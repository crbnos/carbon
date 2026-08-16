import { describe, expect, it } from "vitest";
import { noRawRounding } from "./no-raw-rounding";

describe("no-raw-rounding", () => {
  it("flags Math.round / Math.ceil / Math.floor / toFixed", () => {
    const src = [
      "const a = Math.round(x * 100) / 100;",
      "const b = Math.ceil(qty * scrapPct);",
      "const c = Math.floor(total);",
      "const d = Number(price.toFixed(2));"
    ].join("\n");
    const violations = noRawRounding.scan("a.ts", src);
    expect(violations).toHaveLength(4);
    expect(violations.map((v) => v.line)).toEqual([1, 2, 3, 4]);
  });

  it("uses the full trimmed line as the snippet so sites never collapse", () => {
    const src = ["Math.ceil(a);", "Math.ceil(b);"].join("\n");
    const [first, second] = noRawRounding.scan("a.ts", src);
    expect(first?.snippet).not.toBe(second?.snippet);
  });

  it("allows the precision module's helpers", () => {
    const src = [
      'import { round, scrapAllowance } from "@carbon/utils";',
      "const a = round(x);",
      "const b = scrapAllowance(target, rate);"
    ].join("\n");
    expect(noRawRounding.scan("a.ts", src)).toHaveLength(0);
  });
});
