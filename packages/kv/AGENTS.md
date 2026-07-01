# @carbon/kv

Redis client (ioredis) and rate limiting library. Used for permission caching, login rate limiting, and general key-value storage.

## Always

- Import the singleton Redis client via `import { redis } from "@carbon/kv"` — it's a global singleton with lazy connect and retry logic.
- Use `Ratelimit` class with static factory methods: `Ratelimit.fixedWindow()`, `Ratelimit.slidingWindow()`, or `Ratelimit.tokenBucket()`.
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
| `redis` | Global ioredis singleton (lazy connect, 3 retries, offline queue) |
| `Ratelimit` | Rate limiter class with `limit()`, `blockUntilReady()`, `getRemaining()`, `resetUsedTokens()` |
| `Ratelimit.fixedWindow(tokens, window)` | Fixed window algorithm (simple, low memory) |
| `Ratelimit.slidingWindow(tokens, window)` | Sliding window (smoother, prevents boundary bursts) |
| `Ratelimit.tokenBucket(refillRate, interval, maxTokens?)` | Token bucket (allows controlled bursts) |
| `Duration` type | Time duration strings like `"10 s"`, `"1 m"`, `"1 h"` |

## Cross-References

- `packages/auth/` — uses Redis for permission claim caching (`permissions:${userId}` keys)
- `packages/database/src/ratelimit.ts` — separate API key rate limiting via Postgres RPC (not Redis)
- `packages/env/` — provides `REDIS_URL`
