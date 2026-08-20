import {
  DEFAULT_HANDLE,
  entityValue,
  type RuntimeValue
} from "@carbon/workflows";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineStep, RunPayload } from "./execute";

vi.mock("../../db", () => ({ getJobDatabaseClient: () => ({}) }));
vi.mock("./log", () => ({
  loadRunContext: vi.fn(),
  claimRun: vi.fn(async () => true),
  finishRun: vi.fn(async () => {})
}));
vi.mock("./ledger", () => ({
  claimStep: vi.fn(async () => ({ claimed: true, stepRunId: "s1" })),
  settleStep: vi.fn(async () => {}),
  failInterruptedSteps: vi.fn(async () => 0)
}));
vi.mock("./owner", () => ({
  getOwnerClient: vi.fn(async () => ({})),
  readOwnerPermissions: vi.fn(async () => ({})),
  hasPermission: vi.fn(() => true)
}));
vi.mock("../actions", () => ({ createWorkflowServices: vi.fn() }));

const { executeWorkflowRun } = await import("./execute");
const { loadRunContext, claimRun, finishRun } = await import("./log");
const { claimStep, settleStep } = await import("./ledger");
const { hasPermission } = await import("./owner");
const { createWorkflowServices } = await import("../actions");

const definition = {
  formatVersion: 2,
  nodes: [
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
          purchaseOrder: { kind: "ref", nodeId: "t1", output: "record" }
        }
      }
    }
  ],
  edges: [
    {
      id: "e1",
      source: "t1",
      sourceHandle: DEFAULT_HANDLE,
      target: "act",
      targetHandle: "in"
    }
  ]
};

const payload: RunPayload = {
  runId: "run1",
  companyId: "co1",
  workflowId: "wf1",
  workflowVersionId: "wv1",
  eventId: "purchaseOrder.status.changed",
  ownerId: "u1",
  sourceEventId: "pgmq:1",
  trigger: {
    kind: "record",
    table: "purchaseOrder",
    recordId: "po1",
    operation: "UPDATE",
    record: { id: "po1" },
    before: { id: "po1", status: "Draft" },
    after: { id: "po1", status: "To Receive" }
  }
};

const logger = { info: vi.fn(), error: vi.fn() };

function harness() {
  const ids: string[] = [];
  const step: EngineStep = {
    run: async (id, handler) => {
      ids.push(id);
      return handler();
    }
  };
  return { ids, step };
}

const runAction = vi.fn(
  async (_id: string, _inputs: Record<string, RuntimeValue>) => ({
    ok: true as const,
    outputs: { record: entityValue("purchaseOrder", "po1") }
  })
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(claimRun).mockResolvedValue(true);
  vi.mocked(hasPermission).mockReturnValue(true);
  vi.mocked(claimStep).mockResolvedValue({ claimed: true, stepRunId: "s1" });
  vi.mocked(createWorkflowServices).mockReturnValue({
    runAction,
    runOperation: async () => ({ ok: false, error: "not stubbed" }),
    search: async () => ({ ok: false, error: "not stubbed" })
  });
  vi.mocked(loadRunContext).mockResolvedValue({
    run: {
      id: "run1",
      companyId: "co1",
      ownerId: "u1",
      workflowId: "wf1",
      workflowVersionId: "wv1",
      eventId: "purchaseOrder.status.changed",
      status: "Queued"
    },
    workflowActive: true,
    companyGroupId: "cg1",
    version: definition
  });
});

describe("the owner's permissions", () => {
  it("fails the action step by name when the owner has lost the module", async () => {
    const { step } = harness();
    // The trigger's own view check still passes; only the action's update is gone.
    vi.mocked(hasPermission).mockImplementation(
      (_permissions, _module, action) => action !== "update"
    );

    const result = await executeWorkflowRun({ payload, step, logger });

    expect(vi.mocked(settleStep).mock.calls.at(-1)?.[1]).toMatchObject({
      status: "Failed",
      error: "The owner of this workflow no longer has access to Purchasing."
    });
    expect(runAction).not.toHaveBeenCalled();
    expect(result.status).toBe("Failed");
  });

  it("refuses the whole run when the trigger's own module is gone", async () => {
    const { ids, step } = harness();
    vi.mocked(hasPermission).mockReturnValue(false);

    await executeWorkflowRun({ payload, step, logger });

    expect(ids).toEqual(["load", "permissions"]);
    expect(vi.mocked(finishRun).mock.calls.at(-1)?.[1]).toMatchObject({
      status: "Failed",
      error: "The owner of this workflow no longer has access to Purchasing."
    });
  });
});

describe("a second delivery of the same event", () => {
  it("runs no node, because only a Queued row may be claimed", async () => {
    const { ids, step } = harness();
    vi.mocked(claimRun).mockResolvedValue(false);

    const result = await executeWorkflowRun({ payload, step, logger });

    expect(result).toEqual({ runId: "run1", status: "Duplicate", steps: 0 });
    expect(ids).toEqual(["load"]);
    expect(claimStep).not.toHaveBeenCalled();
    expect(runAction).not.toHaveBeenCalled();
  });
});
