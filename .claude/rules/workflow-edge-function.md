paths: ["packages/database/supabase/functions/**"]

# Workflow: Authoring a Supabase Edge Function

How to add or extend a Carbon edge function. These are **Deno** functions in
`packages/database/supabase/functions/<name>/index.ts`. They run privileged work
that doesn't belong in a request handler (creating documents, posting ledger
entries, MRP, CSV import, scheduling) and are called from app code via
`client.functions.invoke("<name>", { body })`.

Grounded against the real functions (`create`, `post-receipt`, `post-shipment`,
`import-csv`, `mrp`, `schedule`) and the shared `lib/**`. Not Trigger.dev and not
Inngest: edge functions are a distinct mechanism. Async/event-driven side effects
go through the Inngest event system (`@carbon/jobs`, see `event-system.md`), NOT
here. Reach for an edge function when the app needs a synchronous privileged
call-and-wait (it gets `{ data, error }` back from `invoke`).

## 1. Scaffold

```bash
pnpm db:function:new <name>     # → supabase functions new (root script)
```

Creates `packages/database/supabase/functions/<name>/index.ts`.

## 2. Register in config.toml (required to deploy)

Add an entry to `packages/database/supabase/config.toml`. Without it the function
is not deployed.

```toml
[functions.<name>]
enabled = true
verify_jwt = true                              # JWT required (the common case)
# entrypoint = "./functions/<name>/index.ts"   # optional; only if not default index.ts
```

- `verify_jwt = true` — protected (almost all Carbon functions; the JWT/API-key is
  re-checked in-function anyway, see step 4).
- `verify_jwt = false` — only for genuinely public endpoints (`image-resizer`,
  `logo-resizer`).

## 3. Function skeleton

Real imports (note: `serve` from deno.land std, **default** `z` import, lib paths
relative to the function dir):

```typescript
import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import z from "npm:zod@^3.24.1";
import { corsHeaders } from "../lib/headers.ts";
import { requirePermissions } from "../lib/supabase.ts";
import { Database } from "../lib/types.ts";

const payloadValidator = z.object({
  companyId: z.string(),
  userId: z.string(),
  // ...your fields. Use z.discriminatedUnion("type", [...]) for multi-op fns (see `create`).
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
a Kysely transaction (the `post-*` and `create` functions do this):

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

- Sequence numbers: `import { getNextSequence } from "../shared/get-next-sequence.ts";`
- Other shared business logic lives in `../shared/` (`calculate-cogs.ts`,
  `get-accounting-period.ts`, `sampling-engine.ts`, …). Generic DB/auth helpers
  live in `../lib/`.

## 5. Invoke from app code

App services call functions through the supabase client — do **not** hit a raw
HTTP port. `body` is the JSON payload your validator expects; you get back
`{ data, error }`.

```typescript
// e.g. apps/erp/app/modules/.../*.service.ts (client is from requirePermissions)
const { data, error } = await client.functions.invoke("post-receipt", {
  body: { type: "post", receiptId, companyId, userId },
});
```

Real call sites: `serviceRole.functions.invoke("create", { body: {...} })`,
`...invoke("mrp", { body: { ...params } })`, `...invoke("schedule", { body })`,
`...invoke("import-csv", { body })`. The **route's** `requirePermissions` is the
real auth gate for these service-role invocations.

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
from `config.toml`. There is **no `npm run db:deploy` / `db:deploy` script** — that
was stale. Self-hosted instances sync separately via a server-side script
(`.github/workflows/functions.yml`). You don't run a deploy manually; merging to
`main` with the `config.toml` entry present is what ships it.

## Checklist

- [ ] `pnpm db:function:new <name>` (file at `functions/<name>/index.ts`)
- [ ] `[functions.<name>]` added to `config.toml` (`enabled`, `verify_jwt`)
- [ ] CORS `OPTIONS` short-circuit returning `corsHeaders`
- [ ] zod `payloadValidator` (`companyId` + `userId` always; discriminated union for multi-op)
- [ ] Auth via `requirePermissions(req, companyId, userId, { <action>: "<module>" })`
- [ ] Kysely transaction for multi-row writes; pool created at module scope
- [ ] `companyId` + audit fields on every write
- [ ] `try/catch` returning `{ error }` with `corsHeaders` + status 500
- [ ] Called from app code via `client.functions.invoke("<name>", { body })`
