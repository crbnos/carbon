# Task: Address PR #1068 Review Feedback

## Context
PR #1068 (`loop/1031`) — Accounting period close lifecycle + posted-record immutability + close checklist
Branch: `loop/1031`
PR: https://github.com/crbnos/carbon/pull/1068
Issue: #1031

The PR has been open since ~2026-07-05 with review feedback from Brad and CodeRabbit. All feedback was addressed except two Brad comments + several CodeRabbit Major items. Both Brad comments landed on 2026-07-05. Acknowledged in thread; now implement.

## Feedback to Address

### 1. Human (Brad) — Move MONTH_NUMBER to util package [REQUIRED]
- **File:** `apps/erp/app/modules/accounting/accounting.service.ts`
- **Comment:** "let's move this to the util package"
- **What it is:** A `MONTH_NUMBER: Record<string, number>` map (January→1 through December→12) defined inline in the accounting service
- **Action:** Move this constant to `packages/utils/src/` — either into the existing `date.ts` or as a new export. Export it from `packages/utils/src/index.ts`. Import it in `accounting.service.ts`.
- The utils package is `@carbon/utils`.

### 2. Human (Brad) — Use Kysely transactions [REQUIRED]
- **File:** `apps/erp/app/modules/accounting/accounting.service.ts`
- **Comment:** "We also have the ability to run transactions with the kysley client"
- **Context:** The `closeAccountingPeriod` function currently does sequential Supabase calls (for-loop updating each `periodCloseTask`, then updating `accountingPeriod`). These are not atomic — if the final `accountingPeriod` update fails, tasks are already updated.
- **Action:** Refactor `closeAccountingPeriod` (and `lockAccountingPeriod`, `unlockAccountingPeriod` if they also do multi-step mutations) to use `db.transaction().execute(async (trx) => {...})` for atomicity.
- **Pattern:** See `apps/erp/app/modules/invoicing/invoicing.service.ts`, `apps/erp/app/modules/shared/shared.service.ts`, `apps/erp/app/modules/quality/quality.server.ts` for the established Kysely transaction pattern.
- **Kysely db client:** `apps/erp/app/services/database.server.ts` exports the db singleton. Import it as `import { db } from "~/services/database.server"` (or check how other service files import it).
- NOTE: The accounting service currently uses the Supabase client pattern (passed in as `client`). When refactoring to Kysely, you'll need to also port the queries to Kysely syntax, OR use a hybrid: keep read-only queries on supabase client, use a Kysely transaction for the write mutations. Check how the codebase handles this — prefer consistency with other service files.

### 3. CodeRabbit Major — Auto-task state + period flip not atomic [REQUIRED]
- This is exactly what item 2 addresses — the sequential `periodCloseTask` updates + `accountingPeriod` update in `closeAccountingPeriod`. The Kysely transaction refactor resolves this.

### 4. CodeRabbit Major — Custom Auto checklist tasks always resolve as passing [REQUIRED]
- **File:** `apps/erp/app/modules/accounting/accounting.service.ts`
- **Issue:** `computePeriodReadiness` only implements evaluators for `draft-journals`, `tb-balanced`, `draft-depreciation`, and `unmatched-ic`. Any other checklist task type (including seeded Blocker/Warning tasks) always resolves as "passing" by default — they should resolve as "manual" (requiring human completion), not auto-passing.
- **Action:** Fix the fallback/default case in `computePeriodReadiness` so unknown task types are treated as manual tasks (status remains whatever was set, don't auto-mark as Done/passing).

### 5. CodeRabbit Minor (correctness) — Escape `$periodId` in verification command
- **File:** `.ai/runs/1031-resume/binding.loop.md`  
- Minor — escape the filename in the verification command. If it's just a binding file (not shipped code), this might not matter. Check if it's part of the shipped artifact or just agent scaffolding.

### 6. CodeRabbit Major — Button type attribute in form
- **File:** `apps/erp/app/routes/x+/accounting+/periods.$periodId.close.tsx`
- **Issue:** Buttons without explicit `type="button"` in a form default to `type="submit"`, which can cause unintended form submission. Add `type="button"` to non-submit buttons in the close form.

## Pre-flight
- Re-entry on same branch: `loop/1031`
- Merge origin/main first before implementing
- Run typecheck, lint after changes
- All changes on the existing PR branch (same PR #1068 auto-updates)

## What I Need Back
- All 6 items addressed (or explicit skip with reason for items 3+)
- Clean typecheck + lint
- PR #1068 updated with new commits
- Reply here with what was done / what was skipped and why
