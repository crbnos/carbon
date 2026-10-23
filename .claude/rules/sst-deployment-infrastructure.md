---
description: SST + AWS ECS production deployment path (sst.config.ts, ECR-built Docker images, CI workspace fan-out). The managed/cloud alternative to the self-hosted Swarm stack.
paths:
  - "sst.config.ts"
  - "ci/**"
  - ".github/workflows/deploy.yml"
  - ".github/workflows/build-images.yml"
  - ".github/workflows/post-deploy.yml"
  - "Dockerfile"
  - "apps/erp/app/utils/inngest-self-sync.server.ts"
  - "apps/erp/app/entry.server.tsx"
---

# SST / AWS ECS Deployment (managed cloud path)

SST is **still used** — it is the managed, multi-tenant cloud deployment path.
The self-hosted single-VPS Docker **Swarm** stack (see
[the self-host deployment README](../../contrib/deploying/simple-docker-caddy/README.md)) is a separate,
alternative deployment, not a replacement. Both build from the same root `Dockerfile`.

## What SST deploys (`sst.config.ts`)
- App `carbon`, `home: "aws"`, region from `process.env.AWS_REGION` (no hardcoded
  GovCloud region — the old "us-gov-east-1" claim was stale; region is per-workspace).
  `removal: "retain"` for `stage === "prod"`, else `"remove"`.
- One `sst.aws.Vpc` (`CarbonVpc2`) + one `sst.aws.Cluster` (`CarbonCluster`,
  `forceUpgrade: "v2"`).
- Two Fargate services on the cluster, each 2 vCPU / 4 GB:
  - **`CarbonERPService`** — image
    `${IMAGE_REGISTRY}/carbon/erp:${IMAGE_TAG}` (see Images below),
    domain `process.env.URL_ERP ?? "itar.carbon.ms"`, cert `CERT_ARN_ERP`.
  - **`CarbonMESService`** — same shape, `carbon/mes` image, domain
    `process.env.URL_MES ?? "mes.itar.carbon.ms"`, cert `CERT_ARN_MES`.
  - Both: LB ports `80/http`+`443/https` → `3000/http`, `dns: false`, health
    check at `/health` (set both via `loadBalancer.health` and a `transform.target`
    override), `idleTimeout: 600`, scaling `min 1 / max 10`, request count 500,
    70% CPU / 80% mem.
    Image tag is `${IMAGE_TAG}` (was hardcoded `:latest` in the old doc — stale).
- **WAF** (`aws.wafv2.WebAcl` `AppAlbWebAcl`, scope `REGIONAL`): rate-limit rule
  1000 req/IP/5min + `AWSManagedRulesCommonRuleSet`. Default action allow. It is
  **created but NOT auto-associated** with the ALB — association is manual (per
  the in-file comment).

## SST version — two different versions, watch out
- Catalog `sst` in `pnpm-workspace.yaml` is **`4.6.9`** (dev dep used for typegen,
  `sst-env.d.ts`).
- The actual deploy command pins a **different** version: `ci/src/deploy.ts` runs
  `npx --yes sst@3.17.24 deploy --stage prod`. The old doc's `3.17.14` is stale.
- `sst-env.d.ts` files (repo root, `ci/`, per app/package) are SST-generated type
  stubs; do not hand-edit.

## Images, then deploy (`.github/workflows/build-images.yml`)
Every push to `main` runs `build-images.yml`, which builds or re-tags every image
for the commit (`carbon/<image>:<sha>` in `vars.IMAGE_REGISTRY`). The deploy is a
job of that same run, chained with `needs:` — there is no polling:
- `apps` builds `carbon/erp` and `carbon/mes`; `services` builds `bootstrap` and
  `edge-functions`; `assembler` builds `carbon/assembler` — all with the same steps
  (a YAML anchor). Split so each deploy needs only its own images: a failed
  assembler build does not hold back an app release.
- `changes` diffs `github.event.before..sha` twice: over the app inputs
  (`apps/erp`, `apps/mes`, `packages`, `docs/content`, …) for `deploy`, and over
  `apps/assembler`, `crates` and the Cargo files for `assembler`. A new branch or
  force-push (no usable `before`) counts as changed. A manual run of
  `build-images.yml` never deploys.
- `deploy` (`needs: [apps, changes]`) calls `deploy.yml` with `apps: true`;
  `deploy-assembler` (`needs: [assembler, changes]`) calls it with
  `assembler: true` (`workflow_call`, `secrets: inherit`). A failed or cancelled
  image skips its deploy at once.
- `deploy.yml`'s `assembler` job runs one leg per AWS account (prod with
  `ASSEMBLER_AWS_*`, govcloud with `AWS_*`). A Lambda pulls only from a private
  ECR repository in its own account, so each leg copies
  `${IMAGE_REGISTRY}/carbon/assembler:<sha>` into its account's `carbon/assembler`
  (pull and push, keeping one linux/amd64 manifest) and then runs
  `pnpm --filter ci ci:assembler` (`ci/src/assembler.ts`, which deploys
  `apps/assembler/sst.config.ts` for that account's workspaces).
- Image concurrency is per image and per job (`build-images-<image>`), not per
  workflow, so a deploy still running does not hold up the next commit's builds.
- The services pull `${IMAGE_REGISTRY}/carbon/<app>:${IMAGE_TAG}`. With
  `IMAGE_REGISTRY` unset `sst.config.ts` falls back to the workspace account's
  private ECR (`${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com`), which is
  what a deployment that builds its own images uses.

## Deploy (`deploy.yml`, `workflow_call` + `workflow_dispatch`)
- Run by hand, it deploys the commit it is run on, whose images must already exist.
- One deploy at a time (`concurrency: deploy-apps`); a newer commit waiting
  replaces an older one that had not started.
- Sets `IMAGE_TAG: ${{ github.sha }}` (this is what `sst.config.ts` interpolates
  into the ECR image ref — so prod runs the exact SHA, not `:latest`).
- Installs Pulumi `3.212.0` (SST v3 uses Pulumi under the hood), `pnpm install
  --frozen-lockfile`, then `pnpm --filter ci ci:deploy` → `tsx ci/src/deploy.ts`.

### `ci/src/deploy.ts` — multi-tenant workspace fan-out
- Reads all rows from the Supabase **`workspaces`** table (via `ci/src/client.ts`,
  service-role).
- For each workspace: **skips unless `aws === true`**, and skips (logs, `continue`)
  if any required field is missing (aws_account_id, aws_region, domain_name,
  cert_arn_erp/mes, database_url, database_connection_pooler_url, database_password,
  anon_key, service_role_key, resend_api_key, session_secret, inngest_signing_key,
  inngest_event_key, redis_url, url_erp, url_mes).
- Builds a per-workspace env (incl. `IMAGE_TAG`, AWS creds/region, all app secrets;
  note `SUPABASE_DB_URL := database_connection_pooler_url`, `SUPABASE_URL :=
  database_url`, `CARBON_EDITION` defaults `"enterprise"`), then runs SST from repo
  root (`cwd: ".."` relative to `ci/`): `npx --yes sst@3.17.24 deploy --stage prod`.
- Per-workspace failures are caught; the script exits non-zero if any failed.

## Inngest function sync — two mechanisms, both fire on every deploy

Inngest (Cloud or self-hosted) only knows an app's current function list once
something PUTs its serve endpoint (`/api/inngest`) — that's Inngest's own
registration handshake, not Carbon-specific. Two independent triggers exist:

- **Boot self-sync** (`apps/erp/app/utils/inngest-self-sync.server.ts`,
  wired from `apps/erp/app/entry.server.tsx`): on every process boot where
  `NODE_ENV=production` (both this ECS/SST path and self-hosted Swarm), the
  app retries `PUT http://127.0.0.1:${PORT}/api/inngest` against itself
  (up to 10 attempts, 2s apart) until it succeeds, then stops. Fire-and-forget
  — never blocks or fails server boot. Covers every case a per-workspace
  fan-out can't: ECS task reschedules, autoscale-out, self-host restarts —
  not just a `main` push. No-ops in local `pnpm dev`/`vitest` (gated on
  `NODE_ENV === "production"`, which those don't set), and no-ops on a real
  Vercel deployment (`VERCEL_DEPLOYMENT_ID` set) — a serverless function has
  no persistent port to self-connect to; Vercel's own Inngest integration
  syncs via a deploy webhook instead. Carbon doesn't deploy to real Vercel
  today (the `VERCEL_ENV`/`VERCEL_URL` vars above are just an env shim for
  app code that reads them for its own base-URL detection), but the adapter
  path (`server/app.ts`, `@vercel/react-router` in `entry.server.tsx`) is
  still live, so this stays inert there rather than retrying uselessly.
- **CI-triggered sync** (`.github/workflows/post-deploy.yml`, `ci/src/post-deploy.ts`):
  the one post-deploy step, whatever hosts the ERP. Called by `deploy.yml`
  (job `sync`) after its deploy job succeeds, run on a successful production
  deploy of the ERP's Vercel projects (`deployment_status`, environment
  `Production – carbon*`), and runnable by hand. Reads every row in the
  `workspaces` table and does the same `PUT .../api/inngest` against each
  `url_erp`. Redundant with boot self-sync today, but kept as an
  externally-triggered backstop (e.g. if a task's own retries were exhausted
  before the app was reachable). Only targets `url_erp`, never `url_mes` — MES
  has no `/api/inngest` route to sync. For a workspace with a `project_id`
  (hosted Supabase) it then copies the ERP's `/templates/*.html` into the
  project's Auth emails (`ci/src/auth-emails.ts`): hosted Auth cannot
  download templates the way self-hosted Auth does.

Both hit the same handler (`apps/erp/app/routes/api+/inngest.ts`, `serve()`
from `inngest/remix`) — the registration target URL is fixed by that route's
`serveHost` config (`INNGEST_SERVE_HOST || ERP_URL`), so it doesn't matter
whether the PUT arrives via loopback or the public domain.

## Migrations are a separate CI step
SST deploy does **not** run DB migrations. Migrations live in
`ci/src/migrations.ts` (script `ci:migrations`), a separate workspace fan-out over
the `workspaces` table. (The self-host path runs migrations as an ephemeral Swarm
job instead — see [the self-host deployment README](../../contrib/deploying/simple-docker-caddy/README.md).)

## Env vars passed to the services (`sst.config.ts` `environment`)
Both services get Supabase (`SUPABASE_URL`/`ANON_KEY`/`SERVICE_ROLE_KEY`/`JWT_SECRET`/
`DB_URL`), `SESSION_SECRET`, `REDIS_URL`, `INNGEST_*`, `RESEND_*`, `EXCHANGE_RATES_API_KEY`,
`POSTHOG_*`, `CARBON_EDITION`, `BOT_PROTECTION`, `CLOUDFLARE_TURNSTILE_*`,
`CONTROLLED_ENVIRONMENT`, `DOMAIN`, `ERP_URL`/`MES_URL`,
`NODE_ENV=production`, `VERCEL_ENV=production`, `VERCEL_URL` (set to the app host —
there is no real Vercel deploy, this is just an env shim). ERP additionally gets
`OPENAI_API_KEY`, `GOOGLE_PLACES_API_KEY`, `STRIPE_*`,
`SLACK_*`, `JIRA_*`, `QUICKBOOKS_*`, `XERO_*`, `ONSHAPE_*`, `RAMP_CLIENT_ID`,
`RAMP_CLIENT_SECRET`, `AUTH_PROVIDERS`; MES is
the leaner subset (no Stripe/Slack/Jira/QuickBooks/Xero/OpenAI). Autodesk vars are
gone (Autodesk code removed).

Ramp's client id/secret originate on the `workspaces` row as `ramp_client_id` /
`ramp_client_secret`; `ci/src/deploy.ts` copies them into the per-workspace process
environment, and only `CarbonERPService.environment` forwards them to the container.
OAuth state uses the already-required `SESSION_SECRET`, so there is no extra Ramp state
secret to provision.

## /health
`apps/erp/app/routes/health.ts` and `apps/mes/app/routes/_public+/health.tsx` — used
by the ECS/ALB health checks (`/health`, HTTP). Same endpoint the compose stack uses.
With `MAINTENANCE_MODE=true` the route is not reached: `maintenanceMiddleware`
answers `/health` with 200 so tasks are not replaced during the maintenance.

## Notes / gotchas
- `npm run deploy` (root) = `turbo run deploy`; real prod deploy goes through CI →
  `ci:deploy`, not this.
- Service domains use `dns: false` → DNS/cert is managed outside SST (cert ARN per
  workspace); SST does not create Route53 records here.
- WAF must be **manually** associated with the load balancer.
<!-- UNVERIFIED: exact shape of the `workspaces` table in the DB (columns inferred from the Workspace TS type in ci/src/deploy.ts, not from a migration). -->
