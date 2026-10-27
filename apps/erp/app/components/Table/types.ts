// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import "@tanstack/react-table";
import type { CellContext } from "@tanstack/react-table";
import type { ReactElement, ReactNode } from "react";
import type { ColumnFilterData } from "./components/Filter/types";

declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends unknown, TValue> {
    filter?: ColumnFilterData;
    // Filter dropdown/chip label when `header` is JSX instead of a string.
    filterHeader?: string;
    pluralHeader?: string;
    // Extra classes for the header content wrapper (e.g. "justify-center" to
    // center a header). Defaults to left-aligned (`justify-start`).
    headerClassName?: string;
    icon?: ReactElement;
    renderTotal?: boolean;
    formatter?: (
      val:
        | number
        | bigint
        | `${number}`
        | "Infinity"
        | "-Infinity"
        | "+Infinity"
    ) => string;
    // CSV value for this column, given the full row. Overrides the raw-accessor
    // read in Download.tsx. Use when the displayed value is derived/composite, or
    // when the accessorKey is an id whose name lives in another row field.
    exportValue?: (row: TData) => string | number | boolean | null | undefined;
    // Export-only column: never rendered in the grid (Table force-hides it), but
    // still emitted to the CSV via `exportValue`. Use for values that belong in
    // the export but not the on-screen table (e.g. a tokenized download link).
    // Pair with `filterHeader` to supply the CSV heading, since `header` is
    // typically left blank to keep the column out of the column-visibility menu.
    exportOnly?: boolean;
    // Server-sort column override. When set, the sort UI writes `?sort=<sortBy>:dir`
    // instead of using the accessorKey. Use when a column must sort by a different
    // field than its accessor (e.g. accessor `supplierTypeId`, sort by `type`).
    // Must name a real column on the view.
    sortBy?: string;
    // Phone list priority: P1 = identity (line 1), P2 = trailing metric
    // or status pill, P3 = context (line 2); P4 or unset = not in the row.
    // "action" = the row's one trailing button (e.g. "Make 90"), hidden in
    // selection mode. See Table/components/Compact/resolveSlots.ts.
    mobile?: "P1" | "P2" | "P3" | "P4" | "action";
    /** Phones: show this P2 column as a status pill on line 3 (a status column without a static filter). */
    mobilePill?: boolean;
    /** Phones: lead this column's value with its (string) header, since a
     *  list row shows no column headers. */
    mobileLabel?: boolean;
    /** Phones: renders this column in the list row instead of `cell`. */
    mobileCell?: (context: CellContext<TData, TValue>) => ReactNode;
  }
}

export type ColumnSizeMap = Map<string, { width: number; startX: number }>;

/**
 * Turns on infinite scroll for a list whose loader pages with a cursor
 * (`toPage`). The Table fetches the next page from the same route loader.
 *
 * Two ways to use it:
 * - `<Table infinite={options}>`: the Table runs `useInfiniteRows` itself.
 * - Controlled: the parent calls `useInfiniteRows({ initialRows, infinite })`
 *   and passes the result as `<Table data={initialRows} infiniteRows={result}>`.
 *   The parent then reads `result.rows` (every loaded row) with no state copy,
 *   for example to total or plan over them.
 */
export type InfiniteOptions = {
  /** The key of the rows array in the loader data, for example "salesOrders". */
  dataKey: string;
  /** The loader's `nextCursor`: null when page 1 is the whole list. */
  nextCursor: string | null;
  /**
   * The list's key in the server list registry (`utils/list-registry`). Only
   * a registered list gets the background export and bulk-action paths.
   */
  listKey?: string;
  /**
   * URL search params that do not define the list, for example the param
   * that opens a drawer over it. A change of one keeps the loaded pages, the
   * scroll offset and the selection. `after` is always ignored.
   */
  ignoreParams?: string[];
  /**
   * The rows' unique id column when it is not `id`. It de-duplicates rows
   * that move between pages and keys the rows (selection, edits).
   */
  idColumn?: string;
  /**
   * The URL that serves the later pages, with its own search. Default: the
   * list route's own URL (`useFormAction()`). Set it when the rows come from
   * an `api+` loader instead of the route. Its response has the same shape:
   * `{ [dataKey]: rows, nextCursor }`, and `listError` on a failed page.
   */
  pageUrl?: string;
};

/**
 * What a list loader returns, next to its rows key, for a later page
 * (`?after=`) that failed: `{ [dataKey]: [], nextCursor: null, listError }`.
 * The Table then shows "Couldn't load more rows" with Retry, and keeps the
 * rows it has. Page 1 throws (or redirects) as before.
 */
export type InfiniteListError = {
  /** A short message for the log; the Table does not show it. */
  listError: string;
};

/** The state of an infinite list (`useInfiniteRows`). */
export type InfiniteRows<T> = {
  /** Page 1 from the loader, then every page loaded after it. */
  rows: T[];
  hasMore: boolean;
  isLoadingMore: boolean;
  loadError: boolean;
  /**
   * Loads the next page. Does nothing after an error. During a refresh of
   * the loaded pages it waits and loads when the refresh ends.
   */
  loadMore: () => void;
  /** Repeats the request that failed. */
  retry: () => void;
  /**
   * Loads pages until the list ends or `limit` rows are loaded. `resetKey`
   * is the list's key when it ended: a different key than at the start means
   * the list changed while it loaded.
   */
  loadAll: (
    limit: number
  ) => Promise<{ rows: T[]; complete: boolean; resetKey: string }>;
  totalLoaded: number;
  /** The scroll offset to put back after Back navigation, else null. */
  restoredScrollTop: number | null;
  /** The list reports its scroll offset here, so Back can restore it. */
  rememberScrollTop: (scrollTop: number) => void;
  /**
   * The list's identity: the URL search without `after` and `ignoreParams`
   * (and the `pageUrl` search). A new key drops the loaded pages.
   */
  resetKey: string;
  /**
   * The tick (`rowEdits.ts`) when the load of the current rows started. An
   * inline edit made before it is in the rows already.
   */
  syncedAt: number;
  /** The options in use; undefined when infinite scroll is off. */
  options?: InfiniteOptions;
};

/**
 * "Every row that matches the list's URL search": the selection a list makes
 * past 1,000 rows. The browser does not load those rows; a job reads them.
 */
export type AllMatchingSelection = {
  listKey: string;
  /** The list's URL search (`location.search`) when the user chose it. */
  search: string;
  /** The header count then: an estimate from 1,000 rows up. */
  count: number;
};

/** The second argument of `renderActions`. */
export type BulkActionScope = {
  /**
   * Set when the selection is every matching row, not only the selected rows.
   * An action without a background path shows itself disabled with the
   * tooltip from `useAllMatchingUnsupportedLabel`.
   */
  allMatching?: AllMatchingSelection;
};
