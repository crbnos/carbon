import {
  type ActionOutcome,
  DEFAULT_HANDLE,
  entityValue,
  type OperationOutcome,
  primitiveValue,
  type RunTrigger,
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

const logger = { info: vi.fn(), error: vi.fn() };

interface SeedDefinition {
  formatVersion: number;
  nodes: unknown[];
  edges: unknown[];
}

/** The one version this run is pinned to, as `loadRunContext` would hand it over. */
function seed(eventId: string, definition: SeedDefinition): void {
  vi.mocked(loadRunContext).mockResolvedValue({
    run: {
      id: "run1",
      companyId: "co1",
      ownerId: "u1",
      workflowId: "wf1",
      workflowVersionId: "wv1",
      eventId,
      status: "Queued"
    },
    workflowPublished: true,
    companyGroupId: "cg1",
    version: definition
  });
}

function payloadFor(eventId: string, trigger: RunTrigger): RunPayload {
  return {
    runId: "run1",
    companyId: "co1",
    workflowId: "wf1",
    workflowVersionId: "wv1",
    eventId,
    ownerId: "u1",
    sourceEventId: "pgmq:1",
    trigger
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

interface Stubs {
  runAction?: (
    actionId: string,
    inputs: Record<string, RuntimeValue>
  ) => ActionOutcome;
  runOperation?: (
    operationId: string,
    inputs: Record<string, RuntimeValue>
  ) => OperationOutcome;
  search?: () => SearchOutcome;
}

function withServices(stubs: Stubs) {
  const runAction = vi.fn(
    async (
      actionId: string,
      inputs: Record<string, RuntimeValue>
    ): Promise<ActionOutcome> =>
      stubs.runAction?.(actionId, inputs) ?? { ok: true, outputs: {} }
  );
  const runOperation = vi.fn(
    async (
      operationId: string,
      inputs: Record<string, RuntimeValue>
    ): Promise<OperationOutcome> =>
      stubs.runOperation?.(operationId, inputs) ?? {
        ok: false,
        error: "not stubbed"
      }
  );
  const search = vi.fn(
    async (): Promise<SearchOutcome> =>
      stubs.search?.() ?? { ok: false, error: "not stubbed" }
  );

  vi.mocked(createWorkflowServices).mockReturnValue({
    runAction,
    runOperation,
    search
  });
  return { runAction, runOperation, search };
}

function callTo(
  runAction: ReturnType<typeof withServices>["runAction"],
  actionId: string
): Record<string, RuntimeValue> | undefined {
  return runAction.mock.calls.find(([id]) => id === actionId)?.[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  let claimed = 0;
  vi.mocked(claimStep).mockImplementation(async () => {
    claimed += 1;
    return { claimed: true, stepRunId: `s${claimed}` };
  });
});

describe("a workflow end to end", () => {
  it("notifies a role with a sentence built from the record", async () => {
    seed("purchaseOrder.status.changed", {
      formatVersion: 2,
      nodes: [
        {
          id: "t1",
          type: "trigger",
          position: { x: 0, y: 0 },
          data: { events: ["purchaseOrder.status.changed"], origin: "Both" }
        },
        {
          id: "total",
          type: "compute",
          position: { x: 0, y: 1 },
          data: {
            operation: "purchaseOrder.total",
            inputs: {
              purchaseOrder: { kind: "ref", nodeId: "t1", output: "record" }
            }
          }
        },
        {
          id: "over",
          type: "condition",
          position: { x: 0, y: 2 },
          data: {
            paths: [
              {
                id: "p1",
                kind: "if",
                combinator: "and",
                clauses: [
                  {
                    left: { kind: "ref", nodeId: "total", output: "result" },
                    operator: "gt",
                    right: {
                      kind: "literal",
                      type: { kind: "primitive", of: "number" },
                      value: 10000
                    }
                  }
                ]
              }
            ]
          }
        },
        {
          id: "tell",
          type: "action",
          position: { x: 0, y: 3 },
          data: {
            action: "notify",
            inputs: {
              role: {
                kind: "literal",
                type: { kind: "entity", of: "group" },
                value: "g-buyers"
              },
              subject: {
                kind: "template",
                parts: [
                  { kind: "text", text: "Purchase order " },
                  {
                    kind: "ref",
                    nodeId: "t1",
                    output: "record",
                    path: ["purchaseOrderId"]
                  },
                  { kind: "text", text: " is over $10,000" }
                ]
              }
            }
          }
        }
      ],
      edges: [
        {
          id: "e1",
          source: "t1",
          sourceHandle: DEFAULT_HANDLE,
          target: "total",
          targetHandle: "in"
        },
        {
          id: "e2",
          source: "total",
          sourceHandle: DEFAULT_HANDLE,
          target: "over",
          targetHandle: "in"
        },
        {
          id: "e3",
          source: "over",
          sourceHandle: "p1",
          target: "tell",
          targetHandle: "in"
        }
      ]
    });

    const { step } = harness();
    const { runAction } = withServices({
      runOperation: () => ({ ok: true, value: primitiveValue("number", 12450) })
    });

    const record = {
      id: "po1",
      purchaseOrderId: "PO-1042",
      status: "To Review"
    };
    const result = await executeWorkflowRun({
      payload: payloadFor("purchaseOrder.status.changed", {
        kind: "record",
        table: "purchaseOrder",
        recordId: "po1",
        operation: "UPDATE",
        record,
        before: { ...record, status: "Draft" },
        after: record
      }),
      step,
      logger
    });

    expect(result.status).toBe("Succeeded");
    expect(runAction.mock.calls.map(([id]) => id)).toEqual(["notify"]);
    expect(callTo(runAction, "notify")?.subject).toEqual(
      primitiveValue("string", "Purchase order PO-1042 is over $10,000")
    );

    // The trigger is recorded, never executed — without its row the run reads as
    // beginning nowhere and the first real step looks skipped.
    const triggerIndex = vi
      .mocked(claimStep)
      .mock.calls.findIndex(([, params]) => params.nodeType === "trigger");
    expect(triggerIndex).toBeGreaterThanOrEqual(0);
    expect(vi.mocked(claimStep).mock.calls[triggerIndex]?.[1].nodeId).toBe(
      "t1"
    );

    const triggerSettle = vi
      .mocked(settleStep)
      .mock.calls.find(
        ([, params]) => params.stepRunId === `s${triggerIndex + 1}`
      )?.[1];
    expect(triggerSettle?.status).toBe("Succeeded");
    expect(
      (triggerSettle?.output as Record<string, RuntimeValue>).record
    ).toEqual(entityValue("purchaseOrder", "po1", record));

    // The values a step finished with are what a person needs to debug it; the
    // stored templates are not. Both survive, under separate keys.
    const tellIndex = vi
      .mocked(claimStep)
      .mock.calls.findIndex(([, params]) => params.nodeId === "tell");
    const actionSettle = vi
      .mocked(settleStep)
      .mock.calls.find(
        ([, params]) => params.stepRunId === `s${tellIndex + 1}`
      )?.[1];
    const actionInput = actionSettle?.input as {
      inputs?: unknown;
      resolved?: Record<string, RuntimeValue>;
    };
    expect(actionInput?.resolved?.subject).toEqual(
      primitiveValue("string", "Purchase order PO-1042 is over $10,000")
    );
    expect(actionInput?.inputs).toBeDefined();
  });

  it("hands a created record on to the next step", async () => {
    seed("sales.quoteAccepted", {
      formatVersion: 2,
      nodes: [
        {
          id: "t1",
          type: "trigger",
          position: { x: 0, y: 0 },
          data: { events: ["sales.quoteAccepted"], origin: "Both" }
        },
        {
          id: "create",
          type: "action",
          position: { x: 0, y: 1 },
          data: {
            action: "salesOrder.create",
            inputs: {
              customerId: {
                kind: "literal",
                type: { kind: "entity", of: "customer" },
                value: "c-acme"
              }
            }
          }
        },
        {
          id: "tell",
          type: "action",
          position: { x: 0, y: 2 },
          data: {
            action: "notify",
            inputs: {
              user: {
                kind: "literal",
                type: { kind: "entity", of: "user" },
                value: "u-sales"
              },
              subject: {
                kind: "template",
                parts: [
                  { kind: "text", text: "Sales order " },
                  {
                    kind: "ref",
                    nodeId: "create",
                    output: "record",
                    path: ["salesOrderId"]
                  },
                  { kind: "text", text: " is ready" }
                ]
              },
              aboutId: {
                kind: "ref",
                nodeId: "create",
                output: "record",
                path: ["id"]
              },
              aboutType: {
                kind: "literal",
                type: { kind: "primitive", of: "string" },
                value: "salesOrder"
              }
            }
          }
        }
      ],
      edges: [
        {
          id: "e1",
          source: "t1",
          sourceHandle: DEFAULT_HANDLE,
          target: "create",
          targetHandle: "in"
        },
        {
          id: "e2",
          source: "create",
          sourceHandle: SUCCESS_HANDLE,
          target: "tell",
          targetHandle: "in"
        }
      ]
    });

    const { step } = harness();
    const { runAction } = withServices({
      runAction: (actionId): ActionOutcome =>
        actionId === "salesOrder.create"
          ? {
              ok: true,
              outputs: {
                record: entityValue("salesOrder", "so-9", {
                  id: "so-9",
                  salesOrderId: "SO-77"
                })
              }
            }
          : { ok: true, outputs: {} }
    });

    const result = await executeWorkflowRun({
      payload: payloadFor("sales.quoteAccepted", {
        kind: "moment",
        moment: "sales.quoteAccepted",
        outputs: { quote: { id: "q1" }, salesOrder: { id: "so-1" } }
      }),
      step,
      logger
    });

    expect(result.status).toBe("Succeeded");
    expect(runAction.mock.calls.map(([id]) => id)).toEqual([
      "salesOrder.create",
      "notify"
    ]);
    const notify = callTo(runAction, "notify");
    expect(notify?.aboutId).toEqual(primitiveValue("string", "so-9"));
    expect(notify?.subject).toEqual(
      primitiveValue("string", "Sales order SO-77 is ready")
    );
  });

  it("claims one step per job when a batched update follows a lookup", async () => {
    seed("job.status.changed", {
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
          data: {
            entity: "job",
            returns: "list",
            match: [
              {
                field: "status",
                operator: "eq",
                value: {
                  kind: "literal",
                  type: { kind: "primitive", of: "string" },
                  value: "Ready"
                }
              }
            ]
          }
        },
        {
          id: "keep",
          type: "filter",
          position: { x: 0, y: 2 },
          data: {
            source: { kind: "ref", nodeId: "look", output: "result" },
            combinator: "and",
            clauses: [
              {
                left: { kind: "item", path: ["priority"] },
                operator: "gt",
                right: {
                  kind: "literal",
                  type: { kind: "primitive", of: "number" },
                  value: 0
                }
              }
            ]
          }
        },
        {
          id: "bump",
          type: "action",
          position: { x: 0, y: 3 },
          data: {
            action: "job.update",
            inputs: {
              job: { kind: "ref", nodeId: "keep", output: "result" },
              priority: {
                kind: "literal",
                type: { kind: "primitive", of: "number" },
                value: 5
              }
            }
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
          target: "keep",
          targetHandle: "in"
        },
        {
          id: "e3",
          source: "keep",
          sourceHandle: DEFAULT_HANDLE,
          target: "bump",
          targetHandle: "in"
        }
      ]
    });

    const { step } = harness();
    const { runAction } = withServices({
      // The last job is filtered out, so only two reach the batch.
      search: () => {
        const items = [
          entityValue("job", "j1", { id: "j1", status: "Ready", priority: 3 }),
          entityValue("job", "j2", { id: "j2", status: "Ready", priority: 1 }),
          entityValue("job", "j3", { id: "j3", status: "Ready", priority: 0 })
        ];
        return {
          ok: true,
          value: { kind: "list", of: { kind: "entity", of: "job" }, items },
          matched: items.length,
          dropped: 0
        };
      },
      runAction: (_actionId, inputs) => {
        const job = inputs.job;
        return job === undefined
          ? { ok: false, error: "This turn had no item." }
          : { ok: true, outputs: { record: job } };
      }
    });

    const result = await executeWorkflowRun({
      payload: payloadFor("job.status.changed", {
        kind: "record",
        table: "job",
        recordId: "j0",
        operation: "UPDATE",
        record: { id: "j0", status: "Ready" },
        before: { id: "j0", status: "Draft" },
        after: { id: "j0", status: "Ready" }
      }),
      step,
      logger
    });

    expect(result.status).toBe("Succeeded");
    const keys = vi
      .mocked(claimStep)
      .mock.calls.filter(
        ([, params]) => params.nodeId === "bump" && params.itemKey !== ""
      )
      .map(([, params]) => params.itemKey);
    expect(keys).toEqual(["j1", "j2"]);
    expect(runAction.mock.calls.map(([, inputs]) => inputs.job)).toEqual([
      entityValue("job", "j1", { id: "j1", status: "Ready", priority: 3 }),
      entityValue("job", "j2", { id: "j2", status: "Ready", priority: 1 })
    ]);
  });

  it("opens one issue when a computed total clears the condition", async () => {
    seed("job.scrapQuantity.changed", {
      formatVersion: 2,
      nodes: [
        {
          id: "t1",
          type: "trigger",
          position: { x: 0, y: 0 },
          data: { events: ["job.scrapQuantity.changed"], origin: "Both" }
        },
        {
          id: "scrap",
          type: "compute",
          position: { x: 0, y: 1 },
          data: {
            operation: "job.totalScrapQuantity",
            inputs: { job: { kind: "ref", nodeId: "t1", output: "record" } }
          }
        },
        {
          id: "over",
          type: "condition",
          position: { x: 0, y: 2 },
          data: {
            paths: [
              {
                id: "p1",
                kind: "if",
                combinator: "and",
                clauses: [
                  {
                    left: { kind: "ref", nodeId: "scrap", output: "result" },
                    operator: "gt",
                    right: {
                      kind: "literal",
                      type: { kind: "primitive", of: "number" },
                      value: 5
                    }
                  }
                ]
              }
            ]
          }
        },
        {
          id: "open",
          type: "action",
          position: { x: 0, y: 3 },
          data: {
            action: "nonConformance.create",
            inputs: {
              name: {
                kind: "template",
                parts: [
                  { kind: "text", text: "Excess scrap on " },
                  {
                    kind: "ref",
                    nodeId: "t1",
                    output: "record",
                    path: ["jobId"]
                  }
                ]
              }
            }
          }
        }
      ],
      edges: [
        {
          id: "e1",
          source: "t1",
          sourceHandle: DEFAULT_HANDLE,
          target: "scrap",
          targetHandle: "in"
        },
        {
          id: "e2",
          source: "scrap",
          sourceHandle: DEFAULT_HANDLE,
          target: "over",
          targetHandle: "in"
        },
        {
          id: "e3",
          source: "over",
          sourceHandle: "p1",
          target: "open",
          targetHandle: "in"
        }
      ]
    });

    const { step } = harness();
    const { runAction } = withServices({
      runOperation: () => ({ ok: true, value: primitiveValue("number", 7) }),
      runAction: () => ({
        ok: true,
        outputs: { record: entityValue("nonConformance", "ncr-1") }
      })
    });

    const record = { id: "j1", jobId: "J-0007", scrapQuantity: 7 };
    const result = await executeWorkflowRun({
      payload: payloadFor("job.scrapQuantity.changed", {
        kind: "record",
        table: "job",
        recordId: "j1",
        operation: "UPDATE",
        record,
        before: { ...record, scrapQuantity: 0 },
        after: record
      }),
      step,
      logger
    });

    expect(result.status).toBe("Succeeded");
    expect(runAction.mock.calls.map(([id]) => id)).toEqual([
      "nonConformance.create"
    ]);
    expect(callTo(runAction, "nonConformance.create")?.name).toEqual(
      primitiveValue("string", "Excess scrap on J-0007")
    );
  });
});
