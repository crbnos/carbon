// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

// Releasing jobs and batches: what is released, skipped or refused, and the
// order of the steps, which `events` records as they reach the outside world.

const { invoke, events } = vi.hoisted(() => ({
  invoke: vi.fn(),
  events: [] as string[]
}));
vi.mock("../app/modules/shared/shared.service", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../app/modules/shared/shared.service")
    >();
  // Postings are database work with their own database tests; here they
  // answer `invoke`.
  const stubbed = new Set(["create", "batch-operations", "recalculate"]);
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
  runMrp: vi.fn(),
  runLocationSchedule: vi.fn()
}));
vi.mock("@carbon/jobs", () => ({
  trigger: vi.fn(async (event: string) => {
    if (event === "schedule-inputs-changed") events.push("notify");
  })
}));
vi.mock("@carbon/lib/workflows", () => ({ raiseMoment: vi.fn() }));
vi.mock("@carbon/lib/telemetry", () => ({ trackWorkEvent: vi.fn() }));
// The readiness read has its own test (job-release-readiness).
vi.mock("../app/modules/production/production.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getJobReleaseReadiness: vi.fn()
}));

import { runLocationSchedule, runMrp } from "@carbon/planning";
// Before the server module: loaded first, the service gets the stubbed
// postings (shared.service imports it back, and a cycle sees the original).
import { getJobReleaseReadiness } from "../app/modules/production/production.service";
import {
  planDraftJob,
  releaseBatches,
  releaseCheckedJobs,
  releaseJobs
} from "../app/modules/production/production.server";
import { createServiceContext } from "@carbon/api/service-fn.server";

type Row = Record<string, unknown>;

/**
 * A Supabase client over in-memory tables. `eq` and `in` filter on the
 * columns a row has; an update changes the rows still matching, and each
 * status change is logged to `events`. `inFilterSizes` records how many job
 * ids each read sent.
 */
function database(
  tables: Record<string, Row[]>,
  { releasedDateError = null as { message: string } | null } = {}
) {
  const inFilterSizes: number[] = [];
  const from = (table: string) => {
    let rows = tables[table] ?? [];
    let values: Row | null = null;
    const write = () => {
      if (values?.releasedDate) return { data: null, error: releasedDateError };
      for (const row of rows) {
        Object.assign(row, values);
        if (values?.status) {
          events.push(`${String(values.status).toLowerCase()}:${row.id}`);
        }
      }
      return { data: rows.map((row) => ({ id: row.id })), error: null };
    };
    const filter = (column: string, accepts: (value: unknown) => boolean) => {
      rows = rows.filter((row) => !(column in row) || accepts(row[column]));
      return chain;
    };
    const chain: Record<string, any> = {
      select: () => (values ? Promise.resolve(write()) : chain),
      update: (next: Row) => {
        values = next;
        return chain;
      },
      eq: (column: string, value: unknown) =>
        filter(column, (cell) => cell === value),
      in: (column: string, list: unknown[]) => {
        if (table === "job" && column === "id") inFilterSizes.push(list.length);
        return filter(column, (cell) => list.includes(cell));
      },
      order: () => chain,
      is: () => chain,
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve(values ? write() : { data: rows, error: null }).then(
          resolve
        )
    };
    return chain;
  };
  return { client: { from } as any, inFilterSizes };
}

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
    system: () => client,
    pg: () => ({}) as any,
    kv: () => ({}) as any
  });

/** The postings, by name: the defaults succeed; `overrides` replaces one. */
function postings(
  overrides: Partial<Record<string, (input: any) => Promise<unknown>>> = {}
) {
  return async (name: string, input: any) => {
    if (overrides[name]) return overrides[name](input);
    if (name === "recalculate") events.push("recalculate");
    if (name === "batch-operations") events.push(`batch:${input.batchId}`);
    return name === "create"
      ? { data: { purchaseOrderIdsBySupplierId: {} }, error: null }
      : { data: {}, error: null };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  events.length = 0;
  invoke.mockImplementation(postings());
  vi.mocked(runMrp).mockImplementation(async () => {
    events.push("mrp");
    return null as never;
  });
  vi.mocked(runLocationSchedule).mockImplementation(async () => {
    events.push("schedule");
    return undefined as never;
  });
});

describe("releaseCheckedJobs", () => {
  const release = (jobs: Row[], options = {}) =>
    releaseCheckedJobs(contextFor(database({ job: jobs }, options).client), {
      jobIds: jobs.map((job) => job.id as string),
      purchaseOrdersBySupplierId: {}
    });

  it("recalculates, runs MRP, then flips the job to Ready", async () => {
    const result = await release([{ id: "job-1", status: "Planned" }]);
    expect(result.data).toEqual({
      failure: null,
      purchaseOrdersBySupplierId: {},
      releasedJobIds: ["job-1"]
    });
    expect(events).toEqual(["recalculate", "mrp", "ready:job-1"]);
  });

  it("releases past a failed MRP run", async () => {
    vi.mocked(runMrp).mockRejectedValueOnce(new Error("planning blew up"));
    const result = await release([{ id: "job-1", status: "Planned" }]);
    expect(result.data?.releasedJobIds).toEqual(["job-1"]);
  });

  it("flips only a job still Draft or Planned, and stops when it is not", async () => {
    const jobs = [
      { id: "job-1", status: "Cancelled" },
      { id: "job-2", status: "Planned" }
    ];
    const result = await release(jobs);
    expect(result.data).toMatchObject({
      failure: { category: "conflict" },
      releasedJobIds: []
    });
    expect(jobs.map((job) => job.status)).toEqual(["Cancelled", "Planned"]);
  });

  it("reports a failed release-date write on a job that is released", async () => {
    const result = await release([{ id: "job-1", status: "Planned" }], {
      releasedDateError: { message: "connection reset" }
    });
    expect(result.data).toMatchObject({
      failure: { category: "internal" },
      releasedJobIds: ["job-1"]
    });
  });
});

// The planning drawer's Plan on a Draft job follows releaseJobs' order: MRP
// must never count a job as supply while its requirements are stale.
describe("planDraftJob", () => {
  const plan = (job: Row) =>
    planDraftJob(contextFor(database({ job: [job] }).client), {
      jobId: "job-1"
    });

  it("refuses a job that is not Draft before recalculating it", async () => {
    const result = await plan({ id: "job-1", status: "Planned" });
    expect(result.error?.category).toBe("conflict");
    expect(events).toEqual([]);
  });

  it("recalculates, flips Draft to Planned, then runs MRP", async () => {
    const result = await plan({ id: "job-1", status: "Draft" });
    expect(result).toEqual({ data: { warning: null }, error: null });
    expect(events).toEqual(["recalculate", "planned:job-1", "mrp"]);
  });

  it("leaves the job Draft, and runs no MRP, when the recalculation fails", async () => {
    invoke.mockImplementation(
      postings({
        recalculate: async () => ({ data: null, error: { message: "boom" } })
      })
    );
    const job = { id: "job-1", status: "Draft" };
    const result = await plan(job);
    expect(result.error?.category).toBe("internal");
    expect(job.status).toBe("Draft");
    expect(events).toEqual([]);
  });

  it("runs no MRP when the job left Draft during the recalculation", async () => {
    const job = { id: "job-1", status: "Draft" };
    invoke.mockImplementation(
      postings({
        recalculate: async () => {
          job.status = "Ready";
          return { data: {}, error: null };
        }
      })
    );
    expect((await plan(job)).error?.category).toBe("conflict");
    expect(events).toEqual([]);
  });

  it("keeps the job Planned and warns when MRP fails", async () => {
    vi.mocked(runMrp).mockRejectedValueOnce(new Error("planning blew up"));
    const job = { id: "job-1", status: "Draft" };
    const result = await plan(job);
    expect(result.data?.warning).toEqual(expect.any(String));
    expect(job.status).toBe("Planned");
  });
});

const job = (id: string, overrides: Row = {}): Row => ({
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
  materialsWithoutStorageUnit: [],
  supplierIds: [] as string[],
  ...overrides
});

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
    jobs: Row[],
    input: {
      jobIds: string[];
      purchaseOrdersBySupplierId?: Record<string, string>;
      carriedPurchaseOrders?: Record<string, string>;
      supplierProcessByOperationId?: Record<string, string>;
    }
  ) => releaseJobs(contextFor(database({ job: jobs }).client), input);

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
      scheduled: true,
      purchaseOrdersBySupplierId: {}
    });
  });

  it("commits each Ready status before the scheduler runs", async () => {
    readiness([ready("j1")]);
    await run([job("j1")], { jobIds: ["j1"] });
    expect(events).toEqual(["recalculate", "mrp", "ready:j1", "schedule"]);
  });

  it("names a job that is not ready and still releases the others", async () => {
    readiness([ready("j1", { manufacturingBlocked: true }), ready("j2")]);
    const { data } = await run([job("j1"), job("j2")], {
      jobIds: ["j1", "j2"]
    });
    expect(data?.released).toEqual([{ jobId: "j2", readableId: "J2" }]);
    expect(data?.failed).toEqual([
      { jobId: "j1", readableId: "J1", message: expect.any(String) }
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
    expect(refused.data?.failed.map((ref) => ref.jobId)).toEqual(["j1"]);

    const chosen = await run([job("j1")], {
      jobIds: ["j1"],
      purchaseOrdersBySupplierId: { "supplier-a": "po-1" }
    });
    expect(chosen.data?.released).toHaveLength(1);
    expect(invoke.mock.calls.find(([name]) => name === "create")?.[1]).toMatchObject({
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
    invoke.mockImplementation(
      postings({
        create: async (input) => {
          sent.push({ ...input.purchaseOrdersBySupplierId });
          return {
            data: { purchaseOrderIdsBySupplierId: { "supplier-a": "po-new" } },
            error: null
          };
        }
      })
    );
    await run([job("j1"), job("j2")], {
      jobIds: ["j1", "j2"],
      purchaseOrdersBySupplierId: {}
    });
    expect(sent).toEqual([{ "supplier-a": "new" }, { "supplier-a": "po-new" }]);
  });

  it("keeps a supplier on the PO an earlier call created, and returns it for the next call", async () => {
    // A background release runs in slices: slice 1 made po-1, which slice 2
    // reads as a Draft of the supplier and must not ask to choose among.
    readiness(
      [ready("j1", { supplierIds: ["supplier-a"] })],
      [
        {
          supplierId: "supplier-a",
          draftPurchaseOrders: [{ id: "po-1", purchaseOrderId: "PO000001" }]
        }
      ]
    );
    const { data } = await run([job("j1")], {
      jobIds: ["j1"],
      carriedPurchaseOrders: { "supplier-a": "po-1", "supplier-b": "po-2" }
    });
    expect(data?.released).toHaveLength(1);
    expect(invoke.mock.calls.find(([name]) => name === "create")?.[1]).toMatchObject({
      purchaseOrdersBySupplierId: { "supplier-a": "po-1" }
    });
    expect(data?.purchaseOrdersBySupplierId).toEqual({
      "supplier-a": "po-1",
      "supplier-b": "po-2"
    });
  });

  it("reports a job that left Draft or Planned during the release, and schedules each location once", async () => {
    readiness([ready("j1"), ready("j2"), ready("j3")]);
    const jobs = [job("j1"), job("j2"), job("j3", { locationId: "location-2" })];
    invoke.mockImplementation(
      postings({
        recalculate: async (input) => {
          if (input.id === "j2") jobs[1]!.status = "Cancelled";
          return { data: {}, error: null };
        }
      })
    );
    const { data } = await run(jobs, { jobIds: ["j1", "j2", "j3"] });
    expect(data?.failed).toEqual([
      { jobId: "j2", readableId: "J2", message: expect.any(String) }
    ]);
    expect(
      vi.mocked(runLocationSchedule).mock.calls.map(([args]) => args.locationId)
    ).toEqual(["location-1", "location-2"]);
  });

  it("counts and schedules a job released before its purchase orders failed", async () => {
    readiness([ready("j1")]);
    invoke.mockImplementation(
      postings({
        create: async () => ({
          data: null,
          error: { message: "no supplier currency" }
        })
      })
    );
    const { data } = await run([job("j1")], { jobIds: ["j1"] });
    expect(data?.released).toHaveLength(1);
    expect(data?.warnings.map((ref) => ref.jobId)).toEqual(["j1"]);
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
    const { client, inFilterSizes } = database({
      job: [...ids].reverse().map((id) => job(id, { jobId: id.padStart(5, "0") }))
    });
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
    const { error } = await run([job("j1")], {
      jobIds: ["j1"],
      supplierProcessByOperationId: { "op-elsewhere": "sp-1" }
    });
    expect(error).toMatchObject({ category: "validation" });
    expect(events).toEqual([]);
  });
});

describe("releaseBatches", () => {
  const tables = () => ({
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
  });
  const release = (batchIds: string[]) =>
    releaseBatches(contextFor(database(tables()).client), { batchIds });

  it("releases a batch's jobs, then the batch, then tells the scheduler", async () => {
    readiness([ready("j1")]);
    const { data } = await release(["b1"]);
    expect(data?.released).toEqual([{ batchId: "b1", readableId: "BAT1" }]);
    expect(events).toEqual([
      "recalculate",
      "mrp",
      "ready:j1",
      "batch:b1",
      "notify"
    ]);
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
    const { data } = await release(["b1", "b2", "b3"]);
    expect(data?.released.map((ref) => ref.batchId)).toEqual(["b1"]);
    expect(data?.skipped).toEqual([
      { batchId: "b2", readableId: "BAT2", status: "Active" }
    ]);
    expect(data?.failed.map((ref) => ref.batchId)).toEqual(["b3"]);
    expect(events).not.toContain("batch:b3");
  });

  describe("a supplier's purchase order", () => {
    const draft = { id: "po-1", purchaseOrderId: "PO1" };
    // Each batch reads its suppliers after the batches before it released:
    // the PO the first one created is a Draft by the time the second reads.
    const readinessAfterFirstPo = () => {
      let calls = 0;
      vi.mocked(getJobReleaseReadiness).mockImplementation(
        async (_client, jobIds) =>
          ({
            data: {
              jobs: jobIds.map((id) => ready(id)),
              suppliers: [
                {
                  supplierId: "s1",
                  draftPurchaseOrders: calls++ === 0 ? [] : [draft]
                }
              ]
            },
            error: null
          }) as any
      );
    };
    // The PO map each purchase-order posting got, copied when it ran: the
    // release keeps adding to the same object.
    let creates: Record<string, string>[] = [];
    const createdPo = (created: Record<string, string>) =>
      postings({
        create: async (input) => {
          creates.push({ ...input.purchaseOrdersBySupplierId });
          return {
            data: { purchaseOrderIdsBySupplierId: created },
            error: null
          };
        }
      });
    beforeEach(() => {
      creates = [];
      invoke.mockImplementation(createdPo({}));
    });

    it("is the one the first batch created, for every batch after it", async () => {
      readinessAfterFirstPo();
      invoke.mockImplementation(createdPo({ s1: "po-1" }));
      const { data } = await release(["b1", "b3"]);
      expect(data?.released.map((ref) => ref.batchId)).toEqual(["b1", "b3"]);
      expect(creates).toEqual([{ s1: "new" }, { s1: "po-1" }]);
      expect(data?.purchaseOrdersBySupplierId).toEqual({ s1: "po-1" });
    });

    it("is the one an earlier call of the same release carried", async () => {
      readiness([ready("j3")], [{ supplierId: "s1", draftPurchaseOrders: [draft] }]);
      const { data } = await releaseBatches(
        contextFor(database(tables()).client),
        { batchIds: ["b3"], carriedPurchaseOrders: { s1: "po-1" } }
      );
      expect(data?.released.map((ref) => ref.batchId)).toEqual(["b3"]);
      expect(creates).toEqual([{ s1: "po-1" }]);
    });

    it("needs a choice when the Draft is not this release's own", async () => {
      readiness([ready("j3")], [{ supplierId: "s1", draftPurchaseOrders: [draft] }]);
      const { data } = await release(["b3"]);
      expect(data?.failed).toEqual([
        {
          batchId: "b3",
          readableId: "BAT3",
          message:
            "Outside operations need a purchase order choice — open the batch to release it"
        }
      ]);
      expect(creates).toEqual([]);
    });
  });
});
