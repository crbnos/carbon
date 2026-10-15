// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { runLocationSchedule } from "@carbon/planning";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@carbon/auth", () => ({
  assertIsPost: vi.fn(),
  error: vi.fn((_err: unknown, message: string) => ({ message })),
  success: vi.fn((message: string) => ({ message }))
}));
vi.mock("@carbon/auth/auth.server", () => ({
  requirePermissions: vi.fn()
}));
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: vi.fn()
}));
vi.mock("@carbon/auth/session.server", () => ({
  flash: vi.fn(async () => ({}))
}));
vi.mock("@carbon/planning", () => ({
  runLocationSchedule: vi.fn()
}));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn() })
}));
// The operations are the edge functions' successors: stub them, as the
// invoke they replaced was, so the route's own ordering is what is tested.
vi.mock("@carbon/server-functions", () => {
  const invoker = {
    invoke: async (name: string) => {
      events.push(name === "close-job" ? "closeJob" : name);
      return { data: null, error: null };
    }
  };
  return { serverFns: { system: () => invoker, as: () => invoker } };
});
vi.mock("~/services/database.server", () => ({
  getDatabaseClient: vi.fn(() => ({}))
}));
vi.mock("~/modules/service-context.server", () => ({
  serviceContext: vi.fn((auth: { companyId: string; userId: string }) => ({
    company: { id: auth.companyId },
    auditUserId: auth.userId
  }))
}));
vi.mock("~/utils/path", () => ({
  path: {
    to: {
      job: (id: string) => `/x/job/${id}`,
      jobMaterials: (id: string) => `/x/job/${id}/materials`
    }
  },
  requestReferrer: () => null
}));
vi.mock("~/modules/shared/shared.server", () => ({
  requireCompanyRecord: vi.fn(async () => undefined)
}));
vi.mock("~/modules/inventory", () => ({
  cancelOpenPickingListsForJob: vi.fn()
}));
vi.mock("~/modules/production", () => ({
  jobStatus: [
    "Draft",
    "Planned",
    "Ready",
    "In Progress",
    "Paused",
    "Completed",
    "Closed",
    "Cancelled"
  ],
  recalculateJobRequirements: vi.fn(async () => ({ data: null, error: null })),
  returnPickedRemaindersForJob: vi.fn(),
  runMRP: vi.fn(async () => ({ data: null, error: null })),
  updateJobStatus: vi.fn()
}));
vi.mock("~/modules/production/production.server", () => ({
  // Cancel is delegated whole; its steps live in cancelJob.
  cancelJob: vi.fn(async () => ({ data: { jobId: "job-1" }, error: null }))
}));

import { cancelOpenPickingListsForJob } from "~/modules/inventory";
import {
  returnPickedRemaindersForJob,
  updateJobStatus
} from "~/modules/production";
import { cancelJob } from "~/modules/production/production.server";
import { requireCompanyRecord } from "~/modules/shared/shared.server";
import { action } from "./$jobId.status";

type QueryResult = { data: unknown; error: unknown };

// A supabase-client stand-in: chainable AND thenable, so both
// `.select(...).eq(...).single()` and an awaited `.update(...).eq(...)` resolve.
function makeChain(result: QueryResult) {
  const chain: Record<string, any> = {};
  chain.select = vi.fn(() => chain);
  chain.update = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.single = vi.fn(async () => result);
  chain.then = (
    resolve: (v: QueryResult) => unknown,
    reject?: (e: unknown) => unknown
  ) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

// Ordered log of the side effects we care about, shared across the mocks.
let events: string[];

function setup() {
  events = [];

  const client = {
    from: vi.fn(() =>
      makeChain({
        data: { item: { itemReplenishment: { manufacturingBlocked: false } } },
        error: null
      })
    )
  };

  const serviceRole = {
    from: vi.fn(() =>
      makeChain({ data: { locationId: "location-1" }, error: null })
    )
  };

  vi.mocked(requirePermissions).mockResolvedValue({
    client,
    companyId: "company-1",
    userId: "user-1"
  } as any);
  vi.mocked(getCarbonServiceRole).mockReturnValue(serviceRole as any);
  vi.mocked(updateJobStatus).mockImplementation(async () => {
    events.push("updateJobStatus");
    return { data: { id: "job-1" }, error: null } as any;
  });
  vi.mocked(runLocationSchedule).mockImplementation(async () => {
    events.push("runLocationSchedule");
    return undefined as any;
  });
  vi.mocked(returnPickedRemaindersForJob).mockImplementation(async () => {
    events.push("returnPickedRemainders");
    return { data: {}, error: null } as any;
  });
  vi.mocked(cancelOpenPickingListsForJob).mockImplementation(async () => {
    events.push("cancelOpenPickingLists");
    return { error: null };
  });

  return { client, serviceRole };
}

function cancelRequest() {
  const body = new FormData();
  body.set("status", "Cancelled");
  return new Request("http://localhost/x/job/job-1/status", {
    method: "POST",
    body
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setup();
});

describe("Job status tenancy", () => {
  it("refuses a job outside the caller's company before any side effect", async () => {
    // The action runs MRP, scheduling and picking sweeps with the service role
    // keyed on the URL id — a foreign job must stop at the ownership check.
    vi.mocked(requireCompanyRecord).mockRejectedValueOnce(
      new Response("Not found", { status: 404 })
    );

    const thrown = await action({
      request: cancelRequest(),
      params: { jobId: "job-1" },
      context: {}
    } as any).catch((e) => e);

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(404);
    expect(requireCompanyRecord).toHaveBeenCalledWith(
      expect.anything(),
      "job",
      "company-1",
      { id: "job-1" }
    );
    expect(updateJobStatus).not.toHaveBeenCalled();
    expect(runLocationSchedule).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});

describe("Job cancel status action", () => {
  // The steps (return picked material, close picking lists, then cancel) live
  // in cancelJob, shared with planning's Cancel. The route must never set the
  // status itself, which would cancel the job without them.
  it("cancels through cancelJob and never sets the status itself", async () => {
    await expect(
      action({
        request: cancelRequest(),
        params: { jobId: "job-1" },
        context: {}
      } as any)
    ).rejects.toBeInstanceOf(Response);

    expect(cancelJob).toHaveBeenCalledWith(
      expect.objectContaining({
        company: { id: "company-1" },
        auditUserId: "user-1"
      }),
      { jobId: "job-1" }
    );
    expect(updateJobStatus).not.toHaveBeenCalled();
  });
});
