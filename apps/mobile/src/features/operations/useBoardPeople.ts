// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useAuth } from "~/lib/auth/AuthProvider";
import { useSupabase } from "~/lib/auth/useSupabase";
import { keys } from "~/lib/query/keys";

/**
 * Who an operation can be assigned to, for the board's Assignee filter.
 *
 * Web reads this from its `usePeople()` store, which a route loader fills.
 * The native app has no such store, so it reads the `employees` view over
 * PostgREST as the signed-in user — the same thing `useConsoleOperators`
 * does, and what `.claude/rules/mes-mobile-api.md` says a lookup needing only
 * employee-of-the-company should do rather than grow an endpoint.
 *
 * It is NOT in the board payload because that payload carries only the
 * assignee's user id per card. Adding names there would mean an `/api/v1`
 * response-shape change for something a lookup already answers.
 *
 * Loaded when the filter sheet opens, not with the board: a list the operator
 * may never open is not worth a round-trip on shop-floor Wi-Fi.
 */

const personRow = z.object({
  id: z.string(),
  name: z.string().nullable().optional()
});

export type BoardPerson = { id: string; name: string };

export function useBoardPeople(enabled: boolean) {
  const supabase = useSupabase();
  const { companyId, instanceId } = useAuth();

  return useQuery({
    enabled: enabled && Boolean(supabase && companyId),
    queryKey: keys.people({
      instanceId: instanceId ?? "unknown",
      companyId: companyId ?? ""
    }),
    // A shift's worth. The roster changes when someone is hired, not between
    // two operators swapping at a machine.
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<BoardPerson[]> => {
      if (!supabase || !companyId) return [];

      const { data, error } = await supabase
        .from("employees")
        .select("id, name")
        .eq("companyId", companyId)
        .eq("active", true)
        .order("name");
      if (error) throw error;

      return z
        .array(personRow)
        .parse(data ?? [])
        .map((person) => ({ id: person.id, name: person.name?.trim() || "" }))
        .filter((person) => person.name !== "");
    }
  });
}
