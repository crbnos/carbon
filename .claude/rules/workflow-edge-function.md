---
paths: ["packages/database/supabase/functions/**"]
---

# Workflow: Authoring a Supabase Edge Function

How to add or extend a Carbon edge function. These are **Deno** functions in
`packages/database/supabase/functions/<name>/index.ts`, called over HTTP via
`client.functions.invoke("<name>", { body })`. One remains:

| Function | Contract | Caller check | Called from |
|---|---|---|---|
| `embedding` | `{ text }` → `{ embedding }`; `{ texts }` (≤ 100) → `{ embeddings }` — gte-small (384 dims) via `Supabase.ai.Session` | `requireCaller`: the service role key, a `service_role`/`authenticated` JWT (signature verified with `JWT_SECRET` when set), or a `carbon-key` API key checked against `apiKey` + `check_api_key_rate_limit` | ERP `shared.service.ts` (search), `@carbon/jobs` `events/embedding.ts` (`embedRecords`) |

Everything else is Node. Privileged, transactional writes shared by the apps, the
API and jobs (posting, converting, issuing, CSV import) are **server functions** —
see `packages/server-functions/AGENTS.md`. MRP and scheduling are
`@carbon/planning`. Async/event-driven side effects go through the Inngest event
system (`@carbon/jobs`, see `event-system.md`); Postgres sends its own Inngest
events with `util.send_inngest_event` and never calls an edge function. Model
thumbnails are rendered by the Rust assembler (`crates/thumbnail`). Reach for a
new edge function only when the work needs the edge runtime itself (e.g. its
built-in model API).

## 1. Self-contained, always

A function imports nothing outside its own directory. There is no `functions/lib/`
or `functions/shared/`, and `functions/deno.json` is just `{ "lock": false }` — no
import map. Use inline `npm:` / `jsr:` / `node:` specifiers with pinned versions,
and copy the few lines of helper (CORS headers, JSON response, caller check) into
the function rather than sharing them. Workspace packages (`@carbon/*`) cannot be
imported; logic that needs them belongs in Node.

## 2. Scaffold and register

```bash
pnpm db:function:new <name>     # → supabase functions new (root script)
```

Add an entry to `packages/database/supabase/config.toml`:

```toml
[functions.<name>]
enabled = true
verify_jwt = true
```

**A missing entry does not stop the function from deploying.** `ci/src/migrations.ts`
runs `supabase functions deploy` with no function name, which deploys every
directory under `supabase/functions/`. The entry only overrides per-function
settings, `verify_jwt` above all. Register it anyway; never treat absence as "not
deployed".

## 3. Authorize in-function

`verify_jwt = true` only checks the JWT's signature, and the anon key published in
the apps' HTML IS a valid JWT, so the gateway alone lets anyone in. Every function
defines and calls its own `requireCaller` (signed-in users, API keys, servers) or
`requireServiceRole` (servers only) — copy `requireCaller` from `embedding`.
The `edge-function-authorizes-caller` check (`@carbon/checks`) fails a function
whose files call neither.

A function that takes a record id must re-read that record under `companyId` itself
and 404 on a miss — the caller's credentials prove nothing about the ids in the body.

## 4. Skeleton

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    await requireServiceRole(req); // or requireCaller — defined in this file
    const body = await req.json();
    // ...validate body, do the work...
    return json({ success: true });
  } catch (err) {
    console.error("<name> failed", err);
    return json({ message: (err as Error).message }, 500);
  }
});
```

## 5. Invoke from app code

```typescript
const { data, error } = await client.functions.invoke("embedding", {
  body: { text },
});
```

## 6. Local dev and CI

Functions are served by the Docker `edge-runtime` container (`pnpm dev` / `crbn up`),
which live-mounts `packages/database/supabase/functions/` — no per-edit deploy step.
Exercise a function through the app or job path that invokes it.

CI (`.github/workflows/check.yml`, job `edge-functions`, Deno v2) runs
`deno check --no-lock */index.ts` from the functions directory, after a step that
fails any import reaching outside a function's own directory.

## 7. Deploy

Deployment is all-at-once. On push to `main` touching `packages/database/supabase/**`,
CI runs `supabase functions deploy` (`ci/src/migrations.ts`) with no arguments.
Self-hosted instances sync separately (`.github/workflows/functions.yml`). Merging to
`main` is what ships it.

## Checklist

- [ ] `pnpm db:function:new <name>`; nothing imported from outside `functions/<name>/`
- [ ] AGPL SPDX license header at the top of every new file (`pnpm --filter @carbon/checks license-headers`)
- [ ] `[functions.<name>]` in `config.toml` (`enabled`, `verify_jwt = true`)
- [ ] CORS `OPTIONS` short-circuit
- [ ] Payload validated
- [ ] `requireCaller` or `requireServiceRole` defined and called in the function
- [ ] Any record id re-read under `companyId`
- [ ] Called via `client.functions.invoke("<name>", { body })`
