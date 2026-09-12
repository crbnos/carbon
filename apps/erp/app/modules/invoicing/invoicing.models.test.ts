import { describe, expect, it } from "vitest";
import {
  invoiceSettlementDisplayAmounts,
  invoiceSettlementValidator,
  isInvoiceFullyPaid,
  isInvoicePayable,
  paymentValidator,
  toDocumentCurrency
} from "./invoicing.models";

describe("paymentValidator", () => {
  const validReceipt = {
    paymentType: "Receipt" as const,
    customerId: "cust1",
    paymentDate: "2026-05-19",
    currencyCode: "USD",
    exchangeRate: 1,
    totalAmount: 100,
    bankAccount: "acc1"
  };

  it("accepts a Receipt with a customer", () => {
    const r = paymentValidator.safeParse(validReceipt);
    expect(r.success).toBe(true);
  });

  it("accepts a Disbursement with a supplier", () => {
    const r = paymentValidator.safeParse({
      ...validReceipt,
      paymentType: "Disbursement",
      customerId: undefined,
      supplierId: "supp1"
    });
    expect(r.success).toBe(true);
  });

  it("accepts a customer refund disbursement", () => {
    expect(
      paymentValidator.safeParse({
        ...validReceipt,
        paymentType: "Disbursement"
      }).success
    ).toBe(true);
  });

  it("accepts a supplier refund receipt", () => {
    expect(
      paymentValidator.safeParse({
        ...validReceipt,
        customerId: undefined,
        supplierId: "supp1"
      }).success
    ).toBe(true);
  });

  it.each([
    "Receipt",
    "Disbursement"
  ])("rejects ambiguous %s counterparty", (paymentType) => {
    expect(
      paymentValidator.safeParse({
        ...validReceipt,
        paymentType,
        supplierId: "supp1"
      }).success
    ).toBe(false);
  });

  it("rejects a Receipt missing customer", () => {
    const r = paymentValidator.safeParse({
      ...validReceipt,
      customerId: undefined
    });
    expect(r.success).toBe(false);
  });

  it("rejects a Disbursement missing supplier", () => {
    const r = paymentValidator.safeParse({
      ...validReceipt,
      paymentType: "Disbursement",
      customerId: undefined
    });
    expect(r.success).toBe(false);
  });

  it("accepts a zero totalAmount (pure credit-application, no cash)", () => {
    const r = paymentValidator.safeParse({
      ...validReceipt,
      totalAmount: 0
    });
    expect(r.success).toBe(true);
  });

  it("rejects a negative totalAmount", () => {
    const r = paymentValidator.safeParse({
      ...validReceipt,
      totalAmount: -10
    });
    expect(r.success).toBe(false);
  });

  it("rejects a zero exchange rate", () => {
    const r = paymentValidator.safeParse({
      ...validReceipt,
      exchangeRate: 0
    });
    expect(r.success).toBe(false);
  });
});

describe("invoiceSettlementValidator", () => {
  const validApp = {
    paymentId: "p1",
    targetSalesInvoiceId: "si1",
    appliedAmount: 50,
    discountAmount: 0,
    writeOffAmount: 0,
    targetExchangeRate: 1,
    sourceExchangeRate: 1,
    appliedDate: "2026-05-19"
  };

  it("accepts an application against a sales invoice", () => {
    const r = invoiceSettlementValidator.safeParse(validApp);
    expect(r.success).toBe(true);
  });

  it("accepts an application against a purchase invoice", () => {
    const r = invoiceSettlementValidator.safeParse({
      ...validApp,
      targetSalesInvoiceId: undefined,
      targetPurchaseInvoiceId: "pi1"
    });
    expect(r.success).toBe(true);
  });

  it("rejects when both sales and purchase ids set", () => {
    const r = invoiceSettlementValidator.safeParse({
      ...validApp,
      targetPurchaseInvoiceId: "pi1"
    });
    expect(r.success).toBe(false);
  });

  it("rejects when neither sales nor purchase id set", () => {
    const r = invoiceSettlementValidator.safeParse({
      ...validApp,
      targetSalesInvoiceId: undefined
    });
    expect(r.success).toBe(false);
  });

  it("rejects when all three components are zero", () => {
    const r = invoiceSettlementValidator.safeParse({
      ...validApp,
      appliedAmount: 0,
      discountAmount: 0,
      writeOffAmount: 0
    });
    expect(r.success).toBe(false);
  });

  it("accepts a discount-only application (no cash applied)", () => {
    const r = invoiceSettlementValidator.safeParse({
      ...validApp,
      appliedAmount: 0,
      discountAmount: 5
    });
    expect(r.success).toBe(true);
  });

  it("accepts a write-off-only application", () => {
    const r = invoiceSettlementValidator.safeParse({
      ...validApp,
      appliedAmount: 0,
      writeOffAmount: 5
    });
    expect(r.success).toBe(true);
  });

  it("rejects a zero invoice exchange rate", () => {
    const r = invoiceSettlementValidator.safeParse({
      ...validApp,
      targetExchangeRate: 0
    });
    expect(r.success).toBe(false);
  });

  it("rejects a negative payment exchange rate", () => {
    const r = invoiceSettlementValidator.safeParse({
      ...validApp,
      sourceExchangeRate: -1
    });
    expect(r.success).toBe(false);
  });
});

describe("toDocumentCurrency", () => {
  it("converts base-currency invoice totals into the order currency", () => {
    // USD base, EUR order, exchangeRate 0.9: base 1000 displays as €900.
    expect(toDocumentCurrency(1000, 0.9)).toBe(900);
  });

  it("leaves the amount unchanged when the rate is missing or 1", () => {
    expect(toDocumentCurrency(1000, 1)).toBe(1000);
    expect(toDocumentCurrency(1000, null)).toBe(1000);
    expect(toDocumentCurrency(1000, undefined)).toBe(1000);
    expect(toDocumentCurrency(1000, 0)).toBe(1000);
  });
});

describe("invoiceSettlementDisplayAmounts", () => {
  it("converts sales totals from base into document currency", () => {
    expect(
      invoiceSettlementDisplayAmounts({
        total: 1000,
        balance: 400,
        exchangeRate: 0.9,
        convertToDocument: true
      })
    ).toEqual({
      invoicedAmount: 900,
      paidAmount: 540,
      balanceRemaining: 360
    });
  });

  it("keeps posted cash separate from credit relief and converts both cash and balance", () => {
    expect(
      invoiceSettlementDisplayAmounts({
        total: 1000,
        balance: 100,
        paidAmount: 600,
        exchangeRate: 0.9,
        convertToDocument: true
      })
    ).toEqual({ invoicedAmount: 900, paidAmount: 540, balanceRemaining: 90 });
  });

  it("does not label a credit-only settlement as cash paid", () => {
    expect(
      invoiceSettlementDisplayAmounts({
        total: 100,
        balance: 0,
        paidAmount: 0,
        convertToDocument: true
      })
    ).toEqual({ invoicedAmount: 100, paidAmount: 0, balanceRemaining: 0 });
  });

  it("preserves signed applied principal instead of clamping refunds", () => {
    expect(
      invoiceSettlementDisplayAmounts({
        total: -100,
        balance: 0,
        paidAmount: -25,
        exchangeRate: 0.8,
        convertToDocument: true
      })
    ).toEqual({ invoicedAmount: -80, paidAmount: -20, balanceRemaining: 0 });
  });

  it("leaves purchase totals in company base", () => {
    // unitPrice is already supplierUnitPrice * exchangeRate (810 base from
    // 900 EUR at 0.9). Multiplying again would display 729 against a $810 total.
    expect(
      invoiceSettlementDisplayAmounts({
        total: 810,
        balance: 810,
        exchangeRate: 0.9,
        convertToDocument: false
      })
    ).toEqual({
      invoicedAmount: 810,
      paidAmount: 0,
      balanceRemaining: 810
    });
  });
});

describe("isInvoiceFullyPaid", () => {
  it.each([
    0.003, 0.009, 0.01
  ])("does not hide a positive remainder of %s", (balance) => {
    expect(isInvoiceFullyPaid(balance, 100, "Paid")).toBe(false);
  });

  it("requires zero balance and payment progress or paid status", () => {
    expect(isInvoiceFullyPaid(0, 100)).toBe(true);
    expect(isInvoiceFullyPaid(0, 0, "Paid")).toBe(true);
    expect(isInvoiceFullyPaid(0, 0, "Draft")).toBe(false);
  });
});

describe("isInvoicePayable", () => {
  it("is payable when posted with a real outstanding balance", () => {
    expect(isInvoicePayable("Partially Paid", 25)).toBe(true);
    expect(isInvoicePayable("Submitted", 0.01)).toBe(true);
    expect(isInvoicePayable("Overdue", 100)).toBe(true);
  });

  it("keeps positive foreign document remainders payable below a base cent", () => {
    expect(isInvoicePayable("Partially Paid", 0.003)).toBe(true);
    expect(isInvoicePayable("Partially Paid", 0.009)).toBe(true);
  });

  it("is not payable when fully paid or zero balance", () => {
    expect(isInvoicePayable("Paid", 0)).toBe(false);
    expect(isInvoicePayable("Submitted", 0)).toBe(false);
  });

  it("is not payable in non-payable statuses regardless of balance", () => {
    expect(isInvoicePayable("Voided", 100)).toBe(false);
    expect(isInvoicePayable("Draft", 100)).toBe(false);
    expect(isInvoicePayable("Pending", 100)).toBe(false);
  });

  it("treats nullish balance/status as not payable", () => {
    expect(isInvoicePayable(null, null)).toBe(false);
    expect(isInvoicePayable(undefined, undefined)).toBe(false);
  });
});

it("retains exact document principal when its rounded base is zero", () => {
  const result = invoiceSettlementValidator.safeParse({
    paymentId: "pay",
    targetSalesInvoiceId: "inv",
    appliedAmount: 0,
    discountAmount: 0,
    writeOffAmount: 0,
    sourceAmount: 0.01,
    sourceExchangeRate: 100000,
    targetExchangeRate: 100000,
    appliedDate: "2026-09-07"
  });
  expect(result.success).toBe(true);
  if (result.success) expect(result.data).toHaveProperty("sourceAmount", 0.01);
});
