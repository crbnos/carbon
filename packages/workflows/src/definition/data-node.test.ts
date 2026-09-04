import { describe, expect, it } from "vitest";
import { createFixtureCatalog } from "./catalog";
import {
  cardsOf,
  foldOperationTypes,
  operationsFor,
  truncateStarvedCards
} from "./data-operations";
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
    expect(issues[0]?.field).toBe("operations.card-0.field");
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
    expect(issues[0]?.field).toBe("operations.card-0.operation");
  });

  it("requires a field for pluck and nothing else", () => {
    const { node, ctx } = build({ operation: "pluck" });
    expect(checkNodeConfig(node, ctx as never)[0]?.field).toBe(
      "operations.card-0.field"
    );

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

describe("operation chains", () => {
  const cards = (
    ops: Array<
      Partial<
        FilterNode["data"]["operations"] extends (infer C)[] | undefined
          ? C
          : never
      > & { id: string }
    >
  ) =>
    ops.map((op) => ({
      operation: "filter" as const,
      combinator: "and" as const,
      clauses: [],
      flatten: false,
      ...op
    }));

  it("synthesizes one card from the flat fields", () => {
    const { node } = build({ operation: "pluck", field: "summary" });
    expect(cardsOf(node)).toEqual([
      {
        id: "card-0",
        operation: "pluck",
        combinator: "and",
        clauses: [],
        field: "summary",
        flatten: false
      }
    ]);
  });

  it("types every seam of a filter → pluck → count chain", () => {
    const chain = cards([
      { id: "c1" },
      { id: "c2", operation: "pluck", field: "organizer.email" },
      { id: "c3", operation: "count" }
    ]);
    const types = foldOperationTypes(
      t.list(EVENT as never),
      chain,
      createFixtureCatalog()
    );
    expect(types).toEqual([
      t.list(EVENT as never),
      t.list(EVENT as never),
      t.list(t.string as never),
      { kind: "primitive", of: "number" }
    ]);
    // ...and the node's output is the LAST seam.
    const { node, ctx } = build({ operations: chain });
    expect(getNodeOutputs(node, ctx)?.result).toEqual({
      kind: "primitive",
      of: "number"
    });
  });

  it("suppresses everything after an unconfigured card", () => {
    const chain = cards([
      { id: "c1", operation: "pluck" }, // no field chosen yet
      { id: "c2", operation: "count" }
    ]);
    const types = foldOperationTypes(
      t.list(EVENT as never),
      chain,
      createFixtureCatalog()
    );
    expect(types[1]).toBeUndefined();
    expect(types[2]).toBeUndefined();
    const { node, ctx } = build({ operations: chain });
    expect(getNodeOutputs(node, ctx)).toBeUndefined();
  });

  it("offers only the operations the incoming type supports", () => {
    // Records have fields to pluck — but no reading as text, so no join.
    expect(operationsFor(t.list(EVENT as never))).toEqual([
      "filter",
      "count",
      "first",
      "last",
      "pluck"
    ]);
    // A Carbon record reads as its display name, so entities CAN be joined.
    expect(operationsFor(t.list(t.entity("job") as never))).toContain("join");
    // Plain strings have no fields to pluck.
    expect(operationsFor(t.list(t.string as never))).not.toContain("pluck");
    // A bare number or string is not a list: nothing can follow.
    expect(operationsFor({ kind: "primitive", of: "number" })).toEqual([]);
    expect(operationsFor({ kind: "primitive", of: "string" })).toEqual([]);
    // Still configuring: offer everything.
    expect(operationsFor(undefined)).toHaveLength(6);
  });

  it("types the loop item by the card it lives in, not the node source", () => {
    const chain = cards([
      { id: "c1", operation: "pluck", field: "organizer.email" },
      { id: "c2" } // a filter over the plucked strings
    ]);
    const { node, ctx } = build({ operations: chain });
    // Card 2's item is a plucked string...
    expect(getNodeLoopList(node, ctx, "c2")).toEqual({
      type: t.list(t.string as never)
    });
    // ...card 1 does not loop at all (pluck walks nothing item by item)...
    expect(getNodeLoopList(node, ctx, "c1")).toBeUndefined();
    // ...and no card id means the FIRST card, exactly as an old ref does.
    expect(getNodeLoopList(node, ctx)).toBeUndefined();
  });

  it("flags the card an incompatible stored operation sits on", () => {
    // The dropdown could not build this — count feeds pluck a bare number —
    // but a stored definition is not trusted.
    const chain = cards([
      { id: "c1", operation: "count" },
      { id: "c2", operation: "pluck", field: "summary" }
    ]);
    const { node, ctx } = build({ operations: chain });
    const issues = checkNodeTypes(node, ctx as never);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.field).toBe("operations.c2.operation");
    expect(issues[0]?.message).toContain("Nothing can follow");
  });

  it("keeps a rippled-broken card and flags it red (delete ripple)", () => {
    // As if a pluck card between these two was deleted: the join now receives
    // the raw records, which have no reading as text.
    const chain = cards([{ id: "c1" }, { id: "c3", operation: "join" }]);
    const { node, ctx } = build({ operations: chain });
    const issues = checkNodeTypes(node, ctx as never);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.field).toBe("operations.c3.operation");
    expect(issues[0]?.message).toContain("cannot be joined");
  });

  it("drops the tail after a terminal card, types known or not", () => {
    // As the form does when a middle card switches to `count`: the cards below
    // would receive a bare value no operation consumes — a STRUCTURAL fact, so
    // it holds even while the source or a pluck field is still unconfigured.
    const chain = cards([
      { id: "c1", operation: "pluck" }, // no field yet — types unknown
      { id: "c2", operation: "count" },
      { id: "c3" },
      { id: "c4", operation: "join" }
    ]);
    expect(truncateStarvedCards(chain)).toEqual(chain.slice(0, 2));
    // A list-preserving chain is never cut.
    const open = cards([{ id: "c1" }, { id: "c2", operation: "pluck" }]);
    expect(truncateStarvedCards(open)).toEqual(open);
  });

  it("flags any card that follows a terminal one, even with no types", () => {
    // The user's own repro: no source picked, count mid-chain, dead cards below.
    const { node, ctx } = build(
      {
        operations: cards([{ id: "c1", operation: "count" }, { id: "c2" }])
      },
      t.list(EVENT as never)
    );
    const issues = checkNodeTypes(node, ctx as never);
    expect(issues[0]?.field).toBe("operations.c2.operation");
    expect(issues[0]?.message).toContain("Nothing can follow");
  });

  it("resolves an old ref with no card against the first card", () => {
    const { node, ctx } = build({ operations: cards([{ id: "c1" }]) });
    expect(getNodeLoopList(node, ctx)).toEqual({
      type: t.list(EVENT as never)
    });
  });
});
