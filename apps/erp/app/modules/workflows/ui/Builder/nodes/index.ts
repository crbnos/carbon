import type { WorkflowNodeType } from "@carbon/workflows";
import type { NodeProps } from "@xyflow/react";
import type { ComponentType } from "react";
import { WorkflowNodeCard } from "./WorkflowNodeCard";

// Spelled out rather than generated, so adding a seventh node kind fails the
// build here (and in NODE_KIND_META) instead of shipping invisibly.
export const nodeTypes: Record<WorkflowNodeType, ComponentType<NodeProps>> = {
  trigger: WorkflowNodeCard,
  condition: WorkflowNodeCard,
  compute: WorkflowNodeCard,
  lookup: WorkflowNodeCard,
  filter: WorkflowNodeCard,
  action: WorkflowNodeCard
};
