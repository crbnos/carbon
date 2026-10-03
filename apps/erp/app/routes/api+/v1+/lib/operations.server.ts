// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The operation catalog for the Carbon API v1 surface. Reads the generated MCP
// manifest (tool-metadata.json) and shapes it for the oRPC router and the MCP/agent
// bridges — a single source of truth for HTTP and MCP.
//
// (Decision 7's build-time relocation of this manifest into @carbon/api is deferred
// to Docs Phase 2; see the plan. For now the committed manifest is the source.)

import type { ManifestEntry } from "@carbon/api";
import raw from "../../mcp+/lib/tool-metadata.json";

export const OPERATIONS = (raw as { tools: ManifestEntry[] }).tools;

const companyTables = (raw as { companyTables?: string[] }).companyTables;
// The dispatcher confines every write to the caller's company by this list
// (`scopedToCompany`). An empty one would switch that off without a sound, so
// a manifest generated before the list existed stops the module loading.
if (!Array.isArray(companyTables) || companyTables.length === 0) {
  throw new Error(
    "tool-metadata.json has no companyTables. Regenerate it: pnpm run generate:mcp"
  );
}

/** Every table with a `companyId` column, from the generated database types. */
export const COMPANY_TABLES: ReadonlySet<string> = new Set(companyTables);

/**
 * Deprecated operation names → the operation that replaced them. An operation's
 * name is derived from the module its service lives in, so moving a function
 * between modules renames the published operation; an entry here keeps the old
 * name working for MCP `call_tool`/`describe_tool`, the agent, workflows and
 * `POST /api/v1/{module}/{operation}`. The alias runs the NEW operation in full —
 * its schema, its dispatch and its permission — so it grants nothing the new name
 * does not. Aliases are never listed in the catalog (search, docs); the OpenAPI
 * spec carries them marked `deprecated`.
 */
export const OPERATION_ALIASES: Readonly<Record<string, string>> = {
  // Inspection plans moved from production to quality.
  production_getInspectionDocument: "quality_getInspectionDocument",
  production_getInspectionDocuments: "quality_getInspectionDocuments",
  production_getInspectionDocumentsForItem:
    "quality_getInspectionDocumentsForItem",
  production_getInspectionFeatures: "quality_getInspectionFeatures",
  production_getBalloons: "quality_getBalloons",
  production_getInspectionPlan: "quality_getInspectionPlan",
  production_saveInspectionDocumentAtomic:
    "quality_saveInspectionDocumentAtomic",
  production_updateInspectionDocumentSampling:
    "quality_updateInspectionDocumentSampling",
  production_upsertInspectionDocument: "quality_upsertInspectionDocument",
  production_deleteInspectionDocument: "quality_deleteInspectionDocument"
};

const canonicalByName = new Map<string, ManifestEntry>(
  OPERATIONS.map((op) => [op.name, op])
);

/** The aliases that resolve: a real operation of the same name always wins, and
 *  an alias whose target is gone is dropped (dispatch-parity.test.ts fails on
 *  both, so neither ships). */
export const liveOperationAliases: ReadonlyArray<[string, ManifestEntry]> =
  Object.entries(OPERATION_ALIASES).flatMap(([alias, target]) => {
    const op = canonicalByName.get(target);
    return op && !canonicalByName.has(alias)
      ? [[alias, op] as [string, ManifestEntry]]
      : [];
  });

/** operation name (`module_func`) → entry, deprecated aliases included (an alias
 *  maps to its replacement's entry, so `entry.name` is the CURRENT name). A lookup
 *  table only — iterate `OPERATIONS` for the catalog. */
export const operationsByName = new Map<string, ManifestEntry>([
  ...canonicalByName,
  ...liveOperationAliases
]);

/** The bare operation id (the name without its `module_` prefix). */
export function operationId(op: ManifestEntry): string {
  return op.name.slice(op.module.length + 1);
}

/**
 * Whether an operation's HTTP response is the LIST envelope `{ results, count }`
 * or the bare payload.
 *
 * The old contract wrapped everything, which stacked our envelope under every
 * generated client's own result wrapper — callers wrote `res.data.data.field`.
 * The Stripe convention fixes it: single results are the body itself; only list
 * results carry an envelope, because `count` means something there.
 *
 * Decided STATICALLY from the reflected response schema so the runtime shaping
 * (router handler), the reverse mapping (`callOperation`), and the published
 * output schema can never disagree. An operation with no reflected schema is
 * treated as bare — those are `any`/void shapes with no pagination.
 */
export function isListOperation(op: ManifestEntry): boolean {
  const type = (op.responseSchema as { type?: string | string[] } | undefined)
    ?.type;
  return type === "array" || (Array.isArray(type) && type.includes("array"));
}

/**
 * The success body over HTTP. Single results are the payload itself — wrapping
 * everything in `{ data }` stacked our envelope under every generated client's own
 * result wrapper, so callers wrote `res.data.data.field`. Lists keep the envelope
 * because `count` belongs there (the Stripe convention). Keyed off
 * `isListOperation` — the same bit `shapeHttpBody` and `callOperation` use — so the
 * published schema and the runtime behavior cannot drift.
 */
export function outputSchema(op: ManifestEntry): Record<string, unknown> {
  if (!isListOperation(op)) return op.responseSchema ?? {};
  return {
    type: "object",
    properties: {
      results: op.responseSchema ?? {},
      count: {
        type: ["number", "null"],
        description: "Total matching rows, present on paginated reads."
      }
    },
    required: ["results"]
  };
}

/** Shape a dispatch result into the HTTP body `outputSchema` promises. */
export function shapeHttpBody(
  op: ManifestEntry,
  result: { data: unknown; count?: number }
): unknown {
  // `results`, not `data`: generated clients wrap responses in their own `.data`,
  // so an envelope field named `data` reads back as `res.data.data`.
  return isListOperation(op)
    ? { results: result.data, count: result.count ?? null }
    : result.data;
}

/**
 * Reverse of `shapeHttpBody`, for the non-HTTP callers (MCP, agent, workflows)
 * that need DispatchResult semantics back. Keyed off the same static bit — never
 * value sniffing, which would mis-unwrap a payload that happens to carry a
 * `data` key.
 */
export function unshapeHttpBody(
  op: ManifestEntry,
  body: unknown
): { data: unknown; count?: number } {
  if (!isListOperation(op)) return { data: body };
  const envelope = body as { results: unknown; count: number | null };
  return {
    data: envelope.results,
    ...(envelope.count !== null ? { count: envelope.count } : {})
  };
}
