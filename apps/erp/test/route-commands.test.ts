import { beforeEach, describe, expect, it, vi } from "vitest";

// Pins the route commands in `sales.server.ts`: the whole
// operation a route action runs after its request gates, which the MCP
// wrappers publish under the primitive's tool name. Each case is a piece of
// orchestration the bare primitive skipped, reproduced over MCP as a bug.

const svc = vi.hoisted(() => ({
  buildMakeToOrderPriceRows: vi.fn(),
  buildPullFromInventoryPriceRows: vi.fn(),
  buildPurchaseToOrderPriceRows: vi.fn(),
  deleteQuoteMaterial: vi.fn(),
  getSalesOrderLines: vi.fn(),
  recalculateQuoteLinePrices: vi.fn(),
  resolvePurchaseToOrderPrices: vi.fn(),
  resolveQuoteLinePrices: vi.fn(),
  upsertQuoteLine: vi.fn(),
  upsertQuoteLineMethod: vi.fn(),
  upsertQuoteMaterial: vi.fn(),
  upsertQuoteMaterialMakeMethod: vi.fn(),
  upsertQuoteOperation: vi.fn(),
  runMRP: vi.fn(),
  trackWorkEvent: vi.fn(),
  kyselyWrites: [] as string[],
  SERVICE_ROLE: {} as Record<string, unknown>
}));

vi.mock("~/modules/sales/sales.service", () => ({
  buildMakeToOrderPriceRows: svc.buildMakeToOrderPriceRows,
  buildPullFromInventoryPriceRows: svc.buildPullFromInventoryPriceRows,
  buildPurchaseToOrderPriceRows: svc.buildPurchaseToOrderPriceRows,
  deleteQuoteMaterial: svc.deleteQuoteMaterial,
  getSalesOrderLines: svc.getSalesOrderLines,
  recalculateQuoteLinePrices: svc.recalculateQuoteLinePrices,
  resolvePurchaseToOrderPrices: svc.resolvePurchaseToOrderPrices,
  resolveQuoteLinePrices: svc.resolveQuoteLinePrices,
  upsertQuoteLine: svc.upsertQuoteLine,
  upsertQuoteLineMethod: svc.upsertQuoteLineMethod,
  upsertQuoteMaterial: svc.upsertQuoteMaterial,
  upsertQuoteMaterialMakeMethod: svc.upsertQuoteMaterialMakeMethod,
  upsertQuoteOperation: svc.upsertQuoteOperation
}));
vi.mock("~/modules/production/production.service", () => ({
  runMRP: svc.runMRP
}));
vi.mock("@carbon/lib/telemetry", () => ({
  trackWorkEvent: svc.trackWorkEvent
}));
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => svc.SERVICE_ROLE
}));
vi.mock("~/modules/shared/timezone.server", () => ({
  getCompanyTimeZone: vi.fn(async () => "UTC")
}));
vi.mock("~/modules/settings", () => ({ getCompanySettings: vi.fn() }));
vi.mock("@carbon/jobs", () => ({ trigger: vi.fn() }));
vi.mock("@carbon/notifications", () => ({ NotificationEvent: {} }));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() })
}));
vi.mock("~/services/database.server", () => ({
  // A Kysely stub that records every write inside the transaction.
  getDatabaseClient: () => {
    const chain = (label: string) => {
      const builder: Record<string, unknown> = {};
      for (const m of ["set", "where", "values"]) {
        builder[m] = () => builder;
      }
      builder.execute = async () => {
        svc.kyselyWrites.push(label);
        return [];
      };
      builder.executeTakeFirst = async () => {
        svc.kyselyWrites.push(label);
        return { numUpdatedRows: BigInt(1) };
      };
      return builder;
    };
    const trx = {
      updateTable: (t: string) => chain(`update:${t}`),
      deleteFrom: (t: string) => chain(`delete:${t}`),
      insertInto: (t: string) => chain(`insert:${t}`)
    };
    return {
      transaction: () => ({
        execute: async (fn: (t: typeof trx) => Promise<unknown>) => fn(trx)
      })
    };
  }
}));

import {
  confirmSalesOrder,
  createQuoteLineWithPrices,
  deleteQuoteOperationWithPrices,
  saveQuoteMaterialWithPrices,
  saveQuoteOperationWithPrices,
  updateQuoteLineWithPrices
} from "~/modules/sales/sales.server";

/** A supabase stub: `rows[table]` answers every read; writes are recorded. */
function makeClient(rows: Record<string, unknown> = {}) {
  const writes: { table: string; op: string; value?: unknown }[] = [];
  const client = {
    writes,
    from(table: string) {
      const read = {
        select: () => read,
        eq: () => read,
        in: () => read,
        order: () => read,
        single: async () => ({ data: rows[table] ?? null, error: null }),
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
        // biome-ignore lint/suspicious/noThenProperty: a thenable query builder
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: rows[table] ?? [], error: null })
      };
      const write = (op: string, value?: unknown) => {
        writes.push({ table, op, value });
        const done = {
          eq: () => done,
          in: () => done,
          // biome-ignore lint/suspicious/noThenProperty: a thenable query builder
          then: (resolve: (v: unknown) => void) =>
            resolve({ data: null, error: null })
        };
        return done;
      };
      return {
        ...read,
        update: (value: unknown) => write("update", value),
        delete: () => write("delete"),
        insert: (value: unknown) => write("insert", value)
      };
    }
  };
  return client;
}

const ok = { data: null, error: null };

beforeEach(() => {
  vi.clearAllMocks();
  svc.kyselyWrites.length = 0;
  for (const fn of [
    svc.recalculateQuoteLinePrices,
    svc.resolvePurchaseToOrderPrices,
    svc.resolveQuoteLinePrices,
    svc.upsertQuoteLineMethod,
    svc.upsertQuoteMaterialMakeMethod,
    svc.deleteQuoteMaterial,
    svc.runMRP
  ]) {
    fn.mockResolvedValue({ ...ok });
  }
  svc.buildMakeToOrderPriceRows.mockResolvedValue({ rows: [], error: null });
  svc.buildPullFromInventoryPriceRows.mockResolvedValue({
    rows: [],
    error: null
  });
  svc.buildPurchaseToOrderPriceRows.mockResolvedValue({
    rows: [{ quantity: 20 }],
    error: null
  });
});

const line = {
  quoteId: "q1",
  itemId: "item1",
  status: "Not Started",
  description: "Bracket",
  methodType: "Purchase to Order",
  unitOfMeasureCode: "EA",
  quantity: [5, 20],
  taxPercent: 0
} as never;

describe("updateQuoteLineWithPrices (sales_upsertQuoteLine update)", () => {
  it("prunes removed breaks and seeds added ones in the same transaction as the line", async () => {
    const serviceRole = makeClient({
      quoteLinePrice: [{ quantity: 5 }, { quantity: 10 }]
    });
    const result = await updateQuoteLineWithPrices(serviceRole as never, {
      companyId: "c1",
      quoteId: "q1",
      lineId: "l1",
      userId: "u1",
      line
    });
    expect(result.error).toBeNull();
    // 20 was added: seeded for the new item id carried in the input.
    expect(svc.buildPurchaseToOrderPriceRows).toHaveBeenCalledWith(
      serviceRole,
      "c1",
      "q1",
      "l1",
      [20],
      "u1",
      "item1"
    );
    // 10 was removed: pruned. Line, prune and seed all inside one transaction.
    expect(svc.kyselyWrites).toEqual([
      "update:quoteLine",
      "delete:quoteLinePrice",
      "insert:quoteLinePrice"
    ]);
  });

  it("writes nothing when pricing fails", async () => {
    svc.buildPurchaseToOrderPriceRows.mockResolvedValue({
      rows: [],
      error: { message: "no supplier price" }
    });
    const result = await updateQuoteLineWithPrices(
      makeClient({ quoteLinePrice: [] }) as never,
      { companyId: "c1", quoteId: "q1", lineId: "l1", userId: "u1", line }
    );
    expect(result.error?.message).toBe(
      "Failed to calculate Purchase to Order prices for new quantities"
    );
    expect(svc.kyselyWrites).toEqual([]);
  });
});

describe("createQuoteLineWithPrices (sales_upsertQuoteLine create)", () => {
  beforeEach(() => {
    svc.upsertQuoteLine.mockResolvedValue({ data: { id: "l9" }, error: null });
  });

  it("Purchase to Order seeds a price row per break", async () => {
    const client = makeClient();
    await createQuoteLineWithPrices(client as never, {
      companyId: "c1",
      quoteId: "q1",
      userId: "u1",
      line
    });
    expect(svc.resolvePurchaseToOrderPrices).toHaveBeenCalledWith(
      client,
      "c1",
      "q1",
      "l9",
      [5, 20],
      "u1"
    );
  });

  it("Make to Order pulls the item's method onto the line, then reprices", async () => {
    await createQuoteLineWithPrices(makeClient() as never, {
      companyId: "c1",
      quoteId: "q1",
      userId: "u1",
      line: { ...(line as object), methodType: "Make to Order" } as never
    });
    expect(svc.upsertQuoteLineMethod).toHaveBeenCalledWith(expect.anything(), {
      quoteId: "q1",
      quoteLineId: "l9",
      itemId: "item1",
      configuration: undefined,
      companyId: "c1",
      userId: "u1"
    });
    expect(svc.recalculateQuoteLinePrices).toHaveBeenCalledOnce();
  });

  it("forces the verified quote id onto the insert", async () => {
    await createQuoteLineWithPrices(makeClient() as never, {
      companyId: "c1",
      quoteId: "q1",
      userId: "u1",
      line: { ...(line as object), quoteId: "q-other" } as never
    });
    expect(svc.upsertQuoteLine.mock.calls[0]![1]).toMatchObject({
      quoteId: "q1",
      companyId: "c1",
      createdBy: "u1"
    });
  });

  it("reports a pricing failure with the created line id", async () => {
    svc.resolvePurchaseToOrderPrices.mockResolvedValue({
      error: { message: "boom" }
    });
    const result = await createQuoteLineWithPrices(makeClient() as never, {
      companyId: "c1",
      quoteId: "q1",
      userId: "u1",
      line
    });
    expect(result.data).toEqual({ id: "l9" });
    expect(result.error?.message).toBe(
      "Failed to resolve Purchase to Order prices"
    );
  });
});

const material = {
  quoteId: "q1",
  quoteLineId: "l1",
  quoteMakeMethodId: "qmm1",
  companyId: "c1",
  itemId: "sub1",
  itemType: "Part",
  methodType: "Make to Order",
  description: "Sub-assembly",
  order: 1,
  quantity: 1,
  unitCost: 0,
  kit: false
} as never;

describe("saveQuoteMaterialWithPrices (sales_upsertQuoteMaterial)", () => {
  beforeEach(() => {
    svc.upsertQuoteMaterial.mockResolvedValue({
      data: { id: "qm1", methodType: "Make to Order" },
      error: null
    });
    svc.SERVICE_ROLE = makeClient({
      quoteMaterialWithMakeMethodId: { quoteMaterialMakeMethodId: "child1" }
    });
  });

  it("a Make to Order create pulls the item's method into the child make method, then reprices", async () => {
    const result = await saveQuoteMaterialWithPrices(
      makeClient() as never,
      { ...(material as object), createdBy: "u1" } as never
    );
    expect(result.error).toBeNull();
    expect(svc.upsertQuoteMaterialMakeMethod).toHaveBeenCalledWith(
      svc.SERVICE_ROLE,
      { sourceId: "sub1", targetId: "child1", companyId: "c1", userId: "u1" }
    );
    expect(svc.recalculateQuoteLinePrices).toHaveBeenCalledWith(
      svc.SERVICE_ROLE,
      "c1",
      "q1",
      "l1",
      "u1"
    );
  });

  it("an update reprices without re-pulling (the update route never re-pulls)", async () => {
    await saveQuoteMaterialWithPrices(
      makeClient() as never,
      { ...(material as object), id: "qm1", updatedBy: "u1" } as never
    );
    expect(svc.upsertQuoteMaterialMakeMethod).not.toHaveBeenCalled();
    expect(svc.recalculateQuoteLinePrices).toHaveBeenCalledOnce();
  });

  it("a failed reprice is reported as the recalculate step with the saved material", async () => {
    svc.recalculateQuoteLinePrices.mockResolvedValue({
      error: { message: "no line" }
    });
    const result = await saveQuoteMaterialWithPrices(
      makeClient() as never,
      { ...(material as object), id: "qm1", updatedBy: "u1" } as never
    );
    expect(result.failedStep).toBe("recalculate");
    expect(result.data).toEqual({ id: "qm1", methodType: "Make to Order" });
  });
});

describe("quote operation commands (sales_upsertQuoteOperation / sales_deleteQuoteOperation)", () => {
  it("a write reprices the line on the service role", async () => {
    svc.upsertQuoteOperation.mockResolvedValue({
      data: { id: "qo1" },
      error: null
    });
    const client = makeClient();
    await saveQuoteOperationWithPrices(client as never, {
      quoteId: "q1",
      quoteLineId: "l1",
      companyId: "c1",
      createdBy: "u1"
    } as never);
    expect(svc.upsertQuoteOperation.mock.calls[0]![0]).toBe(client);
    expect(svc.recalculateQuoteLinePrices).toHaveBeenCalledWith(
      svc.SERVICE_ROLE,
      "c1",
      "q1",
      "l1",
      "u1"
    );
  });

  it("a delete reprices the operation's own line", async () => {
    const client = makeClient({
      quoteOperation: { quoteId: "q1", quoteLineId: "l1" }
    });
    const result = await deleteQuoteOperationWithPrices(client as never, {
      quoteOperationId: "qo1",
      companyId: "c1",
      userId: "u1"
    });
    expect(result.error).toBeNull();
    expect(client.writes).toEqual([
      { table: "quoteOperation", op: "delete", value: undefined }
    ]);
    expect(svc.recalculateQuoteLinePrices).toHaveBeenCalledWith(
      svc.SERVICE_ROLE,
      "c1",
      "q1",
      "l1",
      "u1"
    );
  });

  it("an unknown operation id is refused before anything is deleted", async () => {
    const client = makeClient();
    const result = await deleteQuoteOperationWithPrices(client as never, {
      quoteOperationId: "Q-OP-1",
      companyId: "c1",
      userId: "u1"
    });
    expect(result.error?.message).toBe("Quote operation not found");
    expect(client.writes).toEqual([]);
  });
});

describe("confirmSalesOrder (sales_releaseSalesOrder)", () => {
  beforeEach(() => {
    svc.SERVICE_ROLE = makeClient({
      salesOrder: { id: "so1", companyId: "c1", orderDate: null }
    });
  });

  it("derives the status from the lines, stamps the order date and runs MRP", async () => {
    svc.getSalesOrderLines.mockResolvedValue({
      data: [
        {
          salesOrderLineType: "Service",
          sentComplete: false,
          invoicedComplete: false
        }
      ],
      error: null
    });
    const client = makeClient();
    const result = await confirmSalesOrder(client as never, {
      salesOrderId: "so1",
      companyId: "c1",
      userId: "u1"
    });
    expect(result.error).toBeNull();
    const write = client.writes[0]!;
    expect(write.table).toBe("salesOrder");
    // A service-only order has nothing to ship.
    expect((write.value as { status: string }).status).toBe("To Invoice");
    expect((write.value as { orderDate: string }).orderDate).toMatch(
      /^\d{4}-\d{2}-\d{2}$/
    );
    expect(svc.runMRP).toHaveBeenCalledWith(
      svc.SERVICE_ROLE,
      expect.anything(),
      { type: "salesOrder", id: "so1", companyId: "c1", userId: "u1" }
    );
    expect(svc.trackWorkEvent).toHaveBeenCalledWith(
      "sales_order_confirmed",
      expect.objectContaining({ salesOrderId: "so1", emailed: false })
    );
  });

  it("refuses another company's order without writing", async () => {
    svc.SERVICE_ROLE = makeClient({
      salesOrder: { id: "so1", companyId: "other", orderDate: null }
    });
    const client = makeClient();
    const result = await confirmSalesOrder(client as never, {
      salesOrderId: "so1",
      companyId: "c1",
      userId: "u1"
    });
    expect(result.error).not.toBeNull();
    expect(client.writes).toEqual([]);
    expect(svc.runMRP).not.toHaveBeenCalled();
  });
});
