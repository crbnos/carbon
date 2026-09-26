# Remove Supabase edge functions: implementation plan

**Source:** architecture review + edge-function inventory (2026-09-26). Precedent: MRP/scheduling move to `@carbon/planning` (PR #1151, `7f5f1d2145`; `.ai/plans/2026-08-19-schedule-in-process-node.md`, `.ai/plans/2026-08-22-ee-planning-package-extraction.md`).
**Branch:** one branch per phase (each phase leaves the tree green and deployable).
**Status:** Decisions D1–D4 resolved 2026-09-26 (see "Decisions"). Ready for Phase 0.

## Goal

Every edge function under `packages/database/supabase/functions/` is either ported to Node or deleted. The edge runtime is removed from dev, self-host, CI and deploy, and every deployed function is **deleted from each remote Supabase project** (`supabase functions deploy` never deletes, so removing the code alone leaves the old functions live).

Why: one runtime for domain logic, one auth path (the route's `requirePermissions` / Inngest), no HTTP hop or cold start, and no second in-function authorization layer to get wrong. Independent security fixes to edge functions ship on their own schedule; they do not wait for this migration.

## Target shape (from the planning precedent)

- Ported code lives in a new workspace package **`@carbon/domain`** with subpath exports per area (`/posting`, `/inventory`, `/production`, `/methods`, `/sales`, `/imports`, `/media`). Alternative: one package per area, as `@carbon/planning` did. Pick one in Task 0.1 and don't mix.
- Contract: `fn(ctx, payload)` where `ctx = { db: Kysely<KyselyDatabase>, client: SupabaseClient<Database>, companyId, userId }`. The package **never builds a pool or client**; callers pass them (routes: `getDatabaseClient()` + the `requirePermissions` result; jobs: `getJobDatabaseClient()`).
- The caller authorizes, and the domain function scopes. Every record id in `payload` is re-read under `ctx.companyId` before use, and every write keyed on a payload id carries `companyId`. Enforced by a new `@carbon/checks` rule (Task 0.4).
- Errors throw; the service wrapper keeps its `{ data, error }` shape so routes don't change (as `runMRP` did).
- Service files are browser-bundled, so they **dynamic-import** `@carbon/domain` (lesson from PR #1478 / `production.service.ts:982`).
- Idempotency: `fetchWithRetry` deliberately never retried `/functions/v1/` calls (`packages/auth/src/lib/supabase/client.ts:33-39`). In-process calls lose that implicit guard. Every posting function takes its status transition as a guarded update inside its transaction (`UPDATE … SET status = 'Posted' WHERE id = ? AND companyId = ? AND status = 'Draft'` → 0 rows = already posted → no-op). The catch-block "reset to Draft" pattern is deleted; a thrown transaction rolls back instead.
- Long-running work goes to Inngest, using the existing marker-row + 2.5 s revalidate pattern (company-template / backups). No route waits synchronously on Inngest.

## Decisions (resolved 2026-09-26)

- **D1 → Move direct callers to the v1 API.** No `/functions/v1` shim. Every capability a customer could reach by direct invoke must be available through the v1 oRPC API/registry before its function is deleted; port the contrib quote-configurator; rewrite README.md:491-510; announce a deprecation window before Phase 3 deletions ship.
- **D2 → `gte-small` in Node** (transformers.js/ONNX, 384 dims, no re-embed), run inside Inngest. Accept only if cosine similarity against edge output on a sample is ≥ 0.99.
- **D3 → QuickJS-wasm sandbox** for configuration rules: transpile the rule TS, run it in `quickjs-emscripten` with CPU/memory limits and only the `params` object exposed. Existing rules keep working.
- **D4 → Vercel max duration is 300 s.** `get-method`, `convert`, `batch-operations`, `create`, `seed-company` stay synchronous in-process when their measured p99 is comfortably under that (target < 120 s); anything over moves to Inngest + marker. `import-csv` moves to Inngest regardless.

### Options considered

- **D1: Direct API-key callers of `/functions/v1/*`.** `lib/supabase.ts` accepts `carbon-key`, and README.md:491-510 documents a supabase-js client with it, so customers can call functions directly. The only in-repo example is `contrib/building/examples/quote-configurator` → `get-method`. Recommendation: no compatibility shim at `/functions/v1` (that is the surface being removed). Instead, ensure every capability is reachable through the v1 oRPC API / registry (most already are via `registry.server.ts`), port the contrib example, update the README, and announce a deprecation window.
- **D2: Embeddings (`embed`, `embedding`).** They use the edge runtime's built-in `Supabase.ai` `gte-small` model, which has no Node equivalent. Options: (a) run `gte-small` in Node via transformers.js/ONNX: same model and 384 dims, no re-embed, cold-start model load; (b) a hosted embedding API: new model, requires re-embedding every row and possibly a vector column change. Recommendation: (a), inside Inngest, verified by cosine similarity against edge output on a sample.
- **D3: Configuration-rule execution in `get-method`.** A data-URL `import()` cannot be ported to Node. Options: (a) QuickJS-wasm sandbox (`quickjs-emscripten`) running the transpiled rule with CPU/memory limits and no host globals, which keeps existing customer rules working; (b) a declarative expression language (a product change plus a converter for existing rules). `node:vm` is not a security boundary, and `isolated-vm` is a native addon (risky on serverless). Recommendation: (a) now, (b) later if wanted.
- **D4: Vercel function duration.** It is set in the Vercel dashboard (not the repo), and a per-route `maxDuration` breaks the `@vercel/react-router` build (`.claude/rules/mrp-system.md`). We need the real value to decide which heavy flows (`get-method`, `convert`, `batch-operations`, `seed-company`, `create`) can stay synchronous. `import-csv` goes to Inngest regardless.

## Progress

- [ ] Phase 0: Foundation
- [ ] Phase 1: Delete dead functions + trivial moves
- [ ] Phase 2: Replace the Postgres → edge wake paths
- [ ] Phase 3: Small posting / production functions
- [ ] Phase 4: Document posting (equivalence-gated)
- [ ] Phase 5: Heavy flows
- [ ] Phase 6: Media + embeddings
- [ ] Phase 7: Teardown

## Dependencies

Phase 0 first. Phases 1 and 2 are independent of each other and of 3–6. Within Phase 5: `get-method` before `convert` (convert calls it); `issue` + `post-production-event` before `batch-operations` (it chains into both). `reschedule` is called over HTTP by `issue` and `trigger-rework`: extract it as a runtime-neutral module first so both runtimes use it until `issue` moves. Phase 7 last.

---

## Phase 0: Foundation

- [ ] **0.1 Create `@carbon/domain`** (or per-area packages): `package.json` exports, tsconfig with `noUncheckedIndexedAccess` (the planning move hit ~34 errors from Deno's looser config), vitest via `@carbon/config/vitest`. Add `packages/domain/AGENTS.md` stating the DI contract above.
- [ ] **0.2 Make `functions/lib` + `functions/shared` Node-clean where still Deno-only.** Keep them in place while Deno consumers remain (the planning precedent), reached through `@carbon/database` subpath barrels. Node imports must avoid `lib/database.ts` / `lib/driver.ts` (deno-postgres `queryObject`) and take types from `lib/postgres/index.ts` (lesson `.ai/lessons.md:615`). `lib/response.ts` imports deno-postgres `PostgresError`: don't use it from Node. `lib/logging.ts` must not configure LogTape in Node (`70eda5784e`).
- [ ] **0.3 Port the Deno tests to vitest.** All 42 `*.test.ts` under `functions/` use Deno std asserts; reuse the assert shim `packages/planning/src/scheduling/test-helpers.ts`. Keep the Deno CI job (`.github/workflows/check.yml:173-203`) until Phase 7; add a vitest job for the ported suites. Keep the `databaseTest` fixtures (`post-payment/payment-test-fixture.ts`) behind an env flag.
- [ ] **0.4 Conformance check `domain-scopes-payload-ids`** in `@carbon/checks`: in `packages/domain/src/**`, a Kysely/supabase read or write whose `where`/`.eq("id", …)` value derives from the payload must also constrain `companyId`. Also forbid `getCarbonServiceRole` / pool construction inside the package.
- [ ] **0.5 Equivalence harness** (`packages/domain/test/equivalence/`): seed two scratch companies from the same dataset (`applyDataset`, `packages/database/src/datasets`), run the edge function on A and the Node port on B with the same logical inputs, then diff normalized output rows (by readable ids: document status, `itemLedger`, `journal`/`journalLine`, `costLedger`, `trackedEntity`, `jobMaterial`/`jobOperation` quantities). Local stack only. Required for Phases 4–5. (The MRP move deferred this and never proved equivalence.)

**Verify:** `pnpm exec turbo run typecheck --filter=@carbon/domain`, `pnpm --filter @carbon/domain test`, `pnpm run lint`, the new check passes on an empty package and fails on a seeded bad example.

## Phase 1: Delete dead functions + trivial moves

No callers anywhere in the repo: `pick` (stub), `download`, `textract`, `transcription`, `process-image`.
- [ ] **1.1** Confirm with the owner that `process-image` (documented for REST/MCP in `packages/files/AGENTS.md:42`) has no external consumers; otherwise expose it as an ERP resource route (the pipeline already runs on Node in `@carbon/files`).
- [ ] **1.2** Delete the five directories and their `config.toml` blocks (`pick` :172, `transcription` :228, …) and the checks allowlist entries.
- [ ] **1.3** Delete dead callers: SQL `finish_job_operation()` (latest `20260417000300:66`; its trigger was dropped in `20260410031809:161`) via a new migration; the Inngest `post-transaction.ts` handlers (event `carbon/post-transaction` has no sender).
- [ ] **1.4** `export-company` only sends an Inngest event: replace `backups.service.ts:87` with `trigger("company-export", …)` from the route and delete the function.
- [ ] **1.5** Delete the removed functions from every remote project (`supabase functions delete <name>` for hosted; update `.github/workflows/functions.yml` / `sync-carbon-functions.sh` for self-hosted govcloud). Add this step to the PR checklist for every later phase.

**Verify:** typecheck erp/mes/jobs, `grep -rn 'invoke("(pick|download|textract|transcription|process-image|export-company)"'` is empty, backups export still enqueues (manual/`/test`).

## Phase 2: Replace the Postgres → edge wake paths

Live SQL callers today: `util.wake_event_queue` → `event-wake` (every transaction that dispatches events, plus pg_cron `event-queue-sweeper`); `sync_job_complete_or_canceled` → `trigger`; `util.process_embeddings` (pg_cron every 10 s) → `embed`. All post the anon key.
- [ ] **2.1** Add ERP resource route `api+/internal.pg-event.ts`: accepts `POST { event, data }`, verifies an HMAC over the raw body with a secret held in Vault (read by SQL) and in server env, constant-time compare, allowlisted event names only, then `inngest.send`. No session, no anon key.
- [ ] **2.2** Migration: `util.wake_event_queue` and `sync_job_complete_or_canceled` post to that route with the signature header. The route URL lives in `config` (replacing `apiUrl` + `/functions/v1/`). Keep the pg_net transaction/once-per-txn semantics unchanged (`.claude/rules/event-system.md`).
- [ ] **2.3** Embeddings queue: replace pg_cron `process-embeddings` + `embed` with an Inngest cron that drains `embedding_jobs` directly (depends on D2; until then keep `embed` but gate it behind service role).
- [ ] **2.4** Drop `util.invoke_edge_function` once nothing calls it; delete `event-wake`, `trigger`.

**Verify:** local stack, an insert on a subscribed table produces an `event-queue` run in the Inngest dev server; a job completion produces the notify event; forged/unsigned POSTs to the route get 401.

## Phase 3: Small posting / production functions

Per function: extract the handler into `@carbon/domain` (drop `serve`/CORS/in-function auth/module-scope pool), port its tests, repoint callers, delete the directory + `config.toml` block + remote function. One PR per 2–4 functions.

| Function | Callers to repoint | Notes |
|---|---|---|
| assign-serial-numbers | `production.service.ts:3604` | |
| close-job | `x+/job+/$jobId.status.tsx:243` | |
| correct-stock-movement | `inventory.service.ts:1691` | |
| post-card-transaction | `card-transactions.$id.void.tsx:21`, jobs `ramp-sync-card.ts:286` | already a pure handler with tests |
| post-memo, post-payment | `credits+/$memoId.{post,void}.tsx`, `payments+/$paymentId.{post,void}.tsx`, ee `stripe-connect/payment.server.ts:544,657`, ee `payment-syncer.ts:259`, jobs `ramp-sync-payment.ts:192` | they import each other's modules; move together. Routes pass the permission-checked context |
| post-inventory-count | `inventory-count+/$id.post.tsx:35` | |
| post-nonconformance | `inspection+/$id.reject.tsx:77`, `quality-disposition.server.ts:1155` | |
| post-production-event | `production.service.ts:605,10062`, `job+/$jobId.events.new.tsx:93`, mes `event.tsx:82` | batch-operations (edge) also calls it: keep the edge copy until Phase 5 or have batch-operations move with it |
| update-purchased-prices | `purchase-invoice+/$invoiceId.post.tsx:70`, `purchase-order+/$orderId.tsx:361`, `$orderId.finalize.tsx:208`, `receipt+/$receiptId.post.tsx:248` | |
| post-stock-transfer | `stock-transfer+/$id.line.quantity.tsx:100`, `$id.scan.$lineId.tsx:203` | review the route's permission requirement while repointing |
| reschedule, trigger-rework | mes `trigger-rework.tsx:29`, `inspection-lot.$id.disposition.tsx:305`; `issue` (edge) fetches reschedule | extract reschedule as a runtime-neutral module first |

**Verify:** per PR, ported vitest suites green, typecheck erp/mes/jobs/ee, `/test` on one representative flow per function (post a payment, void it; post a count; reject an inspection).

## Phase 4: Document posting (equivalence-gated)

`post-receipt`, `post-shipment`, `post-sales-invoice`, `post-purchase-invoice`, `post-inventory-adjustment`, `post-picking`. Same recipe as Phase 3, plus:
- [ ] guarded status transition + no catch-block reset (see Target shape)
- [ ] re-read every payload id under `companyId` (the check from 0.4 must pass)
- [ ] equivalence harness diff = empty on the satellite + motor datasets for post and void
- [ ] callers: receipt/shipment/invoice `post`/`void` routes, `inventory.service.ts:1599,3021,4021`, `production.service.ts:3180,10087`, mes `inventory.service.ts:504`, mes `picking.service.ts:282`, jobs `ramp-sync-bill.ts:190`

## Phase 5: Heavy flows

Order: `recalculate` → `get-method` (with the D3 sandbox) → `convert` → `create` → `issue` (+ `reschedule` fully Node) → `batch-operations` → `seed-company` → `sync` → `import-csv`.
- `get-method` (8.5k lines, 15 flows) is ported as-is here; the method-tree rewrite from the architecture review is a separate, later project. 21 callers: `items.service.ts:131`, `production.service.ts:327`, `sales.service.ts:277`, `operation.procedure.sync.tsx:27`, `convert/index.ts:1333` (edge), the contrib example (D1).
- `issue` has 29 callers across erp/mes plus `production.mcp.server.ts:98`.
- `create` has 31 callers (receipt/shipment/issue new routes, Slack interactive, mes `quality.server.ts:179`, journals).
- `import-csv` moves to an Inngest function with a marker row; `shared+/import.$tableId.tsx:76` polls. Replace the Deno std CSV parser with `csv-parse`.
- Remove the `quote+/$quoteId.convert.tsx:33` / `supplier-quote+/$id.convert.tsx:20` 2 MB bundle workaround if it no longer applies.
- Keep heavy flows synchronous only if D4's limit covers their measured p99; otherwise Inngest + marker.

**Verify:** equivalence harness for `convert`, `create`, `issue`, `get-method` (compare generated job/quote method trees by readable ids); `recalculate` quantities; the `/test` playbooks for job creation, quote → order, issue/complete on MES.

## Phase 6: Media + embeddings

- [ ] `logo-resizer` → ERP resource route using `@carbon/files` image pipeline (stays public if labels need it; add a size limit and rate limit). Caller: `packages/documents/src/labels/labelLogo.ts:59`.
- [ ] `thumbnail` → inline into the Inngest job `model-thumbnail.ts:64` with `puppeteer-core`; browserless URL + token from env only (no hard-coded fallback).
- [ ] `embed` / `embedding` per D2; `shared.service.ts:31` `generateEmbedding` calls the Node implementation.

## Phase 7: Teardown

- [ ] Move every remaining `functions/lib` + `functions/shared` module into real package source (`@carbon/database/src`, `@carbon/utils/src`, `@carbon/domain`); turn the re-export bridges (`packages/utils/src/precision.ts`, `batch-*.ts`, `@carbon/database` subpath barrels, `@carbon/files` image-pipeline import, `ramp-sync-bill-po.ts` → `shared/short-close`, `quality-disposition.server.ts` → `shared/batch-split.ts`, datasets helpers) into normal imports. Update `.claude/rules/numeric-precision.md` (the "relative import is BY DESIGN" note).
- [ ] Delete `packages/database/supabase/functions/`, `deno.json`, the `[functions.*]` blocks in `config.toml`, `scripts/setup-env-files.ts:50` functions copy.
- [ ] Infra: remove `supabase functions deploy` from `ci/src/migrations.ts:215`, `.github/workflows/functions.yml`, the `edge-functions` image in `build-images.yml:42` and `docker/edge-functions/`, the edge-runtime + chrome services in `packages/dev/docker/docker-compose.dev.yml:315-353,424`, the Kong `/functions/v1/` route (`kong.yml:114-122`), `packages/dev/docker/edge-main/`, self-host `contrib/deploying/simple-docker-caddy/docker-compose.prod.yml:516-545`, the Deno CI job.
- [ ] Code: remove the `/functions/v1/` retry exclusion in `packages/auth/src/lib/supabase/client.ts:33-39`; replace the `edge-function-authorizes-caller` check with the Phase 0.4 check; update `baseline.json`.
- [ ] Remote: `supabase functions list` on every hosted project is empty (including the old `mrp`/`schedule` from PR #1151, which may still be deployed); self-host instances have no edge runtime.
- [ ] Docs: delete or rewrite `.claude/rules/workflow-edge-function.md`, update the AGENTS.md task router ("Adding an edge function"), `.claude/rules/event-system.md` (wake path), `packages/files/AGENTS.md`, README API section (D1).

**Verify:** `pnpm run build`, `pnpm run test`, `pnpm run lint`, scoped typechecks for every package, `pnpm db:check:datasets`, `/smoke-test`, `grep -rn "functions/v1\|functions.invoke(" apps packages` is empty.

## Rough effort (estimate, not measured)

Phase 0: 1–2 wks · 1–2: 1–2 wks · 3: 2–3 wks · 4: 4–6 wks · 5: 6–10 wks · 6: 1–2 wks · 7: ~1 wk. Phases 3–6 parallelize across people once Phase 0 lands.
