// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import {
  buildTaxCodeMappingEntityId,
  matchTaxCodesByRate,
  parseTaxCodeMappingEntityId
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
});
