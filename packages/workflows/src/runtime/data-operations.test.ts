import { describe, expect, it } from "vitest";
import type { FilterNode } from "../definition/schema";
import { t } from "../definition/types";
import { filterExecutor } from "./filter";
import { createRuntimeContext } from "./fixtures";
import type { RuntimeValue } from "./types";
import { fromColumn, listValue, primitiveValue } from "./values";

const EVENT = {
  kind: "record" as const,
  fields: {
    summary: t.string,
    attendees: t.list(t.string as never),
    organizer: { kind: "record" as const, fields: { email: t.string } }
  }
};

function event(summary: string, attendees: string[], email: string) {
  return fromColumn(EVENT, { summary, attendees, organizer: { email } });
}

const EVENTS = [
  event("Standup", ["a@x.co", "b@x.co"], "sam@x.co"),
  event("Review", ["c@x.co"], "kim@x.co")
];

const node = (data: Partial<FilterNode["data"]>): FilterNode => ({
  id: "d1",
  name: "d1",
  type: "filter",
  position: { x: 0, y: 0 },
  data: {
    source: { kind: "ref", nodeId: "step", output: "items", path: [] },
    combinator: "and",
    clauses: [],
    operation: "filter",
    flatten: false,
    ...data
  }
});

async function run(
  data: Partial<FilterNode["data"]>,
  items: RuntimeValue[] = EVENTS
) {
  const list = listValue(EVENT, items).value;
  const ctx = createRuntimeContext({ outputs: { step: { items: list } } });
  return filterExecutor.execute(node(data), ctx);
}

function output(result: Awaited<ReturnType<typeof run>>) {
  return result.status === "Succeeded" ? result.outputs?.result : undefined;
}

describe("data node operations", () => {
  it("counts the items", async () => {
    expect(output(await run({ operation: "count" }))).toEqual(
      primitiveValue("number", 2)
    );
  });

  it("counts an empty list as zero", async () => {
    expect(output(await run({ operation: "count" }, []))).toEqual(
      primitiveValue("number", 0)
    );
  });

  it("takes the first and the last item", async () => {
    const first = output(await run({ operation: "first" }));
    const last = output(await run({ operation: "last" }));
    expect(first?.kind === "record" && first.fields.summary).toEqual(
      primitiveValue("string", "Standup")
    );
    expect(last?.kind === "record" && last.fields.summary).toEqual(
      primitiveValue("string", "Review")
    );
  });

  // An empty list must not fail the step — the branch after it simply reads nothing.
  it("yields null rather than failing when taking from an empty list", async () => {
    for (const operation of ["first", "last"] as const) {
      const result = await run({ operation }, []);
      expect(result.status).toBe("Succeeded");
      expect(output(result)).toEqual({
        kind: "primitive",
        of: "null",
        value: null
      });
    }
  });

  describe("pluck", () => {
    it("projects a scalar field off every item", async () => {
      const result = output(
        await run({ operation: "pluck", field: "summary" })
      );
      expect(result?.kind === "list" && result.items).toEqual([
        primitiveValue("string", "Standup"),
        primitiveValue("string", "Review")
      ]);
    });

    it("projects through a dotted path into a nested object", async () => {
      const result = output(
        await run({ operation: "pluck", field: "organizer.email" })
      );
      expect(result?.kind === "list" && result.items).toEqual([
        primitiveValue("string", "sam@x.co"),
        primitiveValue("string", "kim@x.co")
      ]);
    });

    // The reason `flatten` is a flag rather than an operation: `list<list<T>>` has
    // no representation, so the flat list is built directly, never nested.
    it("flattens a list-valued field into one flat list", async () => {
      const result = output(
        await run({ operation: "pluck", field: "attendees", flatten: true })
      );
      expect(result?.kind === "list" && result.items).toEqual([
        primitiveValue("string", "a@x.co"),
        primitiveValue("string", "b@x.co"),
        primitiveValue("string", "c@x.co")
      ]);
    });

    it("yields null for an item missing the field, not a shorter list", async () => {
      const partial = [
        EVENTS[0] as RuntimeValue,
        fromColumn(EVENT, { summary: null })
      ];
      const result = output(
        await run({ operation: "pluck", field: "summary" }, partial)
      );
      // Two items in, two values out — position is what lines a pluck up with
      // its source.
      expect(result?.kind === "list" && result.items).toHaveLength(2);
      expect(result?.kind === "list" && result.items[1]).toEqual({
        kind: "primitive",
        of: "null",
        value: null
      });
    });

    it("yields an empty list for an empty source", async () => {
      const result = output(
        await run({ operation: "pluck", field: "summary" }, [])
      );
      expect(result?.kind === "list" && result.items).toEqual([]);
    });
  });

  describe("join", () => {
    it("joins primitives into text", async () => {
      const list = listValue(t.string as never, [
        primitiveValue("string", "a"),
        primitiveValue("string", "b")
      ]).value;
      const ctx = createRuntimeContext({ outputs: { step: { items: list } } });
      const result = await filterExecutor.execute(
        node({ operation: "join" }),
        ctx
      );
      expect(output(result)).toEqual(primitiveValue("string", "a, b"));
    });

    // A null in the middle would otherwise render as ", , " — an empty slot reads
    // as a missing value, not as a blank one.
    it("drops nulls rather than leaving gaps", async () => {
      const list = listValue(t.string as never, [
        primitiveValue("string", "a"),
        { kind: "primitive", of: "null", value: null },
        primitiveValue("string", "b")
      ]).value;
      const ctx = createRuntimeContext({ outputs: { step: { items: list } } });
      const result = await filterExecutor.execute(
        node({ operation: "join" }),
        ctx
      );
      expect(output(result)).toEqual(primitiveValue("string", "a, b"));
    });

    it("joins an empty list to an empty string", async () => {
      // An empty list of TEXT, not of objects: a list of objects is refused
      // whether or not it has items, because an object has no reading as text.
      const list = listValue(t.string as never, []).value;
      const ctx = createRuntimeContext({ outputs: { step: { items: list } } });
      const result = await filterExecutor.execute(
        node({ operation: "join" }),
        ctx
      );
      expect(output(result)).toEqual(primitiveValue("string", ""));
    });

    it("refuses a list of objects, which have no reading as text", async () => {
      const result = await run({ operation: "join" });
      expect(result.status).toBe("Skipped");
    });
  });

  // Same absence as the definition side: a node saved before this field existed
  // reaches the engine with no `operation`, and must filter exactly as it always did.
  it("filters when the stored node has no operation at all", async () => {
    const legacy = node({});
    delete (legacy.data as { operation?: unknown }).operation;
    const list = listValue(EVENT, EVENTS).value;
    const ctx = createRuntimeContext({ outputs: { step: { items: list } } });
    const result = await filterExecutor.execute(legacy, ctx);
    expect(result.status).toBe("Succeeded");
    const value =
      result.status === "Succeeded" ? result.outputs?.result : undefined;
    // No clauses means everything is kept — today's behaviour, unchanged.
    expect(value?.kind === "list" && value.items).toHaveLength(2);
  });

  it("needs no permission — it only reshapes values already in the run", () => {
    expect(
      filterExecutor.permission(node({ operation: "count" }), {} as never)
    ).toBeUndefined();
  });
});
