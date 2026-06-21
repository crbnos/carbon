# Production Docker Compose (self-hosted stack)

Single-host self-hosted deployment, alternative to the SST/AWS path
(`sst-deployment-infrastructure.md`). Added 2026-06-21.

## Files
- `docker-compose.prod.yml` (root) — 15 services
- `.env.production.example` (root) — full env contract; copy to `.env.production` (gitignored)
- `scripts/gen-supabase-keys.mjs` — zero-dep generator for the Supabase key trio
  (`SUPABASE_JWT_SECRET` + `anon`/`service_role` JWTs signed with it, HS256)
- `deploy/prod/Caddyfile` — reverse proxy, 3 hostnames (ERP_HOST, MES_HOST, SUPABASE_HOST)
- `deploy/prod/postgres/01-roles.sh` — role bootstrap; `*.sh` (not `.sql`) so it reads
  `${POSTGRES_PASSWORD}` and sets it on supabase_admin/auth_admin/storage_admin/authenticator
- `deploy/prod/README.md` — operator runbook
- `deploy/prod/deploy.sh` — wrapper script. `init` generates `.env.production`
  (Supabase key trio + random POSTGRES_PASSWORD/SESSION_SECRET/INNGEST keys +
  inlined SUPABASE_DB_URL with ?sslmode=disable; idempotent, `--force` to
  overwrite). `up` builds erp/mes then boots in order: `postgres storage
  --wait` → `run --rm migrate` → data plane → `erp mes caddy`. Also
  `migrate`/`down [--volumes]`/`status`/`logs`. Defensive bash, dep checks.
- App image: shared root `Dockerfile` via `--build-arg APP=erp|mes`

## Shared single Dockerfile
`apps/erp/Dockerfile` + `apps/mes/Dockerfile` were unified into root `./Dockerfile`
(`ARG APP`, re-declared per stage). `.github/workflows/deploy.yml` builds it with
`file: ./Dockerfile`, `build-args: APP=${{ matrix.app }}`. Committed `8408952f4`.

## Profiles
- default profile: `erp`, `mes`, `caddy`, `migrate`
- `data` profile: postgres, gotrue, postgrest, realtime, storage, meta, studio,
  kong, edge-runtime, redis, inngest
- Full self-host: `--profile data up`. Apps-only against managed backends: omit
  the profile, point SUPABASE_*/REDIS_URL/INNGEST_* at external services.
- Apps have NO `depends_on` on data-profile services (keeps apps-only mode valid);
  boot order is sequenced in the README instead.

## Reused from dev stack (mounted, not copied)
`packages/dev/docker/kong.yml`, `packages/dev/docker/edge-main/index.ts`,
`packages/database/supabase/functions`.

## Boot order (critical)
postgres+storage → `migrate` → rest. storage-api creates `storage.*` on boot;
an early migration writes `storage.buckets`, so `migrate` `depends_on` postgres
+ storage healthchecks (storage has a `/status` node-fetch healthcheck).

## Gotchas discovered during bring-up
- **postgres runs ssl=off.** supabase CLI (pgx) only honors disable reliably via
  `PGSSLMODE=disable` env (the `?sslmode=disable` URL param is flaky). The
  `migrate` service sets `PGSSLMODE=disable` and deliberately does NOT load
  `.env.production` (env_file's `SUPABASE_DB_URL` would override `--db-url`).
- **App DB client (pg) DOES honor** `?sslmode=disable` in `SUPABASE_DB_URL` — keep
  it for self-host.
- **ERP requires `RESEND_API_KEY`** — Resend client constructed at boot, crashes if
  empty (`apps/erp/app/lib/resend.server.ts`). MES does not.
- **`INNGEST_SIGNING_KEY` must be plain even-hex** (`openssl rand -hex 32`); the
  self-hosted inngest server rejects the `signkey-…` prefix. App only needs it
  non-empty at boot.
- **gotrue** `GOTRUE_EXTERNAL_*_ENABLED` must be `true`/`false`, never empty — driven
  by `GOOGLE_AUTH_ENABLED`/`AZURE_AUTH_ENABLED` (default false), not `${VAR:+true}`.
- **studio** reports `unhealthy` (image healthcheck expects the omitted analytics
  service); UI still works.

## Migration mechanism
`migrate` one-shot runs the app image: `pnpm exec supabase migration up
--include-all --db-url postgresql://supabase_admin:${POSTGRES_PASSWORD}@postgres:5432/postgres`
(cwd `/repo/packages/database`). Mirrors `packages/dev/src/services/migrations.ts`.
746 migrations applied clean in verification.

## Hard-required app env (from packages/env/src/index.ts)
`SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `SUPABASE_DB_URL`, `REDIS_URL`,
`INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY`. Plus erp: `RESEND_API_KEY`. Most other
`getEnv` calls pass an options object, which makes them effectively optional
(the default `isRequired:true` only applies when no options arg is passed).

## /health
`apps/{erp,mes}/app/routes/_public+/health.tsx` — trivial 200 JSON, no backend
call (cache `sst-deployment-infrastructure.md` description of a DB query is stale).

Committed `aff335336`.
