import { beforeEach, describe, expect, it, vi } from "vitest";

// The `{module}.mcp.server.ts` wrappers: re-apply the route's request gates,
// then call the SAME command the route calls. The commands themselves are
// pinned in route-commands.test.ts; here they are spies.

const m = vi.hoisted(() => ({
  requireToolPermission: vi.fn(),
  requireToolCompanyRecord: vi.fn(),
  updateQuoteLineWithPrices: vi.fn(),
  createQuoteLineWithPrices: vi.fn(),
  saveQuoteMaterialWithPrices: vi.fn(),
  deleteQuoteMaterialWithPrices: vi.fn(),
  saveQuoteOperationWithPrices: vi.fn(),
  deleteQuoteOperationWithPrices: vi.fn(),
  confirmSalesOrder: vi.fn(),
  rows: {} as Record<string, unknown>,
  SERVICE_ROLE: null as unknown
}));

function makeClient(rows: Record<string, unknown>) {
  return {
    from(table: string) {
      const q = {
        select: () => q,
        eq: () => q,
        single: async () => ({ data: rows[table] ?? null, error: null }),
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null })
      };
      return q;
    }
  };
}

vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => m.SERVICE_ROLE
}));
vi.mock("~/services/mcp-guards.server", () => ({
  requireToolPermission: m.requireToolPermission,
  requireToolCompanyRecord: m.requireToolCompanyRecord
}));
vi.mock("~/modules/sales/sales.server", () => ({
  updateQuoteLineWithPrices: m.updateQuoteLineWithPrices,
  createQuoteLineWithPrices: m.createQuoteLineWithPrices,
  saveQuoteMaterialWithPrices: m.saveQuoteMaterialWithPrices,
  deleteQuoteMaterialWithPrices: m.deleteQuoteMaterialWithPrices,
  saveQuoteOperationWithPrices: m.saveQuoteOperationWithPrices,
  deleteQuoteOperationWithPrices: m.deleteQuoteOperationWithPrices,
  confirmSalesOrder: m.confirmSalesOrder
}));
vi.mock("~/modules/sales/sales-transitions.server", () => ({
  setReturnLineDispositionFromPicker: vi.fn()
}));
// sales.models' module graph needs the Lingui macro transform vitest does not
// run; the wrapper only takes isQuoteLocked from it (Draft is the one
// editable quote status).
vi.mock("~/modules/sales/sales.models", () => ({
  isQuoteLocked: (status: string | null | undefined) =>
    status !== null && status !== undefined && status !== "Draft"
}));

import {
  deleteQuoteOperation,
  releaseSalesOrder,
  upsertQuoteLine,
  upsertQuoteMaterial,
  upsertQuoteOperation
} from "~/modules/sales/sales.mcp.server";

const CALLER = makeClient({ quoteLine: { id: "l9", quoteId: "q1" } });

beforeEach(() => {
  vi.clearAllMocks();
  m.requireToolPermission.mockResolvedValue(undefined);
  m.requireToolCompanyRecord.mockResolvedValue(undefined);
  m.SERVICE_ROLE = makeClient({
    quote: { status: "Draft" },
    quoteLine: { quoteId: "q1", quantity: [5], methodType: "Make to Order" }
  });
  for (const fn of [
    m.updateQuoteLineWithPrices,
    m.createQuoteLineWithPrices,
    m.saveQuoteMaterialWithPrices,
    m.saveQuoteOperationWithPrices,
    m.deleteQuoteOperationWithPrices,
    m.confirmSalesOrder
  ]) {
    fn.mockResolvedValue({ data: { id: "x" }, error: null });
  }
});

describe("sales_upsertQuoteLine", () => {
  it("an update runs the details route's command on the service role, keeping unsent fields", async () => {
    const result = await upsertQuoteLine(CALLER as never, {
      id: "l1",
      companyId: "c1",
      updatedBy: "u1",
      description: "Renamed"
    } as never);
    expect(result.error).toBeNull();
    expect(m.requireToolPermission).toHaveBeenCalledWith(
      "u1",
      "c1",
      "sales",
      "create",
      "update quote lines"
    );
    const [client, args] = m.updateQuoteLineWithPrices.mock.calls[0]!;
    expect(client).toBe(m.SERVICE_ROLE);
    expect(args).toMatchObject({
      companyId: "c1",
      quoteId: "q1",
      lineId: "l1",
      userId: "u1",
      // An omitted quantity is the stored breaks, not "all removed".
      line: { description: "Renamed", quantity: [5], methodType: "Make to Order" }
    });
  });

  it("refuses an update on a locked quote", async () => {
    m.SERVICE_ROLE = makeClient({
      quote: { status: "Sent" },
      quoteLine: { quoteId: "q1", quantity: [5], methodType: "Make to Order" }
    });
    await expect(
      upsertQuoteLine(CALLER as never, {
        id: "l1",
        companyId: "c1",
        updatedBy: "u1"
      } as never)
    ).rejects.toThrow("Cannot modify a locked quote. Reopen it first.");
    expect(m.updateQuoteLineWithPrices).not.toHaveBeenCalled();
  });

  it("refuses to move a line to another quote", async () => {
    await expect(
      upsertQuoteLine(CALLER as never, {
        id: "l1",
        quoteId: "q-other",
        companyId: "c1",
        updatedBy: "u1"
      } as never)
    ).rejects.toThrow("A quote line cannot be moved to another quote.");
  });

  it("a create verifies the quote, then runs the add-line command and returns the row", async () => {
    m.createQuoteLineWithPrices.mockResolvedValue({
      data: { id: "l9" },
      error: null
    });
    const result = await upsertQuoteLine(CALLER as never, {
      quoteId: "q1",
      companyId: "c1",
      createdBy: "u1",
      itemId: "item1",
      methodType: "Purchase to Order",
      quantity: [1],
      configuration: '{"size":2}'
    } as never);
    expect(m.requireToolCompanyRecord).toHaveBeenCalledWith(
      "quote",
      "c1",
      { id: "q1" },
      "Quote"
    );
    const [client, args] = m.createQuoteLineWithPrices.mock.calls[0]!;
    expect(client).toBe(m.SERVICE_ROLE);
    expect(args).toMatchObject({
      quoteId: "q1",
      userId: "u1",
      configuration: { size: 2 }
    });
    expect(result.data).toEqual({ id: "l9", quoteId: "q1" });
  });
});

describe("sales_upsertQuoteMaterial / sales_upsertQuoteOperation", () => {
  it("a material create checks the line and make method, then runs the form's command on the service role", async () => {
    await upsertQuoteMaterial(CALLER as never, {
      quoteId: "q1",
      quoteLineId: "l1",
      quoteMakeMethodId: "qmm1",
      companyId: "c1",
      createdBy: "u1"
    } as never);
    expect(m.requireToolCompanyRecord).toHaveBeenCalledWith(
      "quoteLine",
      "c1",
      { id: "l1", quoteId: "q1" },
      "Quote line"
    );
    expect(m.requireToolCompanyRecord).toHaveBeenCalledWith(
      "quoteMakeMethod",
      "c1",
      { id: "qmm1", quoteLineId: "l1" },
      "Quote make method"
    );
    expect(m.saveQuoteMaterialWithPrices.mock.calls[0]![0]).toBe(
      m.SERVICE_ROLE
    );
  });

  it("a failed reprice after a saved material is an error naming the saved row", async () => {
    m.saveQuoteMaterialWithPrices.mockResolvedValue({
      data: { id: "qm1", methodType: "Buy" },
      error: { message: "Failed to recalculate quote line prices" },
      cause: { message: "no line" },
      failedStep: "recalculate"
    });
    const result = await upsertQuoteMaterial(CALLER as never, {
      id: "qm1",
      quoteId: "q1",
      quoteLineId: "l1",
      companyId: "c1",
      updatedBy: "u1"
    } as never);
    expect(result.error?.message).toBe(
      "Quote material qm1 was saved, but failed to recalculate quote line prices: no line"
    );
  });

  it("an operation write keeps the caller's client, like the operation routes", async () => {
    await upsertQuoteOperation(CALLER as never, {
      id: "qo1",
      quoteId: "q1",
      quoteLineId: "l1",
      companyId: "c1",
      updatedBy: "u1"
    } as never);
    expect(m.saveQuoteOperationWithPrices.mock.calls[0]![0]).toBe(CALLER);
  });

  it("an operation delete is gated on sales delete", async () => {
    m.requireToolPermission.mockRejectedValue(new Error("denied"));
    await expect(
      deleteQuoteOperation(CALLER as never, "qo1", "c1", "u1")
    ).rejects.toThrow("denied");
    expect(m.deleteQuoteOperationWithPrices).not.toHaveBeenCalled();
    expect(m.requireToolPermission).toHaveBeenCalledWith(
      "u1",
      "c1",
      "sales",
      "delete",
      "delete quote operations"
    );
  });
});

describe("sales_releaseSalesOrder", () => {
  it("runs the confirm route's command with the caller's client, employees only", async () => {
    await releaseSalesOrder(CALLER as never, "so1", "u1", "c1");
    expect(m.requireToolPermission).toHaveBeenCalledWith(
      "u1",
      "c1",
      "sales",
      "create",
      "confirm sales orders",
      { employee: true }
    );
    expect(m.confirmSalesOrder).toHaveBeenCalledWith(CALLER, {
      salesOrderId: "so1",
      companyId: "c1",
      userId: "u1",
      emailed: false
    });
  });
});
