import { describe, expect, it } from "vitest";
import {
  buildTaxSummary,
  getInvoiceMessages,
  lineTaxSummaryEntries,
  postedTaxSummaryEntries,
  resolveSellerRegistration,
  type TaxLedgerSummaryRow,
  type TaxSummaryCode
} from "./tax-summary";

const component = (
  id: string,
  name: string,
  taxPercent: number,
  extra: Partial<TaxSummaryCode["components"][number]> = {}
): TaxSummaryCode["components"][number] => ({
  id,
  name,
  taxAuthorityId: null,
  taxPercent,
  recoverablePercent: 0,
  sequence: 1,
  isCompound: false,
  taxReceivedAccountId: null,
  taxPaidAccountId: null,
  effectiveDate: null,
  expirationDate: null,
  ...extra
});

const row = (
  journalId: string,
  createdAt: string,
  componentName: string | null,
  taxPercent: number,
  documentTaxableAmount: number,
  documentTaxAmount: number
): TaxLedgerSummaryRow => ({
  journalId,
  createdAt,
  componentName,
  taxPercent,
  documentTaxableAmount,
  documentTaxAmount
});

describe("postedTaxSummaryEntries + buildTaxSummary", () => {
  // Two lines under GST 5% + PST 7%, then a void that negates them.
  const posting = "2026-10-01T10:00:00.000+00:00";
  const voided = "2026-10-05T10:00:00.000+00:00";
  const rows = [
    row("jrn-post", posting, "GST", 0.05, 1000, 50),
    row("jrn-post", posting, "PST", 0.07, 1000, 70),
    row("jrn-post", posting, "GST", 0.05, 200, 10),
    row("jrn-post", posting, "PST", 0.07, 200, 14),
    row("jrn-void", voided, "GST", 0.05, -1000, -50),
    row("jrn-void", voided, "PST", 0.07, -1000, -70),
    row("jrn-void", voided, "GST", 0.05, -200, -10),
    row("jrn-void", voided, "PST", 0.07, -200, -14)
  ];

  it("prints one row per component of the posting journal, ignoring the void", () => {
    const entries = postedTaxSummaryEntries(
      rows,
      new Set(["jrn-post", "jrn-void"])
    );
    expect(buildTaxSummary(entries!, 144, 2)).toEqual([
      { name: "GST", rate: 0.05, base: 1200, tax: 60 },
      { name: "PST", rate: 0.07, base: 1200, tax: 84 }
    ]);
  });

  it("falls back to the lines when the posting journal is not Posted", () => {
    expect(postedTaxSummaryEntries(rows, new Set(["jrn-void"]))).toBeNull();
    expect(postedTaxSummaryEntries([], new Set(["jrn-post"]))).toBeNull();
  });

  it("keeps one entry for one component, so the block prints its single row", () => {
    const summary = buildTaxSummary(
      [
        { name: "VAT", rate: 0.2, base: 100, tax: 20 },
        { name: "VAT", rate: 0.2, base: 50, tax: 10 }
      ],
      30,
      2
    );
    expect(summary).toEqual([{ name: "VAT", rate: 0.2, base: 150, tax: 30 }]);
  });

  it("has no summary when no tax came from a code", () => {
    expect(
      buildTaxSummary(
        [
          { name: null, rate: 0.05, base: 100, tax: 5 },
          { name: null, rate: 0.08, base: 100, tax: 8 }
        ],
        13,
        2
      )
    ).toEqual([]);
  });

  it("drops exempt rows and makes the rows add up to the printed tax", () => {
    const summary = buildTaxSummary(
      [
        { name: "A", rate: 0.1, base: 333.33, tax: 33.333 },
        { name: "B", rate: 0.1001, base: 333.33, tax: 33.333 },
        { name: "C", rate: 0.1002, base: 333.33, tax: 33.333 },
        { name: null, rate: 0, base: 50, tax: 0 }
      ],
      100,
      2
    );
    expect(summary.map((entry) => entry.name)).toEqual(["A", "B", "C"]);
    expect(summary.reduce((sum, entry) => sum + entry.tax, 0)).toBeCloseTo(
      100,
      10
    );
  });
});

describe("lineTaxSummaryEntries", () => {
  const codes = new Map<string, TaxSummaryCode>([
    [
      "txc-ca-bc",
      {
        id: "txc-ca-bc",
        calculationType: "Normal",
        taxesShipping: false,
        invoiceMessage: null,
        components: [
          component("gst", "GST", 0.05),
          component("pst", "PST", 0.07, { sequence: 2 }),
          component("old", "Old levy", 0.01, { expirationDate: "2026-01-01" })
        ]
      }
    ]
  ]);

  it("splits each line's tax across the components in force on the date", () => {
    const entries = lineTaxSummaryEntries(
      [
        { taxCodeId: "txc-ca-bc", taxPercent: 0.12, base: 1000 },
        { taxCodeId: null, taxPercent: 0.1, base: 100 }
      ],
      codes,
      "2026-10-17"
    );
    expect(entries).toEqual([
      { name: "GST", rate: 0.05, base: 1000, tax: 50 },
      { name: "PST", rate: 0.07, base: 1000, tax: 70 },
      { name: null, rate: 0.1, base: 100, tax: 10 }
    ]);
  });
});

describe("getInvoiceMessages", () => {
  it("returns each code's clause once, in line order", () => {
    const codes = new Map<string, TaxSummaryCode>([
      [
        "rc",
        {
          id: "rc",
          calculationType: "Reverse Charge",
          taxesShipping: false,
          invoiceMessage: " Reverse charge: customer to account for VAT. ",
          components: []
        }
      ],
      [
        "std",
        {
          id: "std",
          calculationType: "Normal",
          taxesShipping: false,
          invoiceMessage: null,
          components: []
        }
      ]
    ]);
    expect(getInvoiceMessages(["rc", "std", null, "rc"], codes)).toEqual([
      "Reverse charge: customer to account for VAT."
    ]);
  });
});

describe("resolveSellerRegistration", () => {
  const company = { countryCode: "GB", stateProvince: null, taxId: "TAX-1" };

  it("prints the registration for the company's country in force on the date", () => {
    expect(
      resolveSellerRegistration(
        [
          {
            countryCode: "DE",
            state: null,
            registrationNumber: "DE123",
            effectiveDate: null,
            endDate: null
          },
          {
            countryCode: "GB",
            state: null,
            registrationNumber: "GB-OLD",
            effectiveDate: null,
            endDate: "2025-12-31"
          },
          {
            countryCode: "GB",
            state: null,
            registrationNumber: "GB123456789",
            effectiveDate: "2026-01-01",
            endDate: null
          }
        ],
        company,
        "2026-10-17"
      )
    ).toBe("GB123456789");
  });

  it("falls back to the company's tax ID", () => {
    expect(resolveSellerRegistration([], company, "2026-10-17")).toBe("TAX-1");
    expect(
      resolveSellerRegistration(null, { ...company, taxId: null }, "2026-10-17")
    ).toBeNull();
  });
});
