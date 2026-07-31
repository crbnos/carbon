import type { WorkflowNode } from "@carbon/workflows";
import type { Edge, Node } from "@xyflow/react";

export type BuilderNode = Node<
  Record<string, unknown>,
  WorkflowNode["type"]
> & {
  title?: string;
};
export type BuilderEdge = Edge;
