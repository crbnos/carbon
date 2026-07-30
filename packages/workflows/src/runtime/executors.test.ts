import { describe, expect, it } from "vitest";
import type { WorkflowNode, WorkflowNodeType } from "../definition/schema";
import { conditionExecutor } from "./condition";
import { executorFor } from "./executors";
import { filterExecutor } from "./filter";

const nodeOf = (type: WorkflowNodeType) =>
  ({ id: "n1", type, position: { x: 0, y: 0 }, data: {} }) as WorkflowNode;

describe("executorFor", () => {
  it("hands back the executor for the kinds that can run", () => {
    expect(executorFor(nodeOf("condition"))).toBe(conditionExecutor);
    expect(executorFor(nodeOf("filter"))).toBe(filterExecutor);
  });

  it("has nothing for the kinds that arrive in phase 5", () => {
    expect(executorFor(nodeOf("lookup"))).toBeUndefined();
    expect(executorFor(nodeOf("entity"))).toBeUndefined();
    expect(executorFor(nodeOf("action"))).toBeUndefined();
  });

  // The drift this registry exists to stop: a kind that can execute but whose
  // permission check was forgotten in a second lookup.
  it("never offers work without a permission check beside it", () => {
    for (const type of ["condition", "filter", "lookup", "entity", "action"]) {
      const executor = executorFor(nodeOf(type as WorkflowNodeType));
      if (executor === undefined) continue;
      expect(typeof executor.permission).toBe("function");
      expect(typeof executor.execute).toBe("function");
    }
  });
});
