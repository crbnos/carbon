# @carbon/kv

Redis client (ioredis) and rate limiting library. Used for permission caching, login rate limiting, and general key-value storage.

## Always

- Import the singleton Redis client via `import { redis } from "@carbon/kv"` — it's a global singleton with lazy connect and retry logic.
- The singleton is **resilience-wrapped** (`src/resilient.ts`): Redis is a cache, never the source of truth, so when it's unreachable commands **fail soft instead of throwing** — a read resolves `null` (a collection resolves `[]`), a write resolves `null`, and a pipeline `.exec()` resolves `[]`. Just `await redis.get(...)` normally; treat `null` as a cache miss and read through to the DB. Do **not** wrap call sites in try/catch for connectivity — that's already handled. Each command also has a `REDIS_TIMEOUT_MS` cap so a hung Redis can't stall a request.
- Use `Ratelimit` class with static factory methods: `Ratelimit.fixedWindow()`, `Ratelimit.slidingWindow()`, or `Ratelimit.tokenBucket()`. When Redis is down `Ratelimit.limit()` **fails open** (returns `success: true`) — a cache outage never blocks auth.
- Handle rate limit responses: check `response.success` — caller is responsible for returning 429 when `!success`.
- Requires `REDIS_URL` env var — throws at import if not set.

## Ask First

- Changing Redis connection config (retry strategy, `maxRetriesPerRequest`, `lazyConnect`) — affects all Redis consumers.
- Adding new rate limiting algorithms or modifying Lua scripts (`scripts.ts`).

## Never

- Create additional Redis client instances — use the global singleton to avoid connection pool exhaustion.
- Store large blobs in Redis — it's for caching, rate limiting, and small state only.

## Validation Commands

```bash
pnpm --filter @carbon/kv test        # Runs ratelimit + cache tests (uses ioredis-mock)
pnpm --filter @carbon/kv typecheck
```

## Key Exports

| Export | Provides |
|--------|----------|
| `redis` | Global ioredis singleton (lazy connect, 3 retries, offline queue), resilience-wrapped to fail soft when Redis is unreachable |
| `Ratelimit` | Rate limiter class with `limit()`, `blockUntilReady()`, `getRemaining()`, `resetUsedTokens()` |
| `Ratelimit.fixedWindow(tokens, window)` | Fixed window algorithm (simple, low memory) |
| `Ratelimit.slidingWindow(tokens, window)` | Sliding window (smoother, prevents boundary bursts) |
| `Ratelimit.tokenBucket(refillRate, interval, maxTokens?)` | Token bucket (allows controlled bursts) |
| `Duration` type | Time duration strings like `"10 s"`, `"1 m"`, `"1 h"` |

## Cross-References

- `packages/auth/` — uses Redis for permission claim caching (`permissions:${userId}` keys)
- `packages/database/src/ratelimit.ts` — separate API key rate limiting via Postgres RPC (not Redis)
- `packages/env/` — provides `REDIS_URL`
