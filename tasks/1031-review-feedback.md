# Task: Address PR #1068 Review Feedback

## Objective
Address all actionable review comments on PR #1068 (branch `loop/1031`, worktree `/home/openclaw/carbon-worktrees/loop-1031`). Do NOT create a new worktree or new PR — commit directly to `loop/1031` and push.

## Merge origin/main first
```bash
cd /home/openclaw/carbon-worktrees/loop-1031
git fetch origin main && git merge origin/main
```

## Items to address (in order)

### 1. Move `PeriodPostingSource` type to utils package (Brad, line 624)
- `PeriodPostingSource = "operational" | "accounting"` is currently defined inline in `accounting.service.ts` (~line 604)
- Move it to `packages/utils/src/accounting.ts` (already has fiscal year helpers there)
- Export it from the utils package index
- Import it back in `accounting.service.ts` and anywhere else it's referenced
- Check for any other uses: `rg -n "PeriodPostingSource" apps/ packages/`

### 2. Wrap closeAccountingPeriod in a Kysely transaction (Brad + CodeRabbit Major)
- Brad: "we also have the ability to run transactions with the kyseley client"
- Currently lines ~916-941 do sequential Supabase calls (auto-task state updates, then period flip) — non-atomic
- Pattern to follow: `accounting.server.ts` uses `db.transaction().execute(async (trx) => { ... })` — look at `postDisposal` for the pattern
- `closeAccountingPeriod` needs a Kysely `db` handle added to its signature (alongside the Supabase client)
- Wrap the `periodCloseTask` update loop and the final `accountingPeriod` closeStatus update in a single transaction
- The read path (`getPeriodCloseChecklist`, readiness evaluation) can stay as Supabase — only the write path needs the transaction
- Check callers of `closeAccountingPeriod` to thread `db` through

### 3. Gate close on Locked status (CodeRabbit Major, line 938)
- `closeAccountingPeriod` currently allows `Open → Closed` directly
- Add a check: if `closeStatus !== "Locked"`, return an error: "Period must be locked before closing."
- The checklist "Lock the period" task is currently an Action task — verify it actually calls `lockAccountingPeriod` when completed, or that the close gate makes it moot either way
- The sequential close order is: Open → Locked → Closed (this is the spec intent)

### 4. Add `pending-postings` evaluator (CodeRabbit Major, line 1153)
- `computePeriodReadiness` has evaluators for `draft-journals`, `tb-balanced`, `draft-depreciation`, `unmatched-ic`
- Missing: `pending-postings` (seeded as Blocker, required) and `negative-inventory` (Warning, required) — these always return `autoCheck = null → effectiveStatus = "Done"` which is wrong
- Add `pending-postings` evaluator: query for un-posted operational documents (receipts, shipments, invoices) dated within the period. Look at how other evaluators query — same Supabase client pattern.
- Add `negative-inventory` evaluator: query for negative inventory quantities as of period end. If data isn't available to build this now, at minimum make it return `autoCheck = false` (failing) rather than silently passing — add a TODO comment.
- Keep the `checks`, `blockers`, `warnings` shape so `evaluateCloseChecklist` continues to work

### 5. Fix Cancel button type (CodeRabbit Major, line 346 of periods.$periodId.close.tsx)
- A Cancel button inside a `fetcher.Form` is missing `type="button"`, causing it to submit the form
- Add `type="button"` to that Button component
- Quick fix, should be one line

### 6. Add DELETE guard to immutability trigger (CodeRabbit Major, migration line 176)
- `check_posted_record_immutable()` currently only handles UPDATE, not DELETE
- A SECURITY DEFINER delete path could remove a Posted journal and cascade its lines
- Update the trigger function to handle `TG_OP = 'DELETE'` for `Posted`/`Reversed` journals and reject them
- Update the trigger definition from `BEFORE UPDATE` to `BEFORE UPDATE OR DELETE` on `"journal"`
- This is in migration `20260702044133_period-close-lifecycle.sql` — update it in place (it's idempotent with `CREATE OR REPLACE FUNCTION` and `DROP TRIGGER IF EXISTS`)

## After all changes
- Run typecheck: `pnpm --filter @carbon/erp typecheck && pnpm --filter @carbon/utils typecheck`
- Run lint: `pnpm run lint` (from repo root or erp package)
- Run tests: `pnpm --filter @carbon/erp test` (if accounting tests exist)
- Push to `loop/1031`

## Notes
- This is the same worktree/branch as the original build. Stack is NOT running — these are code-only changes (migration is idempotent, no live DB needed for the trigger change).
- The Kysely `db` client in accounting context: look at `accounting.server.ts` to see how it's imported/instantiated in the ERP loader context, then trace through to `closeAccountingPeriod`.
