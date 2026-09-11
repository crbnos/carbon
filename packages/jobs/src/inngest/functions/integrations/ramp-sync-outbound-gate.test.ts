import { patchRampCursor, type RampClient } from "@carbon/ee/ramp.server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeRampKeysetCursor } from "./ramp-sync-cursor";
import { syncRampOutbound } from "./ramp-sync-outbound";
import type { RampSyncContext } from "./ramp-sync-shared";

vi.mock("@carbon/env", () => ({ getAppUrl: () => "http://localhost:3000" }));
vi.mock("@carbon/ee/ramp.server", async (original) => ({
  ...(await original<typeof import("@carbon/ee/ramp.server")>()),
  patchRampCursor: vi.fn()
}));

describe("Ramp outbound draft-bill safety gate", () => {
  afterEach(() => vi.restoreAllMocks());

  it("holds existing enabled configs' export cursor, reports failure, and still archives settled mapped bills", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cursor = encodeRampKeysetCursor({
      updatedAt: "2026-09-10T00:00:00Z",
      id: "previous"
    });
    const createDraftBill = vi.fn(async () => ({ id: "draft-new" }));
    const submitDraftBill = vi.fn(async () => ({ id: "bill-new" }));
    const archiveBill = vi.fn(async () => undefined);
    const link = vi.fn();
    const client = {
      from(table: string) {
        let columns = "";
        const data = () => {
          if (table === "purchaseInvoices")
            return columns === "id, status"
              ? [{ id: "invoice-settled", status: "Paid" }]
              : [
                  {
                    id: "invoice-new",
                    invoiceId: "AP-NEW",
                    supplierId: "supplier-1",
                    supplierReference: "Vendor-new",
                    currencyCode: "USD",
                    exchangeRate: 1,
                    dateIssued: "2026-09-11",
                    dateDue: "2026-09-30",
                    updatedAt: "2026-09-11T00:00:00Z"
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
          if (table === "purchaseInvoiceLine")
            return [
              {
                invoiceId: "invoice-new",
                description: "Expense",
                totalAmount: 12.34,
                sortOrder: 1
              }
            ];
          return [];
        };
        const query = {
          select: (value: string) => {
            columns = value;
            return query;
          },
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
      companyId: "company-1",
      baseCurrency: "USD",
      companyGroupId: "group-1",
      metadata: {
        sync: { pushInvoices: true, pushPurchaseOrders: false },
        cursors: { invoicePushUpdatedAt: cursor }
      },
      decimalsCache: new Map([["USD", 2]]),
      exchangeRateCache: new Map(),
      mapping: {
        getExternalId: vi.fn(async () => "ramp-vendor-1"),
        link,
        getAllByIntegration: vi.fn(async () => [
          {
            entityId: "invoice-settled",
            externalId: "bill-settled",
            metadata: {},
            createdBy: "system"
          }
        ])
      }
    } as unknown as RampSyncContext;

    // Uses the REAL pushInvoiceDraftBill: mocking that entrypoint would hide
    // precisely the feature gate this regression must protect.
    const result = await syncRampOutbound(
      ctx,
      {
        createDraftBill,
        submitDraftBill,
        archiveBill
      } as unknown as RampClient,
      null
    );
    expect(result.invoices).toMatchObject({
      pushed: 0,
      failed: 1,
      archived: 1
    });
    expect(patchRampCursor).not.toHaveBeenCalled();
    expect(ctx.metadata.cursors?.invoicePushUpdatedAt).toBe(cursor);
    expect(createDraftBill).not.toHaveBeenCalled();
    expect(submitDraftBill).not.toHaveBeenCalled();
    expect(archiveBill).toHaveBeenCalledExactlyOnceWith("bill-settled");
    expect(link).toHaveBeenCalledExactlyOnceWith(
      "bill",
      "invoice-settled",
      "ramp",
      "bill-settled",
      {
        createdBy: "system",
        metadata: { archived: true }
      }
    );
  });
});
