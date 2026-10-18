// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// oRPC context + middleware shared by the HTTP transport and the MCP/agent bridges.

import type { Permission } from "@carbon/auth";
import type { Database } from "@carbon/database";
import { os } from "@orpc/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The identity every Carbon API call runs as. Built once per request (from an API
 * key on HTTP, or from the resolved MCP/agent auth) and injected as oRPC context;
 * `runServiceFn` builds the service context from it.
 */
export interface AuthedContext {
  client: SupabaseClient<Database>;
  userId: string;
  companyId: string;
  companyGroupId: string;
  /** How the caller authenticated. Every kind is checked by the service
   *  function's own gate (`runServiceFn` builds an entry context): RLS alone
   *  does not bound a caller, because a service function may write through the
   *  direct connection, which bypasses it. `"session"` is an in-process caller
   *  acting as a user (the workflow engine acting as the workflow's owner) —
   *  not "oauth" because that names a wire protocol. */
  authKind: "api-key" | "oauth" | "session";
  /** `{ "<module>_<action>": [companyId, …] }` — the API key's scopes, or for a
   *  user (OAuth, a workflow's owner) the user's own permissions in the company
   *  (`scopesFromPermissions`). */
  scopes: Record<string, string[]>;
}

export const base = os.$context<AuthedContext>();

/**
 * A user's permissions (`getUserClaims().permissions`: module → action → company
 * ids) as the scope map the gate reads, holding only `companyId`. The OAuth
 * caller's scopes, so a connector token can do exactly what its user can do in
 * the token's company — no more.
 */
export function scopesFromPermissions(
  permissions: Record<string, Permission>,
  companyId: string
): Record<string, string[]> {
  const scopes: Record<string, string[]> = {};
  for (const [module, actions] of Object.entries(permissions)) {
    for (const [action, companyIds] of Object.entries(actions)) {
      if (companyIds.includes(companyId)) {
        scopes[`${module}_${action}`] = [companyId];
      }
    }
  }
  return scopes;
}
