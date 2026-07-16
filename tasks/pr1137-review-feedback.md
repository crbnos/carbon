# PR #1137 Review Feedback — Job Operation Batching

## Objective
Address actionable CodeRabbit review comments on PR #1137 (branch: `loop/1010-20260714010219`) and resolve the current merge conflicts with `origin/main`.

## PR Details
- **PR:** https://github.com/crbnos/carbon/pull/1137
- **Branch:** `loop/1010-20260714010219`
- **Issue:** Closes #1010 (Job Operation Batching — combine shared preparation across concurrent production orders)
- **PR Status:** CONFLICTING (merge conflicts with main must be resolved)

## Context
The PR was opened 2026-07-14 and CodeRabbit posted new Critical and Major findings after the last agent reply (2026-07-14T07:51:07Z). These have NOT been addressed yet.

## Actionable Review Items (address all Critical and Major)

### CRITICAL — Security

**1. Cross-tenant data leak in `get_batchable_operations` RPC**
- File: `packages/database/supabase/migrations/20260714013500_batchable-operations-rpc.sql`
- `get_batchable_operations` filters only by `location_id`, not by `companyId`. The JS wrapper doesn't accept a `companyId`. This allows cross-tenant batch-planning candidate pool disclosure.
- Fix: Add `company_id` parameter to the RPC and filter by it; update the JS caller to pass `companyId`.

**2. Cross-tenant batch reads in operations service (service-role bypasses RLS)**
- File: `apps/mes/app/services/operations.service.ts`
- Service-role helper functions authorize solely by `batchId`, enabling cross-tenant disclosure.
- Fix: Add `companyId` parameter to all batch service helpers and add WHERE filter.

**3. Serialize the `Active → Completed` transition**
- File: `packages/database/supabase/functions/batch-operations/index.ts`
- Status, members, and events are read outside the transaction; final update doesn't require `status = "Active"`. Concurrent completions can both pass validation.
- Fix: Use `UPDATE jobOperationBatch SET status = 'Completed' WHERE id = $1 AND status = 'Active' RETURNING id` as the gating step; abort if no row returned.

**4. Require submitted members to exactly match batch membership**
- File: `packages/database/supabase/functions/batch-operations/index.ts`
- Query only loads submitted IDs, so a caller can omit real members yet still complete the batch. Duplicate IDs produce duplicate quantity/events.
- Fix: Cross-check submitted IDs against actual batch membership; reject if sets don't match; deduplicate.

**5. Do not make batch terminal before post-commit effects are recoverable**
- File: `packages/database/supabase/functions/batch-operations/index.ts`
- Batch becomes `Completed` before material issue, member completion, and GL posting. Mid-loop failure leaves partial effects; retries are rejected because status is already terminal.
- Fix: Move the status update to AFTER all post-commit effects succeed; or use an intermediate status like `Completing` that retries are allowed to enter.

### MAJOR — Data Integrity & Security

**6. Claim eligible operations atomically**
- File: `packages/database/supabase/functions/batch-operations/index.ts`
- Concurrent create/add transactions can both observe `jobOperationBatchId = null` and overwrite each other.
- Fix: Use `UPDATE jobOperation SET jobOperationBatchId = $batchId WHERE id = ANY($ids) AND jobOperationBatchId IS NULL RETURNING id` and verify all claimed.

**7. Reject completion while a batch timer is still open**
- File: `packages/database/supabase/functions/batch-operations/index.ts`
- Filtering to ended events silently ignores events with `endTime = null`, allowing batch completion with active timers.
- Fix: Check that no open production events exist before completing; return error if any found.

**8. Block work-center changes after production starts**
- File: `packages/database/supabase/functions/batch-operations/index.ts`
- Update path checks only that the batch exists, allowing modification of completed batches.
- Fix: Add guard that batch status is `Pending` or `Active` (not `Completed`) before allowing updates.

**9. Add FKs NOT VALID to avoid locking during migration**
- File: `packages/database/supabase/migrations/20260714012050_job-operation-batching.sql`
- The two new FK constraints (`jobOperation_jobOperationBatchId_fkey`, `productionEvent_jobOperationBatchId_fkey`) require a full table scan and lock.
- Fix: Add with `NOT VALID` then `VALIDATE CONSTRAINT` in a separate step.

**10. Handle failures from all loader queries in batch route**
- File: `apps/mes/app/routes/x+/batch.$batchId.tsx`
- If events query fails, the page enables "Start Batch" creating a duplicate aggregate event.
- Fix: Propagate errors from all three loader queries; redirect on error.

**11. Enforce tenant ownership in batch resource foreign keys**
- File: `packages/database/src/types.ts`
- FKs validate only `locationId`, `processId`, `workCenterId` without cross-checking `companyId`.
- Fix: Add composite foreign keys (or CHECK constraints) verifying referenced resources belong to the same company.

## Steps

1. **Check out the branch and resolve merge conflicts:**
   ```bash
   cd /home/openclaw/carbon
   git fetch origin
   git worktree add /home/openclaw/carbon-worktrees/loop-1010-feedback loop/1010-20260714010219
   cd /home/openclaw/carbon-worktrees/loop-1010-feedback
   git merge origin/main
   # resolve conflicts, then: git add . && git commit -m "chore: merge origin/main"
   ```

2. **Address each review item above** in order (Criticals first, then Majors). Each fix should be a clean commit.

3. **Run type-check and lint:**
   ```bash
   pnpm --filter @carbon/mes typecheck || true
   pnpm --filter @carbon/database typecheck || true
   pnpm --filter '@carbon/ee' typecheck || true
   pnpm lint --filter @carbon/mes || true
   ```

4. **Reply to each addressed review thread** on GitHub with a brief acknowledgment + what was done.

5. **Push to the branch:**
   ```bash
   git push origin loop/1010-20260714010219
   ```

## Constraints
- Work on branch `loop/1010-20260714010219` — this is an existing PR, do NOT create a new branch or PR
- Never merge
- Always use `pnpm`, never `npm`
- Use ABSOLUTE paths everywhere
- Worktree location: `/home/openclaw/carbon-worktrees/loop-1010-feedback`

## What to Return
After completing, output a summary of:
- Which items were addressed vs. skipped (with reason)
- Whether merge conflicts were resolved
- Whether typecheck/lint passed
- Commit SHAs pushed
