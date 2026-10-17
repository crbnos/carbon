// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

// What a material save does around the row write: a Make to Order material
// pulls its item's method (on create, and only on the change INTO Make to
// Order on update), and the recalculations that fill its estimates. Without
// them a material sat at estimatedQuantity 0 and picking pulled nothing.

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
  upsertJobMaterial: vi.fn(async () => ({
    data: { id: "jm1", methodType: "Pull from Inventory" },
    error: null
  })),
  pullJobMaterialMakeMethod: vi.fn(async () => ({ data: {}, error: null })),
  recalculateJobMakeMethodRequirements: vi.fn(async () => ({
    data: {},
    error: null
  })),
  recalculateJobOperationDependencies: vi.fn(async () => ({
    data: {},
    error: null
  }))
}));

import {
  pullJobMaterialMakeMethod,
  recalculateJobMakeMethodRequirements,
  recalculateJobOperationDependencies,
  upsertJobMaterial
} from "../app/modules/production/production.service";
import {
  createJobMaterial,
  updateJobMaterial
} from "../app/modules/production/production.server";
import { createServiceContext } from "@carbon/api/service-fn.server";

/** The caller's and the service-role client: each table's one row, or none. */
function systemWith(rows: Record<string, unknown>) {
  return {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq"]) chain[method] = () => chain;
      chain.maybeSingle = async () => ({
        data: rows[table] ?? null,
        error: null
      });
      return chain;
    }
  } as never;
}

const contextWith = (rows: Record<string, unknown>) =>
  createServiceContext({
    actor: {
      type: "user",
      userId: "u1",
      permissions: {
        production: { view: [], create: ["c1"], update: [], delete: [] }
      }
    },
    company: { id: "c1", groupId: "g1" },
    caller: systemWith(rows),
    system: () => systemWith(rows),
    pg: () => ({}) as never,
    kv: () => ({}) as never
  });

const material = {
  id: "jm1",
  jobId: "job1",
  jobMakeMethodId: "jmm1",
  description: "Bracket",
  itemType: "Part" as const,
  methodType: "Pull from Inventory" as const,
  itemId: "item1",
  kit: false,
  order: 1,
  quantity: 2,
  requiresBatchTracking: false,
  requiresSerialTracking: false,
  unitCost: 0,
  unitOfMeasureCode: "EA"
};
const parents = { jobMakeMethod: { id: "jmm1" }, jobOperation: { id: "op1" } };

beforeEach(() => vi.clearAllMocks());

describe("createJobMaterial", () => {
  it("leaves a Draft job's estimates to the release", async () => {
    const result = await createJobMaterial(
      contextWith({ job: { status: "Draft" }, ...parents }),
      material
    );
    expect(result).toEqual({ data: { id: "jm1" }, error: null });
    expect(recalculateJobMakeMethodRequirements).not.toHaveBeenCalled();
    expect(recalculateJobOperationDependencies).not.toHaveBeenCalled();
  });
  it("refuses a make method that is not the job's", async () => {
    const result = await createJobMaterial(
      contextWith({ job: { status: "Draft" } }),
      material
    );
    expect(result.error?.category).toBe("notFound");
    expect(upsertJobMaterial).not.toHaveBeenCalled();
  });
});

describe("updateJobMaterial", () => {
  it("refuses a material that is not on this job and method", async () => {
    const result = await updateJobMaterial(
      contextWith({ job: { status: "Draft" }, ...parents }),
      material
    );
    expect(result.error?.category).toBe("notFound");
    expect(upsertJobMaterial).not.toHaveBeenCalled();
  });
});
