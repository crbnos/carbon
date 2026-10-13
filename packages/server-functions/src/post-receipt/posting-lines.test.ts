// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { journalLineDimensionRows } from "../lib/journal-line-dimensions";
import {
  buildPurchaseReceiptJournalLines,
  buildSalesReturnReceiptJournalLines,
  type PurchaseReceiptLine,
  purchaseReceiptLineCosts,
  type ReceiptJournalLine
} from "./posting-lines";

const accounts = {
  goodsReceivedNotInvoicedAccount: "grni",
  workInProgressAccount: "wip",
  indirectCostAccount: "indirect",
  rawMaterialsAccount: "raw",
  finishedGoodsAccount: "finished",
  costOfGoodsSoldAccount: "cogs"
};

function line(overrides: Partial<PurchaseReceiptLine>): PurchaseReceiptLine {
  return {
    purchaseOrderLineId: "pol1",
    itemId: "item1",
    quantity: 5,
    unitPrice: 8,
    itemTrackingType: "Inventory",
    replenishmentSystem: "Buy",
    itemPostingGroupId: "ipg1",
    locationId: "loc1",
    processId: null,
    ...overrides
  };
}

/** Account, amount and quantity of each line, in order. Amounts are signed
 *  by the account's natural balance: a GR/IR credit is positive. */
function summary(lines: ReceiptJournalLine[]) {
  return lines.map(({ accountId, description, amount, quantity }) => ({
    accountId,
    description,
    amount,
    quantity
  }));
}

function purchaseReceipt(
  lines: PurchaseReceiptLine[],
  options: { shippingCost?: number; isOutsideProcessing?: boolean } = {}
) {
  const isOutsideProcessing = options.isOutsideProcessing ?? false;
  const costs = purchaseReceiptLineCosts(lines, {
    shippingCost: options.shippingCost ?? 0,
    isOutsideProcessing
  });
  return buildPurchaseReceiptJournalLines({
    documentId: "rcpt1",
    externalDocumentId: "SUP-REF",
    isOutsideProcessing,
    supplierId: "sup1",
    supplierTypeId: "st1",
    accounts,
    lines: lines.map((receiptLine, index) => ({
      ...receiptLine,
      cost: costs[index]!.cost
    })),
    fixedAssets: []
  });
}

describe("buildPurchaseReceiptJournalLines", () => {
  it("debits inventory and credits GR/IR for a received part, on receipt:<poLineId>", () => {
    const lines = purchaseReceipt([line({})]);

    expect(summary(lines)).toEqual([
      {
        accountId: "raw",
        description: "Raw Materials Account",
        amount: 40,
        quantity: 5
      },
      {
        accountId: "grni",
        description: "Goods Received Not Invoiced",
        amount: 40,
        quantity: 5
      }
    ]);
    for (const journalLine of lines) {
      expect(journalLine).toMatchObject({
        documentType: "Receipt",
        documentId: "rcpt1",
        externalDocumentId: "SUP-REF",
        documentLineReference: "receipt:pol1",
        dimensions: {
          SupplierType: "st1",
          ItemPostingGroup: "ipg1",
          Item: "item1",
          Supplier: "sup1",
          Location: "loc1",
          Process: null
        }
      });
    }
    expect(lines[0]!.journalLineReference).toBe(lines[1]!.journalLineReference);
  });

  it("debits indirect cost for a Non-Inventory item, which creates no layer", () => {
    const lines = [line({ itemTrackingType: "Non-Inventory", unitPrice: 3 })];
    expect(
      purchaseReceiptLineCosts(lines, {
        shippingCost: 0,
        isOutsideProcessing: false
      })[0]!.createsLayers
    ).toBe(false);

    expect(summary(purchaseReceipt(lines))).toEqual([
      {
        accountId: "indirect",
        description: "Indirect Cost Account",
        amount: 15,
        quantity: 5
      },
      {
        accountId: "grni",
        description: "Goods Received Not Invoiced",
        amount: 15,
        quantity: 5
      }
    ]);
  });

  it("debits WIP for outside processing, with each line's share of the shipping", () => {
    // Lines worth 30 and 10 share a shipping cost of 8 as 6 and 2.
    const lines = [
      line({ quantity: 3, unitPrice: 10, processId: "proc1" }),
      line({
        purchaseOrderLineId: "pol2",
        itemId: "item2",
        quantity: 2,
        unitPrice: 5,
        processId: "proc2"
      })
    ];
    const costs = purchaseReceiptLineCosts(lines, {
      shippingCost: 8,
      isOutsideProcessing: true
    });
    expect(costs.map((cost) => cost.createsLayers)).toEqual([false, false]);

    const journalLines = purchaseReceipt(lines, {
      shippingCost: 8,
      isOutsideProcessing: true
    });
    expect(summary(journalLines)).toEqual([
      { accountId: "wip", description: "WIP Account", amount: 36, quantity: 3 },
      {
        accountId: "grni",
        description: "Goods Received Not Invoiced",
        amount: 36,
        quantity: 3
      },
      { accountId: "wip", description: "WIP Account", amount: 12, quantity: 2 },
      {
        accountId: "grni",
        description: "Goods Received Not Invoiced",
        amount: 12,
        quantity: 2
      }
    ]);
    expect(
      journalLines.map((journalLine) => journalLine.dimensions.Process)
    ).toEqual(["proc1", "proc1", "proc2", "proc2"]);
    expect(journalLines[2]!.documentLineReference).toBe("receipt:pol2");
  });

  it("reverses the pair for a negative line, at the cost its layers relieved", () => {
    const lines = [line({ quantity: -2 })];
    const costs = purchaseReceiptLineCosts(lines, {
      shippingCost: 0,
      isOutsideProcessing: false
    });
    // The PO cost is the fallback when no layer gives a cost.
    expect(costs[0]).toMatchObject({ createsLayers: true, cost: 16 });

    const journalLines = buildPurchaseReceiptJournalLines({
      documentId: "rcpt1",
      externalDocumentId: null,
      isOutsideProcessing: false,
      supplierId: "sup1",
      supplierTypeId: null,
      accounts,
      // The layers relieved 18, not the PO cost of 16.
      lines: [{ ...lines[0]!, cost: 18 }],
      fixedAssets: []
    });
    expect(summary(journalLines)).toEqual([
      {
        accountId: "grni",
        description: "Goods Received Not Invoiced",
        amount: -18,
        quantity: 2
      },
      {
        accountId: "raw",
        description: "Raw Materials Account",
        amount: -18,
        quantity: 2
      }
    ]);
    expect(journalLines[0]!.externalDocumentId).toBeUndefined();
  });

  it("values the quantity invoiced before receipt at the accrual cost", () => {
    // 3 of the 5 were invoiced first at 9; the other 2 stay at the PO's 8.
    // A second line of the same PO line finds nothing left to claim.
    const lines = [line({}), line({ quantity: 1 })];
    const costs = purchaseReceiptLineCosts(lines, {
      shippingCost: 0,
      isOutsideProcessing: false,
      invoiceFirst: {
        quantity: new Map([["pol1", 3]]),
        unitCost: new Map([["pol1", 9]])
      }
    });
    expect(costs[0]).toMatchObject({
      invoiceFirstQuantity: 3,
      invoiceFirstCost: 27,
      normalQuantity: 2,
      normalCost: 16,
      cost: 43
    });
    expect(costs[1]).toMatchObject({ invoiceFirstQuantity: 0, cost: 8 });
  });

  it("books a fixed asset line on the asset class's account after the receipt lines", () => {
    const journalLines = buildPurchaseReceiptJournalLines({
      documentId: "rcpt1",
      externalDocumentId: null,
      isOutsideProcessing: false,
      supplierId: "sup1",
      supplierTypeId: "st1",
      accounts,
      lines: [{ ...line({ quantity: 0 }), cost: 0 }],
      fixedAssets: [
        {
          purchaseOrderLineId: "pol9",
          quantity: 1,
          cost: 1200,
          assetAccountId: "fa-asset",
          fixedAssetClassId: "fac1",
          locationId: "loc2"
        }
      ]
    });
    expect(summary(journalLines)).toEqual([
      {
        accountId: "fa-asset",
        description: "Fixed Asset Acquisition",
        amount: 1200,
        quantity: 1
      },
      {
        accountId: "grni",
        description: "Goods Received Not Invoiced",
        amount: 1200,
        quantity: 1
      }
    ]);
    expect(journalLines[0]!.dimensions).toEqual({
      SupplierType: "st1",
      ItemPostingGroup: null,
      Item: null,
      Supplier: "sup1",
      Location: "loc2",
      Process: null,
      FixedAssetClass: "fac1"
    });
  });
});

describe("buildSalesReturnReceiptJournalLines", () => {
  it("debits inventory and credits COGS at the re-entry value, and skips a zero-value line", () => {
    const journalLines = buildSalesReturnReceiptJournalLines({
      documentId: "rcpt2",
      externalDocumentId: "RMA-7",
      customerId: "cust1",
      customerTypeId: "ct1",
      accounts,
      lines: [
        {
          returnLineId: "srol1",
          itemId: "item1",
          quantity: 2,
          cost: 24,
          replenishmentSystem: "Make",
          itemPostingGroupId: "ipg1",
          locationId: "loc1"
        },
        {
          returnLineId: "srol2",
          itemId: "item2",
          quantity: 1,
          cost: 0,
          replenishmentSystem: "Buy",
          itemPostingGroupId: null,
          locationId: "loc1"
        }
      ]
    });

    expect(summary(journalLines)).toEqual([
      {
        accountId: "finished",
        description: "Finished Goods Account",
        amount: 24,
        quantity: 2
      },
      {
        accountId: "cogs",
        description: "Cost of Goods Sold",
        amount: -24,
        quantity: 2
      }
    ]);
    for (const journalLine of journalLines) {
      expect(journalLine).toMatchObject({
        documentType: "Receipt",
        documentId: "rcpt2",
        externalDocumentId: "RMA-7",
        documentLineReference: "receipt:srol1",
        dimensions: {
          Item: "item1",
          ItemPostingGroup: "ipg1",
          Location: "loc1",
          Customer: "cust1",
          CustomerType: "ct1"
        }
      });
    }
  });
});

describe("journalLineDimensionRows", () => {
  it("writes the values whose entity type has an active dimension, line for line", () => {
    const rows = journalLineDimensionRows({
      journalLineIds: ["jl1", "jl2"],
      lines: [
        { dimensions: { Item: "item1", Location: null, Supplier: "sup1" } },
        { dimensions: { Item: "item2", Process: "proc1" } }
      ],
      dimensionIdByEntity: new Map([
        ["Item", "dim-item"],
        ["Location", "dim-location"],
        ["Process", "dim-process"]
      ]),
      companyId: "co1"
    });
    expect(rows).toEqual([
      {
        journalLineId: "jl1",
        dimensionId: "dim-item",
        valueId: "item1",
        companyId: "co1"
      },
      {
        journalLineId: "jl2",
        dimensionId: "dim-item",
        valueId: "item2",
        companyId: "co1"
      },
      {
        journalLineId: "jl2",
        dimensionId: "dim-process",
        valueId: "proc1",
        companyId: "co1"
      }
    ]);
  });
});
