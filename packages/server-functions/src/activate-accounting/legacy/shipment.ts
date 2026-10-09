// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The journals of legacy shipments that stored a cost row: the lines
// `post-shipment` writes today, at the cost the rows stored, with today's
// account defaults (.ai/specs/2026-10-08-accounting-cutover.md section 5a).
//
// Mirrors post-shipment/index.ts:
// - a sales order shipment with its "Sale" cost row (the company had
//   accounting on before the reset; ~490-536, ~1216-1422): per shipment line,
//   COGS against inventory on `shipment:<shipmentLineId>`. An item's stored
//   cost is shared across its lines by quantity, the last line taking the
//   remainder, as the posting shares `calculateCOGS`. The enable's re-cost
//   finds the inventory credit and its COGS pair by journal line reference.
//   A fixed asset line is not rebuilt: the asset register carries it;
// - a sales return shipment (~2205-2345): COGS against inventory, and a
//   purchase return shipment (~2785-2918): GR/IR against inventory, one pair
//   per cost row with a positive cost, on `shipment:<shipmentId>`.

import type { Database } from "@carbon/database";
import { journalReference } from "@carbon/database";
import type { KyselyTx } from "@carbon/database/client";
import { credit, debit, round } from "@carbon/utils";
import { sql } from "kysely";
import { nanoid } from "nanoid";
import { resolveInventoryAccount } from "../../lib/get-posting-group";
import { legacyShipments } from "./detect";
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

export async function buildLegacySalesShipmentJournals(
  trx: KyselyTx,
  { companyId, cutoverDate, defaults }: Args
): Promise<LegacyJournal[]> {
  const shipments = await legacyShipments(
    trx,
    { companyId, cutoverDate },
    {
      sourceDocument: "Sales Order",
      journalDocumentType: "Sales Shipment",
      costDocumentType: "Sales Shipment",
      itemLedgerType: "Sale"
    }
  );
  if (shipments.length === 0) return [];
  const shipmentIds = shipments.map((shipment) => shipment.id);

  const lines = await readByIds(shipmentIds, (ids) =>
    trx
      .selectFrom("shipmentLine")
      .select(["id", "shipmentId", "itemId", "shippedQuantity", "locationId"])
      .where("companyId", "=", companyId)
      .where("shipmentId", "in", ids)
      .orderBy("shipmentId")
      .orderBy("createdAt")
      .orderBy("id")
      .execute()
  );
  const itemIds = lines.map((line) => line.itemId);
  const salesOrders = await readByIds(
    shipments.map((shipment) => shipment.sourceDocumentId),
    (ids) =>
      trx
        .selectFrom("salesOrder")
        .select(["id", "customerId", "customerReference"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  const customers = await readByIds(
    salesOrders.map((order) => order.customerId),
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
  // The cost the shipment relieved per item, stored negative.
  const sales = await readByIds(shipmentIds, (ids) =>
    trx
      .selectFrom("costLedger")
      .select(["documentId", "itemId", sql<number>`sum("cost")`.as("cost")])
      .where("companyId", "=", companyId)
      .where("documentType", "=", "Sales Shipment")
      .where("itemLedgerType", "=", "Sale")
      .where("costLedgerType", "=", "Direct Cost")
      .where("adjustment", "=", false)
      .where("appliesToCostLedgerId", "is", null)
      .where("documentId", "in", ids)
      .groupBy(["documentId", "itemId"])
      .execute()
  );

  const orderById = new Map(salesOrders.map((order) => [order.id, order]));
  const customerTypeById = new Map(
    customers.map((row) => [row.id, row.customerTypeId])
  );
  const costByShipmentItem = new Map(
    sales.map((row) => [`${row.documentId}:${row.itemId}`, -Number(row.cost)])
  );
  const linesByShipment = groupBy(lines, (line) => line.shipmentId);

  return shipments.map((shipment) => {
    const order = shipment.sourceDocumentId
      ? orderById.get(shipment.sourceDocumentId)
      : undefined;
    const customerId = order?.customerId ?? null;
    const shippedLines = (linesByShipment.get(shipment.id) ?? []).filter(
      (line) =>
        line.itemId &&
        shippedQuantity(line.shippedQuantity) > 0 &&
        (itemById.get(line.itemId)?.itemTrackingType ?? "Inventory") !==
          "Non-Inventory"
    );

    // Each item's cost, shared by quantity; the last line takes the rest.
    const costByLine = new Map<string, number>();
    for (const group of groupBy(shippedLines, (line) =>
      String(line.itemId)
    ).values()) {
      const total =
        costByShipmentItem.get(`${shipment.id}:${group[0]!.itemId}`) ?? 0;
      const totalQuantity = group.reduce(
        (sum, line) => sum + round(shippedQuantity(line.shippedQuantity)),
        0
      );
      let assigned = 0;
      group.forEach((line, index) => {
        const lineCost =
          index === group.length - 1
            ? total - assigned
            : (round(shippedQuantity(line.shippedQuantity)) / totalQuantity) *
              total;
        assigned += lineCost;
        costByLine.set(line.id, lineCost);
      });
    }

    const journalLines: LegacyJournalLine[] = [];
    for (const line of shippedLines) {
      const itemId = line.itemId as string;
      const cost = costByLine.get(line.id) ?? 0;
      const inventory = resolveInventoryAccount(
        itemById.get(itemId)?.replenishmentSystem ?? null,
        defaults
      );
      const keys = {
        quantity: round(shippedQuantity(line.shippedQuantity)),
        documentType: "Sales Shipment" as const,
        documentId: shipment.id,
        externalDocumentId: order?.customerReference ?? null,
        documentLineReference: journalReference.to.shipment(line.id),
        journalLineReference: nanoid(),
        dimensions: {
          Customer: customerId,
          CustomerType: customerId
            ? (customerTypeById.get(customerId) ?? null)
            : null,
          Item: itemId,
          ItemPostingGroup: postingGroupByItem.get(itemId) ?? null,
          Location: line.locationId ?? shipment.locationId
        }
      };
      journalLines.push(
        {
          ...keys,
          accountId: defaults.costOfGoodsSoldAccount,
          description: "Cost of Goods Sold",
          amount: round(debit("expense", cost))
        },
        {
          ...keys,
          accountId: inventory.account,
          description: inventory.description,
          amount: round(credit("asset", cost))
        }
      );
    }

    return {
      description: `Sales Shipment ${shipment.shipmentId}`,
      postingDate: String(shipment.postingDate),
      sourceType: "Sales Shipment" as const,
      lines: journalLines
    };
  });
}

/** Sales and purchase return shipments, in that order. */
export async function buildLegacyReturnShipmentJournals(
  trx: KyselyTx,
  { companyId, cutoverDate, defaults }: Args
): Promise<LegacyJournal[]> {
  const salesReturns = await legacyShipments(
    trx,
    { companyId, cutoverDate },
    {
      sourceDocument: "Sales Return Order",
      journalDocumentType: "Return Order",
      costDocumentType: "Sales Return Shipment",
      itemLedgerType: "Sale"
    }
  );
  const purchaseReturns = await legacyShipments(
    trx,
    { companyId, cutoverDate },
    {
      sourceDocument: "Purchase Return Order",
      journalDocumentType: "Return Order",
      costDocumentType: "Purchase Return Shipment",
      itemLedgerType: "Purchase"
    }
  );
  if (salesReturns.length === 0 && purchaseReturns.length === 0) return [];
  const shipmentIds = [...salesReturns, ...purchaseReturns].map(
    (shipment) => shipment.id
  );

  // The cost rows, in the order the posting wrote them.
  const rows = await readByIds(shipmentIds, (ids) =>
    trx
      .selectFrom("costLedger")
      .select(["documentId", "documentType", "itemId", "quantity", "cost"])
      .where("companyId", "=", companyId)
      .where((eb) =>
        eb.or([
          eb.and([
            eb("documentType", "=", "Sales Return Shipment"),
            eb("itemLedgerType", "=", "Sale")
          ]),
          eb.and([
            eb("documentType", "=", "Purchase Return Shipment"),
            eb("itemLedgerType", "=", "Purchase")
          ])
        ])
      )
      .where("costLedgerType", "=", "Direct Cost")
      .where("adjustment", "=", false)
      .where("appliesToCostLedgerId", "is", null)
      .where("quantity", "<", 0)
      .where("documentId", "in", ids)
      .orderBy("entryNumber")
      .execute()
  );
  const itemIds = rows.map((row) => row.itemId);
  const itemById = await readItems(trx, companyId, itemIds);
  const postingGroupByItem = await readPostingGroups(trx, companyId, itemIds);
  const salesReturnOrders = await readByIds(
    salesReturns.map((shipment) => shipment.sourceDocumentId),
    (ids) =>
      trx
        .selectFrom("salesReturnOrder")
        .select(["id", "customerId"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  const purchaseReturnOrders = await readByIds(
    purchaseReturns.map((shipment) => shipment.sourceDocumentId),
    (ids) =>
      trx
        .selectFrom("purchaseReturnOrder")
        .select(["id", "supplierId"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  const customers = await readByIds(
    salesReturnOrders.map((order) => order.customerId),
    (ids) =>
      trx
        .selectFrom("customer")
        .select(["id", "customerTypeId"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  const suppliers = await readByIds(
    purchaseReturnOrders.map((order) => order.supplierId),
    (ids) =>
      trx
        .selectFrom("supplier")
        .select(["id", "supplierTypeId"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );

  const customerByOrder = new Map(
    salesReturnOrders.map((order) => [order.id, order.customerId])
  );
  const supplierByOrder = new Map(
    purchaseReturnOrders.map((order) => [order.id, order.supplierId])
  );
  const customerTypeById = new Map(
    customers.map((row) => [row.id, row.customerTypeId])
  );
  const supplierTypeById = new Map(
    suppliers.map((row) => [row.id, row.supplierTypeId])
  );
  const rowsByShipment = groupBy(rows, (row) => String(row.documentId));

  const build = (
    shipment: (typeof salesReturns)[number],
    isSalesReturn: boolean
  ): LegacyJournal => {
    const party = isSalesReturn
      ? (() => {
          const customerId = shipment.sourceDocumentId
            ? (customerByOrder.get(shipment.sourceDocumentId) ?? null)
            : null;
          return {
            Customer: customerId,
            CustomerType: customerId
              ? (customerTypeById.get(customerId) ?? null)
              : null
          };
        })()
      : (() => {
          const supplierId = shipment.sourceDocumentId
            ? (supplierByOrder.get(shipment.sourceDocumentId) ?? null)
            : null;
          return {
            Supplier: supplierId,
            SupplierType: supplierId
              ? (supplierTypeById.get(supplierId) ?? null)
              : null
          };
        })();
    const journalLines: LegacyJournalLine[] = [];
    for (const row of rowsByShipment.get(shipment.id) ?? []) {
      const cost = -Number(row.cost);
      // A return carried at nothing posts no journal.
      if (!(cost > 0)) continue;
      const itemId = row.itemId as string;
      const inventory = resolveInventoryAccount(
        itemById.get(itemId)?.replenishmentSystem ?? null,
        defaults
      );
      const keys = {
        quantity: round(-Number(row.quantity)),
        documentType: "Return Order" as const,
        documentId: shipment.id,
        documentLineReference: journalReference.to.shipment(shipment.id),
        journalLineReference: nanoid(),
        dimensions: {
          Item: itemId,
          ItemPostingGroup: postingGroupByItem.get(itemId) ?? null,
          Location: shipment.locationId,
          ...party
        }
      };
      journalLines.push(
        isSalesReturn
          ? {
              ...keys,
              accountId: defaults.costOfGoodsSoldAccount,
              description: "Cost of Goods Sold",
              amount: round(debit("expense", cost))
            }
          : {
              ...keys,
              accountId: defaults.goodsReceivedNotInvoicedAccount,
              description: "Goods Received Not Invoiced",
              amount: round(debit("liability", cost))
            },
        {
          ...keys,
          accountId: inventory.account,
          description: inventory.description,
          amount: round(credit("asset", cost))
        }
      );
    }
    return isSalesReturn
      ? {
          description: `Return Shipment ${shipment.shipmentId}`,
          postingDate: String(shipment.postingDate),
          sourceType: "Sales Return Shipment",
          lines: journalLines
        }
      : {
          description: `Purchase Return Shipment ${shipment.shipmentId}`,
          postingDate: String(shipment.postingDate),
          sourceType: "Purchase Return Shipment",
          lines: journalLines
        };
  };

  return [
    ...salesReturns.map((shipment) => build(shipment, true)),
    ...purchaseReturns.map((shipment) => build(shipment, false))
  ];
}

/** A shipped quantity as the posting reads it: NaN and null are 0. */
function shippedQuantity(value: number | null): number {
  const quantity = Number(value ?? 0);
  return Number.isNaN(quantity) ? 0 : quantity;
}
