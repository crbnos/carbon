// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  type Database,
  getCompanyTimeZone,
  journalReference
} from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import {
  assertPostingStatusUnchanged,
  journalPostingStatus
} from "@carbon/database/journal-posting-status";
import {
  contains,
  inOrder,
  lt,
  many,
  maybeSingle,
  neq,
  single,
  type Tables,
  updateRows
} from "@carbon/database/rows";
import {
  resolveFeatureSamplingPlan,
  resolveSamplingPlan,
  type SamplingStandard
} from "@carbon/database/sampling";
import { getNextSequence } from "@carbon/database/sequence";
import { getLogger } from "@carbon/logger";
import {
  credit,
  datetime,
  debit,
  resolveReturnUnitCost,
  round,
  settleQuantity,
  type TrackedEntityAttributes
} from "@carbon/utils";
import type { Insertable } from "kysely";
import { nanoid } from "nanoid";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { InvalidInputError, NotFoundError } from "../errors";
import { calculateCOGS } from "../lib/calculate-cogs";
import {
  INVENTORY_VOID_BEFORE_CUTOVER_ERROR,
  refuseVoidBeforeCutover
} from "../lib/cutover-void";
import { documentJournalLines } from "../lib/document-journal-lines";
import { FixedAssetWrites } from "../lib/fixed-asset-writes";
import { getCurrentAccountingPeriod } from "../lib/get-accounting-period";
import {
  getDefaultPostingGroup,
  resolveInventoryAccount
} from "../lib/get-posting-group";
import { journalLineDimensionRows } from "../lib/journal-line-dimensions";
import { assertPostable } from "../lib/postable";
import {
  buildPurchaseReceiptJournalLines,
  buildSalesReturnReceiptJournalLines,
  type FixedAssetReceiptLine,
  type PurchaseReceiptLine,
  purchaseReceiptLineCosts,
  type SalesReturnReceiptLine
} from "./posting-lines";
import { postRentalReceipt } from "./rental-agreement";
import { planReceiptVoidCostLedger } from "./void-cost-ledger";

const logger = getLogger("server-functions", "post-receipt");

export const postReceiptInput = z.object({
  type: z.enum(["post", "void"]).default("post"),
  receiptId: z.string(),
  /** The return date of a rental receipt. Other sources ignore it. */
  postingDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
});

/** Posts or voids a receipt: stock, tracked entities, cost layers and journal. */
const postReceipt = defineServerFn({
  name: "post-receipt",
  input: postReceiptInput,
  permissions: { update: "inventory" },
  async run(ctx, { type, receiptId, postingDate }) {
    const { db, companyId, userId } = ctx;

    logger.info({ type, receiptId, userId, companyId });
    const fixedAssetWrites = new FixedAssetWrites();
    if (type === "post")
      await assertPostable(db, "receipt", receiptId, companyId);
    try {
      const today = datetime
        .today(await getCompanyTimeZone(db, companyId))
        .toString();

      const companyRecord = await single(
        db,
        "company",
        { id: companyId },
        { columns: ["companyGroupId"] }
      );
      if (companyRecord.error) throw new Error("Failed to fetch company");
      const companyGroupId = companyRecord.data.companyGroupId;
      // Every receipt that carries value posts a journal: Provisional before
      // the company's accounting cutover, Posted after it. Read here to decide
      // whether to resolve a period, and again inside each transaction, where
      // FOR SHARE holds the status until commit.
      const postingStatus = await journalPostingStatus(db, companyId);

      const [receipt, receiptLines, receiptLineTracking, dimensions] =
        await inOrder([
          // The client is service-role: authorization proved the caller may
          // act in companyId, not that receiptId belongs to it.
          () => maybeSingle(db, "receipt", { id: receiptId, companyId }),
          () => many(db, "receiptLine", { receiptId, companyId }),
          () =>
            many(db, "trackedEntity", {
              attributes: contains({ Receipt: receiptId }),
              companyId
            }),
          () =>
            many(
              db,
              "dimension",
              {
                companyGroupId: companyGroupId!,
                active: true,
                entityType: [
                  "SupplierType",
                  "Supplier",
                  "CustomerType",
                  "Customer",
                  "ItemPostingGroup",
                  "Item",
                  "Location",
                  "Process",
                  "FixedAssetClass"
                ]
              },
              { columns: ["id", "entityType"] }
            )
        ]);

      if (receipt.error) throw new Error("Failed to fetch receipt");
      if (!receipt.data) throw new NotFoundError("Receipt not found");
      const receiptHeader = receipt.data;
      if (receiptLines.error) throw new Error("Failed to fetch receipt lines");
      if (dimensions.error) {
        logger.error("Failed to fetch dimensions", { error: dimensions.error });
      }

      const dimensionMap = new Map<string, string>();
      for (const dim of dimensions.data ?? []) {
        if (dim.entityType) dimensionMap.set(dim.entityType, dim.id);
      }

      const itemIds = receiptLines.data.reduce<string[]>((acc, receiptLine) => {
        if (receiptLine.itemId && !acc.includes(receiptLine.itemId)) {
          acc.push(receiptLine.itemId);
        }
        return acc;
      }, []);
      const [items, itemCosts, companySettings] = await inOrder([
        () =>
          many(
            db,
            "item",
            { id: itemIds, companyId },
            { columns: ["id", "itemTrackingType", "replenishmentSystem"] }
          ),
        () =>
          many(
            db,
            "itemCost",
            { itemId: itemIds },
            { columns: ["itemId", "itemPostingGroupId"] }
          ),
        () =>
          single(
            db,
            "companySettings",
            { id: companyId },
            { columns: ["samplingStandard"] }
          )
      ]);
      if (items.error) {
        throw new Error("Failed to fetch items");
      }
      if (itemCosts.error) {
        throw new Error("Failed to fetch item costs");
      }

      const samplingStandard: SamplingStandard =
        (companySettings.data as any)?.samplingStandard ?? "ANSI_Z1_4";

      // Receipt-usage inspection document assignments drive per-feature
      // measurement plans on the created lots.
      const inspectionDocumentAssignments = await many(
        db,
        "itemInspectionDocumentAssignment",
        { companyId, usage: "Receipt", itemId: itemIds },
        { columns: ["itemId", "inspectionDocumentId"] }
      );
      const assignmentByItemId = new Map<string, string>(
        ((inspectionDocumentAssignments.data as any[]) ?? []).map((a) => [
          a.itemId,
          a.inspectionDocumentId
        ])
      );
      const assignedDocumentIds = [...new Set(assignmentByItemId.values())];
      const inspectionFeaturesByDocumentId = new Map<string, any[]>();
      if (assignedDocumentIds.length > 0) {
        const inspectionFeatures = await many(
          db,
          "inspectionFeature",
          { inspectionDocumentId: assignedDocumentIds, companyId },
          {
            columns: [
              "id",
              "inspectionDocumentId",
              "type",
              "samplingPlanType",
              "samplingSampleSize",
              "samplingPercentage",
              "samplingAql",
              "samplingInspectionLevel",
              "samplingSeverity"
            ]
          }
        );
        for (const feature of (inspectionFeatures.data as any[]) ?? []) {
          const list =
            inspectionFeaturesByDocumentId.get(feature.inspectionDocumentId) ??
            [];
          list.push(feature);
          inspectionFeaturesByDocumentId.set(
            feature.inspectionDocumentId,
            list
          );
        }
      }

      // The document's default sampling rule is the lot-level plan base and the
      // fallback for features without their own rule (feature rule -> document
      // default -> All).
      const documentDefaultByDocumentId = new Map<string, any>();
      if (assignedDocumentIds.length > 0) {
        const assignedDocuments = await many(
          db,
          "inspectionDocument",
          { id: assignedDocumentIds, companyId },
          {
            columns: [
              "id",
              "samplingPlanType",
              "samplingSampleSize",
              "samplingPercentage",
              "samplingAql",
              "samplingInspectionLevel",
              "samplingSeverity"
            ]
          }
        );
        for (const doc of (assignedDocuments.data as any[]) ?? []) {
          if (!doc.samplingPlanType) continue;
          documentDefaultByDocumentId.set(doc.id, {
            type: doc.samplingPlanType,
            sampleSize: doc.samplingSampleSize,
            percentage:
              doc.samplingPercentage == null
                ? null
                : Number(doc.samplingPercentage),
            aql: doc.samplingAql == null ? null : Number(doc.samplingAql),
            inspectionLevel: doc.samplingInspectionLevel,
            severity: doc.samplingSeverity
          });
        }
      }

      if (type === "void") {
        if (receiptHeader.status !== "Posted") {
          throw new Error("Can only void posted receipts");
        }

        // The enable reset the cost layers this receipt created.
        await refuseVoidBeforeCutover(
          db,
          companyId,
          receiptHeader.postingDate,
          INVENTORY_VOID_BEFORE_CUTOVER_ERROR
        );

        if (receiptHeader.invoiced) {
          throw new Error(
            "Cannot void a receipt created by a purchase invoice. Void the invoice instead."
          );
        }

        if (receiptHeader.sourceDocument === "Rental Agreement") {
          throw new InvalidInputError(
            "A rental return cannot be voided. Correct the unit by hand."
          );
        }

        if (
          receiptHeader.sourceDocument !== "Purchase Order" &&
          receiptHeader.sourceDocument !== "Sales Return Order"
        ) {
          throw new Error(
            `Void is only supported for receipts with source document "Purchase Order" or "Sales Return Order"`
          );
        }

        if (!receiptHeader.sourceDocumentId) {
          throw new Error("Receipt has no sourceDocumentId");
        }

        if (receiptHeader.sourceDocument === "Sales Return Order") {
          // Reverse a posted sales-return receipt: sign-flip the ledger +
          // journal, roll back the RMA quantities and status ladder, flip the
          // reactivated entities back to Consumed (their pre-receipt state), and
          // zero this receipt's own cost layers so FIFO can never consume voided
          // return stock.
          const salesReturnOrderId = receiptHeader.sourceDocumentId;

          // The PO void path blocks voiding an invoiced receipt; the analogous
          // hazard here is a credit memo. Voiding after crediting would leave
          // quantityCredited > quantityReceived with no path to reconcile.
          const creditMemos = await many(
            db,
            "memo",
            { salesReturnOrderId, companyId, status: neq("Voided") },
            { columns: ["id", "status"] }
          );
          if (creditMemos.error)
            throw new Error("Failed to check for credit memos");
          if ((creditMemos.data ?? []).length > 0) {
            throw new Error(
              "Cannot void: a credit memo exists for this return order. Void it first."
            );
          }

          const [originalItemLedger, originalJournalLines, returnLinesVoid] =
            await inOrder([
              () =>
                many(db, "itemLedger", {
                  documentId: receiptId,
                  documentType: "Sales Return Receipt",
                  companyId
                }),
              () =>
                documentJournalLines(db, companyId, {
                  documentId: receiptId,
                  documentType: "Receipt"
                }),
              () =>
                many(db, "salesReturnOrderLine", {
                  salesReturnOrderId,
                  companyId
                })
            ]);
          if (originalItemLedger.error)
            throw new Error("Failed to fetch original item ledger entries");
          if (returnLinesVoid.error)
            throw new Error("Failed to fetch return order lines");

          const reversingItemLedger = (originalItemLedger.data ?? []).map(
            (entry) => ({
              postingDate: today,
              itemId: entry.itemId,
              quantity: -entry.quantity,
              locationId: entry.locationId,
              storageUnitId: entry.storageUnitId,
              entryType:
                entry.entryType === "Positive Adjmt."
                  ? ("Negative Adjmt." as const)
                  : ("Positive Adjmt." as const),
              documentType: "Sales Return Receipt" as const,
              documentId: entry.documentId,
              externalDocumentId: entry.externalDocumentId,
              trackedEntityId: entry.trackedEntityId,
              createdBy: userId,
              companyId
            })
          );

          const reversingJournalLines = originalJournalLines.map((line) => ({
            accountId: line.accountId,
            description: `VOID: ${line.description ?? ""}`,
            amount: -line.amount,
            quantity: line.quantity == null ? undefined : -line.quantity,
            documentType: line.documentType,
            documentId: line.documentId,
            externalDocumentId: line.externalDocumentId ?? undefined,
            documentLineReference: line.documentLineReference ?? undefined,
            journalLineReference: line.journalLineReference,
            companyId
          }));

          const receivedByLine = new Map<string, number>();
          for (const receiptLine of receiptLines.data ?? []) {
            if (!receiptLine.lineId) continue;
            const qty = Number(receiptLine.receivedQuantity ?? 0);
            receivedByLine.set(
              receiptLine.lineId,
              (receivedByLine.get(receiptLine.lineId) ?? 0) + qty
            );
          }

          // A Provisional journal has no accounting period.
          const accountingPeriodId =
            postingStatus === "Posted" && reversingJournalLines.length > 0
              ? await getCurrentAccountingPeriod(companyId, db, today)
              : null;

          await db.transaction().execute(async (trx) => {
            await assertPostingStatusUnchanged(trx, companyId, postingStatus);
            // Refuse to void when this receipt's cost layers were already
            // (partially) consumed — the returned stock moved on (dispositioned,
            // sold, scrapped), so reversing the full receipt would drive stock
            // negative and double-count COGS. The remainder is a manual
            // inventory adjustment, not a void.
            const receiptLayers = await trx
              .selectFrom("costLedger")
              .select(["quantity", "remainingQuantity"])
              .where("documentId", "=", receiptId)
              .where("documentType", "=", "Sales Return Receipt")
              .where("companyId", "=", companyId)
              .forUpdate()
              .execute();
            const consumed = receiptLayers.some(
              (layer) =>
                Number(layer.quantity) > 0 &&
                Number(layer.remainingQuantity) < Number(layer.quantity)
            );
            if (consumed) {
              throw new Error(
                "Cannot void: stock received on this return was already consumed. Correct the remainder with an inventory adjustment instead."
              );
            }

            if (reversingItemLedger.length > 0) {
              await trx
                .insertInto("itemLedger")
                .values(reversingItemLedger)
                .execute();
            }

            if (reversingJournalLines.length > 0) {
              const journalEntryId = await getNextSequence(
                trx,
                "journalEntry",
                companyId
              );
              const journalResult = await trx
                .insertInto("journal")
                .values({
                  journalEntryId,
                  accountingPeriodId,
                  description: `VOID Sales Return Receipt ${receiptHeader.receiptId}`,
                  postingDate: today,
                  companyId,
                  sourceType: "Sales Return Receipt",
                  status: postingStatus,
                  postedAt: datetime.timestamp(),
                  postedBy: userId,
                  createdBy: userId
                })
                .returning(["id"])
                .executeTakeFirstOrThrow();

              await trx
                .insertInto("journalLine")
                .values(
                  reversingJournalLines.map((line) => ({
                    ...line,
                    journalId: journalResult.id
                  }))
                )
                .execute();
            }

            await trx
              .updateTable("costLedger")
              .set({ remainingQuantity: 0 })
              .where("documentId", "=", receiptId)
              .where("documentType", "=", "Sales Return Receipt")
              .where("companyId", "=", companyId)
              .execute();

            for await (const [lineId, received] of receivedByLine) {
              const line = returnLinesVoid.data?.find((l) => l.id === lineId);
              if (!line) continue;
              await trx
                .updateTable("salesReturnOrderLine")
                .set({
                  quantityReceived: Math.max(
                    0,
                    Number(line.quantityReceived ?? 0) - received
                  ),
                  updatedBy: userId
                })
                .where("id", "=", lineId)
                .where("companyId", "=", companyId)
                .execute();
            }

            const remainingLines = await trx
              .selectFrom("salesReturnOrderLine")
              .select(["quantity", "quantityReceived", "closedComplete"])
              .where("salesReturnOrderId", "=", salesReturnOrderId)
              .execute();
            // Derived status (mirrors getSalesReturnOrderStatus): a void that
            // drops received quantity below the authorized total returns the RMA
            // to To Receive; otherwise it stays Completed.
            const allReceived =
              remainingLines.length > 0 &&
              remainingLines.every(
                (l) =>
                  l.closedComplete ||
                  Number(l.quantityReceived) >= Number(l.quantity)
              );
            const returnStatus = allReceived
              ? ("Completed" as const)
              : ("To Receive" as const);
            await trx
              .updateTable("salesReturnOrder")
              .set({ status: returnStatus, updatedBy: userId })
              .where("id", "=", salesReturnOrderId)
              .where("companyId", "=", companyId)
              .execute();

            const voidActivity = await trx
              .insertInto("trackedActivity")
              .values({
                type: "Void Receipt",
                sourceDocument: "Receipt",
                sourceDocumentId: receiptId,
                sourceDocumentReadableId: receiptHeader.receiptId,
                attributes: {
                  "Sales Return Order": salesReturnOrderId,
                  Receipt: receiptId,
                  Employee: userId
                },
                companyId,
                createdBy: userId,
                createdAt: today
              })
              .returning(["id"])
              .execute();
            const voidActivityId = voidActivity[0]?.id;

            for await (const entity of receiptLineTracking.data ?? []) {
              await trx
                .updateTable("trackedEntity")
                .set({ status: "Consumed" })
                .where("id", "=", entity.id)
                .where("companyId", "=", companyId)
                .execute();

              if (voidActivityId) {
                await trx
                  .insertInto("trackedActivityInput")
                  .values({
                    trackedActivityId: voidActivityId,
                    trackedEntityId: entity.id,
                    quantity: entity.quantity ?? 0,
                    companyId,
                    createdBy: userId,
                    createdAt: today
                  })
                  .execute();
              }
            }

            await trx
              .updateTable("receipt")
              .set({
                status: "Voided",
                updatedAt: today,
                updatedBy: userId
              })
              .where("id", "=", receiptId)
              .where("companyId", "=", companyId)
              .execute();
          });

          return { success: true };
        }

        const [
          originalItemLedger,
          originalJournalLines,
          purchaseOrderLinesVoid
        ] = await inOrder([
          () =>
            many(db, "itemLedger", {
              documentId: receiptId,
              documentType: "Purchase Receipt",
              companyId
            }),
          () =>
            documentJournalLines(db, companyId, {
              documentId: receiptId,
              documentType: "Receipt"
            }),
          () =>
            many(db, "purchaseOrderLine", {
              purchaseOrderId: receiptHeader.sourceDocumentId
            })
        ]);

        if (originalItemLedger.error)
          throw new Error("Failed to fetch item ledger entries");
        if (purchaseOrderLinesVoid.error)
          throw new Error("Failed to fetch purchase order lines");

        const reversingItemLedger: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
          originalItemLedger.data.map((entry) => ({
            postingDate: today,
            itemId: entry.itemId,
            quantity: -entry.quantity,
            locationId: entry.locationId,
            storageUnitId: entry.storageUnitId,
            trackedEntityId: entry.trackedEntityId,
            entryType:
              entry.entryType === "Positive Adjmt."
                ? "Negative Adjmt."
                : entry.entryType === "Negative Adjmt."
                  ? "Positive Adjmt."
                  : entry.entryType,
            documentType: entry.documentType,
            documentId: entry.documentId,
            externalDocumentId: entry.externalDocumentId,
            createdBy: userId,
            companyId
          }));

        const reversingJournalLines: Omit<
          Database["public"]["Tables"]["journalLine"]["Insert"],
          "journalId"
        >[] = originalJournalLines.map((entry) => ({
          accountId: entry.accountId,
          accrual: entry.accrual,
          description: `VOID: ${entry.description}`,
          // A reversal is a sign flip of an already-posted value, which is
          // exact — no rounding to do.
          amount: -entry.amount,
          quantity: -entry.quantity,
          documentType: entry.documentType,
          documentId: entry.documentId,
          externalDocumentId: entry.externalDocumentId,
          documentLineReference: entry.documentLineReference,
          journalLineReference: entry.journalLineReference,
          companyId
        }));

        const receiptLinesByPurchaseOrderLineId = receiptLines.data.reduce<
          Record<string, Database["public"]["Tables"]["receiptLine"]["Row"][]>
        >((acc, receiptLine) => {
          if (receiptLine.lineId) {
            acc[receiptLine.lineId] = [
              ...(acc[receiptLine.lineId] ?? []),
              receiptLine
            ];
          }
          return acc;
        }, {});

        const purchaseOrderLineUpdatesVoid = purchaseOrderLinesVoid.data.reduce<
          Record<
            string,
            Database["public"]["Tables"]["purchaseOrderLine"]["Update"]
          >
        >((acc, purchaseOrderLine) => {
          const receiptLinesForPoLine =
            receiptLinesByPurchaseOrderLineId[purchaseOrderLine.id];
          if (
            receiptLinesForPoLine &&
            receiptLinesForPoLine.length > 0 &&
            purchaseOrderLine.purchaseQuantity &&
            purchaseOrderLine.purchaseQuantity > 0
          ) {
            const receivedQuantityInPurchaseUnit =
              receiptLinesForPoLine.reduce((sum, receiptLine) => {
                const safe =
                  isNaN(receiptLine.receivedQuantity) ||
                  receiptLine.receivedQuantity == null
                    ? 0
                    : receiptLine.receivedQuantity;
                return sum + safe;
              }, 0) / (receiptLinesForPoLine[0]!.conversionFactor ?? 1);

            const newQuantityReceived = Math.max(
              0,
              (purchaseOrderLine.quantityReceived ?? 0) -
                receivedQuantityInPurchaseUnit
            );

            const receivedComplete =
              newQuantityReceived >= purchaseOrderLine.purchaseQuantity;

            acc[purchaseOrderLine.id] = {
              quantityReceived: newQuantityReceived,
              receivedComplete
            };
          }
          return acc;
        }, {});

        // Reverse FA PO line received status on void
        const faPoLinesForVoid = purchaseOrderLinesVoid.data.filter(
          (pol) =>
            pol.purchaseOrderLineType === "Fixed Asset" &&
            pol.assetId &&
            pol.receivedComplete
        );

        // CIP cost rows this receipt wrote, summed per asset. Their presence is
        // the durable record that the posting went into Construction in
        // Progress, even if the asset has since been capitalized into a
        // depreciating class.
        const cipCostByAssetVoid = new Map<string, number>();
        if (faPoLinesForVoid.length > 0) {
          const cipCostRowsVoid = await many(
            db,
            "fixedAssetCipCost",
            { companyId, sourceDocumentId: receiptId },
            { columns: ["fixedAssetId", "amount"] }
          );
          if (cipCostRowsVoid.error)
            throw new Error("Failed to fetch fixed asset CIP costs");
          for (const row of cipCostRowsVoid.data) {
            cipCostByAssetVoid.set(
              row.fixedAssetId,
              (cipCostByAssetVoid.get(row.fixedAssetId) ?? 0) +
                Number(row.amount)
            );
          }
        }
        // Reduced acquisition cost per CIP asset, written inside the void transaction
        const cipAssetUpdatesVoid = new Map<string, number>();

        type VoidedAsset = Pick<
          Tables["fixedAsset"]["Row"],
          "id" | "acquisitionCost" | "status"
        > & {
          fixedAssetClass: Pick<
            Tables["fixedAssetClass"]["Row"],
            "isConstructionInProgress"
          > | null;
        };
        const voidedAssets: { data: VoidedAsset[] } =
          faPoLinesForVoid.length > 0
            ? await many<"fixedAsset", VoidedAsset>(
                db,
                "fixedAsset",
                {
                  companyId,
                  id: faPoLinesForVoid.map((line) => line.assetId!)
                },
                {
                  columns: ["id", "acquisitionCost", "status"],
                  embed: {
                    fixedAssetClass: {
                      table: "fixedAssetClass",
                      via: "fixedAssetClassId",
                      columns: ["isConstructionInProgress"]
                    }
                  }
                }
              )
            : { data: [] };
        const voidedAssetById = new Map(
          voidedAssets.data.map((asset) => [asset.id, asset])
        );

        for (const faPoLine of faPoLinesForVoid) {
          const hasReceiptEntries = originalJournalLines.some(
            (jl) =>
              jl.documentLineReference ===
              journalReference.to.receipt(faPoLine.id)
          );

          if (hasReceiptEntries) {
            purchaseOrderLineUpdatesVoid[faPoLine.id] = {
              quantityReceived: 0,
              receivedComplete: false
            };

            const receiptCost = originalJournalLines
              .filter(
                (jl) =>
                  jl.documentLineReference ===
                    journalReference.to.receipt(faPoLine.id) &&
                  (jl.amount ?? 0) > 0
              )
              .reduce((sum, jl) => sum + Math.abs(jl.amount ?? 0), 0);

            const asset = voidedAssetById.get(faPoLine.assetId!);
            if (asset) {
              fixedAssetWrites.overlay(faPoLine.assetId!, asset);
              const isConstructionInProgress =
                cipCostByAssetVoid.has(faPoLine.assetId!) ||
                Boolean(asset.fixedAssetClass?.isConstructionInProgress);
              if (isConstructionInProgress) {
                if (asset.status !== "Under Construction") {
                  throw new Error(
                    "Asset was capitalized; reverse the capitalization first"
                  );
                }
                const cipCost = cipCostByAssetVoid.get(faPoLine.assetId!);
                if (cipCost !== undefined) {
                  cipAssetUpdatesVoid.set(
                    faPoLine.assetId!,
                    Math.max(0, round(Number(asset.acquisitionCost) - cipCost))
                  );
                  continue;
                }
                // No CIP cost row for this receipt (posted before the class
                // was a CIP class): the cost still came in through this
                // receipt, so back it out like any other asset below rather
                // than leave it on the asset.
              }

              const newAcquisitionCost = Math.max(
                0,
                Number(asset.acquisitionCost) - receiptCost
              );
              const faUpdate: Database["public"]["Tables"]["fixedAsset"]["Update"] =
                {
                  acquisitionCost: newAcquisitionCost,
                  updatedBy: userId
                };
              if (newAcquisitionCost === 0 && asset.status === "Active") {
                faUpdate.status = "Draft";
                faUpdate.acquisitionDate = null;
                faUpdate.depreciationStartDate = null;
              }
              fixedAssetWrites.patch(faPoLine.assetId!, faUpdate);
            }
          }
        }

        const projectedPurchaseOrderLines = purchaseOrderLinesVoid.data.map(
          (line) => {
            const update = purchaseOrderLineUpdatesVoid[line.id];
            if (update && update.quantityReceived !== undefined) {
              return {
                ...line,
                quantityReceived: update.quantityReceived
              };
            }
            return line;
          }
        );

        const areAllLinesInvoicedProjected = projectedPurchaseOrderLines.every(
          (line) => {
            if (line.purchaseOrderLineType === "Comment") return true;
            const target = line.purchaseQuantity ?? 0;
            if (target <= 0) return true;
            return (line.quantityInvoiced ?? 0) >= target;
          }
        );

        const areAllLinesReceivedProjected = projectedPurchaseOrderLines.every(
          (line) => {
            if (
              line.purchaseOrderLineType === "Comment" ||
              line.purchaseOrderLineType === "G/L Account" ||
              line.purchaseOrderLineType === "Service"
            )
              return true;
            const target = line.purchaseQuantity ?? 0;
            if (target <= 0) return true;
            return (line.quantityReceived ?? 0) >= target;
          }
        );

        let purchaseOrderStatusVoid: Database["public"]["Tables"]["purchaseOrder"]["Row"]["status"] =
          "To Receive and Invoice";
        if (areAllLinesInvoicedProjected && areAllLinesReceivedProjected) {
          purchaseOrderStatusVoid = "Completed";
        } else if (areAllLinesInvoicedProjected) {
          purchaseOrderStatusVoid = "To Receive";
        } else if (areAllLinesReceivedProjected) {
          purchaseOrderStatusVoid = "To Invoice";
        }

        const trackedEntityUpdatesVoid =
          receiptLineTracking.data?.reduce<
            Record<
              string,
              Database["public"]["Tables"]["trackedEntity"]["Update"]
            >
          >((acc, trackedEntity) => {
            // Voiding restores the lot, but a lot with nothing in it must not
            // come back Available — that is the zero-quantity husk the drain
            // rule forbids. Scrapped/Rejected are terminal quality states and
            // must survive a void, so keep them; everything else returns to
            // Available (the helper then drains a zero-quantity lot to Consumed).
            acc[trackedEntity.id] = settleQuantity({
              quantity: Number(trackedEntity.quantity ?? 0),
              status:
                trackedEntity.status === "Scrapped" ||
                trackedEntity.status === "Rejected"
                  ? trackedEntity.status
                  : ("Available" as const)
            });
            return acc;
          }, {}) ?? {};

        // A Provisional journal has no accounting period.
        const accountingPeriodId =
          postingStatus === "Posted"
            ? await getCurrentAccountingPeriod(companyId, db, today)
            : null;

        await db.transaction().execute(async (trx) => {
          await assertPostingStatusUnchanged(trx, companyId, postingStatus);
          // The cost layers this receipt wrote. Without this, a voided
          // receipt's layer stayed open and later issues consumed stock that
          // was never there.
          const receiptCostLedger = await trx
            .selectFrom("costLedger")
            .select([
              "id",
              "itemId",
              "quantity",
              "remainingQuantity",
              "cost",
              "supplierId",
              "trackedEntityId"
            ])
            .where("documentId", "=", receiptId)
            .where("documentType", "=", "Purchase Receipt")
            .where("adjustment", "=", false)
            .where("companyId", "=", companyId)
            .forUpdate()
            .execute();
          const costLedgerPlan = planReceiptVoidCostLedger(
            receiptCostLedger.map((row) => ({
              ...row,
              quantity: Number(row.quantity),
              remainingQuantity: Number(row.remainingQuantity),
              cost: Number(row.cost)
            }))
          );
          if (costLedgerPlan.consumed) {
            throw new Error(
              "Cannot void: stock received on this receipt was already consumed. Correct the remainder with an inventory adjustment instead."
            );
          }
          if (costLedgerPlan.layerIdsToClose.length > 0) {
            await trx
              .updateTable("costLedger")
              .set({ remainingQuantity: 0 })
              .where("id", "in", costLedgerPlan.layerIdsToClose)
              .where("companyId", "=", companyId)
              .execute();
          }
          if (costLedgerPlan.restoringLayers.length > 0) {
            await trx
              .insertInto("costLedger")
              .values(
                costLedgerPlan.restoringLayers.map((layer) => ({
                  itemLedgerType: "Purchase" as const,
                  costLedgerType: "Direct Cost" as const,
                  adjustment: false,
                  documentType: "Purchase Receipt" as const,
                  documentId: receiptId,
                  externalDocumentId:
                    receiptHeader.externalDocumentId ?? undefined,
                  itemId: layer.itemId,
                  trackedEntityId: layer.trackedEntityId,
                  quantity: layer.quantity,
                  cost: layer.cost,
                  remainingQuantity: layer.quantity,
                  supplierId: layer.supplierId,
                  companyId,
                  postingDate: today
                }))
              )
              .execute();
          }

          await fixedAssetWrites.apply(trx, companyId);
          for await (const [purchaseOrderLineId, update] of Object.entries(
            purchaseOrderLineUpdatesVoid
          )) {
            await trx
              .updateTable("purchaseOrderLine")
              .set(update)
              .where("id", "=", purchaseOrderLineId)
              .where("companyId", "=", companyId)
              .execute();
          }

          await trx
            .updateTable("purchaseOrder")
            .set({ status: purchaseOrderStatusVoid })
            .where("id", "=", receiptHeader.sourceDocumentId!)
            .where("companyId", "=", companyId)
            .execute();

          for (const [assetId, acquisitionCost] of cipAssetUpdatesVoid) {
            await trx
              .deleteFrom("fixedAssetCipCost")
              .where("companyId", "=", companyId)
              .where("sourceDocumentId", "=", receiptId)
              .where("fixedAssetId", "=", assetId)
              .execute();
            await trx
              .updateTable("fixedAsset")
              .set({ acquisitionCost, updatedBy: userId })
              .where("id", "=", assetId)
              .where("companyId", "=", companyId)
              .execute();
          }

          if (reversingJournalLines.length > 0) {
            const voidJournalEntryId = await getNextSequence(
              trx,
              "journalEntry",
              companyId
            );

            const journal = await trx
              .insertInto("journal")
              .values({
                journalEntryId: voidJournalEntryId,
                accountingPeriodId,
                description: `VOID Purchase Receipt ${receiptHeader.receiptId}`,
                postingDate: today,
                companyId,
                sourceType: "Purchase Receipt",
                status: postingStatus,
                postedAt: datetime.timestamp(),
                postedBy: userId,
                createdBy: userId
              })
              .returning(["id"])
              .execute();

            const journalId = journal[0]!.id;
            if (!journalId) throw new Error("Failed to insert journal");

            await trx
              .insertInto("journalLine")
              .values(
                reversingJournalLines.map((journalLine) => ({
                  ...journalLine,
                  journalId
                }))
              )
              .execute();
          }

          if (reversingItemLedger.length > 0) {
            await trx
              .insertInto("itemLedger")
              .values(reversingItemLedger)
              .execute();
          }

          if (Object.keys(trackedEntityUpdatesVoid).length > 0) {
            const voidActivity = await trx
              .insertInto("trackedActivity")
              .values({
                type: "Void Receipt",
                sourceDocument: "Receipt",
                sourceDocumentId: receiptId,
                sourceDocumentReadableId: receiptHeader.receiptId,
                attributes: {
                  "Purchase Order": receiptHeader.sourceDocumentId,
                  Receipt: receiptId,
                  Employee: userId
                },
                companyId,
                createdBy: userId,
                createdAt: today
              })
              .returning(["id"])
              .execute();

            const voidActivityId = voidActivity[0]!.id;

            for await (const [id, update] of Object.entries(
              trackedEntityUpdatesVoid
            )) {
              await trx
                .updateTable("trackedEntity")
                .set(update)
                .where("id", "=", id)
                .where("companyId", "=", companyId)
                .execute();

              if (voidActivityId) {
                await trx
                  .insertInto("trackedActivityInput")
                  .values({
                    trackedActivityId: voidActivityId,
                    trackedEntityId: id,
                    quantity: update.quantity ?? 0,
                    companyId,
                    createdBy: userId,
                    createdAt: today
                  })
                  .execute();
              }
            }
          }

          await trx
            .updateTable("receipt")
            .set({
              status: "Voided",
              updatedAt: today,
              updatedBy: userId
            })
            .where("id", "=", receiptId)
            .where("companyId", "=", companyId)
            .execute();
        });

        return { success: true };
      }

      if (receiptHeader.status === "Voided") {
        throw new Error("Cannot post a voided receipt");
      }

      switch (receiptHeader.sourceDocument) {
        case "Purchase Order": {
          if (!receiptHeader.sourceDocumentId)
            throw new Error("Receipt has no sourceDocumentId");

          const [purchaseOrder, purchaseOrderLines, purchaseOrderDelivery] =
            await inOrder([
              () =>
                single(db, "purchaseOrder", {
                  companyId,
                  id: receiptHeader.sourceDocumentId
                }),
              () =>
                many(db, "purchaseOrderLine", {
                  companyId,
                  purchaseOrderId: receiptHeader.sourceDocumentId
                }),
              () =>
                single(
                  db,
                  "purchaseOrderDelivery",
                  { companyId, id: receiptHeader.sourceDocumentId },
                  { columns: ["supplierShippingCost"] }
                )
            ]);
          if (purchaseOrder.error)
            throw new Error("Failed to fetch purchase order");
          if (purchaseOrderLines.error)
            throw new Error("Failed to fetch purchase order lines");
          if (purchaseOrderDelivery.error)
            throw new Error("Failed to fetch purchase order delivery");

          // supplierShippingCost is a supplier-currency amount and the order's
          // exchangeRate is foreign-units-per-base, so supplier -> base is
          // DIVIDE. It is mixed into base line costs below and becomes the
          // cost-ledger layer value, so multiplying inflated every foreign
          // receipt's capitalised cost by the rate squared. Matches
          // post-purchase-invoice (supplierShippingCost) and migration
          // 20260702061504, which fixed the same expression in the
          // purchaseOrders/purchaseInvoices views.
          const shippingCost =
            (purchaseOrderDelivery.data?.supplierShippingCost ?? 0) /
            (purchaseOrder.data?.exchangeRate || 1);

          const supplier = await single(db, "supplier", {
            id: purchaseOrder.data.supplierId,
            companyId
          });
          if (supplier.error) throw new Error("Failed to fetch supplier");

          const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
            [];
          // Cost layers created by this receipt (the receipt is the sole creator
          // of purchase layers; the invoice adjusts them later). Rows flagged
          // isInvoiceFirst carry their PO line so the flush can exclude quantity
          // already represented by a legacy invoice-created layer (documents
          // posted before receipt-created layers shipped).
          const costLedgerInserts: (Database["public"]["Tables"]["costLedger"]["Insert"] & {
            isInvoiceFirst?: boolean;
            poLineId?: string;
          })[] = [];
          // Negative receipt lines (by index) consume layers at layer cost
          // inside the transaction (calculateCOGS), and book what they
          // relieved. The PO cost is used when no layers yield a cost.
          const negativeReceiptConsumptions: {
            index: number;
            itemId: string;
            quantity: number;
          }[] = [];

          const isOutsideProcessing =
            purchaseOrder.data.purchaseOrderType === "Outside Processing";

          const processIdByJobOperationId = new Map<string, string>();
          if (isOutsideProcessing) {
            const jobOpIds = purchaseOrderLines.data
              .map((pol) => pol.jobOperationId)
              .filter((id): id is string => !!id);
            if (jobOpIds.length > 0) {
              const jobOps = await many(
                db,
                "jobOperation",
                { companyId, id: jobOpIds },
                { columns: ["id", "processId"] }
              );
              for (const op of jobOps.data ?? []) {
                if (op.processId)
                  processIdByJobOperationId.set(op.id, op.processId);
              }
            }
          }

          const receiptLinesByPurchaseOrderLineId = receiptLines.data.reduce<
            Record<string, Database["public"]["Tables"]["receiptLine"]["Row"][]>
          >((acc, receiptLine) => {
            if (receiptLine.lineId) {
              acc[receiptLine.lineId] = [
                ...(acc[receiptLine.lineId] ?? []),
                receiptLine
              ];
            }
            return acc;
          }, {});

          // Build one inspection lot per receiptLine whose item has a Receipt-usage
          // inspection plan (a document assignment). The assigned document is the
          // plan for the receipt; without one, no lot is created. Compute the
          // sampling plan snapshot from the company's chosen standard and the
          // document's default plan (or "Inspect All" when the document has none).
          const inspectionInserts: Array<Record<string, any>> = [];
          // Per-feature resolved plans, keyed by receiptLineId until the lot ids
          // exist (they are joined after the insert returns ids).
          type InspectionSamplingPlanInsert = {
            inspectionFeatureId: string;
            sampleSize: number;
            acceptanceNumber: number;
            rejectionNumber: number;
            codeLetter: string | null;
            companyId: string;
            createdBy: string;
          };
          const samplingPlanInsertsByReceiptLineId = new Map<
            string,
            Array<InspectionSamplingPlanInsert>
          >();
          for (const receiptLine of receiptLines.data ?? []) {
            if (!receiptLine.itemId) continue;

            // An item is inspected at receipt when it has a Receipt-usage
            // inspection plan (document assignment); without one, no lot.
            const assignedDocumentId =
              assignmentByItemId.get(receiptLine.itemId) ?? null;
            if (!assignedDocumentId) continue;

            const safeReceivedQuantity =
              isNaN(receiptLine.receivedQuantity as any) ||
              receiptLine.receivedQuantity == null
                ? 0
                : receiptLine.receivedQuantity;
            if (safeReceivedQuantity <= 0) continue;

            const documentDefault = assignedDocumentId
              ? (documentDefaultByDocumentId.get(assignedDocumentId) ?? null)
              : null;

            const plan = documentDefault ?? {
              type: "All",
              sampleSize: null,
              percentage: null,
              aql: null,
              inspectionLevel: "II",
              severity: "Normal"
            };

            const snapshot = resolveSamplingPlan(
              plan,
              safeReceivedQuantity,
              samplingStandard
            );

            const documentFeatures = assignedDocumentId
              ? (inspectionFeaturesByDocumentId.get(assignedDocumentId) ?? [])
              : [];
            const featurePlans = documentFeatures.map((feature) => ({
              inspectionFeatureId: feature.id,
              resolved: resolveFeatureSamplingPlan(
                feature,
                documentDefault,
                safeReceivedQuantity,
                samplingStandard
              )
            }));
            if (featurePlans.length > 0) {
              samplingPlanInsertsByReceiptLineId.set(
                receiptLine.id,
                featurePlans.map((p) => ({
                  inspectionFeatureId: p.inspectionFeatureId,
                  sampleSize: p.resolved.sampleSize,
                  acceptanceNumber: p.resolved.acceptance,
                  rejectionNumber: p.resolved.rejection,
                  codeLetter: p.resolved.codeLetter,
                  companyId,
                  createdBy: userId
                }))
              );
            }

            inspectionInserts.push({
              sourceDocument: "Receipt",
              sourceDocumentId: receiptId,
              sourceDocumentLineId: receiptLine.id,
              sourceDocumentReadableId: receiptHeader.receiptId ?? null,
              itemId: receiptLine.itemId,
              supplierId: purchaseOrder.data.supplierId ?? null,
              lotSize: safeReceivedQuantity,
              samplingStandard,
              samplingPlanType: plan.type,
              // With a document attached, the lot-level sample size is the max
              // across the per-feature plans (SAP-style); Ac/Re remain the
              // item-plan fallback numbers used by the no-document flow.
              sampleSize:
                featurePlans.length > 0
                  ? Math.max(...featurePlans.map((p) => p.resolved.sampleSize))
                  : snapshot.sampleSize,
              acceptanceNumber: snapshot.acceptance,
              rejectionNumber: snapshot.rejection,
              aql: plan.aql ?? null,
              inspectionLevel: plan.inspectionLevel ?? null,
              severity: plan.severity ?? null,
              codeLetter: snapshot.codeLetter,
              inspectionDocumentId: assignedDocumentId,
              status: "Pending",
              companyId,
              createdBy: userId
            });
          }

          // Tracked entities for items with a Receipt-usage inspection plan stay
          // On Hold after posting (they are released individually by the sample
          // inspection or en masse by lot disposition). Everything else flips to
          // Available.
          const trackedEntityUpdates =
            receiptLineTracking.data?.reduce<
              Record<
                string,
                Database["public"]["Tables"]["trackedEntity"]["Update"]
              >
            >((acc, itemTracking) => {
              const receiptLine = receiptLines.data?.find(
                (receiptLine) =>
                  receiptLine.id ===
                  (itemTracking.attributes as TrackedEntityAttributes)?.[
                    "Receipt Line"
                  ]?.toString()
              );

              const safeReceivedQuantity =
                // @ts-ignore - chillllllll
                isNaN(receiptLine?.receivedQuantity) ||
                receiptLine?.receivedQuantity == null
                  ? 0
                  : receiptLine.receivedQuantity;
              const quantity = receiptLine?.requiresSerialTracking
                ? 1
                : safeReceivedQuantity || itemTracking.quantity;

              const requiresInspection = receiptLine?.itemId
                ? assignmentByItemId.has(receiptLine.itemId)
                : false;

              acc[itemTracking.id] = {
                status: requiresInspection ? "On Hold" : "Available",
                quantity: quantity
              };

              return acc;
            }, {}) ?? {};

          const jobOperationUpdates = isOutsideProcessing
            ? purchaseOrderLines.data.reduce<
                Record<
                  string,
                  Database["public"]["Tables"]["jobOperation"]["Update"]
                >
              >((acc, purchaseOrderLine) => {
                const receiptLines =
                  receiptLinesByPurchaseOrderLineId[purchaseOrderLine.id];
                if (
                  receiptLines &&
                  receiptLines.length > 0 &&
                  purchaseOrderLine.purchaseQuantity &&
                  purchaseOrderLine.purchaseQuantity > 0 &&
                  purchaseOrderLine.jobOperationId
                ) {
                  const recivedQuantityInPurchaseUnit =
                    receiptLines.reduce((acc, receiptLine) => {
                      const safeReceivedQuantity =
                        isNaN(receiptLine.receivedQuantity) ||
                        receiptLine.receivedQuantity == null
                          ? 0
                          : receiptLine.receivedQuantity;
                      return acc + safeReceivedQuantity;
                    }, 0) / (receiptLines[0]!.conversionFactor ?? 1);

                  const receivedComplete =
                    purchaseOrderLine.receivedComplete ||
                    recivedQuantityInPurchaseUnit >=
                      (purchaseOrderLine.quantityToReceive ??
                        purchaseOrderLine.purchaseQuantity);

                  return {
                    ...acc,
                    [purchaseOrderLine.jobOperationId]: {
                      status: receivedComplete ? "Done" : "In Progress"
                    }
                  };
                }

                return acc;
              }, {})
            : {};

          const purchaseOrderLineUpdates = purchaseOrderLines.data.reduce<
            Record<
              string,
              Database["public"]["Tables"]["purchaseOrderLine"]["Update"]
            >
          >((acc, purchaseOrderLine) => {
            const receiptLines =
              receiptLinesByPurchaseOrderLineId[purchaseOrderLine.id];
            if (
              receiptLines &&
              receiptLines.length > 0 &&
              purchaseOrderLine.purchaseQuantity &&
              purchaseOrderLine.purchaseQuantity > 0
            ) {
              const recivedQuantityInPurchaseUnit =
                receiptLines.reduce((acc, receiptLine) => {
                  const safeReceivedQuantity =
                    isNaN(receiptLine.receivedQuantity) ||
                    receiptLine.receivedQuantity == null
                      ? 0
                      : receiptLine.receivedQuantity;
                  return acc + safeReceivedQuantity;
                }, 0) / (receiptLines[0]!.conversionFactor ?? 1);

              const newQuantityReceived =
                (purchaseOrderLine.quantityReceived ?? 0) +
                recivedQuantityInPurchaseUnit;

              const receivedComplete =
                purchaseOrderLine.receivedComplete ||
                recivedQuantityInPurchaseUnit >=
                  (purchaseOrderLine.quantityToReceive ??
                    purchaseOrderLine.purchaseQuantity);

              return {
                ...acc,
                [purchaseOrderLine.id]: {
                  quantityReceived: newQuantityReceived,
                  receivedComplete,
                  receivedDate: today
                }
              };
            }

            return acc;
          }, {});

          // Get account defaults (once for all lines) for the journal entries
          const accountDefaults = await getDefaultPostingGroup(db, companyId);
          if (accountDefaults.error || !accountDefaults.data) {
            throw new Error("Error getting account defaults");
          }

          // Detect invoice-first scenario: PO lines where qty invoiced > qty received
          const invoiceFirstQtyByPoLine = new Map<string, number>();
          const accrualUnitCostByPoLine = new Map<string, number>();
          const receivedBeforeInvUnitsByPoLine = new Map<string, number>();

          for (const pol of purchaseOrderLines.data) {
            const invoicedInInventoryUnit =
              (pol.quantityInvoiced ?? 0) * (pol.conversionFactor ?? 1);
            const receivedInInventoryUnit =
              (pol.quantityReceived ?? 0) * (pol.conversionFactor ?? 1);
            const invoiceFirstQty = Math.max(
              0,
              invoicedInInventoryUnit - receivedInInventoryUnit
            );
            if (invoiceFirstQty > 0) {
              invoiceFirstQtyByPoLine.set(pol.id, invoiceFirstQty);
              receivedBeforeInvUnitsByPoLine.set(
                pol.id,
                receivedInInventoryUnit
              );
            }
          }

          if (invoiceFirstQtyByPoLine.size > 0) {
            const accrualDocRefs = [...invoiceFirstQtyByPoLine.keys()].map(
              (id) => journalReference.to.purchaseInvoice(id)
            );

            const accrualJournalLines = await documentJournalLines(
              db,
              companyId,
              {
                documentLineReference: accrualDocRefs,
                accrual: true
              }
            );

            // GR/IR debit entries have non-positive amounts (debit on a
            // liability; zero-priced invoices accrue at exactly 0). Matching
            // the GR/IR account keeps the paired AP credit lines, which are
            // also 0 on zero-priced invoices, out of the quantity sum.
            const accrualCostByPoLine: Record<
              string,
              { totalCost: number; totalQty: number }
            > = {};
            for (const jl of accrualJournalLines) {
              if (
                (jl.amount ?? 0) <= 0 &&
                (jl.quantity ?? 0) > 0 &&
                jl.accountId ===
                  accountDefaults.data.goodsReceivedNotInvoicedAccount
              ) {
                const [, poLineId] = (jl.documentLineReference ?? "").split(
                  ":"
                ) as [string, string];
                if (!accrualCostByPoLine[poLineId]) {
                  accrualCostByPoLine[poLineId] = {
                    totalCost: 0,
                    totalQty: 0
                  };
                }
                accrualCostByPoLine[poLineId].totalCost += Math.abs(
                  jl.amount ?? 0
                );
                accrualCostByPoLine[poLineId].totalQty += jl.quantity ?? 0;
              }
            }

            for (const [poLineId, info] of Object.entries(
              accrualCostByPoLine
            )) {
              if (info.totalQty > 0) {
                accrualUnitCostByPoLine.set(
                  poLineId,
                  info.totalCost / info.totalQty
                );
              }
            }

            // Units invoiced before receipt with no accrual to clear stay at
            // PO cost, so GR/IR keeps the difference to the invoice's cost.
            // A service or fixed asset invoice accrues nothing on GR/IR.
            const unaccrued = [...invoiceFirstQtyByPoLine.entries()].filter(
              ([poLineId]) => {
                const lineType = purchaseOrderLines.data.find(
                  (pol) => pol.id === poLineId
                )?.purchaseOrderLineType;
                return (
                  !accrualUnitCostByPoLine.has(poLineId) &&
                  lineType !== "Service" &&
                  lineType !== "Fixed Asset" &&
                  lineType !== "G/L Account"
                );
              }
            );
            if (unaccrued.length > 0) {
              logger.warn(
                "Units invoiced before receipt have no GR/IR accrual; the receipt costs them at PO cost",
                {
                  companyId,
                  receiptId,
                  purchaseOrderLines: unaccrued.map(
                    ([purchaseOrderLineId, quantity]) => ({
                      purchaseOrderLineId,
                      quantity
                    })
                  )
                }
              );
            }
          }

          const itemById = new Map(items.data.map((item) => [item.id, item]));
          const itemPostingGroupByItem = new Map(
            itemCosts.data.map((cost) => [cost.itemId, cost.itemPostingGroupId])
          );
          const purchaseOrderLineById = new Map(
            purchaseOrderLines.data.map((line) => [line.id, line])
          );
          const receiptJournalLines: PurchaseReceiptLine[] =
            receiptLines.data.map((receiptLine) => {
              const item = receiptLine.itemId
                ? itemById.get(receiptLine.itemId)
                : undefined;
              const jobOperationId = receiptLine.lineId
                ? purchaseOrderLineById.get(receiptLine.lineId)?.jobOperationId
                : null;
              return {
                purchaseOrderLineId: receiptLine.lineId,
                itemId: receiptLine.itemId,
                quantity:
                  isNaN(receiptLine.receivedQuantity) ||
                  receiptLine.receivedQuantity == null
                    ? 0
                    : receiptLine.receivedQuantity,
                unitPrice: receiptLine.unitPrice,
                itemTrackingType: item?.itemTrackingType,
                replenishmentSystem: item?.replenishmentSystem,
                itemPostingGroupId: receiptLine.itemId
                  ? (itemPostingGroupByItem.get(receiptLine.itemId) ?? null)
                  : null,
                locationId: receiptLine.locationId ?? null,
                processId: jobOperationId
                  ? (processIdByJobOperationId.get(jobOperationId) ?? null)
                  : null
              };
            });
          // Line cost at PO price + proportional shipping. The portion of a
          // line invoiced before receipt is valued at the accrual (invoice)
          // unit cost, so the invoice's GR/IR accrual clears exactly — no
          // PPV. The remainder stays at PO cost until its invoice adjusts it.
          const receiptLineCosts = purchaseReceiptLineCosts(
            receiptJournalLines,
            {
              shippingCost,
              isOutsideProcessing,
              invoiceFirst: {
                quantity: invoiceFirstQtyByPoLine,
                unitCost: accrualUnitCostByPoLine
              }
            }
          );

          for (const [index, receiptLine] of receiptLines.data.entries()) {
            const {
              quantity: receivedQuantity,
              createsLayers,
              invoiceFirstQuantity: invoiceFirstQty,
              invoiceFirstCost: invoiceFirstPortionCost,
              normalQuantity: normalQty,
              normalCost: normalPortionCost
            } = receiptLineCosts[index]!;
            const itemTrackingType =
              receiptJournalLines[index]!.itemTrackingType ?? "Inventory";
            const isNegativeReceipt = receivedQuantity < 0;
            const poLineId = receiptLine.lineId;

            if (createsLayers && isNegativeReceipt) {
              negativeReceiptConsumptions.push({
                index,
                itemId: receiptLine.itemId!,
                quantity: Math.abs(receivedQuantity)
              });
            }

            // Cost layers: the receipt is the sole creator of purchase layers.
            // The invoice later adjusts them via appliesToCostLedgerId children.
            if (createsLayers && !isNegativeReceipt) {
              if (invoiceFirstQty > 0) {
                costLedgerInserts.push({
                  itemLedgerType: "Purchase",
                  costLedgerType: "Direct Cost",
                  adjustment: false,
                  documentType: "Purchase Receipt",
                  documentId: receiptHeader.id ?? undefined,
                  externalDocumentId:
                    receiptHeader.externalDocumentId ?? undefined,
                  itemId: receiptLine.itemId,
                  quantity: round(invoiceFirstQty),
                  nominalCost: round(
                    invoiceFirstQty * (receiptLine.unitPrice ?? 0)
                  ),
                  cost: round(invoiceFirstPortionCost),
                  remainingQuantity: round(invoiceFirstQty),
                  supplierId: purchaseOrder.data?.supplierId ?? undefined,
                  companyId,
                  postingDate: today,
                  isInvoiceFirst: true,
                  poLineId: poLineId ?? undefined
                });
              }
              if (normalQty > 0) {
                costLedgerInserts.push({
                  itemLedgerType: "Purchase",
                  costLedgerType: "Direct Cost",
                  adjustment: false,
                  documentType: "Purchase Receipt",
                  documentId: receiptHeader.id ?? undefined,
                  externalDocumentId:
                    receiptHeader.externalDocumentId ?? undefined,
                  itemId: receiptLine.itemId,
                  quantity: round(normalQty),
                  nominalCost: round(normalQty * (receiptLine.unitPrice ?? 0)),
                  cost: round(normalPortionCost),
                  remainingQuantity: round(normalQty),
                  supplierId: purchaseOrder.data?.supplierId ?? undefined,
                  companyId,
                  postingDate: today
                });
              }
            }

            if (itemTrackingType === "Inventory" && !isOutsideProcessing) {
              // For inventory entries, use the appropriate entry type based on quantity sign
              const entryType =
                receivedQuantity < 0 ? "Negative Adjmt." : "Positive Adjmt.";

              itemLedgerInserts.push({
                postingDate: today,
                itemId: receiptLine.itemId,
                quantity: round(receivedQuantity),
                locationId: receiptLine.locationId,
                storageUnitId: receiptLine.storageUnitId,
                entryType,
                documentType: "Purchase Receipt",
                documentId: receiptHeader.id ?? undefined,
                externalDocumentId:
                  receiptHeader.externalDocumentId ?? undefined,
                createdBy: userId,
                companyId
              });
            }

            if (receiptLine.requiresBatchTracking && !isOutsideProcessing) {
              const entryType =
                receivedQuantity < 0 ? "Negative Adjmt." : "Positive Adjmt.";

              itemLedgerInserts.push({
                postingDate: today,
                itemId: receiptLine.itemId,
                quantity: round(receivedQuantity),
                locationId: receiptLine.locationId,
                storageUnitId: receiptLine.storageUnitId,
                entryType,
                documentType: "Purchase Receipt",
                documentId: receiptHeader.id ?? undefined,
                trackedEntityId: receiptLineTracking.data?.find(
                  (tracking) =>
                    (
                      tracking.attributes as TrackedEntityAttributes | undefined
                    )?.["Receipt Line"] === receiptLine.id
                )?.id,
                externalDocumentId:
                  receiptHeader.externalDocumentId ?? undefined,
                createdBy: userId,
                companyId
              });
            }

            if (receiptLine.requiresSerialTracking && !isOutsideProcessing) {
              const lineTracking = receiptLineTracking.data?.filter(
                (tracking) =>
                  (
                    tracking.attributes as TrackedEntityAttributes | undefined
                  )?.["Receipt Line"] === receiptLine.id
              );

              const safeReceiptLineQuantity =
                isNaN(receiptLine.receivedQuantity) ||
                receiptLine.receivedQuantity == null
                  ? 0
                  : receiptLine.receivedQuantity;
              const absReceivedQuantity = Math.abs(safeReceiptLineQuantity);
              const entryType =
                receivedQuantity < 0 ? "Negative Adjmt." : "Positive Adjmt.";
              const quantityPerEntry = receivedQuantity < 0 ? -1 : 1;

              for (let i = 0; i < absReceivedQuantity; i++) {
                const trackingWithIndex = lineTracking?.find(
                  (tracking) =>
                    (
                      tracking.attributes as TrackedEntityAttributes | undefined
                    )?.["Receipt Line Index"] === i
                );

                itemLedgerInserts.push({
                  postingDate: today,
                  itemId: receiptLine.itemId,
                  quantity: round(quantityPerEntry),
                  locationId: receiptLine.locationId,
                  storageUnitId: receiptLine.storageUnitId,
                  entryType,
                  documentType: "Purchase Receipt",
                  documentId: receiptHeader.id ?? undefined,
                  trackedEntityId: trackingWithIndex?.id,
                  externalDocumentId:
                    receiptHeader.externalDocumentId ?? undefined,
                  createdBy: userId,
                  companyId
                });
              }
            }
          }

          // Process Fixed Asset PO lines (no receipt lines — handled directly from PO)
          const { data: receiptFaLines } = await many(
            db,
            "receiptFixedAssetLine",
            { receiptId, received: true, companyId },
            { columns: ["id", "purchaseOrderLineId", "serialNumber"] }
          );
          const poFaLines = (receiptFaLines ?? []).filter(
            (r): r is typeof r & { purchaseOrderLineId: string } =>
              r.purchaseOrderLineId !== null
          );
          const receivedFaPoLineIds = new Set(
            poFaLines.map((r) => r.purchaseOrderLineId)
          );
          const faSerialNumbers = new Map(
            poFaLines.map((r) => [r.purchaseOrderLineId, r.serialNumber])
          );
          const faReceiptLineIds = new Map<string, string>();
          for (const r of poFaLines) {
            faReceiptLineIds.set(r.purchaseOrderLineId, r.id);
          }
          // A Construction in Progress asset records every posting that adds to
          // its acquisition cost as a CIP cost row. Written inside the
          // transaction, after the journal, so it can carry the journal id.
          const cipCostInserts: Omit<
            Database["public"]["Tables"]["fixedAssetCipCost"]["Insert"],
            "journalId"
          >[] = [];

          const faPurchaseOrderLines = purchaseOrderLines.data.filter(
            (pol) =>
              pol.purchaseOrderLineType === "Fixed Asset" &&
              pol.assetId &&
              !pol.receivedComplete &&
              pol.purchaseQuantity &&
              pol.purchaseQuantity > 0 &&
              receivedFaPoLineIds.has(pol.id)
          );

          const fixedAssetJournalLines: FixedAssetReceiptLine[] = [];
          type ReceivedAsset = Pick<
            Tables["fixedAsset"]["Row"],
            | "id"
            | "status"
            | "acquisitionDate"
            | "depreciationStartDate"
            | "acquisitionCost"
            | "locationId"
            | "fixedAssetClassId"
          > & {
            fixedAssetClass: Pick<
              Tables["fixedAssetClass"]["Row"],
              "assetAccountId" | "isConstructionInProgress"
            > | null;
          };
          const faAssets: { data: ReceivedAsset[] } =
            faPurchaseOrderLines.length > 0
              ? await many<"fixedAsset", ReceivedAsset>(
                  db,
                  "fixedAsset",
                  {
                    companyId,
                    id: faPurchaseOrderLines.map((line) => line.assetId!)
                  },
                  {
                    columns: [
                      "id",
                      "status",
                      "acquisitionDate",
                      "depreciationStartDate",
                      "acquisitionCost",
                      "locationId",
                      "fixedAssetClassId"
                    ],
                    embed: {
                      fixedAssetClass: {
                        table: "fixedAssetClass",
                        via: "fixedAssetClassId",
                        columns: ["assetAccountId", "isConstructionInProgress"]
                      }
                    }
                  }
                )
              : { data: [] };
          const faAssetById = new Map(
            faAssets.data.map((asset) => [asset.id, asset])
          );

          for (const faPoLine of faPurchaseOrderLines) {
            const quantity = faPoLine.purchaseQuantity ?? 1;
            const unitPrice = faPoLine.unitPrice ?? 0;
            const cost = quantity * unitPrice;

            const asset = faAssetById.get(faPoLine.assetId!);
            if (!asset) throw new Error("Failed to fetch fixed asset");
            fixedAssetWrites.overlay(faPoLine.assetId!, asset);

            const isConstructionInProgress = Boolean(
              asset.fixedAssetClass?.isConstructionInProgress
            );

            fixedAssetJournalLines.push({
              purchaseOrderLineId: faPoLine.id,
              quantity,
              cost,
              assetAccountId: asset.fixedAssetClass!.assetAccountId,
              fixedAssetClassId: asset.fixedAssetClassId ?? null,
              locationId:
                faPoLine.locationId ??
                receiptHeader.locationId ??
                asset.locationId ??
                null
            });

            const updateData: Database["public"]["Tables"]["fixedAsset"]["Update"] =
              {
                acquisitionCost: (Number(asset.acquisitionCost) ?? 0) + cost,
                updatedBy: userId
              };
            if (!asset.acquisitionDate) {
              updateData.acquisitionDate = today;
            }
            // A CIP asset does not depreciate until it is capitalized, so its
            // depreciation start date stays null and it goes Under Construction.
            if (!isConstructionInProgress && !asset.depreciationStartDate) {
              updateData.depreciationStartDate = today;
            }
            if (asset.status === "Draft") {
              updateData.status = isConstructionInProgress
                ? "Under Construction"
                : "Active";
            }

            const serialNumber = faSerialNumbers.get(faPoLine.id!);
            if (serialNumber) {
              updateData.serialNumber = serialNumber;
            }

            const faLineLocationId =
              faPoLine.locationId ?? receiptHeader.locationId;
            if (faLineLocationId) {
              updateData.locationId = faLineLocationId;
            }

            fixedAssetWrites.patch(faPoLine.assetId!, updateData);

            if (isConstructionInProgress) {
              cipCostInserts.push({
                fixedAssetId: faPoLine.assetId!,
                sourceType: "Receipt",
                sourceDocumentId: receiptId,
                sourceDocumentLineId:
                  faReceiptLineIds.get(faPoLine.id!) ?? null,
                amount: round(cost),
                costDate: today,
                companyId,
                createdBy: userId
              });
            }

            purchaseOrderLineUpdates[faPoLine.id!] = {
              quantityReceived: faPoLine.purchaseQuantity,
              receivedComplete: true,
              receivedDate: today
            };
          }

          // A Provisional journal has no accounting period.
          const accountingPeriodId =
            postingStatus === "Posted"
              ? await getCurrentAccountingPeriod(companyId, db, today)
              : null;

          await db.transaction().execute(async (trx) => {
            await assertPostingStatusUnchanged(trx, companyId, postingStatus);
            await fixedAssetWrites.apply(trx, companyId);
            // Negative receipts: consume layers at layer cost (FIFO/LIFO with
            // adjustment children), and the journal books what was relieved so
            // the GL credit matches what actually left the subledger.
            const relievedCostByLine = new Map<number, number>();
            for (const consumption of negativeReceiptConsumptions) {
              const cogsResult = await calculateCOGS(trx, {
                itemId: consumption.itemId,
                quantity: consumption.quantity,
                companyId
              });
              // A consumed layer's total is authoritative even at zero or
              // negative (free goods, credit-adjusted layers): the GL credit
              // must match the value actually relieved from the subledger. The
              // PO-cost fallback applies only when nothing was consumed and no
              // cost basis was found.
              const consumedCost =
                cogsResult.layersConsumed.length > 0 || cogsResult.totalCost > 0
                  ? cogsResult.totalCost
                  : receiptLineCosts[consumption.index]!.cost;
              relievedCostByLine.set(consumption.index, consumedCost);
              costLedgerInserts.push({
                itemLedgerType: "Purchase",
                costLedgerType: "Direct Cost",
                adjustment: false,
                documentType: "Purchase Receipt",
                documentId: receiptHeader.id ?? undefined,
                itemId: consumption.itemId,
                quantity: round(-consumption.quantity),
                cost: round(-consumedCost),
                remainingQuantity: 0,
                supplierId: purchaseOrder.data?.supplierId ?? undefined,
                companyId,
                postingDate: today
              });
            }

            // Flush cost layers. Transition guard: invoices posted before
            // receipt-created layers shipped created their own layers, so the
            // invoice-first quantity those legacy layers already represent must
            // not create a second one. Coverage is matched to the receipt's PO
            // lines through the legacy invoices' own lines, net of quantity
            // received before this receipt (which already consumed coverage);
            // only the covered quantity is excluded — any remainder still
            // creates a layer.
            if (costLedgerInserts.length > 0) {
              const invoiceFirstRows = costLedgerInserts.filter(
                (row) => row.isInvoiceFirst && row.itemId && row.poLineId
              );
              const legacyCoverageByPoLine = new Map<string, number>();
              if (invoiceFirstRows.length > 0) {
                const invoiceFirstItemIds = [
                  ...new Set(invoiceFirstRows.map((row) => row.itemId!))
                ];
                const legacyLayers = await trx
                  .selectFrom("costLedger")
                  .select(["documentId"])
                  .where("documentType", "=", "Purchase Invoice")
                  .where("itemId", "in", invoiceFirstItemIds)
                  .where("companyId", "=", companyId)
                  .where("remainingQuantity", ">", 0)
                  // adjustment children are corrections on receipt layers, not
                  // legacy invoice-created layers — must not trip this guard
                  .where("adjustment", "=", false)
                  .where("appliesToCostLedgerId", "is", null)
                  .execute();
                const legacyInvoiceIds = [
                  ...new Set(
                    legacyLayers
                      .map((layer) => layer.documentId)
                      .filter((id): id is string => !!id)
                  )
                ];
                if (legacyInvoiceIds.length > 0) {
                  const invoiceFirstPoLineIds = [
                    ...new Set(invoiceFirstRows.map((row) => row.poLineId!))
                  ];
                  const legacyInvoiceLines = await trx
                    .selectFrom("purchaseInvoiceLine")
                    .select([
                      "purchaseOrderLineId",
                      "quantity",
                      "conversionFactor"
                    ])
                    .where("invoiceId", "in", legacyInvoiceIds)
                    .where("purchaseOrderLineId", "in", invoiceFirstPoLineIds)
                    .where("companyId", "=", companyId)
                    .execute();
                  for (const line of legacyInvoiceLines) {
                    if (!line.purchaseOrderLineId) continue;
                    legacyCoverageByPoLine.set(
                      line.purchaseOrderLineId,
                      (legacyCoverageByPoLine.get(line.purchaseOrderLineId) ??
                        0) +
                        Number(line.quantity ?? 0) *
                          Number(line.conversionFactor ?? 1)
                    );
                  }
                  // Legacy layers were created for the full invoiced quantity,
                  // and units received earlier consumed that coverage first —
                  // subtracting received-to-date leaves exactly the coverage
                  // this and future receipts may still exclude.
                  for (const [linePoId, covered] of legacyCoverageByPoLine) {
                    const receivedBefore =
                      receivedBeforeInvUnitsByPoLine.get(linePoId) ?? 0;
                    legacyCoverageByPoLine.set(
                      linePoId,
                      Math.max(0, covered - receivedBefore)
                    );
                  }
                }
              }
              const costLedgerRows: Database["public"]["Tables"]["costLedger"]["Insert"][] =
                [];
              for (const row of costLedgerInserts) {
                const {
                  isInvoiceFirst,
                  poLineId: rowPoLineId,
                  ...insertRow
                } = row;
                if (isInvoiceFirst && rowPoLineId) {
                  const coverage = legacyCoverageByPoLine.get(rowPoLineId) ?? 0;
                  const rowQty = Number(insertRow.quantity ?? 0);
                  const excludedQty = Math.min(rowQty, coverage);
                  if (excludedQty > 0) {
                    legacyCoverageByPoLine.set(
                      rowPoLineId,
                      coverage - excludedQty
                    );
                    logger.info(
                      "excluding invoice-first quantity already represented by legacy invoice-created layers",
                      {
                        itemId: insertRow.itemId,
                        purchaseOrderLineId: rowPoLineId,
                        excludedQty
                      }
                    );
                    const layerQty = rowQty - excludedQty;
                    if (layerQty <= 0) continue;
                    const scale = layerQty / rowQty;
                    insertRow.quantity = round(layerQty);
                    insertRow.cost = round(Number(insertRow.cost ?? 0) * scale);
                    insertRow.nominalCost = round(
                      Number(insertRow.nominalCost ?? 0) * scale
                    );
                    insertRow.remainingQuantity = round(layerQty);
                  }
                }
                costLedgerRows.push(insertRow);
              }
              if (costLedgerRows.length > 0) {
                await trx
                  .insertInto("costLedger")
                  .values(costLedgerRows)
                  .execute();
              }
            }

            for await (const [purchaseOrderLineId, update] of Object.entries(
              purchaseOrderLineUpdates
            )) {
              await trx
                .updateTable("purchaseOrderLine")
                .set(update)
                .where("id", "=", purchaseOrderLineId)
                .where("companyId", "=", companyId)
                .execute();
            }

            for await (const [jobOperationId, update] of Object.entries(
              jobOperationUpdates
            )) {
              await trx
                .updateTable("jobOperation")
                .set(update)
                .where("id", "=", jobOperationId)
                .where("companyId", "=", companyId)
                .execute();
            }

            const purchaseOrderLines = await trx
              .selectFrom("purchaseOrderLine")
              .select([
                "id",
                "purchaseOrderLineType",
                "invoicedComplete",
                "receivedComplete"
              ])
              .where("purchaseOrderId", "=", purchaseOrder.data.id)
              .execute();

            const areAllLinesInvoiced = purchaseOrderLines.every(
              (line) =>
                line.purchaseOrderLineType === "Comment" ||
                line.invoicedComplete
            );

            const areAllLinesReceived = purchaseOrderLines.every(
              (line) =>
                line.purchaseOrderLineType === "Comment" ||
                line.purchaseOrderLineType === "G/L Account" ||
                line.purchaseOrderLineType === "Service" ||
                line.receivedComplete
            );

            let status: Database["public"]["Tables"]["purchaseOrder"]["Row"]["status"] =
              "To Receive and Invoice";
            if (areAllLinesInvoiced && areAllLinesReceived) {
              status = "Completed";
            } else if (areAllLinesInvoiced) {
              status = "To Receive";
            } else if (areAllLinesReceived) {
              status = "To Invoice";
            }

            await trx
              .updateTable("purchaseOrder")
              .set({
                status
              })
              .where("id", "=", purchaseOrder.data.id)
              .where("companyId", "=", companyId)
              .execute();

            await trx
              .updateTable("purchaseOrderDelivery")
              .set({
                deliveryDate: today,
                locationId: receiptHeader.locationId
              })
              .where("id", "=", receiptHeader.sourceDocumentId)
              .where("companyId", "=", companyId)
              .execute();

            const journalLines = buildPurchaseReceiptJournalLines({
              documentId: receiptHeader.id,
              externalDocumentId: purchaseOrder.data.supplierReference,
              isOutsideProcessing,
              supplierId: purchaseOrder.data.supplierId,
              supplierTypeId: supplier.data.supplierTypeId ?? null,
              accounts: accountDefaults.data,
              lines: receiptJournalLines.map((line, index) => ({
                ...line,
                cost:
                  relievedCostByLine.get(index) ?? receiptLineCosts[index]!.cost
              })),
              fixedAssets: fixedAssetJournalLines
            });
            let receiptJournalId: string | null = null;
            if (journalLines.length > 0) {
              const journalEntryId = await getNextSequence(
                trx,
                "journalEntry",
                companyId
              );

              const journalResult = await trx
                .insertInto("journal")
                .values({
                  journalEntryId,
                  accountingPeriodId,
                  description: `Purchase Receipt ${receiptHeader.receiptId}`,
                  postingDate: today,
                  companyId,
                  sourceType: "Purchase Receipt",
                  status: postingStatus,
                  postedAt: datetime.timestamp(),
                  postedBy: userId,
                  createdBy: userId
                })
                .returning(["id"])
                .executeTakeFirstOrThrow();
              receiptJournalId = journalResult.id;

              const journalLineResults = await trx
                .insertInto("journalLine")
                .values(
                  journalLines.map(({ dimensions: _, ...line }) => ({
                    ...line,
                    journalId: journalResult.id,
                    companyId
                  }))
                )
                .returning(["id"])
                .execute();

              const journalLineDimensionInserts = journalLineDimensionRows({
                journalLineIds: journalLineResults.map((jl) => jl.id),
                lines: journalLines,
                dimensionIdByEntity: dimensionMap,
                companyId
              });
              if (journalLineDimensionInserts.length > 0) {
                await trx
                  .insertInto("journalLineDimension")
                  .values(journalLineDimensionInserts)
                  .execute();
              }
            }

            if (cipCostInserts.length > 0) {
              await trx
                .insertInto("fixedAssetCipCost")
                .values(
                  cipCostInserts.map((row) => ({
                    ...row,
                    journalId: receiptJournalId
                  }))
                )
                .execute();
            }

            if (itemLedgerInserts.length > 0) {
              await trx
                .insertInto("itemLedger")
                .values(itemLedgerInserts)
                .returning(["id"])
                .execute();
            }

            await trx
              .updateTable("receipt")
              .set({
                status: "Posted",
                postingDate: today,
                postedBy: userId
              })
              .where("id", "=", receiptId)
              .where("companyId", "=", companyId)
              .execute();

            if (Object.keys(trackedEntityUpdates).length > 0) {
              const trackedActivity = await trx
                .insertInto("trackedActivity")
                .values({
                  type: "Receive",
                  sourceDocument: "Receipt",
                  sourceDocumentId: receiptId,
                  sourceDocumentReadableId: receiptHeader.receiptId,
                  attributes: {
                    "Purchase Order": receiptHeader.sourceDocumentId,
                    Receipt: receiptId,
                    Employee: userId
                  },
                  companyId,
                  createdBy: userId,
                  createdAt: today
                })
                .returning(["id"])
                .execute();

              const trackedActivityId = trackedActivity[0]!.id;

              for await (const [id, update] of Object.entries(
                trackedEntityUpdates
              )) {
                await trx
                  .updateTable("trackedEntity")
                  .set(update)
                  .where("id", "=", id)
                  .where("companyId", "=", companyId)
                  .execute();

                if (trackedActivityId) {
                  await trx
                    .insertInto("trackedActivityOutput")
                    .values({
                      trackedActivityId,
                      trackedEntityId: id,
                      quantity: update.quantity ?? 0,
                      companyId,
                      createdBy: userId,
                      createdAt: today
                    })
                    .execute();
                }
              }
            }

            if (inspectionInserts.length > 0) {
              for (const row of inspectionInserts) {
                row.inspectionId = await getNextSequence(
                  trx,
                  "inspection",
                  companyId
                );
              }
              const insertedInspections = await trx
                .insertInto("inspection")
                .values(
                  inspectionInserts as Insertable<
                    KyselyDatabase["inspection"]
                  >[]
                )
                .returning(["id", "sourceDocumentLineId"])
                .execute();

              const samplingPlanInserts: Array<
                InspectionSamplingPlanInsert & { inspectionId: string }
              > = [];
              for (const inspection of insertedInspections) {
                const featureRows = inspection.sourceDocumentLineId
                  ? samplingPlanInsertsByReceiptLineId.get(
                      inspection.sourceDocumentLineId
                    )
                  : undefined;
                if (!featureRows) continue;
                for (const featureRow of featureRows) {
                  samplingPlanInserts.push({
                    ...featureRow,
                    inspectionId: inspection.id
                  });
                }
              }
              if (samplingPlanInserts.length > 0) {
                await trx
                  .insertInto("inspectionSamplingPlan")
                  .values(samplingPlanInserts)
                  .execute();
              }
            }
          });
          break;
        }
        case "Sales Return Order": {
          // Customer RMA receipt: goods re-enter inventory at the ORIGINAL
          // outbound cost when the line links a shipment (exact cost reversing),
          // at current cost for blind returns, and at ZERO when the line's
          // return reason flags inventoryValueZero. Entities re-enter On Hold —
          // disposition is the only path to Available.
          if (!receiptHeader.sourceDocumentId)
            throw new Error("Receipt has no sourceDocumentId");
          const salesReturnOrderId = receiptHeader.sourceDocumentId;

          const [salesReturnOrder, salesReturnOrderLines, itemCostDetails] =
            await inOrder([
              () =>
                single(db, "salesReturnOrder", {
                  id: salesReturnOrderId,
                  companyId
                }),
              () =>
                many<
                  "salesReturnOrderLine",
                  Tables["salesReturnOrderLine"]["Row"] & {
                    returnReason: Pick<
                      Tables["returnReason"]["Row"],
                      "inventoryValueZero"
                    > | null;
                  }
                >(
                  db,
                  "salesReturnOrderLine",
                  { salesReturnOrderId, companyId },
                  {
                    embed: {
                      returnReason: {
                        table: "returnReason",
                        via: "returnReasonId",
                        columns: ["inventoryValueZero"]
                      }
                    }
                  }
                ),
              () =>
                many(
                  db,
                  "itemCost",
                  { itemId: itemIds, companyId },
                  { columns: ["itemId", "unitCost"] }
                )
            ]);
          if (salesReturnOrder.error)
            throw new Error("Failed to fetch sales return order");
          if (salesReturnOrderLines.error)
            throw new Error("Failed to fetch sales return order lines");
          if (itemCostDetails.error)
            throw new Error("Failed to fetch item costs for cost resolution");
          // Allowlist, matching the create-side gate: a Draft RMA has never had
          // its caps validated, so it must be confirmed (To Receive) before
          // receiving.
          if (salesReturnOrder.data.status !== "To Receive") {
            throw new Error(
              `Cannot post a receipt against a return order in ${salesReturnOrder.data.status} status`
            );
          }

          const returnLineById = new Map(
            (salesReturnOrderLines.data ?? []).map((l) => [l.id, l])
          );
          const currentCostByItem = new Map(
            (itemCostDetails.data ?? []).map((c) => [
              c.itemId,
              Number(c.unitCost ?? 0)
            ])
          );

          // Original-outbound-cost resolution: the shipment's consumption rows
          // are per (shipment, item) — post-shipment aggregates across lines —
          // so resolve the shipment ids behind the linked shipment lines, then
          // average that shipment's consumption rows for the item.
          const linkedShipmentLineIds = [
            ...new Set(
              (salesReturnOrderLines.data ?? [])
                .map((l) => l.shipmentLineId)
                .filter(Boolean) as string[]
            )
          ];
          const shipmentIdByShipmentLine = new Map<string, string>();
          if (linkedShipmentLineIds.length > 0) {
            const shipmentLines = await many(
              db,
              "shipmentLine",
              { companyId, id: linkedShipmentLineIds },
              { columns: ["id", "shipmentId"] }
            );
            // A failed read must abort, not fall back: an empty map here would
            // silently book every linked line at CURRENT cost instead of the
            // original outbound cost, defeating exact-cost reversing unnoticed.
            if (shipmentLines.error)
              throw new Error(
                "Failed to resolve shipments for original-cost lookup"
              );
            for (const line of shipmentLines.data ?? []) {
              if (line.shipmentId)
                shipmentIdByShipmentLine.set(line.id, line.shipmentId);
            }
          }
          const shipmentIds = [...new Set(shipmentIdByShipmentLine.values())];
          const consumptionRowsByShipmentItem = new Map<
            string,
            { quantity: number; cost: number }[]
          >();
          if (shipmentIds.length > 0) {
            const consumptionRows = await many(
              db,
              "costLedger",
              {
                documentId: shipmentIds,
                documentType: "Sales Shipment",
                companyId,
                quantity: lt(0)
              },
              { columns: ["documentId", "itemId", "quantity", "cost"] }
            );
            if (consumptionRows.error)
              throw new Error(
                "Failed to fetch shipment cost layers for original-cost lookup"
              );
            for (const row of consumptionRows.data ?? []) {
              const key = `${row.documentId}::${row.itemId}`;
              const list = consumptionRowsByShipmentItem.get(key) ?? [];
              list.push({
                quantity: Number(row.quantity ?? 0),
                cost: Number(row.cost ?? 0)
              });
              consumptionRowsByShipmentItem.set(key, list);
            }
          }

          const accountDefaults = await getDefaultPostingGroup(db, companyId);
          if (accountDefaults.error || !accountDefaults.data) {
            throw new Error("Error getting account defaults");
          }

          // Customer type for the return-receipt journal's GL dimensions.
          const customer = await single(
            db,
            "customer",
            { id: salesReturnOrder.data.customerId, companyId },
            { columns: ["id", "customerTypeId"] }
          );
          const customerTypeId = customer.data?.customerTypeId ?? null;

          const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
            [];
          const costLedgerInserts: Database["public"]["Tables"]["costLedger"]["Insert"][] =
            [];
          const returnJournalLines: SalesReturnReceiptLine[] = [];
          const itemById = new Map(items.data.map((item) => [item.id, item]));
          const itemPostingGroupByItem = new Map(
            itemCosts.data.map((cost) => [cost.itemId, cost.itemPostingGroupId])
          );
          const returnLineUpdates: Record<
            string,
            { quantityReceived: number; updatedBy: string }
          > = {};
          const trackedEntityUpdates: Record<
            string,
            {
              status: Database["public"]["Tables"]["trackedEntity"]["Row"]["status"];
              quantity: number;
            }
          > = {};

          for (const receiptLine of receiptLines.data ?? []) {
            if (!receiptLine.itemId || !receiptLine.lineId) continue;
            const returnLine = returnLineById.get(receiptLine.lineId);
            if (!returnLine) {
              throw new Error(
                `Receipt line ${receiptLine.id} does not map to a return order line`
              );
            }

            const safeReceivedQuantity =
              isNaN(receiptLine.receivedQuantity) ||
              receiptLine.receivedQuantity == null
                ? 0
                : receiptLine.receivedQuantity;
            if (safeReceivedQuantity <= 0) continue;
            const receivedQuantity = safeReceivedQuantity;

            const item = itemById.get(receiptLine.itemId);
            const itemTrackingType = item?.itemTrackingType ?? "Inventory";

            // Cost resolution: zero-value reason -> 0; linked -> original
            // outbound cost from the shipment's consumption rows; else current.
            let unitCost: number;
            if (
              (
                returnLine.returnReason as {
                  inventoryValueZero: boolean;
                } | null
              )?.inventoryValueZero
            ) {
              unitCost = 0;
            } else if (
              returnLine.shipmentLineId &&
              shipmentIdByShipmentLine.has(returnLine.shipmentLineId)
            ) {
              const shipmentId = shipmentIdByShipmentLine.get(
                returnLine.shipmentLineId
              )!;
              const rows =
                consumptionRowsByShipmentItem.get(
                  `${shipmentId}::${receiptLine.itemId}`
                ) ?? [];
              // Falls back to current cost only when the resolved shipment
              // genuinely has no usable consumption rows for the item (empty,
              // zero-quantity, or NaN — resolveReturnUnitCost returns null).
              // Read failures throw above rather than reaching this fallback.
              unitCost =
                resolveReturnUnitCost(rows) ??
                currentCostByItem.get(receiptLine.itemId) ??
                0;
            } else {
              unitCost = currentCostByItem.get(receiptLine.itemId) ?? 0;
            }

            const cost = receivedQuantity * unitCost;
            const createsLayers =
              itemTrackingType !== "Non-Inventory" &&
              !!receiptLine.itemId &&
              receivedQuantity > 0;

            // itemLedger — mirrors the Purchase Order branch's three sites,
            // with the Sales Return Receipt document identity.
            if (itemTrackingType === "Inventory") {
              itemLedgerInserts.push({
                postingDate: today,
                itemId: receiptLine.itemId,
                quantity: round(receivedQuantity),
                locationId: receiptLine.locationId,
                storageUnitId: receiptLine.storageUnitId,
                entryType: "Positive Adjmt.",
                documentType: "Sales Return Receipt",
                documentId: receiptHeader.id ?? undefined,
                externalDocumentId:
                  receiptHeader.externalDocumentId ?? undefined,
                createdBy: userId,
                companyId
              });
            }

            if (receiptLine.requiresBatchTracking) {
              const entity = receiptLineTracking.data?.find(
                (tracking) =>
                  (
                    tracking.attributes as TrackedEntityAttributes | undefined
                  )?.["Receipt Line"] === receiptLine.id
              );
              itemLedgerInserts.push({
                postingDate: today,
                itemId: receiptLine.itemId,
                quantity: round(receivedQuantity),
                locationId: receiptLine.locationId,
                storageUnitId: receiptLine.storageUnitId,
                entryType: "Positive Adjmt.",
                documentType: "Sales Return Receipt",
                documentId: receiptHeader.id ?? undefined,
                trackedEntityId: entity?.id,
                externalDocumentId:
                  receiptHeader.externalDocumentId ?? undefined,
                createdBy: userId,
                companyId
              });
              if (entity) {
                trackedEntityUpdates[entity.id] = {
                  status: "On Hold",
                  quantity: receivedQuantity
                };
              }
            }

            if (receiptLine.requiresSerialTracking) {
              const lineTracking = receiptLineTracking.data?.filter(
                (tracking) =>
                  (
                    tracking.attributes as TrackedEntityAttributes | undefined
                  )?.["Receipt Line"] === receiptLine.id
              );
              for (let i = 0; i < receivedQuantity; i++) {
                const trackingWithIndex = lineTracking?.find(
                  (tracking) =>
                    (
                      tracking.attributes as TrackedEntityAttributes | undefined
                    )?.["Receipt Line Index"] === i
                );
                itemLedgerInserts.push({
                  postingDate: today,
                  itemId: receiptLine.itemId,
                  quantity: 1,
                  locationId: receiptLine.locationId,
                  storageUnitId: receiptLine.storageUnitId,
                  entryType: "Positive Adjmt.",
                  documentType: "Sales Return Receipt",
                  documentId: receiptHeader.id ?? undefined,
                  trackedEntityId: trackingWithIndex?.id,
                  externalDocumentId:
                    receiptHeader.externalDocumentId ?? undefined,
                  createdBy: userId,
                  companyId
                });
                if (trackingWithIndex) {
                  trackedEntityUpdates[trackingWithIndex.id] = {
                    status: "On Hold",
                    quantity: 1
                  };
                }
              }
            }

            // Cost layer: consumable re-entry at the resolved cost. A
            // zero-value reason still creates the (0-cost) layer so FIFO
            // consumption stays quantity-consistent.
            if (createsLayers) {
              costLedgerInserts.push({
                itemLedgerType: "Sale",
                costLedgerType: "Direct Cost",
                adjustment: false,
                documentType: "Sales Return Receipt",
                documentId: receiptHeader.id ?? undefined,
                externalDocumentId:
                  receiptHeader.externalDocumentId ?? undefined,
                itemId: receiptLine.itemId,
                quantity: round(receivedQuantity),
                nominalCost: round(cost),
                cost: round(cost),
                remainingQuantity: round(receivedQuantity),
                companyId,
                postingDate: today
              });
            }

            // Journal: Dr Inventory / Cr COGS at the re-entry value. Zero-value
            // re-entries post no journal.
            returnJournalLines.push({
              returnLineId: receiptLine.lineId,
              itemId: receiptLine.itemId,
              quantity: receivedQuantity,
              cost,
              replenishmentSystem: item?.replenishmentSystem,
              itemPostingGroupId:
                itemPostingGroupByItem.get(receiptLine.itemId) ?? null,
              locationId: receiptLine.locationId
            });

            const existingUpdate = returnLineUpdates[returnLine.id];
            returnLineUpdates[returnLine.id] = {
              quantityReceived:
                (existingUpdate?.quantityReceived ??
                  Number(returnLine.quantityReceived ?? 0)) + receivedQuantity,
              updatedBy: userId
            };
          }

          const journalLines = buildSalesReturnReceiptJournalLines({
            documentId: receiptHeader.id,
            externalDocumentId: receiptHeader.externalDocumentId,
            customerId: salesReturnOrder.data.customerId,
            customerTypeId,
            accounts: accountDefaults.data,
            lines: returnJournalLines
          });

          // A Provisional journal has no accounting period.
          const accountingPeriodId =
            postingStatus === "Posted" && journalLines.length > 0
              ? await getCurrentAccountingPeriod(companyId, db, today)
              : null;

          await db.transaction().execute(async (trx) => {
            await assertPostingStatusUnchanged(trx, companyId, postingStatus);
            // Double-post guard: serialize on the receipt row — a second
            // concurrent post waits here, then sees Posted and aborts, so
            // ledger rows, journals, and quantityReceived can never double.
            const lockedReceipt = await trx
              .selectFrom("receipt")
              .select(["status"])
              .where("id", "=", receiptId)
              .forUpdate()
              .executeTakeFirstOrThrow();
            if (
              lockedReceipt.status === "Posted" ||
              lockedReceipt.status === "Voided"
            ) {
              throw new Error(`Receipt is already ${lockedReceipt.status}`);
            }

            // cancelSalesReturnOrder locks this same order row — re-check the
            // status under the lock so a cancel committed after our
            // pre-transaction read cannot be posted over (which would leave a
            // Cancelled order with received stock and a freed cap).
            const lockedOrder = await trx
              .selectFrom("salesReturnOrder")
              .select(["status"])
              .where("id", "=", salesReturnOrderId)
              .forUpdate()
              .executeTakeFirstOrThrow();
            if (lockedOrder.status !== "To Receive") {
              throw new Error(
                `Cannot post a receipt against a return order in ${lockedOrder.status} status`
              );
            }

            if (costLedgerInserts.length > 0) {
              await trx
                .insertInto("costLedger")
                .values(costLedgerInserts)
                .execute();
            }

            for await (const [lineId, update] of Object.entries(
              returnLineUpdates
            )) {
              await trx
                .updateTable("salesReturnOrderLine")
                .set(update)
                .where("id", "=", lineId)
                .where("companyId", "=", companyId)
                .execute();
            }

            // Derived status (mirrors getSalesReturnOrderStatus): the RMA is
            // Completed once every line has received its authorized quantity or
            // been short-closed, otherwise it stays To Receive.
            const allLines = await trx
              .selectFrom("salesReturnOrderLine")
              .select(["quantity", "quantityReceived", "closedComplete"])
              .where("salesReturnOrderId", "=", salesReturnOrderId)
              .execute();
            const allReceived =
              allLines.length > 0 &&
              allLines.every(
                (l) =>
                  l.closedComplete ||
                  Number(l.quantityReceived) >= Number(l.quantity)
              );
            const returnStatus = allReceived
              ? ("Completed" as const)
              : ("To Receive" as const);
            await trx
              .updateTable("salesReturnOrder")
              .set({ status: returnStatus, updatedBy: userId })
              .where("id", "=", salesReturnOrderId)
              .where("companyId", "=", companyId)
              .execute();

            if (journalLines.length > 0) {
              const journalEntryId = await getNextSequence(
                trx,
                "journalEntry",
                companyId
              );

              const journalResult = await trx
                .insertInto("journal")
                .values({
                  journalEntryId,
                  accountingPeriodId,
                  description: `Sales Return Receipt ${receiptHeader.receiptId}`,
                  postingDate: today,
                  companyId,
                  sourceType: "Sales Return Receipt",
                  status: postingStatus,
                  postedAt: datetime.timestamp(),
                  postedBy: userId,
                  createdBy: userId
                })
                .returning(["id"])
                .executeTakeFirstOrThrow();

              const journalLineResults = await trx
                .insertInto("journalLine")
                .values(
                  journalLines.map(({ dimensions: _, ...line }) => ({
                    ...line,
                    journalId: journalResult.id,
                    companyId
                  }))
                )
                .returning(["id"])
                .execute();

              const journalLineDimensionInserts = journalLineDimensionRows({
                journalLineIds: journalLineResults.map((jl) => jl.id),
                lines: journalLines,
                dimensionIdByEntity: dimensionMap,
                companyId
              });
              if (journalLineDimensionInserts.length > 0) {
                await trx
                  .insertInto("journalLineDimension")
                  .values(journalLineDimensionInserts)
                  .execute();
              }
            }

            if (itemLedgerInserts.length > 0) {
              await trx
                .insertInto("itemLedger")
                .values(itemLedgerInserts)
                .execute();
            }

            await trx
              .updateTable("receipt")
              .set({
                status: "Posted",
                postingDate: today,
                postedBy: userId
              })
              .where("id", "=", receiptId)
              .where("companyId", "=", companyId)
              .execute();

            if (Object.keys(trackedEntityUpdates).length > 0) {
              const trackedActivity = await trx
                .insertInto("trackedActivity")
                .values({
                  type: "Return Receipt",
                  sourceDocument: "Receipt",
                  sourceDocumentId: receiptId,
                  sourceDocumentReadableId: receiptHeader.receiptId,
                  attributes: {
                    "Sales Return Order": salesReturnOrderId,
                    Receipt: receiptId,
                    Employee: userId
                  },
                  companyId,
                  createdBy: userId,
                  createdAt: today
                })
                .returning(["id"])
                .execute();

              const trackedActivityId = trackedActivity[0]!.id;

              for await (const [id, update] of Object.entries(
                trackedEntityUpdates
              )) {
                await trx
                  .updateTable("trackedEntity")
                  .set(update)
                  .where("id", "=", id)
                  .where("companyId", "=", companyId)
                  .execute();

                if (trackedActivityId) {
                  await trx
                    .insertInto("trackedActivityOutput")
                    .values({
                      trackedActivityId,
                      trackedEntityId: id,
                      quantity: update.quantity ?? 0,
                      companyId,
                      createdBy: userId,
                      createdAt: today
                    })
                    .execute();
                }
              }
            }
          });
          break;
        }
        case "Inbound Transfer": {
          if (!receiptHeader.sourceDocumentId)
            throw new Error("Receipt has no sourceDocumentId");

          const [warehouseTransfer, warehouseTransferLines] = await inOrder([
            () =>
              single(db, "warehouseTransfer", {
                id: receiptHeader.sourceDocumentId,
                companyId
              }),
            () =>
              many(db, "warehouseTransferLine", {
                transferId: receiptHeader.sourceDocumentId,
                companyId
              })
          ]);

          if (warehouseTransfer.error)
            throw new Error("Failed to fetch warehouse transfer");
          if (warehouseTransferLines.error)
            throw new Error("Failed to fetch warehouse transfer lines");

          // Get item costs for valuation
          const transferItemIds = warehouseTransferLines.data
            .map((line) => line.itemId)
            .filter(Boolean) as string[];
          const [itemCosts, transferItems] = await inOrder([
            () =>
              many(
                db,
                "itemCost",
                { itemId: transferItemIds, companyId },
                { columns: ["itemId", "itemPostingGroupId", "unitCost"] }
              ),
            () =>
              many(
                db,
                "item",
                { id: transferItemIds, companyId },
                { columns: ["id", "replenishmentSystem"] }
              )
          ]);

          if (itemCosts.error) {
            throw new Error("Failed to fetch item costs");
          }
          if (transferItems.error) {
            throw new Error("Failed to fetch items");
          }

          const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
            [];
          const journalLineInserts: Omit<
            Database["public"]["Tables"]["journalLine"]["Insert"],
            "journalId"
          >[] = [];
          const journalLineDimensionsMeta: {
            itemPostingGroupId: string | null;
            itemId: string | null;
            locationId: string | null;
            fixedAssetClassId: string | null;
          }[] = [];
          const warehouseTransferLineUpdates: Record<
            string,
            Database["public"]["Tables"]["warehouseTransferLine"]["Update"]
          > = {};

          // Get account defaults (once for all lines) for the journal entries
          const accountDefaults = await getDefaultPostingGroup(db, companyId);
          if (accountDefaults.error || !accountDefaults.data) {
            throw new Error("Error getting account defaults");
          }

          // Process each receipt line
          for await (const receiptLine of receiptLines.data) {
            const jlStartIdx = journalLineInserts.length;

            const warehouseTransferLine = warehouseTransferLines.data.find(
              (line) => line.id === receiptLine.lineId
            );

            if (!warehouseTransferLine) continue;

            const receivedQuantity =
              isNaN(receiptLine.receivedQuantity) ||
              receiptLine.receivedQuantity == null
                ? 0
                : receiptLine.receivedQuantity;
            if (receivedQuantity === 0) continue;

            // Update warehouse transfer line received quantity
            const newReceivedQuantity =
              (warehouseTransferLine.receivedQuantity ?? 0) + receivedQuantity;

            warehouseTransferLineUpdates[warehouseTransferLine.id] = {
              receivedQuantity: newReceivedQuantity
            };

            // Get item cost for this item
            const itemCost = itemCosts.data?.find(
              (cost) => cost.itemId === receiptLine.itemId
            );
            const unitCost = itemCost?.unitCost ?? 0;
            const totalValue = Math.abs(receivedQuantity) * unitCost;

            // Create item ledger entry for positive adjustment at destination
            itemLedgerInserts.push({
              postingDate: today,
              itemId: receiptLine.itemId,
              quantity: receivedQuantity,
              locationId: receiptLine.locationId,
              storageUnitId: receiptLine.storageUnitId,
              entryType: "Transfer",
              documentType: "Transfer Receipt",
              documentId: warehouseTransfer.data?.transferId,
              externalDocumentId: receiptHeader.externalDocumentId ?? undefined,
              createdBy: userId,
              companyId
            });

            // Create journal entries for inventory movement if there's value
            if (totalValue > 0) {
              const journalLineReference = nanoid();
              // Same account on both sides: a transfer moves stock between
              // locations, not between inventory classes.
              const inventoryAccount = resolveInventoryAccount(
                transferItems.data.find(
                  (item: { id: string }) => item.id === receiptLine.itemId
                )?.replenishmentSystem ?? null,
                accountDefaults.data
              );

              journalLineInserts.push({
                accountId: inventoryAccount.account,
                description: `Transfer Out - ${warehouseTransfer.data?.transferId}`,
                amount: round(credit("asset", totalValue)),
                quantity: round(Math.abs(receivedQuantity)),
                documentType: "Receipt",
                documentId: receiptHeader.id,
                externalDocumentId: warehouseTransfer.data?.transferId,
                documentLineReference: `transfer-receipt:${receiptLine.lineId}`,
                journalLineReference,
                companyId
              });

              journalLineInserts.push({
                accountId: inventoryAccount.account,
                description: `Transfer In - ${warehouseTransfer.data?.transferId}`,
                amount: round(debit("asset", totalValue)),
                quantity: round(Math.abs(receivedQuantity)),
                documentType: "Receipt",
                documentId: receiptHeader.id,
                externalDocumentId: warehouseTransfer.data?.transferId,
                documentLineReference: `transfer-receipt:${receiptLine.lineId}`,
                journalLineReference,
                companyId
              });
            }

            // Track dimensions for this receipt line's journal lines
            const jlCount = journalLineInserts.length - jlStartIdx;
            for (let i = 0; i < jlCount; i++) {
              journalLineDimensionsMeta.push({
                itemPostingGroupId: itemCost?.itemPostingGroupId ?? null,
                itemId: receiptLine.itemId ?? null,
                locationId: receiptLine.locationId ?? null,
                fixedAssetClassId: null
              });
            }
          }

          // Check if all lines are fully received
          const allLinesFullyReceived = warehouseTransferLines.data.every(
            (line) => {
              const updates = warehouseTransferLineUpdates[line.id];
              const receivedQty =
                updates?.receivedQuantity ?? line.receivedQuantity ?? 0;
              return receivedQty >= (line.quantity ?? 0);
            }
          );

          // Check if all lines are fully shipped
          const allLinesFullyShipped = warehouseTransferLines.data.every(
            (line) => {
              const shippedQty = line.shippedQuantity ?? 0;
              return shippedQty >= (line.quantity ?? 0);
            }
          );

          // Determine new warehouse transfer status
          let newStatus: Database["public"]["Tables"]["warehouseTransfer"]["Row"]["status"] =
            warehouseTransfer.data.status;

          if (allLinesFullyReceived && allLinesFullyShipped) {
            newStatus = "Completed";
          } else if (allLinesFullyReceived && !allLinesFullyShipped) {
            newStatus = "To Ship";
          } else if (!allLinesFullyReceived && allLinesFullyShipped) {
            newStatus = "To Receive";
          }

          // A Provisional journal has no accounting period.
          const accountingPeriodId =
            postingStatus === "Posted"
              ? await getCurrentAccountingPeriod(companyId, db, today)
              : null;

          await db.transaction().execute(async (trx) => {
            await assertPostingStatusUnchanged(trx, companyId, postingStatus);
            // Update warehouse transfer lines
            for await (const [lineId, update] of Object.entries(
              warehouseTransferLineUpdates
            )) {
              await trx
                .updateTable("warehouseTransferLine")
                .set(update)
                .where("id", "=", lineId)
                .where("companyId", "=", companyId)
                .execute();
            }

            // Update warehouse transfer status
            await trx
              .updateTable("warehouseTransfer")
              .set({
                status: newStatus,
                updatedBy: userId
              })
              .where("id", "=", warehouseTransfer.data.id)
              .where("companyId", "=", companyId)
              .execute();

            // Create journal entries if there are any
            if (journalLineInserts.length > 0) {
              const transferJournalEntryId = await getNextSequence(
                trx,
                "journalEntry",
                companyId
              );

              const transferJournalResult = await trx
                .insertInto("journal")
                .values({
                  journalEntryId: transferJournalEntryId,
                  accountingPeriodId,
                  description: `Transfer Receipt ${receiptHeader.receiptId}`,
                  postingDate: today,
                  companyId,
                  sourceType: "Transfer Receipt",
                  status: postingStatus,
                  postedAt: datetime.timestamp(),
                  postedBy: userId,
                  createdBy: userId
                })
                .returning(["id"])
                .executeTakeFirstOrThrow();

              const journalLineResults = await trx
                .insertInto("journalLine")
                .values(
                  journalLineInserts.map((line) => ({
                    ...line,
                    journalId: transferJournalResult.id
                  }))
                )
                .returning(["id"])
                .execute();

              // Insert automatic dimensions for transfer journal lines
              if (dimensionMap.size > 0) {
                const journalLineDimensionInserts: {
                  journalLineId: string;
                  dimensionId: string;
                  valueId: string;
                  companyId: string;
                }[] = [];

                journalLineResults.forEach((jl, index) => {
                  const meta = journalLineDimensionsMeta[index];
                  if (!meta) return;

                  if (
                    meta.itemPostingGroupId &&
                    dimensionMap.has("ItemPostingGroup")
                  ) {
                    journalLineDimensionInserts.push({
                      journalLineId: jl.id,
                      dimensionId: dimensionMap.get("ItemPostingGroup")!,
                      valueId: meta.itemPostingGroupId,
                      companyId
                    });
                  }
                  if (meta.itemId && dimensionMap.has("Item")) {
                    journalLineDimensionInserts.push({
                      journalLineId: jl.id,
                      dimensionId: dimensionMap.get("Item")!,
                      valueId: meta.itemId,
                      companyId
                    });
                  }
                  if (meta.locationId && dimensionMap.has("Location")) {
                    journalLineDimensionInserts.push({
                      journalLineId: jl.id,
                      dimensionId: dimensionMap.get("Location")!,
                      valueId: meta.locationId,
                      companyId
                    });
                  }
                  if (
                    meta.fixedAssetClassId &&
                    dimensionMap.has("FixedAssetClass")
                  ) {
                    journalLineDimensionInserts.push({
                      journalLineId: jl.id,
                      dimensionId: dimensionMap.get("FixedAssetClass")!,
                      valueId: meta.fixedAssetClassId,
                      companyId
                    });
                  }
                });

                if (journalLineDimensionInserts.length > 0) {
                  await trx
                    .insertInto("journalLineDimension")
                    .values(journalLineDimensionInserts)
                    .execute();
                }
              }
            }

            // Create item ledger entries
            if (itemLedgerInserts.length > 0) {
              await trx
                .insertInto("itemLedger")
                .values(itemLedgerInserts)
                .returning(["id"])
                .execute();
            }

            // Update receipt status
            await trx
              .updateTable("receipt")
              .set({
                status: "Posted",
                postingDate: today,
                postedBy: userId
              })
              .where("id", "=", receiptId)
              .where("companyId", "=", companyId)
              .execute();
          });

          break;
        }
        case "Rental Agreement": {
          await postRentalReceipt(db, {
            receiptId,
            companyId,
            userId,
            today,
            postingDate
          });
          break;
        }
        default: {
          break;
        }
      }

      return { success: true };
    } catch (err) {
      // A failed VOID leaves the receipt Posted: its rows still stand.
      if (type !== "void") {
        await updateRows(
          db,
          "receipt",
          { status: "Draft" },
          { id: receiptId, companyId }
        );
      }
      throw err;
    }
  }
});

export default postReceipt;
