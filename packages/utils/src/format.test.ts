import { describe, expect, it } from "vitest";
import {
  formatMoney,
  formatPercent,
  formatPrice,
  formatQuantity,
  INPUT_STEP
} from "./format";

describe("formatPercent", () => {
  it("renders up to 3 digits, only when real", () => {
    expect(formatPercent(0.0625, "en-US")).toBe("6.25%");
    expect(formatPercent(0.06255, "en-US")).toBe("6.255%");
    expect(formatPercent(0.05, "en-US")).toBe("5%");
  });
});

describe("formatMoney", () => {
  it("pads settlement money to the currency's decimals", () => {
    expect(formatMoney(4.5, "en-US", "USD", 2)).toBe("$4.50");
  });

  it("respects a 0-decimal currency", () => {
    expect(formatMoney(1000, "en-US", "JPY", 0)).toBe("¥1,000");
  });

  it("respects a 3-decimal currency", () => {
    // Intl separates code and value with a non-breaking space
    expect(formatMoney(0.563, "en-US", "BHD", 3)).toBe("BHD 0.563");
  });
});

describe("formatPrice", () => {
  it("shows the full stored per-unit price", () => {
    expect(formatPrice(0.164, "en-US", "USD", 2)).toBe("$0.164");
  });

  it("carries only the digits the price actually has", () => {
    // Non-significant zeros are noise on a value whose precision varies.
    expect(formatPrice(4.5, "en-US", "USD", 2)).toBe("$4.5");
    expect(formatPrice(3, "en-US", "USD", 2)).toBe("$3");
    expect(formatPrice(3.03, "en-US", "USD", 2)).toBe("$3.03");
    expect(formatPrice(3.1, "en-US", "USD", 2)).toBe("$3.1");
    expect(formatPrice(3.003, "en-US", "USD", 2)).toBe("$3.003");
  });

  it("is unaffected by the currency's decimals", () => {
    // The argument is vestigial — a price is an internal scale-5 value, so the
    // settlement width has no say in how many digits it shows.
    expect(formatPrice(3, "en-US", "BHD", 3)).toBe(
      formatPrice(3, "en-US", "BHD", 0)
    );
  });

  it("still pads settlement money, which is the opposite kind", () => {
    // The contrast is the point: money's zeros state the amount in full, and it
    // has already been rounded TO the currency's decimals.
    expect(formatMoney(3, "en-US", "USD", 2)).toBe("$3.00");
    expect(formatMoney(3.003, "en-US", "USD", 2)).toBe("$3.00");
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
    expect(INPUT_STEP.rate).toBe(1e-5);
    expect(INPUT_STEP.quantity).toBe(1e-5);
    expect(INPUT_STEP.price).toBe(1e-5);
  });

  it("lets every value the rate kind can DISPLAY also be committed", () => {
    // 3 percent-digits == 5 fraction decimals; each must be a whole multiple
    // of the step, or react-aria snaps it away.
    for (const percent of [0.0625, 0.06255, 0.12345, 0.05, 0.001]) {
      expect(Math.round(percent / INPUT_STEP.rate)).toBeCloseTo(
        percent / INPUT_STEP.rate,
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
