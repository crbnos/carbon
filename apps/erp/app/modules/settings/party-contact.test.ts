import { describe, expect, it } from "vitest";
import {
  hasEmailableContact,
  isEmailableContact,
  PARTY_CONTACT_SETTING,
  partyContactRequiredMessage,
  requiredContactField
} from "./party-contact";

describe("isEmailableContact", () => {
  /**
   * The bar has to be an EMAIL, not merely a contact row. A spend platform
   * rejects a vendor create whose contact carries no email exactly as it rejects
   * one with no contact at all, so a phone-only contact satisfies nothing — and a
   * gate that passed it would let the document post and fail downstream, which is
   * worse than no gate.
   */
  it("accepts a contact with an email", () => {
    expect(isEmailableContact({ email: "aosei@dsrf.com" })).toBe(true);
  });

  it("rejects a blank-but-present email", () => {
    // An empty string in the column is common and would otherwise pass.
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
    // The two real failure shapes: a supplier with no contacts at all, and one
    // whose contacts are all phone-only.
    expect(hasEmailableContact([])).toBe(false);
    expect(hasEmailableContact([{ email: null }, { email: "" }])).toBe(false);
  });
});

describe("PARTY_CONTACT_SETTING", () => {
  it("maps each party kind to its own company setting", () => {
    // The two are independent on purpose: the purchasing side has a platform
    // requirement behind it, the sales side ships off and has none yet.
    expect(PARTY_CONTACT_SETTING.supplier).toBe("requireSupplierContact");
    expect(PARTY_CONTACT_SETTING.customer).toBe("requireCustomerContact");
  });
});

describe("partyContactRequiredMessage", () => {
  it("names the party and the record to fix", () => {
    const message = partyContactRequiredMessage("supplier", "Deep Space RF");

    expect(message).toContain("Deep Space RF");
    expect(message).toContain("email");
    expect(message).toContain("supplier record");
  });

  it("stays readable when the party has no name", () => {
    expect(partyContactRequiredMessage("customer", null)).toContain(
      "This customer"
    );
    expect(partyContactRequiredMessage("supplier", "   ")).toContain(
      "This supplier"
    );
  });

  it("says the requirement came from settings, not from nowhere", () => {
    // Without this the message reads as a hard product rule, and the person
    // hitting it has no idea it is a company setting somebody turned on.
    expect(partyContactRequiredMessage("supplier", "Acme")).toContain(
      "settings"
    );
  });
});

describe("requiredContactField", () => {
  /**
   * One phrasing for all six documents, and the reason it is a helper rather than
   * five copies: the message a user sees for a missing purchase-order contact and
   * a missing sales-invoice contact should not drift apart.
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
