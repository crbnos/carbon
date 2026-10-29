// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  invoiceSettlementValidator,
  isInvoicePayable,
  memoValidator,
  paymentValidator,
  purchaseInvoiceSupplierChange,
  salesInvoiceCustomerChange
} from "./invoicing.models";

describe("paymentValidator", () => {
  const base = (overrides: Record<string, unknown>) =>
    paymentValidator.safeParse({
      paymentType: "Receipt",
      paymentDate: "2026-05-19",
      currencyCode: "USD",
      exchangeRate: 1,
      totalAmount: 100,
      bankAccount: "acc1",
      ...overrides
    });

  // Exactly one party; either direction is legal for a customer or a supplier
  // (refunds), an employee only receives a reimbursement payout.
  it.each([
    ["Receipt", { customerId: "cust1" }, true],
    ["Disbursement", { supplierId: "supp1" }, true],
    ["Disbursement", { customerId: "cust1" }, true],
    ["Receipt", { supplierId: "supp1" }, true],
    ["Disbursement", { employeeId: "emp1" }, true],
    ["Receipt", {}, false],
    ["Disbursement", {}, false],
    ["Receipt", { customerId: "cust1", supplierId: "supp1" }, false],
    ["Disbursement", { customerId: "cust1", supplierId: "supp1" }, false],
    ["Disbursement", { employeeId: "emp1", customerId: "cust1" }, false],
    ["Disbursement", { employeeId: "emp1", supplierId: "supp1" }, false]
  ])("%s with %o parses: %s", (paymentType, parties, success) => {
    expect(base({ paymentType, ...parties }).success).toBe(success);
  });

  it("accepts a zero total (credit application, no cash) and refuses a negative one", () => {
    expect(base({ customerId: "cust1", totalAmount: 0 }).success).toBe(true);
    expect(base({ customerId: "cust1", totalAmount: -10 }).success).toBe(false);
  });
});

describe("invoiceSettlementValidator", () => {
  const base = (overrides: Record<string, unknown>) =>
    invoiceSettlementValidator.safeParse({
      paymentId: "p1",
      appliedAmount: 50,
      discountAmount: 0,
      writeOffAmount: 0,
      targetExchangeRate: 1,
      sourceExchangeRate: 1,
      appliedDate: "2026-05-19",
      ...overrides
    });

  it.each([
    [{ targetSalesInvoiceId: "si1" }, true],
    [{ targetPurchaseInvoiceId: "pi1" }, true],
    [{ targetReimbursementId: "reimb1" }, true],
    [{}, false],
    [{ targetSalesInvoiceId: "si1", targetPurchaseInvoiceId: "pi1" }, false],
    [{ targetSalesInvoiceId: "si1", targetReimbursementId: "reimb1" }, false]
  ])("needs exactly one target: %o parses %s", (targets, success) => {
    expect(base(targets).success).toBe(success);
  });

  it.each([
    [{ appliedAmount: 0 }, false],
    [{ appliedAmount: 0, discountAmount: 5 }, true],
    [{ appliedAmount: 0, writeOffAmount: 5 }, true]
  ])("needs a non-zero component: %o parses %s", (amounts, success) => {
    expect(base({ targetSalesInvoiceId: "si1", ...amounts }).success).toBe(
      success
    );
  });

  it("keeps the exact document principal when its rounded base is zero", () => {
    const result = base({
      targetSalesInvoiceId: "si1",
      appliedAmount: 0,
      sourceAmount: 0.01,
      sourceExchangeRate: 100000,
      targetExchangeRate: 100000
    });
    expect(result.data?.sourceAmount).toBe(0.01);
  });
});

describe("isInvoicePayable", () => {
  it.each([
    ["Partially Paid", 25, true],
    ["Submitted", 0.01, true],
    ["Overdue", 100, true],
    // A foreign document remainder below one base cent is still owed.
    ["Partially Paid", 0.003, true],
    ["Paid", 0, false],
    ["Submitted", 0, false],
    ["Voided", 100, false],
    ["Draft", 100, false],
    ["Pending", 100, false],
    [null, null, false],
    [undefined, undefined, false]
  ])("%s with balance %s → %s", (status, balance, payable) => {
    expect(isInvoicePayable(status, balance)).toBe(payable);
  });
});

// Every party × direction is legal: deriving direction from the party once
// made a customer Debit / supplier Credit memo unauthorable.
describe("memoValidator", () => {
  const base = {
    memoDate: "2026-09-28",
    currencyCode: "USD",
    amount: "100",
    exchangeRate: "1"
  };

  it.each([
    [{ customerId: "cust_1" }, "Credit"],
    [{ customerId: "cust_1" }, "Debit"],
    [{ supplierId: "sup_1" }, "Credit"],
    [{ supplierId: "sup_1" }, "Debit"]
  ] as const)("accepts %o in the %s direction", (party, direction) => {
    expect(
      memoValidator.safeParse({ ...base, direction, ...party }).data?.direction
    ).toBe(direction);
  });

  it.each([{}, { customerId: "cust_1", supplierId: "sup_1" }])(
    "requires exactly one party, refusing %o",
    (parties) => {
      expect(
        memoValidator.safeParse({ ...base, direction: "Credit", ...parties })
          .success
      ).toBe(false);
    }
  );

  it("requires a direction rather than defaulting one", () => {
    expect(
      memoValidator.safeParse({ ...base, customerId: "cust_1" }).success
    ).toBe(false);
  });
});

describe("invoice party change", () => {
  const eur = { currencyCode: "EUR", exchangeRate: 0.92 };

  it("sets the invoice customer, clears its contact and location, and keeps the currency when the customer has none", () => {
    expect(salesInvoiceCustomerChange("cust_billing", null)).toEqual({
      invoiceCustomerId: "cust_billing",
      invoiceCustomerContactId: null,
      invoiceCustomerLocationId: null
    });
  });

  it("takes the invoice customer's currency, never the sold-to customer", () => {
    expect(salesInvoiceCustomerChange("cust_billing", eur)).toEqual({
      invoiceCustomerId: "cust_billing",
      invoiceCustomerContactId: null,
      invoiceCustomerLocationId: null,
      ...eur
    });
  });

  it("sets the invoice supplier and takes its currency, never the supplier", () => {
    expect(purchaseInvoiceSupplierChange("supp_billing", null)).toEqual({
      invoiceSupplierId: "supp_billing",
      invoiceSupplierContactId: null,
      invoiceSupplierLocationId: null
    });
    expect(purchaseInvoiceSupplierChange("supp_billing", eur)).toEqual({
      invoiceSupplierId: "supp_billing",
      invoiceSupplierContactId: null,
      invoiceSupplierLocationId: null,
      ...eur
    });
  });
});
