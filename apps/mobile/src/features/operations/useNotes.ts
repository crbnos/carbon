// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { operationNote } from "@carbon/mes-core";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useAuth } from "~/lib/auth/AuthProvider";
import { useSupabase } from "~/lib/auth/useSupabase";

/**
 * The operation's notes, read straight over PostgREST as the signed-in user.
 *
 * This is the one read on this screen with no `/api/v1` endpoint, and
 * deliberately so: the web's own Chat component reads `jobOperationNote` the
 * same way (`Chat.tsx`), the table needs nothing more than being an employee
 * of the company, and `.claude/rules/mes-mobile-api.md` is explicit that a
 * lookup like that does not get an endpoint — a second one would be a second
 * place for the list to drift.
 *
 * WRITING a note does go through the API, because on a shared tablet it has to
 * be attributed to the pinned operator rather than to the terminal account the
 * browser session belongs to.
 */
export function useOperationNotes(operationId: string) {
  const supabase = useSupabase();
  const { companyId, instanceId } = useAuth();

  return useQuery({
    enabled: Boolean(supabase && companyId && operationId),
    queryKey: [
      "operation-notes",
      instanceId ?? "unknown",
      companyId ?? "",
      operationId
    ] as const,
    queryFn: async () => {
      if (!supabase || !companyId) return [];
      const { data, error } = await supabase
        .from("jobOperationNote")
        .select("*")
        .eq("jobOperationId", operationId)
        // Explicit even though RLS also scopes it: this app holds sessions for
        // several instances, and a client-side read must never rely on RLS
        // alone to decide whose rows it is looking at.
        .eq("companyId", companyId)
        .order("createdAt", { ascending: true });
      if (error) throw error;
      // The client is untyped, so the rows are validated rather than trusted.
      return z.array(operationNote).parse(data ?? []);
    }
  });
}
