import { REFERENCE_ISSUE_CODES } from "@carbon/workflows";
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

/** How this step repeats, or undefined when it runs once. Read straight out of the map
 * so the reference stays stable between the debounced re-derivations. */
export const selectNodeBatchPlan = (id: string) => (s: BuilderState) =>
  s.batchPlans[id];

/** Wired to anything at all, either direction. A node with no edges is not part of
 * the workflow yet, so its problems are noise rather than something to fix. */
export const selectIsConnected = (id: string) => (s: BuilderState) =>
  s.edges.some((e) => e.source === id || e.target === id);

/**
 * Everything wrong with the workflow: what the last publish attempt found, minus the
 * broken-variable ones, plus the live answer to those. The live pass is always the
 * newer of the two — a publish result goes stale the moment the graph is edited.
 */
export const selectAllIssues = (s: BuilderState) => [
  ...s.issues.filter((issue) => !REFERENCE_ISSUE_CODES.includes(issue.code)),
  ...s.liveIssues
];

export const selectNodeIssues = (id: string) => (s: BuilderState) =>
  selectAllIssues(s).filter((issue) => issue.nodeId === id);
