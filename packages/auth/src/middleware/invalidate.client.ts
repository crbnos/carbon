// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { MiddlewareFunction } from "react-router";

/** The part of a TanStack `QueryClient` this needs; `@carbon/auth` does not depend on it. */
type LoaderCache = {
  invalidateQueries(filters: { queryKey: unknown[] }): unknown;
};

/** First segment of every cached loader entry (`cachedClientLoader`, `useLoaderQuery`). */
export const LOADER_QUERY_KEY = "loader";

/**
 * Marks every cached loader entry stale once a mutation has finished, so no
 * route has to name the lists its action changes. The action and the
 * revalidation that follows it are separate passes through the middleware, so
 * the entries are already stale when the loaders re-run.
 *
 * `skipPaths` is for POSTs that change no data (the session refresh that fires
 * on every tab focus would otherwise refetch every list).
 */
export const createInvalidationMiddleware =
  ({
    getCache,
    skipPaths = []
  }: {
    getCache: () => LoaderCache | undefined;
    skipPaths?: string[];
  }): MiddlewareFunction<unknown> =>
  async ({ request }, next) => {
    const result = await next();
    if (request.method === "GET") return result;
    if (skipPaths.includes(new URL(request.url).pathname)) return result;
    getCache()?.invalidateQueries({ queryKey: [LOADER_QUERY_KEY] });
    return result;
  };
