// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { operationsScreen } from "@carbon/mes-core";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "~/lib/auth/AuthProvider";
import { keys } from "~/lib/query/keys";

/**
 * The operations list, from `GET /api/v1/operations` — which runs the same
 * `getOperationsScreen` the web route runs, so a tablet and web MES show the
 * same cards for the same location and work centers.
 *
 * Refetches on focus and every 30 seconds. The operation screen is a live
 * picture of a shop floor where other people are also working, so a long stale
 * time would show an operator a timer somebody else already stopped.
 */
export function useOperationsQuery(workCenterIds: string[] = []) {
  const { api, companyId, locationId, me } = useAuth();
  const instanceId = me?.instance.name ?? "unknown";

  return useQuery({
    enabled: Boolean(companyId && locationId),
    queryKey: keys.operations(
      { instanceId, companyId: companyId ?? "" },
      locationId ?? "",
      workCenterIds
    ),
    refetchInterval: 30_000,
    queryFn: () => {
      const query = workCenterIds.length
        ? `?workCenterIds=${encodeURIComponent(workCenterIds.join(","))}`
        : "";
      return api.request(`/operations${query}`, { schema: operationsScreen });
    }
  });
}
