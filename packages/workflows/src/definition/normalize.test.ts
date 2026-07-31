import { describe, expect, it } from "vitest";
import { emptyDefinition, readWorkflowVersion } from "./normalize";

const triggerNode = {
  id: "n1",
  type: "trigger",
  position: { x: 0, y: 0 },
  data: { events: ["purchaseOrder.status.changed"], origin: "Both" }
};

/** The definition, or a failure message, so assertions read either way. */
const read = (row: unknown) => {
  const result = readWorkflowVersion(row);
  return result.ok ? result.definition : result;
};

describe("readWorkflowVersion", () => {
  it("reads a null row as an empty canvas", () => {
    expect(read(null)).toEqual(emptyDefinition());
  });

  it("reads an undefined row as an empty canvas", () => {
    expect(read(undefined)).toEqual(emptyDefinition());
  });

  it("reads a row with no columns set as an empty canvas", () => {
    expect(read({})).toEqual(emptyDefinition());
  });

  it("reads the database defaults as an empty canvas", () => {
    expect(read({ formatVersion: 1, nodes: [], edges: [] })).toEqual(
      emptyDefinition()
    );
  });

  it("assembles the two columns into one definition", () => {
    const result = readWorkflowVersion({
      formatVersion: 1,
      nodes: [triggerNode],
      edges: []
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.nodes).toHaveLength(1);
    expect(result.definition.nodes[0]?.id).toBe("n1");
    expect(result.definition.formatVersion).toBe(2);
  });

  it("keeps nodes and edges apart", () => {
    const result = readWorkflowVersion({
      formatVersion: 1,
      nodes: [
        triggerNode,
        {
          id: "n2",
          type: "action",
          position: { x: 1, y: 1 },
          data: { action: "notify" }
        }
      ],
      edges: [
        {
          id: "e1",
          source: "n1",
          sourceHandle: "out",
          target: "n2",
          targetHandle: "in"
        }
      ]
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.nodes).toHaveLength(2);
    expect(result.definition.edges).toHaveLength(1);
    expect(result.definition.edges[0]?.id).toBe("e1");
  });

  it("ignores unrelated row columns", () => {
    const result = readWorkflowVersion({
      id: "wfv_123",
      companyId: "c1",
      versionNumber: 3,
      formatVersion: 1,
      nodes: [triggerNode],
      edges: []
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.nodes).toHaveLength(1);
  });

  it("treats a missing formatVersion as v1, so its migration is not skipped", () => {
    const result = readWorkflowVersion({
      nodes: [
        triggerNode,
        {
          id: "n2",
          type: "lookup",
          position: { x: 1, y: 1 },
          data: {
            entity: "purchaseOrder",
            returns: "one",
            match: [
              {
                left: {
                  kind: "literal",
                  type: { kind: "primitive", of: "string" },
                  value: "a"
                },
                operator: "eq",
                right: {
                  kind: "literal",
                  type: { kind: "primitive", of: "string" },
                  value: "b"
                }
              }
            ]
          }
        }
      ]
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.formatVersion).toBe(2);
  });

  it("opens a v1 lookup as v2 with its old two-sided rules dropped", () => {
    const result = readWorkflowVersion({
      formatVersion: 1,
      nodes: [
        triggerNode,
        {
          id: "n2",
          type: "lookup",
          position: { x: 1, y: 1 },
          data: {
            entity: "purchaseOrder",
            returns: "list",
            match: [
              {
                left: {
                  kind: "ref",
                  nodeId: "n1",
                  output: "record",
                  path: ["status"]
                },
                operator: "eq",
                right: {
                  kind: "literal",
                  type: { kind: "primitive", of: "string" },
                  value: "Draft"
                }
              }
            ]
          }
        }
      ],
      edges: []
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lookup = result.definition.nodes[1];
    expect(lookup?.type).toBe("lookup");
    if (lookup?.type !== "lookup") return;
    expect(lookup.data.match).toEqual([]);
    expect(lookup.data.returns).toBe("list");
  });

  it("round-trips a definition already at the current version", () => {
    const row = { formatVersion: 2, nodes: [triggerNode], edges: [] };
    const once = readWorkflowVersion(row);
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    expect(readWorkflowVersion(once.definition)).toEqual(once);
  });

  describe("reports failure instead of silently returning a blank canvas", () => {
    it("rejects a garbage nodes column", () => {
      const result = readWorkflowVersion({ nodes: "oops", edges: [] });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure).toBe("invalid");
    });

    it("rejects an unknown node type", () => {
      const result = readWorkflowVersion({
        formatVersion: 1,
        nodes: [{ ...triggerNode, type: "teleport" }],
        edges: []
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure).toBe("invalid");
    });

    it("rejects a document written by a newer release rather than emptying it", () => {
      const result = readWorkflowVersion({
        formatVersion: 3,
        nodes: [{ id: "n1", type: "brandNewKind", position: { x: 0, y: 0 } }],
        edges: []
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure).toBe("future-format");
    });
  });

  it("hands out a fresh empty canvas each time, so no caller can poison it", () => {
    const first = emptyDefinition();
    first.nodes.push(triggerNode as never);
    expect(emptyDefinition().nodes).toHaveLength(0);
  });
});
