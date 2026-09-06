// oRPC context + middleware shared by the HTTP transport and the MCP/agent bridges.

import type { ManifestEntry, ToolPermission } from "@carbon/api";
import type { Database } from "@carbon/database";
import { ORPCError, os } from "@orpc/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMcpBlockedTool } from "../../mcp+/lib/mcp-blocked-tools";

/**
 * The identity every Carbon API call runs as. Built once per request (from an API
 * key on HTTP, or from the resolved MCP/agent auth) and injected as oRPC context;
 * the service dispatch reads `client`/`companyId`/`userId`/`companyGroupId` from it.
 */
export interface AuthedContext {
  client: SupabaseClient<Database>;
  userId: string;
  companyId: string;
  companyGroupId: string;
  /** `"api-key"` runs the per-operation scope gate. `"oauth"` (MCP connector) does
   *  not — its RLS/role already bounds it, exactly as MCP behaves today. `"session"`
   *  is an already-authorized in-process caller (the in-app agent behind the route's
   *  requirePermissions, and the workflow engine acting as the workflow's owner) —
   *  not "oauth" because that names a wire protocol, not a trust decision. */
  authKind: "api-key" | "oauth" | "session";
  /** The API key's scopes: `{ "<module>_<action>": [companyId, …] }`. */
  scopes: Record<string, string[]>;
}

export const base = os.$context<AuthedContext>();

/**
 * Enforce that an API-key caller holds the operation's permission. `module: null`
 * gates only on a valid key of the company (today's MCP behavior for account/shared);
 * otherwise every action in the permission must be scoped to the active company.
 * The exact-companyId check (no `"0"` wildcard) matches requirePermissions' key path.
 */
export function assertScopes(
  scopes: Record<string, string[]>,
  companyId: string,
  permission: ToolPermission
): void {
  if (permission.module === null) return;
  for (const action of permission.actions) {
    const key = `${permission.module}_${action}`;
    if (!scopes[key]?.includes(companyId)) {
      throw new ORPCError("FORBIDDEN", {
        message: `API key lacks the required scope: ${key}`
      });
    }
  }
}

/** Per-operation gate middleware — runs the scope check for API-key callers.
 *  The blocked-name guard is belt-and-braces: blocked tools are already excluded
 *  from the manifest at generation time, so this only fires if that exclusion
 *  ever regresses — the surface stays closed instead of silently opening. */
export const gate = (meta: ManifestEntry) =>
  base.middleware(async ({ context, next }) => {
    if (isMcpBlockedTool(meta.name)) throw new ORPCError("NOT_FOUND");
    if (context.authKind === "api-key") {
      assertScopes(context.scopes, context.companyId, meta.permission);
    }
    return next();
  });
