---
description: Self-hosted single-VPS deployment — Docker Swarm + Caddy stack under contrib/deploying/simple-docker-caddy. Swarm secrets, full Supabase data plane, the alternative to the SST/AWS cloud path.
paths:
  - "contrib/deploying/**"
---

# Self-host: single-VPS Docker Swarm + Caddy (`contrib/deploying/simple-docker-caddy`)

Self-host the whole stack (ERP + MES + full Supabase data plane + Redis + Inngest)
on **one Linux VPS** as a single-node Docker **Swarm** (`docker stack deploy`),
behind an auto-HTTPS Caddy proxy. The community/self-host alternative to the
managed SST/AWS path (see [sst-deployment-infrastructure.md](sst-deployment-infrastructure.md)).
Both build from the same root `Dockerfile` (`--build-arg APP=erp|mes`).

This **replaced** the old `docker-compose.prod.yml` + `deploy/prod/` compose stack
(deleted) and the root `scripts/gen-supabase-keys.mjs` (moved into the example).

## Files (all under `contrib/deploying/simple-docker-caddy/`)
- `docker-compose.prod.yml` — the Swarm stack. NOT `docker compose up`-able: `build:`,
  `depends_on`, `profiles`, `restart:` are intentionally absent (Swarm ignores
  them). Uses `deploy:` (replicas/resources/update_config/restart_policy), top-level
  `secrets: external: true`, an `attachable` overlay `internal`, YAML anchors
  (`*shim`, `*restart`, `*app-deploy`).
- `deploy.sh` — lifecycle: `init` (swarm init + create secrets + `.env`), `build`
  (host build of erp/mes, skipped when `CARBON_REGISTRY` set), `deploy`
  (`docker stack deploy`), `up` (build+deploy+migrate+roll apps), `migrate`,
  `secret <name>` (stdin), `status`, `logs <svc>`, `down [--volumes]`.
- `bin/secrets-entrypoint.sh` — the linchpin. Used as `entrypoint:` on every
  secret-consuming service; substitutes `__SECRET_NAME__` placeholders in env with
  the contents of `/run/secrets/<secret_name>` (awk literal subst — safe for `/ + = &`),
  then `exec "$@"`. This is how Swarm secret *files* feed images that only read env
  vars (incl. Postgres DSNs that embed the password). POSIX sh + awk; verified to
  run as non-root (`supabase`, `ubuntu`) in the pinned images.
- `Caddyfile` — `{$ERP_HOST}`→erp:3000, `{$MES_HOST}`→mes:3000, `{$SUPABASE_HOST}`→kong:8000,
  + security headers/compression via a `(common)` snippet; optional `{$STUDIO_HOST}`
  block behind `basic_auth` (commented; Studio is internal-only by default).
- `postgres/01-roles.sh` — Supabase role passwords from `POSTGRES_PASSWORD` (`*.sh`
  so it reads env; same as the old deploy/prod one).
- `postgres/02-performance.sh` — first-init tuning via `ALTER SYSTEM` (max_connections,
  shared_buffers, work_mem, effective_cache_size…) from `CARBON_PG_*` env +
  `pg_stat_statements`. `shared_preload_libraries=pg_stat_statements` is a server
  flag in the postgres `command:` (can't be set by ALTER SYSTEM at runtime).
- `scripts/gen-supabase-keys.sh` — Supabase JWT trio (jwt_secret + anon/service_role
  signed with it), HS256 via `openssl` only (no Node). Consumed by `deploy.sh init`.
- `scripts/harden.sh` — UFW (SSH+80+443 only), fail2ban, swap, unattended-upgrades.
- `scripts/backup.sh` — `pg_dump` (password from the in-container secret) + storage
  volume tarball.
- `.env.example` — NON-secret config only (hosts/urls, `CARBON_REPO`, image tags,
  pg tuning, toggles). Secrets are never here.

## Secrets (10, all `external: true` — created by `deploy.sh init`)
`postgres_password`, `postgrest_db_uri`, `session_secret`, `inngest_signing_key`
(plain hex — self-host Inngest rejects the `signkey-` prefix), `inngest_event_key`,
the trio `jwt_secret`/`anon_key`/`service_role_key` (minted together), and
operator-supplied `resend_api_key` + `smtp_password` (seeded with placeholders so
the stack deploys; ERP crashes on boot with an empty RESEND key).
- **`postgres_password` + `postgrest_db_uri` are a pair** — both written ONLY via
  `set_postgres_password()` in deploy.sh (init, `init --force`, and
  `secret postgres_password` all cascade), so the password can't drift between them.
  PostgREST's image is FROM scratch (no shell → can't run the secrets-entrypoint
  shim), so it reads its full connection URI from the `postgrest_db_uri` file via
  PostgREST's native `@file` syntax (`PGRST_DB_URI: "@/run/secrets/postgrest_db_uri"`,
  `PGRST_JWT_SECRET: "@/run/secrets/jwt_secret"`). Drift here = "password
  authentication failed for user authenticator".

## Key facts / gotchas
- **Single-node only.** Config files + edge functions are bind-mounted from
  `${CARBON_REPO}` (the repo must be on the host; images also built from it). The
  stack bind-mounts repo paths it doesn't duplicate: `packages/dev/docker/kong.yml`,
  `packages/dev/docker/edge-main`, `packages/database/supabase/functions`,
  `packages/database/src`. Multi-node → registry images + Swarm `configs` + shared storage.
- **Image launch argv is preserved** when overriding `entrypoint` to the shim — each
  service's `command:` is the image's real ENTRYPOINT+CMD (captured via
  `docker image inspect`), e.g. realtime = `/usr/bin/tini -s -g -- /app/run.sh /app/bin/server`,
  storage/meta/studio = `docker-entrypoint.sh node …`. **postgres does NOT override
  shared_preload_libraries** (the image default already preloads pg_net, pg_cron,
  pgsodium, supabase_vault, … — overriding it dropped pg_net and broke the webhooks
  migration's `CREATE EXTENSION pg_net`). **postgrest does NOT use the shim** (scratch
  image, no shell) — it uses `@file` secrets instead.
- **Healthchecks use `127.0.0.1`, never `localhost`** — `/etc/hosts` resolves
  localhost to `::1` (IPv6) but services bind IPv4, and busybox `wget` (caddy) won't
  fall back, so a localhost check flaps the service. **studio** also needs
  `HOSTNAME=0.0.0.0` (Next.js standalone binds `$HOSTNAME`, which Docker sets to the
  container id → overlay IP only) and a healthcheck override (its built-in demands
  HTTP 200 with no start_period).
- **Ordering** isn't via `depends_on` (Swarm ignores it). `deploy.sh up` deploys all,
  waits for postgres+storage healthy, runs `migrate` as an ephemeral
  `--mode replicated-job` service on `${STACK_NAME}_internal` (reads the password
  from `/run/secrets/postgres_password`, `PGSSLMODE=disable`), then `--force` rolls erp/mes.
- **Postgres has no TLS** → `SUPABASE_DB_URL` keeps `?sslmode=disable`; migrate sets `PGSSLMODE=disable`.
- **Only caddy publishes** (80/443 + 443/udp for HTTP/3), in **`mode: host`** (NOT
  ingress) with `update_config.order: stop-first`. ingress-mesh (IPVS) convergence
  lags caddy's immediate ACME attempt, so HTTP-01 validators hit `:80` before it
  routes and get connection-refused, failing every cert. host mode binds the NIC
  the instant caddy starts. Studio unpublished.
- **Registry mode**: set `CARBON_REGISTRY` + image tags; `build` no-ops, `deploy`
  resolves images from the registry.

## Verify after editing
`docker stack config -c docker-compose.prod.yml` (with `.env` sourced) must parse with no leftover
`${...}` and the `__SECRET__` placeholders intact (resolved at runtime by the shim).
