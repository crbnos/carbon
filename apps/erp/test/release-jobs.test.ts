// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

// The service's imports now reach the glossary, whose `msg` macro only runs compiled.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => ({ id: strings.join("") })
}));
vi.mock("@carbon/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@carbon/env")>()),
  ASSEMBLER_SERVICE_URL: ""
}));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn() })
}));
const { invoke, events } = vi.hoisted(() => ({
  // The `create` server function: purchase orders for outside operations.
  invoke: vi.fn(),
  // What reached the outside world, in order.
  events: [] as string[]
}));
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
vi.mock("@carbon/planning", () => ({
  runLocationSchedule: vi.fn(async () => {
    events.push("schedule");
  })
}));
vi.mock("../app/modules/production/production.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getJobReleaseReadiness: vi.fn(),
  recalculateJobRequirements: vi.fn(async () => ({ data: null, error: null })),
  runMRP: vi.fn(async () => ({ data: null, error: null })),
  updateJobStatus: vi.fn(async (_client, { id }) => {
    events.push(`ready:${id}`);
    return { error: null, updated: true };
  }),
  releaseJobOperationBatch: vi.fn(async (_client, _db, { batchId }) => {
    events.push(`batch:${batchId}`);
    return { data: null, error: null };
  }),
  notifyScheduleInputsChanged: vi.fn(async () => {
    events.push("notify");
  })
}));

import { runLocationSchedule } from "@carbon/planning";
import {
  getJobReleaseReadiness,
  recalculateJobRequirements,
  runMRP,
  updateJobStatus
} from "../app/modules/production/production.service";
import {
  planDraftJob,
  releaseBatches,
  releaseCheckedJobs,
  releaseJobs
} from "../app/modules/production/production.server";
import { createServiceContext } from "@carbon/api/service-fn.server";

const contextFor = (client: any) =>
  createServiceContext({
    actor: {
      type: "user",
      userId: "user-1",
      permissions: {
        production: { view: [], create: [], update: ["company-1"], delete: [] }
      }
    },
    company: { id: "company-1", groupId: "group-1" },
    caller: client,
    system: () => ({}) as any,
    pg: () => ({}) as any,
    kv: () => ({}) as any
  });

// The release-date write: a chainable, thenable stand-in for the user client.
function clientWith(stamp: { error: null | { message: string } }) {
  const chain: Record<string, any> = {};
  for (const method of ["update", "eq"]) chain[method] = () => chain;
  chain.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data: null, ...stamp }).then(resolve);
  return { from: () => chain } as any;
}

const release = (client: any, jobIds = ["job-1"]) =>
  releaseCheckedJobs(contextFor(client), {
    jobIds,
    purchaseOrdersBySupplierId: {}
  });

beforeEach(() => {
  vi.clearAllMocks();
  events.length = 0;
  invoke.mockResolvedValue({
    data: { purchaseOrderIdsBySupplierId: {} },
    error: null
  });
  vi.mocked(updateJobStatus).mockImplementation(async (_client, { id }) => {
    events.push(`ready:${id}`);
    return { error: null, updated: true } as any;
  });
});

describe("releaseCheckedJobs", () => {
  it("releases past a failed MRP run", async () => {
    vi.mocked(runMRP).mockResolvedValueOnce({
      data: null,
      error: new Error("planning blew up")
    });
    const result = await release(clientWith({ error: null }));
    expect(result.data).toEqual({
      failure: null,
      purchaseOrdersBySupplierId: {},
      releasedJobIds: ["job-1"]
    });
  });

  it("flips only a job still Draft or Planned, and stops when it is not", async () => {
    vi.mocked(updateJobStatus).mockResolvedValueOnce({
      error: null,
      updated: false
    } as any);
    const result = await release(clientWith({ error: null }), [
      "job-1",
      "job-2"
    ]);
    expect(vi.mocked(updateJobStatus).mock.calls[0]?.[1]).toMatchObject({
      status: "Ready",
      fromStatuses: ["Draft", "Planned"]
    });
    expect(result.data).toMatchObject({
      failure: {
        category: "conflict",
        message: "The job is no longer Draft or Planned"
      },
      purchaseOrdersBySupplierId: {},
      releasedJobIds: []
    });
  });

  it("reports a failed release-date write on a job that is released", async () => {
    const result = await release(
      clientWith({ error: { message: "connection reset" } })
    );
    expect(result.data).toMatchObject({
      failure: {
        message: "The job is released, but its release date could not be saved"
      },
      purchaseOrdersBySupplierId: {},
      releasedJobIds: ["job-1"]
    });
  });
});

// The planning drawer's Plan on a Draft job follows releaseJobs' order: MRP
// must never count a job as supply while its requirements are stale.
describe("planDraftJob", () => {
  // The user client: the job's status, read before anything runs.
  const jobWithStatus = (status: string) => {
    const chain: Record<string, any> = {};
    for (const method of ["select", "eq"]) chain[method] = () => chain;
    chain.maybeSingle = async () => ({ data: { status }, error: null });
    return { from: () => chain } as any;
  };
  const plan = (status = "Draft") =>
    planDraftJob(contextFor(jobWithStatus(status)), { jobId: "job-1" });

  it("refuses a job that is not Draft before recalculating it", async () => {
    expect((await plan("Planned")).error?.category).toBe("conflict");
    expect(recalculateJobRequirements).not.toHaveBeenCalled();
  });

  it("recalculates, flips only from Draft, then runs MRP", async () => {
    const order: string[] = [];
    vi.mocked(recalculateJobRequirements).mockImplementationOnce(async () => {
      order.push("recalculate");
      return { data: null, error: null } as any;
    });
    vi.mocked(updateJobStatus).mockImplementationOnce(async () => {
      order.push("flip");
      return { error: null, updated: true } as any;
    });
    vi.mocked(runMRP).mockImplementationOnce(async () => {
      order.push("mrp");
      return { data: null, error: null } as any;
    });

    expect(await plan()).toEqual({ data: { warning: null }, error: null });
    expect(order).toEqual(["recalculate", "flip", "mrp"]);
    expect(vi.mocked(updateJobStatus).mock.calls[0]?.[1]).toMatchObject({
      status: "Planned",
      fromStatuses: ["Draft"]
    });
  });

  it("leaves the job Draft, and runs no MRP, when the recalculation fails", async () => {
    vi.mocked(recalculateJobRequirements).mockResolvedValueOnce({
      data: null,
      error: { message: "boom" }
    } as any);

    const result = await plan();
    expect(result.error?.category).toBe("internal");
    expect(updateJobStatus).not.toHaveBeenCalled();
    expect(runMRP).not.toHaveBeenCalled();
  });

  it("runs no MRP when the job is no longer Draft", async () => {
    vi.mocked(updateJobStatus).mockResolvedValueOnce({
      error: null,
      updated: false
    } as any);

    expect((await plan()).error?.category).toBe("conflict");
    expect(runMRP).not.toHaveBeenCalled();
  });

  it("keeps the job Planned and warns when MRP fails", async () => {
    vi.mocked(runMRP).mockResolvedValueOnce({
      data: null,
      error: new Error("planning blew up")
    });

    const result = await plan();
    expect(result.error).toBeNull();
    expect(result.data?.warning).toBeTruthy();
  });
});

type JobRow = {
  id: string;
  jobId: string;
  status: string;
  locationId: string;
};

const job = (id: string, overrides: Partial<JobRow> = {}): JobRow => ({
  id,
  jobId: id.toUpperCase(),
  status: "Planned",
  locationId: "location-1",
  ...overrides
});

const ready = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  jobId: id.toUpperCase(),
  status: "Planned" as const,
  manufacturingBlocked: false,
  nothingToMake: false,
  makeToAssetError: null,
  missingAssemblies: [],
  outsideOperationsWithoutSupplier: [],
  supplierIds: [] as string[],
  ...overrides
});

// The user client: reads of the selected jobs (the `in` filter applied) and
// the release-date write. `inFilterSizes` records how many ids each read sent.
function clientFor(jobs: JobRow[]) {
  const inFilterSizes: number[] = [];
  const from = () => {
    let rows: unknown = jobs;
    const chain: Record<string, any> = {};
    for (const method of ["select", "eq", "order"]) chain[method] = () => chain;
    chain.update = () => {
      rows = null;
      return chain;
    };
    chain.in = (_column: string, ids: string[]) => {
      inFilterSizes.push(ids.length);
      rows = (rows as JobRow[]).filter((row) => ids.includes(row.id));
      return chain;
    };
    chain.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve);
    return chain;
  };
  return { client: { from } as any, inFilterSizes };
}

function readiness(
  jobs: ReturnType<typeof ready>[],
  suppliers: {
    supplierId: string;
    draftPurchaseOrders: { id: string; purchaseOrderId: string }[];
  }[] = []
) {
  vi.mocked(getJobReleaseReadiness).mockResolvedValue({
    data: { jobs, suppliers },
    error: null
  } as any);
}

describe("releaseJobs", () => {
  const run = (
    jobs: JobRow[],
    input: { jobIds: string[]; purchaseOrdersBySupplierId?: Record<string, string> }
  ) => releaseJobs(contextFor(clientFor(jobs).client), input);

  it("releases Draft and Planned jobs, and lists the rest as skipped", async () => {
    readiness([ready("j1"), ready("j2")]);
    const { data } = await run(
      [job("j1", { status: "Draft" }), job("j2"), job("j3", { status: "In Progress" })],
      { jobIds: ["j1", "j2", "j3"] }
    );
    expect(data).toEqual({
      released: [
        { jobId: "j1", readableId: "J1" },
        { jobId: "j2", readableId: "J2" }
      ],
      warnings: [],
      failed: [],
      skipped: [{ jobId: "j3", readableId: "J3", status: "In Progress" }],
      scheduled: true
    });
  });

  it("commits each Ready status before the scheduler runs", async () => {
    readiness([ready("j1")]);
    await run([job("j1")], { jobIds: ["j1"] });
    expect(events).toEqual(["ready:j1", "schedule"]);
  });

  it("names a job that is not ready and still releases the others", async () => {
    readiness([
      ready("j1", { manufacturingBlocked: true }),
      ready("j2"),
      ready("j3", { nothingToMake: true }),
      ready("j4", {
        makeToAssetError:
          "A job linked to a sales order line cannot complete to a fixed asset"
      })
    ]);
    const { data } = await run([job("j1"), job("j2"), job("j3"), job("j4")], {
      jobIds: ["j1", "j2", "j3", "j4"]
    });
    expect(data?.released).toEqual([{ jobId: "j2", readableId: "J2" }]);
    expect(data?.failed).toEqual([
      { jobId: "j1", readableId: "J1", message: "manufacturing is blocked" },
      { jobId: "j3", readableId: "J3", message: "nothing to make" },
      {
        jobId: "j4",
        readableId: "J4",
        message:
          "A job linked to a sales order line cannot complete to a fixed asset"
      }
    ]);
  });

  it("refuses a supplier with Draft purchase orders only when no choice was sent", async () => {
    const suppliers = [
      {
        supplierId: "supplier-a",
        draftPurchaseOrders: [{ id: "po-1", purchaseOrderId: "PO000001" }]
      }
    ];
    readiness([ready("j1", { supplierIds: ["supplier-a"] })], suppliers);
    const refused = await run([job("j1")], { jobIds: ["j1"] });
    expect(refused.data?.failed[0]?.message).toBe(
      "choose a purchase order for its outside operations on the job"
    );

    readiness([ready("j1", { supplierIds: ["supplier-a"] })], suppliers);
    const chosen = await run([job("j1")], {
      jobIds: ["j1"],
      purchaseOrdersBySupplierId: { "supplier-a": "po-1" }
    });
    expect(chosen.data?.released).toHaveLength(1);
    expect(invoke.mock.calls[0]?.[1]).toMatchObject({
      purchaseOrdersBySupplierId: { "supplier-a": "po-1" }
    });
  });

  it("puts later jobs on the purchase order an earlier job created", async () => {
    readiness(
      [
        ready("j1", { supplierIds: ["supplier-a"] }),
        ready("j2", { supplierIds: ["supplier-a"] })
      ],
      [{ supplierId: "supplier-a", draftPurchaseOrders: [] }]
    );
    // The map is the function's own and filled in afterwards: copy it per call.
    const sent: Record<string, string>[] = [];
    invoke.mockImplementation(async (_name, input) => {
      sent.push({ ...input.purchaseOrdersBySupplierId });
      return {
        data: { purchaseOrderIdsBySupplierId: { "supplier-a": "po-new" } },
        error: null
      };
    });
    await run([job("j1"), job("j2")], {
      jobIds: ["j1", "j2"],
      purchaseOrdersBySupplierId: {}
    });
    expect(sent).toEqual([{ "supplier-a": "new" }, { "supplier-a": "po-new" }]);
  });

  it("reports a job that left Draft or Planned during the release, and schedules each location once", async () => {
    readiness([ready("j1"), ready("j2"), ready("j3", {})]);
    vi.mocked(updateJobStatus).mockImplementation(async (_client, { id }) => {
      events.push(`ready:${id}`);
      return { error: null, updated: id !== "j2" } as any;
    });
    const { data } = await run(
      [job("j1"), job("j2"), job("j3", { locationId: "location-2" })],
      { jobIds: ["j1", "j2", "j3"] }
    );
    expect(data?.failed).toEqual([
      {
        jobId: "j2",
        readableId: "J2",
        message: "The job is no longer Draft or Planned"
      }
    ]);
    expect(
      vi.mocked(runLocationSchedule).mock.calls.map(([args]) => args.locationId)
    ).toEqual(["location-1", "location-2"]);
  });

  it("counts and schedules a job released before its purchase orders failed", async () => {
    readiness([ready("j1")]);
    invoke.mockResolvedValueOnce({
      data: null,
      error: { message: "no supplier currency" }
    });
    const { data } = await run([job("j1")], { jobIds: ["j1"] });
    expect(data?.released).toHaveLength(1);
    expect(data?.warnings[0]?.message).toMatch(
      /^The job is released, but its purchase orders could not be created/
    );
    expect(runLocationSchedule).toHaveBeenCalledOnce();
  });

  it("says so when the released jobs could not be scheduled", async () => {
    readiness([ready("j1")]);
    vi.mocked(runLocationSchedule).mockRejectedValueOnce(
      new Error("no calendar")
    );
    const { data } = await run([job("j1")], { jobIds: ["j1"] });
    expect(data).toMatchObject({ scheduled: false });
    expect(data?.released).toHaveLength(1);
  });

  it("loads a large selection in groups, and releases it in job order", async () => {
    const ids = Array.from({ length: 250 }, (_, index) => `j${index}`);
    // Stored out of order, so the release order is the function's own doing.
    const { client, inFilterSizes } = clientFor(
      [...ids].reverse().map((id) => job(id, { jobId: id.padStart(5, "0") }))
    );
    readiness(ids.map((id) => ready(id)));
    const { data } = await releaseJobs(contextFor(client), { jobIds: ids });
    expect(inFilterSizes.slice(0, 3)).toEqual([100, 100, 50]);
    expect(data?.released).toHaveLength(250);
    expect(data?.released.slice(0, 3).map((ref) => ref.jobId)).toEqual([
      "j0",
      "j1",
      "j2"
    ]);
  });

  it("refuses a supplier choice for an operation of another job", async () => {
    readiness([ready("j1")]);
    const system = {
      from: () => {
        const chain: Record<string, any> = {};
        for (const method of ["select", "eq", "in"]) chain[method] = () => chain;
        chain.then = (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve);
        return chain;
      }
    };
    const ctx = createServiceContext({
      ...({} as any),
      actor: {
        type: "user",
        userId: "user-1",
        permissions: {
          production: { view: [], create: [], update: ["company-1"], delete: [] }
        }
      },
      company: { id: "company-1", groupId: "group-1" },
      caller: clientFor([job("j1")]).client,
      system: () => system as any,
      pg: () => ({}) as any,
      kv: () => ({}) as any
    });
    const { error } = await releaseJobs(ctx, {
      jobIds: ["j1"],
      supplierProcessByOperationId: { "op-elsewhere": "sp-1" }
    });
    expect(error).toMatchObject({ category: "validation" });
    expect(updateJobStatus).not.toHaveBeenCalled();
  });
});

describe("releaseBatches", () => {
  // Tables by name; `in` filters on the column it names.
  function clientWith(tables: Record<string, Record<string, unknown>[]>) {
    return {
      from: (table: string) => {
        let rows = tables[table] ?? [];
        const chain: Record<string, any> = {};
        for (const method of ["select", "eq", "order", "update"]) {
          chain[method] = () => chain;
        }
        chain.in = (column: string, values: string[]) => {
          rows = rows.filter((row) => values.includes(row[column] as string));
          return chain;
        };
        chain.then = (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: rows, error: null }).then(resolve);
        return chain;
      }
    } as any;
  }

  const tables = {
    jobOperationBatch: [
      { id: "b1", readableId: "BAT1", status: "Planned", workCenterId: "wc1" },
      { id: "b2", readableId: "BAT2", status: "Active", workCenterId: "wc1" },
      { id: "b3", readableId: "BAT3", status: "Planned", workCenterId: "wc2" }
    ],
    jobOperation: [
      { jobId: "j1", jobOperationBatchId: "b1" },
      { jobId: "j3", jobOperationBatchId: "b3" }
    ],
    job: [
      { id: "j1", jobId: "J1", status: "Planned" },
      { id: "j3", jobId: "J3", status: "Planned" }
    ]
  };

  it("releases a batch's jobs, then the batch, then tells the scheduler", async () => {
    readiness([ready("j1")]);
    const { data } = await releaseBatches(contextFor(clientWith(tables)), {
      batchIds: ["b1"]
    });
    expect(data?.released).toEqual([{ batchId: "b1", readableId: "BAT1" }]);
    expect(events).toEqual(["ready:j1", "batch:b1", "notify"]);
  });

  it("skips a batch that is not Planned, and refuses one whose job is not ready", async () => {
    vi.mocked(getJobReleaseReadiness).mockImplementation(
      async (_client, jobIds) =>
        ({
          data: {
            jobs: jobIds.map((id) =>
              ready(id, { manufacturingBlocked: id === "j3" })
            ),
            suppliers: []
          },
          error: null
        }) as any
    );
    const { data } = await releaseBatches(contextFor(clientWith(tables)), {
      batchIds: ["b1", "b2", "b3"]
    });
    expect(data?.released.map((ref) => ref.batchId)).toEqual(["b1"]);
    expect(data?.skipped).toEqual([
      { batchId: "b2", readableId: "BAT2", status: "Active" }
    ]);
    expect(data?.failed).toEqual([
      {
        batchId: "b3",
        readableId: "BAT3",
        message: "Fix these jobs before releasing: J3: manufacturing is blocked"
      }
    ]);
    expect(events).not.toContain("batch:b3");
  });
});
