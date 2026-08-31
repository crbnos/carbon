import { describe, expect, it } from "vitest";
import { createFixtureCatalog } from "./catalog";
import {
  checkNodeConfig,
  checkNodeTypes,
  getNodeLoopList,
  getNodeOutputs
} from "./nodes";
import type { FilterNode, WorkflowDefinition } from "./schema";
import { t, type ValueType } from "./types";
import { createContext } from "./variables";

const EVENT: ValueType = {
  kind: "record",
  fields: {
    summary: t.string,
    attendees: t.list(t.string as never),
    organizer: { kind: "record", fields: { email: t.string } }
  }
};

/** A trigger whose output is the list under test, then the data node reading it. */
function build(
  data: Partial<FilterNode["data"]>,
  sourceType: ValueType = t.list(EVENT as never)
) {
  const node: FilterNode = {
    id: "d1",
    name: "d1",
    type: "filter",
    position: { x: 0, y: 0 },
    data: {
      source: { kind: "ref", nodeId: "t1", output: "items", path: [] },
      combinator: "and",
      clauses: [],
      operation: "filter",
      flatten: false,
      ...data
    }
  };

  const definition = {
    formatVersion: 4,
    nodes: [
      {
        id: "t1",
        name: "t1",
        type: "compute" as const,
        position: { x: 0, y: 0 },
        data: { operation: "job.totalScrap", inputs: {} }
      },
      node
    ],
    edges: [
      {
        id: "e1",
        source: "t1",
        sourceHandle: "out",
        target: "d1",
        targetHandle: "in"
      }
    ]
  } as unknown as WorkflowDefinition;

  // The compute fixture returns a number, so stub the context's type resolution to
  // hand the data node whatever source type this case is about.
  const { context } = createContext(definition, createFixtureCatalog());
  const ctx = {
    ...context,
    typeOf: () => sourceType,
    resolveValue: () => ({ type: sourceType })
  };
  return { node, ctx };
}

function resultOf(
  data: Partial<FilterNode["data"]>,
  sourceType?: ValueType
): ValueType | undefined {
  const { node, ctx } = build(data, sourceType);
  return getNodeOutputs(node, ctx as never)?.result;
}

describe("data node outputs", () => {
  it("filter keeps the source list type", () => {
    expect(resultOf({ operation: "filter" })).toEqual(t.list(EVENT as never));
  });

  it("count is a number", () => {
    expect(resultOf({ operation: "count" })).toEqual(t.number);
  });

  it("first and last are the element type", () => {
    expect(resultOf({ operation: "first" })).toEqual(EVENT);
    expect(resultOf({ operation: "last" })).toEqual(EVENT);
  });

  it("pluck of a scalar field is a list of that field's type", () => {
    expect(resultOf({ operation: "pluck", field: "summary" })).toEqual(
      t.list(t.string as never)
    );
  });

  it("pluck through a dotted path reads the nested field's type", () => {
    expect(resultOf({ operation: "pluck", field: "organizer.email" })).toEqual(
      t.list(t.string as never)
    );
  });

  // `list<list<T>>` is unrepresentable, so without flattening there is no type to
  // return — which reads as "not configured" rather than a lie.
  it("pluck of a list field needs flatten, and yields one flat list", () => {
    expect(
      resultOf({ operation: "pluck", field: "attendees", flatten: false })
    ).toBeUndefined();
    expect(
      resultOf({ operation: "pluck", field: "attendees", flatten: true })
    ).toEqual(t.list(t.string as never));
  });

  it("pluck of a field the items do not have has no type", () => {
    expect(resultOf({ operation: "pluck", field: "nope" })).toBeUndefined();
  });

  it("join is text, but only over a list of simple values", () => {
    expect(resultOf({ operation: "join" }, t.list(t.string as never))).toEqual(
      t.string
    );
    expect(resultOf({ operation: "join" })).toBeUndefined();
  });

  it("has no output when the source is not a list", () => {
    expect(resultOf({ operation: "count" }, t.string)).toBeUndefined();
  });
});

// The builder holds RAW node objects that never went through zod, so its default
// does not apply there. A node dropped on the canvas — or saved before this field
// existed — has no `operation` key at all, and reading it unguarded produced no
// outputs, so the output handle showed nothing.
describe("a node with no stored operation", () => {
  const bare = (extra: Record<string, unknown> = {}) => {
    const { node, ctx } = build({});
    const stripped = {
      ...node,
      data: { ...node.data, ...extra }
    } as typeof node;
    delete (stripped.data as { operation?: unknown }).operation;
    return { node: stripped, ctx };
  };

  it("still reports its output", () => {
    const { node, ctx } = bare();
    expect(getNodeOutputs(node, ctx as never)?.result).toEqual(
      t.list(EVENT as never)
    );
  });

  it("still exposes the loop item, as filtering always did", () => {
    const { node, ctx } = bare();
    expect(getNodeLoopList(node, ctx as never)).toEqual({
      type: t.list(EVENT as never)
    });
  });

  it("still validates its clauses", () => {
    const { node, ctx } = bare({
      clauses: [
        {
          left: { kind: "item" as const, path: ["summary"] },
          operator: "eq" as const,
          right: undefined
        }
      ]
    });
    expect(checkNodeConfig(node, ctx as never).length).toBeGreaterThan(0);
  });
});

describe("data node loop item", () => {
  // Only filtering walks item by item, which is what keeps `ItemRef` meaning one
  // thing — a `count` node exposing "the current item" would be nonsense.
  it("is exposed by filter and by nothing else", () => {
    const { node, ctx } = build({ operation: "filter" });
    expect(getNodeLoopList(node, ctx as never)).toEqual({
      type: t.list(EVENT as never)
    });

    for (const operation of [
      "count",
      "first",
      "last",
      "pluck",
      "join"
    ] as const) {
      const other = build({ operation, field: "summary" });
      expect(
        getNodeLoopList(other.node, other.ctx as never),
        operation
      ).toBeUndefined();
    }
  });
});

describe("data node validation", () => {
  it("reports a source that is not a list", () => {
    const { node, ctx } = build({ operation: "count" }, t.string);
    const issues = checkNodeTypes(node, ctx as never);
    expect(issues[0]?.code).toBe("TYPE_MISMATCH");
    expect(issues[0]?.field).toBe("source");
  });

  it("reports a pluck field the items do not have", () => {
    const { node, ctx } = build({ operation: "pluck", field: "nope" });
    const issues = checkNodeTypes(node, ctx as never);
    expect(issues[0]?.field).toBe("field");
    expect(issues[0]?.message).toContain("nope");
  });

  it("explains that a list-valued field must be flattened", () => {
    const { node, ctx } = build({ operation: "pluck", field: "attendees" });
    const issues = checkNodeTypes(node, ctx as never);
    expect(issues[0]?.message).toContain("one combined list");
  });

  it("refuses to join a list of objects", () => {
    const { node, ctx } = build({ operation: "join" });
    const issues = checkNodeTypes(node, ctx as never);
    expect(issues[0]?.field).toBe("source");
  });

  it("requires a field for pluck and nothing else", () => {
    const { node, ctx } = build({ operation: "pluck" });
    expect(checkNodeConfig(node, ctx as never)[0]?.field).toBe("field");

    const counted = build({ operation: "count" });
    expect(checkNodeConfig(counted.node, counted.ctx as never)).toEqual([]);
  });

  // Clauses belong to filtering alone: a stale clause left on a node switched to
  // `count` must not be validated, or the node becomes unpublishable for no reason.
  it("checks clauses only while filtering", () => {
    const stale = [
      {
        left: { kind: "item" as const, path: ["nope"] },
        operator: "eq" as const,
        right: undefined
      }
    ];
    const counting = build({ operation: "count", clauses: stale });
    expect(checkNodeConfig(counting.node, counting.ctx as never)).toEqual([]);

    const filtering = build({ operation: "filter", clauses: stale });
    expect(
      checkNodeConfig(filtering.node, filtering.ctx as never).length
    ).toBeGreaterThan(0);
  });
});
