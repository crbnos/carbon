# Assembler Service Deployment — SST (adapts the geometry-service plan for Rust)

> Status: design → ready for implementation (approval gate before any prod deploy)
> Author: Claude (with Sid Rathi)
> Date: 2026-07-15
> Supersedes: `.ai/specs/2026-07-06-geometry-service-deployment.md` (Python-era; the
>   service was rewritten Python → Rust, `services/geometry` → `apps/assembler`)

## TLDR

Deploy the Rust **assembler** (`apps/assembler`) to production with the **same
two-SST-app shape** Brad designed: (A) a third Fargate service
`CarbonAssemblerService` on the existing `CarbonCluster` in the root
`sst.config.ts` (GovCloud/ITAR, per-workspace fan-out, ALB + per-workspace
domain/cert), and (B) a standalone `carbon-assembler` SST app at
`apps/assembler/sst.config.ts` serving the Vercel-hosted build at
`assembler.carbon.ms`. Both run one ECR image `carbon/assembler:${sha}` built from
`apps/assembler/Dockerfile`, which links a **prebuilt `carbon-occt` base image**
(static OCCT) — that base must be built once and cached in ECR.

**Most of Brad's scope is already done by the Rust rewrite:** the `/plan`
in-memory→Redis externalization he pulled into scope is built in
(`ASSEMBLER_REDIS_URL`, Memory|Redis `JobStore`); the container/Dockerfile is
production-ready (static OCCT + Draco, non-root, `EXPOSE 8000`, `/health`); and
`ASSEMBLER_SERVICE_URL/_API_KEY` already exist in `@carbon/env` and are consumed by
the Inngest tasks. What remains is the **SST/CI wiring + the OCCT base image + prod
env (SSRF allowlist, bind) + memory sizing**.

## Already done (Rust rewrite) — do NOT re-scope from Brad's plan

- **Job store** — `ASSEMBLER_REDIS_URL` (`config.rs`): set → Redis store, unset →
  in-memory. Autoscale-safe. (Brad's OQ-3 externalization = done.)
- **Dockerfile** — `apps/assembler/Dockerfile`: multi-stage `carbon-occt` (static
  OCCT) → fcl → draco (static) → `rust:1.90` build → `debian:bookworm-slim` runtime;
  `USER assembler`, `EXPOSE 8000`, `HEALTHCHECK … /health`, `CMD ["assembler"]`.
  Static OCCT + Draco linked in → slim runtime, no CAD `.so` deps.
- **Consumer env** — `ASSEMBLER_SERVICE_URL` / `ASSEMBLER_SERVICE_API_KEY` in
  `@carbon/env` (`index.ts:198,201`), consumed by `assembly-convert.ts`,
  `assembly-plan.ts`, `model-optimize.ts` via `assembler-client.ts`.

## What's left (this spec)

1. **`carbon-occt` base image** built + pushed to ECR once, referenced via
   `OCCT_IMAGE` build-arg (expensive ~15–30 min OCCT compile → build + cache).
2. **`carbon/assembler:${sha}`** built in CI from `apps/assembler/Dockerfile`
   (NOT the root Dockerfile / `APP` build-arg — that's node-app only).
3. **Flavor A** — `CarbonAssemblerService` in root `sst.config.ts`, cloning the
   ERP/MES service shape (port 8000).
4. **Flavor B** — standalone `apps/assembler/sst.config.ts` at `assembler.carbon.ms`.
5. **`workspaces` columns** — `url_assembler`, `cert_arn_assembler`,
   `assembler_service_api_key` (rename of Brad's geometry columns).
6. **Prod env** — `ASSEMBLER_BIND=0.0.0.0:8000`, `ASSEMBLER_DEV_MODE` unset,
   **`ASSEMBLER_ALLOWED_URL_HOSTS`** (SSRF allowlist — the storage host).
7. **Memory sizing** — bump beyond Brad's 4 GB (see Sizing — optimize is heavier
   than Python convert was).
8. **Consumer wiring** — ERP/MES `environment` gets `ASSEMBLER_SERVICE_URL/_API_KEY`;
   Vercel env gets the standalone URL/key.
9. **CI hardening** — Trivy image scan (devops standard), pin SST to `3.17.24`.

## Design

### OCCT base image (the new CI concern)

`apps/assembler/Dockerfile` opens with `ARG OCCT_IMAGE=carbon-occt:8.0.0-p1` and
`FROM ${OCCT_IMAGE} AS occt`. In CI:
- Build `apps/assembler/occt.Dockerfile` → tag `carbon/occt:8.0.0-p1`, push to ECR.
- **Build only when the base changes** (path filter on `occt.Dockerfile` or a manual
  `workflow_dispatch`), not every assembler build — it's a 15–30 min compile.
- The assembler build passes `--build-arg OCCT_IMAGE=${ECR}/carbon/occt:8.0.0-p1`.
- GHA buildx cache + ECR layer cache keep incremental assembler builds fast.

### Flavor A — `CarbonAssemblerService` (root `sst.config.ts`, GovCloud)

Clone the `CarbonERPService` block (SST rule §"What SST deploys"), changing:
- `image`: `${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/carbon/assembler:${IMAGE_TAG}`
- `port: 8000`; `loadBalancer.health`: `{ "8000/http": { path: "/health" } }`;
  ports `80/http`+`443/https` → `8000/http`; `transform.target` health override at
  `/health` (same pattern ERP/MES use).
- `domain`: `process.env.URL_ASSEMBLER ?? "assembler.itar.carbon.ms"`, `dns: false`,
  `cert: process.env.CERT_ARN_ASSEMBLER`.
- `environment`:
  ```
  ASSEMBLER_BIND: "0.0.0.0:8000"
  ASSEMBLER_SERVICE_API_KEY: process.env.ASSEMBLER_SERVICE_API_KEY
  ASSEMBLER_REDIS_URL: process.env.REDIS_URL           // per-workspace Redis, asm:-namespaced
  ASSEMBLER_ALLOWED_URL_HOSTS: process.env.ASSEMBLER_ALLOWED_URL_HOSTS  // storage host(s)
  // ASSEMBLER_DEV_MODE intentionally UNSET → TLS verify on + SSRF default-deny
  ```
- `scaling: { min: 1, max: 4, cpuUtilization: 70, memoryUtilization: 80 }` (Brad's
  cap; job state is external so scaling is safe).
- **ERP/MES services** gain `ASSEMBLER_SERVICE_URL=https://${URL_ASSEMBLER}` +
  `ASSEMBLER_SERVICE_API_KEY` in their `environment`.
- WAF (`AppAlbWebAcl`) association stays manual (existing gotcha). Bearer key gates
  every non-`/health` route.
- **Public vs internal ALB (decision):** the assembler is a *private backend* —
  only ERP/MES (same VPC) and the Inngest jobs call it, never a browser. Brad chose
  a **public** ALB for GovCloud "to avoid the Cloud Map / Service Connect unknown."
  An **internal** ALB (VPC-only) is the more secure default and removes the
  public-cert/DNS need there. Recommend **internal for Flavor A** (ERP/MES reach it
  in-VPC via `ASSEMBLER_SERVICE_URL`); Flavor B stays public (Vercel calls over the
  internet). If internal, `url_assembler`/`cert_arn_assembler` become the internal
  DNS name and are optional. ← confirm with Sid at the approval gate.

### Flavor B — standalone `apps/assembler/sst.config.ts` (`carbon-assembler`)

New app, own VPC + cluster + one public Fargate service at `assembler.carbon.ms`
(mirror Brad's Flavor B, geometry→assembler). Rationale unchanged: **SST/Pulumi
state is per app+stage** — a conditional inside the `carbon` app would delete
ERP/MES from that stage's state. Separate app = isolated state + cadence. Deploy
runs from `apps/assembler/` (SST resolves `sst.config.ts` from cwd). `REDIS_URL`
provisioned outside SST, passed as a secret. Stateless w.r.t. tenant data (files via
signed URLs; Redis job records transient, opaque-ID-keyed) → one shared deployment,
one shared `ASSEMBLER_SERVICE_API_KEY` for v1.

### Sizing — bump memory over Brad's 4 GB ⚠️

Brad sized 2 vCPU / **4 GB** for the Python *convert*. The Rust service now also
runs **optimize**, which is memory-heavier: a 27.5 M-tri model peaked **~3.7 GB**
after the mmap/streaming work (down from 7.5 GB) — 4 GB is a **tight OOM risk** under
any concurrency. Options (pick per cost/appetite):
- **8 GB / 2 vCPU** (recommended baseline) + `ASSEMBLER_MAX_CONCURRENCY=2`, or
- 4 GB + `ASSEMBLER_MAX_CONCURRENCY=1` + a tighter `ASSEMBLER_MAX_SOURCE_MB` gate.

Tune from CloudWatch memory metrics after first deploy. (This is the one place
Brad's numbers don't carry over.)

### CI wiring (`.github/workflows/deploy.yml` + a new workflow)

- **Assembler image build** — a matrix/step distinct from the erp/mes entries
  (different context + Dockerfile): `context: ./`, `file: apps/assembler/Dockerfile`,
  `--build-arg OCCT_IMAGE=${ECR}/carbon/occt:8.0.0-p1`, `platforms: linux/amd64`,
  push `carbon/assembler:${github.sha}` (+ `:latest`). Add `apps/assembler/**`,
  `crates/**` to `paths`. Guarantees the tag exists for every sha the root app's
  `${IMAGE_TAG}` references.
- **OCCT base** — separate job, path-filtered on `apps/assembler/occt.Dockerfile`
  (or `workflow_dispatch`), builds + pushes `carbon/occt:8.0.0-p1`.
- **Trivy scan** on `carbon/assembler:${sha}` before push (devops standard).
- **Standalone deploy** — new workflow path-filtered on `apps/assembler/**` +
  `crates/**`; runs `npx --yes sst@3.17.24 deploy --stage prod` from `apps/assembler/`
  with `AWS_*`, `IMAGE_TAG=${sha}`, `URL_ASSEMBLER`, `CERT_ARN_ASSEMBLER`,
  `ASSEMBLER_SERVICE_API_KEY`, `REDIS_URL`, `ASSEMBLER_ALLOWED_URL_HOSTS`. ERP/MES
  pushes never churn the assembler stack, and vice versa.
- **GovCloud flavor** picks the image up through the existing `ci/src/deploy.ts`
  fan-out with the same `IMAGE_TAG`.

### `workspaces` columns (CI control table, not an app table)

Add nullable, following the flat-secret convention (`ci/src/deploy.ts` `Workspace`
type + skip-and-log when missing):
- `url_assembler` — per-workspace hostname (e.g. `assembler.itar.carbon.ms`).
- `cert_arn_assembler` — ACM cert ARN.
- `assembler_service_api_key` — per-workspace bearer secret.
- (`ASSEMBLER_ALLOWED_URL_HOSTS` derives from the workspace's storage host — reuse
  the existing per-workspace storage/domain value; no new column if derivable.)

### Consumer wiring (no consumer-code change)

| Build | `ASSEMBLER_SERVICE_URL` | `ASSEMBLER_SERVICE_API_KEY` |
|---|---|---|
| GovCloud (`carbon` app) | `https://${URL_ASSEMBLER}` (per-workspace) | per-workspace secret (new column) |
| Vercel-hosted | `https://assembler.carbon.ms` | one shared secret in Vercel env (v1) |

## Security (devops constraints)

- **Secrets** — API key + `REDIS_URL` come from the `workspaces` service-role table
  (GovCloud) / GitHub+Vercel secrets (standalone), never in code. (Not a dedicated
  secret manager, but matches every other Carbon secret; acceptable for v1.)
- **SSRF** — `ASSEMBLER_ALLOWED_URL_HOSTS` MUST be set in prod; with `DEV_MODE` unset
  the service default-denies non-allowlisted hosts (`config.rs` `_validate_url`).
- **Auth** — bearer key on every non-`/health` route; `POST /v1/*` without it → 401.
- **Non-root** container (`USER assembler`), resource limits set, image Trivy-scanned,
  SHA-pinned image (no `:latest` in the running task).

## Rollback

```bash
# ECS (both flavors): roll the service back to the previous task-def revision
aws ecs update-service --cluster CarbonCluster --service CarbonAssemblerService \
  --task-definition <prev-revision> --force-new-deployment
aws ecs wait services-stable --cluster CarbonCluster --services CarbonAssemblerService
curl -fsS https://${URL_ASSEMBLER}/health   # expect {"ok":true,...}
# Or redeploy the prior good sha: re-run the deploy workflow with IMAGE_TAG=<prev-sha>.
```
The consumers degrade gracefully — a down assembler leaves models on the poster/WASM
tier; no data loss (raw + prior artifacts untouched).

## Acceptance criteria

- [ ] `carbon/occt:8.0.0-p1` + `carbon/assembler:${sha}` exist in ECR after a
      `apps/assembler/**` push to `main`.
- [ ] GovCloud: each fully-configured `aws===true` workspace runs
      `CarbonAssemblerService` behind its ALB; `https://${url_assembler}/health` →
      `{"ok":true,...}`; `POST /v1/optimize` without a bearer key → 401.
- [ ] GovCloud: a workspace missing any new column is skipped (log line); its
      ERP/MES deploy is unaffected.
- [ ] End-to-end: uploading a STEP in a deployed workspace completes convert +
      optimize (glb/graph/optimized land in storage; viewer renders).
- [ ] Standalone: `https://assembler.carbon.ms/health` → 200 public; bearer-gated;
      a STEP fixture processes end-to-end.
- [ ] Isolation: an ERP/MES-only push doesn't trigger the assembler deploy, and an
      `apps/assembler/**` push doesn't redeploy ERP/MES.
- [ ] `sst deploy` of the standalone app doesn't mutate any `carbon`-app resource
      (verified via deploy diff).
- [ ] Memory: no OOM under `MAX_CONCURRENCY` load on a large (>20 M-tri) STEP.

## Risks

| Risk | Sev | Mitigation |
|---|---|---|
| 4 GB OOM on big optimize | **High** | 8 GB baseline or 4 GB + concurrency 1 + source gate; watch CloudWatch |
| OCCT base build slow / missing tag | Med | separate cached job; assembler build fails fast if `OCCT_IMAGE` absent |
| SSRF if `ALLOWED_URL_HOSTS` unset in prod | Med | acceptance gate + default-deny already enforced when `DEV_MODE≠true` |
| Root-app deploy references an unbuilt assembler tag | Med | assembler joins the same sha build; every deployed sha has an image |
| Two `sst.config.ts` → wrong cwd | Low | deploys only via CI with fixed cwd; document in `apps/assembler/README.md` |
| SST version drift | Low | pin standalone to `sst@3.17.24` (CI's version) |

## Implementation phases (the plan)

**P0 — ECR repos + OCCT base.** Nothing in this repo auto-creates ECR repos (SST
+ CI reference them by string only, like `carbon/erp`). **Create `carbon/assembler`
and `carbon/occt` out-of-band** (console/Terraform), same as the erp/mes repos. Then
a CI job builds `apps/assembler/occt.Dockerfile` → `carbon/occt:8.0.0-p1` → ECR;
path-filtered/manual. *Verify:* both repos exist + occt image pushed.

**P1 — Assembler image build.** deploy.yml: assembler build step (own
Dockerfile/context + `OCCT_IMAGE` arg + Trivy) → `carbon/assembler:${sha}`; add
`apps/assembler/**`,`crates/**` to `paths`. *Verify:* tag in ECR after a push.

**P2 — Flavor A (GovCloud).** Root `sst.config.ts`: `CarbonAssemblerService` (port
8000, env, scaling, memory per Sizing); ERP/MES get `ASSEMBLER_SERVICE_URL/_API_KEY`.
`ci/src/deploy.ts`: 3 `Workspace` fields + skip-and-log + per-workspace env.
`workspaces` columns. *Verify:* health 200 + 401-without-key on a test workspace;
STEP end-to-end.

**P3 — Flavor B (standalone).** `apps/assembler/sst.config.ts` + a path-filtered
deploy workflow; provision `assembler.carbon.ms` cert/DNS + secrets. Set Vercel
`ASSEMBLER_SERVICE_URL/_API_KEY`. *Verify:* public health + bearer-gated + STEP
fixture; deploy-diff shows no `carbon`-app mutation.

**P4 — Harden + tune.** Memory/concurrency from metrics; WAF association; runbook in
`apps/assembler/README.md`; rollback rehearsal.

> **Approval gate:** no `sst deploy --stage prod` runs until Sid approves AWS
> account/region, the two hostnames + ACM certs, memory sizing, and the shared vs
> per-workspace key split. This spec produces the IaC/CI; a human triggers prod.

## Changelog

- 2026-07-15 — written; adapts the 2026-07-06 geometry plan to the Rust assembler.
  Redis job store + Dockerfile marked done; added OCCT-base CI, SSRF/bind prod env,
  memory-sizing bump. Not yet implemented.
