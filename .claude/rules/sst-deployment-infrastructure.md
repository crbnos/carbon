---
description: SST + AWS ECS production deployment path (sst.config.ts, ECR-built Docker images, CI workspace fan-out). The managed/cloud alternative to the self-hosted Swarm stack.
paths:
  - "sst.config.ts"
  - "ci/**"
  - ".github/workflows/deploy.yml"
  - "Dockerfile"
---

# SST / AWS ECS Deployment (managed cloud path)

SST is **still used** — it is the managed, multi-tenant cloud deployment path.
The self-hosted single-VPS Docker **Swarm** stack (see
[contrib-deployment-swarm.md](contrib-deployment-swarm.md)) is a separate,
alternative deployment, not a replacement. Both build from the same root `Dockerfile`.

## What SST deploys (`sst.config.ts`)
- App `carbon`, `home: "aws"`, region from `process.env.AWS_REGION` (no hardcoded
  GovCloud region — the old "us-gov-east-1" claim was stale; region is per-workspace).
  `removal: "retain"` for `stage === "prod"`, else `"remove"`.
- One `sst.aws.Vpc` (`CarbonVpc2`) + one `sst.aws.Cluster` (`CarbonCluster`,
  `forceUpgrade: "v2"`).
- Two Fargate services on the cluster, each 2 vCPU / 4 GB:
  - **`CarbonERPService`** — image
    `${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/carbon/erp:${IMAGE_TAG}`,
    domain `process.env.URL_ERP ?? "itar.carbon.ms"`, cert `CERT_ARN_ERP`.
  - **`CarbonMESService`** — same shape, `carbon/mes` image, domain
    `process.env.URL_MES ?? "mes.itar.carbon.ms"`, cert `CERT_ARN_MES`.
  - Both: LB ports `80/http`+`443/https` → `3000/http`, `dns: false`, health
    check at `/health` (set both via `loadBalancer.health` and a `transform.target`
    override), `idleTimeout: 600`, scaling `min 1 / max 10`, 70% CPU / 80% mem.
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

## Build → push (`.github/workflows/deploy.yml`, job `build`)
Triggers on push to `main` touching `apps/erp/**`, `apps/mes/**`, `packages/**`
(or manual `workflow_dispatch`). Matrix over `[erp, mes]`:
- `aws-actions/configure-aws-credentials` + `amazon-ecr-login`.
- `docker/build-push-action` builds the **single root `Dockerfile`** with
  `--build-arg APP=<erp|mes>` (the old per-app `apps/{erp,mes}/Dockerfile` claim is
  stale — there is now ONE Dockerfile: `deps`→`build` (`pnpm run build:${APP}`)→
  `runner` on `node:22-slim`).
- Pushes `carbon/<app>:latest` **and** `carbon/<app>:${{ github.sha }}` to ECR,
  `platforms: linux/amd64`, GHA buildx cache.

## Deploy (job `deploy`, needs `build`)
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

## Migrations are a separate CI step
SST deploy does **not** run DB migrations. Migrations live in
`ci/src/migrations.ts` (script `ci:migrations`), a separate workspace fan-out over
the `workspaces` table. (The self-host path runs migrations as an ephemeral Swarm
job instead — see [contrib-deployment-swarm.md](contrib-deployment-swarm.md).)

## Env vars passed to the services (`sst.config.ts` `environment`)
Both services get Supabase (`SUPABASE_URL`/`ANON_KEY`/`SERVICE_ROLE_KEY`/`JWT_SECRET`/
`DB_URL`), `SESSION_SECRET`, `REDIS_URL`, `INNGEST_*`, `RESEND_*`, `EXCHANGE_RATES_API_KEY`,
`POSTHOG_*`, `CARBON_EDITION`, `CONTROLLED_ENVIRONMENT`, `DOMAIN`, `ERP_URL`/`MES_URL`,
`NODE_ENV=production`, `VERCEL_ENV=production`, `VERCEL_URL` (set to the app host —
there is no real Vercel deploy, this is just an env shim). ERP additionally gets
`OPENAI_API_KEY`, `GOOGLE_PLACES_API_KEY`, `CLOUDFLARE_TURNSTILE_*`, `STRIPE_*`,
`SLACK_*`, `JIRA_*`, `QUICKBOOKS_*`, `XERO_*`, `ONSHAPE_*`, `AUTH_PROVIDERS`; MES is
the leaner subset (no Stripe/Slack/Jira/QuickBooks/Xero/OpenAI). Autodesk vars are
gone (Autodesk code removed).

## /health
`apps/{erp,mes}/app/routes/_public+/health.tsx` — used by the ECS/ALB health checks
(`/health`, HTTP). Same endpoint the compose stack uses.

## Notes / gotchas
- `npm run deploy` (root) = `turbo run deploy`; real prod deploy goes through CI →
  `ci:deploy`, not this.
- Service domains use `dns: false` → DNS/cert is managed outside SST (cert ARN per
  workspace); SST does not create Route53 records here.
- WAF must be **manually** associated with the load balancer.
<!-- UNVERIFIED: exact shape of the `workspaces` table in the DB (columns inferred from the Workspace TS type in ci/src/deploy.ts, not from a migration). -->
