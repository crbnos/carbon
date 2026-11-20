// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { loadTaxSummary } from "./sales-invoice-tax-summary.server";

type Rows = Record<string, unknown[]>;

// A chainable stand-in for a Supabase client: every read of `table` resolves
// to `rows[table]`, and each table touched is recorded.
function fakeClient(rows: Rows) {
  const tables: string[] = [];
  const client = {
    from(table: string) {
      tables.push(table);
      const result = { data: rows[table] ?? [], error: null };
      const chain: Record<string, unknown> = {
        then: (resolve: (value: typeof result) => unknown) => resolve(result)
      };
      for (const method of ["select", "eq", "in", "limit"]) {
        chain[method] = () => chain;
      }
      return chain;
    }
  };
  return { client: client as never, tables };
}

const company = {
  countryCode: "GB",
  stateProvince: null,
  taxId: "GB-COMPANY",
  timezone: "UTC"
};

const line = {
  id: "line-1",
  invoiceLineType: "Part",
  taxCodeId: "code-std",
  quantity: 1,
  convertedUnitPrice: 100,
  discountPercent: 0,
  convertedShippingCost: 0,
  convertedAddOnCost: 0,
  taxPercent: 0.2
} as never;

const taxRows: Rows = {
  taxCode: [
    {
      id: "code-std",
      calculationType: "Normal",
      invoiceMessage: null,
      taxesShipping: false,
      taxCodeComponent: [
        {
          id: "cmp-vat",
          name: "VAT",
          taxAuthorityId: null,
          taxPercent: 0.2,
          recoverablePercent: 1,
          sequence: 1,
          isCompound: false,
          taxReceivedAccountId: null,
          taxPaidAccountId: null,
          effectiveDate: null,
          expirationDate: null
        }
      ]
    }
  ],
  taxRegistration: [
    {
      countryCode: "GB",
      state: null,
      registrationNumber: "GB123456789",
      effectiveDate: null,
      endDate: null
    }
  ],
  taxLedger: [
    {
      journalId: "jrn-post",
      createdAt: "2026-10-01T10:00:00.000+00:00",
      componentName: "VAT (posted)",
      taxPercent: 0.2,
      documentTaxableAmount: 100,
      documentTaxAmount: 20
    }
  ]
};

const load = (status: string, taxClient: never) =>
  loadTaxSummary({
    taxClient,
    companyId: "company-1",
    invoiceId: "invoice-1",
    company,
    salesInvoice: {
      dateIssued: "2026-10-01",
      status
    } as never,
    lines: [line],
    headerShipping: 0,
    currencyDecimals: 2
  });

describe("loadTaxSummary", () => {
  it("reads every tax table through the tax client and never reads journal", async () => {
    const tax = fakeClient(taxRows);
    const summary = await load("Submitted", tax.client);
    expect(new Set(tax.tables)).toEqual(
      new Set(["taxCode", "taxRegistration", "taxLedger"])
    );
    expect(summary.sellerRegistration).toBe("GB123456789");
  });

  it("prints the posted ledger rows once the invoice status is past Draft", async () => {
    const summary = await load("Submitted", fakeClient(taxRows).client);
    expect(summary.taxSummary?.[0]?.name).toBe("VAT (posted)");
  });

  it("splits the lines for a Draft, ignoring any ledger rows", async () => {
    const summary = await load("Draft", fakeClient(taxRows).client);
    expect(summary.taxSummary?.[0]?.name).toBe("VAT");
  });
});
