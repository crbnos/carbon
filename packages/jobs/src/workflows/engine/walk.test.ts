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
  findTriggerNodeForEvent,
  MAX_NODE_EXECUTIONS,
  nextNode,
  outgoing,
  type WalkState
} from "./walk";

const position = { x: 0, y: 0 };

function trigger(id: string): WorkflowNode {
  return {
    id,
    name: id,
    type: "trigger",
    position,
    data: { events: ["purchaseOrder.status.changed"], origin: "Both" }
  };
}

function action(id: string): WorkflowNode {
  return {
    id,
    name: id,
    type: "action",
    position,
    data: { action: "purchaseOrder.release", inputs: {} }
  };
}

function condition(id: string, pathIds: string[]): WorkflowNode {
  return {
    id,
    name: id,
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
  it("caps node executions at 500", () => {
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
    expect(state.sequence).toBe(1); // reserved 0 for the trigger's own row
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
    expect(state.sequence).toBe(7);
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
    expect(state.sequence).toBe(4);
  });

  it("holds a join back until both branches have settled", () => {
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
    // "a" has run, "b" has not — the join is not ready and is not queued.
    expect(state.frontier).toEqual(["b"]);

    advance(state, def, nextNode(state) as string, DEFAULT_HANDLE);
    expect(state.frontier).toEqual(["join"]);

    expect(nextNode(state)).toBe("join");
    advance(state, def, "join", DEFAULT_HANDLE);
    expect(alreadyExecuted(state, "join")).toBe(true);
    expect(nextNode(state)).toBeUndefined();
  });

  it("does not execute a join before a longer branch has arrived", () => {
    const def = definition(
      [trigger("t"), action("b"), action("c1"), action("c2"), action("d")],
      [
        edge("t", DEFAULT_HANDLE, "b"),
        edge("t", DEFAULT_HANDLE, "c1"),
        edge("b", DEFAULT_HANDLE, "d"),
        edge("c1", DEFAULT_HANDLE, "c2"),
        edge("c2", DEFAULT_HANDLE, "d")
      ]
    );
    expect(drain(createWalkState(def), def)).toEqual(["b", "c1", "c2", "d"]);
  });

  it("releases a join when the other branch was never taken", () => {
    // cond picks p1, so "no" never runs — but "join" must still run, once.
    const def = definition(
      [
        trigger("t"),
        condition("cond", ["p1", "p2"]),
        action("yes"),
        action("no"),
        action("join")
      ],
      [
        edge("t", DEFAULT_HANDLE, "cond"),
        edge("cond", "p1", "yes"),
        edge("cond", "p2", "no"),
        edge("yes", DEFAULT_HANDLE, "join"),
        edge("no", DEFAULT_HANDLE, "join")
      ]
    );
    const state = createWalkState(def);
    expect(drain(state, def, { cond: "p1" })).toEqual(["cond", "yes", "join"]);
    expect([...state.skipped]).toEqual(["no"]);
  });

  it("skips a whole subgraph behind an untaken branch", () => {
    const def = definition(
      [
        trigger("t"),
        condition("cond", ["p1", "p2"]),
        action("yes"),
        action("no1"),
        action("no2")
      ],
      [
        edge("t", DEFAULT_HANDLE, "cond"),
        edge("cond", "p1", "yes"),
        edge("cond", "p2", "no1"),
        edge("no1", DEFAULT_HANDLE, "no2")
      ]
    );
    const state = createWalkState(def);
    expect(drain(state, def, { cond: "p1" })).toEqual(["cond", "yes"]);
    expect([...state.skipped].sort()).toEqual(["no1", "no2"]);
  });

  it("skips a join whose every branch was untaken", () => {
    const def = definition(
      [
        trigger("t"),
        condition("cond", ["p1", "p2"]),
        action("a"),
        action("b"),
        action("join")
      ],
      [
        edge("t", DEFAULT_HANDLE, "cond"),
        edge("cond", "p1", "a"),
        edge("cond", "p2", "b"),
        edge("a", DEFAULT_HANDLE, "join"),
        edge("b", DEFAULT_HANDLE, "join")
      ]
    );
    // A terminal handle on "a" kills the only live path into the join.
    const state = createWalkState(def);
    expect(drain(state, def, { cond: "p1", a: null })).toEqual(["cond", "a"]);
    expect([...state.skipped].sort()).toEqual(["b", "join"]);
  });
});

describe("findTriggerNodeForEvent", () => {
  const t1 = trigger("t1");
  const t2: WorkflowNode = {
    id: "t2",
    name: "t2",
    type: "trigger",
    position,
    data: { events: ["part.created"], origin: "Both" }
  };

  it("returns the trigger whose events list contains the event id", () => {
    const def = definition([t1, t2, action("a")], []);
    expect(findTriggerNodeForEvent(def, "part.created")?.id).toBe("t2");
    expect(
      findTriggerNodeForEvent(def, "purchaseOrder.status.changed")?.id
    ).toBe("t1");
  });

  it("falls back to the first trigger when no event matches (scheduled run)", () => {
    const def = definition([t1, t2, action("a")], []);
    expect(findTriggerNodeForEvent(def, "unknown.event")?.id).toBe("t1");
  });

  it("returns undefined when there is no trigger node", () => {
    const def = definition([action("a")], []);
    expect(
      findTriggerNodeForEvent(def, "purchaseOrder.status.changed")
    ).toBeUndefined();
  });
});

describe("createWalkState with triggerNodeId", () => {
  const t1 = trigger("t1");
  const t2: WorkflowNode = {
    id: "t2",
    name: "t2",
    type: "trigger",
    position,
    data: { events: ["part.created"], origin: "Both" }
  };

  it("seeds frontier from the specified trigger only", () => {
    const def = definition(
      [t1, t2, action("a1"), action("a2")],
      [edge("t1", DEFAULT_HANDLE, "a1"), edge("t2", DEFAULT_HANDLE, "a2")]
    );
    const state = createWalkState(def, "t2");
    expect(state.frontier).toEqual(["a2"]);
    expect(state.frontier).not.toContain("a1");
  });

  it("seeds frontier from the first trigger when no triggerNodeId is passed", () => {
    const def = definition(
      [t1, t2, action("a1"), action("a2")],
      [edge("t1", DEFAULT_HANDLE, "a1"), edge("t2", DEFAULT_HANDLE, "a2")]
    );
    const state = createWalkState(def);
    expect(state.frontier).toEqual(["a1"]);
  });
});
