// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { allocateVarianceAcrossLayers, round } from "@carbon/utils";
import { expect, it } from "vitest";
import {
  calculatePurchasePostingAmounts,
  getInvoicedPurchaseQuantityAfterVoid,
  type PurchasePostingLine
} from "./purchase-posting-amounts";

it("invoice void restores purchase-unit quantities when inventory UOM factor is five", () => {
  for (const quantity of [2, 1]) {
    const invoice = line({ quantity, conversionFactor: 5 });
    const [posted] = calculatePurchasePostingAmounts({
      lines: [invoice],
      exchangeRate: 1.1,
      supplierShippingCost: 0
    });
    expect(posted!.inventoryQuantity).toEqual(quantity * 5);
    expect(
      getInvoicedPurchaseQuantityAfterVoid(quantity, invoice.quantity)
    ).toEqual(0);
  }
  expect(getInvoicedPurchaseQuantityAfterVoid(5, 2)).toEqual(3);
  expect(getInvoicedPurchaseQuantityAfterVoid(null, 2)).toEqual(0);
});

function line(
  overrides: Partial<PurchasePostingLine> = {}
): PurchasePostingLine {
  return {
    id: "line",
    invoiceLineType: "Part",
    quantity: 1,
    conversionFactor: 1,
    unitPrice: 100,
    shippingCost: 0,
    taxAmount: 0,
    ...overrides
  };
}

for (const invoiceLineType of [
  "Part",
  "Service",
  "Fixture",
  "Fixed Asset",
  "G/L Account"
]) {
  it(`${invoiceLineType}: document 110 at rate 1.10 posts 100 base`, () => {
    const [amounts] = calculatePurchasePostingAmounts({
      lines: [line({ invoiceLineType })],
      exchangeRate: 1.1,
      supplierShippingCost: 0
    });
    expect(amounts!.totalBaseCost).toEqual(100);
    expect(amounts!.nominalBaseCost).toEqual(100);
    expect(amounts!.inventoryUnitCost).toEqual(100);
  });
}

it("matching receipt and invoice costs produce zero PPV with freight, tax, FX and a non-1 UOM", () => {
  // Receipt creation divides base purchase price by the UOM factor, spreads
  // line tax/freight over inventory units, then post-receipt adds header
  // supplier freight divided by the foreign-per-base rate.
  const purchaseQuantity = 2;
  const conversionFactor = 10;
  const receiptInventoryQuantity = purchaseQuantity * conversionFactor;
  const receiptUnitCost =
    50 / conversionFactor + (10 + 11) / receiptInventoryQuantity;
  const receiptCost = receiptInventoryQuantity * receiptUnitCost + 11 / 1.1;
  const [invoice] = calculatePurchasePostingAmounts({
    lines: [
      line({
        quantity: purchaseQuantity,
        conversionFactor,
        unitPrice: 50,
        shippingCost: 10,
        taxAmount: 11
      })
    ],
    exchangeRate: 1.1,
    supplierShippingCost: 11
  });
  expect(invoice!.inventoryQuantity).toEqual(20);
  expect(invoice!.nominalBaseCost).toEqual(100);
  expect(invoice!.headerShippingBase).toEqual(10);
  expect(invoice!.totalBaseCost).toEqual(131);
  expect(invoice!.inventoryUnitCost).toEqual(6.55);
  const variance = round(
    invoice!.inventoryQuantity * invoice!.inventoryUnitCost - receiptCost
  );
  expect(variance).toEqual(0);
  expect(
    allocateVarianceAcrossLayers(
      [{ id: "receipt", quantity: 20, remainingQuantity: 10 }],
      20,
      variance
    )
  ).toEqual({
    inventoryShare: 0,
    ppvShare: 0,
    perLayer: []
  });
});

it("a true purchase price increase still allocates 5 to inventory and 5 to consumed PPV", () => {
  const [invoice] = calculatePurchasePostingAmounts({
    lines: [
      line({
        quantity: 2,
        conversionFactor: 10,
        unitPrice: 55,
        shippingCost: 10,
        taxAmount: 11
      })
    ],
    exchangeRate: 1.1,
    supplierShippingCost: 11
  });
  const variance = round(invoice!.totalBaseCost - 131);
  expect(variance).toEqual(10);
  const allocation = allocateVarianceAcrossLayers(
    [{ id: "receipt", quantity: 20, remainingQuantity: 10 }],
    20,
    variance
  );
  expect(allocation.inventoryShare).toEqual(5);
  expect(allocation.ppvShare).toEqual(5);
});

it("header supplier freight is allocated by base cost and comment lines absorb none", () => {
  const amounts = calculatePurchasePostingAmounts({
    lines: [
      line({ id: "a", unitPrice: 25 }),
      line({ id: "b", unitPrice: 75 }),
      line({ id: "comment", invoiceLineType: "Comment", unitPrice: 999 })
    ],
    exchangeRate: 0.8,
    supplierShippingCost: 8
  });
  expect(
    amounts.map((row) => [row.id, row.headerShippingBase, row.totalBaseCost])
  ).toEqual([
    ["a", 2.5, 27.5],
    ["b", 7.5, 82.5]
  ]);
});

it("zero-cost freight allocation reconciles the final internal rounding unit", () => {
  const amounts = calculatePurchasePostingAmounts({
    lines: ["a", "b", "c"].map((id) =>
      line({ id, invoiceLineType: "G/L Account", unitPrice: 0 })
    ),
    exchangeRate: 1.1,
    supplierShippingCost: 0.011
  });
  expect(amounts.map((row) => row.headerShippingBase)).toEqual([
    0.00333, 0.00333, 0.00334
  ]);
  expect(
    round(amounts.reduce((sum, row) => sum + row.totalBaseCost, 0))
  ).toEqual(0.01);
});

it("fractional quantities retain inventory-unit precision", () => {
  const [amounts] = calculatePurchasePostingAmounts({
    lines: [
      line({
        quantity: 2.5,
        conversionFactor: 2.4,
        unitPrice: 3.2,
        shippingCost: 0.04,
        taxAmount: 0.01
      })
    ],
    exchangeRate: 0.8,
    supplierShippingCost: 0.016
  });
  expect(amounts!.inventoryQuantity).toEqual(6);
  expect(amounts!.totalBaseCost).toEqual(8.07);
  expect(amounts!.inventoryUnitCost).toEqual(1.345);
});

for (const exchangeRate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
  it(`invalid rate ${exchangeRate} refuses a purchase posting`, () => {
    expect(() =>
      calculatePurchasePostingAmounts({
        lines: [line()],
        exchangeRate,
        supplierShippingCost: 0
      })
    ).toThrow("rate");
  });
}

it("an invalid UOM factor refuses a nonfinite inventory unit cost", () => {
  expect(() =>
    calculatePurchasePostingAmounts({
      lines: [line({ conversionFactor: 0 })],
      exchangeRate: 1.1,
      supplierShippingCost: 0
    })
  ).toThrow("conversion factor");
});

it("nonfinite base costs cannot enter AP or an acquisition", () => {
  expect(() =>
    calculatePurchasePostingAmounts({
      lines: [line({ unitPrice: Number.NaN })],
      exchangeRate: 1.1,
      supplierShippingCost: 0
    })
  ).toThrow("finite");
});

it("buyer matching value keeps supplier currency and excludes tax/header freight", () => {
  const source = {
    ...line({ shippingCost: 10, taxAmount: 20 }),
    supplierUnitPrice: 110,
    supplierShippingCost: 11
  };
  const [amounts] = calculatePurchasePostingAmounts({
    lines: [source],
    exchangeRate: 1.1,
    supplierShippingCost: 33
  });
  expect(amounts!.intercompanyDocumentAmount).toEqual(121);
});
