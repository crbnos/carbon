/**
 * Tools excluded from MCP discovery (tool-metadata.json) and blocked at runtime.
 * Keep this list small; add only operations that must never run via /api/mcp.
 */
export const MCP_BLOCKED_TOOL_NAMES: readonly string[] = [
  "settings_seedCompany",
  // Creating a company is an account-level operation that must not be exposed
  // as an MCP tool (it would let a company-scoped token create new tenants).
  "settings_insertCompany",
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
  "sales_insertSalesOrderLines"
];

export function isMcpBlockedTool(name: string): boolean {
  return MCP_BLOCKED_TOOL_NAMES.includes(name);
}
