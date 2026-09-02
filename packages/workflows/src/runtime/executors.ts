import type { WorkflowNode, WorkflowNodeType } from "../definition/schema";
import { actionExecutor } from "./action";
import { computeExecutor } from "./compute";
import { conditionExecutor } from "./condition";
import { filterExecutor } from "./filter";
import { lookupExecutor } from "./lookup";
import type { NodeExecutor } from "./types";

// One entry per node kind that can run; a missing entry means the kind refuses to execute.
// Permission and execution share an entry so the permission check cannot silently drift.
const EXECUTORS: {
  [K in WorkflowNodeType]?: NodeExecutor<Extract<WorkflowNode, { type: K }>>;
} = {
  action: actionExecutor,
  compute: computeExecutor,
  condition: conditionExecutor,
  filter: filterExecutor,
  lookup: lookupExecutor
};

export function executorFor<N extends WorkflowNode>(
  node: N
): NodeExecutor<N> | undefined {
  return EXECUTORS[node.type] as unknown as NodeExecutor<N> | undefined;
}
