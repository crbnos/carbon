import { badRequest } from "@carbon/auth";
import type { PostgrestFilterBuilder } from "@supabase/postgrest-js";
import type { GenericSchema } from "@supabase/supabase-js/dist/module/lib/types";
import { getPageOffset, getPageSize } from "./pagination";

/**
 * Count mode for the paged list endpoints backed by the big multi-join views
 * (`parts`, `materials`, `salesOrders`, `purchaseOrders`, the invoice views…).
 *
 * PostgREST implements `exact` as `COUNT(*) OVER ()`, which makes Postgres
 * materialize the entire filtered result set purely to produce a total — so
 * `.range()` pagination limits what is transferred but not what is computed.
 *
 * `estimated` is a hybrid, not a blind guess: PostgREST still returns an exact
 * count when the planner's estimate is under `max-rows`, and only falls back to
 * the estimate for result sets far larger than any page a user is reading. The
 * totals stay accurate at the sizes where being off by a few would be visible.
 *
 * These endpoints also pair it with an explicit `*_LIST_COLUMNS` constant rather
 * than `select("*")`, for the same reason: naming the columns lets Postgres
 * prune the views' unreferenced computed columns instead of materializing them
 * per row. Adding a column to one of those tables means adding it to the
 * constant — `apps/erp/test/list-select-columns.test.ts` fails if an
 * `accessorKey` is missing, because the CSV export reads accessors untyped.
 */
export const LIST_COUNT = "estimated" as const;

export type Sort = {
  sortBy: string;
  sortAsc: boolean;
};

export type Filter = {
  column: string;
  operator: string;
  value?: string;
};

export interface GenericQueryFilters {
  limit: number;
  offset: number;
  sorts?: Sort[];
  filters?: Filter[];
}

export function getGenericQueryFilters(
  params: URLSearchParams
): GenericQueryFilters {
  const limit = getPageSize(params);
  const offset = getPageOffset(params);

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

  return { limit, offset, sorts, filters };
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
    default:
      throw badRequest(`Invalid filter operator: ${operator}`);
  }
}

export function setGenericQueryFilters<
  T extends GenericSchema,
  U extends Record<string, unknown>,
  V
>(
  // @ts-expect-error TS2707 - TODO: fix type
  query: PostgrestFilterBuilder<T, U, V>,
  args: Partial<GenericQueryFilters>,
  defaultSorts?: { column: string; ascending: boolean; foreignTable?: string }[]
  // @ts-expect-error TS2707 - TODO: fix type
): PostgrestFilterBuilder<T, U, V> {
  args.filters?.forEach((filter) => {
    if (!filter.value) return;
    query = getGenericFilter(
      query,
      filter.column,
      filter.operator,
      filter.value
    );
  });

  if (args.sorts && args.sorts.length > 0) {
    args.sorts.forEach((sort) => {
      if (sort.sortBy.includes(".")) {
        const [table, column] = sort.sortBy.split(".");
        query = query.order(`${table}(${column})`, {
          ascending: sort.sortAsc
        });
      } else {
        query = query.order(sort.sortBy, { ascending: sort.sortAsc });
      }
    });
  } else if (defaultSorts && defaultSorts?.length > 0) {
    defaultSorts.forEach((sort) => {
      query = query.order(sort.column, {
        ascending: sort.ascending,
        foreignTable: sort.foreignTable
      });
    });
  }

  if (Number.isInteger(args.offset) && Number.isInteger(args.limit)) {
    query = query.range(args.offset!, args.offset! + args.limit! - 1);
  }

  return query;
}

export function getSearchTokens(search: string): string[] {
  // Strip characters that are structural in a PostgREST `.or(...)` filter
  // (comma separates conditions, parens group them) so the search value can't
  // alter the filter shape.
  return search
    .replace(/[,()\\]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * The same token-AND match as `setSearchFilter`, as one PostgREST condition
 * (`and(or(a.ilike.%t1%,b.ilike.%t1%),or(…t2…))`) for a service that must OR
 * it with other conditions, e.g. pre-resolved `fkId.in.(…)` lists for a search
 * that spans parent and embedded columns. Null when the search has no tokens.
 */
export function searchCondition(
  search: string | null | undefined,
  columns: string[]
): string | null {
  const tokens = search ? getSearchTokens(search) : [];
  if (tokens.length === 0) return null;
  return `and(${tokens
    .map(
      (token) =>
        `or(${columns.map((column) => `${column}.ilike.%${token}%`).join(",")})`
    )
    .join(",")})`;
}

/**
 * The one way a list service applies free-text search: strips the characters
 * that are structural in a PostgREST `.or(...)` filter, splits the rest into
 * tokens, and requires every token to match at least one of `columns`. Never
 * interpolate a search value into `.or(...)` by hand (the `no-raw-or-filter`
 * conformance check fails it): a comma or parenthesis in it breaks the filter.
 *
 * `referencedTable` searches columns of ONE embedded resource instead of the
 * parent's. The embed must be selected `!inner` (`"*, embed!inner(col)"`) or
 * rows whose embed does not match come back with the embed nulled instead of
 * being dropped. A search across a parent column AND an embedded column cannot
 * be one `.or()`: use a view column, or resolve the embedded matches to ids
 * first and OR `fkId.in.(ids)` with the parent columns.
 */
export function setSearchFilter<
  T extends GenericSchema,
  U extends Record<string, unknown>,
  V
>(
  // @ts-expect-error TS2707 - TODO: fix type
  query: PostgrestFilterBuilder<T, U, V>,
  search: string | null | undefined,
  columns: string[],
  options?: { referencedTable?: string }
  // @ts-expect-error TS2707 - TODO: fix type
): PostgrestFilterBuilder<T, U, V> {
  if (!search) return query;

  // Each token must match at least one column, and all tokens must match, so
  // "M8 washer" finds "Washer, Flat, M8". Chained `.or(...)` calls are ANDed.
  for (const token of getSearchTokens(search)) {
    const condition = columns
      .map((column) => `${column}.ilike.%${token}%`)
      .join(",");
    query = options?.referencedTable
      ? query.or(condition, { referencedTable: options.referencedTable })
      : query.or(condition);
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
