# Review Feedback Task — Issue #1061, PR #1090

## Context
PR #1090 (`loop/1061`) — Avalara integration foundation. CodeRabbit just posted review with 4 actionable comments (2 Major, 2 Minor). No human reviewer comments yet.

Worktree: `/home/openclaw/carbon-loop-1061`
Branch: `loop/1061`

## Pre-work
Before writing any code:
1. `cd /home/openclaw/carbon-loop-1061`
2. `git fetch origin main && git merge origin/main` (to incorporate recent merges)
3. Read relevant source files before touching them

## Actionable Items

### 1. [MAJOR] Bearer-token fetch bypasses retry loop — `packages/ee/src/avalara/lib/client.ts` ~line 236

**Problem:** `authHeaders()` (which calls `getBearerToken()`) is called *before* the retry loop in `request()`. If this call throws an `AvalaraError` (even one marked `retryable: true`), the retry logic is never reached — the error escapes immediately.

**Fix:** Move auth header retrieval into the retry loop, or add a retry wrapper around `authHeaders()` inside `request()`, so transient token-fetch failures are retried with the same backoff. Keep the existing `request()`, `authHeaders()`, and `getBearerToken()` flow otherwise unchanged.

### 2. [MAJOR] Retry logic too broad in createTransaction — `packages/ee/src/avalara/lib/avatax.ts` ~line 91

**Problem:** The retry condition `retryable: body.commit !== true` still allows non-idempotent `create` calls to be retried when no stable `code` is provided. Retrying a `CreateTransaction` without a code can duplicate transactions in AvaTax.

**Fix:** Update the retry condition in `createTransaction` so it only retries safe estimate-style requests — e.g. when `body.commit !== true` AND `body.code` is present (stable idempotency key). Keep `commit=true` calls non-retryable. Use the existing `createTransaction` method and `body.commit`/`body.code` fields.

### 3. [MINOR/correctness] listAvalaraCompanies ignores row.error — `packages/ee/src/avalara/service.server.ts` ~line 162

**Problem:** Unlike `readInstalledConfig` (which checks `row.error` before reading data), `listAvalaraCompanies` ignores `row.error` and silently defaults to sandbox when the DB lookup fails.

**Fix:** Check `row.error` before reading `row.data?.metadata`. Return a typed failure (similar to `readInstalledConfig` pattern) if there's a DB error, instead of proceeding with a default. The environment selection and `AvataxApi/listCompanies` call should only happen after a successful lookup.

### 4. [MINOR/correctness] integrations.$id.tsx silently swallows listAvalaraCompanies error — `apps/erp/app/routes/x+/settings+/integrations.$id.tsx` ~line 123

**Problem:** Only `data` is destructured from `listAvalaraCompanies`; the returned `error` field is discarded. Config/auth failures fall back to an empty `avalaraCompanyOptions` array silently.

**Fix:** Destructure and inspect the `error` field from `listAvalaraCompanies`. Log the error (using `console.error` or similar) before falling back to `[]`, similar to how `api+/integrations.avalara.companies.ts` handles `listError`.

## Nitpick Items (SKIP — do not implement)
- Duplicate `AvalaraHttp` construction in `hooks.server.ts` — Trivial, skip
- Silent failure logging in `avalaraOnInstall` — Trivial, skip

## PR Reply Flow
After pushing the fix commit, reply to each inline review comment thread with a brief acknowledgment + what was done. Use `gh api` to reply to the comment IDs:
- Comment ID 3528888723 (integrations.$id.tsx)
- Comment ID 3528888748 (avatax.ts)  
- Comment ID 3528888761 (client.ts)
- Comment ID 3528888779 (service.server.ts)

Also post a summary comment on the PR:
```
gh pr comment 1090 --body "Pushed <commit> addressing the CodeRabbit review:

- **Bearer-token retry bypass (Major):** auth header retrieval moved inside the retry loop in `request()` so transient token-fetch errors get backoff treatment
- **createTransaction retry safety (Major):** retry now requires both `commit !== true` AND a stable `body.code` (idempotency key); uncommitted codeless creates are non-retryable to prevent duplicate transactions
- **listAvalaraCompanies DB error (Minor):** `row.error` is now checked before reading metadata, returns typed failure instead of silently defaulting to sandbox
- **integrations.$id.tsx error swallowing (Minor):** `error` from `listAvalaraCompanies` is now inspected and logged before falling back to `[]`

Gates: @carbon/ee typecheck ✓, @carbon/ee test ✓, erp typecheck ✓, biome ✓"
```

## Gates to verify before pushing
```bash
cd /home/openclaw/carbon-loop-1061
pnpm --filter @carbon/ee typecheck 2>&1 | tail -5
pnpm --filter @carbon/ee test run 2>&1 | tail -10
pnpm --filter carbon typecheck 2>&1 | tail -5
pnpm exec biome check packages/ee/src/avalara/ apps/erp/app/routes/x+/settings+/ 2>&1 | tail -5
```
