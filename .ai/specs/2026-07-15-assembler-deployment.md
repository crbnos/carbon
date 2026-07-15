# Assembler Service Deployment — Lambda-default + ECS-Spot overflow

> Status: design → ready for implementation (approval gate before any prod deploy)
> Author: Claude (with Sid Rathi)
> Date: 2026-07-15
> Supersedes: `.ai/specs/2026-07-06-geometry-service-deployment.md` (Python-era,
>   two always-on Fargate services). Facts below fact-checked against AWS/SST docs
>   (July 2026).

## TLDR

Run the Rust assembler **serverless by default on AWS Lambda** (container image),
and fall back to **one-shot ECS Fargate Spot tasks** only for jobs too big/long for
Lambda's 15-min ceiling. **One image, two runtimes.** This is the cheapest option
(~$0 idle, ~$10–30/mo typical + cents per rare overflow job), needs **no scaling to
manage** ("don't scale it until someone complains"), and works in **GovCloud** — so
it's a single strategy for both the shared (Vercel-serving) and per-workspace
(ITAR) flavors. It's a new feature; this keeps the cost floor at zero.

The trade: a **modest refactor of the job layer** from async submit→poll to
**synchronous invoke-and-await** (Lambda) + **RunTask** (ECS). The compute
(`run_optimize`/`convert`) already runs inline — we stop spawning + polling.

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
  `stopTimeout ≤ 120 s` for graceful drain. **A `RunTask` one-shot is not
  auto-rescheduled on interruption** — the caller (Inngest) retries.
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

### One image, two runtimes

The single `carbon/assembler:${sha}` image (built once) gains:
1. **LWA extension** in the Dockerfile (`COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.9.1 /lambda-adapter /opt/extensions/lambda-adapter`) + `ENV AWS_LWA_PORT=8000`. Lets the axum app run on Lambda unchanged.
2. A **one-shot CLI entrypoint** (`assembler run-job <spec.json>` reading source/output/options), for ECS RunTask — shares `run_optimize`/`convert` with the HTTP handler. Container CMD stays the HTTP server (Lambda default); RunTask overrides `command`.

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

### Runtime B — ECS Fargate Spot, one-shot RunTask (overflow only)

- **No service, no ALB, no scaling policy** — a bare `aws.ecs.Cluster` + a
  registered `aws.ecs.TaskDefinition` (same image, `command` = `run-job`).
- The router (below) calls `ecs.runTask({ capacityProviderStrategy:
  [{ capacityProvider: "FARGATE_SPOT", weight: 1 }], overrides: { containerOverrides:
  [{ command: […spec] }] }, … })`. The task downloads → optimizes → uploads → updates
  the `modelUpload` row → exits. Pay only for that task's runtime.
- `stopTimeout: 110` + SIGTERM drain. On Spot interruption the task just stops (no
  auto-reschedule) → **Inngest retries** (idempotent, keyed by `modelUploadId` +
  the declared-hash result cache). A retry may go Spot again or on-demand.
- No 15-min ceiling.

### Router (`packages/jobs/.../tasks/model-optimize.ts`)

1. **Pre-route by size** — source > threshold (e.g. > 150 MB, or estimated tris
   over budget) → straight to ECS RunTask.
2. Else → **invoke Lambda**, await the result.
3. **Fallback** — Lambda returns "timed out / too large" (or the invoke times out)
   → re-dispatch to ECS RunTask.
Most jobs never touch ECS.

### Job-layer refactor (the real cost)

- `assembler-client.ts`: replace submit→poll with (a) `invokeLambda(spec)` awaiting
  the sync result, (b) `runEcsTask(spec)` + wait-for-STOPPED/row-update.
- `model-optimize.ts` / `assembly-convert.ts` / `assembly-plan.ts`: call the router
  instead of `submitAssemblerJob` + `pollAssemblerJobOnce`.
- Assembler: add the **sync HTTP handler** (run inline, return) + the **`run-job`
  CLI** entrypoint. The async `/v1/jobs` API becomes optional (kept for local dev /
  a standing-container fallback).
- **Simpler than today**, not more — no external job store needed on the hot path.

### GovCloud vs standalone — same hybrid

Both flavors use Lambda + ECS-Spot-RunTask (Lambda is in GovCloud). Differences:
- **Standalone (Vercel-serving):** one Lambda + one bare ECS cluster in the shared
  account; Function URL public + bearer.
- **GovCloud (per-workspace):** one Lambda + task-def per workspace, deployed by the
  `ci/src/deploy.ts` fan-out (new `workspaces` columns for the Lambda ARN / Function
  URL + `assembler_service_api_key`); or **shared within the compliance boundary**
  since the service holds no tenant data at rest.

## SST specifics

- **Lambda:** raw `new aws.lambda.Function("Assembler", { packageType: "Image",
  imageUri: <ecr>/carbon/assembler:${IMAGE_TAG}, memorySize: 10240, timeout: 900,
  ephemeralStorage: { size: 10240 }, environment: { variables: { ASSEMBLER_*, … } },
  role: <exec-role with ECR + logs + s3/signed-url + redis SG> })` + a
  `aws.lambda.FunctionUrl` (auth `NONE` → bearer-gated in-app, or `AWS_IAM`).
  **Not** `sst.aws.Function` (no prebuilt-image support).
- **ECS overflow:** `sst.aws.Cluster` (or raw `aws.ecs.Cluster`) with **no service**;
  `aws.ecs.TaskDefinition` (Fargate, 4 vCPU/16 GB for the big-job tier); the RunTask
  call lives in the job code (AWS SDK). A small VPC (public subnet + SG, **no NAT**)
  or reuse the GovCloud VPC.
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
  --image-uri …:${sha}`) + register a new task-def revision; GovCloud goes through
  the `ci/src/deploy.ts` fan-out with `IMAGE_TAG`.

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
| ECS Spot overflow (rare big jobs) | **cents/job**, $0 standing |
| Two always-on Fargate services (the rejected plan) | ~$400–500 |

Per Lambda job ≈ 10 GB × ~10 s × $0.0000167/GB-s ≈ **$0.0017** + request. Scale-to-zero
by construction; no ALB/VPC/NAT on the Lambda path.

## Rollback

- **Lambda:** publish versions/alias; roll the alias back to the prior version, or
  `update-function-code` to the previous `:sha`. Instant.
- **ECS:** deregister the bad task-def revision; RunTask points at the prior one.
- Consumers degrade gracefully — a down assembler leaves models on the poster tier;
  no data loss (raw + prior artifacts untouched).

## Acceptance criteria

- [ ] `carbon/occt` + `carbon/assembler:${sha}` in ECR; LWA extension present; Trivy
      clean.
- [ ] Lambda: STEP fixture via Function URL → optimize completes (artifact in
      storage, row updated); no bearer → 401; a job that would exceed 12 min
      degrades via the time gate and still returns ≤ 15 min.
- [ ] Overflow: a > threshold source routes to ECS RunTask (Spot), completes, no
      15-min limit; a Spot interruption → Inngest retry succeeds (idempotent).
- [ ] GovCloud: Lambda + task-def deployed per configured workspace; missing config
      skipped (log line); STEP end-to-end in a deployed workspace.
- [ ] No standing ECS service / ALB exists (verified in the console + SST diff).

## Risks

| Risk | Sev | Mitigation |
|---|---|---|
| Sync refactor scope | Med | compute already inline; async API kept for dev; incremental (Lambda first, ECS later) |
| Lambda 15-min on a huge job | Med | time-budget gate degrades to fit; ECS overflow with no cap; size pre-route |
| Spot interruption mid-job | Low | 2-min drain + Inngest idempotent retry; no reschedule expected |
| Cold start on first job after idle | Low | ~1–3 s, background job — acceptable |
| SST can't do container Lambda natively | Low | raw `aws.lambda.Function` (packageType Image) — verified path |
| ECR repos not auto-created | Low | create `carbon/assembler` + `carbon/occt` out-of-band (P0) |

## Implementation phases

**P0 — ECR + OCCT base + LWA in image.** Create `carbon/assembler`+`carbon/occt`
repos; CI builds the OCCT base; add LWA extension + `AWS_LWA_PORT=8000` + the
`run-job` CLI entrypoint to the Dockerfile/binary. *Verify:* image runs the HTTP
server locally AND `run-job` one-shot works.

**P1 — Sync execution + router.** Add the sync HTTP handler (inline run) + `run-job`
CLI; refactor `assembler-client.ts`/`model-optimize.ts` to invoke-and-await + the
size/timeout router (Lambda only first; ECS stubbed). *Verify:* local end-to-end via
the sync path.

**P2 — Lambda (standalone).** `aws.lambda.Function` (packageType Image) + Function
URL + IAM role + env; CI updates the image. Vercel env → `ASSEMBLER_SERVICE_URL`
(Function URL) + key. *Verify:* acceptance rows for Lambda.

**P3 — ECS Spot overflow.** Bare cluster + task-def (4 vCPU/16 GB) + `runTask`
(FARGATE_SPOT) in the router; public-subnet VPC (no NAT). *Verify:* overflow +
interruption-retry rows.

**P4 — GovCloud.** Per-workspace Lambda/task-def via `ci/src/deploy.ts` fan-out + new
`workspaces` columns; or one shared within the boundary. *Verify:* fan-out + skip
convention + STEP end-to-end.

> **Approval gate:** no prod deploy until Sid confirms AWS account/region, the
> standalone vs shared-GovCloud call, the size-route threshold, and the sync-refactor
> go-ahead. This spec produces the code + IaC; a human triggers prod.

## Changelog

- 2026-07-15 — written. Pivoted from the two-always-on-Fargate-services draft to
  **Lambda-default + ECS-Spot-RunTask overflow** (cheaper, no scaling, GovCloud-wide)
  after fact-checking Lambda/LWA/Fargate-Spot/SST against AWS+SST docs. Not yet
  implemented.
