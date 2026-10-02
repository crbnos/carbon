// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { operationDetail } from "@carbon/mes-core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useAuth } from "~/lib/auth/AuthProvider";
import { keys } from "~/lib/query/keys";

/**
 * One operation, from `GET /api/v1/operations/:id` — which runs the same
 * `getOperationScreen` the web route runs.
 *
 * It refetches every 30 seconds and on focus, because this screen is a live
 * picture of a floor where other people are also working: a supervisor may
 * stop a timer, another operator may report the quantity that finishes the
 * operation. A long stale time would show a timer that is already closed, and
 * the operator would press Pause on nothing.
 *
 * `trackedEntityId` is part of the key, not a mutable filter: a serial
 * operation's payload is scoped to one unit, so two units are two different
 * answers and must not share a cache entry.
 */
export function useOperationQuery(
  operationId: string,
  trackedEntityId?: string | null
) {
  const { api, companyId, me } = useAuth();
  const instanceId = me?.instance.name ?? "unknown";
  const scope = { instanceId, companyId: companyId ?? "" };

  return useQuery({
    enabled: Boolean(companyId && operationId),
    queryKey: [
      ...keys.operation(scope, operationId),
      trackedEntityId ?? null
    ] as const,
    refetchInterval: 30_000,
    queryFn: () => {
      const query = trackedEntityId
        ? `?trackedEntityId=${encodeURIComponent(trackedEntityId)}`
        : "";
      return api.request(`/operations/${operationId}${query}`, {
        schema: operationDetail
      });
    }
  });
}

/**
 * Re-read the operation after a command.
 *
 * Every write refetches rather than patching the cache by hand: the server
 * derives quantities, statuses and open events from rows this app does not
 * have, so a locally-computed optimistic result would disagree with the next
 * poll. The operations LIST is invalidated too — finishing an operation
 * removes its card, and an operator who taps back to a list still showing it
 * has been told the write failed when it did not.
 */
export function useInvalidateOperation(operationId: string) {
  const queryClient = useQueryClient();
  const { companyId, me } = useAuth();
  const instanceId = me?.instance.name ?? "unknown";
  const company = companyId ?? "";

  // The scope object is built INSIDE the callback: as a dependency it would be
  // a new literal on every render, so the callback identity would change every
  // render and every mutation holding it would resubscribe.
  return useCallback(async () => {
    const scope = { instanceId, companyId: company };
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: keys.operation(scope, operationId)
      }),
      queryClient.invalidateQueries({ queryKey: ["operations", instanceId] })
    ]);
  }, [queryClient, instanceId, company, operationId]);
}
