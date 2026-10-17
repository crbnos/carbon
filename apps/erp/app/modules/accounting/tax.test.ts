// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { TaxCodeInput, TaxComponentInput } from "@carbon/utils";
import { describe, expect, it } from "vitest";
import { decideLineTax, taxCodeRate } from "./accounting.utils";

function component(
  overrides: Partial<TaxComponentInput> = {}
): TaxComponentInput {
  return {
    id: "c1",
    name: "TX State",
    taxAuthorityId: null,
    taxPercent: 0.0625,
    recoverablePercent: 0,
    sequence: 1,
    isCompound: false,
    taxReceivedAccountId: null,
    taxPaidAccountId: null,
    effectiveDate: null,
    expirationDate: null,
    ...overrides
  };
}

const austin: TaxCodeInput = {
  id: "austin",
  calculationType: "Normal",
  taxesShipping: false,
  components: [
    component(),
    component({
      id: "c2",
      name: "City of Austin",
      taxPercent: 0.02,
      sequence: 2
    })
  ]
};

const dallas: TaxCodeInput = {
  id: "dallas",
  calculationType: "Normal",
  taxesShipping: false,
  components: [component({ id: "d1", taxPercent: 0.0825 })]
};

const facts = {
  source: "sales" as const,
  taxExempt: false,
  taxExemptionReason: null,
  itemTaxable: true,
  locationTaxCode: null,
  partyTaxCode: null,
  fallbackTaxPercent: 0.05,
  date: "2026-10-16"
};

describe("decideLineTax", () => {
  it("lets an exempt customer beat every code", () => {
    const decision = decideLineTax({
      ...facts,
      taxExempt: true,
      taxExemptionReason: "Resale",
      partyTaxCode: austin
    });
    expect(decision).toMatchObject({
      taxCodeId: null,
      taxPercent: 0,
      exempt: true,
      exemptionReason: "Resale"
    });
  });

  it("gives a non-taxable item zero tax with no reason", () => {
    const decision = decideLineTax({
      ...facts,
      itemTaxable: false,
      partyTaxCode: austin
    });
    expect(decision).toMatchObject({
      taxPercent: 0,
      exempt: true,
      exemptionReason: null
    });
  });

  it("prefers the ship-to location's code over the customer's", () => {
    const decision = decideLineTax({
      ...facts,
      locationTaxCode: dallas,
      partyTaxCode: austin
    });
    expect(decision.taxCodeId).toBe("dallas");
  });

  it("ignores a location code on a purchase", () => {
    const decision = decideLineTax({
      ...facts,
      source: "purchase",
      locationTaxCode: dallas,
      partyTaxCode: austin
    });
    expect(decision.taxCodeId).toBe("austin");
  });

  it("sums the code's components", () => {
    const decision = decideLineTax({ ...facts, partyTaxCode: austin });
    expect(decision.taxPercent).toBeCloseTo(0.0825, 10);
    expect(decision.components).toHaveLength(2);
  });

  it("falls back to the party's bare percent when there is no code", () => {
    const decision = decideLineTax(facts);
    expect(decision).toMatchObject({
      taxCodeId: null,
      taxPercent: 0.05,
      exempt: false
    });
  });

  it("leaves out an expired component", () => {
    const code: TaxCodeInput = {
      ...austin,
      components: [
        component({ expirationDate: "2026-06-30" }),
        component({ id: "new", taxPercent: 0.065, effectiveDate: "2026-07-01" })
      ]
    };
    const decision = decideLineTax({ ...facts, partyTaxCode: code });
    expect(decision.components.map((c) => c.id)).toEqual(["new"]);
    expect(taxCodeRate(code, "2026-06-30")).toBeCloseTo(0.0625, 10);
  });
});
