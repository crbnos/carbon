import { describe, expect, it } from "vitest";
import { getNodeHandles } from "./nodes";
import {
  CURRENT_DEFINITION_FORMAT_VERSION,
  edgeSchema,
  nodeSchema,
  workflowDefinitionSchema
} from "./schema";
import { scheduleSchema, valueTypeSchema, variableRefSchema } from "./types";

const triggerNode = {
  id: "n1",
  type: "trigger",
  position: { x: 0, y: 0 },
  data: { events: ["purchaseOrder.status.changed"] }
};

describe("workflowDefinitionSchema", () => {
  it("parses a minimal definition", () => {
    const parsed = workflowDefinitionSchema.parse({
      nodes: [triggerNode],
      edges: []
    });
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.formatVersion).toBe(CURRENT_DEFINITION_FORMAT_VERSION);
  });

  it("parses an empty canvas", () => {
    const parsed = workflowDefinitionSchema.parse({ nodes: [], edges: [] });
    expect(parsed.nodes).toEqual([]);
    expect(parsed.edges).toEqual([]);
  });

  it("rejects an unknown node type", () => {
    const result = workflowDefinitionSchema.safeParse({
      nodes: [{ ...triggerNode, type: "teleport" }],
      edges: []
    });
    expect(result.success).toBe(false);
  });

  it("rejects a node with an empty id", () => {
    const result = nodeSchema.safeParse({ ...triggerNode, id: "" });
    expect(result.success).toBe(false);
  });
});

describe("node defaults", () => {
  it("defaults a trigger's events and origin", () => {
    const parsed = nodeSchema.parse({
      id: "n1",
      type: "trigger",
      position: { x: 0, y: 0 },
      data: {}
    });
    expect(parsed.type).toBe("trigger");
    if (parsed.type !== "trigger") throw new Error("expected a trigger node");
    expect(parsed.data.events).toEqual([]);
    expect(parsed.data.origin).toBe("Both");
  });

  it("defaults an action's batch flag to false", () => {
    const parsed = nodeSchema.parse({
      id: "n2",
      type: "action",
      position: { x: 0, y: 0 },
      data: { action: "notify" }
    });
    if (parsed.type !== "action") throw new Error("expected an action node");
    expect(parsed.data.batch).toBe(false);
    expect(parsed.data.inputs).toEqual({});
  });

  it("parses a node without title and leaves title undefined", () => {
    const parsed = nodeSchema.parse({
      id: "n1",
      type: "trigger",
      position: { x: 0, y: 0 },
      data: {}
    });
    expect(parsed.title).toBeUndefined();
  });

  it("round-trips a node with a title", () => {
    const parsed = nodeSchema.parse({
      id: "n1",
      type: "trigger",
      position: { x: 0, y: 0 },
      title: "Open POs",
      data: {}
    });
    expect(parsed.title).toBe("Open POs");
  });

  it("accepts an empty string title", () => {
    const parsed = nodeSchema.parse({
      id: "n1",
      type: "trigger",
      position: { x: 0, y: 0 },
      title: "",
      data: {}
    });
    expect(parsed.title).toBe("");
  });

  it("defaults a variable reference's property path to empty", () => {
    const parsed = variableRefSchema.parse({
      kind: "ref",
      nodeId: "n1",
      output: "result"
    });
    expect(parsed.path).toEqual([]);
  });
});

describe("getNodeHandles", () => {
  it("gives an action success and failure handles", () => {
    const node = nodeSchema.parse({
      id: "n2",
      type: "action",
      position: { x: 0, y: 0 },
      data: { action: "notify" }
    });
    expect(getNodeHandles(node)).toEqual(["success", "failure"]);
  });

  it("gives a condition one handle per path", () => {
    const node = nodeSchema.parse({
      id: "n3",
      type: "condition",
      position: { x: 0, y: 0 },
      data: {
        paths: [
          { id: "p1", kind: "if" },
          { id: "p2", kind: "else" }
        ]
      }
    });
    expect(getNodeHandles(node)).toEqual(["p1", "p2"]);
  });

  it("gives a trigger a single default handle", () => {
    expect(getNodeHandles(nodeSchema.parse(triggerNode))).toEqual(["out"]);
  });
});

describe("valueTypeSchema", () => {
  it("accepts a list of entities", () => {
    const parsed = valueTypeSchema.parse({
      kind: "list",
      of: { kind: "entity", of: "part" }
    });
    expect(parsed.kind).toBe("list");
  });

  it("rejects a list of lists", () => {
    const result = valueTypeSchema.safeParse({
      kind: "list",
      of: { kind: "list", of: { kind: "entity", of: "part" } }
    });
    expect(result.success).toBe(false);
  });
});

describe("scheduleSchema", () => {
  it("accepts the last day of the month", () => {
    const parsed = scheduleSchema.parse({
      freq: "Monthly",
      hour: 9,
      minute: 0,
      day: "last",
      tz: "America/Chicago"
    });
    expect(parsed.day).toBe("last");
  });

  it("rejects an out-of-range hour", () => {
    const result = scheduleSchema.safeParse({
      freq: "Daily",
      hour: 24,
      minute: 0,
      tz: "America/Chicago"
    });
    expect(result.success).toBe(false);
  });

  it("rejects a weekday outside 0-6", () => {
    const result = scheduleSchema.safeParse({
      freq: "Weekly",
      hour: 9,
      minute: 0,
      weekdays: [7],
      tz: "America/Chicago"
    });
    expect(result.success).toBe(false);
  });
});

describe("edgeSchema", () => {
  it("requires a source handle", () => {
    const result = edgeSchema.safeParse({
      id: "e1",
      source: "n1",
      target: "n2",
      targetHandle: "in"
    });
    expect(result.success).toBe(false);
  });

  it("parses a complete edge", () => {
    const parsed = edgeSchema.parse({
      id: "e1",
      source: "n1",
      sourceHandle: "out",
      target: "n2",
      targetHandle: "in"
    });
    expect(parsed.source).toBe("n1");
  });
});
