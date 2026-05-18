# MCP Tools Manifest + Embeddings Pipeline

**Date:** 2026-05-13
**Status:** Draft — pending implementation plan

## 1. Overview

Replace the current runtime MCP tool registration architecture with a **build-time generated manifest** (`mcp-tools.json`, lockfile-style), served via an HTTP endpoint, consumed by a **pgmq-driven edge function** that generates and stores embeddings using a local Ollama model (`embeddinggemma:300m`).

Embeddings are keyed by `descriptionHash` and reused across versions — if a tool's description hasn't changed, its embedding is reused. The active set of tools is tracked by an `isActive` flag with a partial unique index, enabling atomic version swaps inside a transaction.

## 2. Goals

- Generate MCP tool definitions at build time, not runtime, so they are deterministic and reviewable in git.
- Detect manifest drift via content hash, like a lockfile.
- Avoid regenerating embeddings when descriptions haven't changed.
- Decouple embedding generation from app boot — async via pgmq.
- Use local Ollama (no external embedding API spend).

## 3. Components

### 3.1 Build script — `scripts/generate-mcp-manifest.ts`

Imports the MCP service modules so their `mcpTool(...)` calls populate `McpToolRegistry`, then reads the registry and emits `apps/erp/app/services/mcp/mcp-tools.json`:

```json
{
  "generatedAt": "2026-05-13T12:34:56.000Z",
  "contentHash": "sha256:...",
  "tools": [
    {
      "id": "account_getAccount",
      "module": "account",
      "name": "getAccount",
      "description": "...",
      "classification": "READ",
      "descriptionHash": "sha256:..."
    }
  ]
}
```

**Manifest is a slim view of the registry.** Runtime-only fields (`argOrder`, `paramSchema`, `injectAuth`, `injectInto`, `optional`, `hasArgsParam`, `fn`) are NOT emitted — they are irrelevant to embeddings and to manifest consumers. The wrapper signature and `McpToolAnnotation` shape are unchanged.

- `contentHash` = SHA-256 of the canonicalized `tools` array (stable key ordering, sorted by `id`, no incidental whitespace).
- `descriptionHash` per tool = SHA-256 of `id + description + classification` (the fields a downstream embedding consumer actually sees).
- **Tools with `disable: true` are skipped** — not emitted to the manifest. Mirrors the existing `registry.list()` filter.
- Registered in `package.json` as `mcp:manifest`.
- Run before build via `prebuild` (or explicit CI step).

### 3.2 Endpoint — `apps/erp/app/routes/api+/mcp+/manifest.ts`

- `GET` returns the JSON file contents.
- Sets `ETag: <contentHash>`, supports `If-None-Match` → returns `304`.
- Gated by service-role header (the edge function passes the Supabase service-role key).

### 3.3 App-boot trigger

On ERP server startup (after DB is reachable):

```sql
SELECT pgmq.send('mcp_embeddings_queue', jsonb_build_object('contentHash', $1));
```

- Fire-and-forget.
- Multi-instance boots send duplicate messages — that's fine; the edge function dedups via hash check.

### 3.4 Database schema

```sql
CREATE TABLE "mcpToolVersion" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  toolName        text NOT NULL,
  descriptionHash text NOT NULL UNIQUE,
  metadata        jsonb NOT NULL,
  isActive        boolean NOT NULL DEFAULT false,
  createdAt       timestamptz NOT NULL DEFAULT now(),
  updatedAt       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "mcpToolVersion_active_unique"
  ON "mcpToolVersion"(toolName) WHERE isActive;

CREATE TABLE "mcpToolEmbedding" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  toolVersionId   uuid NOT NULL REFERENCES "mcpToolVersion"(id) ON DELETE CASCADE,
  embedding       vector(768) NOT NULL,
  createdAt       timestamptz NOT NULL DEFAULT now(),
  updatedAt       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (toolVersionId)
);
```

- `vector(768)` matches `embeddinggemma:300m` output dimension.
- `descriptionHash` is `UNIQUE` — the embedding-reuse contract.
- Partial unique index `(toolName) WHERE isActive` guarantees exactly one active row per tool.
- No separate "active descriptions" table — `isActive` + partial index supersedes it.

### 3.5 Edge function — `supabase/functions/mcp-embeddings-worker/index.ts`

Invocation: `pg_cron` job every 30s checks if the queue has messages; if so, calls this function via `pg_net`.

Per invocation:

1. `pgmq.read('mcp_embeddings_queue', visibility_timeout := 60)`.
2. Fetch manifest from `GET /api/mcp/manifest` (service-role header).
3. For each tool in the manifest:
   - `SELECT 1 FROM "mcpToolVersion" WHERE descriptionHash = $1`.
   - Exists → reuse, no Ollama call.
   - Missing → enqueue for embedding.
4. Batch missing tools, concurrency = 4 parallel requests to `http://ollama:11434/api/embeddings` with model `embeddinggemma:300m`.
5. **Single transaction** for the whole manifest (all-or-nothing):
   - Insert new `mcpToolVersion` rows (`isActive = false`).
   - Insert their `mcpToolEmbedding` rows.
   - `UPDATE "mcpToolVersion" SET isActive = false WHERE toolName IN (manifest tool names)`.
   - `UPDATE "mcpToolVersion" SET isActive = true WHERE descriptionHash IN (manifest hashes)`.
6. `pgmq.delete` the message.

On failure: do not delete the message; pgmq redelivers after the visibility timeout.

### 3.6 Pre-commit hook

Husky hook `.husky/pre-commit`:

- If any staged file is under MCP source directories → run `pnpm mcp:manifest`.
- `git diff --exit-code apps/erp/app/services/mcp/mcp-tools.json` — fail if dirty with message:
  > "MCP manifest out of date. Run `pnpm mcp:manifest` and stage the result."

The hook does not stage the file automatically — the developer must review and stage explicitly.

## 4. Data flow

```
[source files change] → developer commits
       ↓
[pre-commit hook] → regenerates mcp-tools.json → fails commit if drift
       ↓
[CI build] → prebuild script regenerates and verifies hash
       ↓
[ERP deploys & boots] → pgmq.send({ contentHash })
       ↓
[pg_cron every 30s] → if queue non-empty → pg_net → edge function
       ↓
[edge function] → fetch manifest → diff descriptionHash → embed missing via Ollama
       ↓
[transaction] → insert rows + flip isActive atomically
       ↓
[mcpToolVersion + mcpToolEmbedding] ← consumed by downstream vector search
```

## 5. Error handling

| Failure | Behavior |
|---|---|
| Manifest endpoint unreachable | Message not deleted → pgmq redelivers |
| Ollama unreachable | All-or-nothing txn aborts → no partial state → retry |
| Duplicate messages (multi-instance boot) | Hash check short-circuits; txn idempotent because `descriptionHash UNIQUE` |
| Stale manifest in commit | Pre-commit hook blocks |
| Stale manifest in deploy | CI prebuild regenerates + asserts no drift |

## 5b. Wrapper / annotation changes

After audit (`registry.ts`, `executor.ts`), every existing `McpToolAnnotation` field is load-bearing at runtime:

| Field | Role | Status |
|---|---|---|
| `module`, `name` | tool id, manifest | keep |
| `description` | manifest + embedding source | keep |
| `classification` | executor authorization gate | keep |
| `disable` | registry + manifest filter | keep |
| `injectAuth`, `injectInto` | tenant identity injection — security-critical | keep |
| `argOrder`, `paramSchema` | executor positional binding + payload validation | keep |

**No fields are removed from the wrapper or the runtime registry.** The slimming happens *only* at the manifest serialization boundary (see §3.1). This keeps the executor untouched and the new architecture additive.

Concretely:
- `mcpTool(annotation, fn)` signature unchanged.
- `McpToolAnnotation`, `McpToolMetadata`, `McpToolRegistry`, `ToolExecutor` unchanged.
- New code: only the manifest generator, endpoint, edge function, tables, pgmq plumbing, and pre-commit hook.

## 6. Out of scope (v1)

- Embedding entities beyond MCP tools (routes, docs) — schema is tools-only.
- Manifest version history beyond `isActive` (old rows kept solely for embedding reuse).
- Public/unauthenticated access to the manifest endpoint.
- Backfill / migration of any existing tool data — assumed greenfield for the new tables.

## 7. Open questions

None at spec-write time. Confirmed decisions:

- **Tools-only** scope (no `entityType` column).
- **All-or-nothing transaction** per manifest.
- **Service-role** gating on the manifest endpoint.
- **`embeddinggemma:300m`** via local Ollama (768 dims).
- **pg_cron + pg_net** as the queue → edge function bridge (Supabase has no native pgmq→function push).
- **No wrapper/runtime changes** — manifest is a slim serialization view of the existing registry; runtime types and the executor are untouched.
