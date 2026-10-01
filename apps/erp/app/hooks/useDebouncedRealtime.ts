// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useRealtime } from "./useRealtime";

/**
 * `useRealtime` with a longer coalescing window.
 *
 * Use for append-heavy tables (e.g. `itemLedger`) where one business action
 * inserts many rows at once: a 300-row posting should produce one revalidation,
 * not a burst spread over the default window. Subscribe with a
 * `companyId=eq.<id>` filter so new inserts (not just changes to already-loaded
 * rows) trigger a refetch.
 */
export function useDebouncedRealtime(
  table: string,
  filter: string | undefined,
  debounceMs = 1500
) {
  return useRealtime(table, filter, debounceMs);
}
