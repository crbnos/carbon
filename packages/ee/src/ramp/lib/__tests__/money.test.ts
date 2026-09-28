import { describe, expect, it } from "vitest";
import {
  normalizeRampCardTransactionAmount,
  parseVerifiedRampMinorAmount,
  rampMinorAmountToMajor,
  validateRampCurrencyDecimals,
  validateRampExchangeRate
} from "../money";

describe("parseVerifiedRampMinorAmount", () => {
  it("accepts Ramp signed and CurrencyAmount minor-unit objects", () => {
    expect(
      parseVerifiedRampMinorAmount(
        { value: -12_345, currency: "USD" },
        "Card amount"
      )
    ).toEqual({
      ok: true,
      value: { minorUnits: -12_345, currencyCode: "USD" }
    });
    expect(
      parseVerifiedRampMinorAmount(
        { amount: 63, currency_code: "JPY" },
        "Transfer amount"
      )
    ).toEqual({
      ok: true,
      value: { minorUnits: 63, currencyCode: "JPY" }
    });
  });

  it.each([
    undefined,
    null,
    Number.NaN,
    12.34
  ])("rejects absent or ambiguous bare-number value %s", (value) => {
    const result = parseVerifiedRampMinorAmount(value, "Transfer amount");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Transfer amount");
  });

  it.each([
    { value: Number.POSITIVE_INFINITY, currency: "USD" },
    { value: 1.5, currency: "USD" },
    { amount: Number.NaN, currency_code: "USD" },
    { amount: 2.5, currency_code: "USD" }
  ])("rejects invalid minor-unit object %#", (value) => {
    expect(parseVerifiedRampMinorAmount(value, "Amount").ok).toBe(false);
  });
});

describe("rampMinorAmountToMajor", () => {
  it("uses the authoritative currency precision", () => {
    expect(
      rampMinorAmountToMajor(
        { minorUnits: 4_000, currencyCode: "USD" },
        "USD",
        2
      )
    ).toBe(40);
    expect(
      rampMinorAmountToMajor({ minorUnits: 63, currencyCode: "JPY" }, "JPY", 0)
    ).toBe(63);
  });
});

describe("normalizeRampCardTransactionAmount", () => {
  it("prefers signed entity minor units", () => {
    expect(
      normalizeRampCardTransactionAmount({
        entityAmount: { value: -12_345, currency: "USD" },
        deprecatedMajorAmount: -999,
        currencyCode: "USD",
        decimals: 2
      })
    ).toEqual({ ok: true, value: -123.45 });
  });

  it("keeps the deprecated card fallback in major units", () => {
    expect(
      normalizeRampCardTransactionAmount({
        entityAmount: null,
        deprecatedMajorAmount: 123.45,
        currencyCode: "USD",
        decimals: 2
      })
    ).toEqual({ ok: true, value: 123.45 });
  });

  it("rejects an entity amount whose currency disagrees with the transaction", () => {
    expect(
      normalizeRampCardTransactionAmount({
        entityAmount: { value: 12_345, currency: "JPY" },
        deprecatedMajorAmount: undefined,
        currencyCode: "USD",
        decimals: 2
      }).ok
    ).toBe(false);
  });

  it.each([
    undefined,
    null,
    Number.NaN,
    Number.POSITIVE_INFINITY
  ])("rejects missing or non-finite fallback %s", (deprecatedMajorAmount) => {
    expect(
      normalizeRampCardTransactionAmount({
        entityAmount: null,
        deprecatedMajorAmount,
        currencyCode: "USD",
        decimals: 2
      }).ok
    ).toBe(false);
  });
});

describe("currency metadata validation", () => {
  it("accepts an authoritative zero-decimal precision", () => {
    expect(validateRampCurrencyDecimals(0, "JPY")).toEqual({
      ok: true,
      value: 0
    });
  });

  it.each([
    undefined,
    null,
    -1,
    1.5,
    Number.NaN
  ])("rejects unknown or invalid precision %s", (value) => {
    expect(validateRampCurrencyDecimals(value, "USD").ok).toBe(false);
  });

  it("accepts a finite positive exchange rate", () => {
    expect(validateRampExchangeRate("1.25", "EUR")).toEqual({
      ok: true,
      value: 1.25
    });
  });

  it.each([
    undefined,
    null,
    0,
    -1,
    Number.NaN,
    "not-a-rate"
  ])("rejects unknown or invalid exchange rate %s", (value) => {
    expect(validateRampExchangeRate(value, "EUR").ok).toBe(false);
  });
});
