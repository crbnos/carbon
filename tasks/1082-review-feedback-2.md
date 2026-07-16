# Task: Fix PR #1082 CodeRabbit Minor correctness issues

## Context

PR #1082 (`loop/1077`) is open on branch `loop/1077`. It's the transparent Redis resilience proxy for `@carbon/kv`. The proxy wrapped the latest commit `c7f43ec956d3e9f0e897052cfa44cb8520ff2294`. Two Minor correctness issues from CodeRabbit's latest round (03:42 UTC) need fixing.

## Repo path

`/home/openclaw/carbon`

## Branch

`loop/1077` — re-enter on this branch, merge origin/main first.

## Issue 1 — spop/srandmember wrong fallback shape (line 110-111 in client.ts)

`spop` and `srandmember` without a count argument return `string | null` (a single member), not an array. They are currently in `ARRAY_REPLY` which gives them `[]` as fallback — wrong for the no-count form.

**Fix:** Remove `spop` and `srandmember` from `ARRAY_REPLY`. Since these commands are overloaded (no-count → scalar, count → array), the proxy needs to inspect the argument count at call time:
- `spop(key)` → fallback `null`
- `spop(key, count)` → fallback `[]`
- `srandmember(key)` → fallback `null`
- `srandmember(key, count)` → fallback `[]`
\nImplement this inside the proxy's `get` trap for these two commands specifically: check `args.length` (or `args[1]` presence) to pick the right fallback shape.

## Issue 2 — Blocking commands bypassed by 500ms timeout (line 293-298 in client.ts)

`blpop`, `brpop`, `blmove`, `brpoplpush`, `bzpopmin`, `bzpopmax`, `xread`, `xreadgroup` are blocking Redis commands — they're designed to wait indefinitely (or up to their own `BLOCK` timeout) for data. Forcing them through `runSafe` with a 500ms timeout makes them useless: they always return the fallback instead of blocking as intended.

`WAIT` (already in `INTEGER_REPLY`) has a similar problem — it's a wait command, not a fire-and-forget.

**Fix:** Add a `BLOCKING_COMMANDS` Set:
```
blpop, brpop, blmove, brpoplpush, bzpopmin, bzpopmax, xread, xreadgroup, wait
```

Route these through `withRedis`/`rawRedis` (the raw client, not the proxy) so they execute unmodified with the real Redis client. No timeout wrapper, no fallback. Document in a JSDoc comment on the set that these pass through to preserve blocking semantics.

Note: The `wait` command was already in `INTEGER_REPLY` — remove it from there when you add it to `BLOCKING_COMMANDS` to avoid double-classification.

## Worktree

The worktree for `loop/1077` was at `/home/openclaw/carbon-loop-1077` — check if it still exists with `git worktree list`. If it does, cd into it, fetch and merge origin/main, then fix and push. If the worktree is gone, recreate it:
```bash
cd /home/openclaw/carbon
git worktree add /home/openclaw/carbon-loop-1077 loop/1077
cd /home/openclaw/carbon-loop-1077
git fetch origin main && git merge origin/main
```

## What to deliver

1. Fix both issues in `packages/kv/src/client.ts`
2. Add/update tests in `packages/kv/src/client.test.ts` for:
   - `redis.spop(key)` → returns `null` on outage (scalar fallback)
   - `redis.spop(key, 2)` → returns `[]` on outage (array fallback)
   - `redis.srandmember(key)` → returns `null` on outage
   - `redis.srandmember(key, 2)` → returns `[]` on outage
   - One blocking command (e.g. `redis.blpop`) passes through to rawRedis (check it's NOT wrapped by runSafe)
3. Run `pnpm --filter @carbon/kv test` — all tests must pass
4. Run typecheck (`pnpm --filter @carbon/kv exec tsc --noEmit`) — must be clean
5. Run biome (`pnpm --filter @carbon/kv exec biome check`) — must be clean
6. Push to `loop/1077` — PR #1082 updates automatically

## Done

Report the commit hash and test counts when complete.
