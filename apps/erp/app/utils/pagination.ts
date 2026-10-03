// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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

// PostgREST's `estimated` count is exact up to max-rows (config.toml) and a
// planner estimate above it.
const MAX_EXACT_COUNT = 1000;

// An estimate can run low, so past the exact range the rows returned decide
// whether a next page exists.
export function pageBounds(args: {
  count: number;
  offset: number;
  pageSize: number;
  rowsOnPage: number;
}) {
  const seen = args.offset + args.rowsOnPage;
  const atExactEnd = args.count <= MAX_EXACT_COUNT && seen === args.count;
  return {
    canNextPage: args.rowsOnPage >= args.pageSize && !atExactEnd,
    count: Math.max(args.count, seen)
  };
}
