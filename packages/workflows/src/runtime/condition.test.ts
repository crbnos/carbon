import { describe, expect, it } from "vitest";
import type { ConditionNode, ConditionPath } from "../definition/schema";
import { conditionExecutor } from "./condition";
import { createRuntimeContext } from "./fixtures";
import { entityValue } from "./values";

const ctx = createRuntimeContext({
  outputs: { trigger: { record: entityValue("purchaseOrder", "po1") } },
  rows: { "purchaseOrder:po1": { amount: 15000 } }
});

const amount = {
  kind: "ref" as const,
  nodeId: "trigger",
  output: "record",
  path: ["amount"]
};

const over = (value: number): ConditionPath["clauses"] => [
  {
    left: amount,
    operator: "gt",
    right: { kind: "literal", type: { kind: "primitive", of: "number" }, value }
  }
];

const node = (paths: ConditionPath[]): ConditionNode => ({
  id: "check",
  type: "condition",
  position: { x: 0, y: 0 },
  data: { paths }
});

const path = (
  id: string,
  kind: ConditionPath["kind"],
  clauses: ConditionPath["clauses"] = []
): ConditionPath => ({ id, kind, combinator: "and", clauses });

describe("conditionExecutor", () => {
  it("takes the first branch that passes", async () => {
    const result = await conditionExecutor.execute(
      node([path("p1", "if", over(10000)), path("p2", "else")]),
      ctx
    );
    expect(result).toEqual({
      status: "Succeeded",
      outputs: {},
      handle: "p1",
      branchTaken: "p1"
    });
  });

  it("falls through to an else-if", async () => {
    const result = await conditionExecutor.execute(
      node([path("p1", "if", over(50000)), path("p2", "elseIf", over(10000))]),
      ctx
    );
    expect(result).toMatchObject({ handle: "p2", branchTaken: "p2" });
  });

  it("falls through to the else", async () => {
    const result = await conditionExecutor.execute(
      node([path("p1", "if", over(50000)), path("p2", "else")]),
      ctx
    );
    expect(result).toMatchObject({ handle: "p2", branchTaken: "p2" });
  });

  it("stops cleanly when nothing matches and there is no else", async () => {
    const result = await conditionExecutor.execute(
      node([path("p1", "if", over(50000))]),
      ctx
    );
    expect(result).toEqual({
      status: "Succeeded",
      outputs: {},
      handle: null,
      branchTaken: "none"
    });
  });

  it("skips rather than reaching the else when a value is missing", async () => {
    const missing = path("p1", "if", [
      {
        left: { kind: "ref", nodeId: "gone", output: "result", path: [] },
        operator: "eq",
        right: {
          kind: "literal",
          type: { kind: "primitive", of: "number" },
          value: 1
        }
      }
    ]);
    const result = await conditionExecutor.execute(
      node([missing, path("p2", "else")]),
      ctx
    );
    expect(result).toEqual({
      status: "Skipped",
      reason: "The step that produces this value did not run."
    });
  });
});
