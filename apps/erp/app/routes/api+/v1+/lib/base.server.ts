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

/** Errors a service raises deliberately are worth reporting; the ones the JS
 *  runtime raises for us mean Carbon has a bug and must stay opaque. */
const PROGRAMMING_ERRORS: ReadonlyArray<Function> = [
  TypeError,
  ReferenceError,
  RangeError,
  SyntaxError
];

/**
 * Turn a service's deliberate `throw new Error(...)` into a 422 that carries its
 * message.
 *
 * Carbon's services are meant to return the Supabase `{ data, error }` envelope
 * (dispatchOperation maps that to a 400 with the Postgres detail), but ~51 of
 * them throw instead — "Purchase order line not found", "Invalid type: x",
 * "No labels provided". oRPC's `toORPCError` rewrites any non-ORPCError throw to
 * INTERNAL_SERVER_ERROR and keeps the message only as `cause`, which the encoder
 * never serializes. So HTTP answered a bad id with an opaque 500 while the same
 * call over MCP returned the real text — `callOperation` catches and reads
 * `err.message` itself. This closes that gap at the one point both surfaces share.
 *
 * Classification is by constructor because the ERP service layer has no domain
 * error class: a plain `Error` was written by a person and is safe to surface (their
 * messages carry ids and enum values, never credentials); a `TypeError` and friends
 * mean a real defect, so those keep their 500 with the detail withheld.
 *
 * Deliberately does NOT attach `data.supabase` — `callOperation` keys its
 * `Database error:` envelope off that field, and MCP's output must not change.
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
