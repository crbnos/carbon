import { beforeEach, describe, expect, it, vi } from "vitest";

// Pin the ORCHESTRATION the MCP wrapper adds over the bare service upsert —
// the routes run this themselves, so a connector call must reproduce it or
// imported materials sit at estimatedQuantity 0 (and the generated
// quantityToIssue 0 means issue/picking pulls nothing).

const upsertJobMaterialRow = vi.fn();
const pullJobMaterialMakeMethod = vi.fn();
const recalculateJobMakeMethodRequirements = vi.fn();
const recalculateJobOperationDependencies = vi.fn();

vi.mock("~/modules/production/production.service", () => ({
  upsertJobMaterial: (...args: unknown[]) => upsertJobMaterialRow(...args),
  pullJobMaterialMakeMethod: (...args: unknown[]) =>
    pullJobMaterialMakeMethod(...args),
  recalculateJobMakeMethodRequirements: (...args: unknown[]) =>
    recalculateJobMakeMethodRequirements(...args),
  recalculateJobOperationDependencies: (...args: unknown[]) =>
    recalculateJobOperationDependencies(...args)
}));
vi.mock("~/services/database.server", () => ({
  getDatabaseClient: () => ({}) as never
}));
vi.mock("@carbon/auth/users.server", () => ({
  getUserClaims: vi.fn(async () => ({
    permissions: {
      production_create: ["c1"],
      production_update: ["c1"]
    },
    role: "employee"
  }))
}));
vi.mock("@carbon/auth", () => ({
  hasPermission: (
    permissions: Record<string, string[]> | undefined,
    module: string,
    action: string,
    companyId: string
  ) => Boolean(permissions?.[`${module}_${action}`]?.includes(companyId))
}));
vi.mock("@carbon/ee/storage-rules.server", () => ({
  evaluateLinesForSurface: vi.fn(),
  isBlocked: vi.fn()
}));

import { upsertJobMaterial } from "~/modules/production/production.mcp.server";

/** A supabase client stub answering the wrapper's two reads. */
function makeClient(opts: {
  jobStatus?: string;
  existingMethodType?: string | null;
}) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: async () => ({
              data: { methodType: opts.existingMethodType ?? null },
              error: null
            })
          }),
          single: async () => ({
            data: { status: opts.jobStatus ?? "Draft" },
            error: null
          })
        })
      })
    })
  } as never;
}

const base = {
  id: "jm1",
  description: "Bracket",
  jobMakeMethodId: "jmm1",
  itemType: "Part" as const,
  methodType: "Pull from Inventory" as const,
  itemId: "item1",
  kit: false,
  order: 1,
  quantity: 2,
  requiresBatchTracking: false,
  requiresSerialTracking: false,
  unitCost: 0,
  unitOfMeasureCode: "EA",
  jobId: "job1",
  companyId: "c1"
};

beforeEach(() => {
  vi.clearAllMocks();
  upsertJobMaterialRow.mockResolvedValue({
    data: { id: "jm1", methodType: "Pull from Inventory" },
    error: null
  });
  pullJobMaterialMakeMethod.mockResolvedValue({ data: {}, error: null });
  recalculateJobMakeMethodRequirements.mockResolvedValue({
    data: {},
    error: null
  });
  recalculateJobOperationDependencies.mockResolvedValue({
    data: {},
    error: null
  });
});

describe("MCP upsertJobMaterial orchestration", () => {
  it("create on a Draft job inserts without recalc (release fills estimates, like the UI)", async () => {
    const result = await upsertJobMaterial(makeClient({ jobStatus: "Draft" }), {
      ...base,
      createdBy: "u1"
    });
    expect(result.error).toBeNull();
    expect(upsertJobMaterialRow).toHaveBeenCalledOnce();
    expect(recalculateJobMakeMethodRequirements).not.toHaveBeenCalled();
    expect(recalculateJobOperationDependencies).not.toHaveBeenCalled();
  });

  it("create on a released job recalcs requirements and dependencies", async () => {
    await upsertJobMaterial(makeClient({ jobStatus: "Ready" }), {
      ...base,
      createdBy: "u1"
    });
    expect(recalculateJobMakeMethodRequirements).toHaveBeenCalledWith(
      expect.anything(),
      { id: "jmm1", companyId: "c1", userId: "u1" }
    );
    expect(recalculateJobOperationDependencies).toHaveBeenCalledOnce();
  });

  it("update always recalcs requirements; dependencies only for op-linked Make to Order", async () => {
    await upsertJobMaterial(
      makeClient({ existingMethodType: "Pull from Inventory" }),
      { ...base, updatedBy: "u1" }
    );
    expect(recalculateJobMakeMethodRequirements).toHaveBeenCalledOnce();
    expect(recalculateJobOperationDependencies).not.toHaveBeenCalled();
  });

  it("pulls the subassembly method only on the transition INTO Make to Order", async () => {
    await upsertJobMaterial(
      makeClient({ existingMethodType: "Make to Order" }),
      { ...base, methodType: "Make to Order", updatedBy: "u1" }
    );
    expect(pullJobMaterialMakeMethod).not.toHaveBeenCalled();

    await upsertJobMaterial(
      makeClient({ existingMethodType: "Pull from Inventory" }),
      {
        ...base,
        methodType: "Make to Order",
        jobOperationId: "op1",
        updatedBy: "u1"
      }
    );
    expect(pullJobMaterialMakeMethod).toHaveBeenCalledOnce();
    expect(recalculateJobOperationDependencies).toHaveBeenCalledOnce();
  });

  it("refuses a user without the production permission", async () => {
    await expect(
      upsertJobMaterial(makeClient({}), {
        ...base,
        companyId: "other-company",
        createdBy: "u1"
      })
    ).rejects.toThrow(/permission/);
    expect(upsertJobMaterialRow).not.toHaveBeenCalled();
  });
});
