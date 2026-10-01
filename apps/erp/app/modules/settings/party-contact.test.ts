// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import * as partyContact from "./party-contact";
import {
  hasEmailableContact,
  hasUsableLocation,
  isEmailableContact,
  isUsableLocationAddress,
  missingPartyFacts,
  PARTY_CONTACT_SETTING,
  partyContactRequiredMessage,
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

describe("missingPartyFacts", () => {
  /**
   * The decision `checkPartyContactRequirement` makes, without its three
   * queries. Both halves below have been wrong in this file's history.
   */
  const reachable = [{ contact: { email: "aosei@dsrf.com" } }];
  const placeable = [{ address: { countryCode: "GB" } }];

  it("finds nothing missing for a complete party", () => {
    expect(
      missingPartyFacts({
        contacts: { rows: reachable, failed: false },
        locations: { rows: placeable, failed: false }
      })
    ).toEqual({ contact: false, location: false });
  });

  it("maps address.countryCode onto the address rule's `country`", () => {
    // The column is `countryCode`; the rule takes `country`. Miss the rename and
    // every complete address reads as "no country", blocking a fine record.
    expect(
      missingPartyFacts({
        contacts: { rows: reachable, failed: false },
        locations: {
          rows: [{ address: { countryCode: "US", stateProvince: "VA" } }],
          failed: false
        }
      }).location
    ).toBe(false);
  });

  it("carries the US state rule through the stored columns", () => {
    expect(
      missingPartyFacts({
        contacts: { rows: reachable, failed: false },
        locations: {
          rows: [{ address: { countryCode: "US", stateProvince: null } }],
          failed: false
        }
      })
    ).toEqual({ contact: false, location: true });
  });

  it("treats an unjoined embed as absent, not as a crash", () => {
    // PostgREST returns the join row with a null embed when the FK is dangling.
    expect(
      missingPartyFacts({
        contacts: { rows: [{ contact: null }, {}], failed: false },
        locations: { rows: [{ address: null }, {}], failed: false }
      })
    ).toEqual({ contact: true, location: true });
  });

  it("reports both missing for a party created from just a name", () => {
    expect(
      missingPartyFacts({
        contacts: { rows: [], failed: false },
        locations: { rows: [], failed: false }
      })
    ).toEqual({ contact: true, location: true });
  });

  it("fails open per read, without suppressing the other half", () => {
    // A locations query that errored must not be reported as "no location" —
    // and must not hide a genuinely unreachable supplier either. Skipping BOTH
    // halves on EITHER error is what this pins against.
    expect(
      missingPartyFacts({
        contacts: { rows: [], failed: false },
        locations: { rows: null, failed: true }
      })
    ).toEqual({ contact: true, location: false });

    expect(
      missingPartyFacts({
        contacts: { rows: null, failed: true },
        locations: { rows: [], failed: false }
      })
    ).toEqual({ contact: false, location: true });
  });

  it("finds nothing missing when both reads failed", () => {
    // Which makes `checkPartyContactRequirement` return null — a database hiccup
    // is not a reason to block a post. The route logs the degradation.
    expect(
      missingPartyFacts({
        contacts: { rows: null, failed: true },
        locations: { rows: null, failed: true }
      })
    ).toEqual({ contact: false, location: false });
  });
});

describe("the party check is the only enforcement point", () => {
  it("exposes no document field-level requirement (D-2)", () => {
    // `requiredContactField` was applied by six `make*Validator` factories, which
    // only the six browser forms and the six `*.details.tsx` actions used — every
    // CREATE action, the API and MCP kept the permissive validator, so the rule
    // was cosmetic there. It also refused to save an EXISTING draft whose
    // optional location was null, blocking edits to unrelated fields. Deleting
    // the helper is what stops a seventh copy being built on it; the bar now
    // lives in `checkPartyContactRequirement` alone.
    expect(Object.keys(partyContact)).not.toContain("requiredContactField");
  });
});
