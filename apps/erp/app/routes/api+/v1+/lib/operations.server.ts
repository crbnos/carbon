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
