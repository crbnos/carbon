import {
  type ActionOutcome,
  DEFAULT_HANDLE,
  entityValue,
  type RuntimeValue,
  type SearchOutcome,
  SUCCESS_HANDLE
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
  claimStep: vi.fn(),
  settleStep: vi.fn(async () => {}),
  failInterruptedSteps: vi.fn(async () => 0)
}));
vi.mock("./owner", () => ({
  // The engine reads the company custom fields through this client; a bare {} has no
  // `.from`, so the stub answers that one query with an empty list.
  getOwnerClient: vi.fn(async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ eq: async () => ({ data: [], error: null }) })
      })
    })
  })),
  readOwnerPermissions: vi.fn(async () => ({})),
  hasPermission: () => true
}));
vi.mock("../actions", () => ({ createWorkflowServices: vi.fn() }));
// The real module pulls in the email templates and @carbon/env; the engine only wants a URL.
vi.mock("../../inngest/functions/notifications/content", () => ({
  buildNotificationLink: (
    event: string,
    documentId: string,
    companyId: string
  ) =>
    `https://erp.test/api/link?event=${event}&documentId=${documentId}&companyId=${companyId}`
}));

const { executeWorkflowRun } = await import("./execute");
const { loadRunContext } = await import("./log");
const { claimStep, settleStep } = await import("./ledger");
const { createWorkflowServices } = await import("../actions");

const definition = {
  formatVersion: 2,
  nodes: [
    {
      id: "t1",
      type: "trigger",
      position: { x: 0, y: 0 },
      data: { events: ["job.status.changed"], origin: "Both" }
    },
    {
      id: "look",
      type: "lookup",
      position: { x: 0, y: 1 },
      data: { entity: "job", returns: "list", match: [] }
    },
    {
      id: "act",
      type: "action",
      position: { x: 0, y: 2 },
      data: {
        action: "job.update",
        inputs: { job: { kind: "ref", nodeId: "look", output: "result" } }
      }
    }
  ],
  edges: [
    {
      id: "e1",
      source: "t1",
      sourceHandle: DEFAULT_HANDLE,
      target: "look",
      targetHandle: "in"
    },
    {
      id: "e2",
      source: "look",
      sourceHandle: SUCCESS_HANDLE,
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
  eventId: "job.status.changed",
  ownerId: "u1",
  sourceEventId: "pgmq:1",
  trigger: {
    kind: "record",
    table: "job",
    recordId: "j0",
    operation: "UPDATE",
    record: { id: "j0" },
    before: { id: "j0" },
    after: { id: "j0" }
  }
};

const logger = { info: vi.fn(), error: vi.fn() };

function jobs(count: number): RuntimeValue {
  return {
    kind: "list",
    of: { kind: "entity", of: "job" },
    items: Array.from({ length: count }, (_, index) =>
      entityValue("job", `j${index + 1}`)
    )
  };
}

/** Every step is run inline, and its id recorded in order. */
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

function withServices(params: {
  found: RuntimeValue;
  runAction: (job: RuntimeValue) => ActionOutcome;
}) {
  const runAction = vi.fn(
    async (
      _id: string,
      inputs: Record<string, RuntimeValue>
    ): Promise<ActionOutcome> => {
      const job = inputs.job;
      return job === undefined
        ? { ok: false, error: "This turn had no item." }
        : params.runAction(job);
    }
  );
  const search = vi.fn(
    async (): Promise<SearchOutcome> => ({
      ok: true,
      value: params.found,
      matched: params.found.kind === "list" ? params.found.items.length : 1,
      dropped: 0
    })
  );
  vi.mocked(createWorkflowServices).mockReturnValue({
    runAction,
    runOperation: async () => ({ ok: false, error: "not stubbed" }),
    search
  });
  return { runAction };
}

/** The statusReason written for a node's aggregate row (the one with no item key). */
function aggregateReason(): string | null | undefined {
  const settled = vi.mocked(settleStep).mock.calls.at(-1)?.[1];
  return settled?.statusReason;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadRunContext).mockResolvedValue({
    run: {
      id: "run1",
      companyId: "co1",
      ownerId: "u1",
      workflowId: "wf1",
      workflowVersionId: "wv1",
      eventId: "job.status.changed",
      status: "Queued"
    },
    workflowPublished: true,
    companyGroupId: "cg1",
    version: definition
  });
  let claimed = 0;
  vi.mocked(claimStep).mockImplementation(async () => {
    claimed += 1;
    return { claimed: true, stepRunId: `s${claimed}` };
  });
});

describe("batch mode", () => {
  // Nothing on the node says "repeat" — the list arriving at a slot that takes one
  // record is the whole decision, here and in the validator.
  it("runs once when the same wiring delivers a single record", async () => {
    const { ids, step } = harness();
    withServices({
      found: entityValue("job", "j1"),
      runAction: (job) => ({ ok: true, outputs: { record: job } })
    });

    await executeWorkflowRun({ payload, step, logger });

    expect(ids).toEqual([
      "load",
      "custom-fields",
      "permissions",
      // The trigger is recorded before the walk starts at its successors.
      "node:t1",
      "node:look",
      "node:act",
      "finish"
    ]);
  });

  it("runs one durable step per item, keyed by the record", async () => {
    const { ids, step } = harness();
    const { runAction } = withServices({
      found: jobs(3),
      runAction: (job) => ({ ok: true, outputs: { record: job } })
    });

    await executeWorkflowRun({ payload, step, logger });

    expect(ids).toEqual([
      "load",
      "custom-fields",
      "permissions",
      "node:t1",
      "node:look",
      "node:act:j1",
      "node:act:j2",
      "node:act:j3",
      "node:act",
      "finish"
    ]);
    // Each turn saw its own item, never the whole list.
    expect(runAction.mock.calls.map(([, inputs]) => inputs.job)).toEqual([
      entityValue("job", "j1"),
      entityValue("job", "j2"),
      entityValue("job", "j3")
    ]);
  });

  it("hands the whole node's outputs on as a list, in item order", async () => {
    const { step } = harness();
    withServices({
      found: jobs(3),
      runAction: (job) => ({ ok: true, outputs: { record: job } })
    });

    await executeWorkflowRun({ payload, step, logger });

    const settled = vi.mocked(settleStep).mock.calls.at(-1)?.[1];
    expect(settled?.output).toEqual({
      record: {
        kind: "list",
        of: { kind: "entity", of: "job" },
        items: [
          entityValue("job", "j1"),
          entityValue("job", "j2"),
          entityValue("job", "j3")
        ]
      }
    });
  });

  it("still succeeds when one item fails, and says so", async () => {
    const { step } = harness();
    withServices({
      found: jobs(3),
      runAction: (job) =>
        job.kind === "entity" && job.id === "j2"
          ? { ok: false, error: "That job could not be read." }
          : { ok: true, outputs: { record: job } }
    });

    const result = await executeWorkflowRun({ payload, step, logger });

    expect(aggregateReason()).toBe("Ran 3 of 3; 1 failed.");
    // One failed item still marks the run failed; the node itself carried on.
    expect(result.status).toBe("Failed");
  });

  it("follows the failure handle when every item fails", async () => {
    const { step } = harness();
    withServices({
      found: jobs(2),
      runAction: () => ({ ok: false, error: "That job could not be read." })
    });

    await executeWorkflowRun({ payload, step, logger });

    const settled = vi.mocked(settleStep).mock.calls.at(-1)?.[1];
    expect(settled?.status).toBe("Failed");
    expect(settled?.error).toBe("Ran 2 of 2; 2 failed.");
  });

  it("caps a long list and reports what it did not use", async () => {
    const { ids, step } = harness();
    withServices({
      found: jobs(150),
      runAction: (job) => ({ ok: true, outputs: { record: job } })
    });

    await executeWorkflowRun({ payload, step, logger });

    expect(ids.filter((id) => id.startsWith("node:act:"))).toHaveLength(100);
    expect(aggregateReason()).toBe("Ran 100 of 150; 50 were not used.");
  });

  it("does no work on a replay, because every item key is already claimed", async () => {
    const { step } = harness();
    const { runAction } = withServices({
      found: jobs(3),
      runAction: (job) => ({ ok: true, outputs: { record: job } })
    });
    vi.mocked(claimStep).mockResolvedValue({ claimed: false });

    await executeWorkflowRun({ payload, step, logger });

    expect(runAction).not.toHaveBeenCalled();
    expect(settleStep).not.toHaveBeenCalled();
  });

  it("skips a batch whose list turned out to be empty", async () => {
    const { ids, step } = harness();
    withServices({
      found: jobs(0),
      runAction: (job) => ({ ok: true, outputs: { record: job } })
    });

    await executeWorkflowRun({ payload, step, logger });

    expect(ids).not.toContain("node:act:j1");
    expect(aggregateReason()).toBe(
      "That list was empty, so there was nothing to do."
    );
  });

  it("records what each turn ran with, item and all", async () => {
    const { step } = harness();
    withServices({
      found: jobs(1),
      runAction: (job) => ({ ok: true, outputs: { record: job } })
    });

    await executeWorkflowRun({ payload, step, logger });

    const claim = vi
      .mocked(claimStep)
      .mock.calls.find(([, params]) => params.itemKey === "j1")?.[1];
    expect(claim?.input).toEqual({
      inputs: {
        job: { kind: "ref", nodeId: "look", output: "result", path: [] }
      },
      item: entityValue("job", "j1")
    });
  });

  // Items are independent; running them one at a time made a 100-item batch take
  // 100x longer than it needed to. Bounded, though — unbounded fan-out is what
  // exhausts the run-log pool.
  it("runs items in overlapping groups without exceeding the cap", async () => {
    const { ids, step } = harness();
    let inFlight = 0;
    let peak = 0;

    vi.mocked(createWorkflowServices).mockReturnValue({
      runAction: async (_id, inputs) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        const job = inputs.job;
        return job === undefined
          ? { ok: false, error: "This turn had no item." }
          : { ok: true, outputs: { record: job } };
      },
      runOperation: async () => ({ ok: false, error: "not stubbed" }),
      search: async () => ({
        ok: true,
        value: jobs(12),
        matched: 12,
        dropped: 0
      })
    });

    await executeWorkflowRun({ payload, step, logger });

    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(5);
    // Concurrency must not reorder the items: the node's output list is defined to
    // be in item order, and the step ids are the record of that order.
    expect(ids.filter((id) => id.startsWith("node:act:"))).toEqual(
      Array.from({ length: 12 }, (_, i) => `node:act:j${i + 1}`)
    );
  });
});
