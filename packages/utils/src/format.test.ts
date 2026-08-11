import { describe, expect, it } from "vitest";
import {
  formatMoney,
  formatPercent,
  formatPrice,
  formatQuantity
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

  it("pads to settlement decimals when the price is coarse", () => {
    expect(formatPrice(4.5, "en-US", "USD", 2)).toBe("$4.50");
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
