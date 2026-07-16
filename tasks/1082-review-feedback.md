# Task Brief: PR #1082 — Transparent Redis resilience (Brad feedback)

## Context

PR #1082 (`loop/1077`): Redis resilience wrapper in `@carbon/kv`.

Brad's feedback (2026-07-06 02:59 UTC): "Is it possible to maintain the same API — but to make it safe without thinking about it?"

The current implementation adds `safeGet`/`safeSet`/`safeDel` helpers that consumers must explicitly adopt. Brad wants the existing `redis.get()`, `redis.set()`, `redis.del()` etc. to be safe transparently — callers don't change anything, the client itself degrades gracefully.

## Current state of the branch

Branch: `loop/1077`
Worktree does NOT exist locally — it was torn down after the PR was opened. You will need to check out a new worktree.

Current `packages/kv/src/client.ts` exports:
- `default redis` — raw ioredis client (unsafe)
- `withRedis<T>(fn, fallback)` — escape hatch for custom ops
- `safeGet(key)`, `safeSet(key, value, opts?)`, `safeDel(key)` — manual wrappers

Brad wants: `import redis from '@carbon/kv'` → every redis command call silently returns a sane default when Redis is unreachable, instead of throwing.

## What to build

**Redesign `packages/kv/src/client.ts` to export a transparent resilient proxy:**

1. **Create a `createSafeRedis(client: Redis)` function** that returns a `Proxy<Redis>` which intercepts every method call:
   - For methods that return data (get, hget, hgetall, lrange, smembers, etc.) → wrap with 500ms timeout + return `null` (or appropriate empty value) on failure
   - For write commands (set, setex, del, hset, hdel, lpush, sadd, etc.) → wrap with 500ms timeout + swallow error (return 0 / undefined / "OK" as appropriate for the type)
   - For `pipeline()` and `multi()` → return a safe no-op pipeline if Redis is down
   - Keep the debounced logDegraded/logRecovered pattern (emit at most once per 10s)

2. **The default export becomes the safe proxy** — same `redis` import, same call style, zero migration needed:
   ```ts
   import redis from '@carbon/kv'
   // These just work safely:
   const val = await redis.get('key')   // null if Redis down
   await redis.set('key', 'value')       // silently no-ops if Redis down
   await redis.del('key')                // silently no-ops if Redis down
   ```

3. **Keep `withRedis` as a lower-level escape hatch** for complex ops that need explicit fallback values.

4. **Remove `safeGet`/`safeSet`/`safeDel`** — they're no longer needed. Update index.ts exports accordingly.

5. **Update the test suite** in `packages/kv/src/client.test.ts`:
   - Tests should call `redis.get()`, `redis.set()`, `redis.del()` directly on the proxy
   - Verify that when ioredis-mock is configured to simulate failure, these calls return null/undefined instead of throwing
   - Verify that when Redis is healthy, they return the expected values
   - Verify the debounced logging behavior (logDegraded once per 10s, logRecovered on first success after failure)

## Constraints

- TypeScript strict — all types must pass `pnpm --filter @carbon/kv typecheck`
- The Proxy must preserve the TypeScript type: `createSafeRedis(redis: Redis): Redis`
- All existing tests must pass or be updated
- `pnpm --filter @carbon/kv test` must pass
- No `npm` — always `pnpm`

## How to work on the existing PR branch

```bash
# From /home/openclaw/carbon
git fetch origin loop/1077
# Create a new worktree for the branch
crbn new loop/1077 --base origin/loop/1077 --yes
# OR if crbn new doesn't support that, do:
# git worktree add /home/openclaw/carbon-loop-1077 loop/1077
cd /home/openclaw/carbon-loop-1077   # (or whatever path crbn prints)
git fetch origin main && git merge origin/main
```

Then make the changes, commit, and push to `loop/1077`. The PR (#1082) will update automatically.

## What to return

After pushing:
1. Run `pnpm --filter @carbon/kv test` and confirm it passes
2. Run `pnpm --filter @carbon/kv typecheck` and confirm clean
3. Output a summary of what was changed
4. Do NOT open a new PR — push to the existing `loop/1077` branch

## Files to edit

- `packages/kv/src/client.ts` — main redesign
- `packages/kv/src/index.ts` — update exports (remove safeGet/safeSet/safeDel)
- `packages/kv/src/client.test.ts` — update tests
