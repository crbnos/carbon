// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { inspectionScreen } from "@carbon/mes-core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useAuth } from "~/lib/auth/AuthProvider";
import { keys } from "~/lib/query/keys";

/**
 * The inspection screen, from `GET /api/v1/operations/:id/inspection` — the
 * same `getInspectionScreen` the web route runs.
 *
 * **Opening it creates the lot.** The read is a lazy find-or-create, which is
 * why it is addressed by the operation and why it is not prefetched anywhere:
 * fetching this is a side effect, not an idle cache warm.
 *
 * Unlike the operation screen it does NOT poll. The grid holds unsaved local
 * state — a reading half-typed into a cell — and a background refetch that
 * re-seeded the cells underneath an inspector's thumb would discard what they
 * had just entered. The screen is refetched when a write lands and when the
 * inspector pulls to refresh, which is the only state change that is not
 * their own doing.
 */
export function useInspectionQuery(operationId: string) {
  const { api, companyId, instanceId } = useAuth();
  const scope = {
    instanceId: instanceId ?? "unknown",
    companyId: companyId ?? ""
  };

  return useQuery({
    enabled: Boolean(companyId && operationId),
    queryKey: keys.inspection(scope, operationId),
    queryFn: () =>
      api.request(`/operations/${operationId}/inspection`, {
        schema: inspectionScreen
      })
  });
}

/**
 * Re-read the lot after a write.
 *
 * The per-cell writes deliberately do NOT call this — they keep their own
 * result as a local patch, so a reading does not cost a round trip. It is the
 * lot-level writes (a disposition, a completion, a scanned unit) that
 * invalidate, because those change quantities and statuses the server derives
 * from rows this app does not hold. The operation list goes with them: a
 * dispositioned lot can finish the operation, and a card still showing it
 * reads as a failed write.
 */
export function useInvalidateInspection(operationId: string) {
  const queryClient = useQueryClient();
  const { companyId, instanceId } = useAuth();
  const instance = instanceId ?? "unknown";
  const company = companyId ?? "";

  // Built inside the callback: as a dependency the scope literal would be new
  // on every render, so every mutation holding this would resubscribe.
  return useCallback(async () => {
    const scope = { instanceId: instance, companyId: company };
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: keys.inspection(scope, operationId)
      }),
      queryClient.invalidateQueries({
        queryKey: keys.operation(scope, operationId)
      }),
      queryClient.invalidateQueries({ queryKey: ["operations", instance] })
    ]);
  }, [queryClient, instance, company, operationId]);
}
