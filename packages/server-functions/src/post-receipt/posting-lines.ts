// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The journal lines of a receipt, from plain facts. No I/O. `post-receipt`
// and the legacy backfill of the accounting enable
// (activate-accounting/legacy/receipt.ts) both build through here, so a
// rebuilt receipt journal is the one the posting writes.
//
// - A purchase order receipt line books inventory (indirect cost for a
//   Non-Inventory item, WIP for outside processing) against GR/IR on
//   `receipt:<poLineId>` with the received quantity, which the purchase
//   invoice's GR/IR walk reads. A negative line reverses the pair. A fixed
//   asset line books the asset class's account against GR/IR.
// - A sales return receipt line books inventory against COGS at its
//   re-entry value. A line with no value books nothing.

import { type Database, journalReference } from "@carbon/database";
import { credit, debit, round } from "@carbon/utils";
import { nanoid } from "nanoid";
import { resolveInventoryAccount } from "../lib/get-posting-group";
import type { JournalLineDimensionValues } from "../lib/journal-line-dimensions";

type Enums = Database["public"]["Enums"];
type AccountDefaults = Database["public"]["Tables"]["accountDefault"]["Row"];
type JournalLineInsert = Database["public"]["Tables"]["journalLine"]["Insert"];

/** A journal line and its dimension values, by entity type. The caller adds
 *  the journal and the company. */
export type ReceiptJournalLine = Omit<
  JournalLineInsert,
  "journalId" | "companyId" | "createdBy"
> & {
  dimensions: JournalLineDimensionValues;
};

/** One purchase order receipt line, as the posting reads it. */
export type PurchaseReceiptLine = {
  purchaseOrderLineId: string | null;
  itemId: string | null;
  /** Signed. Null and NaN are read as 0 by the caller. */
  quantity: number;
  unitPrice: number | null;
  /** No item, or an item with no tracking type, is Inventory. */
  itemTrackingType: Enums["itemTrackingType"] | null | undefined;
  replenishmentSystem: Enums["itemReplenishmentSystem"] | null | undefined;
  itemPostingGroupId: string | null;
  locationId: string | null;
  /** The process of an outside processing line's job operation. */
  processId: string | null;
};

/** What a purchase order line was invoiced before it was received. */
export type InvoiceFirstBasis = {
  /** Invoiced and not yet received, in inventory units, per PO line. */
  quantity: Map<string, number>;
  /** The unit cost the invoice accrued on GR/IR, per PO line. */
  unitCost: Map<string, number>;
};

export type PurchaseReceiptLineCost = {
  quantity: number;
  /** The line puts stock on (or takes it off) a cost layer. */
  createsLayers: boolean;
  /** Price × quantity and the line's share of the order's shipping. */
  poCost: number;
  /** The quantity claimed by an invoice posted before the receipt, valued at
   *  the invoice's accrual cost. Positive lines only. */
  invoiceFirstQuantity: number;
  invoiceFirstCost: number;
  /** The rest of the line, at its PO unit cost. */
  normalQuantity: number;
  normalCost: number;
  /** What the line books: the PO cost of a negative line, the invoice-first
   *  and normal portions of a positive one. */
  cost: number;
};

function trackingType(line: Pick<PurchaseReceiptLine, "itemTrackingType">) {
  return line.itemTrackingType ?? "Inventory";
}

/**
 * The cost of each line, in the order given. The shipping is shared by each
 * line's PO value. A positive line first claims the quantity its PO line was
 * invoiced before receipt, at the accrual unit cost; a later line of the same
 * PO line claims what is left. A missing accrual cost claims nothing.
 */
export function purchaseReceiptLineCosts(
  lines: PurchaseReceiptLine[],
  {
    shippingCost,
    isOutsideProcessing,
    invoiceFirst
  }: {
    /** In base currency. */
    shippingCost: number;
    isOutsideProcessing: boolean;
    invoiceFirst?: InvoiceFirstBasis;
  }
): PurchaseReceiptLineCost[] {
  const totalLinesCost = lines.reduce(
    (sum, line) => sum + Math.abs(line.quantity) * (line.unitPrice ?? 0),
    0
  );
  const unclaimed = new Map(invoiceFirst?.quantity);
  return lines.map((line) => {
    const absQuantity = Math.abs(line.quantity);
    const lineCost = absQuantity * (line.unitPrice ?? 0);
    const share = totalLinesCost === 0 ? 0 : lineCost / totalLinesCost;
    const poCost = lineCost + shippingCost * share;
    const poUnitCost = absQuantity > 0 ? poCost / absQuantity : 0;

    let invoiceFirstQuantity = 0;
    let accrualUnitCost = 0;
    const poLineId = line.purchaseOrderLineId;
    if (line.quantity >= 0 && poLineId && unclaimed.has(poLineId)) {
      const remaining = unclaimed.get(poLineId)!;
      const claimed = Math.min(absQuantity, remaining);
      const unitCost = invoiceFirst?.unitCost.get(poLineId);
      // A recorded accrual is claimed even at zero unit cost (a zero-priced
      // invoice); only a missing one leaves the line at PO cost.
      if (claimed > 0 && unitCost !== undefined) {
        invoiceFirstQuantity = claimed;
        accrualUnitCost = unitCost;
        unclaimed.set(poLineId, remaining - claimed);
      }
    }
    const invoiceFirstCost = invoiceFirstQuantity * accrualUnitCost;
    const normalQuantity = absQuantity - invoiceFirstQuantity;
    const normalCost = normalQuantity * poUnitCost;

    return {
      quantity: line.quantity,
      createsLayers:
        trackingType(line) !== "Non-Inventory" &&
        !isOutsideProcessing &&
        Boolean(line.itemId) &&
        absQuantity > 0,
      poCost,
      invoiceFirstQuantity,
      invoiceFirstCost,
      normalQuantity,
      normalCost,
      cost: line.quantity < 0 ? poCost : invoiceFirstCost + normalCost
    };
  });
}

/** A fixed asset purchase order line received on the receipt. */
export type FixedAssetReceiptLine = {
  purchaseOrderLineId: string;
  quantity: number;
  cost: number;
  /** The asset class's asset account. */
  assetAccountId: string;
  fixedAssetClassId: string | null;
  locationId: string | null;
};

/**
 * The journal lines of a purchase order receipt: one pair per receipt line
 * with a quantity, then one pair per fixed asset line. A line books `cost`:
 * the cost its layers relieved or stored when the caller knows it, else its
 * `purchaseReceiptLineCosts` cost.
 */
export function buildPurchaseReceiptJournalLines({
  documentId,
  externalDocumentId,
  isOutsideProcessing,
  supplierId,
  supplierTypeId,
  accounts,
  lines,
  fixedAssets
}: {
  documentId: string;
  /** The supplier's reference on the purchase order. */
  externalDocumentId: string | null;
  isOutsideProcessing: boolean;
  supplierId: string | null;
  supplierTypeId: string | null;
  accounts: Pick<
    AccountDefaults,
    | "goodsReceivedNotInvoicedAccount"
    | "workInProgressAccount"
    | "indirectCostAccount"
    | "rawMaterialsAccount"
    | "finishedGoodsAccount"
  >;
  lines: (PurchaseReceiptLine & { cost: number })[];
  fixedAssets: FixedAssetReceiptLine[];
}): ReceiptJournalLine[] {
  const journalLines: ReceiptJournalLine[] = [];
  const pair = (
    purchaseOrderLineId: string | null,
    quantity: number,
    dimensions: ReceiptJournalLine["dimensions"]
  ) => ({
    quantity: round(quantity),
    documentType: "Receipt" as const,
    documentId,
    externalDocumentId: externalDocumentId ?? undefined,
    documentLineReference: journalReference.to.receipt(
      String(purchaseOrderLineId)
    ),
    journalLineReference: nanoid(),
    dimensions
  });
  const goodsReceived = {
    accountId: accounts.goodsReceivedNotInvoicedAccount,
    description: "Goods Received Not Invoiced"
  };

  for (const line of lines) {
    const absQuantity = Math.abs(line.quantity);
    if (absQuantity <= 0) continue;

    let debitSide: { accountId: string; description: string };
    if (trackingType(line) !== "Non-Inventory" && !isOutsideProcessing) {
      const inventory = resolveInventoryAccount(
        line.replenishmentSystem ?? null,
        accounts
      );
      debitSide = {
        accountId: inventory.account,
        description: inventory.description
      };
    } else if (isOutsideProcessing) {
      debitSide = {
        accountId: accounts.workInProgressAccount,
        description: "WIP Account"
      };
    } else {
      debitSide = {
        accountId: accounts.indirectCostAccount,
        description: "Indirect Cost Account"
      };
    }

    const keys = pair(line.purchaseOrderLineId, absQuantity, {
      SupplierType: supplierTypeId,
      ItemPostingGroup: line.itemPostingGroupId,
      Item: line.itemId,
      Supplier: supplierId,
      Location: line.locationId,
      Process: line.processId
    });
    if (line.quantity < 0) {
      journalLines.push(
        {
          ...goodsReceived,
          ...keys,
          amount: round(debit("liability", line.cost))
        },
        { ...debitSide, ...keys, amount: round(credit("asset", line.cost)) }
      );
    } else {
      journalLines.push(
        { ...debitSide, ...keys, amount: round(debit("asset", line.cost)) },
        {
          ...goodsReceived,
          ...keys,
          amount: round(credit("liability", line.cost))
        }
      );
    }
  }

  for (const asset of fixedAssets) {
    const keys = pair(asset.purchaseOrderLineId, asset.quantity, {
      SupplierType: supplierTypeId,
      ItemPostingGroup: null,
      Item: null,
      Supplier: supplierId,
      Location: asset.locationId,
      Process: null,
      FixedAssetClass: asset.fixedAssetClassId
    });
    journalLines.push(
      {
        accountId: asset.assetAccountId,
        description: "Fixed Asset Acquisition",
        ...keys,
        amount: round(debit("asset", asset.cost))
      },
      {
        ...goodsReceived,
        ...keys,
        amount: round(credit("liability", asset.cost))
      }
    );
  }
  return journalLines;
}

/** One sales return receipt line and the value it re-enters stock at. */
export type SalesReturnReceiptLine = {
  /** The sales return order line. */
  returnLineId: string;
  itemId: string;
  quantity: number;
  cost: number;
  replenishmentSystem: Enums["itemReplenishmentSystem"] | null | undefined;
  itemPostingGroupId: string | null;
  locationId: string | null;
};

/** The journal lines of a sales return receipt: inventory against COGS per
 *  line with a value. A zero-value re-entry books nothing. */
export function buildSalesReturnReceiptJournalLines({
  documentId,
  externalDocumentId,
  customerId,
  customerTypeId,
  accounts,
  lines
}: {
  documentId: string;
  /** The receipt's own external document id. */
  externalDocumentId: string | null;
  customerId: string | null;
  customerTypeId: string | null;
  accounts: Pick<
    AccountDefaults,
    "costOfGoodsSoldAccount" | "rawMaterialsAccount" | "finishedGoodsAccount"
  >;
  lines: SalesReturnReceiptLine[];
}): ReceiptJournalLine[] {
  return lines.flatMap((line) => {
    if (!(line.cost > 0)) return [];
    const inventory = resolveInventoryAccount(
      line.replenishmentSystem ?? null,
      accounts
    );
    const keys = {
      quantity: round(line.quantity),
      documentType: "Receipt" as const,
      documentId,
      externalDocumentId: externalDocumentId ?? undefined,
      documentLineReference: journalReference.to.receipt(line.returnLineId),
      journalLineReference: nanoid(),
      dimensions: {
        Item: line.itemId,
        ItemPostingGroup: line.itemPostingGroupId,
        Location: line.locationId,
        Customer: customerId,
        CustomerType: customerTypeId
      }
    };
    return [
      {
        accountId: inventory.account,
        description: inventory.description,
        ...keys,
        amount: round(debit("asset", line.cost))
      },
      {
        accountId: accounts.costOfGoodsSoldAccount,
        description: "Cost of Goods Sold",
        ...keys,
        amount: round(credit("expense", line.cost))
      }
    ];
  });
}
