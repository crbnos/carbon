import { describe, expect, it } from "vitest";
import {
  invoiceSettlementValidator,
  isInvoicePayable,
  paymentValidator
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

describe("isInvoicePayable", () => {
  it("is payable when posted with a real outstanding balance", () => {
    expect(isInvoicePayable("Partially Paid", 25)).toBe(true);
    expect(isInvoicePayable("Submitted", 0.01)).toBe(true);
    expect(isInvoicePayable("Overdue", 100)).toBe(true);
  });

  it("forgives a sub-cent dust balance (not payable)", () => {
    expect(isInvoicePayable("Partially Paid", 0.003)).toBe(false);
    expect(isInvoicePayable("Partially Paid", 0.009)).toBe(false);
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
