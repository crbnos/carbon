/**
 * Tools excluded from MCP discovery (tool-metadata.json) and blocked at runtime.
 * Keep this list small; add only operations that must never run via /api/mcp.
 */
export const MCP_BLOCKED_TOOL_NAMES: readonly string[] = [
  "settings_seedCompany",
  // Creating a company is an account-level operation that must not be exposed
  // as an MCP tool (it would let a company-scoped token create new tenants).
  "settings_insertCompany",
  // The mirror of insertCompany: a bare `company` delete whose only argument is a
  // companyId the dispatcher fills from the caller's own key, so an empty body
  // deletes the caller's tenant. Its "internal users only" gate lives in the
  // settings ROUTE, which no API/MCP call passes through.
  "settings_deleteSubsidiary",
  // Its first parameter is a service-role (RLS-bypassing) client. Blocking keeps
  // a privileged client off the public API rather than teaching the dispatcher to
  // hand one out.
  "purchasing_getSupplierApprovalContext",
  // Internal sweep orchestration invoked by job/operation completion flows.
  // Their args require a userId the MCP executor cannot inject (AuthField has
  // no such payload field), so direct calls would only ever fail validation.
  "production_returnPickedRemaindersForOperation",
  "production_returnPickedRemaindersForJob",
  // Ungated scheduling primitive: it fires the `schedule-job` Inngest event with
  // no permission check of its own (every ERP route gates on `production` update
  // before calling it). `production_scheduleJob` is the intended MCP entry point —
  // it re-applies that gate — so the raw trigger must not be reachable via MCP.
  "production_triggerJobSchedule",
  // Bulk sales-order line insert. It has no in-app caller — it is reachable
  // only through this executor, which exposes every named export of
  // sales.service.ts. It writes lines without the sales-rule evaluation the
  // route action performs, and unlike `upsertSalesOrderLine` there is no
  // single-line path to gate.
  "sales_insertSalesOrderLines",
  // Unreachable by construction: these tables carry USER-scoped RLS
  // (`"createdBy"::uuid = auth.uid()`, migration 20260228000000_rls-refactor-3.sql),
  // but an API key authenticates by header rather than a Supabase JWT, so
  // `auth.uid()` is NULL and the predicate can never match. Blocked rather than
  // left to fail because the failure is silent for half of them — an UPDATE or
  // DELETE matching zero rows is not an error, so `deleteNote` answered 200 with
  // the row untouched. Making them work is an RLS decision, not an app-code one.
  "shared_updateNote",
  "shared_deleteNote",
  "production_deleteMaintenanceDispatchComment",
  "resources_deleteMaintenanceDispatchComment",
  "sales_updateQuoteFavorite",
  "sales_updateSalesOrderFavorite",
  "sales_updateSalesRFQFavorite",
  "purchasing_updateSupplierQuoteFavorite",
  "resources_insertTrainingCompletion"
];

export function isMcpBlockedTool(name: string): boolean {
  return MCP_BLOCKED_TOOL_NAMES.includes(name);
}
