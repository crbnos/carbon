// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { NotFoundError } from "@carbon/api/errors";
import {
  CarbonError,
  createServiceContext,
  defineServiceFn
} from "@carbon/api/service-fn.server";
import { paged, payload, run, unwrap } from "@carbon/api/service-tools.server";
import type { Json } from "@carbon/database";
import { rows } from "@carbon/database/row-schemas";
import { convertUnitPrice } from "@carbon/database/supplier-part-price";
import {
  dedupeViolations,
  evaluateSalesRuleLines,
  isBlocked,
  resolveSalesOrderShipTo
} from "@carbon/ee/rules.server";
import { trackWorkEvent } from "@carbon/lib/telemetry";
import { raiseMoment } from "@carbon/lib/workflows";
import { getLogger } from "@carbon/logger";
import { runLocationSchedule } from "@carbon/planning";
import {
  datetime,
  getErrorMessage,
  getOverReceiptViolations,
  isUniqueViolation,
  requireAffected,
  round,
  type Violation
} from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { z } from "zod";
import { getItemReplenishment } from "~/modules/items/items.service";
import { getSupplierPartPricing } from "~/modules/items/items.utils";
import { releaseCheckedJobs } from "~/modules/production/production.server";
import {
  getActiveJobOperationByJobId,
  getJobReleaseReadiness,
  insertJob,
  updateKanbanJob,
  upsertJobMethod
} from "~/modules/production/production.service";
import { jobReleaseProblems } from "~/modules/production/ui/Jobs/job-release-logic";
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
  booleanField,
  optionalTiptapDoc
} from "~/modules/shared/shared.models";
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
  isSameStorageUnit,
  pickingListStatusType,
  receiptFixedAssetLineUpdateValidator,
  receiptSourceDocumentType,
  resolveStockTransferPickForward,
  SAME_STORAGE_UNIT_MESSAGE,
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

export const createReceipt = defineServiceFn({
  publish: true,
  title: "Create a receipt",
  description: `From its source document, with its lines: a purchase order, a sales return
order, an inbound warehouse transfer or a rental agreement. With no source
document it creates an empty receipt. The location is the caller's default
location; a sales return falls back to the return order's own.

A sales return order or rental agreement with a Draft receipt already
returns that receipt instead of a second one. A purchase order with Draft
receipts returns the oldest one.`,
  output: rows.receipt.pick({ id: true }).meta({ table: "receipt" }),
  input: z.object({
    sourceDocument: z.enum(receiptSourceDocumentType).optional(),
    sourceDocumentId: z.string().default("")
  }),
  permission: { create: "inventory" },

  async run(ctx, { sourceDocument, sourceDocumentId }) {
    const locationId = await service.defaultLocationOf(ctx);

    // One open draft per purchase order, return order or agreement: a second
    // Receive goes to the existing draft instead of stacking up duplicates.
    if (
      sourceDocument === "Purchase Order" ||
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
        // A purchase order reuses its oldest Draft; a return order or an
        // agreement keeps its newest, as before.
        .order("createdAt", { ascending: sourceDocument === "Purchase Order" })
        .order("id", { ascending: true })
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

export const updateReceipt = defineServiceFn({
  publish: true,
  title: "Update a receipt's details",
  description: `A changed source document or location rebuilds the receipt's lines from
the new source (a purchase order, a sales return order or an inbound
transfer), and is refused once the receipt is not Draft. Otherwise the
fields are saved as sent. A rental receipt keeps its rental agreement:
changing it is refused.`,
  output: rows.receipt.pick({ id: true }).meta({ table: "receipt" }),
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

export const postReceipt = defineServiceFn({
  publish: true,
  title: "Post a receipt",
  description: `In order:
  1. A Posted or Voided receipt is refused (\`conflict\`): posting it again
     would duplicate its ledger entries, cost layers and journal lines.
  2. Storage rules run on the \`receipt\` and \`place\` surfaces (and
     \`warehouseTransfer\` for an inbound transfer), and a purchase order
     receipt is checked for over-receipt against the live order lines. A
     blocking rule returns its \`violations\` and \`ruleNames\` and changes
     nothing; send \`acknowledged: true\` to post past warnings.
  3. The receipt is set Pending (only from Draft or Pending: \`conflict\`
     otherwise).
  4. Stale serial entities on serial-tracked lines are deleted, so they
     are not made Available as phantom serials, and the receipt is posted:
     ledger entries, cost layers, the journal and tracked entities. A
     failed post sets it back to Draft.
  5. Supplier lead times are refreshed when the company setting is on,
     labels print when the receiving printer auto-prints, and the
     receipt-posted workflow moment is raised.

\`postingDate\` dates a rental return; every other receipt posts today.`,
  output: z.union([
    z.object({
      violations: z.array(
        z.object({
          ruleId: z.string(),
          severity: z.enum(["error", "warn"]),
          message: z.string(),
          lineId: z.string().nullable().optional()
        })
      ),
      ruleNames: z.record(z.string(), z.string()),
      posted: z.null().optional()
    }),
    z.object({
      posted: z.boolean(),
      violations: z.null().optional(),
      ruleNames: z.null().optional()
    }),
    z.null()
  ]),
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
            "id, purchaseQuantity, quantityReceived, item!purchaseOrderLine_itemId_fkey(readableIdWithRevision)"
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
      const { linesMissingSerials } =
        await service.reconcileReceiptSerialEntities(ctx.asSystem.pg, {
          receiptId,
          companyId,
          isSalesReturn: receipt.data.sourceDocument === "Sales Return Order",
          lines: lines.data ?? []
        });
      if (linesMissingSerials.length > 0) {
        await backToDraft();
        return ctx.error("rule", "Serial numbers are missing");
      }
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
        // Below 500 the posting refused the receipt, in words for the person.
        return posted.error.status < 500
          ? service.serverFnFailure(
              ctx,
              posted.error,
              posted.error.message || "Failed to post receipt"
            )
          : ctx.error("internal", "Failed to post receipt", posted.error);
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

export const voidReceipt = defineServiceFn({
  publish: "destructive",
  title: "Void a posted receipt",
  description: `Reverses its inventory adjustments and journal entries, restores its
tracked entities and the purchase order quantities. Only a Posted receipt
can be voided, and not one a purchase invoice created: void the invoice
instead.`,
  output: rows.receipt.pick({ receiptId: true }).meta({ table: "receipt" }),
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
      // Below 500 the posting refused the void, in words for the person.
      return voided.error.status < 500
        ? service.serverFnFailure(
            ctx,
            voided.error,
            voided.error.message || "Failed to void receipt"
          )
        : ctx.error("internal", "Failed to void receipt", voided.error);
    }
    return { receiptId };
  }
});

export const splitReceiptLine = defineServiceFn({
  publish: true,
  title: "Split a receipt line in two",
  description: `Moves \`quantity\` of the line onto a new line of the same receipt, so the
two can go to different storage units or carry different tracking.`,
  output: z.object({
    receiptLineId: z.string()
  }),
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

export const updateReceiptLines = defineServiceFn({
  publish: true,
  title: "Set one field on receipt lines",
  description: `\`storageUnitId\` or \`receivedQuantity\`, on every line in \`ids\`. An empty
value clears the field. Storage rules run when the receipt is posted, not
here.`,
  output: z.object({
    ids: z.array(z.string())
  }),
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

    if (field === "receivedQuantity") {
      const receivedQuantity = Number(value || 0);
      if (!Number.isFinite(receivedQuantity)) {
        return ctx.error("validation", "Received quantity must be a number");
      }
      // Drop serials beyond the new quantity in the same transaction.
      try {
        await ctx.asSystem.pg.transaction().execute(async (trx) => {
          const updated = await trx
            .updateTable("receiptLine")
            .set({
              receivedQuantity,
              updatedBy: ctx.auditUserId,
              updatedAt: datetime.timestamp()
            })
            .where("id", "in", ids)
            .where("companyId", "=", ctx.company.id)
            .returning([
              "id",
              "receiptId",
              "receivedQuantity",
              "requiresSerialTracking"
            ])
            .execute();
          if (updated.length === 0) return;

          const receipts = await trx
            .selectFrom("receipt")
            .select(["id", "sourceDocument"])
            .where("id", "in", [...new Set(updated.map((l) => l.receiptId))])
            .where("companyId", "=", ctx.company.id)
            .where("status", "=", "Draft")
            .execute();
          for (const receipt of receipts) {
            await service.reconcileReceiptSerialsInTransaction(trx, {
              receiptId: receipt.id,
              companyId: ctx.company.id,
              isSalesReturn: receipt.sourceDocument === "Sales Return Order",
              lines: updated.filter((l) => l.receiptId === receipt.id)
            });
          }
        });
      } catch (error) {
        return ctx.error("internal", "Failed to update receipt lines", error);
      }
      return { ids };
    }

    const update = await ctx.asCaller.supabase
      .from("receiptLine")
      .update({
        storageUnitId: value || null,
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

export const updateReceiptFixedAssetLine = defineServiceFn({
  publish: true,
  title: "Update one field of a fixed-asset line on a receipt",
  description: `\`received\`, \`serialNumber\`, \`meter\`, \`notes\`, \`outOfService\` (an empty
value returns the unit to service, any other text is the reason) or
\`residualDestination\`. A posted or voided receipt is a record: its lines no
longer change.`,
  output: rows.receiptFixedAssetLine
    .pick({ id: true })
    .meta({ table: "receiptFixedAssetLine" }),
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

    const update = await requireAffected(
      serviceRole
        .from("receiptFixedAssetLine")
        .update({
          ...service.receiptFixedAssetLineChange(change),
          updatedBy: ctx.auditUserId
        })
        .eq("id", id)
        .eq("companyId", ctx.company.id)
        .select("id")
    );
    if (update.error) {
      return ctx.error("internal", "Failed to update the line", update.error);
    }
    return { id };
  }
});
export const setReceiptLineBatch = defineServiceFn({
  publish: true,
  title: "Set the batch number of a batch-tracked receipt line",
  description: `Creates or updates the line's batch (On Hold until the receipt posts) with
the line's quantity, its properties and an optional \`expirationDate\` in
\`properties\`. \`trackedEntityId\` names the line's existing batch (another
entity is refused); without it the batch already tagged with the line is
updated, so renaming a batch number never orphans the old one. Only a
Draft receipt's batches change.`,
  output: z.object({
    receiptLineId: z.string()
  }),
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

export const setReceiptLineSerial = defineServiceFn({
  publish: true,
  title: "Set one serial number of a serial-tracked receipt line",
  description: `\`index\` is the unit's position on the line, from 0. An empty serial number
clears the position. A serial number the line's item already uses at another
position, or that belongs to an existing unit with stock movements, is
refused and the position is cleared.`,
  output: z.object({
    receiptLineId: z.string(),
    index: z.number()
  }),
  input: z.object({
    receiptId: z.string(),
    receiptLineId: z.string(),
    serialNumber: z.string(),
    index: z.number().int().min(0),
    expiryDate: z.string().optional()
  }),
  permission: { create: "inventory" },

  async run(ctx, input) {
    const line = await service.receiptLineOf(ctx, input);
    if (line instanceof Error) return line;

    const box = {
      companyId: ctx.company.id,
      receiptLineId: input.receiptLineId,
      index: input.index
    };
    let saved: service.ReceiptSerialBoxResult;
    try {
      saved = await service.saveReceiptSerialBox(ctx.asSystem.pg, {
        ...box,
        receiptId: input.receiptId,
        itemId: line.itemId ?? "",
        serialNumber: input.serialNumber.trim(),
        expiryDate: input.expiryDate
      });
    } catch (error) {
      // The position shows a value that did not save; empty it so its
      // previous serial cannot post in its place.
      await service
        .clearReceiptSerialBox(ctx.asSystem.pg, box)
        .catch((clearError) =>
          logger.error("Failed to clear the serial box", {
            ...box,
            error: clearError
          })
        );
      if (isUniqueViolation(error)) {
        return ctx.error(
          "conflict",
          "Serial number already exists for this item"
        );
      }
      return ctx.error("internal", "Failed to update tracking", error);
    }

    if (!saved.ok) {
      switch (saved.reason) {
        case "notFound":
          return ctx.error("notFound", RECEIPT_NOT_FOUND);
        case "locked":
          return ctx.error("rule", RECEIPT_LOCKED);
        case "unit":
          return ctx.error(
            "conflict",
            "Serial number already belongs to an existing unit"
          );
        case "box":
          return ctx.error(
            "conflict",
            "Serial number is already used for a different item or position"
          );
      }
    }
    return { receiptLineId: input.receiptLineId, index: input.index };
  }
});
export const assignReceiptReturnEntity = defineServiceFn({
  publish: true,
  title: "Assign a returned tracked entity to a sales-return receipt line",
  description: `Re-tags the EXISTING entity a customer sent back with this receipt line,
instead of creating a new serial or batch; posting reactivates it On Hold.
The entity must be Consumed, the return line's item, and have left on a
posted shipment to the return's customer. One that another Draft
sales-return receipt has claimed is refused. Whatever entity held the slot
(\`index\` for a serial, the line for a batch) is cleared first.`,
  output: z.object({
    trackedEntityId: z.string()
  }),
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

    const assigned = await requireAffected(
      serviceRole
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
        .eq("companyId", companyId)
        .select("id")
    );
    if (assigned.error) {
      return ctx.error("internal", "Failed to update tracking", assigned.error);
    }
    return { trackedEntityId };
  }
});

export const removeReceiptReturnEntity = defineServiceFn({
  publish: true,
  title: "Remove a returned tracked entity from a sales-return receipt line",
  description: `Clears the receipt tracking the entity carries, only when it points at
this receipt line: another receipt's assignment is refused.`,
  output: z.object({
    trackedEntityId: z.string()
  }),
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

    const cleared = await requireAffected(
      ctx.asSystem.supabase
        .from("trackedEntity")
        .update({
          attributes: service.withoutReceiptTracking(attributes) as Json
        })
        .eq("id", trackedEntityId)
        .eq("companyId", ctx.company.id)
        .select("id")
    );
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

export const createShipment = defineServiceFn({
  publish: true,
  title: "Create a shipment",
  description: `From its source document, with its lines: a sales order, a sales return
order, a purchase order, a purchase return order, an outbound warehouse
transfer or a rental agreement. With no source document it creates an
empty shipment. The location is the caller's default location, which a
purchase order shipment requires. A sales order shipment ships from the
order's location, or from the caller's default location when one of the
order's lines ships from there.

A return order or rental agreement with a Draft shipment already returns
that shipment instead of a second one.`,
  output: rows.shipment.pick({ id: true }).meta({ table: "shipment" }),
  input: z.object({
    sourceDocument: z.enum(shipmentSourceDocumentType).optional(),
    sourceDocumentId: z.string().default("")
  }),
  permission: { create: "inventory" },

  async run(ctx, { sourceDocument, sourceDocumentId }) {
    let locationId = await service.defaultLocationOf(ctx);
    if (sourceDocument === "Sales Order") {
      const location = await service.salesOrderShipmentLocationOf(
        ctx,
        sourceDocumentId,
        locationId
      );
      if (location.error) {
        return ctx.error(
          "internal",
          "Failed to load the sales order's location",
          location.error
        );
      }
      locationId = location.data ?? undefined;
    }

    if (
      !locationId &&
      (sourceDocument === "Sales Order" || sourceDocument === "Purchase Order")
    ) {
      return ctx.error("rule", NO_DEFAULT_LOCATION);
    }

    // One open draft per return order, agreement or contract: a second Ship
    // goes to the existing draft instead of stacking up duplicates.
    if (
      sourceDocument === "Sales Return Order" ||
      sourceDocument === "Purchase Return Order" ||
      sourceDocument === "Rental Agreement" ||
      sourceDocument === "Customer Contract"
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
        case "Customer Contract":
          return invokeCreate(ctx, {
            type: "shipmentFromCustomerContract",
            customerContractId: sourceDocumentId
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

export const updateShipment = defineServiceFn({
  publish: true,
  title: "Update a shipment's details",
  description: `A changed source document or location rebuilds the shipment's lines from
the new source (a sales order, a sales return order, a purchase order, a
purchase return order or an outbound transfer), and is refused once the
shipment is not Draft. Otherwise the fields are saved as sent. A rental
shipment keeps its rental agreement: changing it is refused.`,
  output: rows.shipment.pick({ id: true }).meta({ table: "shipment" }),
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
    const isContract =
      current.data.sourceDocument === "Customer Contract" ||
      shipment.sourceDocument === "Customer Contract";
    if (isContract && sourceChanged) {
      return ctx.error(
        "rule",
        "A contract delivery keeps its contract. Create it from the contract."
      );
    }
    if (isRental && sourceChanged) {
      return ctx.error(
        "rule",
        "A rental shipment keeps its rental agreement. Create it from the agreement."
      );
    }

    const rebuild =
      !isRental &&
      !isContract &&
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
export const postShipment = defineServiceFn({
  publish: true,
  title: "Post a shipment",
  description: `In order:
  1. Storage rules run on the \`shipment\` and \`pick\` surfaces (and
     \`warehouseTransfer\` for an outbound transfer), and a sales order
     shipment runs its order's sales rules on the lines shipped. A
     blocking rule returns its \`violations\` and \`ruleNames\` and changes
     nothing (a blocked sales rule is recorded on the order); send
     \`acknowledged: true\` to post past warnings.
  2. Expired batches on the shipment: the company's expired-entity policy
     refuses the post (\`Block\`, \`BlockWithOverride\`), or posts it with a
     \`warning\` (\`Warn\`). Expiry is judged on the shipping location's
     calendar.
  3. The shipment is set Pending (only from Draft or Pending: \`conflict\`
     otherwise). A sales order shipment saves its packing slip on the
     order's opportunity.
  4. The shipment is posted: ledger entries, cost of goods, the journal and
     tracked entities. A failed post sets it back to Draft.
  5. Labels print when the shipping printer auto-prints (and for batches
     the post split), acknowledged sales rules are recorded on the order,
     and the shipment-posted workflow moment is raised.

\`postingDate\` dates a rental delivery; every other shipment posts today.
\`locale\` formats the packing slip.`,
  output: z.union([
    z.object({
      violations: z.array(
        z.object({
          ruleId: z.string(),
          severity: z.enum(["error", "warn"]),
          message: z.string(),
          lineId: z.string().nullable().optional()
        })
      ),
      ruleNames: z.record(z.string(), z.string()),
      warning: z.null().optional()
    }),
    z.object({
      warning: z.string().nullable(),
      violations: z.null().optional(),
      ruleNames: z.null().optional()
    }),
    z.null()
  ]),
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

export const voidShipment = defineServiceFn({
  publish: "destructive",
  title: "Void a posted shipment",
  description: `Reverses its inventory movements and journal entries and restores its
tracked entities and the source document's shipped quantities. Only a
Posted shipment can be voided.`,
  output: rows.shipment.pick({ shipmentId: true }).meta({ table: "shipment" }),
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

export const splitShipmentLine = defineServiceFn({
  publish: true,
  title: "Split a shipment line in two",
  description: `Moves \`quantity\` of the line onto a new line of the same shipment, so the
two can come from different storage units or carry different tracking.`,
  output: z.object({
    shipmentLineId: z.string()
  }),
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

export const updateShipmentLines = defineServiceFn({
  publish: true,
  title: "Set one field on shipment lines",
  description: `\`storageUnitId\`, \`shippedQuantity\` or \`serialNumber\` (a contract
delivery's typed serial), on every line in \`ids\`. An empty
value clears the field. Storage rules run when the shipment is posted, not
here.`,
  output: z.object({
    ids: z.array(z.string())
  }),
  input: z.object({
    ids: z.array(z.string()).min(1),
    field: z.enum(["storageUnitId", "shippedQuantity", "serialNumber"]),
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
          : field === "serialNumber"
            ? { serialNumber: value || null }
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

export const updateShipmentFixedAssetLine = defineServiceFn({
  publish: true,
  title: "Update one field of a fixed-asset line on a shipment",
  description: `\`shipped\`, \`serialNumber\` or \`meter\` (a rental unit's meter out). A posted
or voided shipment is a record: its lines no longer change.`,
  output: rows.shipmentFixedAssetLine
    .pick({ id: true })
    .meta({ table: "shipmentFixedAssetLine" }),
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

    const update = await requireAffected(
      serviceRole
        .from("shipmentFixedAssetLine")
        .update({
          ...(change.field === "shipped"
            ? { shipped: change.value }
            : change.field === "serialNumber"
              ? { serialNumber: change.value || null }
              : { meter: change.value === "" ? null : Number(change.value) }),
          updatedBy: ctx.auditUserId
        })
        .eq("id", id)
        .eq("companyId", ctx.company.id)
        .select("id")
    );
    if (update.error) {
      return ctx.error("internal", "Failed to update the line", update.error);
    }
    return { id };
  }
});

export const assignShipmentLineEntity = defineServiceFn({
  publish: true,
  title: "Assign a tracked entity to a shipment line",
  description: `Tags the batch, or the serial unit at \`index\`, with the shipment line;
posting ships it. The entity must be the line's item and Available (On
Hold for a return-to-customer shipment, and then it must have come back on
a receipt of that return order). A batch must hold at least \`quantity\`.
Whatever entity held the slot before is cleared once the new one is set.`,
  output: z.object({
    trackedEntityId: z.string()
  }),
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
        .select("sourceDocument, sourceDocumentId, status, supplierId")
        .eq("id", shipmentId)
        .eq("companyId", companyId)
        .single(),
      client
        .from("shipmentLine")
        .select("itemId, lineId")
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

    // The statuses this source may ship (`shippableEntityStatuses`): a
    // return-to-customer ships returned stock, On Hold until it is
    // dispositioned; a return-to-supplier also ships rejected units;
    // everything else ships Available stock only. On Hold alone is not
    // provenance: the entity must have COME BACK on a receipt of this return
    // order.
    const isReturn = shipment.data.sourceDocument === "Sales Return Order";
    const allowedStatuses = utils.shippableEntityStatuses(
      shipment.data.sourceDocument
    );
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

    if (!allowedStatuses.includes(entity.data.status)) {
      return ctx.error(
        "rule",
        `Tracked entity is not available. Current status: ${entity.data.status}`
      );
    }

    // Rejected alone is not provenance either: a rejected unit goes back only
    // to the supplier it came from, i.e. it was received on a posted receipt
    // from this return's supplier (the rule the return-line picker applies).
    if (
      shipment.data.sourceDocument === "Purchase Return Order" &&
      entity.data.status === "Rejected"
    ) {
      const receiptId = attributes.Receipt;
      const provenance =
        typeof receiptId === "string" && shipment.data.supplierId
          ? await client
              .from("receipt")
              .select("id")
              .eq("id", receiptId)
              .eq("supplierId", shipment.data.supplierId)
              .eq("status", "Posted")
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
          "Rejected tracked entity was not received from this supplier and cannot be returned to it"
        );
      }
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
      .eq("status", entity.data.status)
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
        `Tracked entity is no longer ${entity.data.status}`
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

export const createStockTransfer = defineServiceFn({
  publish: true,
  title: "Create a stock transfer",
  description: `Moves stock between storage units of one location. The transfer is created
Released, so storage rules run on the \`stockTransfer\` surface against each
line's destination before it exists: a blocking rule returns its
\`violations\` and \`ruleNames\` and creates nothing; send \`acknowledged: true\`
to create past warnings. A serial-tracked line of N units becomes N lines
of one.`,
  output: z.union([
    z.object({
      violations: z.array(
        z.object({
          ruleId: z.string(),
          severity: z.enum(["error", "warn"]),
          message: z.string(),
          lineId: z.string().nullable().optional()
        })
      ),
      ruleNames: z.record(z.string(), z.string())
    }),
    z.object({
      pickedLineIds: z.array(z.string()),
      moveError: z.string().nullable(),
      id: z.string(),
      stockTransferId: z.string()
    }),
    z.null()
  ]),
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
          requiresBatchTracking: z.boolean().optional(),
          trackedEntityId: z
            .string()
            .nullish()
            .describe(
              "The serial unit or batch a tracked line moves, when it is known up front."
            )
        })
      )
      .min(1),
    acknowledged: z.boolean().default(false),
    moveNow: z
      .boolean()
      .default(false)
      .describe(
        "Pick every line as soon as the transfer is created: untracked lines, and tracked lines that name their trackedEntityId. Other tracked lines stay to be picked."
      ),
    customFields: customFieldsInput
  }),
  permission: { create: "inventory" },

  async run(
    ctx,
    { locationId, lines: input, acknowledged, moveNow, customFields }
  ) {
    // Tracking comes from the item, never the caller. Kysely, not PostgREST:
    // a large `.in()` of ids would pass the gateway's URL length limit.
    const items = await ctx.asSystem.pg
      .selectFrom("item")
      .select(["id", "itemTrackingType"])
      .where("companyId", "=", ctx.company.id)
      .where("id", "in", [...new Set(input.map((line) => line.itemId))])
      .execute();
    const trackingByItem = new Map(
      items.map((item) => [item.id, item.itemTrackingType])
    );
    if (input.some((line) => !trackingByItem.has(line.itemId))) {
      return ctx.error("notFound", "Item not found");
    }
    const lines = input.map((line) => ({
      ...line,
      requiresSerialTracking: trackingByItem.get(line.itemId) === "Serial",
      requiresBatchTracking: trackingByItem.get(line.itemId) === "Batch",
      // A unit named up front is only kept to pick it now; stored on an
      // unpicked line it would read as picked.
      trackedEntityId: moveNow ? line.trackedEntityId : undefined
    }));

    if (
      lines.some((line) =>
        isSameStorageUnit(line.fromStorageUnitId, line.toStorageUnitId)
      )
    ) {
      return ctx.error("validation", SAME_STORAGE_UNIT_MESSAGE);
    }
    // A transfer moves stock within one location of this company.
    const unitIds = [
      ...new Set(
        lines.flatMap((line) =>
          [line.fromStorageUnitId, line.toStorageUnitId].filter(
            (unitId): unitId is string => !!unitId
          )
        )
      )
    ];
    const [location, units] = await Promise.all([
      ctx.asSystem.pg
        .selectFrom("location")
        .select("id")
        .where("id", "=", locationId)
        .where("companyId", "=", ctx.company.id)
        .executeTakeFirst(),
      unitIds.length === 0
        ? Promise.resolve([])
        : ctx.asSystem.pg
            .selectFrom("storageUnit")
            .select("id")
            .where("id", "in", unitIds)
            .where("companyId", "=", ctx.company.id)
            .where("locationId", "=", locationId)
            .execute()
    ]);
    if (!location) return ctx.error("notFound", "Location not found");
    if (units.length !== unitIds.length) {
      return ctx.error(
        "validation",
        "A storage unit is not at the transfer's location"
      );
    }
    if (
      lines.some(
        (line) =>
          line.trackedEntityId &&
          line.requiresSerialTracking &&
          line.quantity !== 1
      )
    ) {
      return ctx.error(
        "validation",
        "A line that names a serial unit moves exactly one"
      );
    }

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
    const pickedLineIds: string[] = [];
    if (!moveNow) {
      return {
        ...created.data,
        pickedLineIds,
        moveError: undefined as string | undefined
      };
    }

    // The transfer already exists, so a failed pick returns `moveError`
    // instead of an error: an error would invite a resend and a duplicate transfer.
    let moveError: string | undefined;
    const moved = () => ({ ...created.data!, pickedLineIds, moveError });
    // Unpicked lines drop their unit so it stays free for other lines.
    const failed = async (message: string) => {
      moveError = message;
      const cleared = await ctx.asSystem.supabase
        .from("stockTransferLine")
        .update({ trackedEntityId: null })
        .eq("stockTransferId", created.data!.id)
        .eq("companyId", ctx.company.id)
        .eq("pickedQuantity", 0);
      if (cleared.error) {
        logger.error("Failed to clear the unit of unpicked lines", {
          companyId: ctx.company.id,
          stockTransferId: created.data!.id,
          error: cleared.error
        });
      }
      return moved();
    };
    try {
      pickedLineIds.push(
        ...(await service.pickUntrackedStockTransferLines(ctx.asSystem.pg, {
          stockTransferId: created.data.id,
          companyId: ctx.company.id,
          userId: ctx.auditUserId
        }))
      );
    } catch (error) {
      logger.error("Moving the lines of a new stock transfer failed", {
        companyId: ctx.company.id,
        stockTransferId: created.data.id,
        error
      });
      return failed(getErrorMessage(error, "Moving its lines failed"));
    }

    // A tracked line that names its unit is picked through the same posting a
    // scan uses, so the source-bin and expiry checks still apply.
    if (lines.some((line) => line.trackedEntityId)) {
      const tracked = await ctx.asSystem.supabase
        .from("stockTransferLine")
        .select(
          "id, quantity, trackedEntityId, requiresSerialTracking, requiresBatchTracking"
        )
        .eq("stockTransferId", created.data.id)
        .eq("companyId", ctx.company.id)
        .not("trackedEntityId", "is", null);
      if (tracked.error) {
        logger.error("Failed to load the tracked lines of a stock transfer", {
          companyId: ctx.company.id,
          stockTransferId: created.data.id,
          error: tracked.error
        });
        return failed("Failed to load its serial and batch lines");
      }
      for (const line of tracked.data) {
        if (!line.requiresSerialTracking && !line.requiresBatchTracking) {
          continue;
        }
        const posted = await service.postStockTransferLine(
          ctx,
          {
            type: line.requiresSerialTracking ? "serial" : "batch",
            stockTransferId: created.data.id,
            stockTransferLineId: line.id,
            trackedEntityId: line.trackedEntityId!,
            quantity: Number(line.quantity ?? 0),
            locationId
          },
          (error) => getErrorMessage(error, "Moving it failed")
        );
        if (posted instanceof Error) return failed(posted.message);
        pickedLineIds.push(line.id);
      }
    }
    return moved();
  }
});

export const pickAllStockTransferLines = defineServiceFn({
  publish: true,
  title: "Pick every untracked line of a stock transfer",
  description: `Moves the remaining quantity of each line that is not serial or batch
tracked from its source to its destination storage unit, in one
transaction. Tracked lines are left: each needs its unit picked. A
Draft or Completed transfer is refused.`,
  output: z.object({
    stockTransferId: z.string(),
    pickedLineIds: z.array(z.string())
  }),
  input: z.object({ stockTransferId: z.string().min(1) }),
  permission: { create: "inventory" },

  async run(ctx, { stockTransferId }) {
    const transfer = await ctx.asCaller.supabase
      .from("stockTransfer")
      .select("id, status")
      .eq("id", stockTransferId)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (transfer.error) {
      return ctx.error(
        "internal",
        "Failed to load stock transfer",
        transfer.error
      );
    }
    if (!transfer.data) {
      return ctx.error("notFound", "The stock transfer could not be found");
    }
    if (transfer.data.status === "Completed") {
      return ctx.error("rule", "Cannot pick from a completed stock transfer.");
    }
    // Release runs the storage rules; picking a Draft would step past them.
    if (transfer.data.status === "Draft") {
      return ctx.error("rule", service.STOCK_TRANSFER_NOT_RELEASED);
    }
    try {
      const pickedLineIds = await service.pickUntrackedStockTransferLines(
        ctx.asSystem.pg,
        {
          stockTransferId,
          companyId: ctx.company.id,
          userId: ctx.auditUserId
        }
      );
      return { stockTransferId, pickedLineIds };
    } catch (error) {
      // The locked re-read can still find it gone or Completed.
      if (error instanceof NotFoundError) {
        return ctx.error("notFound", "The stock transfer could not be found");
      }
      if (error instanceof service.StockTransferPickRefusal) {
        return ctx.error("rule", error.message);
      }
      return ctx.error("internal", "Failed to pick lines", error);
    }
  }
});

export const getTrackedStockAtLocation = defineServiceFn({
  publish: "read",
  title: "Get the serial and batch stock at a location",
  description: `Per item and storage unit: the quantity in Available serial or batch units
(what a stock transfer can pick), split by batch number for a batch item,
and the quantity that has no serial or batch number, which cannot be picked
until it is given one.`,
  output: z.object({
    stock: z.array(
      z.object({
        itemId: z.string(),
        storageUnitId: z.string().nullable(),
        batchNumber: z.string().nullable(),
        expirationDate: z.string().nullable(),
        quantity: z.number()
      })
    ),
    unnumbered: z.array(
      z.object({
        itemId: z.string(),
        storageUnitId: z.string().nullable(),
        quantity: z.number()
      })
    )
  }),
  input: z.object({ locationId: z.string().min(1) }),
  permission: { view: "inventory" },

  async run(ctx, { locationId }) {
    try {
      return await service.getTrackedStockAtLocation(ctx.asSystem.pg, {
        companyId: ctx.company.id,
        locationId
      });
    } catch (error) {
      return ctx.error(
        "internal",
        "Failed to load serial and batch stock",
        error
      );
    }
  }
});

export const assignBatchToUnnumberedStock = defineServiceFn({
  publish: true,
  title: "Give stock with no batch number a batch",
  description: `For a batch-tracked item: moves \`quantity\` of the storage unit's stock that
has no batch number into a new batch \`readableId\` in the same storage unit,
so it can be picked, moved and shipped. Nothing is revalued and no journal
is posted.`,
  output: z.object({
    trackedEntityId: z.string()
  }),
  input: z.object({
    itemId: z.string().min(1),
    locationId: z.string().min(1),
    storageUnitId: z.string().nullish(),
    quantity: z.number().positive(),
    readableId: z
      .string()
      .trim()
      .min(1, { message: "Batch number is required" }),
    expirationDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Use a YYYY-MM-DD date" })
      .nullish(),
    comment: z.string().nullish()
  }),
  // Creates stock records, like an inventory adjustment.
  permission: { create: "inventory", update: "inventory" },

  async run(ctx, input) {
    try {
      return await service.assignBatchToUnnumberedStock(ctx.asSystem.pg, {
        ...input,
        storageUnitId: input.storageUnitId ?? null,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      });
    } catch (error) {
      if (error instanceof NotFoundError) {
        return ctx.error("notFound", error.message);
      }
      if (error instanceof service.AssignBatchRefusal) {
        return ctx.error("rule", error.message);
      }
      return ctx.error("internal", "Failed to give the stock a batch", error);
    }
  }
});

const COMPLETED_ALREADY = "The stock transfer is already completed";
const COMPLETE_NEEDS_RELEASE =
  "Release the stock transfer before completing it";
const COMPLETE_NEEDS_PICK =
  "Pick at least one line before completing the stock transfer";

export const setStockTransferStatus = defineServiceFn({
  publish: true,
  title: "Set a stock transfer's status",
  description: `Released and Completed commit the transfer plan: storage rules run on the
\`stockTransfer\` surface against each line's destination, and a blocking
rule returns its \`violations\` and \`ruleNames\` and changes nothing (send
\`acknowledged: true\` to continue past warnings). Completing needs a
Released or In Progress transfer with at least one line picked; it clears
the assignee and stamps the completion time. Reopening a Completed
transfer needs the inventory \`delete\` permission.`,
  output: z.union([
    z.object({
      violations: z.array(
        z.object({
          ruleId: z.string(),
          severity: z.enum(["error", "warn"]),
          message: z.string(),
          lineId: z.string().nullable().optional()
        })
      ),
      ruleNames: z.record(z.string(), z.string())
    }),
    z.object({
      id: z.string(),
      status: z.literal("Completed")
    }),
    z.object({
      id: z.string(),
      status: z.enum(["Draft", "In Progress", "Released"])
    }),
    z.null()
  ]),
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

    // The page's Complete button rule, checked here so a refused request
    // does no rule work, and again under the lock as it is written.
    if (status === "Completed") {
      if (current.data.status === "Completed") {
        return ctx.error("rule", COMPLETED_ALREADY);
      }
      if (current.data.status === "Draft") {
        return ctx.error("rule", COMPLETE_NEEDS_RELEASE);
      }
      // Filtered, so a picked line past PostgREST's row cap is still found.
      const picked = await ctx.asSystem.supabase
        .from("stockTransferLine")
        .select("id")
        .eq("stockTransferId", id)
        .eq("companyId", ctx.company.id)
        .neq("pickedQuantity", 0)
        .limit(1);
      if (picked.error) {
        return ctx.error(
          "internal",
          "Failed to load stock transfer lines",
          picked.error
        );
      }
      if (picked.data.length === 0) {
        return ctx.error("rule", COMPLETE_NEEDS_PICK);
      }
    }

    // Released is the commitment to the plan; Completed is kept as a second
    // gate. Draft is editing and In Progress is set by picking.
    if (status === "Released" || status === "Completed") {
      const lines = await ctx.asSystem.supabase
        .from("stockTransferLine")
        .select("id, itemId, toStorageUnitId, quantity")
        .eq("stockTransferId", id)
        .eq("companyId", ctx.company.id);
      if (lines.error) {
        return ctx.error(
          "internal",
          "Failed to load stock transfer lines",
          lines.error
        );
      }

      const rules = await service.storageRuleViolations(
        ctx,
        ["stockTransfer"],
        lines.data.map((line) => ({
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

    if (status === "Completed") {
      const refusal = await service.completeStockTransfer(ctx.asSystem.pg, {
        id,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      });
      if (refusal === "notFound") {
        return ctx.error("notFound", "The stock transfer could not be found");
      }
      if (refusal === "status") {
        return ctx.error("rule", "The stock transfer's status has changed");
      }
      if (refusal === "nothingPicked") {
        return ctx.error("rule", COMPLETE_NEEDS_PICK);
      }
      return { id, status };
    }

    const update = await service.updateStockTransferStatus(
      ctx.asCaller.supabase,
      { id, status, completedAt: null, updatedBy: ctx.auditUserId }
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
export const pickStockTransferLine = defineServiceFn({
  publish: true,
  title: "Pick a stock transfer line",
  description: `Moves \`quantity\` of the line's item from its source to its destination
storage unit. A serial- or batch-tracked line needs its \`trackedEntityId\`;
\`pickStockTransferLineEntity\` picks a scanned one. A Completed
transfer is refused.`,
  output: z.object({
    stockTransferId: z.string(),
    stockTransferLineId: z.string(),
    quantity: z.number()
  }),
  input: z.object({
    lineId: z.string(),
    quantity: z.number().positive(),
    locationId: z.string(),
    trackedEntityId: z.string().optional()
  }),
  permission: { create: "inventory" },

  async run(ctx, { lineId, quantity, locationId, trackedEntityId }) {
    const line = await service.stockTransferLineOf(ctx, lineId, {
      forPick: true
    });
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
      // The over-pick guard's refusal names what is left.
      (error) => getErrorMessage(error, "Failed to pick line")
    );
  }
});

export const unpickStockTransferLine = defineServiceFn({
  publish: true,
  title: "Unpick a stock transfer line",
  description: `Moves the line's picked stock back to its source storage unit. A serial-
or batch-tracked line needs its \`trackedEntityId\`. A Completed transfer is
refused.`,
  output: z.object({
    stockTransferId: z.string(),
    stockTransferLineId: z.string(),
    quantity: z.number()
  }),
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

export const pickStockTransferLineEntity = defineServiceFn({
  publish: true,
  title: "Pick a scanned serial unit or batch for a stock transfer line",
  description: `A serial scan moves one unit; a batch scan moves \`quantity\` of it, which
may not exceed what the line still has to pick. Refused when the line is
already fully picked, when the entity is already picked, or when the
transfer is Completed.`,
  output: z.object({
    stockTransferId: z.string(),
    stockTransferLineId: z.string(),
    quantity: z.number()
  }),
  input: z.object({
    lineId: z.string(),
    trackedEntityId: z.string().min(1),
    quantity: z.number().positive(),
    locationId: z.string().min(1)
  }),
  permission: { update: "inventory" },

  async run(ctx, { lineId, trackedEntityId, quantity, locationId }) {
    const line = await service.stockTransferLineOf(ctx, lineId, {
      forPick: true
    });
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

export const updateStockTransferLines = defineServiceFn({
  publish: true,
  title: "Set one storage unit on stock transfer lines",
  description: `\`fromStorageUnitId\` or \`toStorageUnitId\`, on every line in \`ids\`. An empty
value clears it. A transfer that is not Draft is locked: reopen it first.
Storage rules run when the transfer is released, not here.`,
  output: z.object({
    ids: z.array(z.string())
  }),
  input: z.object({
    ids: z.array(z.string()).min(1),
    field: z.enum(["fromStorageUnitId", "toStorageUnitId"]),
    value: z.string().nullable()
  }),
  permission: { update: "inventory" },

  async run(ctx, { ids, field, value }) {
    const refusal = await service.updateStockTransferLineStorageUnits(
      ctx.asSystem.pg,
      { companyId: ctx.company.id, userId: ctx.auditUserId, ids, field, value }
    );
    if (refusal === "notFound") {
      return ctx.error("notFound", "Stock transfer line not found");
    }
    if (refusal === "locked") {
      return ctx.error("rule", service.STOCK_TRANSFER_LOCKED);
    }
    if (refusal === "same") {
      return ctx.error("validation", SAME_STORAGE_UNIT_MESSAGE);
    }
    if (refusal === "unknownUnit") {
      return ctx.error(
        "validation",
        "The storage unit is not at the transfer's location"
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

export const setWarehouseTransferStatus = defineServiceFn({
  publish: true,
  title: "Set a warehouse transfer's status",
  description: `Confirming, shipping, receiving or completing commits the transfer plan:
storage rules run on the \`warehouseTransfer\` surface against each line's
destination, and a blocking rule returns its \`violations\` and \`ruleNames\`
and changes nothing (send \`acknowledged: true\` to continue past warnings).
Draft (reopen) and Cancelled are not commits and run no rules.`,
  output: z.union([
    z.object({
      violations: z.array(
        z.object({
          ruleId: z.string(),
          severity: z.enum(["error", "warn"]),
          message: z.string(),
          lineId: z.string().nullable().optional()
        })
      ),
      ruleNames: z.record(z.string(), z.string())
    }),
    z.object({
      id: z.string(),
      status: z.enum([
        "Cancelled",
        "Completed",
        "Draft",
        "To Receive",
        "To Ship",
        "To Ship and Receive"
      ])
    }),
    z.null()
  ]),
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

export const createWarehouseTransferLine = defineServiceFn({
  publish: true,
  title: "Add a line to a Draft warehouse transfer",
  description: `The line moves \`quantity\` of the item between the transfer's locations.
A transfer that is not Draft is locked: reopen it first.`,
  output: rows.warehouseTransferLine
    .pick({ id: true })
    .meta({ table: "warehouseTransferLine" }),
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
export const updateWarehouseTransferLine = defineServiceFn({
  publish: true,
  title: "Update a line of a Draft warehouse transfer",
  description: `Sets the line's quantity, storage units and notes. A transfer that is not
Draft is locked: reopen it first.`,
  output: rows.warehouseTransferLine
    .pick({ id: true })
    .meta({ table: "warehouseTransferLine" }),
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

export const removeWarehouseTransferLine = defineServiceFn({
  publish: "destructive",
  title: "Delete a line of a Draft warehouse transfer",
  description: "A transfer that is not Draft is locked: reopen it first.",
  output: rows.warehouseTransferLine
    .pick({ id: true })
    .meta({ table: "warehouseTransferLine" }),
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

export const createInventoryCount = defineServiceFn({
  publish: true,
  title: "Create an inventory count",
  description: `Creates a Draft count at a location and snapshots its on-hand into count
lines: one per item, storage unit and tracked entity with stock history,
Rejected and Consumed lots left out. \`storageUnitIds\` and \`itemType\`
narrow what is counted. If the snapshot fails the count is deleted, so no
empty count is left behind.`,
  output: rows.inventoryCount
    .pick({ id: true })
    .meta({ table: "inventoryCount" }),
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

export const postInventoryCount = defineServiceFn({
  publish: true,
  title: "Post a confirmed inventory count",
  description: `Only a Pending (confirmed) count posts. Each counted line's variance
against its snapshot is booked as an inventory adjustment, all in one
transaction: ledger entries, cost layers and the journal. Posted is
final. A count with lines that cannot post (a serial line counted as
anything but 0 or 1) is not posted and returns \`invalidLineIds\` with the
reason in \`message\`.`,
  output: z.union([
    z.object({
      invalidLineIds: z.array(z.string()),
      message: z.string()
    }),
    z.object({
      inventoryCountId: z.string()
    }),
    z.null()
  ]),
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
      return service.inventoryCountPostingFailure(ctx, posted.error);
    }
    return { inventoryCountId };
  }
});

export const adjustInventory = defineServiceFn({
  publish: true,
  title: "Adjust an item's stock",
  description: `A positive or negative adjustment, a set quantity, a scrap (with its scrap
reason) or an unscrap of a Scrapped tracked entity. It writes the ledger
entry, updates the tracked entity, maintains cost layers and posts the
journal in one transaction. Storage rules run first on the
\`inventoryAdjustment\` surface and, when a storage unit is named, on \`pick\`
(a decrease or scrap) or \`place\` (an increase or unscrap): a blocking rule
returns its \`violations\` and \`ruleNames\` and changes nothing; send
\`acknowledged: true\` to adjust past warnings.

Every adjustment but an unscrap needs \`locationId\`; an unscrap resolves its
location, bin and cost from the original scrap.`,
  output: z.union([
    z.object({
      violations: z.array(
        z.object({
          ruleId: z.string(),
          severity: z.enum(["error", "warn"]),
          message: z.string(),
          lineId: z.string().nullable().optional()
        })
      ),
      ruleNames: z.record(z.string(), z.string()),
      itemLedgerId: z.null().optional()
    }),
    z.object({
      itemLedgerId: z.string().nullable(),
      violations: z.null().optional(),
      ruleNames: z.null().optional()
    }),
    z.null()
  ]),
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
    const rules = await service.storageRuleViolations(
      ctx,
      service.adjustmentRuleSurfaces(
        adjustment.adjustmentType,
        adjustment.storageUnitId
      ),
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
      return service.postingFailure(
        ctx,
        posted.error,
        "Failed to create manual inventory adjustment"
      );
    }
    return { itemLedgerId: posted.data.itemLedger?.id ?? null };
  }
});

// ---------------------------------------------------------------------------
// Storage units
// ---------------------------------------------------------------------------

export const removeStorageUnit = defineServiceFn({
  publish: "destructive",
  title: "Delete a storage unit",
  description: `A unit with nested units is refused unless \`cascade\` is set, which deletes
the whole subtree.`,
  output: z.object({
    storageUnitId: z.string(),
    cascade: z.boolean()
  }),
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

export const setPickingListStatus = defineServiceFn({
  publish: true,
  title: "Set a picking list's status",
  description: `Reopening a Completed, Partial or Cancelled list needs the inventory delete
permission. Finishing (Completed) checks the lines first: with lines left
unpicked, the company's incomplete picking list policy refuses (\`error\`) or
returns \`needsAcknowledgement\` with those lines until the call is repeated
with \`acknowledged\` (\`warn\`). A list with unpicked or short lines finishes
Partial, not Completed.`,
  output: z.union([
    z.object({
      needsAcknowledgement: z.boolean(),
      unresolvedLines: z.array(
        z.object({
          itemName: z.string(),
          outstanding: z.number()
        })
      ),
      pickingListId: z.null().optional(),
      status: z.null().optional()
    }),
    z.object({
      pickingListId: z.string(),
      status: z.enum([
        "Cancelled",
        "Completed",
        "Draft",
        "In Progress",
        "Partial"
      ]),
      needsAcknowledgement: z.null().optional(),
      unresolvedLines: z.null().optional()
    }),
    z.null()
  ]),
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

export const updatePickingList = defineServiceFn({
  publish: true,
  title: "Update a Draft picking list's details",
  description: `Location, assignee, due date, notes and custom fields. A list past Draft is
locked: reopen it first.`,
  output: rows.pickingList
    .pick({ pickingListId: true })
    .meta({ table: "pickingList" }),
  input: z.object({
    pickingListId: z.string(),
    locationId: z.string().min(1),
    assignee: z.string().optional(),
    dueDate: z.string().optional(),
    notes: optionalTiptapDoc,
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

export const pickPickingListLineChecked = defineServiceFn({
  publish: true,
  title: "Pick a picking list line, or mark it short",
  description: `Sets the line's picked quantity (0 unpicks); with \`markShort\` the line is
Short at that quantity. The line must be on the list.`,
  output: rows.pickingListLine
    .pick({ id: true })
    .meta({ table: "pickingListLine" }),
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

export const pickPickingListLineEntity = defineServiceFn({
  publish: true,
  title: "Pick a serial or batch for a picking list line, or put it back",
  description: `Picks \`quantity\` of the tracked entity (from \`fromStorageUnitId\` when
given) onto the line; with \`unpick\` the entity's pick is undone. The line
must be on the list.`,
  output: rows.pickingListLine
    .pick({ id: true })
    .meta({ table: "pickingListLine" }),
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
   * `message` says why the job was not released, or that its method could
   * not be copied.
   */
  | {
      type: "job";
      jobId: string;
      operationId: string | null;
      startAs: "Setup" | "Labor" | "Machine" | null;
      message: string | null;
    }
  | { type: "purchaseOrder"; purchaseOrderId: string }
  | { type: "stockTransfer"; stockTransferId: string };

/**
 * Replenish a kanban: what scanning its card does.
 *
 * @remarks
 * Make: creates a Hard Deadline job for the kanban's item and quantity, due
 * after the item's lead time, copies the item's method and links the job to
 * the kanban; with auto-release it runs the release checks, then releases the
 * job (`releaseCheckedJobs`) and runs the location's schedule. A job that
 * fails the checks, or whose method could not be copied, stays Draft and
 * `message` names the problems. A kanban that already has a job is a
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

    // replenishKanban checks a Transfer card's units itself, for scans and
    // level checks alike.
    if (card.replenishmentSystem !== "Transfer") {
      const refused = await service.refuseNonNettableKanbanUnits(ctx, [
        card.storageUnitId
      ]);
      if (refused) return refused;
    }

    /** No one at a kanban card can choose a purchase order, so unlike
     *  `releaseJobs` a supplier's newest Draft PO is reused rather than a
     *  blocker. */
    async function releaseKanbanJob(
      jobId: string,
      locationId: string
    ): Promise<{ released: boolean; message: string | null }> {
      const job = await serviceRole
        .from("job")
        .select("jobId")
        .eq("id", jobId)
        .eq("companyId", companyId)
        .single();
      const readiness = await getJobReleaseReadiness(
        serviceRole,
        [jobId],
        companyId
      );
      const ready = readiness.data?.jobs[0];
      if (job.error || readiness.error || !ready) {
        logger.error("Failed to check a kanban job for release", {
          companyId,
          jobId,
          error: job.error ?? readiness.error
        });
        return {
          released: false,
          message: `${job.data?.jobId ?? "The job"} was created but could not be checked for release. Release it from the job.`
        };
      }

      const problems = jobReleaseProblems(ready);
      if (problems.length > 0) {
        return {
          released: false,
          message: `${job.data.jobId} was created but not released: ${problems.join("; ")}`
        };
      }

      // As the system, like the job it releases: the scanner may not hold
      // production update, and the status write runs on the caller's client.
      const system = createServiceContext({
        actor: { type: "system", onBehalfOf: userId },
        company: ctx.company,
        caller: serviceRole,
        system: () => serviceRole,
        pg: () => ctx.asSystem.pg,
        kv: () => ctx.kv
      });
      const result = await releaseCheckedJobs(system, {
        jobIds: [jobId],
        purchaseOrdersBySupplierId: Object.fromEntries(
          (readiness.data?.suppliers ?? []).map((supplier) => [
            supplier.supplierId,
            [...supplier.draftPurchaseOrders].sort((a, b) =>
              b.purchaseOrderId.localeCompare(a.purchaseOrderId)
            )[0]?.id ?? "new"
          ])
        ),
        source: "kanban"
      });
      const failure = result.error ?? result.data.failure;
      const released = result.data?.releasedJobIds.includes(jobId) ?? false;
      if (failure) {
        logger.error("Failed to release a kanban job", {
          companyId,
          jobId,
          error: failure
        });
      }
      for (const warning of result.data?.warnings ?? []) {
        logger.warn("A kanban job was released with a warning", {
          companyId,
          jobId,
          warning: warning.message
        });
      }

      // After the status is persisted: the scheduler only places released jobs.
      if (released) {
        try {
          await runLocationSchedule({
            db: ctx.asSystem.pg,
            client: serviceRole,
            locationId,
            companyId,
            userId
          });
        } catch (error) {
          logger.error("Failed to schedule a kanban job", {
            companyId,
            jobId,
            error
          });
        }
      }

      return {
        released,
        message: failure ? `${job.data.jobId}: ${failure.message}` : null
      };
    }

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
      if (createdJob.error || !createdJob.data) {
        return ctx.error("internal", "Failed to create job", createdJob.error);
      }
      const jobId = createdJob.data.id;

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
      }
      const release = method.error
        ? {
            released: false,
            message: `${createdJob.data.jobId} was created, but its method could not be copied. Use Get Method on the job before releasing it.`
          }
        : card.autoRelease
          ? await releaseKanbanJob(jobId, card.locationId!)
          : { released: false, message: null };

      const operation = release.released
        ? await getActiveJobOperationByJobId(client, jobId, companyId)
        : null;
      if (!operation) {
        return {
          type: "job",
          jobId,
          operationId: null,
          startAs: null,
          message: release.message
        };
      }
      const startAs = !card.autoStartJob
        ? null
        : operation.setupTime
          ? "Setup"
          : operation.machineTime && !operation.laborTime
            ? "Machine"
            : "Labor";
      return {
        type: "job",
        jobId,
        operationId: operation.id,
        startAs,
        message: release.message
      };
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
export const deleteBatchProperty = defineServiceFn({
  publish: "destructive",
  title: "Delete batch property",
  output: z.array(
    rows.batchProperty.pick({ id: true }).meta({ table: "batchProperty" })
  ),
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

export const deleteKanban = defineServiceFn({
  publish: "destructive",
  title: "Delete kanban",
  output: z.array(rows.kanban.pick({ id: true }).meta({ table: "kanban" })),
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

export const deleteReceipt = defineServiceFn({
  publish: "destructive",
  title: "Delete receipt",
  description: "A posted receipt cannot be deleted; void it instead.",
  output: z.array(rows.receipt.pick({ id: true }).meta({ table: "receipt" })),
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

export const deleteReceiptLine = defineServiceFn({
  publish: "destructive",
  title: "Delete receipt line",
  description: "Only a Draft receipt's lines can be deleted.",
  output: z.array(
    rows.receiptLine.pick({ id: true }).meta({ table: "receiptLine" })
  ),
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

export const deleteShipment = defineServiceFn({
  publish: "destructive",
  title: "Delete shipment",
  description: "A posted shipment cannot be deleted; void it instead.",
  output: z.array(rows.shipment.pick({ id: true }).meta({ table: "shipment" })),
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

export const deleteShipmentLine = defineServiceFn({
  publish: "destructive",
  title: "Delete shipment line",
  description: "Only a Draft shipment's lines can be deleted.",
  output: z.array(
    rows.shipmentLine.pick({ id: true }).meta({ table: "shipmentLine" })
  ),
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

export const deleteShippingMethod = defineServiceFn({
  publish: "destructive",
  title: "Delete shipping method",
  output: z.array(
    rows.shippingMethod.pick({ id: true }).meta({ table: "shippingMethod" })
  ),
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

export const deleteStockTransfer = defineServiceFn({
  publish: "destructive",
  title: "Delete stock transfer",
  description:
    "Only a Draft transfer can be deleted: reopen a locked one first.",
  output: z.array(
    rows.stockTransfer.pick({ id: true }).meta({ table: "stockTransfer" })
  ),
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

export const deleteStockTransferLine = defineServiceFn({
  publish: "destructive",
  title: "Delete stock transfer line",
  description:
    "Only a line of a Draft transfer can be deleted: reopen a locked one first.",
  output: z.array(
    rows.stockTransferLine
      .pick({ id: true })
      .meta({ table: "stockTransferLine" })
  ),
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

export const deleteWarehouseTransfer = defineServiceFn({
  publish: "destructive",
  title: "Delete warehouse transfer",
  output: z.array(
    rows.warehouseTransfer
      .pick({ id: true })
      .meta({ table: "warehouseTransfer" })
  ),
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

export const getItemLedgerActivity = defineServiceFn({
  publish: "read",
  title:
    "Keyset-paginated item-ledger activity for the per-item Activity panel",
  description: `A page of \`rows\`, newest first. \`hasMore\` says another page lies beyond
it: send the last row's \`entryNumber\` to read it.`,
  output: z.object({
    rows: z.array(
      z.object({
        comment: z.string().nullable(),
        companyId: z.string(),
        correctionOfItemLedgerId: z.string().nullable(),
        createdAt: z.string(),
        createdBy: z.string(),
        documentId: z.string().nullable(),
        documentLineId: z.string().nullable(),
        documentType: z
          .enum([
            "Asset Transfer",
            "Batch Merge",
            "Batch Split",
            "Direct Transfer",
            "Inbound Inspection",
            "Inventory Count",
            "Inventory Receipt",
            "Inventory Shipment",
            "Job Consumption",
            "Job Receipt",
            "Maintenance Consumption",
            "Non-Conformance",
            "Posted Assembly",
            "Project Issue",
            "Project Transfer",
            "Purchase Credit Memo",
            "Purchase Invoice",
            "Purchase Order",
            "Purchase Receipt",
            "Purchase Return Shipment",
            "Rental Agreement",
            "Sales Credit Memo",
            "Sales Invoice",
            "Sales Return Receipt",
            "Sales Return Shipment",
            "Sales Shipment",
            "Scrap",
            "Service Credit Memo",
            "Service Invoice",
            "Service Job Consumption",
            "Service Shipment",
            "Transfer Receipt",
            "Transfer Shipment"
          ])
          .nullable(),
        entryNumber: z.number(),
        entryType: z.enum([
          "Assembly Consumption",
          "Assembly Output",
          "Consumption",
          "Negative Adjmt.",
          "Output",
          "Positive Adjmt.",
          "Purchase",
          "Sale",
          "Transfer"
        ]),
        externalDocumentId: z.string().nullable(),
        id: z.string(),
        itemId: z.string(),
        locationId: z.string().nullable(),
        postingDate: z.string(),
        projectId: z.string().nullable(),
        quantity: z.number(),
        scrapReasonId: z.string().nullable(),
        storageUnitId: z.string().nullable(),
        trackedEntityId: z.string().nullable(),
        trackedEntityStatus: z
          .enum([
            "Available",
            "Consumed",
            "On Hold",
            "Rejected",
            "Reserved",
            "Scrapped"
          ])
          .nullable(),
        updatedBy: z.string().nullable(),
        storageUnit: z
          .object({
            name: z.string()
          })
          .nullable(),
        trackedEntity: z
          .object({
            readableId: z.string().nullable()
          })
          .nullable()
      })
    ),
    hasMore: z.boolean()
  }),
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

export const getItemLedgerBalance = defineServiceFn({
  publish: "read",
  title:
    "On-hand quantity of an item at a location right after ledger entry `entryNumber` (omit it for on-hand now), on the same definition as the inventory table's On Hand column",
  output: z.number(),
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

export const getBatchProperties = defineServiceFn({
  publish: "read",
  title: "Get batch properties",
  output: z.array(rows.batchProperty),
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

export const getInventoryItems = defineServiceFn({
  publish: "read",
  title: "Get inventory items",
  output: z
    .array(
      z.object({
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
        itemTrackingType: z.enum([
          "Batch",
          "Inventory",
          "Non-Inventory",
          "Serial"
        ]),
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
      })
    )
    .nullable(),
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

export const getInventoryValuation = defineServiceFn({
  publish: "read",
  title: "Get inventory valuation",
  output: z.array(
    z.object({
      costingMethod: z.enum(["Average", "FIFO", "LIFO", "Standard"]),
      itemId: z.string(),
      locationId: z.string(),
      locationName: z.string(),
      name: z.string(),
      projectId: z.string(),
      quantityOnHand: z.number(),
      quantityOnHold: z.number(),
      quantityRejected: z.number(),
      readableIdWithRevision: z.string(),
      replenishmentSystem: z.enum(["Buy", "Buy and Make", "Make"]),
      thumbnailPath: z.string(),
      totalValue: z.number(),
      type: z.enum([
        "Consumable",
        "Fixture",
        "Material",
        "Part",
        "Service",
        "Tool"
      ]),
      unitCost: z.number(),
      unitOfMeasureCode: z.string()
    })
  ),
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

export const getInventoryValuationTieOut = defineServiceFn({
  publish: "read",
  title: "Get inventory valuation tie out",
  output: z.array(
    z.object({
      accountId: z.string(),
      accountKind: z.string(),
      accountName: z.string(),
      glBalance: z.number(),
      subledgerValue: z.number(),
      variance: z.number()
    })
  ),
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

export const createInventoryReconciliationJournal = defineServiceFn({
  publish: true,
  title:
    "Creates a draft GL journal that clears the inventory valuation variance",
  output: z.object({
    journalId: z.string()
  }),
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

export const getKanbans = defineServiceFn({
  publish: "read",
  title: "Get kanbans",
  output: z.array(rows.kanbans).nullable(),
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

export const getKanban = defineServiceFn({
  publish: "read",
  title: "Get kanban",
  output: rows.kanbans,
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

export const getKanbanProjectedQuantities = defineServiceFn({
  publish: "read",
  title: "Get kanban projected quantities",
  output: z.array(
    z.object({
      kanbanId: z.string(),
      projectedQuantity: z.number(),
      replenishmentLevel: z.number()
    })
  ),
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

export const getStockTransfer = defineServiceFn({
  publish: "read",
  title: "Get stock transfer",
  output: rows.stockTransfer
    .pick({
      assignee: true,
      companyId: true,
      completedAt: true,
      createdAt: true,
      createdBy: true,
      id: true,
      kanbanId: true,
      locationId: true,
      status: true,
      stockTransferId: true,
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
      ]),
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
    .meta({ table: "stockTransfer" }),
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

export const getStockTransferLines = defineServiceFn({
  publish: "read",
  title: "Get stock transfer lines",
  output: z.array(rows.stockTransferLines),
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

export const getStockTransfers = defineServiceFn({
  publish: "read",
  title: "Get stock transfers",
  output: z
    .array(
      rows.stockTransfer
        .pick({
          assignee: true,
          companyId: true,
          completedAt: true,
          createdAt: true,
          createdBy: true,
          id: true,
          kanbanId: true,
          locationId: true,
          status: true,
          stockTransferId: true,
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
          ])
        })
        .meta({ table: "stockTransfer" })
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

export const getReceipts = defineServiceFn({
  publish: "read",
  title: "Get receipts",
  output: z
    .array(
      rows.receipt
        .pick({
          assignee: true,
          companyId: true,
          createdAt: true,
          createdBy: true,
          externalDocumentId: true,
          id: true,
          invoiced: true,
          locationId: true,
          postedBy: true,
          postingDate: true,
          receiptId: true,
          sourceDocument: true,
          sourceDocumentId: true,
          sourceDocumentReadableId: true,
          status: true,
          supplierId: true,
          supplierInteractionId: true,
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
          internalNotes: z.union([
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
        .meta({ table: "receipt" })
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

export const getReceipt = defineServiceFn({
  publish: "read",
  title: "Get receipt",
  output: rows.receipt
    .pick({
      assignee: true,
      companyId: true,
      createdAt: true,
      createdBy: true,
      externalDocumentId: true,
      id: true,
      invoiced: true,
      locationId: true,
      postedBy: true,
      postingDate: true,
      receiptId: true,
      sourceDocument: true,
      sourceDocumentId: true,
      sourceDocumentReadableId: true,
      status: true,
      supplierId: true,
      supplierInteractionId: true,
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
      ]),
      internalNotes: z.union([
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
    .meta({ table: "receipt" }),
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

export const getReceiptLines = defineServiceFn({
  publish: "read",
  title: "Get receipt lines",
  output: z.array(rows.receiptLines),
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

export const getReceiptRelatedItems = defineServiceFn({
  publish: "read",
  title:
    "The documents around a receipt that its own row does not name: the purchase invoices raised against its supplier interaction, and, for a customer return, the customer it came back from",
  output: z.object({
    invoices: z.array(
      z.object({
        id: z.string(),
        invoiceId: z.string(),
        status: z.enum([
          "Debit Note Issued",
          "Draft",
          "Open",
          "Overdue",
          "Paid",
          "Partially Paid",
          "Pending",
          "Return",
          "Voided"
        ])
      })
    ),
    customerId: z.string().nullable(),
    serviceJobs: z.array(
      z.object({
        id: z.string(),
        serviceJobId: z.string(),
        status: z.enum([
          "Awaiting Approval",
          "Cancelled",
          "Completed",
          "In Progress",
          "Invoiced",
          "On Hold",
          "Open"
        ]),
        salesReturnOrderLineId: z.string().nullable()
      })
    )
  }),
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

export const getReceiptTracking = defineServiceFn({
  publish: "read",
  title: "Get receipt tracking",
  output: z.array(rows.trackedEntity),
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

export const getReceiptFiles = defineServiceFn({
  publish: "read",
  title: "Get receipt files",
  description: `The files attached to each receipt line in \`lineIds\`, at most 200 lines a
call.`,
  // One storage listing per line.
  output: z.array(z.unknown()),
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

export const getSerialNumbersForItem = defineServiceFn({
  publish: "read",
  title: "Get serial numbers for item",
  output: z.array(rows.trackedEntity),
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

export const getAvailableTrackedEntities = defineServiceFn({
  publish: "read",
  title:
    "Available tracked entities for an item at a location, one row per entity, with its bin, on-hand, and FEFO/FIFO order keys — for the shared TrackedEntityPicker",
  output: z.array(
    z.object({
      availableQuantity: z.number(),
      createdAt: z.string(),
      expirationDate: z.string(),
      projectId: z.string(),
      readableId: z.string(),
      status: z.string(),
      storageUnitId: z.string(),
      storageUnitName: z.string(),
      trackedEntityId: z.string()
    })
  ),
  input: z.looseObject({
    itemId: z.string(),
    locationId: z.string(),
    excludeLineside: z.boolean().optional(),
    excludeNonNettable: z.boolean().optional(),
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

export const getPickOrder = defineServiceFn({
  publish: "read",
  title:
    "The configured tracked-entity pick order for an item at a location, used as the picker's default sort",
  output: z.enum(["Default", "FEFO", "FIFO", "LIFO"]).nullable(),
  input: z.looseObject({ itemId: z.string(), locationId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return await service.getPickOrder(
      ctx.asCaller.supabase,
      payload(ctx, input).build() as never
    );
  }
});

export const getBatchNumbersForItem = defineServiceFn({
  publish: "read",
  title: "Get batch numbers for item",
  output: z.array(rows.trackedEntity),
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

export const getStorageUnitsList = defineServiceFn({
  publish: "read",
  title: "Get storage units list",
  output: z.array(
    rows.storageUnit
      .pick({ id: true, name: true })
      .meta({ table: "storageUnit" })
  ),
  input: z.record(z.string(), z.unknown()),
  permission: { view: "inventory" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getStorageUnitsList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

export const getStorageUnitsListForLocation = defineServiceFn({
  publish: "read",
  title: "Get storage units list for location",
  output: z.array(
    rows.storageUnit
      .pick({ id: true, name: true })
      .meta({ table: "storageUnit" })
  ),
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

export const getStorageUnitsTreeForLocation = defineServiceFn({
  publish: "read",
  title: "Get storage units tree for location",
  output: z.array(
    rows.storageUnit
      .pick({ id: true, name: true, parentId: true })
      .extend({
        depth: z.number(),
        ancestorPath: z.array(z.string())
      })
      .meta({ table: "storageUnit" })
  ),
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

export const getStorageUnit = defineServiceFn({
  publish: "read",
  title: "Get storage unit",
  output: rows.storageUnit
    .pick({
      active: true,
      companyId: true,
      createdAt: true,
      createdBy: true,
      effectiveNettable: true,
      id: true,
      isWorkCenterDefault: true,
      locationId: true,
      name: true,
      nettable: true,
      parentId: true,
      storageTypeIds: true,
      tags: true,
      updatedAt: true,
      updatedBy: true,
      warehouseId: true,
      workCenterId: true
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
    .meta({ table: "storageUnit" }),
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

export const getEffectiveWorkCenterId = defineServiceFn({
  publish: "read",
  title: "Get effective work center id",
  output: z.string(),
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

export const getStorageUnitRoots = defineServiceFn({
  publish: "read",
  title: "Get storage unit roots",
  output: z.array(rows.storageUnits_recursive).nullable(),
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

export const getStorageUnitChildren = defineServiceFn({
  publish: "read",
  title: "Get storage unit children",
  output: z.array(rows.storageUnits_recursive),
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

export const getStorageUnitSubtrees = defineServiceFn({
  publish: "read",
  title: "Get storage unit subtrees",
  output: z.union([
    z.array(z.unknown()),
    z.array(
      z.object({
        active: z.boolean().nullable(),
        ancestorPath: z.array(z.string()).nullable(),
        companyId: z.string().nullable(),
        depth: z.number().nullable(),
        effectiveNettable: z.boolean().nullable(),
        id: z.string().nullable(),
        locationId: z.string().nullable(),
        name: z.string().nullable(),
        parentId: z.string().nullable(),
        storageTypeIds: z.array(z.string()).nullable(),
        warehouseId: z.string().nullable()
      })
    ),
    z.null()
  ]),
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

export const getStorageUnitParentIdsWithChildren = defineServiceFn({
  publish: "read",
  title: "Get storage unit parent ids with children",
  output: z.array(z.string()),
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

export const searchStorageUnitsWithAncestors = defineServiceFn({
  publish: "read",
  title: "Search storage units with ancestors",
  output: z.null(),
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

export const getStockMovements = defineServiceFn({
  publish: "read",
  title: "Get stock movements",
  output: z.array(rows.itemLedgers).nullable(),
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

export const getShipments = defineServiceFn({
  publish: "read",
  title: "Get shipments",
  output: z
    .array(
      rows.shipment
        .pick({
          assignee: true,
          companyId: true,
          createdAt: true,
          createdBy: true,
          customerId: true,
          externalDocumentId: true,
          id: true,
          invoiced: true,
          locationId: true,
          opportunityId: true,
          postedBy: true,
          postingDate: true,
          shipmentId: true,
          shippingMethodId: true,
          sourceDocument: true,
          sourceDocumentId: true,
          sourceDocumentReadableId: true,
          status: true,
          supplierId: true,
          supplierInteractionId: true,
          tags: true,
          trackingNumber: true,
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
          externalNotes: z.union([
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
          internalNotes: z.union([
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
        .meta({ table: "shipment" })
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

export const getShipment = defineServiceFn({
  publish: "read",
  title: "Get shipment",
  output: rows.shipment
    .pick({
      assignee: true,
      companyId: true,
      createdAt: true,
      createdBy: true,
      customerId: true,
      externalDocumentId: true,
      id: true,
      invoiced: true,
      locationId: true,
      opportunityId: true,
      postedBy: true,
      postingDate: true,
      shipmentId: true,
      shippingMethodId: true,
      sourceDocument: true,
      sourceDocumentId: true,
      sourceDocumentReadableId: true,
      status: true,
      supplierId: true,
      supplierInteractionId: true,
      tags: true,
      trackingNumber: true,
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
      externalNotes: z.union([
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
      internalNotes: z.union([
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
    .meta({ table: "shipment" }),
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

export const getShipmentLines = defineServiceFn({
  publish: "read",
  title: "Get shipment lines",
  output: z.array(
    rows.shipmentLines
      .extend({
        fulfillment: z
          .object({
            companyId: z.string(),
            createdAt: z.string(),
            createdBy: z.string(),
            id: z.string(),
            jobId: z.string().nullable(),
            quantity: z.number(),
            salesOrderLineId: z.string(),
            type: z.enum(["Inventory", "Job"]),
            updatedBy: z.string().nullable(),
            job: z
              .object({
                actualTime: z.number().nullable(),
                assignee: z.string().nullable(),
                companyId: z.string(),
                completedDate: z.string().nullable(),
                configuration: z.union([
                  z.string(),
                  z.number(),
                  z.boolean(),
                  z.record(z.string(), z.unknown()),
                  z.array(z.unknown()),
                  z.null()
                ]),
                consumeToProject: z.boolean(),
                createdAt: z.string(),
                createdBy: z.string(),
                customerContractLineId: z.string().nullable(),
                customerId: z.string().nullable(),
                customFields: z.union([
                  z.string(),
                  z.number(),
                  z.boolean(),
                  z.record(z.string(), z.unknown()),
                  z.array(z.unknown()),
                  z.null()
                ]),
                deadlineType: z.enum([
                  "ASAP",
                  "Hard Deadline",
                  "No Deadline",
                  "Soft Deadline"
                ]),
                dueDate: z.string().nullable(),
                estimatedTime: z.number().nullable(),
                fixedAssetClassId: z.string().nullable(),
                fixedAssetId: z.string().nullable(),
                id: z.string(),
                itemId: z.string(),
                jobId: z.string(),
                locationId: z.string(),
                modelUploadId: z.string().nullable(),
                notes: z.union([
                  z.string(),
                  z.number(),
                  z.boolean(),
                  z.record(z.string(), z.unknown()),
                  z.array(z.unknown()),
                  z.null()
                ]),
                planningGroupId: z.string().nullable(),
                priority: z.number(),
                productionQuantity: z.number().nullable(),
                projectedCompletionAt: z.string().nullable(),
                projectElementId: z.string().nullable(),
                projectId: z.string().nullable(),
                quantity: z.number(),
                quantityComplete: z.number(),
                quantityReceivedToInventory: z.number(),
                quantityShipped: z.number(),
                quoteId: z.string().nullable(),
                quoteLineId: z.string().nullable(),
                receiveToProjectStock: z.boolean(),
                releasedDate: z.string().nullable(),
                salesOrderId: z.string().nullable(),
                salesOrderLineId: z.string().nullable(),
                scheduleOutdatedAt: z.string().nullable(),
                scheduleOutdatedReason: z.string().nullable(),
                scrapQuantity: z.number(),
                secondsToComplete: z.number().nullable(),
                startDate: z.string().nullable(),
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
                ]),
                storageUnitId: z.string().nullable(),
                tags: z.array(z.string()).nullable(),
                unitOfMeasureCode: z.string(),
                updatedAt: z.string().nullable(),
                updatedBy: z.string().nullable()
              })
              .nullable()
          })
          .nullable()
      })
      .meta({ table: "shipmentLine" })
  ),
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

export const getShipmentRelatedItems = defineServiceFn({
  publish: "read",
  title: "Get shipment related items",
  output: z.object({
    invoices: z.array(
      z.object({
        assignee: z.string().nullable(),
        automationHoldReason: z.string().nullable(),
        companyId: z.string(),
        createdAt: z.string(),
        createdBy: z.string(),
        currencyCode: z.string(),
        customerContractId: z.string().nullable(),
        customerId: z.string(),
        customerReference: z.string().nullable(),
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
        dateDue: z.string().nullable(),
        dateIssued: z.string().nullable(),
        datePaid: z.string().nullable(),
        exchangeRate: z.number(),
        exchangeRateUpdatedAt: z.string().nullable(),
        externalNotes: z.union([
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
        internalNotes: z.union([
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
        invoiceCustomerContactId: z.string().nullable(),
        invoiceCustomerId: z.string().nullable(),
        invoiceCustomerLocationId: z.string().nullable(),
        invoiceId: z.string(),
        locationId: z.string().nullable(),
        opportunityId: z.string().nullable(),
        paymentTermId: z.string().nullable(),
        postingDate: z.string().nullable(),
        sendError: z.string().nullable(),
        sentAt: z.string().nullable(),
        sentTo: z.string().nullable(),
        shipmentId: z.string().nullable(),
        status: z.enum([
          "Credit Note Issued",
          "Draft",
          "Overdue",
          "Paid",
          "Partially Paid",
          "Pending",
          "Return",
          "Submitted",
          "Voided"
        ]),
        subtotal: z.number(),
        tags: z.array(z.string()).nullable(),
        totalAmount: z.number(),
        totalDiscount: z.number(),
        totalTax: z.number(),
        updatedAt: z.string().nullable(),
        updatedBy: z.string().nullable()
      })
    )
  }),
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

export const getShipmentTracking = defineServiceFn({
  publish: "read",
  title: "Get shipment tracking",
  output: z.array(rows.trackedEntity),
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

export const getRentalShipmentLines = defineServiceFn({
  publish: "read",
  title: "Get rental shipment lines",
  output: z.array(
    z.object({
      id: z.string(),
      shipped: z.boolean(),
      meter: z.number().nullable(),
      rentalAgreementLineId: z.string(),
      rentalAgreementLine: z
        .object({
          id: z.string(),
          status: z.enum(["On Rent", "Pending", "Returned", "Sold"]),
          lessorClassification: z
            .enum(["Financing", "Rental", "Sale"])
            .nullable(),
          fixedAsset: z
            .object({
              id: z.string(),
              fixedAssetId: z.string(),
              name: z.string(),
              serialNumber: z.string().nullable()
            })
            .nullable(),
          item: z.object({
            name: z.string(),
            readableIdWithRevision: z.string().nullable(),
            thumbnailPath: z.string().nullable(),
            type: z.enum([
              "Consumable",
              "Fixture",
              "Material",
              "Part",
              "Service",
              "Tool"
            ])
          }),
          trackedEntity: z
            .object({
              readableId: z.string().nullable()
            })
            .nullable()
        })
        .nullable()
    })
  ),
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

export const getRentalReceiptLines = defineServiceFn({
  publish: "read",
  title: "Get rental receipt lines",
  output: z.array(
    z.object({
      id: z.string(),
      received: z.boolean(),
      meter: z.number().nullable(),
      notes: z.string().nullable(),
      takeOutOfService: z.boolean(),
      outOfServiceReason: z.string().nullable(),
      residualDestination: z.string().nullable(),
      rentalAgreementLineId: z.string(),
      rentalAgreementLine: z
        .object({
          id: z.string(),
          status: z.enum(["On Rent", "Pending", "Returned", "Sold"]),
          lessorClassification: z
            .enum(["Financing", "Rental", "Sale"])
            .nullable(),
          fixedAsset: z
            .object({
              id: z.string(),
              fixedAssetId: z.string(),
              name: z.string(),
              serialNumber: z.string().nullable()
            })
            .nullable(),
          item: z.object({
            name: z.string(),
            readableIdWithRevision: z.string().nullable(),
            thumbnailPath: z.string().nullable(),
            type: z.enum([
              "Consumable",
              "Fixture",
              "Material",
              "Part",
              "Service",
              "Tool"
            ])
          }),
          trackedEntity: z
            .object({
              readableId: z.string().nullable()
            })
            .nullable()
        })
        .nullable()
    })
  ),
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

export const getShippingMethod = defineServiceFn({
  publish: "read",
  title: "Get shipping method",
  output: rows.shippingMethod
    .pick({
      active: true,
      carrier: true,
      carrierAccountId: true,
      companyId: true,
      createdAt: true,
      createdBy: true,
      id: true,
      name: true,
      tags: true,
      trackingUrl: true,
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
    .meta({ table: "shippingMethod" }),
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

export const getShippingMethods = defineServiceFn({
  publish: "read",
  title: "Get shipping methods",
  output: z
    .array(
      rows.shippingMethod
        .pick({
          active: true,
          carrier: true,
          carrierAccountId: true,
          companyId: true,
          createdAt: true,
          createdBy: true,
          id: true,
          name: true,
          tags: true,
          trackingUrl: true,
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
        .meta({ table: "shippingMethod" })
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

export const getShippingMethodsList = defineServiceFn({
  publish: "read",
  title: "Get shipping methods list",
  output: z.array(
    rows.shippingMethod
      .pick({ id: true, name: true })
      .meta({ table: "shippingMethod" })
  ),
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

export const getShippingTermsList = defineServiceFn({
  publish: "read",
  title: "Get shipping terms list",
  output: z.array(
    rows.shippingTerm
      .pick({ id: true, name: true })
      .meta({ table: "shippingTerm" })
  ),
  input: z.record(z.string(), z.unknown()),
  permission: { view: "inventory" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getShippingTermsList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

export const getTrackedEntities = defineServiceFn({
  publish: "read",
  title: "Get tracked entities",
  output: z.array(rows.trackedEntity).nullable(),
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

export const getTrackedEntitiesByMakeMethodId = defineServiceFn({
  publish: "read",
  title: "Get tracked entities by make method id",
  output: z.array(rows.trackedEntity),
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

export const getTrackedEntity = defineServiceFn({
  publish: "read",
  title: "Get tracked entity",
  output: rows.trackedEntity,
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

export const updateTrackedEntityExpiry = defineServiceFn({
  publish: true,
  title: "Manual override of a tracked entity's expirationDate",
  description: `An empty or missing \`expirationDate\` clears it. The \`reason\` is kept in the
entity's override history.`,
  output: z.array(
    rows.trackedEntity.pick({ id: true }).meta({ table: "trackedEntity" })
  ),
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

export const mergeTrackedEntities = defineServiceFn({
  publish: true,
  title: "Merge tracked entities into one lot",
  description: `Combines two or more Available lots of one item into ONE new lot: their
summed quantity, the earliest expiration date and the attributes every lot
shares. The merged lots become Consumed, and the new lot's genealogy names
each of them. It takes the first lot's number unless \`readableId\` names one.`,
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

export const getWarehouseTransfers = defineServiceFn({
  publish: "read",
  title: "Get warehouse transfers",
  output: z
    .array(
      rows.warehouseTransfer
        .pick({
          companyId: true,
          createdAt: true,
          createdBy: true,
          expectedReceiptDate: true,
          fromLocationId: true,
          id: true,
          notes: true,
          reference: true,
          status: true,
          tags: true,
          toLocationId: true,
          transferDate: true,
          transferId: true,
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
          fromLocation: z.object({
            name: z.string()
          }),
          toLocation: z.object({
            name: z.string()
          })
        })
        .meta({ table: "warehouseTransfer" })
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

export const getWarehouseTransfer = defineServiceFn({
  publish: "read",
  title: "Get warehouse transfer",
  output: rows.warehouseTransfer
    .pick({
      companyId: true,
      createdAt: true,
      createdBy: true,
      expectedReceiptDate: true,
      fromLocationId: true,
      id: true,
      notes: true,
      reference: true,
      status: true,
      tags: true,
      toLocationId: true,
      transferDate: true,
      transferId: true,
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
      fromLocation: z.object({
        addressLine1: z.string(),
        addressLine2: z.string().nullable(),
        city: z.string(),
        code: z.string().nullable(),
        companyId: z.string(),
        countryCode: z.string().nullable(),
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
        latitude: z.number().nullable(),
        longitude: z.number().nullable(),
        name: z.string(),
        postalCode: z.string(),
        requiresStaffing: z.boolean(),
        responsibleEmployee: z.string().nullable(),
        stateProvince: z.string().nullable(),
        tags: z.array(z.string()).nullable(),
        timezone: z.string(),
        updatedAt: z.string().nullable(),
        updatedBy: z.string().nullable()
      }),
      toLocation: z.object({
        addressLine1: z.string(),
        addressLine2: z.string().nullable(),
        city: z.string(),
        code: z.string().nullable(),
        companyId: z.string(),
        countryCode: z.string().nullable(),
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
        latitude: z.number().nullable(),
        longitude: z.number().nullable(),
        name: z.string(),
        postalCode: z.string(),
        requiresStaffing: z.boolean(),
        responsibleEmployee: z.string().nullable(),
        stateProvince: z.string().nullable(),
        tags: z.array(z.string()).nullable(),
        timezone: z.string(),
        updatedAt: z.string().nullable(),
        updatedBy: z.string().nullable()
      })
    })
    .meta({ table: "warehouseTransfer" }),
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

export const getWarehouseTransferRelatedItems = defineServiceFn({
  publish: "read",
  title:
    "The documents a warehouse transfer has raised: the shipments that send it out of the source location and the receipts that take it in at the destination",
  output: z.object({
    shipments: z.array(
      z.object({
        id: z.string(),
        shipmentId: z.string(),
        status: z.enum(["Draft", "Pending", "Posted", "Voided"])
      })
    ),
    receipts: z.array(
      z.object({
        id: z.string(),
        receiptId: z.string(),
        status: z.enum(["Draft", "Pending", "Posted", "Voided"])
      })
    )
  }),
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

export const getWarehouseTransferLine = defineServiceFn({
  publish: "read",
  title: "Get warehouse transfer line",
  output: rows.warehouseTransferLine
    .pick({
      companyId: true,
      createdAt: true,
      createdBy: true,
      fromLocationId: true,
      fromStorageUnitId: true,
      id: true,
      itemId: true,
      notes: true,
      quantity: true,
      receivedQuantity: true,
      shippedQuantity: true,
      toLocationId: true,
      toStorageUnitId: true,
      transferId: true,
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
      warehouseTransfer: z.object({
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
        expectedReceiptDate: z.string().nullable(),
        fromLocationId: z.string(),
        id: z.string(),
        notes: z.string().nullable(),
        reference: z.string().nullable(),
        status: z.enum([
          "Cancelled",
          "Completed",
          "Draft",
          "To Receive",
          "To Ship",
          "To Ship and Receive"
        ]),
        tags: z.array(z.string()).nullable(),
        toLocationId: z.string(),
        transferDate: z.string().nullable(),
        transferId: z.string(),
        updatedAt: z.string().nullable(),
        updatedBy: z.string().nullable(),
        fromLocation: z.object({
          name: z.string()
        }),
        toLocation: z.object({
          name: z.string()
        })
      })
    })
    .meta({ table: "warehouseTransferLine" }),
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

export const getWarehouseTransferLines = defineServiceFn({
  publish: "read",
  title: "Get warehouse transfer lines",
  output: z.array(
    rows.warehouseTransferLine
      .pick({
        companyId: true,
        createdAt: true,
        createdBy: true,
        fromLocationId: true,
        fromStorageUnitId: true,
        id: true,
        itemId: true,
        notes: true,
        quantity: true,
        receivedQuantity: true,
        shippedQuantity: true,
        toLocationId: true,
        toStorageUnitId: true,
        transferId: true,
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
          active: z.boolean(),
          assignee: z.string().nullable(),
          changeOrderId: z.string().nullable(),
          companyId: z.string().nullable(),
          createdAt: z.string(),
          createdBy: z.string(),
          defaultMethodType: z
            .enum(["Make to Order", "Pull from Inventory", "Purchase to Order"])
            .nullable(),
          description: z.string().nullable(),
          embedding: z.unknown(),
          id: z.string(),
          itemTrackingType: z.enum([
            "Batch",
            "Inventory",
            "Non-Inventory",
            "Serial"
          ]),
          modelUploadId: z.string().nullable(),
          mpn: z.string().nullable(),
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
          readableId: z.string(),
          readableIdWithRevision: z.string().nullable(),
          replenishmentSystem: z.enum(["Buy", "Buy and Make", "Make"]),
          revision: z.string().nullable(),
          revisionStatus: z.enum([
            "Design",
            "Obsolete",
            "Production",
            "Prototype"
          ]),
          sourcingType: z.enum([
            "Drop Ship",
            "Ship from Inventory",
            "Specified"
          ]),
          thumbnailPath: z.string().nullable(),
          trackingMethod: z.string().nullable(),
          type: z.enum([
            "Consumable",
            "Fixture",
            "Material",
            "Part",
            "Service",
            "Tool"
          ]),
          unitOfMeasureCode: z.string().nullable(),
          updatedAt: z.string().nullable(),
          updatedBy: z.string().nullable()
        }),
        fromStorageUnit: z
          .object({
            name: z.string()
          })
          .nullable(),
        toStorageUnit: z
          .object({
            name: z.string()
          })
          .nullable()
      })
      .meta({ table: "warehouseTransferLine" })
  ),
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

export const getStockMovementEffectiveQuantity = defineServiceFn({
  publish: "read",
  title: "Get stock movement effective quantity",
  output: z.object({
    rootId: z.string(),
    effectiveQuantity: z.number()
  }),
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

export const correctStockMovement = defineServiceFn({
  publish: true,
  title: "Correct stock movement",
  description: `Books one opposite movement so the posted movement's quantity becomes
\`correctedQuantity\` (signed, as the ledger stores it), dated with the
original and posted into its accounting period.`,
  output: z.object({
    id: z.unknown()
  }),
  input: service.correctStockMovementInput,
  permission: service.postStockMovementCorrectionPermission,
  async run(ctx, input) {
    const corrected = await run(ctx, "correct-stock-movement", () =>
      service.postStockMovementCorrection(ctx, input)
    );
    return corrected instanceof Error ? corrected : corrected.itemLedger;
  }
});

export const getInventoryCounts = defineServiceFn({
  publish: "read",
  title: "Get inventory counts",
  output: z
    .array(
      rows.inventoryCount
        .pick({
          companyId: true,
          createdAt: true,
          createdBy: true,
          id: true,
          inventoryCountId: true,
          isBlind: true,
          locationId: true,
          notes: true,
          postedAt: true,
          postedBy: true,
          snapshotAt: true,
          status: true,
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
          scope: z.union([
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
        .meta({ table: "inventoryCount" })
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

export const getInventoryCount = defineServiceFn({
  publish: "read",
  title: "Get inventory count",
  output: rows.inventoryCount
    .pick({
      companyId: true,
      createdAt: true,
      createdBy: true,
      id: true,
      inventoryCountId: true,
      isBlind: true,
      locationId: true,
      notes: true,
      postedAt: true,
      postedBy: true,
      snapshotAt: true,
      status: true,
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
      scope: z.union([
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
    .meta({ table: "inventoryCount" }),
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

export const getInventoryCountLines = defineServiceFn({
  publish: "read",
  title: "Get inventory count lines",
  output: z
    .array(
      rows.inventoryCountLines
        .pick({
          assignedReadableId: true,
          companyId: true,
          countedAt: true,
          countedBy: true,
          countedQuantity: true,
          createdAt: true,
          createdBy: true,
          dimension: true,
          dimensionId: true,
          finish: true,
          finishId: true,
          foundDuringCount: true,
          grade: true,
          gradeId: true,
          id: true,
          inventoryCountId: true,
          itemId: true,
          itemName: true,
          itemReadableIdWithRevision: true,
          itemThumbnailPath: true,
          itemTrackingType: true,
          locationId: true,
          materialFormId: true,
          materialSubstanceId: true,
          materialType: true,
          materialTypeId: true,
          postedItemLedgerId: true,
          projectId: true,
          projectIdentifier: true,
          projectName: true,
          readableId: true,
          storageTypeIds: true,
          storageUnitId: true,
          systemQuantity: true,
          tags: true,
          trackedEntityId: true,
          type: true,
          unitOfMeasureCode: true,
          updatedAt: true,
          updatedBy: true,
          variance: true
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
        .meta({ table: "inventoryCountLine" })
    )
    .nullable(),
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

export const getInventoryCountGroups = defineServiceFn({
  publish: "read",
  title: "Get the groups of an inventory count",
  description: `One row per item and storage unit: expected, counted and variance, and how
many units are Found, Missing, Unexpected, Not counted and without a serial
number. While the count is blind and not posted, \`expectedQuantity\` and
\`variance\` are left out.`,
  output: z.array(rows.inventoryCountGroups).nullable(),
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
    const header = await service.getInventoryCount(
      ctx.asCaller.supabase,
      input.inventoryCountId,
      ctx.company.id
    );
    if (header.error || !header.data) {
      return ctx.error("notFound", "Inventory count not found", header.error);
    }
    const blind = utils.isBlindCountEntry(header.data);
    // A blind count withholds what the system expects: the values, and any
    // filter or sort on them, which would reveal them through the rows.
    const args = payload(ctx, input).build() as {
      filters?: { column: string }[];
      sorts?: { sortBy: string }[];
    };
    if (blind) {
      args.filters = args.filters?.filter(
        (filter) => !utils.BLIND_COUNT_GROUP_COLUMNS.includes(filter.column)
      );
      args.sorts = args.sorts?.filter(
        (sort) => !utils.BLIND_COUNT_GROUP_COLUMNS.includes(sort.sortBy)
      );
    }
    const groups = await service.getInventoryCountGroups(
      ctx.asCaller.supabase,
      input.inventoryCountId as never,
      ctx.company.id,
      args as never
    );
    if (blind && groups.data) {
      groups.data = groups.data.map((group) => ({
        ...group,
        expectedQuantity: null,
        variance: null,
        missingCount: null,
        notCountedCount: null
      }));
    }
    return paged(ctx, groups);
  }
});

export const getInventoryCountLineSummary = defineServiceFn({
  publish: "read",
  title: "Get inventory count line summary",
  output: z.object({
    uncounted: z.number(),
    variances: z.number()
  }),
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

export const getInventoryCountMovements = defineServiceFn({
  publish: "read",
  title: "Get inventory count movements",
  output: z.array(rows.itemLedgers),
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

export const deleteInventoryCount = defineServiceFn({
  publish: "destructive",
  title: "Delete inventory count",
  output: z.array(
    rows.inventoryCount.pick({ id: true }).meta({ table: "inventoryCount" })
  ),
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

export const updateInventoryCountLine = defineServiceFn({
  publish: true,
  title: "Update inventory count line",
  description: `Records the caller's count of one line; leaving out \`countedQuantity\`
clears it. Only a Draft count's lines change.`,
  output: rows.inventoryCountLine
    .pick({ id: true })
    .meta({ table: "inventoryCountLine" }),
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

export const recordInventoryCountScan = defineServiceFn({
  publish: true,
  title: "Record a scanned code on an inventory count",
  description: `The code is a serial or batch number, an item readable id, or a new number.
A unit already on the count in the storage unit is counted (1 for a serial,
\`quantity\` for a batch or an untracked item). A unit on the count in another
storage unit, or on no line, gets a new line that reads as Unexpected; the
post moves a known unit from its bin and creates a new one. The result's
\`outcome\` says what happened: \`counted\`, \`added\`, \`alreadyCounted\`, or what
the caller must send again — \`ambiguous\` (pick one of \`itemIds\`), \`unknown\`
(send \`itemId\` for a new number), \`needsQuantity\`, \`needsUnitNumber\` (scan
the serial or batch, not the item), \`notInventory\` (a Non-Inventory item has no
stock to count), \`wrongStorageUnit\`. Draft counts only.`,
  output: z.union([
    z.object({
      outcome: z.enum(["added", "counted"]),
      lineId: z.string(),
      groupId: z.string()
    }),
    z.object({
      outcome: z.literal("alreadyCounted"),
      lineId: z.string(),
      groupId: z.string()
    }),
    z.object({
      outcome: z.literal("ambiguous"),
      itemIds: z.array(z.string())
    }),
    z.object({
      outcome: z.literal("unknown")
    }),
    z.object({
      outcome: z.literal("needsQuantity"),
      itemId: z.string()
    }),
    z.object({
      outcome: z.literal("needsUnitNumber"),
      itemId: z.string()
    }),
    z.object({
      outcome: z.literal("notInventory"),
      itemId: z.string()
    }),
    z.object({
      outcome: z.literal("wrongStorageUnit")
    }),
    z.null()
  ]),
  input: z.object({
    inventoryCountId: z.string().min(1),
    storageUnitId: z
      .string()
      .nullable()
      .optional()
      .describe(
        "The storage unit counted; left out for stock in no storage unit."
      ),
    code: z.string().trim().min(1),
    itemId: z
      .string()
      .optional()
      .describe(
        "The item, when the code matches 2 or more items or is a new number."
      ),
    quantity: z
      .number()
      .min(0)
      .optional()
      .describe("A batch's or an untracked item's counted quantity.")
  }),
  permission: { update: "inventory" },
  async run(ctx, input) {
    const result = await service.recordInventoryCountUnit(ctx.asSystem.pg, {
      inventoryCountId: input.inventoryCountId,
      companyId: ctx.company.id,
      userId: ctx.auditUserId,
      storageUnitId: input.storageUnitId ?? null,
      code: input.code,
      itemId: input.itemId,
      quantity: input.quantity
    });
    if (!result) {
      return ctx.error(
        "conflict",
        "Counts can only be edited while the document is Draft"
      );
    }
    return result;
  }
});

export const addInventoryCountUnit = defineServiceFn({
  publish: true,
  title: "Add a unit to an inventory count by hand",
  description: `The same as \`recordInventoryCountScan\`, with the item named: for a serial
or batch the counter reads off the unit, found on the shelf.`,
  output: z.union([
    z.object({
      outcome: z.enum(["added", "counted"]),
      lineId: z.string(),
      groupId: z.string()
    }),
    z.object({
      outcome: z.literal("alreadyCounted"),
      lineId: z.string(),
      groupId: z.string()
    }),
    z.object({
      outcome: z.literal("ambiguous"),
      itemIds: z.array(z.string())
    }),
    z.object({
      outcome: z.literal("unknown")
    }),
    z.object({
      outcome: z.literal("needsQuantity"),
      itemId: z.string()
    }),
    z.object({
      outcome: z.literal("needsUnitNumber"),
      itemId: z.string()
    }),
    z.object({
      outcome: z.literal("notInventory"),
      itemId: z.string()
    }),
    z.object({
      outcome: z.literal("wrongStorageUnit")
    }),
    z.null()
  ]),
  input: z.object({
    inventoryCountId: z.string().min(1),
    storageUnitId: z.string().nullable().optional(),
    code: z.string().trim().min(1),
    itemId: z.string().min(1),
    quantity: z.number().min(0).optional()
  }),
  permission: { update: "inventory" },
  async run(ctx, input) {
    const result = await service.recordInventoryCountUnit(ctx.asSystem.pg, {
      inventoryCountId: input.inventoryCountId,
      companyId: ctx.company.id,
      userId: ctx.auditUserId,
      storageUnitId: input.storageUnitId ?? null,
      code: input.code,
      itemId: input.itemId,
      quantity: input.quantity
    });
    if (!result) {
      return ctx.error(
        "conflict",
        "Counts can only be edited while the document is Draft"
      );
    }
    return result;
  }
});

export const setInventoryCountUnnumberedQuantity = defineServiceFn({
  publish: true,
  title: "Count the units with no serial number in one group",
  description: `Units with no serial number cannot be told apart, so they are counted as a
quantity: the oldest \`quantity\` units are Found and the rest Missing. A
quantity above the number of such units is refused: scan or type a serial
number for each extra unit. Draft counts only.`,
  output: z.object({
    counted: z.number()
  }),
  input: z.object({
    inventoryCountId: z.string().min(1),
    itemId: z.string().min(1),
    storageUnitId: z
      .string()
      .nullable()
      .optional()
      .describe("The storage unit; left out for stock in no storage unit."),
    quantity: z.number().int().min(0)
  }),
  permission: { update: "inventory" },
  async run(ctx, input) {
    const result = await service.setInventoryCountUnnumberedQuantity(
      ctx.asSystem.pg,
      {
        inventoryCountId: input.inventoryCountId,
        companyId: ctx.company.id,
        userId: ctx.auditUserId,
        itemId: input.itemId,
        storageUnitId: input.storageUnitId ?? null,
        quantity: input.quantity
      }
    );
    if (!result) {
      return ctx.error(
        "conflict",
        "Counts can only be edited while the document is Draft"
      );
    }
    if ("tooMany" in result) {
      return ctx.error(
        "rule",
        `Only ${result.tooMany} unit(s) here have no serial number. Scan or type a serial number for each extra unit.`
      );
    }
    return result;
  }
});

export const assignInventoryCountSerial = defineServiceFn({
  publish: true,
  title: "Give a counted unit with no serial number a serial number",
  description: `The unit must be on the count, counted Found, and have no serial number.
The number must not be on another unit of the item, on the shelf or on this
count. The post writes it to the unit. Draft counts only.`,
  output: z.object({
    lineId: z.string()
  }),
  input: z.object({
    lineId: z.string().min(1),
    readableId: z.string().trim().min(1)
  }),
  permission: { update: "inventory" },
  async run(ctx, input) {
    const result = await service.assignInventoryCountSerial(ctx.asSystem.pg, {
      lineId: input.lineId,
      companyId: ctx.company.id,
      userId: ctx.auditUserId,
      readableId: input.readableId
    });
    if ("refusal" in result) {
      switch (result.refusal) {
        case "notDraft":
          return ctx.error(
            "conflict",
            "Counts can only be edited while the document is Draft"
          );
        case "notFoundUnnumbered":
          return ctx.error(
            "rule",
            "Only a counted unit with no serial number can be given one"
          );
        case "numberTaken":
          return ctx.error(
            "rule",
            `${input.readableId} is already on another unit of this item`
          );
      }
    }
    return result;
  }
});

export const importInventoryCountResults = defineServiceFn({
  publish: true,
  title: "Import the results of an inventory count",
  description: `Each row names an item, a storage unit (empty for stock in no storage
unit), a serial or batch number (empty for an untracked item, or for a
serial with no number) and the counted quantity. Each (item, storage unit)
with a counted row is a full count: its units the rows leave out become
Missing, and units added while counting that the rows leave out are
removed. A row with a null quantity is not counted yet and leaves its unit
as it is. Non-Inventory items are refused. Rows resolve as a scan does. Nothing is written when any row has an error; the
result then lists \`errors\` with their line numbers. Draft counts only.`,
  output: z.union([
    z.object({
      errors: z.array(
        z.object({
          line: z.number(),
          message: z.string()
        })
      )
    }),
    z.object({
      counted: z.number(),
      added: z.number(),
      removed: z.number()
    }),
    z.null()
  ]),
  input: z.object({
    inventoryCountId: z.string().min(1),
    rows: z
      .array(
        z.object({
          line: z.number().int(),
          item: z.string().min(1),
          storageUnit: z.string(),
          code: z.string(),
          quantity: z.number().min(0).nullable()
        })
      )
      .max(20000)
  }),
  permission: { update: "inventory" },
  async run(ctx, input) {
    const result = await service.importInventoryCountRows(ctx.asSystem.pg, {
      inventoryCountId: input.inventoryCountId,
      companyId: ctx.company.id,
      userId: ctx.auditUserId,
      rows: input.rows
    });
    if (!result) {
      return ctx.error(
        "conflict",
        "Counts can only be edited while the document is Draft"
      );
    }
    return result;
  }
});

export const removeInventoryCountUnit = defineServiceFn({
  publish: "destructive",
  title: "Remove a unit added to an inventory count",
  description: `Removes a line the counter added (an Unexpected unit). A line from the
snapshot cannot be removed; count it 0. Draft counts only.`,
  output: z.object({
    lineId: z.string()
  }),
  input: z.object({ lineId: z.string().min(1) }),
  permission: { update: "inventory" },
  async run(ctx, { lineId }) {
    const removed = await service.removeInventoryCountUnit(ctx.asSystem.pg, {
      lineId,
      companyId: ctx.company.id
    });
    if (!removed) {
      return ctx.error(
        "conflict",
        "Only a unit added while counting can be removed, while the count is Draft"
      );
    }
    return { lineId };
  }
});

export const updateInventoryCountStatus = defineServiceFn({
  publish: true,
  title: "Confirm or reopen an inventory count",
  description: `\`Pending\` confirms a Draft count for review; \`Draft\` reopens a Pending one
for entry. A count is posted only by \`postInventoryCount\`, which books its
variances; a Posted count stays Posted.`,
  output: z.object({
    id: z.string(),
    status: z.enum(["Draft", "Pending"])
  }),
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

export const updateBatchPropertyOrder = defineServiceFn({
  publish: true,
  title: "Update batch property order",
  output: z.array(
    rows.batchProperty.pick({ id: true }).meta({ table: "batchProperty" })
  ),
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

export const upsertBatchProperty = defineServiceFn({
  publish: true,
  title: "Upsert batch property",
  description:
    "A `list` property needs its `listOptions`; another type keeps none.",
  output: z.array(
    rows.batchProperty.pick({ id: true }).meta({ table: "batchProperty" })
  ),
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

export const createKanban = defineServiceFn({
  publish: true,
  title: "Create a kanban",
  description: `A Buy kanban needs its supplier; a Transfer kanban needs a from and a to
storage unit, and only it can have a replenishment level. Neither storage
unit may be non-nettable. When the location's Kanbans printer auto-prints,
the new kanban's Create card is printed.`,
  output: rows.kanban.pick({ id: true }).meta({ table: "kanban" }),
  input: kanbanInput,
  permission: { create: "inventory" },
  async run(ctx, { id: _id, ...input }) {
    const refused = await service.refuseNonNettableKanbanUnits(ctx, [
      input.storageUnitId,
      input.fromStorageUnitId
    ]);
    if (refused) return refused;
    const created = unwrap(
      ctx,
      await service.upsertKanban(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
    if (created instanceof CarbonError || !created) return created;

    await service.autoPrint(ctx, {
      sourceDocument: "Kanban",
      sourceDocumentId: created.id,
      locationId: input.locationId,
      context: "kanban"
    });

    return created;
  }
});

export const updateKanban = defineServiceFn({
  publish: true,
  title: "Update a kanban",
  description: "The same rules as `createKanban`.",
  output: rows.kanban.pick({ id: true }).meta({ table: "kanban" }),
  input: kanbanInput.extend({
    id: z.string().describe("The kanban to update.")
  }),
  permission: { update: "inventory" },
  async run(ctx, input) {
    // Only a unit the update sets: a kanban whose unit became non-nettable
    // later stays editable; scanKanban and replenishKanban refuse its scans.
    const current = await ctx.asCaller.supabase
      .from("kanban")
      .select("storageUnitId, fromStorageUnitId")
      .eq("id", input.id)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (current.error) {
      return ctx.error("internal", "Failed to load kanban", current.error);
    }
    const refused = await service.refuseNonNettableKanbanUnits(ctx, [
      input.storageUnitId !== current.data?.storageUnitId
        ? input.storageUnitId
        : null,
      input.fromStorageUnitId !== current.data?.fromStorageUnitId
        ? input.fromStorageUnitId
        : null
    ]);
    if (refused) return refused;
    return unwrap(
      ctx,
      await service.upsertKanban(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

export const createStorageUnit = defineServiceFn({
  publish: true,
  title: "Create a storage unit",
  description: "Upsert storage unit",
  output: rows.storageUnit.pick({ id: true }).meta({ table: "storageUnit" }),
  input: z.looseObject({
    name: z.string().min(1),
    locationId: z.string().min(1),
    warehouseId: z.string().optional(),
    parentId: z.string().optional(),
    workCenterId: z.string().optional(),
    storageTypeIds: z.array(z.string()).optional(),
    nonNettable: z
      .boolean()
      .describe(
        "Stock in it is not supply: MRP and planning ignore it, and picking never sources from it."
      )
      .optional(),
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

export const updateStorageUnit = defineServiceFn({
  publish: true,
  title: "Update a storage unit",
  description: "Upsert storage unit",
  output: rows.storageUnit.pick({ id: true }).meta({ table: "storageUnit" }),
  input: z
    .looseObject({
      name: z.string().min(1),
      locationId: z.string().min(1),
      warehouseId: z.string().optional(),
      parentId: z.string().optional(),
      workCenterId: z.string().optional(),
      storageTypeIds: z.array(z.string()).optional(),
      nonNettable: z
        .boolean()
        .describe(
          "Stock in it is not supply: MRP and planning ignore it, and picking never sources from it."
        )
        .optional(),
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

export const createShippingMethod = defineServiceFn({
  publish: true,
  title: "Create a shipping method",
  description: "Upsert shipping method",
  output: rows.shippingMethod
    .pick({ id: true })
    .meta({ table: "shippingMethod" }),
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

export const updateShippingMethod = defineServiceFn({
  publish: true,
  title: "Update a shipping method",
  description: "Upsert shipping method",
  output: rows.shippingMethod
    .pick({ id: true })
    .meta({ table: "shippingMethod" }),
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

export const createStockTransferLine = defineServiceFn({
  publish: true,
  title: "Create a stock transfer line",
  description: `Adds a line to a Draft stock transfer: reopen a locked one first. The line
starts unpicked; picking moves stock through \`pickStockTransferLine\`.`,
  output: rows.stockTransferLine
    .pick({ id: true })
    .meta({ table: "stockTransferLine" }),
  input: z.object({
    stockTransferId: z.string().min(1),
    itemId: z.string().min(1),
    fromStorageUnitId: z.string().optional(),
    toStorageUnitId: z.string().optional(),
    quantity: z.number().min(0),
    requiresBatchTracking: booleanField(),
    requiresSerialTracking: booleanField()
  }),
  permission: { create: "inventory" },
  async run(ctx, input) {
    if (isSameStorageUnit(input.fromStorageUnitId, input.toStorageUnitId)) {
      return ctx.error("validation", SAME_STORAGE_UNIT_MESSAGE);
    }
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

export const updateStockTransferLine = defineServiceFn({
  publish: true,
  title: "Update a stock transfer line",
  description: `Changes a line of a Draft stock transfer: reopen a locked one first. Its
picked quantity moves only by picking (\`pickStockTransferLine\`).`,
  output: rows.stockTransferLine
    .pick({ id: true })
    .meta({ table: "stockTransferLine" }),
  input: z
    .object({
      stockTransferId: z.string().min(1),
      itemId: z.string().min(1),
      fromStorageUnitId: z.string().optional(),
      toStorageUnitId: z.string().optional(),
      quantity: z.number().min(0),
      requiresBatchTracking: booleanField(),
      requiresSerialTracking: booleanField(),
      id: z.string().describe("The line to update.").optional()
    })
    .required({ id: true }),
  permission: { create: "inventory", update: "inventory" },
  async run(ctx, input) {
    if (isSameStorageUnit(input.fromStorageUnitId, input.toStorageUnitId)) {
      return ctx.error("validation", SAME_STORAGE_UNIT_MESSAGE);
    }
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

export const getStorageUnitDescendants = defineServiceFn({
  publish: "read",
  title: "Get storage unit descendants",
  output: z.array(
    z.object({
      id: z.string().nullable(),
      parentId: z.string().nullable(),
      locationId: z.string().nullable(),
      warehouseId: z.string().nullable(),
      name: z.string().nullable(),
      active: z.boolean().nullable(),
      storageTypeIds: z.array(z.string()).nullable(),
      companyId: z.string().nullable(),
      depth: z.number().nullable(),
      ancestorPath: z.array(z.string()).nullable()
    })
  ),
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

export const expandStorageUnitIdsWithDescendants = defineServiceFn({
  publish: "read",
  title: "Expand storage unit ids with descendants",
  output: z.array(z.string()),
  input: z.looseObject({ storageUnitIds: z.array(z.string()) }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return await service.expandStorageUnitIdsWithDescendants(
      ctx.asCaller.supabase,
      input.storageUnitIds
    );
  }
});

export const getStorageTypeUsage = defineServiceFn({
  publish: "read",
  title: "Get storage type usage",
  output: z.array(
    rows.storageType
      .pick({ id: true, name: true })
      .meta({ table: "storageType" })
  ),
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

export const deleteStorageTypeWithCascade = defineServiceFn({
  publish: "destructive",
  title: "Delete storage type with cascade",
  description: `A storage type that storage units still have is deleted only with
\`cascade\`, which takes it off those units in the same transaction.`,
  output: rows.storageType.pick({ id: true }).meta({ table: "storageType" }),
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

export const getStorageTypes = defineServiceFn({
  publish: "read",
  title: "Get storage types",
  output: z
    .array(
      rows.storageType
        .pick({
          companyId: true,
          createdAt: true,
          createdBy: true,
          id: true,
          name: true,
          nettable: true,
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
        .meta({ table: "storageType" })
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
      await service.getStorageTypes(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

export const getStorageType = defineServiceFn({
  publish: "read",
  title: "Get storage type",
  output: rows.storageType
    .pick({
      companyId: true,
      createdAt: true,
      createdBy: true,
      id: true,
      name: true,
      nettable: true,
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
    .meta({ table: "storageType" }),
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

export const getStorageTypesList = defineServiceFn({
  publish: "read",
  title: "Get storage types list",
  output: z.array(
    rows.storageType
      .pick({ id: true, name: true })
      .meta({ table: "storageType" })
  ),
  input: z.record(z.string(), z.unknown()),
  permission: { view: "inventory" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getStorageTypesList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

export const createStorageType = defineServiceFn({
  publish: true,
  title: "Create a storage type",
  description: "Upsert storage type",
  output: rows.storageType.pick({ id: true }).meta({ table: "storageType" }),
  input: z.looseObject({
    name: z.string().min(1),
    nonNettable: z
      .boolean()
      .describe("Every storage unit of this type is non-nettable.")
      .optional(),
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

export const updateStorageType = defineServiceFn({
  publish: true,
  title: "Update a storage type",
  description: "Upsert storage type",
  output: rows.storageType.pick({ id: true }).meta({ table: "storageType" }),
  input: z
    .looseObject({
      name: z.string().min(1),
      nonNettable: z
        .boolean()
        .describe("Every storage unit of this type is non-nettable.")
        .optional(),
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

export const getShelfLifeForItems = defineServiceFn({
  publish: "read",
  title: "Get shelf life for items",
  output: z.array(
    z.object({
      itemId: z.string(),
      mode: z.enum(["Calculated", "Fixed Duration", "Set on Receipt"]),
      days: z.number().nullable()
    })
  ),
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

export const getTrackedEntityExpirations = defineServiceFn({
  publish: "read",
  title: "Map of trackedEntityId → expirationDate (or null) for a set of ids",
  output: z.record(z.string(), z.string().nullable()),
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

export const getPickingLists = defineServiceFn({
  publish: "read",
  title: "Get picking lists",
  output: z
    .array(
      rows.pickingLists
        .pick({
          assignee: true,
          assigneeAvatarUrl: true,
          assigneeName: true,
          companyId: true,
          completedLineCount: true,
          createdAt: true,
          createdBy: true,
          dueDate: true,
          id: true,
          lineCount: true,
          locationId: true,
          locationName: true,
          pickingListId: true,
          status: true,
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
          ])
        })
        .meta({ table: "pickingList" })
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

export const getPickingList = defineServiceFn({
  publish: "read",
  title: "Get picking list",
  output: rows.pickingList
    .pick({
      assignee: true,
      companyId: true,
      createdAt: true,
      createdBy: true,
      dueDate: true,
      id: true,
      locationId: true,
      pickingListId: true,
      status: true,
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
      location: z.object({
        name: z.string()
      }),
      assigneeUser: z
        .object({
          fullName: z.string().nullable(),
          avatarUrl: z.string().nullable()
        })
        .nullable()
    })
    .meta({ table: "pickingList" }),
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

export const getPicksByJobMaterial = defineServiceFn({
  publish: "read",
  title: "Get picks by job material",
  output: z.record(
    z.string(),
    z.array(
      z.object({
        itemId: z.string(),
        itemReadableId: z.string(),
        isSubstitute: z.boolean(),
        quantityToPick: z.number(),
        quantityPicked: z.number(),
        pickingListId: z.string(),
        pickingListReadableId: z.string(),
        pickingListStatus: z.string()
      })
    )
  ),
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

export const getPickingListLines = defineServiceFn({
  publish: "read",
  title: "Get picking list lines",
  output: z.array(
    rows.pickingListLine
      .pick({
        companyId: true,
        createdAt: true,
        createdBy: true,
        id: true,
        itemId: true,
        jobId: true,
        jobMaterialId: true,
        jobOperationId: true,
        outstandingQuantity: true,
        pickingListId: true,
        projectId: true,
        quantityPicked: true,
        quantityReturned: true,
        quantityToPick: true,
        status: true,
        storageUnitId: true,
        toStorageUnitId: true,
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
          readableId: z.string(),
          itemTrackingType: z.enum([
            "Batch",
            "Inventory",
            "Non-Inventory",
            "Serial"
          ]),
          unitOfMeasureCode: z.string().nullable()
        }),
        jobMaterial: z.object({
          itemId: z.string(),
          quantity: z.number(),
          substitutionFactor: z.number().nullable(),
          item: z.object({
            readableId: z.string(),
            itemSupersession: z
              .object({
                conversionFactor: z.number()
              })
              .nullable()
          })
        }),
        job: z.object({
          jobId: z.string()
        }),
        jobOperation: z
          .object({
            order: z.number(),
            processId: z.string(),
            workCenterId: z.string().nullable(),
            process: z.object({
              name: z.string()
            }),
            workCenter: z
              .object({
                name: z.string()
              })
              .nullable()
          })
          .nullable(),
        storageUnit: z
          .object({
            name: z.string(),
            locationId: z.string()
          })
          .nullable(),
        toStorageUnit: z
          .object({
            name: z.string(),
            locationId: z.string()
          })
          .nullable(),
        trackedEntities: z.array(
          z.object({
            trackedEntityId: z.string(),
            quantity: z.number(),
            quantityPicked: z.number(),
            trackedEntity: z.object({
              readableId: z.string().nullable()
            })
          })
        )
      })
      .meta({ table: "pickingListLine" })
  ),
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

export const getPickingListRelatedItems = defineServiceFn({
  publish: "read",
  title:
    "The documents around a picking list that its own row doesn't name: the jobs its lines pick for, with their status",
  output: z.object({
    jobs: z.array(
      z.object({
        id: z.string(),
        jobId: z.string(),
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
        ]),
        itemId: z.string()
      })
    )
  }),
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

export const getPickingListAvailability = defineServiceFn({
  publish: "read",
  title:
    "Warehouse on-hand for each line of a picking list: every bin but lineside, the unassigned bin included, keyed by picking list line id",
  output: z.record(z.string(), z.unknown()),
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

export const getPickingListRecommendations = defineServiceFn({
  publish: "read",
  title:
    "The recommended tracked entities (serial/batch lots) for each tracked picking line, in pick order — surfaced as at-a-glance subtext before the picker opens",
  output: z.record(
    z.string(),
    z.array(
      z.object({
        trackedEntityId: z.string(),
        readableId: z.string().nullable()
      })
    )
  ),
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

export const getPickingListLine = defineServiceFn({
  publish: "read",
  title: "Get picking list line",
  output: rows.pickingListLine
    .pick({
      companyId: true,
      createdAt: true,
      createdBy: true,
      id: true,
      itemId: true,
      jobId: true,
      jobMaterialId: true,
      jobOperationId: true,
      outstandingQuantity: true,
      pickingListId: true,
      projectId: true,
      quantityPicked: true,
      quantityReturned: true,
      quantityToPick: true,
      status: true,
      storageUnitId: true,
      toStorageUnitId: true,
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
      item: z.object({
        name: z.string(),
        readableId: z.string()
      }),
      job: z.object({
        jobId: z.string()
      }),
      jobOperation: z
        .object({
          order: z.number(),
          processId: z.string(),
          workCenterId: z.string().nullable(),
          process: z.object({
            name: z.string()
          }),
          workCenter: z
            .object({
              name: z.string()
            })
            .nullable()
        })
        .nullable(),
      storageUnit: z
        .object({
          name: z.string(),
          locationId: z.string()
        })
        .nullable(),
      toStorageUnit: z
        .object({
          name: z.string(),
          locationId: z.string()
        })
        .nullable(),
      pickingList: z.object({
        pickingListId: z.string(),
        status: z.enum([
          "Cancelled",
          "Completed",
          "Draft",
          "In Progress",
          "Partial"
        ])
      })
    })
    .meta({ table: "pickingListLine" }),
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

export const deletePickingList = defineServiceFn({
  publish: "destructive",
  title: "Delete picking list",
  output: z.array(
    rows.pickingList.pick({ id: true }).meta({ table: "pickingList" })
  ),
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

export const getPickingSchedule = defineServiceFn({
  publish: "read",
  title: "Get picking schedule",
  output: z.array(
    z.object({
      customerId: z.string(),
      customerName: z.string(),
      deadlineType: z.enum([
        "ASAP",
        "Hard Deadline",
        "No Deadline",
        "Soft Deadline"
      ]),
      dueDate: z.string(),
      itemDescription: z.string(),
      itemId: z.string(),
      itemReadableId: z.string(),
      jobId: z.string(),
      jobMakeMethodId: z.string(),
      jobOperationId: z.string(),
      jobReadableId: z.string(),
      laborTime: z.number(),
      laborUnit: z.enum([
        "Hours/100 Pieces",
        "Hours/1000 Pieces",
        "Hours/Piece",
        "Minutes/100 Pieces",
        "Minutes/1000 Pieces",
        "Minutes/Piece",
        "Pieces/Hour",
        "Pieces/Minute",
        "Seconds/Piece",
        "Total Hours",
        "Total Minutes"
      ]),
      machineTime: z.number(),
      machineUnit: z.enum([
        "Hours/100 Pieces",
        "Hours/1000 Pieces",
        "Hours/Piece",
        "Minutes/100 Pieces",
        "Minutes/1000 Pieces",
        "Minutes/Piece",
        "Pieces/Hour",
        "Pieces/Minute",
        "Seconds/Piece",
        "Total Hours",
        "Total Minutes"
      ]),
      operationDescription: z.string(),
      operationOrder: z.number(),
      operationQuantity: z.number(),
      operationStatus: z.enum([
        "Canceled",
        "Done",
        "In Progress",
        "Paused",
        "Ready",
        "Todo",
        "Waiting"
      ]),
      partsToPickCount: z.number(),
      processName: z.string(),
      quantityComplete: z.number(),
      quantityReworked: z.number(),
      quantityScrapped: z.number(),
      salesOrderId: z.string(),
      salesOrderLineId: z.string(),
      salesOrderReadableId: z.string(),
      setupTime: z.number(),
      setupUnit: z.enum([
        "Hours/100 Pieces",
        "Hours/1000 Pieces",
        "Hours/Piece",
        "Minutes/100 Pieces",
        "Minutes/1000 Pieces",
        "Minutes/Piece",
        "Pieces/Hour",
        "Pieces/Minute",
        "Seconds/Piece",
        "Total Hours",
        "Total Minutes"
      ]),
      tags: z.array(z.string()),
      targetQuantity: z.number(),
      thumbnailPath: z.string(),
      totalQuantityToPick: z.number(),
      workCenterId: z.string(),
      workCenterName: z.string()
    })
  ),
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

export const generatePickingList = defineServiceFn({
  publish: "destructive",
  title: "Generate picking list",
  output: rows.pickingList
    .pick({ id: true, pickingListId: true })
    .meta({ table: "pickingList" }),
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

export const insertWarehouseTransfer = defineServiceFn({
  publish: true,
  title: "Create a warehouse transfer between locations",
  description: `Create a Draft warehouse transfer between locations. Generates sequence ID
automatically. Its status moves only through \`setWarehouseTransferStatus\`.`,
  output: rows.warehouseTransfer
    .pick({ id: true, transferId: true })
    .meta({ table: "warehouseTransfer" }),
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

export const updateWarehouseTransfer = defineServiceFn({
  publish: true,
  title: "Update an existing warehouse transfer",
  description: `Only a Draft transfer's header changes: reopen it first. Its status moves
only through \`setWarehouseTransferStatus\`.`,
  output: rows.warehouseTransfer
    .pick({ id: true })
    .meta({ table: "warehouseTransfer" }),
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

export const getSerialUnitCosts = defineServiceFn({
  publish: "read",
  title: "Value an item's serial units on hand",
  description: `What each serial unit of the item on hand would leave stock at, valued the
way a shipment or a capitalization relieves it, keyed by tracked entity id.
With \`locationId\`, only the units at that location.`,
  output: z.union([
    z.object({
      costs: z.record(z.string(), z.unknown()),
      costingMethod: z.null()
    }),
    z.object({
      costs: z.record(z.string(), z.number()),
      costingMethod: z.enum(["Average", "FIFO", "LIFO", "Standard"])
    }),
    z.null()
  ]),
  input: service.previewSerialUnitCostsInput,
  permission: service.previewSerialUnitCostsPermission,
  async run(ctx, input) {
    return run(ctx, "preview-serial-unit-costs", () =>
      service.previewSerialUnitCosts(ctx, input)
    );
  }
});

export const recostSerialUnit = defineServiceFn({
  publish: true,
  title: "Recost one serial unit in stock",
  description: `Re-books the unit's cost layer at \`unitCost\` and posts the difference
against the offset account. The unit must be the only one of its serial on
hand at one location, of a FIFO or LIFO item.`,
  output: z.object({
    previousCost: z.number(),
    unitCost: z.number(),
    journalId: z.string().nullable()
  }),
  input: service.recostSerialUnitInput,
  permission: service.recostSerialUnitPermission,
  async run(ctx, input) {
    return run(ctx, "recost-serial-unit", () =>
      service.recostSerialUnit(ctx, input)
    );
  }
});
