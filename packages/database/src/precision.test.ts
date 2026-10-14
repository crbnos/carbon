// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  applyRate,
  assertBalanced,
  deriveRate,
  distributeRoundingResidual,
  isBalanced,
  RoundingMode,
  round,
  SCALE,
  scrapAllowance
} from "./precision.ts";

describe("round", () => {
  it("rounds 1.005 to 1.01 at 2dp (exponent-shift beats the float artifact)", () => {
    expect(round(1.005, 2)).toBe(1.01);
  });

  it("rounds ties away from zero like Postgres (round(-2.5, 0) === -3)", () => {
    expect(round(-2.5, 0)).toBe(-3);
    expect(round(2.5, 0)).toBe(3);
  });

  it("defaults to scale 5", () => {
    expect(round(4.33333333)).toBe(4.33333);
  });

  it("passes non-finite values through", () => {
    expect(round(Infinity)).toBe(Infinity);
    expect(round(-Infinity)).toBe(-Infinity);
    expect(Number.isNaN(round(NaN))).toBe(true);
  });

  it("rounds up away from zero in Up mode", () => {
    expect(round(0.31, 0, RoundingMode.Up)).toBe(1);
    expect(round(-0.31, 0, RoundingMode.Up)).toBe(-1);
    expect(round(2.00001, 0, RoundingMode.Up)).toBe(3);
  });
});

describe("scrapAllowance", () => {
  it("is zero at a zero rate, so the target passes through unrounded", () => {
    expect(scrapAllowance(4.5, 0)).toBe(0);
    expect(4.5 + scrapAllowance(4.5, 0)).toBe(4.5);
  });

  it("ceils a partial allowance to whole units", () => {
    expect(scrapAllowance(31, 0.01)).toBe(1);
    expect(31 + scrapAllowance(31, 0.01)).toBe(32);
  });

  it("ceils rather than rounds — 2.00001 units of scrap needs 3", () => {
    expect(scrapAllowance(200001, 0.00001)).toBe(3);
  });
});

describe("deriveRate", () => {
  it("recovers the rate an amount implies, at internal scale", () => {
    expect(deriveRate(0.56, 9)).toBe(0.06222);
  });

  it("is zero when there is no base to divide by", () => {
    expect(deriveRate(5, 0)).toBe(0);
    expect(deriveRate(5, -1)).toBe(0);
  });

  it("round-trips a typed rate through applyRate at internal scale", () => {
    expect(deriveRate(applyRate(9, 0.0625, 5), 9)).toBe(0.0625);
  });
});

describe("applyRate", () => {
  it("rounds to settlement decimals", () => {
    expect(applyRate(9, 0.0625, 2)).toBe(0.56);
  });

  it("handles 0-decimal currencies", () => {
    expect(applyRate(1000, 0.0625, 0)).toBe(63);
  });

  it("handles 3-decimal currencies", () => {
    expect(applyRate(9, 0.0625, 3)).toBe(0.563);
  });
});

describe("isBalanced", () => {
  it("absorbs float noise at the default EPSILON", () => {
    expect(isBalanced(0.1 + 0.2, 0.3)).toBe(true);
  });

  it("distinguishes adjacent scale-5 values", () => {
    expect(isBalanced(1.00002, 1.00003)).toBe(false);
  });

  it("accepts drift inside an explicit business tolerance and rejects it outside", () => {
    expect(isBalanced(100, 100.0005, 0.001)).toBe(true);
    expect(isBalanced(100, 100.002, 0.001)).toBe(false);
  });

  it("is sign-agnostic — credits over debits reads the same", () => {
    expect(isBalanced(100.005, 100, 0.01)).toBe(true);
    expect(isBalanced(100, 100.005, 0.01)).toBe(true);
  });
});

describe("assertBalanced", () => {
  it("throws on drift beyond the default EPSILON", () => {
    expect(() => assertBalanced(100, 100.001)).toThrow(/does not balance/);
  });

  it("passes equal debits and credits", () => {
    expect(() => assertBalanced(100, 100)).not.toThrow();
  });

  it("honors an explicit business tolerance", () => {
    expect(() => assertBalanced(100, 100.005, 0.01)).not.toThrow();
    expect(() => assertBalanced(100, 100.02, 0.01)).toThrow(/does not balance/);
  });
});

describe("distributeRoundingResidual", () => {
  const sum = (values: number[]) =>
    round(
      values.reduce((t, v) => t + v, 0),
      SCALE
    );

  it("distributes a surplus one minor unit at a time, most under-rounded first", () => {
    // 20 lines of 1.99 at 8.25%: each exact tax is 0.164175, which rounds down to
    // 0.16 and leaves an 0.08 residual against the authoritative 3.28.
    const exact = Array.from({ length: 20 }, () => 1.99 * 0.0825);
    const allocated = distributeRoundingResidual(exact, 3.28, 2);
    expect(sum(allocated)).toEqual(3.28);
    // Every component stays within one minor unit of its own exact value, which
    // is the bound QuickBooks' `tax = net × percent` check assumes.
    for (const [index, value] of allocated.entries()) {
      expect(Math.abs(value - exact[index]!) <= 0.01).toEqual(true);
    }
    expect(allocated.filter((v) => v === 0.17).length).toEqual(8);
    expect(allocated.filter((v) => v === 0.16).length).toEqual(12);
  });

  it("takes a deficit from the most over-rounded parts", () => {
    // 0.128 rounds UP to 0.13, so those two parts owe a unit back; 0.121 rounds
    // DOWN and is asked last. One unit is owed, so only the first over-rounded
    // part gives it up.
    const allocated = distributeRoundingResidual(
      [0.128, 0.128, 0.121],
      0.37,
      2
    );
    expect(sum(allocated)).toEqual(0.37);
    expect(allocated).toEqual([0.12, 0.13, 0.12]);
  });

  it("breaks an exact deficit tie by index", () => {
    const allocated = distributeRoundingResidual(
      [0.126, 0.126, 0.126],
      0.37,
      2
    );
    expect(sum(allocated)).toEqual(0.37);
    expect(allocated).toEqual([0.12, 0.12, 0.13]);
  });

  it("returns the independently rounded values when nothing is left over", () => {
    expect(distributeRoundingResidual([1.115, 2.22], 3.34, 2)).toEqual([
      1.12, 2.22
    ]);
  });

  it("resolves ties by index so the allocation is stable", () => {
    const first = distributeRoundingResidual([0.125, 0.125], 0.26, 2);
    const second = distributeRoundingResidual([0.125, 0.125], 0.26, 2);
    expect(first).toEqual(second);
    expect(first).toEqual([0.13, 0.13]);
  });

  it("keeps signed parts on their own side of zero", () => {
    const allocated = distributeRoundingResidual(
      [1.005, -0.335, -0.335],
      0.34,
      2
    );
    expect(sum(allocated)).toEqual(0.34);
    expect(allocated[0]! > 0).toEqual(true);
    expect(allocated.slice(1).every((v) => v < 0)).toEqual(true);
  });

  it("refuses a residual larger than one unit per part — that is a real disagreement", () => {
    expect(() => distributeRoundingResidual([1.0, 2.0], 10.0, 2)).toThrow(
      "exceeds"
    );
  });

  it("refuses non-finite inputs", () => {
    expect(() => distributeRoundingResidual([1, Number.NaN], 1, 2)).toThrow(
      "finite"
    );
  });

  it("defaults to internal scale", () => {
    const allocated = distributeRoundingResidual([0.000005, 0.000005], 0.00002);
    expect(sum(allocated)).toEqual(0.00002);
  });

  it("never reverses a part's sign to place the residual", () => {
    // Reported on PR #1599: mixed-sign tax components. The deficit unit used to
    // land on the only positive part (it had the smallest rounding error),
    // turning a +0.001 tax into -0.01 against positive revenue — the exact shape
    // this helper exists to prevent.
    const exact = [-0.028, -0.028, 0.001];
    const allocated = distributeRoundingResidual(exact, -0.07, 2);
    expect(sum(allocated)).toEqual(-0.07);
    expect(allocated).toEqual([-0.04, -0.03, 0]);
    for (const [index, value] of allocated.entries()) {
      if (value !== 0 && exact[index] !== 0) {
        expect(Math.sign(value)).toEqual(Math.sign(exact[index]!));
      }
    }
  });

  it("refuses a target that can only be met by reversing a sign", () => {
    expect(() => distributeRoundingResidual([0.001, 0.001], -0.02, 2)).toThrow(
      "reversing"
    );
  });
});
