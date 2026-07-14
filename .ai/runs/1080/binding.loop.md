---
id: "1080"
issue: 1080
kind: bug
risk: low
title: "Redis resilience: migrate remaining cache consumers (printing, ERP server files)"
acceptance:
  - "Grep confirms no raw import of ioredis outside packages/kv/ — all consumers go through @carbon/kv"
  - "packages/printing/src/cache.server.ts: cache reads treat null as a miss; writes don't throw"
  - "apps/erp/app/modules/shared/*.server.ts: Redis null returns handled as cache miss"
  - "apps/erp/app/modules/settings/*.server.ts: Redis null returns handled as cache miss"
  - "apps/erp/app/modules/users/*.server.ts: Redis null returns handled as cache miss"
  - "apps/erp/app/routes/api+/docs.ts: Redis null returns handled as cache miss"
  - "TypeScript clean: pnpm --filter @carbon/printing typecheck and relevant ERP packages"
  - "Biome lint clean"
---

## Context

PR #1083 (merged to main) wraps the `@carbon/kv` Redis client at the Proxy level via `withResilience()` in `packages/kv/src/resilient.ts`. All consumers that import `redis` from `@carbon/kv` automatically get fail-soft behavior — reads resolve `null` (collections `[]`), writes resolve `null`, no thrown errors. The resilience is handled at the wrapper level; per-call-site try/catch for connectivity is NOT needed.

## Task

Audit and harden the remaining cache consumers (non-auth, non-rate-limit):

1. Grep for `import.*ioredis` in all app/package code outside `packages/kv/` — any such import bypasses the resilience wrapper and must be changed to use `import { redis } from "@carbon/kv"` instead.

2. For each consumer file:
   - `packages/printing/src/cache.server.ts`
   - `apps/erp/app/modules/shared/*.server.ts`
   - `apps/erp/app/modules/settings/*.server.ts`
   - `apps/erp/app/modules/users/*.server.ts`
   - `apps/erp/app/routes/api+/docs.ts`
   
   Check: does the code assume `redis.get()` returns a non-null value? If it does (e.g. JSON.parse without null guard, destructuring without null check), fix it to treat `null` as a cache miss and fall through to the source of truth.

3. Do NOT add try/catch for Redis connectivity — that's already handled by the wrapper.

4. Run typecheck and lint; ensure clean.

5. Open a PR against main. Close issue #1080 from the PR body ("Closes #1080").
