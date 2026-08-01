import type { WorkflowNodeType } from "@carbon/workflows";
import {
  NODE_KINDS,
  nodeSchema,
  workflowDefinitionSchema
} from "@carbon/workflows";
import { describe, expect, it } from "vitest";
import type { BuilderEdge, BuilderNode } from "../../types";
import {
  createNode,
  fromReactFlow,
  nextNodePosition,
  toReactFlow,
  wouldCreateCycle
} from "./graph";

const edge = (
  id: string,
  source: string,
  target: string,
  sourceHandle: string | null = "out"
): BuilderEdge => ({
  id,
  source,
  target,
  sourceHandle,
  targetHandle: "in"
});

describe("fromReactFlow", () => {
  it("drops React Flow runtime fields and produces a valid definition", () => {
    const nodes = [
      {
        ...createNode("trigger", { x: 0, y: 0 }),
        selected: true,
        dragging: false,
        measured: { width: 440, height: 180 },
        width: 440,
        height: 180
      },
      createNode("action", { x: 0, y: 260 })
    ] as unknown as BuilderNode[];

    const definition = fromReactFlow(nodes, [
      edge("e1", nodes[0].id, nodes[1].id)
    ]);

    expect(Object.keys(definition.nodes[0]).sort()).toEqual([
      "data",
      "expanded",
      "id",
      "position",
      "type"
    ]);
    expect(workflowDefinitionSchema.safeParse(definition).success).toBe(true);
  });

  it("drops an edge whose sourceHandle is null", () => {
    const a = createNode("trigger", { x: 0, y: 0 });
    const b = createNode("action", { x: 0, y: 260 });
    const definition = fromReactFlow([a, b] as unknown as BuilderNode[], [
      edge("e1", a.id, b.id, null),
      edge("e2", a.id, b.id)
    ]);

    expect(definition.edges).toHaveLength(1);
    expect(definition.edges[0].id).toBe("e2");
  });

  it("round-trips expanded: false through fromReactFlow and toReactFlow", () => {
    const a = {
      ...createNode("trigger", { x: 0, y: 0 }),
      expanded: false
    } as unknown as BuilderNode;
    const definition = fromReactFlow([a], []);
    expect(definition.nodes[0].expanded).toBe(false);
    const flow = toReactFlow(definition);
    expect(flow.nodes[0].expanded).toBe(false);
  });

  it("defaults expanded to true when missing from a stored definition", () => {
    const raw = {
      id: "n1",
      type: "trigger",
      position: { x: 0, y: 0 },
      data: { events: [], origin: "Both" }
    };
    const definition = workflowDefinitionSchema.parse({
      formatVersion: 2,
      nodes: [raw],
      edges: []
    });
    const flow = toReactFlow(definition);
    expect(flow.nodes[0].expanded).toBe(true);
  });
});

describe("wouldCreateCycle", () => {
  it("rejects a direct back edge", () => {
    expect(wouldCreateCycle([edge("e1", "a", "b")], "b", "a")).toBe(true);
  });

  it("rejects a three-node cycle", () => {
    const edges = [edge("e1", "a", "b"), edge("e2", "b", "c")];
    expect(wouldCreateCycle(edges, "c", "a")).toBe(true);
  });

  it("rejects a self-connection", () => {
    expect(wouldCreateCycle([], "a", "a")).toBe(true);
  });

  it("allows a diamond", () => {
    const edges = [
      edge("e1", "a", "b"),
      edge("e2", "a", "c"),
      edge("e3", "b", "d")
    ];
    expect(wouldCreateCycle(edges, "c", "d")).toBe(false);
  });
});

describe("createNode", () => {
  it("produces a schema-valid node for every kind", () => {
    for (const kind of Object.keys(NODE_KINDS) as WorkflowNodeType[]) {
      const node = createNode(kind, { x: 0, y: 0 });
      const parsed = nodeSchema.safeParse(node);
      expect(parsed.success, `${kind} failed to parse`).toBe(true);
    }
  });

  it("seeds a condition with an if path and an else path", () => {
    const node = createNode("condition", { x: 0, y: 0 });
    if (node.type !== "condition") throw new Error("wrong kind");
    expect(node.data.paths).toHaveLength(2);
    expect(node.data.paths.map((p) => p.kind)).toEqual(["if", "else"]);
  });
});

describe("toReactFlow", () => {
  it("round-trips a small graph unchanged", () => {
    const a = createNode("trigger", { x: 0, y: 0 });
    const b = createNode("action", { x: 0, y: 260 });
    const definition = fromReactFlow([a, b] as unknown as BuilderNode[], [
      edge("e1", a.id, b.id)
    ]);

    const flow = toReactFlow(definition);
    expect(fromReactFlow(flow.nodes, flow.edges)).toEqual(definition);
  });

  it("round-trips a node's title through fromReactFlow → toReactFlow → fromReactFlow", () => {
    const a = createNode("trigger", { x: 0, y: 0 });
    const b = {
      ...createNode("action", { x: 0, y: 260 }),
      title: "Send alert"
    };
    const definition = fromReactFlow([a, b] as unknown as BuilderNode[], [
      edge("e1", a.id, b.id)
    ]);

    expect(definition.nodes[1].title).toBe("Send alert");

    const flow = toReactFlow(definition);
    expect(flow.nodes[1].title).toBe("Send alert");

    const roundTripped = fromReactFlow(flow.nodes, flow.edges);
    expect(roundTripped.nodes[1].title).toBe("Send alert");
    expect(roundTripped.nodes[0].title).toBeUndefined();
  });
});

describe("nextNodePosition", () => {
  it("places the first node at the origin", () => {
    expect(nextNodePosition([], undefined)).toEqual({ x: 0, y: 0 });
  });

  it("places to the right of the anchor at the same y", () => {
    const a = { ...createNode("trigger", { x: 0, y: 0 }) } as BuilderNode;
    const position = nextNodePosition([a], a);
    expect(position.x).toBeGreaterThan(a.position.x);
    expect(position.y).toBe(a.position.y);
  });

  it("nudges down when the position to the right is occupied", () => {
    const a = { ...createNode("trigger", { x: 0, y: 0 }) } as BuilderNode;
    const taken = {
      ...createNode("action", { x: 480, y: 0 })
    } as BuilderNode;
    const position = nextNodePosition([a, taken], a);
    expect(position.x).toBe(480);
    expect(position.y).toBeGreaterThan(0);
  });
});
