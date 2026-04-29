export const TRACE_API = {
  expand: "/api/traceability/expand",
  search: "/api/traceability/search"
} as const;

export const DEPTH = { min: 1, max: 5, default: 1 } as const;
export const SPACING = { min: 1, max: 5, default: 2 } as const;
export const NODE_SIZE = 44;
export const NODE_RADIUS = NODE_SIZE / 2;

export function clampDepth(n: number): number {
  return Math.min(Math.max(DEPTH.min, n), DEPTH.max);
}

export function clampSpacing(n: number): number {
  return Math.min(Math.max(SPACING.min, n), SPACING.max);
}
