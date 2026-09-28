import { hasPermission } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getUserClaims } from "@carbon/auth/users.server";
import { requireCompanyRecord } from "~/modules/shared/shared.server";

// The request-level gates a route action runs before its command, restated for
// the `{module}.mcp.server.ts` wrappers that publish the same command as a
// tool. An OAuth MCP caller is bounded only by RLS, and a command that runs on
// the service role or Kysely (price reconciliation, make-method pulls, MRP)
// sidesteps RLS — so the wrapper re-applies the route's `requirePermissions`
// and `requireCompanyRecord` before calling it. Failures throw a plain
// `Error`, which the dispatch layer returns to the caller as a 422 with the
// message.

type Action = "view" | "create" | "update" | "delete";

/**
 * The route's `requirePermissions({ [action]: module })` (and optional
 * `role: "employee"`) for the calling user.
 */
export async function requireToolPermission(
  userId: string,
  companyId: string,
  module: string,
  action: Action,
  what: string,
  options: { employee?: boolean } = {}
): Promise<void> {
  const claims = await getUserClaims(userId, companyId);
  if (!hasPermission(claims?.permissions, module, action, companyId)) {
    throw new Error(
      `You do not have permission to ${what} (${module} ${action}).`
    );
  }
  if (options.employee && claims?.role !== "employee") {
    throw new Error(`Only employees can ${what}.`);
  }
}

/**
 * The route's `requireCompanyRecord(serviceRole, …)`: a row of `table` in
 * `companyId` must match every column in `match`. Throws `"<label> not found."`
 * instead of the route's 404 Response.
 */
export async function requireToolCompanyRecord(
  table: Parameters<typeof requireCompanyRecord>[1],
  companyId: string,
  match: { id: string } & Record<string, string>,
  label: string
): Promise<void> {
  try {
    await requireCompanyRecord(getCarbonServiceRole(), table, companyId, match);
  } catch (err) {
    if (err instanceof Response) throw new Error(`${label} not found.`);
    throw err;
  }
}
