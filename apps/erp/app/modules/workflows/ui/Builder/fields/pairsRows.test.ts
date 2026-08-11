import type { PairEntry, ValueOrRef } from "@carbon/workflows";
import { describe, expect, it } from "vitest";
import {
  addRow,
  entriesOf,
  removeRow,
  setRowName,
  setRowValue,
  toValue
} from "./pairsRows";

const text = (value: string): ValueOrRef => ({
  kind: "literal",
  type: { kind: "primitive", of: "string" },
  value
});

const rows = (...names: string[]): PairEntry[] =>
  names.map((name) => ({ name, value: text(name) }) as PairEntry);

describe("entriesOf", () => {
  it("reads the rows out of a pairs value", () => {
    expect(entriesOf({ kind: "pairs", entries: rows("A") })).toHaveLength(1);
  });

  it("treats anything else as no rows", () => {
    expect(entriesOf(undefined)).toEqual([]);
    expect(entriesOf(text("hi"))).toEqual([]);
  });
});

describe("addRow", () => {
  it("appends an empty row without touching the others", () => {
    const before = rows("A");
    const after = addRow(before);
    expect(after).toHaveLength(2);
    expect(after[1]).toEqual({ name: "", value: text("") });
    expect(before).toHaveLength(1);
  });
});

describe("removeRow", () => {
  it("drops only the row at that position", () => {
    expect(removeRow(rows("A", "B", "C"), 1).map((r) => r.name)).toEqual([
      "A",
      "C"
    ]);
  });
});

describe("setRowName", () => {
  it("renames one row and leaves its value alone", () => {
    const after = setRowName(rows("A", "B"), 0, "Authorization");
    expect(after[0]).toEqual({ name: "Authorization", value: text("A") });
    expect(after[1]?.name).toBe("B");
  });
});

describe("setRowValue", () => {
  it("replaces one row's value", () => {
    const after = setRowValue(rows("A"), 0, text("Bearer x"));
    expect(after[0]?.value).toEqual(text("Bearer x"));
  });

  it("clears the value rather than storing nothing", () => {
    expect(setRowValue(rows("A"), 0, undefined)[0]?.value).toEqual(text(""));
  });

  it("refuses to nest a pairs inside a row", () => {
    const nested = { kind: "pairs", entries: [] } as ValueOrRef;
    expect(setRowValue(rows("A"), 0, nested)[0]?.value).toEqual(text(""));
  });
});

describe("toValue", () => {
  it("stores an empty set as absent", () => {
    expect(toValue([])).toBeUndefined();
  });

  it("wraps the rows once there are any", () => {
    expect(toValue(rows("A"))).toEqual({ kind: "pairs", entries: rows("A") });
  });
});
