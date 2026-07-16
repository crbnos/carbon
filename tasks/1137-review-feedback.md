# PR #1137 Review Feedback — Work Order Batching (Issue #1010)

## Objective

Address all Critical and Major CodeRabbit review comments on PR #1137 (job-operation-batching feature). Re-enter the inner loop on the existing branch and push fixes.

## PR

https://github.com/crbnos/carbon/pull/1137
Branch: `agent/1010-job-operation-batching` (or equivalent — check `gh pr view 1137 --json headRefName`)

## Setup

1. Check out the existing PR branch into a fresh worktree:
   ```bash
   cd /home/openclaw/carbon
   BRANCH=$(gh pr view 1137 --json headRefName --jq .headRefName)
   git fetch origin "$BRANCH"
   crbn new loop/1010-review-1 --base "origin/$BRANCH" --yes
   # note the worktree path printed
   cd <worktree-path>
   git fetch origin main && git merge origin/main
   ```
2. All code changes must be made in that worktree (absolute paths throughout).
3. After fixes: `git push origin HEAD` (updates the existing PR branch).

## Actionable Review Comments (address ALL of these)

### CRITICAL

1. **Cross-tenant data leak — `get_batchable_operations` RPC**
   - File: `packages/database/supabase/migrations/20260714013500_batchable-operations-rpc.sql` (line 121)
   - Problem: `get_batchable_operations` SQL function filters only by `location_id`, no `company_id` scoping. Its JS wrapper doesn't accept `companyId`. Caller fetches all operations across tenants.
   - Fix: Add `company_id` filter to the SQL function signature and body; update the JS wrapper to pass `companyId`; update the ERP board caller to supply it.

2. **Scope service-role batch reads by `companyId`**
   - File: `apps/mes/app/services/operations.service.ts` (line 1219)
   - Problem: Service-role helpers bypass RLS and authorize solely by `batchId` — enables cross-tenant disclosure of batch, operation, and production-event data.
   - Fix: Accept `companyId` parameter in all three helpers; add the filter to their queries. Update all callers.

3. **Serialize the `Active` → `Completed` transition**
   - File: `packages/database/supabase/functions/batch-operations/index.ts` (line 222)
   - Problem: Status, members, and events are read outside the transaction. Final UPDATE doesn't require `status = "Active"`, so concurrent completions can both pass validation and insert duplicate effects.
   - Fix: Wrap the entire completion path in a serializable transaction; add `WHERE status = 'Active'` (or pessimistic lock) on the status update; validate inside the transaction.

4. **Require submitted members to exactly match batch membership**
   - File: `packages/database/supabase/functions/batch-operations/index.ts` (line 213)
   - Problem: Only loads submitted IDs — caller can omit real members and still complete the batch. Duplicate IDs produce duplicate quantity/events/issues.
   - Fix: Cross-check submitted member IDs against actual batch membership; reject if mismatched or if duplicates present.

5. **Do not make batch terminal before post-commit effects are recoverable**
   - File: `packages/database/supabase/functions/batch-operations/index.ts` (line 342)
   - Problem: Batch status becomes `Completed` before material issue, member completion, and GL posting. Mid-loop failure leaves partial effects; retries are blocked because the batch is already terminal.
   - Fix: Reorder: complete material/member/GL effects first, then mark batch `Completed` as the final atomic step — or wrap the entire sequence in a transaction and set status last.

### MAJOR

6. **Claim eligible operations atomically**
   - File: `packages/database/supabase/functions/batch-operations/index.ts` (line 450)
   - Problem: Concurrent create/add transactions can both read `jobOperationBatchId = null`, then overwrite each other (unconditional UPDATE), leaving empty active batches or wrong membership.
   - Fix: Use `UPDATE ... WHERE jobOperationBatchId IS NULL` for the claim step; or use a SELECT FOR UPDATE to lock the rows before claiming.

7. **Block work-center changes after production starts**
   - File: `packages/database/supabase/functions/batch-operations/index.ts` (line 576)
   - Problem: Path only checks batch exists. Can modify completed batches or change member work centers after events were recorded.
   - Fix: Check batch status is `Pending` (not Active/Completed) before allowing work-center changes; reject mutation if status is Active or Completed.

8. **Reject completion while a batch timer is still open**
   - File: `packages/database/supabase/functions/batch-operations/index.ts` (line 222)
   - Problem: Filtering to ended events silently ignores `endTime = null` events. Batch can become Completed while an active aggregate timer remains.
   - Fix: Explicitly check for any production event with `endTime IS NULL` on the batch; if found, reject completion with an appropriate error.

9. **Handle failures from all three loader queries (MES batch page)**
   - File: `apps/mes/app/routes/x+/batch.$batchId.tsx` (line 68)
   - Problem: If the events query fails, the page treats the timer as stopped and enables "Start Batch," potentially creating a duplicate aggregate event.
   - Fix: Redirect/error boundary if operation or event queries fail, not just the batch query.

10. **Enforce tenant ownership in batch resource FKs**
    - File: `packages/database/src/types.ts` (line 20127) / migration
    - Problem: FKs only validate `locationId`, `processId`, `workCenterId` — batch `companyId` can disagree with referenced resources.
    - Fix: Add composite FKs that enforce `(companyId, locationId)`, `(companyId, processId)`, `(companyId, workCenterId)`.

11. **Add FK constraints `NOT VALID` to avoid table lock during migration**
    - File: `packages/database/supabase/migrations/20260714012050_job-operation-batching.sql` (line 97)
    - Problem: New FKs on `jobOperation` and `productionEvent` require full table scans and will lock large tables in production.
    - Fix: Add FKs as `NOT VALID`; add a separate `VALIDATE CONSTRAINT` step.

12. **`jobOperationBatchId` nullability handling in lib/types.ts**
    - File: `packages/database/supabase/functions/lib/types.ts` (line 69965)
    - Problem: `jobOperationBatchId` nullability might be incorrect in the generated/hand-written types.
    - Fix: Review and correct the nullability annotation if needed.

13. **endProductionEvent auth in batch.event.tsx**
    - File: `apps/mes/app/routes/x+/batch.event.tsx` (line 67)
    - Problem: Security concern around auth check in `endProductionEvent`.
    - Fix: Verify and tighten auth scope (check what CodeRabbit flagged in the full comment body on GitHub if needed).

14. **Batch planning board — correctness issue**
    - File: `apps/erp/app/modules/production/ui/BatchPlanning/BatchPlanningBoard.tsx` (line 84)
    - Problem: Functional correctness concern on the planning board (review full comment on GitHub for details).
    - Fix: Address per the CodeRabbit comment.

## Priority Order

Address in this order:
1. Criticals 1–5 first (data leaks and race conditions)
2. Majors 6–14 after (data integrity and stability)

## Build Instructions

Use the conductor inner loop. The binding for this run should be:

```yaml
---
id: "1010-review-1"
kind: bug
risk: high
issue: 1010
title: "Address PR #1137 review: cross-tenant security, race conditions, data integrity"
acceptance:
  - get_batchable_operations SQL fn and JS wrapper scoped by companyId; ERP board caller passes companyId
  - service-role helpers in operations.service.ts accept and filter by companyId
  - Active→Completed transition serialized in a transaction with status precondition check
  - submitted members validated against actual batch membership; duplicates rejected
  - batch status set to Completed only after material/member/GL effects committed
  - claim-operations uses WHERE jobOperationBatchId IS NULL (no unconditional overwrite)
  - update-work-center rejects mutation when batch status is Active or Completed
  - complete path rejects if any productionEvent for the batch has endTime IS NULL
  - MES batch page redirects on events-query failure (not silent degradation)
  - new FKs added NOT VALID in migration with separate VALIDATE CONSTRAINT step
---
```

Write this binding to `/home/openclaw/carbon/.ai/runs/1010-review-1/binding.loop.md`.

## After Build

- Push to the existing PR branch: `git push origin HEAD`
- The PR (#1137) will update automatically
- Reply on each addressed GitHub review thread to mark resolved
- Report outcome back

## Important Notes

- Use ABSOLUTE paths for binding and --cwd args (pnpm --filter @carbon/harness sets cwd to packages/harness/)
- pnpm ONLY, never npm
- Do NOT open a new PR — push to the existing branch for PR #1137
- If you need the full CodeRabbit comment bodies, use: `gh api repos/crbnos/carbon/pulls/1137/comments --jq '.[] | {id, path, line, body}'`
- doer-budget: use at least --doer-budget 12 (these are high-risk changes)
