// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { requirePermissions } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Cursor, Paging } from "../cursor";
import { decodeCursor, toPage } from "../cursor";
import { PAGE_SIZE } from "../pagination";
import type { Filter, Sort } from "../query";
import { getGenericQueryFilters } from "../query";
import { accountingLists } from "./accounting.server";
import { documentsLists } from "./documents.server";
import { inventoryLists } from "./inventory.server";
import { invoicingLists } from "./invoicing.server";
import { itemsLists } from "./items.server";
import { peopleLists } from "./people.server";
import { productionLists } from "./production.server";
import { purchasingLists } from "./purchasing.server";
import { qualityLists } from "./quality.server";
import { resourcesLists } from "./resources.server";
import { salesLists } from "./sales.server";
import { settingsLists } from "./settings.server";
import { usersLists } from "./users.server";
import { workflowsLists } from "./workflows.server";

/**
 * The server's list of paged ERP lists. One entry holds the query a list's
 * loader runs, so the loader and the background jobs (export, bulk action)
 * read the same rows with the same filters, sorts and permission.
 *
 * Each module keeps its entries in its own file (`sales.server.ts`, …), so
 * module batches can add entries without touching the same file.
 */

/** Which page to read: `limit` rows after `cursor` (null: the first page). */
export type ListPaging = { limit: number; cursor: Cursor | null };

export type ListPermission = Omit<
  Parameters<typeof requirePermissions>[1],
  "bypassRls"
>;

export type ListQueryResult<TRow> = {
  data: TRow[] | null;
  error: unknown;
  count?: number | null;
};

/**
 * What a list's `query` gets, parsed once by `fetchListPage`: the URL search,
 * the page, and the user's sorts and filters (`getGenericQueryFilters`).
 */
export type ListQueryContext = ListPaging & {
  /** The URL search: `search` and the list's own params (`status`, …). */
  params: URLSearchParams;
  sorts: Sort[];
  filters: Filter[];
  /**
   * The company's group, when the caller already has it (a loader's
   * `requirePermissions`). A group-scoped list reads it with
   * `resolveCompanyGroupId`, which looks it up only when it is absent.
   */
  companyGroupId?: string;
};

export type ListRowsContext = {
  client: SupabaseClient<Database>;
  companyId: string;
};

export type ListDefinition<
  TRow extends Record<string, unknown> = Record<string, unknown>
> = Paging & {
  /** The list's key, for example "sales-orders". */
  key: string;
  /** The loader's permission check, without `bypassRls`. */
  permission: ListPermission;
  /** The loader's query for one page. */
  query: (
    client: SupabaseClient<Database>,
    companyId: string,
    context: ListQueryContext
  ) => PromiseLike<ListQueryResult<TRow>>;
  /**
   * The rows of one page as the background CSV export writes them, for a list
   * whose loader adds per-row values (`mapRows`) that columns export: the same
   * lookup, then each such column's export value under its column key. The
   * export job reads `row[key]` and runs no column code.
   */
  exportRows?(
    rows: TRow[],
    context: ListRowsContext
  ): Promise<Record<string, unknown>[]>;
};

export type ListPage<TRow> = {
  rows: TRow[];
  /** The number of matching rows. Only the first page counts (0 later). */
  count: number;
  nextCursor: string | null;
  error: unknown;
};

// One file per module. A module batch adds its entries to its own file only.
export const LIST_REGISTRY: Record<string, ListDefinition> = {
  ...accountingLists,
  ...documentsLists,
  ...inventoryLists,
  ...invoicingLists,
  ...itemsLists,
  ...peopleLists,
  ...productionLists,
  ...purchasingLists,
  ...qualityLists,
  ...resourcesLists,
  ...salesLists,
  ...settingsLists,
  ...usersLists,
  ...workflowsLists
};

export function getListDefinition(key: string): ListDefinition | undefined {
  return Object.hasOwn(LIST_REGISTRY, key) ? LIST_REGISTRY[key] : undefined;
}

/**
 * Runs a list's query for one page and cuts it with `toPage`. Without
 * `paging`, the page is the one the URL asks for: 100 rows after `?after=`.
 * `options.companyGroupId` saves a group lookup for group-scoped lists.
 */
export async function fetchListPage<TRow extends Record<string, unknown>>(
  definition: ListDefinition<TRow>,
  client: SupabaseClient<Database>,
  companyId: string,
  params: URLSearchParams,
  paging: ListPaging = {
    limit: PAGE_SIZE,
    cursor: decodeCursor(params.get("after"))
  },
  options: { companyGroupId?: string } = {}
): Promise<ListPage<TRow>> {
  const { sorts = [], filters = [] } = getGenericQueryFilters(params);
  const result = await definition.query(client, companyId, {
    ...paging,
    params,
    sorts,
    filters,
    companyGroupId: options.companyGroupId
  });
  const page = toPage(
    result.data ?? [],
    { limit: paging.limit, sorts },
    definition
  );
  return {
    rows: page.rows,
    count: result.count ?? 0,
    nextCursor: page.nextCursor,
    error: result.error
  };
}

/**
 * The company's group for a group-scoped list (dimensions, intercompany):
 * the caller's when it passed one, else read from the company.
 */
export async function resolveCompanyGroupId(
  client: SupabaseClient<Database>,
  companyId: string,
  context: Pick<ListQueryContext, "companyGroupId">
): Promise<{ companyGroupId: string | null; error: unknown }> {
  if (context.companyGroupId) {
    return { companyGroupId: context.companyGroupId, error: null };
  }
  const company = await client
    .from("company")
    .select("companyGroupId")
    .eq("id", companyId)
    .single();
  return {
    companyGroupId: company.data?.companyGroupId ?? null,
    error: company.error
  };
}

/** A URL param the list passes to its service: its name, or a reader. */
type ParamReader = string | ((params: URLSearchParams) => unknown);

/**
 * A list whose service takes `(client, companyId, args)` and reads the
 * common args: the service gets `{ search, ...params, limit, cursor, sorts,
 * filters }`. `search` is `params.get("search")`; each entry of `params`
 * names a URL param (passed as `string | null`) or reads one itself.
 *
 * ```ts
 * export const salesOrdersList = searchList({
 *   key: "sales-orders",
 *   permission: { view: "sales" },
 *   paging: SALES_ORDERS_PAGING,
 *   service: getSalesOrders,
 *   params: { status: "status", customerId: "customerId" }
 * });
 * ```
 *
 * A list with another service shape (a group id, a positional arg, two
 * services) writes its own `query`.
 */
export function searchList<TRow extends Record<string, unknown>, TArgs>({
  key,
  permission,
  paging,
  service,
  params: readers = {},
  exportRows
}: {
  key: string;
  permission: ListPermission;
  paging: Paging;
  service: (
    client: SupabaseClient<Database>,
    companyId: string,
    args: TArgs
  ) => PromiseLike<ListQueryResult<TRow>>;
  params?: Record<string, ParamReader>;
  exportRows?: ListDefinition<TRow>["exportRows"];
}): ListDefinition<TRow> {
  return {
    key,
    permission,
    ...paging,
    ...(exportRows ? { exportRows } : {}),
    query: (client, companyId, { params, limit, cursor, sorts, filters }) => {
      const named: Record<string, unknown> = { search: params.get("search") };
      for (const [arg, reader] of Object.entries(readers)) {
        named[arg] =
          typeof reader === "string" ? params.get(reader) : reader(params);
      }
      return service(client, companyId, {
        ...named,
        limit,
        cursor,
        sorts,
        filters
      } as TArgs);
    }
  };
}
