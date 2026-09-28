// The PURE MCP logic (`@carbon/ee/mcp`): catalog search, result/description
// formatting, connect-time instructions, and the shared types. It pulls in NO
// auth/entitlement chain, so tests and the app route can import these helpers
// without loading the server (`@carbon/ee/mcp.server` → `server.ts`, which embeds
// the `requireEntitlement` lock and its heavier dependency graph).
export * from "./catalog-search";
export * from "./describe-format";
export * from "./format-result";
export * from "./instructions";
export * from "./types";
