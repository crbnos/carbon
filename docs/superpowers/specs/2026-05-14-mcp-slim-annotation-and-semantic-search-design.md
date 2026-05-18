# MCP — Slim Annotation + Semantic `search_tools`

**Date:** 2026-05-14
**Status:** Draft — pending implementation plan
**Builds on:** `2026-05-13-mcp-manifest-embeddings-design.md` (manifest + embeddings pipeline, already implemented)

## 1. Overview

Two tightly-coupled changes, shipped together:

1. **Slim the `mcpTool({...})` annotation.** Remove fields that duplicate information already encoded in the function signature or file location: `name`, `module`, `argOrder`. These are recovered by the build-time AST parser. The annotation keeps only fields the parser cannot honestly infer.
2. **Replace `search_tools` in-memory substring match with semantic vector search.** Same MCP tool name, same input schema (filters preserved), new implementation: embed the query via Ollama and rank against the existing `mcpToolEmbedding` table.

The two ship together because the slim annotation changes the shape of every `mcpTool(...)` call site (~1000+ tools), and the generator emits a single artifact that both `mcp-tools.json` and a new `mcp-tools.generated.ts` (runtime registration) consume. Doing them separately would either ship a churn-only PR (rename across 1000 files) or a feature whose data model doesn't match the eventual annotation shape.

## 2. Goals

- Eliminate annotation/source duplication (`name`, `module`, `argOrder`).
- Make annotation/signature drift impossible by construction.
- Replace the substring-match `search_tools` with semantic search that uses the embeddings pipeline already built.
- Constrain Ollama: model loaded lazily on first request, single-flight (no concurrent loads, no preload).
- No new MCP route, no new MCP tool — the change lives entirely inside the existing `search_tools` registration in `server.ts`.

## 3. Annotation shape

**Before:**

```ts
export const getAllAttributeCategories = mcpTool(
  {
    module: MODULE,
    name: "getAllAttributeCategories",
    argOrder: ["client", "userId", "companyId"],
    classification: "READ",
    description: "get all attribute categories",
    injectAuth: ["companyId"],
    paramSchema: z.unknown(),
  },
  async function getAllAttributeCategories(client, userId, companyId) { ... }
);
```

**After:**

```ts
export const getAllAttributeCategories = mcpTool(
  {
    classification: "READ",
    description: "get all attribute categories",
    injectAuth: ["companyId"],
    paramSchema: z.unknown(),
  },
  async function getAllAttributeCategories(client, userId, companyId) { ... }
);
```

### Fields removed from the annotation

| Field | Recovery |
|---|---|
| `name` | `fn.name` (the named function expression) at parse time + runtime |
| `module` | dirname of `*.service.ts` file (`apps/erp/app/modules/<module>/<module>.service.ts`) |
| `argOrder` | parameter list of the function declaration, parsed via `ts-morph` |

### Fields kept (and why each cannot be safely inferred)

| Field | Reason |
|---|---|
| `classification` | security policy — READ vs WRITE vs DESTRUCTIVE is a deliberate choice |
| `description` | the LLM-facing sentence + embedding input; meaningful prose, not derivable |
| `injectAuth` | which identity fields to stamp; security-critical, name-prefix heuristics historically caused real bugs |
| `paramSchema` | runtime payload validation contract |
| `injectInto?` | opt-in override for nested identity injection |
| `disable?` | opt-out flag |

The `McpToolAnnotation` TS type narrows to exactly these six fields. `McpToolMetadata` (registry row shape) is unchanged — `name`, `module`, `id`, `argOrder`, `optional`, `hasArgsParam` still appear there because the executor needs them; they are populated at registration time from the parsed metadata, not from the annotation.

### Runtime registration path

Today every service file calls `mcpTool({...}, fn)` at module-import time, and the wrapper does `registry.register(annotation, fn)`. With the slim annotation, the wrapper alone cannot produce a complete `McpToolMetadata` because `argOrder` is no longer in the annotation, and parsing `fn.toString()` is fragile under transpilation/minification.

Resolution: the generator emits **`apps/erp/app/services/mcp/mcp-tools.generated.ts`** alongside `mcp-tools.json`. The generated file is committed and contains:

```ts
// AUTO-GENERATED. Do not edit by hand. Source of truth: mcpTool() call sites.
import { registerParsed } from "./registry";
import * as account from "~/modules/account/account.service";
// ...one import per module

export function registerAll(): void {
  registerParsed(account.getAccount, {
    module: "account",
    name: "getAccount",
    argOrder: ["client", "id"],
  });
  // ...one line per tool
}
```

- `registerParsed(fn, parsed)` is a new registry entry point that takes the **function** and the **parsed metadata** the generator extracted (module, name, argOrder). The function carries its slim annotation via a non-enumerable symbol property (set by the wrapper); `registerParsed` merges the two into a full `McpToolMetadata`.
- `bootstrap.ts` changes from importing service modules to calling `registerAll()`. The pre-existing module imports still happen — they're triggered transitively by the generated file's `import * as account from ...` — so the wrapper's side-effect tagging still runs.
- HMR remains supported: the registry's duplicate-id behavior (dev: warn, prod: throw) is unchanged.

The wrapper becomes:

```ts
const MCP_TAG = Symbol.for("mcp.tool.annotation");

export function mcpTool<F extends McpToolFn>(annotation: McpSlimAnnotation, fn: F): F {
  Object.defineProperty(fn, MCP_TAG, { value: annotation, enumerable: false });
  return fn;
}
```

Note: the wrapper no longer registers eagerly. Registration happens via `registerAll()` driven by the generated file. This means the **only** way a tool gets into the registry is through the manifest generator — making drift between source and registry impossible.

### Build-time AST parsing (generator)

The existing `scripts/generate-mcp-manifest.ts` already does static AST parsing. It evolves to:

1. Walk every `apps/erp/app/modules/<module>/<module>.service.ts`.
2. For each `mcpTool({...}, fn)` call:
   - Extract the slim annotation literal (`classification`, `description`, `injectAuth`, `injectInto?`, `disable?`).
   - Read `fn.name` from the function expression (must be a named function or named export; the parser fails loudly if anonymous).
   - Read `argOrder` by parsing the function's parameter list (handles `?` for optional, errors on destructured params).
   - Compute `module` from the file path.
3. Emit two artifacts:
   - `apps/erp/app/services/mcp/mcp-tools.json` — embedding payload (unchanged shape from the previous spec, minus what's now derivable).
   - `apps/erp/app/services/mcp/mcp-tools.generated.ts` — runtime registration.
4. Both artifacts are committed; pre-commit hook (already present) regenerates and fails on drift.

## 4. Semantic `search_tools`

### Behavior

`server.ts` `search_tools` registration (currently lines 181–257) is replaced.

**Input schema (unchanged):**

```ts
z.object({
  query: z.string().optional(),
  module: z.string().optional(),
  classification: z.enum(["READ", "WRITE", "DESTRUCTIVE"]).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
})
```

**Behavior:**

- **`query` provided** → embed via Ollama, vector search against `mcpToolEmbedding` joined to `mcpToolVersion` (only `isActive` rows), apply `module`/`classification` filters in SQL, order by cosine distance, paginate.
- **`query` absent** → no embedding work; query `mcpToolVersion` directly, ordered by `toolId`, apply filters, paginate. Matches today's behavior.

**Output text** is unchanged — same grouped-by-module format, same usage hint footer.

### Ollama constraints

The query embedding call must obey:

1. **No preload.** Ollama models are not warmed at app boot.
2. **At most one instance / single-flight.** Concurrent `search_tools` calls share one in-flight embedding request rather than firing N parallel calls that each trigger a model load.

Implementation: a module-scoped singleton in `apps/erp/app/services/mcp/embedQuery.ts`:

```ts
let inFlight: Promise<number[]> | null = null;
let inFlightKey: string | null = null;

export async function embedQuery(text: string): Promise<number[]> {
  const key = text;
  if (inFlightKey === key && inFlight) return inFlight;
  inFlightKey = key;
  inFlight = doEmbed(text).finally(() => {
    if (inFlightKey === key) { inFlight = null; inFlightKey = null; }
  });
  return inFlight;
}
```

Two distinct query strings issued concurrently get two requests, but each unique string is single-flighted. The deduplication window is the lifetime of the request — short and bounded, so no stale-cache problem. Ollama serves the second concurrent request itself; we just don't pile-up if a popular query lands twice in the same tick.

### DB-side search

A new SQL RPC `search_mcp_tools(query_embedding vector(768), filter_module text, filter_classification text, result_limit int, result_offset int)` returns `(toolId, module, name, description, classification, distance)` ordered by `embedding <=> query_embedding` (cosine distance). Joined: `mcpToolVersion v INNER JOIN mcpToolEmbedding e ON e.toolVersionId = v.id WHERE v.isActive`. Filters applied with `AND`. The RPC is `SECURITY DEFINER` and granted to `service_role` only — the ERP server-side caller already uses service-role.

This goes into a new migration `20260514120000_mcp-search-rpc.sql`.

### Code path in `server.ts`

`search_tools` handler becomes (sketch):

```ts
withErrorHandling(async (params: any) => {
  const { query, module, classification, limit = 20, offset = 0 } = params;
  let rows: SearchRow[];
  if (query?.trim()) {
    const embedding = await embedQuery(query.trim());
    const { data, error } = await client.rpc("search_mcp_tools", {
      query_embedding: embedding,
      filter_module: module ?? null,
      filter_classification: classification ?? null,
      result_limit: limit,
      result_offset: offset,
    });
    if (error) throw new Error(error.message);
    rows = data;
  } else {
    rows = await listActive(client, { module, classification, limit, offset });
  }
  return formatSearchOutput(rows);
})
```

`formatSearchOutput` keeps today's output verbatim (grouping, footer, totalResults). `totalResults` for the semantic path is `rows.length` clamped against a separate count query; semantic search without a total page count is acceptable but we'll do a cheap `COUNT(*) FILTER (...)` in the same RPC to preserve the existing UX. (Decision recorded; if performance hurts, drop to just `rows.length`.)

## 5. Database changes

New migration `packages/database/supabase/migrations/20260514120000_mcp-search-rpc.sql`:

```sql
BEGIN;

CREATE OR REPLACE FUNCTION public.search_mcp_tools(
  query_embedding vector,
  filter_module text DEFAULT NULL,
  filter_classification text DEFAULT NULL,
  result_limit int DEFAULT 20,
  result_offset int DEFAULT 0
)
RETURNS TABLE (
  "toolId"         text,
  "module"         text,
  "name"           text,
  "description"    text,
  "classification" text,
  "distance"       float,
  "totalCount"     bigint
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  WITH filtered AS (
    SELECT v.*, e."embedding"
    FROM "mcpToolVersion" v
    INNER JOIN "mcpToolEmbedding" e ON e."toolVersionId" = v."id"
    WHERE v."isActive"
      AND (filter_module IS NULL OR v."module" = filter_module)
      AND (filter_classification IS NULL OR v."classification" = filter_classification)
  ),
  total AS (SELECT count(*) AS c FROM filtered)
  SELECT
    f."toolId", f."module", f."name", f."description", f."classification",
    (f."embedding" <=> query_embedding)::float AS distance,
    (SELECT c FROM total) AS "totalCount"
  FROM filtered f
  ORDER BY f."embedding" <=> query_embedding
  LIMIT result_limit OFFSET result_offset;
$$;

GRANT EXECUTE ON FUNCTION public.search_mcp_tools(vector, text, text, int, int) TO service_role;

COMMIT;
```

No new tables. No schema changes to existing tables.

## 6. File inventory

**Modified:**
- `apps/erp/app/services/mcp/types.ts` — narrow `McpToolAnnotation` to slim shape; keep `McpToolMetadata` as-is.
- `apps/erp/app/services/mcp/mcpTool.ts` — wrapper becomes tagger (no eager register).
- `apps/erp/app/services/mcp/registry.ts` — add `registerParsed(fn, parsed)`; existing `register(annotation, fn)` removed or kept as test-only.
- `apps/erp/app/services/mcp/bootstrap.ts` — call `registerAll()` from generated file instead of importing services directly.
- `scripts/generate-mcp-manifest.ts` — emit both `mcp-tools.json` and `mcp-tools.generated.ts`.
- `apps/erp/app/routes/api+/mcp+/lib/server.ts` — replace substring `search_tools` body with semantic path.
- Every `*.service.ts` under `apps/erp/app/modules/` — remove `name`, `module`, `argOrder` from `mcpTool({...})` calls.

**Created:**
- `apps/erp/app/services/mcp/embedQuery.ts` — Ollama call with single-flight.
- `apps/erp/app/services/mcp/mcp-tools.generated.ts` — committed generator output (registration calls).
- `packages/database/supabase/migrations/20260514120000_mcp-search-rpc.sql` — `search_mcp_tools` RPC.

**Untouched:**
- `executor.ts` (registry shape it consumes is unchanged).
- `blocked.ts`, `notifyManifestQueue.ts`, `manifest.ts`, `mcp-tools.json` schema.
- Embeddings worker edge function — still embeds tool descriptions from the manifest exactly as before.
- All call sites of the executor.

## 7. Migration mechanics (~1000 call sites)

The refactor across `*.service.ts` files is **mechanical**: drop three keys from each `mcpTool({...})` object literal. A one-shot codemod script (`scripts/codemod-slim-mcp-annotations.ts`, throwaway, not committed) uses ts-morph to:

1. Find every `CallExpression` whose callee is `mcpTool`.
2. From its first argument (object literal), remove the `name`, `module`, `argOrder` properties.
3. Validate: the function's name matches the removed `name`, the file path matches the removed `module`, the function's params match the removed `argOrder`. **If any mismatch, fail loudly** — that's a pre-existing bug surfaced by the refactor.
4. Save.

The codemod runs once; its output is reviewed and committed. The codemod itself is deleted before the final commit.

## 8. Error handling

| Failure | Behavior |
|---|---|
| Anonymous `mcpTool(..., () => {})` | Parser fails at build time with explicit error pointing to file:line |
| Destructured params in `mcpTool` fn | Parser fails — destructuring breaks positional binding anyway, this is a real bug |
| `name`/`argOrder` mismatch during codemod | Codemod fails with file:line, no write |
| Ollama unreachable during search | `search_tools` returns an error result (`isError: true`) with the original message; no fallback to substring search — keeping two implementations is the bug |
| `mcpToolEmbedding` empty (worker hasn't run) | Semantic search returns empty results; behavior consistent with "no tools known yet" |
| Concurrent identical queries | Single-flighted (one Ollama call shared) |
| Concurrent distinct queries | Each runs independently (Ollama serializes server-side) |

## 9. Out of scope

- Caching query embeddings across requests (premature; in-request single-flight is enough).
- Cross-encoder reranking on top of cosine similarity.
- Search over inactive (historical) tool versions.
- A standalone `/api/mcp/search` HTTP endpoint — search is internal to `search_tools`.
- Replacing `describe_tool` / `call_tool` (they continue to read from the in-process registry as today).

## 10. Open questions

None. Confirmed decisions:

- Annotation keeps `injectAuth` explicit (no name-prefix heuristics).
- Runtime registration via generator-emitted `mcp-tools.generated.ts`, not `fn.toString()` parsing.
- Ollama: lazy, single-flight, no preload, no second instance.
- Both refactors (slim annotation + semantic search) ship in the same plan.
- `search_mcp_tools` is `SECURITY DEFINER`, `service_role`-only.
