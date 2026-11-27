// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it, vi } from "vitest";
import {
  buildTaxCodeMappingLookup,
  NO_TAX_CODE_MAPPING_ID
} from "../../core/tax-mapping";
import type { Xero } from "./models";
import { toXeroTaxRateOptions } from "./provider";
import {
  resolveXeroTaxType,
  XERO_NO_TAX,
  type XeroTaxContext,
  XeroTaxContextLoader
} from "./tax";

const RATES: Xero.TaxRate[] = [
  {
    TaxType: "OUTPUT2",
    Name: "20% (VAT on Income)",
    EffectiveRate: 20,
    ReportTaxType: "OUTPUT",
    CanApplyToRevenue: true,
    CanApplyToExpenses: false
  },
  {
    TaxType: "INPUT2",
    Name: "20% (VAT on Expenses)",
    EffectiveRate: 20,
    ReportTaxType: "INPUT",
    CanApplyToRevenue: false,
    CanApplyToExpenses: true,
    CanApplyToLiabilities: false
  },
  {
    TaxType: "ZERORATEDOUTPUT",
    Name: "Zero Rated Income",
    EffectiveRate: 0,
    CanApplyToRevenue: true,
    CanApplyToExpenses: false
  },
  { TaxType: "NONE", Name: "No VAT", EffectiveRate: 0 }
];

const context = (overrides: Partial<XeroTaxContext> = {}): XeroTaxContext => ({
  catalogLoaded: true,
  reverseChargeCodeIds: new Set(["ecrc"]),
  noTaxCodeFallback: new Set(["sales"]),
  mappings: buildTaxCodeMappingLookup([
    {
      taxCodeId: "uk20",
      direction: "purchase",
      externalId: "INPUT2",
      externalName: "20% (VAT on Expenses)",
      externalRate: 0.2
    },
    {
      taxCodeId: NO_TAX_CODE_MAPPING_ID,
      direction: "sales",
      externalId: "ZERORATEDOUTPUT",
      externalName: "Zero Rated Income",
      externalRate: 0
    }
  ]),
  options: toXeroTaxRateOptions(RATES),
  accountClassByCode: new Map([
    ["2125", "liability"],
    ["5000", "expense"]
  ]),
  ...overrides
});

const line = {
  documentId: "doc_1",
  direction: "purchase" as const,
  taxCodeId: "uk20" as string | null,
  taxPercent: 0.2,
  netAmount: 100,
  taxAmount: 20,
  decimalPlaces: 2
};

describe("resolveXeroTaxType", () => {
  it("sends a Reverse Charge purchase line at NONE without a mapping", () => {
    expect(
      resolveXeroTaxType({
        ...line,
        context: context(),
        taxCodeId: "ecrc",
        taxPercent: 0,
        taxAmount: 0
      })
    ).toBe(XERO_NO_TAX);
  });

  it("sends an exempt sales line at the fallback rate in a company that uses codes", () => {
    expect(
      resolveXeroTaxType({
        ...line,
        context: context(),
        direction: "sales",
        taxCodeId: null,
        taxPercent: 0,
        taxAmount: 0
      })
    ).toBe("ZERORATEDOUTPUT");
  });

  it("keeps NONE for an untaxed line where the direction has no fallback", () => {
    expect(
      resolveXeroTaxType({
        ...line,
        context: context({ noTaxCodeFallback: new Set() }),
        direction: "sales",
        taxCodeId: null,
        taxPercent: 0,
        taxAmount: 0
      })
    ).toBe(XERO_NO_TAX);
  });

  it("refuses a rate Xero cannot apply to the line's account class", () => {
    expect(() =>
      resolveXeroTaxType({ ...line, context: context(), accountCode: "2125" })
    ).toThrow(
      expect.objectContaining({
        failure: expect.objectContaining({
          errorCode: "UNMAPPED_TAX_CODES",
          warning: true
        })
      })
    );
    expect(
      resolveXeroTaxType({ ...line, context: context(), accountCode: "5000" })
    ).toBe("INPUT2");
  });
});

describe("XeroTaxContextLoader", () => {
  const db = (
    codes: Array<Record<string, unknown>>,
    mappings: Array<Record<string, unknown>> = []
  ) =>
    ({
      selectFrom: (table: string) => {
        const builder: Record<string, unknown> = {
          select: () => builder,
          where: () => builder,
          execute: async () =>
            table === "taxCode"
              ? codes
              : table === "externalIntegrationMapping"
                ? mappings
                : []
        };
        return builder;
      }
    }) as never;
  const salesFallback = {
    entityId: `${NO_TAX_CODE_MAPPING_ID}:sales`,
    externalId: "ZERORATEDOUTPUT",
    metadata: { externalName: "Zero Rated Income", externalRate: 0 }
  };
  const salesCode = {
    id: "uk20",
    name: "UK 20%",
    active: true,
    calculationType: "Normal",
    usedForSales: true,
    usedForPurchase: false
  };
  const provider = () => ({
    listTaxRates: vi.fn(async () => RATES),
    listChartOfAccounts: vi.fn(async () => [])
  });
  const args = { companyId: "c1", integration: "xero" };
  const untaxed = { taxCodeId: null, taxPercent: 0, taxAmount: 0 };

  it("reads no catalog for untaxed lines in a company with no codes", async () => {
    const reads = provider();
    const loader = new XeroTaxContextLoader(db([]), args, reads);
    const loaded = await loader.forLines("sales", [untaxed]);
    expect(loaded.catalogLoaded).toBe(false);
    expect(reads.listTaxRates).not.toHaveBeenCalled();
  });

  it("reads the catalog for untaxed lines once the direction uses codes and maps the fallback", async () => {
    const reads = provider();
    const loader = new XeroTaxContextLoader(
      db([salesCode], [salesFallback]),
      args,
      reads
    );
    const loaded = await loader.forLines("sales", [untaxed]);
    expect(loaded.catalogLoaded).toBe(true);
    expect(loaded.noTaxCodeFallback).toEqual(new Set(["sales"]));
    expect(
      resolveXeroTaxType({
        ...line,
        ...untaxed,
        context: loaded,
        direction: "sales"
      })
    ).toBe("ZERORATEDOUTPUT");
    expect((await loader.forLines("purchase", [untaxed])).catalogLoaded).toBe(
      false
    );
  });

  it("sends untaxed lines at NONE, never parks, while the fallback is unmapped", async () => {
    const reads = provider();
    const loader = new XeroTaxContextLoader(db([salesCode]), args, reads);
    const loaded = await loader.forLines("sales", [untaxed]);
    expect(loaded.catalogLoaded).toBe(false);
    expect(loaded.noTaxCodeFallback).toEqual(new Set());
    expect(
      resolveXeroTaxType({
        ...line,
        ...untaxed,
        context: loaded,
        direction: "sales"
      })
    ).toBe(XERO_NO_TAX);
    expect(reads.listTaxRates).not.toHaveBeenCalled();
  });

  it("needs no catalog for a Reverse Charge purchase line", async () => {
    const reads = provider();
    const loader = new XeroTaxContextLoader(
      db([
        {
          id: "ecrc",
          name: "EC Reverse Charge",
          active: true,
          calculationType: "Reverse Charge",
          usedForSales: false,
          usedForPurchase: true
        }
      ]),
      args,
      reads
    );
    const loaded = await loader.forLines("purchase", [
      { taxCodeId: "ecrc", taxPercent: 0, taxAmount: 0 }
    ]);
    expect(loaded.catalogLoaded).toBe(false);
    expect(loaded.reverseChargeCodeIds).toEqual(new Set(["ecrc"]));
  });
});
