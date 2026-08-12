import {
  DEFAULT_HANDLE,
  entityValue,
  type RuntimeValue,
  SUCCESS_HANDLE
} from "@carbon/workflows";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Enough of Kysely's builder to record what a manual run writes. */
type Builder = {
  values: (row: Record<string, unknown>) => Builder;
  set: (row: Record<string, unknown>) => Builder;
  onConflict: () => Builder;
  returning: () => Builder;
  select: () => Builder;
  where: () => Builder;
  execute: () => Promise<unknown[]>;
  executeTakeFirst: () => Promise<unknown>;
  executeTakeFirstOrThrow: () => Promise<unknown>;
};

const inserted: Array<{ table: string; row: Record<string, unknown> }> = [];
const updated: Array<{ table: string; row: Record<string, unknown> }> = [];
let stepIds = 0;

function builder(
  result: unknown,
  sink?: (row: Record<string, unknown>) => void
): Builder {
  const self: Builder = {
    values: (row) => {
      sink?.(row);
      return self;
    },
    set: (row) => {
      sink?.(row);
      return self;
    },
    onConflict: () => self,
    returning: () => self,
    select: () => self,
    where: () => self,
    execute: async () => [],
    executeTakeFirst: async () => result,
    executeTakeFirstOrThrow: async () => result
  };
  return self;
}

const getJobDatabaseClient = vi.fn(() => ({
  insertInto: (table: string) =>
    builder(
      table === "workflowRun" ? { id: "run1" } : { id: `step${++stepIds}` },
      (row) => inserted.push({ table, row })
    ),
  updateTable: (table: string) =>
    builder({ numUpdatedRows: 0n }, (row) => updated.push({ table, row })),
  // Only `failCrashedRun` reads, and only for the run's startedAt.
  selectFrom: () => builder({ startedAt: null })
}));
vi.mock("../../db", () => ({ getJobDatabaseClient }));
vi.mock("./owner", () => ({
  getOwnerClient: vi.fn(async () => ({})),
  readOwnerPermissions: vi.fn(async () => ({})),
  hasPermission: vi.fn(() => true)
}));
vi.mock("../actions", () => ({ createWorkflowServices: vi.fn() }));

const { executeManualWorkflowRun } = await import("./manual");
const { createWorkflowServices } = await import("../actions");
const { readOwnerPermissions } = await import("./owner");

const nodes = [
  {
    id: "t1",
    type: "trigger",
    position: { x: 0, y: 0 },
    data: { events: ["purchaseOrder.status.changed"], origin: "Both" }
  },
  {
    id: "act",
    type: "action",
    position: { x: 0, y: 1 },
    data: {
      action: "purchaseOrder.update",
      inputs: {
        purchaseOrder: {
          kind: "ref",
          nodeId: "t1",
          output: "record",
          path: []
        }
      }
    }
  }
];

const edges = [
  {
    id: "e1",
    source: "t1",
    sourceHandle: DEFAULT_HANDLE,
    target: "act",
    targetHandle: "in"
  }
];

const definition = { formatVersion: 3, nodes, edges } as never;

const trigger = {
  kind: "record" as const,
  table: "purchaseOrder",
  recordId: "po1",
  operation: "UPDATE" as const,
  record: { id: "po1" },
  before: { id: "po1", status: "Draft" },
  after: { id: "po1", status: "To Receive" }
};

const logger = { info: vi.fn(), error: vi.fn() };

function run(overrides?: { definition?: never; triggerNodeId?: string }) {
  return executeManualWorkflowRun({
    definition: overrides?.definition ?? definition,
    companyId: "co1",
    companyGroupId: "cg1",
    ownerId: "u1",
    workflowId: "wf1",
    workflowVersionId: "wfv1",
    eventId: "purchaseOrder.status.changed",
    triggerNodeId: overrides?.triggerNodeId ?? "t1",
    trigger,
    logger
  });
}

const runAction = vi.fn(
  async (_id: string, _inputs: Record<string, RuntimeValue>) => ({
    ok: true as const,
    outputs: { record: entityValue("purchaseOrder", "po1") },
    handle: SUCCESS_HANDLE
  })
);

beforeEach(() => {
  vi.clearAllMocks();
  inserted.length = 0;
  updated.length = 0;
  stepIds = 0;
  vi.mocked(createWorkflowServices).mockReturnValue({
    runAction,
    runOperation: async () => ({ ok: false, error: "not stubbed" }),
    search: async () => ({ ok: false, error: "not stubbed" })
  });
});

/** Step rows in the order they were claimed. The caller reads them back from the
 * database, so what was written is the whole contract. */
function steps() {
  return inserted
    .filter((one) => one.table === "workflowStepRun")
    .map((one) => one.row);
}

/** The settle call for each step. `failInterruptedSteps` also updates this table but
 * writes no `branchTaken`, which is how the two are told apart. */
function settled() {
  return updated
    .filter(
      (one) => one.table === "workflowStepRun" && "branchTaken" in one.row
    )
    .map((one) => one.row);
}

describe("executeManualWorkflowRun", () => {
  it("records the trigger step first, then every node it walked", async () => {
    const result = await run();

    expect(result.status).toBe("Succeeded");
    expect(steps().map((one) => one.nodeId)).toEqual(["t1", "act"]);
    expect(steps().map((one) => one.nodeType)).toEqual(["trigger", "action"]);
    expect(settled().map((one) => one.status)).toEqual([
      "Succeeded",
      "Succeeded"
    ]);
    expect(runAction).toHaveBeenCalledTimes(1);
  });

  it("reports a failed action's own error on that step", async () => {
    runAction.mockResolvedValueOnce({ ok: false, error: "boom" } as never);

    const result = await run();

    expect(result.status).toBe("Failed");
    expect(settled().map((one) => one.error)).toEqual([null, "boom"]);
  });

  // The side effects are real, so the history has to be too — flagged, not hidden.
  it("records a flagged run row against the version being edited", async () => {
    await run();

    const runs = inserted.filter((one) => one.table === "workflowRun");
    expect(runs).toHaveLength(1);
    expect(runs[0]?.row).toMatchObject({
      companyId: "co1",
      workflowId: "wf1",
      workflowVersionId: "wfv1",
      isTest: true,
      status: "Running",
      triggerTable: "purchaseOrder",
      triggerRecordId: "po1"
    });
    expect(String(runs[0]?.row.sourceEventId)).toMatch(/^manual:/);
  });

  it("writes a step row per node and closes the run", async () => {
    await run();

    expect(
      inserted.filter((one) => one.table === "workflowStepRun")
    ).toHaveLength(2);
    const finish = updated.filter((one) => one.table === "workflowRun");
    expect(finish.at(-1)?.row).toMatchObject({ status: "Succeeded" });
  });

  // Nothing runs, so no step row can carry the reason — the return value must.
  it("returns why the run was refused when no step could say so", async () => {
    vi.mocked(readOwnerPermissions).mockResolvedValueOnce(null);

    const result = await run();

    expect(result.status).toBe("Failed");
    expect(steps()).toEqual([]);
    expect(result.error).toBe(
      "The permissions for the owner of this workflow could not be read."
    );
  });

  // The row exists before the walk does, so a throw that escapes it must not leave
  // the run Running until the nightly reaper.
  it("closes the run row when the walk throws", async () => {
    runAction.mockRejectedValueOnce(new Error("the database went away"));

    await expect(run()).rejects.toThrow("the database went away");

    const closed = updated.filter((one) => one.table === "workflowRun").at(-1);
    expect(closed?.row).toMatchObject({
      status: "Failed",
      error: "the database went away"
    });
  });

  it("succeeds with no error", async () => {
    expect((await run()).error).toBeNull();
  });

  // Two triggers can list the same event; the author picked which one to fire.
  it("starts from the trigger the caller named", async () => {
    const twoTriggers = {
      formatVersion: 3,
      edges,
      nodes: [
        {
          id: "t0",
          type: "trigger",
          position: { x: 0, y: 0 },
          data: { events: ["purchaseOrder.status.changed"], origin: "Both" }
        },
        ...nodes
      ]
    } as never;

    await run({ definition: twoTriggers, triggerNodeId: "t1" });
    expect(steps().map((one) => one.nodeId)).toEqual(["t1", "act"]);

    // t0 has no outgoing edge, so choosing it walks nothing but its own row.
    inserted.length = 0;
    await run({ definition: twoTriggers, triggerNodeId: "t0" });
    expect(steps().map((one) => one.nodeId)).toEqual(["t0"]);
  });
});
