// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { operationQueueScreen } from "@carbon/mes-core";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "~/lib/auth/AuthProvider";
import { keys } from "~/lib/query/keys";
import type { QueueKind } from "./queues";

/**
 * The three personal operation queues, each from its own `/api/v1` endpoint —
 * which runs the same extracted screen read the matching web MES route runs
 * (`x+/assigned.tsx`, `x+/active.tsx`, `x+/recent.tsx`).
 *
 * None of these is a candidate for a direct PostgREST read, for the reason
 * `.claude/rules/mes-mobile-api.md` gives: all three are RPCs over
 * `productionEvent` and `jobOperation`, `get_assigned_job_operations` is read
 * with the SERVICE ROLE on the web, and an operator without `production_view`
 * would see less on the tablet than in the browser.
 *
 * All three poll every 30 seconds and refetch on focus (the screen does that),
 * for the same reason the board does: a shop floor moves while the operator is
 * on another screen, and a supervisor can reassign work or another operator can
 * stop a timer. Specifically for ACTIVE, the count is badged on the switcher
 * from whichever of the four queue screens is open, so it has to stay live when
 * the operator is not looking at it.
 */
function useQueue(kind: QueueKind) {
  const { api, companyId, instanceId } = useAuth();

  return useQuery({
    enabled: Boolean(companyId),
    queryKey: keys.operationQueue(
      { instanceId: instanceId ?? "unknown", companyId: companyId ?? "" },
      kind
    ),
    refetchInterval: 30_000,
    queryFn: () =>
      api.request(`/operations/${kind}`, { schema: operationQueueScreen })
  });
}

/** Work a planner put on this operator's name, whatever its status. */
export function useAssignedQuery() {
  return useQueue("assigned");
}

/**
 * The operations this operator has an open production event on.
 *
 * Mounted by `QueueSwitcher` on every queue screen as well as by the Active
 * screen itself. Both observers share ONE cache entry (the key carries only
 * the instance, the company and the queue), so the badge and the list can never
 * show different numbers, and the second observer costs no extra request.
 */
export function useActiveQuery() {
  return useQueue("active");
}

/** What this operator last touched, so picking a job back up is one tap. */
export function useRecentQuery() {
  return useQueue("recent");
}
