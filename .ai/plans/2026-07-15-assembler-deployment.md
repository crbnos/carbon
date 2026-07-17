# Plan — Assembler Deployment (Lambda-default + ECS-Spot overflow)

Spec: `.ai/specs/2026-07-15-assembler-deployment.md`
Runbook: `.ai/runs/2026-07-15-assembler-deployment.md` (create on execute)

**Model (locked):** one image, two runtimes. **Lambda** (container image + LWA,
synchronous) is the default; **ECS Fargate Spot one-shot `RunTask`** is the overflow
for jobs past Lambda's 15-min cap. **One shared deployment per environment** —
commercial (Vercel) + GovCloud/ITAR — **NOT per-workspace** (Sid, 2026-07-15).

**Gates:**
- P1 (async→sync refactor) — needs Sid's go-ahead (architectural).
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
- [ ] **T0.4 Add a `run-job` CLI entrypoint** — `apps/assembler/src/main.rs`: if
      `argv[1] == "run-job"`, read a job spec (JSON via arg/env: `{action, source_url,
      format, outputs, options}`), call the shared `run_optimize`/`run_convert`,
      upload to the signed URL(s), print result JSON, exit — **no HTTP server**.
      Shares compute with the HTTP handlers (extract a `run_action(spec) -> Result`
      used by both). *Verify:* `assembler run-job '<spec>'` against a local STEP +
      pre-signed URLs → artifact lands, exit 0.
- [x] **T0.5 CI: build + push `carbon/assembler:${sha}`** — `docker/build-push-action`
      (`context: .`, `file: apps/assembler/Dockerfile`, `--build-arg
      OCCT_IMAGE=<ecr>/carbon/occt:8.0.0-p1`), **Trivy scan**, tags `:${sha}` + `:latest`.
      Add `apps/assembler/**`,`crates/**` to `paths`. File: `.github/workflows/deploy.yml`.
      *Verify:* push to a branch → tag in ECR, Trivy clean.

## P1 — Synchronous execution + router  ⛳ needs go-ahead

- [ ] **T1.1 Sync HTTP handler** — a request that runs the job **inline** and returns
      the result (no 202/spawn). Reuse `run_action`. Keep the async `/v1/jobs` path
      behind a flag for local dev / standing-container fallback.
      Files: `apps/assembler/src/main.rs`, `.../actions/*`.
      *Verify:* `POST /v1/optimize` (sync) returns the completed result in one response.
- [ ] **T1.2 Time-budget gate** — thread a wall-clock budget (~12 min) into the
      simplify ladder; degrade coarser as it runs down; return best-so-far before
      15 min. File: `apps/assembler/src/actions/optimize.rs` (+ convert).
      *Verify:* a synthetic slow job returns before the budget, coarser.
- [ ] **T1.3 Job-layer router** — `packages/jobs/.../tasks/assembler-client.ts`:
      replace `submitAssemblerJob`/`pollAssemblerJobOnce` with `invokeLambda(spec)`
      (await) + `runEcsTask(spec)` (RunTask + wait-for-STOPPED/row-update). Router:
      source>threshold → ECS; else Lambda; Lambda timeout → ECS. Update callers
      `model-optimize.ts`, `assembly-convert.ts`, `assembly-plan.ts`.
      *Verify:* `pnpm --filter @carbon/jobs typecheck` clean; local end-to-end via the
      sync path (Lambda stub) succeeds; a forced-timeout routes to the ECS stub.

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

## P3 — ECS Spot overflow  ⛳ needs size-route threshold

- [ ] **T3.1 Bare ECS cluster + task-def** — `aws.ecs.Cluster` (no service) +
      `aws.ecs.TaskDefinition` (Fargate, 4 vCPU/16 GB, `command`=`run-job`,
      `stopTimeout: 110`, same image). Public-subnet VPC (`nat: false`) + SG.
      File: `apps/assembler/sst.config.ts`.
- [ ] **T3.2 `runTask` in the router** — `runEcsTask` calls `ecs.runTask({
      capacityProviderStrategy: [{ capacityProvider: "FARGATE_SPOT", weight: 1 }],
      overrides: { containerOverrides: [{ command: [...spec] }] }, networkConfiguration
      … })`; wait for STOPPED + row update; Spot-interrupt → Inngest retry.
      *Verify (P3):* a > threshold source routes to ECS, completes (no 15-min cap);
      an induced Spot stop → retry succeeds (idempotent by `modelUploadId`).

## P4 — GovCloud (shared, not per-workspace)  ⛳ needs ITAR account

- [ ] **T4.1** Replicate the P2/P3 stack once in the GovCloud account/region (Lambda +
      ECS-Spot cluster). No fan-out, no `workspaces` columns.
- [ ] **T4.2** GovCloud ERP/MES get the GovCloud Function URL + key (single value).
      *Verify (P4):* health + bearer + STEP end-to-end in GovCloud;
      `assembler.itar.carbon.ms` resolves.

---

## Sequencing

P0 → P1 (⛳) → P2 → P3, then P4. P0 is safe to start now. P1 is the crux (go-ahead).
P2–P4 are IaC + prod, human-triggered at the approval gate.

## Rollback (each deploy phase)

Lambda: roll the alias/version back or `update-function-code` to prior `:sha`.
ECS: deregister the bad task-def revision; RunTask targets the prior one.
Consumers degrade to the poster tier — no data loss.

## Open decisions for the approval gate

- AWS account IDs + regions (commercial + GovCloud) and the two hostnames + ACM certs.
- Size-route threshold (Lambda→ECS), e.g. ≥ 150 MB source or an estimated-tri budget.
- Lambda Function URL auth: in-app bearer (auth NONE) vs `AWS_IAM`.
- ECS overflow memory/vCPU (default 4 vCPU/16 GB).
