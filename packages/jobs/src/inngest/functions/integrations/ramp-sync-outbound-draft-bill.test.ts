import {
  patchRampCursor,
  pushInvoiceDraftBill,
  type RampClient
} from "@carbon/ee/ramp.server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { syncRampOutbound } from "./ramp-sync-outbound";
import type { RampSyncContext } from "./ramp-sync-shared";

vi.mock("@carbon/env", () => ({ getAppUrl: () => "http://localhost:3000" }));
vi.mock("@carbon/ee/ramp.server", async (original) => ({
  ...(await original<typeof import("@carbon/ee/ramp.server")>()),
  patchRampCursor: vi.fn(),
  pushInvoiceDraftBill: vi.fn(async () => "pushed")
}));

describe("Ramp outbound draft-bill push wiring", () => {
  afterEach(() => vi.restoreAllMocks());

  it("hands the Kysely db + pushed coding sets to the draft-bill push, then advances the cursor", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const db = { kysely: true } as unknown as RampSyncContext["db"];
    const client = {
      from(table: string) {
        const data = () => {
          if (table === "purchaseInvoices")
            return [
              {
                id: "invoice-new",
                invoiceId: "AP-NEW",
                supplierId: "supplier-1",
                supplierReference: "Vendor-new",
                dateIssued: "2026-09-11",
                dateDue: "2026-09-30",
                createdAt: "2026-09-11T00:00:00Z"
              }
            ];
          if (table === "supplier")
            return [
              {
                id: "supplier-1",
                name: "Test Supplier",
                supplierTypeId: null,
                supplierContact: null,
                supplierLocation: []
              }
            ];
          return [];
        };
        const query = {
          select: () => query,
          eq: () => query,
          in: () => query,
          order: () => query,
          limit: () => query,
          or: () => query,
          maybeSingle: async () => ({ data: null, error: null }),
          range: async () => ({
            data: data(),
            error: null,
            count: data().length
          }),
          then: (
            resolve: (value: {
              data: Record<string, unknown>[];
              error: null;
            }) => unknown
          ) => Promise.resolve({ data: data(), error: null }).then(resolve)
        };
        return query;
      }
    };
    const ctx = {
      client,
      db,
      companyId: "company-1",
      baseCurrency: "USD",
      companyGroupId: "group-1",
      metadata: {
        sync: { pushInvoices: true, pushPurchaseOrders: false },
        cursors: {}
      },
      decimalsCache: new Map([["USD", 2]]),
      exchangeRateCache: new Map(),
      mapping: {
        link: vi.fn(),
        getAllByIntegration: vi.fn(
          async (_integration: string, type: string) => {
            if (type === "account")
              return [{ entityId: "acct_expense", externalId: "acct_expense" }];
            if (type === "costCenter")
              return [{ entityId: "cc_ga", externalId: "cc_ga" }];
            return [];
          }
        )
      }
    } as unknown as RampSyncContext;

    const result = await syncRampOutbound(
      ctx,
      {} as unknown as RampClient,
      null
    );

    expect(result.invoices).toMatchObject({ pushed: 1, failed: 0 });
    expect(pushInvoiceDraftBill).toHaveBeenCalledTimes(1);
    const call = vi.mocked(pushInvoiceDraftBill).mock.calls[0]!;
    // db is arg 0; invoice is arg 4; pushed sets are arg 5.
    expect(call[0]).toBe(db);
    expect(call[4]).toMatchObject({
      id: "invoice-new",
      supplierReference: "Vendor-new"
    });
    expect(call[5].pushedAccountIds.has("acct_expense")).toBe(true);
    expect(call[5].pushedCostCenterIds.has("cc_ga")).toBe(true);
    // All fetched rows processed → cursor advances.
    expect(patchRampCursor).toHaveBeenCalled();
  });
});
