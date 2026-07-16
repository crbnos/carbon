# Task Brief: Issue #1080 — Redis resilience: migrate remaining cache consumers

## Issue
https://github.com/crbnos/carbon/issues/1080

## Context
PR #1083 (merged) wraps the `@carbon/kv` Redis client at the Proxy level via `withResilience()`. All consumers that import `redis` from `@carbon/kv` automatically get fail-soft behavior — reads resolve `null` (collections `[]`), writes resolve `null`, no thrown errors. No per-call-site migration is needed UNLESS a consumer assumes non-null and breaks on null.

## What to do
1. Audit each consumer for null-handling correctness:
   - `packages/printing/src/cache.server.ts`
   - `apps/erp/app/modules/shared/*.server.ts`
   - `apps/erp/app/modules/settings/*.server.ts`
   - `apps/erp/app/modules/users/*.server.ts`
   - `apps/erp/app/routes/api+/docs.ts`
2. Grep for any `import.*ioredis` outside `packages/kv/` that bypasses the resilience wrapper — fix those to import through `@carbon/kv` instead.
3. For any consumer that assumes non-null Redis returns: fix the null-handling to treat `null` as a cache miss and fall through to source of truth.
4. Do NOT add try/catch for connectivity — the wrapper already handles that.

## Acceptance Criteria
- Grep confirms no raw `import.*ioredis` in app/packages code outside `packages/kv/` itself
- With Redis stopped, affected features degrade gracefully — no 5xx from these paths
- Any consumer that assumed non-null Redis returns is fixed to treat null as a miss
- TypeScript and biome clean

## Repo
/home/openclaw/carbon

## Output
Open a PR against main. Close issue #1080 from the PR body.
