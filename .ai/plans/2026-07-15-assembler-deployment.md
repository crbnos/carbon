# Plan — Assembler Deployment (Lambda-default + ECS-Spot service overflow)

Spec: `.ai/specs/2026-07-15-assembler-deployment.md`
Runbook: `.ai/runs/2026-07-15-assembler-deployment.md` (create on execute)

**Model (locked):** one image, two runtimes, **same default HTTP entrypoint**.
**Lambda** (container image + LWA, **synchronous**) is the default; a **long-running
ECS Fargate Spot _service_** (default-off, `desiredCount 0`, async submit→poll) is the
overflow for jobs past Lambda's 15-min cap. **One shared deployment per environment**
— commercial (Vercel) + GovCloud/ITAR — **NOT per-workspace** (Sid, 2026-07-15).
Overflow model changed RunTask → service (Sid, 2026-07-17).

**Gates:**
- P1 (Lambda **sync handler** + router) — needs Sid's go-ahead (touches the job hot
  path; the ECS side keeps the existing async client).
- P2+ (prod deploy) — needs AWS account/region + hostnames/certs; run by a human
  (no creds in-session, no prod deploy without approval).

Legend: `[ ]` todo · verify = command + expected.

---

## P0 — Image is Lambda- and ECS-runnable (decision-free code)

- [ ] **T0.1 Create ECR repos out-of-band** — `carbon/assembler` + `carbon/occt` in
      the target account/region (console/Terraform; nothing in-repo creates them).
      *Verify:* `aws ecr describe-repositories --repository-names carbon/assembler carbon/occt`.
- [x] **T0.2 CI: build + push the OCCT base** — new job (path-filter
      `apps/assembler/occt.Dockerfile` or `workflow_dispatch`) builds it →
      `carbon/occt:8.0.0-p1` → ECR. File: `.github/workflows/deploy.yml`.
      *Verify:* image tag present in ECR.
- [x] **T0.3 Dockerfile: add the Lambda Web Adapter** — in the runtime stage of
      `apps/assembler/Dockerfile`:
      `COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.9.1 /lambda-adapter /opt/extensions/lambda-adapter`
      and `ENV AWS_LWA_PORT=8000` (LWA defaults 8080; assembler binds 8000).
      *Verify:* `docker build -f apps/assembler/Dockerfile --build-arg OCCT_IMAGE=carbon-occt:8.0.0-p1 -t asm .` builds; `docker run -p 8000:8000 asm` → `curl localhost:8000/health` = `{"ok":true,...}`.
- [x] **T0.4 Add a `run-job` CLI entrypoint** — `apps/assembler/src/main.rs`: if
      `argv[1] == "run-job"`, read a job spec, spawn the action, `run_to_completion`,
      print terminal JSON, exit. **Note (2026-07-17):** now that overflow is a standing
      service, this CLI is **not** on either production path — retained only as an
      optional batch/manual entrypoint. `run_to_completion` is reused by the P1 Lambda
      sync handler. *Verify:* `assembler run-job '<spec>'` → artifact lands, exit 0.
- [x] **T0.5 CI: build + push `carbon/assembler:${sha}`** — `docker/build-push-action`
      (`context: .`, `file: apps/assembler/Dockerfile`, `--build-arg
      OCCT_IMAGE=<ecr>/carbon/occt:8.0.0-p1`), **Trivy scan**, tags `:${sha}` + `:latest`.
      Add `apps/assembler/**`,`crates/**` to `paths`. File: `.github/workflows/deploy.yml`.
      *Verify:* push to a branch → tag in ECR, Trivy clean.

## P1 — Lambda sync handler + router  ⛳ needs go-ahead

- [ ] **T1.1 Sync HTTP branch** — a `?sync` (or `wait`) flag on the create routes that,
      after `spawn`, calls `run_to_completion` inline with the request's
      `X-Carbon-Upload-Urls` and returns the **terminal** result in one response (no
      202). The async `/v1/jobs` path is **unchanged** — it stays the ECS service's
      primary contract + local dev. Files: `apps/assembler/src/main.rs`,
      `.../actions/*`. *Verify:* `POST /v1/optimize?sync` returns the completed result
      in one response; plain `POST` still 202s.
- [ ] **T1.2 Time-budget gate** — thread a wall-clock budget (~12 min) into the
      simplify ladder; degrade coarser as it runs down; return best-so-far before
      15 min. File: `apps/assembler/src/actions/optimize.rs` (+ convert).
      *Verify:* a synthetic slow job returns before the budget, coarser.
- [ ] **T1.3 Job-layer router** — `packages/jobs/.../tasks/assembler-client.ts`:
      add `invokeLambda(spec)` (await the sync result). **Keep**
      `submitAssemblerJob`/`pollAssemblerJobOnce` — the ECS service is a normal async
      assembler endpoint at `ASSEMBLER_ECS_SERVICE_URL`. Router: source>threshold →
      ECS service (if URL set, else degrade); else Lambda; Lambda timeout → ECS
      service. Update callers `model-optimize.ts`, `assembly-convert.ts`,
      `assembly-plan.ts`. *Verify:* `pnpm --filter @carbon/jobs typecheck` clean;
      local end-to-end via the sync path succeeds; a forced-timeout routes to the async
      path (or degrades when the URL is unset).

## P2 — Lambda (commercial / standalone)  ⛳ needs AWS account/region + hostname

- [ ] **T2.1 SST/IaC: `aws.lambda.Function`** (packageType Image) — `imageUri` =
      `carbon/assembler:${IMAGE_TAG}`, `memorySize: 10240`, `timeout: 900`,
      `ephemeralStorage: { size: 10240 }`, exec role (ECR pull, logs, signed-URL
      egress), env (`ASSEMBLER_SERVICE_API_KEY`, `ASSEMBLER_REDIS_URL`,
      `ASSEMBLER_ALLOWED_URL_HOSTS`, `ASSEMBLER_DEV_MODE` unset). **Not**
      `sst.aws.Function`. File: `apps/assembler/sst.config.ts` (new standalone app).
- [ ] **T2.2 `aws.lambda.FunctionUrl`** (auth NONE + in-app bearer, or AWS_IAM) at
      `assembler.carbon.ms` (cert/DNS out-of-band, `dns:false`).
- [ ] **T2.3 CI deploy step** — on `apps/assembler/**`/`crates/**` push, `sst deploy
      --stage prod` from `apps/assembler/` (pinned `sst@3.17.24`), then
      `lambda update-function-code --image-uri …:${sha}`.
- [ ] **T2.4 Consumer env** — commercial ERP/MES + Vercel get
      `ASSEMBLER_SERVICE_URL` (Function URL) + `ASSEMBLER_SERVICE_API_KEY`.
      *Verify (P2):* `curl https://assembler.carbon.ms/health` 200; no bearer → 401;
      a STEP fixture optimizes end-to-end (artifact + row).

## P3 — ECS Spot service (default-off)  ⛳ needs size-route threshold

- [ ] **T3.1 Cluster + long-running service** — `sst.aws.Cluster` +
      `sst.aws.Service` (Fargate, 4 vCPU/16 GB, FARGATE_SPOT capacity provider,
      `stopTimeout: 110`, same image's **default HTTP CMD**, ALB on `/health`,
      **`desiredCount 0` behind a stage flag**). Public-subnet VPC (`nat: false`) + SG.
      File: `apps/assembler/sst.config.ts`.
- [ ] **T3.2 Point the router at the service** — set `ASSEMBLER_ECS_SERVICE_URL` to the
      ALB URL; the router's overflow branch uses the **existing async
      submit→poll** client against it (no RunTask code). Enable by bumping
      `desiredCount` → 1. *Verify (P3):* enabled → a > threshold source routes to the
      service, completes (no 15-min cap); an induced Spot stop → service reschedules +
      Inngest retry succeeds (idempotent by `modelUploadId`). Disabled → job degrades,
      $0 billing.

## P4 — GovCloud (shared, not per-workspace)  ⛳ needs ITAR account

- [ ] **T4.1** Replicate the P2/P3 stack once in the GovCloud account/region (Lambda +
      default-off ECS-Spot service). No fan-out, no `workspaces` columns.
- [ ] **T4.2** GovCloud ERP/MES get the GovCloud Function URL + key (single value).
      *Verify (P4):* health + bearer + STEP end-to-end in GovCloud;
      `assembler.itar.carbon.ms` resolves.

---

## Sequencing

P0 → P1 (⛳) → P2 → P3, then P4. P0 is safe to start now. P1 is the crux (go-ahead).
P2–P4 are IaC + prod, human-triggered at the approval gate.

## Rollback (each deploy phase)

Lambda: roll the alias/version back or `update-function-code` to prior `:sha`.
ECS service: roll to the prior task-def revision, or `desiredCount 0` to disable.
Consumers degrade to the poster tier — no data loss.

## Open decisions for the approval gate

- AWS account IDs + regions (commercial + GovCloud) and the hostnames + ACM certs
  (Lambda Function URL + the service ALB).
- Size-route threshold (Lambda→ECS service), e.g. ≥ 150 MB source or an estimated-tri
  budget.
- Lambda Function URL auth: in-app bearer (auth NONE) vs `AWS_IAM`.
- ECS service task size (default 4 vCPU/16 GB) + `scaling` min/max; service ALB
  internal vs public+bearer.
- When to first enable the service (default-off until a real overflow complaint).
