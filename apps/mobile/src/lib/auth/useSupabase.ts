// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useMemo } from "react";
import { useAuth } from "./AuthProvider";
import { getSupabase } from "./supabase";

/**
 * The signed-in user's supabase client, or null before `/me` has answered.
 *
 * Null rather than throwing, because the url and anon key only arrive with
 * `/me` — a component that mounts during sign-in must render, not crash. Every
 * caller therefore guards on it, which is also what keeps a query disabled
 * until it can actually run.
 *
 * Reads only, and only the tables that require nothing more than being an
 * employee of the company. Every write goes through `/api/v1` so the command
 * code — backflush, cost posting, genealogy, the floor gates — cannot be
 * skipped.
 */
export function useSupabase() {
  const { me, instanceId } = useAuth();

  return useMemo(() => {
    if (!me || !instanceId) return null;
    // `instanceId` — the linked instance's local uuid — and NOT
    // `me.instance.name`. `getSupabase` memoizes one client per
    // `(instanceId, url)` and replaces it when either changes, so a caller
    // passing a different id would build a fresh, session-less client and
    // throw away the session `AuthProvider` set. It is also the id the
    // provider's own handoff uses, and the only one that is unique.
    return getSupabase(instanceId, me.instance);
  }, [me, instanceId]);
}
