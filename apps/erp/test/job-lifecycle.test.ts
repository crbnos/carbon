// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

// The job header's status buttons: which status each starts from and goes to,
// what refuses it, and what is still reported when a step after the status
// change fails.

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
vi.mock("@carbon/lib/telemetry", () => ({ trackWorkEvent: vi.fn() }));
vi.mock("@carbon/lib/workflows", () => ({ raiseMoment: vi.fn() }));
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../app/modules/shared/shared.service", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../app/modules/shared/shared.service")
    >();
  // The postings the server functions package ran are the boundary; every
  // other posting runs its (mocked) body as before.
  const stubbed = new Set([
    "issue",
    "create",
    "batch-operations",
    "post-inventory-adjustment",
    "post-maintenance-event",
    "post-picking",
    "post-production-event",
    "recalculate",
    "reschedule",
    "trigger-rework"
  ]);
  return {
    ...actual,
    invokePosting: ((from: never, name: string, input: never, ...rest: never[]) =>
      stubbed.has(name)
        ? invoke(name, input)
        : (actual.invokePosting as (...args: unknown[]) => unknown)(
            from,
            name,
            input,
            ...rest
          )) as typeof actual.invokePosting,
    invokeCreate: (_from: unknown, input: unknown) => invoke("create", input)
  };
});
vi.mock("@carbon/planning", () => ({ runLocationSchedule: vi.fn() }));
vi.mock("../app/modules/production/production.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  recalculateJobRequirements: vi.fn(async () => ({ data: null, error: null })),
  runMRP: vi.fn(async () => ({ data: null, error: null })),
  returnPickedRemaindersForJob: vi.fn(async () => ({ data: {}, error: null })),
  upsertProductionQuantity: vi.fn(async () => ({
    data: { id: "pq1" },
    error: null
  }))
}));

import {
  returnPickedRemaindersForJob,
  upsertProductionQuantity
} from "../app/modules/production/production.service";
import {
  closeJob,
  completeJob,
  createProductionQuantity,
  pauseJob,
  reopenJob,
  resumeJob
} from "../app/modules/production/production.server";
import { createServiceContext } from "@carbon/api/service-fn.server";

/** Every status the job was moved to, with the statuses the move allowed. */
let statusWrites: { status: unknown; fromStatuses?: unknown }[] = [];

/** The user client: the job as read, its status writes, and the completion RPC's answer. */
function callerWith(
  job: Record<string, unknown> | null,
  rpc: { error: { message: string } | null } = { error: null }
) {
  const read: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) read[method] = () => read;
  read.maybeSingle = async () => ({ data: job, error: null });
  const update = (row: { status?: unknown }) => {
    const write = {
      eq: () => write,
      in: (_column: string, fromStatuses: unknown) => {
        statusWrites.push({ status: row.status, fromStatuses });
        return { select: async () => ({ data: [{ id: "j1" }], error: null }) };
      },
      then: (resolve: (value: unknown) => void) => {
        statusWrites.push({ status: row.status });
        resolve({ error: null });
      }
    };
    return write;
  };
  return {
    from: () => ({ ...read, update }),
    rpc: async () => ({ data: null, ...rpc })
  };
}

const contextWith = (caller: unknown) =>
  createServiceContext({
    actor: {
      type: "user",
      userId: "u1",
      permissions: {
        production: { view: [], create: ["c1"], update: ["c1"], delete: [] }
      }
    },
    company: { id: "c1", groupId: "g1" },
    caller: caller as never,
    system: () => ({}) as never,
    pg: () => ({}) as never,
    kv: () => ({}) as never
  });

const flips = () => statusWrites;

beforeEach(() => {
  vi.clearAllMocks();
  statusWrites = [];
  invoke.mockResolvedValue({ data: {}, error: null });
});

describe("pauseJob", () => {
  it("pauses a Ready or In Progress job, guarded on the same statuses", async () => {
    const result = await pauseJob(contextWith(callerWith({ status: "Ready" })), {
      jobId: "j1"
    });
    expect(result.error).toBeNull();
    expect(flips()).toEqual([
      { status: "Paused", fromStatuses: ["Ready", "In Progress"] }
    ]);
  });

  it("refuses a job that is not on the floor", async () => {
    const result = await pauseJob(contextWith(callerWith({ status: "Draft" })), {
      jobId: "j1"
    });
    expect(result.error?.category).toBe("rule");
    expect(flips()).toEqual([]);
  });

  it("refuses a job of another company as not found", async () => {
    const result = await pauseJob(contextWith(callerWith(null)), {
      jobId: "j1"
    });
    expect(result.error?.category).toBe("notFound");
  });
});

describe("resumeJob", () => {
  const paused = (overrides: Record<string, unknown> = {}) =>
    callerWith({
      status: "Paused",
      quantity: 2,
      salesOrderLineId: null,
      fixedAssetClassId: null,
      fixedAssetId: null,
      item: {
        itemTrackingType: "Inventory",
        itemReplenishment: { manufacturingBlocked: false }
      },
      ...overrides
    });

  it("puts a Paused job back to Ready", async () => {
    const result = await resumeJob(contextWith(paused()), { jobId: "j1" });
    expect(result.error).toBeNull();
    expect(flips()).toEqual([{ status: "Ready", fromStatuses: ["Paused"] }]);
  });

  it("refuses when manufacturing is blocked", async () => {
    const result = await resumeJob(
      contextWith(
        paused({
          item: {
            itemTrackingType: "Inventory",
            itemReplenishment: { manufacturingBlocked: true }
          }
        })
      ),
      { jobId: "j1" }
    );
    expect(result.error?.message).toBe("Manufacturing is blocked");
    expect(flips()).toEqual([]);
  });

  it("refuses a Make to Asset job whose item cannot complete to the asset class", async () => {
    const result = await resumeJob(
      contextWith(paused({ fixedAssetClassId: "fac1" })),
      { jobId: "j1" }
    );
    expect(result.error?.category).toBe("rule");
    expect(flips()).toEqual([]);
  });

  it("refuses a job that is not Paused", async () => {
    const result = await resumeJob(
      contextWith(paused({ status: "Draft" })),
      { jobId: "j1" }
    );
    expect(result.error?.category).toBe("rule");
  });
});

describe("reopenJob", () => {
  it.each([
    ["Cancelled", "Draft"],
    ["Completed", "In Progress"]
  ])("reopens a %s job as %s", async (from, to) => {
    await reopenJob(contextWith(callerWith({ status: from })), {
      jobId: "j1"
    });
    expect(flips()).toEqual([{ status: to, fromStatuses: [from] }]);
  });

  it("refuses a job that is still open", async () => {
    const result = await reopenJob(
      contextWith(callerWith({ status: "In Progress" })),
      { jobId: "j1" }
    );
    expect(result.error?.category).toBe("rule");
  });
});

describe("closeJob", () => {
  it("refuses a job that is not Completed, before any write-off", async () => {
    const result = await closeJob(
      contextWith(callerWith({ status: "In Progress" })),
      { jobId: "j1" }
    );
    expect(result.error?.category).toBe("rule");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps the job Closed and warns when the WIP write-off fails", async () => {
    invoke.mockResolvedValueOnce({ data: null, error: new Error("no WIP") });
    const result = await closeJob(
      contextWith(callerWith({ status: "Completed" })),
      { jobId: "j1" }
    );
    expect(result.error).toBeNull();
    expect(result.data?.warning).toBeTruthy();
    expect(flips()).toEqual([{ status: "Closed", fromStatuses: ["Completed"] }]);
  });
});

describe("completeJob", () => {
  const complete = (caller: unknown) =>
    completeJob(contextWith(caller), { jobId: "j1", quantityComplete: 5 });

  it("returns the database's refusal as a rule, and returns nothing picked", async () => {
    const result = await complete(
      callerWith(null, {
        error: { message: "Quantity is below what was received" }
      })
    );
    expect(result.error).toMatchObject({
      category: "rule",
      message: "Quantity is below what was received"
    });
    expect(returnPickedRemaindersForJob).not.toHaveBeenCalled();
  });

  it("keeps the completion and warns when returning picked material fails", async () => {
    vi.mocked(returnPickedRemaindersForJob).mockResolvedValueOnce({
      data: null,
      error: new Error("sweep failed")
    } as never);
    const result = await complete(callerWith(null));
    expect(result.error).toBeNull();
    expect(result.data?.warning).toBe(
      "Job completed, but returning picked material failed"
    );
  });
});

describe("createProductionQuantity", () => {
  const record = (jobStatus: string, type: "Production" | "Scrap") =>
    createProductionQuantity(
      contextWith(callerWith({ job: { status: jobStatus } })),
      {
        jobOperationId: "op1",
        type,
        scrapReasonId: "sr1",
        quantity: 3
      }
    );

  it("refuses a locked job", async () => {
    const result = await record("Completed", "Production");
    expect(result.error?.category).toBe("rule");
    expect(upsertProductionQuantity).not.toHaveBeenCalled();
  });

  it("keeps a scrap reason only on scrap", async () => {
    await record("In Progress", "Production");
    await record("In Progress", "Scrap");
    expect(
      vi
        .mocked(upsertProductionQuantity)
        .mock.calls.map(([, quantity]) => quantity.scrapReasonId)
    ).toEqual([undefined, "sr1"]);
  });
});
