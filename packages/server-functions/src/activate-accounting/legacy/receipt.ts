// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The journals of legacy receipts: the lines `post-receipt` writes today,
// from the stored receipt and the cost rows it stored, with today's account
// defaults (.ai/specs/implemented/2026-10-08-accounting-cutover.md section 5a).
//
// Mirrors post-receipt/index.ts:
// - a purchase order receipt (~1641-1985, header ~2432-2550): per receipt
//   line, inventory (indirect cost for a Non-Inventory item, WIP for outside
//   processing) against GR/IR, on `receipt:<poLineId>` with the received
//   quantity, which the purchase invoice's GR/IR walk reads. A negative line
//   reverses the pair. A line that stored cost rows books what they stored;
//   one that stored none (Non-Inventory, outside processing) books its PO
//   cost with its share of the order's shipping, as the posting costs it.
//   A fixed asset line has no receipt line and no cost row, and is not
//   rebuilt: the asset register and the opening fixed asset lines carry it;
// - a sales return receipt (~2826-3075, header ~3165-3210): inventory
//   against COGS at the cost its cost row stored, per receipt line with a
//   positive cost.
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
import { journalReference } from "@carbon/database";
import type { KyselyTx } from "@carbon/database/client";
import { legacyReceipts } from "@carbon/database/legacy-documents";
import { credit, debit, EPSILON, round } from "@carbon/utils";
import { sql } from "kysely";
import { nanoid } from "nanoid";
import { resolveInventoryAccount } from "../../lib/get-posting-group";
import {
  groupBy,
  type LegacyJournal,
  type LegacyJournalLine,
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

/** A received quantity as the posting reads it: NaN and null are 0. */
function receivedQuantity(value: number | null): number {
  const quantity = Number(value ?? 0);
  return Number.isNaN(quantity) ? 0 : quantity;
}

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
  const linesByReceipt = groupBy(lines, (line) => line.receiptId);

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
    const receiptLineRows = linesByReceipt.get(receipt.id) ?? [];
    const totalLinesCost = receiptLineRows.reduce(
      (sum, line) =>
        sum +
        Math.abs(receivedQuantity(line.receivedQuantity)) *
          Number(line.unitPrice ?? 0),
      0
    );
    // The PO cost of a line: price × quantity and its share of shipping.
    const poCost = (line: (typeof receiptLineRows)[number]) => {
      const lineCost =
        Math.abs(receivedQuantity(line.receivedQuantity)) *
        Number(line.unitPrice ?? 0);
      const percentage = totalLinesCost === 0 ? 0 : lineCost / totalLinesCost;
      return lineCost + shippingCost * percentage;
    };
    const createsLayers = (line: (typeof receiptLineRows)[number]) => {
      const trackingType = line.itemId
        ? (itemById.get(line.itemId)?.itemTrackingType ?? "Inventory")
        : "Inventory";
      return (
        trackingType !== "Non-Inventory" &&
        !isOutsideProcessing &&
        Boolean(line.itemId) &&
        receivedQuantity(line.receivedQuantity) !== 0
      );
    };

    // The cost each layer line stored, shared across its item and sign.
    const costByLine = new Map<string, number>();
    const layerGroups = groupBy(
      receiptLineRows.filter(createsLayers),
      (line) =>
        `${line.itemId}:${receivedQuantity(line.receivedQuantity) > 0 ? "in" : "out"}`
    );
    for (const group of layerGroups.values()) {
      const first = group[0]!;
      const inbound = receivedQuantity(first.receivedQuantity) > 0;
      const rows = stored.get(`${receipt.id}:${first.itemId}`);
      // The posting stores the cost it relieved, its PO cost fallback
      // included; a line with no stored row books its PO cost.
      const total = inbound
        ? (rows?.inbound ?? 0)
        : rows?.hasOutbound
          ? -rows.outbound
          : group.reduce((sum, line) => sum + poCost(line), 0);
      const shares = share(total, group.map(poCost));
      for (const [index, line] of group.entries()) {
        costByLine.set(line.id, shares[index]!);
      }
    }

    const journalLines: LegacyJournalLine[] = [];
    for (const line of receiptLineRows) {
      const quantity = receivedQuantity(line.receivedQuantity);
      const absQuantity = Math.abs(quantity);
      if (absQuantity <= 0) continue;
      const item = line.itemId ? itemById.get(line.itemId) : undefined;
      const trackingType = item?.itemTrackingType ?? "Inventory";
      const cost = costByLine.get(line.id) ?? poCost(line);

      let debitAccount: string;
      let debitDescription: string;
      if (trackingType !== "Non-Inventory" && !isOutsideProcessing) {
        const inventory = resolveInventoryAccount(
          item?.replenishmentSystem ?? null,
          defaults
        );
        debitAccount = inventory.account;
        debitDescription = inventory.description;
      } else if (isOutsideProcessing) {
        debitAccount = defaults.workInProgressAccount;
        debitDescription = "WIP Account";
      } else {
        debitAccount = defaults.indirectCostAccount;
        debitDescription = "Indirect Cost Account";
      }

      const jobOperationId = line.lineId
        ? jobOperationByLine.get(line.lineId)
        : undefined;
      const dimensions = {
        SupplierType: order?.supplierId
          ? (supplierTypeById.get(order.supplierId) ?? null)
          : null,
        ItemPostingGroup: line.itemId
          ? (postingGroupByItem.get(line.itemId) ?? null)
          : null,
        Item: line.itemId,
        Supplier: order?.supplierId ?? null,
        Location: line.locationId,
        Process:
          isOutsideProcessing && jobOperationId
            ? (processByOperation.get(jobOperationId) ?? null)
            : null
      };
      const keys = {
        quantity: round(absQuantity),
        documentType: "Receipt" as const,
        documentId: receipt.id,
        externalDocumentId: order?.supplierReference ?? null,
        documentLineReference: journalReference.to.receipt(String(line.lineId)),
        journalLineReference: nanoid(),
        dimensions
      };
      const goodsReceived = {
        ...keys,
        accountId: defaults.goodsReceivedNotInvoicedAccount,
        description: "Goods Received Not Invoiced"
      };
      if (quantity < 0) {
        journalLines.push(
          { ...goodsReceived, amount: round(debit("liability", cost)) },
          {
            ...keys,
            accountId: debitAccount,
            description: debitDescription,
            amount: round(credit("asset", cost))
          }
        );
      } else {
        journalLines.push(
          {
            ...keys,
            accountId: debitAccount,
            description: debitDescription,
            amount: round(debit("asset", cost))
          },
          { ...goodsReceived, amount: round(credit("liability", cost)) }
        );
      }
    }

    return {
      description: `Purchase Receipt ${receipt.receiptId}`,
      postingDate: String(receipt.postingDate),
      sourceType: "Purchase Receipt" as const,
      lines: journalLines
    };
  });
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
  const linesByReceipt = groupBy(lines, (line) => line.receiptId);

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
        receivedQuantity(line.receivedQuantity) > 0 &&
        (itemById.get(line.itemId)?.itemTrackingType ?? "Inventory") !==
          "Non-Inventory"
    );
    const costByLine = new Map<string, number>();
    for (const group of groupBy(layerLines, (line) =>
      String(line.itemId)
    ).values()) {
      const total =
        stored.get(`${receipt.id}:${group[0]!.itemId}`)?.inbound ?? 0;
      const shares = share(
        total,
        group.map((line) => receivedQuantity(line.receivedQuantity))
      );
      for (const [index, line] of group.entries()) {
        costByLine.set(line.id, shares[index]!);
      }
    }

    const journalLines: LegacyJournalLine[] = [];
    for (const line of layerLines) {
      const cost = costByLine.get(line.id) ?? 0;
      // A zero-value re-entry posts no journal.
      if (!(cost > 0)) continue;
      const quantity = receivedQuantity(line.receivedQuantity);
      const itemId = line.itemId as string;
      const inventory = resolveInventoryAccount(
        itemById.get(itemId)?.replenishmentSystem ?? null,
        defaults
      );
      const keys = {
        quantity: round(quantity),
        documentType: "Receipt" as const,
        documentId: receipt.id,
        externalDocumentId: receipt.externalDocumentId ?? null,
        documentLineReference: journalReference.to.receipt(
          line.lineId as string
        ),
        journalLineReference: nanoid(),
        dimensions: {
          Item: itemId,
          ItemPostingGroup: postingGroupByItem.get(itemId) ?? null,
          Location: line.locationId,
          Customer: customerId,
          CustomerType: customerId
            ? (customerTypeById.get(customerId) ?? null)
            : null
        }
      };
      journalLines.push(
        {
          ...keys,
          accountId: inventory.account,
          description: inventory.description,
          amount: round(debit("asset", cost))
        },
        {
          ...keys,
          accountId: defaults.costOfGoodsSoldAccount,
          description: "Cost of Goods Sold",
          amount: round(credit("expense", cost))
        }
      );
    }

    return {
      description: `Sales Return Receipt ${receipt.receiptId}`,
      postingDate: String(receipt.postingDate),
      sourceType: "Sales Return Receipt" as const,
      lines: journalLines
    };
  });
}
