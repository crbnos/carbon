// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Copyright (C) Carbon Manufacturing Systems Corporation.
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import {
  describeMissingVendorFields,
  pickVendorAddresses,
  pickVendorContacts,
  resolveVendorContact
} from "./parties";

const party = (
  over: Partial<Parameters<typeof describeMissingVendorFields>[0]>
) =>
  ({
    id: "sup_1",
    name: "Deep Space RF",
    country: "US",
    contact: {
      email: "aosei@dsrf.com",
      firstName: null,
      lastName: null,
      phone: null
    },
    // A US country with no state is INCOMPLETE (Ramp: 400 DEVELOPER_7080), so
    // the default fixture carries one — otherwise "nothing is missing" cases
    // would silently be testing a party that really is missing something.
    address: { stateProvince: "VA" },
    ...over
  }) as Parameters<typeof describeMissingVendorFields>[0];

describe("pickVendorContacts", () => {
  /**
   * A spend-vendor create needs `business_vendor_contacts.email` — Ramp rejects
   * both a create with no contact and one whose contact carries no email
   * (`DEVELOPER_7001 "Missing data for required field"`, verified live
   * 2026-09-26). So a supplier with no purchasing contact could not be created
   * at all, and every bill for it failed, even when the supplier plainly had one
   * contact with an address on file.
   */
  it("uses the sole emailable contact", () => {
    const sole = pickVendorContacts([
      { supplierId: "sup_1", email: "aosei@dsrf.com" }
    ]);

    expect(sole.get("sup_1")?.email).toBe("aosei@dsrf.com");
  });

  it("takes the FIRST when several are emailable", () => {
    // Deliberately not a refusal. Demanding exactly one blocked the push over a
    // choice nobody had made, and a human picking between two colleagues would
    // be just as arbitrary. Setting the purchasing contact overrides this.
    const sole = pickVendorContacts([
      { supplierId: "sup_1", email: "a@dsrf.com" },
      { supplierId: "sup_1", email: "b@dsrf.com" }
    ]);

    expect(sole.get("sup_1")?.email).toBe("a@dsrf.com");
  });

  it("is stable under the caller's order, which is what makes FIRST meaningful", () => {
    // The query orders by the join row's id. If the caller ever stopped, the
    // vendor's contact at the platform would flip between syncs.
    const forwards = pickVendorContacts([
      { supplierId: "sup_1", email: "a@dsrf.com" },
      { supplierId: "sup_1", email: "b@dsrf.com" }
    ]);
    const backwards = pickVendorContacts([
      { supplierId: "sup_1", email: "b@dsrf.com" },
      { supplierId: "sup_1", email: "a@dsrf.com" }
    ]);

    expect(forwards.get("sup_1")?.email).toBe("a@dsrf.com");
    expect(backwards.get("sup_1")?.email).toBe("b@dsrf.com");
  });

  it("ignores contacts with no usable email, and can still find a sole one", () => {
    // Three contacts but only one reachable ⇒ unambiguous.
    const sole = pickVendorContacts([
      { supplierId: "sup_1", email: null },
      { supplierId: "sup_1", email: "   " },
      { supplierId: "sup_1", email: "only@dsrf.com" }
    ]);

    expect(sole.get("sup_1")?.email).toBe("only@dsrf.com");
  });

  it("keeps suppliers independent", () => {
    const sole = pickVendorContacts([
      { supplierId: "sup_1", email: "one@a.com" },
      { supplierId: "sup_2", email: "x@b.com" },
      { supplierId: "sup_2", email: "y@b.com" }
    ]);

    expect(sole.get("sup_1")?.email).toBe("one@a.com");
    expect(sole.get("sup_2")?.email).toBe("x@b.com");
  });

  it("yields nothing when no contact is emailable", () => {
    expect(
      pickVendorContacts([{ supplierId: "sup_1", email: null }]).size
    ).toBe(0);
  });
});

describe("describeMissingVendorFields", () => {
  /**
   * The message this replaces read "its supplier has no Ramp spend vendor (a
   * create needs a name, email and country)" — it named neither the supplier nor
   * which of the three was actually absent, so acting on it meant querying the
   * database.
   */
  it("names the supplier and the one missing field", () => {
    const message = describeMissingVendorFields(party({ contact: null }));

    expect(message).toContain("Deep Space RF");
    expect(message).toContain("a contact email");
    expect(message).not.toContain("a country");
    expect(message).not.toContain("a name");
  });

  it("lists every missing field, not just the first", () => {
    const message = describeMissingVendorFields(
      party({ contact: null, country: null })
    );

    expect(message).toContain("a contact email");
    expect(message).toContain("a country");
  });

  it("falls back to the id when the supplier has no name", () => {
    const message = describeMissingVendorFields(
      party({ name: "", contact: null })
    );

    expect(message).toContain("sup_1");
    expect(message).toContain("a name");
  });

  it("does not imply an incomplete record when nothing is missing", () => {
    // Everything Carbon checks is present, so the platform refused for its own
    // reason; saying "needs a name/email/country" there sends the reader to look
    // for a gap that is not there.
    const message = describeMissingVendorFields(party({}));

    expect(message).not.toContain("needs");
    expect(message).toContain("provider error");
  });
});

describe("describeMissingVendorFields — the US state rule", () => {
  /**
   * Verified live 2026-09-28: `US` with no `state` is refused
   * `400 DEVELOPER_7080 "State is required for US"`, while `GB` with no state is
   * accepted (200). Before this the message fell through to "see the provider
   * error on the previous attempt" — true, and useless to whoever has to fix the
   * supplier record.
   */
  it("names the missing US state", () => {
    const message = describeMissingVendorFields(
      party({ country: "US", address: null })
    );

    expect(message).toContain("state");
    expect(message).toContain("Deep Space RF");
    expect(message).not.toContain("provider error");
  });

  it("is satisfied by a US location that HAS a state", () => {
    const message = describeMissingVendorFields(
      party({
        country: "US",
        address: { stateProvince: "VA" }
      } as never)
    );

    expect(message).not.toContain("state");
    expect(message).toContain("provider error");
  });

  it("does not demand a state outside the US", () => {
    // A GB vendor create with no state returned 200 — demanding one here would
    // block a push the platform would have accepted.
    const message = describeMissingVendorFields(
      party({ country: "GB", address: null })
    );

    expect(message).not.toContain("state");
    expect(message).toContain("provider error");
  });

  it("asks for the country first when there is none, not a state", () => {
    // "needs a two-letter state on its US location" makes no sense for a
    // supplier with no location at all.
    const message = describeMissingVendorFields(
      party({ country: null, address: null })
    );

    expect(message).toContain("a country on one of its locations");
    expect(message).not.toContain("state");
  });
});

describe("resolveVendorContact", () => {
  const purchasing = {
    email: null,
    firstName: "Ama",
    lastName: "Osei",
    mobilePhone: "+1-555-0100",
    homePhone: null,
    workPhone: null
  };
  const emailable = {
    email: "billing@dsrf.com",
    firstName: "Kofi",
    lastName: "Mensah",
    mobilePhone: null,
    homePhone: null,
    workPhone: "+1-555-0199"
  };

  /**
   * The bug: the fallback was applied PER FIELD, so a purchasing contact with a
   * name but no email produced `email` from the fallback contact and
   * `firstName`/`lastName` from the purchasing one. The Ramp vendor named Ama and
   * mailed Kofi — permanently, because a spend vendor is create-once.
   */
  it("takes the WHOLE fallback contact, never a field from each", () => {
    const contact = resolveVendorContact(purchasing, emailable);

    expect(contact).toEqual({
      email: "billing@dsrf.com",
      firstName: "Kofi",
      lastName: "Mensah",
      phone: "+1-555-0199"
    });
  });

  it("keeps the purchasing contact whole when it is emailable", () => {
    const contact = resolveVendorContact(
      { ...purchasing, email: "ama@dsrf.com" },
      emailable
    );

    expect(contact).toEqual({
      email: "ama@dsrf.com",
      firstName: "Ama",
      lastName: "Osei",
      phone: "+1-555-0100"
    });
  });

  it("keeps a name-only purchasing contact when there is no fallback", () => {
    // It cannot create a vendor, but it can match one — and it is what
    // describeMissingVendorFields reads to say which field is absent.
    expect(resolveVendorContact(purchasing, undefined)).toEqual({
      email: null,
      firstName: "Ama",
      lastName: "Osei",
      phone: "+1-555-0100"
    });
  });

  it("is null when neither row carries anything identifying", () => {
    expect(
      resolveVendorContact(
        {
          email: null,
          firstName: null,
          lastName: null,
          mobilePhone: null,
          homePhone: null,
          workPhone: null
        },
        undefined
      )
    ).toBeNull();
    expect(resolveVendorContact(null, undefined)).toBeNull();
  });

  it("prefers mobile, then work, then home — within ONE contact", () => {
    expect(
      resolveVendorContact(
        { ...emailable, mobilePhone: "m", workPhone: "w", homePhone: "h" },
        undefined
      )?.phone
    ).toBe("m");
    expect(
      resolveVendorContact(
        { ...emailable, mobilePhone: null, workPhone: "w", homePhone: "h" },
        undefined
      )?.phone
    ).toBe("w");
    expect(
      resolveVendorContact(
        { ...emailable, mobilePhone: null, workPhone: null, homePhone: "h" },
        undefined
      )?.phone
    ).toBe("h");
  });
});

describe("pickVendorAddresses", () => {
  const us = (stateProvince: string | null) => ({
    supplierId: "sup_1",
    countryCode: "US",
    stateProvince
  });

  /**
   * Two US locations, one with a state and one without. The old picker only
   * upgraded an incumbent with NO country, so it kept whichever Postgres returned
   * first — and `describeMissingVendorFields` then reported "needs a two-letter
   * state on its US location" even though a complete location existed. With no
   * ORDER BY on the read, the answer also flipped between runs.
   */
  it("prefers the US location that HAS a state, in either input order", () => {
    expect(pickVendorAddresses([us(null), us("VA")]).get("sup_1")).toEqual(
      us("VA")
    );
    expect(pickVendorAddresses([us("VA"), us(null)]).get("sup_1")).toEqual(
      us("VA")
    );
  });

  it("prefers a location with a country over one without", () => {
    const none = {
      supplierId: "sup_1",
      countryCode: null,
      stateProvince: null
    };
    const gb = { supplierId: "sup_1", countryCode: "GB", stateProvince: null };

    expect(pickVendorAddresses([none, gb]).get("sup_1")).toEqual(gb);
    expect(pickVendorAddresses([gb, none]).get("sup_1")).toEqual(gb);
  });

  it("does not demand a state outside the US, so the first GB location stands", () => {
    const first = {
      supplierId: "sup_1",
      countryCode: "GB",
      stateProvince: null
    };
    const second = {
      supplierId: "sup_1",
      countryCode: "GB",
      stateProvince: "Greater London"
    };

    expect(pickVendorAddresses([first, second]).get("sup_1")).toEqual(first);
  });

  it("keeps suppliers independent", () => {
    const picked = pickVendorAddresses([
      us(null),
      { supplierId: "sup_2", countryCode: "US", stateProvince: "TX" }
    ]);

    expect(picked.get("sup_1")).toEqual(us(null));
    expect(picked.get("sup_2")?.stateProvince).toBe("TX");
  });

  it("yields nothing for a supplier with no locations", () => {
    expect(pickVendorAddresses([]).size).toBe(0);
  });
});
