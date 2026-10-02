// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "~/lib/auth/AuthProvider";
import { useSupabase } from "~/lib/auth/useSupabase";
import { keys } from "~/lib/query/keys";

/**
 * The two pickers the reporting sheets need.
 *
 * Scrap reasons come straight over PostgREST as the signed-in user, which
 * `.claude/rules/mes-mobile-api.md` is explicit about: a lookup table that only
 * requires being an employee of the company does not need an endpoint of its
 * own, and adding one would be a second place for the list to drift. Rework
 * targets DO go through `/api/v1`, because the upstream-operations read is a
 * screen the web has its own loader for.
 *
 * Both load when their sheet opens rather than with the screen. A picker the
 * operator may never touch is not worth a round-trip on a shop-floor
 * connection, and the sheet shows a skeleton while it arrives.
 */

export type ScrapReason = { id: string; name: string };

export function useScrapReasons(enabled: boolean) {
  const supabase = useSupabase();
  const { companyId, instanceId } = useAuth();

  return useQuery({
    enabled: enabled && Boolean(supabase && companyId),
    queryKey: keys.scrapReasons({
      instanceId: instanceId ?? "unknown",
      companyId: companyId ?? ""
    }),
    // Reasons are configuration, not shop-floor state: a five-minute cache
    // keeps reopening the sheet instant without going stale in a shift.
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ScrapReason[]> => {
      if (!supabase || !companyId) return [];
      const { data, error } = await supabase
        .from("scrapReason")
        .select("id, name")
        // Explicit even though RLS also scopes it: this app holds sessions for
        // several instances, and a client-side read must never rely on RLS
        // alone to decide which company's rows it is looking at.
        .eq("companyId", companyId)
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as ScrapReason[];
    }
  });
}

export type ReworkTarget = {
  id: string;
  description?: string | null;
  processId?: string | null;
  operationOrder?: number | null;
};

export function useReworkTargets(operationId: string, enabled: boolean) {
  const { api, companyId, instanceId } = useAuth();

  return useQuery({
    enabled: enabled && Boolean(companyId && operationId),
    queryKey: keys.reworkTargets(
      { instanceId: instanceId ?? "unknown", companyId: companyId ?? "" },
      operationId
    ),
    queryFn: async () => {
      const result = await api.request<{
        operations?: { data?: ReworkTarget[] | null } | ReworkTarget[] | null;
      }>(`/operations/${operationId}/rework-targets`);
      // The route passes the service's `{ data, error }` straight through, as
      // the web loader does, so the array may be one level deeper.
      const operations = result?.operations;
      if (Array.isArray(operations)) return operations;
      return operations?.data ?? [];
    }
  });
}
