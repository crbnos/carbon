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

  it("allows named kinds", () => {
    const src = "formatOptions={INPUT_FORMAT.percent}";
    expect(noInlineFractionDigits.scan("a.tsx", src)).toHaveLength(0);
  });
});
