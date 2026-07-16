# Task Brief: Issue #1081 — Redis resilience: health endpoint + observability

## Issue
https://github.com/crbnos/carbon/issues/1081

## Context
PR #1083 (merged) adds `withResilience()` in `packages/kv/src/resilient.ts`. It already emits throttled `console.warn` on Redis unavailability and `console.info` on reconnect via `logUnavailable`/`logReconnected`. Build on top of this.

## What to build

### 1. Health endpoint
- Add or extend a `/health` route in `apps/erp`
- Response: `{ status: 'healthy' | 'degraded', redis: 'up' | 'down' }` (JSON)
- Check Redis with `redis.ping()` from `@carbon/kv` — the resilience wrapper returns `null` on failure, so null = down
- Return HTTP 200 in both cases
- The wrapper's `REDIS_TIMEOUT_MS` (2s) handles timeout — no extra logic needed

### 2. Structured degraded-state logging
- Promote existing `logUnavailable`/`logReconnected` in `packages/kv/src/resilient.ts` to emit structured log events:
  - Degraded: `{ event: 'redis.degraded', message: '...' }`
  - Recovered: `{ event: 'redis.recovered' }`
- Already throttled — keep that behavior

## Acceptance Criteria
- `GET /health` returns `{ status: 'healthy', redis: 'up' }` when Redis is running
- `GET /health` returns `{ status: 'degraded', redis: 'down' }` (HTTP 200) when Redis is stopped
- Within 30s of Redis restart, returns healthy again with no app restart
- Structured log emitted on entering and leaving degraded mode (not one per failed command)
- Unit test: mock `redis.ping()` → null → endpoint returns degraded; mock recovery → returns healthy
- TypeScript and biome clean

## Repo
/home/openclaw/carbon

## Output
Open a PR against main. Close issue #1081 from the PR body.
