// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

// The module's imports reach the glossary, whose `msg` macro only runs compiled.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => ({ id: strings.join("") })
}));

import { readDefaultPurchaseOrderSupplierParties } from "../app/modules/purchasing/purchasing.models";
import {
  getDefaultPurchaseOrderSupplierParties,
  insertPurchaseOrder,
  withSupplierPartyFallback
} from "../app/modules/purchasing/purchasing.service";
import { filteringSupabase } from "./filtering-supabase-fake";

const company = "company-1";

// sup-1's shipping card names sup-2's location, so its default is its only own location.
const base = (overrides: Record<string, any[]> = {}) => ({
  supplier: [{ id: "sup-1", companyId: company, purchasingContactId: "scon-1" }],
  supplierShipping: [
    { supplierId: "sup-1", companyId: company, shippingSupplierLocationId: "sloc-9" }
  ],
  supplierPayment: [{ supplierId: "sup-1", companyId: company, paymentTermId: "pt-1" }],
  supplierLocation: [
    {
      id: "sloc-1",
      supplierId: "sup-1",
      companyId: company,
      address: {
        addressLine1: "1 Main St",
        addressLine2: null,
        city: "Springfield",
        stateProvince: "IL",
        postalCode: "62701",
        country: { alpha2: "US", name: "United States" }
      }
    },
    { id: "sloc-9", supplierId: "sup-2", companyId: company }
  ],
  supplierContact: [
    {
      id: "scon-1",
      supplierId: "sup-1",
      companyId: company,
      contact: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" }
    }
  ],
  ...overrides
});

describe("insertPurchaseOrder with supplier defaults", () => {
  it.each([
    [
      "fills a missing contact and location from the supplier",
      {},
      { supplierContactId: "scon-1", supplierLocationId: "sloc-1" }
    ],
    [
      "keeps a contact and location the caller sent",
      { supplierContactId: "scon-sent", supplierLocationId: "sloc-sent" },
      { supplierContactId: "scon-sent", supplierLocationId: "sloc-sent" }
    ],
    [
      "keeps the sent contact and fills only the missing location",
      { supplierContactId: "scon-sent" },
      { supplierContactId: "scon-sent", supplierLocationId: "sloc-1" }
    ]
  ])("%s", async (_, sent, stored) => {
    const { client, writes } = filteringSupabase(base(), {
      // The order's own payment and shipping reads go by supplier id under RLS.
      unscoped: ["supplierShipping", "supplierPayment"]
    });

    const result = await insertPurchaseOrder(client, {
      supplierId: "sup-1",
      companyId: company,
      companyGroupId: "group-1",
      createdBy: "user-1",
      purchaseOrderId: "PO000001",
      orderDate: "2026-11-26",
      defaultSupplierParty: true,
      ...sent
    });

    expect(result.error).toBeNull();
    const order = writes.find((write) => write.table === "purchaseOrder");
    expect({
      supplierContactId: order?.value.supplierContactId,
      supplierLocationId: order?.value.supplierLocationId
    }).toEqual(stored);
  });

  const create = (client: any) =>
    insertPurchaseOrder(client, {
      supplierId: "sup-1",
      companyId: company,
      companyGroupId: "group-1",
      createdBy: "user-1",
      purchaseOrderId: "PO000001",
      orderDate: "2026-11-26",
      defaultSupplierParty: true
    });

  it("still creates the order, without the defaults, when they cannot be read", async () => {
    const { client, writes } = filteringSupabase(base(), {
      unscoped: ["supplierShipping", "supplierPayment"],
      failing: ["supplierLocation"]
    });

    const result = await create(client);

    expect(result.error).toBeNull();
    const order = writes.find((write) => write.table === "purchaseOrder");
    expect(order?.value.supplierContactId ?? null).toBeNull();
    expect(order?.value.supplierLocationId ?? null).toBeNull();
    // The one interaction written is the order's own.
    expect(writes.filter((write) => write.table === "supplierInteraction")).toHaveLength(1);
    expect(order?.value.supplierInteractionId).toBe("supplierInteraction-1");
  });

  it("writes no supplier interaction when a read the order needs fails", async () => {
    const { client, writes } = filteringSupabase(base(), {
      unscoped: ["supplierShipping", "supplierPayment"],
      failing: ["supplierPayment"]
    });

    const result = await create(client);

    expect(result.error).not.toBeNull();
    expect(writes).toEqual([]);
  });
});

describe("getDefaultPurchaseOrderSupplierParties", () => {
  it("sees a supplier's second location past PostgREST's row cap", async () => {
    // sup-1's second location is row 1,001 of the read, after 999 of sup-2's.
    const supplierLocation = [
      { id: "sloc-1", supplierId: "sup-1", companyId: company },
      ...Array.from({ length: 999 }, (_, i) => ({
        id: `sloc-2-${i}`,
        supplierId: "sup-2",
        companyId: company
      })),
      { id: "sloc-1b", supplierId: "sup-1", companyId: company }
    ];
    const { client } = filteringSupabase(
      base({
        supplier: [
          { id: "sup-1", companyId: company, purchasingContactId: "scon-1" },
          { id: "sup-2", companyId: company, purchasingContactId: null }
        ],
        supplierShipping: [],
        supplierLocation
      }),
      { maxRows: 1000 }
    );

    const parties = await getDefaultPurchaseOrderSupplierParties(client, company, [
      "sup-1",
      "sup-2"
    ]);

    expect(parties.get("sup-1")).toEqual({
      supplierContactId: "scon-1",
      supplierLocationId: null
    });
  });

  // Planning's Order reads through this, so a failed read must not fail the submit.
  it("gives no defaults when the read fails", async () => {
    const { client } = filteringSupabase(base(), { failing: ["supplierLocation"] });

    const parties = await getDefaultPurchaseOrderSupplierParties(client, company, ["sup-1"]);

    expect(parties.size).toBe(0);
  });
});

describe("readDefaultPurchaseOrderSupplierParties", () => {
  const suppliers = Promise.resolve({
    data: [{ id: "sup-1", purchasingContactId: "scon-1" }],
    error: null
  });
  const shippings = Promise.resolve({
    data: [{ supplierId: "sup-1", shippingSupplierLocationId: "sloc-1" }],
    error: null
  });

  it("fills each supplier's default contact and location", async () => {
    const parties = await readDefaultPurchaseOrderSupplierParties(
      {
        suppliers,
        shippings,
        locations: Promise.resolve({
          data: [{ id: "sloc-1", supplierId: "sup-1" }],
          error: null
        })
      },
      { companyId: company }
    );

    expect(parties.get("sup-1")).toEqual({
      supplierContactId: "scon-1",
      supplierLocationId: "sloc-1"
    });
  });

  // A failed read returns `{ error }`; a rejection is a bug and must not pass as one.
  it("lets a rejected read throw", async () => {
    await expect(
      readDefaultPurchaseOrderSupplierParties(
        {
          suppliers,
          shippings,
          locations: Promise.reject(new Error("bad builder"))
        },
        { companyId: company }
      )
    ).rejects.toThrow("bad builder");
  });
});

describe("withSupplierPartyFallback", () => {
  const blank = {
    supplierAddressLine1: null,
    supplierAddressLine2: null,
    supplierCity: null,
    supplierStateProvince: null,
    supplierPostalCode: null,
    supplierCountryCode: null,
    supplierCountryName: null,
    supplierContactName: null,
    supplierContactEmail: null,
    deliveryName: "Plant 1"
  };

  it("prints the supplier's default address and contact without writing the order", async () => {
    const { client, writes } = filteringSupabase(base(), {
      // The location is read by the id the company-scoped party read returned.
      unscoped: ["supplierLocation"]
    });

    const printed = await withSupplierPartyFallback(client, {
      companyId: company,
      order: { supplierId: "sup-1", supplierContactId: null, supplierLocationId: null },
      locations: blank
    });

    expect(printed).toEqual({
      supplierAddressLine1: "1 Main St",
      supplierAddressLine2: null,
      supplierCity: "Springfield",
      supplierStateProvince: "IL",
      supplierPostalCode: "62701",
      supplierCountryCode: "US",
      supplierCountryName: "United States",
      supplierContactName: "Ada Lovelace",
      supplierContactEmail: "ada@example.com",
      deliveryName: "Plant 1"
    });
    expect(writes).toEqual([]);
  });

  it("leaves the contact of an order that has one", async () => {
    const { client } = filteringSupabase(base(), { unscoped: ["supplierLocation"] });

    const printed = await withSupplierPartyFallback(client, {
      companyId: company,
      order: { supplierId: "sup-1", supplierContactId: "scon-7", supplierLocationId: null },
      locations: { ...blank, supplierContactName: "Grace Hopper" }
    });

    expect(printed.supplierContactName).toBe("Grace Hopper");
    expect(printed.supplierCity).toBe("Springfield");
  });
});
