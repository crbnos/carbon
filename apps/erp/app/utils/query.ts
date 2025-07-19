import { badRequest, parseNumberFromUrlParam } from "@carbon/auth";
import type { PostgrestFilterBuilder } from "@supabase/postgrest-js";
import type { GenericSchema } from "@supabase/supabase-js/dist/module/lib/types";

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
  const limit = parseNumberFromUrlParam(params, "limit", 100);
  const offset = parseNumberFromUrlParam(params, "offset", 0);

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
      return query.contains(column, value.split(","));
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
  query: PostgrestFilterBuilder<T, U, V>,
  args: Partial<GenericQueryFilters>,
  defaultSorts?: { column: string; ascending: boolean; foreignTable?: string }[]
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
          ascending: sort.sortAsc,
        });
      } else {
        query = query.order(sort.sortBy, { ascending: sort.sortAsc });
      }
    });
  } else if (defaultSorts && defaultSorts?.length > 0) {
    defaultSorts.forEach((sort) => {
      query = query.order(sort.column, {
        ascending: sort.ascending,
        foreignTable: sort.foreignTable,
      });
    });
  }

  if (Number.isInteger(args.offset) && Number.isInteger(args.limit)) {
    query = query.range(args.offset!, args.offset! + args.limit! - 1);
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
  startsWith: "starts with",
};

export const filterOperatorLabels = Object.entries(filterOperators).map(
  ([key, value]) => ({
    operator: key,
    label: value,
  })
);
