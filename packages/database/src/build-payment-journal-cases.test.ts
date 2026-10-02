// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import {
  type BuildPaymentJournalInput,
  buildPaymentJournal,
  type PaymentJournalApplicationInput
} from "./build-payment-journal.ts";

const accounts = {
  controlAccountId: "control",
  discountAccountId: "discount",
  writeOffAccountId: "writeoff",
  fxGainAccountId: "fxgain",
  fxLossAccountId: "fxloss"
};
const app = (
  input: Partial<PaymentJournalApplicationInput> = {}
): PaymentJournalApplicationInput => ({
  targetSalesInvoiceId: "invoice",
  appliedAmount: 100,
  discountAmount: 0,
  writeOffAmount: 0,
  sourceAmount: 110,
  sourcePaymentId: null,
  sourceExchangeRate: 1.1,
  targetExchangeRate: 1.1,
  fxGainLossAmount: 0,
  ...input
});
const payment = (
  input: Partial<BuildPaymentJournalInput> = {}
): BuildPaymentJournalInput => ({
  paymentId: "payment",
  companyId: "company",
  isAR: true,
  cashIn: true,
  totalAmount: 110,
  exchangeRate: 1.1,
  bankAccount: "bank",
  journalLineReference: "reference",
  applications: [app()],
  accounts: { ...accounts },
  newOnAccountBase: 0,
  ...input
});
const total = (
  result: ReturnType<typeof buildPaymentJournal>,
  account: string
) =>
  result.lines
    .filter((line) => line.accountId === account)
    .reduce((sum, line) => sum + line.amount, 0);

it("applications clear recorded target and source controls after defaults change", () => {
  const result = buildPaymentJournal(
    payment({
      totalAmount: 0,
      applications: [
        app({
          sourcePaymentId: "prior",
          targetControlAccountId: "original-invoice-control",
          sourceControlAccountId: "original-credit-control"
        })
      ]
    })
  );
  expect(total(result, "original-invoice-control")).toEqual(-100);
  expect(total(result, "original-credit-control")).toEqual(100);
  expect(total(result, "control")).toEqual(0);
  expect(result.signedDebitTotal).toEqual(0);
});

it("receipt110 at1.1 releases base100 and posts no realized FX", () => {
  const result = buildPaymentJournal(payment());
  expect(total(result, "bank")).toEqual(100);
  expect(total(result, "control")).toEqual(-100);
  expect(result.totalFxImpact).toEqual(0);
  expect(result.signedDebitTotal).toEqual(0);
});

it("disbursement110 at1.1 releases base100 payable", () => {
  const result = buildPaymentJournal(
    payment({
      isAR: false,
      cashIn: false,
      applications: [
        app({ targetSalesInvoiceId: null, targetPurchaseInvoiceId: "invoice" })
      ]
    })
  );
  expect(total(result, "bank")).toEqual(-100);
  expect(total(result, "control")).toEqual(-100);
  expect(result.signedDebitTotal).toEqual(0);
});

for (const isAR of [true, false]) {
  it(`${isAR ? "customer" : "supplier"} refund builder retains independent party and cash direction`, () => {
    const result = buildPaymentJournal(
      payment({
        isAR,
        cashIn: !isAR,
        exchangeRate: 1,
        applications: [
          app({
            targetSalesInvoiceId: null,
            targetPurchaseInvoiceId: null,
            targetMemoId: "memo",
            sourceExchangeRate: 1,
            fxGainLossAmount: isAR ? -10 : 10
          })
        ]
      })
    );
    expect(total(result, "bank")).toEqual(isAR ? -110 : 110);
    expect(total(result, "control")).toEqual(100);
    expect(total(result, isAR ? "fxloss" : "fxgain")).toEqual(10);
    expect(result.signedDebitTotal).toEqual(0);
  });
}

for (const isAR of [true, false]) {
  for (const [rate, cashBase, arFx] of [
    [1, 110, 10],
    [1.25, 88, -12]
  ] as const) {
    it(`${isAR ? "AR" : "AP"} cash110 at${rate} posts persisted FX and base100 control`, () => {
      const fx = isAR ? arFx : -arFx;
      const result = buildPaymentJournal(
        payment({
          isAR,
          cashIn: isAR,
          exchangeRate: rate,
          applications: [
            app({
              targetSalesInvoiceId: isAR ? "invoice" : null,
              targetPurchaseInvoiceId: isAR ? null : "invoice",
              sourceExchangeRate: rate,
              fxGainLossAmount: fx
            })
          ]
        })
      );
      expect(total(result, "bank")).toEqual(isAR ? cashBase : -cashBase);
      expect(total(result, "control")).toEqual(-100);
      expect(result.totalFxImpact).toEqual(fx);
      expect(total(result, fx > 0 ? "fxgain" : "fxloss")).toEqual(Math.abs(fx));
      expect(result.signedDebitTotal).toEqual(0);
    });
  }
}

it("withheld fee3.30 converts to base3 with bank97 and control100", () => {
  const result = buildPaymentJournal(
    payment({
      fee: { amount: 3.3, accountId: "fee", description: "Processor fee" }
    })
  );
  expect(total(result, "bank")).toEqual(97);
  expect(total(result, "fee")).toEqual(3);
  expect(total(result, "control")).toEqual(-100);
  expect(result.signedDebitTotal).toEqual(0);
});

it("base discount/writeoff remain base and carry no separate FX", () => {
  const result = buildPaymentJournal(
    payment({
      totalAmount: 88,
      exchangeRate: 1,
      applications: [
        app({
          sourceAmount: 88,
          sourceExchangeRate: 1,
          appliedAmount: 80,
          discountAmount: 15,
          writeOffAmount: 5,
          fxGainLossAmount: 8
        })
      ]
    })
  );
  expect(total(result, "bank")).toEqual(88);
  expect(total(result, "control")).toEqual(-100);
  expect(total(result, "discount")).toEqual(15);
  expect(total(result, "writeoff")).toEqual(5);
  expect(total(result, "fxgain")).toEqual(8);
  expect(result.signedDebitTotal).toEqual(0);
});

it("AP allowance and writeoff reverse expense and credit income", () => {
  const result = buildPaymentJournal(
    payment({
      isAR: false,
      cashIn: false,
      totalAmount: 88,
      exchangeRate: 1,
      applications: [
        app({
          targetSalesInvoiceId: null,
          targetPurchaseInvoiceId: "invoice",
          sourceAmount: 88,
          sourceExchangeRate: 1,
          appliedAmount: 80,
          discountAmount: 15,
          writeOffAmount: 5,
          fxGainLossAmount: -8
        })
      ]
    })
  );
  expect(total(result, "bank")).toEqual(-88);
  expect(total(result, "control")).toEqual(-100);
  expect(total(result, "discount")).toEqual(-15);
  expect(total(result, "writeoff")).toEqual(5);
  expect(total(result, "fxloss")).toEqual(8);
  expect(result.signedDebitTotal).toEqual(0);
});

it("unused current cash alone creates new on-account carrying value", () => {
  const result = buildPaymentJournal(
    payment({ totalAmount: 165, newOnAccountBase: 50 })
  );
  expect(total(result, "bank")).toEqual(150);
  expect(total(result, "control")).toEqual(-150);
  expect(
    result.lines.find((line) => line.description.includes("on-account credit"))
      ?.amount
  ).toEqual(-50);
  expect(result.signedDebitTotal).toEqual(0);
});

for (const isAR of [true, false]) {
  it(`${isAR ? "AR" : "AP"} zero-cash prior credit uses original source carrying at changed target rate`, () => {
    const result = buildPaymentJournal(
      payment({
        isAR,
        cashIn: isAR,
        totalAmount: 0,
        exchangeRate: 1.5,
        applications: [
          app({
            targetSalesInvoiceId: isAR ? "invoice" : null,
            targetPurchaseInvoiceId: isAR ? null : "invoice",
            appliedAmount: 88,
            targetExchangeRate: 1.25,
            sourcePaymentId: "prior",
            fxGainLossAmount: isAR ? 12 : -12
          })
        ]
      })
    );
    expect(total(result, "bank")).toEqual(0);
    expect(
      result.lines.find((line) => line.description.includes("credit applied"))
        ?.amount
    ).toEqual(100);
    expect(result.totalFxImpact).toEqual(isAR ? 12 : -12);
    expect(result.signedDebitTotal).toEqual(0);
  });
}

it("mixed current cash and two prior snapshots release recorded sources independently", () => {
  const result = buildPaymentJournal(
    payment({
      totalAmount: 55,
      applications: [
        app({ sourceAmount: 55, appliedAmount: 50 }),
        app({
          sourcePaymentId: "first",
          sourceAmount: 27.5,
          sourceExchangeRate: 1,
          appliedAmount: 25,
          fxGainLossAmount: 2.5
        }),
        app({
          sourcePaymentId: "second",
          sourceAmount: 27.5,
          sourceExchangeRate: 1.25,
          appliedAmount: 25,
          fxGainLossAmount: -3
        })
      ]
    })
  );
  expect(total(result, "bank")).toEqual(50);
  expect(
    result.lines.find((line) => line.description.includes("credit applied"))
      ?.amount
  ).toEqual(49.5);
  expect(result.totalFxImpact).toEqual(-0.5);
  expect(result.signedDebitTotal).toEqual(0);
});

it("terminal160.01 release uses recorded base .01 without reconstructing source units", () => {
  const result = buildPaymentJournal(
    payment({
      totalAmount: 160.01,
      exchangeRate: 16000,
      applications: [
        app({
          sourceAmount: 160.01,
          sourceExchangeRate: 16000,
          targetExchangeRate: 16000,
          appliedAmount: 0.01
        })
      ]
    })
  );
  expect(total(result, "bank")).toEqual(0.01);
  expect(total(result, "control")).toEqual(-0.01);
  expect(result.signedDebitTotal).toEqual(0);
});

it("positive final document unit with zero base is a valid balanced settlement", () => {
  const result = buildPaymentJournal(
    payment({
      totalAmount: 0.01,
      exchangeRate: 16000,
      applications: [
        app({
          sourceAmount: 0.01,
          sourceExchangeRate: 16000,
          targetExchangeRate: 16000,
          appliedAmount: 0
        })
      ]
    })
  );
  expect(result.signedDebitTotal).toEqual(0);
  expect(result.totalFxImpact).toEqual(0);
});

it("final prior-source .33334 carrying release is honored instead of rerounding1/3", () => {
  const result = buildPaymentJournal(
    payment({
      totalAmount: 0,
      exchangeRate: 1,
      applications: [
        app({
          sourcePaymentId: "prior",
          sourceAmount: 1,
          sourceExchangeRate: 3,
          targetExchangeRate: 2,
          appliedAmount: 0.5,
          fxGainLossAmount: -0.16666
        })
      ]
    })
  );
  expect(
    result.lines.find((line) => line.description.includes("credit applied"))
      ?.amount
  ).toEqual(0.33334);
  expect(result.totalFxImpact).toEqual(-0.16666);
  expect(Math.abs(result.signedDebitTotal) < 1e-9).toBeTruthy();
});

it("discount-only application creates no source release or FX", () => {
  const result = buildPaymentJournal(
    payment({
      totalAmount: 0,
      applications: [
        app({ sourceAmount: 0, appliedAmount: 0, discountAmount: 100 })
      ]
    })
  );
  expect(total(result, "control")).toEqual(-100);
  expect(total(result, "discount")).toEqual(100);
  expect(result.signedDebitTotal).toEqual(0);
});

it("source and invoice references remain attached to actual emitted lines", () => {
  const result = buildPaymentJournal(payment());
  for (const line of result.lines) {
    expect(line.documentId).toEqual("payment");
    expect(line.companyId).toEqual("company");
    expect(line.journalLineReference).toEqual("reference");
  }
  expect(
    result.lines.find((line) => line.accountId === "control")
      ?.documentLineReference
  ).toEqual("invoice");
});

for (const [field, input] of [
  ["controlAccountId", payment()],
  [
    "discountAccountId",
    payment({
      totalAmount: 99,
      applications: [
        app({ sourceAmount: 99, appliedAmount: 90, discountAmount: 10 })
      ]
    })
  ],
  [
    "writeOffAccountId",
    payment({
      totalAmount: 99,
      applications: [
        app({ sourceAmount: 99, appliedAmount: 90, writeOffAmount: 10 })
      ]
    })
  ],
  [
    "fxGainAccountId",
    payment({
      exchangeRate: 1,
      applications: [app({ sourceExchangeRate: 1, fxGainLossAmount: 10 })]
    })
  ],
  [
    "fxLossAccountId",
    payment({
      exchangeRate: 1.25,
      applications: [app({ sourceExchangeRate: 1.25, fxGainLossAmount: -12 })]
    })
  ]
] as const) {
  it(`missing relevant ${field} refuses journal construction`, () => {
    expect(() =>
      buildPaymentJournal({
        ...input,
        accounts: { ...accounts, [field]: null }
      })
    ).toThrow();
  });
}

it("invalid rates, nonfinite values, negative relief and excessive fees fail", () => {
  for (const exchangeRate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => buildPaymentJournal(payment({ exchangeRate }))).toThrow();
  }
  for (const totalAmount of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => buildPaymentJournal(payment({ totalAmount }))).toThrow();
  }
  expect(() =>
    buildPaymentJournal(
      payment({ applications: [app({ discountAmount: -1 })] })
    )
  ).toThrow();
  expect(() =>
    buildPaymentJournal(payment({ fee: { amount: 111, accountId: "fee" } }))
  ).toThrow();
  expect(() =>
    buildPaymentJournal(
      payment({ applications: [app({ fxGainLossAmount: Number.NaN })] })
    )
  ).toThrow();
});

it("inconsistent cash source snapshots cannot be concealed by an unapplied plug", () => {
  expect(() =>
    buildPaymentJournal(
      payment({ applications: [app({ fxGainLossAmount: 10 })] })
    )
  ).toThrow();
  expect(() => buildPaymentJournal(payment({ newOnAccountBase: 5 }))).toThrow();
});

// #1600 reclassified the seeded discount accounts: customer discounts are
// contra-revenue (4040, class Revenue) and supplier discounts contra-COGS
// (5080, class Expense) — neither is an operating expense. The journal line's
// natural-balance sign therefore follows the ACCOUNT'S class, not a hardcoded
// "expense". The tests above omit `discountAccountClass` on purpose and pin the
// back-compat fallback.
it("AR customer discount debits a Revenue-class account as contra-revenue", () => {
  const result = buildPaymentJournal(
    payment({
      totalAmount: 88,
      exchangeRate: 1,
      accounts: { ...accounts, discountAccountClass: "Revenue" },
      applications: [
        app({
          sourceAmount: 88,
          sourceExchangeRate: 1,
          appliedAmount: 80,
          discountAmount: 15,
          writeOffAmount: 5,
          fxGainLossAmount: 8
        })
      ]
    })
  );
  // A debit to a credit-natural account stores negative: the discount REDUCES
  // revenue rather than adding an expense.
  expect(total(result, "discount")).toEqual(-15);
  expect(total(result, "control")).toEqual(-100);
  expect(result.signedDebitTotal).toEqual(0);
});

it("AP supplier discount credits an Expense-class account as contra-cost", () => {
  const result = buildPaymentJournal(
    payment({
      isAR: false,
      cashIn: false,
      totalAmount: 88,
      exchangeRate: 1,
      accounts: { ...accounts, discountAccountClass: "Expense" },
      applications: [
        app({
          targetSalesInvoiceId: null,
          targetPurchaseInvoiceId: "invoice",
          sourceAmount: 88,
          sourceExchangeRate: 1,
          appliedAmount: 80,
          discountAmount: 15,
          writeOffAmount: 5,
          fxGainLossAmount: -8
        })
      ]
    })
  );
  expect(total(result, "discount")).toEqual(-15);
  expect(total(result, "control")).toEqual(-100);
  expect(result.signedDebitTotal).toEqual(0);
});

it("an unknown discount account class is refused rather than guessed", () => {
  expect(() =>
    buildPaymentJournal(
      payment({
        accounts: { ...accounts, discountAccountClass: "Contra-Revenue" },
        applications: [app({ discountAmount: 10 })]
      })
    )
  ).toThrow();
});

// --- Employee reimbursement payouts -----------------------------------------
// Structurally the AP arm (cash out, liability control debited) with
// `targetReimbursementId` as the target column and the reimbursement's OWN
// booked payable account as the control. Amounts are natural-balance signed, so
// a balanced entry is `signedDebitTotal === 0`, NOT a zero sum of `amount`.

const reimbursementPayout = (
  input: Partial<BuildPaymentJournalInput> = {}
): BuildPaymentJournalInput =>
  payment({
    isAR: false,
    isReimbursement: true,
    cashIn: false,
    totalAmount: 620,
    exchangeRate: 1,
    newOnAccountBase: 0,
    applications: [
      app({
        targetSalesInvoiceId: null,
        targetReimbursementId: "reimbursement",
        targetControlAccountId: "employee-payable",
        sourceAmount: 620,
        appliedAmount: 620,
        sourceExchangeRate: 1,
        targetExchangeRate: 1
      })
    ],
    ...input
  });

it("a reimbursement payout debits the employee payable and credits the bank", () => {
  const result = buildPaymentJournal(reimbursementPayout());
  // Natural-balance signing: credit("asset", 620) stores −620 and
  // debit("liability", 620) ALSO stores −620 (paying down a liability reduces
  // it). The entry balances in debit(+)/credit(−) space, not in stored `amount`
  // — which is exactly why `signedDebitTotal` is the assertion that matters.
  expect(total(result, "bank")).toEqual(-620);
  expect(total(result, "employee-payable")).toEqual(-620);
  expect(total(result, "control")).toEqual(0);
  expect(result.signedDebitTotal).toEqual(0);
  expect(result.totalFxImpact).toEqual(0);
  expect(
    result.lines.find((line) => line.accountId === "employee-payable")
      ?.description
  ).toEqual("Employee Reimbursements Payable");
  expect(
    result.lines.find((line) => line.accountId === "employee-payable")
      ?.documentLineReference
  ).toEqual("reimbursement");
});

it("a partial reimbursement payout releases only the cash it paid", () => {
  const result = buildPaymentJournal(
    reimbursementPayout({
      totalAmount: 200,
      applications: [
        app({
          targetSalesInvoiceId: null,
          targetReimbursementId: "reimbursement",
          targetControlAccountId: "employee-payable",
          sourceAmount: 200,
          appliedAmount: 200,
          sourceExchangeRate: 1,
          targetExchangeRate: 1
        })
      ]
    })
  );
  expect(total(result, "bank")).toEqual(-200);
  expect(total(result, "employee-payable")).toEqual(-200);
  expect(result.signedDebitTotal).toEqual(0);
});

it("a reimbursement payout refuses a discount, a write-off or a second target", () => {
  for (const invalid of [
    { discountAmount: 20 },
    { writeOffAmount: 20 },
    { targetPurchaseInvoiceId: "invoice" },
    { targetMemoId: "memo" },
    { sourcePaymentId: "prior" },
    { targetReimbursementId: null }
  ]) {
    expect(() =>
      buildPaymentJournal(
        reimbursementPayout({
          applications: [
            app({
              targetSalesInvoiceId: null,
              targetReimbursementId: "reimbursement",
              targetControlAccountId: "employee-payable",
              sourceAmount: 620,
              appliedAmount: 620,
              sourceExchangeRate: 1,
              targetExchangeRate: 1,
              ...invalid
            })
          ]
        })
      )
    ).toThrow("Invalid payment application target");
  }
});

it("an AP payment cannot smuggle a reimbursement target", () => {
  expect(() =>
    buildPaymentJournal(
      payment({
        isAR: false,
        cashIn: false,
        totalAmount: 100,
        exchangeRate: 1,
        applications: [
          app({
            targetSalesInvoiceId: null,
            targetPurchaseInvoiceId: "invoice",
            targetReimbursementId: "reimbursement",
            sourceAmount: 100,
            appliedAmount: 100,
            sourceExchangeRate: 1,
            targetExchangeRate: 1
          })
        ]
      })
    )
  ).toThrow("Invalid payment application target");
});
