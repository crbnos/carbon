// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  hasEmailableContact,
  hasUsableLocation,
  isEmailableContact,
  isUsableLocationAddress,
  missingPartyFacts,
  type PartyContactRow,
  type PartyLocationRow,
  partyContactRequiredMessage
} from "./party-contact";

// Every bar below is what a Ramp vendor create enforces (sandbox, 2026-09-28):
// looser lets a document post and fail downstream, stricter blocks for nothing.
describe("isEmailableContact", () => {
  it("accepts a contact with an email", () => {
    expect(isEmailableContact({ email: "aosei@dsrf.com" })).toBe(true);
  });

  it.each(["", "   ", null, undefined])(
    "rejects a contact whose email is %j",
    (email) => {
      expect(isEmailableContact({ email })).toBe(false);
    }
  );
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
  // Ramp accepts a GB vendor with no state and refuses a US one.
  it.each([
    [{ country: "GB" }, true],
    [{ country: "DE", stateProvince: null }, true],
    [{ country: "US", stateProvince: "VA" }, true],
    [{ country: "" }, false],
    [{ country: "   " }, false],
    [{ country: null }, false],
    [{}, false],
    [{ country: "US" }, false],
    [{ country: "US", stateProvince: "   " }, false],
    // countryCode is free text: "us" and "USA" are the US too.
    [{ country: "us" }, false],
    [{ country: "USA" }, false]
  ])("%j is usable: %s", (address, expected) => {
    expect(isUsableLocationAddress(address)).toBe(expected);
  });
});

describe("hasUsableLocation", () => {
  it("is satisfied by one usable location among several", () => {
    expect(
      hasUsableLocation([
        { country: null },
        { country: "US" },
        { country: "US", stateProvince: "CA" }
      ])
    ).toBe(true);
  });

  it("refuses no locations, or only unusable ones", () => {
    expect(hasUsableLocation([])).toBe(false);
    expect(hasUsableLocation([{ country: null }, { country: "US" }])).toBe(
      false
    );
  });
});

describe("partyContactRequiredMessage", () => {
  it("names the party, both missing facts and where to add them", () => {
    expect(
      partyContactRequiredMessage("supplier", "McMaster-Carr", {
        contact: true,
        location: true
      })
    ).toBe(
      "McMaster-Carr needs a contact with an email address and a location with a country (and a state, for US addresses). Add them on the supplier record before posting. (Suppliers → Contacts and Locations. This is required by your company's settings.)"
    );
  });

  it.each([
    [
      "supplier",
      "Acme",
      { contact: true, location: false },
      /^Acme needs a contact with an email address\. Add it .*Suppliers → Contacts\./
    ],
    [
      "customer",
      "Acme",
      { contact: false, location: true },
      /^Acme needs a location with a country .*Customers → Locations\./
    ],
    [
      "customer",
      null,
      { contact: true, location: false },
      /^This customer needs /
    ],
    [
      "supplier",
      "   ",
      { contact: true, location: false },
      /^This supplier needs /
    ]
  ] as const)(
    "phrases a %s named %j missing %j",
    (kind, name, missing, expected) => {
      expect(partyContactRequiredMessage(kind, name, missing)).toMatch(
        expected
      );
    }
  );
});

describe("missingPartyFacts", () => {
  function base(overrides: {
    contacts?: { rows: PartyContactRow[] | null; failed: boolean };
    locations?: { rows: PartyLocationRow[] | null; failed: boolean };
  }) {
    return missingPartyFacts({
      contacts: {
        rows: [{ contact: { email: "aosei@dsrf.com" } }],
        failed: false
      },
      locations: { rows: [{ address: { countryCode: "GB" } }], failed: false },
      ...overrides
    });
  }

  it("finds nothing missing for a complete party", () => {
    expect(base({})).toEqual({ contact: false, location: false });
  });

  it("reads the stored countryCode as the address rule's country", () => {
    expect(
      base({
        locations: {
          rows: [{ address: { countryCode: "US", stateProvince: "VA" } }],
          failed: false
        }
      })
    ).toEqual({ contact: false, location: false });
  });

  it("applies the US state rule to the stored columns", () => {
    expect(
      base({
        locations: {
          rows: [{ address: { countryCode: "US", stateProvince: null } }],
          failed: false
        }
      })
    ).toEqual({ contact: false, location: true });
  });

  it("treats an unjoined embed as absent", () => {
    expect(
      base({
        contacts: { rows: [{ contact: null }, {}], failed: false },
        locations: { rows: [{ address: null }, {}], failed: false }
      })
    ).toEqual({ contact: true, location: true });
  });

  it("reports both missing for a party created from just a name", () => {
    expect(
      base({
        contacts: { rows: [], failed: false },
        locations: { rows: [], failed: false }
      })
    ).toEqual({ contact: true, location: true });
  });

  // A failed read must not report its fact missing, nor hide the other read's finding.
  it.each([
    [
      {
        contacts: { rows: [], failed: false },
        locations: { rows: null, failed: true }
      },
      { contact: true, location: false }
    ],
    [
      {
        contacts: { rows: null, failed: true },
        locations: { rows: [], failed: false }
      },
      { contact: false, location: true }
    ],
    [
      {
        contacts: { rows: null, failed: true },
        locations: { rows: null, failed: true }
      },
      { contact: false, location: false }
    ]
  ])("fails open per read: %j", (reads, expected) => {
    expect(base(reads)).toEqual(expected);
  });
});
