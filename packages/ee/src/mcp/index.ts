// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Copyright (C) Carbon Manufacturing Systems Corporation.
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// The PURE MCP logic (`@carbon/ee/mcp`): catalog + doc search, result/description
// formatting, connect-time instructions, and the shared types. It pulls in NO
// auth/entitlement chain, so tests and the app route can import these helpers
// without loading the server (`@carbon/ee/mcp.server` → `server.ts`, which embeds
// the `requireEntitlement` lock and its heavier dependency graph).
export * from "./catalog-search";
export * from "./describe-format";
export * from "./doc-search";
export * from "./format-result";
export * from "./instructions";
export * from "./types";
