import { describe, expect, it } from "vitest";
import {
  applyRate,
  assertBalanced,
  deriveRate,
  isBalanced,
  RoundingMode,
  round,
  scrapAllowance
} from "./precision";

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
