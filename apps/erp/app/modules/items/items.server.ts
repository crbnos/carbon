// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ServerFnError } from "@carbon/api/errors";
import { CarbonError, defineServiceFn } from "@carbon/api/service-fn.server";
import { paged, payload, unwrap } from "@carbon/api/service-tools.server";
import { rows } from "@carbon/database/row-schemas";
import {
  activationRefusalMessage,
  getMethodPartsMissingPullFrom,
  getStrictBackflushSettings
} from "@carbon/database/strict-backflush";
import { approvalDecisionValidator } from "@carbon/ee/approvals";
import {
  cancelPendingApprovals,
  decideApprovalRequest,
  openApprovalRequests
} from "@carbon/ee/approvals/document.server";
import { onShapeDataValidator } from "@carbon/ee/onshape";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import {
  chunkArray,
  datetime,
  isUniqueViolation,
  pluckUnique,
  requireAffected
} from "@carbon/utils";
import { z } from "zod";
import { flattenTree } from "~/components/TreeView";
import { replanAfterItemChange } from "~/modules/production/production.server";
import {
  booleanField,
  methodType,
  optionalTiptapDoc,
  requiredTiptapDoc,
  sourcingType
} from "~/modules/shared/shared.models";
import {
  getCompanyTimeZone,
  isActiveCompanyEmployee,
  refuseUnlessOwned
} from "~/modules/shared/shared.service";
import {
  type BomOperation,
  calculateMadePartCosts,
  resolveOperationRates,
  type WorkCenterRate
} from "~/utils/bom";
import { isAssemblerServiceHealthy } from "../production/production.service";
import {
  invokePosting,
  setOperationWorkInstruction
} from "../shared/shared.service";
import {
  applyStorageAndShelfLifeRefines,
  changeNoticeChangeTypes,
  changeNoticeNotifyStages,
  changeNoticeStatusValidator,
  changeNoticeValidator,
  deriveItemMethodUpdate,
  getMethodValidator,
  itemBulkUpdateValidator,
  itemManufacturingValidator,
  itemPlanningValidator,
  itemReplenishmentSystems,
  itemSupersessionValidator,
  itemTrackingTypes,
  makeMethodVersionValidator,
  partFields,
  predecessorSupersessionValidator,
  supplierPartPriceBreaksValidator,
  supplierPartValidator,
  toolFields
} from "./items.models";
import * as service from "./items.service";
import * as utils from "./items.utils";

const logger = getLogger("erp", "change-orders");

// ── Item fields (the items tables' bulk actions and the properties panels) ──

/** The `custom-*` fields of a form, by field id (`setCustomFields`). */
const customFieldsInput = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .optional();

const itemIdsInput = z.array(z.string()).min(1);

export const setItemTrackingType = defineServiceFn({
  publish: true,
  title: "Change items' tracking type",
  description: `Writes \`itemTrackingType\` on every item, then carries the serial and batch
flags onto the open jobs, receipts, shipments and stock transfers that copied
them (\`cascadeItemTrackingType\`). A failed carry-over leaves the items
changed and returns an error.`,
  output: z.object({
    ids: z.array(z.string())
  }),
  input: z.object({
    ids: itemIdsInput,
    itemTrackingType: z.enum(itemTrackingTypes)
  }),
  permission: { update: "parts" },

  async run(ctx, { ids, itemTrackingType }) {
    const companyId = ctx.company.id;
    const update = await ctx.asCaller.supabase
      .from("item")
      .update({
        itemTrackingType,
        updatedBy: ctx.auditUserId,
        updatedAt: datetime.timestamp()
      })
      .in("id", ids)
      .eq("companyId", companyId);
    if (update.error) {
      return ctx.error("internal", update.error.message, update.error);
    }

    try {
      await service.cascadeItemTrackingType(ctx.asSystem.pg, {
        itemIds: ids,
        companyId,
        newType: itemTrackingType,
        userId: ctx.auditUserId
      });
    } catch (err) {
      return ctx.error("internal", "Failed to cascade tracking flags", err);
    }
    return { ids };
  }
});

export const setItemFields = defineServiceFn({
  publish: true,
  title:
    "Change items' name, description, manufacturer part number or unit of measure",
  description: "A field left out is unchanged; every item gets the same value.",
  output: z.object({
    ids: z.array(z.string())
  }),
  input: z.object({
    ids: itemIdsInput,
    name: z.string().optional(),
    description: z.string().optional(),
    mpn: z.string().optional(),
    unitOfMeasureCode: z.string().optional()
  }),
  permission: { update: "parts" },

  async run(ctx, { ids, ...fields }) {
    const update = await ctx.asCaller.supabase
      .from("item")
      .update({
        ...Object.fromEntries(
          Object.entries(fields).filter(([, value]) => value !== undefined)
        ),
        updatedBy: ctx.auditUserId,
        updatedAt: datetime.timestamp()
      })
      .in("id", ids)
      .eq("companyId", ctx.company.id);
    if (update.error) {
      return ctx.error("internal", update.error.message, update.error);
    }
    return { ids };
  }
});

export const setItemSourcing = defineServiceFn({
  publish: true,
  title:
    "Change items' replenishment system, default method type or sourcing type",
  description: `Exactly one of the three per call. They are interlocked
(\`deriveItemMethodUpdate\`): a concrete replenishment system sets the default
method type, a concrete method type sets the replenishment system, and a
sourcing type sets the method type. The item columns and their copies on
the items' Draft method materials change in one transaction
(\`updateItemMethodAndSourcing\`); Active and Archived methods are left alone.`,
  output: z.object({
    ids: z.array(z.string())
  }),
  input: z
    .object({
      ids: itemIdsInput,
      replenishmentSystem: z.enum(itemReplenishmentSystems).optional(),
      defaultMethodType: z.enum(methodType).optional(),
      sourcingType: z.enum(sourcingType).optional()
    })
    .refine(
      (input) =>
        [
          input.replenishmentSystem,
          input.defaultMethodType,
          input.sourcingType
        ].filter((value) => value !== undefined).length === 1,
      {
        message:
          "Set exactly one of replenishmentSystem, defaultMethodType or sourcingType"
      }
    ),
  permission: { update: "parts" },

  async run(
    ctx,
    { ids, replenishmentSystem, defaultMethodType, sourcingType }
  ) {
    const { itemUpdate, cascade } = replenishmentSystem
      ? deriveItemMethodUpdate("replenishmentSystem", replenishmentSystem)
      : defaultMethodType
        ? deriveItemMethodUpdate("defaultMethodType", defaultMethodType)
        : deriveItemMethodUpdate("sourcingType", sourcingType ?? "");
    try {
      await service.updateItemMethodAndSourcing(ctx.asSystem.pg, {
        itemIds: ids,
        companyId: ctx.company.id,
        userId: ctx.auditUserId,
        itemUpdate,
        cascade
      });
    } catch (err) {
      return ctx.error("internal", "Failed to update item", err);
    }
    return { ids };
  }
});

export const setItemActive = defineServiceFn({
  publish: true,
  title: "Activate or deactivate items",
  description: `Activating is refused while a change notice that created an item is not
released: release activates the revisions and parts a notice minted, and an
item switched on by hand would reach the pickers, MRP and job creation with
the notice's unapproved draft method. Deactivating is always allowed.`,
  output: z.object({
    ids: z.array(z.string())
  }),
  input: z.object({ ids: itemIdsInput, active: z.boolean() }),
  permission: { update: "parts" },

  async run(ctx, { ids, active }) {
    const companyId = ctx.company.id;
    if (active) {
      const unreleased = await service.getUnreleasedChangeOrderItems(
        ctx.asSystem.supabase,
        { itemIds: ids, companyId }
      );
      if (unreleased.error) return ctx.error("internal", unreleased.error);
      if (unreleased.data.length > 0) {
        return ctx.error(
          "rule",
          `${service.unreleasedChangeOrderItemsMessage(
            unreleased.data
          )} Release the change notice to activate it.`
        );
      }
    }

    const update = await ctx.asCaller.supabase
      .from("item")
      .update({
        active,
        updatedBy: ctx.auditUserId,
        updatedAt: datetime.timestamp()
      })
      .in("id", ids)
      .eq("companyId", companyId);
    if (update.error) {
      return ctx.error("internal", update.error.message, update.error);
    }
    return { ids };
  }
});

export const setItemPostingGroup = defineServiceFn({
  publish: true,
  title: "Set items' item group (posting group)",
  description: `The group lives on the item's cost row: it is updated where the item has
one, and a Standard cost row of zero is created where it has none. Null
clears the group.`,
  output: z.object({
    ids: z.array(z.string())
  }),
  input: z.object({
    ids: itemIdsInput,
    itemPostingGroupId: z.string().nullable()
  }),
  permission: { update: "parts" },

  async run(ctx, { ids, itemPostingGroupId }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const now = datetime.timestamp();

    const existing = await client
      .from("itemCost")
      .select("itemId")
      .in("itemId", ids)
      .eq("companyId", companyId);
    if (existing.error) {
      return ctx.error("internal", existing.error.message, existing.error);
    }
    const costed = new Set(existing.data.map((row) => row.itemId));
    const uncosted = ids.filter((id) => !costed.has(id));

    if (costed.size > 0) {
      const update = await client
        .from("itemCost")
        .update({ itemPostingGroupId, updatedBy: userId, updatedAt: now })
        .in("itemId", [...costed])
        .eq("companyId", companyId);
      if (update.error) {
        return ctx.error("internal", update.error.message, update.error);
      }
    }
    if (uncosted.length > 0) {
      const insert = await client.from("itemCost").insert(
        uncosted.map((itemId) => ({
          itemId,
          itemPostingGroupId,
          costingMethod: "Standard" as const,
          standardCost: 0,
          unitCost: 0,
          costIsAdjusted: false,
          companyId,
          createdBy: userId,
          updatedBy: userId,
          createdAt: now,
          updatedAt: now
        }))
      );
      if (insert.error) {
        return ctx.error("internal", insert.error.message, insert.error);
      }
    }
    return { ids };
  }
});

/**
 * Set one field on many items.
 *
 * @remarks
 * The items tables' Update and its background job. 100 items at a time, each
 * through the field's own operation (`setItemTrackingType`, `setItemSourcing`,
 * `setItemPostingGroup`), so the value is checked and the cascades run as for
 * one item. Ids that are not the company's items are skipped. A chunk commits
 * on its own: when one fails, the chunks before it stay applied.
 *
 * @returns `done` (items updated) and `skipped` (ids that are not the company's items).
 */
export const updateItems = defineServiceFn({
  input: z.object({ ids: itemIdsInput, change: itemBulkUpdateValidator }),
  permission: { update: "parts" },

  async run(ctx, { ids, change }) {
    const unique = [...new Set(ids)];
    let done = 0;
    for (const chunk of chunkArray(unique, 100)) {
      // The item group write inserts a cost row for each id, so keep only the
      // company's own items.
      const items = await ctx.asCaller.supabase
        .from("item")
        .select("id")
        .in("id", chunk)
        .eq("companyId", ctx.company.id);
      if (items.error) {
        return ctx.error("internal", "Failed to read the items", items.error);
      }
      const owned = items.data.map((item) => item.id);
      if (owned.length === 0) continue;

      const update =
        change.field === "itemTrackingType"
          ? await setItemTrackingType(ctx, {
              ids: owned,
              itemTrackingType: change.value
            })
          : change.field === "itemPostingGroupId"
            ? await setItemPostingGroup(ctx, {
                ids: owned,
                itemPostingGroupId: change.value || null
              })
            : await setItemSourcing(ctx, {
                ids: owned,
                [change.field]: change.value
              });
      if (update.error) {
        return done > 0
          ? ctx.error(
              "internal",
              `Updated ${done} items, then the update failed: ${update.error.message}`,
              update.error
            )
          : update.error;
      }
      done += owned.length;
    }
    return { done, skipped: unique.length - done };
  }
});

const renumberedTable = {
  Part: "part",
  Consumable: "consumable",
  Material: "material",
  Tool: "tool"
} as const;

export const setItemReadableId = defineServiceFn({
  publish: true,
  title:
    "Change the readable id (part number) of a part, consumable, material or tool",
  description: `Every revision of the item takes the new id, and so does its type row
(\`part\`, \`consumable\`, \`material\`, \`tool\`), which is keyed by it. Refused
when the item is not of \`type\`.`,
  output: rows.item
    .pick({ id: true, readableId: true })
    .meta({ table: "item" }),
  input: z.object({
    id: z.string(),
    type: z.enum(["Part", "Consumable", "Material", "Tool"]),
    readableId: z.string().min(1)
  }),
  permission: { update: "parts" },

  async run(ctx, { id, type, readableId }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const item = await client
      .from("item")
      .select("readableId")
      .eq("id", id)
      .eq("type", type)
      .eq("companyId", companyId)
      .maybeSingle();
    if (item.error) {
      return ctx.error("internal", item.error.message, item.error);
    }
    if (!item.data) {
      return ctx.error("notFound", `Item is not a ${type.toLowerCase()}`);
    }
    const current = item.data.readableId;

    const audit = {
      updatedBy: ctx.auditUserId,
      updatedAt: datetime.timestamp()
    };
    try {
      // The type row is keyed by the readable id, so both renames land or
      // neither does. The function's gate is the update policy of both tables.
      await ctx.transaction(async (tx) => {
        await tx.asSystem.pg
          .updateTable("item")
          .set({ readableId, ...audit })
          .where("readableId", "=", current)
          .where("type", "=", type)
          .where("companyId", "=", companyId)
          .execute();
        await tx.asSystem.pg
          .updateTable(renumberedTable[type] as "part")
          .set({ id: readableId, ...audit })
          .where("id", "=", current)
          .where("companyId", "=", companyId)
          .execute();
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return ctx.error(
          "conflict",
          `A ${type.toLowerCase()} with this number already exists`
        );
      }
      throw err;
    }
    return { id, readableId };
  }
});

export const renameService = defineServiceFn({
  publish: true,
  title: "Rename a service",
  description: `A service is identified by its name, so every revision's readable id and the
service row's id follow it (\`updateServiceName\`, one transaction). Refused
when the name is empty or another service already has it.`,
  output: z.object({
    readableId: z.string()
  }),
  input: z.object({ itemId: z.string(), name: z.string() }),
  permission: { update: "parts" },

  async run(ctx, { itemId, name }) {
    let renamed: Awaited<ReturnType<typeof service.updateServiceName>>;
    try {
      renamed = await service.updateServiceName(ctx.asSystem.pg, {
        itemId,
        name,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      });
    } catch (err) {
      return ctx.error("internal", "Failed to update service name", err);
    }
    if (renamed.error) return ctx.error("rule", renamed.error.message);
    return renamed.data;
  }
});

export const setMaterialProperties = defineServiceFn({
  publish: true,
  title: "Change materials' substance, shape, type, finish, grade or dimension",
  description: `For each material among \`ids\` (its revisions count once), the change goes
through \`updateMaterialProperties\`: dependent properties reset, each value
must fit the substance and shape, and generated material ids are renamed.
Each material commits on its own, so every material is tried and every
refusal is named. A field left out is unchanged; null clears it.`,
  output: z.object({
    materialIds: z.array(z.string())
  }),
  input: z.object({
    ids: itemIdsInput,
    materialSubstanceId: z.string().nullable().optional(),
    materialFormId: z.string().nullable().optional(),
    materialTypeId: z.string().nullable().optional(),
    finishId: z.string().nullable().optional(),
    gradeId: z.string().nullable().optional(),
    dimensionId: z.string().nullable().optional()
  }),
  permission: { update: "parts" },

  async run(ctx, { ids, ...properties }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const items = await client
      .from("item")
      .select("readableId")
      .in("id", ids)
      .eq("companyId", companyId);
    if (items.error) {
      return ctx.error("internal", items.error.message, items.error);
    }
    const materialIds = [...new Set(items.data.map((item) => item.readableId))];
    if (materialIds.length === 0) {
      return ctx.error("notFound", "No materials found");
    }

    const changes = Object.fromEntries(
      Object.entries(properties)
        .filter(([, value]) => value !== undefined)
        .map(([field, value]) => [field, value || null])
    );
    const failures: string[] = [];
    for (const materialId of materialIds) {
      const update = await service.updateMaterialProperties(
        client,
        ctx.asSystem.pg,
        {
          id: materialId,
          companyId,
          updatedBy: ctx.auditUserId,
          ...changes
        }
      );
      if (update.error) failures.push(`${materialId}: ${update.error.message}`);
    }
    if (failures.length > 0) return ctx.error("rule", failures.join("; "));
    return { materialIds };
  }
});

// ── Part and tool details, manufacturing and planning ───────────────────────

const partInput = applyStorageAndShelfLifeRefines(
  partFields.extend({ customFields: customFieldsInput })
);

export const createPart = defineServiceFn({
  publish: true,
  title: "Create a part",
  description: `Writes the item and its part row, its item group and unit cost, batch size,
default storage unit and shelf life (\`upsertPart\`).`,
  output: z.object({
    id: z.unknown()
  }),
  input: partInput,
  permission: { create: "parts" },

  async run(ctx, part) {
    const companyId = ctx.company.id;
    const created = await service.upsertPart(ctx.asCaller.supabase, {
      ...part,
      companyId,
      createdBy: ctx.auditUserId
    });
    const id = created.data?.id;
    if (created.error || !id) {
      return ctx.error("internal", "Failed to insert part", created.error);
    }

    return { id };
  }
});

export const updatePart = defineServiceFn({
  publish: true,
  title: "Save a part's details",
  description: `\`id\` is the item id or the part number. A full replace: an optional field
left out is cleared (\`upsertPart\`), including the default storage unit and
shelf life.`,
  output: rows.part.pick({ id: true }).meta({ table: "part" }),
  input: partInput,
  permission: { update: "parts" },

  async run(ctx, part) {
    const updated = await service.upsertPart(ctx.asCaller.supabase, {
      ...part,
      companyId: ctx.company.id,
      updatedBy: ctx.auditUserId
    });
    if (updated.error) {
      return ctx.error("internal", "Failed to update part", updated.error);
    }
    return { id: part.id };
  }
});

export const updateTool = defineServiceFn({
  publish: true,
  title: "Save a tool's details",
  description: `\`id\` is the item id or the tool number. A full replace: an optional field
left out is cleared (\`upsertTool\`).`,
  output: rows.tool.pick({ id: true }).meta({ table: "tool" }),
  input: applyStorageAndShelfLifeRefines(
    toolFields.extend({ customFields: customFieldsInput })
  ),
  permission: { update: "parts" },

  async run(ctx, tool) {
    const updated = await service.upsertTool(ctx.asCaller.supabase, {
      ...tool,
      companyId: ctx.company.id,
      updatedBy: ctx.auditUserId
    });
    if (updated.error) {
      return ctx.error("internal", "Failed to update tool", updated.error);
    }
    return { id: tool.id };
  }
});

export const updateItemManufacturing = defineServiceFn({
  publish: true,
  title: "Save an item's manufacturing settings, then re-plan it",
  description: `Batch size, scrap percentage, lead time and whether it must be configured.
MRP then re-plans the item, so the planning pages' suggestions follow the
new settings now rather than at the next scheduled run; a failed run does
not fail the save.`,
  output: z.object({
    itemId: z.string()
  }),
  input: itemManufacturingValidator.safeExtend({
    customFields: customFieldsInput
  }),
  permission: { update: "parts" },

  async run(ctx, { customFields, ...manufacturing }) {
    const update = await service.upsertItemManufacturing(
      ctx.asCaller.supabase,
      {
        ...manufacturing,
        ...(customFields && { customFields }),
        updatedBy: ctx.auditUserId
      }
    );
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to update item manufacturing",
        update.error
      );
    }
    await replanAfterItemChange(ctx, { itemId: manufacturing.itemId });
    return { itemId: manufacturing.itemId };
  }
});

export const updateItemPlanning = defineServiceFn({
  publish: true,
  title: "Save an item's planning settings at a location, then re-plan it",
  description: `The reordering policy and its sizing parameters, the planning horizon and
the responsible employee. A full replace: an optional field left out is
cleared. The responsible employee must be an active employee of the
company. MRP then re-plans the item, so the planning pages' suggestions
follow the new settings now; a failed run does not fail the save.`,
  output: rows.itemPlanning
    .pick({ itemId: true, locationId: true })
    .meta({ table: "itemPlanning" }),
  input: itemPlanningValidator.safeExtend({ customFields: customFieldsInput }),
  permission: { update: "parts" },

  async run(ctx, { customFields, ...planning }) {
    const client = ctx.asCaller.supabase;
    // The column references the global user table, so the database would
    // take a person from another company, or one since deactivated.
    if (
      planning.responsibleEmployee &&
      !(await isActiveCompanyEmployee(
        client,
        ctx.company.id,
        planning.responsibleEmployee
      ))
    ) {
      return ctx.error("rule", "Choose an employee of this company");
    }

    const update = await service.upsertItemPlanning(client, {
      ...planning,
      ...(customFields && { customFields }),
      updatedBy: ctx.auditUserId
    });
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to update item planning",
        update.error
      );
    }
    await replanAfterItemChange(ctx, { itemId: planning.itemId });
    return { itemId: planning.itemId, locationId: planning.locationId };
  }
});

export const setItemSupersession = defineServiceFn({
  publish: "destructive",
  title:
    "Set or clear an item's supersession: the successor that replaces it and how it is phased out",
  description: `Mode, successor, discontinuation and successor effectivity dates, and the
conversion factor (1 old = N new). No mode clears the supersession. With
\`locationId\`, also the minimum service-stock reserve at that location.
Refused (\`rule\`) when the successor would close a loop, or make a chain
longer than ten hops.`,
  output: rows.itemSupersession
    .pick({ itemId: true })
    .meta({ table: "itemSupersession" }),
  input: itemSupersessionValidator,
  permission: { update: "parts" },

  async run(ctx, supersession) {
    const upsert = await service.upsertItemSupersession(ctx.asCaller.supabase, {
      ...supersession,
      companyId: ctx.company.id,
      createdBy: ctx.auditUserId,
      updatedBy: ctx.auditUserId
    });
    if (upsert.error) {
      return upsert.error.code === service.SUPERSESSION_CYCLE_CODE
        ? ctx.error("rule", upsert.error.message)
        : ctx.error("internal", "Failed to update supersession", upsert.error);
    }
    return { itemId: supersession.itemId };
  }
});

export const addItemPredecessor = defineServiceFn({
  publish: true,
  title:
    "Make another part a predecessor of this one: the other part is phased out in favour of `itemId`",
  description: `The supersession is written on the predecessor, with \`itemId\` as its
successor. Refused when the predecessor is the part itself, is not one of
the company's parts, already has a different successor (change it from that
part's planning page), or would close a loop.`,
  output: z.object({
    itemId: z.string(),
    successorItemId: z.string()
  }),
  input: predecessorSupersessionValidator.safeExtend({ itemId: z.string() }),
  permission: { update: "parts" },

  async run(ctx, { itemId, predecessorItemId, ...supersession }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    if (predecessorItemId === itemId) {
      return ctx.error("rule", "A part cannot be its own predecessor");
    }

    const [predecessor, existing] = await Promise.all([
      client
        .from("item")
        .select("id, readableIdWithRevision")
        .eq("id", predecessorItemId)
        .eq("companyId", companyId)
        .maybeSingle(),
      service.getItemSupersession(client, predecessorItemId, companyId)
    ]);
    if (!predecessor.data) return ctx.error("notFound", "Part not found");
    if (existing.error) {
      return ctx.error(
        "internal",
        "Failed to read the part's supersession",
        existing.error
      );
    }
    if (
      existing.data?.successorItemId &&
      existing.data.successorItemId !== itemId
    ) {
      return ctx.error(
        "rule",
        `${predecessor.data.readableIdWithRevision ?? predecessorItemId} already has a successor (${existing.data.successor?.readableIdWithRevision ?? existing.data.successorItemId}). Change it from that part's planning page.`
      );
    }

    const upsert = await service.upsertItemSupersession(client, {
      ...supersession,
      itemId: predecessorItemId,
      successorItemId: itemId,
      companyId,
      createdBy: ctx.auditUserId,
      updatedBy: ctx.auditUserId
    });
    if (upsert.error) {
      return upsert.error.code === service.SUPERSESSION_CYCLE_CODE
        ? ctx.error("rule", upsert.error.message)
        : ctx.error("internal", "Failed to add predecessor", upsert.error);
    }
    return { itemId: predecessorItemId, successorItemId: itemId };
  }
});

// ── Supplier parts ──────────────────────────────────────────────────────────

const supplierPartInput = supplierPartValidator.omit({ id: true }).extend({
  priceBreaks: supplierPartPriceBreaksValidator.optional(),
  customFields: customFieldsInput
});

const supplierPartTaken =
  "This item already has a supplier part for this supplier";
export const createSupplierPart = defineServiceFn({
  publish: true,
  title:
    "Add a supplier part to an item: what the supplier calls it, and what it costs",
  description: `The supplier's part number, unit of measure and conversion factor, minimum
order quantity, order multiple, and the price per purchase unit in
\`currencyCode\` (the base currency when empty). One supplier part per item
and supplier (\`conflict\`). \`priceBreaks\` are saved as Manual Entry price
breaks; a failed price break write is logged and does not undo the
supplier part.`,
  output: rows.supplierPart.pick({ id: true }).meta({ table: "supplierPart" }),
  input: supplierPartInput,
  permission: { create: "parts" },

  async run(ctx, { priceBreaks, customFields, ...supplierPart }) {
    const client = ctx.asCaller.supabase;
    const created = await service.upsertSupplierPart(client, {
      ...supplierPart,
      ...(customFields && { customFields }),
      companyId: ctx.company.id,
      createdBy: ctx.auditUserId
    });
    if (isUniqueViolation(created.error)) {
      return ctx.error("conflict", supplierPartTaken);
    }
    if (created.error) {
      return ctx.error(
        "internal",
        "Failed to create supplier part",
        created.error
      );
    }
    const id = created.data.id;

    if (priceBreaks?.length) {
      const inserted = await client
        .from("supplierPartPrice")
        .insert(service.priceBreakRows(ctx, id, priceBreaks));
      if (inserted.error) {
        logger.error("Failed to save a new supplier part's price breaks", {
          companyId: ctx.company.id,
          supplierPartId: id,
          error: inserted.error
        });
      }
    }
    return { id };
  }
});

export const updateSupplierPart = defineServiceFn({
  publish: true,
  title: "Save a supplier part",
  description: `A full replace of the supplier part's fields. One supplier part per item and
supplier (\`conflict\`). With \`priceBreaks\`, the supplier part's price breaks
are replaced by them as Manual Entry breaks, in one transaction; without,
they are left as they are.`,
  output: rows.supplierPart.pick({ id: true }).meta({ table: "supplierPart" }),
  input: supplierPartInput.extend({ id: z.string() }),
  permission: { update: "parts" },

  async run(ctx, { id, priceBreaks, customFields, ...supplierPart }) {
    const companyId = ctx.company.id;
    const updated = await service.upsertSupplierPart(ctx.asCaller.supabase, {
      ...supplierPart,
      ...(customFields && { customFields }),
      id,
      companyId,
      updatedBy: ctx.auditUserId
    });
    if (isUniqueViolation(updated.error)) {
      return ctx.error("conflict", supplierPartTaken);
    }
    if (updated.error) {
      return ctx.error(
        "internal",
        "Failed to update supplier part",
        updated.error
      );
    }

    // The caller's update above proved the supplier part is the company's.
    if (priceBreaks) {
      await ctx.transaction(async (tx) => {
        await tx.asSystem.pg
          .deleteFrom("supplierPartPrice")
          .where("supplierPartId", "=", id)
          .where("companyId", "=", companyId)
          .execute();
        if (priceBreaks.length > 0) {
          await tx.asSystem.pg
            .insertInto("supplierPartPrice")
            .values(service.priceBreakRows(ctx, id, priceBreaks))
            .execute();
        }
      });
    }
    return { id };
  }
});

// ── Make methods ────────────────────────────────────────────────────────────
export const copyMethod = defineServiceFn({
  publish: "destructive",
  title: "Copy one make method onto another: Get Method and Save Method",
  description: `\`sourceId\` and \`targetId\` are items (their active method) or make method
versions (\`make_\` ids). The target's bill of materials, bill of process,
parameters, tools, steps and work instructions are replaced by the source's,
each as its flag says (get-method). Refused when the target's revision is
released and release control enforces it, or a change notice holds it; with
release control on warn the copy goes ahead and \`notice\` says why it would
have been held.`,
  output: z.object({
    targetId: z.string(),
    notice: z.string().nullable()
  }),
  input: getMethodValidator,
  permission: { update: "parts" },

  async run(ctx, input) {
    const companyId = ctx.company.id;
    const system = ctx.asSystem.supabase;
    // Copying overwrites the target's materials and operations.
    const lock = await service.checkRevisionLock(system, {
      kind: service.isMakeMethodId(input.targetId) ? "makeMethod" : "item",
      id: input.targetId,
      companyId
    });
    if (!lock.ok) return ctx.error("rule", lock.message);

    const args = { ...input, companyId, userId: ctx.auditUserId };
    const copy =
      service.isMakeMethodId(input.sourceId) ||
      service.isMakeMethodId(input.targetId)
        ? await service.copyMakeMethod(system, ctx.asSystem.pg, args)
        : await service.copyItem(system, ctx.asSystem.pg, args);
    if (copy.error) {
      return ctx.error("internal", "Failed to copy method", copy.error);
    }
    return {
      targetId: input.targetId,
      notice: lock.warn ? lock.message : undefined
    };
  }
});

export const createMethodVersion = defineServiceFn({
  publish: true,
  title:
    "Create a new Draft version of an item's make method, copied from one of its versions",
  description: `The new version takes \`copyFromId\`'s header and, through get-method, its
whole bill of materials and process. \`activeVersionId\` must be \`copyFromId\`:
a Draft source is made Active first (the item's only version, when its
successor is drafted). With strict backflush on, that activation is refused
while a pulled line has no Pull From storage unit, as \`methodVersionToActive\`
refuses it. A failed copy leaves no new version behind.`,
  output: z.object({
    id: z.string(),
    itemId: z.string(),
    type: z.enum([
      "Consumable",
      "Fixture",
      "Material",
      "Part",
      "Service",
      "Tool"
    ])
  }),
  input: makeMethodVersionValidator,
  permission: { create: "parts" },

  async run(ctx, input) {
    const { copyFromId, activeVersionId, version } = input;
    // Any other id could be another item's version, set Active beside its own.
    if (activeVersionId && activeVersionId !== copyFromId) {
      return ctx.error(
        "rule",
        "Only the version being copied can be set Active"
      );
    }
    if (activeVersionId) {
      const db = ctx.asSystem.pg;
      const { strict } = await getStrictBackflushSettings(db, ctx.company.id);
      if (strict) {
        const parts = await getMethodPartsMissingPullFrom(db, {
          makeMethodId: activeVersionId,
          companyId: ctx.company.id
        });
        if (parts.length > 0) {
          return ctx.error("rule", activationRefusalMessage(parts));
        }
      }
    }

    const result = await service.createMakeMethodVersion(
      ctx.asCaller.supabase,
      ctx.asSystem.pg,
      {
        copyFromId,
        version,
        activate: Boolean(activeVersionId),
        companyId: ctx.company.id,
        createdBy: ctx.auditUserId
      }
    );
    // The copy runs as the system, so its refusal is ours, as `copyMethod` reads it.
    if (result.error instanceof ServerFnError) {
      return ctx.error(
        "internal",
        "Failed to create new version",
        result.error
      );
    }
    // `data` is set whenever `error` is not; the null is the union's, not a case.
    return (
      unwrap(ctx, result) ??
      ctx.error("internal", "Failed to create new version")
    );
  }
});

/**
 * Replace a make method's bill of materials with an Onshape assembly's.
 *
 * @remarks
 * The make method must be the company's. `rows` is the assembly's bill of
 * materials as the Onshape panel reads it; the sync server function creates
 * or updates the parts it names and rewrites the method's materials. The
 * method's item is then mapped to the Onshape document, version and element
 * (replacing its earlier mapping), stamped with the sync time.
 */
export const syncOnshapeMethod = defineServiceFn({
  input: z.object({
    makeMethodId: z.string().min(1),
    documentId: z.string(),
    versionId: z.string(),
    elementId: z.string(),
    rows: onShapeDataValidator
  }),
  permission: { update: "parts" },

  async run(ctx, input) {
    const companyId = ctx.company.id;
    const method = await ctx.asCaller.supabase
      .from("makeMethod")
      .select("itemId, companyId")
      .eq("id", input.makeMethodId)
      .maybeSingle();
    if (method.data?.companyId !== companyId) {
      return ctx.error("notFound", "Invalid make method id");
    }
    const { itemId } = method.data;

    const synced = await invokePosting(
      { db: ctx.asSystem.pg, companyId, userId: ctx.auditUserId },
      "sync",
      {
        type: "onshape",
        makeMethodId: input.makeMethodId,
        data: input.rows
      },
      service.syncMakeMethod
    );
    if (synced.error) {
      return ctx.error("internal", "Failed to sync onshape data", synced.error);
    }

    const cleared = await ctx.asSystem.supabase
      .from("externalIntegrationMapping")
      .delete()
      .eq("entityType", "item")
      .eq("entityId", itemId)
      .eq("integration", "onshape")
      .eq("companyId", companyId);
    const mapped = cleared.error
      ? cleared
      : await ctx.asCaller.supabase.from("externalIntegrationMapping").insert({
          entityType: "item",
          entityId: itemId,
          integration: "onshape",
          metadata: {
            documentId: input.documentId,
            versionId: input.versionId,
            elementId: input.elementId
          },
          lastSyncedAt: datetime.timestamp(),
          companyId
        });
    if (mapped.error) {
      // The bill of materials is synced; only the panel's link is stale.
      logger.error("Failed to map the item to its Onshape document", {
        companyId,
        itemId,
        error: mapped.error
      });
    }

    return { itemId };
  }
});

export const deleteMethodOperation = defineServiceFn({
  publish: "destructive",
  title: "Delete an operation from a make method's bill of process",
  description: `Refused when the method's revision is released and release control enforces
it, or a change notice holds it; with release control on warn the delete
goes ahead and \`notice\` says why it would have been held.`,
  output: z.object({
    id: z.string(),
    notice: z.string().nullable()
  }),
  input: z.object({ id: z.string() }),
  permission: { delete: "parts" },

  async run(ctx, { id }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const lock = await service.checkRevisionLock(client, {
      kind: "operation",
      id,
      companyId
    });
    if (!lock.ok) return ctx.error("rule", lock.message);

    const deleted = await requireAffected(
      client
        .from("methodOperation")
        .delete()
        .eq("id", id)
        .eq("companyId", companyId)
        .select("id")
    );
    if (deleted.error) {
      return ctx.error("internal", deleted.error.message, deleted.error);
    }
    return { id, notice: lock.warn ? lock.message : undefined };
  }
});

/**
 * Delete several operations of one make method's bill of process.
 *
 * @remarks
 * The bill of process's Delete Selected. Every operation must belong to the
 * same make method; the method's release lock is checked once, as
 * `deleteMethodOperation` checks it for one.
 */
export const deleteMethodOperations = defineServiceFn({
  input: z.object({ ids: z.array(z.string()).min(1) }),
  permission: { delete: "parts" },

  async run(ctx, { ids }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const makeMethod = await service.getSingleMakeMethodId(
      client,
      companyId,
      "methodOperation",
      ids
    );
    if (makeMethod.error) {
      return ctx.error(
        "internal",
        "Failed to load the operations",
        makeMethod.error
      );
    }
    if (!makeMethod.data) {
      return ctx.error(
        "validation",
        "The operations must belong to one bill of process"
      );
    }
    const lock = await service.checkRevisionLock(client, {
      kind: "makeMethod",
      id: makeMethod.data,
      companyId
    });
    if (!lock.ok) return ctx.error("rule", lock.message);

    const deleted = await client
      .from("methodOperation")
      .delete()
      .in("id", ids)
      .eq("makeMethodId", makeMethod.data)
      .eq("companyId", companyId);
    if (deleted.error) {
      return ctx.error("internal", deleted.error.message, deleted.error);
    }
    return { ids, notice: lock.warn ? lock.message : undefined };
  }
});

export const recalculateItemCost = defineServiceFn({
  publish: true,
  title: "Recalculate a made item's unit cost from its make method",
  description: `Rolls up the active make method (or the newest Draft) and every sub-method:
material costs, and each operation's setup, labor, machine and overhead at
its work center's rates (or the rates of the work centers that run its
process), spread over each item's batch size, as the bill of materials CSV
export does. Overwrites the item's unit cost with the result.`,
  output: z.object({
    itemId: z.string(),
    unitCost: z.number()
  }),
  input: z.object({ itemId: z.string() }),
  permission: { update: "parts" },

  async run(ctx, { itemId }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    const makeMethod = await client
      .from("activeMakeMethods")
      .select("id")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (makeMethod.error || !makeMethod.data?.id) {
      return ctx.error(
        "notFound",
        "No make method found for this item",
        makeMethod.error
      );
    }

    const methodTree = await service.getMethodTree(client, makeMethod.data.id);
    if (methodTree.error) {
      return ctx.error(
        "internal",
        "Failed to load method tree",
        methodTree.error
      );
    }
    const methods =
      methodTree.data.length > 0 ? flattenTree(methodTree.data[0]) : [];
    if (methods.length === 0) {
      return ctx.error("notFound", "No methods found in the method tree");
    }

    const makeMethodIds = pluckUnique(methods, (m) => m.data.makeMethodId);
    const itemIds = pluckUnique(methods, (m) => m.data.itemId);
    const [methodOperations, workCentersResult, lotSizesResult] =
      await Promise.all([
        client
          .from("methodOperation")
          .select(
            "*, ...process(processName:name), ...workCenter(workCenterName:name, laborRate, machineRate, overheadRate)"
          )
          .in("makeMethodId", makeMethodIds)
          .eq("companyId", companyId),
        client
          .from("workCenters")
          .select("id, active, laborRate, machineRate, overheadRate, processes")
          .eq("companyId", companyId),
        client
          .from("itemReplenishment")
          .select("itemId, lotSize")
          .in("itemId", itemIds)
      ]);

    const lotSizesByItemId = new Map(
      (lotSizesResult.data ?? []).map((r) => [r.itemId, r.lotSize ?? 1])
    );
    const workCenters: WorkCenterRate[] = (workCentersResult.data ?? []).map(
      (wc) => ({
        id: wc.id!,
        active: wc.active ?? false,
        laborRate: wc.laborRate,
        machineRate: wc.machineRate,
        overheadRate: wc.overheadRate,
        processes: wc.processes
      })
    );

    const bomOperationsByKey: Record<string, BomOperation[]> = {};
    for (const op of methodOperations.data ?? []) {
      const rates = resolveOperationRates(
        op.workCenterId,
        op.processId,
        op.laborRate,
        op.machineRate,
        op.overheadRate,
        workCenters
      );
      (bomOperationsByKey[op.makeMethodId] ??= []).push({
        operationType: op.operationType,
        setupTime: op.setupTime,
        setupUnit: op.setupUnit,
        laborTime: op.laborTime,
        laborUnit: op.laborUnit,
        machineTime: op.machineTime,
        machineUnit: op.machineUnit,
        operationUnitCost: op.operationUnitCost,
        operationMinimumCost: op.operationMinimumCost,
        ...rates
      } as BomOperation);
    }

    const computedCosts = calculateMadePartCosts(
      methods,
      bomOperationsByKey,
      (node) => node.data.materialMakeMethodId,
      lotSizesByItemId
    );
    // The top-level cost is the root node's.
    const unitCost = computedCosts.get(methods[0].id) ?? 0;

    const update = await client
      .from("itemCost")
      .update({ unitCost, updatedBy: ctx.auditUserId })
      .eq("itemId", itemId)
      .eq("companyId", companyId);
    if (update.error) {
      return ctx.error("internal", "Failed to update item cost", update.error);
    }
    return { itemId, unitCost };
  }
});

// ── Change notices ──────────────────────────────────────────────────────────

// Reason and description arrive as plain text; the columns are tiptap JSON, so
// non-empty text becomes a one-paragraph doc the detail page's editor can edit.
export const createChangeNotice = defineServiceFn({
  publish: true,
  title: "Create a change notice, with the parts it changes",
  description: `The number comes from the change notice sequence unless \`changeOrderId\` is
given; the open date defaults to today in the company's timezone. Each of
\`affectedItemIds\` that is one of the company's parts is added as a Version
change (\`addChangeNoticeAffectedItem\`, which makes a bought part a Revision
and creates the notice's draft method). Anything that is not a part is
skipped. The notice stays when an item cannot be added: \`warning\` says so.`,
  output: z.object({
    id: z.string(),
    warning: z.string().nullable()
  }),
  input: changeNoticeValidator.omit({ id: true, type: true }).extend({
    openDate: z.string().optional(),
    reasonForChange: optionalTiptapDoc,
    description: optionalTiptapDoc,
    customFields: customFieldsInput
  }),
  permission: { create: "parts" },

  async run(ctx, input) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    const created = await service.insertChangeNotice(client, {
      changeNoticeId: input.changeOrderId || undefined,
      name: input.name,
      reasonForChange: input.reasonForChange,
      description: input.description,
      priority: input.priority,
      changeNoticeTypeId: input.changeOrderTypeId || undefined,
      nonConformanceId: input.nonConformanceId || undefined,
      openDate:
        input.openDate ||
        datetime.today(await getCompanyTimeZone(client, companyId)).toString(),
      dueDate: input.dueDate || undefined,
      assignee: input.assignee || undefined,
      companyId,
      createdBy: userId,
      customFields: input.customFields
    });
    if (created.error || !created.data) {
      return ctx.error(
        "internal",
        "Failed to create change notice",
        created.error
      );
    }
    const id = created.data.id;

    // Change notices change parts only; the create modal opens from tool
    // pages too.
    const submitted = [...new Set(input.affectedItemIds ?? [])];
    const items = submitted.length
      ? await client
          .from("item")
          .select("id, type")
          .in("id", submitted)
          .eq("companyId", companyId)
      : null;
    const partIds = (items?.data ?? [])
      .filter((item) => item.type === "Part")
      .map((item) => item.id);

    let failed = !!items?.error;
    for (const itemId of partIds) {
      const added = await service.addChangeNoticeAffectedItem(
        client,
        ctx.asSystem.pg,
        {
          changeNoticeId: id,
          itemId,
          changeType: "Version",
          companyId,
          userId
        }
      );
      if (added.error) {
        logger.error("Failed to add an affected item to a new change notice", {
          companyId,
          changeNoticeId: id,
          itemId,
          error: added.error
        });
        failed = true;
      }
    }

    const warning = failed
      ? "Change notice created, but some items could not be added"
      : partIds.length < submitted.length
        ? "Change notice created. Change notices support Parts only, so non-Part items were skipped"
        : undefined;
    return { id, warning };
  }
});

export const createChangeNoticeForItem = defineServiceFn({
  publish: true,
  title: "Create a change notice for one item",
  description: `Named "Change for" the item, opened today in the company's timezone, with
the item as its first affected item (\`addChangeNoticeAffectedItem\`, a
Version change unless \`changeType\` says otherwise; \`revision\` names a
Revision's new revision). The notice stays when the item cannot be added:
\`warning\` says so.`,
  output: z.union([
    z.object({
      id: z.string(),
      warning: z.string()
    }),
    z.object({
      id: z.string(),
      warning: z.null()
    }),
    z.null()
  ]),
  input: z.object({
    itemId: z.string(),
    changeType: z.enum(changeNoticeChangeTypes).default("Version"),
    revision: z.string().optional()
  }),
  permission: { create: "parts" },

  async run(ctx, { itemId, changeType, revision }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const owned = await refuseUnlessOwned(ctx, "item", { id: itemId });
    if (owned) return owned;

    const item = await service.getItem(client, itemId);
    const label =
      item.data?.readableIdWithRevision ?? item.data?.readableId ?? itemId;

    const created = await service.insertChangeNotice(client, {
      companyId,
      createdBy: userId,
      name: `Change for ${label}`,
      openDate: datetime
        .today(await getCompanyTimeZone(client, companyId))
        .toString()
    });
    if (created.error || !created.data) {
      return ctx.error(
        "internal",
        "Failed to create change notice",
        created.error
      );
    }
    const id = created.data.id;

    const added = await service.addChangeNoticeAffectedItem(
      client,
      ctx.asSystem.pg,
      {
        changeNoticeId: id,
        itemId,
        changeType,
        revision,
        companyId,
        userId
      }
    );
    if (added.error) {
      logger.error("Failed to add the item to its new change notice", {
        companyId,
        changeNoticeId: id,
        itemId,
        error: added.error
      });
      return {
        id,
        warning: "Change notice created, but the item could not be added"
      };
    }
    return { id, warning: undefined };
  }
});

export const setChangeNoticeStatus = defineServiceFn({
  publish: true,
  title: "Move a change notice to another stage",
  description: `\`fromStatus\` is the stage the caller saw: the move is a compare-and-swap on
it, and only the transitions \`changeNoticeStatusTransitions\` allows are
taken. With an approval rule, Engineering Complete → Implementation opens an
approval request and notifies the approvers instead of moving
(\`approvalRequested\`); approving it moves the notice. Implementation → Done
is the release (\`applyChangeNotice\`): it activates each affected item's
draft method, reveals new revisions and parts, and writes their
supersessions. Cancelling, or advancing past the gate after the rule was
turned off, withdraws a pending request. Entering Start, Implementation or
Done notifies the assignee and the action-task assignees.`,
  output: z.object({
    id: z.string(),
    status: z.enum([
      "Cancelled",
      "Done",
      "Draft",
      "Engineering Complete",
      "Implementation",
      "Start"
    ]),
    approvalRequested: z.boolean()
  }),
  input: changeNoticeStatusValidator,
  permission: { update: "parts" },

  async run(ctx, { id, fromStatus, status, assignee }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    const isGatedAdvance =
      fromStatus === "Engineering Complete" && status === "Implementation";
    if (isGatedAdvance) {
      // A stale page must not open a request for a notice that has moved on.
      const current = await client
        .from("changeOrder")
        .select("status")
        .eq("id", id)
        .eq("companyId", companyId)
        .maybeSingle();
      if (current.data?.status !== fromStatus) {
        return ctx.error(
          "conflict",
          service.changeNoticeUpdatedElsewhere,
          current.error
        );
      }

      const opened = await openApprovalRequests(ctx.asSystem.supabase, {
        documentType: "changeOrder",
        documentIds: [id],
        companyId,
        userId
      });
      if (opened.status === "opened" && opened.approverIds.length > 0) {
        await trigger("notify", {
          event: NotificationEvent.ApprovalRequested,
          companyId,
          documentId: id,
          documentType: "changeOrder",
          recipient: { type: "users", userIds: opened.approverIds },
          from: userId
        }).catch((e) =>
          logger.error("Failed to notify change notice approvers", {
            companyId,
            changeNoticeId: id,
            error: e
          })
        );
      }
      if (opened.status === "failed") {
        return ctx.error("internal", "Failed to submit for approval");
      }
      if (opened.status === "opened") {
        if (opened.requested.length === 0) {
          return ctx.error(
            "conflict",
            "This change notice is already waiting for approval"
          );
        }
        return { id, status: fromStatus, approvalRequested: true };
      }
    }

    if (status === "Done") {
      const applied = await service.applyChangeNotice(client, ctx.asSystem.pg, {
        changeNoticeId: id,
        userId,
        companyId
      });
      if (applied.error || !applied.data) {
        return service.changeNoticeRefusal(
          ctx,
          applied.error,
          "Failed to apply change notice"
        );
      }
    } else {
      const update = await service.updateChangeNoticeStatus(client, {
        id,
        companyId,
        fromStatus,
        toStatus: status,
        assignee,
        updatedBy: userId
      });
      if (update.error || !update.data) {
        return service.changeNoticeRefusal(
          ctx,
          update.error,
          "Failed to update change notice status"
        );
      }
    }

    if (status === "Cancelled" || isGatedAdvance) {
      const cancelled = await cancelPendingApprovals(ctx.asSystem.supabase, {
        documentType: "changeOrder",
        documentIds: [id],
        companyId,
        userId
      });
      if (cancelled.error) {
        logger.error("Failed to cancel change notice approval requests", {
          companyId,
          changeNoticeId: id,
          error: cancelled.error
        });
      }
    }

    if (changeNoticeNotifyStages.includes(status)) {
      await service.notifyChangeNoticeTransition({
        client,
        event: service.changeNoticeStageEvent[status],
        changeNoticeId: id,
        companyId,
        userId
      });
    }
    return { id, status, approvalRequested: false };
  }
});

export const decideChangeNoticeApproval = defineServiceFn({
  publish: true,
  title: "Approve or reject a change notice's pending approval request",
  description: `Approving moves the notice from Engineering Complete to Implementation, in
the decision's transaction, and notifies the notice's assignee and
action-task assignees as an advance would. Rejecting leaves the stage. The
requester is told either way, unless they decided it themselves.`,
  output: z.object({
    changeNoticeId: z.string(),
    decision: z.enum(["Approved", "Rejected"])
  }),
  input: approvalDecisionValidator.extend({ changeNoticeId: z.string() }),
  permission: { update: "parts" },

  async run(ctx, { changeNoticeId, approvalRequestId, decision, notes }) {
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const owned = await refuseUnlessOwned(ctx, "changeOrder", {
      id: changeNoticeId
    });
    if (owned) return owned;

    const result = await decideApprovalRequest(
      ctx.asSystem.supabase,
      ctx.asSystem.pg,
      {
        documentType: "changeOrder",
        documentId: changeNoticeId,
        companyId,
        userId,
        approvalRequestId,
        decision,
        notes
      }
    );
    if (result.error) {
      return ctx.error(
        result.error.code === "not-found"
          ? "notFound"
          : result.error.code === "forbidden"
            ? "forbidden"
            : "internal",
        result.error.message,
        result.error
      );
    }

    if (result.requestedBy !== userId) {
      await trigger("notify", {
        event:
          decision === "Approved"
            ? NotificationEvent.ApprovalApproved
            : NotificationEvent.ApprovalRejected,
        companyId,
        documentId: changeNoticeId,
        documentType: "changeOrder",
        recipient: { type: "user", userId: result.requestedBy },
        from: userId
      }).catch((e) =>
        logger.error("Failed to notify the approval requester", {
          companyId,
          changeNoticeId,
          error: e
        })
      );
    }

    if (decision === "Approved") {
      await service.notifyChangeNoticeTransition({
        client: ctx.asCaller.supabase,
        event: service.changeNoticeStageEvent.Implementation,
        changeNoticeId,
        companyId,
        userId
      });
    }
    return { changeNoticeId, decision };
  }
});
export const activateMethodVersion = defineServiceFn({
  publish: true,
  title: "Activate method version",
  output: z.union([
    z.object({
      id: z.string(),
      convertedId: z.null().optional()
    }),
    z.object({
      convertedId: z.string(),
      id: z.null().optional()
    }),
    z.null()
  ]),
  input: z.looseObject({ id: z.string() }),
  permission: { update: "parts" },
  async run(ctx, input) {
    const lock = await service.checkRevisionLocks(
      ctx.asSystem.supabase,
      ctx.company.id,
      [{ kind: "makeMethod", id: input.id }]
    );
    if (!lock.ok) return ctx.error("rule", lock.message);
    return service.withLockNotice(
      lock,
      unwrap(
        ctx,
        await service.activateMethodVersion(
          ctx.asCaller.supabase,
          ctx.asSystem.pg,
          payload(ctx, input).withUser().build() as never
        )
      )
    );
  }
});

export const createRevision = defineServiceFn({
  publish: true,
  title: "Create revision",
  output: z.object({
    id: z.string()
  }),
  input: z.looseObject({
    item: z.looseObject({
      companyId: z.string().nullable(),
      id: z.string(),
      name: z.string(),
      type: z.enum([
        "Part",
        "Service",
        "Material",
        "Tool",
        "Fixture",
        "Consumable"
      ]),
      modelUploadId: z.string().nullable(),
      description: z.string().nullable(),
      unitOfMeasureCode: z.string().nullable(),
      readableId: z.string(),
      defaultMethodType: z
        .enum(["Purchase to Order", "Pull from Inventory", "Make to Order"])
        .nullable(),
      itemTrackingType: z.enum([
        "Inventory",
        "Non-Inventory",
        "Serial",
        "Batch"
      ]),
      mpn: z.string().nullable(),
      replenishmentSystem: z.enum(["Buy", "Make", "Buy and Make"]),
      sourcingType: z.enum(["Specified", "Drop Ship", "Ship from Inventory"]),
      thumbnailPath: z.string().nullable()
    }),
    revision: z.string(),
    active: z.boolean().optional()
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.createRevision(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});

export const deleteConfigurationParameter = defineServiceFn({
  publish: "destructive",
  title: "Delete configuration parameter",
  output: z.array(
    rows.configurationParameter
      .pick({ id: true })
      .meta({ table: "configurationParameter" })
  ),
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteConfigurationParameter(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

export const deleteConfigurationRule = defineServiceFn({
  publish: "destructive",
  title: "Delete configuration rule",
  output: z.null(),
  input: z.looseObject({ field: z.string(), itemId: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteConfigurationRule(
        ctx.asCaller.supabase,
        input.field as never,
        input.itemId as never
      )
    );
  }
});

export const deleteItemCustomerPart = defineServiceFn({
  publish: "destructive",
  title: "Delete item customer part",
  output: z.array(rows.customer.pick({ id: true }).meta({ table: "customer" })),
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteItemCustomerPart(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

export const deleteSupplierPart = defineServiceFn({
  publish: "destructive",
  title: "Delete supplier part",
  output: z.array(
    rows.supplierPart.pick({ id: true }).meta({ table: "supplierPart" })
  ),
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteSupplierPart(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

export const deleteConfigurationParameterGroup = defineServiceFn({
  publish: "destructive",
  title: "Delete configuration parameter group",
  output: z.array(
    rows.configurationParameterGroup
      .pick({ id: true })
      .meta({ table: "configurationParameterGroup" })
  ),
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteConfigurationParameterGroup(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

export const deleteItem = defineServiceFn({
  publish: "destructive",
  title: "Delete item",
  output: z.null(),
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteItem(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

export const deleteItemPostingGroup = defineServiceFn({
  publish: "destructive",
  title: "Delete item posting group",
  output: z.array(
    rows.itemPostingGroup.pick({ id: true }).meta({ table: "itemPostingGroup" })
  ),
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteItemPostingGroup(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

export const deleteMaterialDimension = defineServiceFn({
  publish: "destructive",
  title: "Delete material dimension",
  output: z.array(
    rows.materialDimension
      .pick({ id: true })
      .meta({ table: "materialDimension" })
  ),
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteMaterialDimension(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

export const deleteMaterialFinish = defineServiceFn({
  publish: "destructive",
  title: "Delete material finish",
  output: z.array(
    rows.materialFinish.pick({ id: true }).meta({ table: "materialFinish" })
  ),
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteMaterialFinish(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

export const deleteMaterialForm = defineServiceFn({
  publish: "destructive",
  title: "Delete material form",
  output: z.array(
    rows.materialForm.pick({ id: true }).meta({ table: "materialForm" })
  ),
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteMaterialForm(ctx.asCaller.supabase, input.id as never)
    );
  }
});

export const deleteMaterialGrade = defineServiceFn({
  publish: "destructive",
  title: "Delete material grade",
  output: z.array(
    rows.materialGrade.pick({ id: true }).meta({ table: "materialGrade" })
  ),
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteMaterialGrade(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

export const deleteMaterialSubstance = defineServiceFn({
  publish: "destructive",
  title: "Delete material substance",
  output: z.array(
    rows.materialSubstance
      .pick({ id: true })
      .meta({ table: "materialSubstance" })
  ),
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteMaterialSubstance(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

export const deleteMethodMaterial = defineServiceFn({
  publish: "destructive",
  title: "Delete method material",
  output: z.array(
    rows.methodMaterial.pick({ id: true }).meta({ table: "methodMaterial" })
  ),
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    const lock = await service.checkRevisionLocks(
      ctx.asCaller.supabase,
      ctx.company.id,
      [{ kind: "material", id: input.id }]
    );
    if (!lock.ok) return ctx.error("rule", lock.message);
    return service.withLockNotice(
      lock,
      unwrap(
        ctx,
        await service.deleteMethodMaterial(
          ctx.asCaller.supabase,
          input.id as never
        )
      )
    );
  }
});

/**
 * Delete several materials of one make method's bill of material.
 *
 * @remarks
 * The bill of material's Delete Selected. Every material must belong to the
 * same make method; the method's release lock is checked once, as
 * `deleteMethodMaterial` checks it for one.
 */
export const deleteMethodMaterials = defineServiceFn({
  input: z.object({ ids: z.array(z.string()).min(1) }),
  permission: { delete: "parts" },

  async run(ctx, { ids }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const makeMethod = await service.getSingleMakeMethodId(
      client,
      companyId,
      "methodMaterial",
      ids
    );
    if (makeMethod.error) {
      return ctx.error(
        "internal",
        "Failed to load the materials",
        makeMethod.error
      );
    }
    if (!makeMethod.data) {
      return ctx.error(
        "validation",
        "The materials must belong to one bill of material"
      );
    }
    const lock = await service.checkRevisionLock(client, {
      kind: "makeMethod",
      id: makeMethod.data,
      companyId
    });
    if (!lock.ok) return ctx.error("rule", lock.message);

    const deleted = await client
      .from("methodMaterial")
      .delete()
      .in("id", ids)
      .eq("makeMethodId", makeMethod.data)
      .eq("companyId", companyId);
    if (deleted.error) {
      return ctx.error(
        "internal",
        "Failed to delete method material",
        deleted.error
      );
    }
    return { ids, notice: lock.warn ? lock.message : undefined };
  }
});

export const assertMethodOperationIsDraft = defineServiceFn({
  publish: true,
  title: "Assert method operation is draft",
  output: z.object({
    operationId: z.string()
  }),
  input: z.looseObject({ operationId: z.string() }),
  permission: { update: "parts" },
  async run(ctx, input) {
    try {
      await service.assertMethodOperationIsDraft(
        ctx.asCaller.supabase,
        input.operationId
      );
    } catch (err) {
      return ctx.error(
        "rule",
        err instanceof Error ? err.message : "Failed to find method operation"
      );
    }
    return { operationId: input.operationId };
  }
});

export const deleteMethodOperationStep = defineServiceFn({
  publish: "destructive",
  title: "Delete method operation step",
  output: z.array(
    rows.methodOperationStep
      .pick({ id: true })
      .meta({ table: "methodOperationStep" })
  ),
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    const lock = await service.checkRevisionLock(ctx.asCaller.supabase, {
      kind: "step",
      id: input.id,
      companyId: ctx.company.id
    });
    if (!lock.ok) return ctx.error("rule", lock.message);
    const refusal = await service.methodStepRefusal(
      ctx.asCaller.supabase,
      ctx.company.id,
      { stepId: input.id }
    );
    if (refusal) return ctx.error("rule", refusal);
    return service.withLockNotice(
      lock,
      unwrap(
        ctx,
        await service.deleteMethodOperationStep(ctx.asCaller.supabase, input.id)
      )
    );
  }
});

export const deleteMethodOperationStepSlide = defineServiceFn({
  publish: "destructive",
  title: "Delete method operation step slide",
  output: z.array(
    rows.methodOperationStepSlide
      .pick({ id: true })
      .meta({ table: "methodOperationStepSlide" })
  ),
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    const refusal = await service.methodStepRefusal(
      ctx.asCaller.supabase,
      ctx.company.id,
      { slideId: input.id }
    );
    if (refusal) return ctx.error("rule", refusal);
    return unwrap(
      ctx,
      await service.deleteMethodOperationStepSlide(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

export const deleteMethodOperationParameter = defineServiceFn({
  publish: "destructive",
  title: "Delete method operation parameter",
  output: z.array(
    rows.methodOperationParameter
      .pick({ id: true })
      .meta({ table: "methodOperationParameter" })
  ),
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    const lock = await service.checkRevisionLocks(
      ctx.asCaller.supabase,
      ctx.company.id,
      [{ kind: "parameter", id: input.id }]
    );
    if (!lock.ok) return ctx.error("rule", lock.message);
    return service.withLockNotice(
      lock,
      unwrap(
        ctx,
        await service.deleteMethodOperationParameter(
          ctx.asCaller.supabase,
          input.id as never
        )
      )
    );
  }
});

export const deleteMethodOperationTool = defineServiceFn({
  publish: "destructive",
  title: "Delete method operation tool",
  output: z.array(
    rows.methodOperationTool
      .pick({ id: true })
      .meta({ table: "methodOperationTool" })
  ),
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    const lock = await service.checkRevisionLocks(
      ctx.asCaller.supabase,
      ctx.company.id,
      [{ kind: "tool", id: input.id }]
    );
    if (!lock.ok) return ctx.error("rule", lock.message);
    return service.withLockNotice(
      lock,
      unwrap(
        ctx,
        await service.deleteMethodOperationTool(
          ctx.asCaller.supabase,
          input.id as never
        )
      )
    );
  }
});

export const deleteUnitOfMeasure = defineServiceFn({
  publish: "destructive",
  title: "Delete unit of measure",
  output: z.array(
    rows.unitOfMeasure.pick({ id: true }).meta({ table: "unitOfMeasure" })
  ),
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteUnitOfMeasure(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

export const getConfigurationParameters = defineServiceFn({
  publish: "read",
  title: "Get configuration parameters",
  output: z.object({
    groups: z.array(
      z.object({
        companyId: z.string(),
        id: z.string(),
        isUngrouped: z.boolean(),
        itemId: z.string(),
        name: z.string(),
        sortOrder: z.number()
      })
    ),
    parameters: z.array(
      z.object({
        companyId: z.string(),
        configurationParameterGroupId: z.string().nullable(),
        createdAt: z.string(),
        createdBy: z.string(),
        dataType: z.enum([
          "boolean",
          "date",
          "list",
          "material",
          "numeric",
          "text"
        ]),
        id: z.string(),
        itemId: z.string(),
        key: z.string(),
        label: z.string(),
        listOptions: z.array(z.string()).nullable(),
        materialFormFilterId: z.string().nullable(),
        sortOrder: z.number(),
        updatedAt: z.string().nullable(),
        updatedBy: z.string().nullable()
      })
    )
  }),
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return await utils.getConfigurationParameters(
      ctx.asCaller.supabase,
      input.itemId as never,
      ctx.company.id
    );
  }
});

export const getConfigurationRules = defineServiceFn({
  publish: "read",
  title: "Get configuration rules",
  output: z.array(rows.configurationRule),
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return await service.getConfigurationRules(
      ctx.asCaller.supabase,
      input.itemId as never,
      ctx.company.id
    );
  }
});

export const getConsumable = defineServiceFn({
  publish: "read",
  title: "Get consumable",
  output: z.object({
    active: z.boolean(),
    assignee: z.string(),
    companyId: z.string(),
    createdAt: z.string(),
    createdBy: z.string(),
    customFields: z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.record(
        z.string(),
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(z.string(), z.unknown()),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.array(
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.null()
    ]),
    defaultMethodType: z.enum([
      "Make to Order",
      "Pull from Inventory",
      "Purchase to Order"
    ]),
    description: z.string(),
    id: z.string(),
    itemPostingGroupId: z.string(),
    itemTrackingType: z.enum(["Batch", "Inventory", "Non-Inventory", "Serial"]),
    modelName: z.string(),
    modelPath: z.string(),
    modelSize: z.number(),
    modelUploadId: z.string(),
    mpn: z.string(),
    name: z.string(),
    notes: z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.record(
        z.string(),
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(z.string(), z.unknown()),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.array(
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.null()
    ]),
    readableId: z.string(),
    readableIdWithRevision: z.string(),
    replenishmentSystem: z.enum(["Buy", "Buy and Make", "Make"]),
    revision: z.string(),
    revisions: z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.record(
        z.string(),
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(z.string(), z.unknown()),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.array(
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.null()
    ]),
    sourcingType: z.enum(["Drop Ship", "Ship from Inventory", "Specified"]),
    supplierIds: z.string(),
    tags: z.array(z.string()),
    thumbnailPath: z.string(),
    unitOfMeasure: z.string(),
    unitOfMeasureCode: z.string(),
    updatedAt: z.string(),
    updatedBy: z.string()
  }),
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getConsumable(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

export const getConsumables = defineServiceFn({
  publish: "read",
  title: "Get consumables",
  output: z
    .array(
      rows.consumables
        .pick({
          active: true,
          assignee: true,
          defaultMethodType: true,
          description: true,
          itemTrackingType: true,
          name: true,
          replenishmentSystem: true,
          readableIdWithRevision: true,
          id: true,
          companyId: true,
          thumbnailPath: true,
          supplierIds: true,
          tags: true,
          itemPostingGroupId: true,
          createdBy: true,
          createdAt: true,
          updatedBy: true,
          updatedAt: true,
          supersessionMode: true,
          mpn: true,
          suppliers: true
        })
        .extend({
          customFields: z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        })
    )
    .nullable(),
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    supplierId: z.string().nullable().optional()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getConsumables(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getItem = defineServiceFn({
  publish: "read",
  title: "Get item",
  output: rows.item
    .pick({
      active: true,
      assignee: true,
      changeOrderId: true,
      companyId: true,
      createdAt: true,
      createdBy: true,
      defaultMethodType: true,
      description: true,
      embedding: true,
      id: true,
      itemTrackingType: true,
      modelUploadId: true,
      mpn: true,
      name: true,
      readableId: true,
      readableIdWithRevision: true,
      replenishmentSystem: true,
      revision: true,
      revisionStatus: true,
      sourcingType: true,
      thumbnailPath: true,
      trackingMethod: true,
      type: true,
      unitOfMeasureCode: true,
      updatedAt: true,
      updatedBy: true
    })
    .extend({
      notes: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.null()
      ])
    })
    .meta({ table: "item" }),
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getItem(ctx.asCaller.supabase, input.id as never)
    );
  }
});

export const getItemCost = defineServiceFn({
  publish: "read",
  title: "Get item cost",
  output: rows.itemCost
    .pick({
      companyId: true,
      costingMethod: true,
      costIsAdjusted: true,
      createdAt: true,
      createdBy: true,
      itemId: true,
      itemPostingGroupId: true,
      standardCost: true,
      tags: true,
      unitCost: true,
      updatedAt: true,
      updatedBy: true
    })
    .extend({
      customFields: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.null()
      ]),
      readableIdWithRevision: z.string().nullable()
    })
    .meta({ table: "itemCost" }),
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getItemCost(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

export const getItemCostHistory = defineServiceFn({
  publish: "read",
  title: "Get item cost history",
  output: z.array(rows.costLedger),
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getItemCostHistory(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

export const getItemCustomerPart = defineServiceFn({
  publish: "read",
  title: "Get item customer part",
  output: z.object({
    companyId: z.string(),
    customerId: z.string(),
    customerPartId: z.string(),
    customerPartRevision: z.string().nullable(),
    id: z.string(),
    itemId: z.string(),
    customer: z.object({
      id: z.string(),
      name: z.string()
    })
  }),
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getItemCustomerPart(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

export const getItemCustomerParts = defineServiceFn({
  publish: "read",
  title: "Get item customer parts",
  output: z.array(
    z.object({
      companyId: z.string(),
      customerId: z.string(),
      customerPartId: z.string(),
      customerPartRevision: z.string().nullable(),
      id: z.string(),
      itemId: z.string(),
      customer: z.object({
        id: z.string(),
        name: z.string()
      })
    })
  ),
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getItemCustomerParts(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

export const getItemDemand = defineServiceFn({
  publish: "read",
  title: "Get item demand",
  output: z.null(),
  input: z.looseObject({
    itemId: z.string(),
    locationId: z.string(),
    periods: z.array(z.string())
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getItemDemand(
        ctx.asCaller.supabase,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getDemandForecastSources = defineServiceFn({
  publish: "read",
  title: "Get demand forecast sources",
  output: z.array(
    rows.demandForecastSource
      .pick({
        itemId: true,
        locationId: true,
        periodId: true,
        sourceType: true,
        quantity: true,
        jobId: true,
        salesOrderLineId: true,
        demandProjectionId: true,
        parentItemId: true,
        redirectedFromItemId: true
      })
      .extend({
        parentItem: z.object({
          id: z.string(),
          readableId: z.string(),
          name: z.string()
        }),
        redirectedFromItem: z
          .object({
            id: z.string(),
            readableIdWithRevision: z.string().nullable()
          })
          .nullable(),
        job: z
          .object({
            id: z.string(),
            jobId: z.string(),
            dueDate: z.string().nullable(),
            status: z.enum([
              "Cancelled",
              "Closed",
              "Completed",
              "Draft",
              "Due Today",
              "In Progress",
              "Overdue",
              "Paused",
              "Planned",
              "Ready"
            ])
          })
          .nullable(),
        salesOrderLine: z
          .object({
            id: z.string(),
            salesOrderId: z.string(),
            promisedDate: z.string().nullable(),
            salesOrder: z.object({
              id: z.string(),
              salesOrderId: z.string()
            })
          })
          .nullable(),
        demandProjection: z
          .object({
            id: z.string(),
            forecastQuantity: z.number(),
            forecastMethod: z.string().nullable(),
            confidence: z.number().nullable(),
            notes: z.string().nullable(),
            period: z.object({
              startDate: z.string()
            }),
            createdBy: z.string(),
            createdAt: z.string()
          })
          .nullable()
      })
      .meta({ table: "demandForecastSource" })
  ),
  input: z.looseObject({
    itemId: z.string(),
    locationId: z.string(),
    periods: z.array(z.string())
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getDemandForecastSources(
        ctx.asCaller.supabase,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getItemFiles = defineServiceFn({
  publish: "read",
  title: "Get item files",
  output: z.array(
    z.object({
      name: z.string(),
      id: z.string().nullable(),
      updated_at: z.string().nullable(),
      created_at: z.string().nullable(),
      last_accessed_at: z.string().nullable(),
      metadata: z
        .object({
          eTag: z.string(),
          size: z.number(),
          mimetype: z.string(),
          cacheControl: z.string(),
          lastModified: z.string(),
          contentLength: z.number(),
          httpStatusCode: z.number()
        })
        .nullable(),
      bucket_id: z.string().nullable().optional(),
      owner: z.string().nullable().optional(),
      buckets: z
        .object({
          id: z.string(),
          type: z
            .union([
              z.unknown(),
              z.literal("STANDARD"),
              z.literal("ANALYTICS"),
              z.null()
            ])
            .optional(),
          name: z.string(),
          owner: z.string(),
          file_size_limit: z.number().nullable().optional(),
          allowed_mime_types: z.array(z.string()).nullable().optional(),
          created_at: z.string(),
          updated_at: z.string(),
          public: z.boolean(),
          versioning_status: z
            .enum(["DISABLED", "ENABLED", "SUSPENDED"])
            .nullable()
            .optional()
        })
        .nullable()
        .optional(),
      version: z.string().nullable().optional(),
      archived_at: z.string().nullable().optional(),
      is_delete_marker: z.boolean().nullable().optional(),
      is_versioned: z.boolean().nullable().optional()
    })
  ),
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return await service.getItemFiles(
      ctx.asCaller.supabase,
      input.itemId as never,
      ctx.company.id
    );
  }
});

export const getItemPostingGroup = defineServiceFn({
  publish: "read",
  title: "Get item posting group",
  output: rows.itemPostingGroup
    .pick({
      active: true,
      companyId: true,
      createdAt: true,
      createdBy: true,
      description: true,
      id: true,
      name: true,
      tags: true,
      updatedAt: true,
      updatedBy: true
    })
    .extend({
      customFields: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.null()
      ])
    })
    .meta({ table: "itemPostingGroup" }),
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getItemPostingGroup(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

export const getItemPostingGroups = defineServiceFn({
  publish: "read",
  title: "Get item posting groups",
  output: z
    .array(
      rows.itemPostingGroup
        .pick({
          active: true,
          companyId: true,
          createdAt: true,
          createdBy: true,
          description: true,
          id: true,
          name: true,
          tags: true,
          updatedAt: true,
          updatedBy: true
        })
        .extend({
          customFields: z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        })
        .meta({ table: "itemPostingGroup" })
    )
    .nullable(),
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getItemPostingGroups(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getItemPostingGroupsList = defineServiceFn({
  publish: "read",
  title: "Get item posting groups list",
  output: z.array(
    rows.itemPostingGroup
      .pick({ id: true, name: true })
      .meta({ table: "itemPostingGroup" })
  ),
  input: z.record(z.string(), z.unknown()),
  permission: { view: "parts" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getItemPostingGroupsList(
        ctx.asCaller.supabase,
        ctx.company.id
      )
    );
  }
});

export const getItemManufacturing = defineServiceFn({
  publish: "read",
  title: "Get item manufacturing",
  output: z.object({
    companyId: z.string(),
    conversionFactor: z.number(),
    createdAt: z.string(),
    createdBy: z.string(),
    customFields: z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.record(
        z.string(),
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(z.string(), z.unknown()),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.array(
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.null()
    ]),
    itemId: z.string(),
    leadTime: z.number(),
    lotSize: z.number().nullable(),
    manufacturingBlocked: z.boolean(),
    preferredSupplierId: z.string().nullable(),
    purchasingBlocked: z.boolean(),
    purchasingUnitOfMeasureCode: z.string().nullable(),
    requiresConfiguration: z.boolean(),
    scrapPercentage: z.number(),
    tags: z.array(z.string()).nullable(),
    updatedAt: z.string().nullable(),
    updatedBy: z.string().nullable()
  }),
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getItemManufacturing(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

export const getItemPlanning = defineServiceFn({
  publish: "read",
  title: "Get item planning",
  output: rows.itemPlanning
    .pick({
      allowCommonSupplyForProjects: true,
      companyId: true,
      createdAt: true,
      createdBy: true,
      critical: true,
      demandAccumulationIncludesInventory: true,
      demandAccumulationPeriod: true,
      demandAccumulationSafetyStock: true,
      itemId: true,
      locationId: true,
      maximumInventoryQuantity: true,
      maximumOrderQuantity: true,
      minimumOrderQuantity: true,
      minimumReserveQuantity: true,
      orderMultiple: true,
      planningHorizonDays: true,
      reorderingPolicy: true,
      reorderPoint: true,
      reorderQuantity: true,
      responsibleEmployee: true,
      tags: true,
      updatedAt: true,
      updatedBy: true
    })
    .extend({
      customFields: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.null()
      ])
    })
    .meta({ table: "itemPlanning" }),
  input: z.looseObject({ itemId: z.string(), locationId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getItemPlanning(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id,
        input.locationId as never
      )
    );
  }
});

export const getItemQuantities = defineServiceFn({
  publish: "read",
  title: "Get item quantities",
  output: z.object({
    active: z.boolean(),
    daysRemaining: z.number(),
    demandAccumulationPeriod: z.number(),
    demandAccumulationSafetyStock: z.number(),
    demandForecast: z.number(),
    dimension: z.string(),
    dimensionId: z.string(),
    finish: z.string(),
    finishId: z.string(),
    grade: z.string(),
    gradeId: z.string(),
    id: z.string(),
    itemTrackingType: z.enum(["Batch", "Inventory", "Non-Inventory", "Serial"]),
    leadTime: z.number(),
    lotSize: z.number(),
    materialFormId: z.string(),
    materialSubstanceId: z.string(),
    materialType: z.string(),
    materialTypeId: z.string(),
    maximumInventoryQuantity: z.number(),
    maximumOrderQuantity: z.number(),
    minimumOrderQuantity: z.number(),
    name: z.string(),
    orderMultiple: z.number(),
    quantityOnHand: z.number(),
    quantityOnHold: z.number(),
    quantityOnProductionDemand: z.number(),
    quantityOnProductionOrder: z.number(),
    quantityOnPurchaseOrder: z.number(),
    quantityOnSalesOrder: z.number(),
    quantityRejected: z.number(),
    readableId: z.string(),
    readableIdWithRevision: z.string(),
    reorderingPolicy: z.enum([
      "Demand-Based Reorder",
      "Fixed Reorder Quantity",
      "Manual Reorder",
      "Maximum Quantity"
    ]),
    reorderPoint: z.number(),
    reorderQuantity: z.number(),
    replenishmentSystem: z.enum(["Buy", "Buy and Make", "Make"]),
    storageTypeIds: z.array(z.string()),
    storageUnitIds: z.array(z.string()),
    tags: z.array(z.string()),
    thumbnailPath: z.string(),
    type: z.enum([
      "Consumable",
      "Fixture",
      "Material",
      "Part",
      "Service",
      "Tool"
    ]),
    unitOfMeasureCode: z.string(),
    usageLast30Days: z.number(),
    usageLast90Days: z.number()
  }),
  input: z.looseObject({ itemId: z.string(), locationId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getItemQuantities(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id,
        input.locationId as never
      )
    );
  }
});

export const getItemStockQuantitiesByLocation = defineServiceFn({
  publish: "read",
  title:
    "On-hand quantity per item for the Item picker's badge, as a plain map",
  output: z.record(z.string(), z.number()),
  input: z.looseObject({ locationId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getItemStockQuantitiesByLocation(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.locationId as never
      )
    );
  }
});

export const getItemReplenishment = defineServiceFn({
  publish: "read",
  title: "Get item replenishment",
  output: rows.itemReplenishment
    .pick({
      companyId: true,
      conversionFactor: true,
      createdAt: true,
      createdBy: true,
      itemId: true,
      leadTime: true,
      lotSize: true,
      manufacturingBlocked: true,
      preferredSupplierId: true,
      purchasingBlocked: true,
      purchasingUnitOfMeasureCode: true,
      requiresConfiguration: true,
      scrapPercentage: true,
      tags: true,
      updatedAt: true,
      updatedBy: true
    })
    .extend({
      customFields: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.null()
      ])
    })
    .meta({ table: "itemReplenishment" }),
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getItemReplenishment(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

export const getItemSupersession = defineServiceFn({
  publish: "read",
  title: "Get item supersession",
  output: rows.itemSupersession
    .extend({
      successor: z
        .object({
          id: z.string(),
          readableIdWithRevision: z.string().nullable(),
          name: z.string()
        })
        .nullable()
    })
    .meta({ table: "itemSupersession" }),
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getItemSupersession(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

export const getItemSupersessionsForItems = defineServiceFn({
  publish: "read",
  title: "Get item supersessions for items",
  output: z.union([
    z.array(z.unknown()),
    z.array(
      z.object({
        itemId: z.string(),
        supersessionMode: z.enum([
          "Consume First",
          "No Stock",
          "Prefer New",
          "Stock Only"
        ]),
        successorItemId: z.string().nullable(),
        successorEffectivityDate: z.string().nullable(),
        conversionFactor: z.number(),
        successor: z
          .object({
            readableIdWithRevision: z.string().nullable()
          })
          .nullable()
      })
    ),
    z.null()
  ]),
  input: z.looseObject({ itemIds: z.array(z.string()) }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getItemSupersessionsForItems(
        ctx.asCaller.supabase,
        payload(ctx, input.itemIds).build() as never,
        ctx.company.id
      )
    );
  }
});

export const getSupersessionChain = defineServiceFn({
  publish: "read",
  title: "Get supersession chain",
  output: z.object({
    chain: z.array(
      z.object({
        itemId: z.string(),
        supersessionMode: z.enum([
          "Consume First",
          "No Stock",
          "Prefer New",
          "Stock Only"
        ]),
        successorItemId: z.string().nullable(),
        successorEffectivityDate: z.string().nullable(),
        successor: z
          .object({
            id: z.string(),
            readableIdWithRevision: z.string().nullable(),
            name: z.string()
          })
          .nullable()
      })
    ),
    supersededBy: z.array(
      z.object({
        itemId: z.string(),
        supersessionMode: z.enum([
          "Consume First",
          "No Stock",
          "Prefer New",
          "Stock Only"
        ]),
        successorEffectivityDate: z.string().nullable(),
        predecessor: z.object({
          id: z.string(),
          readableIdWithRevision: z.string().nullable(),
          name: z.string()
        })
      })
    )
  }),
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return await service.getSupersessionChain(
      ctx.asCaller.supabase,
      input.itemId as never,
      ctx.company.id
    );
  }
});

export const getItemStorageUnitQuantities = defineServiceFn({
  publish: "read",
  title: "Get item storage unit quantities",
  output: z.array(
    z.object({
      itemId: z.string(),
      projectId: z.string(),
      quantity: z.number(),
      readableId: z.string(),
      storageUnitId: z.string(),
      storageUnitName: z.string(),
      trackedEntityId: z.string()
    })
  ),
  input: z.looseObject({ itemId: z.string(), locationId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await utils.getItemStorageUnitQuantities(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id,
        input.locationId as never
      )
    );
  }
});

export const getItemUnitSalePrice = defineServiceFn({
  publish: "read",
  title: "Get item unit sale price",
  output: rows.itemUnitSalePrice
    .pick({
      allowInvoiceDiscount: true,
      companyId: true,
      createdAt: true,
      createdBy: true,
      currencyCode: true,
      itemId: true,
      laborWarrantyMonths: true,
      partsWarrantyMonths: true,
      priceIncludesTax: true,
      salesBlocked: true,
      salesUnitOfMeasureCode: true,
      tags: true,
      unitSalePrice: true,
      updatedAt: true,
      updatedBy: true
    })
    .extend({
      customFields: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.null()
      ])
    })
    .meta({ table: "itemUnitSalePrice" }),
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getItemUnitSalePrice(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

export const getMaterialUsedIn = defineServiceFn({
  publish: "read",
  title: "Where a material or consumable is used",
  output: z.object({
    issues: z.array(
      z.object({
        id: z.string(),
        documentReadableId: z.string(),
        documentId: z.string()
      })
    ),
    jobMaterials: z.array(z.unknown()),
    maintenanceDispatchItems: z.array(
      z.object({
        id: z.string(),
        documentReadableId: z.string(),
        documentId: z.string()
      })
    ),
    methodMaterials: z.array(z.unknown()),
    purchaseOrderLines: z.array(
      z.object({
        id: z.string(),
        documentReadableId: z.string(),
        documentId: z.string()
      })
    ),
    receiptLines: z.array(
      z.object({
        id: z.string(),
        documentReadableId: z.string(),
        documentId: z.string()
      })
    ),
    quoteMaterials: z.array(z.unknown()),
    salesOrderLines: z.array(z.unknown()),
    shipmentLines: z.array(
      z.object({
        id: z.string(),
        documentReadableId: z.string(),
        documentId: z.string()
      })
    ),
    supplierQuotes: z.array(
      z.object({
        id: z.string(),
        documentReadableId: z.string(),
        documentId: z.string()
      })
    ),
    inspections: z.array(
      z.object({
        id: z.string(),
        documentReadableId: z.string()
      })
    ),
    jobMaterialUsage: z.object({
      byMaterialId: z.record(z.string(), z.number()),
      byJobId: z.record(z.string(), z.number())
    })
  }),
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return await service.getMaterialUsedIn(
      ctx.asCaller.supabase,
      input.itemId as never,
      ctx.company.id
    );
  }
});

export const getMakeMethods = defineServiceFn({
  publish: "read",
  title: "Get make methods",
  output: z.array(
    rows.makeMethod
      .pick({
        changeOrderId: true,
        companyId: true,
        createdAt: true,
        createdBy: true,
        id: true,
        itemId: true,
        status: true,
        tags: true,
        updatedAt: true,
        updatedBy: true,
        version: true
      })
      .extend({
        customFields: z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      })
      .meta({ table: "makeMethod" })
  ),
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getMakeMethods(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

export const getMakeMethodById = defineServiceFn({
  publish: "read",
  title: "Get make method by id",
  output: rows.makeMethod
    .pick({
      changeOrderId: true,
      companyId: true,
      createdAt: true,
      createdBy: true,
      id: true,
      itemId: true,
      status: true,
      tags: true,
      updatedAt: true,
      updatedBy: true,
      version: true
    })
    .extend({
      customFields: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.null()
      ])
    })
    .meta({ table: "makeMethod" }),
  input: z.looseObject({ makeMethodId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getMakeMethodById(
        ctx.asCaller.supabase,
        input.makeMethodId as never,
        ctx.company.id
      )
    );
  }
});

export const getMaterial = defineServiceFn({
  publish: "read",
  title: "Get material",
  output: z.object({
    active: z.boolean(),
    assignee: z.string(),
    companyId: z.string(),
    createdAt: z.string(),
    createdBy: z.string(),
    customFields: z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.record(
        z.string(),
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(z.string(), z.unknown()),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.array(
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.null()
    ]),
    defaultMethodType: z.enum([
      "Make to Order",
      "Pull from Inventory",
      "Purchase to Order"
    ]),
    description: z.string(),
    dimensionId: z.string(),
    dimensions: z.string(),
    finish: z.string(),
    finishId: z.string(),
    grade: z.string(),
    gradeId: z.string(),
    id: z.string(),
    itemPostingGroupId: z.string(),
    itemTrackingType: z.enum(["Batch", "Inventory", "Non-Inventory", "Serial"]),
    materialForm: z.string(),
    materialFormId: z.string(),
    materialSubstance: z.string(),
    materialSubstanceId: z.string(),
    materialType: z.string(),
    materialTypeId: z.string(),
    modelName: z.string(),
    modelPath: z.string(),
    modelSize: z.number(),
    modelUploadId: z.string(),
    mpn: z.string(),
    name: z.string(),
    notes: z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.record(
        z.string(),
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(z.string(), z.unknown()),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.array(
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.null()
    ]),
    readableId: z.string(),
    readableIdWithRevision: z.string(),
    replenishmentSystem: z.enum(["Buy", "Buy and Make", "Make"]),
    revision: z.string(),
    revisions: z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.record(
        z.string(),
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(z.string(), z.unknown()),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.array(
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.null()
    ]),
    sourcingType: z.enum(["Drop Ship", "Ship from Inventory", "Specified"]),
    supplierIds: z.string(),
    tags: z.array(z.string()),
    thumbnailPath: z.string(),
    unitOfMeasure: z.string(),
    unitOfMeasureCode: z.string(),
    updatedAt: z.string(),
    updatedBy: z.string()
  }),
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getMaterial(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

export const getMaterials = defineServiceFn({
  publish: "read",
  title: "Get materials",
  output: z
    .array(
      rows.materials
        .pick({
          active: true,
          defaultMethodType: true,
          description: true,
          itemTrackingType: true,
          name: true,
          unitOfMeasureCode: true,
          revision: true,
          readableId: true,
          readableIdWithRevision: true,
          id: true,
          companyId: true,
          thumbnailPath: true,
          supplierIds: true,
          unitOfMeasure: true,
          materialForm: true,
          materialSubstance: true,
          dimensions: true,
          finish: true,
          grade: true,
          materialType: true,
          materialSubstanceId: true,
          materialFormId: true,
          tags: true,
          itemPostingGroupId: true,
          createdBy: true,
          createdAt: true,
          updatedBy: true,
          updatedAt: true,
          supersessionMode: true,
          mpn: true,
          suppliers: true
        })
        .extend({
          revisions: z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ]),
          customFields: z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        })
    )
    .nullable(),
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    supplierId: z.string().nullable().optional()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getMaterials(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getMaterialDimension = defineServiceFn({
  publish: "read",
  title: "Get material dimension",
  output: rows.materialDimension,
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getMaterialDimension(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

export const getMaterialDimensions = defineServiceFn({
  publish: "read",
  title: "Get material dimensions",
  output: z.array(rows.materialDimensions).nullable(),
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    isMetric: z.boolean()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getMaterialDimensions(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getMaterialDimensionList = defineServiceFn({
  publish: "read",
  title: "Get material dimension list",
  output: z.array(rows.materialDimension),
  input: z.looseObject({ materialFormId: z.string(), isMetric: z.boolean() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getMaterialDimensionList(
        ctx.asCaller.supabase,
        input.materialFormId as never,
        input.isMetric as never,
        ctx.company.id
      )
    );
  }
});

export const getMaterialFinish = defineServiceFn({
  publish: "read",
  title: "Get material finish",
  output: rows.materialFinish,
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getMaterialFinish(ctx.asCaller.supabase, input.id as never)
    );
  }
});

export const getMaterialFinishes = defineServiceFn({
  publish: "read",
  title: "Get material finishes",
  output: z.array(rows.materialFinishes).nullable(),
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getMaterialFinishes(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getMaterialFinishList = defineServiceFn({
  publish: "read",
  title: "Get material finish list",
  output: z.array(rows.materialFinish),
  input: z.looseObject({ materialSubstanceId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getMaterialFinishList(
        ctx.asCaller.supabase,
        input.materialSubstanceId as never,
        ctx.company.id
      )
    );
  }
});

export const getMaterialForm = defineServiceFn({
  publish: "read",
  title: "Get material form",
  output: rows.materialForm
    .pick({
      code: true,
      companyId: true,
      createdAt: true,
      createdBy: true,
      id: true,
      name: true,
      tags: true,
      updatedAt: true,
      updatedBy: true
    })
    .extend({
      customFields: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.null()
      ])
    })
    .meta({ table: "materialForm" }),
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getMaterialForm(ctx.asCaller.supabase, input.id as never)
    );
  }
});

export const getMaterialForms = defineServiceFn({
  publish: "read",
  title: "Get material forms",
  output: z
    .array(
      rows.materialForm
        .pick({
          code: true,
          companyId: true,
          createdAt: true,
          createdBy: true,
          id: true,
          name: true,
          tags: true,
          updatedAt: true,
          updatedBy: true
        })
        .extend({
          customFields: z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        })
        .meta({ table: "materialForm" })
    )
    .nullable(),
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getMaterialForms(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getMaterialFormsList = defineServiceFn({
  publish: "read",
  title: "Get material forms list",
  output: z.array(
    rows.materialForm
      .pick({ id: true, name: true, code: true, companyId: true })
      .meta({ table: "materialForm" })
  ),
  input: z.record(z.string(), z.unknown()),
  permission: { view: "parts" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getMaterialFormsList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

export const getMaterialGrades = defineServiceFn({
  publish: "read",
  title: "Get material grades",
  output: z.array(rows.materialGrades).nullable(),
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getMaterialGrades(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getMaterialGrade = defineServiceFn({
  publish: "read",
  title: "Get material grade",
  output: rows.materialGrade,
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getMaterialGrade(ctx.asCaller.supabase, input.id as never)
    );
  }
});

export const getMaterialGradeList = defineServiceFn({
  publish: "read",
  title: "Get material grade list",
  output: z.array(rows.materialGrade),
  input: z.looseObject({ materialSubstanceId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getMaterialGradeList(
        ctx.asCaller.supabase,
        input.materialSubstanceId as never,
        ctx.company.id
      )
    );
  }
});

export const getMaterialSubstance = defineServiceFn({
  publish: "read",
  title: "Get material substance",
  output: rows.materialSubstance
    .pick({
      code: true,
      companyId: true,
      createdAt: true,
      createdBy: true,
      id: true,
      name: true,
      tags: true,
      updatedAt: true,
      updatedBy: true
    })
    .extend({
      customFields: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.null()
      ])
    })
    .meta({ table: "materialSubstance" }),
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getMaterialSubstance(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

export const getMaterialSubstances = defineServiceFn({
  publish: "read",
  title: "Get material substances",
  output: z
    .array(
      rows.materialSubstance
        .pick({
          code: true,
          companyId: true,
          createdAt: true,
          createdBy: true,
          id: true,
          name: true,
          tags: true,
          updatedAt: true,
          updatedBy: true
        })
        .extend({
          customFields: z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        })
        .meta({ table: "materialSubstance" })
    )
    .nullable(),
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getMaterialSubstances(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getMaterialSubstancesList = defineServiceFn({
  publish: "read",
  title: "Get material substances list",
  output: z.array(
    rows.materialSubstance
      .pick({ id: true, name: true, code: true, companyId: true })
      .meta({ table: "materialSubstance" })
  ),
  input: z.record(z.string(), z.unknown()),
  permission: { view: "parts" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getMaterialSubstancesList(
        ctx.asCaller.supabase,
        ctx.company.id
      )
    );
  }
});

export const getMethodMaterials = defineServiceFn({
  publish: "read",
  title: "Get method materials",
  output: z
    .array(
      rows.methodMaterial
        .pick({
          companyId: true,
          createdAt: true,
          createdBy: true,
          id: true,
          itemId: true,
          itemType: true,
          kit: true,
          makeMethodId: true,
          materialMakeMethodId: true,
          methodOperationId: true,
          methodType: true,
          order: true,
          productionQuantity: true,
          quantity: true,
          scrapQuantity: true,
          sourcingType: true,
          storageUnitIds: true,
          tags: true,
          unitOfMeasureCode: true,
          updatedAt: true,
          updatedBy: true
        })
        .extend({
          customFields: z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ]),
          item: z.object({
            name: z.string(),
            readableIdWithRevision: z.string().nullable()
          }),
          makeMethod: z.object({
            item: z.object({
              id: z.string(),
              type: z.enum([
                "Consumable",
                "Fixture",
                "Material",
                "Part",
                "Service",
                "Tool"
              ]),
              name: z.string(),
              readableIdWithRevision: z.string().nullable()
            })
          })
        })
        .meta({ table: "methodMaterial" })
    )
    .nullable(),
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getMethodMaterials(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getMethodMaterialsByMakeMethod = defineServiceFn({
  publish: "read",
  title: "Get method materials by make method",
  output: z.array(
    rows.methodMaterial
      .pick({
        companyId: true,
        createdAt: true,
        createdBy: true,
        id: true,
        itemId: true,
        itemType: true,
        kit: true,
        makeMethodId: true,
        materialMakeMethodId: true,
        methodOperationId: true,
        methodType: true,
        order: true,
        productionQuantity: true,
        quantity: true,
        scrapQuantity: true,
        sourcingType: true,
        storageUnitIds: true,
        tags: true,
        unitOfMeasureCode: true,
        updatedAt: true,
        updatedBy: true
      })
      .extend({
        customFields: z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ]),
        item: z.object({
          name: z.string(),
          itemTrackingType: z.enum([
            "Batch",
            "Inventory",
            "Non-Inventory",
            "Serial"
          ]),
          replenishmentSystem: z.enum(["Buy", "Buy and Make", "Make"]),
          defaultMethodType: z
            .enum(["Make to Order", "Pull from Inventory", "Purchase to Order"])
            .nullable(),
          sourcingType: z.enum([
            "Drop Ship",
            "Ship from Inventory",
            "Specified"
          ])
        }),
        methodMaterialStep: z.array(
          z.object({
            methodOperationStepId: z.string(),
            quantity: z.number().nullable()
          })
        )
      })
      .meta({ table: "methodMaterial" })
  ),
  input: z.looseObject({ makeMethodId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getMethodMaterialsByMakeMethod(
        ctx.asCaller.supabase,
        input.makeMethodId as never
      )
    );
  }
});

export const getMethodOperations = defineServiceFn({
  publish: "read",
  title: "Get method operations",
  output: z
    .array(
      rows.methodOperation
        .pick({
          assemblyInstructionId: true,
          companyId: true,
          createdAt: true,
          createdBy: true,
          description: true,
          id: true,
          inspectionDocumentId: true,
          laborTime: true,
          laborUnit: true,
          machineTime: true,
          machineUnit: true,
          makeMethodId: true,
          operationLeadTime: true,
          operationMinimumCost: true,
          operationOrder: true,
          operationSupplierProcessId: true,
          operationType: true,
          operationUnitCost: true,
          order: true,
          procedureId: true,
          processId: true,
          setupTime: true,
          setupUnit: true,
          tags: true,
          updatedAt: true,
          updatedBy: true,
          workCenterId: true,
          workInstruction: true
        })
        .extend({
          customFields: z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ]),
          makeMethod: z.object({
            item: z.object({
              id: z.string(),
              type: z.enum([
                "Consumable",
                "Fixture",
                "Material",
                "Part",
                "Service",
                "Tool"
              ]),
              name: z.string(),
              readableIdWithRevision: z.string().nullable()
            })
          })
        })
        .meta({ table: "methodOperation" })
    )
    .nullable(),
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getMethodOperations(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getMethodOperationsByMakeMethodId = defineServiceFn({
  publish: "read",
  title: "Get method operations by make method id",
  output: z.array(
    rows.methodOperation
      .pick({
        assemblyInstructionId: true,
        companyId: true,
        createdAt: true,
        createdBy: true,
        description: true,
        id: true,
        inspectionDocumentId: true,
        laborTime: true,
        laborUnit: true,
        machineTime: true,
        machineUnit: true,
        makeMethodId: true,
        operationLeadTime: true,
        operationMinimumCost: true,
        operationOrder: true,
        operationSupplierProcessId: true,
        operationType: true,
        operationUnitCost: true,
        order: true,
        procedureId: true,
        processId: true,
        setupTime: true,
        setupUnit: true,
        tags: true,
        updatedAt: true,
        updatedBy: true,
        workCenterId: true,
        workInstruction: true
      })
      .extend({
        customFields: z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ]),
        methodOperationTool: z.array(
          z.object({
            companyId: z.string(),
            createdAt: z.string(),
            createdBy: z.string(),
            id: z.string(),
            operationId: z.string(),
            quantity: z.number(),
            toolId: z.string(),
            updatedAt: z.string(),
            updatedBy: z.string().nullable(),
            methodOperationToolStep: z.array(
              z.object({
                methodOperationStepId: z.string()
              })
            )
          })
        ),
        methodOperationParameter: z.array(
          z.object({
            companyId: z.string(),
            createdAt: z.string(),
            createdBy: z.string(),
            id: z.string(),
            key: z.string(),
            operationId: z.string(),
            updatedAt: z.string().nullable(),
            updatedBy: z.string().nullable(),
            value: z.string()
          })
        ),
        methodOperationStep: z.array(
          z.object({
            assemblyInstructionStepId: z.string().nullable(),
            companyId: z.string(),
            createdAt: z.string(),
            createdBy: z.string(),
            description: z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ]),
            fileTypes: z.array(z.string()).nullable(),
            id: z.string(),
            listValues: z.array(z.string()).nullable(),
            maxValue: z.number().nullable(),
            minValue: z.number().nullable(),
            name: z.string(),
            operationId: z.string(),
            required: z.boolean().nullable(),
            sortOrder: z.number(),
            type: z.enum([
              "Checkbox",
              "File",
              "Inspection",
              "List",
              "Measurement",
              "Person",
              "Task",
              "Timestamp",
              "Value"
            ]),
            unitOfMeasureCode: z.string().nullable(),
            updatedAt: z.string().nullable(),
            updatedBy: z.string().nullable(),
            methodOperationStepSlide: z.array(
              z.object({
                annotations: z.unknown(),
                caption: z.string().nullable(),
                companyId: z.string(),
                createdAt: z.string(),
                createdBy: z.string(),
                id: z.string(),
                imagePath: z.string().nullable(),
                modelUploadId: z.string().nullable(),
                size: z.string(),
                sortOrder: z.number(),
                stepId: z.string(),
                updatedAt: z.string().nullable(),
                updatedBy: z.string().nullable()
              })
            )
          })
        )
      })
      .meta({ table: "methodOperation" })
  ),
  input: z.looseObject({ makeMethodId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getMethodOperationsByMakeMethodId(
        ctx.asCaller.supabase,
        input.makeMethodId as never
      )
    );
  }
});

export const getMethodTree = defineServiceFn({
  publish: "read",
  title: "Get method tree",
  output: z.array(
    z.object({
      id: z.string(),
      data: z.object({
        description: z.string(),
        externalId: z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ]),
        isPickDescendant: z.boolean(),
        isRoot: z.boolean(),
        itemId: z.string(),
        itemReadableId: z.string(),
        itemTrackingType: z.string(),
        itemType: z.string(),
        kit: z.boolean(),
        makeMethodId: z.string(),
        materialMakeMethodId: z.string(),
        methodMaterialId: z.string(),
        methodOperationStepIds: z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ]),
        methodType: z.enum([
          "Make to Order",
          "Pull from Inventory",
          "Purchase to Order"
        ]),
        operationId: z.string(),
        order: z.number(),
        parentMaterialId: z.string(),
        quantity: z.number(),
        replenishmentSystem: z.enum(["Buy", "Buy and Make", "Make"]),
        revision: z.string(),
        storageUnitIds: z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ]),
        unitCost: z.number(),
        unitOfMeasureCode: z.string(),
        version: z.number()
      }),
      children: z.array(z.record(z.string(), z.unknown()))
    })
  ),
  input: z.looseObject({ makeMethodId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getMethodTree(
        ctx.asCaller.supabase,
        input.makeMethodId as never
      )
    );
  }
});

export const getBomItemAttributes = defineServiceFn({
  publish: "read",
  title: "Get bom item attributes",
  output: z.record(z.string(), z.unknown()),
  input: z.looseObject({ itemIds: z.array(z.string()) }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getBomItemAttributes(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input.itemIds).build() as never
      )
    );
  }
});

export const getOpenJobMaterials = defineServiceFn({
  publish: "read",
  title: "Get open job materials",
  output: z.array(
    z.object({
      id: z.string().nullable(),
      parentMaterialId: z.string().nullable(),
      jobMakeMethodId: z.string().nullable(),
      jobId: z.string().nullable(),
      quantity: z.number().nullable(),
      quantityPerParent: z.number().nullable(),
      documentReadableId: z.string().nullable(),
      documentId: z.string().nullable(),
      dueDate: z.string().nullable()
    })
  ),
  input: z.looseObject({ itemId: z.string(), locationId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getOpenJobMaterials(
        ctx.asCaller.supabase,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getOpenProductionOrders = defineServiceFn({
  publish: "read",
  title: "Get open production orders",
  output: z.array(
    z.object({
      id: z.string(),
      quantity: z.number().nullable(),
      documentReadableId: z.string().nullable(),
      documentId: z.string(),
      dueDate: z.string().nullable(),
      deadlineType: z
        .enum(["ASAP", "Hard Deadline", "No Deadline", "Soft Deadline"])
        .nullable()
    })
  ),
  input: z.looseObject({ itemId: z.string(), locationId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getOpenProductionOrders(
        ctx.asCaller.supabase,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getOpenPurchaseOrderLines = defineServiceFn({
  publish: "read",
  title: "Get open purchase order lines",
  output: z.array(
    rows.openPurchaseOrderLines
      .pick({
        promisedDate: true,
        dueDate: true,
        orderDate: true,
        leadTime: true
      })
      .extend({
        id: z.string(),
        quantity: z.number().nullable(),
        documentReadableId: z.string().nullable(),
        documentId: z.string()
      })
      .meta({ table: "purchaseOrderLine" })
  ),
  input: z.looseObject({ itemId: z.string(), locationId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getOpenPurchaseOrderLines(
        ctx.asCaller.supabase,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getOpenSalesOrderLines = defineServiceFn({
  publish: "read",
  title: "Get open sales order lines",
  output: z.array(
    z.object({
      id: z.string().nullable(),
      quantity: z.number().nullable(),
      dueDate: z.string().nullable(),
      documentReadableId: z.string().nullable(),
      documentId: z.string().nullable()
    })
  ),
  input: z.looseObject({ itemId: z.string(), locationId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getOpenSalesOrderLines(
        ctx.asCaller.supabase,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getPart = defineServiceFn({
  publish: "read",
  title: "Get part",
  output: z.object({
    active: z.boolean(),
    assignee: z.string(),
    companyId: z.string(),
    createdAt: z.string(),
    createdBy: z.string(),
    customFields: z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.record(
        z.string(),
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(z.string(), z.unknown()),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.array(
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.null()
    ]),
    defaultMethodType: z.enum([
      "Make to Order",
      "Pull from Inventory",
      "Purchase to Order"
    ]),
    description: z.string(),
    id: z.string(),
    itemPostingGroupId: z.string(),
    itemTrackingType: z.enum(["Batch", "Inventory", "Non-Inventory", "Serial"]),
    modelId: z.string(),
    modelName: z.string(),
    modelPath: z.string(),
    modelSize: z.number(),
    mpn: z.string(),
    name: z.string(),
    notes: z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.record(
        z.string(),
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(z.string(), z.unknown()),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.array(
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.null()
    ]),
    readableId: z.string(),
    readableIdWithRevision: z.string(),
    replenishmentSystem: z.enum(["Buy", "Buy and Make", "Make"]),
    revision: z.string(),
    revisions: z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.record(
        z.string(),
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(z.string(), z.unknown()),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.array(
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.null()
    ]),
    sourcingType: z.enum(["Drop Ship", "Ship from Inventory", "Specified"]),
    tags: z.array(z.string()),
    thumbnailPath: z.string(),
    unitOfMeasure: z.string(),
    unitOfMeasureCode: z.string(),
    updatedAt: z.string(),
    updatedBy: z.string()
  }),
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPart(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

export const getParts = defineServiceFn({
  publish: "read",
  title: "Get parts",
  output: z
    .array(
      rows.parts
        .pick({
          active: true,
          defaultMethodType: true,
          description: true,
          itemTrackingType: true,
          name: true,
          replenishmentSystem: true,
          unitOfMeasureCode: true,
          revision: true,
          readableId: true,
          readableIdWithRevision: true,
          id: true,
          companyId: true,
          thumbnailPath: true,
          supplierIds: true,
          tags: true,
          itemPostingGroupId: true,
          createdBy: true,
          createdAt: true,
          updatedBy: true,
          updatedAt: true,
          supersessionMode: true,
          mpn: true,
          suppliers: true
        })
        .extend({
          revisions: z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ]),
          customFields: z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        })
    )
    .nullable(),
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    supplierId: z.string().nullable().optional()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getParts(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getItemMpnsList = defineServiceFn({
  publish: "read",
  title: "Get item mpns list",
  output: z.array(
    z.object({
      mpn: z.string()
    })
  ),
  input: z.record(z.string(), z.unknown()),
  permission: { view: "parts" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getItemMpnsList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

export const getPartsList = defineServiceFn({
  publish: "read",
  title: "Get parts list",
  output: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      readableIdWithRevision: z.string()
    })
  ),
  input: z.record(z.string(), z.unknown()),
  permission: { view: "parts" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getPartsList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

export const getPartUsedIn = defineServiceFn({
  publish: "read",
  title: "Where a part, tool or service is used",
  output: z.object({
    issues: z.array(
      z.object({
        id: z.string(),
        documentReadableId: z.string(),
        documentId: z.string()
      })
    ),
    jobMaterials: z.array(z.unknown()),
    jobs: z.array(
      z.object({
        id: z.string(),
        documentReadableId: z.string()
      })
    ),
    maintenanceDispatchItems: z.array(
      z.object({
        id: z.string(),
        documentReadableId: z.string(),
        documentId: z.string()
      })
    ),
    methodMaterials: z.array(z.unknown()),
    purchaseOrderLines: z.array(
      z.object({
        id: z.string(),
        documentReadableId: z.string(),
        documentId: z.string()
      })
    ),
    receiptLines: z.array(
      z.object({
        id: z.string(),
        documentReadableId: z.string(),
        documentId: z.string()
      })
    ),
    quoteLines: z.array(z.unknown()),
    quoteMaterials: z.array(z.unknown()),
    salesOrderLines: z.array(z.unknown()),
    shipmentLines: z.array(
      z.object({
        id: z.string(),
        documentReadableId: z.string(),
        documentId: z.string()
      })
    ),
    supplierQuotes: z.array(
      z.object({
        id: z.string(),
        documentReadableId: z.string(),
        documentId: z.string()
      })
    ),
    assemblyInstructions: z.array(
      z.object({
        id: z.string(),
        documentReadableId: z.string(),
        version: z.number()
      })
    ),
    inspections: z.array(
      z.object({
        id: z.string(),
        documentReadableId: z.string()
      })
    ),
    jobMaterialUsage: z.object({
      byMaterialId: z.record(z.string(), z.number()),
      byJobId: z.record(z.string(), z.number())
    })
  }),
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return await service.getPartUsedIn(
      ctx.asCaller.supabase,
      input.itemId as never,
      ctx.company.id
    );
  }
});

export const getPickMethod = defineServiceFn({
  publish: "read",
  title: "Get pick method",
  output: rows.pickMethod
    .pick({
      companyId: true,
      createdAt: true,
      createdBy: true,
      defaultStorageUnitId: true,
      itemId: true,
      locationId: true,
      sortMethod: true,
      updatedAt: true,
      updatedBy: true
    })
    .extend({
      customFields: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.null()
      ])
    })
    .meta({ table: "pickMethod" }),
  input: z.looseObject({ itemId: z.string(), locationId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPickMethod(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id,
        input.locationId as never
      )
    );
  }
});

export const getPickMethods = defineServiceFn({
  publish: "read",
  title: "Get pick methods",
  output: z.array(
    rows.pickMethod
      .pick({
        companyId: true,
        createdAt: true,
        createdBy: true,
        defaultStorageUnitId: true,
        itemId: true,
        locationId: true,
        sortMethod: true,
        updatedAt: true,
        updatedBy: true
      })
      .extend({
        customFields: z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      })
      .meta({ table: "pickMethod" })
  ),
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPickMethods(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

export const getServices = defineServiceFn({
  publish: "read",
  title: "Get services",
  output: z
    .array(
      rows.services
        .pick({
          active: true,
          defaultMethodType: true,
          description: true,
          name: true,
          replenishmentSystem: true,
          revision: true,
          readableIdWithRevision: true,
          id: true,
          companyId: true,
          thumbnailPath: true,
          supplierIds: true,
          tags: true,
          itemPostingGroupId: true,
          createdBy: true,
          createdAt: true,
          updatedBy: true,
          updatedAt: true,
          suppliers: true
        })
        .extend({
          revisions: z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ]),
          customFields: z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        })
    )
    .nullable(),
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    group: z.string().nullable().optional(),
    supplierId: z.string().nullable().optional()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getServices(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getService = defineServiceFn({
  publish: "read",
  title: "Get service",
  output: z.object({
    active: z.boolean(),
    assignee: z.string(),
    companyId: z.string(),
    createdAt: z.string(),
    createdBy: z.string(),
    customFields: z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.record(
        z.string(),
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(z.string(), z.unknown()),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.array(
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.null()
    ]),
    defaultMethodType: z.enum([
      "Make to Order",
      "Pull from Inventory",
      "Purchase to Order"
    ]),
    description: z.string(),
    id: z.string(),
    itemPostingGroupId: z.string(),
    itemTrackingType: z.enum(["Batch", "Inventory", "Non-Inventory", "Serial"]),
    modelId: z.string(),
    modelName: z.string(),
    modelPath: z.string(),
    modelSize: z.number(),
    mpn: z.string(),
    name: z.string(),
    notes: z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.record(
        z.string(),
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(z.string(), z.unknown()),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.array(
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.null()
    ]),
    readableId: z.string(),
    readableIdWithRevision: z.string(),
    replenishmentSystem: z.enum(["Buy", "Buy and Make", "Make"]),
    revision: z.string(),
    revisions: z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.record(
        z.string(),
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(z.string(), z.unknown()),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.array(
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.null()
    ]),
    sourcingType: z.enum(["Drop Ship", "Ship from Inventory", "Specified"]),
    tags: z.array(z.string()),
    thumbnailPath: z.string(),
    unitOfMeasure: z.string(),
    unitOfMeasureCode: z.string(),
    updatedAt: z.string(),
    updatedBy: z.string()
  }),
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getService(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

export const getServicesList = defineServiceFn({
  publish: "read",
  title: "Get services list",
  output: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      readableIdWithRevision: z.string()
    })
  ),
  input: z.record(z.string(), z.unknown()),
  permission: { view: "parts" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getServicesList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

export const getSupplierParts = defineServiceFn({
  publish: "read",
  title: "Get supplier parts",
  output: z.array(
    rows.supplierPart
      .pick({
        active: true,
        companyId: true,
        conversionFactor: true,
        createdAt: true,
        createdBy: true,
        currencyCode: true,
        id: true,
        itemId: true,
        minimumOrderQuantity: true,
        orderMultiple: true,
        supplierId: true,
        supplierPartId: true,
        supplierUnitOfMeasureCode: true,
        supplierUnitPrice: true,
        tags: true,
        updatedAt: true,
        updatedBy: true
      })
      .extend({
        customFields: z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      })
      .meta({ table: "supplierPart" })
  ),
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSupplierParts(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

export const getSupplierPartsBySupplier = defineServiceFn({
  publish: "read",
  title: "Get supplier parts by supplier",
  output: z.array(
    rows.supplierPart
      .pick({
        active: true,
        companyId: true,
        conversionFactor: true,
        createdAt: true,
        createdBy: true,
        currencyCode: true,
        id: true,
        itemId: true,
        minimumOrderQuantity: true,
        orderMultiple: true,
        supplierId: true,
        supplierPartId: true,
        supplierUnitOfMeasureCode: true,
        supplierUnitPrice: true,
        tags: true,
        updatedAt: true,
        updatedBy: true
      })
      .extend({
        customFields: z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ]),
        item: z.object({
          id: z.string(),
          readableIdWithRevision: z.string().nullable(),
          name: z.string(),
          type: z.enum([
            "Consumable",
            "Fixture",
            "Material",
            "Part",
            "Service",
            "Tool"
          ]),
          thumbnailPath: z.string().nullable(),
          unitOfMeasureCode: z.string().nullable()
        })
      })
      .meta({ table: "supplierPart" })
  ),
  input: z.looseObject({ supplierId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSupplierPartsBySupplier(
        ctx.asCaller.supabase,
        input.supplierId as never,
        ctx.company.id
      )
    );
  }
});

export const getTool = defineServiceFn({
  publish: "read",
  title: "Get tool",
  output: z.object({
    active: z.boolean(),
    assignee: z.string(),
    companyId: z.string(),
    createdAt: z.string(),
    createdBy: z.string(),
    customFields: z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.record(
        z.string(),
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(z.string(), z.unknown()),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.array(
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.null()
    ]),
    defaultMethodType: z.enum([
      "Make to Order",
      "Pull from Inventory",
      "Purchase to Order"
    ]),
    description: z.string(),
    id: z.string(),
    itemPostingGroupId: z.string(),
    itemTrackingType: z.enum(["Batch", "Inventory", "Non-Inventory", "Serial"]),
    modelId: z.string(),
    modelName: z.string(),
    modelPath: z.string(),
    modelSize: z.number(),
    mpn: z.string(),
    name: z.string(),
    notes: z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.record(
        z.string(),
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(z.string(), z.unknown()),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.array(
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.null()
    ]),
    readableId: z.string(),
    readableIdWithRevision: z.string(),
    replenishmentSystem: z.enum(["Buy", "Buy and Make", "Make"]),
    revision: z.string(),
    revisions: z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.record(
        z.string(),
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(z.string(), z.unknown()),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.array(
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.null()
    ]),
    sourcingType: z.enum(["Drop Ship", "Ship from Inventory", "Specified"]),
    tags: z.array(z.string()),
    thumbnailPath: z.string(),
    unitOfMeasure: z.string(),
    unitOfMeasureCode: z.string(),
    updatedAt: z.string(),
    updatedBy: z.string()
  }),
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getTool(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

export const getTools = defineServiceFn({
  publish: "read",
  title: "Get tools",
  output: z
    .array(
      rows.tools
        .pick({
          active: true,
          assignee: true,
          defaultMethodType: true,
          description: true,
          itemTrackingType: true,
          name: true,
          replenishmentSystem: true,
          revision: true,
          readableIdWithRevision: true,
          id: true,
          companyId: true,
          thumbnailPath: true,
          supplierIds: true,
          tags: true,
          itemPostingGroupId: true,
          createdBy: true,
          createdAt: true,
          updatedBy: true,
          updatedAt: true,
          supersessionMode: true,
          mpn: true,
          suppliers: true
        })
        .extend({
          revisions: z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ]),
          customFields: z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        })
    )
    .nullable(),
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    supplierId: z.string().nullable().optional()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getTools(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getUnitOfMeasure = defineServiceFn({
  publish: "read",
  title: "Get unit of measure",
  output: rows.unitOfMeasure
    .pick({
      active: true,
      code: true,
      companyId: true,
      createdAt: true,
      createdBy: true,
      id: true,
      name: true,
      tags: true,
      updatedAt: true,
      updatedBy: true
    })
    .extend({
      customFields: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.null()
      ])
    })
    .meta({ table: "unitOfMeasure" }),
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getUnitOfMeasure(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

export const getUnitOfMeasureUsage = defineServiceFn({
  publish: "read",
  title:
    "Which tables still reference a unit of measure, and how many rows each; empty means safe to delete (or id not visible to the caller)",
  output: z.array(
    z.object({
      count: z.number(),
      tableName: z.string()
    })
  ),
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getUnitOfMeasureUsage(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

export const getUnitOfMeasures = defineServiceFn({
  publish: "read",
  title: "Get unit of measures",
  output: z
    .array(
      rows.unitOfMeasure
        .pick({
          active: true,
          code: true,
          companyId: true,
          createdAt: true,
          createdBy: true,
          id: true,
          name: true,
          tags: true,
          updatedAt: true,
          updatedBy: true
        })
        .extend({
          customFields: z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        })
        .meta({ table: "unitOfMeasure" })
    )
    .nullable(),
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getUnitOfMeasures(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getUnitOfMeasuresList = defineServiceFn({
  publish: "read",
  title: "Get unit of measures list",
  output: z.array(rows.currencyCode),
  input: z.record(z.string(), z.unknown()),
  permission: { view: "parts" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getUnitOfMeasuresList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

export const updateConfigurationParameterGroupOrder = defineServiceFn({
  publish: true,
  title: "Update configuration parameter group order",
  output: z.array(
    rows.configurationParameterGroup
      .pick({ id: true })
      .meta({ table: "configurationParameterGroup" })
  ),
  input: z.looseObject({ id: z.string().min(1), sortOrder: z.number().min(0) }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateConfigurationParameterGroupOrder(
        ctx.asCaller.supabase,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const updateDefaultRevision = defineServiceFn({
  publish: true,
  title: "Update default revision",
  output: z.object({
    id: z.string(),
    readableId: z.string(),
    readableIdWithRevision: z.string().nullable(),
    type: z.enum([
      "Consumable",
      "Fixture",
      "Material",
      "Part",
      "Service",
      "Tool"
    ]),
    companyId: z.string().nullable()
  }),
  input: z.looseObject({ id: z.string() }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateDefaultRevision(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

export const updateConfigurationParameterOrder = defineServiceFn({
  publish: true,
  title: "Update configuration parameter order",
  output: z.array(
    rows.configurationParameter
      .pick({ id: true })
      .meta({ table: "configurationParameter" })
  ),
  input: z.looseObject({
    id: z.string().min(1),
    sortOrder: z.number().min(0),
    configurationParameterGroupId: z.string().nullable().optional()
  }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateConfigurationParameterOrder(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

export const updateItemCost = defineServiceFn({
  publish: true,
  title: "Update item cost",
  output: z.null(),
  input: z.looseObject({
    itemId: z.string(),
    cost: z.looseObject({ unitCost: z.number() })
  }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateItemCost(
        ctx.asCaller.supabase,
        input.itemId as never,
        payload(ctx, input.cost).forUpdate() as never
      )
    );
  }
});

export const updateMaterialOrder = defineServiceFn({
  publish: true,
  title: "Update material order",
  output: z.object({
    ids: z.array(z.string()),
    notice: z.string().nullable()
  }),
  input: z.looseObject({
    updates: z.array(z.looseObject({ id: z.string(), order: z.number() }))
  }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return service.reorderMethodRows(ctx, "methodMaterial", input.updates);
  }
});

export const updateOperationOrder = defineServiceFn({
  publish: true,
  title: "Update operation order",
  output: z.object({
    ids: z.array(z.string()),
    notice: z.string().nullable()
  }),
  input: z.looseObject({
    updates: z.array(z.looseObject({ id: z.string(), order: z.number() }))
  }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return service.reorderMethodRows(ctx, "methodOperation", input.updates);
  }
});

export const updateRevision = defineServiceFn({
  publish: true,
  title: "Update revision",
  output: z.array(
    z.object({
      id: z.string()
    })
  ),
  input: z.looseObject({ id: z.string(), revision: z.string() }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateRevision(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

export const upsertConfigurationParameter = defineServiceFn({
  publish: true,
  title: "Upsert configuration parameter",
  output: z.array(
    rows.configurationParameter
      .pick({ id: true })
      .meta({ table: "configurationParameter" })
  ),
  input: z.looseObject({
    id: z.string().optional(),
    itemId: z.string().min(1),
    key: z.string().optional(),
    label: z.string().min(1),
    dataType: z.enum([
      "text",
      "numeric",
      "boolean",
      "list",
      "material",
      "date"
    ]),
    listOptions: z.array(z.string().min(1)).optional(),
    configurationParameterGroupId: z.string().optional(),
    materialFormFilterId: z.string().optional()
  }),
  permission: { create: "parts", update: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertConfigurationParameter(
        ctx.asCaller.supabase,
        payload(ctx, input).withUser().forUpsert() as never
      )
    );
  }
});

export const upsertConfigurationParameterGroup = defineServiceFn({
  publish: true,
  title: "Upsert configuration parameter group",
  output: z.array(
    rows.configurationParameterGroup
      .pick({ id: true })
      .meta({ table: "configurationParameterGroup" })
  ),
  input: z.looseObject({ itemId: z.string() }),
  permission: { create: "parts", update: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertConfigurationParameterGroup(
        ctx.asCaller.supabase,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const upsertConfigurationRule = defineServiceFn({
  publish: true,
  title: "Upsert configuration rule",
  output: z.null(),
  input: z.looseObject({
    field: z.string().min(1),
    code: z.string().min(1),
    itemId: z.string()
  }),
  permission: { create: "parts", update: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertConfigurationRule(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

export const getRecipeProcessIdsForItem = defineServiceFn({
  publish: "read",
  title:
    "Return the distinct processIds referenced by methodOperation rows on the item's active makeMethod",
  output: z.array(z.string()),
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getRecipeProcessIdsForItem(
        ctx.asCaller.supabase,
        input.itemId as never
      )
    );
  }
});

export const getItemShelfLife = defineServiceFn({
  publish: "read",
  title: "Fetch the shelf-life policy for an item",
  output: rows.itemShelfLife
    .pick({
      mode: true,
      days: true,
      triggerProcessId: true,
      triggerTiming: true,
      calculateFromBom: true
    })
    .meta({ table: "itemShelfLife" }),
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getItemShelfLife(
        ctx.asCaller.supabase,
        input.itemId as never
      )
    );
  }
});

export const getBomHasShelfLifeManagedInput = defineServiceFn({
  publish: "read",
  title:
    "Returns true when the item's active make-method has at least one BOM input with a managed shelf-life policy",
  output: z.boolean().nullable(),
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return await service.getBomHasShelfLifeManagedInput(
      ctx.asCaller.supabase,
      input.itemId as never,
      ctx.company.id
    );
  }
});

export const upsertPickMethodWithShelfLife = defineServiceFn({
  publish: "destructive",
  title:
    "Atomic counterpart to {@link upsertPickMethod} + {@link upsertItemShelfLife}",
  input: z.looseObject({
    itemId: z.string(),
    locationId: z.string(),
    defaultStorageUnitId: z.string().nullable().optional(),
    sortMethod: z.enum(["Default", "FEFO", "FIFO", "LIFO"]).optional(),
    customFields: z.unknown().optional(),
    shelfLife: z.looseObject({
      mode: z
        .enum(["NotManaged", "Fixed Duration", "Calculated", "Set on Receipt"])
        .optional(),
      days: z.number().optional(),
      triggerProcessId: z.string().optional(),
      triggerTiming: z.enum(["Before", "After"]).optional(),
      calculateFromBom: z.boolean().optional()
    })
  }),
  permission: { create: "parts", update: "parts" },
  async run(ctx, input) {
    return await service.upsertPickMethodWithShelfLife(
      ctx.asSystem.pg,
      payload(ctx, input).withUser().forUpsert() as never
    );
  }
});

export const createConsumable = defineServiceFn({
  publish: true,
  title: "Create a consumable",
  description:
    "Creates a consumable (item row and consumable row) or updates one; on update `id` is the item id (uuid) or the consumable's readable id and the write is a full…",
  input: z.looseObject({
    id: z
      .string()
      .min(1)
      .max(255)
      .describe(
        "Updates the existing record with this key; creates one when there is none."
      ),
    readableId: z.string().optional(),
    name: z.string().min(1).max(255),
    description: z.string().optional(),
    mpn: z.string().optional(),
    replenishmentSystem: z.enum(["Buy", "Make", "Buy and Make"]),
    defaultMethodType: z.enum([
      "Purchase to Order",
      "Pull from Inventory",
      "Make to Order"
    ]),
    itemTrackingType: z.enum(["Inventory", "Non-Inventory", "Serial", "Batch"]),
    postingGroupId: z.string().optional(),
    unitOfMeasureCode: z.string().min(1),
    unitCost: z.number().min(0).optional(),
    defaultStorageUnitId: z.string().optional(),
    shelfLifeMode: z
      .enum(["NotManaged", "Fixed Duration", "Calculated", "Set on Receipt"])
      .optional(),
    shelfLifeDays: z.number().gt(0).optional(),
    shelfLifeTriggerProcessId: z.string().optional(),
    shelfLifeTriggerTiming: z.enum(["Before", "After"]).optional(),
    shelfLifeCalculateFromBom: z.boolean().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    return await service.upsertConsumable(
      ctx.asCaller.supabase,
      payload(ctx, input).forCreate() as never
    );
  }
});

export const updateConsumable = defineServiceFn({
  publish: true,
  title: "Update a consumable",
  description:
    "Creates a consumable (item row and consumable row) or updates one; on update `id` is the item id (uuid) or the consumable's readable id and the write is a full…",
  input: z
    .looseObject({
      id: z
        .string()
        .min(1)
        .max(255)
        .describe(
          "Updates the existing record with this key; creates one when there is none."
        ),
      readableId: z.string().optional(),
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      mpn: z.string().optional(),
      replenishmentSystem: z.enum(["Buy", "Make", "Buy and Make"]),
      defaultMethodType: z.enum([
        "Purchase to Order",
        "Pull from Inventory",
        "Make to Order"
      ]),
      itemTrackingType: z.enum([
        "Inventory",
        "Non-Inventory",
        "Serial",
        "Batch"
      ]),
      postingGroupId: z.string().optional(),
      unitOfMeasureCode: z.string().min(1),
      unitCost: z.number().min(0).optional(),
      defaultStorageUnitId: z.string().optional(),
      shelfLifeMode: z
        .enum(["NotManaged", "Fixed Duration", "Calculated", "Set on Receipt"])
        .optional(),
      shelfLifeDays: z.number().gt(0).optional(),
      shelfLifeTriggerProcessId: z.string().optional(),
      shelfLifeTriggerTiming: z.enum(["Before", "After"]).optional(),
      shelfLifeCalculateFromBom: z.boolean().optional(),
      customFields: z.unknown().optional()
    })
    .required({ id: true }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return await service.upsertConsumable(
      ctx.asCaller.supabase,
      payload(ctx, input).forUpdate() as never
    );
  }
});

export const resolveItemIdFromExtractedText = defineServiceFn({
  publish: true,
  title:
    "Resolve extracted document line text to an item id: first through the party's part mapping (customer part or supplier part), then by an exact match on the item's readable id or name. Null when nothing matches",
  output: z.string(),
  input: z.looseObject({
    party: z.union([
      z.looseObject({
        type: z.literal("customer"),
        id: z.string().nullable().optional()
      }),
      z.looseObject({
        type: z.literal("supplier"),
        id: z.string().nullable().optional()
      })
    ]),
    candidates: z.array(z.string().nullable())
  }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return await service.resolveItemIdFromExtractedText(
      ctx.asCaller.supabase,
      ctx.company.id,
      payload(ctx, input.party).build() as never,
      payload(ctx, input.candidates).build() as never
    );
  }
});

export const updateItem = defineServiceFn({
  publish: true,
  title: "Update item",
  description: `Writes the item's own fields. Refused when the item is not of \`type\`, or
when \`readableId\` differs from the item's: change the number with
\`setItemReadableId\`, which also renames the type row keyed by it.`,
  output: rows.item.pick({ id: true }).meta({ table: "item" }),
  input: z.looseObject({
    id: z.string().min(1).max(255),
    readableId: z.string().optional(),
    name: z.string().min(1).max(255),
    description: z.string().optional(),
    mpn: z.string().optional(),
    replenishmentSystem: z.enum(["Buy", "Make", "Buy and Make"]),
    defaultMethodType: z.enum([
      "Purchase to Order",
      "Pull from Inventory",
      "Make to Order"
    ]),
    itemTrackingType: z.enum(["Inventory", "Non-Inventory", "Serial", "Batch"]),
    postingGroupId: z.string().optional(),
    unitOfMeasureCode: z.string().min(1),
    unitCost: z.number().min(0).optional(),
    defaultStorageUnitId: z.string().optional(),
    shelfLifeMode: z
      .enum(["NotManaged", "Fixed Duration", "Calculated", "Set on Receipt"])
      .optional(),
    shelfLifeDays: z.number().gt(0).optional(),
    shelfLifeTriggerProcessId: z.string().optional(),
    shelfLifeTriggerTiming: z.enum(["Before", "After"]).optional(),
    shelfLifeCalculateFromBom: z.boolean().optional(),
    type: z.enum([
      "Part",
      "Material",
      "Tool",
      "Service",
      "Consumable",
      "Fixture"
    ])
  }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateItem(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

export const upsertItemCost = defineServiceFn({
  publish: true,
  title: "Upsert item cost",
  output: z.null(),
  input: z.looseObject({
    itemId: z.string().min(1),
    itemPostingGroupId: z.string().optional(),
    costingMethod: z.enum(["Standard", "Average", "FIFO", "LIFO"]),
    unitCost: z.number().min(0),
    customFields: z.unknown().optional()
  }),
  permission: { create: "parts", update: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertItemCost(
        ctx.asCaller.supabase,
        payload(ctx, input).withoutCompany().forUpdate() as never
      )
    );
  }
});

export const createPickMethod = defineServiceFn({
  publish: true,
  title: "Create a pick method",
  description: "Upsert pick method",
  output: z.null(),
  input: z.looseObject({
    itemId: z
      .string()
      .min(1)
      .describe(
        "Updates the existing record with this key; creates one when there is none."
      ),
    locationId: z
      .string()
      .min(1)
      .describe(
        "Updates the existing record with this key; creates one when there is none."
      ),
    defaultStorageUnitId: z.string().optional(),
    sortMethod: z.enum(["Default", "FEFO", "FIFO", "LIFO"]).optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertPickMethod(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

export const updatePickMethod = defineServiceFn({
  publish: true,
  title: "Update a pick method",
  description: "Upsert pick method",
  output: z.null(),
  input: z
    .looseObject({
      itemId: z
        .string()
        .min(1)
        .describe(
          "Updates the existing record with this key; creates one when there is none."
        ),
      locationId: z
        .string()
        .min(1)
        .describe(
          "Updates the existing record with this key; creates one when there is none."
        ),
      defaultStorageUnitId: z.string().optional(),
      sortMethod: z.enum(["Default", "FEFO", "FIFO", "LIFO"]).optional(),
      customFields: z.unknown().optional()
    })
    .required({ itemId: true, locationId: true }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertPickMethod(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

export const upsertItemPurchasing = defineServiceFn({
  publish: true,
  title: "Upsert item purchasing",
  output: z.null(),
  input: z.looseObject({
    itemId: z.string().min(1),
    preferredSupplierId: z.string().optional(),
    conversionFactor: z.number().min(0),
    leadTime: z.number().min(0),
    purchasingUnitOfMeasureCode: z.string().optional()
  }),
  permission: { create: "parts", update: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertItemPurchasing(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});

export const createItemPostingGroup = defineServiceFn({
  publish: true,
  title: "Create a item posting group",
  description: "Upsert item posting group",
  output: rows.itemPostingGroup
    .pick({ id: true })
    .meta({ table: "itemPostingGroup" }),
  input: z.looseObject({
    name: z.string().min(1).max(255),
    description: z.string().optional(),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertItemPostingGroup(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

export const updateItemPostingGroup = defineServiceFn({
  publish: true,
  title: "Update a item posting group",
  description: "Upsert item posting group",
  output: rows.itemPostingGroup
    .pick({ id: true })
    .meta({ table: "itemPostingGroup" }),
  input: z
    .looseObject({
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertItemPostingGroup(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

export const upsertItemCustomerPart = defineServiceFn({
  publish: true,
  title: "Upsert item customer part",
  output: rows.customer.pick({ id: true }).meta({ table: "customer" }),
  input: z.looseObject({
    itemId: z.string().min(1),
    customerId: z.string().min(1),
    customerPartId: z.string(),
    customerPartRevision: z.string().optional(),
    id: z.string().optional()
  }),
  permission: { create: "parts", update: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertItemCustomerPart(
        ctx.asCaller.supabase,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const upsertItemUnitSalePrice = defineServiceFn({
  publish: true,
  title: "Save an item's sales settings",
  description: `Its unit sale price, and the labor and parts warranty months a shipped
serial gets. A warranty field sent empty (null) is cleared; one not sent
is left alone.`,
  output: z.null(),
  input: z.looseObject({
    itemId: z.string().min(1),
    unitSalePrice: z.number().min(0),
    laborWarrantyMonths: z.number().int().min(0).nullable().optional(),
    partsWarrantyMonths: z.number().int().min(0).nullable().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "parts", update: "parts" },
  async run(ctx, input) {
    // The service scopes the update to the company and strips `companyId`
    // from the row it writes.
    return unwrap(
      ctx,
      await service.upsertItemUnitSalePrice(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

export const createMethodMaterial = defineServiceFn({
  publish: true,
  title: "Create a method material",
  description: "Upsert method material",
  output: rows.methodMaterial
    .pick({ id: true })
    .meta({ table: "methodMaterial" }),
  input: z.looseObject({
    id: z
      .string()
      .min(1)
      .optional()
      .describe("The new material's id; the table makes one when left out."),
    makeMethodId: z.string().min(1),
    order: z.number().min(0),
    itemType: z.enum(["Part", "Material", "Consumable"]),
    kit: booleanField().optional(),
    methodType: z.enum([
      "Purchase to Order",
      "Pull from Inventory",
      "Make to Order"
    ]),
    sourcingType: z.enum(["Specified", "Drop Ship", "Ship from Inventory"]),
    itemId: z.string().optional(),
    methodOperationId: z.string().optional(),
    quantity: z.number().min(0),
    unitOfMeasureCode: z.string().min(1),
    storageUnitIds: z.record(z.string(), z.unknown()).nullable().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    const lock = await service.checkRevisionLocks(
      ctx.asCaller.supabase,
      ctx.company.id,
      [{ kind: "makeMethod", id: input.makeMethodId }]
    );
    if (!lock.ok) return ctx.error("rule", lock.message);
    return service.withLockNotice(
      lock,
      unwrap(
        ctx,
        await service.upsertMethodMaterial(
          ctx.asCaller.supabase,
          payload(ctx, input).forCreate() as never
        )
      )
    );
  }
});

export const updateMethodMaterial = defineServiceFn({
  publish: true,
  title: "Update a method material",
  description: "Upsert method material",
  output: rows.methodMaterial
    .pick({ id: true })
    .meta({ table: "methodMaterial" }),
  input: z
    .looseObject({
      id: z
        .string()
        .describe(
          "Updates the existing record with this key; creates one when there is none."
        ),
      makeMethodId: z.string().min(1),
      order: z.number().min(0),
      itemType: z.enum(["Part", "Material", "Consumable"]),
      kit: booleanField().optional(),
      methodType: z.enum([
        "Purchase to Order",
        "Pull from Inventory",
        "Make to Order"
      ]),
      sourcingType: z.enum(["Specified", "Drop Ship", "Ship from Inventory"]),
      itemId: z.string().optional(),
      methodOperationId: z.string().optional(),
      quantity: z.number().min(0),
      unitOfMeasureCode: z.string().min(1),
      storageUnitIds: z.record(z.string(), z.unknown()).nullable().optional(),
      customFields: z.unknown().optional()
    })
    .required({ id: true }),
  // The route gated on create; the write runs under the update policy.
  permission: { create: "parts", update: "parts" },
  async run(ctx, input) {
    const lock = await service.checkRevisionLocks(
      ctx.asCaller.supabase,
      ctx.company.id,
      [
        { kind: "material", id: input.id },
        { kind: "makeMethod", id: input.makeMethodId }
      ]
    );
    if (!lock.ok) return ctx.error("rule", lock.message);
    return service.withLockNotice(
      lock,
      unwrap(
        ctx,
        await service.upsertMethodMaterial(
          ctx.asCaller.supabase,
          payload(ctx, input).forUpdate() as never
        )
      )
    );
  }
});

export const createMethodOperation = defineServiceFn({
  publish: true,
  title: "Create a method operation",
  description: "Upsert method operation",
  output: rows.methodOperation
    .pick({ id: true })
    .meta({ table: "methodOperation" }),
  input: z.looseObject({
    makeMethodId: z.string().min(0),
    order: z.number().min(0),
    operationOrder: z.enum(["After Previous", "With Previous"]),
    operationType: z.enum([
      "Process",
      "Assembly",
      "Inspection",
      "Outside Processing"
    ]),
    processId: z.string().min(1),
    workCenterId: z.string().optional(),
    procedureId: z.string().optional(),
    assemblyInstructionId: z.string().optional(),
    inspectionDocumentId: z.string().optional(),
    description: z.string().min(0),
    setupUnit: z
      .enum([
        "Hours/Piece",
        "Hours/100 Pieces",
        "Hours/1000 Pieces",
        "Minutes/Piece",
        "Minutes/100 Pieces",
        "Minutes/1000 Pieces",
        "Pieces/Hour",
        "Pieces/Minute",
        "Seconds/Piece",
        "Total Hours",
        "Total Minutes"
      ])
      .optional(),
    setupTime: z.number().min(0).optional(),
    laborUnit: z
      .enum([
        "Hours/Piece",
        "Hours/100 Pieces",
        "Hours/1000 Pieces",
        "Minutes/Piece",
        "Minutes/100 Pieces",
        "Minutes/1000 Pieces",
        "Pieces/Hour",
        "Pieces/Minute",
        "Seconds/Piece",
        "Total Hours",
        "Total Minutes"
      ])
      .optional(),
    laborTime: z.number().min(0).optional(),
    machineUnit: z
      .enum([
        "Hours/Piece",
        "Hours/100 Pieces",
        "Hours/1000 Pieces",
        "Minutes/Piece",
        "Minutes/100 Pieces",
        "Minutes/1000 Pieces",
        "Pieces/Hour",
        "Pieces/Minute",
        "Seconds/Piece",
        "Total Hours",
        "Total Minutes"
      ])
      .optional(),
    machineTime: z.number().min(0).optional(),
    operationSupplierProcessId: z.string().optional(),
    operationMinimumCost: z.number().min(0).optional(),
    operationUnitCost: z.number().min(0).optional(),
    operationLeadTime: z.number().min(0).optional(),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe(
        "Updates the existing record with this key; creates one when there is none."
      )
      .optional()
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    const lock = await service.checkRevisionLocks(
      ctx.asCaller.supabase,
      ctx.company.id,
      [{ kind: "makeMethod", id: input.makeMethodId }]
    );
    if (!lock.ok) return ctx.error("rule", lock.message);
    return service.withLockNotice(
      lock,
      unwrap(
        ctx,
        await service.upsertMethodOperation(
          ctx.asCaller.supabase,
          payload(ctx, input).forCreate() as never
        )
      )
    );
  }
});

export const updateMethodOperation = defineServiceFn({
  publish: true,
  title: "Update a method operation",
  description: "Upsert method operation",
  output: rows.methodOperation
    .pick({ id: true })
    .meta({ table: "methodOperation" }),
  input: z
    .looseObject({
      makeMethodId: z.string().min(0),
      order: z.number().min(0),
      operationOrder: z.enum(["After Previous", "With Previous"]),
      operationType: z.enum([
        "Process",
        "Assembly",
        "Inspection",
        "Outside Processing"
      ]),
      processId: z.string().min(1),
      workCenterId: z.string().optional(),
      procedureId: z.string().optional(),
      assemblyInstructionId: z.string().optional(),
      inspectionDocumentId: z.string().optional(),
      description: z.string().min(0),
      setupUnit: z
        .enum([
          "Hours/Piece",
          "Hours/100 Pieces",
          "Hours/1000 Pieces",
          "Minutes/Piece",
          "Minutes/100 Pieces",
          "Minutes/1000 Pieces",
          "Pieces/Hour",
          "Pieces/Minute",
          "Seconds/Piece",
          "Total Hours",
          "Total Minutes"
        ])
        .optional(),
      setupTime: z.number().min(0).optional(),
      laborUnit: z
        .enum([
          "Hours/Piece",
          "Hours/100 Pieces",
          "Hours/1000 Pieces",
          "Minutes/Piece",
          "Minutes/100 Pieces",
          "Minutes/1000 Pieces",
          "Pieces/Hour",
          "Pieces/Minute",
          "Seconds/Piece",
          "Total Hours",
          "Total Minutes"
        ])
        .optional(),
      laborTime: z.number().min(0).optional(),
      machineUnit: z
        .enum([
          "Hours/Piece",
          "Hours/100 Pieces",
          "Hours/1000 Pieces",
          "Minutes/Piece",
          "Minutes/100 Pieces",
          "Minutes/1000 Pieces",
          "Pieces/Hour",
          "Pieces/Minute",
          "Seconds/Piece",
          "Total Hours",
          "Total Minutes"
        ])
        .optional(),
      machineTime: z.number().min(0).optional(),
      operationSupplierProcessId: z.string().optional(),
      operationMinimumCost: z.number().min(0).optional(),
      operationUnitCost: z.number().min(0).optional(),
      operationLeadTime: z.number().min(0).optional(),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe(
          "Updates the existing record with this key; creates one when there is none."
        )
        .optional()
    })
    .required({ id: true }),
  // The route gated on create; the write runs under the update policy.
  permission: { create: "parts", update: "parts" },
  async run(ctx, input) {
    const lock = await service.checkRevisionLocks(
      ctx.asCaller.supabase,
      ctx.company.id,
      [
        { kind: "operation", id: input.id },
        { kind: "makeMethod", id: input.makeMethodId }
      ]
    );
    if (!lock.ok) return ctx.error("rule", lock.message);
    return service.withLockNotice(
      lock,
      unwrap(
        ctx,
        await service.upsertMethodOperation(
          ctx.asCaller.supabase,
          payload(ctx, input).forUpdate() as never
        )
      )
    );
  }
});

export const setMethodOperationWorkInstruction = defineServiceFn({
  publish: true,
  title: "Set the work instruction of a method operation",
  description: `Replaces the operation's work instruction; the rest of the operation is
unchanged. Only a Draft method version can change, and the revision's
release lock applies, as in the bill of process editor.`,
  output: rows.methodOperation
    .pick({ id: true })
    .meta({ table: "methodOperation" }),
  input: z.object({
    id: z.string().min(1).describe("The method operation's id."),
    text: z
      .string()
      .describe(
        "The work instruction as Markdown: headings, **bold**, _italic_, lists, links, quotes and code. Empty text clears it."
      )
  }),
  permission: { update: "parts" },

  async run(ctx, { id, text }) {
    const lock = await service.checkRevisionLocks(
      ctx.asCaller.supabase,
      ctx.company.id,
      [{ kind: "operation", id }]
    );
    if (!lock.ok) return ctx.error("rule", lock.message);
    const notDraft = await service.methodStepRefusal(
      ctx.asCaller.supabase,
      ctx.company.id,
      { operationId: id }
    );
    if (notDraft) return ctx.error("rule", notDraft);
    return service.withLockNotice(
      lock,
      await setOperationWorkInstruction(ctx, "methodOperation", id, text)
    );
  }
});

export const createMethodOperationStep = defineServiceFn({
  publish: true,
  title: "Create a method operation step",
  description: "Upsert method operation step",
  output: rows.methodOperationStep
    .pick({ id: true })
    .meta({ table: "methodOperationStep" }),
  input: z.looseObject({
    operationId: z.string().min(1),
    name: z.string().min(1),
    description: requiredTiptapDoc,
    type: z.enum([
      "Task",
      "Value",
      "Measurement",
      "Checkbox",
      "Timestamp",
      "Person",
      "List",
      "File",
      "Inspection"
    ]),
    unitOfMeasureCode: z.string().optional(),
    minValue: z.number().nullable().optional(),
    maxValue: z.number().nullable().optional(),
    listValues: z.array(z.string()).optional(),
    sortOrder: z.number().min(0).optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional(),
    updatedAt: z.string().optional()
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    const lock = await service.checkRevisionLock(ctx.asCaller.supabase, {
      kind: "operation",
      id: input.operationId,
      companyId: ctx.company.id
    });
    if (!lock.ok) return ctx.error("rule", lock.message);
    const refusal = await service.methodStepRefusal(
      ctx.asCaller.supabase,
      ctx.company.id,
      { operationId: input.operationId }
    );
    if (refusal) return ctx.error("rule", refusal);
    return service.withLockNotice(
      lock,
      unwrap(
        ctx,
        await service.upsertMethodOperationStep(
          ctx.asCaller.supabase,
          payload(ctx, input).forCreate() as never
        )
      )
    );
  }
});

export const updateMethodOperationStep = defineServiceFn({
  publish: true,
  title: "Update a method operation step",
  description: "Upsert method operation step",
  output: rows.methodOperationStep
    .pick({ id: true })
    .meta({ table: "methodOperationStep" }),
  input: z
    .looseObject({
      operationId: z.string().min(1),
      name: z.string().min(1),
      description: requiredTiptapDoc,
      type: z.enum([
        "Task",
        "Value",
        "Measurement",
        "Checkbox",
        "Timestamp",
        "Person",
        "List",
        "File",
        "Inspection"
      ]),
      unitOfMeasureCode: z.string().optional(),
      minValue: z.number().nullable().optional(),
      maxValue: z.number().nullable().optional(),
      listValues: z.array(z.string()).optional(),
      sortOrder: z.number().min(0).optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional(),
      updatedAt: z.string().optional()
    })
    .required({ id: true }),
  permission: { update: "parts" },
  async run(ctx, input) {
    const lock = await service.checkRevisionLocks(
      ctx.asCaller.supabase,
      ctx.company.id,
      [
        { kind: "step", id: input.id },
        { kind: "operation", id: input.operationId }
      ]
    );
    if (!lock.ok) return ctx.error("rule", lock.message);
    for (const ref of [
      { stepId: input.id },
      { operationId: input.operationId }
    ]) {
      const refusal = await service.methodStepRefusal(
        ctx.asCaller.supabase,
        ctx.company.id,
        ref
      );
      if (refusal) return ctx.error("rule", refusal);
    }
    return service.withLockNotice(
      lock,
      unwrap(
        ctx,
        await service.upsertMethodOperationStep(
          ctx.asCaller.supabase,
          payload(ctx, input).forUpdate() as never
        )
      )
    );
  }
});

export const duplicateMethodOperationStep = defineServiceFn({
  publish: true,
  title: "Duplicate method operation step",
  output: rows.methodOperationStep
    .pick({ id: true })
    .meta({ table: "methodOperationStep" }),
  input: z.looseObject({ id: z.string() }),
  permission: { create: "parts" },
  async run(ctx, input) {
    const refusal = await service.methodStepRefusal(
      ctx.asCaller.supabase,
      ctx.company.id,
      { stepId: input.id }
    );
    if (refusal) return ctx.error("rule", refusal);
    return unwrap(
      ctx,
      await service.duplicateMethodOperationStep(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});

export const createMethodOperationStepSlide = defineServiceFn({
  publish: true,
  title: "Create a method operation step slide",
  description: "Upsert method operation step slide",
  output: rows.methodOperationStepSlide
    .pick({ id: true })
    .meta({ table: "methodOperationStepSlide" }),
  input: z.looseObject({
    stepId: z.string().min(1),
    imagePath: z.string().optional(),
    modelUploadId: z.string().optional(),
    caption: z.string().optional(),
    sortOrder: z.number().min(0).optional(),
    size: z.enum(["small", "medium", "large"]).optional(),
    annotations: z
      .array(
        z.looseObject({
          id: z.string(),
          x: z.number(),
          y: z.number(),
          label: z.string().nullable().optional(),
          color: z.string().nullable().optional(),
          toolId: z.string().nullable().optional()
        })
      )
      .nullable()
      .optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional(),
    updatedAt: z.string().optional()
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    const refusal = await service.methodStepRefusal(
      ctx.asCaller.supabase,
      ctx.company.id,
      { stepId: input.stepId }
    );
    if (refusal) return ctx.error("rule", refusal);
    return unwrap(
      ctx,
      await service.upsertMethodOperationStepSlide(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

export const updateMethodOperationStepSlide = defineServiceFn({
  publish: true,
  title: "Update a method operation step slide",
  description: "Upsert method operation step slide",
  output: rows.methodOperationStepSlide
    .pick({ id: true })
    .meta({ table: "methodOperationStepSlide" }),
  input: z
    .looseObject({
      stepId: z.string().min(1),
      imagePath: z.string().optional(),
      modelUploadId: z.string().optional(),
      caption: z.string().optional(),
      sortOrder: z.number().min(0).optional(),
      size: z.enum(["small", "medium", "large"]).optional(),
      annotations: z
        .array(
          z.looseObject({
            id: z.string(),
            x: z.number(),
            y: z.number(),
            label: z.string().nullable().optional(),
            color: z.string().nullable().optional(),
            toolId: z.string().nullable().optional()
          })
        )
        .nullable()
        .optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional(),
      updatedAt: z.string().optional()
    })
    .required({ id: true }),
  permission: { update: "parts" },
  async run(ctx, input) {
    for (const ref of [{ slideId: input.id }, { stepId: input.stepId }]) {
      const refusal = await service.methodStepRefusal(
        ctx.asCaller.supabase,
        ctx.company.id,
        ref
      );
      if (refusal) return ctx.error("rule", refusal);
    }
    return unwrap(
      ctx,
      await service.upsertMethodOperationStepSlide(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

export const createMethodOperationParameter = defineServiceFn({
  publish: true,
  title: "Create a method operation parameter",
  description: "Upsert method operation parameter",
  output: rows.methodOperationParameter
    .pick({ id: true })
    .meta({ table: "methodOperationParameter" }),
  input: z.looseObject({
    operationId: z.string().min(1),
    key: z.string().min(1),
    value: z.string().min(1),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional(),
    updatedAt: z.string().optional()
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    const lock = await service.checkRevisionLocks(
      ctx.asCaller.supabase,
      ctx.company.id,
      [{ kind: "operation", id: input.operationId }]
    );
    if (!lock.ok) return ctx.error("rule", lock.message);
    return service.withLockNotice(
      lock,
      unwrap(
        ctx,
        await service.upsertMethodOperationParameter(
          ctx.asCaller.supabase,
          payload(ctx, input).forCreate() as never
        )
      )
    );
  }
});

export const updateMethodOperationParameter = defineServiceFn({
  publish: true,
  title: "Update a method operation parameter",
  description: "Upsert method operation parameter",
  output: rows.methodOperationParameter
    .pick({ id: true })
    .meta({ table: "methodOperationParameter" }),
  input: z
    .looseObject({
      operationId: z.string().min(1),
      key: z.string().min(1),
      value: z.string().min(1),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional(),
      updatedAt: z.string().optional()
    })
    .required({ id: true }),
  permission: { update: "parts" },
  async run(ctx, input) {
    const lock = await service.checkRevisionLocks(
      ctx.asCaller.supabase,
      ctx.company.id,
      [
        { kind: "parameter", id: input.id },
        { kind: "operation", id: input.operationId }
      ]
    );
    if (!lock.ok) return ctx.error("rule", lock.message);
    return service.withLockNotice(
      lock,
      unwrap(
        ctx,
        await service.upsertMethodOperationParameter(
          ctx.asCaller.supabase,
          payload(ctx, input).forUpdate() as never
        )
      )
    );
  }
});

export const createMethodOperationTool = defineServiceFn({
  publish: true,
  title: "Create a method operation tool",
  description: "Upsert method operation tool",
  output: rows.methodOperationTool
    .pick({ id: true })
    .meta({ table: "methodOperationTool" }),
  input: z.looseObject({
    operationId: z.string().min(1),
    toolId: z.string().min(1),
    quantity: z.number().min(0.000001),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional(),
    updatedAt: z.string().optional()
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    const lock = await service.checkRevisionLocks(
      ctx.asCaller.supabase,
      ctx.company.id,
      [{ kind: "operation", id: input.operationId }]
    );
    if (!lock.ok) return ctx.error("rule", lock.message);
    return service.withLockNotice(
      lock,
      unwrap(
        ctx,
        await service.upsertMethodOperationTool(
          ctx.asCaller.supabase,
          payload(ctx, input).forCreate() as never
        )
      )
    );
  }
});

export const updateMethodOperationTool = defineServiceFn({
  publish: true,
  title: "Update a method operation tool",
  description: "Upsert method operation tool",
  output: rows.methodOperationTool
    .pick({ id: true })
    .meta({ table: "methodOperationTool" }),
  input: z
    .looseObject({
      operationId: z.string().min(1),
      toolId: z.string().min(1),
      quantity: z.number().min(0.000001),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional(),
      updatedAt: z.string().optional()
    })
    .required({ id: true }),
  permission: { update: "parts" },
  async run(ctx, input) {
    const lock = await service.checkRevisionLocks(
      ctx.asCaller.supabase,
      ctx.company.id,
      [
        { kind: "tool", id: input.id },
        { kind: "operation", id: input.operationId }
      ]
    );
    if (!lock.ok) return ctx.error("rule", lock.message);
    return service.withLockNotice(
      lock,
      unwrap(
        ctx,
        await service.upsertMethodOperationTool(
          ctx.asCaller.supabase,
          payload(ctx, input).forUpdate() as never
        )
      )
    );
  }
});

export const setMethodMaterialStepLink = defineServiceFn({
  publish: "destructive",
  title: "Set method material step link",
  output: z.null(),
  input: z.looseObject({
    methodMaterialId: z.string(),
    methodOperationStepId: z.string(),
    linked: z.boolean(),
    quantity: z.number().nullable().optional()
  }),
  permission: { update: "parts" },
  async run(ctx, input) {
    const client = ctx.asCaller.supabase;
    const refusal = await service.methodStepRefusal(client, ctx.company.id, {
      stepId: input.methodOperationStepId
    });
    if (refusal) return ctx.error("rule", refusal);

    // A step's share never exceeds the bill of materials line: the line is what
    // the method requires. A step that uses none of a part is unlinked instead.
    if (input.linked && input.quantity != null) {
      if (!(input.quantity > 0)) {
        return ctx.error("validation", "A step's quantity must be above zero");
      }
      const material = await client
        .from("methodMaterial")
        .select("quantity")
        .eq("id", input.methodMaterialId)
        .eq("companyId", ctx.company.id)
        .maybeSingle();
      if (material.error) {
        return ctx.error(
          "internal",
          "Failed to load method material",
          material.error
        );
      }
      if (!material.data) {
        return ctx.error("notFound", "Method material not found");
      }
      if (
        material.data.quantity !== null &&
        input.quantity > material.data.quantity
      ) {
        return ctx.error(
          "validation",
          "A step cannot use more than the bill of materials line"
        );
      }
    }

    return unwrap(
      ctx,
      await service.setMethodMaterialStepLink(client, {
        methodMaterialId: input.methodMaterialId,
        methodOperationStepId: input.methodOperationStepId,
        linked: input.linked,
        quantity: input.quantity
      })
    );
  }
});

export const setMethodOperationToolStepLink = defineServiceFn({
  publish: "destructive",
  title: "Set method operation tool step link",
  output: z.null(),
  input: z.looseObject({
    operationId: z.string(),
    toolId: z.string(),
    methodOperationStepId: z.string(),
    linked: z.boolean()
  }),
  permission: { update: "parts" },
  async run(ctx, input) {
    const client = ctx.asCaller.supabase;
    const step = await client
      .from("methodOperationStep")
      .select("operationId")
      .eq("id", input.methodOperationStepId)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (step.error) {
      return ctx.error("internal", "Failed to load the step", step.error);
    }
    if (step.data?.operationId !== input.operationId) {
      return ctx.error("notFound", "The step is not on this operation");
    }
    const refusal = await service.methodStepRefusal(client, ctx.company.id, {
      operationId: input.operationId
    });
    if (refusal) return ctx.error("rule", refusal);

    return unwrap(
      ctx,
      await service.setMethodOperationToolStepLink(client, {
        operationId: input.operationId,
        toolId: input.toolId,
        methodOperationStepId: input.methodOperationStepId,
        linked: input.linked,
        companyId: ctx.company.id,
        createdBy: ctx.auditUserId
      })
    );
  }
});

export const createMaterial = defineServiceFn({
  publish: true,
  title: "Create a material",
  description:
    "Creates a material or updates one by item id or readable id; an update keeps any optional field it leaves out, and `sizes` adds a revision per new size",
  input: z.looseObject({
    id: z
      .string()
      .min(1)
      .max(255)
      .describe(
        "Updates the existing record with this key; creates one when there is none."
      ),
    readableId: z.string().optional(),
    name: z.string().min(1).max(255),
    description: z.string().optional(),
    mpn: z.string().optional(),
    replenishmentSystem: z.enum(["Buy", "Make", "Buy and Make"]),
    defaultMethodType: z.enum([
      "Purchase to Order",
      "Pull from Inventory",
      "Make to Order"
    ]),
    itemTrackingType: z.enum(["Inventory", "Non-Inventory", "Serial", "Batch"]),
    postingGroupId: z.string().optional(),
    unitOfMeasureCode: z.string().min(1),
    unitCost: z.number().min(0).optional(),
    defaultStorageUnitId: z.string().optional(),
    shelfLifeMode: z
      .enum(["NotManaged", "Fixed Duration", "Calculated", "Set on Receipt"])
      .optional(),
    shelfLifeDays: z.number().gt(0).optional(),
    shelfLifeTriggerProcessId: z.string().optional(),
    shelfLifeTriggerTiming: z.enum(["Before", "After"]).optional(),
    shelfLifeCalculateFromBom: z.boolean().optional(),
    materialSubstanceId: z.string().optional(),
    materialFormId: z.string().optional(),
    materialTypeId: z.string().optional(),
    finishId: z.string().optional(),
    gradeId: z.string().optional(),
    dimensionId: z.string().optional(),
    sizes: z.array(z.string()).optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    return await service.upsertMaterial(
      ctx.asCaller.supabase,
      ctx.asSystem.pg,
      payload(ctx, input).forCreate() as never
    );
  }
});

export const updateMaterial = defineServiceFn({
  publish: true,
  title: "Update a material",
  description:
    "Creates a material or updates one by item id or readable id; an update keeps any optional field it leaves out, and `sizes` adds a revision per new size",
  input: z
    .looseObject({
      id: z
        .string()
        .min(1)
        .max(255)
        .describe(
          "Updates the existing record with this key; creates one when there is none."
        ),
      readableId: z.string().optional(),
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      mpn: z.string().optional(),
      replenishmentSystem: z.enum(["Buy", "Make", "Buy and Make"]),
      defaultMethodType: z.enum([
        "Purchase to Order",
        "Pull from Inventory",
        "Make to Order"
      ]),
      itemTrackingType: z.enum([
        "Inventory",
        "Non-Inventory",
        "Serial",
        "Batch"
      ]),
      postingGroupId: z.string().optional(),
      unitOfMeasureCode: z.string().min(1),
      unitCost: z.number().min(0).optional(),
      defaultStorageUnitId: z.string().optional(),
      shelfLifeMode: z
        .enum(["NotManaged", "Fixed Duration", "Calculated", "Set on Receipt"])
        .optional(),
      shelfLifeDays: z.number().gt(0).optional(),
      shelfLifeTriggerProcessId: z.string().optional(),
      shelfLifeTriggerTiming: z.enum(["Before", "After"]).optional(),
      shelfLifeCalculateFromBom: z.boolean().optional(),
      materialSubstanceId: z.string().optional(),
      materialFormId: z.string().optional(),
      materialTypeId: z.string().optional(),
      finishId: z.string().optional(),
      gradeId: z.string().optional(),
      dimensionId: z.string().optional(),
      sizes: z.array(z.string()).optional(),
      customFields: z.unknown().optional()
    })
    .required({ id: true }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return await service.upsertMaterial(
      ctx.asCaller.supabase,
      ctx.asSystem.pg,
      payload(ctx, input).forUpdate() as never
    );
  }
});

export const upsertMaterialDimension = defineServiceFn({
  publish: true,
  title:
    "Creates a dimension (a named size) for a material shape, or updates the one whose `id` is sent; a new dimension's id is generated",
  output: rows.materialDimension
    .pick({ id: true })
    .meta({ table: "materialDimension" }),
  input: z.looseObject({
    name: z.string().min(1).max(255),
    materialFormId: z.string().min(1),
    isMetric: z.boolean().optional(),
    id: z.string().optional()
  }),
  permission: { create: "parts", update: "parts" },
  // The row is built from the known fields: the table has no audit columns,
  // so a stray createdBy or updatedBy would fail the write.
  async run(ctx, { name, materialFormId, isMetric, id }) {
    const row = { name, materialFormId, companyId: ctx.company.id };
    return unwrap(
      ctx,
      await service.upsertMaterialDimension(
        ctx.asCaller.supabase,
        id
          ? { ...row, id, ...(isMetric !== undefined && { isMetric }) }
          : { ...row, isMetric: isMetric ?? false }
      )
    );
  }
});

export const upsertMaterialFinish = defineServiceFn({
  publish: true,
  title:
    "Creates a finish for a material substance, or updates the one whose `id` is sent; a new finish's id is generated",
  output: rows.materialFinish
    .pick({ id: true })
    .meta({ table: "materialFinish" }),
  input: z.looseObject({
    materialSubstanceId: z.string().min(1),
    name: z.string().min(1).max(255),
    id: z.string().optional()
  }),
  permission: { create: "parts", update: "parts" },
  // The row is built from the known fields: the table has no audit columns,
  // so a stray createdBy or updatedBy would fail the write.
  async run(ctx, { materialSubstanceId, name, id }) {
    const row = { materialSubstanceId, name, companyId: ctx.company.id };
    return unwrap(
      ctx,
      await service.upsertMaterialFinish(
        ctx.asCaller.supabase,
        id ? { ...row, id } : row
      )
    );
  }
});

export const createMaterialForm = defineServiceFn({
  publish: true,
  title: "Create a material form",
  description: "Upsert material form",
  output: rows.materialForm.pick({ id: true }).meta({ table: "materialForm" }),
  input: z.looseObject({
    name: z.string().min(1).max(255),
    code: z.string().min(1).max(10),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertMaterialForm(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

export const updateMaterialForm = defineServiceFn({
  publish: true,
  title: "Update a material form",
  description: "Upsert material form",
  output: rows.materialForm.pick({ id: true }).meta({ table: "materialForm" }),
  input: z
    .looseObject({
      name: z.string().min(1).max(255),
      code: z.string().min(1).max(10),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertMaterialForm(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

export const upsertMaterialGrade = defineServiceFn({
  publish: true,
  title:
    "Creates a grade for a material substance, or updates the one whose `id` is sent; a new grade's id is generated",
  output: rows.materialGrade
    .pick({ id: true })
    .meta({ table: "materialGrade" }),
  input: z.looseObject({
    materialSubstanceId: z.string().min(1),
    name: z.string().min(1).max(255),
    id: z.string().optional()
  }),
  permission: { create: "parts", update: "parts" },
  // The row is built from the known fields: the table has no audit columns,
  // so a stray createdBy or updatedBy would fail the write.
  async run(ctx, { materialSubstanceId, name, id }) {
    const row = { materialSubstanceId, name, companyId: ctx.company.id };
    return unwrap(
      ctx,
      await service.upsertMaterialGrade(
        ctx.asCaller.supabase,
        id ? { ...row, id } : row
      )
    );
  }
});

export const deleteMaterialType = defineServiceFn({
  publish: "destructive",
  title: "Delete material type",
  output: z.array(
    rows.materialType.pick({ id: true }).meta({ table: "materialType" })
  ),
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteMaterialType(ctx.asCaller.supabase, input.id as never)
    );
  }
});

export const getMaterialTypes = defineServiceFn({
  publish: "read",
  title: "Get material types",
  output: z.array(rows.materialTypes).nullable(),
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getMaterialTypes(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getMaterialType = defineServiceFn({
  publish: "read",
  title: "Get material type",
  output: rows.materialType,
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getMaterialType(ctx.asCaller.supabase, input.id as never)
    );
  }
});

export const getMaterialTypeList = defineServiceFn({
  publish: "read",
  title: "Get material type list",
  output: z.array(rows.materialType),
  input: z.looseObject({
    materialSubstanceId: z.string(),
    materialFormId: z.string()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getMaterialTypeList(
        ctx.asCaller.supabase,
        input.materialSubstanceId as never,
        input.materialFormId as never,
        ctx.company.id
      )
    );
  }
});

export const upsertMaterialType = defineServiceFn({
  publish: true,
  title:
    "Creates a material type for a substance and shape pair, or updates the one whose `id` is sent; a new type's id is generated",
  output: rows.materialType.pick({ id: true }).meta({ table: "materialType" }),
  input: z.looseObject({
    materialSubstanceId: z.string().min(1),
    materialFormId: z.string().min(1),
    name: z.string().min(1).max(255),
    code: z.string().min(1).max(10),
    id: z.string().optional()
  }),
  permission: { create: "parts", update: "parts" },
  // The row is built from the known fields: the table has no audit columns,
  // so a stray createdBy or updatedBy would fail the write.
  async run(ctx, { materialSubstanceId, materialFormId, name, code, id }) {
    const row = {
      materialSubstanceId,
      materialFormId,
      name,
      code,
      companyId: ctx.company.id
    };
    return unwrap(
      ctx,
      await service.upsertMaterialType(
        ctx.asCaller.supabase,
        id ? { ...row, id } : row
      )
    );
  }
});

export const createMaterialSubstance = defineServiceFn({
  publish: true,
  title: "Create a material substance",
  description: "Upsert material substance",
  output: rows.materialSubstance
    .pick({ id: true })
    .meta({ table: "materialSubstance" }),
  input: z.looseObject({
    name: z.string().min(1).max(255),
    code: z.string().min(1).max(10),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertMaterialSubstance(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

export const updateMaterialSubstance = defineServiceFn({
  publish: true,
  title: "Update a material substance",
  description: "Upsert material substance",
  output: rows.materialSubstance
    .pick({ id: true })
    .meta({ table: "materialSubstance" }),
  input: z
    .looseObject({
      name: z.string().min(1).max(255),
      code: z.string().min(1).max(10),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertMaterialSubstance(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

export const createService = defineServiceFn({
  publish: true,
  title: "Create a service",
  description: "Creates a service (item row and service row) or updates one",
  output: z.union([
    z.object({
      active: z.boolean().nullable(),
      assignee: z.string().nullable(),
      companyId: z.string().nullable(),
      createdAt: z.string().nullable(),
      createdBy: z.string().nullable(),
      customFields: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(z.unknown()),
            z.null()
          ])
        ),
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(z.unknown()),
            z.null()
          ])
        ),
        z.null()
      ]),
      defaultMethodType: z
        .enum(["Make to Order", "Pull from Inventory", "Purchase to Order"])
        .nullable(),
      description: z.string().nullable(),
      externalId: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(z.unknown()),
            z.null()
          ])
        ),
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(z.unknown()),
            z.null()
          ])
        ),
        z.null()
      ]),
      id: z.string().nullable(),
      itemPostingGroupId: z.string().nullable(),
      itemTrackingType: z
        .enum(["Batch", "Inventory", "Non-Inventory", "Serial"])
        .nullable(),
      name: z.string().nullable(),
      notes: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(z.unknown()),
            z.null()
          ])
        ),
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(z.unknown()),
            z.null()
          ])
        ),
        z.null()
      ]),
      readableId: z.string().nullable(),
      readableIdWithRevision: z.string().nullable(),
      replenishmentSystem: z.enum(["Buy", "Buy and Make", "Make"]).nullable(),
      revision: z.string().nullable(),
      revisions: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(z.unknown()),
            z.null()
          ])
        ),
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(z.unknown()),
            z.null()
          ])
        ),
        z.null()
      ]),
      supplierIds: z.string().nullable(),
      suppliers: z.array(z.string()).nullable(),
      tags: z.array(z.string()).nullable(),
      thumbnailPath: z.string().nullable(),
      unitOfMeasure: z.string().nullable(),
      unitOfMeasureCode: z.string().nullable(),
      updatedAt: z.string().nullable(),
      updatedBy: z.string().nullable()
    }),
    z.object({
      id: z.string(),
      readableId: z.string()
    }),
    z.null()
  ]),
  input: z.looseObject({
    id: z
      .string()
      .max(255)
      .describe(
        "Updates the existing record with this key; creates one when there is none."
      )
      .optional(),
    readableId: z.string().optional(),
    name: z.string().min(1).max(100),
    description: z.string().optional(),
    mpn: z.string().optional(),
    replenishmentSystem: z.enum(["Buy", "Make"]),
    defaultMethodType: z.enum([
      "Purchase to Order",
      "Pull from Inventory",
      "Make to Order"
    ]),
    itemTrackingType: z.literal("Non-Inventory"),
    postingGroupId: z.string().optional(),
    unitOfMeasureCode: z.string().optional(),
    unitCost: z.number().min(0).optional(),
    defaultStorageUnitId: z.string().optional(),
    shelfLifeMode: z
      .enum(["NotManaged", "Fixed Duration", "Calculated", "Set on Receipt"])
      .optional(),
    shelfLifeDays: z.number().gt(0).optional(),
    shelfLifeTriggerProcessId: z.string().optional(),
    shelfLifeTriggerTiming: z.enum(["Before", "After"]).optional(),
    shelfLifeCalculateFromBom: z.boolean().optional(),
    revision: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertService(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

export const updateService = defineServiceFn({
  publish: true,
  title: "Update a service",
  description: "Creates a service (item row and service row) or updates one",
  output: z.union([
    z.object({
      active: z.boolean().nullable(),
      assignee: z.string().nullable(),
      companyId: z.string().nullable(),
      createdAt: z.string().nullable(),
      createdBy: z.string().nullable(),
      customFields: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(z.unknown()),
            z.null()
          ])
        ),
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(z.unknown()),
            z.null()
          ])
        ),
        z.null()
      ]),
      defaultMethodType: z
        .enum(["Make to Order", "Pull from Inventory", "Purchase to Order"])
        .nullable(),
      description: z.string().nullable(),
      externalId: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(z.unknown()),
            z.null()
          ])
        ),
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(z.unknown()),
            z.null()
          ])
        ),
        z.null()
      ]),
      id: z.string().nullable(),
      itemPostingGroupId: z.string().nullable(),
      itemTrackingType: z
        .enum(["Batch", "Inventory", "Non-Inventory", "Serial"])
        .nullable(),
      name: z.string().nullable(),
      notes: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(z.unknown()),
            z.null()
          ])
        ),
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(z.unknown()),
            z.null()
          ])
        ),
        z.null()
      ]),
      readableId: z.string().nullable(),
      readableIdWithRevision: z.string().nullable(),
      replenishmentSystem: z.enum(["Buy", "Buy and Make", "Make"]).nullable(),
      revision: z.string().nullable(),
      revisions: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(z.unknown()),
            z.null()
          ])
        ),
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(z.unknown()),
            z.null()
          ])
        ),
        z.null()
      ]),
      supplierIds: z.string().nullable(),
      suppliers: z.array(z.string()).nullable(),
      tags: z.array(z.string()).nullable(),
      thumbnailPath: z.string().nullable(),
      unitOfMeasure: z.string().nullable(),
      unitOfMeasureCode: z.string().nullable(),
      updatedAt: z.string().nullable(),
      updatedBy: z.string().nullable()
    }),
    z.object({
      id: z.string(),
      readableId: z.string()
    }),
    z.null()
  ]),
  input: z
    .looseObject({
      id: z
        .string()
        .max(255)
        .describe(
          "Updates the existing record with this key; creates one when there is none."
        )
        .optional(),
      readableId: z.string().optional(),
      name: z.string().min(1).max(100),
      description: z.string().optional(),
      mpn: z.string().optional(),
      replenishmentSystem: z.enum(["Buy", "Make"]),
      defaultMethodType: z.enum([
        "Purchase to Order",
        "Pull from Inventory",
        "Make to Order"
      ]),
      itemTrackingType: z.literal("Non-Inventory"),
      postingGroupId: z.string().optional(),
      unitOfMeasureCode: z.string().optional(),
      unitCost: z.number().min(0).optional(),
      defaultStorageUnitId: z.string().optional(),
      shelfLifeMode: z
        .enum(["NotManaged", "Fixed Duration", "Calculated", "Set on Receipt"])
        .optional(),
      shelfLifeDays: z.number().gt(0).optional(),
      shelfLifeTriggerProcessId: z.string().optional(),
      shelfLifeTriggerTiming: z.enum(["Before", "After"]).optional(),
      shelfLifeCalculateFromBom: z.boolean().optional(),
      revision: z.string().optional(),
      customFields: z.unknown().optional()
    })
    .required({ id: true }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertService(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

export const createUnitOfMeasure = defineServiceFn({
  publish: true,
  title: "Create a unit of measure",
  description: "Upsert unit of measure",
  output: rows.unitOfMeasure
    .pick({ id: true })
    .meta({ table: "unitOfMeasure" }),
  input: z.looseObject({
    code: z.string().min(1).max(10),
    name: z.string().min(1).max(50),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertUnitOfMeasure(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

export const updateUnitOfMeasure = defineServiceFn({
  publish: true,
  title: "Update a unit of measure",
  description: "Upsert unit of measure",
  output: rows.unitOfMeasure
    .pick({ id: true })
    .meta({ table: "unitOfMeasure" }),
  input: z
    .looseObject({
      code: z.string().min(1).max(10),
      name: z.string().min(1).max(50),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertUnitOfMeasure(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

export const createTool = defineServiceFn({
  publish: true,
  title: "Create a tool",
  description:
    "Creates a tool (item row and tool row) or updates one; on update `id` is the item id (uuid) or the tool's readable id and the write is a full replace, so omitt…",
  input: z.looseObject({
    id: z
      .string()
      .min(1)
      .max(255)
      .describe(
        "Updates the existing record with this key; creates one when there is none."
      ),
    readableId: z.string().optional(),
    name: z.string().min(1).max(255),
    description: z.string().optional(),
    mpn: z.string().optional(),
    replenishmentSystem: z.enum(["Buy", "Make", "Buy and Make"]),
    defaultMethodType: z.enum([
      "Purchase to Order",
      "Pull from Inventory",
      "Make to Order"
    ]),
    itemTrackingType: z.enum(["Inventory", "Non-Inventory", "Serial", "Batch"]),
    postingGroupId: z.string().optional(),
    unitOfMeasureCode: z.string().min(1),
    unitCost: z.number().min(0).optional(),
    defaultStorageUnitId: z.string().optional(),
    shelfLifeMode: z
      .enum(["NotManaged", "Fixed Duration", "Calculated", "Set on Receipt"])
      .optional(),
    shelfLifeDays: z.number().gt(0).optional(),
    shelfLifeTriggerProcessId: z.string().optional(),
    shelfLifeTriggerTiming: z.enum(["Before", "After"]).optional(),
    shelfLifeCalculateFromBom: z.boolean().optional(),
    revision: z.string().min(1),
    modelUploadId: z.string().optional(),
    lotSize: z.number().min(0).optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    return await service.upsertTool(
      ctx.asCaller.supabase,
      payload(ctx, input).forCreate() as never
    );
  }
});

export const getSupplierPriceBreaksForItems = defineServiceFn({
  publish: "read",
  title: "Batch pre-fetch supplier pricing for multiple items, for costing",
  output: z.record(
    z.string(),
    z.object({
      priceBreaks: z.array(
        z.object({
          quantity: z.number(),
          unitPrice: z.number()
        })
      ),
      fallbackUnitPrice: z.number().nullable()
    })
  ),
  input: z.looseObject({ itemIds: z.array(z.string()) }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return await utils.getSupplierPriceBreaksForItems(
      ctx.asCaller.supabase,
      payload(ctx, input.itemIds).build() as never
    );
  }
});

export const getChangeNotice = defineServiceFn({
  publish: "read",
  title: "Get change notice",
  output: z.object({
    approvalRequirements: z.array(z.string()).nullable(),
    assignee: z.string().nullable(),
    changeOrderId: z.string(),
    changeOrderTypeId: z.string().nullable(),
    companyId: z.string(),
    createdAt: z.string(),
    createdBy: z.string(),
    customFields: z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.record(
        z.string(),
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(z.string(), z.unknown()),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.array(
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.null()
    ]),
    description: z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.record(
        z.string(),
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(z.string(), z.unknown()),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.array(
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.null()
    ]),
    dueDate: z.string().nullable(),
    id: z.string(),
    name: z.string(),
    nonConformanceId: z.string().nullable(),
    openDate: z.string(),
    priority: z.enum(["Critical", "High", "Low", "Medium"]).nullable(),
    reasonForChange: z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.record(
        z.string(),
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(z.string(), z.unknown()),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.array(
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.null()
    ]),
    requiredActionIds: z.array(z.string()).nullable(),
    sourceId: z.string().nullable(),
    sourceType: z.string().nullable(),
    status: z.enum([
      "Cancelled",
      "Done",
      "Draft",
      "Engineering Complete",
      "Implementation",
      "Start"
    ]),
    tags: z.array(z.string()).nullable(),
    type: z.enum(["Documentation", "Engineering", "Manufacturing"]),
    updatedAt: z.string().nullable(),
    updatedBy: z.string().nullable()
  }),
  input: z.looseObject({ changeNoticeId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getChangeNotice(
        ctx.asCaller.supabase,
        input.changeNoticeId as never,
        ctx.company.id
      )
    );
  }
});

export const getChangeNotices = defineServiceFn({
  publish: "read",
  title: "Get change notices",
  output: z
    .array(
      z.object({
        affectedItems: z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ]),
        approvalRequirements: z.array(z.string()).nullable(),
        assignee: z.string().nullable(),
        changeOrderId: z.string().nullable(),
        changeOrderTypeId: z.string().nullable(),
        companyId: z.string().nullable(),
        createdAt: z.string().nullable(),
        createdBy: z.string().nullable(),
        customFields: z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ]),
        description: z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ]),
        dueDate: z.string().nullable(),
        id: z.string().nullable(),
        itemIds: z.array(z.string()).nullable(),
        name: z.string().nullable(),
        nonConformanceId: z.string().nullable(),
        openDate: z.string().nullable(),
        priority: z.enum(["Critical", "High", "Low", "Medium"]).nullable(),
        reasonForChange: z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ]),
        requiredActionIds: z.array(z.string()).nullable(),
        sourceId: z.string().nullable(),
        sourceType: z.string().nullable(),
        status: z
          .enum([
            "Cancelled",
            "Done",
            "Draft",
            "Engineering Complete",
            "Implementation",
            "Start"
          ])
          .nullable(),
        tags: z.array(z.string()).nullable(),
        type: z
          .enum(["Documentation", "Engineering", "Manufacturing"])
          .nullable(),
        updatedAt: z.string().nullable(),
        updatedBy: z.string().nullable()
      })
    )
    .nullable(),
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getChangeNotices(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const updateChangeNotice = defineServiceFn({
  publish: true,
  title: "Update change notice",
  output: z.object({
    id: z.string()
  }),
  input: z.looseObject({
    id: z.string(),
    changeOrderId: z.string().optional(),
    name: z.string().optional(),
    type: z.enum(["Engineering", "Manufacturing", "Documentation"]).optional(),
    priority: z.string().nullable().optional(),
    changeOrderTypeId: z.string().nullable().optional(),
    nonConformanceId: z.string().nullable().optional(),
    openDate: z.string().optional(),
    reasonForChange: optionalTiptapDoc,
    description: optionalTiptapDoc,
    dueDate: z.string().nullable().optional(),
    assignee: z.string().nullable().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { update: "parts" },
  async run(ctx, input) {
    const locked = await service.requireChangeNoticeEditable(
      ctx.asCaller.supabase,
      {
        changeNoticeId: input.id,
        companyId: ctx.company.id,
        scope:
          input.reasonForChange !== undefined || input.description !== undefined
            ? "engineering"
            : "workflow"
      }
    );
    if (locked) return ctx.error("rule", locked.error.message);
    return unwrap(
      ctx,
      await service.updateChangeNotice(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

export const deleteChangeNotice = defineServiceFn({
  publish: "destructive",
  title: "Delete change notice",
  output: z.array(
    z.object({
      id: z.string()
    })
  ),
  input: z.looseObject({ changeNoticeId: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    const deleted = unwrap(
      ctx,
      await service.deleteChangeNotice(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        input.changeNoticeId,
        ctx.company.id
      )
    );
    if (deleted instanceof CarbonError) return deleted;

    // approvalRequest.documentId has no foreign key, so a pending request
    // would outlive the notice in the approvers' lists.
    const cancelled = await cancelPendingApprovals(ctx.asSystem.supabase, {
      documentType: "changeOrder",
      documentIds: [input.changeNoticeId],
      companyId: ctx.company.id,
      userId: ctx.auditUserId
    });
    if (cancelled.error) {
      logger.error("Failed to cancel change notice approval requests", {
        companyId: ctx.company.id,
        changeNoticeId: input.changeNoticeId,
        error: cancelled.error
      });
    }
    return deleted;
  }
});

export const getChangeNoticeTypes = defineServiceFn({
  publish: "read",
  title: "Get change notice types",
  output: z.array(rows.changeOrderType).nullable(),
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getChangeNoticeTypes(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getChangeNoticeTypesList = defineServiceFn({
  publish: "read",
  title: "Get change notice types list",
  output: z.array(
    z.object({
      id: z.string(),
      name: z.string()
    })
  ),
  input: z.record(z.string(), z.unknown()),
  permission: { view: "parts" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getChangeNoticeTypesList(
        ctx.asCaller.supabase,
        ctx.company.id
      )
    );
  }
});

export const getChangeNoticeType = defineServiceFn({
  publish: "read",
  title: "Get change notice type",
  output: rows.changeOrderType,
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getChangeNoticeType(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

export const createChangeNoticeType = defineServiceFn({
  publish: true,
  title: "Create a change notice type",
  description: "Upsert change notice type",
  output: z.object({
    id: z.string()
  }),
  input: z.looseObject({
    name: z.string(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertChangeNoticeType(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

export const updateChangeNoticeType = defineServiceFn({
  publish: true,
  title: "Update a change notice type",
  description: "Upsert change notice type",
  output: z.object({
    id: z.string()
  }),
  input: z.looseObject({
    id: z.string(),
    name: z.string(),
    customFields: z.unknown().optional()
  }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertChangeNoticeType(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

export const deleteChangeNoticeType = defineServiceFn({
  publish: "destructive",
  title: "Delete change notice type",
  output: z.array(
    z.object({
      id: z.string()
    })
  ),
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteChangeNoticeType(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

export const addChangeNoticeAffectedItem = defineServiceFn({
  publish: "destructive",
  title: "Add change notice affected item",
  output: z.object({
    id: z.string(),
    draftMakeMethodId: z.string().nullable()
  }),
  input: z.looseObject({
    changeNoticeId: z.string(),
    itemId: z.string().optional(),
    changeType: z.enum(["Version", "Revision", "Replacement Part", "New Part"]),
    revision: z.string().optional(),
    newPart: z
      .looseObject({
        readableId: z.string(),
        name: z.string(),
        itemType: z.enum(["Part", "Tool"]),
        replenishmentSystem: z.enum(["Buy", "Make", "Buy and Make"]),
        itemTrackingType: z
          .enum(["Inventory", "Non-Inventory", "Serial", "Batch"])
          .optional()
      })
      .optional()
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    const locked = await service.requireChangeNoticeEditable(
      ctx.asCaller.supabase,
      {
        changeNoticeId: input.changeNoticeId,
        companyId: ctx.company.id,
        scope: "engineering"
      }
    );
    if (locked) return ctx.error("rule", locked.error.message);
    return unwrap(
      ctx,
      await service.addChangeNoticeAffectedItem(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        payload(ctx, input).withUser().forUpsert() as never
      )
    );
  }
});

export const updateChangeNoticeAffectedItemChangeType = defineServiceFn({
  publish: true,
  title: "Update change notice affected item change type",
  output: rows.item.pick({ id: true }).meta({ table: "item" }),
  input: z.looseObject({
    id: z.string(),
    changeType: z.enum(["Version", "Revision", "Replacement Part", "New Part"])
  }),
  permission: { update: "parts" },
  async run(ctx, input) {
    const locked = await service.requireChangeNoticeChildEditable(
      ctx.asCaller.supabase,
      {
        table: "changeOrderAffectedItem",
        id: input.id,
        companyId: ctx.company.id,
        scope: "engineering"
      }
    );
    if (locked) return ctx.error("rule", locked.error.message);
    return unwrap(
      ctx,
      await service.updateChangeNoticeAffectedItemChangeType(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        payload(ctx, input).withUser().forUpdate() as never
      )
    );
  }
});

export const updateChangeNoticeAffectedItemCutover = defineServiceFn({
  publish: true,
  title: "Update change notice affected item cutover",
  output: rows.item.pick({ id: true }).meta({ table: "item" }),
  input: z.looseObject({
    id: z.string(),
    supersessionMode: z.enum([
      "Consume First",
      "Prefer New",
      "Stock Only",
      "No Stock"
    ]),
    discontinuationDate: z.string().optional(),
    successorEffectivityDate: z.string().optional()
  }),
  permission: { update: "parts" },
  async run(ctx, input) {
    const locked = await service.requireChangeNoticeChildEditable(
      ctx.asCaller.supabase,
      {
        table: "changeOrderAffectedItem",
        id: input.id,
        companyId: ctx.company.id,
        scope: "engineering"
      }
    );
    if (locked) return ctx.error("rule", locked.error.message);
    return unwrap(
      ctx,
      await service.updateChangeNoticeAffectedItemCutover(
        ctx.asCaller.supabase,
        payload(ctx, input).withUser().forUpdate() as never
      )
    );
  }
});

export const getChangeNoticeAffectedItems = defineServiceFn({
  publish: "read",
  title: "Get change notice affected items",
  output: z.array(z.unknown()),
  input: z.looseObject({ changeNoticeId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getChangeNoticeAffectedItems(
        ctx.asCaller.supabase,
        input.changeNoticeId as never,
        ctx.company.id
      )
    );
  }
});

export const removeChangeNoticeAffectedItem = defineServiceFn({
  publish: "destructive",
  title: "Remove change notice affected item",
  output: z.array(rows.item.pick({ id: true }).meta({ table: "item" })),
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    const locked = await service.requireChangeNoticeChildEditable(
      ctx.asCaller.supabase,
      {
        table: "changeOrderAffectedItem",
        id: input.id,
        companyId: ctx.company.id,
        scope: "engineering"
      }
    );
    if (locked) return ctx.error("rule", locked.error.message);
    return unwrap(
      ctx,
      await service.removeChangeNoticeAffectedItem(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

export const getChangeNoticesForNonConformance = defineServiceFn({
  publish: "read",
  title: "Get change notices for non conformance",
  output: z.array(
    z.object({
      id: z.string(),
      changeOrderId: z.string(),
      name: z.string(),
      status: z.enum([
        "Cancelled",
        "Done",
        "Draft",
        "Engineering Complete",
        "Implementation",
        "Start"
      ])
    })
  ),
  input: z.looseObject({ nonConformanceId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getChangeNoticesForNonConformance(
        ctx.asCaller.supabase,
        input.nonConformanceId as never,
        ctx.company.id
      )
    );
  }
});

export const getChangeNoticeActions = defineServiceFn({
  publish: "read",
  title: "Get change notice actions",
  output: z.array(
    z.object({
      linearIssue: z.record(z.string(), z.unknown()).nullable(),
      jiraIssue: z.record(z.string(), z.unknown()).nullable(),
      actionTypeId: z.string().nullable(),
      assignee: z.string().nullable(),
      changeOrderId: z.string(),
      companyId: z.string(),
      completedDate: z.string().nullable(),
      createdAt: z.string(),
      createdBy: z.string(),
      dueDate: z.string().nullable(),
      id: z.string(),
      name: z.string().nullable(),
      notes: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(z.unknown()),
            z.null()
          ])
        ),
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(z.unknown()),
            z.null()
          ])
        ),
        z.null()
      ]),
      sortOrder: z.number(),
      status: z.enum(["Completed", "In Progress", "Pending", "Skipped"]),
      tags: z.array(z.string()).nullable(),
      updatedAt: z.string().nullable(),
      updatedBy: z.string().nullable()
    })
  ),
  input: z.looseObject({ changeNoticeId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getChangeNoticeActions(
        ctx.asCaller.supabase,
        input.changeNoticeId as never,
        ctx.company.id
      )
    );
  }
});

export const updateChangeNoticeActionStatus = defineServiceFn({
  publish: true,
  title: "Update change notice action status",
  output: z.object({
    id: z.string()
  }),
  input: z.looseObject({
    id: z.string(),
    status: z.enum(["Pending", "In Progress", "Completed", "Skipped"])
  }),
  permission: { update: "parts" },
  async run(ctx, input) {
    const locked = await service.requireChangeNoticeChildEditable(
      ctx.asCaller.supabase,
      {
        table: "changeOrderActionTask",
        id: input.id,
        companyId: ctx.company.id,
        scope: "workflow"
      }
    );
    if (locked) return ctx.error("rule", locked.error.message);
    return unwrap(
      ctx,
      await service.updateChangeNoticeActionStatus(
        ctx.asCaller.supabase,
        payload(ctx, input).withUser().forUpdate() as never
      )
    );
  }
});

export const deleteChangeNoticeAction = defineServiceFn({
  publish: "destructive",
  title: "Delete change notice action",
  output: z.array(
    z.object({
      id: z.string()
    })
  ),
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    const locked = await service.requireChangeNoticeChildEditable(
      ctx.asCaller.supabase,
      {
        table: "changeOrderActionTask",
        id: input.id,
        companyId: ctx.company.id,
        scope: "workflow"
      }
    );
    if (locked) return ctx.error("rule", locked.error.message);
    return unwrap(
      ctx,
      await service.deleteChangeNoticeAction(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

export const updateChangeNoticeActionOrder = defineServiceFn({
  publish: true,
  title: "Update change notice action order",
  input: z.looseObject({
    changeNoticeId: z.string(),
    updates: z.array(z.looseObject({ id: z.string(), sortOrder: z.number() }))
  }),
  permission: { update: "parts" },
  async run(ctx, input) {
    const locked = await service.requireChangeNoticeEditable(
      ctx.asCaller.supabase,
      {
        changeNoticeId: input.changeNoticeId,
        companyId: ctx.company.id,
        scope: "workflow"
      }
    );
    if (locked) return ctx.error("rule", locked.error.message);
    return await service.updateChangeNoticeActionOrder(
      ctx.asSystem.pg,
      ctx.company.id,
      ctx.auditUserId,
      input.changeNoticeId as never,
      payload(ctx, input.updates).forUpdate() as never
    );
  }
});

export const getChangeNoticeRequiredActions = defineServiceFn({
  publish: "read",
  title: "Get change notice required actions",
  output: z
    .array(
      z.object({
        active: z.boolean(),
        companyId: z.string(),
        createdAt: z.string(),
        createdBy: z.string(),
        customFields: z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ]),
        id: z.string(),
        name: z.string(),
        updatedAt: z.string().nullable(),
        updatedBy: z.string().nullable()
      })
    )
    .nullable(),
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getChangeNoticeRequiredActions(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getChangeNoticeRequiredActionsList = defineServiceFn({
  publish: "read",
  title: "Get change notice required actions list",
  output: z.array(
    z.object({
      id: z.string(),
      name: z.string()
    })
  ),
  input: z.record(z.string(), z.unknown()),
  permission: { view: "parts" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getChangeNoticeRequiredActionsList(
        ctx.asCaller.supabase,
        ctx.company.id
      )
    );
  }
});

export const getChangeNoticeRequiredAction = defineServiceFn({
  publish: "read",
  title: "Get change notice required action",
  output: z.object({
    active: z.boolean(),
    companyId: z.string(),
    createdAt: z.string(),
    createdBy: z.string(),
    customFields: z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.record(
        z.string(),
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(z.string(), z.unknown()),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.array(
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      ),
      z.null()
    ]),
    id: z.string(),
    name: z.string(),
    updatedAt: z.string().nullable(),
    updatedBy: z.string().nullable()
  }),
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getChangeNoticeRequiredAction(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

export const upsertChangeNoticeRequiredAction = defineServiceFn({
  publish: true,
  title: "Upsert change notice required action",
  output: z.object({
    id: z.string()
  }),
  input: z.looseObject({
    id: z.string().optional(),
    name: z.string(),
    active: z.boolean()
  }),
  permission: { create: "parts", update: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertChangeNoticeRequiredAction(
        ctx.asCaller.supabase,
        payload(ctx, input).withUser().forUpsert() as never
      )
    );
  }
});

export const deleteChangeNoticeRequiredAction = defineServiceFn({
  publish: "destructive",
  title: "Delete change notice required action",
  output: z.array(
    z.object({
      id: z.string()
    })
  ),
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteChangeNoticeRequiredAction(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

export const setChangeNoticeActionTasks = defineServiceFn({
  publish: "destructive",
  title: "Set change notice action tasks",
  output: z.null(),
  input: z.looseObject({
    changeNoticeId: z.string(),
    requiredActionIds: z.array(z.string())
  }),
  permission: { update: "parts" },
  async run(ctx, input) {
    const locked = await service.requireChangeNoticeEditable(
      ctx.asCaller.supabase,
      {
        changeNoticeId: input.changeNoticeId,
        companyId: ctx.company.id,
        scope: "workflow"
      }
    );
    if (locked) return ctx.error("rule", locked.error.message);
    return unwrap(
      ctx,
      await service.setChangeNoticeActionTasks(
        ctx.asCaller.supabase,
        payload(ctx, input).withUser().forUpdate() as never
      )
    );
  }
});

export const getChangeNoticeDiff = defineServiceFn({
  publish: "read",
  title: "Get change notice diff",
  output: z.object({
    items: z.array(
      z.object({
        affectedItemId: z.string(),
        itemId: z.string(),
        materials: z.array(
          z.object({
            status: z.enum(["added", "modified", "removed", "unchanged"]),
            before: z.record(z.string(), z.unknown()).nullable(),
            after: z.record(z.string(), z.unknown()).nullable(),
            changedFields: z
              .record(
                z.string(),
                z.object({
                  before: z.unknown(),
                  after: z.unknown()
                })
              )
              .nullable()
              .optional()
          })
        ),
        operations: z.array(z.unknown()),
        attributes: z.array(
          z.object({
            status: z.enum(["added", "modified", "removed", "unchanged"]),
            before: z.record(z.string(), z.unknown()).nullable(),
            after: z.record(z.string(), z.unknown()).nullable(),
            changedFields: z
              .record(
                z.string(),
                z.object({
                  before: z.unknown(),
                  after: z.unknown()
                })
              )
              .nullable()
              .optional()
          })
        ),
        supplierParts: z.array(
          z.object({
            status: z.enum(["added", "modified", "removed", "unchanged"]),
            before: z.record(z.string(), z.unknown()).nullable(),
            after: z.record(z.string(), z.unknown()).nullable(),
            changedFields: z
              .record(
                z.string(),
                z.object({
                  before: z.unknown(),
                  after: z.unknown()
                })
              )
              .nullable()
              .optional()
          })
        )
      })
    )
  }),
  input: z.looseObject({ changeNoticeId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getChangeNoticeDiff(
        ctx.asCaller.supabase,
        input.changeNoticeId as never,
        ctx.company.id
      )
    );
  }
});

export const createItemDocumentUploadUrl = defineServiceFn({
  publish: true,
  title:
    "Create a presigned upload URL for an item (part/material/tool/consumable/service) document",
  output: z.object({
    signedUrl: z.string(),
    token: z.string(),
    path: z.string()
  }),
  input: z.looseObject({ itemId: z.string(), name: z.string() }),
  permission: { create: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.createItemDocumentUploadUrl(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});

export const createModelUploadUrl = defineServiceFn({
  publish: true,
  title: "Create a presigned upload URL for a CAD model",
  description: `First step of the two-step model upload: PUT the file bytes (STEP or another
supported format) to the returned \`signedUrl\`, then call \`insertModelUpload\`
with the returned \`modelId\`, \`path\` and the file's size in bytes. The file is
staged in the \`temp-staging\` bucket, as the browser upload does, so models up
to 2.5 GB are accepted.`,
  output: z.object({
    modelId: z.string(),
    path: z.string(),
    signedUrl: z.string(),
    token: z.string()
  }),
  input: z.object({ name: z.string().min(1) }),
  // A new model row is a parts create (its table's policy); linking it to a
  // record is an update.
  permission: { create: "parts", update: "parts" },
  async run(ctx, { name }) {
    return unwrap(
      ctx,
      // Signed as the system: the temp-staging bucket's storage policy needs a
      // user token, which an API key has none of. The gate above has checked
      // the caller, and the path is built here, in the caller's company.
      await service.createModelUploadUrl(ctx.asSystem.supabase, {
        companyId: ctx.company.id,
        name
      })
    );
  }
});

export const insertModelUpload = defineServiceFn({
  publish: true,
  title: "Record an uploaded CAD model and attach it",
  description: `Second step of the model upload, and what the browser's model dropzone calls.
Records the model staged at \`path\` (from \`createModelUploadUrl\`) and makes it
the model of each record named: an item, a job, a sales RFQ line, a quote line
and a sales order line. Every record is checked first, so a wrong id leaves no
model behind. With none, the model is only recorded; pass its id as
\`modelUploadId\` to a part or a job later. Starts the optimisation, which also
renders the thumbnail. Set \`convert\` for a STEP file whose assembly structure
is needed (assembly instructions, step slides); it runs only while the
assembler is up.`,
  output: z.object({
    modelUploadId: z.string()
  }),
  input: z.object({
    modelId: z.string().min(1),
    path: z.string().min(1),
    name: z.string().min(1),
    size: z.number().nonnegative(),
    itemId: z.string().optional(),
    jobId: z.string().optional(),
    salesRfqLineId: z.string().optional(),
    quoteLineId: z.string().optional(),
    salesOrderLineId: z.string().optional(),
    convert: z.boolean().optional()
  }),
  permission: { create: "parts", update: "parts" },
  async run(ctx, input) {
    if (!service.isModelUploadPath(ctx.company.id, input.modelId, input.path)) {
      return ctx.error("validation", "Invalid model path");
    }
    // Conversion is lazy by default: most models never become assemblies.
    const convert = !!input.convert && (await isAssemblerServiceHealthy());
    return unwrap(
      ctx,
      await service.insertModelUpload(ctx.asCaller.supabase, {
        ...input,
        convert,
        companyId: ctx.company.id,
        createdBy: ctx.auditUserId
      })
    );
  }
});

export const createItemThumbnailUploadUrl = defineServiceFn({
  publish: true,
  title: "Create a presigned upload URL for an item's thumbnail",
  description: `PUT the image (PNG, JPEG or WebP) to the returned \`signedUrl\`, then call
\`updateItemThumbnail\` with the returned \`path\`. An item's own thumbnail is
shown in place of the one rendered from its model.`,
  output: z.object({
    path: z.string(),
    signedUrl: z.string(),
    token: z.string()
  }),
  input: z.object({ itemId: z.string().min(1), name: z.string().min(1) }),
  permission: { update: "parts" },
  async run(ctx, input) {
    const owned = await refuseUnlessOwned(ctx, "item", { id: input.itemId });
    if (owned) return owned;
    return unwrap(
      ctx,
      await service.createItemThumbnailUploadUrl(ctx.asCaller.supabase, {
        ...input,
        companyId: ctx.company.id
      })
    );
  }
});

export const updateItemThumbnail = defineServiceFn({
  publish: true,
  title: "Set or clear an item's thumbnail",
  description: `Sets the thumbnail to an image uploaded with \`createItemThumbnailUploadUrl\`,
or clears it (\`thumbnailPath: null\`) to show the one rendered from the item's
model.`,
  output: rows.item
    .pick({ id: true, thumbnailPath: true })
    .meta({ table: "item" }),
  input: z.object({
    itemId: z.string().min(1),
    thumbnailPath: z.string().min(1).nullable()
  }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateItemThumbnail(ctx.asCaller.supabase, {
        ...input,
        companyId: ctx.company.id,
        updatedBy: ctx.auditUserId
      })
    );
  }
});
