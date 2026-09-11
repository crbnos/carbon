import {
  patchRampCursor,
  pushInvoiceDraftBill,
  pushPurchaseOrder,
  type RampClient
} from "@carbon/ee/ramp.server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeRampKeysetCursor, rampKeysetFilter } from "./ramp-sync-cursor";
import { syncRampOutbound } from "./ramp-sync-outbound";
import type { RampSyncContext } from "./ramp-sync-shared";

vi.mock("@carbon/env", () => ({ getAppUrl: () => "http://localhost:3000" }));
vi.mock("@carbon/ee/ramp.server", async (original) => ({
  ...(await original<typeof import("@carbon/ee/ramp.server")>()),
  pushPurchaseOrder: vi.fn(async () => "created"),
  pushInvoiceDraftBill: vi.fn(async () => "pushed"),
  patchRampCursor: vi.fn(async () => undefined)
}));

type Family = "purchaseOrders" | "invoices";
type Lookup = "supplier" | "supplierType";
const previous = { updatedAt: "2026-09-10T00:00:00.000Z", id: "previous" };
const updatedAt = "2026-09-11T00:00:00.000Z";

/** Only database/provider I/O is substituted; the real family and keyset logic run. */
function fixture(family: Family, failedLookup: Lookup) {
  const errors = new Map<string, { message: string }>([
    [failedLookup, { message: `${failedLookup} unavailable` }]
  ]);
  const ids = family === "purchaseOrders" ? ["po_a", "po_b"] : ["pi_a", "pi_b"];
  const table =
    family === "purchaseOrders" ? "purchaseOrder" : "purchaseInvoices";
  const cursorKey =
    family === "purchaseOrders"
      ? "purchaseOrderPushUpdatedAt"
      : "invoicePushUpdatedAt";
  const rows: Record<string, Record<string, unknown>[]> = {
    [table]: ids.map((id) => ({
      id,
      purchaseOrderId: id,
      invoiceId: id,
      status: family === "purchaseOrders" ? "To Invoice" : "Open",
      supplierId: "sup_1",
      supplierReference: "Vendor invoice",
      currencyCode: "USD",
      exchangeRate: 1,
      dateIssued: "2026-09-11",
      dateDue: "2026-09-30",
      updatedAt
    })),
    supplier: [
      {
        id: "sup_1",
        name: "Test Supplier",
        supplierTypeId: failedLookup === "supplierType" ? "employee" : null,
        supplierContact: {
          contact: {
            email: "supplier@example.test",
            firstName: "Test",
            lastName: "Supplier",
            mobilePhone: null,
            homePhone: null,
            workPhone: null
          }
        },
        supplierLocation: [
          {
            address: {
              countryCode: "US",
              addressLine1: "123 Test Street",
              addressLine2: null,
              city: "Boston",
              stateProvince: "MA",
              postalCode: "02108"
            }
          }
        ]
      }
    ],
    supplierType: [{ id: "employee", name: "Employee" }],
    purchaseOrderLine: ids.map((id) => ({
      id: `line_${id}`,
      purchaseOrderId: id,
      description: "Line",
      purchaseQuantity: 1,
      supplierUnitPrice: 10,
      purchaseOrderLineType: "G/L Account",
      sortOrder: 1
    })),
    purchaseInvoiceLine: ids.map((id) => ({
      invoiceId: id,
      description: "Line",
      totalAmount: 10,
      sortOrder: 1
    }))
  };
  const filters: Array<{ table: string; operator: string; value: unknown }> =
    [];
  const queries: string[] = [];
  const client = {
    from(name: string) {
      queries.push(name);
      const result = (start = 0, end = Number.POSITIVE_INFINITY) => ({
        data: errors.has(name)
          ? null
          : (rows[name] ?? []).slice(start, end + 1),
        error: errors.get(name) ?? null,
        count: rows[name]?.length ?? 0
      });
      const query = {
        select: () => query,
        eq: (_column: string, value: unknown) => {
          filters.push({ table: name, operator: "eq", value });
          return query;
        },
        in: () => query,
        neq: () => query,
        order: () => query,
        limit: () => query,
        or: (value: string) => {
          filters.push({ table: name, operator: "or", value });
          return query;
        },
        gte: (value: string) => {
          filters.push({ table: name, operator: "gte", value });
          return query;
        },
        range: async (start: number, end: number) => result(start, end),
        then: (resolve: (value: ReturnType<typeof result>) => unknown) =>
          Promise.resolve(result()).then(resolve)
      };
      return query;
    }
  };
  const ctx = {
    client,
    companyId: "co_1",
    companyGroupId: "group_1",
    baseCurrency: "USD",
    metadata: {
      entityId: "entity_1",
      sync: {
        pushPurchaseOrders: family === "purchaseOrders",
        pushInvoices: family === "invoices"
      },
      cursors: { [cursorKey]: encodeRampKeysetCursor(previous) }
    },
    decimalsCache: new Map([["USD", 2]]),
    exchangeRateCache: new Map(),
    mapping: { getAllByIntegration: vi.fn(async () => []) }
  } as unknown as RampSyncContext;
  return {
    ctx,
    errors,
    filters,
    queries,
    ids,
    table,
    cursorKey,
    ramp: {} as RampClient
  };
}

describe("Ramp outbound prerequisite lookup failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  const cases = [
    { family: "purchaseOrders", lookup: "supplier" },
    { family: "invoices", lookup: "supplier" },
    { family: "invoices", lookup: "supplierType" }
  ] as const;

  it.each(
    cases
  )("fails $family on $lookup read error before pushing or advancing its cursor", async ({
    family,
    lookup
  }) => {
    const { ctx, ramp, cursorKey } = fixture(family, lookup);
    const result = await syncRampOutbound(ctx, ramp, null);

    expect(result[family]).toMatchObject({ pushed: 0, archived: 0, failed: 1 });
    expect(result[family].error).toContain(`${lookup} unavailable`);
    expect(pushPurchaseOrder).not.toHaveBeenCalled();
    expect(pushInvoiceDraftBill).not.toHaveBeenCalled();
    expect(patchRampCursor).not.toHaveBeenCalled();
    expect(ctx.metadata.cursors?.[cursorKey]).toBe(
      encodeRampKeysetCursor(previous)
    );
  });

  it.each(
    cases
  )("replays the held $family page after $lookup recovers", async ({
    family,
    lookup
  }) => {
    const { ctx, ramp, errors, filters, ids, table, cursorKey } = fixture(
      family,
      lookup
    );
    await syncRampOutbound(ctx, ramp, null);
    expect(patchRampCursor).not.toHaveBeenCalled();

    errors.clear();
    const result = await syncRampOutbound(ctx, ramp, null);
    // A successful Employee classification deliberately skips export, but is
    // now covered work. A failed classification must never use that path.
    expect(result[family]).toMatchObject({
      failed: 0,
      pushed: lookup === "supplierType" ? 0 : 2
    });
    expect(patchRampCursor).toHaveBeenCalledExactlyOnceWith(
      ctx.client,
      ctx.companyId,
      cursorKey,
      encodeRampKeysetCursor({ updatedAt, id: ids[1]! })
    );
    expect(
      filters.filter(
        (filter) => filter.table === table && filter.operator === "or"
      )
    ).toEqual([
      { table, operator: "or", value: rampKeysetFilter(previous).value },
      { table, operator: "or", value: rampKeysetFilter(previous).value }
    ]);
    if (lookup === "supplierType")
      expect(pushInvoiceDraftBill).not.toHaveBeenCalled();
  });
});
