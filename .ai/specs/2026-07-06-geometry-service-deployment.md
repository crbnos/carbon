# Geometry Service Deployment — Two SST Apps

> Status: draft (design resolved, ready for /plan)
> Author: Brad Barbin (design conversation with Claude)
> Date: 2026-07-06

## TLDR

Deploy the Python geometry service (`services/geometry`) to production for both
Carbon hosting flavors using **two separate SST apps**: (1) the existing
`carbon` SST app (GovCloud/ITAR, per-workspace fan-out) gains a third Fargate
service on the existing `CarbonCluster`, exposed like ERP/MES behind its own
ALB + domain (subdomain of the workspace's `itar.carbon.ms`-style domain);
(2) a new standalone **`carbon-geometry`** SST app at
`services/geometry/sst.config.ts` deploys *only* the geometry service — its own
VPC, cluster, and one public Fargate service at `geometry.carbon.ms` — as a
shared multi-tenant backend for the Vercel-hosted build. Both flavors run the
same ECR image `carbon/geometry:${sha}` built from the existing
`services/geometry/Dockerfile`. This spec also **bundles externalizing the
`/plan` in-memory job store to Redis**, so both flavors can autoscale beyond a
single replica. Vercel Python functions were evaluated and ruled out.

## Problem Statement

The geometry service converts STEP files to GLB + `graph.json` and produces
assembly plans. It is consumed server-side by the Inngest tasks
`packages/jobs/src/inngest/functions/tasks/assembly-convert.ts` and
`assembly-plan.ts` via `GEOMETRY_SERVICE_URL` / `GEOMETRY_SERVICE_API_KEY`
(`packages/env/src/index.ts:195-198`). It has a production-ready multi-stage
Dockerfile but **no production deployment path** — it only runs locally today.

Carbon has two production builds:

1. **Vercel-hosted** — the Node apps run serverless on Vercel. There is no AWS
   stack to embed the geometry container into.
2. **AWS GovCloud/ITAR via SST** — `sst.config.ts` deploys per-workspace
   Fargate services (`CarbonERPService`, `CarbonMESService`) on
   `CarbonCluster` inside `CarbonVpc2`, fanned out over the `workspaces` table
   by `ci/src/deploy.ts`.

**Vercel Python functions were evaluated and rejected** for the geometry
service itself:

- The `cadquery-ocp` (OCCT) wheel dynamically links system libraries
  (`libgl1`, `libglu1-mesa`, `libxrender1`, `libfontconfig1`, …) that the
  Dockerfile apt-installs; Vercel's Python runtime cannot install system
  packages and does not run arbitrary containers.
- Bundle size: the OCCT wheel (~70 MB) plus numpy/scipy/trimesh/python-fcl/
  rtree is at best marginal against Vercel's 250 MB uncompressed limit, and
  the meshopt pass shells out to a Node CLI (`gltf-transform`) from Python —
  a cross-runtime pattern Vercel functions don't support.
- `/plan` uses an **in-process job store** (`_plan_job_set` /
  `_run_plan_job` background thread in `services/geometry/app/main.py`) with
  status polling at `/plan/{jobId}`. Serverless invocations share no memory,
  so polling would land on instances that never saw the job.
- Tessellation is long-running CPU-bound work — a poor fit for function
  duration limits and per-CPU-second billing.

So the service stays a container in both builds, and each build needs a home
for it. Separately, the in-memory `/plan` job store makes *any* deployment
with more than one replica behind a load balancer incorrect — polling can hit
a task that never saw the job — so this spec externalizes it.

## Proposed Solution

Two SST apps, one Docker image, Redis-backed `/plan` jobs.

### Flavor A — `carbon` app (GovCloud/ITAR): third service, same pattern as ERP/MES

Add a third service to the existing `sst.config.ts` `run()`, cloning the
ERP/MES service shape (ALB + domain + cert, `dns: false`):

```ts
const geometry = cluster.addService("CarbonGeometryService", {
  cpu: "2 vCPU",
  memory: "4 GB",
  image: `${process.env.AWS_ACCOUNT_ID}.dkr.ecr.${process.env.AWS_REGION}.amazonaws.com/carbon/geometry:${process.env.IMAGE_TAG}`,
  loadBalancer: {
    domain: {
      name: process.env.URL_GEOMETRY ?? "govcloud.itar.carbon.ms",
      dns: false,
      cert: process.env.CERT_ARN_GEOMETRY,
    },
    health: { "8000/http": { path: "/health" } },
    ports: [
      { listen: "80/http", forward: "8000/http" },
      { listen: "443/https", forward: "8000/http" },
    ],
  },
  port: 8000,
  environment: {
    GEOMETRY_SERVICE_API_KEY: process.env.GEOMETRY_SERVICE_API_KEY,
    REDIS_URL: process.env.REDIS_URL, // /plan job store (same per-workspace Redis as ERP/MES)
  },
  scaling: { min: 1, max: 4, cpuUtilization: 70, memoryUtilization: 80 },
});
```

- Same exposure pattern as ERP/MES: public ALB, per-workspace domain + ACM
  cert, `dns: false` (DNS/cert managed outside SST). Bearer key gates
  `/convert` and `/plan`; the WAF ACL pattern (`AppAlbWebAcl`) applies —
  association remains manual, per the existing gotcha.
- ERP and MES service environments gain
  `GEOMETRY_SERVICE_URL=https://${URL_GEOMETRY}` and
  `GEOMETRY_SERVICE_API_KEY`.
- `ci/src/deploy.ts` per-workspace env gains `URL_GEOMETRY`,
  `CERT_ARN_GEOMETRY`, and `GEOMETRY_SERVICE_API_KEY` from three new
  `workspaces` columns (see Data Model Changes). Missing values follow the
  existing skip-and-log convention.
- `/plan` jobs use the workspace's existing `redis_url` (the same Redis
  ERP/MES already receive), namespaced under `geometry:plan:*`.

### Flavor B — `carbon-geometry` app (standalone, serves the Vercel build)

New SST app at `services/geometry/sst.config.ts`:

```ts
export default $config({
  app(input) {
    return {
      name: "carbon-geometry",
      home: "aws",
      region: process.env.AWS_REGION,
      removal: input?.stage === "prod" ? "retain" : "remove",
    };
  },
  async run() {
    const vpc = new sst.aws.Vpc("GeometryVpc");
    const cluster = new sst.aws.Cluster("GeometryCluster", { vpc, forceUpgrade: "v2" });
    cluster.addService("GeometryService", {
      cpu: "2 vCPU",
      memory: "4 GB",
      image: `${process.env.AWS_ACCOUNT_ID}.dkr.ecr.${process.env.AWS_REGION}.amazonaws.com/carbon/geometry:${process.env.IMAGE_TAG}`,
      loadBalancer: {
        domain: {
          name: process.env.URL_GEOMETRY ?? "geometry.carbon.ms",
          dns: false,
          cert: process.env.CERT_ARN_GEOMETRY,
        },
        health: { "8000/http": { path: "/health" } },
        ports: [
          { listen: "80/http", forward: "8000/http" },
          { listen: "443/https", forward: "8000/http" },
        ],
      },
      port: 8000,
      environment: {
        GEOMETRY_SERVICE_API_KEY: process.env.GEOMETRY_SERVICE_API_KEY,
        REDIS_URL: process.env.REDIS_URL, // provisioned outside SST, passed as a secret
      },
      scaling: { min: 1, max: 4, cpuUtilization: 70, memoryUtilization: 80 },
    });
  },
});
```

- **Why a second app, not a mode of the first:** SST/Pulumi state is per
  app + stage. A geometry-only conditional inside the `carbon` app would
  delete the ERP/MES resources from that stage's state on the next deploy.
  A separate app has its own state and zero coupling; SST v3 resolves
  `sst.config.ts` from the working directory, so two apps coexist in the
  monorepo (deploy runs from `services/geometry/`).
- **Public at `geometry.carbon.ms`:** the Vercel-hosted apps and their
  Inngest functions call it over the internet. The ACM cert and DNS record
  are provisioned manually (same `dns: false` convention);
  `URL_GEOMETRY` / `CERT_ARN_GEOMETRY` land in GitHub secrets before the
  first deploy. `GEOMETRY_SERVICE_API_KEY` (one shared key for v1) is the
  auth gate — it lives only in server-side env (Vercel + GitHub secrets).
- **Shared multi-tenant:** the service is stateless with respect to tenant
  data — files flow through pre-signed URLs, nothing is stored; `/plan` job
  records in Redis are transient and keyed by opaque job IDs. One deployment
  serves all Vercel-hosted tenants (cost floor per instance ≈ ALB ~$20/mo +
  min-1 2 vCPU/4 GB Fargate task ~$70/mo makes per-tenant stacks wasteful).
- **Redis provisioned outside SST** and passed as `REDIS_URL`, consistent
  with how the main stack consumes each workspace's `redis_url` — the SST
  app stays a pure consumer of secrets.
- **Not part of the workspace fan-out.** `ci/src/deploy.ts` is untouched by
  this flavor; the standalone app deploys once per environment on its own
  cadence.

### `/plan` job store externalization (in scope)

The in-memory dict + prune in `services/geometry/app/main.py`
(`_plan_job_get` / `_plan_job_set` / `_plan_jobs_prune`) is replaced by a
Redis-backed store so any replica can answer `/plan/{jobId}`:

- New dependency `redis` (sync client) in `pyproject.toml`.
- Job records stored as JSON at `geometry:plan:{jobId}` with a TTL matching
  the current prune window — TTL replaces `_plan_jobs_prune()`.
- `POST /plan` writes the initial record and still runs the conversion on a
  background thread in the receiving task; the thread updates the Redis
  record on progress/completion/failure. Status polling reads Redis, so it
  is replica-independent.
- **Fallback:** when `REDIS_URL` is unset, the store falls back to the
  current in-memory implementation (local dev, tests, docker-compose) —
  no behavior change for existing dev workflows. Deployed environments always
  set `REDIS_URL`.
- Wire contract unchanged: request/response shapes for `/plan` and
  `/plan/{jobId}` stay exactly as defined in
  `docs/specs/animated-work-instructions-contracts.md`.
- Known limitation, accepted for v1: if a task is killed mid-job (deploy,
  scale-in), the background thread dies and the job parks until its TTL;
  the app-side recovery added in `fix(assembly): recover lost plan jobs`
  already handles re-submission.

### CI wiring

- **Image build:** add `geometry` to the `deploy.yml` build matrix, with
  `context: ./services/geometry` and `file: ./services/geometry/Dockerfile`
  (the erp/mes entries keep the root Dockerfile + `APP` build-arg). Add
  `services/geometry/**` to the workflow's `paths`. This guarantees
  `carbon/geometry:${github.sha}` exists for every sha the `carbon` app's
  `${IMAGE_TAG}` interpolation can reference — the main-app deploy never
  points at a missing tag.
- **Standalone deploy:** a new workflow (or job) triggered on
  `services/geometry/**` pushes to `main`, which runs
  `npx --yes sst@3.17.24 deploy --stage prod` from `services/geometry/` with
  the standalone app's env (`AWS_*`, `IMAGE_TAG=${github.sha}`,
  `URL_GEOMETRY`, `CERT_ARN_GEOMETRY`, `GEOMETRY_SERVICE_API_KEY`,
  `REDIS_URL`). ERP/MES pushes never churn the geometry stack, and vice
  versa. Pinned to the same `sst@3.17.24` the CI deploy uses.
- The GovCloud flavor picks the image up through the existing
  `ci/src/deploy.ts` fan-out with the same `IMAGE_TAG`.

### Consumer wiring (both flavors)

No consumer-code changes. `GEOMETRY_SERVICE_URL` and
`GEOMETRY_SERVICE_API_KEY` already exist in `@carbon/env` and are already
consumed by the Inngest tasks. Deployment only supplies values:

| Build | `GEOMETRY_SERVICE_URL` | `GEOMETRY_SERVICE_API_KEY` |
|-------|------------------------|----------------------------|
| GovCloud (`carbon` app) | `https://${URL_GEOMETRY}` (per-workspace subdomain, e.g. `govcloud.itar.carbon.ms`) | per-workspace secret (new `workspaces` column) |
| Vercel-hosted | `https://geometry.carbon.ms` | one shared secret in Vercel env (v1) |

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Host geometry on Vercel Python functions? | **No — container on AWS in both builds** | Native OCCT system libs, ~250 MB bundle ceiling, Python→Node CLI shell-out, in-memory `/plan` job state, long CPU-bound requests. |
| One SST app with a geometry-only mode? | **No — two separate SST apps** | Pulumi state is per app+stage; conditionally omitting ERP/MES would delete them. Separate app = separate state, independent cadence. |
| Standalone app location | `services/geometry/sst.config.ts` | Colocated with the service it deploys; SST resolves config from cwd, so it coexists with the root `sst.config.ts`. |
| GovCloud exposure | **Public ALB + per-workspace domain/cert, same pattern as ERP/MES** (resolved OQ-1) | Uniform with the existing services; avoids the Cloud Map/Service Connect unknown entirely; bearer key + optional WAF gate it. |
| Standalone exposure | **Public ALB at `geometry.carbon.ms` + ACM cert + bearer key** (resolved OQ-1) | Vercel functions call over the internet; `dns: false` + manually provisioned cert, matching the existing convention. |
| Standalone tenancy | **One shared deployment, one shared API key for v1** (resolved OQ-4) | Stateless w.r.t. tenant data (pre-signed URLs); single-secret auth matches `app/auth.py`; per-tenant keys deferred until revocability is needed. |
| GovCloud API-key source | **New `workspaces` columns** (resolved OQ-2) | Consistent with every other per-workspace secret; `deploy.ts` skip-and-log convention applies. |
| `/plan` job store | **Externalize to Redis now, in this spec** (resolved OQ-3) | Enables autoscaling in both flavors from day one; TTL replaces pruning; in-memory fallback preserves local dev. |
| Autoscaling | min 1 / max 4, 70% CPU / 80% mem | Allowed because job state is external; capped below ERP/MES's max 10 since each task is CPU-heavy and volume is lower. |
| Image strategy | **Single image `carbon/geometry:${sha}`, built in the existing `deploy.yml` matrix** | Guarantees the tag exists for every sha the main app deploys; both flavors run identical bits. |
| Config duplication between the two apps | **Accept ~40 lines of duplication** | The two service definitions differ for good reasons (env sources, domains); a shared construct across SST apps isn't worth the coupling. |
| Service sizing | 2 vCPU / 4 GB (match ERP/MES) | Tessellation is CPU-bound; matches the proven baseline; tune later from metrics. |
| Redis provisioning (standalone) | **Outside SST, passed as `REDIS_URL` secret** | Mirrors how the main stack consumes `redis_url`; keeps the SST app a pure consumer of secrets. |
| Wire contracts | **Unchanged** | `/convert`, `/plan`, `graph.json` shapes are owned by `docs/specs/animated-work-instructions-contracts.md`; this spec changes deployment + job-store internals only. |

Heuristics checklist (infra spec — most rows N/A):

| # | Heuristic | Answer |
|---|-----------|--------|
| 1 | Multi-tenancy | No new app tables. The service holds no tenant data at rest; `/plan` Redis records are transient, opaque-ID-keyed. GovCloud isolation is per-workspace stacks. |
| 2 | Service shape | N/A — no new `{module}.service.ts` functions; existing Inngest tasks unchanged. |
| 3 | RLS coverage | N/A — no app-database surface. (New columns are on the CI `workspaces` table, which is service-role-only.) |
| 4 | Permission scoping | N/A for routes; service-to-service auth is the existing bearer-key scheme in `services/geometry/app/auth.py`. |
| 5 | Form pattern | N/A — no UI. |
| 6 | Module layout | N/A — no ERP module changes. |
| 7 | Backward compatibility | Wire contracts frozen per `docs/specs/animated-work-instructions-contracts.md`; job-store change is internal; env additions only. |

## Data Model Changes

No application-database changes. The CI **`workspaces`** table (the deploy
fan-out control table, not an app table) gains three nullable columns,
following its existing flat-secret convention:

- `url_geometry` — per-workspace geometry hostname (e.g.
  `govcloud.itar.carbon.ms`).
- `cert_arn_geometry` — ACM cert ARN for that hostname.
- `geometry_service_api_key` — per-workspace bearer secret.

`ci/src/deploy.ts`'s `Workspace` type gains the same three fields; workspaces
missing them are skipped with a log line, per the existing convention.

## API / Service Changes

- **`services/geometry`**: replace the in-memory `/plan` job store with the
  Redis-backed store described above (`redis` dependency, `REDIS_URL` env,
  TTL-based expiry, in-memory fallback when unset). Wire contracts unchanged.
- **`sst.config.ts` (root)**: add `CarbonGeometryService`; add
  `GEOMETRY_SERVICE_URL` / `GEOMETRY_SERVICE_API_KEY` to ERP and MES
  `environment`.
- **`services/geometry/sst.config.ts`**: new standalone app (sketch above).
- **`.github/workflows/deploy.yml`**: `geometry` in the build matrix +
  `services/geometry/**` in `paths`.
- **New workflow** for the standalone deploy (path-filtered on
  `services/geometry/**`).
- **`ci/src/deploy.ts`**: three new `Workspace` fields passed into the
  per-workspace SST env.
- **`services/geometry/README.md`**: document both deploy paths and the
  Redis job store.

## UI Changes

N/A — no user-facing surface; the viewer already consumes the outputs.

## Acceptance Criteria

- [ ] Push to `main` touching `services/geometry/**` builds and pushes
      `carbon/geometry:${sha}` (and `:latest`) to ECR.
- [ ] GovCloud: after `ci:deploy`, each fully-configured `aws === true`
      workspace stack contains a running `CarbonGeometryService` behind its
      own ALB; `https://${url_geometry}/health` returns `{ "ok": true, ... }`
      and `POST /convert` without a bearer token returns 401.
- [ ] GovCloud: a workspace missing any of the three new columns is skipped
      with a log line and its ERP/MES deploy is unaffected.
- [ ] GovCloud: uploading a STEP file to an assembly in a deployed workspace
      completes the Inngest convert pipeline (GLB + `graph.json` land in
      storage; viewer renders the model).
- [ ] Standalone: `https://geometry.carbon.ms/health` returns 200 publicly;
      `POST /convert` without a bearer token returns 401; with the correct
      key it processes a STEP fixture end-to-end.
- [ ] Standalone: an ERP/MES-only push to `main` does not trigger the
      geometry deploy workflow, and a `services/geometry/**` push does not
      redeploy ERP/MES.
- [ ] `/plan` with `REDIS_URL` set: start a job, then poll `/plan/{jobId}`
      against a **different** replica (or after a store round-trip in tests)
      and receive correct status/result; job record expires after the TTL.
- [ ] `/plan` without `REDIS_URL`: existing in-memory behavior and the
      existing pytest suite pass unchanged.
- [ ] `sst deploy` of the standalone app from `services/geometry/` does not
      mutate any resource in the `carbon` app's stacks (verified via the
      deploy diff).

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Task killed mid-`/plan` job (deploy/scale-in) orphans the job until TTL | Med | Accepted for v1; app-side recovery (`recover lost plan jobs`) re-submits; record a `startedAt` so the app can detect stalls. |
| Root-app deploy references a geometry image tag that was never built | Med | Geometry joins the same `deploy.yml` build matrix, so every deployed sha has a geometry image. |
| Public endpoints abuse (both flavors) | Med | Bearer key required for all non-`/health` routes; WAF rate-limit ACL available (association is manual, same as `AppAlbWebAcl`). |
| Redis unavailable at runtime | Med | `/plan` returns a 5xx with the existing error envelope rather than silently falling back to memory in deployed envs (fallback is dev-only, gated on `REDIS_URL` unset). |
| Two `sst.config.ts` files → deploying from the wrong cwd | Low | Deploys only run via CI workflows with fixed working directories; document in `services/geometry/README.md`. |
| SST version drift between the two apps | Low | Pin the standalone deploy to the same `sst@3.17.24` the CI deploy uses. |
| Per-workspace ALB cost for geometry (GovCloud) | Low | Accepted — consistency with ERP/MES chosen over cost; ~$20/mo/workspace. |

## Open Questions

> 🛑 HARD STOP: Do not proceed with implementation until these are answered.

- [x] **OQ-1: Standalone + GovCloud hostnames.** — **Answer:** GovCloud
      geometry serves per-workspace at `govcloud.itar.carbon.ms` (stored in
      the new `url_geometry` column; public ALB + cert, same pattern as
      ERP/MES — this supersedes the earlier internal-only lean). Standalone
      serves at `geometry.carbon.ms`. Certs/DNS provisioned manually per the
      `dns: false` convention. *(Resolved by Brad, 2026-07-06.)*
- [x] **OQ-2: GovCloud API-key source.** — **Answer:** new
      `geometry_service_api_key` column on the CI `workspaces` table (plus
      `url_geometry`, `cert_arn_geometry`), consistent with every other
      per-workspace secret; `deploy.ts` skip-and-log convention applies.
      *(Resolved by Brad, 2026-07-06.)*
- [x] **OQ-3: `/plan` job-state externalization.** — **Answer:** bundled into
      this spec — Redis-backed job store with TTL expiry and dev-only
      in-memory fallback; autoscaling (max 4) enabled in both flavors.
      *(Resolved by Brad, 2026-07-06.)*
- [x] **OQ-4: Standalone key granularity.** — **Answer:** one shared
      `GEOMETRY_SERVICE_API_KEY` for all Vercel-hosted tenants in v1
      (matches single-secret auth in `app/auth.py`); per-tenant keys deferred.
      *(Resolved by Brad, 2026-07-06.)*
- [x] **OQ-5: Internal discovery mechanism.** — **Answer:** moot — OQ-1's
      resolution puts GovCloud geometry behind an ALB + domain like ERP/MES,
      so `GEOMETRY_SERVICE_URL` is a plain https URL; no Cloud Map/Service
      Connect dependency. *(Resolved as a consequence of OQ-1, 2026-07-06.)*

## Changelog

- 2026-07-06: Created from deployment design conversation (Vercel Python
  functions ruled out; two-SST-app split agreed).
- 2026-07-06: All open questions resolved via grill. GovCloud flavor changed
  from internal-only to public ALB + per-workspace domain (OQ-1); `/plan`
  Redis job store pulled into scope (OQ-3); autoscaling max 4 enabled.
