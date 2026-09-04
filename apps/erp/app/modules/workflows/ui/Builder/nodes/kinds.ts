import type { WorkflowNodeType } from "@carbon/workflows";

// Per-kind facts that layout and store code need. Kept apart from `meta.ts`
// because that module reaches the translation catalog, which the unit-test
// runner cannot compile — importing it from `graph.ts` breaks `graph.test.ts`.

/** Card width in px. A card keeps its width when collapsed, so edges never shift. */
export const NODE_CARD_WIDTH: Record<WorkflowNodeType, number> = {
  trigger: 360,
  condition: 612,
  action: 420,
  compute: 420,
  lookup: 500,
  filter: 500
};

/** Widest card, so auto-placement clears whatever kind it lands beside. */
export const MAX_NODE_CARD_WIDTH = Math.max(...Object.values(NODE_CARD_WIDTH));

/** Rough expanded heights, used only when a card has no measured size yet —
 * `onlyRenderVisibleElements` leaves anything never scrolled into view unmeasured. */
export const NODE_CARD_HEIGHT: Record<WorkflowNodeType, number> = {
  trigger: 180,
  condition: 320,
  action: 260,
  compute: 260,
  lookup: 280,
  filter: 280
};

/** Header-only card. Same for every kind — the body is what differs. */
export const COLLAPSED_NODE_CARD_HEIGHT = 56;

/** Which kinds accept an incoming edge. A trigger starts a run, so nothing may
 * connect into one. Lives here rather than in `meta.ts` so `graph.ts` and its tests
 * can read it without pulling in the Lingui macro that `meta.ts` imports. */
export const NODE_ACCEPTS_INCOMING: Record<WorkflowNodeType, boolean> = {
  trigger: false,
  condition: true,
  action: true,
  compute: true,
  lookup: true,
  filter: true
};
