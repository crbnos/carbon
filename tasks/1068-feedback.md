# Task: PR #1068 Feedback — Accounting Period Close

## Objective
Address two actionable review comments from Brad (barbinbrad) on PR #1068:
https://github.com/crbnos/carbon/pull/1068

PR branch: `loop/1031`
Worktree: recreate from `origin/loop/1031`

## Comment 1 — Move utility to @carbon/utils (line 624)

Brad's comment: "let's move this to the util package"

The comment is on `apps/erp/app/modules/accounting/accounting.service.ts` around line 624 which contains:

```typescript
const MONTH_NUMBER: Record<string, number> = {
  January: 1, February: 2, March: 3, April: 4,
  May: 5, June: 6, July: 7, August: 8,
  September: 9, October: 10, November: 11, December: 12
};

function fiscalYearAndPeriodFor(
  date: Date,
  startMonth: number
): { fiscalYear: number; periodNumber: number } { ... }
```

**Action:** Move `MONTH_NUMBER` and `fiscalYearAndPeriodFor` to `packages/utils/src/accounting.ts` (already exists), export them, then import from `@carbon/utils` in `accounting.service.ts`. Update `packages/utils/src/index.ts` if needed.

## Comment 2 — Use Kysely transaction (lines 913–942)

CodeRabbit flagged the non-atomic writes in `closeAccountingPeriod`:
- Sequential Supabase calls: `periodCloseTask` updates in a loop, then `accountingPeriod` flip
- Non-atomic: partial failure leaves checklist state inconsistent with period state

Brad's reply: "We also have the ability to run transactions with the kysley client"

**Action:** Refactor the close path (the `for` loop of `periodCloseTask` updates + final `accountingPeriod` update) to use Kysely transactions.

Pattern from `invoicing.service.ts`:
```typescript
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
// db is the Kysely client from getDatabaseClient()
return db.transaction().execute(async (trx) => {
  await trx.updateTable("periodCloseTask")...
  await trx.updateTable("accountingPeriod")...
});
```

The function signature already has a `client: SupabaseClient` parameter for reads — the Kysely `db` client should be obtained inside the function via `getDatabaseClient()` (same pattern as invoicing.service.ts uses it).

Look at how `invoicing.service.ts` does it:
- imports `type { Kysely, KyselyDatabase } from "@carbon/database/client"`
- gets db client and uses `db.transaction().execute(async (trx) => { ... })`

Apply the same pattern for the close path writes.

## Working Context

- Fetch and recreate worktree from `origin/loop/1031`:
  ```bash
  cd /home/openclaw/carbon
  git fetch origin loop/1031
  git worktree add /home/openclaw/carbon-worktrees/loop-1031 loop/1031
  cd /home/openclaw/carbon-worktrees/loop-1031
  git merge origin/main
  ```

- Use **absolute paths** for all file references
- Use **pnpm**, never npm
- After changes: run typecheck at minimum (`pnpm --filter @carbon/erp exec tsc --noEmit` or `pnpm typecheck`)
- Then push to `loop/1031` — the PR will auto-update

## Done When
1. `MONTH_NUMBER` and `fiscalYearAndPeriodFor` exported from `@carbon/utils` (in `accounting.ts`), removed from `accounting.service.ts`, import updated
2. `closeAccountingPeriod` uses a Kysely transaction for the `periodCloseTask` loop + `accountingPeriod` update
3. TypeScript compiles clean on affected packages
4. Committed and pushed to `loop/1031`

## What I Need Back
- Confirmation that both changes are done and pushed
- Any blockers encountered (e.g. Kysely type issues, circular deps)
