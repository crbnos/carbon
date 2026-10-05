# Period runs hardening (revenue recognition and depreciation) — implementation plan

**Spec:** none. The decisions come from the conversation of 2026-10-04. The table below lists them.
**Research:** .ai/research/2026-10-04-netsuite-period-runs.md
**Branch:** revenue-recognition-rentals-spec

## Decisions (Brad, 2026-10-04)

| # | Decision | NetSuite precedent |
|---|---|---|
| D0 | Keep the uncommitted baseline: Recalculate on Draft runs, the out-of-date check at Post, and Draft-run sync on invoice void and contract credit memo. | ARM Estimate, re-runnable process |
| D1 | A posting makes a period Active only when the period contains the company's today. | The current period comes from the system date. |
| D2 | New, Repeat and Post refuse a run whose `periodEnd` is after the end of the company's current month. The current month stays allowed. | FAM "Allow Future-dated Depreciation" off |
| D3 | **Reverse Run** on a Posted run reverses its journals, resets the source records, and returns the run to Draft. Depreciation allows it only on the latest posted run. Generic journal reversal refuses run journals. | ARM void or delete makes plan lines recognizable again |
| D4 | A run posts one journal per month, each in that month's accounting period. If that month's period is Closed, that month posts in the run's own period. | FAM journal per period of depreciation |
| D5 | A revenue recognition period can have more than one run. Only one Draft per period exists at a time. | ARM "multiple times in a month" |

Terms used in this plan:

- **Month end**: the last day of a calendar month, `YYYY-MM-DD`.
- **Company today**: `datetime.today(await getCompanyTimeZone(client, companyId)).toString()`.
- **Current month end**: `endOfMonth(parseDate(companyToday)).toString()`.
- **Future run**: a run whose `periodEnd` is after the current month end.
- **Target date**: the posting date of a month's journal. It is the month end, or the run's `periodEnd` when the month's period is Closed.

## Progress

- [x] Task 0: Commit the baseline (shipped inside the contracts Phase B commit — the two share the posting files; see that commit's message)
- [x] Task 1: Make the server period resolver activate only today's period (deviation: `chargeFixture`'s one period spans 2000–2099, so the new test deletes it and inserts a current-month period first)
- [x] Task 2: Make the ERP period helper activate only today's period (deviation: the company today is read lazily, only when a period would change, so the mocked period tests need no `company` row)
- [x] Task 3: Add the pure helpers for future runs and target dates
- [x] Task 4: Refuse future runs in New, Repeat and Post (the check lives once in `futureRunPeriodError`, `accounting.server.ts`)
- [x] Task 5: Add the migration for per-month depreciation lines and one Draft per period (deviation: `periodEnd` stays NULLABLE — `db:check:backups` refused NOT NULL with no default; readers fall back to the run's `periodEnd`. Committed with Task 6, because the dataset check fails on the migration alone)
- [x] Task 6: Regenerate the database types and fix the dataset tier (also: `insertDepreciationRun` / `replaceDepreciationRunLines` write the run's `periodEnd` until Task 7)
- [x] Task 6b: Move the depreciation month arithmetic to `@internationalized/date` (found in Task 7; also corrected the existing test "uses lastPostedPeriodEnd to narrow the window", which pinned the skipped month)
- [x] Task 7: Build depreciation lines per asset per month (lines from before the migration read their run's `periodEnd`)
- [x] Task 8: Post depreciation one journal per line, dated per month
- [x] Task 9: Post revenue recognition one journal per month (contract ledger entries and lease schedule lines record their own month's journal)
- [x] Task 10: Show the period on depreciation lines and every journal in the Documents panels (also: Accum. Depr. / NBV After start a later month from the earlier months of the same asset)
- [x] Task 11: Allow more than one revenue recognition run per period
- [x] Task 12: Add Reverse Run for revenue recognition (also refuses while another Draft holds the period; resets contract ledger entries and revenue months)
- [ ] Task 13: Add Reverse Run for depreciation
- [ ] Task 14: Refuse generic reversal of run journals
- [ ] Task 15: Update AGENTS.md and the fixed-asset rule
- [ ] Task 16: Verify in the browser

## Dependencies

- Task 0 comes first.
- Tasks 1, 2 and 3 are independent of each other.
- Task 4 needs Task 3.
- Task 6 needs Task 5. Tasks 7, 8, 10 and 13 need Task 6.
- Task 8 needs Tasks 3 and 7. Task 9 needs Task 3.
- Task 10 needs Tasks 8 and 9.
- Task 11 needs Task 6 (the unique index).
- Task 12 needs Task 9. Task 13 needs Task 8.
- Task 14 needs Tasks 12 and 13.
- Tasks 15 and 16 come last.

---

## Task 0: Commit the baseline

**Depends on:** none
**Files:**
- Modify: none. The baseline is already in the working tree.

**Steps:**
1. Run `git status --short`. Confirm that git lists `apps/erp/app/modules/sales/ui/useSalesSubmodules.tsx` as modified.
2. Run the `/check-and-commit` skill.
3. Exclude `apps/erp/app/modules/sales/ui/useSalesSubmodules.tsx` from the commit. Another session owns that change.
4. Use the message `feat(accounting): recalculate draft period runs and refuse out-of-date posts`.

**Verify:**
```bash
git show --stat HEAD | grep -c useSalesSubmodules
# Expected: 0
git status --short apps/erp/app/modules/sales/ui/useSalesSubmodules.tsx
# Expected: " M apps/erp/app/modules/sales/ui/useSalesSubmodules.tsx" (still uncommitted)
```

**Out of scope:** any change to `useSalesSubmodules.tsx`.

---

## Task 1: Make the server period resolver activate only today's period

**Depends on:** Task 0
**Files:**
- Modify: `packages/server-functions/src/lib/get-accounting-period.ts` — `resolveAccountingPeriod`, the `mode === "current"` block (line 157)
- Modify: `packages/server-functions/src/post-charge/get-accounting-period.test.ts` — the test "period creation uses the fiscal start and leap-month boundary"

**Steps:**
1. In `resolveAccountingPeriod`, select `sql<string>\`"endDate"::text\`.as("endDate")` beside `startDate` in the `periods` query.
2. Before the `mode === "current"` block, compute the company today: `datetime.today(await getCompanyTimeZone(db, companyId)).toString()`.
3. Change the condition to `mode === "current" && period.status !== "Active" && period.startDate <= today && period.endDate >= today`.
4. Update the comment above the function: a posting dated in another month leaves the Active period alone.
5. In the test "period creation uses the fiscal start and leap-month boundary", change the expected `status` to `"Inactive"`. The date 2024-02-29 is not today.
6. Add a `databaseTest` named "a posting dated in another month leaves the Active period alone":
   1. Use `chargeFixture()`.
   2. Read the id of the period that has `status = 'Active'`.
   3. Call `getCurrentAccountingPeriod(f.companyId, f.db, "2024-02-29")`.
   4. Expect the same period to be still `Active`.
   5. Expect the 2024-02 period to be `Inactive`.

**Verify:**
```bash
cd packages/server-functions && SUPABASE_DB_URL="$(grep -h '^SUPABASE_DB_URL' ../../.env.local | cut -d= -f2- | tr -d '"')" pnpm exec vitest run src/post-charge/get-accounting-period.test.ts
# Expected: all tests pass, none skipped
```

**Out of scope:** the intercompany elimination SQL (`20260816162947`, `20260817122328`). It already activates only the period that contains today.

If `chargeFixture` has no Active period, STOP and report — do not improvise.

---

## Task 2: Make the ERP period helper activate only today's period

**Depends on:** Task 0
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — `getOrCreateAccountingPeriod` (line 2348)

**Steps:**
1. At the top of `getOrCreateAccountingPeriod`, compute the company today with `getCompanyTimeZone(client, companyId)` and `datetime.today(tz)`. Both imports already exist in this file; confirm with grep.
2. Set `isCurrent` to true when `date.slice(0, 10)` and the company today fall in the same month. Compare the `startOfMonth(parseDate(...)).toString()` of each.
3. In the existing-period branch, run the two Active updates only when `isCurrent` is true.
4. In the create branch, run the "demote the Active period" update only when `isCurrent` is true.
5. In the create branch, insert `status: isCurrent ? "Active" : "Inactive"`.
6. Add a doc comment: "Only a posting in the company's current month changes the Active period."

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: Tasks: 2 successful
cd apps/erp && pnpm exec vitest run app/modules/accounting/accounting.periods.test.ts
# Expected: all tests pass
```

**Out of scope:** the `closeStatus` gates in the same function. They stay as they are.

If the mocked clients in `accounting.periods.test.ts` fail on the new `getCompanyTimeZone` read, add the `company` row to each mock. Do not remove a test.

---

## Task 3: Add the pure helpers for future runs and target dates

**Depends on:** Task 0
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.utils.ts`
- Modify: `apps/erp/app/modules/accounting/accounting.utils.test.ts`

**Steps:**
1. Add `isFutureRunPeriod(periodEnd: string, companyToday: string): boolean`. It returns `periodEnd > endOfMonth(parseDate(companyToday)).toString()`.
2. Add `monthEndOf(date: string): string`. It returns `endOfMonth(parseDate(date.slice(0, 10))).toString()`.
3. Add `runPostingTargets(args)`:
   - Input: `months: string[]` (month ends), `runPeriodEnd: string`, `closedMonths: Set<string>` (month ends whose period is Closed).
   - Output: `Map<string, string>`, month end → target date.
   - Rule: a month in `closedMonths` maps to `runPeriodEnd`. Every other month maps to itself.
4. Add tests:
   - `isFutureRunPeriod("2026-10-31", "2026-10-04")` is `false`.
   - `isFutureRunPeriod("2026-11-30", "2026-10-04")` is `true`.
   - `isFutureRunPeriod("2026-09-30", "2026-10-04")` is `false`.
   - `runPostingTargets` with months Aug, Sep, Oct, run Oct, Aug closed gives Aug → Oct, Sep → Sep, Oct → Oct.

**Verify:**
```bash
cd apps/erp && pnpm exec vitest run app/modules/accounting/accounting.utils.test.ts
# Expected: all tests pass
```

**Out of scope:** `getNextPeriodEnd` and `getNextRevenueRecognitionPeriodEnd`. They do not change.

---

## Task 4: Refuse future runs in New, Repeat and Post

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/routes/x+/accounting+/revenue-recognition-runs.new.tsx`
- Modify: `apps/erp/app/routes/x+/revenue-recognition-run+/$runId.repeat.tsx`
- Modify: `apps/erp/app/routes/x+/revenue-recognition-run+/$runId.post.tsx`
- Modify: `apps/erp/app/routes/x+/accounting+/depreciation-runs.new.tsx`
- Modify: `apps/erp/app/routes/x+/depreciation-run+/$depreciationRunId.post.tsx`
- Modify: `packages/server-functions/src/propose-revenue-recognition-run/index.ts`
- Modify: `apps/erp/app/routes/x+/revenue-recognition-run+/$runId.tsx` — loader returns `canRepeat`
- Modify: `apps/erp/app/modules/accounting/ui/RevenueRecognition/RevenueRecognitionRunHeader.tsx` — show Repeat Run only when `canRepeat`

**Steps:**
1. In each of the 5 routes, compute the company today after `requirePermissions`.
2. In each route, after the route knows `periodEnd`, call `isFutureRunPeriod(periodEnd, companyToday)`.
3. If it returns `true`, throw a redirect with this flash error: "{Month Year} has not started yet. A run can cover the current month or an earlier one." Format the month with `formatDate(periodEnd, { month: "long", year: "numeric" })`.
4. In `proposeRevenueRecognitionRun` (`run`), read the company today with `getCompanyTimeZone(db, companyId)`. If the period is a future run, throw `InvalidInputError` with the same text. This guards the monthly job too.
5. Copy the date check as a small inline comparison in the server function. `@carbon/server-functions` cannot import ERP utils.
6. In the run page loader, return `canRepeat: !isFutureRunPeriod(getNextPeriodEnd(run.data.periodEnd), companyToday)`.
7. In `RevenueRecognitionRunHeader`, render the Repeat Run menu item only when `isPosted && canRepeat`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/server-functions
# Expected: Tasks: 3 successful
cd packages/server-functions && SUPABASE_DB_URL="$(grep -h '^SUPABASE_DB_URL' ../../.env.local | cut -d= -f2- | tr -d '"')" pnpm exec vitest run src/recalculate-revenue-recognition-run src/post-memo
# Expected: all tests pass
```

**Out of scope:** the depreciation Repeat route. It repeats the period of a run that is already posted, so it cannot create a future run by itself.

---

## Task 5: Add the migration for per-month depreciation lines and one Draft per period

**Depends on:** Task 0
**Files:**
- Create: the migration from `pnpm db:migrate:new period-run-months`

**Steps:**
1. Run `pnpm db:migrate:new period-run-months`.
2. Write this SQL into the new file:

```sql
-- One depreciation run line per asset per month (FAM's depreciation history
-- record). A catch-up run posts each month in its own accounting period.
ALTER TABLE "depreciationRunLine" ADD COLUMN IF NOT EXISTS "periodEnd" DATE;

UPDATE "depreciationRunLine" l
SET "periodEnd" = r."periodEnd"
FROM "depreciationRun" r
WHERE r."id" = l."depreciationRunId"
  AND l."periodEnd" IS NULL;

ALTER TABLE "depreciationRunLine" ALTER COLUMN "periodEnd" SET NOT NULL;

-- The deferred tax journal of the line's month. Reverse Run reads it.
ALTER TABLE "depreciationRunLine" ADD COLUMN IF NOT EXISTS "deferredTaxJournalId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'depreciationRunLine_deferredTaxJournalId_fkey'
  ) THEN
    ALTER TABLE "depreciationRunLine"
      ADD CONSTRAINT "depreciationRunLine_deferredTaxJournalId_fkey"
      FOREIGN KEY ("deferredTaxJournalId") REFERENCES "journal" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "depreciationRunLine_deferredTaxJournalId_idx"
  ON "depreciationRunLine" ("deferredTaxJournalId");

-- Before this migration a run posted one deferred tax journal, named only by
-- its description. Link it to the run's lines.
UPDATE "depreciationRunLine" l
SET "deferredTaxJournalId" = j."id"
FROM "depreciationRun" r, "journal" j
WHERE r."id" = l."depreciationRunId"
  AND j."companyId" = r."companyId"
  AND j."sourceType" = 'Asset Depreciation'
  AND j."description" = 'Deferred Tax: Depreciation ' || r."depreciationRunId"
  AND l."deferredTaxJournalId" IS NULL;

-- A revenue recognition period can have more than one run, but one Draft at a
-- time.
CREATE UNIQUE INDEX IF NOT EXISTS "revenueRecognitionRun_one_draft_per_period"
  ON "revenueRecognitionRun" ("companyId", "periodEnd")
  WHERE "status" = 'Draft';
```

3. Run `pnpm db:migrate`.

**Verify:**
```bash
pnpm db:migrate
# Expected: the new migration applies with no error
```

If the unique index fails because 2 Drafts share a period, STOP and report the duplicate runs — do not delete them.

**Out of scope:** RLS. Both tables keep their policies.

---

## Task 6: Regenerate the database types and fix the dataset tier

**Depends on:** Task 5
**Files:**
- Modify (generated): `packages/database/src/types.ts` and siblings, via the command
- Modify: `packages/database/src/datasets/tiers/09-accounting.ts` — the `depreciationRunLine` insert (line 491)

**Steps:**
1. Run `pnpm run generate:types`.
2. In tier 09, add `periodEnd: previousMonthEnd(ctx.anchor)` to the `depreciationRunLine` insert. It equals the run's `periodEnd`.
3. Run `pnpm db:check:datasets`.
4. Run `pnpm db:check:backups`.

**Verify:**
```bash
grep -c '"periodEnd"\|periodEnd:' packages/database/src/types.ts
# Expected: a count higher than before the command
pnpm db:check:datasets
# Expected: every dataset passes
pnpm db:check:backups
# Expected: no backup is reported as unrestorable
```

**Out of scope:** hand edits to `packages/database/src/types.ts`.

---

## Task 6b: Move the depreciation month arithmetic to `@internationalized/date`

**Depends on:** Task 6
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.utils.ts` — `addOneMonth`, `getMonthsBetween`, `getMonthsElapsed`, `calculateDepreciation`, `calculateTaxDepreciation`, `calculateMacrsDepreciation`
- Modify: `apps/erp/app/modules/accounting/accounting.utils.test.ts`

Task 7 found 2 defects that already reach production:

| Defect | Effect |
|---|---|
| `addOneMonth` calls `setMonth` before `setDate(1)`, so Aug 31 + 1 month is Oct 1. | After a run for a 31-day month, the next shorter month gets 0 months of depreciation. On a UTC server that is February, April, June, September and November. |
| The helpers parse `YYYY-MM-DD` with `new Date`, which `.claude/rules/date-handling.md` bans. | West of UTC, Jan 1 reads as Dec 31. MACRS tax years then shift by one year. |

**Steps:**
1. Write the failing tests first:
   1. `addOneMonth("2026-08-31")` is the first of September.
   2. `calculateDepreciation` charges 1 month for `2026-09-30` after `2026-08-31` for a Straight Line asset.
   3. A MACRS asset in service on Jan 1 takes its year-1 percentage in January.
2. Run them with `TZ=UTC` and with `TZ=America/New_York`. Expect both to fail.
3. Make `addOneMonth(date: string)` return `startOfMonth(parseDate(date)).add({ months: 1 })`.
4. Make `getMonthsBetween` and `getMonthsElapsed` take `CalendarDate` values. Read `year`, `month` and `day` from them.
5. In the 3 calculate functions, parse every date with `parseDate(value.slice(0, 10))`.
6. Compare dates with `compare`, not with `>`.
7. In `calculateMacrsDepreciation`, replace `getMonth()` with `month - 1` and `getFullYear()` with `year`.
8. Update the existing tests that pass `new Date(...)` to pass `parseDate(...)`.

**Verify:**
```bash
cd apps/erp && TZ=UTC pnpm exec vitest run app/modules/accounting/accounting.utils.test.ts
# Expected: the 3 new tests pass; the Task 7 tests still in the tree are allowed to fail
cd apps/erp && TZ=America/New_York pnpm exec vitest run app/modules/accounting/accounting.utils.test.ts
# Expected: the same result as under TZ=UTC
```

**Out of scope:** posted runs that lost months. A catch-up for them is a separate decision.

---

## Task 7: Build depreciation lines per asset per month

**Depends on:** Task 6
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.utils.ts` — `DepreciationLine`, `buildDepreciationLines`, `depreciationRunLinesMatch`
- Modify: `apps/erp/app/modules/accounting/accounting.server.ts` — `buildDepreciationRunLines`, `replaceDepreciationRunLines`
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — `insertDepreciationRun` writes `periodEnd`
- Modify: `apps/erp/app/modules/accounting/accounting.utils.test.ts`

**Steps:**
1. Add `periodEnd: string` to `DepreciationLine`.
2. Change the `usageMap` argument of `buildDepreciationLines` to `Map<string, number>`. The key is `${fixedAssetId}|${monthEnd}`.
3. In `buildDepreciationLines`, list the month ends from the asset's first month to `periodEnd`:
   - The first month is the month after `lastPostedPeriodEnd`.
   - If `lastPostedPeriodEnd` is null, the first month is the month of `depreciationStartDate ?? acquisitionDate`.
4. For each month, call `calculateDepreciation(asset, monthEnd, previousMonthEnd, decimalPlaces, usage)`:
   - `previousMonthEnd` is the month end before it, or `lastPostedPeriodEnd` for the first month.
   - For the asset's first month with no posted run, pass `null`.
   - `usage` is `{ unitsProduced: usageMap.get(key) ?? 0 }`.
5. After each month, add the month's amount to a local copy of `accumulatedDepreciation`.
6. Do the same for `calculateTaxDepreciation`, with a local copy of `accumulatedTaxDepreciation`.
7. Push one line per month when `amount > 0` or `taxAmount > 0`.
8. In `buildDepreciationRunLines`, build the usage map per month. Key each usage log by `monthEndOf(log.periodEnd)`. Select `periodEnd` from `fixedAssetUsageLog`.
9. Make `depreciationRunLinesMatch` key lines by `${fixedAssetId}|${periodEnd}`. Add `periodEnd` to its `stored` type.
10. Write `periodEnd` in `insertDepreciationRun` and in `replaceDepreciationRunLines`.
11. In the post route, add `periodEnd` to the `depreciationRunLine` select that feeds `depreciationRunLinesMatch`.
12. Add tests:
    - A Straight Line asset with 3 months since the last posted run gives 3 lines. Their sum equals the old 3-month amount.
    - A Declining Balance asset gives 3 lines. Each line is smaller than the one before.
    - A Units of Production asset with logs in 2 of 3 months gives 2 lines.
    - A MACRS asset with bonus depreciation takes the bonus in the first month only.
    - `depreciationRunLinesMatch` is `false` when the same asset has a different `periodEnd`.

**Verify:**
```bash
cd apps/erp && pnpm exec vitest run app/modules/accounting/accounting.utils.test.ts
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=erp
# Expected: Tasks: 2 successful
```

If a split month total differs from the old span total by more than one minor unit for Straight Line, STOP and report — do not improvise.

**Out of scope:** `calculateDepreciation` and `calculateTaxDepreciation` themselves. Call them per month; do not change them.

---

## Task 8: Post depreciation one journal per line, dated per month

**Depends on:** Tasks 3 and 7
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.server.ts` — `postDepreciationRun`, add `resolveRunPostingPeriods`
- Modify: `apps/erp/app/routes/x+/depreciation-run+/$depreciationRunId.post.tsx`

**Steps:**
1. Add `resolveRunPostingPeriods(client, { companyId, monthEnds, runPeriodEnd })` to `accounting.server.ts`:
   1. Read the `accountingPeriod` rows that overlap `[min(monthEnds) start, runPeriodEnd]` in one query.
   2. Put each month whose row is Closed (`closeStatus = 'Closed'` or `closedAt` not null) into `closedMonths`.
   3. Call `runPostingTargets` to get each month's target date.
   4. For each distinct target date, call `getOrCreateAccountingPeriod(client, companyId, target, "accounting")`.
   5. Return `Map<monthEnd, { accountingPeriodId, postingDate }>`, or the first error.
2. Note in a comment that the loop in step 1.4 runs once per distinct month, not per line.
3. In the post route, replace the single `getOrCreateAccountingPeriod` call with `resolveRunPostingPeriods`. Pass the distinct `periodEnd` values of the lines.
4. Change `postDepreciationRun` to take `periods: Map<string, { accountingPeriodId: string; postingDate: string }>` instead of `postingDate` and `accountingPeriodId`.
5. Add `periodEnd` to the `DepreciationRunLine` type in `accounting.server.ts`.
6. For each line, post its journal with the period and posting date of `periods.get(line.periodEnd)`.
7. Sum the amounts per asset before the asset update. Run one `fixedAsset` update per asset with the summed book and tax amounts. The current code adds each line to the same starting value, which loses all but the last month.
8. Compute the deferred tax per month group. Post one deferred tax journal per month, dated with that month's period.
9. Set `deferredTaxJournalId` on every line of that month to the month's deferred tax journal.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: Tasks: 2 successful
cd apps/erp && pnpm exec vitest run app/modules/accounting
# Expected: all tests pass
```

**Out of scope:** the journal line accounts and dimensions. They stay as they are.

---

## Task 9: Post revenue recognition one journal per month

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.server.ts` — `postRevenueRecognitionRun`
- Modify: `apps/erp/app/routes/x+/revenue-recognition-run+/$runId.post.tsx`

**Steps:**
1. In the post route, read the distinct month ends of the run's schedule rows. Use one query on `revenueRecognitionRunLine` with an embed of `scheduledDate`.
2. Call `resolveRunPostingPeriods` from Task 8 with those month ends and the run's `periodEnd`.
3. Change `postRevenueRecognitionRun` to take `periods` (the same map type) instead of `accountingPeriodId` and `postingDate`.
4. In `postRevenueRecognitionRun`, select `s.scheduledDate` in the `rows` query.
5. Group the rows by the target date of `monthEndOf(scheduledDate)`. Months that share a target date go into one journal.
6. For each group, insert one journal with that group's period and posting date. Build its lines with the existing per-row code.
7. Set `journalId` on each schedule row to its group's journal.
8. Set `rentalLeaseScheduleLine.journalId` from the journal of the row that references it.
9. Set `revenueRecognitionRun.journalId` to the journal whose posting date is the run's `periodEnd`. If no group has that date, use the journal with the latest posting date.
10. Keep the out-of-date check from the baseline before the first insert.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: Tasks: 2 successful
```

**Out of scope:** the account and dimension rules of each line. They stay as they are.

---

## Task 10: Show the period on depreciation lines and every journal in the Documents panels

**Depends on:** Tasks 8 and 9
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — `getDepreciationRunLines` selects `periodEnd` and `deferredTaxJournalId`; `getJournalEntryRelatedItems` (the `"Revenue Recognition"` branch near line 5948)
- Modify: `apps/erp/app/routes/x+/depreciation-run+/$depreciationRunId.tsx` — journal ids include `deferredTaxJournalId`; the lines table shows a Period column
- Modify: `apps/erp/app/routes/x+/revenue-recognition-run+/$runId.tsx` — pass the distinct `schedule.journalId` values to `getPeriodRunRelatedItems`
- Copy from (precedent): the Period column of `apps/erp/app/routes/x+/revenue-recognition-run+/$runId.tsx` (the Deferrals table)

**Steps:**
1. In `getDepreciationRunLines`, add `periodEnd, deferredTaxJournalId` to the select. Order by `periodEnd`.
2. In the depreciation run page, add a Period column that shows `formatDate(line.periodEnd)`. Copy the column markup from the revenue recognition run page.
3. In the depreciation run loader, collect both `journalId` and `deferredTaxJournalId`, without duplicates.
4. In the revenue recognition run loader, collect the distinct `schedule.journalId` values from `lines`. Pass them instead of `[run.data.journalId]`.
5. In `getJournalEntryRelatedItems`, change the `"Revenue Recognition"` lookup:
   1. Read `revenueRecognitionSchedule` rows with `journalId = journal.id`.
   2. Embed the run through `runLineId`.
   3. Return each run once.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: Tasks: 2 successful
```

**Out of scope:** the `MAX_LISTED_JOURNALS` cap on the depreciation page. Keep it.

---

## Task 11: Allow more than one revenue recognition run per period

**Depends on:** Task 6
**Files:**
- Modify: `apps/erp/app/routes/x+/accounting+/revenue-recognition-runs.new.tsx` — the "existing run" check (line 55)
- Modify: `apps/erp/app/routes/x+/revenue-recognition-run+/$runId.repeat.tsx` — the "existing run" check
- Modify: `packages/jobs/src/inngest/functions/scheduled/revenue-recognition-proposal.ts` — the `existing` query
- Modify: `packages/server-functions/src/propose-revenue-recognition-run/index.ts` — `createRevenueRecognitionRunProposal`

**Steps:**
1. In both routes, add `.eq("status", "Draft")` to the existing-run query.
2. If a Draft exists, redirect to that Draft with the flash error: "{runId} is already a draft for this period. Recalculate it instead."
3. In the job, add `.where("status", "=", "Draft")` to the `existing` query. Change the log text to "a draft run for {periodEnd} already exists".
4. In `createRevenueRecognitionRunProposal`, read a Draft for the same `companyId` and `periodEnd` before the insert.
5. If one exists, throw `InvalidInputError` with the same text as step 2. The unique index from Task 5 is the backstop.
6. Add a `databaseTest` in `packages/server-functions/src/recalculate-revenue-recognition-run/recalculate-revenue-recognition-run.test.ts`:
   1. Hold one row in a run with `holdInDraftRun`.
   2. Set that run to `Posted`.
   3. Insert a second due row for the same month.
   4. Call `proposeRevenueRecognitionRun` for the same `periodEnd`.
   5. Expect a second run with 1 line.

**Verify:**
```bash
cd packages/server-functions && SUPABASE_DB_URL="$(grep -h '^SUPABASE_DB_URL' ../../.env.local | cut -d= -f2- | tr -d '"')" pnpm exec vitest run src/recalculate-revenue-recognition-run
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/jobs --filter=@carbon/server-functions
# Expected: every task successful
```

**Out of scope:** depreciation. Its Repeat route already adds a run for the same period.

---

## Task 12: Add Reverse Run for revenue recognition

**Depends on:** Task 9
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.server.ts` — add `reverseRevenueRecognitionRun` and `reverseRunJournals`
- Create: `apps/erp/app/routes/x+/revenue-recognition-run+/$runId.reverse.tsx`
- Modify: `apps/erp/app/utils/path.ts` — add `reverseRevenueRecognitionRun` after `reverseJournalEntry`
- Modify: `apps/erp/app/modules/accounting/ui/RevenueRecognition/RevenueRecognitionRunHeader.tsx` — a Reverse Run menu item and its Confirm
- Modify: `packages/server-functions/src/post-sales-invoice/index.ts` — the message "Invoice has recognized revenue; reverse the recognition journal first"
- Copy from (precedent): the Reverse menu item and Confirm in `apps/erp/app/modules/accounting/ui/JournalEntries/JournalEntryHeader.tsx` (lines 91 and 153)

**Steps:**
1. Add `reverseRunJournals(trx, { journalIds, periods, companyId, userId })` to `accounting.server.ts`. For each journal:
   1. Read the journal, its lines and their `journalLineDimension` rows in 3 queries for all journals together.
   2. Insert a Posted journal with `reversalOfId` = the original id and the original `sourceType`.
   3. Use `periods.get(original.postingDate)` for its period and posting date.
   4. Insert the lines with negated `amount`, the same `accountId`, `documentType`, `documentId` and `description`.
   5. Copy each line's dimensions onto its negated line.
   6. Set the original to `status = 'Reversed'` and `reversedById` = the new id.
2. Add `reverseRevenueRecognitionRun(db, { runId, periods, companyId, userId })`. In one transaction:
   1. Lock the run `FOR UPDATE`. Refuse unless it is Posted.
   2. Read the distinct `journalId` values of its schedule rows.
   3. Call `reverseRunJournals`.
   4. Set the run's schedule rows to `status = 'Planned'`, `journalId = null`. Keep `runLineId`.
   5. Set `rentalLeaseScheduleLine.journalId = null` and `postedAt = null` where `journalId` is one of the reversed journals.
   6. Set the run to `status = 'Draft'`, `journalId = null`, `postedAt = null`, `postedBy = null`.
3. In the route, build `periods` for the original posting dates:
   - If the original's period is not Closed, the reversal uses the original posting date.
   - If it is Closed, the reversal uses the company today.
   - Resolve each distinct date with `getOrCreateAccountingPeriod(..., "accounting")`.
4. Require `update: accounting` in the route. On success, redirect to the run with "Reversed {runId}. It is a draft again."
5. In the header, add a destructive Reverse Run menu item for Posted runs. Copy the Confirm from `JournalEntryHeader`. Text: "This will reverse the journals of {runId} and return it to Draft. You can then recalculate, post or delete it."
6. Change the post-sales-invoice message to "Invoice has recognized revenue; reverse its revenue recognition run first".

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/server-functions
# Expected: every task successful
```

If the `journal_posted_immutable` trigger refuses the `Reversed` update, STOP and report — do not disable the trigger.

**Out of scope:** the generic `reverseJournalEntry`. Task 14 changes it.

---

## Task 13: Add Reverse Run for depreciation

**Depends on:** Task 8
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.server.ts` — add `reverseDepreciationRun`
- Create: `apps/erp/app/routes/x+/depreciation-run+/$depreciationRunId.reverse.tsx`
- Modify: `apps/erp/app/utils/path.ts` — add `reverseDepreciationRun`
- Modify: `apps/erp/app/modules/accounting/ui/FixedAssets/DepreciationRunHeader.tsx` — a Reverse Run menu item and its Confirm
- Copy from (precedent): the Task 12 route and header item

**Steps:**
1. Add `reverseDepreciationRun(db, { depreciationRunId, periods, companyId, userId })`. In one transaction:
   1. Lock the run `FOR UPDATE`. Refuse unless it is Posted.
   2. If a Posted run has a later `periodEnd`, refuse: "{later run} is posted for a later period and builds on this run. Reverse it first."
   3. Read the lines with their assets.
   4. If any asset is `Disposed`, refuse: "{fixedAssetId} was disposed after this run. Reverse the disposal first."
   5. Collect the distinct `journalId` and `deferredTaxJournalId` values. Call `reverseRunJournals` from Task 12.
   6. Sum the book and tax amounts per asset.
   7. Subtract the sums from `accumulatedDepreciation` and `accumulatedTaxDepreciation`, one update per asset.
   8. If an asset is `Fully Depreciated` and its new net book value is above its residual value, set it to `Active`.
   9. Set every line's `journalId` and `deferredTaxJournalId` to null.
   10. Set the run to `status = 'Draft'`, `postedAt = null`, `postedBy = null`.
2. Build `periods` in the route the same way as Task 12, step 3.
3. Add the header menu item and Confirm the same way as Task 12, step 5.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: Tasks: 2 successful
```

**Out of scope:** disposal reversal. A disposed asset blocks the reversal; it does not undo the disposal.

---

## Task 14: Refuse generic reversal of run journals

**Depends on:** Tasks 12 and 13
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — `reverseJournalEntry` (line 6511)
- Modify: `apps/erp/app/routes/x+/journal-entry+/$journalEntryId.reverse.tsx` — show the error message
- Modify: `apps/erp/app/modules/accounting/ui/JournalEntries/JournalEntryHeader.tsx` — hide Reverse for these source types

**Steps:**
1. In `reverseJournalEntry`, after the Posted check, refuse when `original.data.sourceType` is `"Revenue Recognition"` or `"Asset Depreciation"`.
2. Use the message: "This journal belongs to a {revenue recognition | depreciation} run. Reverse the run instead, so its schedule and assets stay correct."
3. In the reverse route, flash `result.error.message` when it is set.
4. In `JournalEntryHeader`, render the Reverse menu item only when `sourceType` is not one of the 2 types.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: Tasks: 2 successful
```

**Out of scope:** other system source types. They keep the generic reversal.

---

## Task 15: Update AGENTS.md and the fixed-asset rule

**Depends on:** Tasks 1–14
**Files:**
- Modify: `apps/erp/app/modules/accounting/AGENTS.md` — the Revenue recognition paragraph and the functions list
- Modify: `.claude/rules/fixed-asset-lifecycle.md` — `depreciationRunLine`, the routes list, and the "What a run should hold" bullet

**Steps:**
1. Describe D1 to D5 in each file, one or two sentences each.
2. Name the new functions: `resolveRunPostingPeriods`, `reverseRunJournals`, `reverseRevenueRecognitionRun`, `reverseDepreciationRun`.
3. Name the new columns: `depreciationRunLine.periodEnd` and `depreciationRunLine.deferredTaxJournalId`.
4. Name the index `revenueRecognitionRun_one_draft_per_period`.

**Verify:**
```bash
grep -c "reverseDepreciationRun\|deferredTaxJournalId" apps/erp/app/modules/accounting/AGENTS.md .claude/rules/fixed-asset-lifecycle.md
# Expected: at least 1 in each file
```

**Out of scope:** the docs site under `docs/`.

---

## Task 16: Verify in the browser

**Depends on:** Tasks 0–15
**Files:** none

**Steps:**
1. Ask Brad for permission to use the browser on his dev data.
2. Run `/test` with these cases:
   1. A revenue recognition run for a future month refuses with "has not started yet".
   2. Posting a run for a past month leaves the Active period on the current month.
   3. A catch-up depreciation run over 2 months posts 2 journals, each in its own period.
   4. Reverse Run on a posted revenue recognition run returns it to Draft. Its rows are Planned.
   5. Reverse Run on the latest posted depreciation run restores the asset's accumulated depreciation.
   6. A second revenue recognition run for a posted period picks up a newly due row.
   7. The Reverse menu item is absent on a run journal's page.
3. Run `/check-and-commit` with the message `feat(accounting): per-month period runs, reverse run, today-only active period`.

**Verify:**
```bash
# The /test report lists all 7 cases as passed.
```

**Out of scope:** fixing Brad's current RR000002 and December data. Brad decides that after the browser check.
