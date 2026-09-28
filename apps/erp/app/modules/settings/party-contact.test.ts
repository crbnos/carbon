import { describe, expect, it } from "vitest";
import {
  hasEmailableContact,
  hasUsableLocation,
  isEmailableContact,
  isUsableLocationAddress,
  PARTY_CONTACT_SETTING,
  partyContactRequiredMessage,
  requiredContactField,
  STATE_REQUIRED_COUNTRIES
} from "./party-contact";

/**
 * Every bar below is what a spend-vendor create actually enforces, verified
 * field-by-field against the Ramp sandbox on 2026-09-28. A gate that is LOOSER
 * than the platform lets the document post and fail downstream, which is worse
 * than no gate; a gate that is STRICTER blocks work for no reason.
 */
describe("isEmailableContact", () => {
  it("accepts a contact with an email", () => {
    expect(isEmailableContact({ email: "aosei@dsrf.com" })).toBe(true);
  });

  it("rejects a blank-but-present email", () => {
    // `{"business_vendor_contacts": {"email": ["Missing data for required
    // field."]}}` — a phone-only contact satisfies nothing, and an empty string
    // in the column is common enough that it would otherwise pass.
    for (const email of ["", "   ", null, undefined]) {
      expect(isEmailableContact({ email })).toBe(false);
    }
  });
});

describe("hasEmailableContact", () => {
  it("is satisfied by one reachable contact among several", () => {
    expect(
      hasEmailableContact([
        { email: null },
        { email: "  " },
        { email: "ops@dsrf.com" }
      ])
    ).toBe(true);
  });

  it("refuses an empty list and a list of unreachable contacts", () => {
    expect(hasEmailableContact([])).toBe(false);
    expect(hasEmailableContact([{ email: null }, { email: "" }])).toBe(false);
  });
});

describe("isUsableLocationAddress", () => {
  /**
   * `{"country": ["Missing data for required field."]}` with no country, and
   * `400 DEVELOPER_7080 "State is required for US"` for a US address with no
   * state. A GB address with no state was accepted (200), so the state rule is
   * genuinely per-country rather than general address hygiene.
   */
  it("accepts a non-US address with just a country", () => {
    expect(isUsableLocationAddress({ country: "GB" })).toBe(true);
    expect(
      isUsableLocationAddress({ country: "DE", stateProvince: null })
    ).toBe(true);
  });

  it("refuses an address with no country", () => {
    for (const country of ["", "   ", null, undefined]) {
      expect(isUsableLocationAddress({ country })).toBe(false);
    }
  });

  it("refuses a US address with no state, and accepts one with a state", () => {
    expect(isUsableLocationAddress({ country: "US" })).toBe(false);
    expect(
      isUsableLocationAddress({ country: "US", stateProvince: "   " })
    ).toBe(false);
    expect(
      isUsableLocationAddress({ country: "US", stateProvince: "VA" })
    ).toBe(true);
  });

  it("applies the US state rule whatever the casing or alpha-3 form", () => {
    // Carbon stores `address.countryCode` as free text; "us" and "USA" are the
    // same country to Ramp and must not slip past the state rule.
    expect(isUsableLocationAddress({ country: "us" })).toBe(false);
    expect(isUsableLocationAddress({ country: "USA" })).toBe(false);
    expect(STATE_REQUIRED_COUNTRIES.has("US")).toBe(true);
  });
});

describe("hasUsableLocation", () => {
  it("is satisfied by one usable location among several", () => {
    // A party often has a billing address with no country and a real ship-from
    // with one. Any single usable location is enough — the push picks it.
    expect(
      hasUsableLocation([
        { country: null },
        { country: "US" }, // US with no state — not usable
        { country: "US", stateProvince: "CA" }
      ])
    ).toBe(true);
  });

  it("refuses no locations at all, which is the common failure", () => {
    // McMaster-Carr had zero contacts AND zero locations; both halves of the
    // push error were real.
    expect(hasUsableLocation([])).toBe(false);
    expect(hasUsableLocation([{ country: null }, { country: "US" }])).toBe(
      false
    );
  });
});

describe("PARTY_CONTACT_SETTING", () => {
  it("maps each party kind to its own company setting", () => {
    // These are column names in a live query — a typo is a runtime failure the
    // type system cannot see. The two are independent on purpose: the
    // purchasing side has a platform requirement behind it, the sales side
    // ships off and has none yet.
    expect(PARTY_CONTACT_SETTING.supplier).toBe(
      "requireSupplierContactAndLocation"
    );
    expect(PARTY_CONTACT_SETTING.customer).toBe(
      "requireCustomerContactAndLocation"
    );
  });
});

describe("partyContactRequiredMessage", () => {
  it("names only the fact that is actually missing", () => {
    const contactOnly = partyContactRequiredMessage(
      "supplier",
      "Deep Space RF",
      {
        contact: true,
        location: false
      }
    );
    expect(contactOnly).toContain("Deep Space RF");
    expect(contactOnly).toContain("email");
    expect(contactOnly).not.toContain("country");
    expect(contactOnly).toContain("Contacts");

    const locationOnly = partyContactRequiredMessage("supplier", "Acme", {
      contact: false,
      location: true
    });
    expect(locationOnly).toContain("country");
    expect(locationOnly).not.toContain("email");
    expect(locationOnly).toContain("Locations");
  });

  it("names both when both are missing, which is the common case", () => {
    // A supplier somebody created from just a name has neither.
    const message = partyContactRequiredMessage("supplier", "McMaster-Carr", {
      contact: true,
      location: true
    });

    expect(message).toContain("email");
    expect(message).toContain("country");
    expect(message).toContain("Contacts and Locations");
  });

  it("mentions the US state rule, since that is the non-obvious half", () => {
    expect(
      partyContactRequiredMessage("supplier", "Acme", {
        contact: false,
        location: true
      })
    ).toContain("state");
  });

  it("stays readable when the party has no name", () => {
    expect(
      partyContactRequiredMessage("customer", null, {
        contact: true,
        location: false
      })
    ).toContain("This customer");
    expect(
      partyContactRequiredMessage("supplier", "   ", {
        contact: true,
        location: false
      })
    ).toContain("This supplier");
  });

  it("says the requirement came from settings, not from nowhere", () => {
    // Without this the message reads as a hard product rule, and the person
    // hitting it has no idea it is a company setting somebody turned on.
    expect(
      partyContactRequiredMessage("supplier", "Acme", {
        contact: true,
        location: true
      })
    ).toContain("settings");
  });
});

describe("requiredContactField", () => {
  /**
   * One phrasing for all six documents, and the reason it is a helper rather
   * than five copies: the message a user sees for a missing purchase-order
   * contact and a missing sales-invoice contact should not drift apart.
   */
  it("rejects absent and empty values with a named message", () => {
    const schema = requiredContactField("Supplier contact");

    for (const value of [undefined, "", "   "]) {
      const result = schema.safeParse(value);
      expect(result.success).toBe(false);
      expect(JSON.stringify(result.error?.issues)).toContain(
        "Supplier contact is required"
      );
    }
  });

  it("accepts a real id", () => {
    expect(
      requiredContactField("Customer contact").safeParse("cnt_1").success
    ).toBe(true);
  });
});
