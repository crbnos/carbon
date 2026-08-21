import { round } from "@carbon/utils";
import { describe, expect, it } from "vitest";
import {
  chunk,
  RAMP_ACCOUNTS_BATCH_SIZE,
  rampClassificationForClass,
  scaleRepaymentLines
} from "../service";

describe("rampClassificationForClass", () => {
  it("maps each Carbon GL class to its Ramp classification", () => {
    expect(rampClassificationForClass("Asset", false)).toBe("ASSET");
    expect(rampClassificationForClass("Liability", false)).toBe("LIABILITY");
    expect(rampClassificationForClass("Equity", false)).toBe("EQUITY");
    expect(rampClassificationForClass("Revenue", false)).toBe("REVENUE");
    expect(rampClassificationForClass("Expense", false)).toBe("EXPENSE");
  });

  it("maps the card-liability account to CREDCARD regardless of class", () => {
    expect(rampClassificationForClass("Liability", true)).toBe("CREDCARD");
    expect(rampClassificationForClass("Asset", true)).toBe("CREDCARD");
    expect(rampClassificationForClass(null, true)).toBe("CREDCARD");
    expect(rampClassificationForClass(undefined, true)).toBe("CREDCARD");
  });

  it("returns null for an account with no class (unclassifiable)", () => {
    expect(rampClassificationForClass(null, false)).toBeNull();
    expect(rampClassificationForClass(undefined, false)).toBeNull();
  });
});

describe("chunk", () => {
  it("splits into batches of at most the given size", () => {
    const items = Array.from({ length: 1250 }, (_, index) => index);
    const batches = chunk(items, RAMP_ACCOUNTS_BATCH_SIZE);
    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(500);
    expect(batches[1]).toHaveLength(500);
    expect(batches[2]).toHaveLength(250);
    // No item is dropped or duplicated.
    expect(batches.flat()).toEqual(items);
  });

  it("returns exactly one batch when the input fits", () => {
    expect(chunk([1, 2, 3], RAMP_ACCOUNTS_BATCH_SIZE)).toEqual([[1, 2, 3]]);
  });

  it("returns no batches for an empty input", () => {
    expect(chunk([], RAMP_ACCOUNTS_BATCH_SIZE)).toEqual([]);
  });

  it("throws when the batch size is not positive", () => {
    expect(() => chunk([1], 0)).toThrow();
    expect(() => chunk([1], -1)).toThrow();
  });
});

describe("scaleRepaymentLines", () => {
  it("scales a 3-line original to a partial repayment, putting the rounding residual on the largest line so the sum equals the header exactly", () => {
    const original = [
      { accountId: "a", amount: 10 },
      { accountId: "b", amount: 10 },
      { accountId: "c", amount: 13.33 }
    ];
    // ratio = 11.11 / 33.33 ≈ 0.33333 → 3.33, 3.33, 4.44 (sum 11.10), residual
    // 0.01 lands on the largest line (c → 4.45).
    const scaled = scaleRepaymentLines(original, 11.11, 33.33, 2);

    expect(scaled.map((line) => line.amount)).toEqual([3.33, 3.33, 4.45]);

    const sum = round(
      scaled.reduce((acc, line) => acc + line.amount, 0),
      2
    );
    expect(sum).toBe(11.11);
  });

  it("returns an empty list for no original lines", () => {
    expect(scaleRepaymentLines([], 5, 10, 2)).toEqual([]);
  });
});
