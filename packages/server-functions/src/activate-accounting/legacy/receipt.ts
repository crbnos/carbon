// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The journals of legacy receipts: the lines `post-receipt` writes today,
// from the stored receipt and the cost rows it stored, with today's account
// defaults (.ai/specs/implemented/2026-10-08-accounting-cutover.md section 5a).
// Both build their lines through post-receipt/posting-lines.ts; this file
// only gathers the facts from the stored rows.
//
// - A purchase order receipt: a line that stored cost rows books what they
//   stored; one that stored none (Non-Inventory, outside processing) books
//   its PO cost with its share of the order's shipping, as the posting costs
//   it. A fixed asset line has no receipt line and no cost row, and is not
//   rebuilt: the asset register and the opening fixed asset lines carry it.
// - A sales return receipt: each receipt line with a positive cost, at the
//   cost its cost row stored. The detection leaves out a return with none
//   (`legacyReceipts`), as the posting books no zero-value re-entry.
//
// Cost rows are stored per receipt line but carry no line id. The rows of
// one item and sign are shared across that item's lines: by PO cost for a
// purchase receipt, by quantity for a return. One line per item, the usual
// case, gets its own row's cost exactly.
//
// Approximations: a Non-Inventory or outside processing line received after
// its invoice books its PO cost, not the invoice's accrual cost. A return of
// a Non-Inventory item is not rebuilt: it stored no cost row.

import type { Database } from "@carbon/database";
import type { KyselyTx } from "@carbon/database/client";
import { legacyReceipts } from "@carbon/database/legacy-documents";
import { EPSILON } from "@carbon/utils";
import { sql } from "kysely";
import {
  buildPurchaseReceiptJournalLines,
  buildSalesReturnReceiptJournalLines,
  type PurchaseReceiptLine,
  type PurchaseReceiptLineCost,
  purchaseReceiptLineCosts
} from "../../post-receipt/posting-lines";
import {
  type LegacyJournal,
  postedQuantity,
  readByIds,
  readItems,
  readPostingGroups
} from "./write";

type AccountDefaults = Database["public"]["Tables"]["accountDefault"]["Row"];
type Args = {
  companyId: string;
  cutoverDate: string;
  defaults: AccountDefaults;
};

/** Shares `total` across the weights; equal weights when they sum to 0. */
function share(total: number, weights: number[]): number[] {
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  if (Math.abs(sum) <= EPSILON) {
    return weights.map(() => total / Math.max(weights.length, 1));
  }
  return weights.map((weight) => (total * weight) / sum);
}

function receiptLines(trx: KyselyTx, companyId: string, receiptIds: string[]) {
  return readByIds(receiptIds, (ids) =>
    trx
      .selectFrom("receiptLine")
      .select([
        "id",
        "receiptId",
        "lineId",
        "itemId",
        "receivedQuantity",
        "unitPrice",
        "locationId"
      ])
      .where("companyId", "=", companyId)
      .where("receiptId", "in", ids)
      .orderBy("receiptId")
      .orderBy("createdAt")
      .orderBy("id")
      .execute()
  );
}

/** The cost a receipt stored per item and sign, from its own rows only. */
function storedCosts(
  trx: KyselyTx,
  {
    companyId,
    receiptIds,
    documentType,
    itemLedgerType
  }: {
    companyId: string;
    receiptIds: string[];
    documentType: Database["public"]["Enums"]["itemLedgerDocumentType"];
    itemLedgerType: Database["public"]["Enums"]["itemLedgerType"];
  }
) {
  return readByIds(receiptIds, (ids) =>
    trx
      .selectFrom("costLedger")
      .select([
        "documentId",
        "itemId",
        sql<number>`coalesce(sum("cost") filter (where "quantity" > 0), 0)`.as(
          "inbound"
        ),
        sql<number>`coalesce(sum("cost") filter (where "quantity" < 0), 0)`.as(
          "outbound"
        ),
        sql<number>`count(*) filter (where "quantity" < 0)`.as("outboundRows")
      ])
      .where("companyId", "=", companyId)
      .where("documentType", "=", documentType)
      .where("itemLedgerType", "=", itemLedgerType)
      .where("costLedgerType", "=", "Direct Cost")
      .where("adjustment", "=", false)
      .where("appliesToCostLedgerId", "is", null)
      .where("documentId", "in", ids)
      .groupBy(["documentId", "itemId"])
      .execute()
  ).then(
    (rows) =>
      new Map(
        rows.map((row) => [
          `${row.documentId}:${row.itemId}`,
          {
            inbound: Number(row.inbound),
            outbound: Number(row.outbound),
            hasOutbound: Number(row.outboundRows) > 0
          }
        ])
      )
  );
}

export async function buildLegacyPurchaseReceiptJournals(
  trx: KyselyTx,
  { companyId, cutoverDate, defaults }: Args
): Promise<LegacyJournal[]> {
  const receipts = await legacyReceipts(
    trx,
    { companyId, cutoverDate },
    "Purchase Order"
  ).execute();
  if (receipts.length === 0) return [];
  const receiptIds = receipts.map((receipt) => receipt.id);
  const purchaseOrderIds = receipts.map((receipt) => receipt.sourceDocumentId);

  const lines = await receiptLines(trx, companyId, receiptIds);
  const itemIds = lines.map((line) => line.itemId);
  const purchaseOrders = await readByIds(purchaseOrderIds, (ids) =>
    trx
      .selectFrom("purchaseOrder")
      .select([
        "id",
        "supplierId",
        "supplierReference",
        "exchangeRate",
        "purchaseOrderType"
      ])
      .where("companyId", "=", companyId)
      .where("id", "in", ids)
      .execute()
  );
  const deliveries = await readByIds(purchaseOrderIds, (ids) =>
    trx
      .selectFrom("purchaseOrderDelivery")
      .select(["id", "supplierShippingCost"])
      .where("companyId", "=", companyId)
      .where("id", "in", ids)
      .execute()
  );
  const suppliers = await readByIds(
    purchaseOrders.map((order) => order.supplierId),
    (ids) =>
      trx
        .selectFrom("supplier")
        .select(["id", "supplierTypeId"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  const itemById = await readItems(trx, companyId, itemIds);
  const postingGroupByItem = await readPostingGroups(trx, companyId, itemIds);
  const purchaseOrderLines = await readByIds(
    lines.map((line) => line.lineId),
    (ids) =>
      trx
        .selectFrom("purchaseOrderLine")
        .select(["id", "jobOperationId"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  const jobOperations = await readByIds(
    purchaseOrderLines.map((line) => line.jobOperationId),
    (ids) =>
      trx
        .selectFrom("jobOperation")
        .select(["id", "processId"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  const stored = await storedCosts(trx, {
    companyId,
    receiptIds,
    documentType: "Purchase Receipt",
    itemLedgerType: "Purchase"
  });

  const purchaseOrderById = new Map(
    purchaseOrders.map((order) => [order.id, order])
  );
  const shippingByOrder = new Map(
    deliveries.map((row) => [row.id, Number(row.supplierShippingCost ?? 0)])
  );
  const supplierTypeById = new Map(
    suppliers.map((row) => [row.id, row.supplierTypeId])
  );
  const jobOperationByLine = new Map(
    purchaseOrderLines.map((row) => [row.id, row.jobOperationId])
  );
  const processByOperation = new Map(
    jobOperations.map((row) => [row.id, row.processId])
  );
  const linesByReceipt = Map.groupBy(lines, (line) => line.receiptId);

  return receipts.map((receipt) => {
    const order = receipt.sourceDocumentId
      ? purchaseOrderById.get(receipt.sourceDocumentId)
      : undefined;
    const isOutsideProcessing =
      order?.purchaseOrderType === "Outside Processing";
    // Supplier currency to base divides by the order's rate (post-receipt).
    const shippingCost =
      (receipt.sourceDocumentId
        ? (shippingByOrder.get(receipt.sourceDocumentId) ?? 0)
        : 0) / (Number(order?.exchangeRate) || 1);
    const receiptJournalLines: PurchaseReceiptLine[] = (
      linesByReceipt.get(receipt.id) ?? []
    ).map((line) => {
      const item = line.itemId ? itemById.get(line.itemId) : undefined;
      const jobOperationId = line.lineId
        ? jobOperationByLine.get(line.lineId)
        : undefined;
      return {
        purchaseOrderLineId: line.lineId,
        itemId: line.itemId,
        quantity: postedQuantity(line.receivedQuantity),
        unitPrice: Number(line.unitPrice ?? 0),
        itemTrackingType: item?.itemTrackingType,
        replenishmentSystem: item?.replenishmentSystem,
        itemPostingGroupId: line.itemId
          ? (postingGroupByItem.get(line.itemId) ?? null)
          : null,
        locationId: line.locationId,
        processId:
          isOutsideProcessing && jobOperationId
            ? (processByOperation.get(jobOperationId) ?? null)
            : null
      };
    });
    const costs = purchaseReceiptLineCosts(receiptJournalLines, {
      shippingCost,
      isOutsideProcessing
    });
    const storedCost = storedLayerCosts(receiptJournalLines, costs, (itemId) =>
      stored.get(`${receipt.id}:${itemId}`)
    );

    return {
      description: `Purchase Receipt ${receipt.receiptId}`,
      postingDate: String(receipt.postingDate),
      sourceType: "Purchase Receipt" as const,
      lines: buildPurchaseReceiptJournalLines({
        documentId: receipt.id,
        externalDocumentId: order?.supplierReference ?? null,
        isOutsideProcessing,
        supplierId: order?.supplierId ?? null,
        supplierTypeId: order?.supplierId
          ? (supplierTypeById.get(order.supplierId) ?? null)
          : null,
        accounts: defaults,
        lines: receiptJournalLines.map((line, index) => ({
          ...line,
          cost: storedCost.get(index) ?? costs[index]!.cost
        })),
        fixedAssets: []
      })
    };
  });
}

/**
 * The cost each layer line stored, by line index, shared across the lines of
 * its item and sign by PO cost. The posting stores the cost it relieved, its
 * PO cost fallback included; an outbound group with no stored row books its
 * PO cost.
 */
function storedLayerCosts(
  lines: PurchaseReceiptLine[],
  costs: PurchaseReceiptLineCost[],
  storedFor: (
    itemId: string
  ) => { inbound: number; outbound: number; hasOutbound: boolean } | undefined
): Map<number, number> {
  const costByLine = new Map<number, number>();
  const layerGroups = Map.groupBy(
    lines.flatMap((line, index) =>
      costs[index]!.createsLayers ? [{ line, index }] : []
    ),
    ({ line }) => `${line.itemId}:${line.quantity > 0 ? "in" : "out"}`
  );
  for (const group of layerGroups.values()) {
    const { line: first } = group[0]!;
    const rows = storedFor(String(first.itemId));
    const poCosts = group.map(({ index }) => costs[index]!.poCost);
    const total =
      first.quantity > 0
        ? (rows?.inbound ?? 0)
        : rows?.hasOutbound
          ? -rows.outbound
          : poCosts.reduce((sum, cost) => sum + cost, 0);
    const shares = share(total, poCosts);
    for (const [position, { index }] of group.entries()) {
      costByLine.set(index, shares[position]!);
    }
  }
  return costByLine;
}

export async function buildLegacySalesReturnReceiptJournals(
  trx: KyselyTx,
  { companyId, cutoverDate, defaults }: Args
): Promise<LegacyJournal[]> {
  const receipts = await legacyReceipts(
    trx,
    { companyId, cutoverDate },
    "Sales Return Order"
  ).execute();
  if (receipts.length === 0) return [];
  const receiptIds = receipts.map((receipt) => receipt.id);

  const lines = await receiptLines(trx, companyId, receiptIds);
  const itemIds = lines.map((line) => line.itemId);
  const returnOrders = await readByIds(
    receipts.map((receipt) => receipt.sourceDocumentId),
    (ids) =>
      trx
        .selectFrom("salesReturnOrder")
        .select(["id", "customerId"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  const customers = await readByIds(
    returnOrders.map((order) => order.customerId),
    (ids) =>
      trx
        .selectFrom("customer")
        .select(["id", "customerTypeId"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  const itemById = await readItems(trx, companyId, itemIds);
  const postingGroupByItem = await readPostingGroups(trx, companyId, itemIds);
  const stored = await storedCosts(trx, {
    companyId,
    receiptIds,
    documentType: "Sales Return Receipt",
    itemLedgerType: "Sale"
  });

  const customerByOrder = new Map(
    returnOrders.map((order) => [order.id, order.customerId])
  );
  const customerTypeById = new Map(
    customers.map((row) => [row.id, row.customerTypeId])
  );
  const linesByReceipt = Map.groupBy(lines, (line) => line.receiptId);

  return receipts.map((receipt) => {
    const customerId = receipt.sourceDocumentId
      ? (customerByOrder.get(receipt.sourceDocumentId) ?? null)
      : null;
    // The lines that stored a cost row: positive, with an item that is not
    // Non-Inventory.
    const layerLines = (linesByReceipt.get(receipt.id) ?? []).filter(
      (line) =>
        line.itemId &&
        line.lineId &&
        postedQuantity(line.receivedQuantity) > 0 &&
        (itemById.get(line.itemId)?.itemTrackingType ?? "Inventory") !==
          "Non-Inventory"
    );
    const costByLine = new Map<string, number>();
    for (const group of Map.groupBy(layerLines, (line) =>
      String(line.itemId)
    ).values()) {
      const total =
        stored.get(`${receipt.id}:${group[0]!.itemId}`)?.inbound ?? 0;
      const shares = share(
        total,
        group.map((line) => postedQuantity(line.receivedQuantity))
      );
      for (const [index, line] of group.entries()) {
        costByLine.set(line.id, shares[index]!);
      }
    }

    const journalLines = buildSalesReturnReceiptJournalLines({
      documentId: receipt.id,
      externalDocumentId: receipt.externalDocumentId ?? null,
      customerId,
      customerTypeId: customerId
        ? (customerTypeById.get(customerId) ?? null)
        : null,
      accounts: defaults,
      lines: layerLines.map((line) => {
        const itemId = line.itemId as string;
        return {
          returnLineId: line.lineId as string,
          itemId,
          quantity: postedQuantity(line.receivedQuantity),
          cost: costByLine.get(line.id) ?? 0,
          replenishmentSystem: itemById.get(itemId)?.replenishmentSystem,
          itemPostingGroupId: postingGroupByItem.get(itemId) ?? null,
          locationId: line.locationId
        };
      })
    });

    return {
      description: `Sales Return Receipt ${receipt.receiptId}`,
      postingDate: String(receipt.postingDate),
      sourceType: "Sales Return Receipt" as const,
      lines: journalLines
    };
  });
}
