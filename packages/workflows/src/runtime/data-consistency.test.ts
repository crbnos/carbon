import { describe, expect, it } from "vitest";
import { createFixtureCatalog } from "../definition/catalog";
import { getNodeOutputs } from "../definition/nodes";
import type { FilterNode, WorkflowDefinition } from "../definition/schema";
import { t, type ValueType } from "../definition/types";
import { createContext } from "../definition/variables";
import { filterExecutor } from "./filter";
import { createRuntimeContext } from "./fixtures";
import type { RuntimeValue } from "./types";
import { entityValue, fromColumn, listValue, primitiveValue } from "./values";

/**
 * The data node declares a type at build time and produces a value at run time.
 * Those two answers must agree for EVERY source and operation — a step that
 * declares no output but still runs puts an untyped value into the graph, and one
 * that declares an output but skips leaves a downstream step reading nothing.
 *
 * This matrix exists because four such disagreements shipped past hand-written
 * per-case tests: `join` refused entities it could render, `pluck` accepted lists
 * of plain values and returned nulls, and both ran in the runtime regardless of
 * what the validator had said.
 */

const EVENT: ValueType = { kind: "record", fields: { summary: t.string } };

const SOURCES: {
  label: string;
  type: ValueType;
  value: () => RuntimeValue;
  /** A field that exists on this list's items, where one can. */
  field?: string;
}[] = [
  {
    label: "list<string>",
    type: t.list(t.string as never),
    value: () =>
      listValue(t.string as never, [primitiveValue("string", "a")]).value
  },
  {
    label: "list<number>",
    type: t.list(t.number as never),
    value: () =>
      listValue(t.number as never, [primitiveValue("number", 1)]).value
  },
  {
    label: "list<date>",
    type: t.list(t.date as never),
    value: () =>
      listValue(t.date as never, [
        primitiveValue("date", "2026-01-01T00:00:00.000Z")
      ]).value
  },
  {
    label: "list<entity>",
    type: t.list({ kind: "entity", of: "part" }),
    value: () =>
      listValue({ kind: "entity", of: "part" }, [
        entityValue("part", "p1", { name: "Bolt" })
      ]).value,
    field: "name"
  },
  {
    label: "list<record>",
    type: t.list(EVENT as never),
    value: () =>
      listValue(EVENT as never, [fromColumn(EVENT, { summary: "A" })]).value,
    field: "summary"
  }
];

const OPERATIONS = [
  "filter",
  "count",
  "first",
  "last",
  "join",
  "pluck"
] as const;

function node(operation: string, field?: string): FilterNode {
  return {
    id: "d1",
    name: "d1",
    type: "filter",
    position: { x: 0, y: 0 },
    data: {
      source: { kind: "ref", nodeId: "s1", output: "result", path: [] },
      combinator: "and",
      clauses: [],
      operation: operation as never,
      flatten: false,
      ...(field === undefined ? {} : { field })
    }
  };
}

function declaredOutput(source: ValueType, target: FilterNode) {
  const { context } = createContext(
    { formatVersion: 4, nodes: [], edges: [] } as unknown as WorkflowDefinition,
    createFixtureCatalog()
  );
  const ctx = {
    ...context,
    typeOf: () => source,
    resolveValue: () => ({ type: source })
  };
  return getNodeOutputs(target, ctx as never)?.result;
}

describe("the data node's declared type and its runtime agree", () => {
  for (const source of SOURCES) {
    for (const operation of OPERATIONS) {
      it(`${source.label} + ${operation}`, async () => {
        // `pluck` needs a field; where the source has none, an invented one is the
        // honest test — it is what an author switching operations would leave behind.
        const target = node(
          operation,
          operation === "pluck" ? (source.field ?? "nope") : undefined
        );
        const declared = declaredOutput(source.type, target);

        const ctx = createRuntimeContext({
          outputs: { s1: { result: source.value() } }
        });
        const result = await filterExecutor.execute(target, ctx);

        expect(
          result.status === "Succeeded",
          declared === undefined
            ? `declares no output but ran, producing an untyped value`
            : `declares ${JSON.stringify(declared)} but did not run`
        ).toBe(declared !== undefined);
      });
    }
  }

  // The specific regressions behind this file, kept as named cases so a failure
  // says what broke rather than just "row 14 of the matrix".
  it("joins a list of records by their display name, not into blanks", async () => {
    const list = listValue({ kind: "entity", of: "part" }, [
      entityValue("part", "p1", { name: "Bolt" }),
      entityValue("part", "p2", { name: "Nut" })
    ]).value;
    const ctx = createRuntimeContext({ outputs: { s1: { result: list } } });
    const result = await filterExecutor.execute(node("join"), ctx);
    expect(result.status === "Succeeded" && result.outputs?.result).toEqual(
      primitiveValue("string", "Bolt, Nut")
    );
  });

  it("types a plucked list from the first real value, not a leading null", async () => {
    const shape = { kind: "record" as const, fields: { v: t.string } };
    const list = listValue(shape, [
      fromColumn(shape, { v: null }),
      fromColumn(shape, { v: "a" })
    ]).value;
    const ctx = createRuntimeContext({ outputs: { s1: { result: list } } });
    const result = await filterExecutor.execute(node("pluck", "v"), ctx);
    // A null-typed list holding a string would disagree with its own contents.
    expect(result.status === "Succeeded" && result.outputs?.result).toEqual(
      listValue(t.string as never, [
        { kind: "primitive", of: "null", value: null },
        primitiveValue("string", "a")
      ]).value
    );
  });

  it("refuses to pluck from a list of plain values rather than returning nulls", async () => {
    const list = listValue(t.string as never, [
      primitiveValue("string", "a")
    ]).value;
    const ctx = createRuntimeContext({ outputs: { s1: { result: list } } });
    const result = await filterExecutor.execute(node("pluck", "x"), ctx);
    expect(result.status).toBe("Skipped");
  });

  it("plucks a field off a list of Carbon records, not a list of nulls", async () => {
    // The validator, `walkPath` and the builder all offer this; only the runtime
    // read it as "not a record" and returned nothing for every item.
    const list = listValue({ kind: "entity", of: "purchaseOrder" }, [
      entityValue("purchaseOrder", "po1", { status: "Draft" }),
      entityValue("purchaseOrder", "po2", { status: "Sent" })
    ]).value;
    const ctx = createRuntimeContext({ outputs: { s1: { result: list } } });
    const result = await filterExecutor.execute(node("pluck", "status"), ctx);
    expect(result.status === "Succeeded" && result.outputs?.result).toEqual(
      listValue(t.string as never, [
        primitiveValue("string", "Draft"),
        primitiveValue("string", "Sent")
      ]).value
    );
  });

  it("types a plucked list from the declared field, even when every value is null", async () => {
    const shape = { kind: "record" as const, fields: { v: t.string } };
    const list = listValue(shape, [fromColumn(shape, { v: null })]).value;
    const ctx = createRuntimeContext({ outputs: { s1: { result: list } } });
    const result = await filterExecutor.execute(node("pluck", "v"), ctx);
    // Sampling the data typed this `null` and disagreed with the builder's promise.
    expect(
      result.status === "Succeeded" &&
        result.outputs?.result?.kind === "list" &&
        result.outputs.result.of
    ).toEqual(t.string);
  });

  it("skips an unflattened pluck of a list-valued field rather than nesting lists", async () => {
    const shape = {
      kind: "record" as const,
      fields: { tags: t.list(t.string as never) }
    };
    const list = listValue(shape, [
      fromColumn(shape, { tags: ["a", "b"] })
    ]).value;
    const ctx = createRuntimeContext({ outputs: { s1: { result: list } } });
    const result = await filterExecutor.execute(node("pluck", "tags"), ctx);
    // `list<list<T>>` has no representation; the validator refuses it and so must
    // the runtime, because a draft is never validated.
    expect(result.status).toBe("Skipped");
  });
});

describe("operation chains at run time", () => {
  const chainNode = (
    operations: FilterNode["data"]["operations"]
  ): FilterNode => ({
    id: "d1",
    name: "d1",
    type: "filter",
    position: { x: 0, y: 0 },
    data: {
      source: { kind: "ref", nodeId: "s1", output: "result", path: [] },
      combinator: "and",
      clauses: [],
      operation: "filter",
      flatten: false,
      operations
    }
  });

  const shape = { kind: "record" as const, fields: { v: t.string } };
  const rows = (values: string[]) =>
    listValue(
      shape,
      values.map((v) => fromColumn(shape, { v }))
    ).value;

  it("folds filter → pluck → count, with one detail row per card", async () => {
    const target = chainNode([
      {
        id: "c1",
        operation: "filter",
        combinator: "and",
        clauses: [
          {
            left: { kind: "item", path: ["v"], card: "c1" },
            operator: "eq",
            right: {
              kind: "literal",
              type: t.string,
              value: "yes"
            }
          }
        ],
        flatten: false
      },
      {
        id: "c2",
        operation: "pluck",
        combinator: "and",
        clauses: [],
        field: "v",
        flatten: false
      },
      {
        id: "c3",
        operation: "count",
        combinator: "and",
        clauses: [],
        flatten: false
      }
    ]);
    const list = rows(["yes", "no", "yes", "no", "yes"]);
    const ctx = createRuntimeContext({ outputs: { s1: { result: list } } });
    const result = await filterExecutor.execute(target, ctx);

    if (result.status !== "Succeeded") throw new Error("Expected Succeeded");
    expect(result.outputs?.result).toEqual(primitiveValue("number", 3));
    // The node reads as its LAST card...
    expect(result.summary).toBe("Counted 3.");
    // ...and the detail tells the whole story, in run order.
    if (result.detail?.kind !== "data") throw new Error("Expected data detail");
    expect(result.detail.cards).toEqual([
      {
        id: "c1",
        operation: "filter",
        summary: "Kept 3 of 5.",
        status: "Succeeded"
      },
      {
        id: "c2",
        operation: "pluck",
        summary: "Took 3 values.",
        status: "Succeeded"
      },
      {
        id: "c3",
        operation: "count",
        summary: "Counted 3.",
        status: "Succeeded"
      }
    ]);
  });

  it("skips the node at the card that cannot run, naming its position", async () => {
    const target = chainNode([
      {
        id: "c1",
        operation: "filter",
        combinator: "and",
        clauses: [],
        flatten: false
      },
      // A draft: pluck with no field chosen. The validator would refuse it,
      // but a draft is never validated.
      {
        id: "c2",
        operation: "pluck",
        combinator: "and",
        clauses: [],
        flatten: false
      }
    ]);
    const ctx = createRuntimeContext({
      outputs: { s1: { result: rows(["yes"]) } }
    });
    const result = await filterExecutor.execute(target, ctx);

    if (result.status !== "Skipped") throw new Error("Expected Skipped");
    expect(result.reason).toContain("Step 2");
    expect(result.reason).toContain("No field was chosen to take.");
    if (result.detail?.kind !== "data") throw new Error("Expected data detail");
    expect(result.detail.cards).toHaveLength(2);
    expect(result.detail.cards[1]?.status).toBe("Skipped");
  });

  it("keeps a single card's summary and skip wording exactly as before", async () => {
    const ctx = createRuntimeContext({
      outputs: { s1: { result: rows(["a", "b"]) } }
    });
    const counted = await filterExecutor.execute(node("count"), ctx);
    expect(counted.status === "Succeeded" && counted.summary).toBe(
      "Counted 2."
    );

    // No "Step 1" prefix when the card IS the node.
    const plucked = await filterExecutor.execute(node("pluck"), ctx);
    expect(plucked.status === "Skipped" && plucked.reason).toBe(
      "No field was chosen to take."
    );
  });
});
