// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Memory and pure helpers for `useInfiniteRows`.
 *
 * A list unmounts when the user opens a record (the record page is outside the
 * list route), so the loaded rows cannot live in component state. This module
 * keeps them per company, list and URL for the Back button, in memory only: a
 * page reload clears it, and so does a switch to another company.
 */

/** At most this many pages stay loaded after a revalidation (2,000 rows). */
export const MAX_REFRESH_PAGES = 20;

/**
 * The browser loads at most this many rows for "Select all matching" and the
 * CSV export. Past it, a list with a `listKey` hands the work to a job.
 */
export const BROWSER_ROW_LIMIT = 1000;

/**
 * Below this many rows the list's count is exact. From it up, `LIST_COUNT` is
 * an estimate: `useExactCount` asks for the exact count after page 1, and the
 * copy says "about" until it arrives.
 */
export const EXACT_COUNT_LIMIT = 1000;

/** The next page starts to load when the user is this close to the end. */
export const PREFETCH_DISTANCE = 600;

const MAX_ENTRIES = 10;

/** One page loaded after page 1, and the cursor after its last row. */
export type InfinitePage<T = unknown> = {
  rows: T[];
  nextCursor: string | null;
};

export type InfiniteRowsEntry = {
  /** The pages loaded after page 1. The loader always returns page 1. */
  pages: InfinitePage[];
  scrollTop: number;
};

const entries = new Map<string, InfiniteRowsEntry>();
let entriesCompanyId: string | undefined;

// The entries belong to one company. Another company's list must never be
// restored, so a new company empties the memory first.
function claimForCompany(companyId: string | undefined) {
  if (companyId === entriesCompanyId) return;
  entries.clear();
  entriesCompanyId = companyId;
}

/** The memory key of one list query: company, rows key and URL. */
export function getStoreKey({
  companyId,
  dataKey,
  pageUrl,
  ignoreParams
}: {
  companyId: string | undefined;
  dataKey: string;
  pageUrl: string;
  ignoreParams?: readonly string[];
}): string {
  const [pathname, search = ""] = pageUrl.split("?");
  return [
    companyId ?? "",
    dataKey,
    `${pathname}?${getSearchKey(search, ignoreParams)}`
  ].join("\n");
}

/** Saves at most `MAX_REFRESH_PAGES` pages: a revalidation re-reads no more. */
export function saveInfiniteRows(
  companyId: string | undefined,
  key: string,
  entry: InfiniteRowsEntry
) {
  claimForCompany(companyId);
  // Re-inserting moves the key to the end, so the oldest save is dropped first.
  entries.delete(key);
  entries.set(key, {
    ...entry,
    pages: entry.pages.slice(0, getRefreshPageCount(entry.pages.length))
  });
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

export function getInfiniteRows(
  companyId: string | undefined,
  key: string
): InfiniteRowsEntry | undefined {
  claimForCompany(companyId);
  return entries.get(key);
}

export function clearInfiniteRows() {
  entries.clear();
  entriesCompanyId = undefined;
}

/**
 * The URL search without `after` and `ignoreParams`: the identity of one list
 * query. `ignoreParams` are the params that do not change the list, for
 * example the one that opens a drawer over it.
 */
export function getSearchKey(
  search: string,
  ignoreParams?: readonly string[]
): string {
  const params = new URLSearchParams(search);
  params.delete("after");
  for (const param of ignoreParams ?? []) params.delete(param);
  params.sort();
  return params.toString();
}

/**
 * The list's reset key: the page's URL search, plus the search of `pageUrl`
 * when the pages come from another endpoint. A new key drops the loaded pages.
 */
export function getResetKey(
  search: string,
  pageUrl: string | undefined,
  ignoreParams?: readonly string[]
): string {
  const key = getSearchKey(search, ignoreParams);
  if (!pageUrl) return key;
  const [pathname, pageSearch = ""] = pageUrl.split("?");
  return `${key}\n${pathname}?${getSearchKey(pageSearch, ignoreParams)}`;
}

/**
 * The URL of the next page: the list route's own URL (with `?index` for an
 * index route) with `after` set to the cursor.
 */
export function getPageUrl(routeUrl: string, cursor: string): string {
  const [pathname, search = ""] = routeUrl.split("?");
  const params = new URLSearchParams(search);
  params.delete("after");
  params.set("after", cursor);
  // `index=` still reads as the naked `?index` React Router looks for.
  return `${pathname}?${params.toString()}`;
}

/**
 * The URL of the list's exact count (`useExactCount`): the list route's own
 * URL with `count=exact` in place of `after`.
 */
export function getCountUrl(routeUrl: string): string {
  const [pathname, search = ""] = routeUrl.split("?");
  const params = new URLSearchParams(search);
  params.delete("after");
  params.set("count", "exact");
  return `${pathname}?${params.toString()}`;
}

/** How many loaded pages after page 1 a revalidation fetches again. */
export function getRefreshPageCount(loadedPages: number): number {
  return Math.max(0, Math.min(loadedPages, MAX_REFRESH_PAGES - 1));
}

/** The row's id in `idColumn` (default `id`), when it has one. */
export function readRowId(row: unknown, idColumn = "id"): string | undefined {
  if (!row || typeof row !== "object" || !(idColumn in row)) return undefined;
  const id = (row as Record<string, unknown>)[idColumn];
  return id === null || id === undefined ? undefined : String(id);
}

/**
 * Page 1 followed by the later rows, without a row twice. A row moves between
 * pages when other rows are added or deleted; page 1 is the newest copy.
 */
export function mergeRows<T>(
  firstPage: T[],
  laterRows: T[],
  getRowId?: (row: T) => string | undefined
): T[] {
  if (laterRows.length === 0) return firstPage;
  if (!getRowId) return [...firstPage, ...laterRows];

  const seen = new Set<string>();
  for (const row of firstPage) {
    const id = getRowId(row);
    if (id !== undefined) seen.add(id);
  }
  const merged = [...firstPage];
  for (const row of laterRows) {
    const id = getRowId(row);
    if (id !== undefined) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    merged.push(row);
  }
  return merged;
}

export type PageResult<T> =
  | {
      status: "ok";
      rows: T[];
      nextCursor: string | null;
    }
  | { status: "error" }
  | { status: "aborted" };

/**
 * Reads one fetched page from the fetcher's data. It is an error when:
 * - the data is still the object seen before the request (a loader that
 *   threw leaves no new data: the router drops the fetcher and shows the
 *   route's error screen, so `loadListPage` turns a later page's throw into
 *   `listError`),
 * - the loader returned `listError` (`InfiniteListError`),
 * - the data has no rows array.
 *
 * A `nextCursor` equal to the cursor just requested would load the same page
 * again forever, so the list ends there.
 */
export function readPage<T>(
  data: unknown,
  dataAtStart: unknown,
  dataKey: string | undefined,
  requestedCursor?: string
): PageResult<T> {
  if (!dataKey || !data || typeof data !== "object" || data === dataAtStart) {
    return { status: "error" };
  }
  const record = data as Record<string, unknown>;
  if (typeof record.listError === "string") return { status: "error" };
  const rows = record[dataKey];
  if (!Array.isArray(rows)) return { status: "error" };
  const nextCursor =
    typeof record.nextCursor === "string" &&
    record.nextCursor !== requestedCursor
      ? record.nextCursor
      : null;
  return { status: "ok", rows: rows as T[], nextCursor };
}
