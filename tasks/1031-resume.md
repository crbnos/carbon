# Task Brief: Resume Build — Issue #1031 Accounting Period Close Lifecycle

## Objective
Continue building issue #1031 on branch `loop/1031` — specifically the remaining
tasks: **Accounting Periods UI page + close-checklist UI**, and final **types/typecheck/lint** gate.

## Context
- Issue: https://github.com/crbnos/carbon/issues/1031
- PR: https://github.com/crbnos/carbon/pull/1068 (open, partial, branch `loop/1031`)
- Worktree: `/home/openclaw/carbon-worktrees/loop-1031`
- Binding: `/home/openclaw/carbon/.ai/runs/1031/binding.loop.md`

## Already done (committed on branch)
1. Period-close migration (immutability trigger, checklist tables, 9 seeded task defs)
2. Period models + core lifecycle services (lock/unlock/close/reopen/readiness)
3. Posting gates wired into postJournalEntry, reverseJournalEntry, depreciation runs, fixed-asset dispose
4. Checklist services: `getPeriodCloseChecklist`, `skipPeriodCloseTask`, `completePeriodCloseTask`,
   `closePeriodWithChecklist`, `updatePeriodCloseTaskDefinition`, plus tests in `accounting.periods.test.ts`

## What remains

### Task 5: Accounting Periods page + close-checklist UI
- Route at `/x/accounting/periods` (list + detail/drawer pattern)
- Use nearest existing list page as precedent (e.g. fiscal-year or journal-entry list)
- Period list table: show all periods for the company (date range, status, close status)
- Close drawer: open via button on a period row → shows the checklist tasks
  - Each task shows: name, type (Auto/Manual/Action), severity (Blocker/Warning/Action), status
  - Auto tasks reflect computed readiness live
  - Manual/Action tasks can be marked Done by user
  - Warning tasks have a Skip option (requires reason) — Blockers cannot be skipped
  - Close button: disabled if any Blocker auto-check fails; enabled when all required tasks are Done/Skipped
- Status display: use PERIOD_CLOSE_STATUS_COLOR_MAP from utils/status-colors.ts
- Navigation: add "Accounting Periods" to the accounting nav sidebar entry

### Task 6: Verification gate
- `pnpm --filter @carbon/erp typecheck`
- `pnpm --filter @carbon/database typecheck`  
- `pnpm run lint` (or `pnpm exec biome check --write --no-errors-on-unmatched <changed paths>`)
- All must pass

## Key design notes
- Do NOT regenerate or commit `packages/database/src/types.ts` — use casts
- Use `(client as any).from("periodCloseTask")` pattern already established in service
- Copy nearest existing accounting list page as precedent (FIRST find, then copy)
- Use existing UI components: Table, Drawer/Sheet, Button, Badge/Status indicators
- Route files: `apps/erp/app/routes/x+/` directory pattern
- Modules: service functions already exist in `accounting.service.ts`, export from `index.ts`

## Acceptance criteria to satisfy
- [ ] Checklist instantiation: opening the close drawer for a period idempotently creates the 9 seeded tasks
- [ ] Blocker tasks: a period with a failing Blocker auto-check cannot be closed; the Close button is disabled
- [ ] Warning skip: a Warning task can be skipped with a recorded reason; empty skippedReason is rejected
- [ ] Blocker skip: a Blocker task cannot be skipped (server-side rejection)
- [ ] Close gates on tasks: close succeeds only when all required tasks are Done or Skipped; final Auto-task states are persisted
- [ ] Types green: typecheck + lint pass

## Budget note
Use `--doer-budget 15` in the harness invocation — this is a medium-large UI feature.
