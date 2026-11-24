// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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

  it("flags the exchange-rate rounding acdbcad23e fixed, and passes its fix", () => {
    // packages/jobs/src/inngest/functions/scheduled/update-exchange-rates.ts
    // before acdbcad23e: the nightly job rounded each rate to the currency's
    // display decimals, which zeroed every 0-decimal currency's rate and
    // froze rates that rounded to 0.
    const before = [
      "              exchangeRate: Number(",
      "                rates[currency.code as CurrencyCode]?.toFixed(",
      "                  currency.decimalPlaces",
      "                )",
      "              ),"
    ].join("\n");
    const file =
      "packages/jobs/src/inngest/functions/scheduled/update-exchange-rates.ts";
    expect(noRawRounding.scan(file, before).map((v) => v.snippet)).toEqual([
      "rates[currency.code as CurrencyCode]?.toFixed("
    ]);
    const after =
      "              exchangeRate: round(Number(rates[currency.code as CurrencyCode])),";
    expect(noRawRounding.scan(file, after)).toHaveLength(0);
  });
});
