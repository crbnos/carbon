// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { loaderQuery, loaderRetry } from "./cache";

/**
 * What a read returns. `T` is the data itself, or the route's `typeof loader`
 * (as `useFetcher<typeof loader>` takes): then it is what that loader returns,
 * without the `data()` wrapper.
 */
export type LoaderData<T> = T extends (...args: any[]) => infer R
  ? Unwrapped<Awaited<R>>
  : T;

// Distributes over a loader that returns `data(...)` on one path and a plain
// object on another. The shape is React Router's `DataWithResponseInit`.
type Unwrapped<R> = R extends {
  type: string;
  data: infer D;
  init: ResponseInit | null;
}
  ? D
  : R;

/**
 * Reads an `api+` URL through the cache, as an observed query: every component
 * reading the same URL shares one request, renders the cached value at once,
 * and refetches when a mutation or a realtime change invalidates the entry.
 * Pass `null` to wait (a picker that is still closed, an id not chosen yet).
 * `invalidate: false` is for data no save or realtime change touches: it keeps
 * the entry out of what those mark stale, and `refetchInterval` refreshes it.
 * `keepPreviousData` shows the last URL's answer while a new URL loads, so a
 * read that follows the user's edits does not empty and refill on each one.
 */
export function useLoaderQuery<T>(
  url: string | null,
  options?: {
    staleTime?: number;
    invalidate?: boolean;
    refetchInterval?: number;
    keepPreviousData?: boolean;
  }
) {
  return useQuery<LoaderData<T>>({
    ...loaderQuery<LoaderData<T>>(url ?? "", options),
    refetchInterval: options?.refetchInterval,
    placeholderData: options?.keepPreviousData ? keepPreviousData : undefined,
    enabled: url !== null,
    retry: loaderRetry
  });
}
