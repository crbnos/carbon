// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { JournalEntrySyncError } from "./posting";
import { resolveProviderTaxRate, sendsProviderNoTax } from "./provider-tax";
import {
  buildTaxCodeMappingLookup,
  NO_TAX_CODE_MAPPING_ID,
  type TaxCodeMapping,
  type TaxRateOption
} from "./tax-mapping";

const options: TaxRateOption[] = [
  { id: "OUTPUT2", name: "20% (VAT on Income)", rate: 0.2, direction: "sales" },
  {
    id: "RROUTPUT",
    name: "5% (VAT on Income)",
    rate: 0.05,
    direction: "sales"
  },
  {
    id: "INPUT2",
    name: "20% (VAT on Expenses)",
    rate: 0.2,
    direction: "purchase"
  },
  { id: "NONE", name: "No VAT", rate: 0, direction: "sales" },
  {
    id: "ZERORATEDOUTPUT",
    name: "Zero Rated Income",
    rate: 0,
    direction: "sales"
  }
];

const mapping = (overrides: Partial<TaxCodeMapping> = {}): TaxCodeMapping => ({
  taxCodeId: "uk20",
  direction: "sales",
  externalId: "OUTPUT2",
  externalName: "20% (VAT on Income)",
  externalRate: 0.2,
  ...overrides
});

const line = {
  documentId: "inv",
  direction: "sales" as const,
  taxCodeId: "uk20" as string | null,
  taxPercent: 0.2,
  netAmount: 100,
  taxAmount: 20,
  decimalPlaces: 2,
  mappings: buildTaxCodeMappingLookup([mapping()]),
  options
};

function warning(run: () => unknown) {
  try {
    run();
  } catch (err) {
    expect(err).toBeInstanceOf(JournalEntrySyncError);
    return (err as JournalEntrySyncError).failure;
  }
  throw new Error("expected a warning");
}

describe("resolveProviderTaxRate", () => {
  it("uses the code's mapping for the direction", () => {
    expect(resolveProviderTaxRate(line)).toMatchObject({
      externalId: "OUTPUT2"
    });
  });

  it("refuses a code with no mapping for the direction", () => {
    const failure = warning(() =>
      resolveProviderTaxRate({ ...line, direction: "purchase" })
    );
    expect(failure).toMatchObject({
      errorCode: "UNMAPPED_TAX_CODES",
      warning: true
    });
    expect(failure.message).toContain("uk20");
  });

  it("matches a legacy line's percentage to one rate", () => {
    expect(
      resolveProviderTaxRate({
        ...line,
        taxCodeId: null,
        taxPercent: 0.05,
        taxAmount: 5
      })
    ).toMatchObject({ externalId: "RROUTPUT" });
  });

  it("sends an untaxed legacy line at NONE", () => {
    expect(
      resolveProviderTaxRate({
        ...line,
        taxCodeId: null,
        taxPercent: 0,
        taxAmount: 0
      })
    ).toMatchObject({ externalId: "NONE" });
  });

  it("refuses a legacy percentage no rate matches", () => {
    const failure = warning(() =>
      resolveProviderTaxRate({
        ...line,
        taxCodeId: null,
        taxPercent: 0.0825,
        taxAmount: 8.25
      })
    );
    expect(failure.message).toContain("8.25%");
  });

  it("refuses a code mapped to a rate with a different percentage", () => {
    const failure = warning(() =>
      resolveProviderTaxRate({
        ...line,
        mappings: buildTaxCodeMappingLookup([
          mapping({
            externalId: "RROUTPUT",
            externalName: "5% (VAT on Income)",
            externalRate: 0.05
          })
        ])
      })
    );
    expect(failure.message).toContain("5% (VAT on Income)");
  });

  it("accepts a tax amount one minor unit off", () => {
    expect(
      resolveProviderTaxRate({ ...line, netAmount: 33.33, taxAmount: 6.67 })
    ).toMatchObject({ externalId: "OUTPUT2" });
  });
});

describe("resolveProviderTaxRate (review fixes)", () => {
  it("refuses a mapping to a rate the provider no longer offers (archived)", () => {
    const failure = warning(() =>
      resolveProviderTaxRate({
        ...line,
        mappings: buildTaxCodeMappingLookup([
          mapping({ externalId: "TAX001", externalName: "Old 20%" })
        ])
      })
    );
    expect(failure).toMatchObject({ errorCode: "UNMAPPED_TAX_CODES" });
    expect(failure.message).toContain("Old 20%");
    expect(failure.message).toContain("re-map");
  });

  it("prefers the standard rate over a capital-goods rate at the same percent", () => {
    const withCapital: TaxRateOption[] = [
      ...options,
      {
        id: "CAPEXOUTPUT2",
        name: "20% (VAT on Capital Sales)",
        rate: 0.2,
        direction: "sales",
        reportTaxType: "CAPEXOUTPUT"
      }
    ];
    expect(
      resolveProviderTaxRate({ ...line, taxCodeId: null, options: withCapital })
    ).toMatchObject({ externalId: "OUTPUT2" });
  });

  it("breaks a tie by the standard ReportTaxType, else refuses", () => {
    const purchase: TaxRateOption[] = [
      {
        id: "INPUT2",
        name: "20% (VAT on Expenses)",
        rate: 0.2,
        direction: "purchase",
        reportTaxType: "INPUT"
      },
      {
        id: "DRCHARGE20",
        name: "20% Domestic Reverse Charge",
        rate: 0.2,
        direction: "purchase",
        reportTaxType: "DRCHARGE"
      }
    ];
    const legacy = {
      ...line,
      direction: "purchase" as const,
      taxCodeId: null
    };
    expect(
      resolveProviderTaxRate({ ...legacy, options: purchase })
    ).toMatchObject({ externalId: "INPUT2" });
    expect(
      warning(() =>
        resolveProviderTaxRate({
          ...legacy,
          options: purchase.map((o) => ({ ...o, reportTaxType: null }))
        })
      ).message
    ).toContain("2 purchase tax rates match 20%");
  });

  it("sends an untaxed code-less line at the fallback mapping when asked", () => {
    const untaxed = {
      ...line,
      taxCodeId: null,
      taxPercent: 0,
      taxAmount: 0,
      noTaxCodeFallback: true
    };
    expect(
      resolveProviderTaxRate({
        ...untaxed,
        mappings: buildTaxCodeMappingLookup([
          mapping({
            taxCodeId: NO_TAX_CODE_MAPPING_ID,
            externalId: "ZERORATEDOUTPUT",
            externalName: "Zero Rated Income"
          })
        ])
      })
    ).toMatchObject({ externalId: "ZERORATEDOUTPUT" });
    expect(warning(() => resolveProviderTaxRate(untaxed)).message).toContain(
      "lines with no tax code (exempt or non-taxable) has no sales tax rate mapping"
    );
  });

  it("refuses a rate that cannot apply to the line's account class", () => {
    const failure = warning(() =>
      resolveProviderTaxRate({
        ...line,
        options: options.map((o) =>
          o.id === "OUTPUT2" ? { ...o, canApplyTo: { liability: false } } : o
        ),
        account: { code: "2125", class: "liability" }
      })
    );
    expect(failure.message).toContain(
      "cannot be used on liability account 2125"
    );
    expect(failure.metadata).toMatchObject({ accountClass: "liability" });
  });
});

describe("sendsProviderNoTax", () => {
  const facts = {
    reverseChargeCodeIds: new Set(["rc"]),
    noTaxCodeFallback: new Set<"sales" | "purchase">(["sales"])
  };
  const untaxed = { taxCodeId: null, taxPercent: 0, taxAmount: 0 };

  it("sends a Reverse Charge purchase line tax-neutral, but not a sale", () => {
    const rc = { taxCodeId: "rc", taxPercent: 0, taxAmount: 0 };
    expect(sendsProviderNoTax(rc, "purchase", facts)).toBe(true);
    expect(sendsProviderNoTax(rc, "sales", facts)).toBe(false);
  });

  it("sends an untaxed line at no tax only where the direction has no fallback", () => {
    expect(sendsProviderNoTax(untaxed, "purchase", facts)).toBe(true);
    expect(sendsProviderNoTax(untaxed, "sales", facts)).toBe(false);
    expect(sendsProviderNoTax(untaxed, "sales", null)).toBe(true);
  });
});
