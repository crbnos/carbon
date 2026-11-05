// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { getMoneyFormatter } from "../../utils/shared";
import type { TaxSummaryEntry } from "../../utils/tax-summary";
import { summaryTaxRows } from "./SummaryBlock";

function rows(taxSummary: TaxSummaryEntry[], taxPercent = 0.12) {
  return summaryTaxRows(
    {
      locale: "en-US",
      currencyCode: "CAD",
      numberFormatter: getMoneyFormatter("en-US", 2),
      salesInvoice: { exchangeRate: 1, totalTax: 144 },
      salesInvoiceLines: [
        {
          quantity: 10,
          convertedUnitPrice: 120,
          discountPercent: 0,
          taxPercent
        }
      ],
      taxSummary
    } as never,
    "Taxes"
  );
}

describe("SalesInvoice SummaryBlock tax rows", () => {
  it("prints today's single tax row for one entry", () => {
    const result = rows([{ name: "HST", rate: 0.12, base: 1200, tax: 144 }]);
    expect(result.map((row) => row.label)).toEqual(["Taxes (CAD)"]);
    expect(result[0]?.amount).toBe("144.00");
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
    expect(rows([], 0)).toEqual([]);
  });
});
