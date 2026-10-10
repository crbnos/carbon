// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The journal lines of a posted shipment, built from plain facts. Used by
// `post-shipment` and by the accounting cutover's legacy backfill
// (`activate-accounting/legacy/shipment.ts`), so a rebuilt journal has the
// lines the posting writes. No database access: the caller relieves the cost
// (`calculateCOGS`, or the stored cost rows) and passes the result in.
//
// The enable's re-cost finds the inventory credit and its debit pair by
// `journalLineReference`, so every pair shares one reference, at zero cost
// too.

import type { Database } from "@carbon/database";
import { journalReference } from "@carbon/database";
import { credit, debit, round } from "@carbon/utils";
import { nanoid } from "nanoid";
import { resolveInventoryAccount } from "../lib/get-posting-group";
import type { JournalLineDimensionValues } from "../lib/journal-line-dimensions";

type Enums = Database["public"]["Enums"];
type JournalLineInsert = Database["public"]["Tables"]["journalLine"]["Insert"];

/** One line before it has a journal, and its dimension values by entity
 *  type, in the order the posting writes them. A null value writes none. */
export type ShipmentJournalLine = Omit<
  JournalLineInsert,
  "journalId" | "companyId" | "createdBy"
> & {
  dimensions: JournalLineDimensionValues;
};

export type ShipmentJournal = {
  description: string;
  sourceType: Enums["journalEntrySourceType"];
  lines: ShipmentJournalLine[];
};

export type ShipmentAccountDefaults = Pick<
  Database["public"]["Tables"]["accountDefault"]["Row"],
  | "costOfGoodsSoldAccount"
  | "goodsReceivedNotInvoicedAccount"
  | "rawMaterialsAccount"
  | "finishedGoodsAccount"
>;

/** A sales order shipment line and the facts of its item. */
export type SalesShipmentLine = {
  shipmentLineId: string;
  itemId: string | null;
  /** The shipped quantity, with null and NaN read as 0. */
  shippedQuantity: number;
  itemTrackingType: Enums["itemTrackingType"] | null;
  replenishmentSystem: Enums["itemReplenishmentSystem"] | null;
  itemPostingGroupId: string | null;
  /** The line's location, else the shipment's. */
  locationId: string | null;
};

/** A fixed asset sold on the sales order and shipped with this shipment. */
export type FixedAssetSale = {
  salesOrderLineId: string;
  acquisitionCost: number;
  accumulatedDepreciation: number;
  assetAccountId: string;
  accumulatedDepreciationAccountId: string;
  /** Used as a disposal clearing account: the net book value parks here
   *  until the invoice recognizes the proceeds. */
  writeOffAccountId: string;
  locationId: string | null;
  fixedAssetClassId: string | null;
};

type CostedLine = SalesShipmentLine & { itemId: string; quantity: number };

/** The lines that carry a COGS pair: an item, a positive shipped quantity,
 *  and stock (not Non-Inventory). `quantity` is the rounded shipped quantity
 *  the pair carries. */
function costedLines(lines: SalesShipmentLine[]): CostedLine[] {
  return lines.flatMap((line) =>
    line.itemId &&
    line.shippedQuantity > 0 &&
    line.itemTrackingType !== "Non-Inventory"
      ? [
          {
            ...line,
            itemId: line.itemId,
            quantity: round(line.shippedQuantity)
          }
        ]
      : []
  );
}

/**
 * Each item's shipped quantity across its costed lines, in first-line order:
 * the quantity the posting relieves per item (`calculateCOGS`).
 */
export function shippedQuantityByItem(
  lines: SalesShipmentLine[]
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const line of costedLines(lines)) {
    totals.set(line.itemId, (totals.get(line.itemId) ?? 0) + line.quantity);
  }
  return totals;
}

/** The net book value a fixed asset leaves the books at. */
export function netBookValue(
  asset: Pick<FixedAssetSale, "acquisitionCost" | "accumulatedDepreciation">
): number {
  return asset.acquisitionCost - asset.accumulatedDepreciation;
}

/**
 * A sales order shipment: per costed line, COGS against inventory on
 * `shipment:<shipmentLineId>`. An item's relieved cost is shared across its
 * lines by quantity, the last line taking the remainder. Then, per fixed
 * asset sold, the accumulated depreciation cleared, the net book value moved
 * to disposal clearing, and the asset removed at cost.
 */
export function buildSalesShipmentJournal({
  shipmentId,
  shipmentReadableId,
  externalDocumentId,
  customerId,
  customerTypeId,
  defaults,
  lines,
  relievedCostByItem,
  fixedAssetSales
}: {
  shipmentId: string;
  shipmentReadableId: string;
  externalDocumentId: string | null;
  customerId: string | null;
  customerTypeId: string | null;
  defaults: ShipmentAccountDefaults;
  lines: SalesShipmentLine[];
  /** The cost each item's shipment relieved, positive. */
  relievedCostByItem: ReadonlyMap<string, number>;
  fixedAssetSales: FixedAssetSale[];
}): ShipmentJournal {
  const costed = costedLines(lines);
  const totalQuantityByItem = shippedQuantityByItem(lines);

  const costByLine = new Map<string, number>();
  for (const [itemId, group] of Map.groupBy(costed, (line) => line.itemId)) {
    const total = relievedCostByItem.get(itemId) ?? 0;
    const totalQuantity = totalQuantityByItem.get(itemId) ?? 0;
    let assigned = 0;
    group.forEach((line, index) => {
      const lineCost =
        index === group.length - 1
          ? total - assigned
          : (line.quantity / totalQuantity) * total;
      assigned += lineCost;
      costByLine.set(line.shipmentLineId, lineCost);
    });
  }

  const document = {
    documentType: "Sales Shipment" as const,
    documentId: shipmentId,
    externalDocumentId
  };
  const journalLines: ShipmentJournalLine[] = [];

  for (const line of costed) {
    const cost = costByLine.get(line.shipmentLineId) ?? 0;
    const inventory = resolveInventoryAccount(
      line.replenishmentSystem,
      defaults
    );
    const keys = {
      ...document,
      quantity: line.quantity,
      documentLineReference: journalReference.to.shipment(line.shipmentLineId),
      journalLineReference: nanoid(),
      dimensions: {
        Customer: customerId,
        CustomerType: customerTypeId,
        Item: line.itemId,
        ItemPostingGroup: line.itemPostingGroupId,
        Location: line.locationId
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

  for (const asset of fixedAssetSales) {
    const nbv = netBookValue(asset);
    const keys = {
      ...document,
      quantity: 1,
      documentLineReference: journalReference.to.shipment(
        asset.salesOrderLineId
      ),
      dimensions: {
        Customer: customerId,
        CustomerType: customerTypeId,
        Location: asset.locationId,
        FixedAssetClass: asset.fixedAssetClassId
      }
    };
    if (asset.accumulatedDepreciation > 0) {
      journalLines.push({
        ...keys,
        accountId: asset.accumulatedDepreciationAccountId,
        description: "Clear accumulated depreciation",
        amount: round(debit("asset", asset.accumulatedDepreciation)),
        journalLineReference: nanoid()
      });
    }
    if (nbv > 0) {
      journalLines.push({
        ...keys,
        accountId: asset.writeOffAccountId,
        description: "Transfer net book value to disposal clearing",
        amount: round(debit("expense", nbv)),
        journalLineReference: nanoid()
      });
    }
    journalLines.push({
      ...keys,
      accountId: asset.assetAccountId,
      description: "Remove asset at cost",
      amount: round(credit("asset", asset.acquisitionCost)),
      journalLineReference: nanoid()
    });
  }

  return {
    description: `Sales Shipment ${shipmentReadableId}`,
    sourceType: "Sales Shipment",
    lines: journalLines
  };
}

/** An item a return shipment relieved: its quantity and cost, positive. */
export type ReturnShipmentItem = {
  itemId: string;
  quantity: number;
  cost: number;
  replenishmentSystem: Enums["itemReplenishmentSystem"] | null;
  itemPostingGroupId: string | null;
};

/**
 * A return shipment: per item, one pair against inventory on
 * `shipment:<shipmentId>`, at zero cost too. A sales return (back to the
 * customer) debits COGS; a purchase return (back to the supplier) debits
 * GR/IR, reversing the receipt.
 */
export function buildReturnShipmentJournal({
  sourceDocument,
  shipmentId,
  shipmentReadableId,
  locationId,
  partyId,
  partyTypeId,
  defaults,
  items
}: {
  sourceDocument: "Sales Return Order" | "Purchase Return Order";
  shipmentId: string;
  shipmentReadableId: string;
  locationId: string | null;
  /** The customer of a sales return, the supplier of a purchase return. */
  partyId: string | null;
  partyTypeId: string | null;
  defaults: ShipmentAccountDefaults;
  items: ReturnShipmentItem[];
}): ShipmentJournal {
  const isSalesReturn = sourceDocument === "Sales Return Order";
  const party = isSalesReturn
    ? { Customer: partyId, CustomerType: partyTypeId }
    : { Supplier: partyId, SupplierType: partyTypeId };

  const lines = items.flatMap((item): ShipmentJournalLine[] => {
    const inventory = resolveInventoryAccount(
      item.replenishmentSystem,
      defaults
    );
    const keys = {
      quantity: round(item.quantity),
      documentType: "Return Order" as const,
      documentId: shipmentId,
      documentLineReference: journalReference.to.shipment(shipmentId),
      journalLineReference: nanoid(),
      dimensions: {
        Item: item.itemId,
        ItemPostingGroup: item.itemPostingGroupId,
        Location: locationId,
        ...party
      }
    };
    return [
      isSalesReturn
        ? {
            ...keys,
            accountId: defaults.costOfGoodsSoldAccount,
            description: "Cost of Goods Sold",
            amount: round(debit("expense", item.cost))
          }
        : {
            ...keys,
            accountId: defaults.goodsReceivedNotInvoicedAccount,
            description: "Goods Received Not Invoiced",
            amount: round(debit("liability", item.cost))
          },
      {
        ...keys,
        accountId: inventory.account,
        description: inventory.description,
        amount: round(credit("asset", item.cost))
      }
    ];
  });

  return isSalesReturn
    ? {
        description: `Return Shipment ${shipmentReadableId}`,
        sourceType: "Sales Return Shipment",
        lines
      }
    : {
        description: `Purchase Return Shipment ${shipmentReadableId}`,
        sourceType: "Purchase Return Shipment",
        lines
      };
}
