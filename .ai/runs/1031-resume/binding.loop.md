---
id: "1031-resume"
kind: feature
title: "Accounting Periods UI + close-checklist UI (continuation of #1031)"
risk: med
issue: 1031
acceptance:
  - "Checklist instantiation: opening the close drawer for a period idempotently creates the 9 seeded tasks (running instantiation twice does not duplicate rows)"
  - "Blocker tasks: a period with a failing Blocker auto-check (e.g. draft JEs) cannot be closed; the Close button is disabled"
  - "Warning skip: a Warning task can be skipped with a recorded reason; empty skippedReason is rejected"
  - "Blocker skip: a Blocker task cannot be skipped (server-side rejection)"
  - "Close gates on tasks: close succeeds only when all required tasks are Done or Skipped; final Auto-task states are persisted"
  - "Types green: pnpm --filter @carbon/erp typecheck, pnpm --filter @carbon/database typecheck, and pnpm run lint all pass"
---

# Issue #1031 Continuation: Accounting Periods UI + Close Checklist

## Context

This is a CONTINUATION of a partial build. The worktree already exists at
`/home/openclaw/carbon-worktrees/loop-1031` on branch `loop/1031`.
PR #1068 is already open. Do NOT create a new worktree or new PR.

## What has already been built (committed on branch)

1. **Migration** `20260702044133_period-close-lifecycle.sql`: DB trigger for immutability,
   periodCloseTaskDefinition + periodCloseTask tables with RLS, 9 seeded system task definitions
2. **Models + core lifecycle services**: lock/unlock/close/reopen/readiness, sequential ordering
3. **Posting gates**: wired into postJournalEntry, reverseJournalEntry, depreciation runs, fixed-asset dispose
4. **Checklist services** (accounting.service.ts): `getPeriodCloseChecklist`, `skipPeriodCloseTask`,
   `completePeriodCloseTask`, `closePeriodWithChecklist`, `updatePeriodCloseTaskDefinition`,
   `getAccountingPeriods`, `lockPeriod`, `unlockPeriod`, `closePeriod`, `reopenPeriod`
5. **Tests**: `accounting.periods.test.ts` with sequential close/reopen and checklist coverage

## What remains (your work)

### Task A: Accounting Periods Page + Close-Checklist UI

Route: `/x/accounting/periods`

**Step 1 (MANDATORY)**: Find the nearest existing list page in the accounting module:
```bash
ls apps/erp/app/routes/x+/accounting+/
# Then read 2-3 of the simpler ones to understand the pattern
```
Copy that pattern — do NOT design from scratch.

Also check the accounting module index for already-exported functions:
```bash
grep -n "export" apps/erp/app/modules/accounting/index.ts | grep -i period
```

**Route files to create:**
- `apps/erp/app/routes/x+/accounting+/periods.tsx` — list loader + page
  - Table columns: Name/label, Date range (startDate–endDate), Status (Open/Locked/Closed),
    Close Status (show colored badge using PERIOD_CLOSE_STATUS_COLOR_MAP), Actions
  - Loader: calls `getAccountingPeriods(client, companyId)` — export it from accounting/index.ts first
  - Status badge colors: use existing status-color mapping pattern

- `apps/erp/app/routes/x+/accounting+/periods.$periodId.close.tsx` (or drawer) — close checklist
  - Shows checklist tasks for the period
  - Each task: name, type badge, severity badge, status, actions
  - Auto tasks: read-only status (derived from readiness)
  - Manual/Action tasks: "Mark Done" button
  - Warning tasks: "Skip" button (opens reason input) — only when status is not Done
  - Blocker tasks: NO skip button
  - Close button at bottom: disabled when `!canClose` (blocking Blocker auto-checks)
  - On close: calls `closePeriodWithChecklist` — persists final auto-task states
  - If close fails, show the `blockingReason`

**Navigation**: Add "Accounting Periods" to the accounting sidebar. Find the sidebar config:
```bash
grep -rn "accounting.*nav\|sidebar.*accounting\|nav.*accounting" apps/erp/app/routes/x+/accounting+/ | head -10
# Or look for the sidebar definition
grep -rn "Periods\|periods" apps/erp/app/routes/x+/accounting+/ | head -10
```

### Task B: Export missing service functions

Check `apps/erp/app/modules/accounting/index.ts` — ensure these are exported:
- `getAccountingPeriods`
- `getAccountingPeriodById`
- `getPeriodCloseChecklist`
- `skipPeriodCloseTask`
- `completePeriodCloseTask`
- `closePeriodWithChecklist`
- `lockPeriod`, `unlockPeriod`, `closePeriod`, `reopenPeriod`

### Task C: Verification gate

After all code is written:
```bash
cd /home/openclaw/carbon-worktrees/loop-1031
pnpm exec biome check --write --no-errors-on-unmatched apps/erp/app/routes/x+/accounting+/periods.tsx apps/erp/app/routes/x+/accounting+/periods.\$periodId.close.tsx apps/erp/app/modules/accounting/index.ts 2>&1 || true
pnpm --filter @carbon/erp typecheck 2>&1
pnpm --filter @carbon/database typecheck 2>&1
pnpm run lint 2>&1
```

Fix any typecheck or lint errors. Use `(row as any).field` casts for new untyped columns.

## Key constraints

- **Do NOT regenerate or commit `packages/database/src/types.ts`** — use `(client as any)` casts
- **Do NOT create a new PR** — update PR #1068 only (push to loop/1031 branch)
- Use `PERIOD_CLOSE_STATUS_COLOR_MAP` from `~/utils/status-colors` for colored badges
- Import from `~/modules/accounting` (the module index)
- For the checklist close action, the route action must call `closePeriodWithChecklist` which
  persists final auto-task states then calls the underlying `closePeriod`

## Behavior proof

The behavior gate for checklist acceptance criteria can be proved via the existing unit tests
in `accounting.periods.test.ts` if they cover instantiation + close gating. Check them:
```bash
cat apps/erp/app/modules/accounting/accounting.periods.test.ts
```
If tests already cover the service-level criteria, mark them proved via unit test.
For UI criteria (Close button disabled, skip reason required), mark as "unverifiable without stack"
and ship as `agent:needs-verification` — do NOT block on visual proof.

## PR Update

After completing, update PR #1068 body to reflect completed tasks. Do NOT open a new PR.
Push to origin/loop/1031.

## Ledger notes from prior run

The prior run plateaued with "no progress across 2 iterations" due to budget exhaustion.
The checklist services were committed in the "no verdict" iteration and are correct.
