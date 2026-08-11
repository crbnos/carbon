import { quantityFormatOptions } from "@carbon/utils";
import { describe, expect, it } from "vitest";
import { formatQuantityForDisplay } from "./useQuantityFormatter";

const formatter = new Intl.NumberFormat("en-US", quantityFormatOptions());

const format = (quantity: number) =>
  formatQuantityForDisplay(quantity, formatter);

describe("formatQuantityForDisplay", () => {
  it("shows full storage precision up to five decimals", () => {
    expect(format(4.33333)).toBe("4.33333");
    expect(format(3.232227)).toBe("3.23223");
    expect(format(1.983918)).toBe("1.98392");
  });

  it("keeps whole numbers whole", () => {
    expect(format(1)).toBe("1");
    expect(format(3)).toBe("3");
    expect(format(1000)).toBe("1,000");
    expect(format(3.0)).toBe("3");
  });

  it("drops trailing zeros", () => {
    expect(format(1.5)).toBe("1.5");
    expect(format(2.1)).toBe("2.1");
  });

  it("renders genuinely small quantities exactly, no placeholder", () => {
    expect(format(0.004)).toBe("0.004");
    expect(format(0.00125)).toBe("0.00125");
    expect(format(0.00999)).toBe("0.00999");
  });

  it("renders a genuine zero as zero", () => {
    expect(format(0)).toBe("0");
  });

  it("handles negative quantities", () => {
    expect(format(-2.567)).toBe("-2.567");
    expect(format(-0.004)).toBe("-0.004");
  });

  it("returns an empty string for non-finite values", () => {
    expect(format(Number.NaN)).toBe("");
    expect(format(Number.POSITIVE_INFINITY)).toBe("");
  });

  it("respects the locale of the formatter it is given", () => {
    const de = new Intl.NumberFormat("de-DE", quantityFormatOptions());
    expect(formatQuantityForDisplay(3.232227, de)).toBe("3,23223");
    expect(formatQuantityForDisplay(1234.5, de)).toBe("1.234,5");
  });
});
