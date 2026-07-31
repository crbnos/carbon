import { describe, expect, it } from "vitest";
import { compare, evaluateClauses } from "./compare";
import { createRuntimeContext } from "./fixtures";
import { entityValue, listValue, primitiveValue } from "./values";

const num = (value: number) => primitiveValue("number", value);
const str = (value: string) => primitiveValue("string", value);
const date = (value: string) => primitiveValue("date", value);
const nothing = primitiveValue("null", null);

const literal = (of: "number" | "string", value: unknown) =>
  ({ kind: "literal", type: { kind: "primitive", of }, value }) as const;

describe("compare", () => {
  it("orders numbers", () => {
    expect(compare(num(15000), "gt", num(10000))).toBe(true);
    expect(compare(num(10000), "gte", num(10000))).toBe(true);
    expect(compare(num(9), "lt", num(10))).toBe(true);
    expect(compare(num(9), "eq", num(10))).toBe(false);
    expect(compare(num(9), "neq", num(10))).toBe(true);
  });

  it("orders dates by instant, whatever the offset says", () => {
    expect(
      compare(
        date("2026-07-30T12:00:00.000Z"),
        "lt",
        date("2026-08-01T00:00:00Z")
      )
    ).toBe(true);
    expect(
      compare(
        date("2026-07-30T12:00:00.000Z"),
        "eq",
        date("2026-07-30T07:00:00-05:00")
      )
    ).toBe(true);
  });

  it("matches text without case but compares it with case", () => {
    expect(compare(str("Acme Tooling"), "contains", str("acme"))).toBe(true);
    expect(compare(str("Acme Tooling"), "startsWith", str("ACME"))).toBe(true);
    expect(compare(str("Acme Tooling"), "endsWith", str("TOOLING"))).toBe(true);
    expect(compare(str("Acme"), "eq", str("acme"))).toBe(false);
    expect(compare(str("Acme"), "neq", str("acme"))).toBe(true);
  });

  it("compares booleans on equality only", () => {
    expect(
      compare(
        primitiveValue("boolean", true),
        "eq",
        primitiveValue("boolean", true)
      )
    ).toBe(true);
    expect(
      compare(
        primitiveValue("boolean", true),
        "gt",
        primitiveValue("boolean", false)
      )
    ).toBe(false);
  });

  it("compares records by kind and id together", () => {
    expect(
      compare(entityValue("part", "p1"), "eq", entityValue("part", "p1"))
    ).toBe(true);
    expect(
      compare(entityValue("part", "p1"), "eq", entityValue("job", "p1"))
    ).toBe(false);
  });

  it("tests list membership", () => {
    const list = listValue({ kind: "entity", of: "part" }, [
      entityValue("part", "p1"),
      entityValue("part", "p2")
    ]).value;
    expect(compare(list, "contains", entityValue("part", "p2"))).toBe(true);
    expect(compare(list, "contains", entityValue("part", "p9"))).toBe(false);
    expect(compare(list, "gt", entityValue("part", "p1"))).toBe(false);
  });

  it("never throws on nothing, and never orders it", () => {
    expect(compare(nothing, "eq", nothing)).toBe(true);
    expect(compare(nothing, "eq", num(0))).toBe(false);
    expect(compare(nothing, "neq", num(0))).toBe(true);
    expect(compare(nothing, "gt", num(0))).toBe(false);
    expect(compare(num(0), "lt", nothing)).toBe(false);
    expect(compare(nothing, "contains", str("a"))).toBe(false);
  });
});

describe("evaluateClauses", () => {
  const ctx = createRuntimeContext({
    outputs: { trigger: { record: entityValue("purchaseOrder", "po1") } },
    rows: { "purchaseOrder:po1": { amount: 15000, status: "Sent" } }
  });

  const amount = {
    kind: "ref" as const,
    nodeId: "trigger",
    output: "record",
    path: ["amount"]
  };

  it("passes when every clause passes under and", async () => {
    const result = await evaluateClauses(
      [
        { left: amount, operator: "gt", right: literal("number", 10000) },
        { left: amount, operator: "lt", right: literal("number", 50000) }
      ],
      "and",
      ctx
    );
    expect(result).toMatchObject({ ok: true, passed: true });
  });

  it("passes under or when only the first clause passes", async () => {
    const result = await evaluateClauses(
      [
        { left: amount, operator: "gt", right: literal("number", 10000) },
        { left: amount, operator: "gt", right: literal("number", 99999) }
      ],
      "or",
      ctx
    );
    expect(result).toMatchObject({ ok: true, passed: true });
  });

  it("passes an empty clause list", async () => {
    const result = await evaluateClauses([], "and", ctx);
    expect(result).toMatchObject({ ok: true, passed: true });
    expect(result.evaluations).toEqual([]);
  });

  it("aborts rather than counting an operand it could not work out", async () => {
    const result = await evaluateClauses(
      [
        {
          left: {
            kind: "ref",
            nodeId: "missing",
            output: "result",
            path: []
          },
          operator: "eq",
          right: literal("number", 1)
        }
      ],
      "and",
      ctx
    );
    expect(result).toMatchObject({
      ok: false,
      reason: "The step that produces this value did not run."
    });
  });

  it("two-clause and: returns evaluations with both sides and passed populated", async () => {
    const result = await evaluateClauses(
      [
        { left: amount, operator: "gt", right: literal("number", 10000) },
        { left: amount, operator: "lt", right: literal("number", 50000) }
      ],
      "and",
      ctx
    );
    expect(result.ok).toBe(true);
    expect(result.evaluations).toHaveLength(2);
    expect(result.evaluations[0]?.passed).toBe(true);
    expect(result.evaluations[0]?.left).not.toBeNull();
    expect(result.evaluations[0]?.right).not.toBeNull();
    expect(result.evaluations[1]?.passed).toBe(true);
  });

  it("unresolvable left side: ok:false, evaluations.length===1, passed:null with reason", async () => {
    const result = await evaluateClauses(
      [
        {
          left: { kind: "ref", nodeId: "gone", output: "result", path: [] },
          operator: "eq",
          right: literal("number", 1)
        }
      ],
      "and",
      ctx
    );
    expect(result.ok).toBe(false);
    expect(result.evaluations).toHaveLength(1);
    expect(result.evaluations[0]?.passed).toBeNull();
    expect(result.evaluations[0]?.reason).toBeTruthy();
  });

  it("three-clause list failing on the second: evaluations.length===2", async () => {
    const result = await evaluateClauses(
      [
        { left: amount, operator: "gt", right: literal("number", 10000) },
        {
          left: { kind: "ref", nodeId: "gone", output: "result", path: [] },
          operator: "eq",
          right: literal("number", 1)
        },
        { left: amount, operator: "lt", right: literal("number", 50000) }
      ],
      "and",
      ctx
    );
    expect(result.ok).toBe(false);
    expect(result.evaluations).toHaveLength(2);
  });
});
