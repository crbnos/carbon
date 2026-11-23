// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type {
  InfiniteListError,
  InfiniteOptions
} from "~/components/Table/types";
import type { ListDefinition } from "./index.server";
import { fetchListPage } from "./index.server";
import { listErrorPage } from "./list-error";

export { LOAD_MORE_ERROR, listErrorPage } from "./list-error";

const logger = getLogger("erp", "list-registry");

/** What a list loader has when it reads its page and its page-1 extras. */
export type ListLoaderContext = Awaited<
  ReturnType<typeof requirePermissions>
> & {
  request: Request;
  /** The URL search the list reads. */
  params: URLSearchParams;
};

/** The loader data of a list page: the rows under `dataKey`, the count and
 *  the cursor, plus `listError` on a failed later page. Page 1 also carries
 *  the Table's `infinite` prop, so a table never restates the list's keys. */
export type ListLoaderData<TKey extends string, TRow> = {
  [K in TKey]: TRow[];
} & {
  count: number;
  nextCursor: string | null;
  infinite: InfiniteOptions;
} & Partial<InfiniteListError>;

/** The Table's `infinite` prop for a page of a registered list. */
export function listInfinite(
  list: Pick<ListDefinition, "key" | "idColumn">,
  dataKey: string,
  nextCursor: string | null
): InfiniteOptions {
  return {
    dataKey,
    nextCursor,
    listKey: list.key,
    ...(list.idColumn ? { idColumn: list.idColumn } : {})
  };
}

export type LoadListPageOptions<
  TKey extends string,
  TExtra,
  TRow = Record<string, unknown>,
  TOut = TRow
> = {
  /** The key of the rows in the loader data (the Table's `infinite.dataKey`). */
  dataKey: TKey;
  /** Pass the loader's own `bypassRls: true`, if it had one. Never add it. */
  bypassRls?: boolean;
  /**
   * A check that runs on every page, after the permission check and before
   * the query: it throws (a redirect) when the list must not load, for
   * example a feature the company has turned off.
   */
  guard?: (context: ListLoaderContext) => Promise<void> | void;
  /**
   * The URL search the list query reads, when it is not the request's: for
   * example a default for a param the URL leaves out. Runs on every page.
   */
  params?: (context: ListLoaderContext) => URLSearchParams;
  /**
   * The page-1 extras (option lists, tags, settings). Runs only without
   * `?after=`, in parallel with the page; its result is merged into the
   * loader data. A later page returns the rows only.
   */
  firstPage?: (context: ListLoaderContext) => Promise<TExtra> | TExtra;
  /**
   * Adds per-row values only the screen needs (a download token) to the rows
   * of every page, after the list's own `rows` lookup. A value a column
   * exports belongs in the list's `rows`, which the background export runs
   * too. Runs after a page loads without an error.
   */
  mapRows?: (rows: TRow[], context: ListLoaderContext) => Promise<TOut[]>;
  /**
   * A failed first page redirects here with an error flash. Without it, the
   * page shows no rows. A failed later page never redirects: it returns
   * `listError`, and the Table shows "Couldn't load more rows" with Retry.
   */
  onError?: { redirectTo: string; message: string };
};

/**
 * The whole loader of a registered list:
 *
 * 1. `requirePermissions` with the list's permission (and `bypassRls`).
 * 2. `guard`, then `fetchListPage` for the URL's page (or `params`), with
 *    the user's company group.
 * 3. `firstPage` extras on page 1 only, in parallel with the page; the
 *    list's `rows` lookup, then `mapRows`, on every page after it.
 * 4. On an error: a later page returns `{ [dataKey]: [], nextCursor: null,
 *    listError }`; page 1 redirects with `onError`, or shows no rows.
 *
 * A loader that does more (an early return, a flash without a redirect)
 * calls `fetchListPage` itself and returns `listErrorPage(dataKey)` for a
 * failed later page.
 *
 * ```ts
 * export async function loader({ request }: LoaderFunctionArgs) {
 *   return loadListPage(request, customersList, {
 *     dataKey: "customers",
 *     bypassRls: true,
 *     firstPage: async ({ client, companyId }) => ({
 *       tags: (await getTagsList(client, companyId, "customer")).data ?? []
 *     }),
 *     onError: { redirectTo: path.to.sales, message: "Failed to fetch customers" }
 *   });
 * }
 * ```
 *
 * The return type holds the extras: `useLoaderData` reads page 1, which has
 * them. Only the Table's fetcher reads a later page.
 */
export async function loadListPage<
  TRow extends Record<string, unknown>,
  TKey extends string,
  TExtra extends Record<string, unknown> = Record<never, never>,
  TListRow extends Record<string, unknown> = TRow,
  TOut = TListRow
>(
  request: Request,
  list: ListDefinition<TRow, TListRow>,
  options: LoadListPageOptions<TKey, TExtra, TListRow, TOut>
): Promise<ListLoaderData<TKey, TOut> & TExtra> {
  const auth = await requirePermissions(
    request,
    options.bypassRls
      ? { ...list.permission, bypassRls: true }
      : list.permission
  );
  const requestParams = new URL(request.url).searchParams;
  const after = requestParams.get("after");
  // The Table's count request: the exact count only, after page 1 shows.
  const countOnly = requestParams.get("count") === "exact";
  // A request a fetcher reads (a later page or the count): an error must not
  // throw, or the route's error screen replaces the list.
  const fromFetcher = Boolean(after) || countOnly;
  const context: ListLoaderContext = {
    ...auth,
    request,
    params: requestParams
  };
  await options.guard?.(context);
  if (options.params) context.params = options.params(context);

  const loadPage = async () => {
    const [page, extra] = await Promise.all([
      fetchListPage(
        list,
        auth.client,
        auth.companyId,
        context.params,
        undefined,
        { companyGroupId: auth.companyGroupId }
      ),
      fromFetcher ? undefined : options.firstPage?.(context)
    ]);

    if (page.error) {
      logger.error("Failed to load a page of the list {listKey}", {
        listKey: list.key,
        companyId: auth.companyId,
        laterPage: Boolean(after),
        countOnly,
        error: page.error
      });
      if (fromFetcher) return listErrorPage(options.dataKey);
      if (options.onError) {
        throw redirect(
          options.onError.redirectTo,
          await flash(request, error(page.error, options.onError.message))
        );
      }
    }

    if (countOnly) {
      return {
        [options.dataKey]: [],
        count: page.count,
        exactCount: page.exactCount,
        nextCursor: null
      } as unknown as ListLoaderData<TKey, TOut> & TExtra;
    }

    const listRows =
      list.rows && !page.error
        ? await list.rows(page.rows, {
            client: auth.client,
            companyId: auth.companyId
          })
        : (page.rows as unknown as TListRow[]);
    const rows =
      options.mapRows && !page.error
        ? await options.mapRows(listRows, context)
        : listRows;

    return {
      ...extra,
      [options.dataKey]: rows,
      count: page.count,
      nextCursor: page.nextCursor,
      infinite: listInfinite(list, options.dataKey, page.nextCursor)
    } as ListLoaderData<TKey, TOut> & TExtra;
  };

  if (!fromFetcher) return loadPage();
  // A later page or the count is read by the Table's fetcher, and a fetcher
  // whose loader throws replaces the whole list with the route's error screen.
  // So any error becomes `listError` ("Couldn't load more rows" with Retry; a
  // failed count keeps the estimate). A thrown Response (a redirect, a
  // refusal) is the router's to handle.
  try {
    return await loadPage();
  } catch (thrown) {
    if (thrown instanceof Response) throw thrown;
    logger.error("Failed to load a page of the list {listKey}", {
      listKey: list.key,
      companyId: auth.companyId,
      laterPage: Boolean(after),
      countOnly,
      error: thrown
    });
    return listErrorPage(options.dataKey);
  }
}
