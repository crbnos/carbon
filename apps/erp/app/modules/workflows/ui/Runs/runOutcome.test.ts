import type { WorkflowDefinition } from "@carbon/workflows";
import { describe, expect, it, vi } from "vitest";
import type {
  WorkflowRunDetail,
  WorkflowRunStep
} from "../../workflows.service";
import { runOutcome } from "./runOutcome";

// `msg` is a compile-time macro and plain vitest doesn't transform it, so the raw
// export throws on access. Stub it to the interpolated source string.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((out, part, i) => out + part + (values[i] ?? ""), "")
}));

const run = (overrides: Partial<WorkflowRunDetail> = {}): WorkflowRunDetail =>
  ({
    id: "run1",
    status: "Succeeded",
    statusReason: null,
    error: null,
    ...overrides
  }) as unknown as WorkflowRunDetail;

const step = (overrides: Partial<WorkflowRunStep> = {}): WorkflowRunStep =>
  ({
    id: "s1",
    runId: "run1",
    sequence: 1,
    nodeId: "n1",
    nodeType: "trigger",
    itemKey: null,
    status: "Succeeded",
    statusReason: null,
    branchTaken: null,
    error: null,
    ...overrides
  }) as unknown as WorkflowRunStep;

const definition = (
  nodes: {
    id: string;
    type: string;
    name?: string;
    data?: Record<string, unknown>;
  }[]
): WorkflowDefinition =>
  ({
    formatVersion: 3,
    nodes: nodes.map((n) => ({
      id: n.id,
      name: n.name ?? n.id,
      type: n.type,
      position: { x: 0, y: 0 },
      data: n.data ?? {}
    })),
    edges: []
  }) as unknown as WorkflowDefinition;

describe("runOutcome", () => {
  it("describes a failure with the failing step and the error", () => {
    const outcome = runOutcome(
      run({ status: "Failed", error: "boom" }),
      [
        step({ id: "s1", nodeId: "n1", nodeType: "trigger" }),
        step({
          id: "s2",
          nodeId: "n2",
          nodeType: "action",
          sequence: 2,
          status: "Failed"
        })
      ],
      definition([
        { id: "n1", type: "trigger" },
        { id: "n2", type: "action" }
      ])
    );

    expect(outcome.tone).toBe("danger");
    expect(outcome.text).toContain("Failed at");
    expect(outcome.text).toContain("boom");
  });

  it("names the failing step by the name the user gave it, not its node id", () => {
    const outcome = runOutcome(
      run({ status: "Failed", error: "boom" }),
      [
        step({ id: "s1", nodeId: "n1", nodeType: "trigger" }),
        step({
          id: "s2",
          nodeId: "n2",
          nodeType: "action",
          sequence: 2,
          status: "Failed"
        })
      ],
      definition([
        { id: "n1", type: "trigger" },
        { id: "n2", type: "action", name: "flag_large_po" }
      ])
    );

    expect(outcome.text).toContain('Failed at "Flag Large Po"');
    expect(outcome.text).not.toContain("n2");
  });

  it("describes a blocked run with its reason", () => {
    const outcome = runOutcome(
      run({ status: "Blocked", statusReason: "Concurrency limit" }),
      [],
      null
    );

    expect(outcome.tone).toBe("warning");
    expect(outcome.text).toBe("Blocked — Concurrency limit");
  });

  it("describes a skipped run with its reason", () => {
    const outcome = runOutcome(
      run({ status: "Skipped", statusReason: "Workflow disabled" }),
      [],
      null
    );

    expect(outcome.tone).toBe("warning");
    expect(outcome.text).toBe("Skipped — Workflow disabled");
  });

  it("describes a queued run", () => {
    const outcome = runOutcome(run({ status: "Queued" }), [], null);

    expect(outcome.tone).toBe("neutral");
    expect(outcome.text).toBe("Waiting to start.");
  });

  it("describes a running run", () => {
    const outcome = runOutcome(run({ status: "Running" }), [], null);

    expect(outcome.tone).toBe("neutral");
    expect(outcome.text).toBe("Running now…");
  });

  it("says nothing happened, with the not-run count, when a condition matched no path", () => {
    const outcome = runOutcome(
      run(),
      [
        step({ id: "s1", nodeId: "n1", nodeType: "trigger" }),
        step({
          id: "s2",
          nodeId: "n2",
          nodeType: "condition",
          sequence: 2,
          branchTaken: "none"
        })
      ],
      definition([
        { id: "n1", type: "trigger" },
        { id: "n2", type: "condition" },
        { id: "n3", type: "action" },
        { id: "n4", type: "action" }
      ])
    );

    expect(outcome.tone).toBe("warning");
    expect(outcome.text).toContain("Nothing happened");
    expect(outcome.text).toContain("2 steps");
  });

  it("omits the count from the nothing-happened sentence when the definition is null", () => {
    const outcome = runOutcome(
      run(),
      [
        step({
          id: "s2",
          nodeId: "n2",
          nodeType: "condition",
          branchTaken: "none"
        })
      ],
      null
    );

    expect(outcome.tone).toBe("warning");
    expect(outcome.text).toContain("Nothing happened");
    expect(outcome.text).not.toContain("NaN");
    expect(outcome.text).not.toContain("undefined");
    expect(outcome.text).not.toContain("never ran");
  });

  it("reports a skipped step as stopping the run early", () => {
    const outcome = runOutcome(
      run(),
      [
        step({ id: "s1", nodeId: "n1", nodeType: "trigger" }),
        step({
          id: "s2",
          nodeId: "n2",
          nodeType: "action",
          sequence: 2,
          status: "Skipped",
          statusReason: "upstream produced no rows"
        })
      ],
      definition([
        { id: "n1", type: "trigger" },
        { id: "n2", type: "action" }
      ])
    );

    expect(outcome.tone).toBe("warning");
    expect(outcome.text).toContain("Stopped early");
    expect(outcome.text).toContain("upstream produced no rows");
  });

  it("reports how many steps ran on a plain success", () => {
    const outcome = runOutcome(
      run(),
      [
        step({ id: "s1", nodeId: "n1", nodeType: "trigger" }),
        step({ id: "s2", nodeId: "n2", nodeType: "action", sequence: 2 })
      ],
      definition([
        { id: "n1", type: "trigger" },
        { id: "n2", type: "action" }
      ])
    );

    expect(outcome.tone).toBe("neutral");
    expect(outcome.text).toBe("Completed — 2 of 2 steps ran.");
  });

  it("ignores per-item step rows when counting", () => {
    const outcome = runOutcome(
      run(),
      [
        step({ id: "s1", nodeId: "n1", nodeType: "trigger" }),
        step({
          id: "s2",
          nodeId: "n2",
          nodeType: "action",
          sequence: 2,
          itemKey: "0"
        })
      ],
      definition([
        { id: "n1", type: "trigger" },
        { id: "n2", type: "action" }
      ])
    );

    expect(outcome.text).toBe("Completed — 1 of 2 steps ran.");
  });
});
