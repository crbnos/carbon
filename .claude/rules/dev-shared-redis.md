---
description: How Redis is configured, shared in dev, and consumed across Carbon
paths:
  - packages/kv/**
  - packages/dev/**
  - packages/env/src/index.ts
  - packages/dev/docker/docker-compose.dev.yml
---

# Dev shared Redis

Redis is a `crbn-shared` service, with Postgres, PgBouncer, Storage, imgproxy
and Inbucket: see [dev-shared-services.md](dev-shared-services.md).

## Client (`@carbon/kv`)

- Library is **`ioredis`** (`packages/kv/package.json`; `ioredis-mock` for tests).
- Single global singleton in **`packages/kv/src/client.ts`**: `new Redis(REDIS_URL, ...)`
  stashed on `global.__redis` (survives HMR / warm lambdas). Options:
  `maxRetriesPerRequest: 3`, `lazyConnect: true`, `enableOfflineQueue: true`,
  and a `retryStrategy` that reconnects forever with capped backoff
  (`min(times * 200, 5000)`) so the client auto-recovers when Redis returns —
  per-command latency is bounded by `maxRetriesPerRequest` + the resilience-layer
  timeout, not by giving up on reconnection. Throws if `REDIS_URL` is unset.
- Exported as `{ redis }` from `packages/kv/src/index.ts`, which also exports the
  `Ratelimit` class (a custom ioredis-backed reimplementation of the
  `@upstash/ratelimit` API using Lua `eval` scripts — see `packages/kv/src/ratelimit/`).
- **Resilience wrapper** (`packages/kv/src/resilient.ts`): the singleton is
  passed through `withResilience()`, a Proxy that makes every command fail soft
  when Redis is unreachable — reads resolve `null` (collections `[]`), writes
  resolve `null`, and `pipeline().exec()` resolves `[]`, each with a
  `REDIS_TIMEOUT_MS` cap. Consumers keep the ordinary ioredis API and need no
  per-call try/catch; a `null` read is just a cache miss → read through to the DB.
  `Ratelimit.limit()` fails open (`success: true`) on any Redis error. This is the
  fix for a Redis outage no longer taking down requests (issue #1076).

## Connection config

- **One env var: `REDIS_URL`** — a full `redis://host:port/db` URL. Required +
  secret (`packages/env/src/index.ts`, `getEnv("REDIS_URL", { isRequired: true, isSecret: true })`).
  There is **no** `REDIS_HOST`/`PORT`/`PASSWORD` split and no in-code default.

## Dev: one shared container, per-worktree logical DB

Dev uses a **single `redis:7-alpine` container per host**, reused across all
worktrees; each worktree is isolated by a **logical DB index (0–24)**, not its
own container.

- **The `redis` service of `crbn-shared`** (`packages/dev/docker/docker-compose.shared.yml`):
  container **`carbon-redis`**, `127.0.0.1:6379`, `restart: on-failure` (like
  every compose service, it comes back with the next `crbn up`, not with
  Docker), healthcheck `redis-cli ping`, `redis-server --appendonly yes
  --databases ${REDIS_DATABASES}`. The volume `carbon-redis-data` is `external`:
  it predates the compose file, and `ensureRedisVolume` creates it.
- **Boot** (`packages/dev/src/services/compose.ts`): shared mode starts it with
  the rest (`bootSharedServices`); isolated mode starts it alone
  (`bootSharedForIsolated`: `up -d --wait --no-deps redis edge-runtime`). Both run `prepareShared`,
  which writes `REDIS_DATABASES=redisDatabasesNeeded(slots)` to
  `~/.carbon/shared/.env`: the pool, or one past a higher index a slot still
  holds. A new count makes compose recreate only redis; the AOF keeps the keys.
- **Move from `docker run`**: crbn before this ran `carbon-redis` with
  `docker run`. `removeStandaloneRedis` stops (so redis flushes its AOF) and
  removes a `carbon-redis` without the `crbn-shared` label; compose then starts
  its own on the same volume. A running `crbn-shared` whose file has no `redis`
  service gets the new file (`missingSharedServices`); compose creates only redis.
  The container and volume names are `SHARED_CONTAINERS.redis` and
  `SHARED_REDIS_VOLUME` in `packages/dev/src/topology.ts`.
- `SHARED_REDIS_PORT = 6379` and `REDIS_DB_MAX = 25` live in
  `packages/dev/src/topology.ts` (`topology.test.ts` checks them against the
  compose file); `pickRedisDb` (`worktree.ts`) allocates a free DB index per
  worktree. A slot keeps its index until `crbn down --purge`, `crbn remove`, or
  `crbn prune` (folder gone) releases it.
- Wired into `crbn up` at `packages/dev/src/commands/up.ts` ("Boot shared
  containers", or "Boot shared redis" in isolated mode).
- `crbn prune --all` flushes the slots' databases before it stops `crbn-shared`.
- **Redis does not come back with Docker.** `restart: on-failure` restarts a
  crash only; after a Docker restart Redis is down until a `crbn up`. The apps
  keep working (`@carbon/kv` fails soft). `flushDb` starts it
  (`startSharedRedis`: `up -d --wait --no-deps redis`) before it flushes: the
  slot is released next, and the worktree that gets the index would otherwise
  read the old keys, cached permissions included, since every worktree's
  database is cloned from the same template users. A flush that still fails
  warns with the command to run.
- The env writer `packages/dev/src/env.ts` emits
  `REDIS_URL=redis://localhost:${SHARED_REDIS_PORT}/${redisDb}` — so dev apps
  connect to **`localhost:6379`** at the worktree's DB index.
- A teardown that wipes data (`crbn down --volumes` / `--purge`, `crbn reset`,
  `crbn remove`, `crbn up --run --volumes`) flushes only that worktree's DB via
  `flushDb(db)` → `docker exec carbon-redis redis-cli -n <db> FLUSHDB`
  (`teardown.ts` → `compose.ts`).

## Consumers

Two patterns: the shared `redis` client (caching / TTL state) and the
`Ratelimit` class (sliding-window). Notable uses:

- **Permissions cache** — user claims, keyed via `getPermissionCacheKey(userId)`
  (`packages/auth/src/services/users.ts`; invalidated in the ERP users module,
  on logout, invite/company creation, and the `update-permissions` Inngest job).
- **Rate limiting** — login/verify (ERP, MES, academy, starter), docs API,
  shared-customer-file downloads.
- **Auth TTL state** — WebAuthn passkey challenges, email verification codes
  (`packages/auth/src/services/passkey.server.ts`, `verification.server.ts`).
- **Settings / schema caches** (`apps/erp/.../settings.service.ts`,
  `shared.service.ts`), **printer config** (`packages/printing/src/cache.server.ts`),
  **Stripe** (`packages/stripe/src/stripe.server.ts`), **Slack EE** mapping.

## Prod (for contrast)

The self-hosted Swarm stack (`contrib/deploying/simple-docker-caddy/docker-compose.prod.yml`,
see [contrib-deployment-swarm.md](contrib-deployment-swarm.md)) runs a real `redis`
service (`redis:7-alpine`, `redis-server --appendonly yes`, no published host port
— reachable internally at `redis:6379`); the apps set `REDIS_URL=redis://redis:6379`.
Managed/cloud deployments override `REDIS_URL` with an external URL.

## Gotchas

- `getPermissionCacheKey` is duplicated (`@carbon/auth` and the ERP users module).
  Both produce the same key today but could drift.
- An old root `docker-compose.yml` once held redis and used volume
  `carbon-shared_redis-data`; that path is gone — current volume is
  `carbon-redis-data`. Any old volume is orphaned but harmless (dev redis is cache).
