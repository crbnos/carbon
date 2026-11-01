// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { badRequest } from "@carbon/auth";
import { searchFilter } from "@carbon/utils";
import type { PostgrestFilterBuilder } from "@supabase/postgrest-js";
import type { Cursor, DefaultSort, KeysetSort, Paging, Sort } from "./cursor";
import {
  buildKeysetFilter,
  cursorMatchesSorts,
  decodeCursor,
  resolveSorts
} from "./cursor";
import { PAGE_SIZE } from "./pagination";

export type { DefaultSort, Paging, Sort } from "./cursor";

type GenericSchema = {
  Tables: Record<string, unknown>;
  Views: Record<string, unknown>;
  Functions: Record<string, unknown>;
};

/**
 * Count mode for every paged list endpoint — any query that goes through
 * `setGenericQueryFilters`. Counts that drive logic rather than a pager
 * (`head: true`, limits, "is this in use?") stay `exact`.
 *
 * PostgREST implements `exact` as `COUNT(*) OVER ()`, which makes Postgres
 * materialize the entire filtered result set purely to produce a total — so
 * `.limit()` paging limits what is transferred but not what is computed.
 *
 * `estimated` is a hybrid, not a blind guess: PostgREST still returns an exact
 * count when the planner's estimate is under `max-rows`, and only falls back to
 * the estimate for result sets far larger than any page a user is reading. The
 * totals stay accurate at the sizes where being off by a few would be visible.
 *
 * The big multi-join views (`parts`, `materials`, `salesOrders`,
 * `purchaseOrders`, the invoice views…) also pair it with an explicit `*_LIST_COLUMNS` constant rather
 * than `select("*")`, for the same reason: naming the columns lets Postgres
 * prune the views' unreferenced computed columns instead of materializing them
 * per row. Adding a column to one of those tables means adding it to the
 * constant — the `list-select-covers-columns` check (`@carbon/checks`) fails
 * if an `accessorKey` is missing, because the CSV export reads accessors untyped.
 */
export const LIST_COUNT = "estimated" as const;

/**
 * The count mode of a list query: none on a later page, `exact` for the
 * Table's count request (`?count=exact`), else `LIST_COUNT`.
 */
export function listCount(
  args?: Pick<GenericQueryFilters, "cursor" | "exactCount">
) {
  if (args?.exactCount) return "exact" as const;
  return args?.cursor ? undefined : LIST_COUNT;
}

export type Filter = {
  column: string;
  operator: string;
  value?: string;
};

export interface GenericQueryFilters {
  limit: number;
  /**
   * The last row of the previous page (`?after=`); null on the first page.
   * Set (even to null) by every list loader: it turns on cursor paging.
   */
  cursor?: Cursor | null;
  /**
   * Offset paging for callers outside the list pages: the MCP server and the
   * v1 API publish `limit` + `offset` for every `GenericQueryFilters` service
   * (`scripts/lib/service-metadata.ts`). Used only when `cursor` is absent.
   */
  offset?: number;
  /**
   * The Table's count request (`?count=exact`): an exact count and one row.
   * `LIST_COUNT` is an estimate from 1,000 rows up.
   */
  exactCount?: boolean;
  sorts?: Sort[];
  filters?: Filter[];
}

export function getGenericQueryFilters(
  params: URLSearchParams
): GenericQueryFilters {
  const limit = PAGE_SIZE;
  const exactCount = params.get("count") === "exact";
  const cursor = exactCount ? null : decodeCursor(params.get("after"));

  const sortParams = params.getAll("sort");
  const sorts: Sort[] =
    sortParams.length > 0
      ? (sortParams
          .map((sort) => {
            const [sortBy, sortDirection] = sort.split(":");
            if (
              !sortBy ||
              !sortDirection ||
              !["asc", "desc"].includes(sortDirection)
            )
              return undefined;
            return { sortBy, sortAsc: sortDirection === "asc" };
          })
          .filter((sort) => sort !== undefined) as Sort[])
      : [];

  const filterParams = params.getAll("filter");
  const filters: Filter[] =
    filterParams.length > 0
      ? (filterParams
          .map((filter) => {
            const [column, operator, value] = filter.split(":");
            if (!column || !operator || !value) return undefined;
            return { column, operator, value };
          })
          .filter((filter) => filter !== undefined) as Filter[])
      : [];

  return {
    limit,
    cursor,
    sorts,
    filters,
    ...(exactCount ? { exactCount } : {})
  };
}

/**
 * Value of a `between` filter: `from,to`, inclusive. Either side may be empty
 * for an open-ended range (`2026-10-01,` is "on or after").
 */
export function parseRangeFilter(value: string): {
  from: string | null;
  to: string | null;
} {
  const [from, to] = value.split(",");
  return { from: from || null, to: to || null };
}

/** Inverse of `parseRangeFilter`; null when neither bound is set. */
export function formatRangeFilter(
  from: string | null | undefined,
  to: string | null | undefined
): string | null {
  if (!from && !to) return null;
  return `${from ?? ""},${to ?? ""}`;
}

export function getGenericFilter<
  T extends GenericSchema,
  U extends Record<string, unknown>,
  V
>(
  // @ts-expect-error TS2707 - TODO: fix type
  query: PostgrestFilterBuilder<T, U, V>,
  column: string,
  operator: string,
  value: string
) {
  switch (operator) {
    case "eq":
      return query.eq(column, value as any);
    case "neq":
      return query.neq(column, value as any);
    case "gt":
      return query.gt(column, getSafeNumber(value));
    case "gte":
      return query.gte(column, getSafeNumber(value));
    case "lt":
      return query.lt(column, getSafeNumber(value));
    case "lte":
      return query.lte(column, getSafeNumber(value));
    case "contains":
      return query.overlaps(column, value.split(","));
    case "startsWith":
      return query.ilike(column, `${value}%`);
    case "in":
      return query.in(column, value.split(",") as any);
    case "between": {
      const { from, to } = parseRangeFilter(value);
      if (from) query = query.gte(column, getSafeNumber(from));
      if (to) query = query.lte(column, getSafeNumber(to));
      return query;
    }
    default:
      throw badRequest(`Invalid filter operator: ${operator}`);
  }
}

function toPaging(paging: Paging | DefaultSort[] | undefined): Paging {
  if (!paging) return { defaultSorts: [] };
  return Array.isArray(paging) ? { defaultSorts: paging } : paging;
}

/**
 * The sorts the cursor follows for these args. Loaders pass the result to
 * `toPage` so the cursor reads the same columns the query orders by.
 */
export function getEffectiveSorts(
  args: Pick<Partial<GenericQueryFilters>, "sorts">,
  paging?: Paging | DefaultSort[]
): KeysetSort[] {
  return resolveSorts(args.sorts, toPaging(paging).defaultSorts).keyset;
}

/**
 * Applies the filters, the order and the page to a list query.
 *
 * - `paging` is the list's `X_PAGING` (a bare `DefaultSort[]` still works for
 *   a query that is not a paged list).
 * - With `args.cursor` set (even to null), it pages by cursor: the keyset
 *   filter after the cursor, and `limit + 1` rows for `toPage`. A cursor cut
 *   for another order (a hand-edited URL, a sort changed mid-request) gives an
 *   empty page, so the list ends rather than restarting at page 1.
 * - Without `args.cursor`, it pages by `offset` + `limit` (MCP, v1 API).
 */
export function setGenericQueryFilters<
  T extends GenericSchema,
  U extends Record<string, unknown>,
  V
>(
  // @ts-expect-error TS2707 - TODO: fix type
  query: PostgrestFilterBuilder<T, U, V>,
  args: Partial<GenericQueryFilters>,
  paging?: Paging | DefaultSort[]
  // @ts-expect-error TS2707 - TODO: fix type
): PostgrestFilterBuilder<T, U, V> {
  const { defaultSorts, idColumn = "id" } = toPaging(paging);

  args.filters?.forEach((filter) => {
    if (!filter.value) return;
    query = getGenericFilter(
      query,
      filter.column,
      filter.operator,
      filter.value
    );
  });

  const { orders, keyset } = resolveSorts(args.sorts, defaultSorts);

  if (args.cursor) {
    query = query.or(
      cursorMatchesSorts(args.cursor, keyset)
        ? buildKeysetFilter(keyset, args.cursor, idColumn)
        : // No row: the id is never both null and not null.
          `and(${idColumn}.is.null,${idColumn}.not.is.null)`
    );
  }

  orders.forEach((sort) => {
    query = query.order(sort.column, {
      ascending: sort.ascending,
      foreignTable: sort.foreignTable
    });
  });

  // The id breaks ties, so the order is total and every row has one place.
  // A query nothing orders keeps its own order (an RPC's ORDER BY), unless
  // it pages by cursor, which needs the id order.
  const ordered = orders.length > 0 || args.cursor !== undefined;
  if (ordered && keyset[keyset.length - 1]?.column !== idColumn) {
    query = query.order(idColumn, { ascending: true });
  }

  if (args.cursor !== undefined) {
    // Cursor paging (list loaders). One extra row tells `toPage` that a next
    // page exists. A count request needs no rows.
    if (args.exactCount) {
      query = query.limit(1);
    } else if (typeof args.limit === "number") {
      query = query.limit(args.limit + 1);
    }
  } else if (Number.isInteger(args.offset) && Number.isInteger(args.limit)) {
    // Offset paging (MCP, v1 API): the exact page, as before cursor paging.
    query = query.range(args.offset!, args.offset! + args.limit! - 1);
  }

  return query;
}

export function getSearchTokens(search: string): string[] {
  // Commas and parentheses separate words, as spaces do ("Washer, Flat").
  return search
    .replace(/[,()\\]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function setSearchFilter<
  T extends GenericSchema,
  U extends Record<string, unknown>,
  V
>(
  // @ts-expect-error TS2707 - TODO: fix type
  query: PostgrestFilterBuilder<T, U, V>,
  search: string | null | undefined,
  columns: string[]
  // @ts-expect-error TS2707 - TODO: fix type
): PostgrestFilterBuilder<T, U, V> {
  if (!search) return query;

  // Each token must match at least one column, and all tokens must match, so
  // "M8 washer" finds "Washer, Flat, M8". Chained `.or(...)` calls are ANDed.
  for (const token of getSearchTokens(search)) {
    query = query.or(searchFilter(columns, token));
  }

  return query;
}

const getSafeNumber = (value: string) => {
  const number = Number(value);
  return Number.isNaN(number) ? value : number;
};

const filterOperators = {
  eq: "equals",
  neq: "not equals",
  gt: "greater than",
  gte: "greater than or equal to",
  lt: "less than",
  lte: "less than or equal to",
  contains: "contains",
  startsWith: "starts with"
};

export const filterOperatorLabels = Object.entries(filterOperators).map(
  ([key, value]) => ({
    operator: key,
    label: value
  })
);

// Array values sort by their first entry.
export function pageInMemory<T extends Record<string, unknown>>(
  rows: T[],
  searchParams: URLSearchParams,
  searchable: (row: T) => (string | null | undefined)[]
): { rows: T[]; count: number } {
  const search = searchParams.get("search")?.trim().toLowerCase() ?? "";
  const { sorts } = getGenericQueryFilters(searchParams);
  // The drawers that use this have no pager: without `limit` every match is
  // one page (the Table renders only the rows in view).
  const offset = Math.max(0, Number(searchParams.get("offset")) || 0);
  const requestedLimit = Number(searchParams.get("limit"));

  const matching = search
    ? rows.filter((row) =>
        searchable(row).some((value) =>
          (value ?? "").toLowerCase().includes(search)
        )
      )
    : [...rows];

  const sortValue = (row: T, key: string) => {
    const value = row[key];
    return Array.isArray(value) ? value[0] : value;
  };
  for (const { sortBy, sortAsc } of [...(sorts ?? [])].reverse()) {
    matching.sort((a, b) => {
      const left = sortValue(a, sortBy);
      const right = sortValue(b, sortBy);
      const order =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left ?? "").localeCompare(String(right ?? ""), undefined, {
              numeric: true
            });
      return sortAsc ? order : -order;
    });
  }

  return {
    rows: matching.slice(
      offset,
      requestedLimit > 0 ? offset + requestedLimit : undefined
    ),
    count: matching.length
  };
}
