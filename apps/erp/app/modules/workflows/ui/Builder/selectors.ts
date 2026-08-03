import type { BuilderState } from "./store";

// Primitives and stable references only: `nodes` is replaced on every drag frame,
// so subscribing to the array itself re-renders every card.

export const selectNode = (id: string) => (s: BuilderState) =>
  s.nodes.find((n) => n.id === id);

export const selectTriggerCount = (s: BuilderState) =>
  s.nodes.reduce((n, node) => n + (node.type === "trigger" ? 1 : 0), 0);

export const selectHasEdgeFrom =
  (id: string, handle: string) => (s: BuilderState) =>
    s.edges.some((e) => e.source === id && e.sourceHandle === handle);
