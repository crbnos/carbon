// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { JournalEntrySyncError } from "./posting";
import { resolveProviderTaxRate } from "./provider-tax";
import {
  buildTaxCodeMappingLookup,
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
