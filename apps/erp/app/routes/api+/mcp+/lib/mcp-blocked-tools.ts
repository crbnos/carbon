/**
 * Tools excluded from MCP discovery (tool-metadata.json) and blocked at runtime.
 * Keep this list small; add only operations that must never run via /api/mcp.
 */
export const MCP_BLOCKED_TOOL_NAMES: readonly string[] = [
  "settings_seedCompany",
  // Internal sweep orchestration invoked by job/operation completion flows.
  // Their args require a userId the MCP executor cannot inject (AuthField has
  // no such payload field), so direct calls would only ever fail validation.
  "production_returnPickedRemaindersForOperation",
  "production_returnPickedRemaindersForJob"
];

export function isMcpBlockedTool(name: string): boolean {
  return MCP_BLOCKED_TOOL_NAMES.includes(name);
}
