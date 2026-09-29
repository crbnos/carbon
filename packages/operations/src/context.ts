import type { Database } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Kysely, sql } from "kysely";

/**
 * Everything an operation runs with. The caller builds it; the DB client comes
 * from `getDatabaseClient()` (ERP/MES) or `getJobDatabaseClient()` (jobs) and is
 * never constructed here.
 */
export type OperationContext = {
  db: Kysely<KyselyDatabase>;
  companyId: string;
  userId: string;
  /**
   * Set by server-side callers with no signed-in user behind them (Inngest jobs,
   * accounting syncers): the counterpart of the service-role bearer the edge
   * functions trusted. Never derive it from request input.
   */
  system?: boolean;
};

type Action = "view" | "create" | "update" | "delete";

/** `{ update: "inventory" }` — the same shape the edge functions passed to requirePermissions. */
export type RequiredPermissions = Partial<Record<Action, string | string[]>>;

/** A user's claims per module: the company ids holding each action. */
export type ModulePermissions = Record<string, Record<Action, string[]>>;

export class OperationForbiddenError extends Error {
  readonly status = 403;
}

const ACTIONS: Action[] = ["view", "create", "update", "delete"];

/**
 * Whether `claims` grant every required `<module>_<action>` in `companyId`. With
 * nothing required, membership of the company (any permission naming it) is
 * still needed — as in the edge functions' requirePermissions.
 */
export function hasPermissions(
  claims: ModulePermissions,
  companyId: string,
  required: RequiredPermissions
): boolean {
  const entries = Object.entries(required) as [Action, string | string[]][];
  if (entries.length === 0) {
    return Object.values(claims).some((permission) =>
      ACTIONS.some((action) => permission[action]?.includes(companyId))
    );
  }
  return entries.every(([action, modules]) =>
    (typeof modules === "string" ? [modules] : modules).every((module) =>
      claims[module]?.[action]?.includes(companyId)
    )
  );
}

/**
 * A user's claims (the `get_claims` jsonb: `<module>_<action>` → company ids,
 * plus `role`) as permissions per module — the edge functions' parser.
 */
export function permissionsFromClaims(
  claims: Record<string, unknown>
): ModulePermissions {
  const permissions: ModulePermissions = {};
  for (const [key, value] of Object.entries(claims)) {
    const parts = key.split("_");
    if (parts.length !== 2 || !Array.isArray(value)) continue;
    const [module, action] = parts as [string, Action];
    if (!ACTIONS.includes(action)) continue;
    permissions[module] ??= { view: [], create: [], update: [], delete: [] };
    permissions[module][action] = value as string[];
  }
  return permissions;
}

/**
 * Throws `OperationForbiddenError` unless the context's user holds `required`
 * in its company. Every operation calls this (or `assertSystemCaller`) before
 * touching data: callers reach it from routes, services, the API and jobs, and
 * not every one of them checks the same permission first.
 *
 * Reads the claims with `get_claims` over `ctx.db`, as the edge functions did.
 * Not `@carbon/auth`'s cached `getUserClaims`: it lives in a `.server` module,
 * which a browser-bundled service's `import()` of an operation may not reach.
 */
export async function assertOperationPermissions(
  ctx: OperationContext,
  required: RequiredPermissions
): Promise<void> {
  if (ctx.system) return;
  const { rows } = await sql<{
    claims: Record<string, unknown> | null;
  }>`SELECT get_claims(${ctx.userId}, ${ctx.companyId}) AS claims`.execute(
    ctx.db
  );
  const permissions = permissionsFromClaims(rows[0]?.claims ?? {});
  if (!hasPermissions(permissions, ctx.companyId, required)) {
    throw new OperationForbiddenError("Insufficient permissions");
  }
}

/** For operations only servers call: refuses any context not marked `system`. */
export function assertSystemCaller(ctx: OperationContext): void {
  if (!ctx.system) {
    throw new OperationForbiddenError("Only server-side callers may run this");
  }
}

/**
 * The service-role client, which every edge function read and wrote with once
 * its permission check passed. Built here rather than passed in: callers
 * include browser-bundled `*.service.ts` files, which cannot import it, and a
 * caller's own RLS client would change what the operation can see. Same
 * construction as `getCarbonServiceRole`, which is `.server`-only.
 */
export async function serviceRoleClient(): Promise<SupabaseClient<Database>> {
  // Lazy: @carbon/env throws at import when a required variable is unset.
  const [{ getCarbonClient }, { SUPABASE_SERVICE_ROLE_KEY }] =
    await Promise.all([import("@carbon/auth"), import("@carbon/env")]);
  return getCarbonClient(SUPABASE_SERVICE_ROLE_KEY!);
}
