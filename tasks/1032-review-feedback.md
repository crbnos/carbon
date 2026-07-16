# Task: PR #1096 Review Feedback — Document Approvals (Issue #1032)

## Objective

Implement the 5 CodeRabbit review fixes that were acknowledged in PR #1096 
(`feat(approvals): document approvals for JEs, payments, purchase invoices, memos + SoD reporting`) 
but not yet implemented. All 5 threads are unresolved.

## Context

- **PR:** https://github.com/crbnos/carbon/pull/1096
- **Branch:** `loop/1032`
- **Worktree:** `/home/openclaw/carbon-loop-1032`
- **Tracking issue:** #1032

The worktree has already been recreated and merged with `origin/main` as of this dispatch.

## Actionable Review Items

### 1. 🟠 MAJOR — Parking and approval-request creation are not atomic (accounting.service.ts)
**File:** `apps/erp/app/modules/accounting/accounting.service.ts`
**CodeRabbit comment ID:** 3532614160

Parking (setting `status = 'Pending Approval'`) and `createApprovalRequest` are not atomic. 
If `createApprovalRequest` fails after the park update, the document is stuck in Pending Approval 
with no corresponding approval request.

**Fix:** Wrap both the `park` status update and `createApprovalRequest` insert in a single Kysely 
transaction so both succeed or both roll back atomically. Apply to all four document types 
(JE, payment, purchase invoice, memo).

**CodeRabbit implementation notes:**
- Since `journal`, `approvalRequest` (and the notification trigger) all need to move together, 
  wrap them in a Kysely `db.transaction().execute(async (trx) => { … })` block
- The `journal_check_period_open` DB trigger fires on INSERT/UPDATE to `journal`, so it will 
  still fire inside the transaction; no special handling needed
- Pass `trx` as the db handle to each service call inside the transaction block

### 2. 🟡 MINOR (correctness) — Revert optimistic toggle state on failure (ApprovalRules.tsx)
**File:** `apps/erp/app/modules/settings/ui/Approvals/ApprovalRules.tsx`
**CodeRabbit comment ID:** 3532614162

`handleToggle` optimistically sets `enabled` state, but the error branch doesn't revert it. 
If the server update fails, the UI is stuck in the wrong state.

**Fix:** Add `setEnabled(!enforceNoSelfApproval)` (or equivalent revert) in the error branch 
of the effect/handler that fires when the update fails.

### 3. 🟠 MAJOR — Access report excludes inactive/terminated employees (users.service.ts)
**File:** `apps/erp/app/modules/users/users.service.ts`
**CodeRabbit comment ID:** 3532614177

The `getUserAccessReport` query filters `.eq("active", true)`, meaning terminated or deactivated 
employees never appear in the SoD/access report — which is exactly the audit scenario where 
you'd want to see their residual permissions.

**Fix:** Remove the `.eq("active", true)` filter from the `employees` query in `getUserAccessReport` 
so the report includes all employees regardless of active status.

### 4. 🟡 MINOR (correctness) — `approvalRequestId` lacks a foreign key constraint (migration SQL)
**File:** `packages/database/supabase/migrations/20260706193000_document-approvals.sql`
**CodeRabbit comment ID:** 3532614187

`preparedBy`/`approvedBy` are FK-constrained to `"user"`, but `approvalRequestId` on the 
`journal` table is not FK-constrained to `approvalRequest`.

**Fix:** Add FK constraint using `NOT VALID` (to avoid table scan / lock on existing data) in 
the existing migration or a new migration, then add a separate `VALIDATE CONSTRAINT` step. 
Example approach:
```sql
ALTER TABLE "journal"
  ADD CONSTRAINT "journal_approvalRequestId_fkey"
  FOREIGN KEY ("approvalRequestId") REFERENCES "approvalRequest"("id")
  NOT VALID;

ALTER TABLE "journal"
  VALIDATE CONSTRAINT "journal_approvalRequestId_fkey";
```
Use `IF NOT EXISTS` guards where possible for idempotency.

### 5. 🟠 MAJOR — Inngest reminder events sent inside `step.run` risk duplicate delivery (approval-escalation.ts)
**File:** `packages/jobs/src/inngest/functions/scheduled/approval-escalation.ts`
**CodeRabbit comment ID:** 3532614190

`inngest.send()` inside `step.run` risks duplicate delivery on step retry, and lacks an 
idempotency key.

**Fix:** 
- Switch from `inngest.send()` to `step.sendEvent()` so Inngest deduplicates on step replay
- Add a stable per-request/day idempotency key (`msgId`) to each emitted event, e.g.:
  `msgId: \`approval-reminder-${approvalRequestId}-${dateString}\``

**CodeRabbit implementation notes:**
- Since `escalateCompany` is a plain async function called from within `step.run`, you'll need 
  to either pass `step` as a parameter to `escalateCompany` or move the `step.sendEvent()` call 
  to the top-level step function that calls `escalateCompany`
- The idempotency key format should be stable across retries (same request + same day = same key)

## Implementation Instructions

1. Work in the existing worktree at `/home/openclaw/carbon-loop-1032`
2. The branch is `loop/1032` — already merged with `origin/main`
3. Implement all 5 fixes in a single commit (or grouped logical commits)
4. After implementing, run the floor gates:
   - `pnpm --filter erp typecheck`
   - `pnpm --filter @carbon/jobs typecheck` (for the Inngest fix)
   - `pnpm --filter @carbon/database typecheck`
   - `pnpm run lint`
5. Push to `loop/1032` — this will update the existing PR #1096
6. After pushing, resolve the 5 CodeRabbit review threads on PR #1096

## What I Need Back

Confirmation that all 5 fixes are implemented, gates pass, and the branch is pushed to origin. 
Report any failures or ambiguities as comments on the issue (#1032).

## Safety

- Do NOT merge the PR. Human approval is required.
- Do NOT push to main. Push only to `loop/1032`.
- Stay within the scope of these 5 fixes only — no scope creep.
