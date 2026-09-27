import { patchRampCursor, type RampClient } from "@carbon/ee/ramp.server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncRampOutbound } from "./ramp-sync-outbound";
import type { RampSyncContext } from "./ramp-sync-shared";

vi.mock("@carbon/env", () => ({ getAppUrl: () => "http://localhost:3000" }));
vi.mock("@carbon/ee/ramp.server", async (original) => ({
  ...(await original<typeof import("@carbon/ee/ramp.server")>()),
  patchRampCursor: vi.fn(async () => undefined)
}));

function fixture() {
  const pos = [
    { id: "po_a", supplierId: "sup_shared", status: "To Invoice" },
    { id: "po_b", supplierId: "sup_shared", status: "To Invoice" },
    { id: "po_c", supplierId: "sup_linked", status: "To Invoice" },
    { id: "po_d", supplierId: "sup_ambiguous", status: "To Invoice" },
    { id: "po_e", supplierId: "sup_unused", status: "Closed" },
    { id: "po_f", supplierId: "sup_unused", status: "Closed" }
  ].map((row) => ({
    ...row,
    purchaseOrderId: row.id,
    currencyCode: "USD",
    updatedAt: "2026-09-11T00:00:00.000Z"
  }));
  const suppliers = [
    "sup_shared",
    "sup_linked",
    "sup_ambiguous",
    "sup_unused"
  ].map((id) => ({
    id,
    name: id === "sup_ambiguous" ? "Duplicate vendor" : id,
    supplierTypeId: null,
    supplierContact: {
      contact: {
        email: "vendor@example.test",
        firstName: null,
        lastName: null,
        mobilePhone: null,
        homePhone: null,
        workPhone: null
      }
    },
    supplierLocation: [
      {
        address: {
          countryCode: "US",
          addressLine1: null,
          addressLine2: null,
          city: null,
          stateProvince: "MA",
          postalCode: null
        }
      }
    ]
  }));
  const rows: Record<string, object[]> = {
    purchaseOrder: pos,
    supplier: suppliers,
    purchaseOrderLine: pos.map((po) => ({
      id: `line_${po.id}`,
      purchaseOrderId: po.id,
      description: "Line",
      purchaseQuantity: 2,
      supplierUnitPrice: 5,
      purchaseOrderLineType: "G/L Account",
      sortOrder: 1
    }))
  };
  const client = {
    from(table: string) {
      const result = { data: rows[table] ?? [], error: null };
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        neq: () => query,
        order: () => query,
        limit: () => query,
        range: async (start: number, end: number) => ({
          data: result.data.slice(start, end + 1),
          error: null
        }),
        then: (resolve: (value: typeof result) => unknown) =>
          Promise.resolve(result).then(resolve)
      };
      return query;
    }
  };
  const storedMappings = new Map([
    ["purchaseOrder:po_a", "ramp-po-a"],
    ["purchaseOrder:po_e", "ramp-po-e"],
    ["vendor:sup_linked", "ramp-linked"]
  ]);
  const mapping = {
    getExternalId: vi.fn(
      async (type: string, id: string) =>
        storedMappings.get(`${type}:${id}`) ?? null
    ),
    getByEntities: vi.fn(
      async (type: string, ids: string[]) =>
        new Map(
          ids.flatMap((id) => {
            const externalId = storedMappings.get(`${type}:${id}`);
            return externalId ? [[id, { entityId: id, externalId }]] : [];
          })
        )
    ),
    link: vi.fn(
      async (
        type: string,
        id: string,
        _integration: string,
        externalId: string
      ) => {
        storedMappings.set(`${type}:${id}`, externalId);
      }
    )
  };
  const vendors = [
    {
      id: "ramp-shared",
      external_vendor_id: "sup_shared",
      name: "Old supplier name"
    },
    { id: "duplicate-a", name: "Duplicate vendor" },
    { id: "duplicate-b", name: "Duplicate vendor" }
  ];
  let vendorError: Error | undefined;
  const ramp = {
    listVendors: vi.fn(async function* (params?: {
      external_vendor_id?: string;
      name?: string;
    }) {
      if (vendorError) throw vendorError;
      const filtered = vendors.filter((vendor) =>
        params?.external_vendor_id
          ? vendor.external_vendor_id === params.external_vendor_id
          : params?.name
            ? vendor.name === params.name
            : true
      );
      // Split the duplicate-name candidates across pages: ambiguity must be
      // decided from the complete provider snapshot.
      yield filtered.slice(0, 2);
      yield filtered.slice(2);
    }),
    createSpendVendor: vi.fn(
      async (body: { external_vendor_id: string; name: string }) => {
        const vendor = {
          id: `created-${body.external_vendor_id}`,
          external_vendor_id: body.external_vendor_id,
          name: body.name
        };
        vendors.push(vendor);
        return vendor;
      }
    ),
    patchPurchaseOrder: vi.fn(async () => undefined),
    createPurchaseOrder: vi.fn(async (body: { external_id: string }) => ({
      id: `ramp-${body.external_id}`
    })),
    archivePurchaseOrder: vi.fn(async () => undefined)
  };
  const ctx = {
    client,
    mapping,
    companyId: "co_1",
    baseCurrency: "USD",
    metadata: {
      entityId: "ramp-entity",
      sync: { pushPurchaseOrders: true, pushInvoices: false }
    }
  } as unknown as RampSyncContext;
  return {
    ctx,
    mapping,
    ramp,
    pos,
    storedMappings,
    vendors,
    failVendorLookup: () => {
      vendorError = new Error("Ramp vendors unavailable");
    }
  };
}

describe("Ramp outbound purchase-order prerequisite batching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("batches mapping and provider reads across a mixed six-order page", async () => {
    const { ctx, mapping, ramp } = fixture();
    const result = await syncRampOutbound(
      ctx,
      ramp as unknown as RampClient,
      null
    );
    expect(result.purchaseOrders).toEqual({
      pushed: 4,
      archived: 1,
      failed: 0
    });
    expect(mapping.getExternalId).not.toHaveBeenCalled();
    expect(mapping.getByEntities).toHaveBeenCalledTimes(2);
    expect(ramp.listVendors).toHaveBeenCalledTimes(1);
    expect(ramp.patchPurchaseOrder).toHaveBeenCalledWith(
      "ramp-po-a",
      expect.objectContaining({ vendor_id: "ramp-shared" })
    );
    expect(ramp.createPurchaseOrder.mock.calls.map(([body]) => body)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          external_id: "po_b",
          vendor_id: "ramp-shared"
        }),
        expect.objectContaining({
          external_id: "po_c",
          vendor_id: "ramp-linked"
        }),
        expect.objectContaining({
          external_id: "po_d",
          vendor_id: "created-sup_ambiguous"
        })
      ])
    );
    expect(ramp.createSpendVendor).toHaveBeenCalledTimes(1);
    expect(ramp.archivePurchaseOrder).toHaveBeenCalledExactlyOnceWith(
      "ramp-po-e"
    );
    expect(patchRampCursor).toHaveBeenCalledOnce();
  });

  it("updates the batch after creating a shared supplier's vendor", async () => {
    const { ctx, mapping, ramp, vendors } = fixture();
    vendors.shift();
    await syncRampOutbound(ctx, ramp as unknown as RampClient, null);
    expect(ramp.listVendors).toHaveBeenCalledTimes(1);
    expect(
      ramp.createSpendVendor.mock.calls.filter(
        ([body]) => body.external_vendor_id === "sup_shared"
      )
    ).toHaveLength(1);
    expect(
      mapping.link.mock.calls.filter(
        ([type, id]) => type === "vendor" && id === "sup_shared"
      )
    ).toHaveLength(1);
  });

  it("skips the provider lookup when every needed supplier is mapped", async () => {
    const { ctx, mapping, ramp, storedMappings } = fixture();
    storedMappings.set("vendor:sup_shared", "ramp-shared");
    storedMappings.set("vendor:sup_ambiguous", "ramp-ambiguous");
    await syncRampOutbound(ctx, ramp as unknown as RampClient, null);
    expect(ramp.listVendors).not.toHaveBeenCalled();
    expect(mapping.getExternalId).not.toHaveBeenCalled();
    expect(mapping.getByEntities).toHaveBeenCalledTimes(2);
  });

  it("isolates a vendor-read failure to orders needing an unmapped vendor", async () => {
    const { ctx, ramp, failVendorLookup } = fixture();
    failVendorLookup();
    const result = await syncRampOutbound(
      ctx,
      ramp as unknown as RampClient,
      null
    );
    expect(result.purchaseOrders).toEqual({
      pushed: 1,
      archived: 1,
      failed: 3
    });
    expect(ramp.listVendors).toHaveBeenCalledTimes(1);
    expect(ramp.createSpendVendor).not.toHaveBeenCalled();
    expect(patchRampCursor).not.toHaveBeenCalled();
  });
});
