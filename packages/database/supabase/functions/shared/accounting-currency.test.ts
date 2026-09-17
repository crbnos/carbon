import {
  assertEquals,
  assertThrows
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import {
  calculateSettlementFx,
  toBaseAmount,
  toDocumentAmount
} from "./accounting-currency.ts";

Deno.test("foreign-per-base conversion divides documents and multiplies base at any rate magnitude", () => {
  assertEquals(toBaseAmount(110, 1.1), 100);
  assertEquals(toBaseAmount(120.8, 0.8), 151);
  assertEquals(toDocumentAmount(100, 1.1, 2), 110);
  assertEquals(toDocumentAmount(151, 0.8, 2), 120.8);
});

Deno.test("base conversion preserves internal precision and rounds signed ties away from zero", () => {
  assertEquals(toBaseAmount(1, 3), 0.33333);
  assertEquals(toBaseAmount(0.000005, 1), 0.00001);
  assertEquals(toBaseAmount(-0.000005, 1), -0.00001);
  assertEquals(toBaseAmount(-110, 1.1), -100);
});

Deno.test("document boundaries respect configured zero, two, three, and four decimals", () => {
  assertEquals(toDocumentAmount(1.005, 1, 2), 1.01);
  assertEquals(toDocumentAmount(-1.005, 1, 2), -1.01);
  assertEquals(toDocumentAmount(12.5, 1, 0), 13);
  assertEquals(toDocumentAmount(12.3455, 1, 3), 12.346);
  assertEquals(toDocumentAmount(12.34555, 1, 4), 12.3456);
});

Deno.test("160.01 at rate16000 cannot be recovered from rounded carrying base", () => {
  const carryingBase = toBaseAmount(160.01, 16000);
  assertEquals(carryingBase, 0.01);
  assertEquals(toDocumentAmount(carryingBase, 16000, 2), 160);
  assertEquals(toBaseAmount(0.01, 16000), 0);
});

Deno.test("memo and fee conversion keeps 55 credit and 3.30 fee at base50 and base3", () => {
  assertEquals(toBaseAmount(55, 1.1), 50);
  assertEquals(toBaseAmount(3.3, 1.1), 3);
  assertEquals(toBaseAmount(110, 1.1) - toBaseAmount(3.3, 1.1), 97);
});

for (const rate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
  Deno.test(`currency conversion rejects invalid rate ${rate}`, () => {
    assertThrows(() => toBaseAmount(100, rate), Error, "rate");
    assertThrows(() => toDocumentAmount(100, rate, 2), Error, "rate");
    assertThrows(() => calculateSettlementFx({ appliedAmount: 100, sourceAmount: 110, sourceExchangeRate: rate, isAR: true }), Error, "rate");
  });
}

Deno.test("currency conversion refuses nonfinite amounts, unsupported precision, and overflow", () => {
  for (const amount of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assertThrows(() => toBaseAmount(amount, 1));
    assertThrows(() => toDocumentAmount(amount, 1, 2));
  }
  for (const decimals of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assertThrows(() => toDocumentAmount(1, 1, decimals), Error, "decimal");
  }
  assertThrows(() => toBaseAmount(Number.MAX_VALUE, Number.MIN_VALUE));
  assertThrows(() => toDocumentAmount(Number.MAX_VALUE, Number.MAX_VALUE, 2));
});

Deno.test("realized FX compares target carrying principal with source cash and reverses AR/AP signs", () => {
  const cases = [
    { sourceExchangeRate: 1.1, gain: 0 },
    { sourceExchangeRate: 1, gain: 10 },
    { sourceExchangeRate: 1.25, gain: -12 }
  ];
  for (const { sourceExchangeRate, gain } of cases) {
    const input = { appliedAmount: 100, sourceAmount: 110, sourceExchangeRate };
    assertEquals(calculateSettlementFx({ ...input, isAR: true }), gain);
    assertEquals(calculateSettlementFx({ ...input, isAR: false }), gain === 0 ? 0 : -gain);
  }
  assertEquals(calculateSettlementFx({ appliedAmount: 80, sourceAmount: 88, sourceExchangeRate: 1, isAR: true }), 8);
  assertEquals(calculateSettlementFx({ appliedAmount: 88, sourceAmount: 110, sourceExchangeRate: 1.1, isAR: true }), 12);
});

Deno.test("realized FX rounds once at internal precision, preserving tiny source-only applications", () => {
  assertEquals(calculateSettlementFx({ appliedAmount: 100, sourceAmount: 110, sourceExchangeRate: 1.15, isAR: true }), -4.34783);
  assertEquals(calculateSettlementFx({ appliedAmount: 100, sourceAmount: 120, sourceExchangeRate: 1.15, isAR: true }), 4.34783);
  assertEquals(calculateSettlementFx({ appliedAmount: 0, sourceAmount: 0.01, sourceExchangeRate: 16000, isAR: true }), 0);
});

Deno.test("realized FX rejects negative and nonfinite principal inputs", () => {
  for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assertThrows(() => calculateSettlementFx({ appliedAmount: invalid, sourceAmount: 1, sourceExchangeRate: 1, isAR: true }));
    assertThrows(() => calculateSettlementFx({ appliedAmount: 1, sourceAmount: invalid, sourceExchangeRate: 1, isAR: true }));
    assertThrows(() => calculateSettlementFx({ appliedAmount: 1, sourceAmount: 1, sourceExchangeRate: 1, sourceBaseAmount: invalid, isAR: true }));
  }
});

Deno.test("recorded source carrying residual governs FX on its final allocation", () => {
  const input = { appliedAmount: 0.33333, sourceAmount: 1, sourceExchangeRate: 3, sourceBaseAmount: 0.33334 };
  assertEquals(calculateSettlementFx({ ...input, isAR: true }), 0.00001);
  assertEquals(calculateSettlementFx({ ...input, isAR: false }), -0.00001);
});
