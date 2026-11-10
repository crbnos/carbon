// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// oRPC context + middleware shared by the HTTP transport and the MCP/agent bridges.

import type { Database } from "@carbon/database";
import type { ExpandedClaims } from "@carbon/database/access";
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
  /** The key's grants, or for a user (OAuth, a workflow's owner) the user's
   *  own, as `authorize` expands them (`<page>` → action → company ids). */
  permissions: ExpandedClaims;
  /** The user's role in the company, as their entry point resolved it; `null`
   *  for an API key. */
  role: "employee" | null;
}

export const base = os.$context<AuthedContext>();
