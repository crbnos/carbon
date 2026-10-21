// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

// Production planning's writes: planning edits only this location's Draft or
// Planned jobs, a released job's suggestion goes to review, and a write that
// changed nothing says so.

vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => ({ id: strings.join("") })
}));
vi.mock("@carbon/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@carbon/env")>()),
  ASSEMBLER_SERVICE_URL: ""
}));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), warn: vi.fn() })
}));
vi.mock("@carbon/jobs", () => ({ trigger: vi.fn(), batchTrigger: vi.fn() }));
vi.mock("@carbon/planning", () => ({ runLocationSchedule: vi.fn() }));
vi.mock("../app/modules/production/production.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  dismissPlanningActions: vi.fn(),
  getPlanningActionsByIds: vi.fn(),
  markPlanningActionsActioned: vi.fn(),
  notifyScheduleInputsChanged: vi.fn(),
  recalculateJobRequirements: vi.fn(async () => ({ data: null, error: null })),
  updatePlanningJob: vi.fn(async () => ({ updated: true, error: null }))
}));

import {
  dismissPlanningActions,
  getPlanningActionsByIds,
  markPlanningActionsActioned,
  recalculateJobRequirements,
  updatePlanningJob
} from "../app/modules/production/production.service";
import {
  applyPlanningActions,
  dismissProductionPlanningActions,
  planJobFromPlanning,
  updatePlannedJob
} from "../app/modules/production/production.server";
import { createServiceContext } from "@carbon/api/service-fn.server";

type Job = {
  id: string;
  status: string;
  locationId: string;
  salesOrderId?: string | null;
  salesOrderLineId?: string | null;
};

/** The service role: the planning job read. */
function systemWithJob(job: Job | null) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) chain[method] = () => chain;
  chain.maybeSingle = async () => ({ data: job, error: null });
  return { from: () => chain };
}

/** Kysely: the jobs the actions target, as `{ id, status }` rows. */
function pgWithJobs(jobs: { id: string; status: string }[]) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "where"]) query[method] = () => query;
  query.execute = async () => jobs;
  return { selectFrom: () => query };
}

const contextWith = ({
  job = null,
  jobs = []
}: {
  job?: Job | null;
  jobs?: { id: string; status: string }[];
}) =>
  createServiceContext({
    actor: {
      type: "user",
      userId: "u1",
      permissions: {
        production: { view: [], create: [], update: ["c1"], delete: [] }
      }
    },
    company: { id: "c1", groupId: "g1" },
    caller: {} as never,
    system: () => systemWithJob(job) as never,
    pg: () => pgWithJobs(jobs) as never,
    kv: () => ({}) as never
  });

const draft = (overrides: Partial<Job> = {}): Job => ({
  id: "j1",
  status: "Draft",
  locationId: "loc1",
  ...overrides
});

beforeEach(() => vi.clearAllMocks());

describe("updatePlannedJob", () => {
  const edit = (job: Job | null) =>
    updatePlannedJob(contextWith({ job }), {
      locationId: "loc1",
      job: { id: "j1", field: "quantity", value: 5 }
    });

  it("refuses another location's job and a released one, before writing", async () => {
    expect((await edit(draft({ locationId: "loc2" }))).error?.category).toBe(
      "conflict"
    );
    expect((await edit(draft({ status: "Ready" }))).error?.category).toBe(
      "conflict"
    );
    expect(updatePlanningJob).not.toHaveBeenCalled();
  });

  it("keeps a saved quantity when the recalculation fails, and says so", async () => {
    vi.mocked(recalculateJobRequirements).mockResolvedValueOnce({
      data: null,
      error: new Error("recalc failed")
    } as never);
    const result = await edit(draft());
    expect(result.error).toBeNull();
    expect(result.data?.warning).toBeTruthy();
  });
});

describe("planJobFromPlanning", () => {
  it("refuses a job a sales order owns", async () => {
    const result = await planJobFromPlanning(
      contextWith({ job: draft({ salesOrderLineId: "sol1" }) }),
      { locationId: "loc1", jobId: "j1" }
    );
    expect(result.error).toMatchObject({
      category: "conflict",
      message: "This job is for a sales order. Plan it on the job."
    });
  });
});

describe("applyPlanningActions", () => {
  it("sends a released job's suggestion to review without claiming it", async () => {
    vi.mocked(getPlanningActionsByIds).mockResolvedValueOnce({
      data: [
        {
          id: "pa1",
          status: "Open",
          type: "Increase",
          jobId: "j1",
          suggestedQuantity: 10
        }
      ],
      error: null
    } as never);
    const result = await applyPlanningActions(
      contextWith({ jobs: [{ id: "j1", status: "In Progress" }] }),
      { planningActionIds: ["pa1", "pa1"] }
    );
    expect(result.data).toEqual({
      applied: [],
      requiresManualAction: [{ id: "pa1", jobId: "j1" }],
      warnings: [],
      errors: []
    });
    expect(markPlanningActionsActioned).not.toHaveBeenCalled();
  });

  it("keeps only the requested type", async () => {
    vi.mocked(getPlanningActionsByIds).mockResolvedValueOnce({
      data: [{ id: "pa1", status: "Open", type: "Defer", jobId: "j1" }],
      error: null
    } as never);
    const result = await applyPlanningActions(contextWith({ jobs: [] }), {
      planningActionIds: ["pa1"],
      type: "Cancel"
    });
    expect(result.data?.errors).toEqual([
      "Planning action pa1 is a Defer, not Cancel"
    ]);
  });
});

describe("dismissProductionPlanningActions", () => {
  it("is a conflict when every action changed since the page loaded", async () => {
    vi.mocked(dismissPlanningActions).mockResolvedValueOnce({
      data: [],
      error: null
    } as never);
    const result = await dismissProductionPlanningActions(contextWith({}), {
      planningActionIds: ["pa1"]
    });
    expect(result.error?.category).toBe("conflict");
  });

  it("counts what changed", async () => {
    vi.mocked(dismissPlanningActions).mockResolvedValueOnce({
      data: [{ id: "pa1" }],
      error: null
    } as never);
    const result = await dismissProductionPlanningActions(contextWith({}), {
      planningActionIds: ["pa1", "pa2"]
    });
    expect(result.data).toEqual({ changed: 1, requested: 2 });
  });
});
