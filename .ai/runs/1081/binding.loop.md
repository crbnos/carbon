---
id: "1081"
issue: 1081
kind: feature
risk: low
title: "Redis resilience: health endpoint + observability"
acceptance:
  - "GET /health returns { status: 'healthy', redis: 'up' } (HTTP 200) when Redis is running"
  - "GET /health returns { status: 'degraded', redis: 'down' } (HTTP 200) when Redis returns null from ping()"
  - "Health route is unauthenticated — no session or auth cookie required"
  - "packages/kv/src/resilient.ts emits structured { event: 'redis.degraded' } log on transition to unavailable (once per transition, not per command)"
  - "packages/kv/src/resilient.ts emits structured { event: 'redis.recovered' } log on reconnect"
  - "Unit test: mocking redis.ping() -> null returns degraded shape; mocking truthy returns healthy shape"
  - "TypeScript clean: pnpm --filter @carbon/erp tsc --noEmit and pnpm --filter @carbon/kv tsc --noEmit"
  - "Biome lint clean"
---

## Context

PR #1083 (merged to main) added `withResilience()` in `packages/kv/src/resilient.ts`. The wrapper already emits throttled `logUnavailable` / `logReconnected` console calls (one per transition). This issue surfaces that signal via a health endpoint and promotes the log events to structured observability.

`@carbon/kv` exports a `redis` client (check `packages/kv/src/index.ts` for the exact export name). `redis.ping()` returns `'PONG'` when Redis is up, or `null` when the resilience wrapper intercepts a down state.

## Task

### 1. Health endpoint (`apps/erp`)
Add a Remix resource route at `apps/erp/app/routes/health.ts` (or `health.tsx` — resource route, no default component export):
- Import the redis client from `@carbon/kv`
- Call `redis.ping()` — if result is `null` or falsy, Redis is down
- Return `Response.json({ status: 'healthy' | 'degraded', redis: 'up' | 'down' }, { status: 200 })`
- No auth required — this is a probe endpoint for infrastructure health checks
- The `REDIS_TIMEOUT_MS` (2s) from the wrapper is sufficient; no extra timeout logic needed

### 2. Structured logging (`packages/kv/src/resilient.ts`)
Find the existing `logUnavailable` / `logReconnected` inline calls. Update them to emit structured JSON:
- On unavailable transition: `console.error(JSON.stringify({ event: 'redis.degraded', message: 'Redis is unavailable, running in degraded mode' }))`
- On recovery: `console.info(JSON.stringify({ event: 'redis.recovered', message: 'Redis reconnected' }))`
Keep the throttle (one log per transition — already implemented, don't break that).

### 3. Unit test
Add `apps/erp/app/routes/health.test.ts`:
- Mock `@carbon/kv` so `redis.ping` returns `null` → loader returns `{ status: 'degraded', redis: 'down' }`
- Mock `@carbon/kv` so `redis.ping` returns `'PONG'` → loader returns `{ status: 'healthy', redis: 'up' }`

## Proof methods
- AC[1][2][3]: Unit test
- AC[4][5]: Static verification of the updated resilient.ts
- AC[6]: Vitest run for the health test
- AC[7][8]: tsc + biome
