// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Which service functions may become MCP / v1-API tools.
 *
 * Exposure used to be opt-OUT: every exported function of a `*.service.ts`
 * became a tool, and `MCP_BLOCKED_TOOL_NAMES` took them back one at a time.
 * That list reached 18 entries against a surface of 1557 tools — 1% — and its
 * own comments record the pattern: `sales_insertSalesOrderLines` was blocked
 * because it "has no in-app caller … and writes lines without the sales-rule
 * evaluation the route action performs", `production_triggerJobSchedule`
 * because the gate every ERP route applies lives in the route, not the
 * function. Those are incidents, found after the fact, in a surface where 211
 * tools had no in-app caller at all and 103 of those were WRITE or DESTRUCTIVE.
 *
 * So a function that CHANGES data is now opt-IN.
 */

/**
 * Modules whose functions may be exposed at all. A module absent here exposes
 * nothing, whatever its functions are tagged with — the coarse gate, so taking
 * a whole domain off the API is one line rather than a tagging sweep.
 */
export const MCP_MODULE_ALLOWLIST: readonly string[] = [
  "account",
  "accounting",
  "documents",
  "inventory",
  "invoicing",
  "items",
  "people",
  "production",
  "purchasing",
  "quality",
  "resources",
  "sales",
  "settings",
  "shared",
  "users"
];

/**
 * The JSDoc tag that opts a data-CHANGING function in. The generator reads it
 * off the declaration's parsed doc tags (`scripts/lib/service-ast.ts`), never
 * off the comment's text, so prose that mentions "@mcp" does not count.
 *
 * Required for WRITE and DESTRUCTIVE only. READs stay opt-out: they are 802 of
 * the 1557 tools, they are bounded by the caller's own RLS and module
 * permission, and no entry on the blocked list is a plain read — every incident
 * has been a write or an orchestration primitive. Requiring the tag on reads
 * would mean tagging 800 functions to reduce no risk.
 */
export const MCP_EXPOSURE_TAG = "@mcp";

/** Classifications that require {@link MCP_EXPOSURE_TAG} to be exposed. */
export const MCP_TAG_REQUIRED_FOR: readonly string[] = ["WRITE", "DESTRUCTIVE"];

/**
 * The tag may also DECLARE the classification — `@mcp read`, `@mcp write`,
 * `@mcp destructive` — which wins over what the generator infers.
 *
 * Classification is not cosmetic. It drives the permission actions a caller
 * must hold (READ → view), the injected auth fields (READ → companyId only),
 * and whether the function needs the tag at all. A read inferred WRITE
 * over-demands permission: `items_diffMethod` diffs two methods and would ask
 * for `parts:update`, locking out an API key scoped to `view`.
 *
 * A declaration is verified against the function's body and a contradiction
 * fails generation, so it cannot quietly downgrade a real write.
 */
export const MCP_DECLARED_CLASSIFICATIONS = {
  read: "READ",
  write: "WRITE",
  destructive: "DESTRUCTIVE"
} as const;
