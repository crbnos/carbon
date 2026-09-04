import type { Database } from "@carbon/database";
import {
  entityValue,
  type RuntimeValue,
  WORKFLOW_OPERATIONS
} from "@carbon/workflows";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { runOperation } from "./operations";

interface Call {
  table: string;
  columns?: string;
  head: boolean;
  eq: Record<string, unknown>;
  in: Record<string, unknown>;
  order?: { column: string; ascending?: boolean };
}

interface StubResult {
  /** What `.maybeSingle()` resolves `data` to. */
  row?: Record<string, unknown> | null;
  /** What awaiting the builder resolves `data` to. */
  rows?: Record<string, unknown>[] | null;
  count?: number | null;
  error?: unknown;
}

/** A chainable stand-in for the owner's client that records how it was queried. */
function stubClient(result: StubResult = {}) {
  const calls: Call[] = [];

  const from = (table: string) => {
    const call: Call = { table, head: false, eq: {}, in: {} };
    calls.push(call);

    const settle = () => ({
      data: result.rows ?? null,
      count: result.count ?? null,
      error: result.error ?? null
    });

    const builder = {
      select(columns: string, options?: { head?: boolean }) {
        call.columns = columns;
        call.head = options?.head === true;
        return builder;
      },
      eq(column: string, value: unknown) {
        call.eq[column] = value;
        return builder;
      },
      in(column: string, value: unknown) {
        call.in[column] = value;
        return builder;
      },
      not() {
        return builder;
      },
      order(column: string, options?: { ascending?: boolean }) {
        call.order = { column, ascending: options?.ascending };
        return builder;
      },
      limit() {
        return builder;
      },
      maybeSingle: async () => ({
        data: result.row ?? null,
        error: result.error ?? null
      }),
      then: (
        onFulfilled: (value: ReturnType<typeof settle>) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) => Promise.resolve(settle()).then(onFulfilled, onRejected)
    };

    return builder;
  };

  return {
    client: { from } as unknown as SupabaseClient<Database>,
    calls
  };
}

function firstCall(calls: Call[]): Call {
  const call = calls[0];
  if (call === undefined) throw new Error("the operation read nothing");
  return call;
}

const COMPANY = "co1";

async function run(
  operationId: string,
  entity: string,
  recordId: string,
  result?: StubResult
) {
  const { client, calls } = stubClient(result);
  const inputs: Record<string, RuntimeValue> = {
    [entity]: entityValue(entity, recordId)
  };
  const outcome = await runOperation({
    client,
    companyId: COMPANY,
    operationId,
    inputs
  });
  return { outcome, calls };
}

describe("stored totals", () => {
  it("reads a purchase order total off the view", async () => {
    const { outcome, calls } = await run(
      "purchaseOrder.total",
      "purchaseOrder",
      "po1",
      { row: { orderTotal: 1250.5 } }
    );

    expect(outcome).toEqual({
      ok: true,
      value: { kind: "primitive", of: "number", value: 1250.5 }
    });
    expect(firstCall(calls).table).toBe("purchaseOrders");
    expect(firstCall(calls).eq).toEqual({ id: "po1", companyId: COMPANY });
  });

  it("reads a sales order total off the view", async () => {
    const { outcome, calls } = await run(
      "salesOrder.total",
      "salesOrder",
      "so1",
      { row: { orderTotal: 42 } }
    );

    expect(outcome).toEqual({
      ok: true,
      value: { kind: "primitive", of: "number", value: 42 }
    });
    expect(firstCall(calls).table).toBe("salesOrders");
  });

  it("refuses rather than inventing a total for a record it cannot find", async () => {
    const { outcome } = await run(
      "purchaseOrder.total",
      "purchaseOrder",
      "gone",
      { row: null }
    );
    expect(outcome).toEqual({
      ok: false,
      error: "We could not find that record."
    });
  });

  it("refuses a quote total, which no single read can answer", async () => {
    const { outcome, calls } = await run("quote.total", "quote", "q1");
    expect(outcome.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("line counts", () => {
  const cases = [
    {
      id: "purchaseOrder.lineCount",
      entity: "purchaseOrder",
      table: "purchaseOrderLine",
      parent: "purchaseOrderId"
    },
    {
      id: "salesOrder.lineCount",
      entity: "salesOrder",
      table: "salesOrderLine",
      parent: "salesOrderId"
    },
    {
      id: "receipt.lineCount",
      entity: "receipt",
      table: "receiptLine",
      parent: "receiptId"
    },
    {
      id: "shipment.lineCount",
      entity: "shipment",
      table: "shipmentLine",
      parent: "shipmentId"
    }
  ];

  for (const { id, entity, table, parent } of cases) {
    it(`counts ${table} rows for its parent`, async () => {
      const { outcome, calls } = await run(id, entity, "p1", { count: 7 });

      expect(outcome).toEqual({
        ok: true,
        value: { kind: "primitive", of: "number", value: 7 }
      });
      expect(firstCall(calls).table).toBe(table);
      expect(firstCall(calls).head).toBe(true);
      expect(firstCall(calls).eq).toEqual({
        [parent]: "p1",
        companyId: COMPANY
      });
    });
  }

  it("reads no rows back when the count is missing", async () => {
    const { outcome } = await run("receipt.lineCount", "receipt", "r1", {
      count: null
    });
    expect(outcome).toEqual({
      ok: true,
      value: { kind: "primitive", of: "number", value: 0 }
    });
  });
});

describe("job operations", () => {
  it("sums scrap across the job's operations", async () => {
    const { outcome, calls } = await run(
      "job.totalScrapQuantity",
      "job",
      "j1",
      {
        rows: [
          { quantityScrapped: 3 },
          { quantityScrapped: null },
          { quantityScrapped: 2 }
        ]
      }
    );

    expect(outcome).toEqual({
      ok: true,
      value: { kind: "primitive", of: "number", value: 5 }
    });
    expect(firstCall(calls).table).toBe("jobOperation");
    expect(firstCall(calls).eq).toEqual({ jobId: "j1", companyId: COMPANY });
  });

  it("turns that scrap into a percentage of the job quantity", async () => {
    const { outcome, calls } = await run("job.scrapPercentage", "job", "j1", {
      rows: [{ quantityScrapped: 5 }],
      row: { quantity: 20 }
    });

    expect(outcome).toEqual({
      ok: true,
      value: { kind: "primitive", of: "number", value: 25 }
    });
    expect(calls.map((call) => call.table)).toEqual(["jobOperation", "job"]);
  });

  it("returns zero rather than dividing by a zero job quantity", async () => {
    const { outcome } = await run("job.scrapPercentage", "job", "j1", {
      rows: [{ quantityScrapped: 5 }],
      row: { quantity: 0 }
    });

    expect(outcome).toEqual({
      ok: true,
      value: { kind: "primitive", of: "number", value: 0 }
    });
  });

  it("counts every operation on the job", async () => {
    const { outcome, calls } = await run("job.operationCount", "job", "j1", {
      count: 4
    });

    expect(outcome).toEqual({
      ok: true,
      value: { kind: "primitive", of: "number", value: 4 }
    });
    expect(firstCall(calls).in).toEqual({});
  });

  it("counts only the operations that are not finished", async () => {
    const { outcome, calls } = await run(
      "job.openOperationCount",
      "job",
      "j1",
      {
        count: 2
      }
    );

    expect(outcome).toEqual({
      ok: true,
      value: { kind: "primitive", of: "number", value: 2 }
    });
    const statuses = firstCall(calls).in.status as string[];
    expect(statuses).toContain("Todo");
    expect(statuses).toContain("In Progress");
    expect(statuses).not.toContain("Done");
    expect(statuses).not.toContain("Canceled");
  });

  it("reads the earliest scheduled start as a date", async () => {
    const { outcome, calls } = await run(
      "job.earliestOperationStart",
      "job",
      "j1",
      { row: { startDate: "2026-03-04" } }
    );

    expect(outcome).toEqual({
      ok: true,
      value: {
        kind: "primitive",
        of: "date",
        value: new Date("2026-03-04").toISOString()
      }
    });
    expect(firstCall(calls).order).toEqual({
      column: "startDate",
      ascending: true
    });
  });

  it("reads the latest scheduled end as a date", async () => {
    const { outcome, calls } = await run(
      "job.latestOperationEnd",
      "job",
      "j1",
      { row: { dueDate: "2026-05-06" } }
    );

    expect(outcome).toEqual({
      ok: true,
      value: {
        kind: "primitive",
        of: "date",
        value: new Date("2026-05-06").toISOString()
      }
    });
    expect(firstCall(calls).order).toEqual({
      column: "dueDate",
      ascending: false
    });
  });

  it("says nothing rather than a made-up date when no operation is scheduled", async () => {
    const { outcome } = await run("job.earliestOperationStart", "job", "j1", {
      row: null
    });
    expect(outcome).toEqual({
      ok: true,
      value: { kind: "primitive", of: "null", value: null }
    });
  });
});

describe("the remaining reads", () => {
  it("counts an issue's unfinished tasks", async () => {
    const { outcome, calls } = await run(
      "nonConformance.openTaskCount",
      "nonConformance",
      "nc1",
      { count: 3 }
    );

    expect(outcome).toEqual({
      ok: true,
      value: { kind: "primitive", of: "number", value: 3 }
    });
    expect(firstCall(calls).table).toBe("nonConformanceActionTask");
    expect(firstCall(calls).eq).toEqual({
      nonConformanceId: "nc1",
      companyId: COMPANY
    });
    expect(firstCall(calls).in.status).toEqual(["Pending", "In Progress"]);
  });

  it("sums an item's quantity on hand across locations", async () => {
    const { outcome, calls } = await run("item.quantityOnHand", "item", "i1", {
      rows: [{ quantityOnHand: 10 }, { quantityOnHand: 2.5 }]
    });

    expect(outcome).toEqual({
      ok: true,
      value: { kind: "primitive", of: "number", value: 12.5 }
    });
    expect(firstCall(calls).table).toBe("itemStockQuantities");
    expect(firstCall(calls).eq).toEqual({ itemId: "i1", companyId: COMPANY });
  });
});

describe("the dispatcher", () => {
  it("refuses an id it has no implementation for", async () => {
    const { client } = stubClient();
    const outcome = await runOperation({
      client,
      companyId: COMPANY,
      operationId: "purchaseOrder.vibes",
      inputs: {}
    });

    expect(outcome).toEqual({
      ok: false,
      error: "This calculation is no longer available."
    });
  });

  it("refuses when the record it works on was not supplied", async () => {
    const { client } = stubClient();
    const outcome = await runOperation({
      client,
      companyId: COMPANY,
      operationId: "purchaseOrder.total",
      inputs: { purchaseOrder: { kind: "primitive", of: "null", value: null } }
    });

    expect(outcome).toEqual({
      ok: false,
      error: "This calculation needs a record to work from."
    });
  });

  it("fails rather than throws when the read blows up", async () => {
    const exploding = {
      from: () => {
        throw new Error("connection reset");
      }
    } as unknown as SupabaseClient<Database>;

    const outcome = await runOperation({
      client: exploding,
      companyId: COMPANY,
      operationId: "job.operationCount",
      inputs: { job: entityValue("job", "j1") }
    });

    expect(outcome.ok).toBe(false);
  });

  it("scopes every read by companyId", async () => {
    for (const [operationId, declaration] of Object.entries(
      WORKFLOW_OPERATIONS
    )) {
      const { calls } = await run(operationId, declaration.entity, "record-1", {
        row: { quantity: 1, orderTotal: 1 },
        rows: [],
        count: 0
      });

      for (const call of calls) {
        expect(
          call.eq.companyId,
          `${operationId} read ${call.table} unscoped`
        ).toBe(COMPANY);
      }
    }
  });

  it("has an implementation for every declared operation but the quote total", async () => {
    const refused: string[] = [];

    for (const [operationId, declaration] of Object.entries(
      WORKFLOW_OPERATIONS
    )) {
      const { outcome } = await run(
        operationId,
        declaration.entity,
        "record-1",
        { row: { quantity: 1, orderTotal: 1 }, rows: [], count: 0 }
      );
      if (!outcome.ok) refused.push(operationId);
    }

    expect(refused).toEqual(["quote.total"]);
  });
});
