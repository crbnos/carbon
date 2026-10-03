// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type Database, getCompanyTimeZone } from "@carbon/database";
import { gte, inOrder, many, maybeSingle } from "@carbon/database/rows";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { sql } from "kysely";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { NotFoundError } from "../errors";

const logger = getLogger("server-functions", "update-purchased-prices");

export const updatePurchasedPricesInput = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("purchaseOrder"),
    purchaseOrderId: z.string(),
    updatePrices: z.boolean().optional(),
    updateLeadTimes: z.boolean().optional()
  }),
  z.object({
    source: z.literal("purchaseInvoice"),
    invoiceId: z.string(),
    updatePrices: z.boolean().optional(),
    updateLeadTimes: z.boolean().optional()
  })
]);

interface PurchaseLineData {
  itemId: string | null;
  jobOperationId: string | null;
  unitPrice: number;
  quantity: number;
  conversionFactor: number | null;
  purchaseUnitOfMeasureCode: string | null;
}

/** Whole days from order to delivery (`YYYY-MM-DD` each); 0 when either is unparseable. */
const calculateLeadTimeInDays = (
  orderDate: string,
  deliveryDate: string
): number => {
  try {
    return Math.max(0, parseDate(deliveryDate).compare(parseDate(orderDate)));
  } catch {
    return 0;
  }
};

const updatePurchasedPrices = defineServerFn({
  name: "update-purchased-prices",
  input: updatePurchasedPricesInput,
  permissions: { update: "purchasing" },
  async run(ctx, parsedPayload) {
    const { source } = parsedPayload;
    const { db, companyId } = ctx;
    const shouldUpdatePrices = parsedPayload.updatePrices ?? true;
    const shouldUpdateLeadTimes = parsedPayload.updateLeadTimes ?? false;

    logger.info("update-purchased-prices", {
      source,
      companyId,
      shouldUpdatePrices,
      shouldUpdateLeadTimes
    });

    let supplierId: string;
    let lines: PurchaseLineData[];

    switch (source) {
      case "purchaseOrder": {
        const { purchaseOrderId } = parsedPayload;

        logger.info("update-purchased-prices", {
          source,
          purchaseOrderId,
          companyId
        });

        const [purchaseOrder, purchaseOrderLines] = await inOrder([
          () =>
            maybeSingle(db, "purchaseOrder", {
              id: purchaseOrderId,
              companyId
            }),
          () => many(db, "purchaseOrderLine", { purchaseOrderId, companyId })
        ]);

        if (purchaseOrder.error)
          throw new Error("Failed to fetch purchaseOrder");
        if (!purchaseOrder.data)
          throw new NotFoundError("Purchase order not found");
        if (purchaseOrderLines.error)
          throw new Error("Failed to fetch purchase order lines");
        if (!purchaseOrder.data.supplierId)
          throw new Error("Purchase order has no supplier");

        supplierId = purchaseOrder.data.supplierId;
        lines = purchaseOrderLines.data
          .map((line) => ({
            itemId: line.itemId,
            jobOperationId: null,
            unitPrice: line.unitPrice ?? 0,
            quantity:
              (line.purchaseQuantity ?? 0) * (line.conversionFactor ?? 1),
            conversionFactor: line.conversionFactor,
            purchaseUnitOfMeasureCode: line.purchaseUnitOfMeasureCode
          }))
          .filter((line) => line.quantity > 0);

        if (shouldUpdatePrices) {
          const today = datetime
            .today(await getCompanyTimeZone(db, companyId))
            .toString();

          // Delete any existing cost ledger entries for this PO (handles re-finalization)
          await db
            .deleteFrom("costLedger")
            .where("documentType", "=", "Purchase Order")
            .where("documentId", "=", purchaseOrderId)
            .where("companyId", "=", companyId)
            .execute();

          // Create new cost ledger entries for each line item. These are
          // planning/cost-history rows, NOT inventory layers — real layers
          // are created at receipt posting. remainingQuantity stays 0 so
          // FIFO/LIFO consumption can never eat unreceived stock.
          const costLedgerInserts = lines
            .filter((line) => line.itemId && line.unitPrice !== 0)
            .map((line) => ({
              itemLedgerType: "Purchase" as const,
              costLedgerType: "Direct Cost" as const,
              adjustment: false,
              documentType: "Purchase Order" as const,
              documentId: purchaseOrderId,
              itemId: line.itemId!,
              quantity: line.quantity,
              cost:
                (line.quantity / (line.conversionFactor ?? 1)) * line.unitPrice,
              remainingQuantity: 0,
              postingDate: today,
              supplierId,
              companyId
            }));

          if (costLedgerInserts.length > 0) {
            await db
              .insertInto("costLedger")
              .values(costLedgerInserts)
              .execute();
          }
        }

        break;
      }

      case "purchaseInvoice": {
        const { invoiceId } = parsedPayload;

        logger.info("update-purchased-prices", {
          source,
          invoiceId,
          companyId
        });

        const [purchaseInvoice, purchaseInvoiceLines] = await inOrder([
          () =>
            maybeSingle(db, "purchaseInvoice", { id: invoiceId, companyId }),
          () => many(db, "purchaseInvoiceLine", { invoiceId, companyId })
        ]);

        if (purchaseInvoice.error)
          throw new Error("Failed to fetch purchaseInvoice");
        if (!purchaseInvoice.data)
          throw new NotFoundError("Purchase invoice not found");
        if (purchaseInvoiceLines.error)
          throw new Error("Failed to fetch invoice lines");
        if (!purchaseInvoice.data.supplierId)
          throw new Error("Purchase invoice has no supplier");

        supplierId = purchaseInvoice.data.supplierId;
        lines = purchaseInvoiceLines.data
          .map((line) => ({
            itemId: line.itemId,
            jobOperationId: line.jobOperationId,
            unitPrice: line.unitPrice ?? 0,
            quantity: (line.quantity ?? 0) * (line.conversionFactor ?? 1),
            conversionFactor: line.conversionFactor,
            purchaseUnitOfMeasureCode: line.purchaseUnitOfMeasureCode
          }))
          .filter((line) => line.quantity > 0);
        break;
      }
    }

    const itemIds = Array.from(
      new Set(
        lines
          .filter((line) => Boolean(line.itemId))
          .map((line) => line.itemId as string)
      )
    );

    // Rolling one-year window over postingDate, anchored on the company's
    // calendar day (postingDate itself is company-tz derived).
    const dateOneYearAgo = datetime
      .today(await getCompanyTimeZone(db, companyId))
      .subtract({ years: 1 })
      .toString();

    const itemCostUpdates: Database["public"]["Tables"]["itemCost"]["Update"][] =
      [];
    const itemReplenishmentUpdates: Database["public"]["Tables"]["itemReplenishment"]["Update"][] =
      [];
    const supplierPartInserts: Database["public"]["Tables"]["supplierPart"]["Insert"][] =
      [];
    const supplierPartUpdates: Database["public"]["Tables"]["supplierPart"]["Update"][] =
      [];

    const jobOperationUpdates: Database["public"]["Tables"]["jobOperation"]["Update"][] =
      [];

    const historicalPartCosts: Record<
      string,
      { quantity: number; cost: number }
    > = {};
    const historicalPartLeadTimes: Record<
      string,
      { quantity: number; weightedLeadTime: number }
    > = {};

    let supplierPartRows: Database["public"]["Tables"]["supplierPart"]["Row"][] =
      [];

    if (shouldUpdatePrices && itemIds.length > 0) {
      // Aggregate in SQL: fetching raw rows through PostgREST silently caps
      // at 1000, which skewed the weighted average for high-volume items.
      const [costLedgerTotals, supplierParts] = await inOrder([
        () =>
          db
            .selectFrom("costLedger")
            .select(({ fn }) => [
              "itemId",
              // Adjustment child rows (invoice-vs-receipt price corrections)
              // carry cost but no additional physical quantity, so they count
              // toward cost but not quantity.
              sql<number>`sum(case when "adjustment" then 0 else "quantity" end)`.as(
                "quantity"
              ),
              fn.sum<number>("cost").as("cost")
            ])
            .where("itemId", "in", itemIds)
            .where("companyId", "=", companyId)
            .where("postingDate", ">=", dateOneYearAgo)
            .groupBy("itemId")
            .execute(),
        () =>
          many(db, "supplierPart", { supplierId, itemId: itemIds, companyId })
      ]);

      if (supplierParts.error) {
        throw new Error("Failed to fetch supplier parts");
      }

      supplierPartRows = supplierParts.data ?? [];

      costLedgerTotals.forEach((row) => {
        if (row.itemId) {
          historicalPartCosts[row.itemId] = {
            quantity: Number(row.quantity ?? 0),
            cost: Number(row.cost ?? 0)
          };
        }
      });
    }

    if (shouldUpdateLeadTimes && itemIds.length > 0) {
      const receipts = await many(
        db,
        "receipt",
        {
          companyId,
          sourceDocument: "Purchase Order",
          postingDate: gte(dateOneYearAgo)
        },
        { columns: ["id", "postingDate", "sourceDocumentId"] }
      );

      if (receipts.error) {
        throw new Error("Failed to fetch historical receipts");
      }

      const receiptIds = receipts.data?.map((receipt) => receipt.id) ?? [];
      const purchaseOrderIds = Array.from(
        new Set(
          (receipts.data ?? [])
            .map((receipt) => receipt.sourceDocumentId)
            .filter((id): id is string => Boolean(id))
        )
      );

      if (receiptIds.length > 0 && purchaseOrderIds.length > 0) {
        const [receiptLines, purchaseOrders] = await inOrder([
          () =>
            many(
              db,
              "receiptLine",
              { receiptId: receiptIds, itemId: itemIds, companyId },
              {
                columns: [
                  "receiptId",
                  "itemId",
                  "receivedQuantity",
                  "conversionFactor"
                ]
              }
            ),
          () =>
            many(
              db,
              "purchaseOrder",
              { id: purchaseOrderIds, companyId },
              { columns: ["id", "orderDate"] }
            )
        ]);

        if (receiptLines.error) {
          throw new Error("Failed to fetch historical receipt lines");
        }
        if (purchaseOrders.error) {
          throw new Error("Failed to fetch historical purchase orders");
        }

        const receiptsById = (receipts.data ?? []).reduce<
          Record<
            string,
            { postingDate: string; sourceDocumentId: string | null }
          >
        >((acc, receipt) => {
          if (receipt.postingDate) {
            acc[receipt.id] = {
              postingDate: receipt.postingDate,
              sourceDocumentId: receipt.sourceDocumentId
            };
          }
          return acc;
        }, {});

        const purchaseOrdersById = purchaseOrders.data.reduce<
          Record<string, { orderDate: string | null }>
        >((acc, row) => {
          acc[row.id] = { orderDate: row.orderDate };
          return acc;
        }, {});

        receiptLines.data.forEach((line) => {
          if (!line.itemId) return;

          const receipt = receiptsById[line.receiptId];
          if (!receipt?.sourceDocumentId) return;

          const orderDate =
            purchaseOrdersById[receipt.sourceDocumentId]?.orderDate;
          if (!orderDate || !receipt.postingDate) return;

          const safeConversionFactor =
            line.conversionFactor && line.conversionFactor > 0
              ? line.conversionFactor
              : 1;
          const quantity = Math.abs(
            (line.receivedQuantity ?? 0) / safeConversionFactor
          );
          if (quantity <= 0) return;

          const leadTimeInDays = calculateLeadTimeInDays(
            orderDate,
            receipt.postingDate
          );

          historicalPartLeadTimes[line.itemId] ??= {
            quantity: 0,
            weightedLeadTime: 0
          };
          const history = historicalPartLeadTimes[line.itemId]!;
          history.quantity += quantity;
          history.weightedLeadTime += leadTimeInDays * quantity;
        });
      }
    }

    lines.forEach((line) => {
      if (line.itemId && !line.jobOperationId) {
        const costHistory = historicalPartCosts[line.itemId];
        const hasLeadTimeHistory =
          (historicalPartLeadTimes[line.itemId]?.quantity ?? 0) > 0;

        if (
          shouldUpdatePrices &&
          line.unitPrice !== 0 &&
          costHistory &&
          costHistory.quantity > 0
        ) {
          itemCostUpdates.push({
            itemId: line.itemId,
            unitCost: costHistory.cost / costHistory.quantity,
            updatedBy: "system"
          });

          const supplierPart = supplierPartRows.find(
            (sp) => sp.itemId === line.itemId && sp.supplierId === supplierId
          );

          if (supplierPart && supplierPart.id) {
            supplierPartUpdates.push({
              id: supplierPart.id,
              unitPrice: line.unitPrice,
              conversionFactor: line.conversionFactor ?? 1,
              supplierUnitOfMeasureCode: line.purchaseUnitOfMeasureCode,
              updatedBy: "system"
            });
          } else {
            supplierPartInserts.push({
              itemId: line.itemId,
              supplierId: supplierId,
              unitPrice: line.unitPrice,
              conversionFactor: line.conversionFactor ?? 1,
              supplierUnitOfMeasureCode: line.purchaseUnitOfMeasureCode,
              createdBy: "system",
              companyId
            });
          }
        }

        if (
          shouldUpdatePrices ||
          (shouldUpdateLeadTimes && hasLeadTimeHistory)
        ) {
          const itemReplenishmentUpdate: Database["public"]["Tables"]["itemReplenishment"]["Update"] =
            {
              itemId: line.itemId,
              updatedBy: "system"
            };

          if (shouldUpdatePrices) {
            itemReplenishmentUpdate.preferredSupplierId = supplierId;
            itemReplenishmentUpdate.purchasingUnitOfMeasureCode =
              line.purchaseUnitOfMeasureCode;
            itemReplenishmentUpdate.conversionFactor =
              line.conversionFactor ?? 1;
          }

          const history = historicalPartLeadTimes[line.itemId];
          if (shouldUpdateLeadTimes && hasLeadTimeHistory && history) {
            itemReplenishmentUpdate.leadTime = Math.round(
              history.weightedLeadTime / history.quantity
            );
          }

          itemReplenishmentUpdates.push(itemReplenishmentUpdate);
        }
      }

      if (shouldUpdatePrices && line.jobOperationId && line.unitPrice !== 0) {
        jobOperationUpdates.push({
          id: line.jobOperationId,
          operationMinimumCost: 0,
          operationUnitCost: line.unitPrice ?? 0,
          updatedBy: "system"
        });
      }
    });

    await db.transaction().execute(async (trx) => {
      if (itemCostUpdates.length > 0) {
        for await (const itemCostUpdate of itemCostUpdates) {
          await trx
            .updateTable("itemCost")
            .set(itemCostUpdate)
            .where("itemId", "=", itemCostUpdate.itemId!)
            .where("companyId", "=", companyId)
            .execute();
        }
      }

      if (jobOperationUpdates.length > 0) {
        for await (const jobOperationUpdate of jobOperationUpdates) {
          await trx
            .updateTable("jobOperation")
            .set(jobOperationUpdate)
            .where("id", "=", jobOperationUpdate.id!)
            .where("companyId", "=", companyId)
            .execute();
        }
      }

      if (supplierPartInserts.length > 0) {
        await trx
          .insertInto("supplierPart")
          .values(supplierPartInserts)
          .onConflict((oc) =>
            oc.columns(["itemId", "supplierId", "companyId"]).doUpdateSet({
              unitPrice: (eb) => eb.ref("excluded.unitPrice"),
              conversionFactor: (eb) => eb.ref("excluded.conversionFactor"),
              supplierUnitOfMeasureCode: (eb) =>
                eb.ref("excluded.supplierUnitOfMeasureCode"),
              updatedBy: "system"
            })
          )
          .execute();
      }

      if (supplierPartUpdates.length > 0) {
        for await (const supplierPartUpdate of supplierPartUpdates) {
          await trx
            .updateTable("supplierPart")
            .set(supplierPartUpdate)
            .where("id", "=", supplierPartUpdate.id!)
            .where("companyId", "=", companyId)
            .execute();
        }
      }

      if (itemReplenishmentUpdates.length > 0) {
        for await (const itemReplenishmentUpdate of itemReplenishmentUpdates) {
          await trx
            .updateTable("itemReplenishment")
            .set(itemReplenishmentUpdate)
            .where("itemId", "=", itemReplenishmentUpdate.itemId!)
            .where("companyId", "=", companyId)
            .execute();
        }
      }
    });

    return { success: true };
  }
});

export default updatePurchasedPrices;
