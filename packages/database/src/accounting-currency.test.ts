// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import {
  calculateSettlementFx,
  toBaseAmount,
  toDocumentAmount
} from "./accounting-currency.ts";

it("foreign-per-base conversion divides documents and multiplies base at any rate magnitude", () => {
  expect(toBaseAmount(110, 1.1)).toEqual(100);
  expect(toBaseAmount(120.8, 0.8)).toEqual(151);
  expect(toDocumentAmount(100, 1.1, 2)).toEqual(110);
  expect(toDocumentAmount(151, 0.8, 2)).toEqual(120.8);
});

it("base conversion preserves internal precision and rounds signed ties away from zero", () => {
  expect(toBaseAmount(1, 3)).toEqual(0.33333);
  expect(toBaseAmount(0.000005, 1)).toEqual(0.00001);
  expect(toBaseAmount(-0.000005, 1)).toEqual(-0.00001);
  expect(toBaseAmount(-110, 1.1)).toEqual(-100);
});

it("document boundaries respect configured zero, two, three, and four decimals", () => {
  expect(toDocumentAmount(1.005, 1, 2)).toEqual(1.01);
  expect(toDocumentAmount(-1.005, 1, 2)).toEqual(-1.01);
  expect(toDocumentAmount(12.5, 1, 0)).toEqual(13);
  expect(toDocumentAmount(12.3455, 1, 3)).toEqual(12.346);
  expect(toDocumentAmount(12.34555, 1, 4)).toEqual(12.3456);
});

it("160.01 at rate16000 cannot be recovered from rounded carrying base", () => {
  const carryingBase = toBaseAmount(160.01, 16000);
  expect(carryingBase).toEqual(0.01);
  expect(toDocumentAmount(carryingBase, 16000, 2)).toEqual(160);
  expect(toBaseAmount(0.01, 16000)).toEqual(0);
});

it("memo and fee conversion keeps 55 credit and 3.30 fee at base50 and base3", () => {
  expect(toBaseAmount(55, 1.1)).toEqual(50);
  expect(toBaseAmount(3.3, 1.1)).toEqual(3);
  expect(toBaseAmount(110, 1.1) - toBaseAmount(3.3, 1.1)).toEqual(97);
});

for (const rate of [
  0,
  -1,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY
]) {
  it(`currency conversion rejects invalid rate ${rate}`, () => {
    expect(() => toBaseAmount(100, rate)).toThrow("rate");
    expect(() => toDocumentAmount(100, rate, 2)).toThrow("rate");
    expect(() =>
      calculateSettlementFx({
        appliedAmount: 100,
        sourceAmount: 110,
        sourceExchangeRate: rate,
        isAR: true
      })
    ).toThrow("rate");
  });
}

it("currency conversion refuses nonfinite amounts, unsupported precision, and overflow", () => {
  for (const amount of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY
  ]) {
    expect(() => toBaseAmount(amount, 1)).toThrow();
    expect(() => toDocumentAmount(amount, 1, 2)).toThrow();
  }
  for (const decimals of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => toDocumentAmount(1, 1, decimals)).toThrow("decimal");
  }
  expect(() => toBaseAmount(Number.MAX_VALUE, Number.MIN_VALUE)).toThrow();
  expect(() =>
    toDocumentAmount(Number.MAX_VALUE, Number.MAX_VALUE, 2)
  ).toThrow();
});

it("realized FX compares target carrying principal with source cash and reverses AR/AP signs", () => {
  const cases = [
    { sourceExchangeRate: 1.1, gain: 0 },
    { sourceExchangeRate: 1, gain: 10 },
    { sourceExchangeRate: 1.25, gain: -12 }
  ];
  for (const { sourceExchangeRate, gain } of cases) {
    const input = { appliedAmount: 100, sourceAmount: 110, sourceExchangeRate };
    expect(calculateSettlementFx({ ...input, isAR: true })).toEqual(gain);
    expect(calculateSettlementFx({ ...input, isAR: false })).toEqual(
      gain === 0 ? 0 : -gain
    );
  }
  expect(
    calculateSettlementFx({
      appliedAmount: 80,
      sourceAmount: 88,
      sourceExchangeRate: 1,
      isAR: true
    })
  ).toEqual(8);
  expect(
    calculateSettlementFx({
      appliedAmount: 88,
      sourceAmount: 110,
      sourceExchangeRate: 1.1,
      isAR: true
    })
  ).toEqual(12);
});

it("realized FX rounds once at internal precision, preserving tiny source-only applications", () => {
  expect(
    calculateSettlementFx({
      appliedAmount: 100,
      sourceAmount: 110,
      sourceExchangeRate: 1.15,
      isAR: true
    })
  ).toEqual(-4.34783);
  expect(
    calculateSettlementFx({
      appliedAmount: 100,
      sourceAmount: 120,
      sourceExchangeRate: 1.15,
      isAR: true
    })
  ).toEqual(4.34783);
  expect(
    calculateSettlementFx({
      appliedAmount: 0,
      sourceAmount: 0.01,
      sourceExchangeRate: 16000,
      isAR: true
    })
  ).toEqual(0);
});

it("realized FX rejects negative and nonfinite principal inputs", () => {
  for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() =>
      calculateSettlementFx({
        appliedAmount: invalid,
        sourceAmount: 1,
        sourceExchangeRate: 1,
        isAR: true
      })
    ).toThrow();
    expect(() =>
      calculateSettlementFx({
        appliedAmount: 1,
        sourceAmount: invalid,
        sourceExchangeRate: 1,
        isAR: true
      })
    ).toThrow();
    expect(() =>
      calculateSettlementFx({
        appliedAmount: 1,
        sourceAmount: 1,
        sourceExchangeRate: 1,
        sourceBaseAmount: invalid,
        isAR: true
      })
    ).toThrow();
  }
});

it("recorded source carrying residual governs FX on its final allocation", () => {
  const input = {
    appliedAmount: 0.33333,
    sourceAmount: 1,
    sourceExchangeRate: 3,
    sourceBaseAmount: 0.33334
  };
  expect(calculateSettlementFx({ ...input, isAR: true })).toEqual(0.00001);
  expect(calculateSettlementFx({ ...input, isAR: false })).toEqual(-0.00001);
});
