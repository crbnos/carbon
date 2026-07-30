import type { WorkflowNode, WorkflowNodeType } from "../definition/schema";
import { conditionExecutor } from "./condition";
import { filterExecutor } from "./filter";
import type { NodeExecutor } from "./types";

/**
 * One entry per node kind that can run. Lookup, entity and action arrive in
 * phase 5; a missing entry is what makes them refuse to execute today.
 *
 * Permission and execution come from the same entry on purpose: two lookups
 * could drift, and the one that drifts silently is the permission check.
 */
const EXECUTORS: {
  [K in WorkflowNodeType]?: NodeExecutor<Extract<WorkflowNode, { type: K }>>;
} = {
  condition: conditionExecutor,
  filter: filterExecutor
};

export function executorFor<N extends WorkflowNode>(
  node: N
): NodeExecutor<N> | undefined {
  return EXECUTORS[node.type] as unknown as NodeExecutor<N> | undefined;
}
