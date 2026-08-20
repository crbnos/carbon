import { describe, expect, it } from "vitest";
import { topologicalNodeOrder } from "./order";
import type { WorkflowDefinition } from "./schema";

function makeDefinition(
  nodes: WorkflowDefinition["nodes"],
  edges: WorkflowDefinition["edges"] = []
): WorkflowDefinition {
  return { formatVersion: 2, nodes, edges };
}

const trigger = (id: string) =>
  ({
    id,
    name: id,
    type: "trigger" as const,
    position: { x: 0, y: 0 },
    data: { events: [], origin: "Both" as const }
  }) satisfies WorkflowDefinition["nodes"][number];

const condition = (id: string) =>
  ({
    id,
    name: id,
    type: "condition" as const,
    position: { x: 0, y: 0 },
    data: { paths: [] }
  }) satisfies WorkflowDefinition["nodes"][number];

const action = (id: string) =>
  ({
    id,
    name: id,
    type: "action" as const,
    position: { x: 0, y: 0 },
    data: { action: "", inputs: {} }
  }) satisfies WorkflowDefinition["nodes"][number];

const edge = (
  source: string,
  target: string
): WorkflowDefinition["edges"][number] => ({
  id: `${source}-${target}`,
  source,
  sourceHandle: "out",
  target,
  targetHandle: "in"
});

describe("topologicalNodeOrder", () => {
  it("linear graph: trigger → condition → action returns ids in that order", () => {
    const def = makeDefinition(
      [trigger("t"), condition("c"), action("a")],
      [edge("t", "c"), edge("c", "a")]
    );
    expect(topologicalNodeOrder(def)).toEqual(["t", "c", "a"]);
  });

  it("condition with two branches: the branch whose node is first in nodes array comes first", () => {
    const def = makeDefinition(
      [trigger("t"), condition("c"), action("a1"), action("a2")],
      [edge("t", "c"), edge("c", "a1"), edge("c", "a2")]
    );
    const order = topologicalNodeOrder(def);
    expect(order[0]).toBe("t");
    expect(order[1]).toBe("c");
    expect(order.indexOf("a1")).toBeLessThan(order.indexOf("a2"));
  });

  it("a node with no incoming edge appears at the end", () => {
    const def = makeDefinition(
      [trigger("t"), action("a"), action("orphan")],
      [edge("t", "a")]
    );
    const order = topologicalNodeOrder(def);
    expect(order.at(-1)).toBe("orphan");
    expect(order).toHaveLength(3);
  });

  it("definition with no trigger returns every node id exactly once", () => {
    const def = makeDefinition([action("a"), action("b"), condition("c")]);
    const order = topologicalNodeOrder(def);
    expect(order).toHaveLength(3);
    expect(new Set(order).size).toBe(3);
  });

  it("two edges converging on one node: that node appears exactly once", () => {
    const def = makeDefinition(
      [trigger("t"), action("branch1"), action("branch2"), action("merge")],
      [
        edge("t", "branch1"),
        edge("t", "branch2"),
        edge("branch1", "merge"),
        edge("branch2", "merge")
      ]
    );
    const order = topologicalNodeOrder(def);
    const mergeCount = order.filter((id) => id === "merge").length;
    expect(mergeCount).toBe(1);
    expect(order).toHaveLength(4);
  });
});
