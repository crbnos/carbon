// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import {
  entityValue,
  type RuntimeValue,
  WORKFLOW_OPERATIONS
} from "@carbon/ee/workflows";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { runOperation } from "./operations";

interface Call {
  table: string;
  eq: Record<string, unknown>;
}

interface StubResult {
  /** What `.maybeSingle()` resolves `data` to. */
  row?: Record<string, unknown> | null;
  /** What awaiting the builder resolves `data` to. */
  rows?: Record<string, unknown>[] | null;
  count?: number | null;
  error?: unknown;
}

/** A chainable stand-in for the owner's client; it records the `eq` filters for the scoping check. */
function stubClient(result: StubResult = {}) {
  const calls: Call[] = [];

  const from = (table: string) => {
    const call: Call = { table, eq: {} };
    calls.push(call);

    const settle = () => ({
      data: result.rows ?? null,
      count: result.count ?? null,
      error: result.error ?? null
    });

    const builder = {
      select: () => builder,
      eq(column: string, value: unknown) {
        call.eq[column] = value;
        return builder;
      },
      in: () => builder,
      not: () => builder,
      order: () => builder,
      limit: () => builder,
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

const number = (value: number) => ({
  ok: true,
  value: { kind: "primitive", of: "number", value }
});

describe("stored totals", () => {
  it.each([
    ["purchaseOrder.total", "purchaseOrder"],
    ["salesOrder.total", "salesOrder"]
  ])("reads %s off the order view", async (operationId, entity) => {
    const { outcome } = await run(operationId, entity, "o1", {
      row: { orderTotal: 1250.5 }
    });
    expect(outcome).toEqual(number(1250.5));
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

  it("refuses a quote total without reading anything", async () => {
    // A quote prices several quantity breaks; no single read can answer it.
    const { outcome, calls } = await run("quote.total", "quote", "q1");
    expect(outcome.ok).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("counts", () => {
  it.each([
    ["purchaseOrder.lineCount", "purchaseOrder"],
    ["salesOrder.lineCount", "salesOrder"],
    ["receipt.lineCount", "receipt"],
    ["shipment.lineCount", "shipment"],
    ["job.operationCount", "job"],
    ["job.openOperationCount", "job"],
    ["nonConformance.openTaskCount", "nonConformance"]
  ])("returns the row count for %s", async (operationId, entity) => {
    const { outcome } = await run(operationId, entity, "p1", { count: 7 });
    expect(outcome).toEqual(number(7));
  });

  it("reads a missing count as zero", async () => {
    const { outcome } = await run("receipt.lineCount", "receipt", "r1", {
      count: null
    });
    expect(outcome).toEqual(number(0));
  });

  it("fails when the count read errors", async () => {
    const { outcome } = await run("receipt.lineCount", "receipt", "r1", {
      error: { message: "denied" }
    });
    expect(outcome).toEqual({
      ok: false,
      error: "We could not read the records this calculation needs."
    });
  });
});

describe("job scrap", () => {
  const scrapped = [
    { quantityScrapped: 3 },
    { quantityScrapped: null },
    { quantityScrapped: 2 }
  ];

  it("sums scrap across the job's operations, reading null as zero", async () => {
    const { outcome } = await run("job.totalScrapQuantity", "job", "j1", {
      rows: scrapped
    });
    expect(outcome).toEqual(number(5));
  });

  it.each([
    [20, 25],
    // A job that makes nothing cannot have scrapped a proportion of it.
    [0, 0]
  ])(
    "gives 5 scrapped on a job of %i as %i percent",
    async (quantity, percent) => {
      const { outcome } = await run("job.scrapPercentage", "job", "j1", {
        rows: scrapped,
        row: { quantity }
      });
      expect(outcome).toEqual(number(percent));
    }
  );
});

describe("job schedule dates", () => {
  it.each([
    ["job.earliestOperationStart", { startDate: "2026-03-04" }],
    ["job.latestOperationEnd", { dueDate: "2026-03-04" }]
  ])("reads %s as a date", async (operationId, row) => {
    const { outcome } = await run(operationId, "job", "j1", { row });
    expect(outcome).toEqual({
      ok: true,
      value: {
        kind: "primitive",
        of: "date",
        value: "2026-03-04T00:00:00.000Z"
      }
    });
  });

  it.each(["job.earliestOperationStart", "job.latestOperationEnd"])(
    "returns null rather than a made-up date when %s finds no scheduled operation",
    async (operationId) => {
      const { outcome } = await run(operationId, "job", "j1", { row: null });
      expect(outcome).toEqual({
        ok: true,
        value: { kind: "primitive", of: "null", value: null }
      });
    }
  );
});

it("sums an item's quantity on hand across locations", async () => {
  const { outcome } = await run("item.quantityOnHand", "item", "i1", {
    rows: [{ quantityOnHand: 10 }, { quantityOnHand: 2.5 }]
  });
  expect(outcome).toEqual(number(12.5));
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
