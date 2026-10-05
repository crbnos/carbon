// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { RealtimeTable } from "@carbon/database/realtime-tables";
import { useRealtime } from "./useRealtime";

/**
 * `useRealtime` with a longer coalescing window.
 *
 * Use for append-heavy tables (e.g. `itemLedger`) where one business action
 * inserts many rows at once: a 300-row posting should produce one revalidation,
 * not a burst spread over the default window. The topic is already the
 * company's, so no filter is needed to follow every change to the table.
 */
export function useDebouncedRealtime(
  table: RealtimeTable,
  filter?: string,
  debounceMs = 1500
) {
  return useRealtime(table, filter, debounceMs);
}
