---
id: "1078"
issue: 1078
kind: bug
risk: low
title: "Redis resilience: migrate auth path (getClaims, session, verification, passkey)"
acceptance:
  - "getUserClaims: when redis.get returns null (Redis down), falls through to DB lookup and returns correct claims without throwing"
  - "verifyEmailCode: when Redis returns null, returns false without throwing"
  - "sendVerificationCode: when redis.set returns null/fails, returns false without throwing"
  - "getAndDeleteRegistrationChallenge / getAndDeleteAuthChallenge: returns null without throwing when Redis is down; callers null-guard correctly"
  - "session.server.ts redis.del: no crash when returns null"
  - "Auth service tests cover all 6 Redis-down cases"
  - "TypeScript clean: pnpm --filter @carbon/auth typecheck"
  - "Biome lint clean: pnpm --filter @carbon/auth lint"
  - "Tests pass: pnpm --filter @carbon/auth test"
---

## Context

PR #1083 (merged 2026-07-06) wraps the `@carbon/kv` Redis client at the Proxy level
inside `withResilience()`. All consumers that import `redis` from `@carbon/kv` now get
fail-soft behavior automatically: reads resolve `null`, writes resolve `null`, no thrown
errors. The `client.ts` singleton is already wrapped.

This issue hardens the auth path and adds tests proving Redis-down behavior is safe.

## What to do

### 1. Review and fix null-handling in each auth service

**`packages/auth/src/services/users.server.ts` — `getUserClaims`:**
- The existing code already has a try/catch around `redis.get` and falls back to the DB.
  With `withResilience` in place, the catch block will rarely fire, but null-handling is
  already correct. Keep the try/catch as defense-in-depth.
- The `redis.set` call (caching fresh claims) should be wrapped so a Redis-down condition
  doesn't abort the in-flight request. Move it inside a try/catch if it isn't already.

**`packages/auth/src/services/verification.server.ts`:**
- `sendVerificationCode`: `redis.set` is inside try/catch — return false if it fails
  (verification code unsendable). This is already correct; verify no silent swallow.
- `verifyEmailCode`: `redis.get` returns null (Redis down) → `storedCode` is null →
  `return false`. This blocks verification when Redis is down. That is acceptable and
  expected behavior — document it with a comment.

**`packages/auth/src/services/passkey.server.ts`:**
- `getAndDeleteRegistrationChallenge` and `getAndDeleteAuthChallenge` return null when
  Redis is down. The callers must treat null as an error (challenge not found) and reject
  the passkey flow. Verify the callers do this correctly.
- If any caller uses the returned challenge without a null-guard, add the guard.

**`packages/auth/src/services/session.server.ts`:**
- Only uses `redis.del` (cache invalidation). A null return is benign — no fix needed.
  Add a comment explaining this is intentionally fire-and-forget.

### 2. Add tests

Add `packages/auth/src/services/users.test.ts` and `packages/auth/src/services/auth-redis-resilience.test.ts`
(or combine in a single test file if the harness pattern prefers it) using vitest.

Mock `@carbon/kv` to return null for all Redis ops:
```ts
vi.mock("@carbon/kv", () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(null),
    getdel: vi.fn().mockResolvedValue(null),
  }
}));
```

Required test cases:
1. `getUserClaims` with Redis returning null → falls through to DB lookup → returns
   correct claims (mock the supabase service role call).
2. `sendVerificationCode` with Redis set returning null → function returns false (no crash).
3. `verifyEmailCode` with Redis returning null → returns false (no crash, no unhandled rejection).
4. `getAndDeleteRegistrationChallenge` with Redis returning null → returns null.
5. `getAndDeleteAuthChallenge` with Redis returning null → returns null.
6. `updateCompanySession` with redis.del returning null → no crash (session cookie still returned).

## Acceptance Criteria

- [ ] `getUserClaims`: when `redis.get` returns null (Redis down), function falls through to DB lookup, returns correct claims, no unhandled rejection
- [ ] `verifyEmailCode`: when Redis returns null, returns false without throwing
- [ ] `sendVerificationCode`: when redis.set fails/returns null, returns false without throwing
- [ ] Passkey challenge retrieval (getAndDeleteRegistrationChallenge / getAndDeleteAuthChallenge): returns null without throwing when Redis is down; callers null-guard correctly
- [ ] `session.server.ts` redis.del: no crash when returns null
- [ ] Auth service tests cover all 6 Redis-down cases listed above
- [ ] TypeScript clean (`pnpm --filter @carbon/auth typecheck`)
- [ ] Biome lint clean (`pnpm --filter @carbon/auth lint`)
- [ ] Tests pass (`pnpm --filter @carbon/auth test`)
