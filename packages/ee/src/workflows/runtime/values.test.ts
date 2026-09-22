import { describe, expect, it } from "vitest";
import { t } from "../definition/types";
import type { RuntimeValue } from "./types";
import {
  entityValue,
  fromColumn,
  fromLiteral,
  isNull,
  listValue,
  primitiveValue
} from "./values";

describe("fromColumn", () => {
  it("turns a date column into an ISO string", () => {
    expect(fromColumn(t.date, "2026-07-30T12:00:00.000Z")).toEqual(
      primitiveValue("date", "2026-07-30T12:00:00.000Z")
    );
  });

  it("turns an unparseable date into nothing", () => {
    expect(fromColumn(t.date, "not a date")).toEqual(
      primitiveValue("null", null)
    );
  });

  it("turns a non-finite number into nothing", () => {
    expect(fromColumn(t.number, "abc")).toEqual(primitiveValue("null", null));
  });

  it("treats an empty entity column as nothing", () => {
    expect(fromColumn(t.entity("part"), "")).toEqual(
      primitiveValue("null", null)
    );
  });

  it("treats a missing column as nothing", () => {
    expect(fromColumn(t.string, null)).toEqual(primitiveValue("null", null));
    expect(fromColumn(t.string, undefined)).toEqual(
      primitiveValue("null", null)
    );
  });

  it("turns a missing list column into an empty list", () => {
    expect(
      fromColumn(t.list({ kind: "primitive", of: "string" }), null)
    ).toEqual({
      kind: "list",
      of: { kind: "primitive", of: "string" },
      items: []
    });
  });

  it("builds entity items from a list of ids", () => {
    const type = t.list({ kind: "entity", of: "part" });
    expect(fromColumn(type, ["p1", "p2"])).toEqual({
      kind: "list",
      of: { kind: "entity", of: "part" },
      items: [entityValue("part", "p1"), entityValue("part", "p2")]
    });
  });
});

describe("listValue", () => {
  it("slices past the cap and reports what was dropped", () => {
    const items: RuntimeValue[] = Array.from({ length: 150 }, (_, i) =>
      entityValue("part", `p${i}`)
    );
    const { value, dropped } = listValue({ kind: "entity", of: "part" }, items);
    expect(dropped).toBe(50);
    expect(value.kind === "list" && value.items).toHaveLength(100);
  });
});

describe("isNull", () => {
  it("is true only for nothing", () => {
    expect(isNull(fromColumn(t.string, null))).toBe(true);
    expect(isNull(primitiveValue("string", ""))).toBe(false);
  });
});

describe("fromLiteral", () => {
  it("reads a literal through the same coercion as a column", () => {
    expect(
      fromLiteral({ kind: "literal", type: t.number, value: 10000 })
    ).toEqual(primitiveValue("number", 10000));
  });
});
