// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

// The assembly instruction operations' refusals: what is checked before the
// geometry service, the job, or another company's model is touched.

vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => ({ id: strings.join("") })
}));
vi.mock("@carbon/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@carbon/env")>()),
  ASSEMBLER_SERVICE_URL: "http://assembler.test"
}));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), warn: vi.fn() })
}));
const { trigger } = vi.hoisted(() => ({ trigger: vi.fn() }));
vi.mock("@carbon/jobs", () => ({ trigger, batchTrigger: vi.fn() }));
vi.mock("@carbon/planning", () => ({ runLocationSchedule: vi.fn() }));
vi.mock("../app/modules/production/production.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createAssemblyPlanJob: vi.fn(async () => ({
    data: { id: "plan1" },
    error: null
  })),
  generateAssemblyStepsFromPlan: vi.fn(),
  getLatestAssemblyPlanJob: vi.fn(async () => ({ data: null, error: null })),
  syncAssemblyInstructionToOperation: vi.fn(),
  syncAssemblyStepMaterialsFromMappings: vi.fn(async () => ({ created: 0 })),
  upsertAssemblyComponentMapping: vi.fn(async () => ({ error: null }))
}));

import {
  generateAssemblyStepsFromPlan,
  syncAssemblyInstructionToOperation,
  upsertAssemblyComponentMapping
} from "../app/modules/production/production.service";
import {
  generateAssemblySteps,
  mapAssemblyComponent,
  syncAssemblyToOperation
} from "../app/modules/production/production.server";
import { createServiceContext } from "@carbon/api/service-fn.server";

/** A client that answers every table's single-row read with `rows[table]`. */
function clientWith(rows: Record<string, unknown>) {
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
  };
}

const contextWith = (rows: Record<string, unknown> = {}) =>
  createServiceContext({
    actor: {
      type: "user",
      userId: "u1",
      permissions: {
        production: { view: [], create: [], update: ["c1"], delete: [] }
      }
    },
    company: { id: "c1", groupId: "g1" },
    caller: clientWith(rows) as never,
    system: () => clientWith(rows) as never,
    pg: () => ({}) as never,
    kv: () => ({}) as never
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true }))
  );
});

describe("syncAssemblyToOperation", () => {
  it("refuses an operation on a locked job", async () => {
    const result = await syncAssemblyToOperation(
      contextWith({ jobOperation: { id: "op1", job: { status: "Closed" } } }),
      { id: "ai1", operationId: "op1" }
    );
    expect(result.error?.category).toBe("rule");
    expect(syncAssemblyInstructionToOperation).not.toHaveBeenCalled();
  });
});

describe("mapAssemblyComponent", () => {
  it("refuses a model that is not this company's", async () => {
    const result = await mapAssemblyComponent(
      contextWith({ item: { id: "i1" } }),
      { id: "ai1", modelUploadId: "mu1", geometryHash: "g1", itemId: "i1" }
    );
    expect(result.error?.category).toBe("notFound");
    expect(upsertAssemblyComponentMapping).not.toHaveBeenCalled();
  });
});

describe("generateAssemblySteps", () => {
  it("does not start a plan while the model is still converting", async () => {
    vi.mocked(generateAssemblyStepsFromPlan).mockResolvedValueOnce({
      ok: false,
      reason: "no-plan",
      modelUploadId: "mu1"
    });
    await generateAssemblySteps(
      contextWith({ modelUpload: { processingStatus: "Processing" } }),
      { id: "ai1" }
    );
    expect(trigger).not.toHaveBeenCalled();
  });

  it("refuses to generate over existing steps", async () => {
    vi.mocked(generateAssemblyStepsFromPlan).mockResolvedValueOnce({
      ok: false,
      reason: "steps-exist"
    });
    const result = await generateAssemblySteps(contextWith(), { id: "ai1" });
    expect(result.error).toMatchObject({
      category: "rule",
      message: "Steps already exist — delete them before generating from the plan"
    });
  });
});
