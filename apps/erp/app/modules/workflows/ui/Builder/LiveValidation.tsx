import { referenceIssues } from "@carbon/workflows";
import { useEffect } from "react";
import { catalog } from "./catalog";
import { useBuilderStore, useBuilderStoreApi } from "./context";
import { fromReactFlow } from "./graph";

const DEBOUNCE_MS = 250;

/**
 * Re-checks every variable against the graph as it is edited — a step deleted or an
 * action swapped breaks values on other cards, and publish is too late to say so.
 * References only: a half-built step is not a mistake yet.
 */
export function LiveValidation() {
  const store = useBuilderStoreApi();
  const nodes = useBuilderStore((state) => state.nodes);
  const edges = useBuilderStore((state) => state.edges);

  useEffect(() => {
    // Debounced because `nodes` is replaced on every drag frame, and dragging a card
    // cannot change what any variable points at.
    const timer = setTimeout(() => {
      store
        .getState()
        .setLiveIssues(referenceIssues(fromReactFlow(nodes, edges), catalog));
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [nodes, edges, store]);

  return null;
}
