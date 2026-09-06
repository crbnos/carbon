// The operation catalog for the Carbon API v1 surface. Reads the generated MCP
// manifest (tool-metadata.json) and shapes it for the oRPC router and the MCP/agent
// bridges — a single source of truth for HTTP and MCP.
//
// (Decision 7's build-time relocation of this manifest into @carbon/api is deferred
// to Docs Phase 2; see the plan. For now the committed manifest is the source.)

import type { ManifestEntry } from "@carbon/api";
import raw from "../../mcp+/lib/tool-metadata.json";

export const OPERATIONS = (raw as { tools: ManifestEntry[] }).tools;

/** operation name (`module_func`) → entry. */
export const operationsByName = new Map<string, ManifestEntry>(
  OPERATIONS.map((op) => [op.name, op])
);

/** The bare operation id (the name without its `module_` prefix). */
export function operationId(op: ManifestEntry): string {
  return op.name.slice(op.module.length + 1);
}
