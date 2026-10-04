// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { LOADER_QUERY_KEY } from "@carbon/auth/middleware/invalidate.client";
import type { QueryClient } from "@tanstack/react-query";
import type { ClientLoaderFunctionArgs } from "react-router";

export enum RefreshRate {
  Never = Infinity,
  High = 1000 * 60 * 2,
  Medium = 1000 * 60 * 10,
  Low = 1000 * 60 * 30
}

// The `companyId` cookie is httpOnly, so the browser cannot read it: the shell
// layout hands the company over instead, before anything below it renders.
let clientCompanyId: string | null = null;

export const setClientCompanyId = (companyId: string | null) => {
  if (typeof window !== "undefined") clientCompanyId = companyId;
};

export const getCompanyId = () => clientCompanyId;

export const getClientCache = (): QueryClient | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.clientCache;
};

/** First segment of every cached loader entry; the root middleware invalidates by it. */
export const LOADER = LOADER_QUERY_KEY;

// Component-level reads. Their keys start with LOADER so a mutation invalidates
// them with the loader entries.
export const accountsQuery = (companyId: string | null) => ({
  queryKey: [LOADER, "accounts", companyId ?? "null"],
  staleTime: RefreshRate.Low
});

export const ITEM_QUANTITIES_QUERY_KEY = "itemQuantities";

export const itemQuantitiesQuery = (
  locationId: string,
  companyId: string | null
) => ({
  queryKey: [ITEM_QUANTITIES_QUERY_KEY, companyId ?? "null", locationId],
  staleTime: RefreshRate.High
});

export const userSelectGroupsQuery = (
  companyId: string | null,
  type: string | null,
  offset: number
) => ({
  queryKey: [
    LOADER,
    "userSelectGroups",
    companyId ?? "null",
    type ?? "all",
    offset
  ],
  staleTime: RefreshRate.Low
});

export const userSelectMembersQuery = (
  companyId: string | null,
  groupId: string
) => ({
  queryKey: [LOADER, "userSelectMembers", companyId ?? "null", groupId],
  staleTime: RefreshRate.Low
});

export const userSelectSearchQuery = (
  companyId: string | null,
  type: string | null,
  q: string,
  filters: string
) => ({
  queryKey: [
    LOADER,
    "userSelectSearch",
    companyId ?? "null",
    type ?? "all",
    q,
    filters
  ],
  staleTime: RefreshRate.High
});

export const userSelectResolveQuery = (
  companyId: string | null,
  ids: string[]
) => ({
  queryKey: [
    LOADER,
    "userSelectResolve",
    companyId ?? "null",
    [...ids].sort().join(",")
  ],
  staleTime: RefreshRate.Low
});

export const groupEmailsQuery = (
  companyId: string | null,
  groupId: string
) => ({
  queryKey: [LOADER, "groupEmails", companyId ?? "null", groupId],
  staleTime: RefreshRate.Low
});

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
    return cache.fetchQuery({
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
 * Read-through fetch against an API route, cached in window.clientCache.
 * fetchQuery dedupes concurrent identical calls and honors staleTime.
 * Falls back to a plain fetch when the cache isn't mounted yet.
 */
export async function cachedApiQuery<T>(
  query: { queryKey: unknown[]; staleTime: number },
  url: string
): Promise<T> {
  const queryFn = async (): Promise<T> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
    return res.json();
  };
  const cache = getClientCache();
  if (!cache) return queryFn();
  return cache.fetchQuery({
    queryKey: query.queryKey,
    queryFn,
    staleTime: query.staleTime
  });
}
