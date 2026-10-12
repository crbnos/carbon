// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export const TRACE_API = {
  expand: "/api/traceability/expand",
  search: "/api/traceability/search"
} as const;

export const DEPTH = { min: 1, max: 5, default: 1 } as const;
export const SPACING = { min: 1, max: 5, default: 2 } as const;
export const NODE_SIZE = 44;
export const NODE_RADIUS = NODE_SIZE / 2;

/** Phones: fit inside the view chip and toolbar above and the legend below. */
export const COMPACT_FIT_PADDING = {
  top: "120px",
  bottom: "56px",
  left: "24px",
  right: "24px"
} as const;

export function clampDepth(n: number): number {
  return Math.min(Math.max(DEPTH.min, n), DEPTH.max);
}

export function clampSpacing(n: number): number {
  return Math.min(Math.max(SPACING.min, n), SPACING.max);
}
