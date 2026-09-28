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
  name: "check",
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
    expect(result).toMatchObject({
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
    expect(result).toMatchObject({
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
    expect(result).toMatchObject({
      status: "Skipped",
      reason: "The step that produces this value did not run."
    });
  });

  it("if fails and falls to else: detail.paths length 2, first taken:false, second taken:true with empty evaluations", async () => {
    const result = await conditionExecutor.execute(
      node([path("p1", "if", over(50000)), path("p2", "else")]),
      ctx
    );
    if (result.status !== "Succeeded") throw new Error("Expected Succeeded");
    const detail = result.detail;
    expect(detail).toBeDefined();
    expect(detail?.kind).toBe("condition");
    expect(detail?.paths).toHaveLength(2);
    expect(detail?.paths[0]?.taken).toBe(false);
    expect(detail?.paths[0]?.evaluations.length).toBeGreaterThan(0);
    expect(detail?.paths[1]?.taken).toBe(true);
    expect(detail?.paths[1]?.evaluations).toEqual([]);
  });

  it("skip: detail's last path has an evaluation carrying a reason", async () => {
    const missingClause = [
      {
        left: {
          kind: "ref" as const,
          nodeId: "gone",
          output: "result",
          path: [] as string[]
        },
        operator: "eq" as const,
        right: {
          kind: "literal" as const,
          type: { kind: "primitive" as const, of: "number" as const },
          value: 1
        }
      }
    ];
    const result = await conditionExecutor.execute(
      node([path("p1", "if", missingClause)]),
      ctx
    );
    if (result.status !== "Skipped") throw new Error("Expected Skipped");
    const detail = result.detail;
    expect(detail).toBeDefined();
    const lastPath = detail?.paths.at(-1);
    expect(lastPath?.evaluations.length).toBeGreaterThan(0);
    expect(lastPath?.evaluations.at(-1)?.reason).toBeTruthy();
  });
});
