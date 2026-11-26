// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  chargedTaxPercent,
  type TaxCodeInput,
  type TaxComponentInput
} from "@carbon/utils";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  overlappingComponentIndex,
  taxCodeFields,
  taxCodeValidator,
  taxRegistrationInput
} from "./accounting.models";
import {
  applyLineTaxDecision,
  chargedRateOr,
  decideLineTax,
  decidePurchaseTaxAmount,
  decideWrittenLineTax,
  documentLineTax,
  itemTaxDecision,
  lineTaxForUpsert,
  newPurchaseLineTax,
  taxCodeRate,
  taxCodeRetireRefusal,
  updatedTaxCodeId
} from "./accounting.utils";

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

  it("stores the summed rate at internal scale, without float noise", () => {
    const code: TaxCodeInput = {
      ...austin,
      components: [
        component({ id: "a", taxPercent: 0.1 }),
        component({ id: "b", taxPercent: 0.05 })
      ]
    };
    expect(decideLineTax({ ...facts, partyTaxCode: code }).taxPercent).toBe(
      0.15
    );
    expect(taxCodeRate(code, facts.date)).toBe(0.15);
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

describe("a Reverse Charge code", () => {
  const useTax: TaxCodeInput = { ...dallas, calculationType: "Reverse Charge" };

  it("is charged at 0, on a purchase and on a sale, and keeps its code and components", () => {
    for (const source of ["purchase", "sales"] as const) {
      const decision = decideLineTax({
        ...facts,
        source,
        partyTaxCode: useTax
      });
      expect(decision).toMatchObject({
        taxCodeId: "dallas",
        taxPercent: 0,
        exempt: false
      });
      expect(decision.components).toHaveLength(1);
    }
  });

  it("charges 0 where a Normal code charges its summed rate", () => {
    expect(chargedTaxPercent(useTax, facts.date)).toBe(0);
    expect(chargedTaxPercent(austin, facts.date)).toBe(0.0825);
    // The self-assessed rate is still the code's own.
    expect(taxCodeRate(useTax, facts.date)).toBe(0.0825);
  });
});

describe("tax code validation", () => {
  const vat = (effectiveDate?: string, expirationDate?: string) => ({
    name: "VAT",
    taxAuthorityId: "auth-1",
    taxPercent: 0.2,
    recoverablePercent: 1,
    sequence: 1,
    isCompound: false,
    effectiveDate,
    expirationDate
  });
  const code = (components: ReturnType<typeof vat>[]) => ({
    name: "Standard",
    calculationType: "Normal" as const,
    reportingCategory: "Standard" as const,
    taxesShipping: true,
    active: true,
    components
  });
  const serverInput = z.object(taxCodeFields);
  // The same code as the form posts it: strings, and checkboxes "on" or absent.
  const formCode = (components: ReturnType<typeof vat>[]) => ({
    ...code(components),
    taxesShipping: "on",
    active: "on",
    components: components.map(({ isCompound: _, ...c }) => ({
      ...c,
      taxPercent: String(c.taxPercent),
      recoverablePercent: String(c.recoverablePercent),
      sequence: String(c.sequence)
    }))
  });

  it("refuses a rate change whose old component expires on the new one's first day", () => {
    const components = [
      vat(undefined, "2027-01-01"),
      { ...vat("2027-01-01"), taxPercent: 0.21 }
    ];
    expect(overlappingComponentIndex(components)).toBe(1);
    const result = serverInput.safeParse(code(components));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["components", 1, "name"]);
    expect(taxCodeValidator.safeParse(formCode(components)).success).toBe(
      false
    );
  });

  it("accepts the old component expiring the day before", () => {
    const components = [
      vat(undefined, "2026-12-31"),
      { ...vat("2027-01-01"), taxPercent: 0.21 }
    ];
    expect(overlappingComponentIndex(components)).toBe(-1);
    expect(serverInput.safeParse(code(components)).success).toBe(true);
    expect(taxCodeValidator.safeParse(formCode(components)).success).toBe(true);
  });

  it("lets components of another name or authority overlap", () => {
    expect(
      overlappingComponentIndex([
        vat(),
        { ...vat(), name: "City" },
        { ...vat(), taxAuthorityId: "auth-2" }
      ])
    ).toBe(-1);
  });

  it("refuses an expiry before the effective date, on the server and the form", () => {
    const components = [vat("2027-01-02", "2027-01-01")];
    expect(serverInput.safeParse(code(components)).success).toBe(false);
    expect(taxCodeValidator.safeParse(formCode(components)).success).toBe(
      false
    );
    expect(
      taxRegistrationInput.safeParse({
        countryCode: "GB",
        registrationNumber: "GB1",
        effectiveDate: "2027-01-02",
        endDate: "2027-01-01"
      }).success
    ).toBe(false);
  });

  it("holds one bound for a rate on the server and the form", () => {
    const components = [{ ...vat(), taxPercent: 1.2 }];
    expect(serverInput.safeParse(code(components)).success).toBe(false);
    expect(taxCodeValidator.safeParse(formCode(components)).success).toBe(
      false
    );
  });
});

describe("applyLineTaxDecision", () => {
  const sent = { taxCodeId: null, taxPercent: 0.03 };

  it("takes a decision that names a code", () => {
    const decision = decideLineTax({ ...facts, partyTaxCode: austin });
    expect(applyLineTaxDecision(decision, sent)).toEqual({
      taxCodeId: "austin",
      taxPercent: 0.0825
    });
  });

  it("takes a decision that zeroes the line", () => {
    const decision = decideLineTax({ ...facts, itemTaxable: false });
    expect(applyLineTaxDecision(decision, sent)).toEqual({
      taxCodeId: null,
      taxPercent: 0
    });
  });

  it("keeps what was sent when the decision is only the party's bare percent", () => {
    expect(applyLineTaxDecision(decideLineTax(facts), sent)).toBe(sent);
  });
});

describe("decideWrittenLineTax", () => {
  const write = {
    source: "sales" as const,
    itemTaxable: true,
    sentTaxCodeId: undefined,
    sentTaxPercent: 0.03,
    sentCode: null,
    partyDecision: null,
    date: "2026-10-16"
  };

  it("zeroes a non-taxable item, whatever was sent", () => {
    expect(
      decideWrittenLineTax({
        ...write,
        itemTaxable: false,
        sentTaxCodeId: "austin",
        sentCode: austin
      }).data
    ).toEqual({ taxCodeId: null, taxPercent: 0 });
  });

  it("derives the rate from a sent code, never the sent percent", () => {
    expect(
      decideWrittenLineTax({
        ...write,
        sentTaxCodeId: "austin",
        sentCode: austin,
        sentTaxPercent: 0.05
      }).data
    ).toEqual({ taxCodeId: "austin", taxPercent: 0.0825 });
  });

  it("refuses a sent code it could not load", () => {
    expect(
      decideWrittenLineTax({ ...write, sentTaxCodeId: "foreign" }).error
    ).toBe("Tax code not found");
  });

  it("refuses a code with no component in force on the date", () => {
    const expired: TaxCodeInput = {
      ...dallas,
      components: [component({ expirationDate: "2026-01-31" })]
    };
    expect(
      decideWrittenLineTax({
        ...write,
        sentTaxCodeId: "dallas",
        sentCode: expired
      }).error
    ).toContain("no rate in force on 2026-10-16");
    expect(
      decideWrittenLineTax({
        ...write,
        partyDecision: decideLineTax({ ...facts, partyTaxCode: expired })
      }).error
    ).toContain("no rate in force");
  });

  it("keeps the sent percent with no code for a cleared code", () => {
    expect(
      decideWrittenLineTax({
        ...write,
        sentTaxCodeId: "",
        partyDecision: decideLineTax({ ...facts, partyTaxCode: austin })
      }).data
    ).toEqual({ taxCodeId: null, taxPercent: 0.03 });
  });

  it("gives a create that sends no code the party's decision", () => {
    expect(
      decideWrittenLineTax({
        ...write,
        partyDecision: decideLineTax({ ...facts, partyTaxCode: austin })
      }).data
    ).toEqual({ taxCodeId: "austin", taxPercent: 0.0825 });
  });

  it("leaves the stored code alone on an update that sends none", () => {
    expect(decideWrittenLineTax(write).data).toEqual({ taxPercent: 0.03 });
  });

  it("returns no tax keys for an update that sends neither a code nor a percent", () => {
    expect(
      decideWrittenLineTax({ ...write, sentTaxPercent: undefined }).data
    ).toStrictEqual({});
  });

  it("keeps the stored tax when an update re-sends a code with no rate in force unchanged", () => {
    const expired: TaxCodeInput = {
      ...dallas,
      components: [component({ expirationDate: "2026-01-31" })]
    };
    const update = {
      ...write,
      sentTaxCodeId: "dallas",
      sentCode: expired,
      stored: { taxCodeId: "dallas", taxPercent: 0.0825 }
    };
    expect(
      decideWrittenLineTax({ ...update, sentTaxPercent: 0.0825 })
    ).toStrictEqual({ data: {}, error: null });
    expect(
      decideWrittenLineTax({ ...update, sentTaxPercent: undefined })
    ).toStrictEqual({ data: {}, error: null });
    // A changed percent, or another code than the stored one, touches tax.
    expect(
      decideWrittenLineTax({ ...update, sentTaxPercent: 0.05 }).error
    ).toContain("no rate in force");
    expect(
      decideWrittenLineTax({
        ...update,
        stored: { taxCodeId: "austin", taxPercent: 0.0825 }
      }).error
    ).toContain("no rate in force");
  });
});

describe("documentLineTax", () => {
  it("takes the item's decision, else the document's, and refuses a code with no rate", () => {
    const document = decideLineTax({ ...facts, partyTaxCode: austin });
    const taxes = {
      document,
      byItem: new Map([["free", itemTaxDecision(document, false)]]),
      date: "2026-10-16"
    };
    expect(documentLineTax(taxes, "free").data).toEqual({
      taxCodeId: null,
      taxPercent: 0
    });
    expect(documentLineTax(taxes, "other").data).toEqual({
      taxCodeId: "austin",
      taxPercent: 0.0825
    });
    const expired = decideLineTax({
      ...facts,
      partyTaxCode: {
        ...dallas,
        components: [component({ expirationDate: "2026-01-31" })]
      }
    });
    expect(
      documentLineTax({ ...taxes, document: expired }, null).error
    ).toContain("no rate in force on 2026-10-16");
  });
});

describe("newPurchaseLineTax", () => {
  it("restates the supplier amount from the code's rate, and zeroes a non-taxable item", () => {
    const decision = decideLineTax({
      ...facts,
      source: "purchase",
      partyTaxCode: austin
    });
    const args = { date: "2026-10-16", base: 200, currencyDecimals: 2 };
    expect(
      newPurchaseLineTax(decision, { ...args, itemTaxable: true }).data
    ).toEqual({
      taxCodeId: "austin",
      taxPercent: 0.0825,
      supplierTaxAmount: 16.5
    });
    expect(
      newPurchaseLineTax(decision, { ...args, itemTaxable: false }).data
    ).toEqual({ taxCodeId: null, taxPercent: 0, supplierTaxAmount: 0 });
  });
});

describe("decidePurchaseTaxAmount", () => {
  const reverseCharge = { calculationType: "Reverse Charge" as const };
  const normal = { calculationType: "Normal" as const };
  const args = {
    itemTaxable: true,
    tax: { taxCodeId: "dallas", taxPercent: 0.0825 },
    code: normal,
    codeWasSent: true,
    sentTaxAmount: undefined,
    base: 200,
    currencyDecimals: 2
  };

  it("refuses a supplier tax amount on a Reverse Charge code", () => {
    const result = decidePurchaseTaxAmount({
      ...args,
      tax: { taxCodeId: "rc", taxPercent: 0 },
      code: reverseCharge,
      sentTaxAmount: 40
    });
    expect(result.error).toContain("Reverse Charge tax code");
    expect(result.error).toContain("Clear the line's tax amount");
  });

  it("stores 0 for a Reverse Charge code sent with no amount", () => {
    expect(
      decidePurchaseTaxAmount({
        ...args,
        tax: { taxPercent: 0.2 },
        code: reverseCharge
      }).data
    ).toBe(0);
  });

  it("restates the amount from a sent code's rate when none is sent", () => {
    expect(decidePurchaseTaxAmount(args).data).toBe(16.5);
  });

  it("keeps the supplier's charged amount sent with the code", () => {
    expect(
      decidePurchaseTaxAmount({ ...args, sentTaxAmount: 16.51 }).data
    ).toBe(16.51);
  });

  it("restates a party's code, whatever amount was sent", () => {
    expect(
      decidePurchaseTaxAmount({
        ...args,
        codeWasSent: false,
        sentTaxAmount: 3
      }).data
    ).toBe(16.5);
  });

  it("zeroes a non-taxable item", () => {
    expect(
      decidePurchaseTaxAmount({
        ...args,
        itemTaxable: false,
        sentTaxAmount: 3
      }).data
    ).toBe(0);
  });
});

describe("taxCodeRetireRefusal", () => {
  it("allows a code nothing names", () => {
    expect(
      taxCodeRetireRefusal({ customers: 0, suppliers: 0, locations: 0 })
    ).toBeNull();
  });

  it("lists every reference with its count", () => {
    expect(
      taxCodeRetireRefusal({ customers: 3, suppliers: 1, locations: 2 })
    ).toBe(
      "This tax code is still assigned to 3 customers, 1 supplier and 2 ship-to locations. Give them another code first, then retire it."
    );
    expect(
      taxCodeRetireRefusal({ customers: 0, suppliers: 0, locations: 1 })
    ).toContain("assigned to 1 ship-to location.");
  });
});

describe("chargedRateOr", () => {
  it("takes the code's rate on the invoice date, else the stored percent", () => {
    const changing: TaxCodeInput = {
      ...dallas,
      components: [
        component({ taxPercent: 0.2, expirationDate: "2026-12-31" }),
        component({ id: "c9", taxPercent: 0.225, effectiveDate: "2027-01-01" })
      ]
    };
    expect(chargedRateOr(changing, 0.2, "2027-01-05")).toBe(0.225);
    expect(chargedRateOr(undefined, "0.07", "2027-01-05")).toBe(0.07);
  });
});

describe("itemTaxDecision", () => {
  it("zeroes a non-taxable item's line, and keeps an exempt customer's", () => {
    const coded = decideLineTax({ ...facts, partyTaxCode: austin });
    expect(itemTaxDecision(coded, true)).toBe(coded);
    expect(itemTaxDecision(coded, false)).toMatchObject({
      taxCodeId: null,
      taxPercent: 0,
      exempt: true
    });
    const exempt = decideLineTax({
      ...facts,
      taxExempt: true,
      taxExemptionReason: "Resale"
    });
    expect(itemTaxDecision(exempt, false)).toBe(exempt);
  });
});

describe("update helpers", () => {
  it("reads a present but empty code as cleared and an absent one as not sent", () => {
    expect(updatedTaxCodeId({ taxCodeId: undefined })).toBe("");
    expect(updatedTaxCodeId({ taxCodeId: "austin" })).toBe("austin");
    expect(updatedTaxCodeId({})).toBeUndefined();
  });

  it("writes a cleared code as a present undefined key", () => {
    const write = lineTaxForUpsert({ taxCodeId: null, taxPercent: 0 });
    expect("taxCodeId" in write).toBe(true);
    expect(write.taxCodeId).toBeUndefined();
    expect("taxCodeId" in lineTaxForUpsert({ taxPercent: 0.1 })).toBe(false);
  });
});
