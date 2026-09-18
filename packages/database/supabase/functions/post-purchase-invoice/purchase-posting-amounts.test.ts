import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { round } from "../shared/precision.ts";
import { allocateVarianceAcrossLayers } from "../shared/purchase-cost-adjustment.ts";
import {
  calculatePurchasePostingAmounts,
  getInvoicedPurchaseQuantityAfterVoid,
  type PurchasePostingLine,
} from "./purchase-posting-amounts.ts";

Deno.test("invoice void restores purchase-unit quantities when inventory UOM factor is five", () => {
  for (const quantity of [2, 1]) {
    const invoice = line({ quantity, conversionFactor: 5 });
    const [posted] = calculatePurchasePostingAmounts({
      lines: [invoice],
      exchangeRate: 1.1,
      supplierShippingCost: 0,
    });
    assertEquals(posted.inventoryQuantity, quantity * 5);
    assertEquals(
      getInvoicedPurchaseQuantityAfterVoid(quantity, invoice.quantity),
      0,
    );
  }
  assertEquals(getInvoicedPurchaseQuantityAfterVoid(5, 2), 3);
  assertEquals(getInvoicedPurchaseQuantityAfterVoid(null, 2), 0);
});

function line(
  overrides: Partial<PurchasePostingLine> = {},
): PurchasePostingLine {
  return {
    id: "line",
    invoiceLineType: "Part",
    quantity: 1,
    conversionFactor: 1,
    unitPrice: 100,
    shippingCost: 0,
    taxAmount: 0,
    ...overrides,
  };
}

for (
  const invoiceLineType of [
    "Part",
    "Service",
    "Fixture",
    "Fixed Asset",
    "G/L Account",
  ]
) {
  Deno.test(`${invoiceLineType}: document 110 at rate 1.10 posts 100 base`, () => {
    const [amounts] = calculatePurchasePostingAmounts({
      lines: [line({ invoiceLineType })],
      exchangeRate: 1.1,
      supplierShippingCost: 0,
    });
    assertEquals(amounts.totalBaseCost, 100);
    assertEquals(amounts.nominalBaseCost, 100);
    assertEquals(amounts.inventoryUnitCost, 100);
  });
}

Deno.test("matching receipt and invoice costs produce zero PPV with freight, tax, FX and a non-1 UOM", () => {
  // Receipt creation divides base purchase price by the UOM factor, spreads
  // line tax/freight over inventory units, then post-receipt adds header
  // supplier freight divided by the foreign-per-base rate.
  const purchaseQuantity = 2;
  const conversionFactor = 10;
  const receiptInventoryQuantity = purchaseQuantity * conversionFactor;
  const receiptUnitCost = 50 / conversionFactor +
    (10 + 11) / receiptInventoryQuantity;
  const receiptCost = receiptInventoryQuantity * receiptUnitCost + 11 / 1.1;
  const [invoice] = calculatePurchasePostingAmounts({
    lines: [
      line({
        quantity: purchaseQuantity,
        conversionFactor,
        unitPrice: 50,
        shippingCost: 10,
        taxAmount: 11,
      }),
    ],
    exchangeRate: 1.1,
    supplierShippingCost: 11,
  });
  assertEquals(invoice.inventoryQuantity, 20);
  assertEquals(invoice.nominalBaseCost, 100);
  assertEquals(invoice.headerShippingBase, 10);
  assertEquals(invoice.totalBaseCost, 131);
  assertEquals(invoice.inventoryUnitCost, 6.55);
  const variance = round(
    invoice.inventoryQuantity * invoice.inventoryUnitCost - receiptCost,
  );
  assertEquals(variance, 0);
  assertEquals(
    allocateVarianceAcrossLayers(
      [{ id: "receipt", quantity: 20, remainingQuantity: 10 }],
      20,
      variance,
    ),
    {
      inventoryShare: 0,
      ppvShare: 0,
      perLayer: [],
    },
  );
});

Deno.test("a true purchase price increase still allocates 5 to inventory and 5 to consumed PPV", () => {
  const [invoice] = calculatePurchasePostingAmounts({
    lines: [
      line({
        quantity: 2,
        conversionFactor: 10,
        unitPrice: 55,
        shippingCost: 10,
        taxAmount: 11,
      }),
    ],
    exchangeRate: 1.1,
    supplierShippingCost: 11,
  });
  const variance = round(invoice.totalBaseCost - 131);
  assertEquals(variance, 10);
  const allocation = allocateVarianceAcrossLayers(
    [{ id: "receipt", quantity: 20, remainingQuantity: 10 }],
    20,
    variance,
  );
  assertEquals(allocation.inventoryShare, 5);
  assertEquals(allocation.ppvShare, 5);
});

Deno.test("header supplier freight is allocated by base cost and comment lines absorb none", () => {
  const amounts = calculatePurchasePostingAmounts({
    lines: [
      line({ id: "a", unitPrice: 25 }),
      line({ id: "b", unitPrice: 75 }),
      line({ id: "comment", invoiceLineType: "Comment", unitPrice: 999 }),
    ],
    exchangeRate: 0.8,
    supplierShippingCost: 8,
  });
  assertEquals(
    amounts.map((row) => [row.id, row.headerShippingBase, row.totalBaseCost]),
    [["a", 2.5, 27.5], ["b", 7.5, 82.5]],
  );
});

Deno.test("zero-cost freight allocation reconciles the final internal rounding unit", () => {
  const amounts = calculatePurchasePostingAmounts({
    lines: ["a", "b", "c"].map((id) =>
      line({ id, invoiceLineType: "G/L Account", unitPrice: 0 })
    ),
    exchangeRate: 1.1,
    supplierShippingCost: 0.011,
  });
  assertEquals(amounts.map((row) => row.headerShippingBase), [
    0.00333,
    0.00333,
    0.00334,
  ]);
  assertEquals(
    round(amounts.reduce((sum, row) => sum + row.totalBaseCost, 0)),
    0.01,
  );
});

Deno.test("fractional quantities retain inventory-unit precision", () => {
  const [amounts] = calculatePurchasePostingAmounts({
    lines: [
      line({
        quantity: 2.5,
        conversionFactor: 2.4,
        unitPrice: 3.2,
        shippingCost: 0.04,
        taxAmount: 0.01,
      }),
    ],
    exchangeRate: 0.8,
    supplierShippingCost: 0.016,
  });
  assertEquals(amounts.inventoryQuantity, 6);
  assertEquals(amounts.totalBaseCost, 8.07);
  assertEquals(amounts.inventoryUnitCost, 1.345);
});

for (const exchangeRate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
  Deno.test(`invalid rate ${exchangeRate} refuses a purchase posting`, () => {
    assertThrows(
      () =>
        calculatePurchasePostingAmounts({
          lines: [line()],
          exchangeRate,
          supplierShippingCost: 0,
        }),
      Error,
      "rate",
    );
  });
}

Deno.test("an invalid UOM factor refuses a nonfinite inventory unit cost", () => {
  assertThrows(
    () =>
      calculatePurchasePostingAmounts({
        lines: [line({ conversionFactor: 0 })],
        exchangeRate: 1.1,
        supplierShippingCost: 0,
      }),
    Error,
    "conversion factor",
  );
});

Deno.test("nonfinite base costs cannot enter AP or an acquisition", () => {
  assertThrows(
    () =>
      calculatePurchasePostingAmounts({
        lines: [line({ unitPrice: Number.NaN })],
        exchangeRate: 1.1,
        supplierShippingCost: 0,
      }),
    Error,
    "finite",
  );
});

Deno.test("buyer matching value keeps supplier currency and excludes tax/header freight", () => {
  const source = {
    ...line({ shippingCost: 10, taxAmount: 20 }),
    supplierUnitPrice: 110,
    supplierShippingCost: 11,
  };
  const [amounts] = calculatePurchasePostingAmounts({
    lines: [source],
    exchangeRate: 1.1,
    supplierShippingCost: 33,
  });
  assertEquals(amounts.intercompanyDocumentAmount, 121);
});
