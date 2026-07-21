# Assembler Service Deployment — Lambda-default + ECS-Spot service overflow

> Status: design → ready for implementation (approval gate before any prod deploy)
> Author: Claude (with Sid Rathi)
> Date: 2026-07-15
> Supersedes: `.ai/specs/2026-07-06-geometry-service-deployment.md` (Python-era,
>   two always-on Fargate services). Facts below fact-checked against AWS/SST docs
>   (July 2026).

## TLDR

Run the Rust assembler **serverless by default on AWS Lambda** (container image),
and overflow jobs too big/long for Lambda's 15-min ceiling to a **long-running ECS
Fargate Spot _service_** (the same image, default HTTP entrypoint). **One image, two
runtimes.** Cheapest viable option (~$0 idle, ~$10–30/mo typical), needs **no scaling
to manage** ("don't scale it until someone complains" → the service is **config-gated,
desiredCount 0 / not deployed by default**; Lambda handles everything until a
complaint bumps it up), and works in **GovCloud** — one strategy for both
environments, one **shared** deployment each (Vercel-serving commercial +
GovCloud/ITAR), **not** per-workspace. New feature; cost floor stays at zero.

The trade — **smaller than the earlier one-shot-RunTask draft**: only the **Lambda
path** needs the async→**synchronous** refactor (Lambda freezes after the response,
so a spawned job must run inline). The **ECS service keeps the assembler's existing
async submit→poll** — it's a warm HTTP backend, no refactor, no `run-job` CLI on the
hot path. The compute (`run_optimize`/`convert`) already runs inline; the Lambda
handler drains a spawned job with `run_to_completion` (already built) instead of
returning 202.

## Verified facts (AWS/SST docs, Jul 2026)

- **Lambda**: container image ≤ **10 GB**; memory ≤ **10,240 MB**; timeout **900 s
  (15 min, hard cap — not raisable)**; `/tmp` **512 MB–10,240 MB**. In **both
  GovCloud regions** incl. container images + cross-account ECR.
- **AWS Lambda Web Adapter (LWA)**: an extension that proxies the Lambda invoke →
  your existing HTTP server, no code change. **Same image runs on Lambda, Fargate,
  EC2, local.** Copy its binary to `/opt/extensions`; **default port 8080 → set
  `AWS_LWA_PORT=8000`** (the assembler binds 8000).
- **Fargate Spot**: 50–70% off; **2-min interruption warning** (EventBridge +
  SIGTERM). Use **`capacityProviderStrategy` NOT `launchType`** (they conflict).
  `stopTimeout ≤ 120 s` for graceful drain. An **ECS _service_ on FARGATE_SPOT
  auto-reschedules** an interrupted task to hold `desiredCount` (unlike a one-shot
  `RunTask`); the in-flight job on the killed task is lost → the caller (Inngest)
  retries, and steady-state capacity self-heals.
- **SST v3**: `sst.aws.Function` does **not** accept a prebuilt container image →
  use raw **`aws.lambda.Function` `{ packageType: "Image", imageUri }`** inside
  `run()` (SST v3 is Pulumi-based, so raw `aws.*` resources compose fine).

## Already done (Rust rewrite)

- Production Dockerfile (`apps/assembler/Dockerfile`, static OCCT+Draco, `EXPOSE
  8000`, `/health`) + cached OCCT base (`occt.Dockerfile`).
- Redis job store (`ASSEMBLER_REDIS_URL`, Memory|Redis) — mostly moot in sync mode,
  kept for the result cache.
- `ASSEMBLER_SERVICE_URL`/`_API_KEY` in `@carbon/env`, consumed by the Inngest tasks.

## Design

### One image, two runtimes — same entrypoint both places

The single `carbon/assembler:${sha}` image (built once) runs `serve()` (the axum HTTP
app) as its default CMD **everywhere**:
- **On Lambda** the **LWA extension** (`COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.9.1 /lambda-adapter /opt/extensions/lambda-adapter` + `ENV AWS_LWA_PORT=8000`) proxies the invoke → the same HTTP server, unchanged.
- **On the ECS service** it's just the HTTP server behind an ALB — a normal warm backend.

No per-runtime CMD switch on the hot path. The `run-job` CLI (`assembler run-job
<spec.json>`) is retained only as an **optional batch/manual entrypoint** (cron,
one-off reprocessing) — it is **not** used by either production path now that overflow
is a standing service. `run_to_completion` (the drain-to-terminal helper it shares) is
reused by the Lambda sync handler below.

### Runtime A — Lambda (default)

- `aws.lambda.Function` `{ packageType: "Image", imageUri, memorySize: 10240,
  timeout: 900, ephemeralStorage: 10240, architectures: ["x86_64"] }` + a **Function
  URL** (bearer-gated) or direct SDK `Invoke`.
- **Synchronous execution**: the HTTP handler runs the whole job in-request
  (download → tessellate → optimize → **upload to the caller-provided signed URL**
  → return small JSON). The GLB never transits the response (late-mint upload), so
  the 6 MB Function-URL response cap is a non-issue.
- The **time-budget gate** (degrade quality until it fits ~12 min, mirroring the
  size gate) keeps ~all jobs inside 900 s.
- Auto-scales, **$0 idle**, GovCloud-capable. Cold start ~1–3 s after first pull
  (fine — background job).

### Runtime B — ECS Fargate Spot _service_ (overflow, config-gated)

- A **long-running `aws.ecs.Service`** (Fargate, FARGATE_SPOT capacity provider)
  running the same image's default HTTP CMD, behind an **ALB** (internal, or public +
  bearer) at a stable URL. 4 vCPU/16 GB task tier for the big-job tier.
- **Config-gated / default-off:** `desiredCount: 0` (or the service simply not
  deployed) until a real overflow need appears — "don't scale until someone
  complains." When enabled it runs **≥1 warm task**; the router uses it only when
  `ASSEMBLER_ECS_SERVICE_URL` is configured, else overflow degrades (poster tier).
- **Native async, no CLI, no RunTask:** the warm service handles jobs through the
  assembler's existing **submit→poll** API (`POST /v1/optimize` → 202 → `GET
  /v1/jobs/{id}?wait`) — the Redis/in-memory job store is used as originally
  designed. No `run-job` orchestration.
- `stopTimeout: 110` + SIGTERM drain. On Spot interruption the **service reschedules**
  the task to hold `desiredCount`; the in-flight job is lost → the client's poll fails
  → **Inngest retries** (idempotent, keyed by `modelUploadId` + the declared-hash
  result cache). Steady-state capacity self-heals.
- No 15-min ceiling — a service task runs as long as the job needs.

### Router (`packages/jobs/.../tasks/model-optimize.ts`)

1. **Pre-route by size** — source > threshold (e.g. > 150 MB, or estimated tris over
   budget) → straight to the **ECS service** (async submit→poll) if
   `ASSEMBLER_ECS_SERVICE_URL` set, else degrade.
2. Else → **invoke Lambda** (sync), await the result.
3. **Fallback** — Lambda returns "timed out / too large" (or the invoke times out) →
   re-dispatch to the ECS service (or degrade if not enabled).
Most jobs never touch ECS; when the service is off, overflow jobs degrade rather than
run — an explicit, cheap default.

### Job-layer changes (smaller than the RunTask draft)

- `assembler-client.ts`: add **`invokeLambda(spec)`** (await the sync result) for the
  default path. **Keep** `submitAssemblerJob` + `pollAssemblerJobOnce` — the ECS
  service is a normal async assembler endpoint, just pointed at
  `ASSEMBLER_ECS_SERVICE_URL`. No RunTask/STOPPED-wait code.
- `model-optimize.ts` / `assembly-convert.ts` / `assembly-plan.ts`: call the router
  (Lambda-sync default, ECS-async overflow).
- Assembler: add the **sync HTTP handler** (spawn + `run_to_completion` inline,
  return) for the Lambda path. The async `/v1/jobs` API is **retained as the ECS
  service's primary contract** (and local dev), not a fallback.
- The only net-new is the Lambda sync handler + the router; the async path stays.

### Two environments — one **shared** assembler each (NOT per-workspace)

**Decision (Sid, 2026-07-15): ITAR/GovCloud is NOT per-workspace.** So there is no
`ci/src/deploy.ts` fan-out and **no new `workspaces` columns** for the assembler —
Brad's per-workspace design is dropped. The service holds no tenant data at rest
(files via signed URLs, Redis job records transient), so **one shared deployment per
environment** serves all tenants in that environment:
- **Commercial (Vercel-serving):** one Lambda + one (default-off) ECS service +
  cluster in the shared commercial account; Lambda Function URL public + bearer at
  `assembler.carbon.ms`; the service (when enabled) behind an ALB at
  `assembler-svc.carbon.ms` (or internal).
- **GovCloud (ITAR):** the **same** hybrid, one shared deployment in the GovCloud
  account/region; internal or public URLs + bearer. `assembler.itar.carbon.ms`.

Both are deployed on their **own cadence** (not through the workspace fan-out). ERP/MES
in each environment get `ASSEMBLER_SERVICE_URL` (that env's Function URL) +
`ASSEMBLER_SERVICE_API_KEY` from env/secrets — a single value per environment, not
per workspace.

## SST specifics

- **Lambda:** raw `new aws.lambda.Function("Assembler", { packageType: "Image",
  imageUri: <ecr>/carbon/assembler:${IMAGE_TAG}, memorySize: 10240, timeout: 900,
  ephemeralStorage: { size: 10240 }, environment: { variables: { ASSEMBLER_*, … } },
  role: <exec-role with ECR + logs + s3/signed-url + redis SG> })` + a
  `aws.lambda.FunctionUrl` (auth `NONE` → bearer-gated in-app, or `AWS_IAM`).
  **Not** `sst.aws.Function` (no prebuilt-image support).
- **ECS overflow:** `sst.aws.Cluster` + `sst.aws.Service` (Fargate, 4 vCPU/16 GB,
  FARGATE_SPOT capacity provider, `scaling: { min: 0/1, max: N }`, ALB on `/health`)
  — **default `desiredCount: 0`** / gated behind a stage flag. A small VPC (public
  subnet + SG, **no NAT**) or reuse the GovCloud VPC. No RunTask code — the router
  hits the service URL over HTTP.
- **ECR repos** `carbon/assembler` + `carbon/occt` created **out-of-band** (nothing
  in-repo auto-creates them; same as `carbon/erp`).

## CI

- **OCCT base** (`apps/assembler/occt.Dockerfile` → `carbon/occt:8.0.0-p1`), built +
  pushed once (path-filtered / manual).
- **Assembler image**: `docker/build-push-action` with `context: .`,
  `file: apps/assembler/Dockerfile`, `--build-arg OCCT_IMAGE=<ecr>/carbon/occt:8.0.0-p1`,
  Trivy scan, push `carbon/assembler:${sha}`. Add `apps/assembler/**`,`crates/**` to
  `paths`.
- **Deploy**: update the Lambda image (`aws lambda update-function-code
  --image-uri …:${sha}`) + (when the service is enabled) a new task-def revision +
  service update. **One shared deployment per environment** on its own cadence — not
  the workspace fan-out.

## Security

- **Auth** — bearer key on every non-`/health` route (Function URL auth `NONE` +
  in-app key, or `AWS_IAM`). Callers: ERP/MES/Inngest with `ASSEMBLER_SERVICE_API_KEY`.
- **SSRF** — `ASSEMBLER_ALLOWED_URL_HOSTS` set in prod (`ASSEMBLER_DEV_MODE` unset →
  default-deny).
- Least-priv IAM exec role; non-root already (`USER assembler`); Trivy scan;
  SHA-pinned image.

## Cost

| | Monthly |
|---|---|
| **Lambda** (typical volume, sync jobs, $0 idle) | **~$10–30** |
| ECS Spot service — **default off** (`desiredCount 0`) | **$0 standing** |
| ECS Spot service — **when enabled** (ALB ~$16 + ≥1 Spot 4vCPU/16GB task) | **~$30–55** |
| Two always-on Fargate services (the rejected plan) | ~$400–500 |

Per Lambda job ≈ 10 GB × ~10 s × $0.0000167/GB-s ≈ **$0.0017** + request. Lambda path
is scale-to-zero with no ALB/VPC/NAT. The service costs $0 until a complaint turns it
on — the standing cost is opt-in, not the default.

## Rollback

- **Lambda:** publish versions/alias; roll the alias back to the prior version, or
  `update-function-code` to the previous `:sha`. Instant.
- **ECS service:** roll the service back to the prior task-def revision, or set
  `desiredCount 0` to disable overflow entirely (Lambda-only).
- Consumers degrade gracefully — a down assembler leaves models on the poster tier;
  no data loss (raw + prior artifacts untouched).

## Acceptance criteria

- [ ] `carbon/occt` + `carbon/assembler:${sha}` in ECR; LWA extension present; Trivy
      clean.
- [ ] Lambda: STEP fixture via Function URL → optimize completes (artifact in
      storage, row updated); no bearer → 401; a job that would exceed 12 min
      degrades via the time gate and still returns ≤ 15 min.
- [ ] Overflow: with the service enabled, a > threshold source routes to the ECS
      service (async submit→poll, Spot), completes, no 15-min limit; a Spot
      interruption → service reschedules + Inngest retry succeeds (idempotent).
- [ ] Overflow default-off: with `ASSEMBLER_ECS_SERVICE_URL` unset / `desiredCount 0`,
      an over-threshold job degrades to the poster tier (no crash), and no ECS task
      or ALB is billing.
- [ ] GovCloud: Lambda deployed; service present but default-off; missing config
      skipped (log line); STEP end-to-end via Lambda in GovCloud.

## Risks

| Risk | Sev | Mitigation |
|---|---|---|
| Sync refactor scope | Low | Lambda-only (ECS keeps async submit→poll); `run_to_completion` already built; compute already inline |
| Lambda 15-min on a huge job | Med | time-budget gate degrades to fit; ECS service overflow with no cap; size pre-route |
| Spot interruption mid-job | Low | 2-min drain + service reschedule + Inngest idempotent retry |
| Standing service cost creep | Low | default `desiredCount 0` / not deployed; opt-in only on a real complaint |
| Cold start on first job after idle | Low | ~1–3 s, background job — acceptable |
| SST can't do container Lambda natively | Low | raw `aws.lambda.Function` (packageType Image) — verified path |
| ECR repos not auto-created | Low | create `carbon/assembler` + `carbon/occt` out-of-band (P0) |

## Implementation phases

**P0 — ECR + OCCT base + LWA in image.** Create `carbon/assembler`+`carbon/occt`
repos; CI builds the OCCT base; add LWA extension + `AWS_LWA_PORT=8000` to the
Dockerfile (default CMD stays the HTTP server). *(`run-job` CLI already built as an
optional batch entrypoint.)* *Verify:* image runs the HTTP server locally.

**P1 — Lambda sync handler + router.** Add the sync HTTP branch (spawn +
`run_to_completion` inline, return) for the Lambda path; add `invokeLambda(spec)` to
`assembler-client.ts` + the size/timeout router in `model-optimize.ts` (Lambda-sync
default; ECS async via the existing `submitAssemblerJob`/`pollAssemblerJobOnce`
pointed at `ASSEMBLER_ECS_SERVICE_URL`). *Verify:* local end-to-end via the sync path;
overflow routes to the async path (stub) or degrades when unset.

**P2 — Lambda (standalone).** `aws.lambda.Function` (packageType Image) + Function
URL + IAM role + env; CI updates the image. Vercel env → `ASSEMBLER_SERVICE_URL`
(Function URL) + key. *Verify:* acceptance rows for Lambda.

**P3 — ECS Spot service (default-off).** `sst.aws.Cluster` + `sst.aws.Service`
(4 vCPU/16 GB, FARGATE_SPOT, ALB, `desiredCount 0` behind a stage flag);
public-subnet VPC (no NAT). Router uses `ASSEMBLER_ECS_SERVICE_URL` when set.
*Verify:* enable → overflow + interruption-reschedule rows; disabled → degrade + $0.

**P4 — GovCloud (shared).** Replicate the P2/P3 stack (Lambda + default-off ECS
service) once in the GovCloud account/region — **no** fan-out, **no** `workspaces`
columns. ERP/MES there get the GovCloud Function URL + key. *Verify:* health + bearer
+ STEP end-to-end in GovCloud.

> **Approval gate:** no prod deploy until Sid confirms AWS account/region, the
> standalone vs shared-GovCloud call, the size-route threshold, and the sync-refactor
> go-ahead. This spec produces the code + IaC; a human triggers prod.

## Changelog

- 2026-07-18 — **async everywhere; the sync path is dead** (Sid, after staging
  fights: org RCP denies anonymous Function URLs, Function URLs can't carry a
  domain, CloudFront/APIGW cap long requests at 30–60s). New Lambda model:
  create → 202 + **Event-type self-invocation** runs the job in its own 900s
  window (`ASSEMBLER_DISPATCH=lambda`; LWA pass-through delivers the event to
  `POST /events`, which reuses the CLI's `spawn_from_spec` + `run_to_completion`);
  job state + hand-off live in the **shared Redis JobStore** (now TLS-capable for
  Upstash), so any instance's poll answers. Artifacts upload **directly from the
  worker** via upload URLs handed over at submit (X-Carbon-Upload-Urls on create;
  long-expiry) — bytes never sit in Redis; per-poll late-mint stays as the
  ECS/dev/retry path. Front door is now **API Gateway HTTP API** (~$0, TLS
  built-in, custom domain later, only `/health` + `/v1/*` routed; every request
  is short so the 30s cap never binds). Self-invoke is a hand-rolled SigV4 POST
  (aws-sdk needs rustc 1.94 > workspace's 1.90); signing key verified against
  AWS's documented example. TS: `runAssemblerJob` is now purely async
  (submit passes upload URLs; sync client + `ASSEMBLER_SYNC_ENABLED` removed).
  The `?sync` HTTP branch remains for dev/CLI convenience but is off the
  production path. **New prod requirement: `ASSEMBLER_REDIS_URL` (serverless
  Redis, e.g. Upstash) on the Lambda.**

- 2026-07-15 — written. Pivoted from the two-always-on-Fargate-services draft to
  **Lambda-default + ECS-Spot-RunTask overflow** (cheaper, no scaling, GovCloud-wide)
  after fact-checking Lambda/LWA/Fargate-Spot/SST against AWS+SST docs. Not yet
  implemented.
- 2026-07-17 — overflow runtime changed from **one-shot `RunTask`** to a **long-running
  ECS Fargate Spot _service_** (Sid). Same image, same default HTTP entrypoint on both
  runtimes; the service handles jobs via the assembler's existing async submit→poll
  (no `run-job` CLI on the hot path — kept only for batch). Net effect: the async→sync
  refactor is now **Lambda-only** (smaller), the service is **config-gated/default-off**
  to preserve $0 idle, and Spot interruptions **self-heal** via the service scheduler.
- 2026-07-17 — **P0 + P1 implemented** (Sid reviewed + approved). P0: LWA in the
  Dockerfile, `run-job` CLI (now batch-only), isolated `assembler.yml` CI. P1:
  assembler `?sync` HTTP branch + wall-clock time-budget gate (`optimize` ladder) +
  the job-layer router `runAssemblerJob` (Lambda-sync default / ECS-async overflow,
  `ASSEMBLER_SYNC_ENABLED` default-off) wired into `model-optimize` + `assembly-convert`
  (`assembly-plan` stays async by design). Verified: `cargo build`/`clippy`,
  `@carbon/{env,jobs}` typecheck, biome. **Next: P2/P3 IaC** — gated on AWS
  account/region + hostnames/certs + the size-route threshold.
