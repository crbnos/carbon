import type { McpToolAnnotation, McpToolFn } from "./types";

// Build-time-only marker. The wrapper is a runtime no-op: it returns the
// function unchanged. The annotation literal is read by the manifest
// generator's AST walk at build time and emitted into mcp-tools.json; the
// runtime executor looks tools up by name from that JSON, not from any
// in-memory registry.
//
// Keep the wrapper for two reasons:
//   1. It's the syntactic marker the AST generator scans for.
//   2. Removing it from every call site would be a churn-only codemod.
export function mcpTool<F extends McpToolFn>(
  _annotation: McpToolAnnotation,
  fn: F
): F {
  return fn;
}
