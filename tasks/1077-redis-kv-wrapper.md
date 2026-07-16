# Task Brief: Issue #1077 — Redis resilience: wrapper + tests in @carbon/kv (foundation)

## Date
2026-07-06

## Parent Epic
#1076 — Redis downtime kills the entire app (critical resilience vulnerability)

## Issue
https://github.com/crbnos/carbon/issues/1077

## Context
The Carbon app has a single global ioredis client in `packages/kv/src/client.ts`. Currently, almost every consumer awaits Redis commands with no try/catch and no fallback. When Redis is unreachable, rejected promises propagate up and cause full application outages.

This PR is the **foundation** only — no consumer migrations. Build the resilient wrapper in `@carbon/kv`, then stop.

## What to Build

### 1. `withRedis<T>` helper in `packages/kv/src/client.ts`
```typescript
withRedis<T>(fn: (client: Redis) => Promise<T>, fallback: T): Promise<T>
```
- Wraps any Redis command with a per-call timeout (~500ms)
- Catches ALL connection/command errors (ECONNREFUSED, command timeouts, ioredis offline-queue full)
- Returns `fallback` on any error — NEVER throws
- Logs degraded state on first failure + recovery when Redis reconnects (debounced, not per-request)
- Does NOT change `enableOfflineQueue` / `retryStrategy` defaults

### 2. Convenience wrappers (also in `packages/kv/src/client.ts`)
- `safeGet(key: string): Promise<string | null>`
- `safeSet(key: string, value: string, options?: SetOptions): Promise<void>`
- `safeDel(key: string): Promise<void>`
- All using `withRedis` internally, typed defaults on failure

### 3. Export from `packages/kv/src/index.ts`
- Export `withRedis`, `safeGet`, `safeSet`, `safeDel`

### 4. Unit tests with ioredis-mock
Check if `packages/kv` has existing test setup first. Use `ioredis-mock` (per `packages/kv` conventions if it exists, else add it as a dev dependency).

Tests must cover:
- Normal path: returns real data from Redis
- Redis-down: mock throws on command → function returns fallback, no unhandled rejection
- Recovery: subsequent call succeeds after mock is restored

## Acceptance Criteria (from issue)
- `withRedis` exported from `packages/kv/src/index.ts`; convenience wrappers exported alongside
- No caller can trigger an unhandled rejection via `withRedis`/`safeGet`/`safeSet`/`safeDel`
- Unit tests pass with `ioredis-mock`: normal path, Redis-down fallback, recovery
- TypeScript and biome clean
- No changes to existing consumer call sites in this PR (foundation only)

## Out of Scope
- Consumer migration (that's #1078–#1081)
- Health endpoint
- Any changes outside `packages/kv`

## Important Notes
- Repo: `/home/openclaw/carbon`
- Package manager: `pnpm` (NEVER npm)
- Git identity: Carbon Agent / support@carbon.ms
- Always use ABSOLUTE paths for binding and --cwd args
- Run `git fetch origin main && git merge origin/main` before starting in the worktree
- Conductor skill: `.ai/skills/conductor/SKILL.md`
- Binding path: `/home/openclaw/carbon/.ai/runs/1077/binding.loop.md`
- Worktree: use `crbn new loop/1077 --base origin/main --yes`
- Use `--doer-budget 8` for the harness (touches 2-3 files, has tests)

## Procedure
Follow the conductor skill at `.ai/skills/conductor/SKILL.md`.

1. Create worktree: `crbn new loop/1077 --base origin/main --yes`
2. cd into worktree, `git merge origin/main`
3. Write binding to `/home/openclaw/carbon/.ai/runs/1077/binding.loop.md`
4. Validate binding with harness parseBinding
5. Dispatch: `crbn up --minimal --run 'pnpm --filter @carbon/harness loop /home/openclaw/carbon/.ai/runs/1077/binding.loop.md --cwd <abs-worktree-path>' --volumes`
6. Read outcome.json
7. If shipped: open PR with `gh pr create`, post results on issue, drop agent:working label
8. If blocked: label agent:blocked, post diagnostics

After dispatch, commit artifacts to main:
```bash
cd /home/openclaw/carbon
git add .ai/runs/1077/binding.loop.md .ai/runs/1077/ledger.jsonl .ai/runs/1077/outcome.json
git diff --cached --quiet || git commit -m "chore(runs): persist loop artifacts for #1077"
git push origin main
```
