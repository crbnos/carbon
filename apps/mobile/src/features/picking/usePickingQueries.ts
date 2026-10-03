// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  pickingListDetail,
  pickingScreen,
  pickingTrackedOptions
} from "@carbon/mes-core";
import { useIsMutating, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { useAuth } from "~/lib/auth/AuthProvider";
import { useSupabase } from "~/lib/auth/useSupabase";
import { keys } from "~/lib/query/keys";

/**
 * The three picking reads, all through `/api/v1`.
 *
 * None of these is a candidate for a direct PostgREST read, and the reason is
 * the one `.claude/rules/mes-mobile-api.md` gives: RLS on `pickingList`
 * requires `inventory_view`, while the web loaders read with the service role
 * after a sign-in check. A kitter without that permission would see LESS on
 * the tablet than in the browser — and the `availableQuantity` column and the
 * recommended lots are an RPC and a greedy allocation pass, not columns, so
 * they do not exist to be selected at all.
 */

function useScope() {
  const { companyId, instanceId } = useAuth();
  return {
    instanceId: instanceId ?? "unknown",
    companyId: companyId ?? ""
  };
}

/**
 * The kitter's assigned lists.
 *
 * Refetched every 30 seconds and on focus (by the screen), because a
 * supervisor can reassign or cancel a list while the kitter is walking the
 * floor with the tablet, and a card for a list that is no longer theirs ends
 * in a 404 they cannot explain.
 */
export function usePickingQuery() {
  const { api, companyId } = useAuth();
  const scope = useScope();

  return useQuery({
    enabled: Boolean(companyId),
    queryKey: keys.picking(scope),
    refetchInterval: 30_000,
    queryFn: () => api.request("/picking", { schema: pickingScreen })
  });
}

/**
 * One list with its lines, its availability and its recommended lots.
 *
 * No poll interval here, deliberately: this screen is driven by the operator's
 * own picks (which invalidate it) and by realtime on `pickingListLine`, and a
 * background refetch mid-pick would re-render the row under a thumb that is
 * reaching for it.
 */
export function usePickingListQuery(listId: string) {
  const { api, companyId } = useAuth();
  const scope = useScope();

  return useQuery({
    enabled: Boolean(companyId && listId),
    queryKey: keys.pickingList(scope, listId),
    queryFn: () =>
      api.request(`/picking/${listId}`, { schema: pickingListDetail })
  });
}

/**
 * The lots available for one tracked line, with the company's expiry policy.
 *
 * Loaded only when the picker is open (`enabled`), like the web's fetcher: a
 * list of twenty tracked lines would otherwise make twenty calls on a
 * shop-floor connection for pickers nobody opens. `staleTime: 0` is the point
 * of it — another kitter may have taken the lot between opening the sheet
 * twice, and an offered lot that is gone is a failed pick the operator cannot
 * account for.
 */
export function usePickingTrackedOptions(
  listId: string,
  lineId: string | null
) {
  const { api, companyId } = useAuth();
  const scope = useScope();

  return useQuery({
    enabled: Boolean(companyId && listId && lineId),
    queryKey: keys.pickingTrackedOptions(scope, listId, lineId ?? ""),
    staleTime: 0,
    queryFn: () =>
      api.request(`/picking/${listId}/lines/${lineId}/tracked-options`, {
        schema: pickingTrackedOptions
      })
  });
}

/**
 * Which of the list's items are serial/batch tracked.
 *
 * A direct PostgREST read, and the one place on these screens where that is
 * right: `item` needs nothing more than being an employee of the company
 * (`.claude/rules/mes-mobile-api.md` lists it as a lookup), and
 * `itemTrackingType` is NOT in the detail payload — the web gets it from its
 * `useItems()` store, which this app has no equivalent of. Adding a field to
 * `/api/v1` for it would be an API change, which AGENTS.md says to ask about
 * first.
 *
 * ONE `.in()` call for every item on the list, never a query per line.
 */
export function useItemTracking(listId: string, itemIds: string[]) {
  const supabase = useSupabase();
  const { companyId } = useAuth();
  const scope = useScope();
  // Sorted and joined so two renders with the same items reuse one cache entry
  // rather than thrashing the key on every re-render of the list.
  const fingerprint = [...new Set(itemIds)].sort().join(",");

  return useQuery({
    enabled: Boolean(supabase && companyId && fingerprint),
    queryKey: keys.pickingItemTracking(scope, listId, fingerprint),
    // Tracking type is item configuration, not shop-floor state.
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Record<string, string | null>> => {
      if (!supabase || !companyId || !fingerprint) return {};
      const { data, error } = await supabase
        .from("item")
        .select("id, itemTrackingType")
        .in("id", fingerprint.split(","))
        // Explicit even though RLS also scopes it: this app holds sessions for
        // several instances, and a client-side read must never rely on RLS
        // alone to decide which company's rows it is looking at.
        .eq("companyId", companyId);
      if (error) throw error;
      const byId: Record<string, string | null> = {};
      for (const row of (data ?? []) as Array<{
        id: string;
        itemTrackingType: string | null;
      }>) {
        byId[row.id] = row.itemTrackingType;
      }
      return byId;
    }
  });
}

/**
 * Re-read a list after a pick.
 *
 * Every write refetches rather than patching the cache: the server derives the
 * line status, the availability and the recommended lots from rows this app
 * does not have, so a locally-computed result would disagree with the next
 * read. The LIST is invalidated too — a pick can finish the last line, and a
 * kitter who taps back to cards still showing "6 of 14" has been told the pick
 * failed when it did not.
 */
export function useInvalidatePickingList(listId: string) {
  const queryClient = useQueryClient();
  const { companyId, instanceId } = useAuth();
  const instance = instanceId ?? "unknown";
  const company = companyId ?? "";

  // The scope object is built INSIDE the callback: as a dependency it would be
  // a new literal every render, so every mutation holding this callback would
  // resubscribe on every render.
  return useCallback(async () => {
    const scope = { instanceId: instance, companyId: company };
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: keys.pickingList(scope, listId)
      }),
      queryClient.invalidateQueries({ queryKey: keys.picking(scope) }),
      // The lots a picker offered are stale the moment one of them is taken.
      queryClient.invalidateQueries({
        queryKey: ["picking-tracked-options", instance, company, listId]
      })
    ]);
  }, [queryClient, instance, company, listId]);
}

/**
 * Refetch the list when somebody else changes one of its lines.
 *
 * Two kitters can work one list, and a supervisor can cancel a line from the
 * ERP. `pickingListLine` is in the realtime publication for exactly this
 * (migration `20260916090000_picking-list-line-realtime.sql`), and the filter
 * is the list's own id so a tablet is not woken by every company's every pick.
 *
 * It skips while one of THIS screen's own mutations is in flight, mirroring
 * `useRealtimeRevalidator` in web MES: a pick's own write echoes back over
 * realtime mid-request, and refetching then replaces the row the operator is
 * still looking at with a half-applied read.
 */
export function usePickingListRealtime(listId: string) {
  const supabase = useSupabase();
  const invalidate = useInvalidatePickingList(listId);
  const pending = useIsMutating({ mutationKey: ["picking", listId] });

  // Read through a ref so a change in "is something submitting" does not tear
  // the subscription down and build it again.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  useEffect(() => {
    if (!supabase || !listId) return;
    const channel = supabase
      .channel(`picking-list:${listId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "pickingListLine",
          filter: `pickingListId=eq.${listId}`
        },
        () => {
          if (pendingRef.current === 0) void invalidate();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, listId, invalidate]);
}
