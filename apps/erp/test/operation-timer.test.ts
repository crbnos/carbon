// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

// Shop-floor time belongs to the person who did the work. The API's timer
// Start and End run only for the caller's own sign-in; a key acts as its
// creator, who did not do the work.

vi.mock("@carbon/jobs", () => ({ trigger: vi.fn(), batchTrigger: vi.fn() }));
vi.mock("@carbon/lib/telemetry", () => ({ trackWorkEvent: vi.fn() }));
vi.mock("@carbon/lib/workflows", () => ({ raiseMoment: vi.fn() }));
vi.mock("@carbon/planning", () => ({
  runMrp: vi.fn(async () => null),
  runLocationSchedule: vi.fn()
}));

import { type Actor, createServiceContext } from "@carbon/api/service-fn.server";
import {
  endOperationTimer,
  startOperationTimer
} from "../app/modules/production/production.server";
import { pageClaims } from "./page-claims";

const permissions = pageClaims({
  production: { view: ["c1"], create: ["c1"], update: ["c1"], delete: [] }
});

type Row = Record<string, unknown>;

/** An in-memory client: keeps rows per table, applies the filters a query names, and records every table it touches and every write. */
function rowsClient(tables: Record<string, Row[]>) {
  const touched: string[] = [];
  const writes: { table: string; op: string; values: unknown }[] = [];
  const client = {
    from(table: string) {
      touched.push(table);
      let rows = [...(tables[table] ?? [])];
      let shape: "many" | "maybe" | "one" = "many";
      const query: Record<string, unknown> = {};
      const chain = () => query;
      for (const method of ["select", "order", "limit"]) query[method] = chain;
      query.eq = (column: string, value: unknown) => {
        rows = rows.filter((row) => row[column] === value);
        return query;
      };
      query.is = (column: string, value: unknown) => {
        rows = rows.filter((row) => (row[column] ?? null) === value);
        return query;
      };
      query.in = (column: string, values: unknown[]) => {
        rows = rows.filter((row) => values.includes(row[column]));
        return query;
      };
      query.neq = (column: string, value: unknown) => {
        rows = rows.filter((row) => row[column] !== value);
        return query;
      };
      for (const op of ["insert", "update"]) {
        query[op] = (values: Row) => {
          writes.push({ table, op, values });
          if (op === "insert") rows = [{ id: `${table}_new`, ...values }];
          return query;
        };
      }
      query.maybeSingle = () => {
        shape = "maybe";
        return query;
      };
      query.single = () => {
        shape = "one";
        return query;
      };
      query.then = (resolve: (value: unknown) => void) =>
        resolve({
          data: shape === "many" ? rows : (rows[0] ?? null),
          error: null
        });
      return query;
    }
  };
  return { client, touched, writes };
}

const contextAs = (actor: Actor, client: unknown) =>
  createServiceContext({
    actor,
    company: { id: "c1", groupId: "g1" },
    caller: client as never,
    system: () => client as never,
    pg: () => ({}) as never,
    kv: () => ({}) as never
  });

const apiKey: Actor = { type: "apiKey", createdBy: "u1", permissions };
const system: Actor = { type: "system", onBehalfOf: "u1" };
const user: Actor = { type: "user", userId: "u1", role: "employee", permissions };

/** One untracked operation of job j1, whose status is `jobStatus`. */
const released = (jobStatus = "Ready") => ({
  jobOperation: [
    {
      id: "op1",
      companyId: "c1",
      jobId: "j1",
      operationType: "Operation",
      jobOperationBatchId: null,
      workCenterId: null,
      processId: null,
      status: "Ready",
      priors: []
    }
  ],
  job: [{ id: "j1", companyId: "c1", status: jobStatus }]
});

describe("the API's shop-floor timer", () => {
  it.each([
    ["an API key", apiKey],
    ["the system", system]
  ])("refuses a Start from %s before reading anything", async (_, actor) => {
    const { client, touched } = rowsClient({});
    const result = await startOperationTimer(contextAs(actor, client), {
      jobOperationId: "op1",
      type: "Labor"
    });
    expect(result.error?.category).toBe("forbidden");
    expect(touched).toEqual([]);
  });

  it.each([
    ["an API key", apiKey],
    ["the system", system]
  ])("refuses an End from %s before reading anything", async (_, actor) => {
    const { client, touched } = rowsClient({});
    const result = await endOperationTimer(contextAs(actor, client), {
      productionEventId: "ev1"
    });
    expect(result.error?.category).toBe("forbidden");
    expect(touched).toEqual([]);
  });

  it("runs a signed-in user's Start through the floor rule", async () => {
    const { client, touched } = rowsClient(released("Planned"));
    const result = await startOperationTimer(contextAs(user, client), {
      jobOperationId: "op1",
      type: "Labor"
    });
    expect(result.error?.category).toBe("rule");
    expect(touched).toContain("job");
    expect(touched).not.toContain("productionEvent");
  });

  it("records a signed-in user's time against that user", async () => {
    const { client, writes } = rowsClient(released());
    const result = await startOperationTimer(contextAs(user, client), {
      jobOperationId: "op1",
      type: "Labor"
    });
    expect(result.error).toBeNull();
    expect(
      writes.filter((w) => w.table === "productionEvent" && w.op === "insert")
    ).toEqual([
      {
        table: "productionEvent",
        op: "insert",
        values: expect.objectContaining({
          jobOperationId: "op1",
          type: "Labor",
          employeeId: "u1",
          createdBy: "u1",
          companyId: "c1"
        })
      }
    ]);
  });

  // Batch completion closes and costs only the events tagged with its batch.
  it.each([
    ["Active", "bat1"],
    ["Completing", "bat1"],
    ["Completed", undefined]
  ])("tags a Start on a member of a %s batch with %s", async (status, tag) => {
    const tables = released("Planned");
    tables.jobOperation[0]!.jobOperationBatchId = "bat1" as never;
    const { client, writes } = rowsClient({
      ...tables,
      jobOperationBatch: [{ id: "bat1", companyId: "c1", status }]
    });
    const result = await startOperationTimer(contextAs(user, client), {
      jobOperationId: "op1",
      type: "Labor"
    });
    expect(result.error).toBeNull();
    const insert = writes.find(
      (w) => w.table === "productionEvent" && w.op === "insert"
    );
    expect((insert?.values as Row).jobOperationBatchId).toBe(tag);
  });

  it("leaves a Start on an unbatched operation untagged", async () => {
    const { client, writes } = rowsClient(released());
    await startOperationTimer(contextAs(user, client), {
      jobOperationId: "op1",
      type: "Labor"
    });
    const insert = writes.find(
      (w) => w.table === "productionEvent" && w.op === "insert"
    );
    expect((insert?.values as Row).jobOperationBatchId).toBeUndefined();
  });
});
