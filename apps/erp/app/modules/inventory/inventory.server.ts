// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  type CarbonError,
  defineServiceFn
} from "@carbon/api/service-fn.server";
import { paged, payload, run, unwrap } from "@carbon/api/service-tools.server";
import type { Json } from "@carbon/database";
import { convertUnitPrice } from "@carbon/database/supplier-part-price";
import {
  dedupeViolations,
  evaluateSalesRuleLines,
  isBlocked,
  resolveSalesOrderShipTo
} from "@carbon/ee/rules.server";
import { trigger } from "@carbon/jobs";
import { trackWorkEvent } from "@carbon/lib/telemetry";
import { raiseMoment } from "@carbon/lib/workflows";
import { getLogger } from "@carbon/logger";
import { runLocationSchedule } from "@carbon/planning";
import {
  datetime,
  getErrorMessage,
  getOverReceiptViolations,
  isUniqueViolation,
  round,
  type Violation
} from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { z } from "zod";
import { getItemReplenishment } from "~/modules/items/items.service";
import { getSupplierPartPricing } from "~/modules/items/items.utils";
import {
  getActiveJobOperationByJobId,
  insertJob,
  runMRP,
  updateKanbanJob,
  upsertJobMethod
} from "~/modules/production/production.service";
import {
  insertPurchaseOrder,
  updatePurchasedPrices,
  upsertPurchaseOrderLine
} from "~/modules/purchasing/purchasing.service";
import { recordSalesRuleOutcome } from "~/modules/sales/sales.service";
import {
  getCompanySettings,
  getNextSequence
} from "~/modules/settings/settings.service";
import {
  getCompanyTimeZone,
  getLocationTimeZone,
  invokeCreate,
  invokePosting,
  refuseUnlessOwned
} from "~/modules/shared/shared.service";
import { resolveSupplierPrice } from "~/modules/shared/shared.utils";
import {
  finishPickingList,
  inventoryAdjustmentTypes,
  inventoryCountStatusFrom,
  inventoryItemTypes,
  isPickingListLocked,
  isStockTransferLocked,
  pickingListStatusType,
  receiptFixedAssetLineUpdateValidator,
  receiptSourceDocumentType,
  resolveStockTransferPickForward,
  shipmentFixedAssetLineUpdateValidator,
  shipmentSourceDocumentType,
  stockTransferStatusType,
  warehouseTransferStatusType
} from "./inventory.models";
import type { Blocked } from "./inventory.service";
import * as service from "./inventory.service";
import * as utils from "./inventory.utils";
import { getDefaultStorageUnitForJob } from "./inventory.utils";

const logger = getLogger("erp", "inventory");

// ---------------------------------------------------------------------------
// Shared steps
// ---------------------------------------------------------------------------
const customFieldsInput = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .optional();
const RECEIPT_NOT_FOUND = "The receipt could not be found";
const RECEIPT_LOCKED = "A posted receipt can no longer be changed";
// A read by id runs under RLS, which admits every company the caller belongs
// to: another company's row reads like a missing one.
const NOT_FOUND = "No matching record was found.";

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

/**
 * Create a receipt.
 *
 * @remarks
 * From its source document, with its lines: a purchase order, a sales return
 * order, an inbound warehouse transfer or a rental agreement. With no source
 * document it creates an empty receipt. The location is the caller's default
 * location; a sales return falls back to the return order's own.
 *
 * A sales return order or rental agreement with a Draft receipt already
 * returns that receipt instead of a second one.
 *
 * @mcp
 */
export const createReceipt = defineServiceFn({
  input: z.object({
    sourceDocument: z.enum(receiptSourceDocumentType).optional(),
    sourceDocumentId: z.string().default("")
  }),
  permission: { create: "inventory" },

  async run(ctx, { sourceDocument, sourceDocumentId }) {
    const locationId = await service.defaultLocationOf(ctx);

    // One open draft per return order or agreement: a second Receive goes to
    // the existing draft instead of stacking up duplicates.
    if (
      sourceDocument === "Sales Return Order" ||
      sourceDocument === "Rental Agreement"
    ) {
      const existing = await ctx.asCaller.supabase
        .from("receipt")
        .select("id")
        .eq("sourceDocument", sourceDocument)
        .eq("sourceDocumentId", sourceDocumentId)
        .eq("status", "Draft")
        .eq("companyId", ctx.company.id)
        .order("createdAt", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing.error) {
        return ctx.error(
          "internal",
          "Failed to check for an existing receipt",
          existing.error
        );
      }
      if (existing.data) return { id: existing.data.id };
    }

    const created = await (() => {
      switch (sourceDocument) {
        case "Purchase Order":
          return invokeCreate(ctx, {
            type: "receiptFromPurchaseOrder",
            locationId,
            purchaseOrderId: sourceDocumentId,
            receiptId: undefined
          });
        case "Sales Return Order":
          // No default-location guard: the server function falls back to the
          // return order's own location and errors specifically otherwise.
          return invokeCreate(ctx, {
            type: "receiptFromSalesReturnOrder",
            locationId,
            salesReturnOrderId: sourceDocumentId,
            receiptId: undefined
          });
        case "Inbound Transfer":
          return invokeCreate(ctx, {
            type: "receiptFromInboundTransfer",
            warehouseTransferId: sourceDocumentId,
            receiptId: undefined
          });
        case "Rental Agreement":
          return invokeCreate(ctx, {
            type: "receiptFromRentalAgreement",
            rentalAgreementId: sourceDocumentId
          });
        default:
          return invokeCreate(ctx, {
            type: "receiptDefault",
            locationId: locationId as string
          });
      }
    })();
    if (created.error || !created.data) {
      // Only the return and rental paths ever named the reason.
      const named =
        sourceDocument === "Sales Return Order" ||
        sourceDocument === "Rental Agreement";
      return service.serverFnFailure(
        ctx,
        created.error,
        named
          ? getErrorMessage(created.error, "Failed to create receipt")
          : "Failed to create receipt"
      );
    }
    return { id: created.data.id };
  }
});

/**
 * Update a receipt's details.
 *
 * @remarks
 * A changed source document or location rebuilds the receipt's lines from
 * the new source (a purchase order, a sales return order or an inbound
 * transfer), and is refused once the receipt is not Draft. Otherwise the
 * fields are saved as sent. A rental receipt keeps its rental agreement:
 * changing it is refused.
 *
 * @mcp
 */
export const updateReceipt = defineServiceFn({
  input: z.object({
    id: z.string(),
    receiptId: z.string().min(1),
    locationId: z.string().optional(),
    sourceDocument: z.enum(receiptSourceDocumentType).optional(),
    sourceDocumentId: z.string().min(1),
    externalDocumentId: z.string().optional(),
    sourceDocumentReadableId: z.string().optional(),
    supplierId: z.string().optional(),
    customFields: customFieldsInput
  }),
  permission: { update: "inventory" },

  async run(ctx, { id, ...receipt }) {
    const current = await ctx.asCaller.supabase
      .from("receipt")
      .select("sourceDocument, sourceDocumentId, locationId, status")
      .eq("id", id)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (current.error) {
      return ctx.error("internal", "Failed to load receipt", current.error);
    }
    if (!current.data) return ctx.error("notFound", RECEIPT_NOT_FOUND);

    const sourceChanged =
      current.data.sourceDocument !== receipt.sourceDocument ||
      current.data.sourceDocumentId !== receipt.sourceDocumentId;
    const isRental =
      current.data.sourceDocument === "Rental Agreement" ||
      receipt.sourceDocument === "Rental Agreement";
    if (isRental && sourceChanged) {
      return ctx.error(
        "rule",
        "A rental receipt keeps its rental agreement. Create it from the agreement."
      );
    }

    const rebuild =
      !isRental &&
      (sourceChanged || current.data.locationId !== receipt.locationId);
    // A rebuild replaces the lines: on a posted receipt, the posted ones.
    if (rebuild && current.data.status !== "Draft") {
      return ctx.error(
        "rule",
        "Only a Draft receipt can change its source document or location"
      );
    }
    if (!rebuild) {
      const updated = await service.upsertReceipt(ctx.asCaller.supabase, {
        id,
        ...receipt,
        updatedBy: ctx.auditUserId
      });
      if (updated.error) {
        return ctx.error("internal", "Failed to update receipt", updated.error);
      }
      return { id };
    }

    const created = await (() => {
      switch (receipt.sourceDocument) {
        case "Purchase Order":
          return invokeCreate(ctx, {
            type: "receiptFromPurchaseOrder",
            locationId: receipt.locationId,
            purchaseOrderId: receipt.sourceDocumentId,
            receiptId: id
          });
        case "Sales Return Order":
          return invokeCreate(ctx, {
            type: "receiptFromSalesReturnOrder",
            locationId: receipt.locationId,
            salesReturnOrderId: receipt.sourceDocumentId,
            receiptId: id
          });
        case "Inbound Transfer":
          return invokeCreate(ctx, {
            type: "receiptFromInboundTransfer",
            warehouseTransferId: receipt.sourceDocumentId,
            receiptId: id
          });
        default:
          return null;
      }
    })();
    if (!created) {
      return ctx.error("validation", "Unsupported source document");
    }
    if (created.error || !created.data) {
      return service.serverFnFailure(
        ctx,
        created.error,
        "Failed to create receipt"
      );
    }
    return { id };
  }
});

/**
 * Post a receipt.
 *
 * @remarks
 * In order:
 *   1. A Posted or Voided receipt is refused (`conflict`): posting it again
 *      would duplicate its ledger entries, cost layers and journal lines.
 *   2. Storage rules run on the `receipt` and `place` surfaces (and
 *      `warehouseTransfer` for an inbound transfer), and a purchase order
 *      receipt is checked for over-receipt against the live order lines. A
 *      blocking rule returns its `violations` and `ruleNames` and changes
 *      nothing; send `acknowledged: true` to post past warnings.
 *   3. The receipt is set Pending (only from Draft or Pending: `conflict`
 *      otherwise).
 *   4. Stale serial entities on serial-tracked lines are deleted, so they
 *      are not made Available as phantom serials, and the receipt is posted:
 *      ledger entries, cost layers, the journal and tracked entities. A
 *      failed post sets it back to Draft.
 *   5. Supplier lead times are refreshed when the company setting is on,
 *      labels print when the receiving printer auto-prints, and the
 *      receipt-posted workflow moment is raised.
 *
 * `postingDate` dates a rental return; every other receipt posts today.
 *
 * @mcp
 */
export const postReceipt = defineServiceFn({
  input: z.object({
    receiptId: z.string(),
    acknowledged: z.boolean().default(false),
    postingDate: z.string().optional()
  }),
  permission: { update: "inventory" },

  async run(ctx, { receiptId, acknowledged, postingDate }) {
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    // As the system: a user with `inventory` rights may not see the items,
    // bins or purchase order lines the checks read.
    const serviceRole = ctx.asSystem.supabase;

    const [lines, receipt] = await Promise.all([
      serviceRole
        .from("receiptLine")
        .select(
          "id, itemId, storageUnitId, receivedQuantity, locationId, receiptId, requiresSerialTracking, lineId, conversionFactor"
        )
        .eq("receiptId", receiptId)
        .eq("companyId", companyId),
      serviceRole
        .from("receipt")
        .select("sourceDocument, sourceDocumentId, status, locationId")
        .eq("id", receiptId)
        .eq("companyId", companyId)
        .maybeSingle()
    ]);
    if (!receipt.data) return ctx.error("notFound", RECEIPT_NOT_FOUND);
    if (receipt.data.status === "Posted") {
      return ctx.error("conflict", "This receipt has already been posted");
    }
    if (receipt.data.status === "Voided") {
      return ctx.error("conflict", "This receipt has been voided");
    }

    const isTransfer = receipt.data.sourceDocument === "Inbound Transfer";
    const ruleLines = (lines.data ?? []).map((line) => ({
      lineId: line.id,
      itemId: line.itemId,
      storageUnitId: line.storageUnitId,
      quantity: Number(line.receivedQuantity ?? 0),
      locationId: line.locationId
    }));
    // The transfer surface rides with both passes: the post completes the
    // parent transfer. Dedupe collapses the overlap.
    const rules = await service.storageRuleViolations(
      ctx,
      isTransfer
        ? ["receipt", "warehouseTransfer", "place", "warehouseTransfer"]
        : ["receipt", "place"],
      ruleLines
    );

    // Over-receipt is checked against the live purchase order lines, not the
    // receipt's snapshot, so concurrent receipts are counted.
    if (receipt.data.sourceDocument === "Purchase Order") {
      const purchaseOrderLineIds = [
        ...new Set(
          (lines.data ?? [])
            .map((line) => line.lineId)
            .filter((id): id is string => Boolean(id))
        )
      ];
      if (purchaseOrderLineIds.length > 0) {
        const purchaseOrderLines = await serviceRole
          .from("purchaseOrderLine")
          .select(
            "id, purchaseQuantity, quantityReceived, item(readableIdWithRevision)"
          )
          .in("id", purchaseOrderLineIds)
          .eq("companyId", companyId);
        const overReceipt = getOverReceiptViolations(
          lines.data ?? [],
          (purchaseOrderLines.data ?? []).map((line) => ({
            id: line.id,
            purchaseQuantity: line.purchaseQuantity,
            quantityReceived: line.quantityReceived,
            itemReadableId: line.item?.readableIdWithRevision
          }))
        );
        rules.violations.push(...overReceipt.violations);
        Object.assign(rules.ruleNames, overReceipt.ruleNames);
      }
    }

    const violations = dedupeViolations(rules.violations);
    if (violations.length > 0 && isBlocked(violations, acknowledged)) {
      return { violations, ruleNames: rules.ruleNames } satisfies Blocked;
    }

    // Conditional on a postable status, so a concurrent void or post is not
    // flipped back to Pending, and nothing below touches a posted receipt.
    const pending = await ctx.asCaller.supabase
      .from("receipt")
      .update({ status: "Pending" })
      .eq("id", receiptId)
      .eq("companyId", companyId)
      .in("status", ["Draft", "Pending"])
      .select("id");
    if (pending.error) {
      return ctx.error("internal", "Failed to post receipt", pending.error);
    }
    if (!pending.data?.length) {
      return ctx.error(
        "conflict",
        "This receipt has already been posted or voided"
      );
    }

    // Only from Pending: a concurrent post that won must stay Posted.
    const backToDraft = () =>
      ctx.asCaller.supabase
        .from("receipt")
        .update({ status: "Draft" })
        .eq("id", receiptId)
        .eq("companyId", companyId)
        .eq("status", "Pending");

    let failure: CarbonError | null = null;
    try {
      await service.reconcileReceiptSerialEntities(serviceRole, {
        receiptId,
        companyId,
        lines: lines.data ?? []
      });
      const posted = await invokePosting(
        ctx,
        "post-receipt",
        {
          receiptId,
          postingDate
        },
        service.postReceipt
      );
      if (posted.error) {
        await backToDraft();
        return service.serverFnFailure(
          ctx,
          posted.error,
          "Failed to post receipt"
        );
      }
    } catch (thrown) {
      await backToDraft();
      failure = ctx.error("internal", "Failed to post receipt", thrown);
    }

    if (!failure) {
      const settings = await serviceRole
        .from("companySettings")
        .select("updateLeadTimesOnReceipt")
        .eq("id", companyId)
        .single();
      if (
        settings.data?.updateLeadTimesOnReceipt &&
        receipt.data.sourceDocument === "Purchase Order" &&
        receipt.data.sourceDocumentId
      ) {
        // System: the poster needs no purchasing rights to refresh lead times.
        const leadTimes = await invokePosting(
          ctx,
          "update-purchased-prices",
          {
            source: "purchaseOrder",
            purchaseOrderId: receipt.data.sourceDocumentId,
            updatePrices: false,
            updateLeadTimes: true
          },
          updatePurchasedPrices
        );
        if (leadTimes.error) {
          logger.error("Failed to update lead time on receipt posting", {
            error: leadTimes.error
          });
        }
      }

      await service.autoPrint(ctx, {
        sourceDocument: "Receipt",
        sourceDocumentId: receiptId,
        locationId: receipt.data.locationId,
        context: "receiving"
      });
    }

    // Raised after a rollback to Draft too: when workflows fire is its own
    // decision (#1294), unchanged here.
    await raiseMoment("inventory.receiptPosted", {
      outputs: { receipt: { id: receiptId }, postedBy: { id: userId } },
      companyId,
      actorId: userId
    });

    if (failure) return failure;
    trackWorkEvent("receipt_posted", {
      companyId,
      userId,
      receiptId,
      sourceDocument: receipt.data.sourceDocument ?? null
    });
    return { posted: true as const };
  }
});

/**
 * Void a posted receipt.
 *
 * @remarks
 * Reverses its inventory adjustments and journal entries, restores its
 * tracked entities and the purchase order quantities. Only a Posted receipt
 * can be voided, and not one a purchase invoice created: void the invoice
 * instead.
 *
 * @mcp destructive
 */
export const voidReceipt = defineServiceFn({
  input: z.object({ receiptId: z.string() }),
  permission: { update: "inventory" },

  async run(ctx, { receiptId }) {
    const receipt = await ctx.asCaller.supabase
      .from("receipt")
      .select("status, invoiced")
      .eq("id", receiptId)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (receipt.error) {
      return ctx.error("internal", "Failed to void receipt", receipt.error);
    }
    if (!receipt.data) return ctx.error("notFound", "Receipt not found");
    if (receipt.data.status !== "Posted") {
      return ctx.error("rule", "Can only void posted receipts");
    }
    if (receipt.data.invoiced) {
      return ctx.error(
        "rule",
        "Cannot void a receipt created by a purchase invoice. Void the invoice instead."
      );
    }

    const voided = await invokePosting(
      ctx,
      "post-receipt",
      {
        type: "void",
        receiptId
      },
      service.postReceipt
    );
    if (voided.error) {
      return service.serverFnFailure(
        ctx,
        voided.error,
        "Failed to void receipt"
      );
    }
    return { receiptId };
  }
});

/**
 * Split a receipt line in two.
 *
 * @remarks
 * Moves `quantity` of the line onto a new line of the same receipt, so the
 * two can go to different storage units or carry different tracking.
 *
 * @mcp
 */
export const splitReceiptLine = defineServiceFn({
  input: z.object({
    receiptId: z.string().min(1),
    receiptLineId: z.string().min(1),
    locationId: z.string().min(1),
    quantity: z.number()
  }),
  permission: { update: "inventory" },

  async run(ctx, { receiptId, receiptLineId, locationId, quantity }) {
    const line = await ctx.asCaller.supabase
      .from("receiptLine")
      .select("id, receipt!receiptLine_receiptId_fkey(status)")
      .eq("id", receiptLineId)
      .eq("receiptId", receiptId)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (line.error) {
      return ctx.error("internal", "Failed to split line", line.error);
    }
    if (!line.data?.receipt) {
      return ctx.error("notFound", "The receipt line could not be found");
    }
    if (line.data.receipt.status !== "Draft") {
      return ctx.error("rule", RECEIPT_LOCKED);
    }

    const split = await invokeCreate(ctx, {
      type: "receiptLineSplit",
      locationId,
      receiptId,
      receiptLineId,
      quantity
    });
    if (split.error) {
      return service.serverFnFailure(ctx, split.error, "Failed to split line");
    }
    return { receiptLineId };
  }
});

/**
 * Set one field on receipt lines.
 *
 * @remarks
 * `storageUnitId` or `receivedQuantity`, on every line in `ids`. An empty
 * value clears the field. Storage rules run when the receipt is posted, not
 * here.
 *
 * @mcp
 */
export const updateReceiptLines = defineServiceFn({
  input: z.object({
    ids: z.array(z.string()).min(1),
    field: z.enum(["storageUnitId", "receivedQuantity"]),
    value: z.string().nullable()
  }),
  permission: { update: "inventory" },

  async run(ctx, { ids, field, value }) {
    const lines = await ctx.asCaller.supabase
      .from("receiptLine")
      .select("id, receipt!receiptLine_receiptId_fkey(status)")
      .in("id", ids)
      .eq("companyId", ctx.company.id);
    if (lines.error) {
      return ctx.error("internal", "Failed to load receipt lines", lines.error);
    }
    if (lines.data.length !== new Set(ids).size) {
      return ctx.error("notFound", "The receipt line could not be found");
    }
    if (lines.data.some((line) => line.receipt?.status !== "Draft")) {
      return ctx.error("rule", RECEIPT_LOCKED);
    }

    const update = await ctx.asCaller.supabase
      .from("receiptLine")
      .update({
        ...(field === "storageUnitId"
          ? { storageUnitId: value || null }
          : { receivedQuantity: Number(value || 0) }),
        updatedBy: ctx.auditUserId,
        updatedAt: datetime.timestamp()
      })
      .in("id", ids)
      .eq("companyId", ctx.company.id);
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to update receipt lines",
        update.error
      );
    }
    return { ids };
  }
});

/**
 * Update one field of a fixed-asset line on a receipt.
 *
 * @remarks
 * `received`, `serialNumber`, `meter`, `notes`, `outOfService` (an empty
 * value returns the unit to service, any other text is the reason) or
 * `residualDestination`. A posted or voided receipt is a record: its lines no
 * longer change.
 *
 * @mcp
 */
export const updateReceiptFixedAssetLine = defineServiceFn({
  input: receiptFixedAssetLineUpdateValidator,
  permission: { update: "inventory" },

  async run(ctx, { id, ...change }) {
    const serviceRole = ctx.asSystem.supabase;
    const line = await serviceRole
      .from("receiptFixedAssetLine")
      .select("receipt!receiptFixedAssetLine_receiptId_fkey(status)")
      .eq("id", id)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (line.error || !line.data?.receipt) {
      return ctx.error("notFound", "The receipt line could not be found");
    }
    if (line.data.receipt.status !== "Draft") {
      return ctx.error("rule", "A posted receipt can no longer be changed");
    }

    const update = await serviceRole
      .from("receiptFixedAssetLine")
      .update({
        ...service.receiptFixedAssetLineChange(change),
        updatedBy: ctx.auditUserId
      })
      .eq("id", id)
      .eq("companyId", ctx.company.id);
    if (update.error) {
      return ctx.error("internal", "Failed to update the line", update.error);
    }
    return { id };
  }
});
/**
 * Set the batch number of a batch-tracked receipt line.
 *
 * @remarks
 * Creates or updates the line's batch (On Hold until the receipt posts) with
 * the line's quantity, its properties and an optional `expirationDate` in
 * `properties`. `trackedEntityId` names the line's existing batch (another
 * entity is refused); without it the batch already tagged with the line is
 * updated, so renaming a batch number never orphans the old one. Only a
 * Draft receipt's batches change.
 *
 * @mcp
 */
export const setReceiptLineBatch = defineServiceFn({
  input: z.object({
    receiptId: z.string(),
    receiptLineId: z.string(),
    batchNumber: z.string(),
    quantity: z.number(),
    properties: z.record(z.string(), z.unknown()).default({}),
    trackedEntityId: z.string().optional()
  }),
  permission: { create: "inventory" },

  async run(ctx, input) {
    const [line, receipt] = await Promise.all([
      service.receiptLineOf(ctx, input),
      ctx.asSystem.supabase
        .from("receipt")
        .select("status")
        .eq("id", input.receiptId)
        .eq("companyId", ctx.company.id)
        .maybeSingle()
    ]);
    if (line instanceof Error) return line;
    if (receipt.error) {
      return ctx.error("internal", "Failed to load receipt", receipt.error);
    }
    if (receipt.data?.status !== "Draft") {
      return ctx.error("rule", RECEIPT_LOCKED);
    }

    let trackedEntityId = input.trackedEntityId;
    if (trackedEntityId) {
      // The RPC rewrites this entity's quantity, status and attributes with
      // no ledger entry: it must be this line's own batch.
      const entity = await ctx.asSystem.supabase
        .from("trackedEntity")
        .select("id, attributes")
        .eq("id", trackedEntityId)
        .eq("companyId", ctx.company.id)
        .maybeSingle();
      if (entity.error || !entity.data) {
        return ctx.error("notFound", "The tracked entity could not be found");
      }
      const attributes = (entity.data.attributes ?? {}) as Record<
        string,
        unknown
      >;
      if (attributes["Receipt Line"] !== input.receiptLineId) {
        return ctx.error(
          "validation",
          "The tracked entity is not this receipt line's batch"
        );
      }
    } else {
      const existing = await ctx.asCaller.supabase
        .from("trackedEntity")
        .select("id")
        .eq("attributes ->> Receipt Line", input.receiptLineId)
        .eq("companyId", ctx.company.id)
        .maybeSingle();
      if (existing.error) {
        return ctx.error(
          "internal",
          "Failed to query batch number",
          existing.error
        );
      }
      trackedEntityId = existing.data?.id;
    }

    const updated = await ctx.asSystem.supabase.rpc(
      "update_receipt_line_batch_tracking",
      {
        p_tracked_entity_id: trackedEntityId,
        p_receipt_line_id: input.receiptLineId,
        p_receipt_id: input.receiptId,
        p_batch_number: input.batchNumber,
        p_quantity: input.quantity,
        p_properties: input.properties as Json
      }
    );
    if (updated.error) {
      return ctx.error("internal", "Failed to update tracking", updated.error);
    }
    return { receiptLineId: input.receiptLineId };
  }
});

/**
 * Set one serial number of a serial-tracked receipt line.
 *
 * @remarks
 * `index` is the unit's position on the line, from 0. A serial number the
 * line's item already uses at another receipt line or position is refused.
 *
 * @mcp
 */
export const setReceiptLineSerial = defineServiceFn({
  input: z.object({
    receiptId: z.string(),
    receiptLineId: z.string(),
    serialNumber: z.string(),
    index: z.number().int().min(0),
    expiryDate: z.string().optional()
  }),
  permission: { create: "inventory" },

  async run(ctx, input) {
    const [line, receipt] = await Promise.all([
      service.receiptLineOf(ctx, input),
      ctx.asSystem.supabase
        .from("receipt")
        .select("status")
        .eq("id", input.receiptId)
        .eq("companyId", ctx.company.id)
        .maybeSingle()
    ]);
    if (line instanceof Error) return line;
    if (receipt.error) {
      return ctx.error("internal", "Failed to load receipt", receipt.error);
    }
    if (receipt.data?.status !== "Draft") {
      return ctx.error("rule", RECEIPT_LOCKED);
    }

    const existing = await ctx.asCaller.supabase
      .from("trackedEntity")
      .select("id, attributes")
      .eq("sourceDocumentId", line.itemId ?? "")
      .eq("readableId", input.serialNumber)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (existing.error) {
      return ctx.error(
        "internal",
        "Failed to check serial number index",
        existing.error
      );
    }

    // Only a serial entity (one with a receipt line index) at a different
    // line or position conflicts.
    if (existing.data) {
      const attributes = (existing.data.attributes ?? {}) as Record<
        string,
        unknown
      >;
      if (
        "Receipt Line Index" in attributes &&
        (attributes["Receipt Line"] !== input.receiptLineId ||
          attributes["Receipt Line Index"] !== input.index)
      ) {
        return ctx.error(
          "conflict",
          "Serial number is already used for a different item or position"
        );
      }
    }

    const updated = await ctx.asSystem.supabase.rpc(
      "update_receipt_line_serial_tracking",
      {
        p_tracked_entity_id: existing.data?.id,
        p_receipt_line_id: input.receiptLineId,
        p_receipt_id: input.receiptId,
        p_serial_number: input.serialNumber,
        p_index: input.index,
        p_expiry_date: input.expiryDate || undefined
      }
    );
    if (updated.error) {
      if (isUniqueViolation(updated.error)) {
        return ctx.error(
          "conflict",
          "Serial number already exists for this item"
        );
      }
      return ctx.error("internal", "Failed to update tracking", updated.error);
    }
    return { receiptLineId: input.receiptLineId, index: input.index };
  }
});
/**
 * Assign a returned tracked entity to a sales-return receipt line.
 *
 * @remarks
 * Re-tags the EXISTING entity a customer sent back with this receipt line,
 * instead of creating a new serial or batch; posting reactivates it On Hold.
 * The entity must be Consumed, the return line's item, and have left on a
 * posted shipment to the return's customer. One that another Draft
 * sales-return receipt has claimed is refused. Whatever entity held the slot
 * (`index` for a serial, the line for a batch) is cleared first.
 *
 * @mcp
 */
export const assignReceiptReturnEntity = defineServiceFn({
  input: z.object({
    receiptId: z.string(),
    receiptLineId: z.string(),
    trackedEntityId: z.string(),
    index: z.number().int().min(0).optional()
  }),
  permission: { create: "inventory" },

  async run(ctx, { receiptId, receiptLineId, trackedEntityId, index }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    const [returnLine, entity, receipt] = await Promise.all([
      service.returnReceiptLineOf(ctx, { receiptId, receiptLineId }),
      client
        .from("trackedEntity")
        .select("id, status, attributes, itemId")
        .eq("id", trackedEntityId)
        .eq("companyId", companyId)
        .maybeSingle(),
      client
        .from("receipt")
        .select("status")
        .eq("id", receiptId)
        .eq("companyId", companyId)
        .maybeSingle()
    ]);
    if (returnLine instanceof Error) return returnLine;
    if (receipt.data?.status !== "Draft") {
      return ctx.error("rule", RECEIPT_LOCKED);
    }
    if (!entity.data) {
      return ctx.error("validation", "Tracked entity not found");
    }
    if (entity.data.status !== "Consumed") {
      return ctx.error(
        "rule",
        "Only shipped (consumed) entities can be returned"
      );
    }

    // "Which serial is it" lives on the receipt: the return order does not
    // pre-pick serials. The proof is provenance: the return line's item, and
    // left on a posted shipment to this return's customer.
    const orderLine = await client
      .from("salesReturnOrderLine")
      .select("itemId, salesReturnOrderId")
      .eq("id", returnLine.returnLineId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (
      !orderLine.data ||
      orderLine.data.salesReturnOrderId !== returnLine.returnOrderId
    ) {
      return ctx.error(
        "validation",
        "Return line does not belong to this receipt's return order"
      );
    }
    if (entity.data.itemId !== orderLine.data.itemId) {
      return ctx.error(
        "validation",
        "Entity is a different item than this return line"
      );
    }

    const attributes = (entity.data.attributes ?? {}) as Record<
      string,
      unknown
    >;
    const returnOrder = await client
      .from("salesReturnOrder")
      .select("customerId")
      .eq("id", orderLine.data.salesReturnOrderId)
      .eq("companyId", companyId)
      .maybeSingle();
    const shipmentId = attributes.Shipment;
    const shippedToCustomer =
      returnOrder.data?.customerId && typeof shipmentId === "string"
        ? await client
            .from("shipment")
            .select("id")
            .eq("id", shipmentId)
            .eq("companyId", companyId)
            .eq("customerId", returnOrder.data.customerId)
            .eq("status", "Posted")
            .maybeSingle()
        : { data: null };
    if (!shippedToCustomer.data) {
      return ctx.error("rule", "Entity was not shipped to this customer");
    }

    // Overwriting another OPEN return receipt's claim would strip a validated
    // assignment off it. A Consumed entity still carrying its original
    // purchase receipt's attributes is fine.
    const claimedLine = attributes["Receipt Line"];
    if (typeof claimedLine === "string" && claimedLine !== receiptLineId) {
      const otherLine = await client
        .from("receiptLine")
        .select("receiptId")
        .eq("id", claimedLine)
        .eq("companyId", companyId)
        .maybeSingle();
      const otherReceipt = otherLine.data?.receiptId
        ? await client
            .from("receipt")
            .select("id, receiptId, sourceDocument, status")
            .eq("id", otherLine.data.receiptId)
            .eq("companyId", companyId)
            .maybeSingle()
        : { data: null };
      if (
        otherReceipt.data &&
        otherReceipt.data.id !== receiptId &&
        otherReceipt.data.sourceDocument === "Sales Return Order" &&
        otherReceipt.data.status === "Draft"
      ) {
        return ctx.error(
          "conflict",
          `Entity is already assigned on receipt ${otherReceipt.data.receiptId}. Remove it there first.`
        );
      }
    }

    const serviceRole = ctx.asSystem.supabase;
    // Clear the slot on any other entity occupying it.
    const stale = await client
      .from("trackedEntity")
      .select("id, attributes")
      .eq("attributes ->> Receipt Line", receiptLineId)
      .eq("companyId", companyId)
      .neq("id", trackedEntityId);
    for (const staleEntity of stale.data ?? []) {
      const staleAttributes = (staleEntity.attributes ?? {}) as Record<
        string,
        unknown
      >;
      const staleIndex = staleAttributes["Receipt Line Index"];
      if (index != null && staleIndex !== index && staleIndex !== undefined) {
        continue;
      }
      await serviceRole
        .from("trackedEntity")
        .update({
          attributes: service.withoutReceiptTracking(staleAttributes) as Json
        })
        .eq("id", staleEntity.id)
        .eq("companyId", companyId);
    }

    const assigned = await serviceRole
      .from("trackedEntity")
      .update({
        attributes: {
          ...service.withoutReceiptTracking(attributes),
          Receipt: receiptId,
          "Receipt Line": receiptLineId,
          ...(index != null ? { "Receipt Line Index": index } : {})
        } as Json
      })
      .eq("id", trackedEntityId)
      .eq("companyId", companyId);
    if (assigned.error) {
      return ctx.error("internal", "Failed to update tracking", assigned.error);
    }
    return { trackedEntityId };
  }
});

/**
 * Remove a returned tracked entity from a sales-return receipt line.
 *
 * @remarks
 * Clears the receipt tracking the entity carries, only when it points at
 * this receipt line: another receipt's assignment is refused.
 *
 * @mcp
 */
export const removeReceiptReturnEntity = defineServiceFn({
  input: z.object({
    receiptId: z.string(),
    receiptLineId: z.string(),
    trackedEntityId: z.string()
  }),
  permission: { create: "inventory" },

  async run(ctx, { receiptId, receiptLineId, trackedEntityId }) {
    const [returnLine, entity, receipt] = await Promise.all([
      service.returnReceiptLineOf(ctx, { receiptId, receiptLineId }),
      ctx.asCaller.supabase
        .from("trackedEntity")
        .select("id, attributes")
        .eq("id", trackedEntityId)
        .eq("companyId", ctx.company.id)
        .maybeSingle(),
      ctx.asCaller.supabase
        .from("receipt")
        .select("status")
        .eq("id", receiptId)
        .eq("companyId", ctx.company.id)
        .maybeSingle()
    ]);
    if (returnLine instanceof Error) return returnLine;
    if (receipt.data?.status !== "Draft") {
      return ctx.error("rule", RECEIPT_LOCKED);
    }
    if (!entity.data) {
      return ctx.error("validation", "Tracked entity not found");
    }

    const attributes = (entity.data.attributes ?? {}) as Record<
      string,
      unknown
    >;
    if (attributes["Receipt Line"] !== receiptLineId) {
      return ctx.error("rule", "Entity is not assigned to this receipt line");
    }

    const cleared = await ctx.asSystem.supabase
      .from("trackedEntity")
      .update({
        attributes: service.withoutReceiptTracking(attributes) as Json
      })
      .eq("id", trackedEntityId)
      .eq("companyId", ctx.company.id);
    if (cleared.error) {
      return ctx.error("internal", "Failed to update tracking", cleared.error);
    }
    return { trackedEntityId };
  }
});

// ---------------------------------------------------------------------------
// Shipments
// ---------------------------------------------------------------------------

const SHIPMENT_NOT_FOUND = "Shipment not found";
const SHIPMENT_LOCKED = "A posted shipment can no longer be changed";
const NO_DEFAULT_LOCATION =
  "Set a default location in your settings before creating a shipment";

type ExpiredEntityPolicy = "Warn" | "Block" | "BlockWithOverride";

/**
 * Create a shipment.
 *
 * @remarks
 * From its source document, with its lines: a sales order, a sales return
 * order, a purchase order, a purchase return order, an outbound warehouse
 * transfer or a rental agreement. With no source document it creates an
 * empty shipment. The location is the caller's default location, which a
 * sales order or purchase order shipment requires.
 *
 * A return order or rental agreement with a Draft shipment already returns
 * that shipment instead of a second one.
 *
 * @mcp
 */
export const createShipment = defineServiceFn({
  input: z.object({
    sourceDocument: z.enum(shipmentSourceDocumentType).optional(),
    sourceDocumentId: z.string().default("")
  }),
  permission: { create: "inventory" },

  async run(ctx, { sourceDocument, sourceDocumentId }) {
    const locationId = await service.defaultLocationOf(ctx);

    if (
      !locationId &&
      (sourceDocument === "Sales Order" || sourceDocument === "Purchase Order")
    ) {
      return ctx.error("rule", NO_DEFAULT_LOCATION);
    }

    // One open draft per return order or agreement: a second Ship goes to
    // the existing draft instead of stacking up duplicates.
    if (
      sourceDocument === "Sales Return Order" ||
      sourceDocument === "Purchase Return Order" ||
      sourceDocument === "Rental Agreement"
    ) {
      const existing = await ctx.asCaller.supabase
        .from("shipment")
        .select("id")
        .eq("sourceDocument", sourceDocument)
        .eq("sourceDocumentId", sourceDocumentId)
        .eq("status", "Draft")
        .eq("companyId", ctx.company.id)
        .order("createdAt", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing.error) {
        return ctx.error(
          "internal",
          "Failed to check for an existing shipment",
          existing.error
        );
      }
      if (existing.data) return { id: existing.data.id };
    }

    const created = await (() => {
      switch (sourceDocument) {
        case "Sales Order":
          return invokeCreate(ctx, {
            type: "shipmentFromSalesOrder",
            locationId: locationId!,
            salesOrderId: sourceDocumentId,
            shipmentId: undefined
          });
        case "Sales Return Order":
          return invokeCreate(ctx, {
            type: "shipmentFromSalesReturnOrder",
            locationId,
            salesReturnOrderId: sourceDocumentId,
            shipmentId: undefined
          });
        case "Purchase Return Order":
          return invokeCreate(ctx, {
            type: "shipmentFromPurchaseReturnOrder",
            locationId,
            purchaseReturnOrderId: sourceDocumentId,
            shipmentId: undefined
          });
        case "Purchase Order":
          return invokeCreate(ctx, {
            type: "shipmentFromPurchaseOrder",
            locationId: locationId!,
            purchaseOrderId: sourceDocumentId,
            shipmentId: undefined
          });
        case "Outbound Transfer":
          return invokeCreate(ctx, {
            type: "shipmentFromWarehouseTransfer",
            warehouseTransferId: sourceDocumentId,
            shipmentId: undefined
          });
        case "Rental Agreement":
          return invokeCreate(ctx, {
            type: "shipmentFromRentalAgreement",
            rentalAgreementId: sourceDocumentId
          });
        default:
          return invokeCreate(ctx, {
            type: "shipmentDefault",
            locationId
          });
      }
    })();
    if (created.error || !created.data) {
      return service.serverFnFailure(
        ctx,
        created.error,
        getErrorMessage(created.error, "Failed to create shipment")
      );
    }
    return { id: created.data.id };
  }
});

/**
 * Update a shipment's details.
 *
 * @remarks
 * A changed source document or location rebuilds the shipment's lines from
 * the new source (a sales order, a sales return order, a purchase order, a
 * purchase return order or an outbound transfer), and is refused once the
 * shipment is not Draft. Otherwise the fields are saved as sent. A rental
 * shipment keeps its rental agreement: changing it is refused.
 *
 * @mcp
 */
export const updateShipment = defineServiceFn({
  input: z.object({
    id: z.string(),
    shipmentId: z.string().min(1),
    locationId: z.string().optional(),
    sourceDocument: z.enum(shipmentSourceDocumentType).optional(),
    sourceDocumentId: z.string().min(1),
    trackingNumber: z.string().optional(),
    shippingMethodId: z.string().optional(),
    sourceDocumentReadableId: z.string().optional(),
    customerId: z.string().optional(),
    customFields: customFieldsInput
  }),
  permission: { update: "inventory" },

  async run(ctx, { id, ...shipment }) {
    const current = await ctx.asCaller.supabase
      .from("shipment")
      .select("sourceDocument, sourceDocumentId, locationId, status")
      .eq("id", id)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (current.error) {
      return ctx.error("internal", "Failed to load shipment", current.error);
    }
    if (!current.data) return ctx.error("notFound", SHIPMENT_NOT_FOUND);

    const sourceChanged =
      current.data.sourceDocument !== shipment.sourceDocument ||
      current.data.sourceDocumentId !== shipment.sourceDocumentId;
    const isRental =
      current.data.sourceDocument === "Rental Agreement" ||
      shipment.sourceDocument === "Rental Agreement";
    if (isRental && sourceChanged) {
      return ctx.error(
        "rule",
        "A rental shipment keeps its rental agreement. Create it from the agreement."
      );
    }

    const rebuild =
      !isRental &&
      (sourceChanged || current.data.locationId !== shipment.locationId);
    // A rebuild replaces the lines: on a posted shipment, the posted ones.
    if (rebuild && current.data.status !== "Draft") {
      return ctx.error(
        "rule",
        "Only a Draft shipment can change its source document or location"
      );
    }
    if (!rebuild) {
      const updated = await service.upsertShipment(ctx.asCaller.supabase, {
        id,
        ...shipment,
        updatedBy: ctx.auditUserId
      });
      if (updated.error) {
        return ctx.error(
          "internal",
          "Failed to update shipment",
          updated.error
        );
      }
      return { id };
    }

    const { locationId, sourceDocumentId } = shipment;
    const created = await (() => {
      switch (shipment.sourceDocument) {
        case "Sales Order":
          return invokeCreate(ctx, {
            type: "shipmentFromSalesOrder",
            locationId: locationId as string,
            salesOrderId: sourceDocumentId,
            shipmentId: id
          });
        case "Sales Return Order":
          return invokeCreate(ctx, {
            type: "shipmentFromSalesReturnOrder",
            locationId,
            salesReturnOrderId: sourceDocumentId,
            shipmentId: id
          });
        case "Purchase Return Order":
          return invokeCreate(ctx, {
            type: "shipmentFromPurchaseReturnOrder",
            locationId,
            purchaseReturnOrderId: sourceDocumentId,
            shipmentId: id
          });
        case "Purchase Order":
          return invokeCreate(ctx, {
            type: "shipmentFromPurchaseOrder",
            locationId: locationId as string,
            purchaseOrderId: sourceDocumentId,
            shipmentId: id
          });
        case "Outbound Transfer":
          return invokeCreate(ctx, {
            type: "shipmentFromWarehouseTransfer",
            warehouseTransferId: sourceDocumentId,
            shipmentId: id
          });
        default:
          return null;
      }
    })();
    if (!created) {
      return ctx.error(
        "validation",
        `Unsupported source document: ${shipment.sourceDocument}`
      );
    }
    if (created.error || !created.data) {
      return service.serverFnFailure(
        ctx,
        created.error,
        getErrorMessage(created.error, "Failed to create shipment")
      );
    }
    return { id };
  }
});
/**
 * Post a shipment.
 *
 * @remarks
 * In order:
 *   1. Storage rules run on the `shipment` and `pick` surfaces (and
 *      `warehouseTransfer` for an outbound transfer), and a sales order
 *      shipment runs its order's sales rules on the lines shipped. A
 *      blocking rule returns its `violations` and `ruleNames` and changes
 *      nothing (a blocked sales rule is recorded on the order); send
 *      `acknowledged: true` to post past warnings.
 *   2. Expired batches on the shipment: the company's expired-entity policy
 *      refuses the post (`Block`, `BlockWithOverride`), or posts it with a
 *      `warning` (`Warn`). Expiry is judged on the shipping location's
 *      calendar.
 *   3. The shipment is set Pending (only from Draft or Pending: `conflict`
 *      otherwise). A sales order shipment saves its packing slip on the
 *      order's opportunity.
 *   4. The shipment is posted: ledger entries, cost of goods, the journal and
 *      tracked entities. A failed post sets it back to Draft.
 *   5. Labels print when the shipping printer auto-prints (and for batches
 *      the post split), acknowledged sales rules are recorded on the order,
 *      and the shipment-posted workflow moment is raised.
 *
 * `postingDate` dates a rental delivery; every other shipment posts today.
 * `locale` formats the packing slip.
 *
 * @mcp
 */
export const postShipment = defineServiceFn({
  input: z.object({
    shipmentId: z.string(),
    acknowledged: z.boolean().default(false),
    postingDate: z.string().optional(),
    locale: z.string().default("en-US")
  }),
  permission: { update: "inventory" },

  async run(ctx, { shipmentId, acknowledged, postingDate, locale }) {
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const serviceRole = ctx.asSystem.supabase;

    const [lines, shipment] = await Promise.all([
      serviceRole
        .from("shipmentLine")
        .select(
          "id, lineId, itemId, storageUnitId, shippedQuantity, locationId, shipmentId"
        )
        .eq("shipmentId", shipmentId)
        .eq("companyId", companyId),
      serviceRole
        .from("shipment")
        .select("sourceDocument, sourceDocumentId, locationId")
        .eq("id", shipmentId)
        .eq("companyId", companyId)
        .maybeSingle()
    ]);
    // Everything below reads as the system by shipment id, so a shipment
    // outside this company stops here.
    if (!shipment.data) {
      logger.error("Shipment not found for company", { companyId, shipmentId });
      return ctx.error("notFound", SHIPMENT_NOT_FOUND);
    }

    const isTransfer = shipment.data.sourceDocument === "Outbound Transfer";
    const rules = await service.storageRuleViolations(
      ctx,
      isTransfer
        ? ["shipment", "warehouseTransfer", "pick", "warehouseTransfer"]
        : ["shipment", "pick"],
      (lines.data ?? []).map((line) => ({
        lineId: line.id,
        itemId: line.itemId,
        storageUnitId: line.storageUnitId,
        quantity: Number(line.shippedQuantity ?? 0),
        locationId: line.locationId
      }))
    );

    // Sales rules have no shipment surface: the order's lines are evaluated
    // as `salesOrderLine`, at THIS shipment's quantities (an unshipped
    // violating line must not block a partial shipment of a clean one), for
    // the order's resolved ship-to.
    const salesOrderId =
      shipment.data.sourceDocument === "Sales Order"
        ? shipment.data.sourceDocumentId
        : null;
    let salesViolations: Violation[] = [];
    if (salesOrderId) {
      const shipTo = await resolveSalesOrderShipTo(
        serviceRole,
        salesOrderId,
        companyId
      );
      const sales = await evaluateSalesRuleLines({
        client: serviceRole,
        companyId,
        userId,
        surface: "salesOrderLine",
        lines: (lines.data ?? [])
          .filter((line) => !!line.itemId && Number(line.shippedQuantity) > 0)
          .map((line) => ({
            // The order line, when linked, so the evidence lands on it.
            lineId: line.lineId ?? line.id,
            itemId: line.itemId as string,
            quantity: Number(line.shippedQuantity)
          })),
        customerId: shipTo.customerId,
        customerLocationId: shipTo.customerLocationId
      });
      salesViolations = dedupeViolations(sales.violations);
      rules.violations.push(...sales.violations);
      Object.assign(rules.ruleNames, sales.ruleNames);
    }

    // Evidence covers the SALES violations only, attributed to the order. A
    // post blocked by any violation records its sales violations as blocked;
    // acknowledged ones wait until the post has committed.
    const violations = dedupeViolations(rules.violations);
    if (violations.length > 0 && isBlocked(violations, acknowledged)) {
      if (salesViolations.length > 0 && salesOrderId) {
        await recordSalesRuleOutcome(serviceRole, {
          companyId,
          userId,
          documentType: "salesOrder",
          documentId: salesOrderId,
          outcome: "blocked",
          violations: salesViolations,
          ruleNames: rules.ruleNames
        });
      }
      return { violations, ruleNames: rules.ruleNames } satisfies Blocked;
    }

    // Expired batches, as post-stock-transfer and issue judge them.
    const [settings, entities] = await Promise.all([
      serviceRole
        .from("companySettings")
        .select("inventoryShelfLife")
        .eq("id", companyId)
        .single(),
      serviceRole
        .from("trackedEntity")
        .select("id, readableId, expirationDate")
        .eq("attributes ->> Shipment", shipmentId)
        .eq("companyId", companyId)
    ]);
    const policy: ExpiredEntityPolicy =
      (
        settings.data?.inventoryShelfLife as {
          expiredEntityPolicy?: ExpiredEntityPolicy;
        } | null
      )?.expiredEntityPolicy ?? "Block";
    // The shipping site's calendar: a lot that expires today must not read
    // as expired at a plant still on yesterday.
    const today = datetime.today(
      shipment.data.locationId
        ? await getLocationTimeZone(
            serviceRole,
            shipment.data.locationId,
            companyId
          )
        : await getCompanyTimeZone(serviceRole, companyId)
    );
    const expired = (entities.data ?? []).filter((entity) => {
      if (!entity.expirationDate) return false;
      try {
        return parseDate(entity.expirationDate).compare(today) < 0;
      } catch {
        return false;
      }
    });
    let warning: string | null = null;
    if (expired.length > 0) {
      const ids = expired.map((e) => e.readableId ?? e.id).join(", ");
      const batches = expired.length === 1 ? "batch" : "batches";
      if (policy === "Block" || policy === "BlockWithOverride") {
        return ctx.error(
          "rule",
          `Cannot post shipment with expired ${batches}: ${ids}`
        );
      }
      warning = `Posted shipment with expired ${batches}: ${ids}`;
    }

    const pending = await ctx.asCaller.supabase
      .from("shipment")
      .update({ status: "Pending" })
      .eq("id", shipmentId)
      .eq("companyId", companyId)
      .in("status", ["Draft", "Pending"])
      .select("id");
    if (pending.error) {
      return ctx.error("internal", "Failed to post shipment", pending.error);
    }
    if (!pending.data?.length) {
      return ctx.error(
        "conflict",
        "This shipment has already been posted or voided"
      );
    }

    // Only from Pending: a concurrent post that won must stay Posted.
    const backToDraft = () =>
      ctx.asCaller.supabase
        .from("shipment")
        .update({ status: "Draft" })
        .eq("id", shipmentId)
        .eq("companyId", companyId)
        .eq("status", "Pending");

    let failure: CarbonError | null = null;
    let splitEntityIds: string[] = [];
    try {
      await service.savePackingSlip(ctx, { shipmentId, locale });
      const posted = await invokePosting(
        ctx,
        "post-shipment",
        {
          type: "post",
          shipmentId,
          postingDate
        },
        service.postShipment
      );
      if (posted.error) {
        await backToDraft();
        return service.serverFnFailure(
          ctx,
          posted.error,
          "Failed to post shipment"
        );
      }
      splitEntityIds = posted.data?.splitEntityIds ?? [];
    } catch (thrown) {
      await backToDraft();
      failure = ctx.error("internal", "Failed to post shipment", thrown);
    }

    if (!failure) {
      await service.autoPrint(ctx, {
        sourceDocument: "Shipment",
        sourceDocumentId: shipmentId,
        locationId: shipment.data.locationId,
        context: "shipping"
      });
      // The RETAINED shelf lots of a batch split are reprinted: their
      // quantity changed. The shipped child left Consumed and gets no label.
      await service.printEntityLabels(ctx, splitEntityIds);
    }

    // Raised after a rollback to Draft too: when workflows fire is its own
    // decision (#1294), unchanged here.
    await raiseMoment("inventory.shipmentPosted", {
      outputs: { shipment: { id: shipmentId }, postedBy: { id: userId } },
      companyId,
      actorId: userId
    });

    if (failure) return failure;
    // Acknowledged-override evidence only once the post has stuck.
    if (salesViolations.length > 0 && salesOrderId) {
      await recordSalesRuleOutcome(serviceRole, {
        companyId,
        userId,
        documentType: "salesOrder",
        documentId: salesOrderId,
        outcome: "acknowledged",
        violations: salesViolations,
        ruleNames: rules.ruleNames
      });
    }
    trackWorkEvent("shipment_posted", {
      companyId,
      userId,
      shipmentId,
      sourceDocument: shipment.data.sourceDocument ?? null
    });
    return { warning };
  }
});

/**
 * Void a posted shipment.
 *
 * @remarks
 * Reverses its inventory movements and journal entries and restores its
 * tracked entities and the source document's shipped quantities. Only a
 * Posted shipment can be voided.
 *
 * @mcp destructive
 */
export const voidShipment = defineServiceFn({
  input: z.object({ shipmentId: z.string() }),
  permission: { update: "inventory" },

  async run(ctx, { shipmentId }) {
    const shipment = await ctx.asCaller.supabase
      .from("shipment")
      .select("status")
      .eq("id", shipmentId)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (shipment.error) {
      return ctx.error("internal", "Failed to void shipment", shipment.error);
    }
    if (!shipment.data) return ctx.error("notFound", SHIPMENT_NOT_FOUND);
    if (shipment.data.status !== "Posted") {
      return ctx.error("rule", "Can only void posted shipments");
    }

    const voided = await invokePosting(
      ctx,
      "post-shipment",
      {
        type: "void",
        shipmentId
      },
      service.postShipment
    );
    if (voided.error) {
      return service.serverFnFailure(
        ctx,
        voided.error,
        "Failed to void shipment"
      );
    }
    return { shipmentId };
  }
});

/**
 * Split a shipment line in two.
 *
 * @remarks
 * Moves `quantity` of the line onto a new line of the same shipment, so the
 * two can come from different storage units or carry different tracking.
 *
 * @mcp
 */
export const splitShipmentLine = defineServiceFn({
  input: z.object({
    shipmentId: z.string().min(1),
    shipmentLineId: z.string().min(1),
    locationId: z.string().min(1),
    quantity: z.number()
  }),
  permission: { update: "inventory" },

  async run(ctx, { shipmentId, shipmentLineId, locationId, quantity }) {
    const line = await ctx.asCaller.supabase
      .from("shipmentLine")
      .select("id, shipment!shipmentLine_shipmentId_fkey(status)")
      .eq("id", shipmentLineId)
      .eq("shipmentId", shipmentId)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (line.error) {
      return ctx.error("internal", "Failed to split line", line.error);
    }
    if (!line.data?.shipment) {
      return ctx.error("notFound", "The shipment line could not be found");
    }
    if (line.data.shipment.status !== "Draft") {
      return ctx.error("rule", SHIPMENT_LOCKED);
    }

    const split = await invokeCreate(ctx, {
      type: "shipmentLineSplit",
      locationId,
      shipmentId,
      shipmentLineId,
      quantity
    });
    if (split.error) {
      return service.serverFnFailure(ctx, split.error, "Failed to split line");
    }
    return { shipmentLineId };
  }
});

/**
 * Set one field on shipment lines.
 *
 * @remarks
 * `storageUnitId` or `shippedQuantity`, on every line in `ids`. An empty
 * value clears the field. Storage rules run when the shipment is posted, not
 * here.
 *
 * @mcp
 */
export const updateShipmentLines = defineServiceFn({
  input: z.object({
    ids: z.array(z.string()).min(1),
    field: z.enum(["storageUnitId", "shippedQuantity"]),
    value: z.string().nullable()
  }),
  permission: { update: "inventory" },

  async run(ctx, { ids, field, value }) {
    const lines = await ctx.asCaller.supabase
      .from("shipmentLine")
      .select("id, shipment!shipmentLine_shipmentId_fkey(status)")
      .in("id", ids)
      .eq("companyId", ctx.company.id);
    if (lines.error) {
      return ctx.error(
        "internal",
        "Failed to load shipment lines",
        lines.error
      );
    }
    if (lines.data.length !== new Set(ids).size) {
      return ctx.error("notFound", "The shipment line could not be found");
    }
    if (lines.data.some((line) => line.shipment?.status !== "Draft")) {
      return ctx.error("rule", SHIPMENT_LOCKED);
    }

    const update = await ctx.asCaller.supabase
      .from("shipmentLine")
      .update({
        ...(field === "storageUnitId"
          ? { storageUnitId: value || null }
          : { shippedQuantity: Number(value || 0) }),
        updatedBy: ctx.auditUserId,
        updatedAt: datetime.timestamp()
      })
      .in("id", ids)
      .eq("companyId", ctx.company.id);
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to update shipment lines",
        update.error
      );
    }
    return { ids };
  }
});

/**
 * Update one field of a fixed-asset line on a shipment.
 *
 * @remarks
 * `shipped`, `serialNumber` or `meter` (a rental unit's meter out). A posted
 * or voided shipment is a record: its lines no longer change.
 *
 * @mcp
 */
export const updateShipmentFixedAssetLine = defineServiceFn({
  input: shipmentFixedAssetLineUpdateValidator,
  permission: { update: "inventory" },

  async run(ctx, { id, ...change }) {
    const serviceRole = ctx.asSystem.supabase;
    const line = await serviceRole
      .from("shipmentFixedAssetLine")
      .select("shipment!shipmentFixedAssetLine_shipmentId_fkey(status)")
      .eq("id", id)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (line.error || !line.data?.shipment) {
      return ctx.error("notFound", "The shipment line could not be found");
    }
    if (line.data.shipment.status !== "Draft") {
      return ctx.error("rule", "A posted shipment can no longer be changed");
    }

    const update = await serviceRole
      .from("shipmentFixedAssetLine")
      .update({
        ...(change.field === "shipped"
          ? { shipped: change.value === "true" }
          : change.field === "serialNumber"
            ? { serialNumber: change.value || null }
            : { meter: change.value === "" ? null : Number(change.value) }),
        updatedBy: ctx.auditUserId
      })
      .eq("id", id)
      .eq("companyId", ctx.company.id);
    if (update.error) {
      return ctx.error("internal", "Failed to update the line", update.error);
    }
    return { id };
  }
});

/**
 * Assign a tracked entity to a shipment line.
 *
 * @remarks
 * Tags the batch, or the serial unit at `index`, with the shipment line;
 * posting ships it. The entity must be the line's item and Available (On
 * Hold for a return-to-customer shipment, and then it must have come back on
 * a receipt of that return order). A batch must hold at least `quantity`.
 * Whatever entity held the slot before is cleared once the new one is set.
 *
 * @mcp
 */
export const assignShipmentLineEntity = defineServiceFn({
  input: z.discriminatedUnion("trackingType", [
    z.object({
      trackingType: z.literal("batch"),
      shipmentId: z.string(),
      shipmentLineId: z.string(),
      trackedEntityId: z.string(),
      quantity: z.number()
    }),
    z.object({
      trackingType: z.literal("serial"),
      shipmentId: z.string(),
      shipmentLineId: z.string(),
      trackedEntityId: z.string(),
      index: z.number().int().min(0)
    })
  ]),
  permission: { create: "inventory" },

  async run(ctx, input) {
    const { shipmentId, shipmentLineId, trackedEntityId } = input;
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    // The LINE's item, never the caller's, is what the entity must match.
    const [entity, shipment, line] = await Promise.all([
      client
        .from("trackedEntity")
        .select("*")
        .eq("id", trackedEntityId)
        .eq("companyId", companyId)
        .single(),
      client
        .from("shipment")
        .select("sourceDocument, sourceDocumentId, status")
        .eq("id", shipmentId)
        .eq("companyId", companyId)
        .single(),
      client
        .from("shipmentLine")
        .select("itemId")
        .eq("id", shipmentLineId)
        .eq("shipmentId", shipmentId)
        .eq("companyId", companyId)
        .single()
    ]);
    if (entity.error) {
      return ctx.error("notFound", "Tracked entity not found", entity.error);
    }
    // A failed lookup must not fall back to "Available": that would refuse a
    // legitimate On Hold return-to-customer assignment.
    if (shipment.error) {
      return ctx.error("internal", "Failed to load shipment", shipment.error);
    }
    if (shipment.data.status !== "Draft") {
      return ctx.error("rule", SHIPMENT_LOCKED);
    }
    if (line.error) {
      return ctx.error("internal", "Failed to load shipment line", line.error);
    }
    if (
      entity.data.itemId &&
      line.data.itemId &&
      entity.data.itemId !== line.data.itemId
    ) {
      return ctx.error(
        "validation",
        "Tracked entity does not match the line's item"
      );
    }

    // A return-to-customer shipment ships returned stock, On Hold until it
    // is dispositioned; everything else ships Available stock only. On Hold
    // alone is not provenance: the entity must have COME BACK on a receipt
    // of this return order.
    const isReturn = shipment.data.sourceDocument === "Sales Return Order";
    const allowedStatus = isReturn ? "On Hold" : "Available";
    const attributes = (entity.data.attributes ?? {}) as Record<
      string,
      unknown
    >;
    if (isReturn) {
      const receiptId = attributes.Receipt;
      const provenance =
        typeof receiptId === "string"
          ? await client
              .from("receipt")
              .select("id")
              .eq("id", receiptId)
              .eq("sourceDocument", "Sales Return Order")
              .eq("sourceDocumentId", shipment.data.sourceDocumentId ?? "")
              .eq("companyId", companyId)
              .maybeSingle()
          : { data: null, error: null };
      if (provenance.error) {
        return ctx.error(
          "internal",
          "Failed to verify the entity's provenance",
          provenance.error
        );
      }
      if (!provenance.data) {
        return ctx.error(
          "rule",
          "Tracked entity was not received on this return order and cannot ship back on it"
        );
      }
    }

    if (entity.data.status !== allowedStatus) {
      return ctx.error(
        "rule",
        `Tracked entity is not available. Current status: ${entity.data.status}`
      );
    }

    // Rounded: a lot left holding 0.020000000000000018 by an earlier split
    // has enough for a 0.02 assignment.
    if (
      input.trackingType === "batch" &&
      round(entity.data.quantity) < round(input.quantity)
    ) {
      return ctx.error("rule", "Batch has insufficient quantity");
    }

    const serviceRole = ctx.asSystem.supabase;
    const updated = await serviceRole
      .from("trackedEntity")
      .update({
        attributes: {
          ...attributes,
          "Shipment Line": shipmentLineId,
          Shipment: shipmentId,
          ...(input.trackingType === "serial"
            ? { "Shipment Line Index": input.index }
            : {})
        } as Json
      })
      .eq("id", trackedEntityId)
      .eq("companyId", companyId)
      // Guards a concurrent status change: no row matched is a conflict.
      .eq("status", allowedStatus)
      .select("id");
    if (updated.error) {
      return ctx.error(
        "internal",
        "Failed to assign the tracked entity",
        updated.error
      );
    }
    if (!updated.data?.length) {
      return ctx.error(
        "conflict",
        `Tracked entity is no longer ${allowedStatus}`
      );
    }

    // Only now is the slot's previous entity cleared: for a batch any other
    // entity on the line, for a serial the one at this index.
    let staleQuery = serviceRole
      .from("trackedEntity")
      .select("id, attributes")
      .eq("companyId", companyId)
      .eq("attributes ->> Shipment Line", shipmentLineId)
      .neq("id", trackedEntityId);
    if (input.trackingType === "serial") {
      staleQuery = staleQuery.eq(
        "attributes ->> Shipment Line Index",
        String(input.index)
      );
    }
    const stale = await staleQuery;
    await Promise.all(
      (stale.data ?? []).map((row) => {
        const {
          "Shipment Line": _line,
          Shipment: _shipment,
          "Shipment Line Index": _index,
          ...cleaned
        } = (row.attributes ?? {}) as Record<string, unknown>;
        return serviceRole
          .from("trackedEntity")
          .update({ attributes: cleaned as Json })
          .eq("id", row.id)
          .eq("companyId", companyId);
      })
    );

    return { trackedEntityId };
  }
});

// ---------------------------------------------------------------------------
// Stock transfers
// ---------------------------------------------------------------------------

/**
 * Create a stock transfer.
 *
 * @remarks
 * Moves stock between storage units of one location. The transfer is created
 * Released, so storage rules run on the `stockTransfer` surface against each
 * line's destination before it exists: a blocking rule returns its
 * `violations` and `ruleNames` and creates nothing; send `acknowledged: true`
 * to create past warnings. A serial-tracked line of N units becomes N lines
 * of one.
 *
 * @mcp
 */
export const createStockTransfer = defineServiceFn({
  input: z.object({
    locationId: z.string().min(1),
    lines: z
      .array(
        z.object({
          itemId: z.string().min(1),
          fromStorageUnitId: z.string().nullish(),
          toStorageUnitId: z.string().nullish(),
          quantity: z.number().min(0).optional(),
          requiresSerialTracking: z.boolean().optional(),
          requiresBatchTracking: z.boolean().optional()
        })
      )
      .min(1),
    acknowledged: z.boolean().default(false),
    customFields: customFieldsInput
  }),
  permission: { create: "inventory" },

  async run(ctx, { locationId, lines, acknowledged, customFields }) {
    const rules = await service.storageRuleViolations(
      ctx,
      ["stockTransfer"],
      lines.map((line, i) => ({
        lineId: `pending-${i}`,
        itemId: line.itemId,
        storageUnitId: line.toStorageUnitId ?? null,
        quantity: Number(line.quantity ?? 0),
        locationId
      }))
    );
    if (
      rules.violations.length > 0 &&
      isBlocked(rules.violations, acknowledged)
    ) {
      return rules satisfies Blocked;
    }

    const created = await service.insertStockTransfer(ctx.asCaller.supabase, {
      locationId,
      lines,
      companyId: ctx.company.id,
      createdBy: ctx.auditUserId,
      customFields
    });
    if (created.error || !created.data) {
      return ctx.error(
        "internal",
        "Failed to create stock transfer",
        created.error
      );
    }
    return created.data;
  }
});

/**
 * Set a stock transfer's status.
 *
 * @remarks
 * Released and Completed commit the transfer plan: storage rules run on the
 * `stockTransfer` surface against each line's destination, and a blocking
 * rule returns its `violations` and `ruleNames` and changes nothing (send
 * `acknowledged: true` to continue past warnings). Reopening a Completed
 * transfer needs the inventory `delete` permission. Completing it clears the
 * assignee and stamps the completion time.
 *
 * @mcp
 */
export const setStockTransferStatus = defineServiceFn({
  input: z.object({
    id: z.string(),
    status: z.enum(stockTransferStatusType),
    acknowledged: z.boolean().default(false)
  }),
  permission: { update: "inventory" },

  async run(ctx, { id, status, acknowledged }) {
    const current = await ctx.asCaller.supabase
      .from("stockTransfer")
      .select("status")
      .eq("id", id)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (current.error) {
      return ctx.error(
        "internal",
        "Failed to load stock transfer",
        current.error
      );
    }
    if (!current.data) {
      return ctx.error("notFound", "The stock transfer could not be found");
    }
    // Reopening unlocks completed inventory moves.
    if (
      status !== "Completed" &&
      current.data.status === "Completed" &&
      !ctx.can({ delete: "inventory" })
    ) {
      return ctx.error(
        "forbidden",
        "Reopening a completed stock transfer needs the inventory delete permission"
      );
    }

    // Released is the commitment to the plan; Completed is kept as a second
    // gate. Draft is editing and In Progress is set by picking.
    if (status === "Released" || status === "Completed") {
      const lines = await ctx.asSystem.supabase
        .from("stockTransferLine")
        .select("id, itemId, toStorageUnitId, quantity")
        .eq("stockTransferId", id)
        .eq("companyId", ctx.company.id);
      const rules = await service.storageRuleViolations(
        ctx,
        ["stockTransfer"],
        (lines.data ?? []).map((line) => ({
          lineId: line.id,
          itemId: line.itemId,
          storageUnitId: line.toStorageUnitId,
          quantity: Number(line.quantity ?? 0),
          locationId: null
        }))
      );
      if (
        rules.violations.length > 0 &&
        isBlocked(rules.violations, acknowledged)
      ) {
        return rules satisfies Blocked;
      }
    }

    const completed = status === "Completed";
    const update = await service.updateStockTransferStatus(
      ctx.asCaller.supabase,
      {
        id,
        status,
        assignee: completed ? null : undefined,
        completedAt: completed ? datetime.timestamp() : null,
        updatedBy: ctx.auditUserId
      }
    );
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to update stock transfer status",
        update.error
      );
    }
    return { id, status };
  }
});
/**
 * Pick a stock transfer line.
 *
 * @remarks
 * Moves `quantity` of the line's item from its source to its destination
 * storage unit. A serial- or batch-tracked line needs its `trackedEntityId`;
 * `pickStockTransferLineEntity` picks a scanned one. A Completed
 * transfer is refused.
 *
 * @mcp
 */
export const pickStockTransferLine = defineServiceFn({
  input: z.object({
    lineId: z.string(),
    quantity: z.number().positive(),
    locationId: z.string(),
    trackedEntityId: z.string().optional()
  }),
  permission: { create: "inventory" },

  async run(ctx, { lineId, quantity, locationId, trackedEntityId }) {
    const line = await service.stockTransferLineOf(ctx, lineId);
    if (line instanceof Error) return line;
    if (
      !trackedEntityId &&
      (line.requiresSerialTracking || line.requiresBatchTracking)
    ) {
      return ctx.error("validation", "Tracked entity not found");
    }
    return service.postStockTransferLine(
      ctx,
      {
        type: "inventory",
        stockTransferId: line.stockTransferId,
        stockTransferLineId: lineId,
        quantity,
        locationId,
        trackedEntityId
      },
      () => "Failed to pick line"
    );
  }
});

/**
 * Unpick a stock transfer line.
 *
 * @remarks
 * Moves the line's picked stock back to its source storage unit. A serial-
 * or batch-tracked line needs its `trackedEntityId`. A Completed transfer is
 * refused.
 *
 * @mcp
 */
export const unpickStockTransferLine = defineServiceFn({
  input: z.object({
    lineId: z.string(),
    locationId: z.string(),
    trackedEntityId: z.string().optional()
  }),
  permission: { create: "inventory" },

  async run(ctx, { lineId, locationId, trackedEntityId }) {
    const line = await service.stockTransferLineOf(ctx, lineId);
    if (line instanceof Error) return line;
    if (
      !trackedEntityId &&
      (line.requiresSerialTracking || line.requiresBatchTracking)
    ) {
      return ctx.error("validation", "Tracked entity not found");
    }
    return service.postStockTransferLine(
      ctx,
      {
        type: line.requiresSerialTracking
          ? "unpickSerial"
          : line.requiresBatchTracking
            ? "unpickBatch"
            : "unpickInventory",
        stockTransferId: line.stockTransferId,
        stockTransferLineId: lineId,
        quantity: 0,
        locationId,
        trackedEntityId
      },
      () => "Failed to pick line"
    );
  }
});

/**
 * Pick a scanned serial unit or batch for a stock transfer line.
 *
 * @remarks
 * A serial scan moves one unit; a batch scan moves `quantity` of it, which
 * may not exceed what the line still has to pick. Refused when the line is
 * already fully picked, when the entity is already picked, or when the
 * transfer is Completed.
 *
 * @mcp
 */
export const pickStockTransferLineEntity = defineServiceFn({
  input: z.object({
    lineId: z.string(),
    trackedEntityId: z.string().min(1),
    quantity: z.number().positive(),
    locationId: z.string().min(1)
  }),
  permission: { update: "inventory" },

  async run(ctx, { lineId, trackedEntityId, quantity, locationId }) {
    const line = await service.stockTransferLineOf(ctx, lineId);
    if (line instanceof Error) return line;

    const transferType = line.requiresBatchTracking ? "batch" : "serial";
    // The server function re-checks this under a row lock; refusing a full
    // line here saves the round trip and names the reason.
    const forward = resolveStockTransferPickForward({
      transferType,
      quantity,
      lineQuantity: Number(line.quantity ?? 0),
      pickedQuantity: Number(line.pickedQuantity ?? 0)
    });
    if (!forward.ok) return ctx.error("rule", forward.message);

    return service.postStockTransferLine(
      ctx,
      {
        type: transferType,
        stockTransferId: line.stockTransferId,
        stockTransferLineId: lineId,
        trackedEntityId,
        quantity: forward.quantity,
        locationId
      },
      // Its guard failures (over-pick, already picked) carry the reason.
      (error) => getErrorMessage(error, "Failed to pick line")
    );
  }
});

/**
 * Set one storage unit on stock transfer lines.
 *
 * @remarks
 * `fromStorageUnitId` or `toStorageUnitId`, on every line in `ids`. An empty
 * value clears it. A transfer that is not Draft is locked: reopen it first.
 * Storage rules run when the transfer is released, not here.
 *
 * @mcp
 */
export const updateStockTransferLines = defineServiceFn({
  input: z.object({
    ids: z.array(z.string()).min(1),
    field: z.enum(["fromStorageUnitId", "toStorageUnitId"]),
    value: z.string().nullable()
  }),
  permission: { update: "inventory" },

  async run(ctx, { ids, field, value }) {
    const lines = await ctx.asCaller.supabase
      .from("stockTransferLine")
      .select("id, stockTransfer(status)")
      .in("id", ids)
      .eq("companyId", ctx.company.id);
    if (lines.error) {
      return ctx.error(
        "internal",
        "Failed to load stock transfer lines",
        lines.error
      );
    }
    if (
      lines.data.some((line) =>
        isStockTransferLocked(line.stockTransfer?.status)
      )
    ) {
      return ctx.error("rule", service.STOCK_TRANSFER_LOCKED);
    }

    const update = await ctx.asCaller.supabase
      .from("stockTransferLine")
      .update({
        ...(field === "fromStorageUnitId"
          ? { fromStorageUnitId: value || null }
          : { toStorageUnitId: value || null }),
        updatedBy: ctx.auditUserId,
        updatedAt: datetime.timestamp()
      })
      .in("id", ids)
      .eq("companyId", ctx.company.id);
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to update stock transfer lines",
        update.error
      );
    }
    return { ids };
  }
});

// ---------------------------------------------------------------------------
// Warehouse transfers
// ---------------------------------------------------------------------------
/** Every status but these commits the transfer plan. */
const WAREHOUSE_TRANSFER_COMMITS = new Set<string>([
  "To Ship and Receive",
  "To Ship",
  "To Receive",
  "Completed"
]);

/**
 * Set a warehouse transfer's status.
 *
 * @remarks
 * Confirming, shipping, receiving or completing commits the transfer plan:
 * storage rules run on the `warehouseTransfer` surface against each line's
 * destination, and a blocking rule returns its `violations` and `ruleNames`
 * and changes nothing (send `acknowledged: true` to continue past warnings).
 * Draft (reopen) and Cancelled are not commits and run no rules.
 *
 * @mcp
 */
export const setWarehouseTransferStatus = defineServiceFn({
  input: z.object({
    id: z.string(),
    status: z.enum(warehouseTransferStatusType),
    acknowledged: z.boolean().default(false)
  }),
  permission: { update: "inventory" },

  async run(ctx, { id, status, acknowledged }) {
    const transfer = await ctx.asCaller.supabase
      .from("warehouseTransfer")
      .select("id")
      .eq("id", id)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (transfer.error) {
      return ctx.error(
        "internal",
        "Failed to load warehouse transfer",
        transfer.error
      );
    }
    if (!transfer.data) {
      return ctx.error("notFound", service.WAREHOUSE_TRANSFER_NOT_FOUND);
    }

    if (WAREHOUSE_TRANSFER_COMMITS.has(status)) {
      const lines = await ctx.asSystem.supabase
        .from("warehouseTransferLine")
        .select("id, itemId, toStorageUnitId, toLocationId, quantity")
        .eq("transferId", id)
        .eq("companyId", ctx.company.id);
      const rules = await service.storageRuleViolations(
        ctx,
        ["warehouseTransfer"],
        (lines.data ?? []).map((line) => ({
          lineId: line.id,
          itemId: line.itemId,
          storageUnitId: line.toStorageUnitId,
          quantity: Number(line.quantity ?? 0),
          locationId: line.toLocationId
        }))
      );
      if (
        rules.violations.length > 0 &&
        isBlocked(rules.violations, acknowledged)
      ) {
        return rules satisfies Blocked;
      }
    }

    const update = await service.updateWarehouseTransferStatus(
      ctx.asCaller.supabase,
      id,
      status,
      ctx.auditUserId
    );
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to update warehouse transfer status",
        update.error
      );
    }
    return { id, status };
  }
});
const warehouseTransferLineFields = {
  quantity: z.number().min(0.0001, "Quantity must be greater than 0"),
  fromStorageUnitId: z.string().optional(),
  toStorageUnitId: z.string().optional(),
  notes: z.string().optional()
};

/**
 * Add a line to a Draft warehouse transfer.
 *
 * @remarks
 * The line moves `quantity` of the item between the transfer's locations.
 * A transfer that is not Draft is locked: reopen it first.
 *
 * @mcp
 */
export const createWarehouseTransferLine = defineServiceFn({
  input: z.object({
    transferId: z.string(),
    itemId: z.string().min(1),
    unitOfMeasureCode: z.string().optional(),
    ...warehouseTransferLineFields
  }),
  permission: { update: "inventory" },

  async run(ctx, { transferId, ...line }) {
    const transfer = await service.unlockedWarehouseTransfer(ctx, transferId);
    if (transfer instanceof Error) return transfer;

    const created = await service.upsertWarehouseTransferLine(
      ctx.asCaller.supabase,
      {
        ...line,
        transferId,
        fromLocationId: transfer.fromLocationId,
        toLocationId: transfer.toLocationId,
        companyId: ctx.company.id,
        createdBy: ctx.auditUserId
      }
    );
    if (created.error) {
      return ctx.error(
        "internal",
        "Failed to create warehouse transfer line",
        created.error
      );
    }
    return { id: created.data.id };
  }
});
/**
 * Update a line of a Draft warehouse transfer.
 *
 * @remarks
 * Sets the line's quantity, storage units and notes. A transfer that is not
 * Draft is locked: reopen it first.
 *
 * @mcp
 */
export const updateWarehouseTransferLine = defineServiceFn({
  input: z.object({
    transferId: z.string(),
    id: z.string(),
    ...warehouseTransferLineFields
  }),
  permission: { update: "inventory" },

  async run(ctx, { transferId, id, ...line }) {
    const transfer = await service.unlockedWarehouseTransfer(ctx, transferId);
    if (transfer instanceof Error) return transfer;
    const existing = await service.warehouseTransferLineOf(ctx, {
      transferId,
      id
    });
    if (existing instanceof Error) return existing;

    const updated = await service.upsertWarehouseTransferLine(
      ctx.asCaller.supabase,
      {
        id,
        ...line,
        updatedBy: ctx.auditUserId
      }
    );
    if (updated.error) {
      return ctx.error(
        "internal",
        "Failed to update warehouse transfer line",
        updated.error
      );
    }
    return { id };
  }
});

/**
 * Delete a line of a Draft warehouse transfer.
 *
 * @remarks
 * A transfer that is not Draft is locked: reopen it first.
 *
 * @mcp destructive
 */
export const removeWarehouseTransferLine = defineServiceFn({
  input: z.object({ transferId: z.string(), id: z.string() }),
  permission: { update: "inventory" },

  async run(ctx, { transferId, id }) {
    const transfer = await service.unlockedWarehouseTransfer(ctx, transferId);
    if (transfer instanceof Error) return transfer;
    const existing = await service.warehouseTransferLineOf(ctx, {
      transferId,
      id
    });
    if (existing instanceof Error) return existing;

    const deleted = await service.deleteWarehouseTransferLine(
      ctx.asCaller.supabase,
      id
    );
    if (deleted.error) {
      return ctx.error(
        "internal",
        "Failed to delete warehouse transfer line",
        deleted.error
      );
    }
    return { id };
  }
});

// ---------------------------------------------------------------------------
// Inventory counts and adjustments
// ---------------------------------------------------------------------------

/**
 * Create an inventory count.
 *
 * @remarks
 * Creates a Draft count at a location and snapshots its on-hand into count
 * lines: one per item, storage unit and tracked entity with stock history,
 * Rejected and Consumed lots left out. `storageUnitIds` and `itemType`
 * narrow what is counted. If the snapshot fails the count is deleted, so no
 * empty count is left behind.
 *
 * @mcp
 */
export const createInventoryCount = defineServiceFn({
  input: z.object({
    locationId: z.string().min(1),
    isBlind: z.boolean().default(false),
    notes: z.string().optional(),
    storageUnitIds: z.array(z.string()).optional(),
    itemType: z.enum(inventoryItemTypes).optional()
  }),
  permission: { create: "inventory" },

  async run(ctx, { locationId, isBlind, notes, storageUnitIds, itemType }) {
    const companyId = ctx.company.id;
    const sequence = await getNextSequence(
      ctx.asCaller.supabase,
      "inventoryCount",
      companyId
    );
    if (sequence.error || !sequence.data) {
      return ctx.error(
        "internal",
        "Failed to generate inventory count id",
        sequence.error
      );
    }

    // The scope it was generated with, recorded for a future "regenerate from
    // current stock while Draft". Not read back yet.
    const scope = {
      ...(storageUnitIds && storageUnitIds.length > 0
        ? { storageUnitIds }
        : {}),
      ...(itemType ? { itemFilter: { type: itemType } } : {})
    };

    const created = await service.insertInventoryCount(ctx.asCaller.supabase, {
      inventoryCountId: sequence.data as string,
      locationId,
      isBlind,
      notes: notes ?? null,
      scope,
      companyId,
      createdBy: ctx.auditUserId
    });
    if (created.error || !created.data) {
      return ctx.error(
        "internal",
        "Failed to create inventory count",
        created.error
      );
    }

    // The header and the snapshot are not one transaction: a failed snapshot
    // deletes the header instead of leaving an empty Draft count.
    try {
      await service.generateInventoryCountLines(ctx.asSystem.pg, {
        inventoryCountId: created.data.id,
        companyId,
        locationId,
        createdBy: ctx.auditUserId,
        storageUnitIds,
        itemType
      });
    } catch (error) {
      await service.deleteInventoryCount(
        ctx.asCaller.supabase,
        created.data.id,
        companyId
      );
      return ctx.error("internal", "Failed to generate count lines", error);
    }
    return { id: created.data.id };
  }
});

/**
 * Post a confirmed inventory count.
 *
 * @remarks
 * Only a Pending (confirmed) count posts. Each counted line's variance
 * against its snapshot is booked as an inventory adjustment, all in one
 * transaction: ledger entries, cost layers and the journal. Posted is
 * final. A count with lines that cannot post (a serial line counted as
 * anything but 0 or 1) is not posted and returns `invalidLineIds` with the
 * reason in `message`.
 *
 * @mcp
 */
export const postInventoryCount = defineServiceFn({
  input: z.object({ inventoryCountId: z.string() }),
  permission: { update: "inventory" },

  async run(ctx, { inventoryCountId }) {
    const header = await service.getInventoryCount(
      ctx.asCaller.supabase,
      inventoryCountId,
      ctx.company.id
    );
    if (header.data?.status !== "Pending") {
      return ctx.error(
        "rule",
        "Only a confirmed (pending) count can be made effective"
      );
    }

    const posted = await invokePosting(
      ctx,
      "post-inventory-count",
      { inventoryCountId },
      service.postInventoryCount
    );
    if (posted.error) {
      const message = getErrorMessage(
        posted.error,
        "Failed to post inventory count"
      );
      // The rows to highlight: the count stays Pending.
      const invalidLineIds = posted.error.body.invalidLineIds;
      if (Array.isArray(invalidLineIds)) {
        return { invalidLineIds: invalidLineIds as string[], message };
      }
      return service.serverFnFailure(ctx, posted.error, message);
    }
    return { inventoryCountId };
  }
});

/**
 * Adjust an item's stock.
 *
 * @remarks
 * A positive or negative adjustment, a set quantity, a scrap (with its scrap
 * reason) or an unscrap of a Scrapped tracked entity. It writes the ledger
 * entry, updates the tracked entity, maintains cost layers and posts the
 * journal in one transaction. Storage rules run first on the
 * `inventoryAdjustment` surface and, when a storage unit is named, on `pick`
 * (a decrease or scrap) or `place` (an increase or unscrap): a blocking rule
 * returns its `violations` and `ruleNames` and changes nothing; send
 * `acknowledged: true` to adjust past warnings.
 *
 * Every adjustment but an unscrap needs `locationId`; an unscrap resolves its
 * location, bin and cost from the original scrap.
 *
 * @mcp
 */
export const adjustInventory = defineServiceFn({
  input: z
    .object({
      itemId: z.string().min(1),
      adjustmentType: z.enum(inventoryAdjustmentTypes),
      /** A positive magnitude; the type says which way it moves. */
      quantity: z.number().min(0),
      locationId: z.string().optional(),
      storageUnitId: z.string().optional(),
      originalStorageUnitId: z.string().optional(),
      trackedEntityId: z.string().optional(),
      readableId: z.string().optional(),
      expirationDate: z.string().optional(),
      comment: z.string().optional(),
      scrapReasonId: z.string().optional(),
      unscrapOfItemLedgerId: z.string().optional(),
      acknowledged: z.boolean().default(false)
    })
    .refine((d) => d.adjustmentType !== "Scrap" || !!d.scrapReasonId, {
      path: ["scrapReasonId"],
      message: "Scrap reason is required"
    })
    .refine((d) => d.adjustmentType === "Unscrap" || !!d.locationId, {
      path: ["locationId"],
      message: "Location is required"
    }),
  // The adjustment route's gate, and the update the posting itself requires.
  permission: { create: "inventory", update: "inventory" },

  async run(ctx, { acknowledged, ...adjustment }) {
    const serial = await service.serialQuantityRefusal(
      ctx,
      adjustment.itemId,
      adjustment.quantity
    );
    if (serial) return serial;

    const line = [
      {
        lineId: adjustment.itemId,
        itemId: adjustment.itemId,
        storageUnitId: adjustment.storageUnitId ?? null,
        quantity: Number(adjustment.quantity ?? 0),
        locationId: adjustment.locationId ?? null
      }
    ];
    // The bin surface comes from the type alone: `quantity` is a positive
    // magnitude, so its sign cannot say which way stock moves.
    const removes =
      adjustment.adjustmentType === "Negative Adjmt." ||
      adjustment.adjustmentType === "Scrap";
    const rules = await service.storageRuleViolations(
      ctx,
      adjustment.storageUnitId
        ? ["inventoryAdjustment", removes ? "pick" : "place"]
        : ["inventoryAdjustment"],
      line
    );
    const violations = dedupeViolations(rules.violations);
    if (violations.length > 0 && isBlocked(violations, acknowledged)) {
      return { violations, ruleNames: rules.ruleNames } satisfies Blocked;
    }

    const posted = await invokePosting(
      ctx,
      "post-inventory-adjustment",
      adjustment,
      service.postInventoryAdjustment
    );
    if (posted.error) {
      // Below 500 the posting refused the adjustment, in words for the person.
      return posted.error.status < 500
        ? service.serverFnFailure(ctx, posted.error, posted.error.message)
        : ctx.error(
            "internal",
            "Failed to create manual inventory adjustment",
            posted.error
          );
    }
    return { itemLedgerId: posted.data.itemLedger?.id ?? null };
  }
});

// ---------------------------------------------------------------------------
// Storage units
// ---------------------------------------------------------------------------

/**
 * Delete a storage unit.
 *
 * @remarks
 * A unit with nested units is refused unless `cascade` is set, which deletes
 * the whole subtree.
 *
 * @mcp destructive
 */
export const removeStorageUnit = defineServiceFn({
  input: z.object({
    storageUnitId: z.string(),
    cascade: z.boolean().default(false)
  }),
  permission: { delete: "inventory" },

  async run(ctx, { storageUnitId, cascade }) {
    const unit = await ctx.asCaller.supabase
      .from("storageUnit")
      .select("id")
      .eq("id", storageUnitId)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (unit.error) {
      return ctx.error("internal", "Failed to delete storage unit", unit.error);
    }
    if (!unit.data) {
      return ctx.error("notFound", "The storage unit could not be found");
    }

    const deleted = cascade
      ? await service.deleteStorageUnitCascade(
          ctx.asCaller.supabase,
          storageUnitId
        )
      : await service.deleteStorageUnit(ctx.asCaller.supabase, storageUnitId);
    if (deleted.error) {
      return ctx.error(
        "internal",
        "Failed to delete storage unit",
        deleted.error
      );
    }
    return { storageUnitId, cascade };
  }
});

// ---------------------------------------------------------------------------
// Picking lists
// ---------------------------------------------------------------------------

/**
 * Set a picking list's status.
 *
 * @remarks
 * Reopening a Completed, Partial or Cancelled list needs the inventory delete
 * permission. Finishing (Completed) checks the lines first: with lines left
 * unpicked, the company's incomplete picking list policy refuses (`error`) or
 * returns `needsAcknowledgement` with those lines until the call is repeated
 * with `acknowledged` (`warn`). A list with unpicked or short lines finishes
 * Partial, not Completed.
 *
 * @mcp
 */
export const setPickingListStatus = defineServiceFn({
  input: z.object({
    pickingListId: z.string(),
    status: z.enum(pickingListStatusType),
    acknowledged: z.boolean().optional()
  }),
  permission: { update: "inventory" },

  async run(ctx, { pickingListId, status, acknowledged }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    const current = await client
      .from("pickingList")
      .select("status")
      .eq("id", pickingListId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (current.error) {
      return ctx.error(
        "internal",
        "Failed to read the picking list",
        current.error
      );
    }
    if (!current.data) return ctx.error("notFound", "Picking list not found");

    if (
      isPickingListLocked(current.data.status) &&
      !isPickingListLocked(status) &&
      !ctx.can({ delete: "inventory" })
    ) {
      return ctx.error(
        "forbidden",
        "Reopening a closed picking list needs the inventory delete permission"
      );
    }

    let finalStatus = status;
    if (status === "Completed") {
      const [lines, settings] = await Promise.all([
        service.getUnresolvedPickingListLines(client, pickingListId, companyId),
        getCompanySettings(client, companyId)
      ]);
      if (lines.error) {
        return ctx.error(
          "internal",
          "Failed to check picking list lines",
          lines.error
        );
      }
      // Fail closed: an unreadable policy must not fall back to the
      // bypassable 'warn' default.
      if (settings.error || !settings.data) {
        return ctx.error(
          "internal",
          "Failed to read the picking list completion policy",
          settings.error
        );
      }
      const finish = finishPickingList({
        unresolvedItemNames: lines.unresolved.map((line) => line.itemName),
        hasShort: lines.hasShort,
        policy: settings.data.incompletePickingListPolicy,
        acknowledged: acknowledged ?? false
      });
      if (finish.outcome === "refuse") return ctx.error("rule", finish.message);
      if (finish.outcome === "ask") {
        return {
          needsAcknowledgement: true as const,
          unresolvedLines: lines.unresolved
        };
      }
      finalStatus = finish.status;
    }

    const update = await service.updatePickingListStatus(
      client,
      pickingListId,
      finalStatus,
      ctx.auditUserId
    );
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to update picking list status",
        update.error
      );
    }

    if (finalStatus === "Completed" || finalStatus === "Partial") {
      // Partial means a line could not be filled: the material-availability
      // half of job cycle time. The status is the discriminator, so a list
      // that goes Partial and later Completed records both.
      trackWorkEvent(
        "picking_list_completed",
        {
          companyId,
          userId: ctx.auditUserId,
          pickingListId,
          finalStatus,
          source: "erp"
        },
        { discriminator: finalStatus }
      );
    }
    return { pickingListId, status: finalStatus };
  }
});

/**
 * Update a Draft picking list's details.
 *
 * @remarks
 * Location, assignee, due date, notes and custom fields. A list past Draft is
 * locked: reopen it first.
 *
 * @mcp
 */
export const updatePickingList = defineServiceFn({
  input: z.object({
    pickingListId: z.string(),
    locationId: z.string().min(1),
    assignee: z.string().optional(),
    dueDate: z.string().optional(),
    notes: z.string().optional(),
    customFields: z.record(z.string(), z.unknown()).optional()
  }),
  permission: { update: "inventory" },

  async run(ctx, { pickingListId, customFields, ...fields }) {
    const existing = await service.getPickingList(
      ctx.asCaller.supabase,
      pickingListId
    );
    if (existing.error || !existing.data) {
      return ctx.error("notFound", "Picking list not found", existing.error);
    }
    if (existing.data.status !== "Draft") {
      return ctx.error(
        "rule",
        "Cannot modify a locked picking list. Reopen it first."
      );
    }

    const updated = await service.upsertPickingList(ctx.asCaller.supabase, {
      id: pickingListId,
      pickingListId: existing.data.pickingListId,
      ...fields,
      updatedBy: ctx.auditUserId,
      customFields: customFields as Json | undefined
    });
    if (updated.error) {
      return ctx.error(
        "internal",
        "Failed to update picking list",
        updated.error
      );
    }
    return { pickingListId };
  }
});

const pickingListLineInput = {
  pickingListId: z.string(),
  pickingListLineId: z.string()
};

/**
 * Pick a picking list line, or mark it short.
 *
 * @remarks
 * Sets the line's picked quantity (0 unpicks); with `markShort` the line is
 * Short at that quantity. The line must be on the list.
 *
 * @mcp
 */
export const pickPickingListLineChecked = defineServiceFn({
  input: z.object({
    ...pickingListLineInput,
    quantity: z.number().min(0),
    markShort: z.boolean().optional()
  }),
  permission: { update: "inventory" },

  async run(ctx, { pickingListId, pickingListLineId, quantity, markShort }) {
    const owned = await refuseUnlessOwned(ctx, "pickingListLine", {
      id: pickingListLineId,
      pickingListId
    });
    if (owned) return owned;

    const result = await service.pickPickingListLine(
      ctx.asSystem.supabase,
      ctx.asSystem.pg,
      {
        pickingListLineId,
        quantity,
        markShort,
        userId: ctx.auditUserId,
        companyId: ctx.company.id
      }
    );
    if (result.error) return service.pickRefusal(ctx, result.error);
    return result.data;
  }
});

/**
 * Pick a serial or batch for a picking list line, or put it back.
 *
 * @remarks
 * Picks `quantity` of the tracked entity (from `fromStorageUnitId` when
 * given) onto the line; with `unpick` the entity's pick is undone. The line
 * must be on the list.
 *
 * @mcp
 */
export const pickPickingListLineEntity = defineServiceFn({
  input: z.object({
    ...pickingListLineInput,
    trackedEntityId: z.string(),
    fromStorageUnitId: z.string().nullable().optional(),
    quantity: z.number().min(0),
    unpick: z.boolean().optional()
  }),
  permission: { update: "inventory" },

  async run(
    ctx,
    {
      pickingListId,
      pickingListLineId,
      trackedEntityId,
      fromStorageUnitId,
      quantity,
      unpick
    }
  ) {
    const owned = await refuseUnlessOwned(ctx, "pickingListLine", {
      id: pickingListLineId,
      pickingListId
    });
    if (owned) return owned;

    const result = await service.setPickingListLineTrackedEntity(
      ctx.asSystem.supabase,
      ctx.asSystem.pg,
      {
        pickingListLineId,
        trackedEntityId,
        fromStorageUnitId: fromStorageUnitId ?? null,
        quantity,
        unpick: unpick ?? false,
        userId: ctx.auditUserId,
        companyId: ctx.company.id
      }
    );
    if (result.error) return service.pickRefusal(ctx, result.error);
    return result.data;
  }
});
// ---------------------------------------------------------------------------
// Kanbans
// ---------------------------------------------------------------------------

/** What a kanban scan did, for the caller to open. */
export type KanbanScan =
  /** A Make kanban that already has a job: the collision page. */
  | { type: "collision" }
  /**
   * The job it made. `operationId` is its first operation when the kanban
   * releases the job; `startAs` how to start it when the kanban starts it.
   */
  | {
      type: "job";
      jobId: string;
      operationId: string | null;
      startAs: "Setup" | "Labor" | "Machine" | null;
    }
  | { type: "purchaseOrder"; purchaseOrderId: string }
  | { type: "stockTransfer"; stockTransferId: string };

/**
 * Replenish a kanban: what scanning its card does.
 *
 * @remarks
 * Make: creates a Hard Deadline job for the kanban's item and quantity, due
 * after the item's lead time, copies the item's method and links the job to
 * the kanban; with auto-release it recalculates, runs MRP and the location's
 * schedule, and sets the job Ready. A kanban that already has a job is a
 * collision. Buy: adds a line to the supplier's open Draft or Planned purchase
 * order, or a new Draft one, priced from the supplier part in the order's
 * currency. Transfer: releases a stock transfer to the kanban's storage unit
 * (`kanban-replenish`, as the scanner).
 */
export const scanKanban = defineServiceFn({
  input: z.object({ kanbanId: z.string() }),
  // Safe only unpublished (an employee-only route; Make creates jobs as the
  // system): give it a real rule before it is ever tagged @mcp.
  permission: {},

  async run(ctx, { kanbanId }): Promise<KanbanScan | CarbonError> {
    const client = ctx.asCaller.supabase;
    const serviceRole = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    const kanban = await service.getKanban(client, kanbanId, companyId);
    if (kanban.error || !kanban.data) {
      return ctx.error("notFound", "Kanban is not active", kanban.error);
    }
    const card = kanban.data;

    if (card.replenishmentSystem === "Make") {
      if (card.jobReadableId) return { type: "collision" };
      if (!card.itemId) return ctx.error("rule", "Failed to create job");

      const [manufacturing, defaultStorageUnit] = await Promise.all([
        getItemReplenishment(client, card.itemId, companyId),
        getDefaultStorageUnitForJob(
          client,
          card.itemId,
          card.locationId!,
          companyId
        )
      ]);

      // No location on the kanban → the company calendar.
      const startDate = datetime.today(
        card.locationId
          ? await getLocationTimeZone(client, card.locationId, companyId)
          : await getCompanyTimeZone(client, companyId)
      );
      const dueDate = startDate
        .add({ days: manufacturing.data?.leadTime ?? 7 })
        .toString();

      const createdJob = await insertJob(
        serviceRole,
        ctx.asSystem.pg,
        {
          itemId: card.itemId,
          quantity: card.quantity!,
          locationId: card.locationId!,
          storageUnitId: card.storageUnitId || defaultStorageUnit || undefined,
          unitOfMeasureCode: card.purchaseUnitOfMeasureCode!,
          deadlineType: "Hard Deadline",
          startDate: startDate.toString(),
          dueDate,
          companyId,
          createdBy: userId
        },
        { skipMethod: true, skipRecalculate: true, source: "kanban" }
      );
      const jobId = createdJob.data?.id;
      if (createdJob.error || !jobId) {
        return ctx.error("internal", "Failed to create job", createdJob.error);
      }

      const [method, associated] = await Promise.all([
        upsertJobMethod(serviceRole, ctx.asSystem.pg, "itemToJob", {
          sourceId: card.itemId,
          targetId: jobId,
          companyId,
          userId,
          configuration: undefined
        }),
        updateKanbanJob(serviceRole, {
          id: card.id!,
          jobId,
          companyId,
          userId
        })
      ]);
      if (associated.error) {
        return ctx.error(
          "internal",
          "Failed to associate kanban with job",
          associated.error
        );
      }

      if (method.error) {
        logger.error("Kanban operation failed", { error: method.error });
      } else if (card.autoRelease) {
        await Promise.all([
          trigger("recalculate", {
            type: "jobRequirements",
            id: jobId,
            companyId,
            userId
          }),
          runMRP(serviceRole, ctx.asSystem.pg, {
            type: "job",
            id: jobId,
            companyId,
            userId
          }),
          runLocationSchedule({
            db: ctx.asSystem.pg,
            client: serviceRole,
            locationId: card.locationId!,
            companyId,
            userId
          }),
          serviceRole
            .from("job")
            .update({ status: "Ready" as const })
            .eq("id", jobId)
            .eq("companyId", companyId)
        ]);

        // This path writes job.status directly, so it never reaches
        // updateJobStatus and its raiseMoment. The job was just created, so
        // the prior status is always Draft.
        trackWorkEvent("job_released", {
          companyId,
          userId,
          jobId,
          priorStatus: "Draft",
          source: "kanban"
        });
      }

      const operation = card.autoRelease
        ? await getActiveJobOperationByJobId(client, jobId, companyId)
        : null;
      if (!operation) {
        return { type: "job", jobId, operationId: null, startAs: null };
      }
      const startAs = !card.autoStartJob
        ? null
        : operation.setupTime
          ? "Setup"
          : operation.machineTime && !operation.laborTime
            ? "Machine"
            : "Labor";
      return { type: "job", jobId, operationId: operation.id, startAs };
    }

    if (card.replenishmentSystem === "Buy") {
      const existing = await client
        .from("purchaseOrder")
        .select("id, currencyCode, exchangeRate")
        .eq("supplierId", card.supplierId!)
        .in("status", ["Planned", "Draft"])
        .eq("companyId", companyId)
        .maybeSingle();

      let purchaseOrderId = existing.data?.id;
      let orderCurrencyCode = existing.data?.currencyCode ?? null;
      let orderExchangeRate = existing.data?.exchangeRate ?? 1;

      if (!purchaseOrderId) {
        const created = await insertPurchaseOrder(client, {
          supplierId: card.supplierId!,
          status: "Draft",
          purchaseOrderType: "Purchase",
          companyId,
          companyGroupId: ctx.company.groupId,
          createdBy: userId
        });
        if (created.error || !created.data) {
          return ctx.error(
            "internal",
            "Failed to create purchase order",
            created.error
          );
        }
        purchaseOrderId = created.data.id;
        orderCurrencyCode = null;
        orderExchangeRate = created.data.exchangeRate;
      }

      const [item, supplierPart, pickMethod, company] = await Promise.all([
        client
          .from("item")
          .select(
            "name, readableIdWithRevision, type, unitOfMeasureCode, itemCost(unitCost), itemReplenishment(purchasingUnitOfMeasureCode, conversionFactor, leadTime)"
          )
          .eq("id", card.itemId!)
          .eq("companyId", companyId)
          .single(),
        client
          .from("supplierPart")
          .select("*")
          .eq("itemId", card.itemId!)
          .eq("companyId", companyId)
          .eq("supplierId", card.supplierId!)
          .maybeSingle(),
        client
          .from("pickMethod")
          .select("defaultStorageUnitId")
          .eq("itemId", card.itemId!)
          .eq("companyId", companyId)
          .eq("locationId", card.locationId!)
          .maybeSingle(),
        client
          .from("company")
          .select("baseCurrencyCode")
          .eq("id", companyId)
          .single()
      ]);

      // The line is in the ORDER's currency: the supplier part's price
      // converts from its own currency at today's rate, the item cost from
      // base.
      const baseCurrencyCode = company.data?.baseCurrencyCode ?? "USD";
      const order = {
        currencyCode: orderCurrencyCode ?? baseCurrencyCode,
        exchangeRate: orderExchangeRate
      };
      const pricing = supplierPart.data
        ? await getSupplierPartPricing(
            client,
            supplierPart.data,
            baseCurrencyCode,
            order.currencyCode
          )
        : null;
      if (pricing?.error) {
        return ctx.error("internal", pricing.error.message, pricing.error);
      }
      if (item.error) {
        return ctx.error("internal", "Failed to get item", item.error);
      }
      const supplierUnitPrice = resolveSupplierPrice(
        pricing?.data ?? null,
        card.quantity!,
        order,
        convertUnitPrice(
          item.data.itemCost?.[0]?.unitCost ?? 0,
          { currencyCode: baseCurrencyCode, exchangeRate: 1 },
          order
        )
      );

      const line = await upsertPurchaseOrderLine(client, {
        purchaseOrderId,
        purchaseOrderLineType: item.data.type as never,
        itemId: card.itemId!,
        purchaseQuantity: card.quantity!,
        supplierUnitPrice,
        supplierShippingCost: 0,
        supplierTaxAmount: 0,
        taxPercent: 0,
        exchangeRate: order.exchangeRate,
        purchaseUnitOfMeasureCode: card.purchaseUnitOfMeasureCode!,
        inventoryUnitOfMeasureCode:
          item.data.unitOfMeasureCode || card.purchaseUnitOfMeasureCode!,
        conversionFactor:
          card.conversionFactor ||
          item.data.itemReplenishment?.conversionFactor ||
          1,
        locationId: card.locationId!,
        storageUnitId:
          card.storageUnitId ||
          pickMethod.data?.defaultStorageUnitId ||
          undefined,
        companyId,
        createdBy: userId
      });
      if (line.error) {
        return ctx.error(
          "internal",
          "Failed to create purchase order line",
          line.error
        );
      }
      return { type: "purchaseOrder", purchaseOrderId };
    }

    if (card.replenishmentSystem === "Transfer") {
      if (!card.itemId) {
        return ctx.error("rule", "Failed to create stock transfer");
      }
      // kanban-replenish re-reads the kanban under companyId, checks both
      // storage units belong to the kanban's location, and writes the
      // Released transfer with its kanbanId. It runs as the scanner: a scan
      // needs the inventory create permission the stock transfer's RLS
      // rule checks.
      const replenish = await invokePosting(
        { client, db: ctx.asSystem.pg, companyId, userId },
        "kanban-replenish",
        { mode: "scan", kanbanId },
        service.replenishKanban,
        { as: service.replenishKanbanPermission }
      );
      if (replenish.error) {
        return ctx.error(
          "internal",
          "Failed to create stock transfer",
          replenish.error
        );
      }
      const outcome = replenish.data.results[0];
      if (outcome?.outcome === "invalid") {
        return ctx.error("rule", outcome.reason);
      }
      if (outcome?.outcome === "created") {
        return { type: "stockTransfer", stockTransferId: outcome.id };
      }
      return ctx.error("internal", "Failed to create stock transfer");
    }

    return ctx.error("rule", `${card.replenishmentSystem} is not supported`);
  }
});
/**
 * Delete batch property
 *
 * @mcp destructive
 */
export const deleteBatchProperty = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "inventory" },
  async run(ctx, input) {
    const owned = await refuseUnlessOwned(ctx, "batchProperty", {
      id: input.id
    });
    if (owned) return owned;
    return unwrap(
      ctx,
      await service.deleteBatchProperty(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * Delete kanban
 *
 * @mcp destructive
 */
export const deleteKanban = defineServiceFn({
  input: z.looseObject({ kanbanId: z.string() }),
  permission: { delete: "inventory" },
  async run(ctx, input) {
    const owned = await refuseUnlessOwned(ctx, "kanban", {
      id: input.kanbanId
    });
    if (owned) return owned;
    return unwrap(
      ctx,
      await service.deleteKanban(ctx.asCaller.supabase, input.kanbanId as never)
    );
  }
});

/**
 * Delete receipt
 *
 * @remarks
 * A posted receipt cannot be deleted; void it instead.
 *
 * @mcp destructive
 */
export const deleteReceipt = defineServiceFn({
  input: z.looseObject({ receiptId: z.string() }),
  permission: { delete: "inventory" },
  async run(ctx, input) {
    const receipt = await ctx.asCaller.supabase
      .from("receipt")
      .select("postingDate")
      .eq("id", input.receiptId)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (receipt.error) {
      return ctx.error("internal", "Failed to get receipt", receipt.error);
    }
    if (!receipt.data) return ctx.error("notFound", "Receipt not found");
    if (receipt.data.postingDate) {
      return ctx.error("rule", "Cannot delete a posted receipt");
    }
    return unwrap(
      ctx,
      await service.deleteReceipt(
        ctx.asCaller.supabase,
        input.receiptId as never
      )
    );
  }
});

/**
 * Delete receipt line
 *
 * @remarks
 * Only a Draft receipt's lines can be deleted.
 *
 * @mcp destructive
 */
export const deleteReceiptLine = defineServiceFn({
  input: z.looseObject({ receiptLineId: z.string() }),
  permission: { delete: "inventory" },
  async run(ctx, input) {
    const line = await ctx.asCaller.supabase
      .from("receiptLine")
      .select("id, receipt!receiptLine_receiptId_fkey(status)")
      .eq("id", input.receiptLineId)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (line.error) {
      return ctx.error("internal", "Failed to load receipt line", line.error);
    }
    if (!line.data?.receipt) {
      return ctx.error("notFound", "The receipt line could not be found");
    }
    if (line.data.receipt.status !== "Draft") {
      return ctx.error("rule", RECEIPT_LOCKED);
    }
    return unwrap(
      ctx,
      await service.deleteReceiptLine(
        ctx.asCaller.supabase,
        input.receiptLineId as never
      )
    );
  }
});

/**
 * Delete shipment
 *
 * @remarks
 * A posted shipment cannot be deleted; void it instead.
 *
 * @mcp destructive
 */
export const deleteShipment = defineServiceFn({
  input: z.looseObject({ shipmentId: z.string() }),
  permission: { delete: "inventory" },
  async run(ctx, input) {
    const shipment = await ctx.asCaller.supabase
      .from("shipment")
      .select("postingDate")
      .eq("id", input.shipmentId)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (shipment.error) {
      return ctx.error("internal", "Failed to get shipment", shipment.error);
    }
    if (!shipment.data) return ctx.error("notFound", "Shipment not found");
    if (shipment.data.postingDate) {
      return ctx.error("rule", "Cannot delete a posted shipment");
    }
    return unwrap(
      ctx,
      await service.deleteShipment(
        ctx.asCaller.supabase,
        input.shipmentId as never
      )
    );
  }
});

/**
 * Delete shipment line
 *
 * @remarks
 * Only a Draft shipment's lines can be deleted.
 *
 * @mcp destructive
 */
export const deleteShipmentLine = defineServiceFn({
  input: z.looseObject({ shipmentLineId: z.string() }),
  permission: { delete: "inventory" },
  async run(ctx, input) {
    const line = await ctx.asCaller.supabase
      .from("shipmentLine")
      .select("id, shipment!shipmentLine_shipmentId_fkey(status)")
      .eq("id", input.shipmentLineId)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (line.error) {
      return ctx.error("internal", "Failed to load shipment line", line.error);
    }
    if (!line.data?.shipment) {
      return ctx.error("notFound", "The shipment line could not be found");
    }
    if (line.data.shipment.status !== "Draft") {
      return ctx.error("rule", SHIPMENT_LOCKED);
    }
    return unwrap(
      ctx,
      await service.deleteShipmentLine(
        ctx.asCaller.supabase,
        input.shipmentLineId as never
      )
    );
  }
});

/**
 * Delete shipping method
 *
 * @mcp destructive
 */
export const deleteShippingMethod = defineServiceFn({
  input: z.looseObject({ shippingMethodId: z.string() }),
  permission: { delete: "inventory" },
  async run(ctx, input) {
    const owned = await refuseUnlessOwned(ctx, "shippingMethod", {
      id: input.shippingMethodId
    });
    if (owned) return owned;
    return unwrap(
      ctx,
      await service.deleteShippingMethod(
        ctx.asCaller.supabase,
        input.shippingMethodId as never
      )
    );
  }
});

/**
 * Delete stock transfer
 *
 * @remarks
 * Only a Draft transfer can be deleted: reopen a locked one first.
 *
 * @mcp destructive
 */
export const deleteStockTransfer = defineServiceFn({
  input: z.looseObject({ stockTransferId: z.string() }),
  permission: { delete: "inventory" },
  async run(ctx, input) {
    const transfer = await service.unlockedStockTransfer(
      ctx,
      input.stockTransferId
    );
    if (transfer instanceof Error) return transfer;
    return unwrap(
      ctx,
      await service.deleteStockTransfer(
        ctx.asCaller.supabase,
        input.stockTransferId as never
      )
    );
  }
});

/**
 * Delete stock transfer line
 *
 * @remarks
 * Only a line of a Draft transfer can be deleted: reopen a locked one first.
 *
 * @mcp destructive
 */
export const deleteStockTransferLine = defineServiceFn({
  input: z.looseObject({ stockTransferLineId: z.string() }),
  permission: { delete: "inventory" },
  async run(ctx, input) {
    const line = await ctx.asCaller.supabase
      .from("stockTransferLine")
      .select("stockTransferId")
      .eq("id", input.stockTransferLineId)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (line.error) {
      return ctx.error(
        "internal",
        "Failed to load stock transfer line",
        line.error
      );
    }
    if (!line.data) {
      return ctx.error("notFound", "Stock transfer line not found");
    }
    const transfer = await service.unlockedStockTransfer(
      ctx,
      line.data.stockTransferId
    );
    if (transfer instanceof Error) return transfer;
    return unwrap(
      ctx,
      await service.deleteStockTransferLine(
        ctx.asCaller.supabase,
        input.stockTransferLineId as never
      )
    );
  }
});

/**
 * Delete warehouse transfer
 *
 * @mcp destructive
 */
export const deleteWarehouseTransfer = defineServiceFn({
  input: z.looseObject({ transferId: z.string() }),
  permission: { delete: "inventory" },
  async run(ctx, input) {
    const owned = await refuseUnlessOwned(ctx, "warehouseTransfer", {
      id: input.transferId
    });
    if (owned) return owned;
    return unwrap(
      ctx,
      await service.deleteWarehouseTransfer(
        ctx.asCaller.supabase,
        input.transferId as never
      )
    );
  }
});

/**
 * Keyset-paginated item-ledger activity for the per-item Activity panel
 *
 * @remarks
 * A page of `rows`, newest first. `hasMore` says another page lies beyond
 * it: send the last row's `entryNumber` to read it.
 *
 * @mcp read
 */
export const getItemLedgerActivity = defineServiceFn({
  input: z.looseObject({
    itemId: z.string(),
    locationId: z.string(),
    entryNumber: z.number().optional(),
    direction: z.enum(["older", "newer"]).optional(),
    inclusive: z.boolean().optional()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    const page = await utils.getItemLedgerActivity(
      ctx.asCaller.supabase,
      payload(ctx, input).build() as never
    );
    const rows = unwrap(ctx, page);
    if (rows instanceof Error) return rows;
    return { rows, hasMore: page.hasMore };
  }
});

/**
 * On-hand quantity of an item at a location right after ledger entry
 * `entryNumber` (omit it for on-hand now), on the same definition as the
 * inventory table's On Hand column.
 *
 * @mcp read
 */
export const getItemLedgerBalance = defineServiceFn({
  input: z.looseObject({
    itemId: z.string(),
    locationId: z.string(),
    entryNumber: z.number().optional()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getItemLedgerBalance(
        ctx.asCaller.supabase,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get batch properties
 *
 * @mcp read
 */
export const getBatchProperties = defineServiceFn({
  input: z.looseObject({ itemIds: z.array(z.string()) }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getBatchProperties(
        ctx.asCaller.supabase,
        input.itemIds,
        ctx.company.id
      )
    );
  }
});

/**
 * Get inventory items
 *
 * @mcp read
 */
export const getInventoryItems = defineServiceFn({
  input: z.looseObject({
    locationId: z.string(),
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getInventoryItems(
        ctx.asCaller.supabase,
        input.locationId as never,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get inventory valuation
 *
 * @mcp read
 */
export const getInventoryValuation = defineServiceFn({
  input: z.looseObject({
    asOfDate: z.string().nullable().optional(),
    locationId: z.string().nullable().optional()
  }),
  // A valuation is the accounting report's: inventory rights alone see no cost.
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getInventoryValuation(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get inventory valuation tie out
 *
 * @mcp read
 */
export const getInventoryValuationTieOut = defineServiceFn({
  input: z.looseObject({ asOfDate: z.string().nullable().optional() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getInventoryValuationTieOut(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.asOfDate as never
      )
    );
  }
});

/**
 * Creates a draft GL journal that clears the inventory valuation variance
 *
 * @mcp
 */
export const createInventoryReconciliationJournal = defineServiceFn({
  input: z.looseObject({ asOfDate: z.string() }),
  permission: { create: "accounting" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.createInventoryReconciliationJournal(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        ctx.company.id,
        payload(ctx, input).withUser().forUpsert() as never
      )
    );
  }
});

/**
 * Get kanbans
 *
 * @mcp read
 */
export const getKanbans = defineServiceFn({
  input: z.looseObject({
    locationId: z.string(),
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getKanbans(
        ctx.asCaller.supabase,
        input.locationId as never,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get kanban
 *
 * @mcp read
 */
export const getKanban = defineServiceFn({
  input: z.looseObject({ kanbanId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getKanban(
        ctx.asCaller.supabase,
        input.kanbanId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get kanban projected quantities
 *
 * @mcp read
 */
export const getKanbanProjectedQuantities = defineServiceFn({
  input: z.looseObject({ kanbanIds: z.array(z.string()) }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getKanbanProjectedQuantities(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.kanbanIds
      )
    );
  }
});

/**
 * Get stock transfer
 *
 * @mcp read
 */
export const getStockTransfer = defineServiceFn({
  input: z.looseObject({ stockTransferId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    const transfer = await service.getStockTransfer(
      ctx.asCaller.supabase,
      input.stockTransferId
    );
    if (transfer.data && transfer.data.companyId !== ctx.company.id) {
      return ctx.error("notFound", NOT_FOUND);
    }
    return unwrap(ctx, transfer);
  }
});

/**
 * Get stock transfer lines
 *
 * @mcp read
 */
export const getStockTransferLines = defineServiceFn({
  input: z.looseObject({ stockTransferId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    const lines = await service.getStockTransferLines(
      ctx.asCaller.supabase,
      input.stockTransferId
    );
    return unwrap(ctx, {
      ...lines,
      data: lines.data?.filter((line) => line.companyId === ctx.company.id)
    });
  }
});

/**
 * Get stock transfers
 *
 * @mcp read
 */
export const getStockTransfers = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    locationId: z.string().nullable().optional()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getStockTransfers(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get receipts
 *
 * @mcp read
 */
export const getReceipts = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getReceipts(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get receipt
 *
 * @mcp read
 */
export const getReceipt = defineServiceFn({
  input: z.looseObject({ receiptId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    const receipt = await service.getReceipt(
      ctx.asCaller.supabase,
      input.receiptId
    );
    if (receipt.data && receipt.data.companyId !== ctx.company.id) {
      return ctx.error("notFound", NOT_FOUND);
    }
    return unwrap(ctx, receipt);
  }
});

/**
 * Get receipt lines
 *
 * @mcp read
 */
export const getReceiptLines = defineServiceFn({
  input: z.looseObject({ receiptId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    const lines = await service.getReceiptLines(
      ctx.asCaller.supabase,
      input.receiptId
    );
    return unwrap(ctx, {
      ...lines,
      data: lines.data?.filter((line) => line.companyId === ctx.company.id)
    });
  }
});

/**
 * The documents around a receipt that its own row does not name: the purchase
 * invoices raised against its supplier interaction, and, for a customer
 * return, the customer it came back from.
 *
 * @mcp read
 */
export const getReceiptRelatedItems = defineServiceFn({
  input: z.looseObject({
    supplierInteractionId: z.string().nullable(),
    salesReturnOrderId: z.string().nullable()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return await service.getReceiptRelatedItems(
      ctx.asCaller.supabase,
      ctx.company.id,
      input.supplierInteractionId as never,
      input.salesReturnOrderId as never
    );
  }
});

/**
 * Get receipt tracking
 *
 * @mcp read
 */
export const getReceiptTracking = defineServiceFn({
  input: z.looseObject({ receiptId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await utils.getReceiptTracking(
        ctx.asCaller.supabase,
        input.receiptId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get receipt files
 *
 * @remarks
 * The files attached to each receipt line in `lineIds`, at most 200 lines a
 * call.
 *
 * @mcp read
 */
export const getReceiptFiles = defineServiceFn({
  // One storage listing per line.
  input: z.looseObject({ lineIds: z.array(z.string()).max(200) }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getReceiptFiles(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.lineIds
      )
    );
  }
});

/**
 * Get serial numbers for item
 *
 * @mcp read
 */
export const getSerialNumbersForItem = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSerialNumbersForItem(
        ctx.asCaller.supabase,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Available tracked entities for an item at a location, one row per entity, with its bin, on-hand, and FEFO/FIFO order keys — for the shared TrackedEntityPicker
 *
 * @mcp read
 */
export const getAvailableTrackedEntities = defineServiceFn({
  input: z.looseObject({
    itemId: z.string(),
    locationId: z.string(),
    excludeLineside: z.boolean().optional(),
    excludeAllocated: z.boolean().optional(),
    excludeLineId: z.string().nullable().optional(),
    inStorageUnit: z.looseObject({ id: z.string().nullable() }).optional()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getAvailableTrackedEntities(
        ctx.asCaller.supabase,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * The configured tracked-entity pick order for an item at a location, used as the picker's default sort
 *
 * @mcp read
 */
export const getPickOrder = defineServiceFn({
  input: z.looseObject({ itemId: z.string(), locationId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return await service.getPickOrder(
      ctx.asCaller.supabase,
      payload(ctx, input).build() as never
    );
  }
});

/**
 * Get batch numbers for item
 *
 * @mcp read
 */
export const getBatchNumbersForItem = defineServiceFn({
  input: z.looseObject({
    itemId: z.string(),
    isReadOnly: z.boolean().optional()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getBatchNumbersForItem(
        ctx.asCaller.supabase,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get storage units list
 *
 * @mcp read
 */
export const getStorageUnitsList = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "inventory" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getStorageUnitsList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get storage units list for location
 *
 * @mcp read
 */
export const getStorageUnitsListForLocation = defineServiceFn({
  input: z.looseObject({ locationId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getStorageUnitsListForLocation(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.locationId as never
      )
    );
  }
});

/**
 * Get storage units tree for location
 *
 * @mcp read
 */
export const getStorageUnitsTreeForLocation = defineServiceFn({
  input: z.looseObject({ locationId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getStorageUnitsTreeForLocation(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.locationId as never
      )
    );
  }
});

/**
 * Get storage unit
 *
 * @mcp read
 */
export const getStorageUnit = defineServiceFn({
  input: z.looseObject({ storageUnitId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    const unit = await service.getStorageUnit(
      ctx.asCaller.supabase,
      input.storageUnitId
    );
    if (unit.data && unit.data.companyId !== ctx.company.id) {
      return ctx.error("notFound", NOT_FOUND);
    }
    return unwrap(ctx, unit);
  }
});

/**
 * Get effective work center id
 *
 * @mcp read
 */
export const getEffectiveWorkCenterId = defineServiceFn({
  input: z.looseObject({ storageUnitId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    const owned = await refuseUnlessOwned(ctx, "storageUnit", {
      id: input.storageUnitId
    });
    if (owned) return owned;
    return unwrap(
      ctx,
      await service.getEffectiveWorkCenterId(
        ctx.asCaller.supabase,
        input.storageUnitId as never
      )
    );
  }
});

/**
 * Get storage unit roots
 *
 * @mcp read
 */
export const getStorageUnitRoots = defineServiceFn({
  input: z.looseObject({
    locationId: z.string(),
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getStorageUnitRoots(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.locationId as never,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get storage unit children
 *
 * @mcp read
 */
export const getStorageUnitChildren = defineServiceFn({
  input: z.looseObject({ parentId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    const children = await service.getStorageUnitChildren(
      ctx.asCaller.supabase,
      input.parentId
    );
    return unwrap(ctx, {
      ...children,
      data: children.data?.filter((unit) => unit.companyId === ctx.company.id)
    });
  }
});

/**
 * Get storage unit subtrees
 *
 * @mcp read
 */
export const getStorageUnitSubtrees = defineServiceFn({
  input: z.looseObject({
    locationId: z.string(),
    rootIds: z.array(z.string()),
    maxDepth: z.number()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getStorageUnitSubtrees(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.locationId as never,
        input.rootIds,
        input.maxDepth as never
      )
    );
  }
});

/**
 * Get storage unit parent ids with children
 *
 * @mcp read
 */
export const getStorageUnitParentIdsWithChildren = defineServiceFn({
  input: z.looseObject({ locationId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getStorageUnitParentIdsWithChildren(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.locationId as never
      )
    );
  }
});

/**
 * Search storage units with ancestors
 *
 * @mcp read
 */
export const searchStorageUnitsWithAncestors = defineServiceFn({
  input: z.looseObject({ locationId: z.string(), search: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.searchStorageUnitsWithAncestors(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.locationId as never,
        input.search as never
      )
    );
  }
});

/**
 * Get stock movements
 *
 * @mcp read
 */
export const getStockMovements = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getStockMovements(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get shipments
 *
 * @mcp read
 */
export const getShipments = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getShipments(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get shipment
 *
 * @mcp read
 */
export const getShipment = defineServiceFn({
  input: z.looseObject({ shipmentId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    const shipment = await service.getShipment(
      ctx.asCaller.supabase,
      input.shipmentId
    );
    if (shipment.data && shipment.data.companyId !== ctx.company.id) {
      return ctx.error("notFound", NOT_FOUND);
    }
    return unwrap(ctx, shipment);
  }
});

/**
 * Get shipment lines
 *
 * @mcp read
 */
export const getShipmentLines = defineServiceFn({
  input: z.looseObject({ shipmentId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    const lines = await service.getShipmentLines(
      ctx.asCaller.supabase,
      input.shipmentId
    );
    return unwrap(ctx, {
      ...lines,
      data: lines.data?.filter((line) => line.companyId === ctx.company.id)
    });
  }
});

/**
 * Get shipment related items
 *
 * @mcp read
 */
export const getShipmentRelatedItems = defineServiceFn({
  input: z.looseObject({
    shipmentId: z.string(),
    sourceDocumentId: z.string()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    // The reads below run by these ids alone: both must be this company's
    // shipment and its own source document.
    const owned = await refuseUnlessOwned(
      ctx,
      "shipment",
      input.sourceDocumentId
        ? { id: input.shipmentId, sourceDocumentId: input.sourceDocumentId }
        : { id: input.shipmentId }
    );
    if (owned) return owned;
    return await service.getShipmentRelatedItems(
      ctx.asCaller.supabase,
      input.shipmentId as never,
      input.sourceDocumentId as never
    );
  }
});

/**
 * Get shipment tracking
 *
 * @mcp read
 */
export const getShipmentTracking = defineServiceFn({
  input: z.looseObject({ shipmentId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await utils.getShipmentTracking(
        ctx.asCaller.supabase,
        input.shipmentId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get rental shipment lines
 *
 * @mcp read
 */
export const getRentalShipmentLines = defineServiceFn({
  input: z.looseObject({ shipmentId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getRentalShipmentLines(
        ctx.asCaller.supabase,
        input.shipmentId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get rental receipt lines
 *
 * @mcp read
 */
export const getRentalReceiptLines = defineServiceFn({
  input: z.looseObject({ receiptId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getRentalReceiptLines(
        ctx.asCaller.supabase,
        input.receiptId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get shipping method
 *
 * @mcp read
 */
export const getShippingMethod = defineServiceFn({
  input: z.looseObject({ shippingMethodId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    const method = await service.getShippingMethod(
      ctx.asCaller.supabase,
      input.shippingMethodId
    );
    if (method.data && method.data.companyId !== ctx.company.id) {
      return ctx.error("notFound", NOT_FOUND);
    }
    return unwrap(ctx, method);
  }
});

/**
 * Get shipping methods
 *
 * @mcp read
 */
export const getShippingMethods = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getShippingMethods(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get shipping methods list
 *
 * @mcp read
 */
export const getShippingMethodsList = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "inventory" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getShippingMethodsList(
        ctx.asCaller.supabase,
        ctx.company.id
      )
    );
  }
});

/**
 * Get shipping terms list
 *
 * @mcp read
 */
export const getShippingTermsList = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "inventory" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getShippingTermsList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get tracked entities
 *
 * @mcp read
 */
export const getTrackedEntities = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getTrackedEntities(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get tracked entities by make method id
 *
 * @mcp read
 */
export const getTrackedEntitiesByMakeMethodId = defineServiceFn({
  input: z.looseObject({ jobMakeMethodId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getTrackedEntitiesByMakeMethodId(
        ctx.asCaller.supabase,
        input.jobMakeMethodId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get tracked entity
 *
 * @mcp read
 */
export const getTrackedEntity = defineServiceFn({
  input: z.looseObject({ trackedEntityId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    const entity = await service.getTrackedEntity(
      ctx.asCaller.supabase,
      input.trackedEntityId
    );
    if (entity.data && entity.data.companyId !== ctx.company.id) {
      return ctx.error("notFound", NOT_FOUND);
    }
    return unwrap(ctx, entity);
  }
});

/**
 * Manual override of a tracked entity's expirationDate
 *
 * @remarks
 * An empty or missing `expirationDate` clears it. The `reason` is kept in the
 * entity's override history.
 *
 * @mcp
 */
export const updateTrackedEntityExpiry = defineServiceFn({
  input: z.looseObject({
    trackedEntityId: z.string(),
    expirationDate: z.string().nullable().optional(),
    reason: z
      .string()
      .min(3, { message: "Reason must be at least 3 characters" })
      .max(500),
    source: z.string().optional()
  }),
  permission: { update: "inventory" },
  async run(ctx, input) {
    const owned = await refuseUnlessOwned(ctx, "trackedEntity", {
      id: input.trackedEntityId
    });
    if (owned) return owned;
    return unwrap(
      ctx,
      await service.updateTrackedEntityExpiry(ctx.asCaller.supabase, {
        trackedEntityId: input.trackedEntityId,
        expirationDate: input.expirationDate || null,
        reason: input.reason,
        source: input.source,
        userId: ctx.auditUserId
      })
    );
  }
});

/**
 * Merge tracked entities into one lot.
 *
 * @remarks
 * Combines two or more Available lots of one item into ONE new lot: their
 * summed quantity, the earliest expiration date and the attributes every lot
 * shares. The merged lots become Consumed, and the new lot's genealogy names
 * each of them. It takes the first lot's number unless `readableId` names one.
 *
 * @mcp
 */
export const mergeTrackedEntities = defineServiceFn({
  input: z.object({
    trackedEntityIds: z.array(z.string()).min(2),
    readableId: z.string().nullable().optional()
  }),
  permission: { update: "inventory" },
  async run(ctx, { trackedEntityIds, readableId }) {
    // As the system: the gate above is the `issue` posting's own rule for a
    // merge, and the posting reads the lots by this company.
    return unwrap(
      ctx,
      await service.mergeTrackedEntities(
        ctx.asSystem.supabase,
        ctx.asSystem.pg,
        {
          trackedEntityIds,
          readableId,
          companyId: ctx.company.id,
          userId: ctx.auditUserId
        }
      )
    );
  }
});

/**
 * Get warehouse transfers
 *
 * @mcp read
 */
export const getWarehouseTransfers = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getWarehouseTransfers(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get warehouse transfer
 *
 * @mcp read
 */
export const getWarehouseTransfer = defineServiceFn({
  input: z.looseObject({ transferId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    const transfer = await service.getWarehouseTransfer(
      ctx.asCaller.supabase,
      input.transferId
    );
    if (transfer.data && transfer.data.companyId !== ctx.company.id) {
      return ctx.error("notFound", NOT_FOUND);
    }
    return unwrap(ctx, transfer);
  }
});

/**
 * The documents a warehouse transfer has raised: the shipments that send it out of the source location and the receipts that take it in at the destination
 *
 * @mcp read
 */
export const getWarehouseTransferRelatedItems = defineServiceFn({
  input: z.looseObject({ transferId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return await service.getWarehouseTransferRelatedItems(
      ctx.asCaller.supabase,
      ctx.company.id,
      input.transferId as never
    );
  }
});

/**
 * Get warehouse transfer line
 *
 * @mcp read
 */
export const getWarehouseTransferLine = defineServiceFn({
  input: z.looseObject({ transferId: z.string(), lineId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    const line = await service.getWarehouseTransferLine(
      ctx.asCaller.supabase,
      input.transferId,
      input.lineId
    );
    if (line.data && line.data.companyId !== ctx.company.id) {
      return ctx.error("notFound", NOT_FOUND);
    }
    return unwrap(ctx, line);
  }
});

/**
 * Get warehouse transfer lines
 *
 * @mcp read
 */
export const getWarehouseTransferLines = defineServiceFn({
  input: z.looseObject({ transferId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    const lines = await service.getWarehouseTransferLines(
      ctx.asCaller.supabase,
      input.transferId
    );
    return unwrap(ctx, {
      ...lines,
      data: lines.data?.filter((line) => line.companyId === ctx.company.id)
    });
  }
});

/**
 * Get stock movement effective quantity
 *
 * @mcp read
 */
export const getStockMovementEffectiveQuantity = defineServiceFn({
  input: z.looseObject({ itemLedgerId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getStockMovementEffectiveQuantity(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.itemLedgerId as never
      )
    );
  }
});

/**
 * Correct stock movement
 *
 * @remarks
 * Books one opposite movement so the posted movement's quantity becomes
 * `correctedQuantity` (signed, as the ledger stores it), dated with the
 * original and posted into its accounting period.
 *
 * @mcp
 */
export const correctStockMovement = defineServiceFn({
  input: service.correctStockMovementInput,
  permission: service.postStockMovementCorrectionPermission,
  async run(ctx, input) {
    const corrected = await run(ctx, "correct-stock-movement", () =>
      service.postStockMovementCorrection(ctx, input)
    );
    return corrected instanceof Error ? corrected : corrected.itemLedger;
  }
});

/**
 * Get inventory counts
 *
 * @mcp read
 */
export const getInventoryCounts = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getInventoryCounts(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get inventory count
 *
 * @mcp read
 */
export const getInventoryCount = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getInventoryCount(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get inventory count lines
 *
 * @mcp read
 */
export const getInventoryCountLines = defineServiceFn({
  input: z.looseObject({
    inventoryCountId: z.string(),
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getInventoryCountLines(
        ctx.asCaller.supabase,
        input.inventoryCountId as never,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get inventory count line summary
 *
 * @mcp read
 */
export const getInventoryCountLineSummary = defineServiceFn({
  input: z.looseObject({ inventoryCountId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return await service.getInventoryCountLineSummary(
      ctx.asCaller.supabase,
      input.inventoryCountId as never,
      ctx.company.id
    );
  }
});

/**
 * Get inventory count movements
 *
 * @mcp read
 */
export const getInventoryCountMovements = defineServiceFn({
  input: z.looseObject({ inventoryCountId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getInventoryCountMovements(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.inventoryCountId as never
      )
    );
  }
});

/**
 * Delete inventory count
 *
 * @mcp destructive
 */
export const deleteInventoryCount = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "inventory" },
  async run(ctx, input) {
    const count = await service.getInventoryCount(
      ctx.asCaller.supabase,
      input.id,
      ctx.company.id
    );
    if (count.error && count.error.code !== "PGRST116") {
      return ctx.error(
        "internal",
        "Failed to load inventory count",
        count.error
      );
    }
    // A posted count is the record of the adjustments it booked.
    if (count.data?.status === "Posted") {
      return ctx.error(
        "rule",
        "Cannot delete a posted count. Correct its stock movements instead."
      );
    }
    return unwrap(
      ctx,
      await service.deleteInventoryCount(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Update inventory count line
 *
 * @remarks
 * Records the caller's count of one line; leaving out `countedQuantity`
 * clears it. Only a Draft count's lines change.
 *
 * @mcp
 */
export const updateInventoryCountLine = defineServiceFn({
  input: z.object({
    id: z.string().min(1),
    countedQuantity: z.number().min(0).optional()
  }),
  permission: { update: "inventory" },
  async run(ctx, { id, countedQuantity }) {
    const updated = await service.updateInventoryCountLine(ctx.asSystem.pg, {
      id,
      countedQuantity,
      companyId: ctx.company.id,
      countedBy: ctx.auditUserId
    });
    if (!updated) {
      return ctx.error(
        "conflict",
        "Counts can only be edited while the document is Draft"
      );
    }
    return updated;
  }
});

/**
 * Confirm or reopen an inventory count
 *
 * @remarks
 * `Pending` confirms a Draft count for review; `Draft` reopens a Pending one
 * for entry. A count is posted only by `postInventoryCount`, which books its
 * variances; a Posted count stays Posted.
 *
 * @mcp
 */
export const updateInventoryCountStatus = defineServiceFn({
  input: z.object({
    id: z.string(),
    status: z.enum(["Draft", "Pending"])
  }),
  permission: { update: "inventory" },
  async run(ctx, { id, status }) {
    const from = inventoryCountStatusFrom(status);
    const count = await service.getInventoryCount(
      ctx.asCaller.supabase,
      id,
      ctx.company.id
    );
    if (count.error && count.error.code !== "PGRST116") {
      return ctx.error(
        "internal",
        "Failed to load inventory count",
        count.error
      );
    }
    if (!count.data) return ctx.error("notFound", "Inventory count not found");
    if (count.data.status !== from.status) {
      return ctx.error("rule", from.refusal);
    }
    const update = await service.updateInventoryCountStatus(
      ctx.asCaller.supabase,
      {
        id,
        companyId: ctx.company.id,
        status,
        expectedStatus: from.status,
        updatedBy: ctx.auditUserId
      }
    );
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to update inventory count status",
        update.error
      );
    }
    return { id, status };
  }
});

/**
 * Update batch property order
 *
 * @mcp
 */
export const updateBatchPropertyOrder = defineServiceFn({
  input: z.looseObject({
    id: z.string().min(1),
    sortOrder: z.number().min(0),
    batchPropertyGroupId: z.string().nullable().optional()
  }),
  permission: { update: "inventory" },
  async run(ctx, input) {
    // The update matches by id alone: it must be this company's property.
    const owned = await refuseUnlessOwned(ctx, "batchProperty", {
      id: input.id
    });
    if (owned) return owned;
    return unwrap(
      ctx,
      await service.updateBatchPropertyOrder(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Upsert batch property
 *
 * @remarks
 * A `list` property needs its `listOptions`; another type keeps none.
 *
 * @mcp
 */
export const upsertBatchProperty = defineServiceFn({
  input: z
    .looseObject({
      id: z.string().optional(),
      itemId: z.string().min(1),
      label: z.string().min(1),
      dataType: z.enum(["text", "numeric", "boolean", "list", "date"]),
      listOptions: z.array(z.string().min(1)).optional(),
      configurationParameterGroupId: z.string().optional()
    })
    .refine((d) => d.dataType !== "list" || !!d.listOptions, {
      message: "List options are required",
      path: ["listOptions"]
    }),
  permission: { update: "inventory" },
  async run(ctx, input) {
    if (input.id) {
      // The update matches by id alone: it must be this company's property.
      const owned = await refuseUnlessOwned(ctx, "batchProperty", {
        id: input.id
      });
      if (owned) return owned;
    }
    return unwrap(
      ctx,
      await service.upsertBatchProperty(
        ctx.asCaller.supabase,
        payload(ctx, {
          ...input,
          listOptions: input.dataType === "list" ? input.listOptions : undefined
        })
          .withUser()
          .for(input.id ? "update" : "create") as never
      )
    );
  }
});

// The kanban form's rules (`kanbanValidator`), for a caller that sends JSON.
const kanbanInput = z
  .looseObject({
    itemId: z.string().min(1),
    replenishmentSystem: z.enum(["Buy", "Make", "Transfer"]),
    autoRelease: z.boolean().optional(),
    autoStartJob: z.boolean().optional(),
    completedBarcodeOverride: z.string().optional(),
    quantity: z.number().int().min(1),
    locationId: z.string().min(1),
    storageUnitId: z.string().optional(),
    fromStorageUnitId: z.string().optional(),
    supplierId: z.string().optional(),
    purchaseUnitOfMeasureCode: z.string().optional(),
    conversionFactor: z
      .number()
      .min(0)
      .describe(
        "1 when left out on create; on update a field left out keeps its value."
      )
      .optional(),
    replenishmentLevel: z.number().min(0).optional(),
    customFields: z.unknown().optional()
  })
  .refine((d) => d.replenishmentSystem !== "Buy" || !!d.supplierId, {
    message: "Supplier is required",
    path: ["supplierId"]
  })
  .refine(
    (d) => d.replenishmentSystem !== "Transfer" || !!d.fromStorageUnitId,
    { message: "From storage unit is required", path: ["fromStorageUnitId"] }
  )
  .refine((d) => d.replenishmentSystem !== "Transfer" || !!d.storageUnitId, {
    message: "To storage unit is required",
    path: ["storageUnitId"]
  })
  .refine(
    (d) =>
      d.replenishmentSystem !== "Transfer" ||
      d.fromStorageUnitId !== d.storageUnitId,
    {
      message: "From and to storage units must be different",
      path: ["storageUnitId"]
    }
  )
  .refine(
    (d) =>
      d.replenishmentSystem === "Transfer" ||
      d.replenishmentLevel === undefined,
    {
      message: "Only a transfer kanban can have a replenishment level",
      path: ["replenishmentLevel"]
    }
  );

/**
 * Create a kanban
 *
 * @remarks
 * A Buy kanban needs its supplier; a Transfer kanban needs a from and a to
 * storage unit, and only it can have a replenishment level.
 *
 * @mcp
 */
export const createKanban = defineServiceFn({
  input: kanbanInput,
  permission: { create: "inventory" },
  async run(ctx, { id: _id, ...input }) {
    return unwrap(
      ctx,
      await service.upsertKanban(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a kanban
 *
 * @remarks
 * The same rules as `createKanban`.
 *
 * @mcp
 */
export const updateKanban = defineServiceFn({
  input: kanbanInput.extend({
    id: z.string().describe("The kanban to update.")
  }),
  permission: { update: "inventory" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertKanban(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a storage unit
 *
 * @remarks
 * Upsert storage unit
 *
 * @mcp
 */
export const createStorageUnit = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    locationId: z.string().min(1),
    warehouseId: z.string().optional(),
    parentId: z.string().optional(),
    workCenterId: z.string().optional(),
    storageTypeIds: z.array(z.string()).optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "inventory" },
  async run(ctx, { id: _id, ...input }) {
    return unwrap(
      ctx,
      await service.upsertStorageUnit(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a storage unit
 *
 * @remarks
 * Upsert storage unit
 *
 * @mcp
 */
export const updateStorageUnit = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1),
      locationId: z.string().min(1),
      warehouseId: z.string().optional(),
      parentId: z.string().optional(),
      workCenterId: z.string().optional(),
      storageTypeIds: z.array(z.string()).optional(),
      customFields: z.unknown().optional(),
      id: z.string().describe("The storage unit to update.").optional()
    })
    .required({ id: true }),
  permission: { update: "inventory" },
  async run(ctx, input) {
    // The update matches by id alone: it must be this company's unit.
    const owned = await refuseUnlessOwned(ctx, "storageUnit", {
      id: input.id
    });
    if (owned) return owned;
    return unwrap(
      ctx,
      await service.upsertStorageUnit(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a shipping method
 *
 * @remarks
 * Upsert shipping method
 *
 * @mcp
 */
export const createShippingMethod = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    carrier: z.enum(["UPS", "FedEx", "USPS", "DHL", "Other"]),
    carrierAccountId: z.string().optional(),
    trackingUrl: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "inventory" },
  async run(ctx, { id: _id, ...input }) {
    return unwrap(
      ctx,
      await service.upsertShippingMethod(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a shipping method
 *
 * @remarks
 * Upsert shipping method
 *
 * @mcp
 */
export const updateShippingMethod = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1),
      carrier: z.enum(["UPS", "FedEx", "USPS", "DHL", "Other"]),
      carrierAccountId: z.string().optional(),
      trackingUrl: z.string().optional(),
      customFields: z.unknown().optional(),
      id: z.string().describe("The shipping method to update.").optional()
    })
    .required({ id: true }),
  permission: { update: "inventory" },
  async run(ctx, input) {
    // The update matches by id alone: it must be this company's method.
    const owned = await refuseUnlessOwned(ctx, "shippingMethod", {
      id: input.id
    });
    if (owned) return owned;
    return unwrap(
      ctx,
      await service.upsertShippingMethod(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a stock transfer line
 *
 * @remarks
 * Adds a line to a Draft stock transfer: reopen a locked one first. The line
 * starts unpicked; picking moves stock through `pickStockTransferLine`.
 *
 * @mcp
 */
export const createStockTransferLine = defineServiceFn({
  input: z.object({
    stockTransferId: z.string().min(1),
    itemId: z.string().min(1),
    fromStorageUnitId: z.string().optional(),
    toStorageUnitId: z.string().optional(),
    quantity: z.number().min(0),
    requiresBatchTracking: z.enum(["true", "false"]),
    requiresSerialTracking: z.enum(["true", "false"])
  }),
  permission: { create: "inventory" },
  async run(ctx, input) {
    const transfer = await service.unlockedStockTransfer(
      ctx,
      input.stockTransferId
    );
    if (transfer instanceof Error) return transfer;
    return unwrap(
      ctx,
      await service.upsertStockTransferLine(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a stock transfer line
 *
 * @remarks
 * Changes a line of a Draft stock transfer: reopen a locked one first. Its
 * picked quantity moves only by picking (`pickStockTransferLine`).
 *
 * @mcp
 */
export const updateStockTransferLine = defineServiceFn({
  input: z
    .object({
      stockTransferId: z.string().min(1),
      itemId: z.string().min(1),
      fromStorageUnitId: z.string().optional(),
      toStorageUnitId: z.string().optional(),
      quantity: z.number().min(0),
      requiresBatchTracking: z.enum(["true", "false"]),
      requiresSerialTracking: z.enum(["true", "false"]),
      id: z.string().describe("The line to update.").optional()
    })
    .required({ id: true }),
  permission: { create: "inventory", update: "inventory" },
  async run(ctx, input) {
    const transfer = await service.unlockedStockTransfer(
      ctx,
      input.stockTransferId
    );
    if (transfer instanceof Error) return transfer;
    // The line must already be on this transfer: an update cannot move it
    // off a locked one.
    const line = await ctx.asCaller.supabase
      .from("stockTransferLine")
      .select("id")
      .eq("id", input.id)
      .eq("stockTransferId", input.stockTransferId)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (line.error) {
      return ctx.error(
        "internal",
        "Failed to load stock transfer line",
        line.error
      );
    }
    if (!line.data) {
      return ctx.error("notFound", "Stock transfer line not found");
    }
    return unwrap(
      ctx,
      await service.upsertStockTransferLine(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Get storage unit descendants
 *
 * @mcp read
 */
export const getStorageUnitDescendants = defineServiceFn({
  input: z.looseObject({ storageUnitId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    const descendants = await service.getStorageUnitDescendants(
      ctx.asCaller.supabase,
      input.storageUnitId
    );
    return unwrap(ctx, {
      ...descendants,
      data: descendants.data?.filter(
        (unit) => unit.companyId === ctx.company.id
      )
    });
  }
});

/**
 * Expand storage unit ids with descendants
 *
 * @mcp read
 */
export const expandStorageUnitIdsWithDescendants = defineServiceFn({
  input: z.looseObject({ storageUnitIds: z.array(z.string()) }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return await service.expandStorageUnitIdsWithDescendants(
      ctx.asCaller.supabase,
      input.storageUnitIds
    );
  }
});

/**
 * Get storage type usage
 *
 * @mcp read
 */
export const getStorageTypeUsage = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getStorageTypeUsage(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Delete storage type with cascade
 *
 * @remarks
 * A storage type that storage units still have is deleted only with
 * `cascade`, which takes it off those units in the same transaction.
 *
 * @mcp destructive
 */
export const deleteStorageTypeWithCascade = defineServiceFn({
  input: z.looseObject({ id: z.string(), cascade: z.boolean().optional() }),
  permission: { delete: "parts" },
  async run(ctx, { id, cascade }) {
    const usage = await service.getStorageTypeUsage(
      ctx.asCaller.supabase,
      id,
      ctx.company.id
    );
    if (usage.error) {
      return ctx.error(
        "internal",
        "Failed to load storage type usage",
        usage.error
      );
    }
    if (usage.count) {
      if (!cascade) {
        return ctx.error(
          "rule",
          "Storage type is in use; confirm cascade to delete"
        );
      }
      // The cascade edits those storage units.
      if (!ctx.can({ update: "parts" })) {
        return ctx.error("forbidden", "You do not have permission to do this");
      }
    }
    await service.deleteStorageTypeWithCascade(
      ctx.asSystem.pg,
      id,
      ctx.company.id
    );
    return { id };
  }
});

/**
 * Get storage types
 *
 * @mcp read
 */
export const getStorageTypes = defineServiceFn({
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
      await service.getStorageTypes(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get storage type
 *
 * @mcp read
 */
export const getStorageType = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    const storageType = await service.getStorageType(
      ctx.asCaller.supabase,
      input.id
    );
    if (storageType.data && storageType.data.companyId !== ctx.company.id) {
      return ctx.error("notFound", NOT_FOUND);
    }
    return unwrap(ctx, storageType);
  }
});

/**
 * Get storage types list
 *
 * @mcp read
 */
export const getStorageTypesList = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "inventory" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getStorageTypesList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Create a storage type
 *
 * @remarks
 * Upsert storage type
 *
 * @mcp
 */
export const createStorageType = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    customFields: z.unknown().optional()
  }),
  permission: { create: "parts" },
  async run(ctx, { id: _id, ...input }) {
    return unwrap(
      ctx,
      await service.upsertStorageType(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a storage type
 *
 * @remarks
 * Upsert storage type
 *
 * @mcp
 */
export const updateStorageType = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1),
      customFields: z.unknown().optional(),
      id: z.string().describe("The storage type to update.").optional()
    })
    .required({ id: true }),
  permission: { update: "parts" },
  async run(ctx, input) {
    // The update matches by id alone: it must be this company's type.
    const owned = await refuseUnlessOwned(ctx, "storageType", {
      id: input.id
    });
    if (owned) return owned;
    return unwrap(
      ctx,
      await service.upsertStorageType(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Get shelf life for items
 *
 * @mcp read
 */
export const getShelfLifeForItems = defineServiceFn({
  input: z.looseObject({ itemIds: z.array(z.string()) }),
  permission: { view: "inventory" },
  async run(ctx, { itemIds }) {
    if (itemIds.length === 0) return [];
    return unwrap(
      ctx,
      await ctx.asCaller.supabase
        .from("itemShelfLife")
        .select("itemId, mode, days")
        .in("itemId", itemIds)
        .eq("companyId", ctx.company.id)
    );
  }
});

/**
 * Map of trackedEntityId → expirationDate (or null) for a set of ids
 *
 * @mcp read
 */
export const getTrackedEntityExpirations = defineServiceFn({
  input: z.looseObject({ trackedEntityIds: z.array(z.string()) }),
  permission: { view: "inventory" },
  async run(ctx, { trackedEntityIds }) {
    if (trackedEntityIds.length === 0) {
      return {} as Record<string, string | null>;
    }
    const entities = await ctx.asCaller.supabase
      .from("trackedEntity")
      .select("id, expirationDate")
      .in("id", trackedEntityIds)
      .eq("companyId", ctx.company.id);
    if (entities.error) {
      return ctx.error(
        "internal",
        "Failed to load expiration dates",
        entities.error
      );
    }
    return Object.fromEntries(
      entities.data.map((entity) => [entity.id, entity.expirationDate ?? null])
    ) as Record<string, string | null>;
  }
});

/**
 * Get picking lists
 *
 * @mcp read
 */
export const getPickingLists = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    assignee: z.string().nullable().optional(),
    locationId: z.string().nullable().optional()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getPickingLists(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get picking list
 *
 * @mcp read
 */
export const getPickingList = defineServiceFn({
  input: z.looseObject({ pickingListId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    const list = await service.getPickingList(
      ctx.asCaller.supabase,
      input.pickingListId
    );
    if (list.data && list.data.companyId !== ctx.company.id) {
      return ctx.error("notFound", NOT_FOUND);
    }
    return unwrap(ctx, list);
  }
});

/**
 * Get picks by job material
 *
 * @mcp read
 */
export const getPicksByJobMaterial = defineServiceFn({
  input: z.looseObject({ jobId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPicksByJobMaterial(
        ctx.asCaller.supabase,
        input.jobId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get picking list lines
 *
 * @mcp read
 */
export const getPickingListLines = defineServiceFn({
  input: z.looseObject({ pickingListId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    const lines = await service.getPickingListLines(
      ctx.asCaller.supabase,
      input.pickingListId
    );
    return unwrap(ctx, {
      ...lines,
      data: lines.data?.filter((line) => line.companyId === ctx.company.id)
    });
  }
});

/**
 * The documents around a picking list that its own row doesn't name: the jobs its lines pick for, with their status
 *
 * @mcp read
 */
export const getPickingListRelatedItems = defineServiceFn({
  input: z.looseObject({ pickingListId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return await service.getPickingListRelatedItems(
      ctx.asCaller.supabase,
      ctx.company.id,
      input.pickingListId as never
    );
  }
});

/**
 * Warehouse on-hand for each line of a picking list: every bin but lineside,
 * the unassigned bin included, keyed by picking list line id.
 *
 * @mcp read
 */
export const getPickingListAvailability = defineServiceFn({
  input: z.looseObject({ pickingListId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    const owned = await refuseUnlessOwned(ctx, "pickingList", {
      id: input.pickingListId
    });
    if (owned) return owned;
    return await service.getPickingListAvailability(
      ctx.asCaller.supabase,
      input.pickingListId as never
    );
  }
});

/**
 * The recommended tracked entities (serial/batch lots) for each tracked picking line, in pick order — surfaced as at-a-glance subtext before the picker opens
 *
 * @mcp read
 */
export const getPickingListRecommendations = defineServiceFn({
  input: z.looseObject({ pickingListId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    const owned = await refuseUnlessOwned(ctx, "pickingList", {
      id: input.pickingListId
    });
    if (owned) return owned;
    return await service.getPickingListRecommendations(
      ctx.asCaller.supabase,
      input.pickingListId as never
    );
  }
});

/**
 * Get picking list line
 *
 * @mcp read
 */
export const getPickingListLine = defineServiceFn({
  input: z.looseObject({ lineId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    const line = await service.getPickingListLine(
      ctx.asCaller.supabase,
      input.lineId
    );
    if (line.data && line.data.companyId !== ctx.company.id) {
      return ctx.error("notFound", NOT_FOUND);
    }
    return unwrap(ctx, line);
  }
});

/**
 * Delete picking list
 *
 * @mcp destructive
 */
export const deletePickingList = defineServiceFn({
  input: z.looseObject({ pickingListId: z.string() }),
  permission: { delete: "inventory" },
  async run(ctx, input) {
    const owned = await refuseUnlessOwned(ctx, "pickingList", {
      id: input.pickingListId
    });
    if (owned) return owned;
    return unwrap(
      ctx,
      await service.deletePickingList(
        ctx.asCaller.supabase,
        input.pickingListId as never
      )
    );
  }
});

/**
 * Get picking schedule
 *
 * @mcp read
 */
export const getPickingSchedule = defineServiceFn({
  input: z.looseObject({
    locationId: z.string(),
    search: z.string().nullable().optional()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPickingSchedule(
        ctx.asCaller.supabase,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Generate picking list
 *
 * @mcp destructive
 */
export const generatePickingList = defineServiceFn({
  input: z.looseObject({
    jobOperationIds: z.array(z.string()),
    locationId: z.string(),
    assignee: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional()
  }),
  permission: { create: "inventory" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.generatePickingList(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});

/**
 * Create a warehouse transfer between locations
 *
 * @remarks
 * Create a Draft warehouse transfer between locations. Generates sequence ID
 * automatically. Its status moves only through `setWarehouseTransferStatus`.
 *
 * @mcp
 */
export const insertWarehouseTransfer = defineServiceFn({
  input: z.object({
    fromLocationId: z.string(),
    toLocationId: z.string(),
    transferId: z.string().optional(),
    transferDate: z.string().optional(),
    expectedReceiptDate: z.string().optional(),
    notes: z.string().optional(),
    reference: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "inventory" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.insertWarehouseTransfer(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});

/**
 * Update an existing warehouse transfer
 *
 * @remarks
 * Only a Draft transfer's header changes: reopen it first. Its status moves
 * only through `setWarehouseTransferStatus`.
 *
 * @mcp
 */
export const updateWarehouseTransfer = defineServiceFn({
  input: z.object({
    id: z.string(),
    fromLocationId: z.string().optional(),
    toLocationId: z.string().optional(),
    transferId: z.string().optional(),
    transferDate: z.string().optional(),
    expectedReceiptDate: z.string().optional(),
    notes: z.string().optional(),
    reference: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { update: "inventory" },
  async run(ctx, input) {
    const transfer = await service.unlockedWarehouseTransfer(ctx, input.id);
    if (transfer instanceof Error) return transfer;
    return unwrap(
      ctx,
      await service.updateWarehouseTransfer(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Value an item's serial units on hand.
 *
 * @remarks
 * What each serial unit of the item on hand would leave stock at, valued the
 * way a shipment or a capitalization relieves it, keyed by tracked entity id.
 * With `locationId`, only the units at that location.
 *
 * @mcp read
 */
export const getSerialUnitCosts = defineServiceFn({
  input: service.previewSerialUnitCostsInput,
  permission: service.previewSerialUnitCostsPermission,
  async run(ctx, input) {
    return run(ctx, "preview-serial-unit-costs", () =>
      service.previewSerialUnitCosts(ctx, input)
    );
  }
});

/**
 * Recost one serial unit in stock.
 *
 * @remarks
 * Re-books the unit's cost layer at `unitCost` and posts the difference
 * against the offset account. The unit must be the only one of its serial on
 * hand at one location, of a FIFO or LIFO item.
 *
 * @mcp
 */
export const recostSerialUnit = defineServiceFn({
  input: service.recostSerialUnitInput,
  permission: service.recostSerialUnitPermission,
  async run(ctx, input) {
    return run(ctx, "recost-serial-unit", () =>
      service.recostSerialUnit(ctx, input)
    );
  }
});
