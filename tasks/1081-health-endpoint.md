# Task: loop/1081 — Redis resilience: health endpoint + observability

**Binding:** /home/openclaw/carbon/.ai/runs/1081/binding.loop.md
**Worktree:** /home/openclaw/carbon-loop-1081
**Issue:** https://github.com/crbnos/carbon/issues/1081

## What to build

### 1. Health endpoint in `apps/erp`
Add a route `apps/erp/app/routes/health.ts` (or `.tsx`) that is a Remix resource route (loader only, no default export component):
- Import `redis` from `@carbon/kv` (check the package's exports — look for `redis` or `getRedisClient()`)
- Call `redis.ping()` — if result is `null` or falsy, Redis is down
- Return `Response.json({ status: 'healthy'|'degraded', redis: 'up'|'down' }, { status: 200 })`
- No auth required — this is a probe endpoint

### 2. Structured logging in `packages/kv/src/resilient.ts`
Find the `logUnavailable` and `logReconnected` call sites. Replace the console calls (or augment) with structured JSON:
- On unavailable: `console.error(JSON.stringify({ event: 'redis.degraded', message: 'Redis is unavailable' }))`
- On reconnect: `console.info(JSON.stringify({ event: 'redis.recovered', message: 'Redis reconnected' }))`
Keep the throttle (one log per transition, not per command).

### 3. Unit tests (Vitest)
Add a test file `apps/erp/app/routes/health.test.ts` (or `packages/kv/src/resilient.test.ts` for observability):
- Mock `@carbon/kv` to have `redis.ping` return `null` → loader returns degraded
- Mock `@carbon/kv` to have `redis.ping` return `'PONG'` → loader returns healthy

## Gates to run
```bash
cd /home/openclaw/carbon-loop-1081
pnpm --filter @carbon/erp tsc --noEmit
pnpm --filter @carbon/kv tsc --noEmit  
pnpm exec biome check apps/erp/app/routes/health.ts packages/kv/src/resilient.ts
# run tests if any are added
pnpm --filter @carbon/erp test 2>/dev/null || true
```

## On completion
When done, open a PR targeting `main` from branch `loop/1081`.
