# Task: PR #1137 — Add `Completing` intermediate state to batch completion

## Objective
Address CodeRabbit Critical finding on PR #1137 (Job Operation Batching).

## Context
- **PR**: https://github.com/crbnos/carbon/pull/1137
- **Branch**: `loop/1010-20260714010219` (local: `loop/1010-review-1` has latest review fixes)
- **Working branch to modify**: `loop/1010-review-1` (this has all prior review fixes; push to the PR branch or open a follow-up)

## The Problem
In `packages/database/supabase/functions/batch-operations/index.ts`, the batch completion flow:
1. Sets `status = 'Completed'` inside the Kysely transaction
2. Then post-commit: issues materials via `issue` edge fn, flips members to `Done`, posts GL events

If any post-commit step fails (e.g., `issue` edge fn error, GL post error), the batch is permanently in `Completed` state with **partial effects**. A retry is rejected because `status != 'Active'`. There's no recovery path.

CodeRabbit recommendation: use an idempotent `Completing` workflow/outbox pattern — transition to `Completing` inside the transaction, perform post-commit effects, then transition to `Completed` only after all steps succeed.

## What To Do

### 1. Add `Completing` to the DB schema
- In `packages/database/supabase/migrations/`, add a new migration that adds `'Completing'` to the `jobOperationBatchStatus` enum.
- Also update the TypeScript types in `packages/database/src/` (generated or hand-maintained — check how other enums are done).

### 2. Update the edge function (`batch-operations/index.ts`)
Change the completion logic:
- **Inside the transaction**: flip `status = 'Completing'` (not `Completed`)
- **Post-commit loop** (material issue, member Done, GL):
  - Make each step **idempotent**: check if already done before doing it (e.g., check if materials already issued, check if jobOperation already Done, check if productionEvent.postedToGL is already true)
  - Propagate errors from GL invocations (currently silently ignored in the for-loop at the end)
- **After all steps succeed**: flip `status = 'Completed'`
- **Recovery**: if a retry comes in with `status = 'Completing'`, re-run the post-commit steps from where they left off (idempotent resume)

The completion guard (`WHERE status = 'Active'`) should also allow `status = 'Completing'` for retry/resume attempts.

### 3. Update any UI or service code that checks for `Completed` status
- Search for `'Completed'` references related to `jobOperationBatch` in the codebase
- The `Completing` state should be treated as "in-flight" (not terminal) in any UI state checks

### 4. Tests
- Update existing tests in batch-operations that assert `Completed` status to account for the two-phase flow
- Add a test that simulates a mid-flight failure (step fails during post-commit) and verifies a retry succeeds

## Branch & Push Instructions
- Work on branch `loop/1010-review-1` (already checked out locally)
- After changes, run: `pnpm --filter @carbon/checks run build && pnpm --filter @carbon/utils run test 2>&1 | tail -30`
- Push: `git push origin loop/1010-review-1`
- The PR #1137 tracks `loop/1010-20260714010219` as its head; you may need to either:
  a) Force-push `loop/1010-review-1` as `loop/1010-20260714010219`, OR
  b) Just push `loop/1010-review-1` and note the commit SHA in a PR comment

## Files to examine first
- `packages/database/supabase/functions/batch-operations/index.ts` (full file)
- `packages/database/supabase/migrations/` — find the migration that added the `jobOperationBatch` table / status enum
- `packages/database/src/` — how status enums are typed

## Output
When done, output a brief summary of what was changed, what tests pass, and the commit SHA(s). Write it to `/home/openclaw/.openclaw/workspace/tasks/1137-completing-state-output.md`.
