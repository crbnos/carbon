import type { RampClient } from "@carbon/ee/ramp.server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { countRampSyncFailures } from "./ramp-sync-observability";
import { syncRampOutbound } from "./ramp-sync-outbound";
import type { RampSyncContext } from "./ramp-sync-shared";

vi.mock("@carbon/env", () => ({ getAppUrl: () => "http://localhost:3000" }));

function fixture(
  statusError?: string,
  rowCount = 3,
  onlyLastSettled = false,
  errorOnBatch = 1
) {
  const link = vi.fn();
  const archiveBill = vi.fn(async (_id: string) => undefined);
  const ids = Array.from({ length: rowCount }, (_, index) => String(index + 1));
  const statusBatches: string[][] = [];
  const client = {
    from(table: string) {
      expect(table).toBe("purchaseInvoices");
      let columns = "";
      let selectedIds: string[] = [];
      const query = {
        select(value: string) {
          columns = value;
          return query;
        },
        eq: () => query,
        in: (column: string, values: string[]) => {
          if (column === "id") {
            selectedIds = values;
            statusBatches.push(values);
          }
          return query;
        },
        order: () => query,
        limit: () => query,
        then(resolve: (value: unknown) => unknown) {
          const isStatusRead = columns === "id, status";
          const error =
            isStatusRead && statusError && statusBatches.length === errorOnBatch
              ? { message: statusError }
              : null;
          return Promise.resolve({
            data:
              isStatusRead && !error
                ? ids
                    .map((id) => ({
                      id: `invoice-${id}`,
                      status:
                        !onlyLastSettled || id === String(rowCount)
                          ? "Paid"
                          : "Open"
                    }))
                    .filter((row) => selectedIds.includes(row.id))
                    .slice(0, 1000)
                : [],
            error
          }).then(resolve);
        }
      };
      return query;
    }
  };
  const ctx = {
    client,
    companyId: "company-1",
    metadata: { sync: { pushInvoices: true, pushPurchaseOrders: false } },
    mapping: {
      getAllByIntegration: vi.fn(async () =>
        ids.map((id) => ({
          entityId: `invoice-${id}`,
          externalId: `bill-${id}`,
          metadata: {},
          createdBy: "system"
        }))
      ),
      link
    }
  } as unknown as RampSyncContext;
  return {
    ctx,
    link,
    archiveBill,
    statusBatches,
    ramp: { archiveBill } as unknown as RampClient
  };
}

afterEach(() => vi.restoreAllMocks());

describe("Ramp archive failure reporting", () => {
  it("archives settled invoices beyond the first 1000 mappings using bounded status batches", async () => {
    const { ctx, ramp, archiveBill, statusBatches } = fixture(
      undefined,
      1001,
      true
    );

    const result = await syncRampOutbound(ctx, ramp, null);

    expect(result.invoices).toMatchObject({ failed: 0, archived: 1 });
    expect(archiveBill).toHaveBeenCalledExactlyOnceWith("bill-1001");
    expect(statusBatches.flat()).toHaveLength(1001);
    expect(statusBatches.every((ids) => ids.length <= 100)).toBe(true);
  });

  it.each([
    1, 2
  ])("reports a failed status read in batch %s without attempting any archive", async (errorOnBatch) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { ctx, ramp, archiveBill, link } = fixture(
      "Status lookup unavailable",
      101,
      false,
      errorOnBatch
    );

    const result = await syncRampOutbound(ctx, ramp, null);

    expect(result.invoices).toMatchObject({
      failed: 1,
      archived: 0,
      error: expect.stringContaining("Status lookup unavailable")
    });
    expect(
      countRampSyncFailures([result.purchaseOrders, result.invoices])
    ).toBe(1);
    expect(archiveBill).not.toHaveBeenCalled();
    expect(link).not.toHaveBeenCalled();
  });

  it("counts individual archive failures while preserving successes before and after them", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { ctx, ramp, archiveBill, link } = fixture();
    archiveBill.mockImplementation(async (id) => {
      if (id === "bill-2") throw new Error("Provider unavailable");
    });

    const result = await syncRampOutbound(ctx, ramp, null);

    expect(result.invoices).toMatchObject({ failed: 1, archived: 2 });
    expect(
      countRampSyncFailures([result.purchaseOrders, result.invoices])
    ).toBe(1);
    expect(archiveBill).toHaveBeenCalledTimes(3);
    expect(link.mock.calls.map((args) => args[1])).toEqual([
      "invoice-1",
      "invoice-3"
    ]);
  });
});
