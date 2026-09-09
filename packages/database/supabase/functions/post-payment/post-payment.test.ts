import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import {
  buildPaymentJournal,
  type BuildPaymentJournalInput,
  type PaymentJournalApplicationInput,
} from "./build-payment-journal.ts";

const accounts = {
  controlAccountId: "control",
  discountAccountId: "discount",
  writeOffAccountId: "writeoff",
  fxGainAccountId: "fxgain",
  fxLossAccountId: "fxloss",
};
const app = (
  input: Partial<PaymentJournalApplicationInput> = {},
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
  ...input,
});
const payment = (
  input: Partial<BuildPaymentJournalInput> = {},
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
  ...input,
});
const total = (
  result: ReturnType<typeof buildPaymentJournal>,
  account: string,
) =>
  result.lines.filter((line) => line.accountId === account).reduce(
    (sum, line) => sum + line.amount,
    0,
  );

Deno.test("applications clear recorded target and source controls after defaults change", () => {
  const result = buildPaymentJournal(
    payment({
      totalAmount: 0,
      applications: [app({
        sourcePaymentId: "prior",
        targetControlAccountId: "original-invoice-control",
        sourceControlAccountId: "original-credit-control",
      })],
    }),
  );
  assertEquals(total(result, "original-invoice-control"), -100);
  assertEquals(total(result, "original-credit-control"), 100);
  assertEquals(total(result, "control"), 0);
  assertEquals(result.signedDebitTotal, 0);
});

Deno.test("receipt110 at1.1 releases base100 and posts no realized FX", () => {
  const result = buildPaymentJournal(payment());
  assertEquals(total(result, "bank"), 100);
  assertEquals(total(result, "control"), -100);
  assertEquals(result.totalFxImpact, 0);
  assertEquals(result.signedDebitTotal, 0);
});

Deno.test("disbursement110 at1.1 releases base100 payable", () => {
  const result = buildPaymentJournal(
    payment({
      isAR: false,
      cashIn: false,
      applications: [
        app({ targetSalesInvoiceId: null, targetPurchaseInvoiceId: "invoice" }),
      ],
    }),
  );
  assertEquals(total(result, "bank"), -100);
  assertEquals(total(result, "control"), -100);
  assertEquals(result.signedDebitTotal, 0);
});

for (const isAR of [true, false]) {
  Deno.test(`${isAR ? "customer" : "supplier"} refund builder retains independent party and cash direction`, () => {
    const result = buildPaymentJournal(payment({
      isAR,
      cashIn: !isAR,
      exchangeRate: 1,
      applications: [
        app({
          targetSalesInvoiceId: isAR ? "invoice" : null,
          targetPurchaseInvoiceId: isAR ? null : "invoice",
          sourceExchangeRate: 1,
          fxGainLossAmount: isAR ? -10 : 10,
        }),
      ],
    }));
    assertEquals(total(result, "bank"), isAR ? -110 : 110);
    assertEquals(total(result, "control"), 100);
    assertEquals(total(result, isAR ? "fxloss" : "fxgain"), 10);
    assertEquals(result.signedDebitTotal, 0);
  });
}

for (const isAR of [true, false]) {
  for (
    const [rate, cashBase, arFx] of [[1, 110, 10], [1.25, 88, -12]] as const
  ) {
    Deno.test(`${isAR ? "AR" : "AP"} cash110 at${rate} posts persisted FX and base100 control`, () => {
      const fx = isAR ? arFx : -arFx;
      const result = buildPaymentJournal(payment({
        isAR,
        cashIn: isAR,
        exchangeRate: rate,
        applications: [
          app({
            targetSalesInvoiceId: isAR ? "invoice" : null,
            targetPurchaseInvoiceId: isAR ? null : "invoice",
            sourceExchangeRate: rate,
            fxGainLossAmount: fx,
          }),
        ],
      }));
      assertEquals(total(result, "bank"), isAR ? cashBase : -cashBase);
      assertEquals(total(result, "control"), -100);
      assertEquals(result.totalFxImpact, fx);
      assertEquals(total(result, fx > 0 ? "fxgain" : "fxloss"), Math.abs(fx));
      assertEquals(result.signedDebitTotal, 0);
    });
  }
}

Deno.test("withheld fee3.30 converts to base3 with bank97 and control100", () => {
  const result = buildPaymentJournal(
    payment({
      fee: { amount: 3.3, accountId: "fee", description: "Processor fee" },
    }),
  );
  assertEquals(total(result, "bank"), 97);
  assertEquals(total(result, "fee"), 3);
  assertEquals(total(result, "control"), -100);
  assertEquals(result.signedDebitTotal, 0);
});

Deno.test("base discount/writeoff remain base and carry no separate FX", () => {
  const result = buildPaymentJournal(payment({
    totalAmount: 88,
    exchangeRate: 1,
    applications: [
      app({
        sourceAmount: 88,
        sourceExchangeRate: 1,
        appliedAmount: 80,
        discountAmount: 15,
        writeOffAmount: 5,
        fxGainLossAmount: 8,
      }),
    ],
  }));
  assertEquals(total(result, "bank"), 88);
  assertEquals(total(result, "control"), -100);
  assertEquals(total(result, "discount"), 15);
  assertEquals(total(result, "writeoff"), 5);
  assertEquals(total(result, "fxgain"), 8);
  assertEquals(result.signedDebitTotal, 0);
});

Deno.test("AP allowance and writeoff reverse expense and credit income", () => {
  const result = buildPaymentJournal(payment({
    isAR: false,
    cashIn: false,
    totalAmount: 88,
    exchangeRate: 1,
    applications: [app({
      targetSalesInvoiceId: null,
      targetPurchaseInvoiceId: "invoice",
      sourceAmount: 88,
      sourceExchangeRate: 1,
      appliedAmount: 80,
      discountAmount: 15,
      writeOffAmount: 5,
      fxGainLossAmount: -8,
    })],
  }));
  assertEquals(total(result, "bank"), -88);
  assertEquals(total(result, "control"), -100);
  assertEquals(total(result, "discount"), -15);
  assertEquals(total(result, "writeoff"), 5);
  assertEquals(total(result, "fxloss"), 8);
  assertEquals(result.signedDebitTotal, 0);
});

Deno.test("unused current cash alone creates new on-account carrying value", () => {
  const result = buildPaymentJournal(
    payment({ totalAmount: 165, newOnAccountBase: 50 }),
  );
  assertEquals(total(result, "bank"), 150);
  assertEquals(total(result, "control"), -150);
  assertEquals(
    result.lines.find((line) => line.description.includes("on-account credit"))
      ?.amount,
    -50,
  );
  assertEquals(result.signedDebitTotal, 0);
});

for (const isAR of [true, false]) {
  Deno.test(`${isAR ? "AR" : "AP"} zero-cash prior credit uses original source carrying at changed target rate`, () => {
    const result = buildPaymentJournal(payment({
      isAR,
      cashIn: isAR,
      totalAmount: 0,
      exchangeRate: 1.5,
      applications: [app({
        targetSalesInvoiceId: isAR ? "invoice" : null,
        targetPurchaseInvoiceId: isAR ? null : "invoice",
        appliedAmount: 88,
        targetExchangeRate: 1.25,
        sourcePaymentId: "prior",
        fxGainLossAmount: isAR ? 12 : -12,
      })],
    }));
    assertEquals(total(result, "bank"), 0);
    assertEquals(
      result.lines.find((line) => line.description.includes("credit applied"))
        ?.amount,
      100,
    );
    assertEquals(result.totalFxImpact, isAR ? 12 : -12);
    assertEquals(result.signedDebitTotal, 0);
  });
}

Deno.test("mixed current cash and two prior snapshots release recorded sources independently", () => {
  const result = buildPaymentJournal(payment({
    totalAmount: 55,
    applications: [
      app({ sourceAmount: 55, appliedAmount: 50 }),
      app({
        sourcePaymentId: "first",
        sourceAmount: 27.5,
        sourceExchangeRate: 1,
        appliedAmount: 25,
        fxGainLossAmount: 2.5,
      }),
      app({
        sourcePaymentId: "second",
        sourceAmount: 27.5,
        sourceExchangeRate: 1.25,
        appliedAmount: 25,
        fxGainLossAmount: -3,
      }),
    ],
  }));
  assertEquals(total(result, "bank"), 50);
  assertEquals(
    result.lines.find((line) => line.description.includes("credit applied"))
      ?.amount,
    49.5,
  );
  assertEquals(result.totalFxImpact, -0.5);
  assertEquals(result.signedDebitTotal, 0);
});

Deno.test("terminal160.01 release uses recorded base .01 without reconstructing source units", () => {
  const result = buildPaymentJournal(
    payment({
      totalAmount: 160.01,
      exchangeRate: 16000,
      applications: [
        app({
          sourceAmount: 160.01,
          sourceExchangeRate: 16000,
          targetExchangeRate: 16000,
          appliedAmount: 0.01,
        }),
      ],
    }),
  );
  assertEquals(total(result, "bank"), 0.01);
  assertEquals(total(result, "control"), -0.01);
  assertEquals(result.signedDebitTotal, 0);
});

Deno.test("positive final document unit with zero base is a valid balanced settlement", () => {
  const result = buildPaymentJournal(
    payment({
      totalAmount: 0.01,
      exchangeRate: 16000,
      applications: [
        app({
          sourceAmount: 0.01,
          sourceExchangeRate: 16000,
          targetExchangeRate: 16000,
          appliedAmount: 0,
        }),
      ],
    }),
  );
  assertEquals(result.signedDebitTotal, 0);
  assertEquals(result.totalFxImpact, 0);
});

Deno.test("final prior-source .33334 carrying release is honored instead of rerounding1/3", () => {
  const result = buildPaymentJournal(payment({
    totalAmount: 0,
    exchangeRate: 1,
    applications: [
      app({
        sourcePaymentId: "prior",
        sourceAmount: 1,
        sourceExchangeRate: 3,
        targetExchangeRate: 2,
        appliedAmount: 0.5,
        fxGainLossAmount: -0.16666,
      }),
    ],
  }));
  assertEquals(
    result.lines.find((line) => line.description.includes("credit applied"))
      ?.amount,
    0.33334,
  );
  assertEquals(result.totalFxImpact, -0.16666);
  assert(Math.abs(result.signedDebitTotal) < 1e-9);
});

Deno.test("discount-only application creates no source release or FX", () => {
  const result = buildPaymentJournal(
    payment({
      totalAmount: 0,
      applications: [
        app({ sourceAmount: 0, appliedAmount: 0, discountAmount: 100 }),
      ],
    }),
  );
  assertEquals(total(result, "control"), -100);
  assertEquals(total(result, "discount"), 100);
  assertEquals(result.signedDebitTotal, 0);
});

Deno.test("source and invoice references remain attached to actual emitted lines", () => {
  const result = buildPaymentJournal(payment());
  for (const line of result.lines) {
    assertEquals(line.documentId, "payment");
    assertEquals(line.companyId, "company");
    assertEquals(line.journalLineReference, "reference");
  }
  assertEquals(
    result.lines.find((line) => line.accountId === "control")
      ?.documentLineReference,
    "invoice",
  );
});

for (
  const [field, input] of [
    ["controlAccountId", payment()],
    [
      "discountAccountId",
      payment({
        totalAmount: 99,
        applications: [
          app({ sourceAmount: 99, appliedAmount: 90, discountAmount: 10 }),
        ],
      }),
    ],
    [
      "writeOffAccountId",
      payment({
        totalAmount: 99,
        applications: [
          app({ sourceAmount: 99, appliedAmount: 90, writeOffAmount: 10 }),
        ],
      }),
    ],
    [
      "fxGainAccountId",
      payment({
        exchangeRate: 1,
        applications: [app({ sourceExchangeRate: 1, fxGainLossAmount: 10 })],
      }),
    ],
    [
      "fxLossAccountId",
      payment({
        exchangeRate: 1.25,
        applications: [
          app({ sourceExchangeRate: 1.25, fxGainLossAmount: -12 }),
        ],
      }),
    ],
  ] as const
) {
  Deno.test(`missing relevant ${field} refuses journal construction`, () => {
    assertThrows(() =>
      buildPaymentJournal({
        ...input,
        accounts: { ...accounts, [field]: null },
      })
    );
  });
}

Deno.test("invalid rates, nonfinite values, negative relief and excessive fees fail", () => {
  for (const exchangeRate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assertThrows(() => buildPaymentJournal(payment({ exchangeRate })));
  }
  for (const totalAmount of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assertThrows(() => buildPaymentJournal(payment({ totalAmount })));
  }
  assertThrows(() =>
    buildPaymentJournal(
      payment({ applications: [app({ discountAmount: -1 })] }),
    )
  );
  assertThrows(() =>
    buildPaymentJournal(payment({ fee: { amount: 111, accountId: "fee" } }))
  );
  assertThrows(() =>
    buildPaymentJournal(
      payment({ applications: [app({ fxGainLossAmount: Number.NaN })] }),
    )
  );
});

Deno.test("inconsistent cash source snapshots cannot be concealed by an unapplied plug", () => {
  assertThrows(() =>
    buildPaymentJournal(
      payment({ applications: [app({ fxGainLossAmount: 10 })] }),
    )
  );
  assertThrows(() => buildPaymentJournal(payment({ newOnAccountBase: 5 })));
});

// #1600 reclassified the seeded discount accounts: customer discounts are
// contra-revenue (4040, class Revenue) and supplier discounts contra-COGS
// (5080, class Expense) — neither is an operating expense. The journal line's
// natural-balance sign therefore follows the ACCOUNT'S class, not a hardcoded
// "expense". The tests above omit `discountAccountClass` on purpose and pin the
// back-compat fallback.
Deno.test("AR customer discount debits a Revenue-class account as contra-revenue", () => {
  const result = buildPaymentJournal(payment({
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
        fxGainLossAmount: 8,
      }),
    ],
  }));
  // A debit to a credit-natural account stores negative: the discount REDUCES
  // revenue rather than adding an expense.
  assertEquals(total(result, "discount"), -15);
  assertEquals(total(result, "control"), -100);
  assertEquals(result.signedDebitTotal, 0);
});

Deno.test("AP supplier discount credits an Expense-class account as contra-cost", () => {
  const result = buildPaymentJournal(payment({
    isAR: false,
    cashIn: false,
    totalAmount: 88,
    exchangeRate: 1,
    accounts: { ...accounts, discountAccountClass: "Expense" },
    applications: [app({
      targetSalesInvoiceId: null,
      targetPurchaseInvoiceId: "invoice",
      sourceAmount: 88,
      sourceExchangeRate: 1,
      appliedAmount: 80,
      discountAmount: 15,
      writeOffAmount: 5,
      fxGainLossAmount: -8,
    })],
  }));
  assertEquals(total(result, "discount"), -15);
  assertEquals(total(result, "control"), -100);
  assertEquals(result.signedDebitTotal, 0);
});

Deno.test("an unknown discount account class is refused rather than guessed", () => {
  assertThrows(() =>
    buildPaymentJournal(payment({
      accounts: { ...accounts, discountAccountClass: "Contra-Revenue" },
      applications: [app({ discountAmount: 10 })],
    }))
  );
});
