# Onshape STEP sync through the assembler + assembler cleanup

## Context

Onshape models now export as STEP (branch `feat/onshape-step-export`, uncommitted) so
Onshape items get a downloadable STEP, the company-bucket original, and 3D assembly
instructions. But the sync still moves every byte through the app's Inngest function
on Vercel: Onshape → function /tmp → a second full read to hash → upload to staging →
the assembler downloads it again. The whole sync is ONE `step.run` that also sleeps
through Onshape's translation, so a large export hits the function's disk/time limits
and any late failure re-runs the Onshape translation (API quota, 402 when spent).

Goals: (1) the app function never touches model bytes — the assembler fetches from
Onshape straight into staging; (2) the sync is split into resumable steps that hold no
function while waiting; (3) no export when the model already exists; (4) drawings
translate in parallel with the model; (5) the assembler never puts a model (or any
large payload) in Redis, and the other resource/secret issues the audit finds are fixed.

Out of scope: eager assembly conversion (stays lazy), merging fetch+optimize into one
assembler pass (needs the model-row-triggered pipeline redesigned).

## Part A — Assembler cleanup (all actions)

Audited 2026-10-18 (read-only agent, every claim with file:line). Grouped by fix,
ordered so the first one closes the most findings. Paths are `apps/assembler/src/`.

A1. **Delete late-mint and parking — no model bytes ever go to Redis.** Every TS caller
mints upload URLs at submit (`assembler-client.ts:576-591`), so parking only runs after a
failed PUT. Today it stores every output's bytes in `asm:pending:{id}` on Lambda
(`jobs.rs:502-515`, non-atomic with `EXPIRE` last ⇒ a cut-off write can leave a key with
no TTL), `try_finalize` reloads the whole blob from Redis on every 500 ms poll tick
(`jobs.rs:533-585`), the Lambda/CLI path re-PUTs the same URL every 500 ms until 3600 s,
and an expired park leaves the job `uploading` until the caller's `maxWaitMs` ends it as
non-retriable. Replace all of it with: retry each PUT 3× with backoff (1/2/4 s) inside
`finish`, then `set_error("UPLOAD_FAILED")` (the TS resubmits that code,
`assembler-client.ts:457-462`). Delete `park`/`parked`/`unpark`/`park_on_disk`/
`parked_on_disk`/`sweep_dir`/`try_finalize`/`Finalize` (`jobs.rs:137-146,481-601,720-765`),
the sweeper (`main.rs:111-119`), and URL handling on poll (`main.rs:873-877`). TS: throw on
a partial mint (`assembly-convert.ts:165-168`, `model-optimize.ts` drop a URL silently)
and stop minting on every poll (`assembler-client.ts:351`). Drop `outputs` before the
callback runs (`jobs.rs:418-447`).

A2. **One request parser per action, shared by both dispatch paths — fixes a nodeId
bug.** `ang` defaults to 0.15 on the standing service (`main.rs:525`) and 0.5 on Lambda
(`run.rs:125`); the TS sends no convert options and plan always tessellates at 0.5
(`plan.rs:196`). nodeIds hash the tessellated positions (`crates/converter/src/nodeid.rs`),
so on the standing service graph.json and plan.json disagree, and one model gets
different ids per runtime. One `convert_req`/`plan_req`/`compact_req` used by `main.rs`
and `run.rs::spawn_from_spec`, one tessellation-default constant (0.5, what plan uses and
what Lambda already produces), bump `cache.rs` `CODE_VERSION`. Also aligns
`declared_hash` trimming, plan `plan_path`/`model_upload_id`, URL validation.

A3. **Secrets out of the Lambda payload, the job record and error text.**
- Lambda spec (`main.rs:395-406`) carries the service API key, signed source/PUT URLs
  and the callback HMAC. Send only `{ action, job_id, traceparent }`; the worker reads the
  request body from `asm:req:{id}` (TTL 15 min, deleted when the worker takes it). Also
  removes the Invoke payload-size failure for large plan options.
- Clear `upload_urls` and `callback_url` from the job record on done/error/cancel
  (`jobs.rs:54-60,265-266`; kept 24 h today).
- `reqwest::Error::without_url()` at every `map_err` in `http.rs` (`:90,115,131,228,259`);
  the callback failure log (`jobs.rs:470`) prints its `?token=`.
- `/events` mounted only on Lambda, failing closed with no key, and `spawn_from_spec`
  validates every URL (`main.rs:135,428-432`, `run.rs:93-96,192-202`).
- Redirects: `Policy::none()` for storage URLs; `fetch` alone follows redirects with
  `validate_url` on every hop.
- `invalidate_model` SCAN pattern: escape glob characters (`jobs.rs:639-640`; a
  `modelUploadId` of `*` clears every result pointer).

A4. **Disk and deadlines.**
- Acquire the admission grant BEFORE downloading (every action downloads first —
  `convert.rs:56/81`, `plan.rs:37/69`, …), so queued jobs hold no disk.
- Total deadlines on download/upload (size-scaled `tokio::time::timeout`) and a 10 s
  timeout on `dispatch::self_invoke` (`dispatch.rs:101-115`, `set_error` on expiry).
- Idempotent create via `SET NX` on a lock key (`main.rs:491/508`, worker `:440-444`) —
  two concurrent POSTs with one key both spawn today.
- `send_callback` in a spawned task (≤ 36 s inline today in `cancel` and dispatch failure,
  past API Gateway's 30 s).
- Drop the memory grant before any await after compute and use `std::fs` inside the
  blocking closure (`convert.rs:81-131`; possible blocking-pool deadlock, unverified).
- Temp files named `geometry-*` so startup cleanup catches them (`optimize.rs:686`).

A5. **Fewer whole-model copies in memory.**
- GLB built then copied by `to_vec()` (`crates/converter/src/glb.rs:331-347`): write into
  one Vec sized up front.
- Optimize keeps the full lossless result through every targeted pass
  (`optimize.rs:508-582,627`): keep only the sizes.
- Ingest's compressed raw stays in memory through optimize, thumbnail and upload
  (`optimize.rs:63-119,326-331`): compress to a temp file after optimize, upload via mmap.
- Mesh sources read whole with `std::fs::read` (`optimize.rs:663-664,706-707`): mmap, as
  GLB/glTF already are.

A6. **Dead code.** `X-Plan-Upload-Url` (`main.rs:917-924`), the inline plan result
(`plan.rs:155-167`, TS `inlinePlan` `assembly-plan.ts:214`; 400 without `planPath`),
`?sync` (`main.rs:349-380`), the `run-job` CLI (`run.rs:35-78,204-220`, `main.rs:85-89`;
nothing deploys it), `meta` capped to known keys (`main.rs:853-858`), and the stale
"late-mint"/"never bytes in Redis" comments (`convert.rs`, `compact.rs`, `thumbnail.rs`,
`plan.rs`, `config.rs`, `jobs.rs` headers).

Follow-ups (not in this plan): a stale-lease takeover for a Lambda worker that crashed
mid-job (`main.rs:444-458`), compare-and-set status writes so `set_done` cannot overwrite
a cancel (`jobs.rs:272-317`), cancellation inside an in-flight download/upload, DNS-level
SSRF checks, a compute deadline on the standing service.

## Part B — Assembler `fetch` action

New action modelled on `src/actions/thumbnail.rs` (smallest template).

- Request: `POST /v1/fetch` `{ source: { url, authorization? }, maxBytes? }`,
  `X-Carbon-Upload-Urls: { raw }`, `Idempotency-Key: jobId`, `callback_url`.
- Registration in every place actions are listed: route in `main.rs` (~120–135),
  `actions/mod.rs`, `run.rs::spawn_from_spec` match, discovery list `main.rs:233`, the
  TS `action` union in `assembler-client.ts:251`.
- `http::download_hashed` gains an optional `authorization` header, set with
  `HeaderValue::set_sensitive(true)`. reqwest's default redirect policy already strips
  `Authorization` on a cross-host redirect (`remove_sensitive_headers`), so an Onshape
  redirect to a presigned store is safe. The header is never copied into `meta`, the
  Redis record, logs or spans.
- Enforce `maxBytes` during download → 413 `LIMIT_EXCEEDED` (the existing check at
  `http.rs:165` reads `config::max_source_bytes()`; make it per-request).
- Upload the downloaded file unchanged via `http::map_file` (memory-mapped, no heap
  copy) as the single `raw` output through `finish` (A1's retry, never parked).
  zstd auto-decode cannot trigger: STEP starts `ISO-10303-21;`.
- Follows redirects with `validate_url` on each hop (A3); everything else uses none.
- No admission grant beyond the 64 MB minimum (no compute).
- Result: `{ contentHash: <xxh3-128 hex>, bytes }`.
- The Onshape token (≤ 1 h) lives only in the request: on Lambda in `asm:req:{id}`
  until the worker takes it (A3), never in the Invoke payload, the job record or `meta`.

## Part C — Onshape sync pipeline (jobs)

Files: `packages/jobs/src/inngest/functions/integrations/onshape-sync-element.ts`,
`onshape-attach.ts`, `onshape-panel-sync.ts`, `onshape-revision-sync.ts`,
`onshape-backfill.ts`; `packages/ee/src/onshape/lib/client.ts`.

C1. **Client:** add `OnshapeClient.externalDataDownload(documentId, foreignId)` →
`{ url, authorization }` (the token and base URL are private today; base URL covers
onshape-government tenants). Called inside the assembler submit step, so every
(re)submit gets a fresh token from `getOnshapeClient` (refreshes within 120 s of expiry).

C2. **`runOnshapeElementSync(step, carbon, input, prefix)`** replaces
`syncOnshapeElementAssetsToItem` (which runs everything in one caller step):
1. `${p}-existing` — for a part with a source id (computed BEFORE export now), look up
   the `modelUpload`; if it exists, skip the model translation and fetch entirely.
2. `${p}-translate` — start the model translation (unless reused) and every drawing
   translation at once; return their ids.
3. `${p}-poll-${n}` + `step.sleep(${p}-sleep-${n})` — poll all pending translations
   together, same backoff as today (2 s × 1.5 → 15 s, 40 polls). Holds no function.
4. `${p}-fetch` — `assemblerEnabled()` ? `runAssemblerJob({ action: "fetch" })` into
   `temp-staging/${companyId}/models/onshape-fetch-${translationId}.step`
   : one step that runs today's `downloadExternalDataToFile` + upload to the same key
   (no assembler configured ⇒ unchanged behaviour). Both return
   `{ stagedPath, size, contentHash }`, or `{ tooLarge: true }` — returned, not thrown,
   because error classes don't survive Inngest step serialization.
5. `${p}-drawings` — download the PDFs in parallel and upload them to their document
   paths; return metadata only (step output size limit).
6. `${p}-attach` — `attachOnshapeAssetsToItem` takes the staged model and pre-uploaded
   documents. `ensureImmutableModel` MOVES the staged object to
   `${companyId}/models/${id}.step` (`storage.move`, same bucket) instead of uploading;
   `contentSourceId` hashes `["content-v2", companyId, itemId, fileName, contentHash]`
   — no second pass over the file.
7. `${p}-thumbnail` — unchanged.
Each Onshape-calling step is wrapped in `withRateLimitRetry` (move it out of
`onshape-backfill.ts` into a shared module).

C3. **Callers:**
- `onshape-panel-sync`: call the pipeline at top level; add `ASSEMBLER_CONCURRENCY`
  as its second concurrency key.
- `onshape-revision-sync`: split `runOnshapeRevisionSync` into a `resolve-revision`
  step (revision lookup + item match), then the pipeline; `asset-too-large` from the
  returned flag.
- `onshape-backfill`: per item, `step.invoke` a new thin function
  `onshape-element-sync` (event `carbon/onshape-element-sync`) that runs the pipeline —
  keeps a long backfill under Inngest's per-run step limit. Same failure counting.

C4. **Orphans:** confirm the temp-staging sweep (`scheduled/cleanup.ts`) removes an
unreferenced `onshape-fetch-*` object left by a failed attach; extend it if not.

## Order and deploy

One branch, `feat/onshape-step-export` (already holds the uncommitted STEP switch, which
becomes the first commit). Then commits in this order: A1 → A2 → A3 → A4 → A5 → A6 → B →
C, each with its own tests; plan copy at `.ai/plans/2026-10-18-onshape-assembler-fetch.md`.
The assembler (A + B) is deployed from this branch before the branch merges (C needs it). A1's TS half (no mint on poll, throw on a
partial mint) ships with the assembler change, since the service stops reading poll URLs.
A jobs deploy against an assembler without `fetch` fails the sync with a 404
(non-retriable) — no silent data loss. A2 changes nodeIds on the standing service only
(Lambda already uses 0.5); `CODE_VERSION` invalidates cached graphs/plans.

## Docs and rules

`.claude/rules/onshape-panel.md` (Background job section), `apps/assembler/AGENTS.md`
(actions list, parking, fetch), `packages/jobs/AGENTS.md` (new function),
`docs/content/docs/integrations/cad.mdx` only if behaviour visible to users changes.

## Verification

- `cargo test` in `apps/assembler`, with a small local axum listener as the HTTP
  boundary (none exists today): fetch (bearer checked, hash + size, header dropped on a
  cross-host redirect, 413 past `maxBytes`); A1 (a PUT that fails twice then succeeds
  finishes `done`; three failures ⇒ `UPLOAD_FAILED`, nothing written under
  `asm:pending:*`); A2 (both dispatch paths parse one body to the same request);
  A3 (`without_url` error text has no query string; glob escaping). Redis-backed tests
  run against the local Redis `crbn up` starts, skipped when absent.
- Existing stored graph.json/plan.json are untouched by A2: only new conversions change,
  and only on the standing service.
- `pnpm --filter @carbon/jobs test` (Onshape + assembler-client) and scoped typechecks
  (`@carbon/ee`, `@carbon/jobs`, `erp`, one at a time).
- Live (local stack + local assembler): push a part and an assembly from the panel —
  `modelUpload` is `.step`, optimize succeeds, Download returns STEP, a new assembly
  instruction converts and plans; re-push the same release ⇒ no translate/fetch step in
  the Inngest run; a part with a drawing shows model + drawing translated concurrently.

## As built (2026-10-18)

- A2 and A6 landed as one commit: removing the `run-job` CLI and `?sync` is what
  let one `request::parse` serve both runtimes (`src/request.rs`).
- A4's "admission before download" became a separate bound: `source.rs` source
  slots (cores + 2), held from download until the `Source` drops (which deletes
  the file). Taking a memory grant first would let `Grant::resize` release it
  while waiting and admit new downloads anyway.
- A3 kept `callback_url` on ended jobs (the Lambda worker re-sends the
  callback); only upload URLs are cleared.
- A5's GLB fix shifts the header and JSON into the binary buffer's allocation
  (`layout_glb`), pinned byte-for-byte against `gltf`'s `Glb::to_vec`.
- C3 changed after reading Inngest's concurrency guide: no Onshape function
  carries `ASSEMBLER_CONCURRENCY` (every executing step counts against a
  function's keys, so the polls took the five shared slots). The fetch is its
  own function, `onshape-fetch`, `step.invoke`d by the pipeline.
- Not done: the live verification (needs an Onshape document pushed through a
  local stack with a local assembler), and Inngest checkpointing (a client-wide
  change that needs the Vercel function's max duration for `maxRuntime`).
