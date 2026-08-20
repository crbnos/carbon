import { describe, expect, it } from "vitest";
import type { Accounting } from "../../../../core/types";
import { AccountingApiError } from "../../../../core/utils";
import { mapContactToRilletCustomer } from "../customer";
import {
  mapPaymentTermsToRilletDays,
  writeDroppingUnregisteredReferences
} from "../shared";
import {
  mapContactToRilletVendor,
  RILLET_VENDOR_MAX_PAYMENT_TERMS_DAYS
} from "../vendor";

const makeContact = (
  overrides?: Partial<Accounting.Contact>
): Accounting.Contact => ({
  id: "cust-1",
  name: "Acme Manufacturing",
  firstName: "Jane",
  lastName: "Doe",
  companyId: "company-1",
  email: "jane@acme.example",
  website: null,
  taxId: null,
  currencyCode: "USD",
  balance: null,
  creditLimit: null,
  paymentTerms: null,
  updatedAt: "2026-07-01T12:00:00.000Z",
  workPhone: "555-0100",
  mobilePhone: "555-0101",
  fax: null,
  homePhone: null,
  isVendor: false,
  isCustomer: true,
  addresses: [
    {
      label: "HQ",
      type: null,
      line1: "1 Factory Way",
      line2: "Suite 2",
      city: "Cleveland",
      country: "US",
      region: "OH",
      postalCode: "44101"
    }
  ],
  raw: {},
  ...overrides
});

describe("mapContactToRilletCustomer", () => {
  it("maps name, MAIN_SENDER email, the complete address, payment terms and the carbon reference", () => {
    const payload = mapContactToRilletCustomer(
      makeContact({ paymentTerms: "30" })
    );

    expect(payload).toEqual({
      name: "Acme Manufacturing",
      emails: [{ email: "jane@acme.example", type: "MAIN_SENDER" }],
      address: {
        line1: "1 Factory Way",
        line2: "Suite 2",
        city: "Cleveland",
        state: "OH",
        zip_code: "44101",
        country: "US"
      },
      payment_terms: 30,
      external_references: [
        { type: "carbon", id: "cust-1" },
        { type: "carbon-company", id: "company-1" }
      ]
    });
  });

  it("produces the minimal payload when email/address/terms are absent", () => {
    const payload = mapContactToRilletCustomer(
      makeContact({ email: undefined, addresses: [], paymentTerms: null })
    );

    expect(payload).toEqual({
      name: "Acme Manufacturing",
      external_references: [
        { type: "carbon", id: "cust-1" },
        { type: "carbon-company", id: "company-1" }
      ]
    });
  });

  it("omits the address entirely when the all-or-nothing group is incomplete", () => {
    const payload = mapContactToRilletCustomer(
      makeContact({
        addresses: [
          {
            label: null,
            type: null,
            line1: "1 Factory Way",
            line2: null,
            city: "Cleveland",
            country: "US",
            region: null, // missing state breaks the group
            postalCode: "44101"
          }
        ]
      })
    );

    expect(payload.address).toBeUndefined();
  });

  it("keeps line2 optional within a complete address", () => {
    const payload = mapContactToRilletCustomer(
      makeContact({
        addresses: [
          {
            label: null,
            type: null,
            line1: "1 Factory Way",
            line2: null,
            city: "Cleveland",
            country: "US",
            region: "OH",
            postalCode: "44101"
          }
        ]
      })
    );

    expect(payload.address).toEqual({
      line1: "1 Factory Way",
      city: "Cleveland",
      state: "OH",
      zip_code: "44101",
      country: "US"
    });
  });

  it("maps only bare non-negative integer payment terms (customers have no cap)", () => {
    expect(
      mapContactToRilletCustomer(makeContact({ paymentTerms: "Net 30" }))
        .payment_terms
    ).toBeUndefined();
    expect(
      mapContactToRilletCustomer(makeContact({ paymentTerms: "0" }))
        .payment_terms
    ).toBe(0);
    expect(
      mapContactToRilletCustomer(makeContact({ paymentTerms: "240" }))
        .payment_terms
    ).toBe(240);
  });
});

describe("mapContactToRilletVendor", () => {
  it("maps the flat vendor email, tax_id, capped payment terms and the carbon reference", () => {
    const payload = mapContactToRilletVendor(
      makeContact({
        id: "supp-1",
        taxId: "12-3456789",
        paymentTerms: "45",
        isVendor: true,
        isCustomer: false
      })
    );

    expect(payload).toEqual({
      name: "Acme Manufacturing",
      email: "jane@acme.example",
      address: {
        line1: "1 Factory Way",
        line2: "Suite 2",
        city: "Cleveland",
        state: "OH",
        zip_code: "44101",
        country: "US"
      },
      payment_terms: 45,
      tax_id: "12-3456789",
      external_references: [
        { type: "carbon", id: "supp-1" },
        { type: "carbon-company", id: "company-1" }
      ]
    });
  });

  it("omits payment terms beyond Rillet's 180-day vendor cap instead of clamping", () => {
    const payload = mapContactToRilletVendor(
      makeContact({ paymentTerms: "240" })
    );
    expect(payload.payment_terms).toBeUndefined();

    const atCap = mapContactToRilletVendor(
      makeContact({
        paymentTerms: String(RILLET_VENDOR_MAX_PAYMENT_TERMS_DAYS)
      })
    );
    expect(atCap.payment_terms).toBe(RILLET_VENDOR_MAX_PAYMENT_TERMS_DAYS);
  });

  it("produces the minimal payload when optional fields are absent", () => {
    const payload = mapContactToRilletVendor(
      makeContact({
        email: undefined,
        addresses: [],
        paymentTerms: null,
        taxId: null
      })
    );

    expect(payload).toEqual({
      name: "Acme Manufacturing",
      external_references: [
        { type: "carbon", id: "cust-1" },
        { type: "carbon-company", id: "company-1" }
      ]
    });
  });
});

describe("mapPaymentTermsToRilletDays", () => {
  it("parses only bare non-negative integers, honoring the optional cap", () => {
    expect(mapPaymentTermsToRilletDays(null)).toBeUndefined();
    expect(mapPaymentTermsToRilletDays("")).toBeUndefined();
    expect(mapPaymentTermsToRilletDays("Net 30")).toBeUndefined();
    expect(mapPaymentTermsToRilletDays("-5")).toBeUndefined();
    expect(mapPaymentTermsToRilletDays("30.5")).toBeUndefined();
    expect(mapPaymentTermsToRilletDays(" 30 ")).toBe(30);
    expect(mapPaymentTermsToRilletDays("0")).toBe(0);
    expect(mapPaymentTermsToRilletDays("240", { max: 180 })).toBeUndefined();
    expect(mapPaymentTermsToRilletDays("180", { max: 180 })).toBe(180);
  });
});

describe("writeDroppingUnregisteredReferences", () => {
  const referenceError = new AccountingApiError("rillet", "create vendor", {
    statusCode: 400,
    statusText: "Bad Request",
    providerMessage:
      "External reference type does not exist: carbon. The existing external reference types are: . Please ensure that you are using an existing type or add a new type in the Rillet settings."
  });

  it("retries without external_references when the org has no registered types", async () => {
    const calls: unknown[] = [];
    const result = await writeDroppingUnregisteredReferences(
      { name: "MyVendor", external_references: [{ type: "carbon", id: "x" }] },
      async (payload) => {
        calls.push(payload);
        if ("external_references" in payload) throw referenceError;
        return { id: "vendor-1" };
      }
    );

    expect(result).toEqual({ id: "vendor-1" });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({ name: "MyVendor" });
  });

  it("rethrows other errors untouched", async () => {
    const otherError = new AccountingApiError("rillet", "create vendor", {
      statusCode: 500,
      statusText: "Server Error"
    });
    await expect(
      writeDroppingUnregisteredReferences(
        { name: "MyVendor", external_references: [] },
        async () => {
          throw otherError;
        }
      )
    ).rejects.toBe(otherError);
  });

  it("rethrows when the payload carries no references to strip", async () => {
    const payload: { name: string; external_references?: unknown } = {
      name: "MyVendor"
    };
    await expect(
      writeDroppingUnregisteredReferences(payload, async () => {
        throw referenceError;
      })
    ).rejects.toBe(referenceError);
  });
});
