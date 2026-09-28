import { beforeEach, describe, expect, it, vi } from "vitest";

// Production route commands shared by the routes and the MCP wrappers:
// job operation delete/status and the job status wrapper's refusal. The
// Supabase client is the stubbed boundary (reads from a table map, writes
// recorded); the scheduling and picking engines answer with fixed values.

const m = vi.hoisted(() => ({
  SERVICE_ROLE: null as unknown,
  recalculateJobOperationDependencies: vi.fn(),
  returnPickedRemaindersForOperation: vi.fn(),
  requireToolPermission: vi.fn(),
  requireToolCompanyRecord: vi.fn()
}));

vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => m.SERVICE_ROLE
}));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() })
}));
vi.mock("@carbon/planning", () => ({ runLocationSchedule: vi.fn() }));
vi.mock("@carbon/jobs", () => ({ trigger: vi.fn() }));
vi.mock("@carbon/env", () => ({ ASSEMBLER_SERVICE_URL: "" }));
vi.mock("~/services/database.server", () => ({
  getDatabaseClient: () => ({})
}));
vi.mock("~/services/mcp-guards.server", () => ({
  requireToolPermission: m.requireToolPermission,
  requireToolCompanyRecord: m.requireToolCompanyRecord
}));
vi.mock("~/modules/inventory/inventory.service", () => ({
  cancelOpenPickingListsForJob: vi.fn()
}));
vi.mock("~/modules/resources/resources.mcp.server", () => ({
  deleteMaintenanceDispatchItem: vi.fn()
}));
vi.mock("~/modules/production/production.models", () => ({
  isAssemblyPlanRunning: vi.fn()
}));
vi.mock("@carbon/ee/rules.server", () => ({
  evaluateLinesForSurface: vi.fn(),
  isBlocked: vi.fn()
}));
vi.mock("@carbon/auth/users.server", () => ({ getUserClaims: vi.fn() }));
vi.mock("@carbon/auth", () => ({ hasPermission: vi.fn(() => true) }));
vi.mock("~/modules/production/production.service", () => ({
  createAssemblyPlanJob: vi.fn(),
  getJobReleaseReadiness: vi.fn(),
  getLatestAssemblyPlanJob: vi.fn(),
  pullJobMaterialMakeMethod: vi.fn(),
  recalculateJobMakeMethodRequirements: vi.fn(),
  recalculateJobOperationDependencies: m.recalculateJobOperationDependencies,
  recalculateJobRequirements: vi.fn(),
  returnPickedRemaindersForJob: vi.fn(),
  returnPickedRemaindersForOperation: m.returnPickedRemaindersForOperation,
  runMRP: vi.fn(),
  updateJobOperationStatus: (
    client: any,
    id: string,
    status: string,
    updatedBy: string
  ) =>
    client
      .from("jobOperation")
      .update({ status, updatedBy })
      .eq("id", id)
      .select()
      .single(),
  updateJobStatus: vi.fn(),
  upsertJobMaterial: vi.fn(),
  upsertJobOperation: vi.fn()
}));

import { updateJobStatus } from "~/modules/production/production.mcp.server";
import {
  deleteJobOperationWithDependencies,
  setJobOperationStatus
} from "~/modules/production/production.server";

type Write = { table: string; op: string; payload: unknown };

function makeClient(tables: Record<string, unknown>, counts = 0) {
  const writes: Write[] = [];
  return {
    writes,
    from(table: string) {
      const rows = tables[table];
      const one = Array.isArray(rows) ? (rows[0] ?? null) : (rows ?? null);
      const many = Array.isArray(rows) ? rows : rows ? [rows] : [];
      const q: Record<string, any> = {};
      for (const name of ["select", "eq", "in", "limit", "order"]) {
        q[name] = () => q;
      }
      for (const op of ["update", "insert", "upsert", "delete"]) {
        q[op] = (payload?: unknown) => {
          writes.push({ table, op, payload });
          return q;
        };
      }
      q.single = async () => ({ data: one, error: null });
      q.maybeSingle = async () => ({ data: one, error: null });
      q.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: many, error: null, count: counts }).then(
          resolve
        );
      return q;
    }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.recalculateJobOperationDependencies.mockResolvedValue({ error: null });
});

describe("deleteJobOperationWithDependencies", () => {
  it("refuses an operation with recorded production events", async () => {
    m.SERVICE_ROLE = makeClient({ jobOperation: { jobId: "job-1" } });
    const client = makeClient({ productionEvent: [] }, 2);
    const result = await deleteJobOperationWithDependencies(client as any, {
      id: "op-1",
      companyId: "co",
      userId: "u"
    });
    expect(result.error?.message).toBe(
      "Cannot delete an operation that has recorded production events"
    );
    expect(client.writes).toEqual([]);
  });

  it("an unknown id or an operation of another job is not found", async () => {
    m.SERVICE_ROLE = makeClient({});
    const unknown = await deleteJobOperationWithDependencies(
      makeClient({}) as any,
      { id: "nope", companyId: "co", userId: "u" }
    );
    expect(unknown.error?.message).toBe("Job operation not found");

    m.SERVICE_ROLE = makeClient({ jobOperation: { jobId: "job-2" } });
    const otherJob = await deleteJobOperationWithDependencies(
      makeClient({}) as any,
      { id: "op-1", jobId: "job-1", companyId: "co", userId: "u" }
    );
    expect(otherJob.error?.message).toBe("Job operation not found");
  });

  it("deletes, then recalculates the job's operation dependencies", async () => {
    m.SERVICE_ROLE = makeClient({ jobOperation: { jobId: "job-1" } });
    const client = makeClient({ jobOperation: [{ id: "op-1" }] }, 0);
    const result = await deleteJobOperationWithDependencies(client as any, {
      id: "op-1",
      companyId: "co",
      userId: "u"
    });
    expect(result.error).toBeNull();
    expect(client.writes.map((w) => `${w.op}:${w.table}`)).toEqual([
      "delete:jobOperation"
    ]);
    expect(m.recalculateJobOperationDependencies).toHaveBeenCalledWith(
      m.SERVICE_ROLE,
      {},
      { jobId: "job-1", companyId: "co", userId: "u" }
    );
  });
});

describe("setJobOperationStatus", () => {
  it("Done returns picked material after the status write", async () => {
    m.SERVICE_ROLE = makeClient({});
    m.returnPickedRemaindersForOperation.mockResolvedValue({ error: null });
    const client = makeClient({ jobOperation: { id: "op-1" } });
    const result = await setJobOperationStatus(client as any, {
      id: "op-1",
      companyId: "co",
      userId: "u",
      status: "Done"
    });
    expect(result.error).toBeNull();
    expect(client.writes[0]?.payload).toEqual({ status: "Done", updatedBy: "u" });
    expect(m.returnPickedRemaindersForOperation).toHaveBeenCalledWith(
      m.SERVICE_ROLE,
      { jobOperationId: "op-1", userId: "u", companyId: "co" }
    );
  });

  it("other statuses do not sweep", async () => {
    await setJobOperationStatus(makeClient({ jobOperation: {} }) as any, {
      id: "op-1",
      companyId: "co",
      userId: "u",
      status: "In Progress"
    });
    expect(m.returnPickedRemaindersForOperation).not.toHaveBeenCalled();
  });
});

describe("production_updateJobStatus wrapper", () => {
  it("refuses Completed and points at production_completeJob", async () => {
    await expect(
      updateJobStatus({} as any, {
        id: "job-1",
        companyId: "co",
        status: "Completed",
        updatedBy: "u"
      })
    ).rejects.toThrow(/production_completeJob/);
  });

  it("re-applies the route's production update gate", async () => {
    m.requireToolPermission.mockRejectedValueOnce(new Error("denied"));
    await expect(
      updateJobStatus({} as any, {
        id: "job-1",
        companyId: "co",
        status: "Cancelled",
        updatedBy: "u"
      })
    ).rejects.toThrow("denied");
    expect(m.requireToolPermission).toHaveBeenCalledWith(
      "u",
      "co",
      "production",
      "update",
      "change job status"
    );
  });
});
