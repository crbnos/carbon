paths: ["packages/database/supabase/functions/**"]

# Workflow: Authoring a Supabase Edge Function

How to add or extend a Carbon edge function. These are **Deno** functions in
`packages/database/supabase/functions/<name>/index.ts`, called over HTTP via
`client.functions.invoke("<name>", { body })`. Five remain: `embed`, `embedding`,
`event-wake`, `thumbnail`, `trigger`.

Privileged, transactional writes shared by the apps, the API and jobs (posting,
converting, issuing, CSV import) are **server functions** in Node, not edge
functions — see `packages/server-functions/AGENTS.md`. MRP and scheduling are
`@carbon/planning`. Async/event-driven side effects go through the Inngest event
system (`@carbon/jobs`, see `event-system.md`). Reach for a new edge function only
when the work must run in the Supabase edge runtime (e.g. it is called by Postgres
over pg_net).

## 1. Scaffold

```bash
pnpm db:function:new <name>     # → supabase functions new (root script)
```

Creates `packages/database/supabase/functions/<name>/index.ts`.

## 2. Register in config.toml (settings, NOT a deploy gate)

Add an entry to `packages/database/supabase/config.toml`.

**A missing entry does not stop the function from deploying.** `ci/src/migrations.ts`
runs `supabase functions deploy` with **no function name**, and that deploys every
directory under `supabase/functions/` regardless of `config.toml`. The entry only
overrides per-function settings, `verify_jwt` above all.
<!-- UNVERIFIED: verify_jwt default for an UNREGISTERED function (docs say true; not confirmed on a deployed Carbon fn) -->

`embed`, `thumbnail` and `trigger` have no `config.toml` entry today and are
deployed all the same, so in-function authorization is the only gate a function
has. Register the function anyway (it is where a future reader looks), but never
treat absence as "not deployed".

```toml
[functions.<name>]
enabled = true
verify_jwt = true                              # JWT required (the common case)
# entrypoint = "./functions/<name>/index.ts"   # optional; only if not default index.ts
```

- `verify_jwt = true` — the gateway checks the JWT's signature, nothing more. The anon key
  published in the apps' HTML IS a valid JWT, so this alone lets anyone in. The function must
  still authorize in-function: `requirePermissions` when it acts on a company's data, or
  `requireCaller` (`lib/supabase.ts` — service role, signed-in user, or valid API key) when it
  touches none (`embedding`), or `requireServiceRole` when only servers call it
  (`thumbnail`). The `edge-function-authorizes-caller` check (`@carbon/checks`) fails a
  function that calls none of them. `embed`, `event-wake` and `trigger` are called by
  Postgres with the key from the `config` table (`util.invoke_edge_function`,
  `util.wake_event_queue`) and are baselined in that check.
- `verify_jwt = false` — only for genuinely public endpoints (none today).

## 3. Function skeleton

Real imports (note: `serve` from deno.land std, **default** `z` import, lib paths
relative to the function dir):

```typescript
import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import z from "npm:zod@^4.5.4";
import { corsHeaders } from "../lib/headers.ts";
import { requirePermissions } from "../lib/supabase.ts";
import { Database } from "../lib/types.ts";

const payloadValidator = z.object({
  companyId: z.string(),
  userId: z.string(),
  // ...your fields. Use z.discriminatedUnion("type", [...]) for multi-op fns.
});

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const { companyId, userId, ...data } = payloadValidator.parse(payload);

    // Auth + privileged client. Throws on missing/insufficient permission.
    const client = await requirePermissions(req, companyId, userId, {
      update: "inventory", // <module>_<action> the caller must hold; create/view/delete also valid
    });

    // ...work using `client` (service-role supabase, RLS bypassed)...

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    console.error(`Error in <name>:`, err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
```

### Auth: `requirePermissions` (NOT ad-hoc client construction)

`requirePermissions(req, companyId, userId, permissions)` from `../lib/supabase.ts`
is the gate. It handles **both** auth paths — `Authorization: Bearer <jwt>` and the
`carbon-key` API-key header (with rate-limit + scope checks) — verifies the
`<module>_<action>` permission via `get_claims`, and returns a **service-role**
`SupabaseClient<Database>` (RLS bypassed). It **throws** on denial; let the throw
hit the `catch`. `companyId`/`userId` come from the validated payload, not headers.
(Lower-level helpers `getSupabase` / `getSupabaseServiceRole` / `getAuthFromAPIKey`
exist in the same file but `requirePermissions` is the standard entry point.)

## 4. Database-heavy work — Kysely transactions

For multi-row / multi-table writes, init the pool **once at module scope** and use
a Kysely transaction (`embed` does this):

```typescript
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";

const pool = getConnectionPool(1);            // module scope, not per-request
const db = getDatabaseClient<DB>(pool);

await db.transaction().execute(async (trx) => {
  await trx.insertInto("tableName").values({
    id: nanoid(),
    companyId,
    createdBy: userId,
    createdAt: new Date().toISOString(),
    ...data,
  }).execute();
});
```

- `getConnectionPool` / `getDatabaseClient` / `DB` come from `../lib/database.ts`
  (it re-exports `getPostgresConnectionPool` / `getPostgresClient` from
  `lib/postgres/index.ts`; `DB` = `KyselyDatabase`).
- Kysely **bypasses RLS and throws on rollback** — authorize first with
  `requirePermissions`, wrap in `try/catch`.
- Multi-tenancy: always include `companyId`; always set audit fields
  (`createdBy`/`createdAt`, `updatedBy`/`updatedAt`).

### Shared helpers (real paths)

- Business logic (sequences, COGS, accounting periods, sampling, …) is Node-only
  now — it lives in `@carbon/database` / `@carbon/server-functions` and cannot be
  imported here; a function that needs it belongs in `@carbon/server-functions`.
  Generic DB/auth helpers live in `../lib/`.

## 5. Invoke from app code

App code calls functions through the supabase client — do **not** hit a raw
HTTP port. `body` is the JSON payload your validator expects; you get back
`{ data, error }`.

```typescript
const { data, error } = await client.functions.invoke("embedding", {
  body: { text },
});
```

Real call sites: `shared.service.ts` → `embedding`, `packages/jobs/.../events/embedding.ts`
→ `embed`. `event-wake` and `trigger` are called by Postgres via pg_net.

A function that takes a record id must re-read that record under `companyId` itself
and 404 on a miss — the caller's permission proves nothing about the ids in the body.
Scope the read with `.eq("companyId", companyId)` + `.maybeSingle()`; `errorResponse`
(`lib/response.ts`) uses a numeric 4xx/5xx `err.status` over the status the catch
block passes.

## 6. Local dev

Functions are served by the Docker `edge-runtime` container (`pnpm dev` / `crbn up`),
which live-mounts `packages/database/supabase/functions/` — no per-edit deploy step.
Locally `VERIFY_JWT` is `false`. Exercise the function by triggering the app path
that calls `client.functions.invoke("<name>", ...)`.
<!-- UNVERIFIED: invoking a local function directly via curl to the edge-runtime/Kong port — not a documented Carbon path; prefer driving it through the app's invoke() call site. -->

## 7. Deploy

Deployment is **all-at-once**, not per-function. On push to `main` touching
`packages/database/supabase/**`, CI runs `supabase functions deploy`
(`ci/src/migrations.ts`), which deploys every `[functions.*]` with `enabled = true`
(`supabase functions deploy`, no arguments → every directory under
`supabase/functions/`, `config.toml` entry or not). There is **no
`npm run db:deploy` / `db:deploy` script** — that was stale. Self-hosted instances
sync separately via a server-side script (`.github/workflows/functions.yml`). You
don't run a deploy manually; merging to `main` is what ships it.

## Checklist

- [ ] `pnpm db:function:new <name>` (file at `functions/<name>/index.ts`)
- [ ] `[functions.<name>]` added to `config.toml` (`enabled`, `verify_jwt`) — for
      the settings and for discoverability, NOT because it gates the deploy
- [ ] CORS `OPTIONS` short-circuit returning `corsHeaders`
- [ ] zod `payloadValidator` (`companyId` + `userId` always; discriminated union for multi-op)
- [ ] Auth via `requirePermissions(req, companyId, userId, { <action>: "<module>" })`, `requireCaller` or `requireServiceRole`
- [ ] Kysely transaction for multi-row writes; pool created at module scope
- [ ] `companyId` + audit fields on every write
- [ ] `try/catch` returning `{ error }` with `corsHeaders` + status 500
- [ ] Called from app code via `client.functions.invoke("<name>", { body })`
