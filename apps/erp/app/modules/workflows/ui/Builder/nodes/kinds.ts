import type { WorkflowNodeType } from "@carbon/workflows";

// Per-kind facts that layout and store code need. Kept apart from `meta.ts`
// because that module reaches the translation catalog, which the unit-test
// runner cannot compile — importing it from `graph.ts` breaks `graph.test.ts`.

/** Card width in px. A card keeps its width when collapsed, so edges never shift. */
export const NODE_CARD_WIDTH: Record<WorkflowNodeType, number> = {
  trigger: 360,
  condition: 612,
  action: 420,
  entity: 420,
  lookup: 500,
  filter: 500
};

/** Widest card, so auto-placement clears whatever kind it lands beside. */
export const MAX_NODE_CARD_WIDTH = Math.max(...Object.values(NODE_CARD_WIDTH));
