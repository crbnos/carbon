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
vi.mock("@carbon/server-functions", () => ({
  serverFns: {
    system: () => ({
      invoke: vi.fn(async () => ({
        data: { purchaseOrderIdsBySupplierId: {} },
        error: null
      }))
    })
  }
}));
vi.mock("../app/modules/production/production.service", () => ({
  getJobReleaseReadiness: vi.fn(),
  recalculateJobRequirements: vi.fn(async () => ({ data: null, error: null })),
  runMRP: vi.fn(async () => ({ data: null, error: null })),
  updateJobStatus: vi.fn(async () => ({ error: null, updated: true }))
}));

import {
  recalculateJobRequirements,
  runMRP,
  updateJobStatus
} from "../app/modules/production/production.service";
import {
  planDraftJob,
  releaseJobs
} from "../app/modules/production/production.server";
import { createServiceContext } from "../app/modules/service-fn.server";

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
  releaseJobs(contextFor(client), { jobIds, purchaseOrdersBySupplierId: {} });

beforeEach(() => vi.clearAllMocks());

describe("releaseJobs", () => {
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
  const plan = () => planDraftJob(contextFor({}), { jobId: "job-1" });

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
