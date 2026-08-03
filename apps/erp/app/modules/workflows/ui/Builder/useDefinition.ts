import type { WorkflowDefinition } from "@carbon/workflows";
import { availableVariables } from "@carbon/workflows";
import { useMemo } from "react";
import { catalog } from "./catalog";
import { useBuilderStoreShallow } from "./context";
import { fromReactFlow } from "./graph";

/** The current graph as a definition. Memoised so the graph is built once per change. */
export function useDefinition(): WorkflowDefinition {
  const { nodes, edges } = useBuilderStoreShallow((s) => ({
    nodes: s.nodes,
    edges: s.edges
  }));
  return useMemo(() => fromReactFlow(nodes, edges), [nodes, edges]);
}

/** Variables visible to one node. A picker is mounted per input, so this must stay memoised. */
export function useAvailableVariables(nodeId: string) {
  const definition = useDefinition();
  return useMemo(
    () => availableVariables(definition, nodeId, catalog),
    [definition, nodeId]
  );
}
