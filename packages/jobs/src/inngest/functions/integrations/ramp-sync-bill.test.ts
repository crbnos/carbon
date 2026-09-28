import { describe, expect, it, vi } from "vitest";
import { postPurchaseInvoice } from "./ramp-sync-bill";
import type { RampSyncContext } from "./ramp-sync-shared";

vi.mock("@carbon/env", () => ({ getAppUrl: () => "http://localhost" }));

function postingFixture(
  initialStatus: string,
  finalStatus: string,
  error = false
) {
  const row: Record<string, unknown> = {
    id: "invoice-1",
    companyId: "company-1",
    invoiceId: "PI-1",
    status: initialStatus
  };
  const invoke = vi.fn(async () => {
    row.status = finalStatus;
    return { data: null, error: error ? new Error("response lost") : null };
  });
  const client = {
    from: () => {
      let update: Record<string, unknown> | undefined;
      const filters: Array<[string, unknown]> = [];
      const execute = () => {
        const matches = filters.every(([key, value]) => row[key] === value);
        if (matches && update) Object.assign(row, update);
        return { data: matches ? { ...row } : null, error: null };
      };
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => {
          filters.push([key, value]);
          return query;
        },
        update: (values: Record<string, unknown>) => {
          update = values;
          return query;
        },
        single: async () => execute(),
        maybeSingle: async () => execute(),
        then: (resolve: (value: ReturnType<typeof execute>) => unknown) =>
          Promise.resolve(execute()).then(resolve)
      };
      return query;
    },
    functions: { invoke }
  };
  return {
    ctx: { client, companyId: "company-1" } as unknown as RampSyncContext,
    row,
    invoke
  };
}

describe("Ramp invoice posting observation", () => {
  it("does not confirm a successful HTTP response while the invoice remains Pending", async () => {
    const { ctx } = postingFixture("Draft", "Pending");
    expect(await postPurchaseInvoice(ctx, "invoice-1")).toEqual({
      fail: expect.stringContaining("Pending")
    });
  });

  it("accepts a lost post response only when the stored invoice is posted", async () => {
    const { ctx, row } = postingFixture("Draft", "Open", true);
    expect(await postPurchaseInvoice(ctx, "invoice-1")).toEqual({
      readableId: "PI-1"
    });
    expect(row.status).toBe("Open");
  });

  it.each([
    "Pending",
    "Voided"
  ])("does not restart an invoice already %s", async (status) => {
    const { ctx, invoke, row } = postingFixture(status, "Open");
    expect(await postPurchaseInvoice(ctx, "invoice-1")).toEqual({
      fail: expect.stringContaining(status)
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(row.status).toBe(status);
  });
});
