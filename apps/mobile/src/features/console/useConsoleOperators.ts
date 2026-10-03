// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useAuth } from "~/lib/auth/AuthProvider";
import { useSupabase } from "~/lib/auth/useSupabase";
import { keys } from "~/lib/query/keys";

/**
 * Who can pin in at this tablet.
 *
 * Two reads, both direct over PostgREST as the terminal's signed-in user,
 * which `.claude/rules/mes-mobile-api.md` allows for a lookup table that needs
 * nothing more than being an employee of the company. There is no endpoint for
 * this and adding one would be a second place for the list to drift.
 *
 * The second read is the part to be careful about: it selects ONLY
 * `employeeId` from `employeePin`, never `pinHash`. PostgREST honours the
 * column list server-side, so the hashes never leave the database — and an
 * operator list that included people with no PIN set would offer a row that
 * can only ever fail, which on a shop floor reads as a broken app rather than
 * as missing setup.
 */
const operatorRow = z.object({
  id: z.string(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable()
});

export type ConsoleOperatorOption = {
  userId: string;
  name: string;
  avatarUrl: string | null;
};

export function useConsoleOperators(enabled: boolean) {
  const supabase = useSupabase();
  const { companyId, instanceId } = useAuth();

  return useQuery({
    enabled: enabled && Boolean(supabase && companyId),
    queryKey: keys.operators({
      instanceId: instanceId ?? "unknown",
      companyId: companyId ?? ""
    }),
    // A shift's worth: the list changes when someone is hired, not between
    // two operators swapping at a machine.
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<ConsoleOperatorOption[]> => {
      if (!supabase || !companyId) return [];

      const [people, pins] = await Promise.all([
        supabase
          .from("employees")
          .select("id, name, avatarUrl")
          .eq("companyId", companyId)
          .eq("active", true)
          .order("name"),
        // `employeeId` only. Never `pinHash`.
        supabase
          .from("employeePin")
          .select("employeeId")
          .eq("companyId", companyId)
      ]);
      if (people.error) throw people.error;
      if (pins.error) throw pins.error;

      const withPin = new Set(
        (pins.data ?? []).map(
          (row) => (row as { employeeId: string }).employeeId
        )
      );

      return z
        .array(operatorRow)
        .parse(people.data ?? [])
        .filter((person) => withPin.has(person.id))
        .map((person) => ({
          userId: person.id,
          name: person.name ?? person.id,
          avatarUrl: person.avatarUrl
        }));
    }
  });
}
