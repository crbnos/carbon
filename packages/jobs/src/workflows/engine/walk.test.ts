import {
  CURRENT_DEFINITION_FORMAT_VERSION,
  DEFAULT_HANDLE,
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowNode
} from "@carbon/workflows";
import { describe, expect, it } from "vitest";
import {
  advance,
  alreadyExecuted,
  createWalkState,
  findTriggerNode,
  MAX_NODE_EXECUTIONS,
  nextNode,
  outgoing,
  type WalkState
} from "./walk";

const position = { x: 0, y: 0 };

function trigger(id: string): WorkflowNode {
  return {
    id,
    type: "trigger",
    position,
    data: { events: ["purchaseOrder.status.changed"], origin: "Both" }
  };
}

function action(id: string): WorkflowNode {
  return {
    id,
    type: "action",
    position,
    data: { action: "purchaseOrder.release", inputs: {}, batch: false }
  };
}

function condition(id: string, pathIds: string[]): WorkflowNode {
  return {
    id,
    type: "condition",
    position,
    data: {
      paths: pathIds.map((pathId, index) => ({
        id: pathId,
        kind: index === 0 ? ("if" as const) : ("elseIf" as const),
        combinator: "and" as const,
        clauses: []
      }))
    }
  };
}

function edge(
  source: string,
  sourceHandle: string,
  target: string
): WorkflowEdge {
  return {
    id: `e_${source}_${sourceHandle}_${target}`,
    source,
    sourceHandle,
    target,
    targetHandle: "in"
  };
}

function definition(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[]
): WorkflowDefinition {
  return {
    formatVersion: CURRENT_DEFINITION_FORMAT_VERSION,
    nodes,
    edges
  };
}

/** Runs the walk to completion, taking each node's handle from `handles`. */
function drain(
  state: WalkState,
  def: WorkflowDefinition,
  handles: Record<string, string | null> = {}
): string[] {
  const order: string[] = [];
  let nodeId = nextNode(state);
  while (nodeId !== undefined) {
    if (!alreadyExecuted(state, nodeId)) {
      order.push(nodeId);
      const handle =
        nodeId in handles ? (handles[nodeId] ?? null) : DEFAULT_HANDLE;
      advance(state, def, nodeId, handle);
    }
    nodeId = nextNode(state);
  }
  return order;
}

describe("MAX_NODE_EXECUTIONS", () => {
  it("is the PRD cap", () => {
    expect(MAX_NODE_EXECUTIONS).toBe(500);
  });
});

describe("findTriggerNode", () => {
  it("finds the trigger node", () => {
    const def = definition([action("a"), trigger("t")], []);
    expect(findTriggerNode(def)?.id).toBe("t");
  });

  it("returns undefined when there is no trigger", () => {
    expect(findTriggerNode(definition([action("a")], []))).toBeUndefined();
  });
});

describe("outgoing", () => {
  const def = definition(
    [trigger("t"), action("a"), action("b")],
    [edge("t", DEFAULT_HANDLE, "a"), edge("t", "other", "b")]
  );

  it("returns only the targets of the given handle", () => {
    expect(outgoing(def, "t", DEFAULT_HANDLE)).toEqual(["a"]);
    expect(outgoing(def, "t", "other")).toEqual(["b"]);
  });

  it("returns [] for a null handle", () => {
    expect(outgoing(def, "t", null)).toEqual([]);
  });

  it("returns [] for an unconnected handle", () => {
    expect(outgoing(def, "t", "missing")).toEqual([]);
  });

  it("respects stored edge order", () => {
    const ordered = definition(
      [trigger("t"), action("a"), action("b"), action("c")],
      [
        edge("t", DEFAULT_HANDLE, "c"),
        edge("t", DEFAULT_HANDLE, "a"),
        edge("t", DEFAULT_HANDLE, "b")
      ]
    );
    expect(outgoing(ordered, "t", DEFAULT_HANDLE)).toEqual(["c", "a", "b"]);
  });
});

describe("createWalkState", () => {
  it("seeds the frontier from the trigger's default handle", () => {
    const def = definition(
      [trigger("t"), action("a"), action("b")],
      [edge("t", DEFAULT_HANDLE, "a"), edge("t", "other", "b")]
    );
    const state = createWalkState(def);
    expect(state.frontier).toEqual(["a"]);
    expect(state.executed.size).toBe(0);
    expect(state.sequence).toBe(0);
  });

  it("starts empty when there is no trigger node", () => {
    const def = definition(
      [action("a"), action("b")],
      [edge("a", DEFAULT_HANDLE, "b")]
    );
    expect(createWalkState(def).frontier).toEqual([]);
  });
});

describe("walking", () => {
  it("visits a fan-out of three breadth-first", () => {
    const def = definition(
      [
        trigger("t"),
        action("a"),
        action("b"),
        action("c"),
        action("a1"),
        action("b1"),
        action("c1")
      ],
      [
        edge("t", DEFAULT_HANDLE, "a"),
        edge("t", DEFAULT_HANDLE, "b"),
        edge("t", DEFAULT_HANDLE, "c"),
        edge("a", DEFAULT_HANDLE, "a1"),
        edge("b", DEFAULT_HANDLE, "b1"),
        edge("c", DEFAULT_HANDLE, "c1")
      ]
    );
    const state = createWalkState(def);
    expect(drain(state, def)).toEqual(["a", "b", "c", "a1", "b1", "c1"]);
    expect(state.sequence).toBe(6);
  });

  it("follows edge order rather than node order", () => {
    const def = definition(
      [trigger("t"), action("a"), action("b"), action("c")],
      [
        edge("t", DEFAULT_HANDLE, "c"),
        edge("t", DEFAULT_HANDLE, "a"),
        edge("t", DEFAULT_HANDLE, "b")
      ]
    );
    expect(drain(createWalkState(def), def)).toEqual(["c", "a", "b"]);
  });

  it("takes only the branch a condition's handle selects", () => {
    const def = definition(
      [
        trigger("t"),
        condition("cond", ["p1", "p2"]),
        action("yes"),
        action("no")
      ],
      [
        edge("t", DEFAULT_HANDLE, "cond"),
        edge("cond", "p1", "yes"),
        edge("cond", "p2", "no")
      ]
    );
    expect(drain(createWalkState(def), def, { cond: "p2" })).toEqual([
      "cond",
      "no"
    ]);
  });

  it("stops a branch whose node returns a null handle", () => {
    const def = definition(
      [trigger("t"), action("a"), action("a1")],
      [edge("t", DEFAULT_HANDLE, "a"), edge("a", DEFAULT_HANDLE, "a1")]
    );
    expect(drain(createWalkState(def), def, { a: null })).toEqual(["a"]);
  });

  it("executes a node reachable from two branches only once", () => {
    const def = definition(
      [trigger("t"), action("a"), action("b"), action("join")],
      [
        edge("t", DEFAULT_HANDLE, "a"),
        edge("t", DEFAULT_HANDLE, "b"),
        edge("a", DEFAULT_HANDLE, "join"),
        edge("b", DEFAULT_HANDLE, "join")
      ]
    );
    const state = createWalkState(def);
    expect(drain(state, def)).toEqual(["a", "b", "join"]);
    expect([...state.executed]).toEqual(["a", "b", "join"]);
    expect(state.sequence).toBe(3);
  });

  it("reports alreadyExecuted on the second arrival at a join", () => {
    const def = definition(
      [trigger("t"), action("a"), action("b"), action("join")],
      [
        edge("t", DEFAULT_HANDLE, "a"),
        edge("t", DEFAULT_HANDLE, "b"),
        edge("a", DEFAULT_HANDLE, "join"),
        edge("b", DEFAULT_HANDLE, "join")
      ]
    );
    const state = createWalkState(def);
    expect(alreadyExecuted(state, "join")).toBe(false);

    advance(state, def, nextNode(state) as string, DEFAULT_HANDLE);
    advance(state, def, nextNode(state) as string, DEFAULT_HANDLE);

    // Both branches queued "join", so it sits in the frontier twice.
    expect(state.frontier).toEqual(["join", "join"]);
    expect(nextNode(state)).toBe("join");
    advance(state, def, "join", DEFAULT_HANDLE);
    expect(nextNode(state)).toBe("join");
    expect(alreadyExecuted(state, "join")).toBe(true);
    expect(nextNode(state)).toBeUndefined();
  });
});
