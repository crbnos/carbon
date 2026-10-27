// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";

// Production planning's writes: planning edits only this location's Draft or
// Planned jobs, a released job's suggestion goes to review, and a write that
// changed nothing says so.

import {
  applyPlanningActions,
  planJobFromPlanning,
  updatePlannedJob
} from "../app/modules/production/production.server";
import { changedPlanningActions } from "../app/modules/production/production.service";
import { createServiceContext } from "@carbon/api/service-fn.server";

type Job = {
  id: string;
  status: string;
  locationId: string;
  salesOrderId?: string | null;
  salesOrderLineId?: string | null;
};

/** Supabase: each table's one row, whatever the filter; updates are recorded. */
function supabaseWith(rows: Record<string, unknown>, writes: string[]) {
  return {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in"]) chain[method] = () => chain;
      chain.update = () => {
        writes.push(`update ${table}`);
        return chain;
      };
      const row = () => ({ data: rows[table] ?? null, error: null });
      chain.maybeSingle = async () => row();
      chain.single = async () => row();
      chain.then = (resolve: (value: unknown) => unknown) =>
        resolve({ data: rows[table] ? [rows[table]] : [], error: null });
      return chain;
    }
  };
}

/** Kysely: each table's rows, whatever the filter; updates are recorded. */
function kyselyWith(rows: Record<string, unknown[]>, writes: string[]) {
  const query = (result: () => unknown[]) => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "selectAll", "where", "set", "returning"]) {
      chain[method] = () => chain;
    }
    chain.execute = async () => result();
    return chain;
  };
  return {
    selectFrom: (table: string) => query(() => rows[table] ?? []),
    updateTable: (table: string) => {
      writes.push(`update ${table}`);
      return query(() => []);
    }
  };
}

function planning({
  job = null,
  planningAction = [],
  jobs = []
}: {
  job?: Job | null;
  planningAction?: Record<string, unknown>[];
  jobs?: { id: string; status: string }[];
}) {
  const writes: string[] = [];
  const ctx = createServiceContext({
    actor: {
      type: "user",
      userId: "u1",
      permissions: {
        production: { view: [], create: [], update: ["c1"], delete: [] }
      }
    },
    company: { id: "c1", groupId: "g1" },
    caller: {} as never,
    system: () => supabaseWith({ job }, writes) as never,
    pg: () => kyselyWith({ planningAction, job: jobs }, writes) as never,
    kv: () => ({}) as never
  });
  return { ctx, writes };
}

const draft = (overrides: Partial<Job> = {}): Job => ({
  id: "j1",
  status: "Draft",
  locationId: "loc1",
  ...overrides
});

describe("updatePlannedJob", () => {
  const edit = (job: Job) => {
    const { ctx, writes } = planning({ job });
    const result = updatePlannedJob(ctx, {
      locationId: "loc1",
      job: { id: "j1", field: "quantity", value: 5 }
    });
    return { result, writes };
  };

  it.each([
    ["another location's job", draft({ locationId: "loc2" })],
    ["a released job", draft({ status: "Ready" })]
  ])("refuses %s before writing", async (_case, job) => {
    const { result, writes } = edit(job);
    expect((await result).error?.category).toBe("conflict");
    expect(writes).toEqual([]);
  });

  // The recalculation runs against the database, which this test has none of.
  it("keeps a saved quantity when the recalculation fails, and says so", async () => {
    const { result, writes } = edit(draft());
    expect(await result).toEqual({
      data: { id: "j1", warning: expect.any(String) },
      error: null
    });
    expect(writes).toEqual(["update job"]);
  });
});

describe("planJobFromPlanning", () => {
  it("refuses a Draft job a sales order owns", async () => {
    const { ctx } = planning({ job: draft({ salesOrderLineId: "sol1" }) });
    const result = await planJobFromPlanning(ctx, {
      locationId: "loc1",
      jobId: "j1"
    });
    expect(result.error?.category).toBe("conflict");
  });
});

describe("applyPlanningActions", () => {
  it("sends a released job's suggestion to review without claiming it", async () => {
    const { ctx, writes } = planning({
      planningAction: [
        {
          id: "pa1",
          status: "Open",
          type: "Increase",
          jobId: "j1",
          suggestedQuantity: 10
        }
      ],
      jobs: [{ id: "j1", status: "In Progress" }]
    });
    const result = await applyPlanningActions(ctx, {
      planningActionIds: ["pa1", "pa1"]
    });
    expect(result.data).toEqual({
      applied: [],
      requiresManualAction: [{ id: "pa1", jobId: "j1" }],
      warnings: [],
      errors: []
    });
    expect(writes).toEqual([]);
  });

  it("refuses an action of another type than the one requested", async () => {
    const { ctx } = planning({
      planningAction: [{ id: "pa1", status: "Open", type: "Defer", jobId: "j1" }]
    });
    const result = await applyPlanningActions(ctx, {
      planningActionIds: ["pa1"],
      type: "Cancel"
    });
    expect(result.data).toEqual({
      applied: [],
      requiresManualAction: [],
      warnings: [],
      errors: ["Planning action pa1 is a Defer, not Cancel"]
    });
  });
});

describe("changedPlanningActions", () => {
  const { ctx } = planning({});

  it("is a conflict when every action changed since the page loaded", () => {
    expect(
      changedPlanningActions(ctx, { data: [], error: null }, 1, "dismiss")
    ).toMatchObject({ category: "conflict" });
  });

  it("counts what changed of what was requested", () => {
    expect(
      changedPlanningActions(ctx, { data: [{ id: "pa1" }], error: null }, 2, "dismiss")
    ).toEqual({ changed: 1, requested: 2 });
  });
});
