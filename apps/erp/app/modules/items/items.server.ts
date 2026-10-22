// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { CarbonError, defineServiceFn } from "@carbon/api/service-fn.server";
import { paged, payload, unwrap } from "@carbon/api/service-tools.server";
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
import { datetime, isUniqueViolation, pluckUnique } from "@carbon/utils";
import { z } from "zod";
import { flattenTree } from "~/components/TreeView";
import { replanAfterItemChange } from "~/modules/production/production.server";
import { methodType, sourcingType } from "~/modules/shared/shared.models";
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

/**
 * Change items' tracking type.
 *
 * @remarks
 * Writes `itemTrackingType` on every item, then carries the serial and batch
 * flags onto the open jobs, receipts, shipments and stock transfers that copied
 * them (`cascadeItemTrackingType`). A failed carry-over leaves the items
 * changed and returns an error.
 *
 * @mcp
 */
export const setItemTrackingType = defineServiceFn({
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

/**
 * Change items' name, description, manufacturer part number or unit of measure.
 *
 * @remarks
 * A field left out is unchanged; every item gets the same value.
 *
 * @mcp
 */
export const setItemFields = defineServiceFn({
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

/**
 * Change items' replenishment system, default method type or sourcing type.
 *
 * @remarks
 * Exactly one of the three per call. They are interlocked
 * (`deriveItemMethodUpdate`): a concrete replenishment system sets the default
 * method type, a concrete method type sets the replenishment system, and a
 * sourcing type sets the method type. The item columns and their copies on
 * the items' Draft method materials change in one transaction
 * (`updateItemMethodAndSourcing`); Active and Archived methods are left alone.
 *
 * @mcp
 */
export const setItemSourcing = defineServiceFn({
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

/**
 * Activate or deactivate items.
 *
 * @remarks
 * Activating is refused while a change notice that created an item is not
 * released: release activates the revisions and parts a notice minted, and an
 * item switched on by hand would reach the pickers, MRP and job creation with
 * the notice's unapproved draft method. Deactivating is always allowed.
 *
 * @mcp
 */
export const setItemActive = defineServiceFn({
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

/**
 * Set items' item group (posting group).
 *
 * @remarks
 * The group lives on the item's cost row: it is updated where the item has
 * one, and a Standard cost row of zero is created where it has none. Null
 * clears the group.
 *
 * @mcp
 */
export const setItemPostingGroup = defineServiceFn({
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

const renumberedTable = {
  Part: "part",
  Consumable: "consumable",
  Material: "material",
  Tool: "tool"
} as const;

/**
 * Change the readable id (part number) of a part, consumable, material or tool.
 *
 * @remarks
 * Every revision of the item takes the new id, and so does its type row
 * (`part`, `consumable`, `material`, `tool`), which is keyed by it. Refused
 * when the item is not of `type`.
 *
 * @mcp
 */
export const setItemReadableId = defineServiceFn({
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

/**
 * Rename a service.
 *
 * @remarks
 * A service is identified by its name, so every revision's readable id and the
 * service row's id follow it (`updateServiceName`, one transaction). Refused
 * when the name is empty or another service already has it.
 *
 * @mcp
 */
export const renameService = defineServiceFn({
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

/**
 * Change materials' substance, shape, type, finish, grade or dimension.
 *
 * @remarks
 * For each material among `ids` (its revisions count once), the change goes
 * through `updateMaterialProperties`: dependent properties reset, each value
 * must fit the substance and shape, and generated material ids are renamed.
 * Each material commits on its own, so every material is tried and every
 * refusal is named. A field left out is unchanged; null clears it.
 *
 * @mcp
 */
export const setMaterialProperties = defineServiceFn({
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

/**
 * Create a part.
 *
 * @remarks
 * Writes the item and its part row, its item group and unit cost, batch size,
 * default storage unit and shelf life (`upsertPart`).
 *
 * @mcp
 */
export const createPart = defineServiceFn({
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

/**
 * Save a part's details.
 *
 * @remarks
 * `id` is the item id or the part number. A full replace: an optional field
 * left out is cleared (`upsertPart`), including the default storage unit and
 * shelf life.
 *
 * @mcp
 */
export const updatePart = defineServiceFn({
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

/**
 * Save a tool's details.
 *
 * @remarks
 * `id` is the item id or the tool number. A full replace: an optional field
 * left out is cleared (`upsertTool`).
 *
 * @mcp
 */
export const updateTool = defineServiceFn({
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

/**
 * Save an item's manufacturing settings, then re-plan it.
 *
 * @remarks
 * Batch size, scrap percentage, lead time and whether it must be configured.
 * MRP then re-plans the item, so the planning pages' suggestions follow the
 * new settings now rather than at the next scheduled run; a failed run does
 * not fail the save.
 *
 * @mcp
 */
export const updateItemManufacturing = defineServiceFn({
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

/**
 * Save an item's planning settings at a location, then re-plan it.
 *
 * @remarks
 * The reordering policy and its sizing parameters, the planning horizon and
 * the responsible employee. A full replace: an optional field left out is
 * cleared. The responsible employee must be an active employee of the
 * company. MRP then re-plans the item, so the planning pages' suggestions
 * follow the new settings now; a failed run does not fail the save.
 *
 * @mcp
 */
export const updateItemPlanning = defineServiceFn({
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

/**
 * Set or clear an item's supersession: the successor that replaces it and how
 * it is phased out.
 *
 * @remarks
 * Mode, successor, discontinuation and successor effectivity dates, and the
 * conversion factor (1 old = N new). No mode clears the supersession. With
 * `locationId`, also the minimum service-stock reserve at that location.
 * Refused (`rule`) when the successor would close a loop, or make a chain
 * longer than ten hops.
 *
 * @mcp destructive
 */
export const setItemSupersession = defineServiceFn({
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

/**
 * Make another part a predecessor of this one: the other part is phased out
 * in favour of `itemId`.
 *
 * @remarks
 * The supersession is written on the predecessor, with `itemId` as its
 * successor. Refused when the predecessor is the part itself, is not one of
 * the company's parts, already has a different successor (change it from that
 * part's planning page), or would close a loop.
 *
 * @mcp
 */
export const addItemPredecessor = defineServiceFn({
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
/**
 * Add a supplier part to an item: what the supplier calls it, and what it
 * costs.
 *
 * @remarks
 * The supplier's part number, unit of measure and conversion factor, minimum
 * order quantity, order multiple, and the price per purchase unit in
 * `currencyCode` (the base currency when empty). One supplier part per item
 * and supplier (`conflict`). `priceBreaks` are saved as Manual Entry price
 * breaks; a failed price break write is logged and does not undo the
 * supplier part.
 *
 * @mcp
 */
export const createSupplierPart = defineServiceFn({
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

/**
 * Save a supplier part.
 *
 * @remarks
 * A full replace of the supplier part's fields. One supplier part per item and
 * supplier (`conflict`). With `priceBreaks`, the supplier part's price breaks
 * are replaced by them as Manual Entry breaks, in one transaction; without,
 * they are left as they are.
 *
 * @mcp
 */
export const updateSupplierPart = defineServiceFn({
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
/**
 * Copy one make method onto another: Get Method and Save Method.
 *
 * @remarks
 * `sourceId` and `targetId` are items (their active method) or make method
 * versions (`make_` ids). The target's bill of materials, bill of process,
 * parameters, tools, steps and work instructions are replaced by the source's,
 * each as its flag says (get-method). Refused when the target's revision is
 * released and release control enforces it, or a change notice holds it; with
 * release control on warn the copy goes ahead and `notice` says why it would
 * have been held.
 *
 * @mcp destructive
 */
export const copyMethod = defineServiceFn({
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

/**
 * Create a new Draft version of an item's make method, copied from one of its
 * versions.
 *
 * @remarks
 * The new version takes `copyFromId`'s header and, through get-method, its
 * whole bill of materials and process. `activeVersionId` is made Active first
 * (the item's only version, when its successor is drafted). With strict
 * backflush on, that activation is refused while a pulled line has no Pull
 * From storage unit, as `methodVersionToActive` refuses it.
 *
 * @mcp
 */
export const createMethodVersion = defineServiceFn({
  input: makeMethodVersionValidator,
  permission: { create: "parts" },

  async run(ctx, input) {
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    if (input.activeVersionId) {
      const db = ctx.asSystem.pg;
      const { strict } = await getStrictBackflushSettings(db, companyId);
      if (strict) {
        const parts = await getMethodPartsMissingPullFrom(db, {
          makeMethodId: input.activeVersionId,
          companyId
        });
        if (parts.length > 0) {
          return ctx.error("rule", activationRefusalMessage(parts));
        }
      }
    }
    const insert = await service.upsertMakeMethodVersion(
      ctx.asCaller.supabase,
      {
        ...input,
        companyId,
        createdBy: userId
      }
    );
    const version = insert.data;
    if (insert.error || !version?.id || !version.type || !version.itemId) {
      return ctx.error(
        "internal",
        "Failed to insert new version",
        insert.error
      );
    }

    const copy = await service.copyMakeMethod(
      ctx.asSystem.supabase,
      ctx.asSystem.pg,
      {
        sourceId: input.copyFromId,
        targetId: version.id,
        billOfMaterial: true,
        billOfProcess: true,
        parameters: true,
        tools: true,
        steps: true,
        workInstructions: true,
        companyId,
        userId
      }
    );
    if (copy.error) {
      return ctx.error("internal", "Failed to copy make method", copy.error);
    }
    return { id: version.id, itemId: version.itemId, type: version.type };
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

/**
 * Delete an operation from a make method's bill of process.
 *
 * @remarks
 * Refused when the method's revision is released and release control enforces
 * it, or a change notice holds it; with release control on warn the delete
 * goes ahead and `notice` says why it would have been held.
 *
 * @mcp destructive
 */
export const deleteMethodOperation = defineServiceFn({
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

    const deleted = await client
      .from("methodOperation")
      .delete()
      .eq("id", id)
      .eq("companyId", companyId);
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

/**
 * Recalculate a made item's unit cost from its make method.
 *
 * @remarks
 * Rolls up the active make method (or the newest Draft) and every sub-method:
 * material costs, and each operation's setup, labor, machine and overhead at
 * its work center's rates (or the rates of the work centers that run its
 * process), spread over each item's batch size, as the bill of materials CSV
 * export does. Overwrites the item's unit cost with the result.
 *
 * @mcp
 */
export const recalculateItemCost = defineServiceFn({
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
/**
 * Create a change notice, with the parts it changes.
 *
 * @remarks
 * The number comes from the change notice sequence unless `changeOrderId` is
 * given; the open date defaults to today in the company's timezone. Each of
 * `affectedItemIds` that is one of the company's parts is added as a Version
 * change (`addChangeNoticeAffectedItem`, which makes a bought part a Revision
 * and creates the notice's draft method). Anything that is not a part is
 * skipped. The notice stays when an item cannot be added: `warning` says so.
 *
 * @mcp
 */
export const createChangeNotice = defineServiceFn({
  input: changeNoticeValidator.omit({ id: true, type: true }).extend({
    openDate: z.string().optional(),
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
      reasonForChange: service.toRichText(input.reasonForChange),
      description: service.toRichText(input.description),
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

/**
 * Create a change notice for one item.
 *
 * @remarks
 * Named "Change for" the item, opened today in the company's timezone, with
 * the item as its first affected item (`addChangeNoticeAffectedItem`, a
 * Version change unless `changeType` says otherwise; `revision` names a
 * Revision's new revision). The notice stays when the item cannot be added:
 * `warning` says so.
 *
 * @mcp
 */
export const createChangeNoticeForItem = defineServiceFn({
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

/**
 * Move a change notice to another stage.
 *
 * @remarks
 * `fromStatus` is the stage the caller saw: the move is a compare-and-swap on
 * it, and only the transitions `changeNoticeStatusTransitions` allows are
 * taken. With an approval rule, Engineering Complete → Implementation opens an
 * approval request and notifies the approvers instead of moving
 * (`approvalRequested`); approving it moves the notice. Implementation → Done
 * is the release (`applyChangeNotice`): it activates each affected item's
 * draft method, reveals new revisions and parts, and writes their
 * supersessions. Cancelling, or advancing past the gate after the rule was
 * turned off, withdraws a pending request. Entering Start, Implementation or
 * Done notifies the assignee and the action-task assignees.
 *
 * @mcp
 */
export const setChangeNoticeStatus = defineServiceFn({
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

/**
 * Approve or reject a change notice's pending approval request.
 *
 * @remarks
 * Approving moves the notice from Engineering Complete to Implementation, in
 * the decision's transaction, and notifies the notice's assignee and
 * action-task assignees as an advance would. Rejecting leaves the stage. The
 * requester is told either way, unless they decided it themselves.
 *
 * @mcp
 */
export const decideChangeNoticeApproval = defineServiceFn({
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
/**
 * Activate method version
 *
 * @mcp
 */
export const activateMethodVersion = defineServiceFn({
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

/**
 * Create revision
 *
 * @mcp
 */
export const createRevision = defineServiceFn({
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

/**
 * Delete configuration parameter
 *
 * @mcp destructive
 */
export const deleteConfigurationParameter = defineServiceFn({
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

/**
 * Delete configuration rule
 *
 * @mcp destructive
 */
export const deleteConfigurationRule = defineServiceFn({
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

/**
 * Delete item customer part
 *
 * @mcp destructive
 */
export const deleteItemCustomerPart = defineServiceFn({
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

/**
 * Delete supplier part
 *
 * @mcp destructive
 */
export const deleteSupplierPart = defineServiceFn({
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

/**
 * Delete configuration parameter group
 *
 * @mcp destructive
 */
export const deleteConfigurationParameterGroup = defineServiceFn({
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

/**
 * Delete item
 *
 * @mcp destructive
 */
export const deleteItem = defineServiceFn({
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

/**
 * Delete item posting group
 *
 * @mcp destructive
 */
export const deleteItemPostingGroup = defineServiceFn({
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

/**
 * Delete material dimension
 *
 * @mcp destructive
 */
export const deleteMaterialDimension = defineServiceFn({
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

/**
 * Delete material finish
 *
 * @mcp destructive
 */
export const deleteMaterialFinish = defineServiceFn({
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

/**
 * Delete material form
 *
 * @mcp destructive
 */
export const deleteMaterialForm = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteMaterialForm(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Delete material grade
 *
 * @mcp destructive
 */
export const deleteMaterialGrade = defineServiceFn({
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

/**
 * Delete material substance
 *
 * @mcp destructive
 */
export const deleteMaterialSubstance = defineServiceFn({
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

/**
 * Delete method material
 *
 * @mcp destructive
 */
export const deleteMethodMaterial = defineServiceFn({
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

/**
 * Assert method operation is draft
 *
 * @mcp
 */
export const assertMethodOperationIsDraft = defineServiceFn({
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

/**
 * Delete method operation step
 *
 * @mcp destructive
 */
export const deleteMethodOperationStep = defineServiceFn({
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

/**
 * Delete method operation step slide
 *
 * @mcp destructive
 */
export const deleteMethodOperationStepSlide = defineServiceFn({
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

/**
 * Delete method operation parameter
 *
 * @mcp destructive
 */
export const deleteMethodOperationParameter = defineServiceFn({
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

/**
 * Delete method operation tool
 *
 * @mcp destructive
 */
export const deleteMethodOperationTool = defineServiceFn({
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

/**
 * Delete unit of measure
 *
 * @mcp destructive
 */
export const deleteUnitOfMeasure = defineServiceFn({
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

/**
 * Get configuration parameters
 *
 * @mcp read
 */
export const getConfigurationParameters = defineServiceFn({
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

/**
 * Get configuration rules
 *
 * @mcp read
 */
export const getConfigurationRules = defineServiceFn({
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

/**
 * Get consumable
 *
 * @mcp read
 */
export const getConsumable = defineServiceFn({
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

/**
 * Get consumables
 *
 * @mcp read
 */
export const getConsumables = defineServiceFn({
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

/**
 * Get item
 *
 * @mcp read
 */
export const getItem = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getItem(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get item cost
 *
 * @mcp read
 */
export const getItemCost = defineServiceFn({
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

/**
 * Get item cost history
 *
 * @mcp read
 */
export const getItemCostHistory = defineServiceFn({
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

/**
 * Get item customer part
 *
 * @mcp read
 */
export const getItemCustomerPart = defineServiceFn({
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

/**
 * Get item customer parts
 *
 * @mcp read
 */
export const getItemCustomerParts = defineServiceFn({
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

/**
 * Get item demand
 *
 * @mcp read
 */
export const getItemDemand = defineServiceFn({
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

/**
 * Get demand forecast sources
 *
 * @mcp read
 */
export const getDemandForecastSources = defineServiceFn({
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

/**
 * Get item files
 *
 * @mcp read
 */
export const getItemFiles = defineServiceFn({
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

/**
 * Get item posting group
 *
 * @mcp read
 */
export const getItemPostingGroup = defineServiceFn({
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

/**
 * Get item posting groups
 *
 * @mcp read
 */
export const getItemPostingGroups = defineServiceFn({
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

/**
 * Get item posting groups list
 *
 * @mcp read
 */
export const getItemPostingGroupsList = defineServiceFn({
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

/**
 * Get item manufacturing
 *
 * @mcp read
 */
export const getItemManufacturing = defineServiceFn({
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

/**
 * Get item planning
 *
 * @mcp read
 */
export const getItemPlanning = defineServiceFn({
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

/**
 * Get item quantities
 *
 * @mcp read
 */
export const getItemQuantities = defineServiceFn({
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

/**
 * On-hand quantity per item for the Item picker's badge, as a plain map
 *
 * @mcp read
 */
export const getItemStockQuantitiesByLocation = defineServiceFn({
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

/**
 * Get item replenishment
 *
 * @mcp read
 */
export const getItemReplenishment = defineServiceFn({
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

/**
 * Get item supersession
 *
 * @mcp read
 */
export const getItemSupersession = defineServiceFn({
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

/**
 * Get item supersessions for items
 *
 * @mcp read
 */
export const getItemSupersessionsForItems = defineServiceFn({
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

/**
 * Get supersession chain
 *
 * @mcp read
 */
export const getSupersessionChain = defineServiceFn({
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

/**
 * Get item storage unit quantities
 *
 * @mcp read
 */
export const getItemStorageUnitQuantities = defineServiceFn({
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

/**
 * Get item unit sale price
 *
 * @mcp read
 */
export const getItemUnitSalePrice = defineServiceFn({
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

/**
 * Where a material or consumable is used
 *
 * @mcp read
 */
export const getMaterialUsedIn = defineServiceFn({
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

/**
 * Get make methods
 *
 * @mcp read
 */
export const getMakeMethods = defineServiceFn({
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

/**
 * Get make method by id
 *
 * @mcp read
 */
export const getMakeMethodById = defineServiceFn({
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

/**
 * Get material
 *
 * @mcp read
 */
export const getMaterial = defineServiceFn({
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

/**
 * Get materials
 *
 * @mcp read
 */
export const getMaterials = defineServiceFn({
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

/**
 * Get material dimension
 *
 * @mcp read
 */
export const getMaterialDimension = defineServiceFn({
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

/**
 * Get material dimensions
 *
 * @mcp read
 */
export const getMaterialDimensions = defineServiceFn({
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

/**
 * Get material dimension list
 *
 * @mcp read
 */
export const getMaterialDimensionList = defineServiceFn({
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

/**
 * Get material finish
 *
 * @mcp read
 */
export const getMaterialFinish = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getMaterialFinish(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get material finishes
 *
 * @mcp read
 */
export const getMaterialFinishes = defineServiceFn({
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

/**
 * Get material finish list
 *
 * @mcp read
 */
export const getMaterialFinishList = defineServiceFn({
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

/**
 * Get material form
 *
 * @mcp read
 */
export const getMaterialForm = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getMaterialForm(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get material forms
 *
 * @mcp read
 */
export const getMaterialForms = defineServiceFn({
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

/**
 * Get material forms list
 *
 * @mcp read
 */
export const getMaterialFormsList = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "parts" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getMaterialFormsList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get material grades
 *
 * @mcp read
 */
export const getMaterialGrades = defineServiceFn({
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

/**
 * Get material grade
 *
 * @mcp read
 */
export const getMaterialGrade = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getMaterialGrade(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get material grade list
 *
 * @mcp read
 */
export const getMaterialGradeList = defineServiceFn({
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

/**
 * Get material substance
 *
 * @mcp read
 */
export const getMaterialSubstance = defineServiceFn({
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

/**
 * Get material substances
 *
 * @mcp read
 */
export const getMaterialSubstances = defineServiceFn({
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

/**
 * Get material substances list
 *
 * @mcp read
 */
export const getMaterialSubstancesList = defineServiceFn({
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

/**
 * Get method materials
 *
 * @mcp read
 */
export const getMethodMaterials = defineServiceFn({
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

/**
 * Get method materials by make method
 *
 * @mcp read
 */
export const getMethodMaterialsByMakeMethod = defineServiceFn({
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

/**
 * Get method operations
 *
 * @mcp read
 */
export const getMethodOperations = defineServiceFn({
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

/**
 * Get method operations by make method id
 *
 * @mcp read
 */
export const getMethodOperationsByMakeMethodId = defineServiceFn({
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

/**
 * Get method tree
 *
 * @mcp read
 */
export const getMethodTree = defineServiceFn({
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

/**
 * Get bom item attributes
 *
 * @mcp read
 */
export const getBomItemAttributes = defineServiceFn({
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

/**
 * Get open job materials
 *
 * @mcp read
 */
export const getOpenJobMaterials = defineServiceFn({
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

/**
 * Get open production orders
 *
 * @mcp read
 */
export const getOpenProductionOrders = defineServiceFn({
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

/**
 * Get open purchase order lines
 *
 * @mcp read
 */
export const getOpenPurchaseOrderLines = defineServiceFn({
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

/**
 * Get open sales order lines
 *
 * @mcp read
 */
export const getOpenSalesOrderLines = defineServiceFn({
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

/**
 * Get part
 *
 * @mcp read
 */
export const getPart = defineServiceFn({
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

/**
 * Get parts
 *
 * @mcp read
 */
export const getParts = defineServiceFn({
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

/**
 * Get item mpns list
 *
 * @mcp read
 */
export const getItemMpnsList = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "parts" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getItemMpnsList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get parts list
 *
 * @mcp read
 */
export const getPartsList = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "parts" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getPartsList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Where a part, tool or service is used
 *
 * @mcp read
 */
export const getPartUsedIn = defineServiceFn({
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

/**
 * Get pick method
 *
 * @mcp read
 */
export const getPickMethod = defineServiceFn({
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

/**
 * Get pick methods
 *
 * @mcp read
 */
export const getPickMethods = defineServiceFn({
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

/**
 * Get services
 *
 * @mcp read
 */
export const getServices = defineServiceFn({
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

/**
 * Get service
 *
 * @mcp read
 */
export const getService = defineServiceFn({
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

/**
 * Get services list
 *
 * @mcp read
 */
export const getServicesList = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "parts" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getServicesList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get supplier parts
 *
 * @mcp read
 */
export const getSupplierParts = defineServiceFn({
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

/**
 * Get supplier parts by supplier
 *
 * @mcp read
 */
export const getSupplierPartsBySupplier = defineServiceFn({
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

/**
 * Get tool
 *
 * @mcp read
 */
export const getTool = defineServiceFn({
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

/**
 * Get tools
 *
 * @mcp read
 */
export const getTools = defineServiceFn({
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

/**
 * Get unit of measure
 *
 * @mcp read
 */
export const getUnitOfMeasure = defineServiceFn({
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

/**
 * Which tables still reference a unit of measure, and how many rows each; empty means safe to delete (or id not visible to the caller)
 *
 * @mcp read
 */
export const getUnitOfMeasureUsage = defineServiceFn({
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

/**
 * Get unit of measures
 *
 * @mcp read
 */
export const getUnitOfMeasures = defineServiceFn({
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

/**
 * Get unit of measures list
 *
 * @mcp read
 */
export const getUnitOfMeasuresList = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "parts" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getUnitOfMeasuresList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Update configuration parameter group order
 *
 * @mcp
 */
export const updateConfigurationParameterGroupOrder = defineServiceFn({
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

/**
 * Update default revision
 *
 * @mcp
 */
export const updateDefaultRevision = defineServiceFn({
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

/**
 * Update configuration parameter order
 *
 * @mcp
 */
export const updateConfigurationParameterOrder = defineServiceFn({
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

/**
 * Update item cost
 *
 * @mcp
 */
export const updateItemCost = defineServiceFn({
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

/**
 * Update material order
 *
 * @mcp
 */
export const updateMaterialOrder = defineServiceFn({
  input: z.looseObject({
    updates: z.array(z.looseObject({ id: z.string(), order: z.number() }))
  }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return service.reorderMethodRows(ctx, "methodMaterial", input.updates);
  }
});

/**
 * Update operation order
 *
 * @mcp
 */
export const updateOperationOrder = defineServiceFn({
  input: z.looseObject({
    updates: z.array(z.looseObject({ id: z.string(), order: z.number() }))
  }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return service.reorderMethodRows(ctx, "methodOperation", input.updates);
  }
});

/**
 * Update revision
 *
 * @mcp
 */
export const updateRevision = defineServiceFn({
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

/**
 * Upsert configuration parameter
 *
 * @mcp
 */
export const upsertConfigurationParameter = defineServiceFn({
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

/**
 * Upsert configuration parameter group
 *
 * @mcp
 */
export const upsertConfigurationParameterGroup = defineServiceFn({
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

/**
 * Upsert configuration rule
 *
 * @mcp
 */
export const upsertConfigurationRule = defineServiceFn({
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

/**
 * Return the distinct processIds referenced by methodOperation rows on the item's active makeMethod
 *
 * @mcp read
 */
export const getRecipeProcessIdsForItem = defineServiceFn({
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

/**
 * Fetch the shelf-life policy for an item
 *
 * @mcp read
 */
export const getItemShelfLife = defineServiceFn({
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

/**
 * Returns true when the item's active make-method has at least one BOM input with a managed shelf-life policy
 *
 * @mcp read
 */
export const getBomHasShelfLifeManagedInput = defineServiceFn({
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

/**
 * Atomic counterpart to {@link upsertPickMethod} + {@link upsertItemShelfLife}
 *
 * @mcp destructive
 */
export const upsertPickMethodWithShelfLife = defineServiceFn({
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

/**
 * Create a consumable
 *
 * @remarks
 * Creates a consumable (item row and consumable row) or updates one; on update `id` is the item id (uuid) or the consumable's readable id and the write is a full…
 *
 * @mcp
 */
export const createConsumable = defineServiceFn({
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

/**
 * Update a consumable
 *
 * @remarks
 * Creates a consumable (item row and consumable row) or updates one; on update `id` is the item id (uuid) or the consumable's readable id and the write is a full…
 *
 * @mcp
 */
export const updateConsumable = defineServiceFn({
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

/**
 * Resolve extracted document line text to an item id: first through the
 * party's part mapping (customer part or supplier part), then by an exact
 * match on the item's readable id or name. Null when nothing matches.
 *
 * @mcp
 */
export const resolveItemIdFromExtractedText = defineServiceFn({
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

/**
 * Update item
 *
 * @mcp
 */
export const updateItem = defineServiceFn({
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

/**
 * Upsert item cost
 *
 * @mcp
 */
export const upsertItemCost = defineServiceFn({
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

/**
 * Create a pick method
 *
 * @remarks
 * Upsert pick method
 *
 * @mcp
 */
export const createPickMethod = defineServiceFn({
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

/**
 * Update a pick method
 *
 * @remarks
 * Upsert pick method
 *
 * @mcp
 */
export const updatePickMethod = defineServiceFn({
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

/**
 * Upsert item purchasing
 *
 * @mcp
 */
export const upsertItemPurchasing = defineServiceFn({
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

/**
 * Create a item posting group
 *
 * @remarks
 * Upsert item posting group
 *
 * @mcp
 */
export const createItemPostingGroup = defineServiceFn({
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

/**
 * Update a item posting group
 *
 * @remarks
 * Upsert item posting group
 *
 * @mcp
 */
export const updateItemPostingGroup = defineServiceFn({
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

/**
 * Upsert item customer part
 *
 * @mcp
 */
export const upsertItemCustomerPart = defineServiceFn({
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

/**
 * Upsert item unit sale price
 *
 * @mcp
 */
export const upsertItemUnitSalePrice = defineServiceFn({
  input: z.looseObject({
    itemId: z.string().min(1),
    unitSalePrice: z.number().min(0),
    customFields: z.unknown().optional()
  }),
  permission: { create: "parts", update: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertItemUnitSalePrice(
        ctx.asCaller.supabase,
        payload(ctx, input).withoutCompany().forUpdate() as never
      )
    );
  }
});

/**
 * Create a method material
 *
 * @remarks
 * Upsert method material
 *
 * @mcp
 */
export const createMethodMaterial = defineServiceFn({
  input: z.looseObject({
    id: z
      .string()
      .describe(
        "Updates the existing record with this key; creates one when there is none."
      ),
    makeMethodId: z.string().min(1),
    order: z.number().min(0),
    itemType: z.enum(["Part", "Material", "Consumable"]),
    kit: z.enum(["true", "false"]).optional(),
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

/**
 * Update a method material
 *
 * @remarks
 * Upsert method material
 *
 * @mcp
 */
export const updateMethodMaterial = defineServiceFn({
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
      kit: z.enum(["true", "false"]).optional(),
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

/**
 * Create a method operation
 *
 * @remarks
 * Upsert method operation
 *
 * @mcp
 */
export const createMethodOperation = defineServiceFn({
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

/**
 * Update a method operation
 *
 * @remarks
 * Upsert method operation
 *
 * @mcp
 */
export const updateMethodOperation = defineServiceFn({
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

/**
 * Set the work instruction of a method operation.
 *
 * @remarks
 * Replaces the operation's work instruction; the rest of the operation is
 * unchanged. Only a Draft method version can change, and the revision's
 * release lock applies, as in the bill of process editor.
 *
 * @param id - The method operation's id.
 * @param text - The work instruction as Markdown: headings, **bold**,
 *   _italic_, lists, links, quotes and code. Empty text clears it.
 *
 * @mcp
 */
export const setMethodOperationWorkInstruction = defineServiceFn({
  input: z.object({ id: z.string().min(1), text: z.string() }),
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

/**
 * Create a method operation step
 *
 * @remarks
 * Upsert method operation step
 *
 * @mcp
 */
export const createMethodOperationStep = defineServiceFn({
  input: z.looseObject({
    operationId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
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

/**
 * Update a method operation step
 *
 * @remarks
 * Upsert method operation step
 *
 * @mcp
 */
export const updateMethodOperationStep = defineServiceFn({
  input: z
    .looseObject({
      operationId: z.string().min(1),
      name: z.string().min(1),
      description: z.string().min(1),
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

/**
 * Duplicate method operation step
 *
 * @mcp
 */
export const duplicateMethodOperationStep = defineServiceFn({
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

/**
 * Create a method operation step slide
 *
 * @remarks
 * Upsert method operation step slide
 *
 * @mcp
 */
export const createMethodOperationStepSlide = defineServiceFn({
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

/**
 * Update a method operation step slide
 *
 * @remarks
 * Upsert method operation step slide
 *
 * @mcp
 */
export const updateMethodOperationStepSlide = defineServiceFn({
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

/**
 * Create a method operation parameter
 *
 * @remarks
 * Upsert method operation parameter
 *
 * @mcp
 */
export const createMethodOperationParameter = defineServiceFn({
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

/**
 * Update a method operation parameter
 *
 * @remarks
 * Upsert method operation parameter
 *
 * @mcp
 */
export const updateMethodOperationParameter = defineServiceFn({
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

/**
 * Create a method operation tool
 *
 * @remarks
 * Upsert method operation tool
 *
 * @mcp
 */
export const createMethodOperationTool = defineServiceFn({
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

/**
 * Update a method operation tool
 *
 * @remarks
 * Upsert method operation tool
 *
 * @mcp
 */
export const updateMethodOperationTool = defineServiceFn({
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

/**
 * Set method material step link
 *
 * @mcp destructive
 */
export const setMethodMaterialStepLink = defineServiceFn({
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

/**
 * Set method operation tool step link
 *
 * @mcp destructive
 */
export const setMethodOperationToolStepLink = defineServiceFn({
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

/**
 * Create a material
 *
 * @remarks
 * Creates a material or updates one by item id or readable id; an update keeps any optional field it leaves out, and `sizes` adds a revision per new size
 *
 * @mcp
 */
export const createMaterial = defineServiceFn({
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

/**
 * Update a material
 *
 * @remarks
 * Creates a material or updates one by item id or readable id; an update keeps any optional field it leaves out, and `sizes` adds a revision per new size
 *
 * @mcp
 */
export const updateMaterial = defineServiceFn({
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

/**
 * Creates a dimension (a named size) for a material shape, or updates the one whose `id` is sent; a new dimension's id is generated
 *
 * @mcp
 */
export const upsertMaterialDimension = defineServiceFn({
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

/**
 * Creates a finish for a material substance, or updates the one whose `id` is sent; a new finish's id is generated
 *
 * @mcp
 */
export const upsertMaterialFinish = defineServiceFn({
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

/**
 * Create a material form
 *
 * @remarks
 * Upsert material form
 *
 * @mcp
 */
export const createMaterialForm = defineServiceFn({
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

/**
 * Update a material form
 *
 * @remarks
 * Upsert material form
 *
 * @mcp
 */
export const updateMaterialForm = defineServiceFn({
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

/**
 * Creates a grade for a material substance, or updates the one whose `id` is sent; a new grade's id is generated
 *
 * @mcp
 */
export const upsertMaterialGrade = defineServiceFn({
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

/**
 * Delete material type
 *
 * @mcp destructive
 */
export const deleteMaterialType = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteMaterialType(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get material types
 *
 * @mcp read
 */
export const getMaterialTypes = defineServiceFn({
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

/**
 * Get material type
 *
 * @mcp read
 */
export const getMaterialType = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getMaterialType(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get material type list
 *
 * @mcp read
 */
export const getMaterialTypeList = defineServiceFn({
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

/**
 * Creates a material type for a substance and shape pair, or updates the one whose `id` is sent; a new type's id is generated
 *
 * @mcp
 */
export const upsertMaterialType = defineServiceFn({
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

/**
 * Create a material substance
 *
 * @remarks
 * Upsert material substance
 *
 * @mcp
 */
export const createMaterialSubstance = defineServiceFn({
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

/**
 * Update a material substance
 *
 * @remarks
 * Upsert material substance
 *
 * @mcp
 */
export const updateMaterialSubstance = defineServiceFn({
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

/**
 * Create a service
 *
 * @remarks
 * Creates a service (item row and service row) or updates one
 *
 * @mcp
 */
export const createService = defineServiceFn({
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

/**
 * Update a service
 *
 * @remarks
 * Creates a service (item row and service row) or updates one
 *
 * @mcp
 */
export const updateService = defineServiceFn({
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

/**
 * Create a unit of measure
 *
 * @remarks
 * Upsert unit of measure
 *
 * @mcp
 */
export const createUnitOfMeasure = defineServiceFn({
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

/**
 * Update a unit of measure
 *
 * @remarks
 * Upsert unit of measure
 *
 * @mcp
 */
export const updateUnitOfMeasure = defineServiceFn({
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

/**
 * Create a tool
 *
 * @remarks
 * Creates a tool (item row and tool row) or updates one; on update `id` is the item id (uuid) or the tool's readable id and the write is a full replace, so omitt…
 *
 * @mcp
 */
export const createTool = defineServiceFn({
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

/**
 * Batch pre-fetch supplier pricing for multiple items, for costing
 *
 * @mcp read
 */
export const getSupplierPriceBreaksForItems = defineServiceFn({
  input: z.looseObject({ itemIds: z.array(z.string()) }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return await utils.getSupplierPriceBreaksForItems(
      ctx.asCaller.supabase,
      payload(ctx, input.itemIds).build() as never
    );
  }
});

/**
 * Get change notice
 *
 * @mcp read
 */
export const getChangeNotice = defineServiceFn({
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

/**
 * Get change notices
 *
 * @mcp read
 */
export const getChangeNotices = defineServiceFn({
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

/**
 * Update change notice
 *
 * @mcp
 */
export const updateChangeNotice = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    changeOrderId: z.string().optional(),
    name: z.string().optional(),
    type: z.enum(["Engineering", "Manufacturing", "Documentation"]).optional(),
    priority: z.string().nullable().optional(),
    changeOrderTypeId: z.string().nullable().optional(),
    nonConformanceId: z.string().nullable().optional(),
    openDate: z.string().optional(),
    reasonForChange: z.unknown().optional(),
    description: z.unknown().optional(),
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

/**
 * Delete change notice
 *
 * @mcp destructive
 */
export const deleteChangeNotice = defineServiceFn({
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

/**
 * Get change notice types
 *
 * @mcp read
 */
export const getChangeNoticeTypes = defineServiceFn({
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

/**
 * Get change notice types list
 *
 * @mcp read
 */
export const getChangeNoticeTypesList = defineServiceFn({
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

/**
 * Get change notice type
 *
 * @mcp read
 */
export const getChangeNoticeType = defineServiceFn({
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

/**
 * Create a change notice type
 *
 * @remarks
 * Upsert change notice type
 *
 * @mcp
 */
export const createChangeNoticeType = defineServiceFn({
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

/**
 * Update a change notice type
 *
 * @remarks
 * Upsert change notice type
 *
 * @mcp
 */
export const updateChangeNoticeType = defineServiceFn({
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

/**
 * Delete change notice type
 *
 * @mcp destructive
 */
export const deleteChangeNoticeType = defineServiceFn({
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

/**
 * Add change notice affected item
 *
 * @mcp destructive
 */
export const addChangeNoticeAffectedItem = defineServiceFn({
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

/**
 * Update change notice affected item change type
 *
 * @mcp
 */
export const updateChangeNoticeAffectedItemChangeType = defineServiceFn({
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

/**
 * Update change notice affected item cutover
 *
 * @mcp
 */
export const updateChangeNoticeAffectedItemCutover = defineServiceFn({
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

/**
 * Get change notice affected items
 *
 * @mcp read
 */
export const getChangeNoticeAffectedItems = defineServiceFn({
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

/**
 * Remove change notice affected item
 *
 * @mcp destructive
 */
export const removeChangeNoticeAffectedItem = defineServiceFn({
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

/**
 * Get change notices for non conformance
 *
 * @mcp read
 */
export const getChangeNoticesForNonConformance = defineServiceFn({
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

/**
 * Get change notice actions
 *
 * @mcp read
 */
export const getChangeNoticeActions = defineServiceFn({
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

/**
 * Update change notice action status
 *
 * @mcp
 */
export const updateChangeNoticeActionStatus = defineServiceFn({
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

/**
 * Delete change notice action
 *
 * @mcp destructive
 */
export const deleteChangeNoticeAction = defineServiceFn({
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

/**
 * Update change notice action order
 *
 * @mcp
 */
export const updateChangeNoticeActionOrder = defineServiceFn({
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

/**
 * Get change notice required actions
 *
 * @mcp read
 */
export const getChangeNoticeRequiredActions = defineServiceFn({
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

/**
 * Get change notice required actions list
 *
 * @mcp read
 */
export const getChangeNoticeRequiredActionsList = defineServiceFn({
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

/**
 * Get change notice required action
 *
 * @mcp read
 */
export const getChangeNoticeRequiredAction = defineServiceFn({
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

/**
 * Upsert change notice required action
 *
 * @mcp
 */
export const upsertChangeNoticeRequiredAction = defineServiceFn({
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

/**
 * Delete change notice required action
 *
 * @mcp destructive
 */
export const deleteChangeNoticeRequiredAction = defineServiceFn({
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

/**
 * Set change notice action tasks
 *
 * @mcp destructive
 */
export const setChangeNoticeActionTasks = defineServiceFn({
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

/**
 * Get change notice diff
 *
 * @mcp read
 */
export const getChangeNoticeDiff = defineServiceFn({
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

/**
 * Create a presigned upload URL for an item (part/material/tool/consumable/service) document
 *
 * @mcp
 */
export const createItemDocumentUploadUrl = defineServiceFn({
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

/**
 * Create a presigned upload URL for a CAD model
 *
 * @remarks
 * First step of the two-step model upload: PUT the file bytes (STEP or another
 * supported format) to the returned `signedUrl`, then call `insertModelUpload`
 * with the returned `modelId`, `path` and the file's size in bytes. The file is
 * staged in the `temp-staging` bucket, as the browser upload does, so models up
 * to 2.5 GB are accepted.
 *
 * @mcp
 */
export const createModelUploadUrl = defineServiceFn({
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

/**
 * Record an uploaded CAD model and attach it
 *
 * @remarks
 * Second step of the model upload, and what the browser's model dropzone calls.
 * Records the model staged at `path` (from `createModelUploadUrl`) and makes it
 * the model of each record named: an item, a job, a sales RFQ line, a quote line
 * and a sales order line. Every record is checked first, so a wrong id leaves no
 * model behind. With none, the model is only recorded; pass its id as
 * `modelUploadId` to a part or a job later. Starts the optimisation, which also
 * renders the thumbnail. Set `convert` for a STEP file whose assembly structure
 * is needed (assembly instructions, step slides); it runs only while the
 * assembler is up.
 *
 * @mcp
 */
export const insertModelUpload = defineServiceFn({
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

/**
 * Create a presigned upload URL for an item's thumbnail
 *
 * @remarks
 * PUT the image (PNG, JPEG or WebP) to the returned `signedUrl`, then call
 * `updateItemThumbnail` with the returned `path`. An item's own thumbnail is
 * shown in place of the one rendered from its model.
 *
 * @mcp
 */
export const createItemThumbnailUploadUrl = defineServiceFn({
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

/**
 * Set or clear an item's thumbnail
 *
 * @remarks
 * Sets the thumbnail to an image uploaded with `createItemThumbnailUploadUrl`,
 * or clears it (`thumbnailPath: null`) to show the one rendered from the item's
 * model.
 *
 * @mcp
 */
export const updateItemThumbnail = defineServiceFn({
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
