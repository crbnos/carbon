import { describe, expect, it } from "vitest";
import { batchCandidates, batchPlan } from "./batch";
import type { CatalogAction } from "./catalog";
import { t, type ValueOrRef, type ValueType } from "./types";

const action = (overrides: Partial<CatalogAction> = {}): CatalogAction => ({
  id: "assignPart",
  inputs: {
    part: { type: t.entity("part"), required: true },
    tags: {
      type: t.list({ kind: "primitive", of: "string" }),
      required: false
    },
    note: { type: t.string, required: false }
  },
  outputs: {},
  batchable: true,
  permission: { module: "parts", action: "update" },
  ...overrides
});

const ref = (nodeId: string, output: string): ValueOrRef => ({
  kind: "ref",
  nodeId,
  output,
  path: []
});

const item: ValueOrRef = { kind: "item", path: [] };

/** Every named input is a list unless the test says otherwise. */
const asList =
  (scalars: Record<string, ValueType> = {}) =>
  (name: string): ValueType =>
    scalars[name] ?? t.list({ kind: "entity", of: "part" });

describe("batchCandidates", () => {
  it("offers only supplied inputs that take a single value", () => {
    expect(
      batchCandidates(action(), {
        part: ref("find", "result"),
        tags: ref("find", "tags"),
        note: ref("find", "note")
      })
    ).toEqual(["part", "note"]);
  });

  it("skips an input already reading the loop item, which the loop would define", () => {
    expect(
      batchCandidates(action(), { part: ref("find", "result"), note: item })
    ).toEqual(["part"]);
  });

  it("offers nothing for an action that cannot repeat", () => {
    expect(
      batchCandidates(action({ batchable: false }), {
        part: ref("find", "result")
      })
    ).toEqual([]);
  });
});

describe("batchPlan", () => {
  it("runs once when nothing wired in is a list", () => {
    expect(
      batchPlan(action(), { part: ref("find", "result") }, () =>
        t.entity("part")
      )
    ).toEqual({ kind: "none" });
  });

  it("repeats over the one list, naming the input it came from", () => {
    expect(
      batchPlan(
        action(),
        { part: ref("find", "result"), note: ref("find", "note") },
        asList({ note: t.string })
      )
    ).toEqual({
      kind: "repeats",
      input: "part",
      type: t.list({ kind: "entity", of: "part" })
    });
  });

  it("refuses to guess when two lists are wired in", () => {
    expect(
      batchPlan(
        action(),
        { part: ref("a", "result"), note: ref("b", "result") },
        asList()
      )
    ).toEqual({ kind: "ambiguous", first: "part", second: "note" });
  });

  it("ignores a list fed to an input that asked for one", () => {
    expect(
      batchPlan(action(), { tags: ref("find", "tags") }, asList())
    ).toEqual({ kind: "none" });
  });
});
