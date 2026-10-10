// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  type Database,
  getCompanyTimeZone,
  journalReference
} from "@carbon/database";
import { DOCUMENT_JOURNAL_STATUSES } from "@carbon/database/accounting-posting";
import {
  assertPostingStatusUnchanged,
  journalPostingStatus,
  resolveDefaultAccount
} from "@carbon/database/journal-posting-status";
import {
  inOrder,
  many,
  maybeSingle,
  selectRows,
  single,
  type Tables,
  updateRows
} from "@carbon/database/rows";
import { getNextSequence } from "@carbon/database/sequence";
import { getLogger } from "@carbon/logger";
import {
  calculateDueDate,
  classifyIntercompanyPostingLines,
  datetime,
  getBillableQuantity,
  getRemainingQuantityToInvoice,
  round
} from "@carbon/utils";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { NotFoundError } from "../errors";
import {
  PURCHASE_INVOICE_VOID_BEFORE_CUTOVER_ERROR,
  refuseVoidBeforeCutover
} from "../lib/cutover-void";
import { documentJournalLines } from "../lib/document-journal-lines";
import { FixedAssetWrites } from "../lib/fixed-asset-writes";
import { getCurrentAccountingPeriod } from "../lib/get-accounting-period";
import { getDefaultPostingGroup } from "../lib/get-posting-group";
import { journalLineDimensionRows } from "../lib/journal-line-dimensions";
import { assertPostable } from "../lib/postable";
import {
  buildPurchaseInvoicePostingLines,
  isItemLineType,
  type PurchaseInvoiceItem,
  type PurchaseInvoicePostingLine,
  usesReceiptLayers
} from "./posting-lines";
import {
  calculatePurchasePostingAmounts,
  getInvoicedPurchaseQuantityAfterVoid
} from "./purchase-posting-amounts";

const logger = getLogger("server-functions", "post-purchase-invoice");

type JournalLineRow = Database["public"]["Tables"]["journalLine"]["Row"];

/** A PO line's receipts as its receipt journals record them: consecutive
 *  lines of one journal and accrual flag are one receipt, costed by its first
 *  line. */
function receiptGroups(
  receiptLines: JournalLineRow[]
): { quantity: number; cost: number }[] {
  const groups: { quantity: number; cost: number }[] = [];
  let previous: JournalLineRow | undefined;
  for (const line of receiptLines) {
    if (
      !previous ||
      line.journalId !== previous.journalId ||
      line.accrual !== previous.accrual
    ) {
      groups.push({
        quantity: line.quantity,
        cost: Math.abs(line.amount ?? 0)
      });
    }
    previous = line;
  }
  return groups;
}

/** What the receipts of a fixed asset's PO line booked: its acquisition
 *  debits, else its GR/IR credits. */
function fixedAssetReceiptCost(receiptLines: JournalLineRow[]): number {
  let receiptCost = 0;
  for (const entry of receiptLines) {
    if (
      (entry.amount ?? 0) > 0 &&
      entry.description === "Fixed Asset Acquisition"
    ) {
      receiptCost += Math.abs(entry.amount ?? 0);
    }
  }
  if (receiptCost === 0) {
    for (const entry of receiptLines) {
      if (
        (entry.amount ?? 0) < 0 &&
        entry.description === "Goods Received Not Invoiced"
      ) {
        receiptCost += Math.abs(entry.amount ?? 0);
      }
    }
  }
  return receiptCost;
}

export const postPurchaseInvoiceInput = z.object({
  type: z.enum(["post", "void"]).default("post"),
  invoiceId: z.string(),
  skipReceiptPost: z.boolean().optional()
});

/** Posts or voids a purchase invoice: receipts, cost, ledger and journal rows. */
const postPurchaseInvoice = defineServerFn({
  name: "post-purchase-invoice",
  input: postPurchaseInvoiceInput,
  permissions: { update: "invoicing" },
  async run(ctx, { type, invoiceId, skipReceiptPost }) {
    const { db, companyId, userId } = ctx;

    logger.info({ type, invoiceId, userId, skipReceiptPost });
    const fixedAssetWrites = new FixedAssetWrites();
    if (type === "post")
      await assertPostable(db, "purchaseInvoice", invoiceId, companyId);
    try {
      const today = datetime
        .today(await getCompanyTimeZone(db, companyId))
        .toString();

      // Every invoice posts a journal: Provisional before the company's
      // accounting cutover, Posted after it. Read here to decide whether to
      // resolve a period, and again inside each transaction, where FOR SHARE
      // holds the status until commit.
      const postingStatus = await journalPostingStatus(db, companyId);

      if (type === "void") {
        // The client is service-role: authorization proved the caller may
        // act in companyId, not that invoiceId belongs to it.
        const invoice = await maybeSingle(db, "purchaseInvoice", {
          id: invoiceId,
          companyId
        });
        if (invoice.error) throw new Error("Failed to fetch purchaseInvoice");
        if (!invoice.data)
          throw new NotFoundError("Purchase invoice not found");

        if (!invoice.data.postingDate) {
          throw new Error("Can only void posted purchase invoices");
        }

        if (invoice.data.status === "Voided") {
          throw new Error("Purchase invoice is already voided");
        }

        // The enable superseded this invoice's journal and opened its
        // payable in the opening journal.
        await refuseVoidBeforeCutover(
          db,
          companyId,
          invoice.data.postingDate,
          PURCHASE_INVOICE_VOID_BEFORE_CUTOVER_ERROR
        );

        if (
          invoice.data.status === "Paid" ||
          invoice.data.status === "Partially Paid"
        ) {
          throw new Error(
            "Cannot void a purchase invoice with payments applied. Reverse the payment first."
          );
        }

        const [originalItemLedger, originalJournalLines, originalCostLedger] =
          await inOrder([
            () => many(db, "itemLedger", { documentId: invoiceId, companyId }),
            () =>
              documentJournalLines(db, companyId, {
                documentId: invoiceId,
                documentType: "Invoice"
              }),
            () =>
              many(db, "costLedger", {
                documentId: invoiceId,
                documentType: ["Purchase Invoice", "Purchase Receipt"],
                companyId
              })
          ]);

        if (originalItemLedger.error)
          throw new Error("Failed to fetch item ledger entries");
        if (originalCostLedger.error)
          throw new Error("Failed to fetch cost ledger entries");

        const invoiceLinesVoid = await many(db, "purchaseInvoiceLine", {
          invoiceId
        });
        if (invoiceLinesVoid.error)
          throw new Error("Failed to fetch purchase invoice lines");

        // A Fixed Asset line that posted into Construction in Progress wrote a
        // CIP cost row; voiding removes those rows and takes their amount back
        // off the asset. A capitalized asset must be reversed first. Assets on a
        // depreciating class keep the existing behaviour (no asset write).
        const faAssetIdsVoid: string[] = [];
        for (const line of invoiceLinesVoid.data) {
          if (
            line.invoiceLineType === "Fixed Asset" &&
            line.assetId &&
            !faAssetIdsVoid.includes(line.assetId)
          ) {
            faAssetIdsVoid.push(line.assetId);
          }
        }
        const cipAssetUpdatesVoid = new Map<string, number>();
        if (faAssetIdsVoid.length > 0) {
          const [cipCostRowsVoid, faRecordsVoid] = await inOrder([
            () =>
              many(
                db,
                "fixedAssetCipCost",
                { companyId, sourceDocumentId: invoiceId },
                { columns: ["fixedAssetId", "amount"] }
              ),
            () =>
              many<
                "fixedAsset",
                Pick<
                  Tables["fixedAsset"]["Row"],
                  "id" | "status" | "acquisitionCost"
                > & {
                  fixedAssetClass: Pick<
                    Tables["fixedAssetClass"]["Row"],
                    "isConstructionInProgress"
                  > | null;
                }
              >(
                db,
                "fixedAsset",
                { companyId, id: faAssetIdsVoid },
                {
                  columns: ["id", "status", "acquisitionCost"],
                  embed: {
                    fixedAssetClass: {
                      table: "fixedAssetClass",
                      via: "fixedAssetClassId",
                      columns: ["isConstructionInProgress"]
                    }
                  }
                }
              )
          ]);
          if (cipCostRowsVoid.error)
            throw new Error("Failed to fetch fixed asset CIP costs");
          if (faRecordsVoid.error)
            throw new Error("Failed to fetch fixed assets");

          const cipCostByAssetVoid = new Map<string, number>();
          for (const row of cipCostRowsVoid.data) {
            cipCostByAssetVoid.set(
              row.fixedAssetId,
              (cipCostByAssetVoid.get(row.fixedAssetId) ?? 0) +
                Number(row.amount)
            );
          }

          for (const asset of faRecordsVoid.data) {
            const isConstructionInProgress =
              cipCostByAssetVoid.has(asset.id) ||
              Boolean((asset.fixedAssetClass as any)?.isConstructionInProgress);
            if (!isConstructionInProgress) continue;
            if (asset.status !== "Under Construction") {
              throw new Error(
                "Asset was capitalized; reverse the capitalization first"
              );
            }
            // Every acquisitionCost change this invoice made to a CIP asset
            // wrote a CIP cost row (the direct line's cost, a receipt-backed
            // line's variance), so no row means it changed nothing to undo:
            // a receipt-backed line whose variance was within a cent.
            const cipCost = cipCostByAssetVoid.get(asset.id);
            if (cipCost !== undefined) {
              cipAssetUpdatesVoid.set(
                asset.id,
                Math.max(0, round(Number(asset.acquisitionCost) - cipCost))
              );
            }
          }
        }

        const purchaseOrderLineIdsVoid = invoiceLinesVoid.data.reduce<string[]>(
          (acc, invoiceLine) => {
            if (
              invoiceLine.purchaseOrderLineId &&
              !acc.includes(invoiceLine.purchaseOrderLineId)
            ) {
              acc.push(invoiceLine.purchaseOrderLineId);
            }
            return acc;
          },
          []
        );

        const affectedPurchaseOrderIdsVoid: string[] = [];

        if (purchaseOrderLineIdsVoid.length > 0) {
          const touchedLines = await many(
            db,
            "purchaseOrderLine",
            { companyId, id: purchaseOrderLineIdsVoid },
            { columns: ["purchaseOrderId"] }
          );
          if (touchedLines.error)
            throw new Error("Failed to fetch purchase order lines");
          for (const { purchaseOrderId } of touchedLines.data) {
            if (
              purchaseOrderId &&
              !affectedPurchaseOrderIdsVoid.includes(purchaseOrderId)
            ) {
              affectedPurchaseOrderIdsVoid.push(purchaseOrderId);
            }
          }
        }

        const purchaseOrderLinesVoid =
          affectedPurchaseOrderIdsVoid.length > 0
            ? await many(db, "purchaseOrderLine", {
                purchaseOrderId: affectedPurchaseOrderIdsVoid
              })
            : {
                data: [] as Database["public"]["Tables"]["purchaseOrderLine"]["Row"][],
                error: null
              };

        if (purchaseOrderLinesVoid.error)
          throw new Error("Failed to fetch purchase order lines");

        const purchaseOrderLinesByIdVoid = purchaseOrderLinesVoid.data.reduce<
          Record<
            string,
            Database["public"]["Tables"]["purchaseOrderLine"]["Row"]
          >
        >((acc, purchaseOrderLine) => {
          acc[purchaseOrderLine.id] = purchaseOrderLine;
          return acc;
        }, {});

        const purchaseOrderLineUpdatesVoid = invoiceLinesVoid.data.reduce<
          Record<
            string,
            Database["public"]["Tables"]["purchaseOrderLine"]["Update"] & {
              purchaseOrderId: string;
            }
          >
        >((acc, invoiceLine) => {
          const purchaseOrderLine =
            purchaseOrderLinesByIdVoid[invoiceLine.purchaseOrderLineId ?? ""];
          if (
            invoiceLine.purchaseOrderLineId &&
            purchaseOrderLine &&
            invoiceLine.quantity &&
            purchaseOrderLine.purchaseQuantity &&
            purchaseOrderLine.purchaseQuantity > 0
          ) {
            const newQuantityInvoiced = getInvoicedPurchaseQuantityAfterVoid(
              purchaseOrderLine.quantityInvoiced,
              invoiceLine.quantity
            );

            // Short-close aware: compare against the billable (received)
            // quantity for short-closed lines, not the ordered quantity.
            const invoicedComplete =
              newQuantityInvoiced >= getBillableQuantity(purchaseOrderLine);

            acc[invoiceLine.purchaseOrderLineId] = {
              quantityInvoiced: newQuantityInvoiced,
              invoicedComplete,
              purchaseOrderId: purchaseOrderLine.purchaseOrderId
            };
          }
          return acc;
        }, {});

        const purchaseOrderStatusUpdatesVoid: Record<
          string,
          Database["public"]["Tables"]["purchaseOrder"]["Row"]["status"]
        > = {};
        for (const purchaseOrderId of affectedPurchaseOrderIdsVoid) {
          const projectedLines = purchaseOrderLinesVoid.data
            .filter((line) => line.purchaseOrderId === purchaseOrderId)
            .map((line) => {
              const update = purchaseOrderLineUpdatesVoid[line.id];
              if (update && update.quantityInvoiced !== undefined) {
                return { ...line, quantityInvoiced: update.quantityInvoiced };
              }
              return line;
            });

          const areAllLinesInvoicedProjected = projectedLines.every((line) => {
            if (line.purchaseOrderLineType === "Comment") return true;
            const target = line.purchaseQuantity ?? 0;
            if (target <= 0) return true;
            return (line.quantityInvoiced ?? 0) >= target;
          });

          const areAllLinesReceivedProjected = projectedLines.every((line) => {
            if (
              line.purchaseOrderLineType === "Comment" ||
              line.purchaseOrderLineType === "G/L Account" ||
              line.purchaseOrderLineType === "Service"
            )
              return true;
            const target = line.purchaseQuantity ?? 0;
            if (target <= 0) return true;
            return (line.quantityReceived ?? 0) >= target;
          });

          let status: Database["public"]["Tables"]["purchaseOrder"]["Row"]["status"] =
            "To Receive and Invoice";
          if (areAllLinesInvoicedProjected && areAllLinesReceivedProjected) {
            status = "Completed";
          } else if (areAllLinesInvoicedProjected) {
            status = "To Receive";
          } else if (areAllLinesReceivedProjected) {
            status = "To Invoice";
          }

          purchaseOrderStatusUpdatesVoid[purchaseOrderId] = status;
        }

        const reversingJournalLines: Omit<
          Database["public"]["Tables"]["journalLine"]["Insert"],
          "journalId"
        >[] = originalJournalLines.map((entry) => ({
          accountId: entry.accountId,
          // A reversed stand-in line names the same default, so the enable
          // re-points both sides together.
          accountDefaultRole: entry.accountDefaultRole,
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

        // Partition invoice-created costLedger rows for reversal:
        // - adjustment children (variance bumps on receipt layers)
        // - legacy self-heal layers (documentType 'Purchase Receipt')
        // - plain rows (no-PO direct-invoice layers): negative-mirror as before
        type CostLedgerRow = Database["public"]["Tables"]["costLedger"]["Row"];
        const adjustmentChildrenVoid = originalCostLedger.data.filter(
          (entry: CostLedgerRow) =>
            entry.adjustment && entry.appliesToCostLedgerId
        );
        const selfHealLayersVoid = originalCostLedger.data.filter(
          (entry: CostLedgerRow) =>
            !entry.adjustment && entry.documentType === "Purchase Receipt"
        );
        const plainCostLedgerVoid = originalCostLedger.data.filter(
          (entry: CostLedgerRow) =>
            !adjustmentChildrenVoid.includes(entry) &&
            !selfHealLayersVoid.includes(entry)
        );

        const reversingCostLedger: Database["public"]["Tables"]["costLedger"]["Insert"][] =
          plainCostLedgerVoid.map((entry) => ({
            itemLedgerType: entry.itemLedgerType,
            costLedgerType: entry.costLedgerType,
            adjustment: entry.adjustment,
            documentType: entry.documentType,
            documentId: entry.documentId,
            externalDocumentId: entry.externalDocumentId,
            itemId: entry.itemId,
            quantity: -entry.quantity,
            nominalCost: -entry.nominalCost,
            cost: -entry.cost,
            supplierId: entry.supplierId,
            companyId,
            postingDate: today
          }));

        // A Provisional journal has no accounting period.
        const accountingPeriodIdVoid =
          postingStatus === "Posted" && reversingJournalLines.length > 0
            ? await getCurrentAccountingPeriod(companyId, db, today)
            : null;

        await db.transaction().execute(async (trx) => {
          await assertPostingStatusUnchanged(trx, companyId, postingStatus);
          for await (const [purchaseOrderLineId, update] of Object.entries(
            purchaseOrderLineUpdatesVoid
          )) {
            const { purchaseOrderId: _purchaseOrderId, ...lineUpdate } = update;
            await trx
              .updateTable("purchaseOrderLine")
              .set(lineUpdate)
              .where("id", "=", purchaseOrderLineId)
              .where("companyId", "=", companyId)
              .execute();
          }

          for await (const [purchaseOrderId, status] of Object.entries(
            purchaseOrderStatusUpdatesVoid
          )) {
            await trx
              .updateTable("purchaseOrder")
              .set({ status })
              .where("id", "=", purchaseOrderId)
              .where("companyId", "=", companyId)
              .execute();
          }

          for (const [assetId, acquisitionCost] of cipAssetUpdatesVoid) {
            await trx
              .deleteFrom("fixedAssetCipCost")
              .where("companyId", "=", companyId)
              .where("sourceDocumentId", "=", invoiceId)
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
                accountingPeriodId: accountingPeriodIdVoid,
                description: `VOID Purchase Invoice ${invoice.data!.invoiceId}`,
                postingDate: today,
                companyId,
                sourceType: "Purchase Invoice",
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

          if (reversingCostLedger.length > 0) {
            await trx
              .insertInto("costLedger")
              .values(reversingCostLedger)
              .execute();
          }

          // Reverse variance adjustment children created by this invoice.
          // Untouched children are deleted; partially consumed ones get a
          // counter-child with the SAME remainingQuantity while the original
          // stays live — future consumption applies +bump and −bump together,
          // netting remaining units back to base cost. Already-consumed bumps
          // stay in posted COGS (no retroactive restatement).
          for (const child of adjustmentChildrenVoid) {
            if (
              Number(child.remainingQuantity ?? 0) === Number(child.quantity)
            ) {
              await trx
                .deleteFrom("costLedger")
                .where("id", "=", child.id)
                .where("companyId", "=", companyId)
                .execute();
            } else {
              await trx
                .insertInto("costLedger")
                .values({
                  itemLedgerType: child.itemLedgerType,
                  costLedgerType: child.costLedgerType,
                  adjustment: true,
                  appliesToCostLedgerId: child.appliesToCostLedgerId,
                  documentType: child.documentType,
                  documentId: child.documentId,
                  externalDocumentId: child.externalDocumentId,
                  itemId: child.itemId,
                  quantity: round(child.quantity),
                  nominalCost: round(-child.nominalCost),
                  cost: round(-child.cost),
                  remainingQuantity: round(child.remainingQuantity),
                  supplierId: child.supplierId,
                  companyId,
                  postingDate: today
                })
                .execute();
            }
          }

          // Reverse legacy self-heal layers created by this invoice. Unconsumed
          // layers are deleted (restores the pre-invoice no-layer state);
          // partially consumed ones get a negative mirror row and stop feeding
          // consumption (remainingQuantity zeroed).
          for (const layer of selfHealLayersVoid) {
            if (
              Number(layer.remainingQuantity ?? 0) === Number(layer.quantity)
            ) {
              await trx
                .deleteFrom("costLedger")
                .where("id", "=", layer.id)
                .where("companyId", "=", companyId)
                .execute();
            } else {
              await trx
                .insertInto("costLedger")
                .values({
                  itemLedgerType: layer.itemLedgerType,
                  costLedgerType: layer.costLedgerType,
                  adjustment: layer.adjustment,
                  documentType: layer.documentType,
                  documentId: layer.documentId,
                  externalDocumentId: layer.externalDocumentId,
                  itemId: layer.itemId,
                  quantity: round(-layer.quantity),
                  nominalCost: round(-layer.nominalCost),
                  cost: round(-layer.cost),
                  remainingQuantity: 0,
                  supplierId: layer.supplierId,
                  companyId,
                  postingDate: today
                })
                .execute();
              await trx
                .updateTable("costLedger")
                .set({ remainingQuantity: 0 })
                .where("id", "=", layer.id)
                .where("companyId", "=", companyId)
                .execute();
            }
          }

          await trx
            .updateTable("purchaseInvoice")
            .set({
              status: "Voided",
              updatedAt: today,
              updatedBy: userId
            })
            .where("id", "=", invoiceId)
            .where("companyId", "=", companyId)
            .execute();
        });

        return { success: true };
      }

      const companyRecord = await single(
        db,
        "company",
        { id: companyId },
        { columns: ["companyGroupId"] }
      );
      if (companyRecord.error) throw new Error("Failed to fetch company");
      const companyGroupId = companyRecord.data.companyGroupId;

      const [
        purchaseInvoice,
        purchaseInvoiceLines,
        purchaseInvoiceDelivery,
        dimensions
      ] = await inOrder([
        // Scoped for the same reason as the void path's read.
        () => maybeSingle(db, "purchaseInvoice", { id: invoiceId, companyId }),
        () => many(db, "purchaseInvoiceLine", { invoiceId, companyId }),
        () =>
          single(
            db,
            "purchaseInvoiceDelivery",
            { companyId, id: invoiceId },
            { columns: ["supplierShippingCost"] }
          ),
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
                "ItemPostingGroup",
                "Item",
                "Location",
                "CostCenter",
                "Project",
                "Process",
                "FixedAssetClass"
              ]
            },
            { columns: ["id", "entityType"] }
          )
      ]);

      if (purchaseInvoice.error)
        throw new Error("Failed to fetch purchaseInvoice");
      if (!purchaseInvoice.data)
        throw new NotFoundError("Purchase invoice not found");
      if (purchaseInvoiceLines.error)
        throw new Error("Failed to fetch receipt lines");
      if (purchaseInvoiceDelivery.error)
        throw new Error("Failed to fetch purchase invoice delivery");
      if (dimensions.error) {
        logger.error("Failed to fetch dimensions", { error: dimensions.error });
      }

      const dimensionMap = new Map<string, string>();
      for (const dim of dimensions.data ?? []) {
        if (dim.entityType) dimensionMap.set(dim.entityType, dim.id);
      }

      const amountsByLineId = new Map(
        calculatePurchasePostingAmounts({
          lines: purchaseInvoiceLines.data,
          exchangeRate: purchaseInvoice.data.exchangeRate ?? 1,
          supplierShippingCost:
            purchaseInvoiceDelivery.data.supplierShippingCost ?? 0
        }).map((amounts) => [amounts.id, amounts])
      );

      const itemIds = purchaseInvoiceLines.data.reduce<string[]>(
        (acc, invoiceLine) => {
          if (invoiceLine.itemId && !acc.includes(invoiceLine.itemId)) {
            acc.push(invoiceLine.itemId);
          }
          return acc;
        },
        []
      );

      const [items, itemCosts, purchaseOrderLines, supplier] = await inOrder([
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
            { columns: ["itemId", "itemPostingGroupId", "costingMethod"] }
          ),
        () =>
          many(db, "purchaseOrderLine", {
            id: purchaseInvoiceLines.data.reduce<string[]>(
              (acc, invoiceLine) => {
                if (
                  invoiceLine.purchaseOrderLineId &&
                  !acc.includes(invoiceLine.purchaseOrderLineId)
                ) {
                  acc.push(invoiceLine.purchaseOrderLineId);
                }
                return acc;
              },
              []
            )
          }),
        () =>
          single(db, "supplier", {
            id: purchaseInvoice.data?.supplierId ?? "",
            companyId
          })
      ]);
      if (items.error) throw new Error("Failed to fetch items");
      if (itemCosts.error) throw new Error("Failed to fetch item costs");
      if (purchaseOrderLines.error)
        throw new Error("Failed to fetch purchase order lines");
      if (supplier.error) throw new Error("Failed to fetch supplier");

      // Detect the buyer side of an intercompany transaction. The sister supplier
      // row carries intercompanyCompanyId when both companies belong to a group.
      // post-sales-invoice records the seller side; this records the buyer side,
      // so runIntercompanyMatching can pair them for consolidation.
      const isIntercompany = supplier.data.intercompanyCompanyId != null;
      const intercompanyPartnerId = isIntercompany
        ? supplier.data.intercompanyCompanyId
        : null;

      // Keep the existing pre-tax matching basis in the document currency named
      // on the trade. Supplier fields retain that denomination; generated unitPrice
      // and shippingCost are base and must not be labelled as document amounts.
      const intercompanyAmount = [...amountsByLineId.values()].reduce(
        (total, amounts) => total + amounts.intercompanyDocumentAmount,
        0
      );

      const purchaseOrders = await many(db, "purchaseOrder", {
        purchaseOrderId: purchaseOrderLines.data.reduce<string[]>(
          (acc, purchaseOrderLine) => {
            if (
              purchaseOrderLine.purchaseOrderId &&
              !acc.includes(purchaseOrderLine.purchaseOrderId)
            ) {
              acc.push(purchaseOrderLine.purchaseOrderId);
            }
            return acc;
          },
          []
        ),
        companyId
      });

      if (purchaseOrders.error)
        throw new Error("Failed to fetch purchase orders");

      const costLedgerInserts: Database["public"]["Tables"]["costLedger"]["Insert"][] =
        [];

      // A Construction in Progress asset records every posting that adds to its
      // acquisition cost as a CIP cost row. Written inside the transaction, after
      // the journal, so it can carry the journal id.
      const cipCostInserts: Omit<
        Database["public"]["Tables"]["fixedAssetCipCost"]["Insert"],
        "journalId"
      >[] = [];

      const processIdByJobOperationId = new Map<string, string>();
      {
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

      const receiptLineInserts: Omit<
        Database["public"]["Tables"]["receiptLine"]["Insert"],
        "receiptId"
      >[] = [];

      const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
        [];

      const purchaseInvoiceLinesByPurchaseOrderLine =
        purchaseInvoiceLines.data.reduce<
          Record<
            string,
            Database["public"]["Tables"]["purchaseInvoiceLine"]["Row"]
          >
        >((acc, invoiceLine) => {
          if (invoiceLine.purchaseOrderLineId) {
            acc[invoiceLine.purchaseOrderLineId] = invoiceLine;
          }
          return acc;
        }, {});

      const purchaseOrderLineUpdates = purchaseOrderLines.data.reduce<
        Record<
          string,
          Database["public"]["Tables"]["purchaseOrderLine"]["Update"]
        >
      >((acc, purchaseOrderLine) => {
        const invoiceLine =
          purchaseInvoiceLinesByPurchaseOrderLine[purchaseOrderLine.id];
        if (
          invoiceLine &&
          invoiceLine.quantity &&
          purchaseOrderLine.purchaseQuantity &&
          purchaseOrderLine.purchaseQuantity > 0
        ) {
          const newQuantityInvoiced =
            (purchaseOrderLine.quantityInvoiced ?? 0) + invoiceLine.quantity;

          // Short-close aware: a line whose receiving was stopped is fully
          // invoiced once the received (not ordered) quantity is billed.
          const invoicedComplete =
            purchaseOrderLine.invoicedComplete ||
            invoiceLine.quantity >=
              getRemainingQuantityToInvoice(purchaseOrderLine);

          return {
            ...acc,
            [purchaseOrderLine.id]: {
              quantityInvoiced: newQuantityInvoiced,
              invoicedComplete,
              purchaseOrderId: purchaseOrderLine.purchaseOrderId
            }
          };
        }

        return acc;
      }, {});

      const receiptReferences = purchaseOrderLines.data.reduce<string[]>(
        (acc, purchaseOrderLine) => {
          if (
            (purchaseOrderLine.quantityReceived ?? 0) >
            (purchaseOrderLine.quantityInvoiced ?? 0)
          ) {
            acc.push(journalReference.to.receipt(purchaseOrderLine.id));
          }
          return acc;
        },
        []
      );
      const journalLines = await documentJournalLines(db, companyId, {
        documentLineReference: receiptReferences
      });

      const journalLinesByPurchaseOrderLine = journalLines.reduce<
        Record<string, Database["public"]["Tables"]["journalLine"]["Row"][]>
      >((acc, journalEntry) => {
        // A "receipt:" reference always carries the line id after the colon.
        const [type, purchaseOrderLineId] = (
          journalEntry.documentLineReference ?? ""
        ).split(":") as [string, string];
        if (type === "receipt") {
          if (
            acc[purchaseOrderLineId] &&
            Array.isArray(acc[purchaseOrderLineId])
          ) {
            acc[purchaseOrderLineId].push(journalEntry);
          } else {
            acc[purchaseOrderLineId] = [journalEntry];
          }
        }
        return acc;
      }, {});

      // Get account defaults (once for all lines)
      const accountDefaults = await getDefaultPostingGroup(db, companyId);
      if (accountDefaults.error || !accountDefaults.data) {
        throw new Error("Error getting account defaults");
      }

      // For IC transactions, book the payable to Inter-Company Payables instead of
      // regular AP — the mirror of post-sales-invoice's IC Receivables swap. Resolve
      // it from accountDefault (stable id), not by account number. An empty IC
      // default falls back to regular payables.
      const payables = isIntercompany
        ? resolveDefaultAccount(
            accountDefaults.data,
            "intercompanyPayablesAccount",
            postingStatus
          )
        : {
            accountId: accountDefaults.data.payablesAccount,
            accountDefaultRole: null
          };
      const payablesAccountId = payables.accountId;

      const purchaseOrderLineOf = (id: string | null) =>
        purchaseOrderLines.data.find((line) => line.id === id);
      const itemOf = (itemId: string | null): PurchaseInvoiceItem => {
        const item = items.data.find((row) => row.id === itemId);
        const itemCost = itemCosts.data.find((row) => row.itemId === itemId);
        return {
          itemId,
          itemTrackingType: item?.itemTrackingType ?? null,
          replenishmentSystem: item?.replenishmentSystem ?? null,
          itemPostingGroupId: itemCost?.itemPostingGroupId ?? null,
          // An item with no cost record posts as FIFO.
          costingMethod: itemCost?.costingMethod ?? "FIFO"
        };
      };
      /** A PO line's quantities, in inventory units. */
      const inventoryQuantities = (
        purchaseOrderLine:
          | Database["public"]["Tables"]["purchaseOrderLine"]["Row"]
          | undefined
      ) => ({
        quantityReceived:
          (purchaseOrderLine?.quantityReceived ?? 0) *
          (purchaseOrderLine?.conversionFactor ?? 1),
        quantityInvoiced:
          (purchaseOrderLine?.quantityInvoiced ?? 0) *
          (purchaseOrderLine?.conversionFactor ?? 1)
      });

      // The receipt layers a received line's variance may write up, read once
      // for the invoice: the layers of the line's item on the receipts of its
      // PO line, and the on-hand quantity of an item whose receipts wrote none.
      const layerLines = purchaseInvoiceLines.data.filter((invoiceLine) => {
        if (
          !isItemLineType(invoiceLine.invoiceLineType) ||
          !invoiceLine.itemId
        ) {
          return false;
        }
        const purchaseOrderLine = purchaseOrderLineOf(
          invoiceLine.purchaseOrderLineId
        );
        if (!purchaseOrderLine) return false;
        const { quantityReceived, quantityInvoiced } =
          inventoryQuantities(purchaseOrderLine);
        return (
          quantityReceived > quantityInvoiced &&
          usesReceiptLayers(
            itemOf(invoiceLine.itemId),
            !!purchaseOrderLine.jobOperationId
          )
        );
      });
      const receiptIdsByPurchaseOrderLine = new Map<string, Set<string>>();
      if (layerLines.length > 0) {
        const receiptLines = await selectRows(
          db,
          "receiptLine",
          {
            lineId: [
              ...new Set(
                layerLines.map((line) => line.purchaseOrderLineId as string)
              )
            ],
            companyId
          },
          { columns: ["lineId", "receiptId"] }
        );
        for (const { lineId, receiptId } of receiptLines) {
          if (!lineId || !receiptId) continue;
          const receiptIds = receiptIdsByPurchaseOrderLine.get(lineId);
          if (receiptIds) receiptIds.add(receiptId);
          else receiptIdsByPurchaseOrderLine.set(lineId, new Set([receiptId]));
        }
      }
      const layerReceiptIds = [
        ...new Set(
          [...receiptIdsByPurchaseOrderLine.values()].flatMap((ids) => [...ids])
        )
      ];
      const receiptLayers =
        layerReceiptIds.length > 0
          ? await selectRows(
              db,
              "costLedger",
              {
                documentType: "Purchase Receipt",
                documentId: layerReceiptIds,
                itemId: [
                  ...new Set(layerLines.map((line) => line.itemId as string))
                ],
                adjustment: false,
                companyId
              },
              {
                columns: [
                  "id",
                  "documentId",
                  "itemId",
                  "quantity",
                  "remainingQuantity"
                ],
                orderBy: ["postingDate", "createdAt"]
              }
            )
          : [];
      const layersByInvoiceLine = new Map(
        layerLines.map((invoiceLine) => {
          const receiptIds = receiptIdsByPurchaseOrderLine.get(
            invoiceLine.purchaseOrderLineId as string
          );
          return [
            invoiceLine.id,
            receiptLayers
              .filter(
                (layer) =>
                  layer.itemId === invoiceLine.itemId &&
                  !!layer.documentId &&
                  !!receiptIds?.has(layer.documentId)
              )
              .map((layer) => ({
                id: layer.id,
                quantity: Number(layer.quantity),
                remainingQuantity: Number(layer.remainingQuantity ?? 0)
              }))
          ];
        })
      );
      const selfHealItemIds = [
        ...new Set(
          layerLines
            .filter((line) => layersByInvoiceLine.get(line.id)?.length === 0)
            .map((line) => line.itemId as string)
        )
      ];
      const onHand =
        selfHealItemIds.length > 0
          ? await db
              .selectFrom("itemLedger")
              .select((eb) => [
                "itemId",
                eb.fn.sum<number>("quantity").as("quantity")
              ])
              .where("itemId", "in", selfHealItemIds)
              .where("companyId", "=", companyId)
              .groupBy("itemId")
              .execute()
          : [];
      const onHandByItem = new Map(
        onHand.map((row) => [row.itemId, Number(row.quantity ?? 0)])
      );

      const glAccountIds = [
        ...new Set(
          purchaseInvoiceLines.data.flatMap((line) =>
            line.invoiceLineType === "G/L Account" && line.accountId
              ? [line.accountId]
              : []
          )
        )
      ];
      const glAccounts =
        glAccountIds.length > 0
          ? await selectRows(
              db,
              "account",
              { companyGroupId: companyGroupId!, id: glAccountIds },
              { columns: ["id", "name", "isGroup"] }
            )
          : [];

      type FixedAssetRow = Pick<
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
      const fixedAssetIds = [
        ...new Set(
          purchaseInvoiceLines.data.flatMap((line) =>
            line.invoiceLineType === "Fixed Asset" && line.assetId
              ? [line.assetId]
              : []
          )
        )
      ];
      const fixedAssets =
        fixedAssetIds.length > 0
          ? await selectRows<"fixedAsset", FixedAssetRow>(
              db,
              "fixedAsset",
              { companyId, id: fixedAssetIds },
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
          : [];
      const fixedAssetById = new Map(
        fixedAssets.map((asset) => [asset.id, asset])
      );

      // The facts of each line, in order. A line the journal cannot be built
      // from is refused here.
      const postingLines: PurchaseInvoicePostingLine[] = [];
      for (const invoiceLine of purchaseInvoiceLines.data) {
        if (invoiceLine.invoiceLineType === "Comment") continue;
        const base = {
          id: invoiceLine.id,
          invoiceLineType: invoiceLine.invoiceLineType,
          locationId: invoiceLine.locationId ?? null,
          amounts: amountsByLineId.get(invoiceLine.id)!
        };

        if (isItemLineType(invoiceLine.invoiceLineType)) {
          const item = itemOf(invoiceLine.itemId ?? null);
          if (invoiceLine.purchaseOrderLineId === null) {
            postingLines.push({
              ...base,
              kind: "direct",
              item,
              receivedWithInvoice: !skipReceiptPost
            });
            continue;
          }
          const purchaseOrderLine = purchaseOrderLineOf(
            invoiceLine.purchaseOrderLineId
          );
          postingLines.push({
            ...base,
            kind: "ordered",
            item,
            purchaseOrderLine: {
              purchaseOrderLineId: invoiceLine.purchaseOrderLineId,
              ...inventoryQuantities(purchaseOrderLine),
              receiptGroups: receiptGroups(
                journalLinesByPurchaseOrderLine[
                  invoiceLine.purchaseOrderLineId
                ] ?? []
              ),
              isOutsideProcessing: !!purchaseOrderLine?.jobOperationId,
              processId: purchaseOrderLine?.jobOperationId
                ? (processIdByJobOperationId.get(
                    purchaseOrderLine.jobOperationId
                  ) ?? null)
                : null,
              coverage: {
                receiptLayers: layersByInvoiceLine.get(invoiceLine.id) ?? [],
                onHandQuantity: invoiceLine.itemId
                  ? (onHandByItem.get(invoiceLine.itemId) ?? 0)
                  : 0
              }
            }
          });
          continue;
        }

        switch (invoiceLine.invoiceLineType) {
          case "Fixed Asset": {
            // Silently skipping would credit less to AP than the invoice total
            // the payment flow is allowed to apply against.
            if (!invoiceLine.assetId) {
              throw new Error(
                `Fixed Asset invoice line ${invoiceLine.id} has no asset selected`
              );
            }
            const purchaseOrderLine = purchaseOrderLineOf(
              invoiceLine.purchaseOrderLineId
            );
            const asset = fixedAssetById.get(invoiceLine.assetId);
            const wasReceived =
              !!invoiceLine.purchaseOrderLineId &&
              (purchaseOrderLine?.quantityReceived ?? 0) > 0;
            if (!wasReceived && !asset) {
              throw new Error("Failed to fetch fixed asset");
            }
            postingLines.push({
              ...base,
              kind: "fixedAsset",
              purchaseOrderLineId: invoiceLine.purchaseOrderLineId,
              purchaseOrderLineLocationId:
                purchaseOrderLine?.locationId ?? null,
              assetLocationId: asset?.locationId ?? null,
              fixedAssetClassId: asset?.fixedAssetClassId ?? null,
              acquisition: wasReceived
                ? {
                    receiptCost: fixedAssetReceiptCost(
                      journalLinesByPurchaseOrderLine[
                        invoiceLine.purchaseOrderLineId!
                      ] ?? []
                    )
                  }
                : { assetAccountId: asset!.fixedAssetClass!.assetAccountId }
            });
            break;
          }
          case "G/L Account": {
            const account = glAccounts.find(
              (row) => row.id === invoiceLine.accountId
            );
            if (!account) throw new Error("Failed to fetch account");
            if (account.isGroup)
              throw new Error("Cannot post to a group account");
            postingLines.push({
              ...base,
              kind: "glAccount",
              purchaseOrderLineId: invoiceLine.purchaseOrderLineId,
              account,
              costCenterId: invoiceLine.costCenterId ?? null,
              projectId: invoiceLine.projectId ?? null
            });
            break;
          }
          default:
            throw new Error("Unsupported invoice line type");
        }
      }

      const posting = buildPurchaseInvoicePostingLines({
        invoice: {
          id: purchaseInvoice.data.id,
          supplierId: purchaseInvoice.data.supplierId,
          supplierReference: purchaseInvoice.data.supplierReference
        },
        supplierTypeId: supplier.data.supplierTypeId ?? null,
        accounts: accountDefaults.data,
        payables,
        lines: postingLines
      });
      const journalLineInserts = posting.lines.map(
        ({ dimensions: _dimensions, ...line }) => ({ ...line, companyId })
      );

      // What the journal decided, written to the receipts, ledgers, layers
      // and fixed assets.
      for (const invoiceLine of purchaseInvoiceLines.data) {
        if (invoiceLine.invoiceLineType === "Comment") continue;
        const postingAmounts = amountsByLineId.get(invoiceLine.id)!;
        const {
          inventoryQuantity: invoiceLineQuantityInInventoryUnit,
          totalBaseCost: totalLineCostWithWeightedShipping,
          inventoryUnitCost: invoiceLineUnitCostInInventoryUnit
        } = postingAmounts;
        const received = posting.receivedVariances.get(invoiceLine.id);

        if (isItemLineType(invoiceLine.invoiceLineType)) {
          const item = items.data.find(
            (item) => item.id === invoiceLine.itemId
          );
          const itemTrackingType = item?.itemTrackingType ?? "Inventory";

          logger.debug({
            invoiceLineItemId: invoiceLine.itemId,
            foundItem: item,
            itemTrackingType,
            requiresSerialTracking: itemTrackingType === "Serial",
            requiresBatchTracking: itemTrackingType === "Batch"
          });

          // With no PO line the invoice receives the part itself.
          if (invoiceLine.purchaseOrderLineId === null) {
            // Services are never received, so they must not materialize a
            // receipt document — only the expense + AP entries.
            if (invoiceLine.invoiceLineType !== "Service") {
              receiptLineInserts.push({
                itemId: invoiceLine.itemId!,
                lineId: invoiceLine.id,
                orderQuantity: invoiceLineQuantityInInventoryUnit,
                outstandingQuantity: invoiceLineQuantityInInventoryUnit,
                receivedQuantity: invoiceLineQuantityInInventoryUnit,
                locationId: invoiceLine.locationId,
                storageUnitId: invoiceLine.storageUnitId,
                unitOfMeasure: invoiceLine.inventoryUnitOfMeasureCode ?? "EA",
                unitPrice: invoiceLineUnitCostInInventoryUnit,
                requiresSerialTracking: itemTrackingType === "Serial",
                requiresBatchTracking: itemTrackingType === "Batch",
                createdBy: invoiceLine.createdBy,
                companyId
              });
            }

            // Only create item ledger entries if the receipt is being posted
            // (not when skipReceiptPost is true, as entries will be created when the receipt is posted later)
            if (itemTrackingType === "Inventory" && !skipReceiptPost) {
              itemLedgerInserts.push({
                postingDate: today,
                itemId: invoiceLine.itemId!,
                quantity: round(invoiceLineQuantityInInventoryUnit),
                locationId: invoiceLine.locationId,
                storageUnitId: invoiceLine.storageUnitId,
                entryType: "Positive Adjmt.",
                documentType: "Purchase Receipt",
                documentId: purchaseInvoice.data?.id ?? undefined,
                externalDocumentId:
                  purchaseInvoice.data?.supplierReference ?? undefined,
                createdBy: userId,
                companyId
              });
            }

            // Services are never stocked — a cost ledger layer would pollute
            // inventory valuation, so only the journal entries apply.
            if (invoiceLine.invoiceLineType !== "Service") {
              costLedgerInserts.push({
                itemLedgerType: "Purchase",
                costLedgerType: "Direct Cost",
                adjustment: false,
                documentType: "Purchase Invoice",
                documentId: purchaseInvoice.data?.id ?? undefined,
                externalDocumentId:
                  purchaseInvoice.data?.supplierReference ?? undefined,
                itemId: invoiceLine.itemId,
                quantity: round(invoiceLineQuantityInInventoryUnit),
                nominalCost: postingAmounts.nominalBaseCost,
                cost: round(totalLineCostWithWeightedShipping),
                remainingQuantity: round(invoiceLineQuantityInInventoryUnit),
                supplierId: purchaseInvoice.data?.supplierId,
                companyId,
                postingDate: today
              });
            }
            continue;
          }

          // The receipt is the sole creator of purchase cost layers; this
          // invoice adjusts the receipt's layers instead of creating its own.
          if (!received) continue;

          // Subledger: adjustment child rows on the covered layers, consumed
          // alongside their parent by calculateCOGS.
          for (const entry of received.allocation.perLayer) {
            costLedgerInserts.push({
              itemLedgerType: "Purchase",
              costLedgerType: "Direct Cost",
              adjustment: true,
              appliesToCostLedgerId: entry.costLedgerId,
              documentType: "Purchase Invoice",
              documentId: purchaseInvoice.data?.id ?? undefined,
              externalDocumentId:
                purchaseInvoice.data?.supplierReference ?? undefined,
              itemId: invoiceLine.itemId,
              quantity: round(entry.appliedQuantity),
              nominalCost: round(entry.adjustmentCost),
              cost: round(entry.adjustmentCost),
              remainingQuantity: round(entry.appliedQuantity),
              supplierId: purchaseInvoice.data?.supplierId,
              companyId,
              postingDate: today
            });
          }

          // Legacy self-heal: goods received before receipt-created layers
          // shipped. The layer only represents stock still on hand, at
          // receipt cost plus its share of the variance — the consumed
          // remainder's variance is PPV and must not become consumable
          // subledger value.
          const coveredQuantity = received.selfHealQuantity;
          if (coveredQuantity > 0) {
            const coverageRatio = coveredQuantity / received.quantity;
            costLedgerInserts.push({
              itemLedgerType: "Purchase",
              costLedgerType: "Direct Cost",
              adjustment: false,
              documentType: "Purchase Receipt",
              documentId: purchaseInvoice.data?.id ?? undefined,
              externalDocumentId:
                purchaseInvoice.data?.supplierReference ?? undefined,
              itemId: invoiceLine.itemId,
              quantity: round(coveredQuantity),
              nominalCost: round(
                coveredQuantity * invoiceLineUnitCostInInventoryUnit
              ),
              cost: round(
                received.receiptCost * coverageRatio +
                  received.allocation.inventoryShare
              ),
              remainingQuantity: round(coveredQuantity),
              supplierId: purchaseInvoice.data?.supplierId,
              companyId,
              postingDate: today
            });
          }
          continue;
        }

        if (invoiceLine.invoiceLineType !== "Fixed Asset") continue;
        const assetId = invoiceLine.assetId!;
        const asset = fixedAssetById.get(assetId);

        if (received) {
          // Received: a variance changes the asset's acquisition cost.
          const { variance } = received;
          if (Math.abs(variance) > 0.005 && asset) {
            const assetRecord = fixedAssetWrites.overlay(assetId, {
              ...asset
            });
            fixedAssetWrites.patch(assetId, {
              acquisitionCost: Number(assetRecord.acquisitionCost) + variance,
              updatedBy: userId
            });

            if (asset.fixedAssetClass?.isConstructionInProgress) {
              cipCostInserts.push({
                fixedAssetId: assetId,
                sourceType: "Purchase Invoice",
                sourceDocumentId: invoiceId,
                sourceDocumentLineId: invoiceLine.id,
                amount: round(variance),
                costDate: today,
                companyId,
                createdBy: userId
              });
            }
          }
          continue;
        }

        // Direct invoice (no prior receipt) — full acquisition
        const assetRecord = fixedAssetWrites.overlay(assetId, { ...asset! });
        const isConstructionInProgress = Boolean(
          assetRecord.fixedAssetClass?.isConstructionInProgress
        );
        const updateData: Database["public"]["Tables"]["fixedAsset"]["Update"] =
          {
            acquisitionCost:
              (Number(assetRecord.acquisitionCost) ?? 0) +
              totalLineCostWithWeightedShipping,
            updatedBy: userId
          };
        if (!assetRecord.acquisitionDate) {
          updateData.acquisitionDate = today;
        }
        // A CIP asset does not depreciate until it is capitalized, so its
        // depreciation start date stays null and it goes Under Construction.
        if (!isConstructionInProgress && !assetRecord.depreciationStartDate) {
          updateData.depreciationStartDate = today;
        }
        if (assetRecord.status === "Draft") {
          updateData.status = isConstructionInProgress
            ? "Under Construction"
            : "Active";
        }

        if (invoiceLine.locationId) {
          updateData.locationId = invoiceLine.locationId;
        }

        fixedAssetWrites.patch(assetId, updateData);

        if (isConstructionInProgress) {
          cipCostInserts.push({
            fixedAssetId: assetId,
            sourceType: "Purchase Invoice",
            sourceDocumentId: invoiceId,
            sourceDocumentLineId: invoiceLine.id,
            amount: round(totalLineCostWithWeightedShipping),
            costDate: today,
            companyId,
            createdBy: userId
          });
        }
      }

      // A Provisional journal has no accounting period.
      const accountingPeriodId =
        postingStatus === "Posted"
          ? await getCurrentAccountingPeriod(companyId, db, today)
          : null;

      const createdReceiptIds: string[] = [];

      await db.transaction().execute(async (trx) => {
        await assertPostingStatusUnchanged(trx, companyId, postingStatus);
        await fixedAssetWrites.apply(trx, companyId);
        if (receiptLineInserts.length > 0) {
          const receiptLinesGroupedByLocationId = receiptLineInserts.reduce<
            Record<string, typeof receiptLineInserts>
          >((acc, line) => {
            if (line.locationId) {
              if (line.locationId in acc) {
                acc[line.locationId]!.push(line);
              } else {
                acc[line.locationId] = [line];
              }
            }

            return acc;
          }, {});

          for await (const [locationId, receiptLines] of Object.entries(
            receiptLinesGroupedByLocationId
          )) {
            const readableReceiptId = await getNextSequence(
              trx,
              "receipt",
              companyId
            );
            const receipt = await trx
              .insertInto("receipt")
              .values({
                receiptId: readableReceiptId,
                locationId,
                sourceDocument: "Purchase Invoice",
                sourceDocumentId: purchaseInvoice.data!.id,
                sourceDocumentReadableId: purchaseInvoice.data!.invoiceId,
                externalDocumentId: purchaseInvoice.data!.supplierReference,
                supplierId: purchaseInvoice.data!.supplierId,
                status: skipReceiptPost ? "Draft" : "Posted",
                postingDate: skipReceiptPost ? null : today,
                postedBy: skipReceiptPost ? null : userId,
                invoiced: true,
                companyId,
                createdBy: purchaseInvoice.data!.createdBy
              })
              .returning(["id"])
              .execute();

            const receiptId = receipt[0]!.id;
            if (!receiptId) throw new Error("Failed to insert receipt");
            createdReceiptIds.push(receiptId);

            await trx
              .insertInto("receiptLine")
              .values(
                receiptLines.map((r) => ({
                  ...r,
                  receiptId: receiptId
                }))
              )
              .returning(["id"])
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

        const purchaseOrdersUpdated = Object.values(
          purchaseOrderLineUpdates
        ).reduce<string[]>((acc, update) => {
          if (update.purchaseOrderId && !acc.includes(update.purchaseOrderId)) {
            acc.push(update.purchaseOrderId);
          }
          return acc;
        }, []);

        for await (const purchaseOrderId of purchaseOrdersUpdated) {
          const purchaseOrderLines = await trx
            .selectFrom("purchaseOrderLine")
            .select([
              "id",
              "purchaseOrderLineType",
              "invoicedComplete",
              "receivedComplete"
            ])
            .where("purchaseOrderId", "=", purchaseOrderId)
            .execute();

          const areAllLinesInvoiced = purchaseOrderLines.every(
            (line) =>
              line.purchaseOrderLineType === "Comment" || line.invoicedComplete
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
            .where("id", "=", purchaseOrderId)
            .where("companyId", "=", companyId)
            .execute();
        }

        let invoiceJournalId: string | null = null;
        if (journalLineInserts.length > 0) {
          const journalEntryId = await getNextSequence(
            trx,
            "journalEntry",
            companyId
          );

          const journal = await trx
            .insertInto("journal")
            .values({
              journalEntryId,
              accountingPeriodId,
              description: `Purchase Invoice ${purchaseInvoice.data?.invoiceId}`,
              postingDate: today,
              companyId,
              sourceType: "Purchase Invoice",
              status: postingStatus,
              postedAt: datetime.timestamp(),
              postedBy: userId,
              createdBy: userId
            })
            .returning(["id"])
            .execute();

          const journalId = journal[0]!.id;
          if (!journalId) throw new Error("Failed to insert journal");
          invoiceJournalId = journalId;

          const journalLineResults = await trx
            .insertInto("journalLine")
            .values(
              journalLineInserts.map((journalLine) => ({
                ...journalLine,
                journalId
              }))
            )
            .returning(["id"])
            .execute();

          if (dimensionMap.size > 0) {
            const journalLineDimensionInserts = journalLineDimensionRows({
              journalLineIds: journalLineResults.map((line) => line.id),
              lines: posting.lines,
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

          // Record the buyer side of an intercompany transaction (mirrors the
          // seller-side insert in post-sales-invoice) so runIntercompanyMatching can
          // pair the two and generateEliminationEntries can eliminate them for
          // consolidated reporting. Uses the first journal line as the reference,
          // exactly as the sales side does.
          // Keep the first payable as the matching anchor while capturing every
          // actual payable row for elimination of multiline and split receipts.
          const icControlLines = isIntercompany
            ? classifyIntercompanyPostingLines(
                journalLineInserts.map((line, index) => ({
                  ...line,
                  id: journalLineResults[index]?.id ?? ""
                })),
                posting.lines.map((line) => ({
                  itemId: line.dimensions.Item ?? null
                })),
                { controlAccountId: payablesAccountId }
              )
            : [];
          const icJournalLineId = icControlLines[0]?.journalLineId ?? null;
          if (
            isIntercompany &&
            intercompanyPartnerId &&
            companyGroupId &&
            icJournalLineId
          ) {
            const icTxn = await trx
              .insertInto("intercompanyTransaction")
              .values({
                companyGroupId,
                sourceCompanyId: companyId,
                targetCompanyId: intercompanyPartnerId,
                sourceJournalLineId: icJournalLineId,
                amount: round(intercompanyAmount),
                currencyCode: purchaseInvoice.data?.currencyCode ?? "USD",
                description: `Purchase Invoice ${purchaseInvoice.data?.invoiceId}`,
                documentType: "Invoice",
                documentId: purchaseInvoice.data?.id,
                status: "Unmatched"
              })
              .returning(["id"])
              .executeTakeFirstOrThrow();

            // Capture the buyer side's role-classified elimination lines. The
            // profit the consolidation defers is embedded in whatever ASSET the
            // buyer capitalized the goods into — inventory OR a fixed asset — so
            // capture the buyer's actual capitalization account (not the seller's
            // inventory relief, which was the negative-Finished-Goods bug).
            const eliminationLineInserts: Database["public"]["Tables"]["intercompanyEliminationLine"]["Insert"][] =
              icControlLines.map((line) => ({
                ...line,
                companyId,
                intercompanyTransactionId: icTxn.id,
                createdBy: userId
              }));

            // Capitalization is any Asset-class DEBIT the buyer posted for the
            // goods — which excludes GR/IR clearing (a liability) and expensed
            // indirect cost by construction. It lands in two places: on THIS
            // invoice for not-yet-received / fixed-asset-at-invoice lines, and on
            // the linked RECEIPT posting for goods already received (the common
            // path — the invoice only trues up the price variance there).
            const poLineToItem = new Map<string, string | null>();
            for (const line of purchaseInvoiceLines.data) {
              if (line.purchaseOrderLineId)
                poLineToItem.set(line.purchaseOrderLineId, line.itemId ?? null);
            }
            const jlIdToItem = new Map<string, string | null>();
            journalLineResults.forEach((jl, index) => {
              jlIdToItem.set(
                jl.id,
                posting.lines[index]?.dimensions.Item ?? null
              );
            });

            // (i) inline capitalization on this invoice's journal
            const invoiceCapLines = await trx
              .selectFrom("journalLine as jl")
              .innerJoin("journal as j", (join) =>
                join
                  .onRef("j.id", "=", "jl.journalId")
                  .onRef("j.companyId", "=", "jl.companyId")
              )
              .innerJoin("account as a", "a.id", "jl.accountId")
              .select([
                "jl.id as id",
                "jl.accountId as accountId",
                "jl.amount as amount",
                "jl.quantity as quantity"
              ])
              .where("jl.journalId", "=", journalId)
              .where("jl.companyId", "=", companyId)
              .where("a.class", "=", "Asset")
              .where("jl.amount", ">", 0)
              .where("j.status", "in", [...DOCUMENT_JOURNAL_STATUSES])
              .execute();
            for (const cap of invoiceCapLines) {
              eliminationLineInserts.push({
                companyId,
                intercompanyTransactionId: icTxn.id,
                role: "Capitalization",
                journalLineId: cap.id,
                accountId: cap.accountId!,
                amount: cap.amount ?? 0,
                itemId: jlIdToItem.get(cap.id) ?? null,
                quantity: cap.quantity ?? null,
                createdBy: userId
              });
            }

            // (ii) receipt capitalization (goods received before invoicing)
            const poLineIds = [...poLineToItem.keys()];
            if (poLineIds.length > 0) {
              const receiptLineRows = await trx
                .selectFrom("receiptLine")
                .select(["receiptId", "lineId"])
                .where("lineId", "in", poLineIds)
                .where("companyId", "=", companyId)
                .execute();
              const receiptIds = [
                ...new Set(
                  receiptLineRows
                    .map((row) => row.receiptId)
                    .filter((id): id is string => !!id)
                )
              ];
              if (receiptIds.length > 0) {
                const receiptCapLines = await trx
                  .selectFrom("journalLine as jl")
                  .innerJoin("journal as j", (join) =>
                    join
                      .onRef("j.id", "=", "jl.journalId")
                      .onRef("j.companyId", "=", "jl.companyId")
                  )
                  .innerJoin("account as a", "a.id", "jl.accountId")
                  .select([
                    "jl.id as id",
                    "jl.accountId as accountId",
                    "jl.amount as amount",
                    "jl.quantity as quantity",
                    "jl.documentLineReference as documentLineReference"
                  ])
                  .where("jl.companyId", "=", companyId)
                  .where("jl.documentId", "in", receiptIds)
                  .where("a.class", "=", "Asset")
                  .where("jl.amount", ">", 0)
                  .where("j.status", "in", [...DOCUMENT_JOURNAL_STATUSES])
                  .execute();
                for (const cap of receiptCapLines) {
                  // documentLineReference is `receipt:<purchaseOrderLineId>`; map
                  // it back to the item so on-hand realization can scale the
                  // writedown. Fixed assets carry no item -> full deferral.
                  let itemId: string | null = null;
                  const ref = cap.documentLineReference ?? "";
                  if (ref.startsWith("receipt:")) {
                    itemId =
                      poLineToItem.get(ref.slice("receipt:".length)) ?? null;
                  }
                  eliminationLineInserts.push({
                    companyId,
                    intercompanyTransactionId: icTxn.id,
                    role: "Capitalization",
                    journalLineId: cap.id,
                    accountId: cap.accountId!,
                    amount: cap.amount ?? 0,
                    itemId,
                    quantity: cap.quantity ?? null,
                    createdBy: userId
                  });
                }
              }
            }

            if (eliminationLineInserts.length > 0) {
              await trx
                .insertInto("intercompanyEliminationLine")
                .values(eliminationLineInserts)
                .execute();
            }
          }
        }

        if (cipCostInserts.length > 0) {
          await trx
            .insertInto("fixedAssetCipCost")
            .values(
              cipCostInserts.map((row) => ({
                ...row,
                journalId: invoiceJournalId
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

        if (costLedgerInserts.length > 0) {
          await trx
            .insertInto("costLedger")
            .values(costLedgerInserts)
            .returning(["id"])
            .execute();
        }

        // Posting keeps the supplier's dateIssued, so only fill dateDue when it
        // is empty — a manually entered due date from the supplier's invoice wins.
        // With no payment term the invoice still gets one, via Net 30.
        const paymentTerm =
          !purchaseInvoice.data?.dateDue && purchaseInvoice.data?.paymentTermId
            ? await trx
                .selectFrom("paymentTerm")
                .select(["daysDue", "calculationMethod"])
                .where("id", "=", purchaseInvoice.data.paymentTermId)
                .where("companyId", "=", companyId)
                .executeTakeFirst()
            : undefined;
        const dateDue = purchaseInvoice.data?.dateDue
          ? null
          : calculateDueDate(
              purchaseInvoice.data?.dateIssued ?? today,
              paymentTerm
            );

        await trx
          .updateTable("purchaseInvoice")
          .set({
            ...(dateDue ? { dateDue } : {}),
            postingDate: today,
            status: "Open"
          })
          .where("id", "=", invoiceId)
          .where("companyId", "=", companyId)
          .execute();
      });

      return {
        success: true,
        receiptIds: createdReceiptIds
      };
    } catch (err) {
      // A failed VOID leaves the invoice Posted: its rows still stand.
      if (type !== "void") {
        await updateRows(
          db,
          "purchaseInvoice",
          { status: "Draft" },
          { id: invoiceId, companyId }
        );
      }
      throw err;
    }
  }
});

export default postPurchaseInvoice;
