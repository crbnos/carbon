import {
  DEFAULT_HANDLE,
  entityValue,
  type RuntimeValue,
  SUCCESS_HANDLE
} from "@carbon/workflows";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getJobDatabaseClient = vi.fn(() => ({}));
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
  vi.mocked(createWorkflowServices).mockReturnValue({
    runAction,
    runOperation: async () => ({ ok: false, error: "not stubbed" }),
    search: async () => ({ ok: false, error: "not stubbed" })
  });
});

describe("executeManualWorkflowRun", () => {
  it("returns the trigger step first, then every node it walked", async () => {
    const result = await run();

    expect(result.status).toBe("Succeeded");
    expect(result.steps.map((one) => one.nodeId)).toEqual(["t1", "act"]);
    expect(result.steps.map((one) => one.nodeType)).toEqual([
      "trigger",
      "action"
    ]);
    expect(result.steps.map((one) => one.status)).toEqual([
      "Succeeded",
      "Succeeded"
    ]);
    expect(runAction).toHaveBeenCalledTimes(1);
  });

  it("reports a failed action's own error on that step", async () => {
    runAction.mockResolvedValueOnce({ ok: false, error: "boom" } as never);

    const result = await run();

    expect(result.status).toBe("Failed");
    expect(result.steps.map((one) => one.error)).toEqual([null, "boom"]);
  });

  // The whole point of a test run: it must leave no trace in the two run-log tables.
  it("never opens a privileged database connection", async () => {
    await run();
    expect(getJobDatabaseClient).not.toHaveBeenCalled();
  });

  // Nothing runs, so no step row can carry the reason — the return value must.
  it("returns why the run was refused when no step could say so", async () => {
    vi.mocked(readOwnerPermissions).mockResolvedValueOnce(null);

    const result = await run();

    expect(result.status).toBe("Failed");
    expect(result.steps).toEqual([]);
    expect(result.error).toBe(
      "The permissions for the owner of this workflow could not be read."
    );
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

    const named = await run({
      definition: twoTriggers,
      triggerNodeId: "t1"
    });
    expect(named.steps.map((one) => one.nodeId)).toEqual(["t1", "act"]);

    // t0 has no outgoing edge, so choosing it walks nothing but its own row.
    const other = await run({
      definition: twoTriggers,
      triggerNodeId: "t0"
    });
    expect(other.steps.map((one) => one.nodeId)).toEqual(["t0"]);
  });
});
