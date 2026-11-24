// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
    const src = "formatOptions={INPUT_FORMAT.percent}";
    expect(noInlineFractionDigits.scan("a.tsx", src)).toHaveLength(0);
  });

  it("flags the exchange-rate input acdbcad23e fixed, and passes its fix", () => {
    // apps/erp/app/modules/accounting/ui/ExchangeRates/ExchangeRateForm.tsx
    // before acdbcad23e: the editable rate set only its minimum digits from
    // the currency's display decimals, so Intl's default maximum applied and
    // react-aria's blur commit (parse(format(x))) cut the stored rate.
    const before = [
      "              <NumberField",
      '                name="exchangeRate"',
      "                formatOptions={{",
      "                  minimumFractionDigits: decimalPlaces ?? 0",
      "                }}",
      "              />"
    ].join("\n");
    const file =
      "apps/erp/app/modules/accounting/ui/ExchangeRates/ExchangeRateForm.tsx";
    expect(
      noInlineFractionDigits.scan(file, before).map((v) => v.snippet)
    ).toEqual(["minimumFractionDigits: decimalPlaces ?? 0"]);
    const after = [
      "                step={INPUT_STEP.exchangeRate}",
      "                formatOptions={INPUT_FORMAT.exchangeRate}"
    ].join("\n");
    expect(noInlineFractionDigits.scan(file, after)).toHaveLength(0);
  });
});
