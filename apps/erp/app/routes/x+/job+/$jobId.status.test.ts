import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
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
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn() })
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
  runMRP: vi.fn(async () => ({ data: null, error: null })),
  updateJobStatus: vi.fn()
}));

import { updateJobStatus } from "~/modules/production";
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
    ),
    functions: {
      invoke: vi.fn(async (name: string) => {
        events.push(`invoke:${name}`);
        return { data: {}, error: null };
      })
    }
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

  return { client, serviceRole };
}

function releaseRequest() {
  const body = new FormData();
  body.set("status", "Ready");
  body.set("selectedPurchaseOrdersBySupplierId", "{}");
  // The "Release Job" dialog posts status=Ready with ?schedule=1.
  return new Request("http://localhost/x/job/job-1/status?schedule=1", {
    method: "POST",
    body
  });
}

async function runRelease() {
  return action({
    request: releaseRequest(),
    params: { jobId: "job-1" },
    context: {}
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  setup();
});

describe("Job release status action", () => {
  it("commits the Ready status before invoking the scheduler", async () => {
    // On success the action ends by throwing a redirect Response.
    await expect(runRelease()).rejects.toBeInstanceOf(Response);

    expect(updateJobStatus).toHaveBeenCalledOnce();
    expect(events).toContain("updateJobStatus");
    expect(events).toContain("invoke:schedule");
    // Regression guard: the `schedule` edge function only batches jobs already
    // Ready/In Progress/Paused. If the status is committed AFTER the scheduler
    // runs, the freshly released job is filtered out of its own schedule run and
    // never lands in capacityReservation / the forecast.
    expect(events.indexOf("updateJobStatus")).toBeLessThan(
      events.indexOf("invoke:schedule")
    );
  });
});
