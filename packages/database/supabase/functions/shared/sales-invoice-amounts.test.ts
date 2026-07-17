import { expect, test } from "vitest";
import { debit } from "../lib/utils.ts";
import {
  getSalesInvoiceCreditLines,
  getSalesInvoiceLineAmounts,
} from "./sales-invoice-amounts.ts";

// The journal post-sales-invoice pushes for one line: the credit lines the
// shared helper returns (the same call the edge function makes), plus the AR
// debit for the whole total, which the caller owns.
const journalLinesFor = (
  input: Parameters<typeof getSalesInvoiceLineAmounts>[0]
) => {
  const amounts = getSalesInvoiceLineAmounts(input);
  return [
    ...getSalesInvoiceCreditLines(amounts).map((line) => ({
      account: line.accountKey as string,
      amount: line.amount,
    })),
    {
      account: "receivablesAccount",
      amount: debit("asset", amounts.totalAmount),
    },
  ];
};

// The expression post-sales-invoice used before the revenue/tax split, kept here
// so every test can assert the invoice total (and the AR debit) never moved.
const legacyTotal = (input: {
  quantity: number;
  unitPrice?: number;
  shippingCost?: number;
  addOnCost?: number;
  nonTaxableAddOnCost?: number;
  taxPercent?: number;
  weightedHeaderShipping?: number;
  exchangeRate?: number;
}) => {
  const preTaxLineCost =
    input.quantity * (input.unitPrice ?? 0) +
    (input.shippingCost ?? 0) +
    (input.addOnCost ?? 0);
  const totalLineCost =
    preTaxLineCost * (1 + (input.taxPercent ?? 0)) +
    (input.nonTaxableAddOnCost ?? 0);
  return (
    (totalLineCost + (input.weightedHeaderShipping ?? 0)) *
    (input.exchangeRate ?? 1)
  );
};

test("a taxed line splits revenue at pre-tax and tax separately", () => {
  const line = { quantity: 10, unitPrice: 100, taxPercent: 0.07 };
  const { revenueAmount, taxAmount, totalAmount } =
    getSalesInvoiceLineAmounts(line);

  expect(revenueAmount).toBe(1000);
  expect(taxAmount).toBeCloseTo(70, 9);
  expect(totalAmount).toBeCloseTo(1070, 9);
  expect(totalAmount).toBe(legacyTotal(line));
});

test("revenue + tax equals the pre-change total", () => {
  const line = {
    quantity: 3,
    unitPrice: 133.33,
    shippingCost: 12.5,
    addOnCost: 4.25,
    nonTaxableAddOnCost: 19.99,
    taxPercent: 0.0825,
    weightedHeaderShipping: 31.75,
  };
  const { revenueAmount, taxAmount, totalAmount } =
    getSalesInvoiceLineAmounts(line);

  expect(totalAmount).toBe(legacyTotal(line));
  expect(revenueAmount + taxAmount).toBe(totalAmount);
});

test("nonTaxableAddOnCost and header shipping are untaxed revenue", () => {
  const line = {
    quantity: 1,
    unitPrice: 1000,
    nonTaxableAddOnCost: 50,
    weightedHeaderShipping: 75,
    taxPercent: 0.07,
  };
  const { revenueAmount, taxAmount, totalAmount } =
    getSalesInvoiceLineAmounts(line);

  // Tax is charged on the $1,000 basis only — not on the $50 or the $75.
  expect(revenueAmount).toBe(1125);
  expect(taxAmount).toBeCloseTo(70, 9);
  expect(totalAmount).toBe(legacyTotal(line));
});

test("a zero-tax line yields no tax amount and posts as before", () => {
  const line = {
    quantity: 4,
    unitPrice: 25,
    shippingCost: 10,
    nonTaxableAddOnCost: 5,
    weightedHeaderShipping: 15,
    taxPercent: 0,
  };
  const { revenueAmount, taxAmount, totalAmount } =
    getSalesInvoiceLineAmounts(line);

  expect(taxAmount).toBe(0);
  expect(revenueAmount).toBe(totalAmount);
  expect(totalAmount).toBe(legacyTotal(line));
});

test("a missing taxPercent is treated as zero", () => {
  const line = { quantity: 2, unitPrice: 50 };
  expect(getSalesInvoiceLineAmounts(line).taxAmount).toBe(0);
  expect(getSalesInvoiceLineAmounts(line).revenueAmount).toBe(100);
});

test("a taxed line posts $1,000 to revenue and $70 to sales tax payable", () => {
  const lines = journalLinesFor({
    quantity: 10,
    unitPrice: 100,
    taxPercent: 0.07,
  });

  expect(lines.find((l) => l.account === "salesAccount")?.amount).toBe(1000);
  expect(
    lines.find((l) => l.account === "salesTaxPayableAccount")?.amount
  ).toBeCloseTo(70, 9);
  expect(lines.find((l) => l.account === "receivablesAccount")?.amount).toBe(
    1070
  );
});

test("the journal balances for a taxed line with header shipping and nonTaxableAddOnCost", () => {
  const lines = journalLinesFor({
    quantity: 7,
    unitPrice: 89.95,
    shippingCost: 14.5,
    addOnCost: 6.75,
    nonTaxableAddOnCost: 22.4,
    taxPercent: 0.0725,
    weightedHeaderShipping: 40.6,
    exchangeRate: 1.1,
  });

  // `amount` is signed by the account's natural balance, so the balance check
  // is credit side (revenue + tax) against debit side (AR), not a sum to zero.
  const creditSide = lines
    .filter((l) => l.account !== "receivablesAccount")
    .reduce((sum, l) => sum + l.amount, 0);
  const debitSide = lines
    .filter((l) => l.account === "receivablesAccount")
    .reduce((sum, l) => sum + l.amount, 0);

  expect(lines).toHaveLength(3);
  expect(creditSide).toBeCloseTo(debitSide, 9);
});

test("a zero-tax line emits no tax journal line", () => {
  const lines = journalLinesFor({ quantity: 2, unitPrice: 50, taxPercent: 0 });

  expect(lines.map((l) => l.account)).toEqual([
    "salesAccount",
    "receivablesAccount",
  ]);
});

test("the exchange rate is applied to revenue and tax alike", () => {
  const line = {
    quantity: 1,
    unitPrice: 1000,
    nonTaxableAddOnCost: 10,
    weightedHeaderShipping: 20,
    taxPercent: 0.07,
    exchangeRate: 1.25,
  };
  const { revenueAmount, taxAmount, totalAmount } =
    getSalesInvoiceLineAmounts(line);

  expect(revenueAmount).toBe(1030 * 1.25);
  expect(taxAmount).toBeCloseTo(70 * 1.25, 9);
  expect(totalAmount).toBe(legacyTotal(line));
  expect(revenueAmount + taxAmount).toBe(totalAmount);
});
