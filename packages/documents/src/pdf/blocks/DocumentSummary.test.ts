// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { getMoneyFormatter } from "../../utils/shared";
import type { TaxSummaryEntry } from "../../utils/tax-summary";
import { summaryTaxRows } from "./DocumentSummary";

function rows(
  taxSummary: TaxSummaryEntry[],
  { printsTax = true, showsTax = true } = {}
) {
  return summaryTaxRows({
    taxSummary,
    taxLabel: "Taxes",
    currencyCode: "CAD",
    locale: "en-US",
    numberFormatter: getMoneyFormatter("en-US", 2),
    taxValue: "144.00",
    printsTax,
    showsTax
  });
}

describe("DocumentSummary tax rows", () => {
  it("prints the single tax row for one entry", () => {
    const result = rows([{ name: "HST", rate: 0.12, base: 1200, tax: 144 }]);
    expect(result).toEqual([
      { key: "tax", label: "Taxes (CAD)", amount: "144.00" }
    ]);
  });

  it("prints one row per component when there are several", () => {
    const result = rows([
      { name: "GST", rate: 0.05, base: 1200, tax: 60 },
      { name: "PST", rate: 0.07, base: 1200, tax: 84 }
    ]);
    expect(result).toEqual([
      { key: "GST:0.05", label: "GST 5% on 1,200.00 (CAD)", amount: "60.00" },
      { key: "PST:0.07", label: "PST 7% on 1,200.00 (CAD)", amount: "84.00" }
    ]);
  });

  it("prints no tax row when no line is taxed", () => {
    expect(rows([], { printsTax: false })).toEqual([]);
  });

  it("prints no component row when the user hid the tax value", () => {
    expect(
      rows(
        [
          { name: "GST", rate: 0.05, base: 1200, tax: 60 },
          { name: "PST", rate: 0.07, base: 1200, tax: 84 }
        ],
        { printsTax: false, showsTax: false }
      )
    ).toEqual([]);
  });
});
