// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The journals of legacy shipments that stored a cost row: the lines
// `post-shipment` writes today, at the cost the rows stored, with today's
// account defaults (.ai/specs/implemented/2026-10-08-accounting-cutover.md section 5a).
//
// The lines come from the posting's own builders
// (`post-shipment/posting-lines.ts`); this file only gathers their facts:
// - a sales order shipment with its "Sale" cost row (stored by a posting with
//   accounting on, or written by the enable first, movement-cost.ts): the
//   cost rows give each item's relieved cost. A fixed asset line is not
//   rebuilt: the asset register carries it;
// - a sales or purchase return shipment: one pair per cost row
//   (`shipmentCostRows`), in the order the posting wrote them.

import type { Database } from "@carbon/database";
import type { KyselyTx } from "@carbon/database/client";
import {
  LEGACY_PURCHASE_RETURN_SHIPMENT,
  LEGACY_SALES_RETURN_SHIPMENT,
  LEGACY_SALES_SHIPMENT,
  type LegacyShipmentKind,
  legacyShipments,
  shipmentCostRows
} from "@carbon/database/legacy-documents";
import { sql } from "kysely";
import {
  buildReturnShipmentJournal,
  buildSalesShipmentJournal
} from "../../post-shipment/posting-lines";
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

export async function buildLegacySalesShipmentJournals(
  trx: KyselyTx,
  { companyId, cutoverDate, defaults }: Args
): Promise<LegacyJournal[]> {
  const shipments = await legacyShipments(
    trx,
    { companyId, cutoverDate },
    LEGACY_SALES_SHIPMENT
  ).execute();
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
    shipmentCostRows(trx, companyId, LEGACY_SALES_SHIPMENT)
      .select([
        "cost.documentId",
        "cost.itemId",
        sql<number>`sum("cost"."cost")`.as("cost")
      ])
      .where("cost.documentId", "in", ids)
      .groupBy(["cost.documentId", "cost.itemId"])
      .execute()
  );

  const orderById = new Map(salesOrders.map((order) => [order.id, order]));
  const customerTypeById = new Map(
    customers.map((row) => [row.id, row.customerTypeId])
  );
  const relievedCostByShipment = new Map(
    [...Map.groupBy(sales, (row) => row.documentId)].map(
      ([shipmentId, rows]) => [
        shipmentId,
        new Map(rows.map((row) => [String(row.itemId), -Number(row.cost)]))
      ]
    )
  );
  const linesByShipment = Map.groupBy(lines, (line) => line.shipmentId);

  return shipments.map((shipment) => {
    const order = shipment.sourceDocumentId
      ? orderById.get(shipment.sourceDocumentId)
      : undefined;
    const customerId = order?.customerId ?? null;
    const journal = buildSalesShipmentJournal({
      shipmentId: shipment.id,
      shipmentReadableId: shipment.shipmentId,
      externalDocumentId: order?.customerReference ?? null,
      customerId,
      customerTypeId: customerId
        ? (customerTypeById.get(customerId) ?? null)
        : null,
      defaults,
      lines: (linesByShipment.get(shipment.id) ?? []).map((line) => {
        const item = line.itemId ? itemById.get(line.itemId) : undefined;
        return {
          shipmentLineId: line.id,
          itemId: line.itemId,
          shippedQuantity: postedQuantity(line.shippedQuantity),
          itemTrackingType: item?.itemTrackingType ?? null,
          replenishmentSystem: item?.replenishmentSystem ?? null,
          itemPostingGroupId: line.itemId
            ? (postingGroupByItem.get(line.itemId) ?? null)
            : null,
          locationId: line.locationId ?? shipment.locationId
        };
      }),
      relievedCostByItem: relievedCostByShipment.get(shipment.id) ?? new Map(),
      // Not rebuilt: the asset register carries a fixed asset sale.
      fixedAssetSales: []
    });
    return { ...journal, postingDate: String(shipment.postingDate) };
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
    LEGACY_SALES_RETURN_SHIPMENT
  ).execute();
  const purchaseReturns = await legacyShipments(
    trx,
    { companyId, cutoverDate },
    LEGACY_PURCHASE_RETURN_SHIPMENT
  ).execute();
  if (salesReturns.length === 0 && purchaseReturns.length === 0) return [];

  // The cost rows, in the order the posting wrote them.
  const costRows = (ids: string[], kind: LegacyShipmentKind) =>
    shipmentCostRows(trx, companyId, kind)
      .select(["cost.documentId", "cost.itemId", "cost.quantity", "cost.cost"])
      .where("cost.documentId", "in", ids)
      .where("cost.itemId", "is not", null)
      .$narrowType<{ documentId: string; itemId: string }>()
      .orderBy("cost.entryNumber")
      .execute();
  const rows = [
    ...(await readByIds(
      salesReturns.map((shipment) => shipment.id),
      (ids) => costRows(ids, LEGACY_SALES_RETURN_SHIPMENT)
    )),
    ...(await readByIds(
      purchaseReturns.map((shipment) => shipment.id),
      (ids) => costRows(ids, LEGACY_PURCHASE_RETURN_SHIPMENT)
    ))
  ];
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
  const rowsByShipment = Map.groupBy(rows, (row) => row.documentId);

  const build = (
    shipment: (typeof salesReturns)[number],
    sourceDocument: "Sales Return Order" | "Purchase Return Order"
  ): LegacyJournal => {
    const isSalesReturn = sourceDocument === "Sales Return Order";
    const orderParty = isSalesReturn ? customerByOrder : supplierByOrder;
    const partyTypeById = isSalesReturn ? customerTypeById : supplierTypeById;
    const partyId = shipment.sourceDocumentId
      ? (orderParty.get(shipment.sourceDocumentId) ?? null)
      : null;
    const journal = buildReturnShipmentJournal({
      sourceDocument,
      shipmentId: shipment.id,
      shipmentReadableId: shipment.shipmentId,
      locationId: shipment.locationId,
      partyId,
      partyTypeId: partyId ? (partyTypeById.get(partyId) ?? null) : null,
      defaults,
      items: (rowsByShipment.get(shipment.id) ?? []).map((row) => ({
        itemId: row.itemId,
        quantity: -Number(row.quantity),
        cost: -Number(row.cost),
        replenishmentSystem:
          itemById.get(row.itemId)?.replenishmentSystem ?? null,
        itemPostingGroupId: postingGroupByItem.get(row.itemId) ?? null
      }))
    });
    return { ...journal, postingDate: String(shipment.postingDate) };
  };

  return [
    ...salesReturns.map((shipment) => build(shipment, "Sales Return Order")),
    ...purchaseReturns.map((shipment) =>
      build(shipment, "Purchase Return Order")
    )
  ];
}
