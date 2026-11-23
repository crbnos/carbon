// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { summarizeSalesOrderInvoices } from "./sales.utils";

function invoice(
  overrides: Partial<Parameters<typeof summarizeSalesOrderInvoices>[1][number]>
) {
  return {
    id: "inv-1",
    invoiceTotal: 100,
    status: "Posted",
    currencyCode: "USD",
    exchangeRate: 1,
    ...overrides
  };
}

describe("summarizeSalesOrderInvoices", () => {
  it("adds up every applied settlement against an invoice", () => {
    expect(
      summarizeSalesOrderInvoices(
        "USD",
        [invoice({})],
        [
          { targetSalesInvoiceId: "inv-1", appliedAmount: 50 },
          { targetSalesInvoiceId: "inv-1", appliedAmount: 25 },
          { targetSalesInvoiceId: null, appliedAmount: 999 }
        ]
      )
    ).toEqual({
      invoicedAmount: 100,
      paidAmount: 75,
      currencyMismatchCount: 0
    });
  });

  it("converts base totals into the order currency at the invoice's rate", () => {
    // 100 base × 0.8 EUR per base = 80 EUR invoiced; 50 base paid = 40 EUR.
    expect(
      summarizeSalesOrderInvoices(
        "EUR",
        [invoice({ currencyCode: "EUR", exchangeRate: 0.8 })],
        [{ targetSalesInvoiceId: "inv-1", appliedAmount: 50 }]
      )
    ).toEqual({ invoicedAmount: 80, paidAmount: 40, currencyMismatchCount: 0 });
  });

  it("ignores a voided invoice and the payments applied to it", () => {
    expect(
      summarizeSalesOrderInvoices(
        "USD",
        [invoice({}), invoice({ id: "inv-2", status: "Voided" })],
        [
          { targetSalesInvoiceId: "inv-1", appliedAmount: 10 },
          { targetSalesInvoiceId: "inv-2", appliedAmount: 100 }
        ]
      )
    ).toEqual({
      invoicedAmount: 100,
      paidAmount: 10,
      currencyMismatchCount: 0
    });
  });

  it("counts an invoice in another currency instead of mixing it into the totals", () => {
    expect(
      summarizeSalesOrderInvoices(
        "USD",
        [invoice({}), invoice({ id: "inv-2", currencyCode: "EUR" })],
        [{ targetSalesInvoiceId: "inv-2", appliedAmount: 100 }]
      )
    ).toEqual({ invoicedAmount: 100, paidAmount: 0, currencyMismatchCount: 1 });
  });
});
