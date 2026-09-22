import type { WorkflowNode } from "@carbon/ee/workflows";
import type { Edge, Node } from "@xyflow/react";

export type BuilderNode = Node<
  Record<string, unknown>,
  WorkflowNode["type"]
> & {
  name: string;
  expanded?: boolean;
};
export type BuilderEdge = Edge;
