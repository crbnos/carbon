import { expect, test } from "vitest";
import { getBaseCurrencyShippingCost } from "./supplier-shipping-cost.ts";

// The direction the database itself uses, transcribed from the generated
// `shippingCost` columns and the purchaseOrders/purchaseInvoices views:
//   "supplierShippingCost" / CASE WHEN "exchangeRate" = 0 THEN 1 ELSE "exchangeRate" END
// If the helper ever disagrees with this, the GL disagrees with the views that
// report it, and the difference lands in purchaseVarianceAccount.
const sqlConvention = (supplierShippingCost: number, exchangeRate: number) =>
  supplierShippingCost / (exchangeRate === 0 ? 1 : exchangeRate);

// What post-receipt did before this change.
const legacyReceiptMultiply = (
  supplierShippingCost: number,
  exchangeRate: number
) => supplierShippingCost * exchangeRate;

test("converts supplier-currency shipping to base by dividing", () => {
  // 150 supplier units at 1.25 foreign-per-base is 120 base units.
  expect(getBaseCurrencyShippingCost(150, 1.25)).toBe(120);
});

test("matches the SQL convention at rates on both sides of 1.0", () => {
  for (const exchangeRate of [0.5, 0.8, 1, 1.25, 2, 7.3]) {
    expect(getBaseCurrencyShippingCost(150, exchangeRate)).toBeCloseTo(
      sqlConvention(150, exchangeRate),
      10
    );
  }
});

// This is the bug AC4 names: post-receipt multiplied while post-purchase-invoice
// and the views divided, so the same freight was valued in opposite directions.
test("diverges from the legacy multiply whenever the rate is not 1.0", () => {
  expect(getBaseCurrencyShippingCost(150, 1.25)).not.toBeCloseTo(
    legacyReceiptMultiply(150, 1.25),
    10
  );
  // At parity the two agree, which is why the bug stayed invisible in
  // base-currency companies.
  expect(getBaseCurrencyShippingCost(150, 1)).toBe(
    legacyReceiptMultiply(150, 1)
  );
});

test("guards a zero or missing rate the way the SQL CASE does", () => {
  expect(getBaseCurrencyShippingCost(150, 0)).toBe(150);
  expect(getBaseCurrencyShippingCost(150, null)).toBe(150);
  expect(getBaseCurrencyShippingCost(150, undefined)).toBe(150);
});

test("treats missing shipping as zero", () => {
  expect(getBaseCurrencyShippingCost(null, 1.25)).toBe(0);
  expect(getBaseCurrencyShippingCost(undefined, 1.25)).toBe(0);
});
