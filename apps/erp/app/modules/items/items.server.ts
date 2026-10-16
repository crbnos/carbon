// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineServiceFn } from "@carbon/api/service-fn.server";
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
import { serverFns } from "@carbon/server-functions";
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
import {
  addChangeNoticeAffectedItem,
  applyChangeNotice,
  cascadeItemTrackingType,
  changeNoticeStageEvent,
  checkRevisionLock,
  copyItem,
  copyMakeMethod,
  getItem,
  getItemSupersession,
  getMethodTree,
  getUnreleasedChangeOrderItems,
  insertChangeNotice,
  isMakeMethodId,
  notifyChangeNoticeTransition,
  priceBreakRows,
  SUPERSESSION_CYCLE_CODE,
  toRichText,
  unreleasedChangeOrderItemsMessage,
  updateChangeNoticeStatus,
  updateItemMethodAndSourcing,
  updateMaterialProperties,
  updateServiceName,
  upsertItemManufacturing,
  upsertItemPlanning,
  upsertItemSupersession,
  upsertMakeMethodVersion,
  upsertPart,
  upsertSupplierPart,
  upsertTool
} from "./items.service";

const logger = getLogger("erp", "change-orders");

// An item page's layout and its tab loaders run in ONE request and each read the
// item's methods and change notices. These share that read across the loaders;
// on a mutation they are plain calls, so a revalidation never sees stale rows.
// Release-lock helpers — gate BOM/BOP mutations on a released (Production)
// revision. A Production revision is the controlled, released make method;
// changes must flow through a change notice. The pending revision an ECO creates
// is Design/Prototype (NOT Production), so it stays editable.
// The FK chain from each lock kind up to its owning make method, expressed once.
// The two lock inputs (the item's revisionStatus and the owning change notice's
// status) hang off that method, so one nested select answers both — walking the
// chain twice would double a query that runs on every BOM/BOP mutation.
// `methodMaterial` has two FKs to `makeMethod` (makeMethodId and
// materialMakeMethodId); the parent method is methodMaterial_methodId_fkey.
// Every base query is scoped by companyId (defense-in-depth; the id is a global
// UUID but tenant scoping is a golden rule). The lock is advisory — RLS +
// requirePermissions are the real boundary — so a null/unresolvable status
// leaves the gate open by design (see checkRevisionLock).
// Read variant for loaders that need the raw lock state (revisionStatus +
// releaseControl) to drive read-only UI. A revision is locked ONLY when it is
// "Production".
// The single guard entry point for mutation routes: resolves the entity's
// parent item and returns the enforce/warn/off verdict. A missing/null id
// (cannot resolve) leaves the lock unlocked, so the gate is safely skipped.
// =============================================================================
// Change Notices — server-only helpers (imports @carbon/jobs).
// =============================================================================
// Why a change notice's engineering content cannot be edited, or null. An
// approval request can only be pending at Engineering Complete (approval gates
// the move to Implementation), so only that stage pays for the lookup;
// approvalRequest is service-role only.
// One status read + predicate. Mutation routes call this before writing; the
// UI disable is cosmetic on top of it.
// The inverse gate: an item owned by an open change notice must not get a manual
// revision, because the notice authors it. Fails closed — a lookup we couldn't
// read cannot prove the item is free.
// Child rows (affected items, action tasks) are addressed by their own id, so
// authorizing the change notice in the URL proves nothing about the row being
// mutated — an editable notice's URL would otherwise let a user mutate a frozen
// notice's rows. Same failure contract as requireEditableChangeNoticeRoute;
// null means the route may proceed.
// The route-level guard: resolves the change notice from the URL, checks the
// scope, and returns the flashed failure response so all eight mutation routes
// share one failure contract. Returns null when the route may proceed.
// Maps a notifying stage to its notification event. Only Start / Implementation
// / Done notify; Draft / Engineering Complete are silent, so callers simply
// don't invoke this for those stages.
// Notifies the people involved in the CO — its assignee plus every action-task
// assignee — on a stage entry (best-effort). Deliberately NOT a company-wide
// broadcast; the notify function dedupes and drops the acting user itself.
// =============================================================================
// applyChangeNotice — the top-to-bottom "release", run on the Implementation →
// Done transition (this function IS that transition). It materializes each
// affected item's CO-staged end-state onto a NEW inactive revision, activates
// it, then auto-writes the oldRev → newRev supersession (Q1/Q2/Q5).
//
// Atomicity (G2): createRevision + activateMethodVersion call the get-method /
// convert operations, each of which commits its own transaction, so this CANNOT
// be one Kysely transaction. The apply is therefore an idempotent, CAS-guarded orchestration:
//   - PER-AFFECTED-ITEM idempotency: each changeOrderAffectedItem gets its
//     created revision id stamped into `newItemId` at the END of its processing.
//     A re-run skips any affected item whose `newItemId` is already set, so a
//     partial failure re-run resumes at the first unprocessed item instead of
//     re-creating revisions.
//   - CO-LEVEL idempotency: the final flip to 'Done' is a compare-and-swap on
//     status='Implementation', so a re-run can't double-transition the CO; only
//     the closing status flip is transactional.
// =============================================================================
// -----------------------------------------------------------------------------
// releaseAffectedItem (v2) — dispatch by change type. The CO-owned Draft make
// method already holds the edited BOM/BOP, so release just:
//   Version          → activate the Draft on the SAME item (prior Active →
//                      Archived); no new item, no supersession.
//   Revision         → activate the Draft + reveal the new revision item + auto
//                      oldRev→newRev supersession.
//   Replacement Part → activate the Draft + reveal the new part + auto
//                      affected→new supersession.
//   New Part         → activate the Draft + reveal the net-new part; NO
//                      supersession (no predecessor).
// Idempotent: once the Draft's changeOrderId is cleared it counts as released.
// -----------------------------------------------------------------------------
// Coerce a possibly-null DB supersession mode to a valid enum member, defaulting
// to 'Consume First' (Q3 default) when unset/invalid.
// -----------------------------------------------------------------------------
// Unreleased-change-order guard.
//
// Release is what activates a change notice's items: `applyChangeNotice` flips
// `active` on the revisions and parts the notice minted. Nothing stops a user
// switching the Active toggle on by hand first, and once it is on the item is
// selectable everywhere — carrying the notice's un-approved draft BOM, since a
// minted revision's only make method is that Draft and `activeMakeMethods` falls
// back to it when no Active version exists.
//
// So two kinds of write ask this question: one that would ACTIVATE such an item,
// and one that would CONSUME it (a sales order line, a purchase order line, a
// job).
//
// `item.changeOrderId` is NOT a draft marker on its own — release leaves it in
// place as a provenance back-link, so the owning change order's status decides.
// Release IS the Implementation -> Done transition, so every other status means
// the item is still a draft.
//
// Pass a service-role client: reading `changeOrder` requires `parts_view`, which
// the caller need not have.
// -----------------------------------------------------------------------------
// Both reads go through fetchAllByIds: an `in` filter rides in the URL and a
// response stops at PostgREST's row cap. Truncating either one would drop an
// item from the answer, and a missing row reads as "no change order holds it".

// Two queries per batch of ids — the bulk item update can carry a whole table
// selection.
//
// `error` is a message to show the user, not a thrown failure — a read that did
// not answer says nothing about the items, so callers block on it rather than
// wave the write through on a database blip.
// Single-item form for the loaders that only need to know whether to lock the
// Active toggle on this one item's page. Best-effort: a failed read leaves the
// toggle unlocked, and the action behind it still refuses the write.
// Single-item form for the actions that put an item into circulation. Returns
// the reason to refuse, or null. Unlike the loader form this fails closed: a
// read that did not answer says nothing about the item.
//
// Deliberately does NOT judge `active`. Plain inactive items are allowed onto
// these documents today, and changing that is a separate decision from closing
// the change order hole.
// Names every offending item so a bulk edit says which row to fix.
// Not awaited by the item layouts: only the header badge and the properties
// sidebar read these, so they stream instead of holding the page.
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
      await cascadeItemTrackingType(ctx.asSystem.pg, {
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
      await updateItemMethodAndSourcing(ctx.asSystem.pg, {
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
      const unreleased = await getUnreleasedChangeOrderItems(
        ctx.asSystem.supabase,
        { itemIds: ids, companyId }
      );
      if (unreleased.error) return ctx.error("internal", unreleased.error);
      if (unreleased.data.length > 0) {
        return ctx.error(
          "rule",
          `${unreleasedChangeOrderItemsMessage(
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

    const revisions = await client
      .from("item")
      .select("id")
      .eq("readableId", current)
      .eq("type", type)
      .eq("companyId", companyId);
    if (revisions.error) {
      return ctx.error("internal", revisions.error.message, revisions.error);
    }

    const audit = {
      updatedBy: ctx.auditUserId,
      updatedAt: datetime.timestamp()
    };
    const [itemUpdate, typedUpdate] = await Promise.all([
      client
        .from("item")
        .update({ readableId, ...audit })
        .in(
          "id",
          revisions.data.map((revision) => revision.id)
        )
        .eq("companyId", companyId),
      client
        .from(renumberedTable[type] as "part")
        .update({ id: readableId, ...audit })
        .eq("id", current)
        .eq("companyId", companyId)
    ]);
    const failed = typedUpdate.error ?? itemUpdate.error;
    if (failed) return ctx.error("internal", failed.message, failed);
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
    let renamed: Awaited<ReturnType<typeof updateServiceName>>;
    try {
      renamed = await updateServiceName(ctx.asSystem.pg, {
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
      const update = await updateMaterialProperties(client, ctx.asSystem.pg, {
        id: materialId,
        companyId,
        updatedBy: ctx.auditUserId,
        ...changes
      });
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
 * default storage unit and shelf life (`upsertPart`). A part created with a
 * CAD model queues the model's optimisation, which also renders its
 * thumbnail.
 *
 * @mcp
 */
export const createPart = defineServiceFn({
  input: partInput,
  permission: { create: "parts" },

  async run(ctx, part) {
    const companyId = ctx.company.id;
    const created = await upsertPart(ctx.asCaller.supabase, {
      ...part,
      companyId,
      createdBy: ctx.auditUserId
    });
    const id = created.data?.id;
    if (created.error || !id) {
      return ctx.error("internal", "Failed to insert part", created.error);
    }

    if (part.modelUploadId) {
      await trigger("model-optimize", {
        modelUploadId: part.modelUploadId,
        companyId,
        userId: ctx.auditUserId
      }).catch((err) =>
        logger.error("Failed to queue the new part's model optimisation", {
          companyId,
          itemId: id,
          error: err
        })
      );
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
    const updated = await upsertPart(ctx.asCaller.supabase, {
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
    const updated = await upsertTool(ctx.asCaller.supabase, {
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
    const update = await upsertItemManufacturing(ctx.asCaller.supabase, {
      ...manufacturing,
      ...(customFields && { customFields }),
      updatedBy: ctx.auditUserId
    });
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

    const update = await upsertItemPlanning(client, {
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
    const upsert = await upsertItemSupersession(ctx.asCaller.supabase, {
      ...supersession,
      companyId: ctx.company.id,
      createdBy: ctx.auditUserId,
      updatedBy: ctx.auditUserId
    });
    if (upsert.error) {
      return upsert.error.code === SUPERSESSION_CYCLE_CODE
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
      getItemSupersession(client, predecessorItemId, companyId)
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

    const upsert = await upsertItemSupersession(client, {
      ...supersession,
      itemId: predecessorItemId,
      successorItemId: itemId,
      companyId,
      createdBy: ctx.auditUserId,
      updatedBy: ctx.auditUserId
    });
    if (upsert.error) {
      return upsert.error.code === SUPERSESSION_CYCLE_CODE
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
    const created = await upsertSupplierPart(client, {
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
        .insert(priceBreakRows(ctx, id, priceBreaks));
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
    const updated = await upsertSupplierPart(ctx.asCaller.supabase, {
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
            .values(priceBreakRows(ctx, id, priceBreaks))
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
    const lock = await checkRevisionLock(system, {
      kind: isMakeMethodId(input.targetId) ? "makeMethod" : "item",
      id: input.targetId,
      companyId
    });
    if (!lock.ok) return ctx.error("rule", lock.message);

    const args = { ...input, companyId, userId: ctx.auditUserId };
    const copy =
      isMakeMethodId(input.sourceId) || isMakeMethodId(input.targetId)
        ? await copyMakeMethod(system, ctx.asSystem.pg, args)
        : await copyItem(system, ctx.asSystem.pg, args);
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
 * (the item's only version, when its successor is drafted).
 *
 * @mcp
 */
export const createMethodVersion = defineServiceFn({
  input: makeMethodVersionValidator,
  permission: { create: "parts" },

  async run(ctx, input) {
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const insert = await upsertMakeMethodVersion(ctx.asCaller.supabase, {
      ...input,
      companyId,
      createdBy: userId
    });
    const version = insert.data;
    if (insert.error || !version?.id || !version.type || !version.itemId) {
      return ctx.error(
        "internal",
        "Failed to insert new version",
        insert.error
      );
    }

    const copy = await copyMakeMethod(ctx.asSystem.supabase, ctx.asSystem.pg, {
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
    });
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

    const synced = await serverFns
      .system({ db: ctx.asSystem.pg, companyId, userId: ctx.auditUserId })
      .invoke("sync", {
        type: "onshape",
        makeMethodId: input.makeMethodId,
        data: input.rows
      });
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
    const lock = await checkRevisionLock(client, {
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

    const methodTree = await getMethodTree(client, makeMethod.data.id);
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

    const created = await insertChangeNotice(client, {
      changeNoticeId: input.changeOrderId || undefined,
      name: input.name,
      reasonForChange: toRichText(input.reasonForChange),
      description: toRichText(input.description),
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
      const added = await addChangeNoticeAffectedItem(client, ctx.asSystem.pg, {
        changeNoticeId: id,
        itemId,
        changeType: "Version",
        companyId,
        userId
      });
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

    const item = await getItem(client, itemId);
    const label =
      item.data?.readableIdWithRevision ?? item.data?.readableId ?? itemId;

    const created = await insertChangeNotice(client, {
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

    const added = await addChangeNoticeAffectedItem(client, ctx.asSystem.pg, {
      changeNoticeId: id,
      itemId,
      changeType,
      revision,
      companyId,
      userId
    });
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
          "The change notice was updated by someone else. Refresh and try again.",
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
      const applied = await applyChangeNotice(client, ctx.asSystem.pg, {
        changeNoticeId: id,
        userId,
        companyId
      });
      if (applied.error || !applied.data) {
        return ctx.error(
          "internal",
          "Failed to apply change notice",
          applied.error
        );
      }
    } else {
      const update = await updateChangeNoticeStatus(client, {
        id,
        companyId,
        fromStatus,
        toStatus: status,
        assignee,
        updatedBy: userId
      });
      if (update.error || !update.data) {
        return ctx.error(
          "internal",
          "Failed to update change notice status",
          update.error
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
      await notifyChangeNoticeTransition({
        client,
        event: changeNoticeStageEvent[status],
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
      await notifyChangeNoticeTransition({
        client: ctx.asCaller.supabase,
        event: changeNoticeStageEvent.Implementation,
        changeNoticeId,
        companyId,
        userId
      });
    }
    return { changeNoticeId, decision };
  }
});
