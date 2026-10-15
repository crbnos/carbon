// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Json } from "@carbon/database";
import {
  dedupeViolations,
  evaluateLinesForSurface,
  evaluateSalesRuleLines,
  isBlocked,
  resolveSalesOrderShipTo
} from "@carbon/ee/rules.server";
import { storage } from "@carbon/files";
import { trigger } from "@carbon/jobs";
import { trackWorkEvent } from "@carbon/lib/telemetry";
import { raiseMoment } from "@carbon/lib/workflows";
import { getLogger } from "@carbon/logger";
import { getCachedPrinterConfig } from "@carbon/printing/printing.server";
import { type ServerFnInput, serverFns } from "@carbon/server-functions";
import type { ServerFnError } from "@carbon/server-functions/errors";
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
import { upsertDocument } from "~/modules/documents/documents.service";
import { recordSalesRuleOutcome } from "~/modules/sales/sales.server";
import {
  type CarbonError,
  defineServiceFn,
  ERROR_STATUS,
  type ErrorCategory,
  type ServiceContext
} from "~/modules/service-fn.server";
import { getNextSequence } from "~/modules/settings/settings.service";
import {
  getCompanyTimeZone,
  getLocationTimeZone
} from "~/modules/shared/timezone.server";
import { stripSpecialCharacters } from "~/utils/string";
import {
  inventoryAdjustmentTypes,
  inventoryItemTypes,
  isStockTransferLocked,
  isWarehouseTransferLocked,
  receiptFixedAssetLineUpdateValidator,
  receiptSourceDocumentType,
  resolveStockTransferPickForward,
  shipmentFixedAssetLineUpdateValidator,
  shipmentSourceDocumentType,
  stockTransferStatusType,
  warehouseTransferStatusType
} from "./inventory.models";
import {
  deleteInventoryCount,
  deleteStorageUnit,
  deleteStorageUnitCascade,
  deleteWarehouseTransferLine,
  generateInventoryCountLines,
  getInventoryCount,
  insertInventoryCount,
  insertManualInventoryAdjustment,
  insertStockTransfer,
  reconcileReceiptSerialEntities,
  updateStockTransferStatus,
  updateWarehouseTransferStatus,
  upsertReceipt,
  upsertShipment,
  upsertWarehouseTransferLine
} from "./inventory.service";
import { renderPackingSlip } from "./packing-slip.server";

const logger = getLogger("erp", "inventory");

// ---------------------------------------------------------------------------
// Shared steps
// ---------------------------------------------------------------------------

type RuleLines = Parameters<typeof evaluateLinesForSurface>[0]["lines"];
type RuleSurface = Parameters<typeof evaluateLinesForSurface>[0]["surface"];

/** A post a blocking rule refused: what the user must see, or acknowledge. */
type Blocked = { violations: Violation[]; ruleNames: Record<string, string> };

/**
 * Every storage rule the lines break, on each surface in turn. Read as the
 * system: a user with `inventory` rights may not see the items or bins.
 */
async function storageRuleViolations(
  ctx: ServiceContext,
  surfaces: RuleSurface[],
  lines: RuleLines
): Promise<Blocked> {
  const violations: Violation[] = [];
  const ruleNames: Record<string, string> = {};
  for (const surface of surfaces) {
    const result = await evaluateLinesForSurface({
      client: ctx.asSystem.supabase,
      companyId: ctx.company.id,
      userId: ctx.auditUserId,
      targetType: "item",
      surface,
      lines
    });
    violations.push(...result.violations);
    Object.assign(ruleNames, result.ruleNames);
  }
  return { violations, ruleNames };
}

/** The server functions, run as the system for this call's company and user. */
function system(ctx: ServiceContext) {
  return serverFns.system({
    db: ctx.asSystem.pg,
    companyId: ctx.company.id,
    userId: ctx.auditUserId
  });
}

const CATEGORY_BY_STATUS = Object.fromEntries(
  Object.entries(ERROR_STATUS).map(([category, status]) => [status, category])
) as Record<number, ErrorCategory>;

/**
 * A server function's failure as this operation's error, its category from
 * the function's own status. A call that returned no data and no error is
 * `internal`.
 */
function serverFnFailure(
  ctx: ServiceContext,
  error: ServerFnError | null,
  message: string
): CarbonError {
  return ctx.error(
    (error && CATEGORY_BY_STATUS[error.status]) || "internal",
    message,
    error
  );
}

const customFieldsInput = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .optional();

/** The caller's default location, from their user defaults. */
async function defaultLocationOf(ctx: ServiceContext) {
  const defaults = await ctx.asCaller.supabase
    .from("userDefaults")
    .select("locationId")
    .eq("userId", ctx.auditUserId)
    .eq("companyId", ctx.company.id)
    .maybeSingle();
  return defaults.data?.locationId ?? undefined;
}

/** Print a document's labels when its location's printer auto-prints. */
async function autoPrint(
  ctx: ServiceContext,
  {
    sourceDocument,
    sourceDocumentId,
    locationId,
    context
  }: {
    sourceDocument: "Receipt" | "Shipment";
    sourceDocumentId: string;
    locationId: string | null;
    context: "receiving" | "shipping";
  }
) {
  if (!locationId) return;
  try {
    const config = await getCachedPrinterConfig(
      ctx.asSystem.supabase,
      ctx.company.id,
      locationId,
      context
    );
    if (config?.autoPrint ?? true) {
      await trigger("print-job", {
        sourceDocument,
        sourceDocumentId,
        companyId: ctx.company.id,
        userId: ctx.auditUserId,
        locationId
      });
    }
  } catch (error) {
    logger.error("Auto-print failed", { error });
  }
}

/** Print a fresh label for each tracked entity a post or pick split. */
async function printEntityLabels(
  ctx: ServiceContext,
  entityIds: string[],
  locationId?: string
) {
  try {
    for (const entityId of entityIds) {
      await trigger("print-job", {
        sourceDocument: "Entity",
        sourceDocumentId: entityId,
        companyId: ctx.company.id,
        userId: ctx.auditUserId,
        ...(locationId ? { locationId } : {})
      });
    }
  } catch (error) {
    logger.error("Auto-print for split entities failed", { error });
  }
}

const RECEIPT_NOT_FOUND = "The receipt could not be found";

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
    const locationId = await defaultLocationOf(ctx);

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
          return system(ctx).invoke("create", {
            type: "receiptFromPurchaseOrder",
            locationId,
            purchaseOrderId: sourceDocumentId,
            receiptId: undefined
          });
        case "Sales Return Order":
          // No default-location guard: the server function falls back to the
          // return order's own location and errors specifically otherwise.
          return system(ctx).invoke("create", {
            type: "receiptFromSalesReturnOrder",
            locationId,
            salesReturnOrderId: sourceDocumentId,
            receiptId: undefined
          });
        case "Inbound Transfer":
          return system(ctx).invoke("create", {
            type: "receiptFromInboundTransfer",
            warehouseTransferId: sourceDocumentId,
            receiptId: undefined
          });
        case "Rental Agreement":
          return system(ctx).invoke("create", {
            type: "receiptFromRentalAgreement",
            rentalAgreementId: sourceDocumentId
          });
        default:
          return system(ctx).invoke("create", {
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
      return serverFnFailure(
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
 * transfer). Otherwise the fields are saved as sent. A rental receipt keeps
 * its rental agreement: changing it is refused.
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
      .select("sourceDocument, sourceDocumentId, locationId")
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
    if (!rebuild) {
      const updated = await upsertReceipt(ctx.asCaller.supabase, {
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
          return system(ctx).invoke("create", {
            type: "receiptFromPurchaseOrder",
            locationId: receipt.locationId,
            purchaseOrderId: receipt.sourceDocumentId,
            receiptId: id
          });
        case "Sales Return Order":
          return system(ctx).invoke("create", {
            type: "receiptFromSalesReturnOrder",
            locationId: receipt.locationId,
            salesReturnOrderId: receipt.sourceDocumentId,
            receiptId: id
          });
        case "Inbound Transfer":
          return system(ctx).invoke("create", {
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
      return serverFnFailure(ctx, created.error, "Failed to create receipt");
    }
    return { id };
  }
});

/**
 * Post a receipt.
 *
 * @remarks
 * In order:
 *   1. A Voided receipt is refused: posting it again would duplicate its
 *      ledger entries, cost layers and journal lines.
 *   2. Storage rules run on the `receipt` and `place` surfaces (and
 *      `warehouseTransfer` for an inbound transfer), and a purchase order
 *      receipt is checked for over-receipt against the live order lines. A
 *      blocking rule returns its `violations` and `ruleNames` and changes
 *      nothing; send `acknowledged: true` to post past warnings.
 *   3. Stale serial entities on serial-tracked lines are deleted, so they
 *      are not made Available as phantom serials.
 *   4. The receipt is set Pending (only from Draft or Pending: `conflict`
 *      otherwise) and posted: ledger entries, cost layers, the journal and
 *      tracked entities. A failed post sets it back to Draft.
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
    if (receipt.data.status === "Voided") {
      return ctx.error(
        "conflict",
        "This receipt has already been posted or voided"
      );
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
    const rules = await storageRuleViolations(
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

    await reconcileReceiptSerialEntities(serviceRole, {
      receiptId,
      companyId,
      lines: lines.data ?? []
    });

    // Conditional on a postable status, so a concurrent void or post is not
    // flipped back to Pending.
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
      return ctx.error("conflict", "Cannot post a voided receipt");
    }

    const backToDraft = () =>
      ctx.asCaller.supabase
        .from("receipt")
        .update({ status: "Draft" })
        .eq("id", receiptId)
        .eq("companyId", companyId);

    let failure: CarbonError | null = null;
    try {
      const posted = await system(ctx).invoke("post-receipt", {
        receiptId,
        postingDate
      });
      if (posted.error) {
        await backToDraft();
        return serverFnFailure(ctx, posted.error, "Failed to post receipt");
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
        const leadTimes = await system(ctx).invoke("update-purchased-prices", {
          source: "purchaseOrder",
          purchaseOrderId: receipt.data.sourceDocumentId,
          updatePrices: false,
          updateLeadTimes: true
        });
        if (leadTimes.error) {
          logger.error("Failed to update lead time on receipt posting", {
            error: leadTimes.error
          });
        }
      }

      await autoPrint(ctx, {
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

    const voided = await system(ctx).invoke("post-receipt", {
      type: "void",
      receiptId
    });
    if (voided.error) {
      return serverFnFailure(ctx, voided.error, "Failed to void receipt");
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
      .select("id")
      .eq("id", receiptLineId)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (line.error) {
      return ctx.error("internal", "Failed to split line", line.error);
    }
    if (!line.data) {
      return ctx.error("notFound", "The receipt line could not be found");
    }

    const split = await system(ctx).invoke("create", {
      type: "receiptLineSplit",
      locationId,
      receiptId,
      receiptLineId,
      quantity
    });
    if (split.error) {
      return serverFnFailure(ctx, split.error, "Failed to split line");
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
        ...receiptFixedAssetLineChange(change),
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

function receiptFixedAssetLineChange(
  change: Omit<z.output<typeof receiptFixedAssetLineUpdateValidator>, "id">
) {
  switch (change.field) {
    case "received":
      return { received: change.value === "true" };
    case "serialNumber":
      return { serialNumber: change.value || null };
    case "meter":
      return { meter: change.value === "" ? null : Number(change.value) };
    case "notes":
      return { notes: change.value.trim() || null };
    case "outOfService":
      return change.value.trim() === ""
        ? { takeOutOfService: false, outOfServiceReason: null }
        : { takeOutOfService: true, outOfServiceReason: change.value.trim() };
    case "residualDestination":
      return {
        residualDestination: (change.value || null) as
          | "Fleet"
          | "Inventory"
          | null
      };
  }
}

/** The receipt line, read as the system: the tracking RPCs key on its ids alone. */
async function receiptLineOf(
  ctx: ServiceContext,
  { receiptId, receiptLineId }: { receiptId: string; receiptLineId: string }
) {
  const line = await ctx.asSystem.supabase
    .from("receiptLine")
    .select("id, itemId")
    .eq("id", receiptLineId)
    .eq("receiptId", receiptId)
    .eq("companyId", ctx.company.id)
    .maybeSingle();
  if (line.error) {
    return ctx.error(
      "internal",
      "Failed to verify the receipt line",
      line.error
    );
  }
  if (!line.data) {
    return ctx.error(
      "notFound",
      "The receipt line could not be found. It may have been deleted, or it belongs to another company."
    );
  }
  return line.data;
}

/**
 * Set the batch number of a batch-tracked receipt line.
 *
 * @remarks
 * Creates or updates the line's batch (On Hold until the receipt posts) with
 * the line's quantity, its properties and an optional `expirationDate` in
 * `properties`. `trackedEntityId` names the line's existing batch; without it
 * the batch already tagged with the line is updated, so renaming a batch
 * number never orphans the old one.
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
    const line = await receiptLineOf(ctx, input);
    if (line instanceof Error) return line;

    let trackedEntityId = input.trackedEntityId;
    if (trackedEntityId) {
      // The RPC upserts by this id: one from another company would overwrite
      // that company's lot.
      const entity = await ctx.asSystem.supabase
        .from("trackedEntity")
        .select("id")
        .eq("id", trackedEntityId)
        .eq("companyId", ctx.company.id)
        .maybeSingle();
      if (entity.error || !entity.data) {
        return ctx.error("notFound", "The tracked entity could not be found");
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
    const line = await receiptLineOf(ctx, input);
    if (line instanceof Error) return line;

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

/** A sales-return receipt line, and the receipt's return order. */
async function returnReceiptLineOf(
  ctx: ServiceContext,
  { receiptId, receiptLineId }: { receiptId: string; receiptLineId: string }
) {
  const client = ctx.asCaller.supabase;
  const [receipt, line] = await Promise.all([
    client
      .from("receipt")
      .select("id, sourceDocument, sourceDocumentId")
      .eq("id", receiptId)
      .eq("companyId", ctx.company.id)
      .maybeSingle(),
    client
      .from("receiptLine")
      .select("id, lineId")
      .eq("id", receiptLineId)
      // Scoped to the receipt too: without it, a line of another receipt of
      // the same return order would tag the entity with a mismatched pair.
      .eq("receiptId", receiptId)
      .eq("companyId", ctx.company.id)
      .maybeSingle()
  ]);
  if (!receipt.data || receipt.data.sourceDocument !== "Sales Return Order") {
    return ctx.error(
      "validation",
      "Return tracking requires a sales-return receipt"
    );
  }
  if (!line.data?.lineId) {
    return ctx.error("validation", "Receipt line not found");
  }
  return {
    returnOrderId: receipt.data.sourceDocumentId,
    returnLineId: line.data.lineId
  };
}

function withoutReceiptTracking(attributes: Record<string, unknown>) {
  const {
    Receipt: _receipt,
    "Receipt Line": _line,
    "Receipt Line Index": _index,
    ...rest
  } = attributes;
  return rest;
}

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

    const [returnLine, entity] = await Promise.all([
      returnReceiptLineOf(ctx, { receiptId, receiptLineId }),
      client
        .from("trackedEntity")
        .select("id, status, attributes, itemId")
        .eq("id", trackedEntityId)
        .eq("companyId", companyId)
        .maybeSingle()
    ]);
    if (returnLine instanceof Error) return returnLine;
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
        .update({ attributes: withoutReceiptTracking(staleAttributes) as Json })
        .eq("id", staleEntity.id)
        .eq("companyId", companyId);
    }

    const assigned = await serviceRole
      .from("trackedEntity")
      .update({
        attributes: {
          ...withoutReceiptTracking(attributes),
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
    const [returnLine, entity] = await Promise.all([
      returnReceiptLineOf(ctx, { receiptId, receiptLineId }),
      ctx.asCaller.supabase
        .from("trackedEntity")
        .select("id, attributes")
        .eq("id", trackedEntityId)
        .eq("companyId", ctx.company.id)
        .maybeSingle()
    ]);
    if (returnLine instanceof Error) return returnLine;
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
      .update({ attributes: withoutReceiptTracking(attributes) as Json })
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
    const locationId = await defaultLocationOf(ctx);

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
          return system(ctx).invoke("create", {
            type: "shipmentFromSalesOrder",
            locationId: locationId!,
            salesOrderId: sourceDocumentId,
            shipmentId: undefined
          });
        case "Sales Return Order":
          return system(ctx).invoke("create", {
            type: "shipmentFromSalesReturnOrder",
            locationId,
            salesReturnOrderId: sourceDocumentId,
            shipmentId: undefined
          });
        case "Purchase Return Order":
          return system(ctx).invoke("create", {
            type: "shipmentFromPurchaseReturnOrder",
            locationId,
            purchaseReturnOrderId: sourceDocumentId,
            shipmentId: undefined
          });
        case "Purchase Order":
          return system(ctx).invoke("create", {
            type: "shipmentFromPurchaseOrder",
            locationId: locationId!,
            purchaseOrderId: sourceDocumentId,
            shipmentId: undefined
          });
        case "Outbound Transfer":
          return system(ctx).invoke("create", {
            type: "shipmentFromWarehouseTransfer",
            warehouseTransferId: sourceDocumentId,
            shipmentId: undefined
          });
        case "Rental Agreement":
          return system(ctx).invoke("create", {
            type: "shipmentFromRentalAgreement",
            rentalAgreementId: sourceDocumentId
          });
        default:
          return system(ctx).invoke("create", {
            type: "shipmentDefault",
            locationId
          });
      }
    })();
    if (created.error || !created.data) {
      return serverFnFailure(
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
 * purchase return order or an outbound transfer). Otherwise the fields are
 * saved as sent. A rental shipment keeps its rental agreement: changing it is
 * refused.
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
      .select("sourceDocument, sourceDocumentId, locationId")
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
    if (!rebuild) {
      const updated = await upsertShipment(ctx.asCaller.supabase, {
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
          return system(ctx).invoke("create", {
            type: "shipmentFromSalesOrder",
            locationId: locationId as string,
            salesOrderId: sourceDocumentId,
            shipmentId: id
          });
        case "Sales Return Order":
          return system(ctx).invoke("create", {
            type: "shipmentFromSalesReturnOrder",
            locationId,
            salesReturnOrderId: sourceDocumentId,
            shipmentId: id
          });
        case "Purchase Return Order":
          return system(ctx).invoke("create", {
            type: "shipmentFromPurchaseReturnOrder",
            locationId,
            purchaseReturnOrderId: sourceDocumentId,
            shipmentId: id
          });
        case "Purchase Order":
          return system(ctx).invoke("create", {
            type: "shipmentFromPurchaseOrder",
            locationId: locationId as string,
            purchaseOrderId: sourceDocumentId,
            shipmentId: id
          });
        case "Outbound Transfer":
          return system(ctx).invoke("create", {
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
      return serverFnFailure(
        ctx,
        created.error,
        getErrorMessage(created.error, "Failed to create shipment")
      );
    }
    return { id };
  }
});

/**
 * Save a sales order shipment's packing slip on the order's opportunity.
 * Best effort: a failure is logged and never stops the post.
 */
async function savePackingSlip(
  ctx: ServiceContext,
  { shipmentId, locale }: { shipmentId: string; locale: string }
) {
  const companyId = ctx.company.id;
  const serviceRole = ctx.asSystem.supabase;
  try {
    const shipment = await serviceRole
      .from("shipment")
      .select("sourceDocument, sourceDocumentId, shipmentId")
      .eq("id", shipmentId)
      .eq("companyId", companyId)
      .single();
    if (
      shipment.data?.sourceDocument !== "Sales Order" ||
      !shipment.data.sourceDocumentId
    ) {
      return;
    }

    const salesOrder = await serviceRole
      .from("salesOrder")
      .select("opportunityId")
      .eq("id", shipment.data.sourceDocumentId)
      .eq("companyId", companyId)
      .single();
    if (!salesOrder.data?.opportunityId) return;

    const pdf = await renderPackingSlip({
      client: ctx.asCaller.supabase,
      serviceRole,
      companyId,
      shipmentId,
      locale
    });
    if (pdf.headers.get("content-type") !== "application/pdf") return;

    const file = await pdf.arrayBuffer();
    const fileName = stripSpecialCharacters(
      `${shipment.data.shipmentId} - ${datetime.timestamp().slice(0, -5)}.pdf`
    );
    const documentFilePath = `${companyId}/opportunity/${salesOrder.data.opportunityId}/${fileName}`;
    const upload = await storage(serviceRole)
      .company(companyId)
      .upload(documentFilePath, file, {
        cacheControl: `${12 * 60 * 60}`,
        contentType: "application/pdf",
        upsert: true
      });
    if (upload.error) return;

    await upsertDocument(serviceRole, {
      path: documentFilePath,
      name: fileName,
      size: round(file.byteLength / 1024, 0),
      sourceDocument: "Shipment",
      sourceDocumentId: shipmentId,
      readGroups: [ctx.auditUserId],
      writeGroups: [ctx.auditUserId],
      createdBy: ctx.auditUserId,
      companyId
    });
  } catch (error) {
    logger.error("Failed to generate packing slip PDF", { error });
  }
}

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
    const rules = await storageRuleViolations(
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

    const backToDraft = () =>
      ctx.asCaller.supabase
        .from("shipment")
        .update({ status: "Draft" })
        .eq("id", shipmentId)
        .eq("companyId", companyId);

    let failure: CarbonError | null = null;
    let splitEntityIds: string[] = [];
    try {
      await savePackingSlip(ctx, { shipmentId, locale });
      const posted = await system(ctx).invoke("post-shipment", {
        type: "post",
        shipmentId,
        postingDate
      });
      if (posted.error) {
        await backToDraft();
        return serverFnFailure(ctx, posted.error, "Failed to post shipment");
      }
      splitEntityIds = posted.data?.splitEntityIds ?? [];
    } catch (thrown) {
      await backToDraft();
      failure = ctx.error("internal", "Failed to post shipment", thrown);
    }

    if (!failure) {
      await autoPrint(ctx, {
        sourceDocument: "Shipment",
        sourceDocumentId: shipmentId,
        locationId: shipment.data.locationId,
        context: "shipping"
      });
      // The RETAINED shelf lots of a batch split are reprinted: their
      // quantity changed. The shipped child left Consumed and gets no label.
      await printEntityLabels(ctx, splitEntityIds);
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

    const voided = await system(ctx).invoke("post-shipment", {
      type: "void",
      shipmentId
    });
    if (voided.error) {
      return serverFnFailure(ctx, voided.error, "Failed to void shipment");
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
      .select("id")
      .eq("id", shipmentLineId)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (line.error) {
      return ctx.error("internal", "Failed to split line", line.error);
    }
    if (!line.data) {
      return ctx.error("notFound", "The shipment line could not be found");
    }

    const split = await system(ctx).invoke("create", {
      type: "shipmentLineSplit",
      locationId,
      shipmentId,
      shipmentLineId,
      quantity
    });
    if (split.error) {
      return serverFnFailure(ctx, split.error, "Failed to split line");
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
        .select("sourceDocument, sourceDocumentId")
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

const STOCK_TRANSFER_LOCKED =
  "Cannot modify a locked stock transfer. Reopen it first.";

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
    const rules = await storageRuleViolations(
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

    const created = await insertStockTransfer(ctx.asCaller.supabase, {
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
      const rules = await storageRuleViolations(
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
    const update = await updateStockTransferStatus(ctx.asCaller.supabase, {
      id,
      status,
      assignee: completed ? null : undefined,
      completedAt: completed ? datetime.timestamp() : null,
      updatedBy: ctx.auditUserId
    });
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

/** A stock transfer line of this company, with its transfer's status. */
async function stockTransferLineOf(ctx: ServiceContext, lineId: string) {
  const line = await ctx.asCaller.supabase
    .from("stockTransferLine")
    .select(
      "id, stockTransferId, quantity, pickedQuantity, requiresSerialTracking, requiresBatchTracking, stockTransfer(status)"
    )
    .eq("id", lineId)
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
  if (line.data.stockTransfer?.status === "Completed") {
    return ctx.error("rule", "Cannot pick from a completed stock transfer.");
  }
  return line.data;
}

/** Move a line's stock (or put it back), and label any batch it split. */
async function postStockTransferLine(
  ctx: ServiceContext,
  input: {
    type:
      | "inventory"
      | "unpickSerial"
      | "unpickBatch"
      | "unpickInventory"
      | "batch"
      | "serial";
    stockTransferId: string;
    stockTransferLineId: string;
    quantity: number;
    locationId: string;
    trackedEntityId?: string;
  },
  failure: (error: ServerFnError) => string
) {
  const moved = await system(ctx).invoke(
    "post-stock-transfer",
    // One body for every `type`; the server function validates it per type.
    input as ServerFnInput<"post-stock-transfer">
  );
  if (moved.error)
    return serverFnFailure(ctx, moved.error, failure(moved.error));

  // The split child that arrives at the destination gets a fresh label; the
  // shelf parent whose quantity changed is reprinted.
  const splitEntityId = moved.data?.splitEntityId;
  if (splitEntityId) {
    await printEntityLabels(
      ctx,
      [
        splitEntityId,
        ...(input.trackedEntityId ? [input.trackedEntityId] : [])
      ],
      input.locationId || undefined
    );
  }
  return {
    stockTransferId: input.stockTransferId,
    stockTransferLineId: input.stockTransferLineId,
    quantity: input.quantity
  };
}

/**
 * Pick a stock transfer line.
 *
 * @remarks
 * Moves `quantity` of the line's item from its source to its destination
 * storage unit. A serial- or batch-tracked line needs its `trackedEntityId`;
 * `inventory.stockTransfer.line.pickEntity` picks a scanned one. A Completed
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
    const line = await stockTransferLineOf(ctx, lineId);
    if (line instanceof Error) return line;
    if (
      !trackedEntityId &&
      (line.requiresSerialTracking || line.requiresBatchTracking)
    ) {
      return ctx.error("validation", "Tracked entity not found");
    }
    return postStockTransferLine(
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
    const line = await stockTransferLineOf(ctx, lineId);
    if (line instanceof Error) return line;
    if (
      !trackedEntityId &&
      (line.requiresSerialTracking || line.requiresBatchTracking)
    ) {
      return ctx.error("validation", "Tracked entity not found");
    }
    return postStockTransferLine(
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
    const line = await stockTransferLineOf(ctx, lineId);
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

    return postStockTransferLine(
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
      return ctx.error("rule", STOCK_TRANSFER_LOCKED);
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

const WAREHOUSE_TRANSFER_NOT_FOUND =
  "The warehouse transfer could not be found";
const WAREHOUSE_TRANSFER_LOCKED =
  "Cannot modify a locked warehouse transfer. Reopen it first.";

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
      return ctx.error("notFound", WAREHOUSE_TRANSFER_NOT_FOUND);
    }

    if (WAREHOUSE_TRANSFER_COMMITS.has(status)) {
      const lines = await ctx.asSystem.supabase
        .from("warehouseTransferLine")
        .select("id, itemId, toStorageUnitId, toLocationId, quantity")
        .eq("transferId", id)
        .eq("companyId", ctx.company.id);
      const rules = await storageRuleViolations(
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

    const update = await updateWarehouseTransferStatus(
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

/** A Draft warehouse transfer of this company: any other is locked. */
async function unlockedWarehouseTransfer(
  ctx: ServiceContext,
  transferId: string
) {
  const transfer = await ctx.asCaller.supabase
    .from("warehouseTransfer")
    .select("id, status, fromLocationId, toLocationId")
    .eq("id", transferId)
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
    return ctx.error("notFound", WAREHOUSE_TRANSFER_NOT_FOUND);
  }
  if (isWarehouseTransferLocked(transfer.data.status)) {
    return ctx.error("rule", WAREHOUSE_TRANSFER_LOCKED);
  }
  return transfer.data;
}

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
    const transfer = await unlockedWarehouseTransfer(ctx, transferId);
    if (transfer instanceof Error) return transfer;

    const created = await upsertWarehouseTransferLine(ctx.asCaller.supabase, {
      ...line,
      transferId,
      fromLocationId: transfer.fromLocationId,
      toLocationId: transfer.toLocationId,
      companyId: ctx.company.id,
      createdBy: ctx.auditUserId
    });
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

/** The line, when it is on this transfer. */
async function warehouseTransferLineOf(
  ctx: ServiceContext,
  { transferId, id }: { transferId: string; id: string }
) {
  const line = await ctx.asCaller.supabase
    .from("warehouseTransferLine")
    .select("id")
    .eq("id", id)
    .eq("transferId", transferId)
    .eq("companyId", ctx.company.id)
    .maybeSingle();
  if (line.error) {
    return ctx.error(
      "internal",
      "Failed to load warehouse transfer line",
      line.error
    );
  }
  if (!line.data) {
    return ctx.error(
      "notFound",
      "The warehouse transfer line could not be found"
    );
  }
  return line.data;
}

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
    const transfer = await unlockedWarehouseTransfer(ctx, transferId);
    if (transfer instanceof Error) return transfer;
    const existing = await warehouseTransferLineOf(ctx, { transferId, id });
    if (existing instanceof Error) return existing;

    const updated = await upsertWarehouseTransferLine(ctx.asCaller.supabase, {
      id,
      ...line,
      updatedBy: ctx.auditUserId
    });
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
    const transfer = await unlockedWarehouseTransfer(ctx, transferId);
    if (transfer instanceof Error) return transfer;
    const existing = await warehouseTransferLineOf(ctx, { transferId, id });
    if (existing instanceof Error) return existing;

    const deleted = await deleteWarehouseTransferLine(
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

    const created = await insertInventoryCount(ctx.asCaller.supabase, {
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
      await generateInventoryCountLines(ctx.asSystem.pg, {
        inventoryCountId: created.data.id,
        companyId,
        locationId,
        createdBy: ctx.auditUserId,
        storageUnitIds,
        itemType
      });
    } catch (error) {
      await deleteInventoryCount(
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
    const header = await getInventoryCount(
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

    const posted = await system(ctx).invoke("post-inventory-count", {
      inventoryCountId
    });
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
      return serverFnFailure(ctx, posted.error, message);
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
      quantity: z.number(),
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
  permission: { create: "inventory" },

  async run(ctx, { acknowledged, ...adjustment }) {
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
    const rules = await storageRuleViolations(
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

    const itemLedger = await insertManualInventoryAdjustment(
      ctx.asCaller.supabase,
      ctx.asSystem.pg,
      {
        ...adjustment,
        companyId: ctx.company.id,
        createdBy: ctx.auditUserId
      }
    );
    if (itemLedger.error) {
      // Only these reasons are worth showing; the rest is a failure.
      const shown = [
        "Insufficient quantity for negative adjustment",
        "Serial number not found",
        "Multiple tracked entities in this storage unit — select a specific row to adjust"
      ];
      return shown.includes(itemLedger.error)
        ? ctx.error("rule", itemLedger.error)
        : ctx.error(
            "internal",
            "Failed to create manual inventory adjustment",
            itemLedger.error
          );
    }
    return { itemLedgerId: itemLedger.data?.id ?? null };
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
      ? await deleteStorageUnitCascade(ctx.asCaller.supabase, storageUnitId)
      : await deleteStorageUnit(ctx.asCaller.supabase, storageUnitId);
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
