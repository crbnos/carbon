# Carbon — production Docker Compose

Self-host the whole Carbon stack (ERP + MES + Supabase + Redis + Inngest) on a
single host behind an auto-HTTPS reverse proxy. Or run **apps-only** against
managed backends.

Files:
- [`docker-compose.prod.yml`](../../docker-compose.prod.yml) — the stack
- [`.env.production.example`](../../.env.production.example) — env template
- [`scripts/gen-supabase-keys.mjs`](../../scripts/gen-supabase-keys.mjs) — key generator
- `Caddyfile` — reverse proxy (3 hostnames)
- `postgres/01-roles.sh` — Supabase role bootstrap (parameterized password)

The unified app image is built from the repo-root [`Dockerfile`](../../Dockerfile)
via `--build-arg APP=erp|mes`.

## Quick start (`deploy.sh`)

`deploy/prod/deploy.sh` wraps everything below — env generation + ordered boot:

```bash
deploy/prod/deploy.sh init      # create .env.production (keys + random secrets)
# edit .env.production: set the *_HOST/*_URL, ACME_EMAIL, RESEND_API_KEY, SMTP
deploy/prod/deploy.sh up        # build + boot (postgres+storage → migrate → rest → apps)
deploy/prod/deploy.sh status    # docker compose ps
deploy/prod/deploy.sh logs caddy
deploy/prod/deploy.sh migrate   # re-apply migrations after an update
deploy/prod/deploy.sh down      # stop (add --volumes to wipe data)
```

`init` fills `SUPABASE_*` keys, `POSTGRES_PASSWORD`, `SESSION_SECRET`,
`INNGEST_*`, and `SUPABASE_DB_URL` automatically; you only edit hostnames + the
third-party secrets it warns about. The manual steps below are the same flow if
you'd rather run compose yourself.

## Prerequisites

- A host with Docker + Compose v2.
- DNS A-records for `ERP_HOST`, `MES_HOST`, `SUPABASE_HOST` pointing at the host
  (Caddy needs them reachable on :80/:443 for Let's Encrypt).

## 1. Configure

```bash
cp .env.production.example .env.production
node scripts/gen-supabase-keys.mjs        # paste the 3 SUPABASE_* lines in
openssl rand -hex 32                       # -> SESSION_SECRET
openssl rand -hex 24                       # -> POSTGRES_PASSWORD
```

Then in `.env.production`:
- Set `ERP_HOST` / `MES_HOST` / `SUPABASE_HOST` + matching `*_URL` and `ACME_EMAIL`.
- Set `POSTGRES_PASSWORD`, and put the **same** password into `SUPABASE_DB_URL`
  (`env_file` does not expand `${...}`).
- Set `INNGEST_SIGNING_KEY` (`signkey-prod-<hex>`) and `INNGEST_EVENT_KEY`.
- Fill SMTP so Auth can send invites/magic links.

`docker compose` reads `.env.production` via `--env-file` (below). To shorten the
commands, `export COMPOSE_FILE=docker-compose.prod.yml` and
`alias dc='docker compose --env-file .env.production'`.

## 2. Bring up the data plane (self-host)

Order matters: `storage` must be up before `migrate` — storage-api creates the
`storage.*` schema on boot and an early migration writes into `storage.buckets`.
The `migrate` service already `depends_on` postgres + storage healthchecks, so
the one command below sequences correctly:

```bash
dc --profile data up -d postgres storage   # postgres + storage bootstrap
dc --profile data run --rm migrate         # ~750 migrations (gated on storage healthy)
dc --profile data up -d                     # gotrue, kong, redis, inngest, …
```

Sanity check the schema:

```bash
dc --profile data exec postgres psql -U postgres -c '\dt public.*' | head
```

Seed an initial company/admin (optional):

```bash
dc --profile data run --rm \
  -e SUPABASE_URL=http://kong:8000 \
  -w /repo/packages/database migrate \
  sh -c "pnpm db:seed"
```

## 3. Bring up the apps

```bash
dc up -d --build erp mes caddy
dc logs -f caddy                         # watch cert issuance
curl -fsS https://$ERP_HOST/health       # -> 200 JSON
curl -fsS https://$MES_HOST/health       # -> 200 JSON
dc logs inngest                          # both apps synced
```

## Managed backends (apps-only)

Skip the `data` profile. In `.env.production` point `SUPABASE_URL` /
`SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_DB_URL` /
`REDIS_URL` / `INNGEST_*` at your managed services, then:

```bash
dc up -d --build erp mes caddy
```

Apply migrations against the managed DB with your existing
`supabase db push` flow (see `packages/database`).

## Operating

- **Studio** (DB admin) is bound to `127.0.0.1:${STUDIO_PORT:-3900}` only —
  reach it with `ssh -L 3900:localhost:3900 host`.
- **Postgres / Kong are not published** — only Caddy's 80/443 are public.
- **Updates**: `dc up -d --build erp mes` rebuilds + rolls the apps; run
  `dc --profile data run --rm migrate` first if the release adds migrations.
- **Backups**: snapshot the `pgdata` and `storage` volumes.

## Notes

- **ERP requires `RESEND_API_KEY`** — it builds the Resend client at boot and
  crashes if empty. Use a real key or a non-empty placeholder. MES has no such
  requirement.
- **`INNGEST_SIGNING_KEY` must be plain hex** (`openssl rand -hex 32`); the
  self-hosted inngest server rejects the `signkey-…` prefixed form.
- **`SUPABASE_DB_URL` needs `?sslmode=disable`** for the self-hosted postgres
  (it runs without TLS). The `migrate` one-shot sets `PGSSLMODE=disable` for the
  same reason (the supabase CLI honors the env var reliably, the URL param not).
- **`studio` may report `unhealthy`** — its image healthcheck expects the
  Supabase analytics service, which this stack omits. The UI still works; ignore
  it or drop the `studio` service if unwanted.
- `VERIFY_JWT=false` on edge-runtime mirrors dev; Kong fronts the functions.
  Tighten to `true` if you call functions only with valid JWTs.
- `realtime` `SECRET_KEY_BASE` / `DB_ENC_KEY` are internal-only; override
  `REALTIME_SECRET_KEY_BASE` in env for extra hygiene.
