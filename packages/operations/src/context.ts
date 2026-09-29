import type { Database } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Kysely } from "kysely";

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
 * Throws `OperationForbiddenError` unless the context's user holds `required`
 * in its company. Every operation calls this (or `assertSystemCaller`) before
 * touching data: callers reach it from routes, services, the API and jobs, and
 * not every one of them checks the same permission first.
 */
export async function assertOperationPermissions(
  ctx: OperationContext,
  required: RequiredPermissions
): Promise<void> {
  if (ctx.system) return;
  // Lazy: users.server pulls Redis and the service-role client, which a
  // `*.service.ts` importing this package must not load at module scope.
  const { getUserClaims } = await import("@carbon/auth/users.server");
  const { permissions } = await getUserClaims(ctx.userId, ctx.companyId);
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
 * its permission check passed. Fetched here rather than passed in: callers
 * include browser-bundled `*.service.ts` files, which cannot import it, and a
 * caller's own RLS client would change what the operation can see.
 */
export async function serviceRoleClient(): Promise<SupabaseClient<Database>> {
  const { getCarbonServiceRole } = await import("@carbon/auth/client.server");
  return getCarbonServiceRole();
}
