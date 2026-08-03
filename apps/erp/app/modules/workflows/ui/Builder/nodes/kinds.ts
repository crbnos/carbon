import type { WorkflowNodeType } from "@carbon/workflows";

// Per-kind facts that layout and store code need. Kept apart from `meta.ts`
// because that module reaches the translation catalog, which the unit-test
// runner cannot compile — importing it from `graph.ts` breaks `graph.test.ts`.

/** Card width in px when expanded. Collapsed cards are always 260px. */
export const NODE_CARD_WIDTH: Record<WorkflowNodeType, number> = {
  trigger: 360,
  condition: 540,
  action: 420,
  entity: 420,
  lookup: 500,
  filter: 500
};

/** False where the handles are drawn by the form and would vanish when collapsed. */
export const NODE_CAN_COLLAPSE: Record<WorkflowNodeType, boolean> = {
  trigger: true,
  condition: false,
  action: true,
  entity: true,
  lookup: true,
  filter: true
};

/** Widest card, so auto-placement clears whatever kind it lands beside. */
export const MAX_NODE_CARD_WIDTH = Math.max(...Object.values(NODE_CARD_WIDTH));
