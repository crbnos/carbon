import type {
  AvailableVariable,
  BatchPlan,
  ValueOrRef,
  ValueType,
  WorkflowDefinition
} from "@carbon/workflows";
import {
  availableVariables,
  batchPlan,
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

/** The type of any value a node may hold — a literal, a template, the loop item, or a
 * reference into an earlier step. The same resolver the validator uses, so an operator
 * list and a type error can never disagree about what a field holds. */
export function useValueTypeResolver(
  nodeId: string
): (value: ValueOrRef) => ValueType | undefined {
  const definition = useDefinition();
  return useMemo(() => {
    const { context } = createContext(definition, catalog);
    return (value: ValueOrRef) => context.typeOf(value, nodeId);
  }, [definition, nodeId]);
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

/**
 * Every action step's repeat plan, in one pass over the graph. The cards read the result
 * out of the store rather than each deriving its own: subscribing a card to the whole
 * definition would rebuild it on every drag frame, once per card.
 */
export function batchPlansFor(
  definition: WorkflowDefinition
): Record<string, BatchPlan> {
  const { context } = createContext(definition, catalog);
  const plans: Record<string, BatchPlan> = {};
  for (const node of definition.nodes) {
    if (node.type !== "action") continue;
    const action = catalog.getAction(node.data.action);
    if (action === undefined) continue;
    const plan = batchPlan(action, node.data.inputs, (name) => {
      const supplied = node.data.inputs[name];
      return supplied === undefined
        ? undefined
        : context.typeOf(supplied, node.id);
    });
    if (plan.kind !== "none") plans[node.id] = plan;
  }
  return plans;
}

/** Whether one action step repeats, read off its wiring — there is no stored flag. The
 * form and the card both ask here, so neither can describe the step differently. */
export function useActionBatchPlan(
  nodeId: string,
  actionId: string,
  inputs: Record<string, ValueOrRef>
): BatchPlan {
  const typeOf = useValueTypeResolver(nodeId);
  return useMemo(() => {
    const action = actionId ? catalog.getAction(actionId) : undefined;
    if (action === undefined) return { kind: "none" };
    return batchPlan(action, inputs, (name) => {
      const supplied = inputs[name];
      return supplied === undefined ? undefined : typeOf(supplied);
    });
  }, [actionId, inputs, typeOf]);
}

/** The name of the entity operation input that is wired to a list, or undefined when
 * the node runs once. The form uses this to show the batch note. */
export function useEntityBatchInput(
  nodeId: string,
  operationId: string,
  inputs: Record<string, ValueOrRef>
): string | undefined {
  const typeOf = useValueTypeResolver(nodeId);
  return useMemo(() => {
    const operation = operationId
      ? catalog.getOperation(operationId)
      : undefined;
    if (operation === undefined) return undefined;
    for (const [name, decl] of Object.entries(operation.inputs)) {
      if (decl.type.kind === "list") continue;
      const supplied = inputs[name];
      if (supplied === undefined || supplied.kind === "item") continue;
      const type = typeOf(supplied);
      if (type?.kind === "list") return name;
    }
    return undefined;
  }, [operationId, inputs, typeOf]);
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
