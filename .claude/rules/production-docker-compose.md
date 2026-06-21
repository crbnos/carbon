---
description: Self-hosted production Docker Compose stack (apps + Supabase data plane + Redis + Inngest) and the deploy/prod/deploy.sh helper
paths:
  - "deploy/**"
  - "docker-compose.prod.yml"
  - "Dockerfile"
  - "scripts/gen-supabase-keys.mjs"
---

# Production Docker Compose (self-hosted stack)

Single-host self-hosted deployment: ERP + MES + full Supabase data plane + Redis
+ Inngest behind an auto-HTTPS Caddy proxy. Alternative to the SST/AWS path. Can
also run **apps-only** against managed backends (omit the `data` profile).

Note: the `.github/workflows/deploy.yml` "Deploy" job uses Pulumi + AWS ECR (the
managed/cloud path), NOT this compose stack. It only shares the root `Dockerfile`.

## Files (verified locations)
- `docker-compose.prod.yml` (repo root) — the stack, 15 services
- `.env.production.example` (repo root) — env template; copy to `.env.production` (gitignored)
- `scripts/gen-supabase-keys.mjs` — zero-dep generator for the Supabase key trio
  (`SUPABASE_JWT_SECRET` + `anon`/`service_role` JWTs signed with it, HS256)
- `Dockerfile` (repo root) — single shared app image, `ARG APP` (re-declared per
  stage), built with `--build-arg APP=erp|mes`. Stages: `deps` → `build`
  (`pnpm run build:${APP}`) → `runner` (node:22-slim, installs curl for healthcheck)
- `deploy/prod/deploy.sh` — wrapper script (see below)
- `deploy/prod/Caddyfile` — reverse proxy, 3 hostnames (`ERP_HOST` → erp:3000,
  `MES_HOST` → mes:3000, `SUPABASE_HOST` → kong:8000); ACME email from `ACME_EMAIL`
- `deploy/prod/postgres/01-roles.sh` — role bootstrap. A `*.sh` (not `.sql`) so it
  reads `${POSTGRES_PASSWORD}` from env and `ALTER USER … WITH PASSWORD` on
  supabase_admin / supabase_auth_admin / supabase_storage_admin / authenticator;
  grants anon+authenticated+service_role to authenticator; creates `_realtime`
  schema. Mounted into `/docker-entrypoint-initdb.d` (runs once per fresh pgdata)
- `deploy/prod/README.md` — operator runbook

## Services (15)
- **Apps (always on, no profile):** `erp`, `mes` (both build from root Dockerfile,
  image `carbon/{app}:latest`, expose 3000, `/health` healthcheck via curl),
  `caddy` (only published service — 80/443; `depends_on` erp+mes)
- **`migrate`** — one-shot, `data` profile. `depends_on` postgres + storage healthy
- **Data plane (`data` profile):** `postgres`, `gotrue`, `postgrest`, `realtime`,
  `storage`, `meta`, `studio`, `kong`, `edge-runtime`, `redis`, `inngest`

`postgres` carries network alias `db`; `realtime` carries alias `realtime-dev`.
Only `caddy` (80/443) and `studio` (`127.0.0.1:${STUDIO_PORT:-3900}` loopback
only) publish ports — everything else stays on the internal network.

Apps have **no `depends_on`** on data-plane services (keeps apps-only mode valid);
boot order is enforced by `deploy.sh` / the README, not compose deps.

## Reused from dev stack (bind-mounted, not copied)
`packages/dev/docker/kong.yml` (→ kong), `packages/dev/docker/edge-main/`
(→ edge-runtime main service), `packages/database/supabase/functions` +
`packages/database/src` (→ edge-runtime). The dev compose itself now lives at
`packages/dev/docker/docker-compose.dev.yml` (recently moved from repo root).

## deploy/prod/deploy.sh (defensive bash, `set -euo pipefail`)
Always runs `docker compose -f docker-compose.prod.yml --env-file .env.production`
from repo root. Subcommands:
- **`init [--force]`** — `cp .env.production.example .env.production`, then
  `upsert_env` (awk-based, GNU/BSD-portable) the generated values: Supabase key
  trio from `gen-supabase-keys.mjs`, `POSTGRES_PASSWORD` (`openssl rand -hex 24`),
  `SESSION_SECRET` (hex 32), `INNGEST_SIGNING_KEY` (hex 32), `INNGEST_EVENT_KEY`
  (hex 16), and `SUPABASE_DB_URL=postgresql://postgres:<pw>@postgres:5432/postgres?sslmode=disable`.
  Then warns to hand-edit `*_HOST`/`*_URL` + `ACME_EMAIL` + `RESEND_API_KEY` + SMTP.
- **`up`** — ordered boot:
  1. `dc build erp mes`
  2. `dc --profile data up -d --wait postgres storage`
  3. `dc --profile data run --rm migrate`
  4. `dc --profile data up -d gotrue postgrest realtime meta studio kong edge-runtime redis inngest`
  5. `dc up -d erp mes caddy`
- **`migrate`** — re-run steps 2–3 only (postgres+storage wait, then migrate)
- **`down [--volumes]`** — `down` (add `--volumes` to wipe all data)
- **`status`** — `ps`; **`logs [service]`** — `logs -f`

## Boot order (critical)
postgres + storage → `migrate` → rest of data plane → apps. `storage-api` creates
the `storage.*` schema on boot and an early migration `INSERT`s into
`storage.buckets`, so `migrate` gates on **storage healthy** (storage has a
`/status` node-fetch healthcheck) as well as postgres healthy.

## Migration mechanism
`migrate` runs the `carbon/erp:latest` image, cwd `/repo/packages/database`:
`pnpm exec supabase migration up --include-all --db-url postgresql://supabase_admin:${POSTGRES_PASSWORD}@postgres:5432/postgres`.
Mirrors the dev migration flow.

## Gotchas
- **postgres runs ssl=off.** The supabase CLI (pgx) only honors disable reliably
  via `PGSSLMODE=disable` env — the `?sslmode=disable` URL param is flaky. The
  `migrate` service sets `PGSSLMODE=disable` and **deliberately does NOT** load
  `.env.production` (env_file's `SUPABASE_DB_URL` would override `--db-url`).
- **App DB client (node-postgres) DOES honor** `?sslmode=disable` in
  `SUPABASE_DB_URL` — keep it for self-host.
- **ERP requires a non-empty `RESEND_API_KEY`.** `packages/lib/src/resend.server.ts`
  runs `new Resend(process.env.RESEND_API_KEY!)` at module load, so ERP crashes on
  boot if empty. Use a real key or a placeholder. MES has no such requirement.
- **`INNGEST_SIGNING_KEY` must be plain even-length hex** (`openssl rand -hex 32`);
  the self-hosted inngest server rejects the `signkey-…` prefix. `deploy.sh init`
  generates plain hex. (The README's step-1 line suggesting `signkey-prod-<hex>`
  is internally inconsistent with deploy.sh and its own Notes section — trust the
  plain-hex form.)
- **gotrue** `GOTRUE_EXTERNAL_{GOOGLE,AZURE}_ENABLED` are driven by
  `${GOOGLE_AUTH_ENABLED:-false}` / `${AZURE_AUTH_ENABLED:-false}` (must be
  `true`/`false`, never empty).
- **studio** may report `unhealthy` (its image healthcheck expects the omitted
  Supabase analytics service); the UI still works. Reach it only via SSH tunnel
  to the loopback port.

## App env hard-requirements (`packages/env/src/index.ts`)
`getEnv(name)` with no options object defaults `isRequired: true` and throws
`"${name} is not set"` if empty; passing an options object usually opts out. Bare
(required) exports include `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`. Several
others (`SUPABASE_DB_URL`, `REDIS_URL`, `INNGEST_SIGNING_KEY`) pass options.
`RESEND_API_KEY` is read directly from `process.env` (not via `getEnv`).

## /health
`apps/{erp,mes}/app/routes/_public+/health.tsx` — used by the compose healthchecks
(`curl -fsS http://localhost:3000/health`).
