---
description: How Redis is configured, shared in dev, and consumed across Carbon
paths:
  - packages/kv/**
  - packages/dev/**
  - packages/env/src/index.ts
  - packages/dev/docker/docker-compose.dev.yml
---

# Dev shared Redis

## Client (`@carbon/kv`)

- Library is **`ioredis`** (`packages/kv/package.json`; `ioredis-mock` for tests).
- Single global singleton in **`packages/kv/src/client.ts`**: `new Redis(REDIS_URL, ...)`
  stashed on `global.__redis` (survives HMR / warm lambdas). Options:
  `maxRetriesPerRequest: 3`, `lazyConnect: true`, `enableOfflineQueue: true`,
  capped `retryStrategy` (stop after 3). Throws if `REDIS_URL` is unset.
- Exported as `{ redis }` from `packages/kv/src/index.ts`, which also exports the
  `Ratelimit` class (a custom ioredis-backed reimplementation of the
  `@upstash/ratelimit` API using Lua `eval` scripts — see `packages/kv/src/ratelimit/`).

## Connection config

- **One env var: `REDIS_URL`** — a full `redis://host:port/db` URL. Required +
  secret (`packages/env/src/index.ts`, `getEnv("REDIS_URL", { isRequired: true, isSecret: true })`).
  There is **no** `REDIS_HOST`/`PORT`/`PASSWORD` split and no in-code default.

## Dev: one shared container, per-worktree logical DB

Dev uses a **single `redis:7-alpine` container per host**, reused across all
worktrees; each worktree is isolated by a **logical DB index (0–15)**, not its
own container.

- **Not a compose service.** `packages/dev/docker/docker-compose.dev.yml`
  (the per-worktree Supabase + inngest stack) explicitly documents redis's
  absence (~line 238). The dev CLI boots redis directly.
- **`bootSharedRedis()`** in `packages/dev/src/services/compose.ts` does
  `docker run` of container **`carbon-redis`** (volume `carbon-redis-data`,
  `-p ${SHARED_REDIS_PORT}:6379`, `--restart unless-stopped`, healthcheck
  `redis-cli ping`, `redis-server --appendonly yes`). Idempotent: reuse running,
  start stopped, else recreate. Constants `REDIS_CONTAINER` / `REDIS_VOLUME` are
  at the top of that file.
- `SHARED_REDIS_PORT = 6379` and `REDIS_DB_MAX = 16` live in
  `packages/dev/src/worktree.ts`; `pickRedisDb` allocates a free DB index per
  worktree.
- Wired into `crbn up` at `packages/dev/src/commands/up.ts` ("shared redis" task).
- The env writer `packages/dev/src/env.ts` emits
  `REDIS_URL=redis://localhost:${SHARED_REDIS_PORT}/${redisDb}` — so dev apps
  connect to **`localhost:6379`** at the worktree's DB index.
- `crbn reset` / `crbn remove` flush only that worktree's DB via
  `flushDb(db)` → `docker exec carbon-redis redis-cli -n <db> FLUSHDB`
  (`compose.ts`).

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
- **Settings / schema caches** (`apps/erp/.../settings.server.ts`,
  `shared.server.ts`), **printer config** (`packages/printing/src/cache.server.ts`),
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
