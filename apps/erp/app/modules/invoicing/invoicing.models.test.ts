// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  invoiceSettlementValidator,
  isInvoicePayable,
  memoValidator,
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

  it("accepts a Disbursement with an employee (reimbursement payout)", () => {
    const r = paymentValidator.safeParse({
      ...validReceipt,
      paymentType: "Disbursement",
      customerId: undefined,
      employeeId: "emp1"
    });
    expect(r.success).toBe(true);
  });

  it.each([
    ["customer", { customerId: "cust1" }],
    ["supplier", { supplierId: "supp1" }]
  ])("rejects an employee payee alongside a %s", (_label, other) => {
    expect(
      paymentValidator.safeParse({
        ...validReceipt,
        paymentType: "Disbursement",
        customerId: undefined,
        employeeId: "emp1",
        ...other
      }).success
    ).toBe(false);
  });

  it("rejects a payment with no party at all", () => {
    expect(
      paymentValidator.safeParse({
        ...validReceipt,
        customerId: undefined
      }).success
    ).toBe(false);
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

  it("accepts an application against a reimbursement", () => {
    const r = invoiceSettlementValidator.safeParse({
      ...validApp,
      targetSalesInvoiceId: undefined,
      targetReimbursementId: "reimb1"
    });
    expect(r.success).toBe(true);
  });

  it("rejects a reimbursement target alongside an invoice target", () => {
    const r = invoiceSettlementValidator.safeParse({
      ...validApp,
      targetReimbursementId: "reimb1"
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

describe("memoValidator", () => {
  /**
   * All four party × direction combinations are legal and must stay authorable.
   * `memoDirection` carries both values, `memo`'s only party constraint is
   * customer-XOR-supplier (verified against the live schema — nothing pairs the
   * two), both memo list routes filter on the PARTY and offer direction as a
   * separate filter, and `packages/database/src/datasets/validate.ts` requires
   * coverage of both directions.
   *
   * `MemoForm` briefly derived `direction` from the party and force-submitted it
   * with `<Hidden value>`, which both overwrote a stored direction on save and
   * made a customer Debit / supplier Credit memo unauthorable. This pins the
   * contract that change violated.
   */
  const base = {
    memoDate: "2026-09-28",
    currencyCode: "USD",
    amount: "100",
    exchangeRate: "1"
  };

  it.each([
    ["customer", "Credit"],
    ["customer", "Debit"],
    ["supplier", "Credit"],
    ["supplier", "Debit"]
  ] as const)("accepts a %s memo in the %s direction", (party, direction) => {
    const result = memoValidator.safeParse({
      ...base,
      direction,
      ...(party === "customer"
        ? { customerId: "cust_1" }
        : { supplierId: "sup_1" })
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.direction).toBe(direction);
  });

  it("still requires exactly one party", () => {
    for (const parties of [{}, { customerId: "cust_1", supplierId: "sup_1" }]) {
      expect(
        memoValidator.safeParse({ ...base, direction: "Credit", ...parties })
          .success
      ).toBe(false);
    }
  });

  it("requires a direction rather than defaulting one", () => {
    // A defaulted direction is how a wrong one reaches the journal unnoticed.
    expect(
      memoValidator.safeParse({ ...base, customerId: "cust_1" }).success
    ).toBe(false);
  });
});
