// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import {
  CUSTOMER_DEPOSIT_APPLIED_DESCRIPTION,
  CUSTOMER_DEPOSIT_DESCRIPTION
} from "./accounting-posting.ts";
import {
  buildPaymentJournal,
  type PaymentJournalApplicationInput
} from "./build-payment-journal.ts";
import { round } from "./precision.ts";

for (const isAR of [true, false]) {
  it(`${isAR ? "AR" : "AP"} multiple target rates preserve per-invoice relief, signed FX and decoded GL balance`, () => {
    // Document cash 88 + 55 is worth base 143 at the payment's rate of 1.
    // Target A: 88 / 1.1 = 80 principal + 15 discount + 5 write-off = 100.
    // Target B: 55 / 0.8 = 68.75 principal + 3 discount + 2 write-off = 73.75.
    // AR realizes +8 and -13.75; AP has the opposite gains/losses.
    const applications: PaymentJournalApplicationInput[] = [
      {
        targetSalesInvoiceId: isAR ? "invoice-a" : null,
        targetPurchaseInvoiceId: isAR ? null : "invoice-a",
        targetControlAccountId: "original-control-a",
        targetExchangeRate: 1.1,
        sourceExchangeRate: 1,
        sourcePaymentId: null,
        sourceAmount: 88,
        appliedAmount: 80,
        discountAmount: 15,
        writeOffAmount: 5,
        fxGainLossAmount: isAR ? 8 : -8
      },
      {
        targetSalesInvoiceId: isAR ? "invoice-b" : null,
        targetPurchaseInvoiceId: isAR ? null : "invoice-b",
        targetControlAccountId: "original-control-b",
        targetExchangeRate: 0.8,
        sourceExchangeRate: 1,
        sourcePaymentId: null,
        sourceAmount: 55,
        appliedAmount: 68.75,
        discountAmount: 3,
        writeOffAmount: 2,
        fxGainLossAmount: isAR ? -13.75 : 13.75
      }
    ];
    const result = buildPaymentJournal({
      paymentId: "payment",
      companyId: "company",
      isAR,
      cashIn: isAR,
      totalAmount: 143,
      exchangeRate: 1,
      bankAccount: "bank",
      journalLineReference: "reference",
      applications,
      newOnAccountBase: 0,
      accounts: {
        controlAccountId: "today-control",
        discountAccountId: "discount",
        writeOffAccountId: "writeoff",
        fxGainAccountId: "fxgain",
        fxLossAccountId: "fxloss"
      }
    });

    for (const [index, application] of applications.entries()) {
      const target = index === 0 ? "invoice-a" : "invoice-b";
      const expectedRelief = index === 0 ? 100 : 73.75;
      const lines = result.lines.filter(
        (line) => line.documentLineReference === target
      );
      const control = lines.find(
        (line) => line.accountId === application.targetControlAccountId
      );
      if (!control) throw new Error(`Missing original control for ${target}`);
      // Natural-balance storage decreases both AR assets and AP liabilities.
      expect(control.amount).toEqual(-expectedRelief);
      expect(-control.amount).toEqual(
        round(
          application.appliedAmount +
            application.discountAmount +
            application.writeOffAmount
        )
      );
      expect(
        lines.find((line) => line.accountId === "discount")?.amount
      ).toEqual(
        isAR ? application.discountAmount : -application.discountAmount
      );
      expect(
        lines.find((line) => line.accountId === "writeoff")?.amount
      ).toEqual(application.writeOffAmount);
      expect(round(expectedRelief + control.amount)).toEqual(0);
    }
    expect(
      result.lines.find((line) => line.accountId === "bank")?.amount
    ).toEqual(isAR ? 143 : -143);
    expect(result.totalFxImpact).toEqual(isAR ? -5.75 : 5.75);
    expect(
      result.lines.find(
        (line) => line.accountId === (isAR ? "fxloss" : "fxgain")
      )?.amount
    ).toEqual(5.75);
    expect(
      !result.lines.some((line) => line.accountId === "today-control")
    ).toBeTruthy();

    // Decode storage independently by account class; a natural-signed sum
    // or the builder's returned running total alone cannot prove GL balance.
    const classes: Record<
      string,
      "Asset" | "Liability" | "Expense" | "Revenue"
    > = {
      bank: "Asset",
      "original-control-a": isAR ? "Asset" : "Liability",
      "original-control-b": isAR ? "Asset" : "Liability",
      discount: "Expense",
      writeoff: isAR ? "Expense" : "Revenue",
      fxgain: "Revenue",
      fxloss: "Expense"
    };
    const debitSigned = result.lines.reduce((sum, line) => {
      const accountClass = classes[line.accountId];
      expect(accountClass, `Unexpected account ${line.accountId}`).toBeTruthy();
      return (
        sum +
        (accountClass === "Asset" || accountClass === "Expense"
          ? line.amount
          : -line.amount)
      );
    }, 0);
    expect(round(debitSigned)).toEqual(0);
    expect(result.signedDebitTotal).toEqual(0);
  });
}

// Direction of cash and ledger side are independent. A Disbursement to a
// CUSTOMER is an AR refund (cash out, receivable restored); a Receipt from a
// SUPPLIER is an AP refund. `payment_party_check` permits both, the composer
// stages them, and the docs describe them as supported — post-payment must not
// refuse them.
for (const isAR of [true, false]) {
  it(`${isAR ? "AR" : "AP"} refund posts cash on the opposite side of its ledger`, () => {
    const result = buildPaymentJournal({
      paymentId: "payment",
      companyId: "company",
      isAR,
      // The refund case: cash moves the opposite way to the normal flow.
      cashIn: !isAR,
      totalAmount: 40,
      exchangeRate: 1,
      bankAccount: "bank",
      journalLineReference: "reference",
      applications: [
        {
          targetMemoId: "memo-a",
          targetControlAccountId: "original-control",
          targetExchangeRate: 1,
          sourceExchangeRate: 1,
          sourcePaymentId: null,
          sourceAmount: 40,
          appliedAmount: 40,
          discountAmount: 0,
          writeOffAmount: 0,
          fxGainLossAmount: 0
        }
      ],
      newOnAccountBase: 0,
      accounts: {
        controlAccountId: "today-control",
        discountAccountId: "discount",
        writeOffAccountId: "writeoff",
        fxGainAccountId: "fxgain",
        fxLossAccountId: "fxloss"
      }
    });

    // An AR refund pays cash OUT, so the bank asset falls; an AP refund
    // receives cash back, so it rises. This is the axis `cashIn` owns.
    expect(
      result.lines.find((line) => line.accountId === "bank")?.amount
    ).toEqual(isAR ? -40 : 40);
    // The ledger side is the axis `isAR` owns: the refund restores the
    // original control account rather than relieving it.
    expect(
      result.lines.find((line) => line.accountId === "original-control")?.amount
    ).toEqual(40);
    const classes: Record<
      string,
      "Asset" | "Liability" | "Expense" | "Revenue"
    > = {
      bank: "Asset",
      "original-control": isAR ? "Asset" : "Liability"
    };
    const debitSigned = result.lines.reduce((sum, line) => {
      const accountClass = classes[line.accountId];
      expect(accountClass, `Unexpected account ${line.accountId}`).toBeTruthy();
      return (
        sum +
        (accountClass === "Asset" || accountClass === "Expense"
          ? line.amount
          : -line.amount)
      );
    }, 0);
    expect(round(debitSigned)).toEqual(0);
    expect(result.signedDebitTotal).toEqual(0);
  });
}

// A customer DEPOSIT — a Receipt referencing a sales order or rental agreement
// — is the customer's money held against that document. Its unapplied cash is
// a liability on the prepayment account (2110), never on-account receivable
// credit; applying it later releases 2110 against the invoice; and a
// Disbursement carrying the same reference refunds it from 2110. Across the
// three, 2110 nets to zero and receivables never carry the deposit itself.
const depositAccounts = {
  controlAccountId: "today-control",
  discountAccountId: "discount",
  writeOffAccountId: "writeoff",
  fxGainAccountId: "fxgain",
  fxLossAccountId: "fxloss"
};
const depositClasses: Record<
  string,
  "Asset" | "Liability" | "Expense" | "Revenue"
> = {
  bank: "Asset",
  prepayment: "Liability",
  "original-control": "Asset",
  "today-control": "Asset"
};
// Decode storage independently by account class, as the tests above do: a
// natural-signed sum cannot prove GL balance once a liability is in the entry.
const decodedDebitTotal = (result: ReturnType<typeof buildPaymentJournal>) =>
  round(
    result.lines.reduce((sum, line) => {
      const accountClass = depositClasses[line.accountId];
      expect(accountClass, `Unexpected account ${line.accountId}`).toBeTruthy();
      return (
        sum +
        (accountClass === "Asset" || accountClass === "Expense"
          ? line.amount
          : -line.amount)
      );
    }, 0)
  );

it("deposit receipt holds its unapplied cash on the prepayment account, not receivables", () => {
  const result = buildPaymentJournal({
    paymentId: "deposit",
    companyId: "company",
    isAR: true,
    cashIn: true,
    totalAmount: 3000,
    exchangeRate: 1,
    bankAccount: "bank",
    journalLineReference: "reference",
    applications: [],
    newOnAccountBase: 3000,
    accounts: depositAccounts,
    isDeposit: true,
    depositAccountId: "prepayment"
  });
  expect(
    result.lines.find((line) => line.accountId === "bank")?.amount
  ).toEqual(3000);
  const held = result.lines.find((line) => line.accountId === "prepayment");
  if (!held) throw new Error("Missing prepayment line");
  // A credit to a liability is stored positive: 3,000 owed back to the customer.
  expect(held.amount).toEqual(3000);
  expect(held.description).toEqual(CUSTOMER_DEPOSIT_DESCRIPTION);
  expect(
    !result.lines.some((line) => line.accountId === "today-control")
  ).toBeTruthy();
  expect(decodedDebitTotal(result)).toEqual(0);
  expect(result.signedDebitTotal).toEqual(0);
});

it("applying a deposit to an invoice releases the prepayment account against receivables", () => {
  // A zero-cash receipt funded by the posted deposit (sourcePaymentId), the
  // existing prior-credit path; the driver read the deposit's own journal line
  // and marked the source as a deposit on the prepayment account.
  const result = buildPaymentJournal({
    paymentId: "application",
    companyId: "company",
    isAR: true,
    cashIn: true,
    totalAmount: 0,
    exchangeRate: 1,
    bankAccount: "bank",
    journalLineReference: "reference",
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
    newOnAccountBase: 0,
    accounts: depositAccounts,
    isDeposit: false,
    depositAccountId: "prepayment"
  });
  const released = result.lines.find((line) => line.accountId === "prepayment");
  if (!released) throw new Error("Missing prepayment release");
  // A debit to a liability is stored negative: 500 less owed back.
  expect(released.amount).toEqual(-500);
  expect(released.description).toEqual(CUSTOMER_DEPOSIT_APPLIED_DESCRIPTION);
  expect(
    result.lines.find((line) => line.accountId === "original-control")?.amount
  ).toEqual(-500);
  expect(!result.lines.some((line) => line.accountId === "bank")).toBeTruthy();
  expect(
    !result.lines.some((line) => line.accountId === "today-control")
  ).toBeTruthy();
  expect(decodedDebitTotal(result)).toEqual(0);
  expect(result.signedDebitTotal).toEqual(0);
});

it("refunding a deposit is a customer Disbursement that debits the prepayment account", () => {
  const result = buildPaymentJournal({
    paymentId: "refund",
    companyId: "company",
    isAR: true,
    cashIn: false,
    totalAmount: 2500,
    exchangeRate: 1,
    bankAccount: "bank",
    journalLineReference: "reference",
    applications: [],
    newOnAccountBase: 2500,
    accounts: depositAccounts,
    isDeposit: true,
    depositAccountId: "prepayment"
  });
  expect(
    result.lines.find((line) => line.accountId === "bank")?.amount
  ).toEqual(-2500);
  const refunded = result.lines.find((line) => line.accountId === "prepayment");
  if (!refunded) throw new Error("Missing prepayment line");
  expect(refunded.amount).toEqual(-2500);
  expect(refunded.description).toEqual(CUSTOMER_DEPOSIT_DESCRIPTION);
  // Never restored to receivables: the customer was not owed on account.
  expect(
    !result.lines.some((line) => line.accountId === "today-control")
  ).toBeTruthy();
  expect(decodedDebitTotal(result)).toEqual(0);
  expect(result.signedDebitTotal).toEqual(0);
});

it("a receipt without a document reference keeps its remainder on receivables", () => {
  const result = buildPaymentJournal({
    paymentId: "payment",
    companyId: "company",
    isAR: true,
    cashIn: true,
    totalAmount: 3000,
    exchangeRate: 1,
    bankAccount: "bank",
    journalLineReference: "reference",
    applications: [],
    newOnAccountBase: 3000,
    accounts: depositAccounts,
    isDeposit: false,
    depositAccountId: "prepayment"
  });
  expect(
    result.lines.find((line) => line.accountId === "today-control")?.amount
  ).toEqual(-3000);
  expect(
    !result.lines.some((line) => line.accountId === "prepayment")
  ).toBeTruthy();
  expect(decodedDebitTotal(result)).toEqual(0);
});

it("a deposit refuses to post without a prepayment account", () => {
  expect(() =>
    buildPaymentJournal({
      paymentId: "deposit",
      companyId: "company",
      isAR: true,
      cashIn: true,
      totalAmount: 3000,
      exchangeRate: 1,
      bankAccount: "bank",
      journalLineReference: "reference",
      applications: [],
      newOnAccountBase: 3000,
      accounts: depositAccounts,
      isDeposit: true,
      depositAccountId: null
    })
  ).toThrow(CUSTOMER_DEPOSIT_DESCRIPTION);
});
