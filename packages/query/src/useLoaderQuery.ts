// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useQuery } from "@tanstack/react-query";
import { loaderQuery } from "./cache";

/**
 * Reads an `api+` URL through the cache, as an observed query: every component
 * reading the same URL shares one request, renders the cached value at once,
 * and refetches when a mutation or a realtime change invalidates the entry.
 * Pass `null` to wait (a picker that is still closed, an id not chosen yet).
 */
export function useLoaderQuery<T>(
  url: string | null,
  options?: { staleTime?: number }
) {
  return useQuery<T>({
    ...loaderQuery<T>(url ?? "", options),
    enabled: url !== null
  });
}
