# Plan: Assembler code for ECS-service-default (Lambda as optional cost-mode)

Date: 2026-07-15 (revised)
Spec: `.ai/specs/2026-07-15-assembler-deployment.md`
Scope: **code only** — Rust assembler + `@carbon/jobs` + Dockerfile. IaC (ECS
service, ALB, autoscaling, VPC, SST/CI) is a downstream handoff.

## Pivot (Sid, 2026-07-15)

**Run the assembler as a standing ECS service** (the primary), async submit→poll
over HTTP behind a load balancer. **Lambda stays available as an optional
cost-mode** (scale-to-zero) if idle cost ever bites — but it is no longer the
default. This **diverges from the spec's Lambda-default stance**; the spec needs a
changelog update to record the flip (noted in Tasks).

### Why this is *less* code, not more

The assembler is **already a standing async HTTP service** and its job store is
**already multi-replica-safe**:

- `apps/assembler/src/jobs.rs` — `Backend::Redis` keeps job **status + pointers** in
  Redis, and holds the pending late-mint artifact bytes in Redis under a short TTL
  **"so ANY replica's poll can drain it"** (its own doc comment). `Backend::Memory`
  is process-local (single-process/dev).
- So with `ASSEMBLER_REDIS_URL` set, N replicas behind a round-robin LB Just Work:
  submit lands on replica A, the poll can be served by replica B (status from Redis,
  pending bytes from Redis). No sticky sessions, no refactor.
- `packages/jobs/.../assembler-client.ts` already does submit→poll against
  `ASSEMBLER_SERVICE_URL` with `internalizeStorageUrl` (no-op in prod). Pointing that
  URL at the ECS load balancer is the whole integration change.

The big sync/`run-job`/router refactor from the earlier draft was **only for Lambda**.
It moves to an **optional** workstream, gated on cost.

## Verified current state

- `main.rs` — axum `/v1/{convert,optimize,plan}` (submit → 202), `/v1/jobs/:id`
  (long-poll, drains late-mint via `X-Carbon-Upload-Urls`), `/v1/cache/invalidate`,
  `/health`, `/v1` discovery. `main()` → tokio runtime → `serve()`.
- `config.rs` — `max_concurrency` (semaphore), `shutdown_grace` (default 600 s),
  `max_source_bytes` (0 = unlimited, set earlier), `redis_url` (Redis when set +
  reachable, else Memory), TTLs, URL/SSRF policy (`require_https`/`verify_tls` off
  under `ASSEMBLER_DEV_MODE`).
- `actions/optimize.rs` — inline `run_optimize` (streaming glTF→GLB repack done;
  bounded memory), a **size** ladder gate (`cannot_fit_budget`).
- `Dockerfile` — static OCCT+Draco, `EXPOSE 8000`, `/health`, `USER assembler`.

## Workstream A — ECS-service readiness (the real code work; small)

- [ ] **Redis is the prod default.** No code change (env: `ASSEMBLER_REDIS_URL`
      set). Add a **boot log line** that states the backend (`Redis`/`Memory`) and,
      on Redis, **warn loudly if unset in a multi-replica context** — a Memory
      backend behind an LB with >1 task silently breaks cross-replica polls. Confirm
      `existing_active` / `set_pending` / late-mint all round-trip on Redis (they do
      by design; add an integration test against a local redis).
- [ ] **Graceful shutdown / SIGTERM drain.** Verify `serve()` installs a shutdown
      signal handler (SIGTERM/SIGINT) with `axum::serve(...).with_graceful_shutdown`
      that (a) stops accepting new work, (b) waits up to `shutdown_grace` for
      in-flight jobs, then exits. **If not wired, add it.** This is what makes
      rolling deploys + scale-in / (later) Spot drains lossless. Align
      `stopTimeout` (IaC) with `shutdown_grace`.
- [ ] **Concurrency / backpressure.** Confirm the `max_concurrency` semaphore returns
      **429 + `Retry-After`** when full (so the LB/autoscaler sheds instead of OOM).
      Default `max_concurrency` should track the task's vCPU (OCCT is CPU-bound);
      document the `vCPU → max_concurrency` guidance.
- [ ] **Autoscaling signal.** Prefer **CPU target-tracking** (no code). If queue-depth
      scaling is wanted later, expose in-flight + pending counts on `/v1` discovery
      (cheap) for a custom CloudWatch metric — optional, deferred.
- [ ] **Health vs readiness.** `/health` exists (liveness). Confirm it returns
      healthy only once the server is actually serving (post-bind); that doubles as
      the LB target-group health check. A separate readiness gate is unnecessary
      (stateless workers).

## Workstream B — Per-job robustness / bounding (applies to any runtime)

- [ ] **Memory bounding** — the streaming glTF→GLB repack (done) keeps geometry in an
      mmap'd `/tmp` file off-heap. Confirm the optimiser working set fits the task's
      RAM (4 vCPU / 16 GB tier); document the practical max input. jemalloc on linux
      already curbs fragmentation.
- [ ] **`/tmp` discipline** — temps (download + repacked glb) under `std::env::
      temp_dir()`; prompt `remove_file` on done/error (present). On ECS the container
      FS is ephemeral + sized by task storage — set the ephemeral/`/tmp` size in the
      task-def (IaC) to fit `raw + repacked + output`.
- [ ] **Time/size gates** — the size ladder exists. A **wall-clock budget** is
      **not required** for an ECS service (no 15-min cap) — a long job just runs. Keep
      it **optional**, only wired if the Lambda cost-mode (Workstream C) is enabled.
- [ ] **SSRF/auth for prod** — `ASSEMBLER_ALLOWED_URL_HOSTS` set, `ASSEMBLER_DEV_MODE`
      unset (https + TLS verify + private-IP default-deny — wired), bearer on every
      non-`/health` route (present).

## Workstream C — Optional Lambda cost-mode (deferred; only if idle cost bites)

Everything from the earlier draft, kept but **not on the critical path**:

- [ ] Sync execution via `X-Carbon-Sync: 1` + request-carried `upload_url` (inline
      run + upload + return JSON), the `run-job` CLI (arg-dispatch in `main()`),
      the **wall-clock time-budget gate** (the 900 s fit), Redis-off-on-Lambda, LWA
      extension in the Dockerfile, and the TS **router** (size pre-route → Lambda
      invoke-and-await → fallback to the ECS service).
- [ ] The ECS **service** (Workstream A) is the fallback target for Lambda overflow —
      no separate one-shot RunTask path needed once a standing service exists (a
      simpler topology than the spec's Lambda+one-shot-ECS).

Full detail preserved in the spec (`2026-07-15-assembler-deployment.md` P1/§Design);
implement only when cost forces scale-to-zero.

## Workstream D — Dockerfile / image

- [ ] Confirm the standing-service image is complete: `EXPOSE 8000`, `/health`,
      non-root, static OCCT/Draco, sane default `CMD` = the HTTP server. No LWA needed
      for the ECS service (LWA is added only under Workstream C for Lambda).
- [ ] `ASSEMBLER_BIND=0.0.0.0:8000` in the container so the LB/target group reaches it
      (dev binds `127.0.0.1`).

## Workstream E — TS job layer (minimal)

- [ ] **No refactor.** Keep `submitAssemblerJob` + `pollAssemblerJobOnce`. The only
      prod wiring: `ASSEMBLER_SERVICE_URL` = the ECS load-balancer URL,
      `ASSEMBLER_SERVICE_API_KEY` = the bearer (both already in `@carbon/env`).
      `internalizeStorageUrl` no-ops in prod. `model-optimize`/`assembly-convert`/
      `assembly-plan` are unchanged.
- [ ] (Only if Workstream C lands) add the `invokeAssembler` router.

## Workstream G — Inngest job-layer hardening (for a standing service)

A standing service **restarts on every deploy** and scales; the Inngest tasks must
tolerate that. Grounded in the current code.

- [ ] **Fix retry classification (bug).** `assembler-client.ts::submitAssemblerJob`
      throws `NonRetriableError` on **every** non-429 status, so a **5xx during a
      rolling deploy** fails the job permanently. Split it:
  - **4xx** (bad input / permanent reject) → `NonRetriableError` (fail fast). ✓
  - **5xx / connection refused / timeout** (outage / deploy / restart) → a **plain
    `Error`** (retryable — Inngest retries after the service returns).
      Shared client → fixes `model-optimize` + `assembly-convert` + `assembly-plan`
      at once. Mirror in `pollAssemblerJobOnce` (a transient poll 5xx should retry,
      not fail — it already throws a plain `Error`; keep it that way).
- [ ] **Raise retries for deploy resilience.** `model-optimize` is `retries: 2`; a
      rolling deploy can outlast 2 exponential backoffs. Bump to ~4–5 (and audit
      convert/plan) so a job survives a deploy window. Idempotent by `jobId`
      (`optimize-${modelUploadId}` + the assembler's `existing_active` + declared-hash
      result cache), so extra retries just re-attach / hit the cache — never
      double-compute.
- [ ] **Align the wait budget with uncapped ECS jobs.** `MAX_OPTIMIZE_WAIT_MS = 15
      min` was sized to the (old) Lambda-ish ceiling. On a standing service there is
      **no cap** — a big job (e.g. the 1.73 GB glTF) can exceed 15 min, at which point
      the Inngest poll loop **gives up while the service is still working and
      uploads the artifact anyway** → row goes `Failed` despite a good GLB (state
      mismatch). Raise `MAX_OPTIMIZE_WAIT_MS` to the real max (≈ `assembly-plan`'s 40
      min, or derive from size); the Inngest budget is now the effective cap, so make
      it generous. Audit `assembly-convert` similarly (`assembly-plan` already 40 min).
- [ ] **Align concurrency with the service's capacity.** Inngest `model-optimize`
      concurrency is `[{limit:4},{company:2}]`; the assembler caps in-flight via its
      `max_concurrency` semaphore (per replica). Set Inngest global concurrency ≈
      `replicas × max_concurrency` so it doesn't 429-storm a single replica (the
      `BUSY_RETRIES` + `Retry-After` backoff is the safety net, but tuning avoids the
      churn). Document the relationship; it's a deploy-time number.
- [ ] **Dedup rapid re-triggers (optional).** `model-optimize` fires from several
      call sites (upload, both drag routes, Part/Tool insert, the Retry route). The
      assembler dedups server-side (`Idempotency-Key`), but two near-simultaneous
      triggers still spawn two function runs that both attach + both persist. Consider
      an Inngest `idempotency: "event.data.modelUploadId"` (windowed) to collapse them.
- [ ] **Terminal-failure row status is already right** — `model-optimize` `onFailure`
      → `optimizeStatus: "Failed"`, `assembly-plan` `onFailure` → `Failed`. Confirm
      `assembly-convert` does the same so the viewer's Retry surfaces on every path.

## Workstream F — Tests & verification

- [ ] Rust: an integration test of the Redis backend cross-replica invariant —
      `set_pending` on one `JobStore`, poll/finalize from a second `JobStore` sharing
      the same redis (proves multi-replica polling). A graceful-shutdown test
      (SIGTERM mid-job → in-flight completes, no new accepts).
- [ ] `cargo test -p assembler`; image builds; run the container with a local redis +
      2 replicas behind a tiny round-robin proxy → submit on one, poll on the other →
      success (the horizontal-scale proof).
- [ ] TS: a `submitAssemblerJob` unit test asserting **5xx / connection error →
      retryable throw**, **4xx → `NonRetriableError`** (the deploy-resilience fix).
      Path still green (`pnpm --filter @carbon/jobs typecheck` + `test`).

## Out of scope (downstream IaC)

ECS **service** definition (desired count, rolling deploy), ALB + target group +
health check, service-autoscaling policy (CPU target-tracking), VPC/subnets/SG, the
Redis the service points at (existing `@carbon/kv` redis or an ElastiCache), SST/CI,
GovCloud fan-out, ECR repos. This plan produces the **code + image** those consume.

## Sequencing

1. **A + B + D + E + G** — make the standing service production-solid (Redis-default
   log, graceful drain, 429 backpressure, bind `0.0.0.0`, cross-replica test) **and**
   the Inngest layer deploy-resilient (5xx-retryable, wait budget, retries). Small.
   The retry-classification fix (G) is worth doing **now regardless of deployment** —
   it's a latent bug the moment the dev/prod service ever restarts mid-job.
2. Hand to IaC for the ECS service + ALB + autoscaling.
3. **C (Lambda cost-mode)** — only if/when idle cost justifies the sync refactor.

## Decisions (locked)

- **Primary = standing ECS service**, async submit→poll, multi-replica via the
  existing Redis job store. **Lambda = optional cost-mode**, deferred.
- Update the deployment **spec's changelog** to record this flip from Lambda-default.

## Risks

| Risk | Mitigation |
|---|---|
| Memory backend behind an LB with >1 task → cross-replica poll misses | Redis is the prod default + a loud boot warn when Memory + scaled; cross-replica integration test |
| Graceful drain not wired → rolling deploys drop in-flight jobs | verify/add `with_graceful_shutdown` + `shutdown_grace`; align `stopTimeout` |
| Standing service = non-zero idle cost | accepted trade for simplicity; Lambda cost-mode (Workstream C) is the escape hatch |
| Long/huge job on a small task → OOM | size the task tier (4 vCPU/16 GB); streaming repack (done) bounds memory; 429 backpressure sheds overload |
