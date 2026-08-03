import type { AvailableVariable, WorkflowDefinition } from "@carbon/workflows";
import {
  availableVariables,
  createContext,
  variablesFromHandle
} from "@carbon/workflows";
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

export type HandlePreview = {
  variables: AvailableVariable[];
  /** The node adds nothing of its own — it only routes what reaches it. */
  routesOnly: boolean;
};

/** What a node wired to this handle would see. On demand for the same reason. */
export function useHandlePreviewGetter(
  nodeId: string,
  handleId: string
): () => HandlePreview {
  const store = useBuilderStoreApi();
  return useCallback(() => {
    const { nodes, edges } = store.getState();
    const definition = fromReactFlow(nodes, edges);
    // Defined-but-empty means "routes only"; undefined means "not configured yet".
    const outputs = createContext(definition, catalog).context.outputsOf(
      nodeId
    );
    return {
      variables: variablesFromHandle(definition, nodeId, handleId, catalog),
      routesOnly: outputs !== undefined && Object.keys(outputs).length === 0
    };
  }, [store, nodeId, handleId]);
}
