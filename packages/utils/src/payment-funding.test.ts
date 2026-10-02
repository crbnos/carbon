// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { toBaseAmount } from "@carbon/database/accounting-currency";
import { round } from "@carbon/database/precision";
import { expect, it } from "vitest";
import {
  allocatePaymentFunding,
  type FundingApplication,
  type FundingRequest,
  type FundingSource,
  invoiceRemainingAmounts,
  isEffectiveSettlement,
  reduceInvoiceSettlements,
  remainingFundingSources
} from "./payment-funding";

const source = (
  paymentId: string,
  remainingDocument: number,
  exchangeRate = 1,
  overrides: Partial<FundingSource> = {}
): FundingSource => ({
  paymentId,
  postingDate: "2026-09-07",
  exchangeRate,
  remainingDocument,
  remainingBase: toBaseAmount(remainingDocument, exchangeRate),
  ...overrides
});

const request = (
  targetId: string,
  principal: number,
  exchangeRate = 1,
  overrides: Partial<FundingRequest> = {}
): FundingRequest => ({
  targetId,
  targetExchangeRate: exchangeRate,
  remainingDocument: principal,
  remainingBase: toBaseAmount(principal, exchangeRate),
  requestedDocumentPrincipal: principal,
  discountAmount: 0,
  writeOffAmount: 0,
  ...overrides
});

const allocate = (
  currentPayment: FundingSource,
  requests: FundingRequest[],
  overrides: Partial<Parameters<typeof allocatePaymentFunding>[0]> = {}
) =>
  allocatePaymentFunding({
    currentPayment,
    priorSources: [],
    requests,
    currencyDecimals: 2,
    isAR: true,
    ...overrides
  });

function firstApplication(applications: FundingApplication[]) {
  expect(applications.length > 0).toEqual(true);
  return applications[0]!;
}

it("110 paid at matching1.10 snapshots relieves base100 without FX", () => {
  const result = allocate(source("current", 110, 1.1), [
    request("invoice", 110, 1.1)
  ]);
  expect(result).toEqual({
    applications: [
      {
        targetId: "invoice",
        sourcePaymentId: null,
        sourceAmount: 110,
        sourceExchangeRate: 1.1,
        targetExchangeRate: 1.1,
        appliedAmount: 100,
        discountAmount: 0,
        writeOffAmount: 0,
        fxGainLossAmount: 0
      }
    ],
    newOnAccountDocument: 0,
    sourceRemainders: [
      { paymentId: "current", remainingDocument: 0, remainingBase: 0 }
    ]
  });
});

for (const [paymentRate, arFx] of [
  [1, 10],
  [1.25, -12]
] as const) {
  for (const isAR of [true, false]) {
    it(`110 application with source rate${paymentRate}, ${isAR ? "AR" : "AP"} records correct signed FX`, () => {
      const result = allocate(
        source("current", 110, paymentRate),
        [request("invoice", 110, 1.1)],
        { isAR }
      );
      const row = firstApplication(result.applications);
      expect(row.appliedAmount).toEqual(100);
      expect(row.sourceAmount).toEqual(110);
      expect(row.fxGainLossAmount).toEqual(isAR ? arFx : -arFx);
      expect(result.newOnAccountDocument).toEqual(0);
    });
  }
}

it("discount and write-off remain target base and do not consume cash", () => {
  const result = allocate(source("current", 88), [
    request("invoice", 88, 1.1, {
      remainingDocument: 110,
      remainingBase: 100,
      discountAmount: 10
    })
  ]);
  const row = firstApplication(result.applications);
  expect(row.appliedAmount).toEqual(80);
  expect(row.discountAmount).toEqual(10);
  expect(row.sourceAmount).toEqual(88);
  expect(row.fxGainLossAmount).toEqual(8);
  expect(100 - row.appliedAmount - row.discountAmount).toEqual(10);
  const writtenOff = allocate(
    source("current", 88),
    [
      request("invoice", 88, 1.1, {
        remainingDocument: 110,
        remainingBase: 100,
        writeOffAmount: 10
      })
    ],
    { isAR: false }
  );
  expect(firstApplication(writtenOff.applications).writeOffAmount).toEqual(10);
  expect(firstApplication(writtenOff.applications).fxGainLossAmount).toEqual(
    -8
  );
});

it("payment132 applies110 and retains22 document /20 base from current cash", () => {
  const result = allocate(source("current", 132, 1.1), [
    request("invoice", 110, 1.1)
  ]);
  expect(result.newOnAccountDocument).toEqual(22);
  expect(result.sourceRemainders).toEqual([
    { paymentId: "current", remainingDocument: 22, remainingBase: 20 }
  ]);
});

it("two invoices at1.10 and1.20 funded by230 at1.15 reconcile to zero net FX", () => {
  const result = allocate(source("current", 230, 1.15), [
    request("a", 110, 1.1),
    request("b", 120, 1.2)
  ]);
  expect(result.applications.map((row) => row.appliedAmount)).toEqual([
    100, 100
  ]);
  expect(result.applications.map((row) => row.fxGainLossAmount)).toEqual([
    -4.34783, 4.34783
  ]);
  expect(
    round(
      result.applications.reduce((sum, row) => sum + row.fxGainLossAmount, 0)
    )
  ).toEqual(0);
  expect(result.sourceRemainders).toEqual([
    { paymentId: "current", remainingDocument: 0, remainingBase: 0 }
  ]);
});

it("a prior110 credit releases its original base100 against an invoice carrying88", () => {
  const priorSources = [
    source("credit", 110, 1.1, { postingDate: "2026-09-06" })
  ];
  const requests = [request("invoice", 110, 1.25)];
  const first = allocate(source("current", 0, 99), requests, { priorSources });
  const second = allocate(source("current", 0, 0.5), requests, {
    priorSources
  });
  expect(first).toEqual(second);
  expect(firstApplication(first.applications)).toEqual({
    targetId: "invoice",
    sourcePaymentId: "credit",
    sourceAmount: 110,
    sourceExchangeRate: 1.1,
    targetExchangeRate: 1.25,
    appliedAmount: 88,
    discountAmount: 0,
    writeOffAmount: 0,
    fxGainLossAmount: 12
  });
});

it("current cash first, then prior dates and IDs, without mutating input order", () => {
  const priorSources = [
    source("later", 100, 2, { postingDate: "2026-09-05" }),
    source("b", 33, 1.1, { postingDate: "2026-09-04" }),
    source("a", 44, 1.1, { postingDate: "2026-09-04" })
  ];
  const before = structuredClone(priorSources);
  const input = source("current", 22, 1.1);
  const requests = [request("invoice", 110, 1.1)];
  const result = allocate(input, requests, { priorSources });
  expect(result).toEqual(
    allocate(input, requests, { priorSources: [...priorSources].reverse() })
  );
  expect(priorSources).toEqual(before);
  expect(
    result.applications.map((row) => [
      row.sourcePaymentId,
      row.sourceAmount,
      row.appliedAmount
    ])
  ).toEqual([
    [null, 22, 20],
    ["a", 44, 40],
    ["b", 33, 30],
    ["later", 11, 10]
  ]);
  expect(result.sourceRemainders).toEqual([
    { paymentId: "current", remainingDocument: 0, remainingBase: 0 },
    { paymentId: "a", remainingDocument: 0, remainingBase: 0 },
    { paymentId: "b", remainingDocument: 0, remainingBase: 0 },
    { paymentId: "later", remainingDocument: 89, remainingBase: 44.5 }
  ]);
});

it("mixed cash and two prior rates assign discount/write-off exactly once", () => {
  const result = allocate(
    source("current", 22, 1.1),
    [
      request("invoice", 88, 1.1, {
        remainingDocument: 110,
        remainingBase: 100,
        discountAmount: 10,
        writeOffAmount: 10
      })
    ],
    {
      priorSources: [
        source("older", 33, 1),
        source("newer", 33, 1.5, { postingDate: "2026-09-08" })
      ]
    }
  );
  expect(
    result.applications.map((row) => [
      row.sourceAmount,
      row.appliedAmount,
      row.discountAmount,
      row.writeOffAmount,
      row.fxGainLossAmount
    ])
  ).toEqual([
    [22, 20, 10, 10, 0],
    [33, 30, 0, 0, 3],
    [33, 30, 0, 0, -8]
  ]);
  expect(
    result.applications.reduce(
      (sum, row) =>
        sum + row.appliedAmount + row.discountAmount + row.writeOffAmount,
      0
    )
  ).toEqual(100);
  expect(result.newOnAccountDocument).toEqual(0);
});

it("discount-only rows need no funding source and never create FX", () => {
  const result = allocate(source("current", 0, 1.5), [
    request("invoice", 0, 1.1, {
      remainingDocument: 11,
      remainingBase: 10,
      discountAmount: 8,
      writeOffAmount: 2
    })
  ]);
  expect(firstApplication(result.applications)).toEqual({
    targetId: "invoice",
    sourcePaymentId: null,
    sourceAmount: 0,
    sourceExchangeRate: 1.5,
    targetExchangeRate: 1.1,
    appliedAmount: 0,
    discountAmount: 8,
    writeOffAmount: 2,
    fxGainLossAmount: 0
  });
});

it("160.01 source units exhaust exactly even when target base rounds to0.01000", () => {
  const result = allocate(source("current", 160.01, 16000), [
    request("invoice", 160.01, 16000)
  ]);
  const row = firstApplication(result.applications);
  expect(row.sourceAmount).toEqual(160.01);
  expect(row.appliedAmount).toEqual(0.01);
  expect(result.newOnAccountDocument).toEqual(0);
  expect(result.sourceRemainders).toEqual([
    { paymentId: "current", remainingDocument: 0, remainingBase: 0 }
  ]);
  // Releasing/voiding this persisted allocation restores the exact source units.
  expect(round(result.newOnAccountDocument + row.sourceAmount, 2)).toEqual(
    160.01
  );
});

it("160.00 partial application leaves a positive0.01 document allocation with zero base", () => {
  const initial = allocate(source("current", 160.01, 16000), [
    request("invoice", 160, 16000, {
      remainingDocument: 160.01,
      remainingBase: 0.01
    })
  ]);
  expect(firstApplication(initial.applications).sourceAmount).toEqual(160);
  expect(initial.newOnAccountDocument).toEqual(0.01);
  expect(initial.sourceRemainders[0]?.remainingBase).toEqual(0);
  const closing = allocate(
    source("applying", 0, 1),
    [request("invoice", 0.01, 16000, { remainingBase: 0 })],
    {
      priorSources: [source("current", 0.01, 16000, { remainingBase: 0 })]
    }
  );
  expect(firstApplication(closing.applications).sourceAmount).toEqual(0.01);
  expect(firstApplication(closing.applications).appliedAmount).toEqual(0);
  expect(
    closing.sourceRemainders.every(
      (row) => row.remainingDocument === 0 && row.remainingBase === 0
    )
  ).toEqual(true);
});

it("three separate partial allocations preserve exact source and target carrying residuals", () => {
  let remainingDocument = 3;
  let remainingBase = 1;
  const applied: number[] = [];
  const released: number[] = [];
  for (const installment of [1, 2, 3]) {
    const result = allocate(
      source(`owner-${installment}`, 0),
      [request("invoice", 1, 3, { remainingDocument, remainingBase })],
      {
        priorSources: [
          source("credit", remainingDocument, 3, { remainingBase })
        ]
      }
    );
    const row = firstApplication(result.applications);
    applied.push(row.appliedAmount);
    released.push(round(row.appliedAmount + row.fxGainLossAmount));
    const credit = result.sourceRemainders.find(
      (remainder) => remainder.paymentId === "credit"
    )!;
    remainingDocument = credit.remainingDocument;
    remainingBase = credit.remainingBase;
  }
  expect(applied).toEqual([0.33333, 0.33333, 0.33334]);
  expect(released).toEqual([0.33333, 0.33333, 0.33334]);
  expect(remainingDocument).toEqual(0);
  expect(remainingBase).toEqual(0);
});

it("source and target final carrying residuals can differ and reconcile through recorded FX", () => {
  for (const isAR of [true, false]) {
    const result = allocate(
      source("current", 0),
      [request("invoice", 1, 3, { remainingBase: 0.33333 })],
      {
        priorSources: [source("credit", 1, 3, { remainingBase: 0.33334 })],
        isAR
      }
    );
    const row = firstApplication(result.applications);
    expect(row.appliedAmount).toEqual(0.33333);
    expect(row.fxGainLossAmount).toEqual(isAR ? 0.00001 : -0.00001);
    expect(result.sourceRemainders[1]?.remainingBase).toEqual(0);
  }
});

it("splitting a target across tiny sources reconciles target carrying once", () => {
  const result = allocate(source("current", 1, 3), [request("invoice", 3, 3)], {
    priorSources: [source("a", 1, 3), source("b", 1, 3)]
  });
  expect(result.applications.map((row) => row.appliedAmount)).toEqual([
    0.33333, 0.33333, 0.33334
  ]);
  expect(result.applications.map((row) => row.fxGainLossAmount)).toEqual([
    0, 0, -0.00001
  ]);
});

it("repeated cent allocations consume160.01 exactly without floating residuals", () => {
  let credit = source("credit", 160.01, 16000);
  const principal = [53.33, 53.33, 53.35];
  const allocated: FundingApplication[] = [];
  for (const [index, amount] of principal.entries()) {
    const result = allocate(
      source(`owner-${index}`, 0),
      [
        request("invoice", amount, 16000, {
          remainingDocument: credit.remainingDocument,
          remainingBase: credit.remainingBase
        })
      ],
      { priorSources: [credit] }
    );
    allocated.push(...result.applications);
    const remainder = result.sourceRemainders.find(
      (row) => row.paymentId === credit.paymentId
    )!;
    credit = { ...credit, ...remainder };
  }
  expect(credit.remainingDocument).toEqual(0);
  expect(credit.remainingBase).toEqual(0);
  expect(
    round(
      allocated.reduce((sum, row) => sum + row.sourceAmount, 0),
      2
    )
  ).toEqual(160.01);
  expect(
    round(allocated.reduce((sum, row) => sum + row.appliedAmount, 0))
  ).toEqual(0.01);
});

it("funding respects configured zero and three document decimals", () => {
  const whole = allocate(
    source("current", 13, 2),
    [request("invoice", 12, 2)],
    { currencyDecimals: 0 }
  );
  expect(whole.newOnAccountDocument).toEqual(1);
  const three = allocate(
    source("current", 1.005),
    [request("invoice", 1.001)],
    { currencyDecimals: 3 }
  );
  expect(three.newOnAccountDocument).toEqual(0.004);
  expect(three.sourceRemainders[0]?.remainingBase).toEqual(0.004);
});

it("no requests leave current cash and prior credits independently available", () => {
  const result = allocate(source("current", 22, 1.1), [], {
    priorSources: [source("old", 110, 1.1)]
  });
  expect(result.applications).toEqual([]);
  expect(result.newOnAccountDocument).toEqual(22);
  expect(result.sourceRemainders).toEqual([
    { paymentId: "current", remainingDocument: 22, remainingBase: 20 },
    { paymentId: "old", remainingDocument: 110, remainingBase: 100 }
  ]);
});

it("empty request rows do not produce empty settlements", () => {
  const result = allocate(source("current", 20), [
    request("invoice", 0, 1, { remainingDocument: 10, remainingBase: 10 })
  ]);
  expect(result.applications).toEqual([]);
  expect(result.newOnAccountDocument).toEqual(20);
});

it("funding rejects target document over-application and excess target relief", () => {
  expect(() =>
    allocate(source("current", 120), [
      request("invoice", 110.01, 1.1, {
        remainingDocument: 110,
        remainingBase: 100
      })
    ])
  ).toThrow("target");
  expect(() =>
    allocate(source("current", 110), [
      request("invoice", 110, 1.1, { discountAmount: 0.01 })
    ])
  ).toThrow("target");
  expect(() =>
    allocate(source("current", 0), [
      request("invoice", 0, 1.1, {
        remainingDocument: 11,
        remainingBase: 10,
        discountAmount: 11
      })
    ])
  ).toThrow("target");
});

it("funding rejects insufficient sources without mutating any source or request", () => {
  const current = source("current", 22);
  const priorSources = [source("old", 77)];
  const requests = [request("invoice", 100)];
  const before = structuredClone({ current, priorSources, requests });
  expect(() => allocate(current, requests, { priorSources })).toThrow(
    "funding"
  );
  expect({ current, priorSources, requests }).toEqual(before);
});

it("duplicate source IDs, source self-reference, and duplicate target IDs are rejected", () => {
  expect(() =>
    allocate(source("current", 0), [], {
      priorSources: [source("a", 1), source("a", 1)]
    })
  ).toThrow("Duplicate");
  expect(() =>
    allocate(source("current", 0), [], { priorSources: [source("current", 1)] })
  ).toThrow("Duplicate");
  expect(() =>
    allocate(source("current", 2), [request("a", 1), request("a", 1)])
  ).toThrow("Duplicate");
});

it("funding refuses invalid rates, amounts, document precision, and unsafe integer units", () => {
  for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() =>
      allocate({ ...source("current", 1), exchangeRate: invalid }, [])
    ).toThrow("rate");
    expect(() =>
      allocate(source("current", 1), [
        { ...request("a", 1), targetExchangeRate: invalid }
      ])
    ).toThrow("rate");
  }
  for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() =>
      allocate({ ...source("current", 1), remainingDocument: invalid }, [])
    ).toThrow();
    expect(() =>
      allocate({ ...source("current", 1), remainingBase: invalid }, [])
    ).toThrow();
    for (const key of [
      "requestedDocumentPrincipal",
      "discountAmount",
      "writeOffAmount",
      "remainingBase",
      "remainingDocument"
    ] as const) {
      expect(() =>
        allocate(source("current", 1), [{ ...request("a", 1), [key]: invalid }])
      ).toThrow();
    }
  }
  expect(() => allocate(source("current", 1.001), [])).toThrow("precision");
  expect(() => allocate(source("current", 1), [request("a", 0.001)])).toThrow(
    "precision"
  );
  expect(() =>
    allocate(source("current", Number.MAX_SAFE_INTEGER), [])
  ).toThrow("safe");
  expect(() =>
    allocate({ ...source("current", 1), remainingBase: Number.MAX_VALUE }, [])
  ).toThrow();
  expect(() =>
    allocate(source("current", 1), [], { currencyDecimals: -1 })
  ).toThrow("decimal");
});

it("inconsistent exhausted source snapshot cannot retain unreleased carrying base", () => {
  expect(() =>
    allocate(source("current", 0, 3, { remainingBase: 0.00001 }), [])
  ).toThrow("carrying");
  expect(() =>
    allocate(source("current", 0), [], {
      priorSources: [source("credit", 0, 3, { remainingBase: 0.00001 })]
    })
  ).toThrow("carrying");
});

it("inconsistent discount-only closure cannot leave target carrying base behind", () => {
  expect(() =>
    allocate(source("current", 0), [
      request("invoice", 0, 3, {
        remainingDocument: 1,
        remainingBase: 0.33334,
        discountAmount: 0.33333
      })
    ])
  ).toThrow("carrying");
  const complete = allocate(source("current", 0), [
    request("invoice", 0, 3, {
      remainingDocument: 1,
      remainingBase: 0.33334,
      discountAmount: 0.33334
    })
  ]);
  expect(firstApplication(complete.applications).discountAmount).toEqual(
    0.33334
  );
});

it("settlement effectiveness requires the owning posted parent", () => {
  const row = {
    paymentId: null,
    memoId: null,
    appliedViaPaymentId: null,
    paymentStatus: null,
    memoStatus: null,
    viaStatus: null
  };
  expect(isEffectiveSettlement({ ...row, paymentStatus: "Posted" })).toEqual(
    false
  );
  expect(isEffectiveSettlement({ ...row, memoStatus: "Posted" })).toEqual(
    false
  );
  for (const status of ["Draft", "Posted", "Voided"]) {
    expect(
      isEffectiveSettlement({
        ...row,
        paymentId: "payment",
        paymentStatus: status
      })
    ).toEqual(status === "Posted");
    expect(
      isEffectiveSettlement({
        ...row,
        memoId: "memo",
        memoStatus: "Posted",
        appliedViaPaymentId: "payment",
        viaStatus: status
      })
    ).toEqual(status === "Posted");
  }
  expect(
    isEffectiveSettlement({ ...row, memoId: "memo", memoStatus: "Posted" })
  ).toEqual(true);
  expect(
    isEffectiveSettlement({
      ...row,
      paymentId: "payment",
      paymentStatus: "Draft",
      memoId: "memo",
      memoStatus: "Posted"
    })
  ).toEqual(false);
});
it("invoice reducers preserve signed controls and aggregate before rounding", () => {
  for (const isAR of [true, false]) {
    const invoice = { id: "invoice", totalAmount: 90, exchangeRate: 1 };
    const controls = new Map([["invoice", 100 - 10]]);
    const row = {
      targetSalesInvoiceId: "invoice",
      targetPurchaseInvoiceId: "invoice",
      sourceAmount: 90,
      appliedAmount: 90,
      discountAmount: 0,
      writeOffAmount: 0
    };
    expect(invoiceRemainingAmounts(invoice, [row], controls, 2, isAR)).toEqual({
      remainingDocument: 0,
      remainingBase: 0
    });
    expect(() =>
      invoiceRemainingAmounts(
        invoice,
        [{ ...row, sourceAmount: 91 }],
        controls,
        2,
        isAR
      )
    ).toThrow("excessive settlements");
  }
  expect(
    reduceInvoiceSettlements(
      Array.from({ length: 1001 }, () => ({
        sourceAmount: 0,
        appliedAmount: 0.000004,
        discountAmount: 0,
        writeOffAmount: 0
      })),
      1,
      2
    )
  ).toEqual({ document: 0, base: 0.004 });
  expect(
    reduceInvoiceSettlements(
      [
        {
          sourceAmount: 0.1,
          appliedAmount: 0.09091,
          discountAmount: 0.004,
          writeOffAmount: 0.004
        },
        {
          sourceAmount: 0.2,
          appliedAmount: 0.18182,
          discountAmount: 0.004,
          writeOffAmount: 0.004
        }
      ],
      1.1,
      2
    )
  ).toEqual({ document: 0.32, base: 0.28873 });
});
it("source reduction preserves principal, final carry and AP FX direction", () => {
  const payment = {
    id: "source",
    totalAmount: 160.01,
    exchangeRate: 16000,
    postingDate: null,
    paymentDate: "2026-09-07",
    currencyCode: "EUR"
  };
  const use = {
    paymentId: "current",
    sourcePaymentId: "source",
    sourceAmount: 160,
    appliedAmount: 0.01,
    fxGainLossAmount: 0
  };
  const decimals = new Map([["EUR", 2]]);
  expect(remainingFundingSources([payment], [use], decimals, true)[0]).toEqual({
    paymentId: "source",
    postingDate: "2026-09-07",
    exchangeRate: 16000,
    remainingDocument: 0.01,
    remainingBase: 0
  });
  expect(
    remainingFundingSources(
      [payment],
      [use, { ...use, sourceAmount: 0.01, appliedAmount: 0 }],
      decimals,
      true
    )
  ).toEqual([]);
  expect(
    remainingFundingSources(
      [{ ...payment, totalAmount: 1, exchangeRate: 3 }],
      [{ ...use, sourceAmount: 0.5, appliedAmount: 0.16667 }],
      decimals,
      true
    )[0]?.remainingBase
  ).toEqual(0.16666);
  expect(
    remainingFundingSources(
      [{ ...payment, totalAmount: 110, exchangeRate: 1.1 }],
      [{ ...use, sourceAmount: 55, appliedAmount: 60, fxGainLossAmount: 10 }],
      decimals,
      false
    )[0]?.remainingBase
  ).toEqual(50);
  expect(
    remainingFundingSources(
      [{ ...payment, totalAmount: 3, exchangeRate: 3 }],
      [
        { ...use, sourceAmount: 1, appliedAmount: 0.33333 },
        { ...use, sourceAmount: 1, appliedAmount: 0.33333 }
      ],
      decimals,
      true
    )[0]?.remainingBase
  ).toEqual(0.33334);
  for (const principal of [null, -1, Number.NaN]) {
    expect(() =>
      remainingFundingSources(
        [payment],
        [{ ...use, sourceAmount: principal }],
        decimals,
        true
      )
    ).toThrow("principal");
  }
  expect(() =>
    remainingFundingSources(
      [payment],
      [{ ...use, sourceAmount: 161 }],
      decimals,
      true
    )
  ).toThrow("Invalid remaining");
});
it("legacy settlements without a document principal derive it from applied base", () => {
  const legacy = {
    sourceAmount: null,
    appliedAmount: 110,
    discountAmount: 0,
    writeOffAmount: 0
  };
  expect(reduceInvoiceSettlements([legacy], 1.1, 2)).toEqual({
    document: 121,
    base: 110
  });
  expect(
    reduceInvoiceSettlements([legacy, { ...legacy, sourceAmount: 121 }], 1.1, 2)
  ).toEqual({ document: 242, base: 220 });
  for (const isAR of [true, false]) {
    const invoice = { id: "invoice", totalAmount: 200, exchangeRate: 1.1 };
    const row = {
      ...legacy,
      targetSalesInvoiceId: "invoice",
      targetPurchaseInvoiceId: "invoice"
    };
    expect(
      invoiceRemainingAmounts(
        invoice,
        [row],
        new Map([["invoice", 200]]),
        2,
        isAR
      )
    ).toEqual({ remainingDocument: 99, remainingBase: 90 });
  }
  const payment = {
    id: "p",
    totalAmount: 220,
    exchangeRate: 1.1,
    postingDate: "2026-01-01",
    paymentDate: "2026-01-01",
    currencyCode: "EUR"
  };
  const decimals = new Map([["EUR", 2]]);
  const direct = {
    paymentId: "p",
    sourcePaymentId: null,
    sourceAmount: null,
    appliedAmount: 110,
    fxGainLossAmount: null
  };
  expect(remainingFundingSources([payment], [direct], decimals, true)).toEqual([
    {
      paymentId: "p",
      postingDate: "2026-01-01",
      exchangeRate: 1.1,
      remainingDocument: 99,
      remainingBase: 90
    }
  ]);
  expect(() =>
    remainingFundingSources(
      [payment],
      [{ ...direct, paymentId: "q", sourcePaymentId: "p" }],
      decimals,
      true
    )
  ).toThrow("missing its document principal");
  const tiny = { ...direct, appliedAmount: 0.004 };
  expect(
    reduceInvoiceSettlements(
      [tiny, tiny].map((row) => ({
        ...row,
        discountAmount: 0,
        writeOffAmount: 0
      })),
      1.1,
      2
    ).document
  ).toEqual(0);
  expect(
    remainingFundingSources([payment], [tiny, tiny], decimals, true)[0]!
      .remainingDocument
  ).toEqual(220);
});
