// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import {
  CUSTOMER_DEPOSIT_APPLIED_DESCRIPTION,
  CUSTOMER_DEPOSIT_DESCRIPTION,
  SUPPLIER_PREPAYMENT_APPLIED_DESCRIPTION,
  SUPPLIER_PREPAYMENT_DESCRIPTION
} from "./accounting-posting.ts";
import {
  buildPaymentJournal,
  type PaymentJournalApplicationInput
} from "./build-payment-journal.ts";
import { round } from "./precision.ts";

type Input = Parameters<typeof buildPaymentJournal>[0];
type AccountClass = "Asset" | "Liability" | "Expense" | "Revenue";

const base = (overrides: Partial<Input> = {}): Input => ({
  paymentId: "payment",
  companyId: "company",
  isAR: true,
  cashIn: true,
  totalAmount: 0,
  exchangeRate: 1,
  bankAccount: "bank",
  journalLineReference: "reference",
  applications: [],
  newOnAccountBase: 0,
  accounts: {
    controlAccountId: "today-control",
    discountAccountId: "discount",
    writeOffAccountId: "writeoff",
    fxGainAccountId: "fxgain",
    fxLossAccountId: "fxloss"
  },
  ...overrides
});

const amountOf = (
  result: ReturnType<typeof buildPaymentJournal>,
  accountId: string
) => result.lines.find((line) => line.accountId === accountId)?.amount;

// Decode storage independently by account class: a natural-signed sum or the
// builder's own running total cannot prove GL balance once a liability is in
// the entry.
const decodedDebitTotal = (
  result: ReturnType<typeof buildPaymentJournal>,
  classes: Record<string, AccountClass>
) =>
  round(
    result.lines.reduce((sum, line) => {
      const accountClass = classes[line.accountId];
      if (!accountClass)
        throw new Error(`Unexpected account ${line.accountId}`);
      return (
        sum +
        (accountClass === "Asset" || accountClass === "Expense"
          ? line.amount
          : -line.amount)
      );
    }, 0)
  );

it.each([true, false])(
  "multiple target rates preserve per-invoice relief, signed FX and GL balance (isAR=%s)",
  (isAR) => {
    // Document cash 88 + 55 is worth base 143 at the payment's rate of 1.
    // Target A: 88 / 1.1 = 80 principal + 15 discount + 5 write-off = 100.
    // Target B: 55 / 0.8 = 68.75 principal + 3 discount + 2 write-off = 73.75.
    // AR realizes +8 and -13.75 (net loss 5.75); AP has the opposite.
    const target = (id: string) => ({
      targetSalesInvoiceId: isAR ? id : null,
      targetPurchaseInvoiceId: isAR ? null : id,
      targetControlAccountId: `control-${id}`,
      sourceExchangeRate: 1,
      sourcePaymentId: null
    });
    const applications: PaymentJournalApplicationInput[] = [
      {
        ...target("a"),
        targetExchangeRate: 1.1,
        sourceAmount: 88,
        appliedAmount: 80,
        discountAmount: 15,
        writeOffAmount: 5,
        fxGainLossAmount: isAR ? 8 : -8
      },
      {
        ...target("b"),
        targetExchangeRate: 0.8,
        sourceAmount: 55,
        appliedAmount: 68.75,
        discountAmount: 3,
        writeOffAmount: 2,
        fxGainLossAmount: isAR ? -13.75 : 13.75
      }
    ];
    const result = buildPaymentJournal(
      base({ isAR, cashIn: isAR, totalAmount: 143, applications })
    );

    const linesFor = (id: string) =>
      result.lines
        .filter((line) => line.documentLineReference === id)
        .map((line) => [line.accountId, line.amount]);
    // Natural-balance storage decreases both AR assets and AP liabilities;
    // each invoice is relieved on its ORIGINAL control account.
    expect(linesFor("a")).toEqual(
      expect.arrayContaining([
        ["control-a", -100],
        ["discount", isAR ? 15 : -15],
        ["writeoff", 5]
      ])
    );
    expect(linesFor("b")).toEqual(
      expect.arrayContaining([
        ["control-b", -73.75],
        ["discount", isAR ? 3 : -3],
        ["writeoff", 2]
      ])
    );
    expect(amountOf(result, "bank")).toEqual(isAR ? 143 : -143);
    expect(result.totalFxImpact).toEqual(isAR ? -5.75 : 5.75);
    expect(amountOf(result, isAR ? "fxloss" : "fxgain")).toEqual(5.75);
    expect(amountOf(result, "today-control")).toBeUndefined();

    const control = isAR ? "Asset" : "Liability";
    expect(
      decodedDebitTotal(result, {
        bank: "Asset",
        "control-a": control,
        "control-b": control,
        discount: "Expense",
        writeoff: isAR ? "Expense" : "Revenue",
        fxgain: "Revenue",
        fxloss: "Expense"
      })
    ).toEqual(0);
    expect(result.signedDebitTotal).toEqual(0);
  }
);

// A customer DEPOSIT — a Receipt referencing a sales order or rental agreement
// — is the customer's money held against that document. Its unapplied cash is
// a liability on the prepayment account (2110), never on-account receivable
// credit; applying it later releases 2110 against the invoice; and a
// Disbursement carrying the same reference refunds it from 2110.
const depositClasses: Record<string, AccountClass> = {
  bank: "Asset",
  prepayment: "Liability",
  "original-control": "Asset",
  "today-control": "Asset"
};

it("deposit receipt holds its unapplied cash on the prepayment account, not receivables", () => {
  const result = buildPaymentJournal(
    base({
      totalAmount: 3000,
      newOnAccountBase: 3000,
      isDeposit: true,
      depositAccountId: "prepayment"
    })
  );
  expect(amountOf(result, "bank")).toEqual(3000);
  // A credit to a liability is stored positive: 3,000 owed back to the customer.
  expect(
    result.lines.find((line) => line.accountId === "prepayment")
  ).toMatchObject({ amount: 3000, description: CUSTOMER_DEPOSIT_DESCRIPTION });
  expect(amountOf(result, "today-control")).toBeUndefined();
  expect(decodedDebitTotal(result, depositClasses)).toEqual(0);
  expect(result.signedDebitTotal).toEqual(0);
});

it("applying a deposit to an invoice releases the prepayment account against receivables", () => {
  // A zero-cash receipt funded by the posted deposit (sourcePaymentId), with
  // the source marked as a deposit on the prepayment account.
  const result = buildPaymentJournal(
    base({
      paymentId: "application",
      applications: [
        {
          targetSalesInvoiceId: "invoice",
          targetControlAccountId: "original-control",
          sourcePaymentId: "deposit",
          sourceControlAccountId: "prepayment",
          sourceIsDeposit: true,
          sourceAmount: 500,
          appliedAmount: 500,
          discountAmount: 0,
          writeOffAmount: 0,
          targetExchangeRate: 1,
          sourceExchangeRate: 1,
          fxGainLossAmount: 0
        }
      ],
      isDeposit: false,
      depositAccountId: "prepayment"
    })
  );
  // A debit to a liability is stored negative: 500 less owed back.
  expect(
    result.lines.find((line) => line.accountId === "prepayment")
  ).toMatchObject({
    amount: -500,
    description: CUSTOMER_DEPOSIT_APPLIED_DESCRIPTION
  });
  expect(amountOf(result, "original-control")).toEqual(-500);
  expect(amountOf(result, "bank")).toBeUndefined();
  expect(amountOf(result, "today-control")).toBeUndefined();
  expect(decodedDebitTotal(result, depositClasses)).toEqual(0);
  expect(result.signedDebitTotal).toEqual(0);
});

it("a receipt without a document reference keeps its remainder on receivables", () => {
  const result = buildPaymentJournal(
    base({
      totalAmount: 3000,
      newOnAccountBase: 3000,
      isDeposit: false,
      depositAccountId: "prepayment"
    })
  );
  expect(amountOf(result, "today-control")).toEqual(-3000);
  expect(amountOf(result, "prepayment")).toBeUndefined();
  expect(decodedDebitTotal(result, depositClasses)).toEqual(0);
});

it("a deposit refuses to post without a prepayment account", () => {
  expect(() =>
    buildPaymentJournal(
      base({
        totalAmount: 3000,
        newOnAccountBase: 3000,
        isDeposit: true,
        depositAccountId: null
      })
    )
  ).toThrow(CUSTOMER_DEPOSIT_DESCRIPTION);
});

// A SUPPLIER PREPAYMENT — a Disbursement referencing a purchase order — is
// our money held by the supplier against that order: an ASSET on the supplier
// prepayment account (1150), never an on-account debit inside payables.
// Applying it later releases 1150 against the invoice's AP; a Receipt carrying
// the same reference refunds it from 1150.
const prepaymentClasses: Record<string, AccountClass> = {
  bank: "Asset",
  prepayment: "Asset",
  "original-control": "Liability",
  "today-control": "Liability"
};

it("supplier prepayment holds its unapplied cash on the prepayment asset, not payables", () => {
  const result = buildPaymentJournal(
    base({
      isAR: false,
      cashIn: false,
      totalAmount: 3000,
      newOnAccountBase: 3000,
      isDeposit: true,
      depositAccountId: "prepayment"
    })
  );
  expect(amountOf(result, "bank")).toEqual(-3000);
  // A debit to an asset is stored positive: 3,000 owed to us in goods.
  expect(
    result.lines.find((line) => line.accountId === "prepayment")
  ).toMatchObject({
    amount: 3000,
    description: SUPPLIER_PREPAYMENT_DESCRIPTION
  });
  expect(amountOf(result, "today-control")).toBeUndefined();
  expect(decodedDebitTotal(result, prepaymentClasses)).toEqual(0);
  expect(result.signedDebitTotal).toEqual(0);
});

it("applying a supplier prepayment to a purchase invoice releases the asset against payables", () => {
  const result = buildPaymentJournal(
    base({
      isAR: false,
      cashIn: false,
      paymentId: "application",
      applications: [
        {
          targetPurchaseInvoiceId: "invoice",
          targetControlAccountId: "original-control",
          sourcePaymentId: "prepayment-payment",
          sourceControlAccountId: "prepayment",
          sourceIsDeposit: true,
          sourceAmount: 500,
          appliedAmount: 500,
          discountAmount: 0,
          writeOffAmount: 0,
          targetExchangeRate: 1,
          sourceExchangeRate: 1,
          fxGainLossAmount: 0
        }
      ],
      isDeposit: false,
      depositAccountId: "prepayment"
    })
  );
  // A credit to an asset is stored negative: 500 less owed to us.
  expect(
    result.lines.find((line) => line.accountId === "prepayment")
  ).toMatchObject({
    amount: -500,
    description: SUPPLIER_PREPAYMENT_APPLIED_DESCRIPTION
  });
  // A debit to a liability is stored negative: 500 less owed to the supplier.
  expect(amountOf(result, "original-control")).toEqual(-500);
  expect(amountOf(result, "bank")).toBeUndefined();
  expect(decodedDebitTotal(result, prepaymentClasses)).toEqual(0);
  expect(result.signedDebitTotal).toEqual(0);
});

it("a supplier disbursement without a purchase order keeps its remainder on payables", () => {
  const result = buildPaymentJournal(
    base({
      isAR: false,
      cashIn: false,
      totalAmount: 3000,
      newOnAccountBase: 3000,
      isDeposit: false,
      depositAccountId: "prepayment"
    })
  );
  // A debit to a liability is stored negative.
  expect(amountOf(result, "today-control")).toEqual(-3000);
  expect(amountOf(result, "prepayment")).toBeUndefined();
  expect(decodedDebitTotal(result, prepaymentClasses)).toEqual(0);
});

it.each([false, true])(
  "refunds original deposit carrying value and books only cash FX (isAR=%s)",
  (isAR) => {
    const result = buildPaymentJournal(
      base({
        isAR,
        cashIn: !isAR,
        totalAmount: 55,
        exchangeRate: 1.25,
        isDeposit: true,
        depositAccountId: "changed-default",
        applications: [
          {
            targetPaymentId: "advance",
            sourcePaymentId: "advance",
            sourceControlAccountId: "original-deposit",
            sourceIsDeposit: true,
            sourceAmount: 55,
            appliedAmount: 50,
            sourceExchangeRate: 1.1,
            targetExchangeRate: 1.1,
            discountAmount: 0,
            writeOffAmount: 0,
            fxGainLossAmount: 0
          }
        ]
      })
    );
    expect(amountOf(result, "bank")).toBe(isAR ? -44 : 44);
    expect(
      result.lines.find((line) => line.accountId === "original-deposit")
    ).toMatchObject({
      amount: -50,
      description: isAR
        ? CUSTOMER_DEPOSIT_APPLIED_DESCRIPTION
        : SUPPLIER_PREPAYMENT_APPLIED_DESCRIPTION,
      documentLineReference: "advance"
    });
    expect(amountOf(result, "changed-default")).toBeUndefined();
    expect(result.totalFxImpact).toBe(isAR ? 6 : -6);
    expect(result.signedDebitTotal).toBe(0);
  }
);

it("refuses an unallocated deposit refund", () => {
  expect(() =>
    buildPaymentJournal(
      base({
        isAR: false,
        cashIn: true,
        totalAmount: 10,
        newOnAccountBase: 10,
        isDeposit: true,
        depositAccountId: "prepayment"
      })
    )
  ).toThrow();
});

it("reconstructs a legacy customer deposit refund without payment-target applications", () => {
  const result = buildPaymentJournal(
    base({
      isAR: true,
      cashIn: false,
      totalAmount: 110,
      exchangeRate: 1.1,
      newOnAccountBase: 100,
      isDeposit: true,
      depositAccountId: "prepayment",
      legacyCustomerDepositRefund: true
    })
  );
  expect(
    result.lines.map(({ accountId, amount, description }) => ({
      accountId,
      amount,
      description
    }))
  ).toEqual([
    { accountId: "bank", amount: -100, description: "Bank / Cash" },
    {
      accountId: "prepayment",
      amount: -100,
      description: CUSTOMER_DEPOSIT_DESCRIPTION
    }
  ]);
  expect(result.signedDebitTotal).toBe(0);
});

it("reconstructs a legacy customer deposit refund's memo application and remaining deposit debit", () => {
  const result = buildPaymentJournal(
    base({
      isAR: true,
      cashIn: false,
      totalAmount: 110,
      exchangeRate: 1.1,
      newOnAccountBase: 60,
      isDeposit: true,
      depositAccountId: "prepayment",
      legacyCustomerDepositRefund: true,
      applications: [
        {
          targetMemoId: "memo",
          sourcePaymentId: null,
          sourceAmount: 44,
          appliedAmount: 40,
          sourceExchangeRate: 1.1,
          targetExchangeRate: 1.1,
          discountAmount: 0,
          writeOffAmount: 0,
          fxGainLossAmount: 0
        }
      ]
    })
  );
  expect(amountOf(result, "bank")).toBe(-100);
  expect(amountOf(result, "today-control")).toBe(40);
  expect(amountOf(result, "prepayment")).toBe(-60);
  expect(result.signedDebitTotal).toBe(0);
});

it.each([true, false])(
  "new unallocated deposit refunds remain strict (isAR=%s)",
  (isAR) => {
    expect(() =>
      buildPaymentJournal(
        base({
          isAR,
          cashIn: !isAR,
          totalAmount: 10,
          newOnAccountBase: 10,
          isDeposit: true,
          depositAccountId: "prepayment"
        })
      )
    ).toThrow();
  }
);

it("does not allow supplier refunds to opt into legacy customer reconstruction", () => {
  expect(() =>
    buildPaymentJournal(
      base({
        isAR: false,
        cashIn: true,
        totalAmount: 10,
        newOnAccountBase: 10,
        isDeposit: true,
        depositAccountId: "prepayment",
        legacyCustomerDepositRefund: true
      })
    )
  ).toThrow();
});
