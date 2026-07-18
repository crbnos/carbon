---
id: "1010-review-1"
kind: bug
risk: high
issue: 1010
title: "Address PR #1137 review: cross-tenant security, race conditions, data integrity"
acceptance:
  - get_batchable_operations SQL fn and JS wrapper scoped by companyId; ERP board caller passes companyId
  - service-role helpers in operations.service.ts accept and filter by companyId on all batch/operation/event reads
  - Active→Completed transition serialized in a transaction with WHERE status='Active' precondition check
  - submitted members validated against actual batch membership; duplicates and omissions both rejected
  - batch status set to Completed only after material-issue, member-completion, and GL-posting effects are committed
  - claim-operations path uses WHERE jobOperationBatchId IS NULL (or SELECT FOR UPDATE) to prevent concurrent races
  - update-work-center rejects mutation when batch status is Active or Completed
  - complete path rejects if any productionEvent for the batch has endTime IS NULL
  - MES batch page (batch.$batchId.tsx) redirects on events-query failure rather than silently degrading
  - new migration FKs added NOT VALID with separate VALIDATE CONSTRAINT step to avoid table locks
---

# Address PR #1137 Review: Cross-Tenant Security, Race Conditions, Data Integrity

This is a PR-feedback re-entry on issue #1010 (Work Order Batching). PR #1137 received 4 Critical and 11 Major CodeRabbit review comments. Address ALL of them.

## Working Context

- Worktree: /home/openclaw/carbon-loop-1010-review-1
- Branch: `loop/1010-20260714010219` (this worktree IS on the PR branch; it already contains a merge of origin/main that clears the PR's prior CONFLICTING state).
- PR: https://github.com/crbnos/carbon/pull/1137 — the harness pushes `HEAD` to `origin/loop/1010-20260714010219` and updates this existing PR idempotently. Do NOT create a new branch or a second PR; just commit on the current branch.

## Critical Issues to Fix

### 1. Cross-tenant data leak — get_batchable_operations (CRITICAL)

File: `packages/database/supabase/migrations/20260714013500_batchable-operations-rpc.sql`

`get_batchable_operations` SQL function filters only by `location_id`, no `company_id` scoping. JS wrapper in packages/database doesn't accept `companyId`. ERP planning board caller fetches without tenant scope.

**Fix:** Add `p_company_id` parameter to SQL function, filter `job_operation.company_id = p_company_id`. Update JS wrapper to accept and pass `companyId`. Update the ERP board loader to supply `companyId` from the session/request context.

### 2. Service-role batch helpers bypass RLS (CRITICAL)

File: `apps/mes/app/services/operations.service.ts` (around line 1219)

Three service-role helper functions authorize solely by `batchId` — they bypass RLS and have no tenant scoping, enabling cross-tenant batch/operation/production-event disclosure.

**Fix:** Add `companyId` parameter to all three helpers. Add `AND company_id = companyId` filter (or equivalent) to their queries. Update all callers to pass `companyId`.

### 3. Serialize Active → Completed transition (CRITICAL)

File: `packages/database/supabase/functions/batch-operations/index.ts` (around line 222)

Status, members, and events are read outside any transaction. The final UPDATE does not require `status = 'Active'`, so concurrent completions can both pass validation and insert duplicate material/member/GL effects.

**Fix:** Wrap the entire completion path in a transaction. Add `WHERE status = 'Active'` on the status UPDATE (or use `SELECT ... FOR UPDATE` on the batch row as a pessimistic lock). All reads (members, events) must happen within the transaction.

### 4. Submitted members not validated against actual membership (CRITICAL)

File: `packages/database/supabase/functions/batch-operations/index.ts` (around line 213)

Only loads submitted IDs. A caller can omit real members or pass duplicate IDs. Duplicates produce duplicate quantity/events/issues.

**Fix:** After reading submitted IDs, fetch actual batch member IDs. Reject if: (a) submitted set ≠ actual set, (b) any duplicates in submitted list. Return a clear error message.

### 5. Batch terminal before post-commit effects are recoverable (CRITICAL)

File: `packages/database/supabase/functions/batch-operations/index.ts` (around line 342)

Batch status becomes `Completed` first, then material issue → member completion → GL posting. Any mid-loop failure leaves partial effects with no retry path (batch is already terminal).

**Fix:** Reorder: do material issue, member completion, GL posting first — then set status = `Completed` last. Or wrap the whole completion path in a single transaction so it's fully atomic.

## Major Issues to Fix

### 6. Claim eligible operations atomically (MAJOR)

File: `packages/database/supabase/functions/batch-operations/index.ts` (around line 450)

Concurrent create/add transactions can both observe `jobOperationBatchId = null`, then unconditionally UPDATE, overwriting each other.

**Fix:** Change the UPDATE to `WHERE jobOperationBatchId IS NULL` (or use SELECT FOR UPDATE). Return an error if the update affected fewer rows than expected.

### 7. Block work-center changes after production starts (MAJOR)

File: `packages/database/supabase/functions/batch-operations/index.ts` (around line 576)

Path only checks batch exists. Can change work centers on Active or Completed batches.

**Fix:** Check `status = 'Pending'` before allowing work-center changes. Reject with appropriate error if status is Active or Completed.

### 8. Reject completion while timer is open (MAJOR)

File: `packages/database/supabase/functions/batch-operations/index.ts` (around line 222)

Filtering to ended events silently ignores `endTime = null`. Batch completes while an active aggregate timer is still running.

**Fix:** Before completing, explicitly query for any production event on the batch with `endTime IS NULL`. If any exist, reject completion with an error.

### 9. MES batch page — handle loader query failures (MAJOR)

File: `apps/mes/app/routes/x+/batch.$batchId.tsx` (around line 68)

If the events query fails, the page treats the timer as stopped and enables "Start Batch," potentially creating a duplicate aggregate event.

**Fix:** If the operation or event queries error, throw/redirect (similar to how the batch query is handled). Don't silently degrade.

### 10. Enforce tenant ownership in batch resource FKs (MAJOR)

File: migration (20260714012050) or a new migration

Batch FKs only validate single-column references (`locationId`, `processId`, `workCenterId`). A batch's `companyId` can disagree with referenced resources.

**Fix:** Add composite FKs: `(companyId, locationId)`, `(companyId, processId)`, `(companyId, workCenterId)`. These can be added `NOT VALID` (see item 11) to avoid locks.

### 11. New FKs NOT VALID to avoid migration locks (MAJOR)

File: `packages/database/supabase/migrations/20260714012050_job-operation-batching.sql`

New FKs on `jobOperation` and `productionEvent` require full table scans → will lock large tables in production.

**Fix:** Change FK `ADD CONSTRAINT` statements to `NOT VALID`. Add a separate `ALTER TABLE ... VALIDATE CONSTRAINT ...` step. This allows existing rows to be validated separately (or by a DBA) without taking a full lock.

### 12-14. Additional fixes (MAJOR)

- **lib/types.ts (line 69965):** Review and correct `jobOperationBatchId` nullability in the batch-related types if it's wrong.
- **batch.event.tsx (line 67):** Tighten auth check in `endProductionEvent` call per CodeRabbit's full comment (check the GitHub thread for specifics).
- **BatchPlanningBoard.tsx (line 84):** Address functional correctness issue per CodeRabbit's full comment.

## Instructions

1. Read the relevant files carefully before changing anything.
2. Fix Critical issues first (items 1-5), then Major (items 6-14).
3. Run gates after each batch of changes:
   - `pnpm --filter @carbon/database db:generate` if schema changed
   - `pnpm --filter @carbon/database tsc --noEmit`
   - `pnpm --filter @carbon/mes tsc --noEmit`
   - `pnpm --filter @carbon/erp tsc --noEmit`
4. After all fixes pass gates: `git push origin loop/1010-review-1:loop/1010-20260714010219`

Use --doer-budget 12 in the harness loop invocation.
