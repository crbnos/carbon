// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assemblyScreen } from "@carbon/mes-core";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useAuth } from "~/lib/auth/AuthProvider";
import { keys } from "~/lib/query/keys";

/**
 * Which unit of the operation to open.
 *
 * `null` means "wherever the server lands": the next unit still to build. A
 * serial parent is addressed by its entity, everything else by its 0-based
 * position — the same two search params the web route takes, and the server
 * resolves them the same way for both.
 */
export type UnitSelection =
  | { trackedEntityId: string }
  | { unit: number }
  | null;

/**
 * The assembly screen, from `GET /api/v1/operations/:id/assembly` — the same
 * `getAssemblyScreen` the web route runs.
 *
 * The unit is part of the KEY. The payload's materials are attributed to one
 * unit, so two units are two different answers and must not share a cache
 * entry; paging to another unit is another GET, exactly as the web revalidates
 * its loader when `?unit=` changes.
 *
 * `keepPreviousData` holds the last unit on screen while the next one loads.
 * Without it every page of the unit pager would flash a skeleton, and an
 * operator paging through ten units to find the one they want would see ten
 * blank screens.
 *
 * It polls every 30 seconds, like the operation screen: the web keeps this
 * view live over a realtime channel, and another operator's timer or a
 * supervisor's completed unit has to arrive here somehow. Nothing on the
 * screen holds unsaved input outside a sheet, so a refetch cannot discard
 * anything.
 */
export function useAssemblyQuery(
  operationId: string,
  selection: UnitSelection
) {
  const { api, companyId, instanceId } = useAuth();
  const scope = {
    instanceId: instanceId ?? "unknown",
    companyId: companyId ?? ""
  };
  const trackedEntityId =
    selection && "trackedEntityId" in selection
      ? selection.trackedEntityId
      : null;
  const unit = selection && "unit" in selection ? selection.unit : null;

  return useQuery({
    enabled: Boolean(companyId && operationId),
    queryKey: [
      ...keys.assembly(scope, operationId),
      trackedEntityId,
      unit
    ] as const,
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
    queryFn: () => {
      const query = trackedEntityId
        ? `?trackedEntityId=${encodeURIComponent(trackedEntityId)}`
        : unit !== null
          ? `?unit=${unit}`
          : "";
      return api.request(`/operations/${operationId}/assembly${query}`, {
        schema: assemblyScreen
      });
    }
  });
}
