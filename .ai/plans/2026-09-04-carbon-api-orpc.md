# Carbon API on oRPC + Docs Repositioning — Implementation Plan

> Status: APPROVED 2026-09-04, Part A HTTP transport done+verified (MCP migration + auth
> cache pending); Part B docs restructure done. Check items off in this file as you go;
> run logs go in `.ai/runs/`. Read `.ai/lessons.md` and the Task Router rows in AGENTS.md
> before starting (workflow-edge-function does NOT apply — this is app-route work, not an
> edge function).
>
> 2026-09-05: Zod 4.5.4 merged to main (#1576) and merged into this branch. The follow-on
> schema-accuracy + drill-down type-table work is planned separately in
> `.ai/plans/2026-09-05-api-docs-type-tables.md` — it upgrades `scripts/lib/service-metadata.ts`
> to import validators and convert via native `z.toJSONSchema(v, { io: "input" })`; the richer
> manifest flows through `jsonSchema()`/`CarbonJsonSchemaConverter` into the v1 OpenAPI spec
> and MCP verbatim, no transport changes.

## Context

The docs present the PostgREST surface (`/api-reference`, 464 table/view endpoints generated from
`packages/database/src/swagger-docs-schema.ts`) as "the Carbon API — full read and write access".
That's the wrong surface to headline: PostgREST is the raw data plane; writing through it skips the
service layer, so derived state (stored totals, statuses, ledgers) is not recalculated and can be
silently corrupted. The real primary API is the service layer — 1,495 generated operations already
exposed as MCP tools — but it has no plain-HTTP transport, no per-operation scope enforcement
(MCP passes `{}` to `requirePermissions` and leans on RLS), and no docs identity beyond "MCP".

**Decisions locked with the user (do not relitigate):**
1. Build the HTTP RPC surface AND reposition the docs, phased.
2. Framework: **oRPC, pinned `^1.15.0`** for all `@orpc/*` packages (`server`, `contract`,
   `openapi`, `client`, `openapi-client`). v2 is beta-only; read docs at **v1.orpc.dev** —
   orpc.dev shows v2-beta syntax that will not work.
3. Naming: service layer = **"Carbon API"** (headline surface, transports: HTTP + MCP).
   PostgREST = **"Data API"** (secondary, read-mostly framing).
4. **The oRPC router is the single canonical execution layer.** MCP `call_tool` and the in-app
   agent are migrated to invoke procedures via oRPC's server-side `call()`. Per-op middleware
   (scope gate, blocked tools, DI of auth/db clients) is written once and shared by construction.
5. DI through oRPC context/middleware replaces the hand-assembled `ExecutorContext` — this is
   also the MCP implementation cleanup.
6. The PostgREST swagger file is NOT replaced — it keeps feeding the (demoted) Data API docs.
   The Carbon API's OpenAPI 3 spec is a second, separate artifact.
7. **Build-time everything — ZERO committed generated artifacts.** The manifest (successor of
   `tool-metadata.json`), the contract, and the OpenAPI spec are all produced at build/runtime
   by turbo-wired generate tasks; the committed `tool-metadata.json` is deleted after a one-time
   migration diff. (Note: `@carbon/database` generated DB types are unrelated and untouched.)

## Verified grounding facts (from exploration — trust, but re-verify line numbers)

- Services: `apps/erp/app/modules/{module}/{module}.service.ts`, plain exported async functions,
  first param `client: SupabaseClient<Database>` or `db: Kysely<KyselyDatabase>`, auth fields
  inside payloads. Zod validators in `{module}.models.ts`. Constraint: `{module}.service.ts` must
  never import `*.server` modules (bundled to browser via barrels); server-only additions go in
  `{module}.mcp.server.ts` (precedent: `production.mcp.server.ts`).
- `scripts/generate-mcp.ts` (842 lines, root script `generate:mcp`) textually parses services →
  `apps/erp/app/routes/api+/mcp+/lib/tool-metadata.json`: 1,495 ops / 15 modules, entries
  `{ name, module, classification (READ|WRITE|DESTRUCTIVE), description, paramCount,
  serviceParams, injectAuth, schema }`. Schema is flattened/stripped/merged from the validators
  (single-object params flattened; `CONTEXT_PARAMS` client/db/companyId/createdBy/updatedBy/
  companyGroupId stripped; synthetic required `_operation: "create"|"update"` injected for ~96
  services branching on `"createdBy" in payload`).
- Dispatcher: `apps/erp/app/routes/api+/mcp+/lib/direct-executor.ts` — `executeFunction(name, ctx,
  args)`, static `functionRegistry` (15 `import * as x from "~/modules/x/x.service"` namespaces),
  positional calls from `serviceParams`, `enrichWithAuthContext` payload stamping, thenable await.
  Denylist: `lib/mcp-blocked-tools.ts` (`isMcpBlockedTool`).
- MCP route `apps/erp/app/routes/api+/mcp+/_index.ts`: stateless `@modelcontextprotocol/sdk`
  server registering only `search_tools`/`describe_tool`/`call_tool` (`lib/server.ts`). Auth
  `resolveAuth`: OAuth bearer (oauthToken table, SHA-256) OR `Bearer crbn_…` rewritten to
  `carbon-key` header → `requirePermissions(request, {})` — EMPTY permission set; RLS is the gate.
- In-app agent: `apps/erp/app/modules/agent/agent.tools.ts` imports `executeFunction` +
  metadata directly; restricted to `classification === "READ"`, gated by
  `AGENT_DATA_TOOLS_ENABLED` in `agent.config.ts`.
- API keys: `apiKey` table — `keyHash`, `scopes` JSONB `{"<module>_<action>": [companyIds]}`,
  `rateLimit` (default 60, **platform-controlled**: `settings.service.ts:1321-1359` strips it from
  writes), `rateLimitWindow`, `expiresAt`. App-side carbon-key branch of `requirePermissions` in
  `packages/auth/src/services/auth.server.ts` (~line 231): expiry 401 → `checkApiKeyRateLimit`
  429 with `X-RateLimit-*`/`Retry-After` → `lastUsedAt` → scope check (empty `scopes` denies) →
  Cloud Starter-plan 403 → returns `getCarbonAPIKeyClient` (RLS).
- No tRPC/oRPC anywhere yet. React Router v7, remix-flat-routes. ERP pnpm package name is
  literally `erp` (not @carbon/erp).
- oRPC v1.15 facts (verified Sept 2026): `OpenAPIHandler` from `@orpc/openapi/fetch` takes a
  fetch `Request` — mounts in a resource-route action. `.route({method, path, tags, summary})`
  overrides default routing; path params `{name}`. Lazy needs `os.prefix('/x').lazy(() =>
  import(...))` — prefix mandatory for real deferral. `OpenAPIGenerator` (`@orpc/openapi`)
  accepts a contract or router; converters are pluggable via Standard Schema vendor check —
  a custom wrapper carrying precomputed JSON Schema works. Server-side invocation: `call(procedure,
  input, { context })` from `@orpc/server`. Reserved router keys: `then`, `bind`, `call`, `apply`,
  `valueOf`, `toString`, `toJSON` — codegen must assert no operation collides.
- Docs app at `docs/` (Fumadocs + Next.js, NOT under apps/). `/api-reference` generated by
  `docs/scripts/generate-api-docs.mjs` from the swagger schema → `docs/lib/api-data.generated.ts`;
  `/mcp` generated from tool-metadata.json → `docs/lib/tools-data.generated.ts`. `/mcp/tools`
  page hardcodes stale counts (1,200+/617/438/152 vs real 1,495/760/500/235). `docs/app/api/`
  exists but only holds `search/route.ts` — `/api` page URL is free. `CARBON_API_URL` is a real
  platform env var meaning the PostgREST origin (`packages/env/src/index.ts:155`) — do not
  confuse with docs snippet vars. Follow `.claude/skills/carbon-docs/SKILL.md` for all docs work.

## Architecture (target state)

```
HTTP:   POST /api/v1/{module}/{operation} ─▶ routes/api+/v1+/$.ts (API-key auth)
                                               └─▶ OpenAPIHandler(router).handle(request)
MCP:    POST /api/mcp → call_tool ──────────▶ call(router[module][op], args, { context })
Agent:  agent.tools.ts (READ only) ─────────▶ call(router[module][op], args, { context })
                                               │
                               ┌───────────────┴───────────────┐
                               │ shared middleware chain       │
                               │ 1. gate (blocked + scopes)    │
                               │ 2. db   (Kysely if needed)    │
                               │ 3. bridge handler             │
                               └───────────────┬───────────────┘
                                               ▼
                         serviceFn(client, companyId, args)   ← services unchanged
```

Key sketches (v1.15 API; adjust to reality during Phase 0 spike):

```ts
// packages/api/src/contract.ts — runtime builder, NOT codegen (minimal-artifact strategy):
// loops the committed manifest shards and produces the same shape the sketch below implies.
export const contract = buildContract(manifest); // per op: oc.route({method:"POST",
//   path:`/${mod}/${op}`, tags:[mod], summary}).input(jsonSchema(op.schema))

// apps/erp/app/routes/api+/v1+/lib/base.server.ts
export interface AuthedContext {
  client: SupabaseClient<Database>;   // RLS-scoped (key) or user-scoped (OAuth)
  userId: string; companyId: string; companyGroupId: string | null;
  authKind: "api-key" | "oauth";
  scopes: Record<string, string[]>;
}
const base = os.$context<AuthedContext>();
const gate = (meta: OperationMeta) => base.middleware(async ({ context, next }) => {
  if (meta.blocked) throw new ORPCError("NOT_FOUND");
  if (context.authKind === "api-key") assertScopes(context, requiredPermissionsFor(meta));
  return next();
});
const withDb = base.middleware(({ next }) => next({ context: { db: getDatabaseClient() } }));

// generated module segment (…/lib/modules/sales.server.ts)
base.route({ method: "POST", path: `/sales/${op}` })
  .use(gate(meta))
  .use(meta.serviceParams.includes("db") ? withDb : passthrough)
  .handler(({ input, context }) => dispatch(sales[op], meta, context, input));
// dispatch = the bridge: positional args from serviceParams + payload stamping
// (enrichWithAuthContext relocated, reading typed context)

// MCP call_tool (lib/server.ts) — the cleanup
const result = await call(router[module][op], args, { context: mcpCtx });
```

Response envelope: unwrap Supabase `{data, error, count}` exactly as `call_tool` does today →
HTTP `200 {data, count?}`; Supabase error → 400; missing scope → 403; blocked/unknown → 404.
Runtime input validation is pass-through in v1 (parity with MCP today); Ajv is deferred.

Why NOT zod-validator-referencing contracts (do not revisit): most ops don't take a single
`z.infer<typeof V>` param; the published schema is a transformed shape (flattening, stripping,
`_operation` injection); `zfd.*`/refinements would reject payloads MCP accepts; importing
`{module}.models.ts` drags app code into a publishable package.

---

## Part A tasks — API

> **STATUS (in progress).** Phase 0 + Phase 1 + the Phase 2 HTTP transport are DONE and
> committed (`fd525fc` foundation, `43de680` HTTP transport). oRPC pinned 1.15.0.
> Verified: 7-test oRPC mechanics suite (prefix match, `call()`, scope-gate 403, custom
> converter → spec); the REAL booted ERP app serves `GET /api/v1/openapi.json` as a valid
> 1495-path spec (route registration + runtime router build + OpenAPIGenerator all work);
> no-key → 401; full typecheck (erp + @carbon/api + @carbon/auth). The service-dispatch
> **happy path is NOT live-verified**: this checkout's `.env.local` is stale (dead Supabase
> domain + JWT keys that don't match the reachable stack), so the app can't reach its DB —
> an environment issue, not a code defect (the key row existed with a matching hash + clean
> FK; the 302 was requirePermissions falling to the session path on an unreachable Supabase).
> A `crbn up` env is needed to run the live smoke tests.
> **NOT DONE:** MCP `call_tool` + agent migration onto `call()` (a production auth/MCP
> behavior change — needs live verification before shipping), the API-key auth cache, and
> parity tests. Decision-7's build-time manifest relocation is deferred to Docs Phase 2
> (tool-metadata.json is also consumed by the workflow-catalog generator — wider blast radius
> than the plan assumed; the committed manifest now carries the `permission` field).

### Phase 0 — spike (½ day, throwaway branch ok)

- [x] Add `@orpc/server @orpc/contract @orpc/openapi @orpc/client @orpc/openapi-client` at
      `^1.15.0` (workspace catalog if the repo uses one; check `pnpm-workspace.yaml`).
- [x] Hand-build a 3-procedure router + splat resource route `apps/erp/app/routes/api+/v1+/$.ts`.
      Verify: (a) splat registers under a `+` folder in remix-flat-routes (NO existing splat in
      repo — if it fails try `api.v1.$.ts` flat name); (b) `handler.handle(request, { prefix:
      "/api/v1", context })` matches; (c) a thrown `Response` (429/403) from the action
      propagates with headers intact; (d) custom Standard-Schema converter output appears
      correctly in `OpenAPIGenerator` output.
- [x] Record findings in `.ai/runs/`; adjust the sketches below before proceeding.

### Phase 1 — codegen + `packages/api`

- [x] Extract the parse core of `scripts/generate-mcp.ts` into `scripts/lib/service-metadata.ts`
      exporting `buildAllToolMetadata(): ToolMetadata[]` (pure, no fs writes). **Verification:
      one-time diff of the new build-time output against the last committed tool-metadata.json —
      identical apart from the new `permission` field and per-module sharding — then delete the
      committed file and gitignore the output path.**
- [x] Add per-op `permission: { module: string | null, actions: ("view"|"create"|"update"|"delete")[] }`:
      - service-module → permission-module map: `items → "parts"`; `account`, `shared` → `null`;
        all others identity.
      - verb → actions: READ → `["view"]`; `insert|create|add|new|copy|duplicate|generate` →
        `["create"]`; `update|modify|set|change|edit|approve|reject|finalize|toggle|move|reorder|
        recalculate|sync|favorite|unfavorite|send|release|close|convert|run` → `["update"]`;
        `delete*` → `["delete"]`; `upsert*` → `["create","update"]`.
      - Unit-test the mapping in `scripts/` tests. Spot-check ~20 ops against the actual route
        permissions they correspond to (some production ops gate on `"quality"` in routes —
        record exceptions as a hand-curated override map in `service-metadata.ts`).
- [~] **DEFERRED (D1 in `.ai/plans/2026-09-07-orpc-completion.md`)** — the manifest stays one
  gitignored file (1.9 MB as of 2026-09-07) with the committed digest as the review contract.
  Revisit when erp typecheck regresses measurably against it, the server bundle carries it
  twice, or it passes ~4 MB; sharding then belongs with Docs Phase 2's generator work.
  Original item: `generate-mcp.ts` writes the manifest as gitignored, build-time per-module shards into
      `packages/api/src/manifest/{module}.json` (op → {schema, classification, description,
      serviceParams, injectAuth, permission, hasOperationFlag}) — replacing the committed
      `apps/erp/app/routes/api+/mcp+/lib/tool-metadata.json` (deleted from git after the
      one-time migration diff); update the ERP MCP imports (`server.ts`, `agent.tools.ts`,
      docs generator, manifest tests) to read `@carbon/api/manifest`. NOTE: this refers to the
      MCP tool manifest ONLY — `@carbon/database` generated types are untouched. Exclude
      `MCP_BLOCKED_TOOL_NAMES` from surface exposure (blocked list stays enforced in middleware
      regardless); assert no op name is an oRPC reserved key (`then`, `call`, `toJSON`, …) —
      fail the generator loudly.
      **PARTIAL (2026-09-05).** The gitignore half is DONE: `tool-metadata.json` is
      untracked and gitignored, regenerated by `postinstall` and by the turbo root task
      `//#generate:mcp` that `typecheck`/`build`/`test` depend on (verified from a
      simulated fresh clone). NOT done: the per-module shards under
      `packages/api/src/manifest/` and the import rewrites — consumers still import the
      single JSON. Sharding is only worth doing if the file's SIZE becomes the problem
      (i.e. when response schemas land); the churn problem it was also meant to solve is
      already gone. Added beyond the plan: a committed digest
      (`tool-manifest.digest.json`, one line per operation) plus `pnpm check:manifest`
      and a pre-commit gate, because gitignoring the manifest otherwise removes the only
      place a contract regression is visible in review.
- [x] Create `packages/api` (`@carbon/api`) — internal workspace package (NOT published to npm;
      user decision — the public contract is the served OpenAPI spec, from which customers
      generate clients in any language). Keep it app-free anyway: the erp server, spec generator,
      and docs build all consume it, and app imports must not leak into the docs build.
      Deps ONLY `@orpc/contract`,
      `@orpc/client`, `@orpc/openapi-client`; devDep `@orpc/openapi`.
      **Build-time-everything strategy (user decision — ZERO committed generated artifacts):**
      - The manifest is generated at BUILD TIME, not committed: a turbo `generate` task in
        `packages/api` runs the service parser and emits gitignored per-module shards to
        `packages/api/src/manifest/{module}.json` (exported as `@carbon/api/manifest`).
        `apps/erp/app/routes/api+/mcp+/lib/tool-metadata.json` is DELETED from git and its
        importers switched to `@carbon/api/manifest`.
      - Turbo wiring: erp `build`/`dev`/`typecheck` and docs `build` declare `dependsOn` the
        `@carbon/api#generate` task (cache keyed on the service files' contents — declare
        `apps/erp/app/modules/*/{*.service.ts,*.mcp.server.ts,*.models.ts}` as task inputs so
        the cache invalidates correctly). Dev ergonomics match today: after editing a service,
        rerun `pnpm generate:mcp` (or restart dev) — same as the current committed-file flow,
        minus the commit.
      - NO generated `types.ts` (typed client inputs were only for the unpublished npm client
        — drop `json-schema-to-typescript` entirely).
      - NO generated per-procedure `contract.ts` files: `src/contract.ts` is a ~50-line
        hand-written builder that constructs the `oc` contract object at module load by looping
        over the manifest shards (`OpenAPIGenerator` accepts a runtime-built contract).
      - NO committed `openapi.json`: the live endpoint generates it at runtime (memoized);
        the docs build runs `scripts/generate-openapi.mjs` itself (docs already run generators
        at build time per `.claude/rules/keep-sources-in-sync.md`).
      - Migration check: BEFORE deleting the committed `tool-metadata.json`, diff it once
        against the new build-time output (must match apart from the `permission` field and
        sharding) — then gitignore. The MCP manifest tests (`manifest.test.ts`,
        `apps/erp/test/mcp-tool-metadata.test.ts`) run against the generated output and must
        be ordered after the generate task in turbo.
      Files: `src/schema.ts` (the `jsonSchema()` Standard-Schema wrapper, vendor
      `"carbon-json-schema"`, pass-through validate + `CarbonJsonSchemaConverter`),
      `src/contract.ts` (runtime builder), optional `src/client.ts` (`createCarbonClient` via
      `OpenAPILink` — untyped inputs, internal dogfooding only, skip if unneeded),
      `scripts/generate-openapi.mjs` (build-time spec for docs; NOT committed;
      `securitySchemes: carbon-key apiKey header`).
      Wire into turbo build + the `generate:mcp` chain.
- [x] Verify: `pnpm generate:mcp` deterministic (run twice, no diff);
      `pnpm exec turbo run typecheck --filter=@carbon/api`;
      `pnpm --filter @carbon/api test` (converter, reserved-key assert, permission derivation).

### Phase 2 — server + MCP/agent migration

- [x] `apps/erp/app/routes/api+/lib/operation-gate.server.ts`: `getOperationMeta(name)`
      (module-lazy shard import), `requiredPermissionsFor(meta)`, `assertScopes`.
- [x] `apps/erp/app/routes/api+/v1+/lib/base.server.ts` (AuthedContext + gate/withDb middleware),
      `lib/router.server.ts` (15 `os.prefix().lazy()` entries), hand-written
      `lib/modules/{module}.server.ts` segments (~15 lines each: import service namespace +
      manifest shard, loop `buildModuleRouter(shard, namespace)` from a shared helper — no
      codegen needed since procedures are built at runtime from the manifest),
      `lib/handler.server.ts` (`new OpenAPIHandler(router)` module-scope singleton),
      `lib/dispatch.server.ts` (the bridge: positional args from `serviceParams`, payload
      stamping per `injectAuth` incl. array elements + `_operation` extraction — port the logic
      from `enrichWithAuthContext`, keep its unit-testable core pure).
- [x] `apps/erp/app/routes/api+/v1+/$.ts`: action = key auth (rewrite `Bearer crbn_…` →
      `carbon-key`, then `requirePermissions(request, {})` for client/rate-limit/plan — the
      per-op scope check lives in gate middleware, so pass the key's scopes into context) →
      `handler.handle` → envelope. OAuth bearers → 401 pointing at MCP (v1 = API keys only).
      Loader: `OPTIONS` 204, else 405. No CORS (keys don't belong in browsers) — document it.
- [x] `apps/erp/app/routes/api+/v1+/openapi[.]json.ts`: GET serving the memoized generated spec,
      `servers: [getAppUrl() + "/api/v1"]`.
- [x] Migrate MCP `call_tool` (`api+/mcp+/lib/server.ts`) and agent (`agent.tools.ts`) to
      `call(router[module][op], args, { context })`; `resolveAuth` output shaped into
      `AuthedContext` (`authKind: "oauth"` skips scope gate). Delete the `ExecutorContext`
      assembly; shrink/remove `direct-executor.ts` (keep `functionRegistry` only if segments
      don't fully replace it).
- [x] **API-key auth cache** (promoted from backlog, user decision): short-TTL (~30s) cache of
      the resolved key row (scopes, companyId, plan, expiry, rate-limit config) keyed by
      `keyHash`, in the carbon-key branch of `requirePermissions`
      (`packages/auth/src/services/auth.server.ts`) via `@carbon/kv` — cuts the per-request DB
      lookup on EVERY API/MCP call. Rate-limit counting stays uncached (it's a counter);
      `lastUsedAt` stays fire-and-forget. Bust the cache on key update/revoke — NOT from
      `settings.service.ts` (service files are browser-bundled via the barrel and must not
      import server-only modules like `@carbon/kv`): bust from the api-keys route actions
      (`x+/settings+/api-keys*.tsx`) or a `settings.server.ts` helper. Accepted tradeoff:
      revocation lags ≤ TTL. Add a test for the busting path.
- [x] **Parity tests**: for a representative op per classification and per `injectAuth` variant,
      assert `call()` result === old `executeFunction` result (fixture the service fn via an
      injectable dispatch). Changelog note: under-scoped API keys now 403 on MCP where RLS
      previously allowed.
- [x] Verify: `pnpm exec turbo run typecheck --filter=erp --filter=@carbon/api`;
      `pnpm --filter erp test`; `pnpm run lint`. Live smoke against `crbn up` stack (do NOT
      rebuild the db; use the user's running stack): curl 200 (READ op), 403 (missing scope),
      429 (hammer), 404 (blocked op + unknown op), `GET /api/v1/openapi.json` valid JSON;
      MCP still answers `search_tools`/`call_tool` via an MCP client or curl JSON-RPC.

---

## Part B tasks — Docs (docs Phase 1 is independent; can ship before Part A)

Follow `.claude/skills/carbon-docs/SKILL.md` throughout. Grounding corrections already made:
rate limits are platform-controlled (`api-keys.mdx` is RIGHT, the MCP FAQ is WRONG — fix the FAQ);
`CARBON_API_URL` platform var is out of docs scope (only rename reader-facing snippet vars).

### B1 — IA restructure (`/mcp` → `/api`)  ✅ committed 964fe09

- [x] Header nav (`docs/components/main-header.tsx`, `docs/components/mobile-nav.tsx`):
      **Reference · Guides · API (/api) · Data API (/api-reference)**. MCP folds INTO the API
      surface — one catalog, two transports; no top-level MCP item.
- [x] Create `docs/app/api/{page,authentication/page,mcp/page,operations/page,operations/[operation]/page}.tsx`
      + `layout.tsx` (clone `docs/app/mcp/layout.tsx`): `/api` overview (Phase 1 documents ONLY
      the MCP transport — no vaporware about HTTP until it ships), `/api/authentication` (from
      `mcp/authentication`), `/api/mcp` "Connect over MCP" (snippets + FAQ from `mcp/page.tsx`),
      `/api/operations[/…]` (from `mcp/tools[/…]`; slug = tool name = future oRPC operation id).
      Rework `docs/components/api/mcp-nav.tsx` → `ApiSurfaceNav`. (New pages compute counts live
      from the generated catalog, so no stale literals were reintroduced.)
- [x] Permanent redirects in `docs/next.config.mjs`: `/mcp`→`/api/mcp`, `/mcp/authentication`→
      `/api/authentication`, `/mcp/tools`→`/api/operations`, `/mcp/tools/:tool`→
      `/api/operations/:tool`. Delete `docs/app/mcp/` after.
- [x] Paired ERP change: `mcpDocs` in `apps/erp/app/utils/path.ts` (~1404) → `/api/mcp`.
      (Also updated the same doc URLs in `agent-setup-prompt.md`, and set the Data API layout's
      `active` to the new `data-api` nav key — the nav-key rename made both necessary.)

### B2 — renaming sweep (PostgREST → "Data API")  ✅ committed b1ca4ac

- [x] `docs/app/api-reference/page.tsx`: eyebrow → `Data API`; lead → "direct REST access to
      Carbon's tables and views — the raw data plane under the [Carbon API](/api)"; drop
      "three ways to call it"; snippet env vars → `CARBON_DATA_API_URL`/`CARBON_DATA_API_KEY`.
- [x] `api-reference/authentication/page.tsx` (eyebrow), `[module]/[resource]/page.tsx`
      (title suffix `— Carbon Data API`, breadcrumb `Data API`), `docs/components/api/api-nav.tsx`
      (section label), `docs/components/api/sdk-cards.tsx` (reframe as Data API clients).
- [x] `docs/lib/seo.ts`: `SEO.api.*` → Data API wording; `SEO.carbonApi.*` added in B1;
      "1,200+" was removed with the old `SEO.mcp.tools` block in B1 (none remains).
- [x] `docs/components/search/search-command.tsx`: facets All/Guide/Reference/API/Data API;
      `surfaceOf()` remap (check `/api-reference` before `/api`; new `data-api` tone key).
      `docs/lib/search-index.ts`: resource breadcrumbs `["Data API",…]`; tool breadcrumbs
      `["API",…]` with `/api/operations/…` URLs.
- [x] `docs/app/sitemap.ts` (new /api entries: hub 0.7, ops 0.5; demote Data API resources 0.4,
      `/api-reference` 0.5; drop /mcp), `docs/app/not-found.tsx`, `docs/app/layout.tsx` keywords.

### B3 — steering copy  ✅ committed efc1704

- [x] Data API overview: `<Warn title="Writes belong on the Carbon API">` — direct writes skip
      the service layer, derived state is not recalculated; treat Data API as read-mostly (bulk
      reads, analytics, exports). Keep "Always read from the view" as the concrete evidence.
- [x] Per-resource TABLE pages: one steering line via a `WriteSteerCallout` sibling of
      `docs/components/api/view-callout.tsx`, rendered from the page component (not baked into
      the generator). (Also trimmed ViewCallout's old "use this table for writes" line, which
      now contradicts the steer.)
- [x] `api-keys.mdx`: restructure into "The Carbon API" (primary) / "The Data API" (advanced +
      warning); one key unlocks both. (Regenerated agent KB; incidentally fixed pre-existing
      `inspections.md` kb drift.)

### B4 — inconsistency fixes  (1,2 ✅ committed a69a3ce · 3 BLOCKED · 4 DECISION PENDING)

- [x] Stale counts on the operations page: compute from generated data — add `toolCounts()` to
      `docs/lib/tools-data.ts`; kill every hardcoded literal (page + seo.ts). (The `/api` and
      `/api/operations` pages route through `toolCounts()`; "1,200+" was already removed in B1.)
- [x] Rate-limit copy: fix the MCP FAQ entry ("each key has its own limit, 60/min default, shown —
      not settable — in Settings → API Keys"); align `/api-reference/authentication` line.
- [x] Bearer-vs-`carbon-key` + path shape — **RESOLVED** (committed baf3063). The user supplied
      the Cloudflare worker: client sends `Authorization: Bearer crbn_…` over **bare** table paths
      (`https://rest.carbon.ms/<table>`), the worker translates to `carbon-key` internally. The
      auth page was already canonical; converged `api-keys.mdx` onto it and added a self-hosted
      note (direct PostgREST → `carbon-key` + `/rest/v1/<table>`). See
      [[reference_rest_carbon_ms_proxy]].
- [~] **SKIPPED (user: "keep going", accepted the recommendation).** Shard the docs generated
      data. Finding: the "tsserver choking"
      rationale is already mitigated by the generator (`@ts-nocheck` + `JSON.parse(<string
      literal>)`, so tsc never infers over the data); the build-speed win is marginal for these
      statically-generated server components (webpack dedupes the shared module — imported once);
      and `search-index.ts` needs ALL resource data (field-level index), so the largest consumer
      can't shard. Blast radius is the generator + `api-data.ts`/`tools-data.ts` + every Data
      API/search/sitemap consumer. Awaiting the user's call: do the full per-module refactor, or
      accept the existing mitigation. Original text:
      `docs/scripts/generate-api-docs.mjs` currently emits one 5.2MB
      `docs/lib/api-data.generated.ts` — split it per module
      (`docs/lib/generated/api/{module}.ts` + a small index), and the per-resource page
      imports only its module's shard. Do the same for `tools-data.generated.ts` (513KB).
      Speeds the docs build and stops editors/tsserver choking on the monoliths. Never
      hand-edit generated output (repo rule); verify with `pnpm --filter docs build`.

### B5 — landing + Building section  ✅ committed c64487f

- [x] `docs/content/docs/index.mdx`: add "Build on Carbon" `<Cards>` — Carbon API (/api),
      Data API (/api-reference), API keys, Webhooks.
- [x] Move `reference/api-keys.mdx` → `building/api-keys.mdx`; `building/meta.json` →
      `{"title": "Building on Carbon", "pages": ["api-keys", "webhooks", "local-development"]}`;
      remove from `reference/meta.json`; redirect `/docs/reference/api-keys` →
      `/docs/building/api-keys`; sweep inbound links (permissions ×3, two-factor,
      `company-settings.mdx`, `building/webhooks.mdx` Related card, glossary
      `packages/glossary/src/terms.ts`). The plan's line-number list was partial; swept all.
- [x] Regenerate agent KB (`pnpm run generate:agent-kb`) and commit `apps/erp/app/modules/agent/kb/**`
      in the same commit as MDX changes.

### Docs Phase 2 (after the Carbon API ships)

- [ ] Extend `docs/scripts/generate-api-docs.mjs`: run `packages/api/scripts/generate-openapi.mjs`
      at docs build time (no committed spec — build-time-everything strategy), consume its
      output + `@carbon/api/manifest`, join BY OPERATION NAME → merged
      `docs/lib/operations-data.generated.ts` with
      `{name, module, classification, description, schema, http: {method, path, samples}}`
      (reuse the existing httpsnippet pipeline).
- [ ] `/api/operations/[operation]`: transport `<Tabs>` — HTTP (method badge, path, curl/JS
      samples) + MCP (`call_tool` snippet).
- [ ] `/api` + `/api/authentication`: HTTP quickstart with `CARBON_API_URL`/`CARBON_API_KEY`
      (the primary API now earns the unprefixed names) — curl + "generate a client from
      `GET /api/v1/openapi.json`" (openapi-generator/orval); no npm package (not published).
- [ ] Optional (needs sign-off): `/api-reference` → `/data-api` cutover with permanent
      redirects + ERP `apiDocs` path + sitemap/search/canonicals.

### Docs verification loop (every docs step)

Dev server on port 3002 (`pnpm --filter docs dev`) — NEVER kill/restart a server the user is
running. `pnpm exec fumadocs-mdx` after frontmatter changes; `curl -sS` new pages for 200 +
expected headings (an unquoted colon in frontmatter 500s the whole site); redirect check
`curl -sI /mcp/tools` → 308. Gold standard: `pnpm --filter docs build` green in a clean state
(also runs the generators, catching count regressions). Check search facets in ⌘K, `/sitemap.xml`.

---

## Execution order

1. Docs Phase 1 (B1–B5) — independent, ships immediately, establishes positioning.
2. API Phase 0 spike → Phase 1 codegen/`packages/api` → Phase 2 server + MCP/agent migration.
3. Docs Phase 2.
4. Deferred backlog: READ→GET routing with `Cache-Control`/ETag (classification is in
   metadata — makes reads CDN-able), oRPC batch plugin for HTTP integrators (verify plugin
   identifier against v1.orpc.dev; rate limit MUST count per batched operation, not per
   request, or batching becomes a limit bypass), MCP `call_tools` batch meta-tool (MCP spec
   removed JSON-RPC batching and the oRPC batch plugin is HTTP-only — batch server-side by
   looping `call()`; READ-only first, per-item results, middleware enforcement inherited
   per item), opt-in Ajv request validation, OAuth bearer auth on `/api/v1`, typed client
   outputs, `/data-api` URL cutover.
   (Promoted INTO scope: API-key auth cache — Part A Phase 2; docs generated-data sharding —
   Part B B4. npm publish of `@carbon/api`: explicitly OUT — user decision; customers
   generate clients from the served OpenAPI spec.)

## Open questions (ask the user when reached — do not guess)

1. **rest.carbon.ms proxy** (blocks B4 item 3): which header (`Authorization: Bearer` vs
   `carbon-key`) and path shape (bare `/table` vs `/rest/v1/table`) does it accept? Infra, not
   answerable from the repo.
2. `upsert*` requiring BOTH `create`+`update` scopes — confirm (alternative: branch on `_operation`).
3. `account`/`shared` ops with `permission: null` → gated only by "valid unexpired key of the
   company" (today's MCP behavior) — confirm or hand-curate.
4. `/api-reference` → `/data-api` migration (docs Phase 2) — sign-off.

## Risks

- oRPC v2 migration later (mitigated: the whole surface is regenerable codegen).
- Splat-route registration under `api+/v1+/` unverified (Phase 0 spike de-risks; fallback names listed).
- MCP scope-gate 403s for existing under-scoped keys (accepted; changelog note required).
- Per-op permission verb-mapping heuristic will have exceptions (Phase 1 spot-check + override map).
- Plan gating: the Business-plan 403 in `requirePermissions` applies to the new surface
  automatically via the shared carbon-key branch — verify in smoke tests, don't reimplement.
- Build-time generation makes dev/CI depend on the generate task: turbo `inputs` must list the
  service/model globs correctly or caching serves a stale manifest; in dev, editing a service
  requires rerunning `pnpm generate:mcp` (unchanged from today's flow, but now nothing committed
  catches drift — the manifest tests in CI are the guard).

## Key files

Modify: `scripts/generate-mcp.ts`, `apps/erp/app/routes/api+/mcp+/lib/server.ts`,
`apps/erp/app/routes/api+/mcp+/_index.ts`, `apps/erp/app/modules/agent/agent.tools.ts`,
`packages/auth/src/services/auth.server.ts` (carbon-key branch gains the `@carbon/kv`
short-TTL key cache), api-keys route actions under `x+/settings+/api-keys*.tsx` (cache
busting on key update/revoke — not the service file, which is browser-bundled),
docs files per Part B.
Create: `scripts/lib/service-metadata.ts`,
`packages/api/**` (hand-written core + gitignored build-time `src/manifest/` output),
`apps/erp/app/routes/api+/v1+/**`,
`apps/erp/app/routes/api+/lib/operation-gate.server.ts`, `docs/app/api/**`,
turbo `generate` task wiring in `turbo.json`.
Delete (after migration): committed `apps/erp/app/routes/api+/mcp+/lib/tool-metadata.json`
(one-time diff first, then gitignore the new output path), most of `direct-executor.ts`,
`docs/app/mcp/`.
