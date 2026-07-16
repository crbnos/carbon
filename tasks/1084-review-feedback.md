# PR 1084 Review Feedback — Redis resilience: auth path

## Context

PR 1084 (branch: loop/1078) addresses issue #1078 (Redis resilience: migrate auth path).
Worktree: /home/openclaw/carbon-loop-1078
CI: all green ✅. reviewDecision: REVIEW_REQUIRED (awaiting Brad).

CodeRabbit left one **Major** and two **Minor** review comments (posted 2026-07-06T05:09:37Z).

## Actionable Items

### 1. [MAJOR] Add TTL to permission cache write — `packages/auth/src/services/users.server.ts:55`

**CodeRabbit finding:** `redis.set(getPermissionCacheKey(userId), JSON.stringify(claims))` at line 55 writes with no TTL. If `redis.del` during a company switch fails (even silently under `withResilience`), stale permissions persist indefinitely. The session code's TTL-based self-healing assumption breaks.

**Fix:** Add an `EX` TTL to the `redis.set` call. Look at how other Redis writes in the auth package set TTLs (verification codes, sessions) to pick a consistent value. A reasonable TTL is 3600 seconds (1 hour) matching verification codes. The fix:

```ts
await redis.set(getPermissionCacheKey(userId), JSON.stringify(claims), "EX", 3600);
```

Verify the existing constant/enum for TTL values in the auth package (e.g. `VERIFICATION_CODE_TTL` or similar) and reuse it if available. Otherwise add a named constant `PERMISSION_CACHE_TTL_SECONDS = 3600` near the top of the file.

### 2. [MINOR] Stale ledger entry — `.ai/runs/1078/ledger.jsonl` line 10

**CodeRabbit finding:** Line 10 of the ledger still has a blocker note saying `sendVerificationCode` is broken and needs a fix, but the merged fail-closed behavior is already in the PR. Update or drop this entry so the run log matches reality.

**Fix:** Edit `.ai/runs/1078/ledger.jsonl` — find the entry on line ~10 referencing the `sendVerificationCode` blocker and update the `change`/`reason` field to reflect that the fail-closed behavior is now implemented (or remove the blocker language).

### 3. [MINOR] Permission cache invalidation is `await`-ed, making it synchronous — `packages/auth/src/services/session.server.ts:244`

**CodeRabbit finding:** The `await redis.del(...)` at line 244 is blocking the company-switch flow. Since the cache has a TTL now (from fix #1 above), the deletion is best-effort and doesn't need to block.

**Fix:** Remove `await` from line 244 — make it fire-and-forget:
```ts
redis.del(getPermissionCacheKey(authSession?.userId!));  // fire-and-forget; cache expires on its own TTL
```
Note: since the `withResilience` wrapper already swallows errors, this is safe.

## Execution Instructions

1. cd /home/openclaw/carbon-loop-1078
2. git fetch origin main && git merge origin/main (stay on loop/1078)
3. Apply all three fixes above
4. Run: pnpm --filter @carbon/auth typecheck  (must be clean)
5. Run: pnpm run lint  (must be clean or only pre-existing warnings)
6. Commit all changes with message: "loop(1078): address CodeRabbit review feedback — permission cache TTL, fire-and-forget del, stale ledger entry"
7. git push origin loop/1078
8. For each of the 3 CodeRabbit comment threads on PR 1084, reply indicating the fix was applied (use `gh api --method POST /repos/crbnos/carbon/pulls/1084/comments/<id>/replies -f body="..."`)
   - Comment IDs: 3526539582 (ledger/minor), 3526539583 (session.server.ts/minor), 3526539584 (users.server.ts/major)

## What to return

After completing, output a brief summary of:
- What was changed and where
- Whether typecheck and lint passed
- Confirmation that the push succeeded
- Any issues encountered
