// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { runLocationSchedule } from "@carbon/planning";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@carbon/auth", () => ({
  assertIsPost: vi.fn()
}));
vi.mock("@carbon/auth/auth.server", () => ({
  requirePermissions: vi.fn()
}));
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: vi.fn(() => ({}))
}));
vi.mock("@carbon/planning", () => ({
  runLocationSchedule: vi.fn()
}));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn() })
}));
vi.mock("~/services/database.server", () => ({
  getDatabaseClient: vi.fn(() => ({}))
}));
vi.mock("~/modules/production", () => ({
  getJobReleaseReadiness: vi.fn()
}));
vi.mock("~/modules/production/production.server", () => ({
  releaseJobs: vi.fn()
}));

import { getJobReleaseReadiness } from "~/modules/production";
import { releaseJobs } from "~/modules/production/production.server";
import { action } from "./release";

type JobRow = {
  id: string;
  jobId: string;
  status: string;
  quantity: number;
  scrapQuantity: number;
  locationId: string;
};

const job = (id: string, overrides: Partial<JobRow> = {}): JobRow => ({
  id,
  jobId: id.toUpperCase(),
  status: "Planned",
  quantity: 10,
  scrapQuantity: 0,
  locationId: "location-1",
  ...overrides
});

const ready = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  jobId: id.toUpperCase(),
  status: "Planned" as const,
  manufacturingBlocked: false,
  missingAssemblies: [],
  outsideOperationsWithoutSupplier: [],
  supplierIds: [] as string[],
  ...overrides
});

// The selected jobs behind a chainable, thenable client stand-in that applies
// the `in` filter on the id. `inFilterSizes` records how many ids each carried.
function setup(jobs: JobRow[]) {
  const inFilterSizes: number[] = [];
  const from = vi.fn(() => {
    let rows = jobs;
    const chain: Record<string, any> = {};
    for (const method of ["select", "eq", "order"]) {
      chain[method] = vi.fn(() => chain);
    }
    chain.in = vi.fn((_column: string, ids: string[]) => {
      inFilterSizes.push(ids.length);
      rows = rows.filter((row) => ids.includes(row.id));
      return chain;
    });
    chain.then = (
      resolve: (value: { data: JobRow[]; error: null }) => unknown
    ) => Promise.resolve({ data: rows, error: null }).then(resolve);
    return chain;
  });

  vi.mocked(requirePermissions).mockResolvedValue({
    client: { from },
    companyId: "company-1",
    userId: "user-1"
  } as any);
  return { inFilterSizes };
}

const request = (jobIds: string[]) =>
  new Request("http://localhost/x/job/release", {
    method: "POST",
    body: JSON.stringify({ jobIds }),
    headers: { "Content-Type": "application/json" }
  });

const run = (jobIds: string[]) =>
  action({ request: request(jobIds), params: {}, context: {} } as any);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(releaseJobs).mockImplementation(
    async ({ jobIds, purchaseOrdersBySupplierId }) => ({
      error: null,
      purchaseOrdersBySupplierId,
      releasedJobIds: jobIds
    })
  );
});

describe("bulk job release", () => {
  it("releases Draft and Planned jobs and skips the rest of the selection", async () => {
    setup([
      job("j1", { status: "Draft" }),
      job("j2"),
      job("j3", { status: "In Progress" })
    ]);
    vi.mocked(getJobReleaseReadiness).mockResolvedValue({
      data: { jobs: [ready("j1"), ready("j2")], suppliers: [] },
      error: null
    });

    const result = await run(["j1", "j2", "j3"]);

    expect(vi.mocked(getJobReleaseReadiness).mock.calls[0]?.[1]).toEqual([
      "j1",
      "j2"
    ]);
    expect(
      vi.mocked(releaseJobs).mock.calls.map(([args]) => args.jobIds)
    ).toEqual([["j1"], ["j2"]]);
    expect(result).toEqual({
      success: true,
      released: 2,
      warnings: [],
      failed: [],
      scheduled: true
    });
  });

  it("names a job that is not ready and still releases the others", async () => {
    setup([job("j1"), job("j2"), job("j3", { quantity: 0 })]);
    vi.mocked(getJobReleaseReadiness).mockResolvedValue({
      data: {
        jobs: [
          ready("j1", { manufacturingBlocked: true }),
          ready("j2"),
          ready("j3")
        ],
        suppliers: []
      },
      error: null
    });

    const result = await run(["j1", "j2", "j3"]);

    expect(
      vi.mocked(releaseJobs).mock.calls.map(([args]) => args.jobIds)
    ).toEqual([["j2"]]);
    expect(result).toMatchObject({
      released: 1,
      failed: [
        { readableId: "J1", message: "manufacturing is blocked" },
        { readableId: "J3", message: "nothing to make" }
      ]
    });
  });

  it("skips a job whose supplier has a draft purchase order to choose from", async () => {
    setup([job("j1"), job("j2")]);
    vi.mocked(getJobReleaseReadiness).mockResolvedValue({
      data: {
        jobs: [
          ready("j1", { supplierIds: ["supplier-a"] }),
          ready("j2", { supplierIds: ["supplier-b"] })
        ],
        suppliers: [
          {
            supplierId: "supplier-a",
            draftPurchaseOrders: [{ id: "po-1", purchaseOrderId: "PO000001" }]
          },
          { supplierId: "supplier-b", draftPurchaseOrders: [] }
        ]
      },
      error: null
    });

    const result = await run(["j1", "j2"]);

    expect(
      vi.mocked(releaseJobs).mock.calls.map(([args]) => args.jobIds)
    ).toEqual([["j2"]]);
    expect(result).toMatchObject({
      released: 1,
      failed: [
        {
          readableId: "J1",
          message:
            "choose a purchase order for its outside operations on the job"
        }
      ]
    });
  });

  it("puts later jobs on the purchase order an earlier job created", async () => {
    setup([job("j1"), job("j2")]);
    vi.mocked(getJobReleaseReadiness).mockResolvedValue({
      data: {
        jobs: [
          ready("j1", { supplierIds: ["supplier-a"] }),
          ready("j2", { supplierIds: ["supplier-a"] })
        ],
        suppliers: [{ supplierId: "supplier-a", draftPurchaseOrders: [] }]
      },
      error: null
    });
    vi.mocked(releaseJobs).mockImplementation(async ({ jobIds }) => ({
      error: null,
      purchaseOrdersBySupplierId: { "supplier-a": "po-new" },
      releasedJobIds: jobIds
    }));

    await run(["j1", "j2"]);

    expect(
      vi
        .mocked(releaseJobs)
        .mock.calls.map(([args]) => args.purchaseOrdersBySupplierId)
    ).toEqual([{ "supplier-a": "new" }, { "supplier-a": "po-new" }]);
  });

  it("reports a job the release path refused and schedules each location once", async () => {
    setup([
      job("j1"),
      job("j2"),
      job("j3"),
      job("j4", { locationId: "location-2" })
    ]);
    vi.mocked(getJobReleaseReadiness).mockResolvedValue({
      data: {
        jobs: [ready("j1"), ready("j2"), ready("j3"), ready("j4")],
        suppliers: []
      },
      error: null
    });
    vi.mocked(releaseJobs).mockImplementation(async ({ jobIds }) => ({
      error: jobIds[0] === "j2" ? "Failed to recalculate job j2" : null,
      purchaseOrdersBySupplierId: {},
      releasedJobIds: jobIds[0] === "j2" ? [] : jobIds
    }));

    const result = await run(["j1", "j2", "j3", "j4"]);

    expect(result).toMatchObject({
      released: 3,
      failed: [{ readableId: "J2", message: "Failed to recalculate job j2" }],
      scheduled: true
    });
    expect(
      vi.mocked(runLocationSchedule).mock.calls.map(([args]) => args.locationId)
    ).toEqual(["location-1", "location-2"]);
  });

  it("counts and schedules a job released before its purchase orders failed", async () => {
    setup([job("j1"), job("j2", { locationId: "location-2" })]);
    vi.mocked(getJobReleaseReadiness).mockResolvedValue({
      data: { jobs: [ready("j1"), ready("j2")], suppliers: [] },
      error: null
    });
    vi.mocked(releaseJobs).mockImplementation(async ({ jobIds }) => ({
      error:
        jobIds[0] === "j1"
          ? "The job is released, but its purchase orders could not be created: no supplier currency"
          : null,
      purchaseOrdersBySupplierId: {},
      releasedJobIds: jobIds
    }));

    const result = await run(["j1", "j2"]);

    expect(result).toMatchObject({
      released: 2,
      failed: [],
      warnings: [
        {
          readableId: "J1",
          message:
            "The job is released, but its purchase orders could not be created: no supplier currency"
        }
      ]
    });
    expect(
      vi.mocked(runLocationSchedule).mock.calls.map(([args]) => args.locationId)
    ).toEqual(["location-1", "location-2"]);
  });

  it("says so when the released jobs could not be scheduled", async () => {
    setup([job("j1")]);
    vi.mocked(getJobReleaseReadiness).mockResolvedValue({
      data: { jobs: [ready("j1")], suppliers: [] },
      error: null
    });
    vi.mocked(runLocationSchedule).mockRejectedValue(new Error("no calendar"));

    expect(await run(["j1"])).toMatchObject({ released: 1, scheduled: false });
  });

  it("loads a large selection in groups, and releases it in job order", async () => {
    const ids = Array.from({ length: 250 }, (_, index) => `j${index}`);
    // Stored out of order, so the release order is the route's own doing.
    const { inFilterSizes } = setup(
      [...ids].reverse().map((id) => job(id, { jobId: id.padStart(5, "0") }))
    );
    vi.mocked(getJobReleaseReadiness).mockResolvedValue({
      data: { jobs: ids.map((id) => ready(id)), suppliers: [] },
      error: null
    });

    const result = await run(ids);

    expect(inFilterSizes).toEqual([100, 100, 50]);
    expect(result).toMatchObject({ released: 250, failed: [] });
    const released = vi
      .mocked(releaseJobs)
      .mock.calls.map(([args]) => args.jobIds[0]);
    expect(released.slice(0, 3)).toEqual(["j0", "j1", "j2"]);
  });

  it("refuses a body that is not the table's shape", async () => {
    setup([]);
    const malformed = (body: string) =>
      action({
        request: new Request("http://localhost/x/job/release", {
          method: "POST",
          body,
          headers: { "Content-Type": "application/json" }
        }),
        params: {},
        context: {}
      } as any);

    expect(await malformed("not json")).toEqual({
      success: false,
      message: "Invalid request"
    });
    expect(await malformed(JSON.stringify({ jobIds: "j1" }))).toEqual({
      success: false,
      message: "Invalid request"
    });
    expect(releaseJobs).not.toHaveBeenCalled();
  });

  it("refuses an empty selection", async () => {
    setup([]);
    expect(await run([])).toEqual({
      success: false,
      message: "No jobs selected"
    });
    expect(releaseJobs).not.toHaveBeenCalled();
  });
});
