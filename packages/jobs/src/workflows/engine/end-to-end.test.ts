// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
} from "@carbon/ee/workflows";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineStep, RunPayload } from "./execute";

vi.mock("@carbon/ee/workflows.server", () => ({
  workflowsEnabledForCompany: vi.fn(async () => true)
}));
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

type Ref = { kind: "ref"; nodeId: string; output: string; path?: string[] };
const ref = (nodeId: string, output: string, path?: string[]): Ref =>
  path
    ? { kind: "ref", nodeId, output, path }
    : { kind: "ref", nodeId, output };
const literal = (type: unknown, value: unknown) => ({
  kind: "literal",
  type,
  value
});
const template = (...parts: (string | Ref)[]) => ({
  kind: "template",
  parts: parts.map((part) =>
    typeof part === "string" ? { kind: "text", text: part } : part
  )
});

/** Nodes laid out top to bottom; each edge is [source, sourceHandle, target]. */
function definition(
  nodes: [id: string, type: string, data: unknown][],
  edges: [source: string, handle: string, target: string][]
): SeedDefinition {
  return {
    formatVersion: 2,
    nodes: nodes.map(([id, type, data], y) => ({
      id,
      type,
      position: { x: 0, y },
      data
    })),
    edges: edges.map(([source, sourceHandle, target], i) => ({
      id: `e${i + 1}`,
      source,
      sourceHandle,
      target,
      targetHandle: "in"
    }))
  };
}

/** trigger → compute → "result > threshold" → action. */
function computeThenAct(params: {
  event: string;
  operation: string;
  operationInputs: Record<string, Ref>;
  threshold: number;
  actionId: string;
  action: string;
  actionInputs: Record<string, unknown>;
}): SeedDefinition {
  return definition(
    [
      ["t1", "trigger", { events: [params.event], origin: "Both" }],
      [
        "compute",
        "compute",
        { operation: params.operation, inputs: params.operationInputs }
      ],
      [
        "over",
        "condition",
        {
          paths: [
            {
              id: "p1",
              kind: "if",
              combinator: "and",
              clauses: [
                {
                  left: ref("compute", "result"),
                  operator: "gt",
                  right: literal(
                    { kind: "primitive", of: "number" },
                    params.threshold
                  )
                }
              ]
            }
          ]
        }
      ],
      [
        params.actionId,
        "action",
        { action: params.action, inputs: params.actionInputs }
      ]
    ],
    [
      ["t1", DEFAULT_HANDLE, "compute"],
      ["compute", DEFAULT_HANDLE, "over"],
      ["over", "p1", params.actionId]
    ]
  );
}

describe("a workflow end to end", () => {
  it("notifies a role with a sentence built from the record", async () => {
    seed(
      "purchaseOrder.status.changed",
      computeThenAct({
        event: "purchaseOrder.status.changed",
        operation: "purchaseOrder.total",
        operationInputs: { purchaseOrder: ref("t1", "record") },
        threshold: 10000,
        actionId: "tell",
        action: "notify",
        actionInputs: {
          role: literal({ kind: "entity", of: "group" }, "g-buyers"),
          subject: template(
            "Purchase order ",
            ref("t1", "record", ["purchaseOrderId"]),
            " is over $10,000"
          )
        }
      })
    );

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
    seed(
      "sales.quoteAccepted",
      definition(
        [
          [
            "t1",
            "trigger",
            { events: ["sales.quoteAccepted"], origin: "Both" }
          ],
          [
            "create",
            "action",
            {
              action: "salesOrder.create",
              inputs: {
                customerId: literal(
                  { kind: "entity", of: "customer" },
                  "c-acme"
                )
              }
            }
          ],
          [
            "tell",
            "action",
            {
              action: "notify",
              inputs: {
                user: literal({ kind: "entity", of: "user" }, "u-sales"),
                subject: template(
                  "Sales order ",
                  ref("create", "record", ["salesOrderId"]),
                  " is ready"
                ),
                aboutId: ref("create", "record", ["id"]),
                aboutType: literal(
                  { kind: "primitive", of: "string" },
                  "salesOrder"
                )
              }
            }
          ]
        ],
        [
          ["t1", DEFAULT_HANDLE, "create"],
          ["create", SUCCESS_HANDLE, "tell"]
        ]
      )
    );

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

  it("opens one issue when a computed total clears the condition", async () => {
    seed(
      "job.scrapQuantity.changed",
      computeThenAct({
        event: "job.scrapQuantity.changed",
        operation: "job.totalScrapQuantity",
        operationInputs: { job: ref("t1", "record") },
        threshold: 5,
        actionId: "open",
        action: "nonConformance.create",
        actionInputs: {
          name: template("Excess scrap on ", ref("t1", "record", ["jobId"]))
        }
      })
    );

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
