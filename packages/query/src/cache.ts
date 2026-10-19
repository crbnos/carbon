// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { QueryClient } from "@tanstack/react-query";
import type { ClientLoaderFunctionArgs } from "react-router";
import { LOADER_QUERY_KEY, loaderInvalidations } from "./invalidation";

// The cache half of @carbon/query, with no React or UI import: a route module
// (which also runs on the server) can import it without pulling in the app's
// component library.

export { createInvalidationMiddleware } from "./invalidation";

/** How long a cached entry is served before it is refetched, in ms. */
export const RefreshRate = {
  Never: Number.POSITIVE_INFINITY,
  High: 1000 * 60 * 2,
  Medium: 1000 * 60 * 10,
  Low: 1000 * 60 * 30
} as const;

// The `companyId` cookie is httpOnly, so the browser cannot read it: the shell
// layout hands the company over instead, before anything below it renders.
let clientCompanyId: string | null = null;
let clientUserId: string | null = null;

/**
 * Who the page is working as. The cache is one user's view of one company:
 * - another user in this tab (sign out, sign in) starts from an empty cache;
 * - leaving a company drops its loader entries, because a load that was in
 *   flight while another tab switched the company cookie answered for the new
 *   company and was stored under the old one.
 */
export const setClientCompanyId = (
  companyId: string | null,
  userId: string | null = clientUserId
) => {
  if (typeof window === "undefined") return;
  const cache = getClientCache();
  if (clientUserId && userId !== clientUserId) {
    cache?.clear();
  } else if (clientCompanyId && companyId !== clientCompanyId) {
    cache?.removeQueries({ queryKey: [LOADER_QUERY_KEY, clientCompanyId] });
  }
  clientCompanyId = companyId;
  clientUserId = userId;
};

export const getCompanyId = () => clientCompanyId;

/** The one QueryClient of the page, reachable outside React. The app root creates it. */
export const getClientCache = (): QueryClient | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  return (window as { clientCache?: QueryClient }).clientCache;
};

/** First segment of every cached loader entry; the root middleware invalidates by it. */
export const LOADER = LOADER_QUERY_KEY;

// URL keys make one entry per distinct search string, so they cannot live forever.
const LOADER_GC_TIME = 1000 * 60 * 30;

/** The cache key of a loader URL — the same for a `clientLoader` and a component read. */
export const loaderQueryKey = (url: string, companyId = getCompanyId()) => {
  const { pathname, search } = new URL(url, "http://localhost");
  return [LOADER, companyId ?? "null", pathname, search];
};

/**
 * A `clientLoader` that caches its route's server loader by URL. Unlike a
 * `getQueryData`/`setQueryData` pair it honors `staleTime`, dedupes concurrent
 * loads, and refetches once the root middleware has invalidated the entry.
 */
export function cachedClientLoader<L>(options?: { staleTime?: number }) {
  const clientLoader = ({
    request,
    serverLoader
  }: ClientLoaderFunctionArgs) => {
    const cache = getClientCache();
    const companyId = getCompanyId();
    if (!cache || !companyId) return serverLoader<L>();
    return fetchLoader(cache, {
      queryKey: loaderQueryKey(request.url, companyId),
      queryFn: () => serverLoader<L>(),
      staleTime: options?.staleTime ?? RefreshRate.Low,
      gcTime: LOADER_GC_TIME
    });
  };
  clientLoader.hydrate = true as const;
  return clientLoader;
}

/**
 * `fetchQuery`, for a load with no observer. Nothing cancels such a load when
 * the entries are invalidated, so one that started before a mutation and
 * finished after it would be stored as fresh: it is marked stale again here.
 */
async function fetchLoader<T>(
  cache: QueryClient,
  query: {
    queryKey: unknown[];
    queryFn: () => Promise<T>;
    staleTime: number;
    gcTime: number;
  }
): Promise<T> {
  const before = loaderInvalidations();
  const data = await cache.fetchQuery(query);
  if (loaderInvalidations() !== before) {
    await cache.invalidateQueries({
      queryKey: query.queryKey,
      exact: true,
      refetchType: "none"
    });
  }
  return data;
}

/** A read the server answered and refused: asking again changes nothing. */
export class LoaderRequestError extends Error {}

const fetchJson = async <T>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) {
    const message = `Request failed with status ${res.status}`;
    throw res.status < 500
      ? new LoaderRequestError(message)
      : new Error(message);
  }
  // An expired session redirects to the login page, which is HTML.
  if (!res.headers.get("content-type")?.includes("json")) {
    throw new LoaderRequestError(
      `Expected JSON from ${url} (is the session still valid?)`
    );
  }
  return res.json();
};

/**
 * What a cached read of `url` is: the key, the fetch and the lifetimes. Shared
 * by the imperative read below and by `useLoaderQuery`, so both land on the
 * entry a `cachedClientLoader` for the same URL uses.
 */
export const loaderQuery = <T>(
  url: string,
  options?: { staleTime?: number }
) => ({
  queryKey: loaderQueryKey(url),
  queryFn: () => fetchJson<T>(url),
  staleTime: options?.staleTime ?? RefreshRate.Low,
  gcTime: LOADER_GC_TIME
});

/**
 * Read-through fetch against an API route, cached by its URL in the page's
 * QueryClient. fetchQuery dedupes concurrent identical calls and honors
 * staleTime. Falls back to a plain fetch when the cache isn't mounted yet.
 * For an event handler or an effect; a component renders with `useLoaderQuery`.
 */
export async function cachedApiQuery<T>(
  url: string,
  options?: { staleTime?: number }
): Promise<T> {
  const cache = getClientCache();
  if (!cache) return fetchJson<T>(url);
  return fetchLoader(cache, loaderQuery<T>(url, options));
}
