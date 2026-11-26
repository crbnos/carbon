// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { loadTaxSummary } from "./sales-invoice-tax-summary.server";

type Rows = Record<string, Record<string, unknown>[]>;

// A chainable stand-in for a Supabase client: a read of `table` resolves to the
// rows of `rows[table]` that pass its `eq`/`in` filters, so a read that drops
// its `companyId` filter returns the other company's rows. Each table touched
// is recorded.
function fakeClient(rows: Rows) {
  const tables: string[] = [];
  const client = {
    from(table: string) {
      tables.push(table);
      const filters: ((row: Record<string, unknown>) => boolean)[] = [];
      let limit = Number.POSITIVE_INFINITY;
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          filters.push((row) => row[column] === value);
          return chain;
        },
        in: (column: string, values: unknown[]) => {
          filters.push((row) => values.includes(row[column]));
          return chain;
        },
        limit: (count: number) => {
          limit = count;
          return chain;
        },
        then: (resolve: (value: unknown) => unknown) =>
          resolve({
            data: (rows[table] ?? [])
              .filter((row) => filters.every((passes) => passes(row)))
              .slice(0, limit),
            error: null
          })
      };
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

const taxCodeRow = (companyId: string, active: boolean, name: string) => ({
  id: "code-std",
  companyId,
  active,
  calculationType: "Normal",
  invoiceMessage: companyId === "company-1" ? null : `${name} clause`,
  taxesShipping: false,
  taxCodeComponent: [
    {
      id: "cmp-vat",
      name,
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
});

const registrationRow = (companyId: string, registrationNumber: string) => ({
  companyId,
  countryCode: "GB",
  state: null,
  registrationNumber,
  effectiveDate: null,
  endDate: null
});

const ledgerRow = (companyId: string, componentName: string) => ({
  companyId,
  documentType: "Sales Invoice",
  documentId: "invoice-1",
  journalId: "jrn-post",
  createdAt: "2026-10-01T10:00:00.000+00:00",
  componentName,
  taxPercent: 0.2,
  documentTaxableAmount: 100,
  documentTaxAmount: 20
});

const taxRows: Rows = {
  taxCode: [taxCodeRow("company-1", true, "VAT")],
  taxRegistration: [registrationRow("company-1", "GB123456789")],
  taxLedger: [ledgerRow("company-1", "VAT (posted)")]
};

// Company 1 has no registration, no posted rows and no active code; company 2
// has all three, on the same ids.
const otherCompanyRows: Rows = {
  taxCode: [
    taxCodeRow("company-1", false, "VAT"),
    taxCodeRow("company-2", true, "LEAK")
  ],
  taxRegistration: [registrationRow("company-2", "LEAK-REG")],
  taxLedger: [ledgerRow("company-2", "LEAK (posted)")]
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

  it("reads only the company's rows from every tax table", async () => {
    const summary = await load(
      "Submitted",
      fakeClient(otherCompanyRows).client
    );
    expect(JSON.stringify(summary)).not.toContain("LEAK");
    expect(summary.taxSummary?.[0]?.name).toBe("VAT");
    expect(summary.invoiceMessages).toEqual([]);
    expect(summary.sellerRegistration).toBeNull();
  });
});
