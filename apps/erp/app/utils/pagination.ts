import { parseNumberFromUrlParam } from "@carbon/auth";

export const PAGE_SIZES = [20, 100, 500, 1000];
export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = PAGE_SIZES[PAGE_SIZES.length - 1];

// Snap ?limit= onto the page-size options so a hand-typed value can't dump every row on one page.
export function getPageSize(params: URLSearchParams): number {
  const limit = parseNumberFromUrlParam(params, "limit", DEFAULT_PAGE_SIZE);
  if (!Number.isFinite(limit) || limit < 1) return DEFAULT_PAGE_SIZE;
  return PAGE_SIZES.find((size) => size >= limit) ?? MAX_PAGE_SIZE;
}

export function getPageOffset(params: URLSearchParams): number {
  return Math.max(0, parseNumberFromUrlParam(params, "offset", 0));
}
