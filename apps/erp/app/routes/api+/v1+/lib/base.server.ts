// oRPC context + middleware shared by the HTTP transport and the MCP/agent bridges.

import type { ManifestEntry, ToolPermission } from "@carbon/api";
import { getUserClaims } from "@carbon/auth/users.server";
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
  /** `"api-key"` runs the per-operation scope gate. `"oauth"` (MCP connector)
   *  normally relies on its user-scoped RLS client; service-role operations are
   *  explicitly checked by the gate. `"session"` is an already-authorized
   *  in-process caller (the in-app agent behind the route's requirePermissions, and
   *  the workflow engine acting as the workflow's owner) — not `"oauth"` because
   *  that names a wire protocol, not a trust decision. */
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

// An operation whose service params include `db` is handed a server-owned Kysely
// client by the dispatcher (see dispatchOperation), and that client bypasses RLS.
// Every other operation runs as the OAuth caller's user-scoped client, where RLS
// IS the permission check — which is why the scope gate is skipped for oauth.
// So a DB-backed operation must pass the user-permission check explicitly, or a
// connector caller could reach it without holding the operation's permission.
// Derived from the manifest, not a hand-kept name list: a new DB-backed operation
// cannot silently skip the check. The check mirrors requirePermissions:
// permissions are exact company grants; the removed "0" wildcard is not accepted.
function usesServerOwnedDatabase(meta: ManifestEntry): boolean {
  return meta.serviceParams.includes("db");
}

async function assertOAuthServiceRolePermission(
  context: AuthedContext,
  meta: ManifestEntry
): Promise<void> {
  if (!usesServerOwnedDatabase(meta)) return;
  const module = meta.permission.module;
  if (module === null) return;

  const claims = await getUserClaims(context.userId, context.companyId);
  const missingAction = meta.permission.actions.find(
    (action) =>
      !claims.permissions[module]?.[action]?.includes(context.companyId)
  );

  if (missingAction) {
    throw new ORPCError("FORBIDDEN", {
      message: `OAuth caller lacks the required permission: ${module}_${missingAction}`
    });
  }
}

/** Per-operation gate middleware — runs the scope check for API-key callers and
 *  the explicit user-permission check for OAuth operations that bypass RLS.
 *  Session callers are already-authorized in-process callers and remain
 *  intentionally unchanged here. The blocked-name guard is belt-and-braces:
 *  blocked tools are already excluded from the manifest at generation time, so
 *  this only fires if that exclusion ever regresses — the surface stays closed
 *  instead of silently opening. */
export const gate = (meta: ManifestEntry) =>
  base.middleware(async ({ context, next }) => {
    if (isMcpBlockedTool(meta.name)) throw new ORPCError("NOT_FOUND");
    if (context.authKind === "api-key") {
      assertScopes(context.scopes, context.companyId, meta.permission);
    } else if (context.authKind === "oauth") {
      await assertOAuthServiceRolePermission(context, meta);
    }
    return next();
  });

const PROGRAMMING_ERRORS: ReadonlyArray<Function> = [
  TypeError,
  ReferenceError,
  RangeError,
  SyntaxError
];

/**
 * Turn a service's deliberate `throw new Error(...)` into a 422 carrying its
 * message; oRPC would otherwise rewrite it to an opaque 500 with the text only
 * in `cause`, which the encoder never serializes.
 *
 * Classification is by constructor because the ERP service layer has no domain
 * error class: a plain `Error` was written by a person; a `TypeError` and friends
 * mean a real defect, so those keep their 500 with the detail withheld.
 *
 * Must NOT attach `data.supabase` — `callOperation` keys its `Database error:`
 * envelope off that field, so adding it would silently change MCP output.
 */
export const mapThrownErrors = base.middleware(async ({ next }) => {
  try {
    return await next();
  } catch (err) {
    if (err instanceof ORPCError) throw err;
    if (
      err instanceof Error &&
      !PROGRAMMING_ERRORS.some((ctor) => err instanceof ctor)
    ) {
      throw new ORPCError("UNPROCESSABLE_CONTENT", {
        message: err.message,
        cause: err
      });
    }
    throw err;
  }
});
