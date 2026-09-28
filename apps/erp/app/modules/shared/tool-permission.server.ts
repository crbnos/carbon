import { hasPermission } from "@carbon/auth";
import { getUserClaims } from "@carbon/auth/users.server";

type PermissionAction = "view" | "create" | "update" | "delete";

/**
 * The subset of a route's `requirePermissions` requirement a tool re-applies:
 * one module per action, plus an optional role (`role: "employee"`).
 */
export type ToolPermissionRequirement = Partial<
  Record<PermissionAction, string>
> & { role?: string };

/**
 * Re-apply a route's permission gate inside an MCP/API companion tool
 * (`{module}.mcp.server.ts`).
 *
 * The dispatch layer gates API-key callers on scopes, but an OAuth MCP caller
 * passes no tool-level check (`gate()` in `api+/v1+/lib/base.server.ts` runs
 * only for `authKind: "api-key"`). Row writes through the caller's Supabase
 * client are still bounded by RLS, and edge functions invoked with that client
 * run their own `requirePermissions`, so neither needs this. A companion that
 * reaches Kysely (`getDatabaseClient`), the service role, or a SECURITY DEFINER
 * RPC bypasses RLS, so it MUST call this first with the same requirement its
 * ERP route passes to `requirePermissions` (pinned by
 * `test/mcp-registry-parity.test.ts`).
 *
 * Throws a plain `Error` (mapped to a 422 with this message by the dispatch):
 * `You do not have permission to <what> (<module> <action>).`
 */
export async function requireToolPermission(
  companyId: string,
  userId: string,
  required: ToolPermissionRequirement,
  what: string
): Promise<void> {
  const claims = await getUserClaims(userId, companyId);
  for (const action of ["view", "create", "update", "delete"] as const) {
    const module = required[action];
    if (!module) continue;
    if (!hasPermission(claims?.permissions, module, action, companyId)) {
      throw new Error(
        `You do not have permission to ${what} (${module} ${action}).`
      );
    }
  }
  if (required.role && claims?.role !== required.role) {
    throw new Error(
      `You do not have permission to ${what} (${required.role} role).`
    );
  }
}
