---
id: 1031
kind: feature
title: Accounting period close lifecycle + posted-record immutability + close checklist
risk: med
issue: 1031
acceptance:
- "DB trigger: direct service-role SQL INSERT INTO journal dated in a Closed period is rejected with a trigger error"
- "Immutability: UPDATE journal SET ... WHERE status = 'Posted' (non-Reversed) is rejected via PostgREST for both user and service role; Posted -> Reversed still works"
- "Service gate: operational posting (receipt/shipment/invoice) into a Locked period is rejected with a 'period is locked' error"
- "Service gate: accounting posting (manual JE) into a Locked period is allowed"
- "Sequential close: closing period N is rejected while period N-1 is not Closed"
- "Sequential reopen: reopening period N is rejected while period N+1 is not Open"
- "Checklist instantiation: opening the close drawer for a period idempotently creates the 9 seeded tasks (running instantiation twice does not duplicate rows)"
- "Blocker tasks: a period with a failing Blocker auto-check (e.g. draft JEs) cannot be closed; the Close button is disabled"
- "Warning skip: a Warning task can be skipped with a recorded reason; empty skippedReason is rejected"
- "Blocker skip: a Blocker task cannot be skipped (server-side rejection)"
- "Close gates on tasks: close succeeds only when all required tasks are Done or Skipped; final Auto-task states are persisted"
- "Migration idempotent: running the migration SQL twice completes cleanly (IF NOT EXISTS / OR REPLACE guards)"
- "Types green: pnpm run generate:types, pnpm --filter @carbon/erp typecheck, pnpm --filter @carbon/database typecheck, and pnpm run lint all pass"
---

# Issue #1031: Accounting Period Close Lifecycle + Posted-Record Immutability + NetSuite Checklist

## What to build

Implement the Open → Locked → Closed accounting period lifecycle for Carbon, with:

1. DB trigger backstop (hard close enforcement at the DB layer; no code path can bypass)
2. Service-layer posting gate in `getOrCreateAccountingPeriod` (operational vs accounting source context)
3. Sequential close / reverse-sequential reopen rules
4. Fiscal-year identity (fiscalYear + periodNumber on accountingPeriod)
5. Posted-record immutability: posted journals allow only Posted→Reversed; journalLines frozen once parent posted; journalLine.createdBy added
6. NetSuite-style persisted close checklist (periodCloseTaskDefinition template + per-period periodCloseTask instances, 9 seeded system tasks)
7. Accounting Periods UI page at `/x/accounting/periods`

## Specs & Plans

The full spec and implementation plan are on the `period-closing-spec` branch (PR #1013). Fetch them before starting:

```bash
git fetch origin period-closing-spec
git show origin/period-closing-spec:.ai/specs/2026-07-02-period-closing.md > /tmp/period-closing-spec.md
git show origin/period-closing-spec:.ai/plans/2026-07-02-period-closing.md > /tmp/period-closing-plan.md
git show origin/period-closing-spec:.ai/specs/2026-07-04-accounting-implementation-meta.md > /tmp/accounting-meta.md
```

Read all three files before writing any code.

## Ground rules (from the plan)

- Do NOT regenerate or commit `packages/database/src/types.ts` — cloud-generated; use `(client.from("accountingPeriod") as any)` / `as unknown as` casts for new columns
- Do NOT rebuild the database; apply migrations with `pnpm db:migrate` only when the local stack is up
- Typecheck per package (e.g. `pnpm --filter @carbon/erp typecheck`), never whole-repo `tsc --noEmit`
- Commit only at the marked checkpoints after verification passes

## Key migration

Migration `20260702044133_period-close-lifecycle.sql` is ALREADY DRAFTED and exists on `period-closing-spec` branch at `packages/database/supabase/migrations/20260702044133_period-close-lifecycle.sql`. Fetch it:

```bash
git show origin/period-closing-spec:packages/database/supabase/migrations/20260702044133_period-close-lifecycle.sql
```

The Task 17 checklist DDL should be folded into this migration (since it hasn't been applied yet — preferred per addendum).

## Commit checkpoints

1. After Tasks 1–8 + 17 (backend) pass typecheck: `feat(accounting): period close lifecycle — schema, services, posting gates, checklist tables`
2. After Tasks 9–16 + 18–20 (UI + checklist) pass typecheck + lint: `feat(accounting): accounting periods page + NetSuite-style close checklist`

PR must reference: `Closes #1031`
