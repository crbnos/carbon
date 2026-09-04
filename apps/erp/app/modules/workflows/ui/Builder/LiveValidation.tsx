import { referenceIssues } from "@carbon/workflows";
import { useEffect } from "react";
import { useWorkflowCatalog } from "./catalog";
import { useBuilderStore, useBuilderStoreApi } from "./context";
import { fromReactFlow } from "./graph";
import { batchPlansFor } from "./useDefinition";

const DEBOUNCE_MS = 250;

/**
 * Re-derives what the graph implies as it is edited — which variables are now broken
 * (a step deleted or an action swapped breaks values on other cards, and publish is too
 * late to say so), and which steps repeat. References only: a half-built step is not a
 * mistake yet.
 */
export function LiveValidation() {
  const store = useBuilderStoreApi();
  const catalog = useWorkflowCatalog();
  const nodes = useBuilderStore((state) => state.nodes);
  const edges = useBuilderStore((state) => state.edges);

  useEffect(() => {
    // Debounced because `nodes` is replaced on every drag frame, and dragging a card
    // can change neither what a variable points at nor what a step repeats over.
    const timer = setTimeout(() => {
      const definition = fromReactFlow(nodes, edges);
      const state = store.getState();
      state.setLiveIssues(referenceIssues(definition, catalog));
      state.setBatchPlans(batchPlansFor(definition, catalog));
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [nodes, edges, store, catalog]);

  return null;
}
