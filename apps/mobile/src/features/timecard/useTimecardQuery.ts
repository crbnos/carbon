// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { timecardScreen } from "@carbon/mes-core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useAuth } from "~/lib/auth/AuthProvider";
import { keys } from "~/lib/query/keys";

/**
 * One week of the operator's own hours, from `GET /api/v1/timecard?weekOffset=`
 * — which runs the same `getTimecardScreen` web MES's `x+/timecard.tsx` runs,
 * so the two cannot disagree about which days are in the week or which entry
 * is open.
 *
 * The hours are read for the EFFECTIVE user, which on a shared terminal is the
 * pinned operator rather than the signed-in tablet. That is decided by the
 * server from the operator token the client sends, so nothing here names a
 * user; `keys.timecard` is scoped by instance and company only.
 *
 * It polls every 60 seconds, and the screen also refetches on focus. An open
 * entry can be closed by somebody else — a supervisor on web, or the nightly
 * auto-close shift — and an operator looking at a Clock out button for a timer
 * that is already closed will press it and be told their own tap failed.
 * Sixty seconds rather than the operation screen's thirty: the only thing that
 * changes between polls is a minute counter, and this screen is often left
 * open on a bench.
 */
export function useTimecardQuery(weekOffset: number) {
  const { api, companyId, me } = useAuth();
  const instanceId = me?.instance.name ?? "unknown";
  const scope = { instanceId, companyId: companyId ?? "" };

  return useQuery({
    enabled: Boolean(companyId),
    queryKey: keys.timecard(scope, weekOffset),
    refetchInterval: 60_000,
    queryFn: () =>
      api.request(`/timecard?weekOffset=${weekOffset}`, {
        schema: timecardScreen
      })
  });
}

/**
 * Re-read the time card after a command.
 *
 * EVERY week is invalidated, not just the one on screen. `openEntry` is part
 * of each week's payload — the server answers "are you clocked in" the same way
 * whichever week you asked about — so clocking out while looking at last week
 * would otherwise leave this week's cached copy still clocked in, and the next
 * tap would offer Clock out again.
 *
 * Nothing is patched into the cache by hand: a `timeCardEntry` row carries
 * server-set timestamps, and a locally-guessed clock-out would disagree with
 * the next poll by however long the request took.
 */
export function useInvalidateTimecard() {
  const queryClient = useQueryClient();
  const { me } = useAuth();
  const instanceId = me?.instance.name ?? "unknown";

  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["timecard", instanceId] }),
    [queryClient, instanceId]
  );
}
