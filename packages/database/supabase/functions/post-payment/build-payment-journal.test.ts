import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { round } from "../shared/precision.ts";
import {
  buildPaymentJournal,
  type PaymentJournalApplicationInput,
} from "./build-payment-journal.ts";

for (const isAR of [true, false]) {
  Deno.test(`${isAR ? "AR" : "AP"} multiple target rates preserve per-invoice relief, signed FX and decoded GL balance`, () => {
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
        fxGainLossAmount: isAR ? 8 : -8,
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
        fxGainLossAmount: isAR ? -13.75 : 13.75,
      },
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
        fxLossAccountId: "fxloss",
      },
    });

    for (const [index, application] of applications.entries()) {
      const target = index === 0 ? "invoice-a" : "invoice-b";
      const expectedRelief = index === 0 ? 100 : 73.75;
      const lines = result.lines.filter((line) =>
        line.documentLineReference === target
      );
      const control = lines.find((line) =>
        line.accountId === application.targetControlAccountId
      );
      assert(control, `Missing original control for ${target}`);
      // Natural-balance storage decreases both AR assets and AP liabilities.
      assertEquals(control.amount, -expectedRelief);
      assertEquals(
        -control.amount,
        round(
          application.appliedAmount + application.discountAmount +
            application.writeOffAmount,
        ),
      );
      assertEquals(
        lines.find((line) => line.accountId === "discount")?.amount,
        isAR ? application.discountAmount : -application.discountAmount,
      );
      assertEquals(
        lines.find((line) => line.accountId === "writeoff")?.amount,
        application.writeOffAmount,
      );
      assertEquals(round(expectedRelief + control.amount), 0);
    }
    assertEquals(
      result.lines.find((line) => line.accountId === "bank")?.amount,
      isAR ? 143 : -143,
    );
    assertEquals(result.totalFxImpact, isAR ? -5.75 : 5.75);
    assertEquals(
      result.lines.find((line) =>
        line.accountId === (isAR ? "fxloss" : "fxgain")
      )?.amount,
      5.75,
    );
    assert(!result.lines.some((line) => line.accountId === "today-control"));

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
      fxloss: "Expense",
    };
    const debitSigned = result.lines.reduce((sum, line) => {
      const accountClass = classes[line.accountId];
      assert(accountClass, `Unexpected account ${line.accountId}`);
      return sum +
        (accountClass === "Asset" || accountClass === "Expense"
          ? line.amount
          : -line.amount);
    }, 0);
    assertEquals(round(debitSigned), 0);
    assertEquals(result.signedDebitTotal, 0);
  });
}

// Direction of cash and ledger side are independent. A Disbursement to a
// CUSTOMER is an AR refund (cash out, receivable restored); a Receipt from a
// SUPPLIER is an AP refund. `payment_party_check` permits both, the composer
// stages them, and the docs describe them as supported — post-payment must not
// refuse them.
for (const isAR of [true, false]) {
  Deno.test(`${isAR ? "AR" : "AP"} refund posts cash on the opposite side of its ledger`, () => {
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
          fxGainLossAmount: 0,
        },
      ],
      newOnAccountBase: 0,
      accounts: {
        controlAccountId: "today-control",
        discountAccountId: "discount",
        writeOffAccountId: "writeoff",
        fxGainAccountId: "fxgain",
        fxLossAccountId: "fxloss",
      },
    });

    // An AR refund pays cash OUT, so the bank asset falls; an AP refund
    // receives cash back, so it rises. This is the axis `cashIn` owns.
    assertEquals(
      result.lines.find((line) => line.accountId === "bank")?.amount,
      isAR ? -40 : 40,
    );
    // The ledger side is the axis `isAR` owns: the refund restores the
    // original control account rather than relieving it.
    assertEquals(
      result.lines.find((line) => line.accountId === "original-control")
        ?.amount,
      40,
    );
    const classes: Record<
      string,
      "Asset" | "Liability" | "Expense" | "Revenue"
    > = {
      bank: "Asset",
      "original-control": isAR ? "Asset" : "Liability",
    };
    const debitSigned = result.lines.reduce((sum, line) => {
      const accountClass = classes[line.accountId];
      assert(accountClass, `Unexpected account ${line.accountId}`);
      return sum +
        (accountClass === "Asset" || accountClass === "Expense"
          ? line.amount
          : -line.amount);
    }, 0);
    assertEquals(round(debitSigned), 0);
    assertEquals(result.signedDebitTotal, 0);
  });
}
