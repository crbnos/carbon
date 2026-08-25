import { describe, expect, it } from "vitest";
import type { WorkflowNode, WorkflowNodeType } from "../definition/schema";
import { actionExecutor } from "./action";
import { computeExecutor } from "./compute";
import { conditionExecutor } from "./condition";
import { executorFor } from "./executors";
import { filterExecutor } from "./filter";
import { lookupExecutor } from "./lookup";

const nodeOf = (type: WorkflowNodeType) =>
  ({ id: "n1", type, position: { x: 0, y: 0 }, data: {} }) as WorkflowNode;

const RUNNABLE: WorkflowNodeType[] = [
  "condition",
  "filter",
  "lookup",
  "compute",
  "action"
];

describe("executorFor", () => {
  it("hands back the executor for every kind that can run", () => {
    expect(executorFor(nodeOf("condition"))).toBe(conditionExecutor);
    expect(executorFor(nodeOf("filter"))).toBe(filterExecutor);
    expect(executorFor(nodeOf("lookup"))).toBe(lookupExecutor);
    expect(executorFor(nodeOf("compute"))).toBe(computeExecutor);
    expect(executorFor(nodeOf("action"))).toBe(actionExecutor);
  });

  it("has nothing for a trigger, which the walk starts from rather than runs", () => {
    expect(executorFor(nodeOf("trigger"))).toBeUndefined();
  });

  it("covers every node kind except the trigger", () => {
    for (const type of RUNNABLE) {
      expect(executorFor(nodeOf(type))).toBeDefined();
    }
  });

  it("never offers work without a permission check beside it", () => {
    for (const type of RUNNABLE) {
      const executor = executorFor(nodeOf(type));
      if (executor === undefined) continue;
      expect(typeof executor.permission).toBe("function");
      expect(typeof executor.execute).toBe("function");
    }
  });
});
