// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { jobsScreen } from "@carbon/mes-core";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "~/lib/auth/AuthProvider";
import { keys } from "~/lib/query/keys";

/**
 * Every open job at the operator's location — `GET /api/v1/jobs`, which runs
 * the same `getJobsScreen` web MES's `x+/jobs.tsx` now calls.
 *
 * Keyed by LOCATION as well as by instance and company: the floor rule is
 * per-location, and an operator who switches plant must not see the previous
 * one's jobs out of cache while the new list loads.
 *
 * Polls on the same 30s cadence as the operation queues and refetches on
 * focus, for the same reason: a planner releases and closes jobs while the
 * operator is on another screen.
 */
export function useJobsQuery() {
  const { api, companyId, instanceId, locationId } = useAuth();

  return useQuery({
    enabled: Boolean(companyId && locationId),
    queryKey: keys.jobs(
      { instanceId: instanceId ?? "unknown", companyId: companyId ?? "" },
      locationId ?? ""
    ),
    refetchInterval: 30_000,
    queryFn: () => api.request("/jobs", { schema: jobsScreen })
  });
}
