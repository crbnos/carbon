// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { credit, debit } from "@carbon/utils";
import { describe, expect, it } from "vitest";
import {
  type BuildPurchaseInvoicePostingLinesInput,
  buildPurchaseInvoicePostingLines,
  type InvoicedPurchaseOrderLine,
  type PurchaseInvoiceItem,
  type PurchaseInvoiceJournalLine,
  type PurchaseInvoicePostingLine
} from "./posting-lines";
import { calculatePurchasePostingAmounts } from "./purchase-posting-amounts";

const accounts: BuildPurchaseInvoicePostingLinesInput["accounts"] = {
  goodsReceivedNotInvoicedAccount: "grni",
  purchaseVarianceAccount: "ppv",
  indirectCostAccount: "indirect",
  workInProgressAccount: "wip",
  rawMaterialsAccount: "raw",
  finishedGoodsAccount: "finished"
};

const part: PurchaseInvoiceItem = {
  itemId: "item-1",
  itemTrackingType: "Inventory",
  replenishmentSystem: "Buy",
  itemPostingGroupId: "group-1",
  costingMethod: "FIFO"
};

function build(lines: PurchaseInvoicePostingLine[]) {
  return buildPurchaseInvoicePostingLines({
    invoice: {
      id: "inv-1",
      supplierId: "supplier-1",
      supplierReference: "S-9"
    },
    supplierTypeId: "supplier-type-1",
    accounts,
    payables: { accountId: "ap", accountDefaultRole: null },
    lines
  });
}

function amounts(inventoryQuantity: number, totalBaseCost: number) {
  return {
    inventoryQuantity,
    totalBaseCost,
    inventoryUnitCost: totalBaseCost / inventoryQuantity
  };
}

function ordered(
  id: string,
  quantity: number,
  total: number,
  purchaseOrderLine: Partial<InvoicedPurchaseOrderLine>,
  item: PurchaseInvoiceItem = part
): PurchaseInvoicePostingLine {
  return {
    id,
    invoiceLineType: "Part",
    locationId: "loc-1",
    amounts: amounts(quantity, total),
    kind: "ordered",
    item,
    purchaseOrderLine: {
      purchaseOrderLineId: `pol-${id}`,
      quantityReceived: 0,
      quantityInvoiced: 0,
      receiptGroups: [],
      isOutsideProcessing: false,
      processId: null,
      coverage: { receiptLayers: [], onHandQuantity: 0 },
      ...purchaseOrderLine
    }
  };
}

/** Account, amount and quantity of each line, in order. */
const summary = (lines: PurchaseInvoiceJournalLine[]) =>
  lines.map(({ accountId, amount, quantity, accrual }) => ({
    accountId,
    amount,
    quantity,
    ...(accrual ? { accrual } : {})
  }));

describe("buildPurchaseInvoicePostingLines", () => {
  it("clears GR/IR at receipt cost and splits the variance between inventory and purchase variance", () => {
    // 10 received at 8, invoiced at 10: a variance of 20, 2 a unit. The
    // layer still holds 4 units, so 8 writes up inventory and 12 is PPV.
    const { lines, receivedVariances } = build([
      ordered("a", 10, 100, {
        quantityReceived: 10,
        receiptGroups: [{ quantity: 10, cost: 80 }],
        coverage: {
          receiptLayers: [
            { id: "layer-1", quantity: 10, remainingQuantity: 4 }
          ],
          onHandQuantity: 0
        }
      })
    ]);

    expect(summary(lines)).toEqual([
      { accountId: "grni", amount: debit("liability", 80), quantity: 10 },
      { accountId: "raw", amount: debit("asset", 8), quantity: 10 },
      { accountId: "ppv", amount: debit("expense", 12), quantity: 10 },
      { accountId: "ap", amount: credit("liability", 100), quantity: 10 }
    ]);
    expect(new Set(lines.map((line) => line.journalLineReference)).size).toBe(
      1
    );
    for (const line of lines) {
      expect(line.documentLineReference).toBe("purchase-invoice:pol-a");
      expect(line.documentType).toBe("Invoice");
      expect(line.documentId).toBe("inv-1");
      expect(line.externalDocumentId).toBe("S-9");
      expect(line.dimensions).toEqual({
        SupplierType: "supplier-type-1",
        ItemPostingGroup: "group-1",
        Item: "item-1",
        Supplier: "supplier-1",
        Location: "loc-1",
        CostCenter: null,
        Project: null,
        Process: null,
        FixedAssetClass: null
      });
    }
    expect(receivedVariances.get("a")).toMatchObject({
      quantity: 10,
      receiptCost: 80,
      variance: 20,
      allocation: {
        inventoryShare: 8,
        ppvShare: 12,
        perLayer: [
          { costLedgerId: "layer-1", appliedQuantity: 4, adjustmentCost: 8 }
        ]
      },
      selfHealQuantity: 0
    });
  });

  it("skips the units an earlier invoice cleared and accrues the units not yet received", () => {
    // Two receipts of 3 (at 6, then at 9); an earlier invoice cleared 3, so
    // this invoice of 5 clears the second receipt and accrues 2.
    const { lines, receivedVariances } = build([
      ordered("a", 5, 50, {
        quantityReceived: 6,
        quantityInvoiced: 3,
        receiptGroups: [
          { quantity: 3, cost: 18 },
          { quantity: 3, cost: 27 }
        ]
      })
    ]);

    expect(summary(lines)).toEqual([
      { accountId: "grni", amount: debit("liability", 27), quantity: 3 },
      { accountId: "ppv", amount: debit("expense", 3), quantity: 3 },
      { accountId: "ap", amount: credit("liability", 30), quantity: 3 },
      {
        accountId: "grni",
        amount: debit("liability", 20),
        quantity: 2,
        accrual: true
      },
      {
        accountId: "ap",
        amount: credit("liability", 20),
        quantity: 2,
        accrual: true
      }
    ]);
    // The cleared units and the accrued units are two pairs.
    expect(lines[0]!.journalLineReference).toBe(lines[2]!.journalLineReference);
    expect(lines[3]!.journalLineReference).toBe(lines[4]!.journalLineReference);
    expect(lines[0]!.journalLineReference).not.toBe(
      lines[3]!.journalLineReference
    );
    // No layer and nothing on hand: the whole variance is PPV.
    expect(receivedVariances.get("a")?.allocation.ppvShare).toBeCloseTo(3, 10);
  });

  it("expenses an unreceived service to indirect cost with no accrual", () => {
    const service = ordered("s", 2, 40, {});
    const { lines } = build([{ ...service, invoiceLineType: "Service" }]);
    expect(summary(lines)).toEqual([
      { accountId: "indirect", amount: debit("asset", 40), quantity: 2 },
      { accountId: "ap", amount: credit("liability", 40), quantity: 2 }
    ]);
  });

  it("shares a stored write-up across the lines of one item by their variance", () => {
    const writeUp = { coverage: { storedWriteUp: 6 } };
    const { lines } = build([
      ordered("a", 1, 30, {
        quantityReceived: 1,
        receiptGroups: [{ quantity: 1, cost: 20 }],
        ...writeUp
      }),
      ordered("b", 1, 40, {
        quantityReceived: 1,
        receiptGroups: [{ quantity: 1, cost: 20 }],
        ...writeUp
      })
    ]);
    // Variances 10 and 20 take 2 and 4 of the write-up.
    expect(summary(lines).filter((line) => line.accountId !== "grni")).toEqual([
      { accountId: "raw", amount: debit("asset", 2), quantity: 1 },
      { accountId: "ppv", amount: debit("expense", 8), quantity: 1 },
      { accountId: "ap", amount: credit("liability", 30), quantity: 1 },
      { accountId: "raw", amount: debit("asset", 4), quantity: 1 },
      { accountId: "ppv", amount: debit("expense", 16), quantity: 1 },
      { accountId: "ap", amount: credit("liability", 40), quantity: 1 }
    ]);
  });

  it("refuses a received line whose item has no cost record", () => {
    expect(() =>
      build([
        ordered(
          "a",
          1,
          10,
          { quantityReceived: 1, receiptGroups: [{ quantity: 1, cost: 8 }] },
          { ...part, costingMethod: null }
        )
      ])
    ).toThrow("Item item-1 on a purchase invoice has no cost record");
  });

  it("posts G/L and fixed asset lines", () => {
    const base = { invoiceLineType: "G/L Account" as const, locationId: null };
    const { lines, receivedVariances } = build([
      {
        ...base,
        id: "gl",
        amounts: amounts(1, 20),
        kind: "glAccount",
        purchaseOrderLineId: null,
        account: { id: "office", name: "Office Supplies" },
        costCenterId: "cc-1",
        projectId: "project-1"
      },
      {
        ...base,
        id: "fa-direct",
        invoiceLineType: "Fixed Asset",
        amounts: amounts(1, 500),
        kind: "fixedAsset",
        purchaseOrderLineId: null,
        purchaseOrderLineLocationId: null,
        assetLocationId: "loc-asset",
        fixedAssetClassId: "class-1",
        acquisition: { assetAccountId: "machinery" }
      },
      {
        ...base,
        id: "fa-received",
        invoiceLineType: "Fixed Asset",
        amounts: amounts(1, 510),
        kind: "fixedAsset",
        purchaseOrderLineId: "pol-fa",
        purchaseOrderLineLocationId: "loc-po",
        assetLocationId: "loc-asset",
        fixedAssetClassId: "class-1",
        acquisition: { receiptCost: 500 }
      }
    ]);

    expect(
      lines.map(
        ({ accountId, description, amount, documentLineReference }) => ({
          accountId,
          description,
          amount,
          documentLineReference
        })
      )
    ).toEqual([
      {
        accountId: "office",
        description: "Office Supplies",
        amount: debit("asset", 20),
        documentLineReference: null
      },
      {
        accountId: "ap",
        description: "Accounts Payable",
        amount: credit("liability", 20),
        documentLineReference: null
      },
      {
        accountId: "machinery",
        description: "Fixed Asset Acquisition",
        amount: debit("asset", 500),
        documentLineReference: null
      },
      {
        accountId: "ap",
        description: "Accounts Payable",
        amount: credit("liability", 500),
        documentLineReference: null
      },
      {
        accountId: "grni",
        description: "GR/IR Clearing",
        amount: debit("liability", 500),
        documentLineReference: "purchase-invoice:pol-fa"
      },
      {
        accountId: "ppv",
        description: "Purchase Price Variance",
        amount: debit("expense", 10),
        documentLineReference: "purchase-invoice:pol-fa"
      },
      {
        accountId: "ap",
        description: "Accounts Payable",
        amount: credit("liability", 510),
        documentLineReference: "purchase-invoice:pol-fa"
      }
    ]);
    // A G/L line carries no supplier type; its cost center and project do.
    expect(lines[0]!.dimensions).toMatchObject({
      SupplierType: null,
      Supplier: "supplier-1",
      CostCenter: "cc-1",
      Project: "project-1"
    });
    // A fixed asset line's location is its own, else the PO line's, else
    // the asset's.
    expect(lines[2]!.dimensions).toMatchObject({
      Location: "loc-asset",
      FixedAssetClass: "class-1"
    });
    expect(lines[4]!.dimensions).toMatchObject({ Location: "loc-po" });
    expect(receivedVariances.get("fa-received")?.variance).toBe(10);
    expect(receivedVariances.has("fa-direct")).toBe(false);
  });

  it("capitalizes tax and line shipping, and converts a foreign header freight to base", () => {
    // EUR invoice at 0.5 EUR per USD: the header freight of 20 EUR is 40 USD,
    // shared 115 : 85 by line cost. Line amounts are already base.
    const postingAmounts = calculatePurchasePostingAmounts({
      lines: [
        {
          id: "gl",
          invoiceLineType: "G/L Account",
          quantity: 2,
          conversionFactor: 1,
          unitPrice: 50,
          shippingCost: 5,
          taxAmount: 10
        },
        {
          id: "part",
          invoiceLineType: "Part",
          quantity: 1,
          conversionFactor: 1,
          unitPrice: 85,
          shippingCost: 0,
          taxAmount: 0
        }
      ],
      exchangeRate: 0.5,
      supplierShippingCost: 20
    });
    const [glAmounts, partAmounts] = postingAmounts;
    const { lines } = build([
      {
        id: "gl",
        invoiceLineType: "G/L Account",
        locationId: null,
        amounts: glAmounts!,
        kind: "glAccount",
        purchaseOrderLineId: null,
        account: { id: "office", name: "Office Supplies" },
        costCenterId: null,
        projectId: null
      },
      {
        id: "part",
        invoiceLineType: "Part",
        locationId: "loc-1",
        amounts: partAmounts!,
        kind: "direct",
        item: part,
        receivedWithInvoice: true
      }
    ]);

    expect(summary(lines)).toEqual([
      { accountId: "office", amount: debit("asset", 138), quantity: 2 },
      { accountId: "ap", amount: credit("liability", 138), quantity: 2 },
      { accountId: "raw", amount: debit("asset", 102), quantity: 1 },
      { accountId: "ap", amount: credit("liability", 102), quantity: 1 }
    ]);
    // A direct line names no PO line.
    expect(lines[2]!.documentLineReference).toBeUndefined();
  });

  it("debits WIP for a direct line whose receipt is not posted with the invoice", () => {
    const { lines } = build([
      {
        id: "part",
        invoiceLineType: "Part",
        locationId: "loc-1",
        amounts: amounts(1, 10),
        kind: "direct",
        item: part,
        receivedWithInvoice: false
      }
    ]);
    expect(lines[0]).toMatchObject({
      accountId: "wip",
      description: "WIP Account"
    });
  });
});
