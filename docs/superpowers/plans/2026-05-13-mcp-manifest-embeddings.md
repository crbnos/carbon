# MCP Tools Manifest + Embeddings Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate MCP tool definitions at build time into a hashed manifest file, serve it via an authenticated endpoint, and have a pgmq-driven edge function consume it to produce embeddings (via local Ollama `embeddinggemma:300m`), reusing embeddings keyed by description hash.

**Architecture:** A new `scripts/generate-mcp-manifest.ts` imports the existing `McpToolRegistry` (no runtime changes) and writes a slim JSON view. On ERP boot, the app sends a pgmq message; a `pg_cron` job invokes a new edge function via `util.invoke_edge_function` that diffs description hashes, embeds missing ones in batches, and flips an `isActive` flag inside a transaction.

**Tech Stack:** TypeScript, tsx, React Router (Remix-style routes), Supabase (pgmq, pg_cron, pg_net, pgvector), Deno (edge function), Ollama (`embeddinggemma:300m`), Husky.

---

## Spec reference

`docs/superpowers/specs/2026-05-13-mcp-manifest-embeddings-design.md`

## File structure

**New files:**
- `scripts/generate-mcp-manifest.ts` — manifest generator
- `apps/erp/app/services/mcp/manifest.ts` — small helper that the script and route share (canonicalize + hash)
- `apps/erp/app/routes/api+/mcp+/manifest.ts` — GET endpoint
- `apps/erp/app/services/mcp/notifyManifestQueue.ts` — boot-time pgmq send
- `packages/database/supabase/migrations/20260513120000_mcp-tool-embeddings.sql` — tables, pgmq queue, pg_cron job
- `packages/database/supabase/functions/mcp-embeddings-worker/index.ts` — edge function
- `packages/database/supabase/functions/mcp-embeddings-worker/deno.json` — function deno config (if needed; mirror existing functions)

**Modified files:**
- `apps/erp/package.json` — add `mcp:manifest` script + `prebuild` hook
- `apps/erp/app/entry.server.tsx` (or equivalent boot module) — trigger pgmq send on startup
- `.husky/pre-commit` — replace existing `generate-mcp.ts` block with the new generator + drift check
- `apps/erp/app/services/mcp/mcp-tools.json` — generated artifact (committed)

**Untouched (intentionally):** `mcpTool.ts`, `registry.ts`, `executor.ts`, `types.ts`, and every `mcpTool(...)` call site. The slimming happens only at the manifest serialization boundary.

---

## Task 1: Shared canonicalize + hash helper

**Files:**
- Create: `apps/erp/app/services/mcp/manifest.ts`
- Create: `apps/erp/app/services/mcp/manifest.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/erp/app/services/mcp/manifest.test.ts
import { describe, expect, it } from "vitest";
import {
  buildManifest,
  hashDescription,
  toManifestEntry,
  type ManifestEntry
} from "./manifest";
import type { McpToolMetadata } from "./types";
import { z } from "zod";

function meta(over: Partial<McpToolMetadata> = {}): McpToolMetadata {
  return {
    id: "account_getAccount",
    module: "account",
    name: "getAccount",
    description: "  get account  ",
    classification: "READ",
    disable: false,
    fn: () => undefined,
    paramSchema: z.unknown(),
    argOrder: ["client", "id"],
    optional: [false, false],
    hasArgsParam: false,
    auth: { companyId: false, userId: false, createdBy: false, updatedBy: false },
    ...over
  };
}

describe("manifest helpers", () => {
  it("toManifestEntry strips runtime fields and trims description", () => {
    const entry = toManifestEntry(meta());
    expect(entry).toEqual<ManifestEntry>({
      id: "account_getAccount",
      module: "account",
      name: "getAccount",
      description: "get account",
      classification: "READ",
      descriptionHash: hashDescription({
        id: "account_getAccount",
        description: "get account",
        classification: "READ"
      })
    });
  });

  it("hashDescription is stable and depends on id+description+classification", () => {
    const a = hashDescription({ id: "x", description: "y", classification: "READ" });
    const b = hashDescription({ id: "x", description: "y", classification: "READ" });
    const c = hashDescription({ id: "x", description: "y", classification: "WRITE" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("buildManifest sorts tools by id, skips disabled, and produces a stable contentHash", () => {
    const m1 = buildManifest([
      meta({ id: "b_t", module: "b", name: "t" }),
      meta({ id: "a_t", module: "a", name: "t" }),
      meta({ id: "z_t", module: "z", name: "t", disable: true })
    ]);
    const m2 = buildManifest([
      meta({ id: "a_t", module: "a", name: "t" }),
      meta({ id: "b_t", module: "b", name: "t" })
    ]);
    expect(m1.tools.map((t) => t.id)).toEqual(["a_t", "b_t"]);
    expect(m1.contentHash).toBe(m2.contentHash);
    expect(m1.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("buildManifest contentHash changes when a description changes", () => {
    const m1 = buildManifest([meta({ description: "one" })]);
    const m2 = buildManifest([meta({ description: "two" })]);
    expect(m1.contentHash).not.toBe(m2.contentHash);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter erp test app/services/mcp/manifest.test.ts`
Expected: FAIL — module `./manifest` does not exist.

- [ ] **Step 3: Implement `manifest.ts`**

```ts
// apps/erp/app/services/mcp/manifest.ts
import { createHash } from "node:crypto";
import type { McpClassification, McpToolMetadata } from "./types";

export interface ManifestEntry {
  id: string;
  module: string;
  name: string;
  description: string;
  classification: McpClassification;
  descriptionHash: string;
}

export interface Manifest {
  generatedAt: string;
  contentHash: string;
  tools: ManifestEntry[];
}

function sha256(input: string): string {
  return "sha256:" + createHash("sha256").update(input).digest("hex");
}

export function hashDescription(input: {
  id: string;
  description: string;
  classification: McpClassification;
}): string {
  return sha256(`${input.id}\n${input.description}\n${input.classification}`);
}

export function toManifestEntry(t: McpToolMetadata): ManifestEntry {
  const description = t.description.trim();
  return {
    id: t.id,
    module: t.module,
    name: t.name,
    description,
    classification: t.classification,
    descriptionHash: hashDescription({ id: t.id, description, classification: t.classification })
  };
}

// Canonical JSON: deterministic key order + no incidental whitespace.
function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalStringify).join(",") + "]";
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalStringify((value as Record<string, unknown>)[k]))
      .join(",") +
    "}"
  );
}

export function buildManifest(tools: McpToolMetadata[], now: Date = new Date()): Manifest {
  const entries = tools
    .filter((t) => !t.disable)
    .map(toManifestEntry)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    generatedAt: now.toISOString(),
    contentHash: sha256(canonicalStringify(entries)),
    tools: entries
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter erp test app/services/mcp/manifest.test.ts`
Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/erp/app/services/mcp/manifest.ts apps/erp/app/services/mcp/manifest.test.ts
git commit -m "feat(mcp): add manifest canonicalize + hash helpers"
```

---

## Task 2: Manifest generator script

**Files:**
- Create: `scripts/generate-mcp-manifest.ts`
- Modify: `apps/erp/package.json`
- Create (generated, committed): `apps/erp/app/services/mcp/mcp-tools.json`

- [ ] **Step 1: Implement the script**

```ts
// scripts/generate-mcp-manifest.ts
//
// Loads every annotated service module so mcpTool() side effects populate
// McpToolRegistry, then writes a slim manifest view to disk.
//
// Run via: pnpm --filter erp mcp:manifest

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { buildManifest } from "../apps/erp/app/services/mcp/manifest";
import { McpToolRegistry } from "../apps/erp/app/services/mcp/registry";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_FILE = resolve(ROOT, "apps/erp/app/services/mcp/mcp-tools.json");

// Mirror bootstrap.ts exactly. Update both lists together when modules are added.
const SERVICE_MODULES = [
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
] as const;

async function main(): Promise<void> {
  for (const m of SERVICE_MODULES) {
    await import(resolve(ROOT, `apps/erp/app/modules/${m}/${m}.service.ts`));
  }

  const manifest = buildManifest(McpToolRegistry.getInstance().list());
  const next = JSON.stringify(manifest, null, 2) + "\n";

  // Preserve generatedAt when only that field would change (avoids spurious
  // diffs when content is unchanged).
  if (existsSync(OUT_FILE)) {
    const prev = JSON.parse(readFileSync(OUT_FILE, "utf8")) as { contentHash?: string };
    if (prev.contentHash === manifest.contentHash) {
      console.log(`[mcp-manifest] unchanged (${manifest.tools.length} tools, ${manifest.contentHash})`);
      return;
    }
  }

  writeFileSync(OUT_FILE, next);
  console.log(
    `[mcp-manifest] wrote ${OUT_FILE} (${manifest.tools.length} tools, ${manifest.contentHash})`
  );
}

main().catch((err) => {
  console.error("[mcp-manifest] failed:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Add `mcp:manifest` and `prebuild` scripts**

Modify `apps/erp/package.json` — within the `"scripts"` block, replace:

```json
    "build": "react-router build",
```

with:

```json
    "mcp:manifest": "tsx ../../scripts/generate-mcp-manifest.ts",
    "prebuild": "pnpm mcp:manifest",
    "build": "react-router build",
```

- [ ] **Step 3: Generate the manifest for the first time**

Run: `pnpm --filter erp mcp:manifest`
Expected: stdout `[mcp-manifest] wrote .../mcp-tools.json (N tools, sha256:...)` where N matches the count printed by `bootstrap.ts` at runtime.

- [ ] **Step 4: Verify deterministic regeneration**

Run: `pnpm --filter erp mcp:manifest && pnpm --filter erp mcp:manifest`
Expected: second run logs `[mcp-manifest] unchanged ...` and `git diff apps/erp/app/services/mcp/mcp-tools.json` is empty.

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-mcp-manifest.ts apps/erp/package.json apps/erp/app/services/mcp/mcp-tools.json
git commit -m "feat(mcp): generate mcp-tools.json from registry at build time"
```

---

## Task 3: Manifest HTTP endpoint

**Files:**
- Create: `apps/erp/app/routes/api+/mcp+/manifest.ts`
- Create: `apps/erp/app/routes/api+/mcp+/manifest.test.ts`

The endpoint is gated by the Supabase **service-role key** in a header. This matches the edge function caller and excludes anonymous traffic.

- [ ] **Step 1: Write failing tests**

```ts
// apps/erp/app/routes/api+/mcp+/manifest.test.ts
import { describe, expect, it, beforeEach, vi } from "vitest";
import { loader } from "./manifest";

const SERVICE_KEY = "test-service-role-key";

beforeEach(() => {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
});

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/mcp/manifest", { headers });
}

describe("GET /api/mcp/manifest", () => {
  it("rejects requests without the service-role header", async () => {
    const res = await loader({ request: req(), params: {}, context: {} as never });
    expect(res.status).toBe(401);
  });

  it("returns the manifest with ETag when authorized", async () => {
    const res = await loader({
      request: req({ "x-supabase-service-role": SERVICE_KEY }),
      params: {},
      context: {} as never
    });
    expect(res.status).toBe(200);
    const etag = res.headers.get("etag");
    expect(etag).toMatch(/^"sha256:[a-f0-9]{64}"$/);
    const body = await res.json();
    expect(body).toHaveProperty("contentHash");
    expect(body).toHaveProperty("tools");
  });

  it("returns 304 when If-None-Match matches the contentHash", async () => {
    const first = await loader({
      request: req({ "x-supabase-service-role": SERVICE_KEY }),
      params: {},
      context: {} as never
    });
    const etag = first.headers.get("etag")!;
    const res = await loader({
      request: req({ "x-supabase-service-role": SERVICE_KEY, "if-none-match": etag }),
      params: {},
      context: {} as never
    });
    expect(res.status).toBe(304);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter erp test app/routes/api+/mcp+/manifest.test.ts`
Expected: FAIL — `./manifest` not found.

- [ ] **Step 3: Implement the route**

```ts
// apps/erp/app/routes/api+/mcp+/manifest.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { LoaderFunctionArgs } from "@remix-run/node";

const MANIFEST_PATH = resolve(
  process.cwd(),
  "apps/erp/app/services/mcp/mcp-tools.json"
);

interface CachedManifest {
  raw: string;
  contentHash: string;
}

let cached: CachedManifest | null = null;

function loadManifest(): CachedManifest {
  if (cached) return cached;
  const raw = readFileSync(MANIFEST_PATH, "utf8");
  const parsed = JSON.parse(raw) as { contentHash: string };
  cached = { raw, contentHash: parsed.contentHash };
  return cached;
}

export async function loader({ request }: LoaderFunctionArgs): Promise<Response> {
  const expected = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const presented = request.headers.get("x-supabase-service-role");
  if (!expected || presented !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { raw, contentHash } = loadManifest();
  const etag = `"${contentHash}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { etag } });
  }
  return new Response(raw, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      etag,
      "cache-control": "no-cache"
    }
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter erp test app/routes/api+/mcp+/manifest.test.ts`
Expected: PASS — 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/erp/app/routes/api+/mcp+/manifest.ts apps/erp/app/routes/api+/mcp+/manifest.test.ts
git commit -m "feat(mcp): expose manifest via service-role-gated endpoint"
```

---

## Task 4: Database migration — tables + pgmq queue + pg_cron

**Files:**
- Create: `packages/database/supabase/migrations/20260513120000_mcp-tool-embeddings.sql`

- [ ] **Step 1: Write the migration**

```sql
-- packages/database/supabase/migrations/20260513120000_mcp-tool-embeddings.sql
--
-- MCP tool versions + embeddings, fed by a pgmq queue consumed by the
-- mcp-embeddings-worker edge function via pg_cron.

BEGIN;

CREATE TABLE "mcpToolVersion" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "toolId"          text NOT NULL,
  "module"          text NOT NULL,
  "name"            text NOT NULL,
  "description"     text NOT NULL,
  "classification"  text NOT NULL CHECK ("classification" IN ('READ','WRITE','DESTRUCTIVE')),
  "descriptionHash" text NOT NULL UNIQUE,
  "isActive"        boolean NOT NULL DEFAULT false,
  "createdAt"       timestamptz NOT NULL DEFAULT now(),
  "updatedAt"       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "mcpToolVersion_active_unique"
  ON "mcpToolVersion"("toolId") WHERE "isActive";

CREATE INDEX "mcpToolVersion_toolId_idx" ON "mcpToolVersion"("toolId");

CREATE TABLE "mcpToolEmbedding" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "toolVersionId" uuid NOT NULL UNIQUE REFERENCES "mcpToolVersion"("id") ON DELETE CASCADE,
  "embedding"     vector(768) NOT NULL,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "mcpToolEmbedding_embedding_idx"
  ON "mcpToolEmbedding" USING hnsw ("embedding" vector_cosine_ops);

-- updatedAt triggers (mirror existing pattern; reuse moddatetime extension if
-- the project uses one — falling back to a plpgsql trigger here for clarity).
CREATE OR REPLACE FUNCTION util.mcp_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER "mcpToolVersion_touch"
  BEFORE UPDATE ON "mcpToolVersion"
  FOR EACH ROW EXECUTE FUNCTION util.mcp_touch_updated_at();

CREATE TRIGGER "mcpToolEmbedding_touch"
  BEFORE UPDATE ON "mcpToolEmbedding"
  FOR EACH ROW EXECUTE FUNCTION util.mcp_touch_updated_at();

-- pgmq queue: app sends one message per boot containing the manifest contentHash.
SELECT pgmq.create('mcp_embeddings_queue');

-- pg_cron polls the queue every 30s and invokes the edge function.
SELECT cron.schedule(
  'mcp-embeddings-worker',
  '30 seconds',
  $$
    DO $cron$
    BEGIN
      IF EXISTS (SELECT 1 FROM pgmq.metrics('mcp_embeddings_queue') WHERE queue_length > 0) THEN
        PERFORM util.invoke_edge_function(
          'mcp-embeddings-worker',
          jsonb_build_object('triggeredAt', now())
        );
      END IF;
    END;
    $cron$;
  $$
);

COMMIT;
```

- [ ] **Step 2: Verify migration applies cleanly**

Ask the user to run `pnpm db:build` (per CLAUDE.md: never rebuild the database yourself — wait for the user).

After they confirm: connect to the DB and verify:

```sql
\d "mcpToolVersion"
\d "mcpToolEmbedding"
SELECT * FROM pgmq.metrics('mcp_embeddings_queue');
SELECT jobname FROM cron.job WHERE jobname = 'mcp-embeddings-worker';
```

Expected: tables exist with the columns above; queue exists with length 0; cron job is listed.

- [ ] **Step 3: Commit**

```bash
git add packages/database/supabase/migrations/20260513120000_mcp-tool-embeddings.sql
git commit -m "feat(db): add mcpToolVersion + mcpToolEmbedding tables and worker cron"
```

---

## Task 5: App-boot pgmq trigger

**Files:**
- Create: `apps/erp/app/services/mcp/notifyManifestQueue.ts`
- Create: `apps/erp/app/services/mcp/notifyManifestQueue.test.ts`
- Modify: `apps/erp/app/entry.server.tsx` (or whichever module runs once at boot — verify before editing)

- [ ] **Step 1: Locate the boot module**

Run: `rg -n "entry.server" apps/erp/app/ --files-with-matches | head -5; ls apps/erp/app/entry.server.* 2>/dev/null`
Expected: a single `entry.server.tsx` (or `.ts`) at `apps/erp/app/entry.server.tsx`. If absent, locate the equivalent in `apps/erp/app/root.tsx` server-only effect or `server.ts`. The boot hook must run exactly once per process.

- [ ] **Step 2: Write failing tests for `notifyManifestQueue`**

```ts
// apps/erp/app/services/mcp/notifyManifestQueue.test.ts
import { describe, expect, it, vi } from "vitest";
import { notifyManifestQueue } from "./notifyManifestQueue";

describe("notifyManifestQueue", () => {
  it("reads mcp-tools.json and sends one pgmq message with its contentHash", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 1, error: null });
    const client = { rpc } as unknown as Parameters<typeof notifyManifestQueue>[0];
    await notifyManifestQueue(client);
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("pgmq_send");
    expect(args).toMatchObject({
      queue_name: "mcp_embeddings_queue"
    });
    expect(args.message).toHaveProperty("contentHash");
    expect(args.message.contentHash).toMatch(/^sha256:/);
  });

  it("does not throw when rpc returns an error (fire-and-forget)", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: new Error("nope") });
    const client = { rpc } as unknown as Parameters<typeof notifyManifestQueue>[0];
    await expect(notifyManifestQueue(client)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter erp test app/services/mcp/notifyManifestQueue.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement `notifyManifestQueue`**

Inspect an existing pgmq.send caller first to confirm the RPC name used in this codebase:

Run: `rg -n "pgmq" apps/erp/app/ packages/database/supabase/ | head -20`

If the codebase exposes a `pgmq_send` RPC (search migrations for `CREATE FUNCTION public.pgmq_send`), use it. Otherwise add a thin SQL wrapper in the same migration as Task 4 and re-run the migration step. The contract this code expects:

```sql
CREATE OR REPLACE FUNCTION public.pgmq_send(queue_name text, message jsonb)
RETURNS bigint LANGUAGE sql SECURITY DEFINER AS $$
  SELECT pgmq.send(queue_name, message);
$$;
GRANT EXECUTE ON FUNCTION public.pgmq_send(text, jsonb) TO authenticated, service_role;
```

If you added this RPC, append it to the Task 4 migration and re-run `pnpm db:build`.

Now the implementation:

```ts
// apps/erp/app/services/mcp/notifyManifestQueue.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

const MANIFEST_PATH = resolve(
  process.cwd(),
  "apps/erp/app/services/mcp/mcp-tools.json"
);

export async function notifyManifestQueue(client: SupabaseClient): Promise<void> {
  let contentHash: string;
  try {
    const parsed = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as { contentHash: string };
    contentHash = parsed.contentHash;
  } catch (err) {
    console.error("[mcp] notifyManifestQueue: cannot read manifest, skipping", err);
    return;
  }

  const { error } = await client.rpc("pgmq_send", {
    queue_name: "mcp_embeddings_queue",
    message: { contentHash }
  });
  if (error) {
    // Fire-and-forget: another instance will send the same message, or the
    // next deploy will. Don't crash boot.
    console.warn("[mcp] notifyManifestQueue: rpc error", error.message);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter erp test app/services/mcp/notifyManifestQueue.test.ts`
Expected: PASS.

- [ ] **Step 6: Wire the boot hook**

Find the existing server entry. In `apps/erp/app/entry.server.tsx`, near the top after imports, add a single-shot invocation. Pattern to add (adapt the client factory to whatever the file already uses — `getCarbonServiceRole` or similar; search `apps/erp/app/lib/` for the service-role client factory):

```ts
import { notifyManifestQueue } from "~/services/mcp/notifyManifestQueue";
import { getCarbonServiceRole } from "~/lib/supabase/server"; // adapt to actual path

let mcpBootTriggered = false;
function triggerMcpBootOnce(): void {
  if (mcpBootTriggered) return;
  mcpBootTriggered = true;
  void notifyManifestQueue(getCarbonServiceRole()).catch(() => {
    // already logged inside notifyManifestQueue
  });
}
triggerMcpBootOnce();
```

If `entry.server` has no obvious top-level boot point, fall back to invoking `triggerMcpBootOnce()` from the existing `handleRequest` once per process (guarded by the same `mcpBootTriggered` flag).

- [ ] **Step 7: Verify end-to-end at boot**

Ask the user to run the ERP dev server (`pnpm --filter erp dev`) and confirm in the DB:

```sql
SELECT msg_id, message FROM pgmq.read('mcp_embeddings_queue', 5, 10);
```

Expected: one message with `{"contentHash":"sha256:..."}`. The cron job will subsequently consume it (visible as queue length returning to 0 after edge function is deployed in Task 6).

- [ ] **Step 8: Commit**

```bash
git add apps/erp/app/services/mcp/notifyManifestQueue.ts \
        apps/erp/app/services/mcp/notifyManifestQueue.test.ts \
        apps/erp/app/entry.server.tsx
git commit -m "feat(mcp): notify embeddings queue on app boot"
```

---

## Task 6: Edge function `mcp-embeddings-worker`

**Files:**
- Create: `packages/database/supabase/functions/mcp-embeddings-worker/index.ts`
- Create (if pattern requires): `packages/database/supabase/functions/mcp-embeddings-worker/deno.json`

The function: reads one message from the queue, fetches the manifest, diffs hashes, embeds missing tools via Ollama (concurrency 4), commits one transaction, deletes the message.

- [ ] **Step 1: Confirm Ollama URL convention**

Run: `rg -n "OLLAMA|ollama|11434" packages/database/supabase/functions/ apps/erp/app/ --files-with-matches | head -10`
If a `OLLAMA_URL` env var is already conventional in this repo, reuse it; otherwise we'll require `OLLAMA_URL` (e.g. `http://ollama:11434`) to be set on the function. Document this in step 4.

- [ ] **Step 2: Implement the edge function**

```ts
// packages/database/supabase/functions/mcp-embeddings-worker/index.ts
//
// Consumes pgmq 'mcp_embeddings_queue', fetches mcp-tools.json from the ERP
// manifest endpoint, diffs descriptionHash against mcpToolVersion, embeds
// missing rows via Ollama (embeddinggemma:300m, 768-dim), then flips isActive
// atomically. All-or-nothing per manifest — partial failures roll back.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface ManifestEntry {
  id: string;
  module: string;
  name: string;
  description: string;
  classification: "READ" | "WRITE" | "DESTRUCTIVE";
  descriptionHash: string;
}
interface Manifest {
  generatedAt: string;
  contentHash: string;
  tools: ManifestEntry[];
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MANIFEST_URL = Deno.env.get("MCP_MANIFEST_URL")!; // e.g. https://erp.example.com/api/mcp/manifest
const OLLAMA_URL = Deno.env.get("OLLAMA_URL") ?? "http://ollama:11434";
const OLLAMA_MODEL = "embeddinggemma:300m";
const CONCURRENCY = 4;

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function readOneMessage(): Promise<{ msgId: number; contentHash: string } | null> {
  const { data, error } = await db.rpc("pgmq_read", {
    queue_name: "mcp_embeddings_queue",
    vt: 60,
    qty: 1
  });
  if (error) throw new Error(`pgmq_read failed: ${error.message}`);
  const row = (data as Array<{ msg_id: number; message: { contentHash: string } }> | null)?.[0];
  return row ? { msgId: row.msg_id, contentHash: row.message.contentHash } : null;
}

async function deleteMessage(msgId: number): Promise<void> {
  const { error } = await db.rpc("pgmq_delete", {
    queue_name: "mcp_embeddings_queue",
    msg_id: msgId
  });
  if (error) console.warn(`pgmq_delete failed: ${error.message}`);
}

async function fetchManifest(): Promise<Manifest> {
  const res = await fetch(MANIFEST_URL, {
    headers: { "x-supabase-service-role": SERVICE_ROLE_KEY }
  });
  if (!res.ok) throw new Error(`manifest fetch ${res.status}`);
  return (await res.json()) as Manifest;
}

async function existingHashes(hashes: string[]): Promise<Set<string>> {
  if (hashes.length === 0) return new Set();
  const { data, error } = await db
    .from("mcpToolVersion")
    .select("descriptionHash")
    .in("descriptionHash", hashes);
  if (error) throw new Error(`select existing failed: ${error.message}`);
  return new Set((data ?? []).map((r) => r.descriptionHash));
}

async function embed(text: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt: text })
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { embedding: number[] };
  if (!Array.isArray(json.embedding) || json.embedding.length !== 768) {
    throw new Error(`unexpected embedding shape: len=${json.embedding?.length}`);
  }
  return json.embedding;
}

async function embedAllConcurrent(
  entries: ManifestEntry[]
): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  let i = 0;
  async function worker(): Promise<void> {
    while (i < entries.length) {
      const idx = i++;
      const e = entries[idx];
      out.set(e.descriptionHash, await embed(e.description));
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker));
  return out;
}

// Commits the manifest atomically via a server-side RPC. The RPC is added in
// the migration as `apply_mcp_manifest(manifest_tools jsonb, embeddings jsonb)`.
async function applyManifest(
  tools: ManifestEntry[],
  embeddings: Map<string, number[]>
): Promise<void> {
  const newRows = tools
    .filter((t) => embeddings.has(t.descriptionHash))
    .map((t) => ({
      toolId: t.id,
      module: t.module,
      name: t.name,
      description: t.description,
      classification: t.classification,
      descriptionHash: t.descriptionHash,
      embedding: embeddings.get(t.descriptionHash)!
    }));
  const activeHashes = tools.map((t) => t.descriptionHash);
  const activeToolIds = tools.map((t) => t.id);

  const { error } = await db.rpc("apply_mcp_manifest", {
    new_rows: newRows,
    active_hashes: activeHashes,
    active_tool_ids: activeToolIds
  });
  if (error) throw new Error(`apply_mcp_manifest: ${error.message}`);
}

Deno.serve(async () => {
  try {
    const msg = await readOneMessage();
    if (!msg) return new Response("no message", { status: 200 });

    const manifest = await fetchManifest();
    if (manifest.contentHash !== msg.contentHash) {
      console.log(
        `[mcp-worker] contentHash mismatch (msg=${msg.contentHash} live=${manifest.contentHash}) — using live manifest`
      );
    }

    const have = await existingHashes(manifest.tools.map((t) => t.descriptionHash));
    const missing = manifest.tools.filter((t) => !have.has(t.descriptionHash));
    console.log(`[mcp-worker] tools=${manifest.tools.length} missing=${missing.length}`);

    const embeddings = await embedAllConcurrent(missing);
    await applyManifest(manifest.tools, embeddings);
    await deleteMessage(msg.msgId);
    return new Response(JSON.stringify({ ok: true, embedded: missing.length }), {
      headers: { "content-type": "application/json" }
    });
  } catch (err) {
    console.error("[mcp-worker] failed", err);
    return new Response(String(err), { status: 500 });
  }
});
```

- [ ] **Step 3: Add the `apply_mcp_manifest` RPC + pgmq RPC wrappers to the migration**

Append to `packages/database/supabase/migrations/20260513120000_mcp-tool-embeddings.sql` (re-run migration via user):

```sql
-- Thin RPC wrappers so the edge function can call pgmq without touching schema directly.
CREATE OR REPLACE FUNCTION public.pgmq_read(queue_name text, vt int, qty int)
RETURNS SETOF pgmq.message_record LANGUAGE sql SECURITY DEFINER AS $$
  SELECT * FROM pgmq.read(queue_name, vt, qty);
$$;
GRANT EXECUTE ON FUNCTION public.pgmq_read(text, int, int) TO service_role;

CREATE OR REPLACE FUNCTION public.pgmq_delete(queue_name text, msg_id bigint)
RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$
  SELECT pgmq.delete(queue_name, msg_id);
$$;
GRANT EXECUTE ON FUNCTION public.pgmq_delete(text, bigint) TO service_role;

-- Atomic manifest application: inserts new versions + their embeddings, then
-- flips isActive in a single transaction (function body = implicit txn).
CREATE OR REPLACE FUNCTION public.apply_mcp_manifest(
  new_rows jsonb,
  active_hashes text[],
  active_tool_ids text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  row jsonb;
  v_version_id uuid;
BEGIN
  -- Insert new versions; ignore conflicts (concurrent worker invocations).
  FOR row IN SELECT * FROM jsonb_array_elements(new_rows)
  LOOP
    INSERT INTO "mcpToolVersion" (
      "toolId", "module", "name", "description", "classification", "descriptionHash", "isActive"
    ) VALUES (
      row->>'toolId',
      row->>'module',
      row->>'name',
      row->>'description',
      row->>'classification',
      row->>'descriptionHash',
      false
    )
    ON CONFLICT ("descriptionHash") DO UPDATE
      SET "updatedAt" = now()
    RETURNING "id" INTO v_version_id;

    INSERT INTO "mcpToolEmbedding" ("toolVersionId", "embedding")
    VALUES (
      v_version_id,
      (SELECT array_agg(x::float)::vector FROM jsonb_array_elements_text(row->'embedding') AS x)
    )
    ON CONFLICT ("toolVersionId") DO NOTHING;
  END LOOP;

  -- Atomic active swap.
  UPDATE "mcpToolVersion" SET "isActive" = false
    WHERE "toolId" = ANY(active_tool_ids) AND "isActive";
  UPDATE "mcpToolVersion" SET "isActive" = true
    WHERE "descriptionHash" = ANY(active_hashes);
END;
$$;
GRANT EXECUTE ON FUNCTION public.apply_mcp_manifest(jsonb, text[], text[]) TO service_role;
```

Ask the user to re-run `pnpm db:build` after editing the migration.

- [ ] **Step 4: Document required edge function env vars**

The function requires:
- `SUPABASE_URL` (auto-provided)
- `SUPABASE_SERVICE_ROLE_KEY` (auto-provided)
- `MCP_MANIFEST_URL` — full URL to `/api/mcp/manifest` on the running ERP
- `OLLAMA_URL` — defaults to `http://ollama:11434`

Set these via `supabase functions secrets set` per repo convention.

- [ ] **Step 5: Deploy and smoke-test**

Ask the user to deploy the function (`supabase functions deploy mcp-embeddings-worker`). Then verify:

```sql
-- Trigger a manual run
SELECT util.invoke_edge_function('mcp-embeddings-worker', '{}'::jsonb);

-- Wait a few seconds, then check
SELECT count(*) FROM "mcpToolVersion" WHERE "isActive";
SELECT count(*) FROM "mcpToolEmbedding";
SELECT * FROM pgmq.metrics('mcp_embeddings_queue');
```

Expected: `mcpToolVersion` active count equals the manifest tool count; embedding count matches; queue length is 0.

- [ ] **Step 6: Commit**

```bash
git add packages/database/supabase/functions/mcp-embeddings-worker \
        packages/database/supabase/migrations/20260513120000_mcp-tool-embeddings.sql
git commit -m "feat(mcp): add embeddings worker edge function + apply RPC"
```

---

## Task 7: Pre-commit hook (replace existing block)

**Files:**
- Modify: `.husky/pre-commit`

- [ ] **Step 1: Read current hook**

The current hook regenerates from a deleted script (`scripts/generate-mcp.ts`) and stages outputs that no longer exist. Replace the MCP-related block.

- [ ] **Step 2: Update the hook**

Replace the block starting at `# Regenerate MCP tools` with:

```sh
# Regenerate MCP manifest if any .service.ts file was modified.
# Hook fails (does NOT auto-stage) if the manifest is now dirty — the
# developer must review and stage explicitly.
if git diff --cached --name-only | grep -q '\.service\.ts$'; then
  pnpm --filter erp mcp:manifest
  if ! git diff --quiet -- apps/erp/app/services/mcp/mcp-tools.json; then
    echo
    echo "✖ MCP manifest is out of date."
    echo "  Run 'pnpm --filter erp mcp:manifest' and stage apps/erp/app/services/mcp/mcp-tools.json."
    exit 1
  fi
fi
```

- [ ] **Step 3: Manual verification**

Make a trivial change to any `.service.ts` mcpTool description, stage it, and try to commit. Expected: hook fails with the message above. Stage `mcp-tools.json` and retry: commit succeeds.

- [ ] **Step 4: Commit (use --no-verify is NOT allowed; the hook should pass for this commit because only `.husky/pre-commit` is staged)**

```bash
git add .husky/pre-commit
git commit -m "chore(husky): pre-commit check that mcp-tools.json is up to date"
```

---

## Task 8: Self-review + final verification

- [ ] **Step 1: Run the full test suite**

Run: `pnpm --filter erp test`
Expected: PASS (all 3 new test files green, no regressions).

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter erp typecheck`
Expected: PASS.

- [ ] **Step 3: Verify build wires the manifest step**

Run: `pnpm --filter erp build`
Expected: log shows `[mcp-manifest] ...` before the react-router build step; build succeeds.

- [ ] **Step 4: End-to-end smoke**

With ERP running and edge function deployed:
1. Confirm `mcpToolVersion` active row count equals registry tool count.
2. Change one `mcpTool` description in a `.service.ts`, commit (hook regenerates manifest; you stage and commit).
3. Restart ERP. Confirm a new pgmq message is sent and within 30s a new `mcpToolVersion` row appears for that tool with `isActive = true`, and the prior row flips to `isActive = false`. Old embedding rows remain (reuse contract).

- [ ] **Step 5: Update llm/cache after committing**

Per CLAUDE.md, after committing, update `llm/cache/` with a short note describing the new MCP manifest + embeddings architecture. Do NOT include details about uncommitted code.

---

## Self-review notes (against spec)

| Spec section | Plan task |
|---|---|
| §3.1 Build script | Task 2 |
| §3.2 Endpoint | Task 3 |
| §3.3 App-boot trigger | Task 5 |
| §3.4 Tables | Task 4 |
| §3.5 Edge function | Task 6 |
| §3.6 Pre-commit hook | Task 7 |
| §5b Wrapper untouched | All tasks — no runtime files modified |
| §6 Out of scope | enforced (no entityType column, no extra entities) |

Cross-task type consistency:
- `ManifestEntry` is the single shape used in `manifest.ts`, the generator, the endpoint (via raw JSON), and the edge function (re-declared verbatim). Field set: `id, module, name, description, classification, descriptionHash`.
- `descriptionHash` format: `sha256:<64 hex>` — used as both the table `UNIQUE` column and the input to `existingHashes()`.
- Embedding dim 768 is fixed in both the SQL (`vector(768)`) and the edge function check.
- RPC names match between callers and migration: `pgmq_send`, `pgmq_read`, `pgmq_delete`, `apply_mcp_manifest`.

No placeholders, TBDs, or "implement later" present.
