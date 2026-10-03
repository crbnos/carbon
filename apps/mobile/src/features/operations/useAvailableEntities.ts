// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "~/lib/auth/AuthProvider";
import { useSupabase } from "~/lib/auth/useSupabase";
import { keys } from "~/lib/query/keys";
import type { AvailableEntity } from "./trackedIssue";

/**
 * The serials or lots of one item that are on the shelf to be issued.
 *
 * Read straight over PostgREST as the signed-in user, which is what the web's
 * own lookups do (`getSerialNumbersForItem` / `getBatchNumbersForItem` run on
 * the user's client) and what `.claude/rules/mes-mobile-api.md` says of
 * `trackedEntity`: a lookup that needs nothing more than being an employee of
 * the company does not get an endpoint of its own.
 *
 * It is the same query as those two, including their two details that are easy
 * to lose:
 *
 *  - a MATERIAL is stocked under every revision of its readable id, so the
 *    lots of all of them are offered, not only the one the job names;
 *  - the order is FEFO then FIFO — soonest expiry first, nulls last, then
 *    oldest — so the entity at the top of the list is the one to take.
 *
 * Loaded when the sheet opens, not with the screen: most parts on an assembly
 * are not tracked, and the ones that are get issued by scanning a label that
 * names the entity outright.
 */
export function useAvailableEntities(
  itemId: string | null | undefined,
  enabled: boolean
) {
  const supabase = useSupabase();
  const { companyId, instanceId } = useAuth();

  return useQuery({
    enabled: enabled && Boolean(supabase && companyId && itemId),
    queryKey: keys.availableEntities(
      { instanceId: instanceId ?? "unknown", companyId: companyId ?? "" },
      itemId ?? ""
    ),
    // Stock moves: another operator may have just taken the lot at the top.
    staleTime: 0,
    queryFn: async (): Promise<AvailableEntity[]> => {
      if (!supabase || !companyId || !itemId) return [];

      let itemIds = [itemId];
      const item = await supabase
        .from("item")
        .select("id, type, readableId")
        .eq("id", itemId)
        // Explicit even though RLS also scopes it: this app holds sessions for
        // several instances, and a client-side read must never rely on RLS
        // alone to decide which company's rows it is looking at.
        .eq("companyId", companyId)
        .maybeSingle();
      if (item.error) throw item.error;
      if (item.data?.type === "Material" && item.data.readableId) {
        const revisions = await supabase
          .from("item")
          .select("id")
          .eq("readableId", item.data.readableId)
          .eq("companyId", companyId);
        if (revisions.error) throw revisions.error;
        if (revisions.data?.length) {
          itemIds = revisions.data.map((row: { id: string }) => row.id);
        }
      }

      const { data, error } = await supabase
        .from("trackedEntity")
        .select("id, readableId, quantity, status, expirationDate")
        .eq("sourceDocument", "Item")
        .in("sourceDocumentId", itemIds)
        .eq("companyId", companyId)
        .eq("status", "Available")
        .gt("quantity", 0)
        .order("expirationDate", { ascending: true, nullsFirst: false })
        .order("createdAt", { ascending: true });
      if (error) throw error;
      return (data ?? []) as AvailableEntity[];
    }
  });
}
