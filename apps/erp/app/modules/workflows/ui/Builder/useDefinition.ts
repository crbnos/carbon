import type { AvailableVariable, WorkflowDefinition } from "@carbon/workflows";
import { availableVariables } from "@carbon/workflows";
import { useCallback, useMemo } from "react";
import { catalog } from "./catalog";
import { useBuilderStoreApi, useBuilderStoreShallow } from "./context";
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

/** The same list, computed on demand. Subscribing re-renders every field on every
 * drag frame; a menu only needs the list at the moment it opens. */
export function useVariablesGetter(nodeId: string): () => AvailableVariable[] {
  const store = useBuilderStoreApi();
  return useCallback(() => {
    const { nodes, edges } = store.getState();
    return availableVariables(fromReactFlow(nodes, edges), nodeId, catalog);
  }, [store, nodeId]);
}
