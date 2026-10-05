// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { RealtimeTable } from "@carbon/database/realtime-tables";
import { useRealtimeTable } from "@carbon/query";
import { useUser } from "./useUser";

/**
 * Reloads the page's data when `table` changes in the user's company. A route
 * declares its tables in `handle.realtime` instead; this is for a component
 * that is not a route. Only an `id=eq.` / `id=in.()` filter narrows it.
 */
export function useRealtime(
  table: RealtimeTable,
  filter?: string,
  debounceMs?: number
) {
  const { company } = useUser();
  return useRealtimeTable({
    companyId: company.id,
    table,
    filter,
    debounceMs
  });
}
