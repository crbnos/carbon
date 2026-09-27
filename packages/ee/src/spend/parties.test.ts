import { describe, expect, it } from "vitest";
import {
  describeMissingVendorFields,
  pickSoleEmailableContacts
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
    address: null,
    ...over
  }) as Parameters<typeof describeMissingVendorFields>[0];

describe("pickSoleEmailableContacts", () => {
  /**
   * A spend-vendor create needs `business_vendor_contacts.email` — Ramp rejects
   * both a create with no contact and one whose contact carries no email
   * (`DEVELOPER_7001 "Missing data for required field"`, verified live
   * 2026-09-26). So a supplier with no purchasing contact could not be created
   * at all, and every bill for it failed, even when the supplier plainly had one
   * contact with an address on file.
   */
  it("uses the sole emailable contact", () => {
    const sole = pickSoleEmailableContacts([
      { supplierId: "sup_1", email: "aosei@dsrf.com" }
    ]);

    expect(sole.get("sup_1")?.email).toBe("aosei@dsrf.com");
  });

  it("refuses to choose between two emailable contacts", () => {
    // Picking either would put a stranger on the vendor record at the platform.
    const sole = pickSoleEmailableContacts([
      { supplierId: "sup_1", email: "a@dsrf.com" },
      { supplierId: "sup_1", email: "b@dsrf.com" }
    ]);

    expect(sole.has("sup_1")).toBe(false);
  });

  it("ignores contacts with no usable email, and can still find a sole one", () => {
    // Three contacts but only one reachable ⇒ unambiguous.
    const sole = pickSoleEmailableContacts([
      { supplierId: "sup_1", email: null },
      { supplierId: "sup_1", email: "   " },
      { supplierId: "sup_1", email: "only@dsrf.com" }
    ]);

    expect(sole.get("sup_1")?.email).toBe("only@dsrf.com");
  });

  it("keeps suppliers independent", () => {
    const sole = pickSoleEmailableContacts([
      { supplierId: "sup_1", email: "one@a.com" },
      { supplierId: "sup_2", email: "x@b.com" },
      { supplierId: "sup_2", email: "y@b.com" }
    ]);

    expect(sole.get("sup_1")?.email).toBe("one@a.com");
    expect(sole.has("sup_2")).toBe(false);
  });

  it("yields nothing when no contact is emailable", () => {
    expect(
      pickSoleEmailableContacts([{ supplierId: "sup_1", email: null }]).size
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

  it("points at the purchasing contact as the fix for ambiguity", () => {
    // The only way a supplier WITH contacts still lacks an email here is that
    // several were emailable and the sole-contact rule refused to choose.
    expect(describeMissingVendorFields(party({ contact: null }))).toContain(
      "purchasing contact"
    );
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
