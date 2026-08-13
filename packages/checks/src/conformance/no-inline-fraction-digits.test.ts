import { describe, expect, it } from "vitest";
import { noInlineFractionDigits } from "./no-inline-fraction-digits";

describe("no-inline-fraction-digits", () => {
  it("flags inline fraction-digit options", () => {
    const src = [
      "const f = new Intl.NumberFormat(locale, {",
      "  minimumFractionDigits: 2,",
      "  maximumFractionDigits: 4",
      "});"
    ].join("\n");
    const violations = noInlineFractionDigits.scan("a.tsx", src);
    expect(violations).toHaveLength(2);
    expect(violations[0]?.message).toContain("named kind");
  });

  it("excludes the one file where digits are defined", () => {
    const src = "const opts = { maximumFractionDigits: SCALE };";
    expect(
      noInlineFractionDigits.scan("packages/utils/src/format.ts", src)
    ).toHaveLength(0);
  });

  it("does NOT exclude a file that merely consumes a kind", () => {
    // Hook files were once listed as exclusions even though they contain no
    // digits at all, which exempted whatever got added to them later. A file
    // that consumes a kind has nothing to exempt, so it must still be scanned.
    const src = "const opts = { maximumFractionDigits: 2 };";
    for (const file of [
      "apps/erp/app/hooks/usePercentFormatter.tsx",
      "apps/erp/app/hooks/useQuantityFormatter.tsx",
      "packages/documents/src/utils/shared.ts"
    ]) {
      expect(noInlineFractionDigits.scan(file, src)).toHaveLength(1);
    }
  });

  it("allows named kinds", () => {
    const src = "formatOptions={INPUT_FORMAT.rate}";
    expect(noInlineFractionDigits.scan("a.tsx", src)).toHaveLength(0);
  });
});
