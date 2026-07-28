import { describe, expect, it } from "vitest";
import { formatQuantityForDisplay } from "./useQuantityFormatter";

const formatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
});

const format = (quantity: number) =>
  formatQuantityForDisplay(quantity, formatter);

describe("formatQuantityForDisplay", () => {
  it("rounds to two decimals", () => {
    expect(format(3.232227)).toBe("3.23");
    expect(format(1.983918)).toBe("1.98");
    expect(format(0.02008193)).toBe("0.02");
    expect(format(1.005)).toBe("1.01");
  });

  it("keeps whole numbers whole", () => {
    expect(format(1)).toBe("1");
    expect(format(3)).toBe("3");
    expect(format(1000)).toBe("1,000");
    expect(format(3.0)).toBe("3");
  });

  it("drops a trailing zero on a single-decimal quantity", () => {
    expect(format(1.5)).toBe("1.5");
    expect(format(2.1)).toBe("2.1");
  });

  it("never renders a non-zero quantity as zero", () => {
    expect(format(0.004)).toBe("<0.01");
    expect(format(0.000001)).toBe("<0.01");
    expect(format(0.00999)).toBe("<0.01");
  });

  it("renders a genuine zero as zero", () => {
    expect(format(0)).toBe("0");
  });

  it("keeps the boundary value exact", () => {
    expect(format(0.01)).toBe("0.01");
  });

  it("handles small negative quantities symmetrically", () => {
    expect(format(-0.004)).toBe(">-0.01");
    expect(format(-2.567)).toBe("-2.57");
  });

  it("returns an empty string for non-finite values", () => {
    expect(format(Number.NaN)).toBe("");
    expect(format(Number.POSITIVE_INFINITY)).toBe("");
  });

  it("respects the locale of the formatter it is given", () => {
    const de = new Intl.NumberFormat("de-DE", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    });
    expect(formatQuantityForDisplay(3.232227, de)).toBe("3,23");
    expect(formatQuantityForDisplay(0.004, de)).toBe("<0,01");
  });

  it("uses the locale's own negative sign below the threshold", () => {
    // sv-SE renders negatives with U+2212 MINUS SIGN, not an ASCII hyphen.
    const sv = new Intl.NumberFormat("sv-SE", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    });
    expect(formatQuantityForDisplay(-0.004, sv)).toBe(`>${sv.format(-0.01)}`);
    expect(formatQuantityForDisplay(-0.004, sv)).toBe(">−0,01");
    expect(formatQuantityForDisplay(0.004, sv)).toBe("<0,01");
  });
});
