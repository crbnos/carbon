import { OPERATOR_LABELS } from "@carbon/utils";
import { describe, expect, it } from "vitest";
import {
  canAssign,
  expectedClauseRightType,
  rendersAsText,
  t,
  valueOrRefSchema,
  WORKFLOW_OPERATORS
} from "./types";

const stringList = t.list({ kind: "primitive", of: "string" });

describe("canAssign", () => {
  it("accepts identical types", () => {
    expect(canAssign(t.string, t.string)).toBe(true);
    expect(canAssign(t.entity("job"), t.entity("job"))).toBe(true);
    expect(canAssign(stringList, stringList)).toBe(true);
  });

  it("rejects mismatched types", () => {
    expect(canAssign(t.string, t.number)).toBe(false);
    expect(canAssign(t.entity("job"), t.entity("item"))).toBe(false);
  });

  it("only lets a list fill a single input when batching", () => {
    expect(canAssign(stringList, t.string)).toBe(false);
    expect(canAssign(stringList, t.string, { batching: true })).toBe(true);
  });

  it("does not let batching bridge a list of the wrong element type", () => {
    expect(canAssign(stringList, t.number, { batching: true })).toBe(false);
  });

  it("does not let batching turn a single value into a list", () => {
    expect(canAssign(t.string, stringList, { batching: true })).toBe(false);
  });
});

describe("expectedClauseRightType", () => {
  it("unwraps a list for contains", () => {
    expect(expectedClauseRightType(stringList, "contains")).toEqual(t.string);
  });

  it("leaves a non-list alone for contains", () => {
    expect(expectedClauseRightType(t.string, "contains")).toEqual(t.string);
  });

  it("leaves a list alone for every other operator", () => {
    expect(expectedClauseRightType(stringList, "eq")).toEqual(stringList);
  });
});

describe("operator wording", () => {
  it("has customer-facing wording for every workflow operator", () => {
    const missing = WORKFLOW_OPERATORS.filter((op) => !(op in OPERATOR_LABELS));
    expect(missing).toEqual([]);
  });
});

describe("pairs", () => {
  const header = {
    name: "X-A",
    value: { kind: "literal", type: t.string, value: "1" }
  };

  it("round-trips a set of named rows", () => {
    expect(
      valueOrRefSchema.parse({ kind: "pairs", entries: [header] })
    ).toEqual({ kind: "pairs", entries: [header] });
  });

  it("defaults entries to empty", () => {
    expect(valueOrRefSchema.parse({ kind: "pairs" })).toEqual({
      kind: "pairs",
      entries: []
    });
  });

  it("rejects rows nested inside rows", () => {
    expect(
      valueOrRefSchema.safeParse({
        kind: "pairs",
        entries: [{ name: "X-A", value: { kind: "pairs", entries: [] } }]
      }).success
    ).toBe(false);
  });
});

describe("rendersAsText", () => {
  it("accepts every primitive", () => {
    for (const type of [t.string, t.number, t.boolean, t.date]) {
      expect(rendersAsText(type)).toBe(true);
    }
  });

  // A record prints as its readable id, which is what "…for SO000123" means, and is
  // what a notification body turns into a link.
  it("accepts a record", () => {
    expect(rendersAsText(t.entity("salesOrder"))).toBe(true);
  });

  it("accepts a list of primitives", () => {
    expect(rendersAsText(t.list({ kind: "primitive", of: "string" }))).toBe(
      true
    );
  });

  // A run of ids in a sentence has no good reading.
  it("refuses a list of records", () => {
    expect(rendersAsText(t.list({ kind: "entity", of: "salesOrder" }))).toBe(
      false
    );
  });
});
