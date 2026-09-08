import {
  assertEquals,
  assertThrows
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { toBaseAmount } from "./accounting-currency.ts";
import {
  allocatePaymentFunding,
  type FundingApplication,
  type FundingRequest,
  type FundingSource
} from "./payment-funding.ts";
import { round } from "./precision.ts";

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
) => allocatePaymentFunding({
  currentPayment,
  priorSources: [],
  requests,
  currencyDecimals: 2,
  isAR: true,
  ...overrides
});

function firstApplication(applications: FundingApplication[]) {
  assertEquals(applications.length > 0, true, "Expected an actual funding row");
  return applications[0]!;
}

Deno.test("110 paid at matching1.10 snapshots relieves base100 without FX", () => {
  const result = allocate(source("current", 110, 1.1), [request("invoice", 110, 1.1)]);
  assertEquals(result, {
    applications: [{
      targetId: "invoice", sourcePaymentId: null, sourceAmount: 110,
      sourceExchangeRate: 1.1, targetExchangeRate: 1.1, appliedAmount: 100,
      discountAmount: 0, writeOffAmount: 0, fxGainLossAmount: 0
    }],
    newOnAccountDocument: 0,
    sourceRemainders: [{ paymentId: "current", remainingDocument: 0, remainingBase: 0 }]
  });
});

for (const [paymentRate, arFx] of [[1, 10], [1.25, -12]] as const) {
  for (const isAR of [true, false]) {
    Deno.test(`110 application with source rate${paymentRate}, ${isAR ? "AR" : "AP"} records correct signed FX`, () => {
      const result = allocate(source("current", 110, paymentRate), [request("invoice", 110, 1.1)], { isAR });
      const row = firstApplication(result.applications);
      assertEquals(row.appliedAmount, 100);
      assertEquals(row.sourceAmount, 110);
      assertEquals(row.fxGainLossAmount, isAR ? arFx : -arFx);
      assertEquals(result.newOnAccountDocument, 0);
    });
  }
}

Deno.test("discount and write-off remain target base and do not consume cash", () => {
  const result = allocate(source("current", 88), [request("invoice", 88, 1.1, {
    remainingDocument: 110, remainingBase: 100, discountAmount: 10
  })]);
  const row = firstApplication(result.applications);
  assertEquals(row.appliedAmount, 80);
  assertEquals(row.discountAmount, 10);
  assertEquals(row.sourceAmount, 88);
  assertEquals(row.fxGainLossAmount, 8);
  assertEquals(100 - row.appliedAmount - row.discountAmount, 10);
  const writtenOff = allocate(source("current", 88), [request("invoice", 88, 1.1, {
    remainingDocument: 110, remainingBase: 100, writeOffAmount: 10
  })], { isAR: false });
  assertEquals(firstApplication(writtenOff.applications).writeOffAmount, 10);
  assertEquals(firstApplication(writtenOff.applications).fxGainLossAmount, -8);
});

Deno.test("payment132 applies110 and retains22 document /20 base from current cash", () => {
  const result = allocate(source("current", 132, 1.1), [request("invoice", 110, 1.1)]);
  assertEquals(result.newOnAccountDocument, 22);
  assertEquals(result.sourceRemainders, [{ paymentId: "current", remainingDocument: 22, remainingBase: 20 }]);
});

Deno.test("two invoices at1.10 and1.20 funded by230 at1.15 reconcile to zero net FX", () => {
  const result = allocate(source("current", 230, 1.15), [request("a", 110, 1.1), request("b", 120, 1.2)]);
  assertEquals(result.applications.map((row) => row.appliedAmount), [100, 100]);
  assertEquals(result.applications.map((row) => row.fxGainLossAmount), [-4.34783, 4.34783]);
  assertEquals(round(result.applications.reduce((sum, row) => sum + row.fxGainLossAmount, 0)), 0);
  assertEquals(result.sourceRemainders, [{ paymentId: "current", remainingDocument: 0, remainingBase: 0 }]);
});

Deno.test("a prior110 credit releases its original base100 against an invoice carrying88", () => {
  const priorSources = [source("credit", 110, 1.1, { postingDate: "2026-09-06" })];
  const requests = [request("invoice", 110, 1.25)];
  const first = allocate(source("current", 0, 99), requests, { priorSources });
  const second = allocate(source("current", 0, 0.5), requests, { priorSources });
  assertEquals(first, second, "Changing the applying payment rate cannot revalue prior credit");
  assertEquals(firstApplication(first.applications), {
    targetId: "invoice", sourcePaymentId: "credit", sourceAmount: 110,
    sourceExchangeRate: 1.1, targetExchangeRate: 1.25, appliedAmount: 88,
    discountAmount: 0, writeOffAmount: 0, fxGainLossAmount: 12
  });
});

Deno.test("current cash first, then prior dates and IDs, without mutating input order", () => {
  const priorSources = [
    source("later", 100, 2, { postingDate: "2026-09-05" }),
    source("b", 33, 1.1, { postingDate: "2026-09-04" }),
    source("a", 44, 1.1, { postingDate: "2026-09-04" })
  ];
  const before = structuredClone(priorSources);
  const input = source("current", 22, 1.1);
  const requests = [request("invoice", 110, 1.1)];
  const result = allocate(input, requests, { priorSources });
  assertEquals(result, allocate(input, requests, { priorSources: [...priorSources].reverse() }));
  assertEquals(priorSources, before);
  assertEquals(result.applications.map((row) => [row.sourcePaymentId, row.sourceAmount, row.appliedAmount]), [
    [null, 22, 20], ["a", 44, 40], ["b", 33, 30], ["later", 11, 10]
  ]);
  assertEquals(result.sourceRemainders, [
    { paymentId: "current", remainingDocument: 0, remainingBase: 0 },
    { paymentId: "a", remainingDocument: 0, remainingBase: 0 },
    { paymentId: "b", remainingDocument: 0, remainingBase: 0 },
    { paymentId: "later", remainingDocument: 89, remainingBase: 44.5 }
  ]);
});

Deno.test("mixed cash and two prior rates assign discount/write-off exactly once", () => {
  const result = allocate(source("current", 22, 1.1), [request("invoice", 88, 1.1, {
    remainingDocument: 110, remainingBase: 100, discountAmount: 10, writeOffAmount: 10
  })], {
    priorSources: [source("older", 33, 1), source("newer", 33, 1.5, { postingDate: "2026-09-08" })]
  });
  assertEquals(result.applications.map((row) => [row.sourceAmount, row.appliedAmount, row.discountAmount, row.writeOffAmount, row.fxGainLossAmount]), [
    [22, 20, 10, 10, 0], [33, 30, 0, 0, 3], [33, 30, 0, 0, -8]
  ]);
  assertEquals(result.applications.reduce((sum, row) => sum + row.appliedAmount + row.discountAmount + row.writeOffAmount, 0), 100);
  assertEquals(result.newOnAccountDocument, 0);
});

Deno.test("discount-only rows need no funding source and never create FX", () => {
  const result = allocate(source("current", 0, 1.5), [request("invoice", 0, 1.1, {
    remainingDocument: 11, remainingBase: 10, discountAmount: 8, writeOffAmount: 2
  })]);
  assertEquals(firstApplication(result.applications), {
    targetId: "invoice", sourcePaymentId: null, sourceAmount: 0,
    sourceExchangeRate: 1.5, targetExchangeRate: 1.1, appliedAmount: 0,
    discountAmount: 8, writeOffAmount: 2, fxGainLossAmount: 0
  });
});

Deno.test("160.01 source units exhaust exactly even when target base rounds to0.01000", () => {
  const result = allocate(source("current", 160.01, 16000), [request("invoice", 160.01, 16000)]);
  const row = firstApplication(result.applications);
  assertEquals(row.sourceAmount, 160.01);
  assertEquals(row.appliedAmount, 0.01);
  assertEquals(result.newOnAccountDocument, 0);
  assertEquals(result.sourceRemainders, [{ paymentId: "current", remainingDocument: 0, remainingBase: 0 }]);
  // Releasing/voiding this persisted allocation restores the exact source units.
  assertEquals(round(result.newOnAccountDocument + row.sourceAmount, 2), 160.01);
});

Deno.test("160.00 partial application leaves a positive0.01 document allocation with zero base", () => {
  const initial = allocate(source("current", 160.01, 16000), [request("invoice", 160, 16000, {
    remainingDocument: 160.01, remainingBase: 0.01
  })]);
  assertEquals(firstApplication(initial.applications).sourceAmount, 160);
  assertEquals(initial.newOnAccountDocument, 0.01);
  assertEquals(initial.sourceRemainders[0]?.remainingBase, 0);
  const closing = allocate(source("applying", 0, 1), [request("invoice", 0.01, 16000, { remainingBase: 0 })], {
    priorSources: [source("current", 0.01, 16000, { remainingBase: 0 })]
  });
  assertEquals(firstApplication(closing.applications).sourceAmount, 0.01);
  assertEquals(firstApplication(closing.applications).appliedAmount, 0);
  assertEquals(closing.sourceRemainders.every((row) => row.remainingDocument === 0 && row.remainingBase === 0), true);
});

Deno.test("three separate partial allocations preserve exact source and target carrying residuals", () => {
  let remainingDocument = 3;
  let remainingBase = 1;
  const applied: number[] = [];
  const released: number[] = [];
  for (const installment of [1, 2, 3]) {
    const result = allocate(source(`owner-${installment}`, 0), [request("invoice", 1, 3, { remainingDocument, remainingBase })], {
      priorSources: [source("credit", remainingDocument, 3, { remainingBase })]
    });
    const row = firstApplication(result.applications);
    applied.push(row.appliedAmount);
    released.push(round(row.appliedAmount + row.fxGainLossAmount));
    const credit = result.sourceRemainders.find((remainder) => remainder.paymentId === "credit")!;
    remainingDocument = credit.remainingDocument;
    remainingBase = credit.remainingBase;
  }
  assertEquals(applied, [0.33333, 0.33333, 0.33334]);
  assertEquals(released, [0.33333, 0.33333, 0.33334]);
  assertEquals(remainingDocument, 0);
  assertEquals(remainingBase, 0);
});

Deno.test("source and target final carrying residuals can differ and reconcile through recorded FX", () => {
  for (const isAR of [true, false]) {
    const result = allocate(source("current", 0), [request("invoice", 1, 3, { remainingBase: 0.33333 })], {
      priorSources: [source("credit", 1, 3, { remainingBase: 0.33334 })], isAR
    });
    const row = firstApplication(result.applications);
    assertEquals(row.appliedAmount, 0.33333);
    assertEquals(row.fxGainLossAmount, isAR ? 0.00001 : -0.00001);
    assertEquals(result.sourceRemainders[1]?.remainingBase, 0);
  }
});

Deno.test("splitting a target across tiny sources reconciles target carrying once", () => {
  const result = allocate(source("current", 1, 3), [request("invoice", 3, 3)], {
    priorSources: [source("a", 1, 3), source("b", 1, 3)]
  });
  assertEquals(result.applications.map((row) => row.appliedAmount), [0.33333, 0.33333, 0.33334]);
  assertEquals(result.applications.map((row) => row.fxGainLossAmount), [0, 0, -0.00001]);
});

Deno.test("repeated cent allocations consume160.01 exactly without floating residuals", () => {
  let credit = source("credit", 160.01, 16000);
  const principal = [53.33, 53.33, 53.35];
  const allocated: FundingApplication[] = [];
  for (const [index, amount] of principal.entries()) {
    const result = allocate(source(`owner-${index}`, 0), [request("invoice", amount, 16000, {
      remainingDocument: credit.remainingDocument, remainingBase: credit.remainingBase
    })], { priorSources: [credit] });
    allocated.push(...result.applications);
    const remainder = result.sourceRemainders.find((row) => row.paymentId === credit.paymentId)!;
    credit = { ...credit, ...remainder };
  }
  assertEquals(credit.remainingDocument, 0);
  assertEquals(credit.remainingBase, 0);
  assertEquals(round(allocated.reduce((sum, row) => sum + row.sourceAmount, 0), 2), 160.01);
  assertEquals(round(allocated.reduce((sum, row) => sum + row.appliedAmount, 0)), 0.01);
});

Deno.test("funding respects configured zero and three document decimals", () => {
  const whole = allocate(source("current", 13, 2), [request("invoice", 12, 2)], { currencyDecimals: 0 });
  assertEquals(whole.newOnAccountDocument, 1);
  const three = allocate(source("current", 1.005), [request("invoice", 1.001)], { currencyDecimals: 3 });
  assertEquals(three.newOnAccountDocument, 0.004);
  assertEquals(three.sourceRemainders[0]?.remainingBase, 0.004);
});

Deno.test("no requests leave current cash and prior credits independently available", () => {
  const result = allocate(source("current", 22, 1.1), [], { priorSources: [source("old", 110, 1.1)] });
  assertEquals(result.applications, []);
  assertEquals(result.newOnAccountDocument, 22);
  assertEquals(result.sourceRemainders, [
    { paymentId: "current", remainingDocument: 22, remainingBase: 20 },
    { paymentId: "old", remainingDocument: 110, remainingBase: 100 }
  ]);
});

Deno.test("empty request rows do not produce empty settlements", () => {
  const result = allocate(source("current", 20), [request("invoice", 0, 1, { remainingDocument: 10, remainingBase: 10 })]);
  assertEquals(result.applications, []);
  assertEquals(result.newOnAccountDocument, 20);
});

Deno.test("funding rejects target document over-application and excess target relief", () => {
  assertThrows(() => allocate(source("current", 120), [request("invoice", 110.01, 1.1, { remainingDocument: 110, remainingBase: 100 })]), Error, "target");
  assertThrows(() => allocate(source("current", 110), [request("invoice", 110, 1.1, { discountAmount: 0.01 })]), Error, "target");
  assertThrows(() => allocate(source("current", 0), [request("invoice", 0, 1.1, { remainingDocument: 11, remainingBase: 10, discountAmount: 11 })]), Error, "target");
});

Deno.test("funding rejects insufficient sources without mutating any source or request", () => {
  const current = source("current", 22);
  const priorSources = [source("old", 77)];
  const requests = [request("invoice", 100)];
  const before = structuredClone({ current, priorSources, requests });
  assertThrows(() => allocate(current, requests, { priorSources }), Error, "funding");
  assertEquals({ current, priorSources, requests }, before);
});

Deno.test("duplicate source IDs, source self-reference, and duplicate target IDs are rejected", () => {
  assertThrows(() => allocate(source("current", 0), [], { priorSources: [source("a", 1), source("a", 1)] }), Error, "Duplicate");
  assertThrows(() => allocate(source("current", 0), [], { priorSources: [source("current", 1)] }), Error, "Duplicate");
  assertThrows(() => allocate(source("current", 2), [request("a", 1), request("a", 1)]), Error, "Duplicate");
});

Deno.test("funding refuses invalid rates, amounts, document precision, and unsafe integer units", () => {
  for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assertThrows(() => allocate({ ...source("current", 1), exchangeRate: invalid }, []), Error, "rate");
    assertThrows(() => allocate(source("current", 1), [{ ...request("a", 1), targetExchangeRate: invalid }]), Error, "rate");
  }
  for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assertThrows(() => allocate({ ...source("current", 1), remainingDocument: invalid }, []));
    assertThrows(() => allocate({ ...source("current", 1), remainingBase: invalid }, []));
    for (const key of ["requestedDocumentPrincipal", "discountAmount", "writeOffAmount", "remainingBase", "remainingDocument"] as const) {
      assertThrows(() => allocate(source("current", 1), [{ ...request("a", 1), [key]: invalid }]));
    }
  }
  assertThrows(() => allocate(source("current", 1.001), []), Error, "precision");
  assertThrows(() => allocate(source("current", 1), [request("a", 0.001)]), Error, "precision");
  assertThrows(() => allocate(source("current", Number.MAX_SAFE_INTEGER), []), Error, "safe");
  assertThrows(() => allocate({ ...source("current", 1), remainingBase: Number.MAX_VALUE }, []));
  assertThrows(() => allocate(source("current", 1), [], { currencyDecimals: -1 }), Error, "decimal");
});

Deno.test("inconsistent exhausted source snapshot cannot retain unreleased carrying base", () => {
  assertThrows(() => allocate(source("current", 0, 3, { remainingBase: 0.00001 }), []), Error, "carrying");
  assertThrows(() => allocate(source("current", 0), [], {
    priorSources: [source("credit", 0, 3, { remainingBase: 0.00001 })]
  }), Error, "carrying");
});

Deno.test("inconsistent discount-only closure cannot leave target carrying base behind", () => {
  assertThrows(() => allocate(source("current", 0), [request("invoice", 0, 3, {
    remainingDocument: 1, remainingBase: 0.33334, discountAmount: 0.33333
  })]), Error, "carrying");
  const complete = allocate(source("current", 0), [request("invoice", 0, 3, {
    remainingDocument: 1, remainingBase: 0.33334, discountAmount: 0.33334
  })]);
  assertEquals(firstApplication(complete.applications).discountAmount, 0.33334);
});
