// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// No imports on purpose: a service module (`accounting.server.ts`) returns a
// failed page without loading the list registry, which reaches every module.

/** The `listError` of a failed later page. The Table does not show it. */
export const LOAD_MORE_ERROR = "Failed to load more rows";

/**
 * The loader data of a later page (`?after=`) that failed, for a list loader
 * that does not use `loadListPage`: `{ [dataKey]: [], count: 0,
 * nextCursor: null, listError }`. Log the real error first, then
 * `return listErrorPage(dataKey)`.
 *
 * Typed `never` so the loader's data type stays the page-1 shape that
 * `useLoaderData` reads: only the Table's fetcher reads a later page.
 */
export function listErrorPage(dataKey: string): never {
  return {
    [dataKey]: [],
    count: 0,
    nextCursor: null,
    listError: LOAD_MORE_ERROR
  } as never;
}
