// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { MiddlewareFunction } from "react-router";

/** The part of a TanStack `QueryClient` this needs; `@carbon/auth` does not depend on it. */
type LoaderCache = {
  invalidateQueries(filters: { queryKey: unknown[] }): unknown;
};

// How many times the loader entries have been marked stale. A load that was in
// flight across one finishes with data from before it: TanStack marks a
// finished fetch fresh, so the loader reads this to mark it stale again.
let invalidations = 0;
export const loaderInvalidations = () => invalidations;

/** Marks every cached loader entry stale (`cachedClientLoader`, `useLoaderQuery`). */
export const invalidateLoaderEntries = (cache: LoaderCache | undefined) => {
  invalidations += 1;
  cache?.invalidateQueries({ queryKey: [LOADER_QUERY_KEY] });
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
    if (
      request.method === "GET" ||
      skipPaths.includes(new URL(request.url).pathname)
    ) {
      return next();
    }
    try {
      return await next();
    } finally {
      // An action that throws may still have written.
      invalidateLoaderEntries(getCache());
    }
  };
