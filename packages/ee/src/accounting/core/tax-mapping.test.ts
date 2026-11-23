// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import {
  buildTaxCodeMappingEntityId,
  computeUnmappedTaxCodes,
  matchTaxCodesByRate,
  NO_TAX_CODE_MAPPING_ID,
  noTaxCodeFallbackDirections,
  parseTaxCodeMappingEntityId,
  type TaxCodeUsage,
  unmappedNoTaxCodeDirections
} from "./tax-mapping";

describe("tax-code mapping ids", () => {
  it("round-trips a code and direction", () => {
    const id = buildTaxCodeMappingEntityId("txc_123", "purchase");
    expect(parseTaxCodeMappingEntityId(id)).toEqual({
      taxCodeId: "txc_123",
      direction: "purchase"
    });
  });

  it("refuses an unknown direction", () => {
    expect(parseTaxCodeMappingEntityId("txc_123:both")).toBeNull();
    expect(parseTaxCodeMappingEntityId("txc_123")).toBeNull();
  });
});

describe("matchTaxCodesByRate", () => {
  const options = [
    {
      id: "OUTPUT2",
      name: "20% (VAT on Income)",
      rate: 0.2,
      direction: "sales" as const
    },
    {
      id: "INPUT2",
      name: "20% (VAT on Expenses)",
      rate: 0.2,
      direction: "purchase" as const
    },
    {
      id: "RROUTPUT",
      name: "5% (VAT on Income)",
      rate: 0.05,
      direction: "sales" as const
    },
    {
      id: "ZERORATEDOUTPUT",
      name: "Zero Rated Income",
      rate: 0,
      direction: "sales" as const
    },
    {
      id: "EXEMPTOUTPUT",
      name: "Exempt Income",
      rate: 0,
      direction: "sales" as const
    }
  ];

  it("proposes the one rate of each direction with the code's percentage", () => {
    const proposals = matchTaxCodesByRate({
      codes: [{ id: "uk20", rate: 0.2 }],
      options,
      mapped: new Set()
    });
    expect(proposals.map((p) => [p.direction, p.externalId])).toEqual([
      ["sales", "OUTPUT2"],
      ["purchase", "INPUT2"]
    ]);
  });

  it("proposes nothing when two rates share the percentage", () => {
    expect(
      matchTaxCodesByRate({
        codes: [{ id: "zero", rate: 0 }],
        options,
        mapped: new Set()
      }).filter((p) => p.direction === "sales")
    ).toEqual([]);
  });

  it("proposes nothing for a code with no component in force (it charges 0% today)", () => {
    const zeroRated = options.filter((o) => o.id !== "EXEMPTOUTPUT");
    const propose = (inForce: boolean) =>
      matchTaxCodesByRate({
        codes: [{ id: "future20", rate: 0, inForce }],
        options: zeroRated,
        mapped: new Set()
      }).map((p) => p.externalId);
    expect(propose(true)).toEqual(["ZERORATEDOUTPUT"]);
    expect(propose(false)).toEqual([]);
  });

  it("skips a direction that is already mapped", () => {
    const proposals = matchTaxCodesByRate({
      codes: [{ id: "uk20", rate: 0.2 }],
      options,
      mapped: new Set([buildTaxCodeMappingEntityId("uk20", "sales")])
    });
    expect(proposals.map((p) => p.direction)).toEqual(["purchase"]);
  });

  it("proposes nothing when no rate matches", () => {
    expect(
      matchTaxCodesByRate({
        codes: [{ id: "tx", rate: 0.0825 }],
        options,
        mapped: new Set()
      })
    ).toEqual([]);
  });

  it("matches a Reverse Charge code on its charged 0%, and never for purchases", () => {
    const proposals = matchTaxCodesByRate({
      codes: [{ id: "ecrc", rate: 0, reverseCharge: true }],
      options: [
        ...options.filter((o) => o.rate !== 0),
        {
          id: "ECZROUTPUT",
          name: "Zero Rated EC Goods Income",
          rate: 0,
          direction: "sales" as const
        },
        {
          id: "ZERORATEDINPUT",
          name: "Zero Rated Expenses",
          rate: 0,
          direction: "purchase" as const
        }
      ],
      mapped: new Set()
    });
    expect(proposals.map((p) => [p.direction, p.externalId])).toEqual([
      ["sales", "ECZROUTPUT"]
    ]);
  });
});

describe("computeUnmappedTaxCodes", () => {
  const usage = (overrides: Partial<TaxCodeUsage>): TaxCodeUsage => ({
    id: "uk20",
    name: "UK Standard 20%",
    active: true,
    reverseCharge: false,
    usedForSales: false,
    usedForPurchase: false,
    ...overrides
  });

  it("lists each used, unmapped direction, retired codes included", () => {
    expect(
      computeUnmappedTaxCodes({
        usage: [
          usage({ usedForSales: true, usedForPurchase: true }),
          usage({
            id: "old",
            name: "Old 17.5%",
            active: false,
            usedForSales: true
          }),
          usage({ id: "unused", name: "Unused" })
        ],
        mappings: [{ taxCodeId: "uk20", direction: "sales" }]
      })
    ).toEqual([
      { taxCodeId: "uk20", name: "UK Standard 20%", direction: "purchase" },
      { taxCodeId: "old", name: "Old 17.5%", direction: "sales" }
    ]);
  });

  it("needs no purchase mapping for a Reverse Charge code", () => {
    expect(
      computeUnmappedTaxCodes({
        usage: [
          usage({ id: "ecrc", reverseCharge: true, usedForPurchase: true })
        ],
        mappings: []
      })
    ).toEqual([]);
  });

  it("never requires the fallback row, mapped or not", () => {
    const used = [usage({ usedForSales: true })];
    const mappings = [{ taxCodeId: "uk20", direction: "sales" as const }];
    expect(computeUnmappedTaxCodes({ usage: used, mappings })).toEqual([]);
  });
});

describe("the no-tax-code fallback", () => {
  const used = [
    {
      id: "uk20",
      name: "UK Standard 20%",
      active: true,
      reverseCharge: false,
      usedForSales: true,
      usedForPurchase: false
    }
  ];
  const fallback = {
    taxCodeId: NO_TAX_CODE_MAPPING_ID,
    direction: "sales" as const
  };

  it("sends the fallback only where the direction uses codes and the row is mapped", () => {
    expect(noTaxCodeFallbackDirections(used, [fallback])).toEqual(
      new Set(["sales"])
    );
    expect(noTaxCodeFallbackDirections(used, [])).toEqual(new Set());
    expect(noTaxCodeFallbackDirections([], [fallback])).toEqual(new Set());
  });

  it("warns for a direction that uses codes with the row unmapped", () => {
    expect(unmappedNoTaxCodeDirections(used, [])).toEqual(["sales"]);
    expect(unmappedNoTaxCodeDirections(used, [fallback])).toEqual([]);
    expect(unmappedNoTaxCodeDirections([], [])).toEqual([]);
  });
});
