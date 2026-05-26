// Tools that must never be exposed via MCP, regardless of accidental
// registration. Enforced by both the registry (registration is skipped) and
// the executor (defence in depth — `execute()` rejects with FORBIDDEN). Add
// to this set instead of relying on "just don't wrap it with mcpTool()".
export const BLOCKED_TOOL_IDS: ReadonlySet<string> = new Set([
  "settings_seedCompany"
]);
