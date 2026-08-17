import { describe, expect, it } from "vitest";
import {
  formatMoney,
  formatPercent,
  formatQuantity,
  INPUT_FORMAT,
  INPUT_STEP,
  moneyFormatOptions,
  rateFormatOptions
} from "./format";

describe("formatPercent", () => {
  it("renders up to 3 digits, only when real", () => {
    expect(formatPercent(0.0625, "en-US")).toBe("6.25%");
    expect(formatPercent(0.06255, "en-US")).toBe("6.255%");
    expect(formatPercent(0.05, "en-US")).toBe("5%");
  });
});

describe("formatMoney", () => {
  it("pads to the currency's decimals, so the width states the amount in full", () => {
    expect(formatMoney(300, "en-US", "USD", 2)).toBe("$300.00");
    expect(formatMoney(3.5, "en-US", "USD", 2)).toBe("$3.50");
    expect(formatMoney(0, "en-US", "USD", 2)).toBe("$0.00");
    expect(formatMoney(1234.5, "en-US", "USD", 2)).toBe("$1,234.50");
  });

  it("takes the currency's decimals as the CEILING too", () => {
    // The DB column is authoritative, so a stored value wider than the currency
    // rounds to it on screen — storage keeps the rest.
    expect(formatMoney(300.22121, "en-US", "USD", 2)).toBe("$300.22");
    expect(formatMoney(18.7638, "en-US", "USD", 2)).toBe("$18.76");
  });

  it("respects a 0-decimal and a 3-decimal currency", () => {
    expect(formatMoney(63, "en-US", "JPY", 0)).toBe("¥63");
    expect(formatMoney(63.4, "en-US", "JPY", 0)).toBe("¥63");
    // Intl separates code and value with a non-breaking space
    expect(formatMoney(0.563, "en-US", "BHD", 3)).toBe("BHD\u00a00.563");
    expect(formatMoney(0.5, "en-US", "BHD", 3)).toBe("BHD\u00a00.500");
  });

  it("gives editable fields the SAME digits they display with", () => {
    // react-aria's blur commit is setNumberValue(parse(format(x))), so this
    // options object decides the precision a typed amount is STORED at.
    const usd = new Intl.NumberFormat("en-US", INPUT_FORMAT.money("USD", 2));
    expect(usd.format(300)).toBe("$300.00");
    expect(usd.format(300.22121)).toBe("$300.22");

    const jpy = new Intl.NumberFormat("en-US", INPUT_FORMAT.money("JPY", 0));
    expect(jpy.format(63.4)).toBe("¥63");
  });

  it("money and price agree until the currency's decimals run out", () => {
    const price = new Intl.NumberFormat("en-US", INPUT_FORMAT.rate("USD", 2));
    const money = new Intl.NumberFormat("en-US", INPUT_FORMAT.money("USD", 2));
    // A settlement amount and a per-unit price of the same value look alike...
    for (const v of [0, 300, 18.75]) {
      expect(price.format(v)).toBe(money.format(v));
    }
    // ...until the value needs more than the currency settles in, where a
    // SETTLEMENT amount rounds and a PRICE keeps its digits (#1203).
    expect(money.format(300.22121)).toBe("$300.22");
    expect(price.format(300.22121)).toBe("$300.22121");
  });
});

describe("formatQuantity", () => {
  it("shows full storage precision without padding", () => {
    expect(formatQuantity(4.33333, "en-US")).toBe("4.33333");
    expect(formatQuantity(3, "en-US")).toBe("3");
    expect(formatQuantity(0.00125, "en-US")).toBe("0.00125");
  });

  it("uses locale separators", () => {
    expect(formatQuantity(1234.5, "de-DE")).toBe("1.234,5");
  });
});

describe("INPUT_STEP", () => {
  it("is never coarser than the scale the field holds", () => {
    // A step coarser than the stored scale SNAPS on commit: step 0.0001 turned
    // a typed 6.255% into 6.25%, silently, before anything could format it.
    expect(INPUT_STEP.percent).toBe(1e-5);
    expect(INPUT_STEP.quantity).toBe(1e-5);
    expect(INPUT_STEP.exchangeRate).toBe(1e-5);
  });

  it("lets every value the rate kind can DISPLAY also be committed", () => {
    // 3 percent-digits == 5 fraction decimals; each must be a whole multiple
    // of the step, or react-aria snaps it away.
    for (const percent of [0.0625, 0.06255, 0.12345, 0.05, 0.001]) {
      expect(Math.round(percent / INPUT_STEP.percent)).toBeCloseTo(
        percent / INPUT_STEP.percent,
        9
      );
    }
  });

  it("steps settlement money in its own smallest unit", () => {
    expect(INPUT_STEP.money(2)).toBe(0.01);
    expect(INPUT_STEP.money(0)).toBe(1);
    expect(INPUT_STEP.money(3)).toBe(0.001);
  });
});

describe("rateFormatOptions — the price kind (issue #1203)", () => {
  const fmt = (v: number, currency = "USD", decimals = 2) =>
    new Intl.NumberFormat(
      "en-US",
      rateFormatOptions(currency, decimals)
    ).format(v);

  it("still PADS to the currency's decimals — a price column stays aligned", () => {
    expect(fmt(300)).toBe("$300.00");
    expect(fmt(3.5)).toBe("$3.50");
    expect(fmt(0)).toBe("$0.00");
  });

  it("but the currency's decimals are a FLOOR, not a ceiling", () => {
    // The whole point: a distributor price that a 2-decimal field would have
    // turned into $0.00 survives.
    expect(fmt(0.164)).toBe("$0.164");
    expect(fmt(0.00123)).toBe("$0.00123");
    expect(fmt(12.34567)).toBe("$12.34567");
  });

  it("never exceeds the storage scale — display cannot imply more than is kept", () => {
    expect(fmt(1.234567891)).toBe("$1.23457");
  });

  it("respects a currency whose own decimals already exceed nothing", () => {
    expect(fmt(63, "JPY", 0)).toBe("¥63");
    expect(fmt(63.4, "JPY", 0)).toBe("¥63.4");
    expect(fmt(0.563, "BHD", 3)).toBe("BHD\u00a00.563");
  });

  it("differs from money ONLY in the ceiling", () => {
    const money = new Intl.NumberFormat(
      "en-US",
      moneyFormatOptions(2, { currency: "USD" })
    );
    const price = new Intl.NumberFormat("en-US", rateFormatOptions("USD", 2));
    // identical where the value fits the currency
    for (const v of [0, 3.5, 300, 1234.5]) {
      expect(price.format(v)).toBe(money.format(v));
    }
    // and only diverges past it
    expect(money.format(0.164)).toBe("$0.16");
    expect(price.format(0.164)).toBe("$0.164");
  });

  it("INPUT_FORMAT.rate is that kind, so a typed price commits at its width", () => {
    // react-aria commits parse(format(x)); this is what #1203 was about.
    const opts = INPUT_FORMAT.rate("USD", 2);
    expect(opts.maximumFractionDigits).toBe(5);
    expect(opts.minimumFractionDigits).toBe(2);
  });

  it("INPUT_STEP.rate cannot snap away the digits the format keeps", () => {
    expect(INPUT_STEP.rate).toBe(1e-5);
    expect(INPUT_STEP.money(2)).toBe(0.01);
  });
});
