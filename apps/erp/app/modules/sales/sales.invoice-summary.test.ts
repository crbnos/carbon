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
    balance: 25,
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
      balanceRemaining: 25,
      currencyMismatchCount: 0
    });
  });

  it("keeps a credit-only invoice balance separate from cash paid", () => {
    expect(
      summarizeSalesOrderInvoices(
        "USD",
        [invoice({ balance: 0, status: "Paid" })],
        []
      )
    ).toEqual({
      invoicedAmount: 100,
      paidAmount: 0,
      balanceRemaining: 0,
      currencyMismatchCount: 0
    });
  });

  it("converts base totals into the order currency at the invoice's rate", () => {
    // 100 base × 0.8 EUR per base = 80 EUR invoiced; 50 base paid = 40 EUR; 50 base balance = 40 EUR.
    expect(
      summarizeSalesOrderInvoices(
        "EUR",
        [invoice({ balance: 50, currencyCode: "EUR", exchangeRate: 0.8 })],
        [{ targetSalesInvoiceId: "inv-1", appliedAmount: 50 }]
      )
    ).toEqual({
      invoicedAmount: 80,
      paidAmount: 40,
      balanceRemaining: 40,
      currencyMismatchCount: 0
    });
  });

  it.each(["Draft", "Pending", "Voided", "Return"])(
    "ignores a %s invoice and the payments applied to it",
    (status) => {
      expect(
        summarizeSalesOrderInvoices(
          "USD",
          [invoice({ balance: 90 }), invoice({ id: "inv-2", status })],
          [
            { targetSalesInvoiceId: "inv-1", appliedAmount: 10 },
            { targetSalesInvoiceId: "inv-2", appliedAmount: 100 }
          ]
        )
      ).toEqual({
        invoicedAmount: 100,
        paidAmount: 10,
        balanceRemaining: 90,
        currencyMismatchCount: 0
      });
    }
  );

  it("counts an invoice in another currency instead of mixing it into the totals", () => {
    expect(
      summarizeSalesOrderInvoices(
        "USD",
        [
          invoice({ balance: 100 }),
          invoice({ id: "inv-2", currencyCode: "EUR" })
        ],
        [{ targetSalesInvoiceId: "inv-2", appliedAmount: 100 }]
      )
    ).toEqual({
      invoicedAmount: 100,
      paidAmount: 0,
      balanceRemaining: 100,
      currencyMismatchCount: 1
    });
  });
});
