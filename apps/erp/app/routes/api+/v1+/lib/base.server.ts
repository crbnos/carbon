// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// oRPC context + middleware shared by the HTTP transport and the MCP/agent bridges.

import type { ManifestEntry, ToolPermission } from "@carbon/api";
import type { Permission } from "@carbon/auth";
import type { Database } from "@carbon/database";
import { ORPCError, os } from "@orpc/server";
import type { SupabaseClient } from "@supabase/supabase-js";

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
  /** How the caller authenticated. Every kind runs the per-operation scope gate:
   *  RLS alone does not bound a caller, because a service handed `db` writes
   *  through the direct connection, which bypasses it. `"session"` is an
   *  in-process caller acting as a user (the workflow engine acting as the
   *  workflow's owner) — not "oauth" because that names a wire protocol. */
  authKind: "api-key" | "oauth" | "session";
  /** `{ "<module>_<action>": [companyId, …] }` — the API key's scopes, or for a
   *  user (OAuth, a workflow's owner) the user's own permissions in the company
   *  (`scopesFromPermissions`). */
  scopes: Record<string, string[]>;
}

export const base = os.$context<AuthedContext>();

/**
 * Enforce that the caller holds the operation's permission. `module: null` gates
 * only on an authenticated caller of the company (today's MCP behavior for
 * account/shared); otherwise every action in the permission must be scoped to the
 * active company. The exact-companyId check (no `"0"` wildcard) matches
 * requirePermissions' key path.
 */
export function assertScopes(
  scopes: Record<string, string[]>,
  companyId: string,
  permission: ToolPermission,
  authKind: AuthedContext["authKind"]
): void {
  if (permission.module === null) return;
  for (const action of permission.actions) {
    const key = `${permission.module}_${action}`;
    if (!scopes[key]?.includes(companyId)) {
      throw new ORPCError("FORBIDDEN", {
        message:
          authKind === "api-key"
            ? `API key lacks the required scope: ${key}`
            : authKind === "session"
              ? `The workflow's owner does not have the required permission: ${key}`
              : `You do not have the required permission: ${key}`
      });
    }
  }
}

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

/** Per-operation gate middleware — runs the scope check for every caller. */
export const gate = (meta: ManifestEntry) =>
  base.middleware(async ({ context, next }) => {
    assertScopes(
      context.scopes,
      context.companyId,
      meta.permission,
      context.authKind
    );
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
