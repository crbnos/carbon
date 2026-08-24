import { describe, expect, it } from "vitest";
// Import the mapper directly, never `./stripe-customer.server` — that module
// pulls the `~/modules/sales` barrel and, through it, `@carbon/glossary`'s
// Lingui macros, which throw outside a configured i18n runtime.
import type { StripeCustomerSources } from "./stripe-customer.mapper";
import {
  buildStripeCustomerInput,
  toStripeTaxExempt
} from "./stripe-customer.mapper";

/**
 * The real `StripeCustomerSources` is derived from Supabase query-builder
 * return types, which are far wider than the mapper reads. These fixtures carry
 * only the fields under test and are cast in — a full literal would be noise
 * that obscures which field each case is actually about.
 */
function sources(
  overrides: {
    customer?: Record<string, unknown>;
    contact?: Record<string, unknown> | null;
    billingLocation?: Record<string, unknown> | null;
    customerTax?: Record<string, unknown> | null;
  } = {}
): StripeCustomerSources {
  return {
    customer: {
      id: "cust_1",
      companyId: "co_1",
      name: "Acme Manufacturing",
      readableId: "CUS000123",
      website: "https://acme.test",
      phone: null,
      status: "Active",
      type: "Direct",
      taxPercent: 0.0825,
      tags: ["oem"],
      ...overrides.customer
    },
    contact:
      overrides.contact === null
        ? null
        : {
            id: "ccontact_1",
            contactId: "contact_1",
            contact: {
              email: "ap@acme.test",
              firstName: "Dana",
              lastName: "Reed",
              workPhone: "+1-555-0100",
              mobilePhone: null
            },
            ...overrides.contact
          },
    billingLocation:
      overrides.billingLocation === null
        ? null
        : {
            id: "cloc_1",
            address: {
              addressLine1: "1 Foundry Way",
              addressLine2: "Suite 4",
              city: "Detroit",
              stateProvince: "MI",
              postalCode: "48201",
              countryCode: "US"
            },
            ...overrides.billingLocation
          },
    customerTax:
      overrides.customerTax === null
        ? null
        : {
            customerId: "cust_1",
            taxExempt: false,
            taxExemptionReason: null,
            ...overrides.customerTax
          }
  } as unknown as StripeCustomerSources;
}

describe("buildStripeCustomerInput", () => {
  it("reads email and phone from the embedded contact, not the join row", () => {
    const input = buildStripeCustomerInput(sources());

    expect(input?.email).toBe("ap@acme.test");
    expect(input?.phone).toBe("+1-555-0100");
  });

  it("reads address from the embedded address, not the location join row", () => {
    const input = buildStripeCustomerInput(sources());

    expect(input?.address).toEqual({
      line1: "1 Foundry Way",
      line2: "Suite 4",
      city: "Detroit",
      state: "MI",
      postal_code: "48201",
      country: "US"
    });
  });

  it("prefers the customer's own phone over the contact's", () => {
    const input = buildStripeCustomerInput(
      sources({ customer: { phone: "+1-555-9999" } })
    );

    expect(input?.phone).toBe("+1-555-9999");
  });

  it("falls back to the contact's mobile when there is no work phone", () => {
    const input = buildStripeCustomerInput(
      sources({
        contact: {
          contact: {
            email: "ap@acme.test",
            workPhone: null,
            mobilePhone: "+1-555-0177"
          }
        }
      })
    );

    expect(input?.phone).toBe("+1-555-0177");
  });

  it("returns null when there is no email to invoice", () => {
    const input = buildStripeCustomerInput(
      sources({ contact: { contact: { email: null } } })
    );

    expect(input).toBeNull();
  });

  it("uses the override email when the contact has none", () => {
    const input = buildStripeCustomerInput(
      sources({ contact: { contact: { email: null } } }),
      "billing@acme.test"
    );

    expect(input?.email).toBe("billing@acme.test");
  });

  it("omits the address entirely when no billing location is set", () => {
    const input = buildStripeCustomerInput(sources({ billingLocation: null }));

    expect(input?.address).toBeUndefined();
    // A customer with no billing address is still billable.
    expect(input?.email).toBe("ap@acme.test");
  });

  it("maps an export exemption to Stripe's reverse charge", () => {
    const input = buildStripeCustomerInput(
      sources({
        customerTax: { taxExempt: true, taxExemptionReason: "Export" }
      })
    );

    expect(input?.taxExempt).toBe("reverse");
  });

  it("defaults to not exempt when the customer has no tax row", () => {
    const input = buildStripeCustomerInput(sources({ customerTax: null }));

    expect(input?.taxExempt).toBe("none");
  });

  it("stores taxPercent as the stored fraction, not a percentage", () => {
    const input = buildStripeCustomerInput(sources());

    expect(input?.metadata.carbon_tax_percent).toBe("0.0825");
  });

  it("clamps metadata values to Stripe's 500-character limit", () => {
    const input = buildStripeCustomerInput(
      sources({ customer: { tags: [`${"a".repeat(400)},${"b".repeat(400)}`] } })
    );

    expect(input?.metadata.carbon_tags).toHaveLength(500);
  });

  it("labels a missing status and type rather than emitting empty strings", () => {
    const input = buildStripeCustomerInput(
      sources({ customer: { status: null, type: null } })
    );

    // Stripe accepts empty values, but "unknown" reads correctly in the
    // dashboard where these are the only Carbon context a support rep has.
    expect(input?.metadata.carbon_status).toBe("unknown");
    expect(input?.metadata.carbon_type).toBe("unknown");
  });

  it("keeps the Carbon ids that tie the Stripe record back to the ERP", () => {
    const input = buildStripeCustomerInput(sources());

    expect(input?.metadata.carbon_customer_id).toBe("cust_1");
    expect(input?.metadata.carbon_company_id).toBe("co_1");
    expect(input?.metadata.carbon_readable_id).toBe("CUS000123");
  });
});

describe("toStripeTaxExempt", () => {
  it("is 'none' when the customer is not exempt, whatever the reason says", () => {
    expect(toStripeTaxExempt(false, "Export")).toBe("none");
    expect(toStripeTaxExempt(null, null)).toBe("none");
    expect(toStripeTaxExempt(undefined, undefined)).toBe("none");
  });

  it("treats an export sale as a reverse charge, not an exemption", () => {
    // Zero-rated with the tax liability shifted to the buyer — billing it as
    // "exempt" would misstate the transaction on the Stripe invoice.
    expect(toStripeTaxExempt(true, "Export")).toBe("reverse");
  });

  it("treats every other Carbon reason as an ordinary exemption", () => {
    for (const reason of [
      "Resale",
      "Government",
      "Nonprofit",
      "Agriculture",
      "Industrial",
      "Medical",
      "Educational",
      "Religious",
      "Other"
    ]) {
      expect(toStripeTaxExempt(true, reason)).toBe("exempt");
    }
  });

  it("is 'exempt' when exempt with no reason recorded", () => {
    expect(toStripeTaxExempt(true, null)).toBe("exempt");
  });
});
