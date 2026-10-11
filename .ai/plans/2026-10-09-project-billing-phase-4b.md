# Project Billing Phase 4b — revenue — implementation plan

**Spec:** .ai/specs/2026-10-09-project-billing.md (Phase 4b, *Revenue and WIP relief*, decisions 2–5, 12, 17–18, Open Questions Q1)
**Research:** .ai/research/projects-wbs-pmmo.md (patterns 9 and 10, Answer 6, Recommendation 7)
**Branch:** projects-wbs-research-spec
**Prerequisite:** every task of these plans is done and committed:
- `.ai/plans/2026-10-07-projects-phase-1a.md` and `.ai/plans/2026-10-08-projects-phase-1b.md` (`projectLedger`, `projectWorkInProgressAccount`, `get_project_cost_summary`, the Costs tab);
- `.ai/plans/2026-10-09-field-service-phase-a.md` (`projectBillableItem`);
- `.ai/plans/2026-10-09-project-billing-phase-4a.md` (the enum values `Right to Invoice`, `Percent Complete`, `Cost Relief`, `Loss Provision`; `get_contract_line_subtree`; `estimateAtCompletion` and `sumSubtree`; `@carbon/ee/project-revenue.server` with `generateCostPlusItems`; `ProjectBillingLines` and `ContractProjectBilling`).

If one of these artifacts does not exist, STOP and report.

🛑 **Release rule.** Phase 4a and Phase 4b ship in the same release. With 4a alone, T&M invoices credit Deferred Revenue and no run recognizes them. Merge both to `main` together.

## Scope of this plan

The monthly revenue recognition run recognizes project contract revenue and relieves Project WIP:
1. **Right to Invoice** (community): revenue = the billable amount of the work performed to date, less what is already recognized.
2. **Percent Complete** (commercial, `PROJECT_REVENUE`): revenue = price × (actual cost ÷ estimate at completion), with a cumulative catch-up each month.
3. **Cost relief:** the same run moves the matching cost from Project WIP to cost of goods sold. `projectCostRelief` records each relieved ledger row once.
4. **Loss provision** (commercial): a forecast loss is provided in full and adjusted each month.
5. **Posting** of the `Cost Relief` and `Loss Provision` rows with the Project and Project Element dimensions.
6. **UI:** the progress figures in the run review, on the project Billing tab and on the contract. The Contract Loss Provision account default.

Phase 4a's enum migration already holds every enum value this plan uses. This plan adds no enum value.

## Rules for the executor

- Read `.ai/lessons.md`, `.claude/rules/conventions-database.md`, `.claude/rules/database-patterns.md`, `.claude/rules/accounting-sync-handlers.md`, `.claude/rules/commercial-licensing.md`, `.claude/rules/numeric-precision.md`, `.claude/rules/project-billing.md` and `.claude/rules/projects-system.md` before Task 1.
- Read `apps/erp/app/modules/accounting/AGENTS.md` (Revenue recognition) and `packages/server-functions/AGENTS.md`.
- Use the `carbon-design` skill for every UI task.
- Start every new source file with its SPDX header. Run `pnpm --filter @carbon/checks license-headers` after you create files. Files under `packages/ee/` and `.ee.` files get the commercial header.
- Never use JavaScript `Date`, and never `CURRENT_DATE` in SQL. Pass dates as `YYYY-MM-DD` strings.
- Round with `round()` from `@carbon/utils`. Never query in a loop. Never construct a database client in a `*.service.ts`.
- Every Kysely write in a server function or an ee function names `companyId` explicitly.
- If a quoted code line or line number does not match the file, search for the quoted code. If you cannot find it, STOP and report.

## Decisions this plan makes

These correct or add to the spec. Task 13 records them there.

| # | Decision | Why |
|---|---|---|
| R1 | The revenue run functions take extra synthesizers from the caller: `revenueRunSynthesizers` on the server function fields. The ERP and the jobs pass `projectRevenueSynthesizers` from `@carbon/ee/project-revenue.server`. The run order is rental accruals, the passed synthesizers, Right to Invoice, then contract revenue. | `@carbon/server-functions` cannot import `@carbon/ee`; the reverse import already exists. Percent Complete must run in commercial code (Q1), inside the run's transaction. Both project synthesizers write month rows that `synthesizeContractRevenue` then moves through the contract position. |
| R2 | `projectCostRelief` keys on `revenueRecognitionScheduleId` (FK, `ON DELETE CASCADE`), not on a run line. It has `UNIQUE ("projectLedgerId", "companyId")`. | The synthesizers run before the run lines exist (`claimScheduleRows`, `propose-revenue-recognition-run/index.ts:522`). A rebuilt month deletes its schedule rows, and the cascade frees their ledger rows. The unique key makes a second relief of one row impossible. |
| R3 | Right to Invoice relieves every unrelieved subtree ledger row posted on or before the period end. | A T&M line bills no overhead row (decision 8), and a written-off item earns nothing. With item-only relief, that cost would stay in WIP forever. All performed work is recognized, so its cost belongs to the same month. |
| R4 | Relief covers only rows whose journal debit line (`projectLedger.journalLineId`) is on an `Asset` account. The Cost Relief row credits that account. | An element can override the account or the treatment (`resolveProjectPostingAccount`). Relieving an expensed row would expense it twice. A row posted with accounting off has no journal line and nothing in WIP. |
| R5 | The synthesizers rebuild the run's month of each progress line: they delete its Planned schedule rows of that month and its Planned month row, then write new ones. A Recognized month is never touched. | The EAC and the items change between proposals. Rebuilding is idempotent; a delete goes through `syncDraftRecognitionRuns`, so a Draft run of a later period stays consistent. |
| R6 | `Cost Relief` and `Loss Provision` rows carry `customerContractLineId` and a null `customerContractRevenueId`. The orphan cleanup in `synthesizeContractRevenue` only looks at `Deferral` and `Accrual` rows. | Without the filter the cleanup (`:295-313`) deletes every relief row the moment it is written. |
| R7 | `customerContractRevenue` gains `earnedToDate`, `estimateAtCompletion`, `transactionPrice` and `progress`. | The spec's risk table: "The run shows the EAC, price and progress per line in the proposal for review before posting." The figures must be stored to be shown. |
| R8 | Progress = `min(actualToDate / EAC, 1)` when EAC > 0, else 0. EAC = the billing element's `estimateAtCompletion` override, else `estimateAtCompletion()` on the subtree roll-up. `actualToDate` sums the subtree ledger rows posted on or before the period end. | The Costs tab and the funding notice use the same helpers (4a Task 4). A zero EAC with no cost must not divide by zero. |
| R9 | Cost Relief and Loss Provision debit `accountDefault.costOfGoodsSoldAccount`. The provision credits the new `contractLossProvisionAccount`, account `2165 Contract Loss Provision` (Liability). | 2165 is free and sits next to 2160 Deferred Revenue (`seed-data.ts:1245-1268`). |
| R10 | The commercial synthesizer first calls `generateCostPlusItems` through the period end, in the run's transaction. | A Cost Plus line with Right to Invoice needs its items before the community synthesizer reads them. |
| R11 | The database tests of Percent Complete live in `packages/ee`. They use the server function test fixture through a new export, `@carbon/server-functions/test-fixture`. | The ee package has no database fixture. Copying one would duplicate it. |

## Progress

- [x] Task 1: Create the project revenue migration
- [x] Task 2: Apply the migration, regenerate types, ship RLS and the seed account
- [x] Task 3: Let callers pass revenue run synthesizers
- [x] Task 4: Add the shared project revenue writers and the Right to Invoice synthesizer
- [x] Task 5: Add the Percent Complete and loss provision math
- [x] Task 6: Add the commercial Percent Complete synthesizer
- [ ] Task 7: Pass the project revenue synthesizers at every run call site
- [ ] Task 8: Post Cost Relief and Loss Provision rows
- [ ] Task 9: Add the Percent Complete database tests
- [ ] Task 10: Show progress in the run review
- [ ] Task 11: Show progress on the Billing tab and the contract
- [ ] Task 12: Add the Contract Loss Provision account default
- [ ] Task 13: Update the rules, AGENTS.md, docs, spec and changelog
- [ ] Task 14: Verify in the browser

## Dependencies

- Tasks 1 → 2 run in order.
- Task 3 needs Task 2. Task 4 needs Task 3. Task 5 needs Task 2.
- Task 6 needs Tasks 4 and 5. Task 7 needs Task 6. Task 8 needs Task 2.
- Task 9 needs Tasks 6, 7 and 8.
- Tasks 10 and 11 need Task 4. Task 12 needs Task 2.
- Task 13 needs Tasks 1–12. Task 14 runs last.
- Tasks 5, 8 and 12 are independent of each other.

---

## Task 1: Create the project revenue migration

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_project-revenue.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20261006220201_revenue-recognition-core.sql:6-135` (the `accountDefault` column, its FK, the account per company group, the backfill and its guard)

**Steps:**
1. Run `pnpm db:migrate:new project-revenue`.
2. Check that account number 2165 and the name "Contract Loss Provision" are free in every company group:

```bash
psql "$SUPABASE_DB_URL" -c "SELECT count(*) FROM \"account\" WHERE number = '2165' OR name = 'Contract Loss Provision';"
# Expected: 0
```

   If the count is not 0, STOP and report.
3. Write the SQL below. Add an index on `companyId` and on every FK column.

```sql
-- 1) Which ledger rows each relief covered (append-only) -----------------------------
CREATE TABLE IF NOT EXISTS "projectCostRelief" (
  "id" TEXT NOT NULL DEFAULT id('pcr'),
  "companyId" TEXT NOT NULL,
  "projectLedgerId" TEXT NOT NULL,
  "revenueRecognitionScheduleId" TEXT NOT NULL,
  "amount" NUMERIC NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "projectCostRelief_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectCostRelief_ledger_key" UNIQUE ("projectLedgerId", "companyId"),
  CONSTRAINT "projectCostRelief_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "projectCostRelief_ledger_fkey" FOREIGN KEY ("projectLedgerId", "companyId")
    REFERENCES "projectLedger"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectCostRelief_schedule_fkey" FOREIGN KEY ("revenueRecognitionScheduleId", "companyId")
    REFERENCES "revenueRecognitionSchedule"("id", "companyId") ON DELETE CASCADE
);

-- 2) The figures behind a progress month (decision R7) -------------------------------
ALTER TABLE "customerContractRevenue"
  ADD COLUMN IF NOT EXISTS "earnedToDate" NUMERIC,
  ADD COLUMN IF NOT EXISTS "estimateAtCompletion" NUMERIC,
  ADD COLUMN IF NOT EXISTS "transactionPrice" NUMERIC,
  ADD COLUMN IF NOT EXISTS "progress" NUMERIC CHECK ("progress" IS NULL OR "progress" BETWEEN 0 AND 1);

-- 3) The loss provision account default -----------------------------------------------
ALTER TABLE "accountDefault" ADD COLUMN IF NOT EXISTS "contractLossProvisionAccount" TEXT;
```

4. Copy the FK block of the precedent (`:14-30`) for `contractLossProvisionAccount`: `ON DELETE RESTRICT ON UPDATE CASCADE`.
5. Copy the account block (`:38-91`) with one spec row: `('2165', 'Contract Loss Provision', 'Liability', 'Other Current Liability', 'Balance Sheet', 'Current', 'Current Liabilities', ARRAY['2160', '2170', '2180'])`.
6. Copy the backfill (`:95-120`) for `contractLossProvisionAccount`, by number `2165`, then by name.
7. Copy the guard (`:124-135`): raise when a company has no `contractLossProvisionAccount`, or it is not a Liability leaf.

**Verify:**
```bash
pnpm db:migrate && psql "$SUPABASE_DB_URL" -c "SELECT count(*) FROM \"accountDefault\" WHERE \"contractLossProvisionAccount\" IS NULL;"
# Expected: the migration succeeds, and the count is 0
```

**Out of scope:** enum values. Phase 4a Task 1 added them.

---

## Task 2: Apply the migration, regenerate types, ship RLS and the seed account

**Depends on:** 1
**Files:**
- Modify: `packages/database/src/authz/manifest.ts`
- Modify: `packages/database/src/seed-data.ts` (accounts near `:1245`, `accountDefaults` near `:2180`)
- Modify: `packages/jobs/src/backups/id-refs.ts` (only if step 4 needs it)
- Modify: `packages/server-functions/package.json` — the `./test-fixture` export (R11)
- Modify: generated types

**Steps:**
1. Run `pnpm run generate:types`.
2. Add the RLS rule `projectCostRelief: company("accounting", { create: false, update: false, delete: false })`. Server functions write it with Kysely.
3. Run `pnpm --filter @carbon/database authz migration project-revenue-rls`, then `pnpm db:migrate`, then `pnpm run generate:types`.
4. Both id columns of `projectCostRelief` have FKs. Read the rule at the top of `id-refs.ts`. Add an entry only if it asks for FK columns too.
5. In `seed-data.ts`:
   1. Add account `2165` "Contract Loss Provision" under `current-liabilities`, after `2160`. Copy the `2160` entry's shape.
   2. Add `contractLossProvisionAccount: "2165"` to `accountDefaults`.
6. Add `"./test-fixture": "./src/local-database-test-fixture.ts"` to the `exports` of `packages/server-functions/package.json`.

**Verify:**
```bash
pnpm --filter @carbon/database exec vitest run src/authz
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=@carbon/database --filter=@carbon/server-functions --filter=erp
# Expected: exit code 0
```

**Out of scope:** the account default form (Task 12).

---

## Task 3: Let callers pass revenue run synthesizers

**Depends on:** 2
**Files:**
- Modify: `packages/server-functions/src/server-fn-context.ts` (`ContextFields` `:64-70`, the class `:72-120`)
- Modify: `packages/server-functions/src/invoke.ts` (`Fields` `:72-77`, `serverFns` `:126-145`)
- Modify: `packages/server-functions/src/propose-revenue-recognition-run/index.ts` (`RUN_ROW_SYNTHESIZERS` `:496-499`, `createRevenueRecognitionRunProposal` `:554`, the server function `:639-659`)
- Modify: `packages/server-functions/src/recalculate-revenue-recognition-run/index.ts` (`:99`)
- Modify: `packages/server-functions/src/preview-revenue-recognition-run/index.ts` (`:41`)
- Create: `packages/server-functions/src/propose-revenue-recognition-run/synthesizer-order.test.ts`

**Steps:**
1. Add `revenueRunSynthesizers?: RunRowSynthesizer[]` to `ContextFields` and to the invoker `Fields`. Import the type with `import type`.
2. Add `readonly revenueRunSynthesizers: RunRowSynthesizer[]` to `ServerFnContext`, default `[]`. `system`, `user` and `fromClient` keep the value from `fields`.
3. Replace `RUN_ROW_SYNTHESIZERS` with the function below. Task 4 adds `synthesizeProjectRevenue`. Until then, leave it out of the list.

```ts
/** The run's synthesizers in order. `extra` comes from the caller (the
 *  commercial project revenue synthesizer, decision R1) and runs before the
 *  project and contract synthesizers, which read the month rows it writes. */
export function runRowSynthesizers(extra: RunRowSynthesizer[] = []): RunRowSynthesizer[] {
  return [synthesizeRentalAccruals, ...extra, synthesizeProjectRevenue, synthesizeContractRevenue];
}
```

4. In the three run functions, read `revenueRunSynthesizers` from the context. Loop over `runRowSynthesizers(revenueRunSynthesizers)`.
5. Write `synthesizer-order.test.ts` (`databaseTest`). Pass a fake synthesizer through `ServerFnContext.system({ …, revenueRunSynthesizers: [fake] })`. Expect the proposal to call it once, after the rental accruals and before the contract revenue.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- synthesizer-order recalculate-revenue-recognition-run preview-revenue-recognition-run
# Expected: all tests pass
```

**Out of scope:** the call sites (Task 7).

---

## Task 4: Add the shared project revenue writers and the Right to Invoice synthesizer

**Depends on:** 3
**Files:**
- Create: `packages/server-functions/src/project-revenue/index.ts`
- Create: `packages/server-functions/src/project-revenue/right-to-invoice.test.ts`
- Modify: `packages/server-functions/src/propose-revenue-recognition-run/index.ts` (the orphan query `:295-301`, `runRowSynthesizers`)
- Copy from (precedent): `synthesizeContractRevenue` (`propose-revenue-recognition-run/index.ts:285-494`); `syncDraftRecognitionRuns` (`packages/server-functions/src/lib/draft-recognition-run.ts`)

**Steps:**
1. 🛑 The orphan cleanup deletes every Planned contract row with a null `customerContractRevenueId`. Add `.where("type", "in", ["Deferral", "Accrual"])` to that query first (R6).
2. In `project-revenue/index.ts`, export the shared writers. The commercial synthesizer (Task 6) imports them from `@carbon/server-functions/project-revenue`.
   - `lockProjectRevenue(trx, companyId)`: calls `lockContractPositions` (`src/lib/contract-ledger.ts`), which the ee package cannot import directly.
   - `loadProgressLines(trx, { companyId, periodEnd, revenueMethods })`: lines with those revenue methods on contracts that are not Draft. Return the line, `billingMethod`, `projectId`, `projectElementId`, `feePercent`, `ceilingAmount` and `customerContractId`.
   - `clearProgressMonth(trx, ctx, { lineIds, monthStart })`: R5. Skip lines whose month row is `Recognized`. Delete the lines' Planned schedule rows with `periodStart = monthStart`, through `syncDraftRecognitionRuns`. Then delete the Planned month rows. The cascade removes their ledger entries and `projectCostRelief` rows. Return the line ids still open.
   - `recognizedBefore(trx, { companyId, lineIds, monthStart })`: Σ `customerContractRevenue.amount` per line with `periodStart < monthStart`, any status.
   - `writeProgressMonths(trx, ctx, rows)`: insert one Planned `customerContractRevenue` row per line with a non-zero amount, with the R7 snapshot columns.
   - `selectUnrelievedCost(trx, { companyId, lineIds, through })`: R3 and R4. Join `get_contract_line_subtree` → `projectLedger` (`postingDate <= through`) → `journalLine` → `account` (class `Asset`). Leave out rows in `projectCostRelief`. Return, per line and account, the amount and the ledger rows.
   - `writeCostRelief(trx, ctx, reliefs)`: one `Cost Relief` schedule row per line and account. Debit `costOfGoodsSoldAccount`, credit the WIP account, `customerContractLineId` set, `scheduledDate = periodEnd`. Then one `projectCostRelief` row per ledger row with the schedule row id.
3. Export `synthesizeProjectRevenue(trx, ctx)`, the Right to Invoice synthesizer:
   1. Call `lockProjectRevenue(trx, companyId)` first. `synthesizeContractRevenue` takes the same lock; a second take is a no-op.
   2. `loadProgressLines` with `["Right to Invoice"]`. Call `clearProgressMonth` for the month of `periodEnd`.
   3. Earned to date per line: Σ `projectBillableItem.amount` of the line where `status <> 'Written Off'` and the ledger row's `postingDate <= periodEnd`. One query.
   4. Month amount = `round(earnedToDate − recognizedBefore)`. A negative amount is a valid catch-up.
   5. `writeProgressMonths` with `earnedToDate` set and the other snapshot columns null.
   6. `selectUnrelievedCost` through `periodEnd`, then `writeCostRelief`.
   7. If the COGS default is missing, throw "Set the Cost of Goods Sold account default before recognizing project revenue".
4. Add `synthesizeProjectRevenue` to `runRowSynthesizers`, after the passed synthesizers.
5. Write `right-to-invoice.test.ts` (`databaseTest`), the spec's Right to Invoice case:
   1. In October, items of 9,000.00 post with 5,500.00 of cost in WIP. A posted invoice bills 6,000.00 of them.
   2. The October proposal holds 3 rows:
      - a Deferral row of 6,000.00;
      - an Accrual row of 3,000.00;
      - a Cost Relief row of 5,500.00, Dr COGS / Cr Project WIP.
   3. Deleting the Draft run and proposing again gives the same rows. `projectCostRelief` still has one row per ledger row.
   4. Writing off a 1,000.00 item and proposing November gives a −1,000.00 month.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- right-to-invoice synthesizer-order contract-posting
# Expected: all tests pass
```

**Out of scope:** Percent Complete and the loss provision (Tasks 5 and 6).

---

## Task 5: Add the Percent Complete and loss provision math

**Depends on:** 2
**Files:**
- Create: `packages/ee/src/project-revenue/progress.ts`
- Create: `packages/ee/src/project-revenue/progress.test.ts`
- Modify: `packages/ee/src/project-revenue/index.ts` — re-export it

**Steps:**
1. Export `percentCompletePrice(args)`:

```ts
export function percentCompletePrice(args: {
  billingMethod: "Fixed" | "Time & Materials" | "Cost Plus";
  scheduledTotal: number;            // Fixed: Σ the line's schedule rows
  estimateAtCompletion: number;
  feePercent: number | null;
  ceilingAmount: number | null;
}): number
```

   1. Fixed: `scheduledTotal`.
   2. Cost Plus: `round(estimateAtCompletion × (1 + feePercent))`, capped at `ceilingAmount` when set.
   3. Time & Materials: throw. The DB CHECK refuses that pair (4a decision P6).
2. Export `percentCompleteRevenue({ price, estimateAtCompletion, actualToDate, recognizedToDate })`. It returns `{ progress, earnedToDate, month }` (R8):
   1. `progress = estimateAtCompletion > 0 ? min(actualToDate / estimateAtCompletion, 1) : 0`, rounded at internal scale.
   2. `earnedToDate = round(price × progress)`.
   3. `month = round(earnedToDate − recognizedToDate)`.
3. Export `lossProvisionBalance({ price, estimateAtCompletion, progress })`. It returns `round((estimateAtCompletion − price) × (1 − progress))` when `estimateAtCompletion > price`, else 0.
4. Write `progress.test.ts` with the spec's numbers:
   1. Cost Plus, EAC 100,000.00, fee 8 %, no ceiling: price 108,000.00. Actual 25,000.00: earned 27,000.00.
   2. Next month, EAC 120,000.00 (price 129,600.00), actual 40,000.00, recognized 27,000.00: month 16,200.00.
   3. The same with a ceiling of 115,000.00: price 115,000.00.
   4. Fixed price 100,000.00, EAC 110,000.00, progress 0.4: provision 6,000.00.
   5. Progress 1: provision 0.
   6. EAC 0 and actual 0: progress 0.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- progress
# Expected: 6 passed
```

**Out of scope:** database reads (Task 6).

---

## Task 6: Add the commercial Percent Complete synthesizer

**Depends on:** 4, 5
**Files:**
- Modify: `packages/ee/src/project-revenue/service.server.ts`
- Copy from (precedent): `synthesizeProjectRevenue` (Task 4); `packages/ee/src/workflows.server.ts:27-36` (the degrade check)

**Steps:**
1. Export `synthesizeCommercialProjectRevenue(trx, ctx)`, of type `RunRowSynthesizer` (`import type` from `@carbon/server-functions/propose-revenue-recognition-run`):
   1. If `projectRevenueEnabledForCompany(ctx.companyId)` is false, return. This is the degrade (Q1).
   2. Call `generateCostPlusItems(trx, { companyId, userId, through: periodEnd })` (R10).
   3. Call `lockProjectRevenue(trx, companyId)` from `@carbon/server-functions/project-revenue`.
   4. `loadProgressLines` with `["Percent Complete"]`. Call `clearProgressMonth` for the month of `periodEnd`.
2. Read, with one query each:
   1. the subtree ledger actual per line to `periodEnd` (`get_contract_line_subtree` → `projectLedger`);
   2. `get_project_cost_summary` per distinct project, and those projects' elements;
   3. the Fixed lines' `scheduledTotal`: Σ `customerContractInvoiceLine.amount` per line;
   4. the Loss Provision balance per line: Σ `Loss Provision` schedule row amounts with `periodStart` before the month.
3. Per line:
   1. EAC: the billing element's `estimateAtCompletion`, else `estimateAtCompletion(sumSubtree(…))` (4a Task 4).
   2. `price = percentCompletePrice(…)`.
   3. `{ progress, earnedToDate, month } = percentCompleteRevenue(…)` with `recognizedBefore`.
   4. `target = lossProvisionBalance({ price, estimateAtCompletion, progress })`. Change = `round(target − balance)`.
4. Write:
   1. `writeProgressMonths` with all four snapshot columns.
   2. One `Loss Provision` schedule row per line with a non-zero change. Debit `costOfGoodsSoldAccount`, credit `contractLossProvisionAccount`, the signed change as `amount`.
   3. `selectUnrelievedCost` through `periodEnd`, then `writeCostRelief`.
5. If `contractLossProvisionAccount` is null and a change is non-zero, throw "Set the Contract Loss Provision account default before recognizing contract losses".
6. Export `projectRevenueSynthesizers: RunRowSynthesizer[] = [synthesizeCommercialProjectRevenue]`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit code 0
```

**Out of scope:** the database tests (Task 9).

---

## Task 7: Pass the project revenue synthesizers at every run call site

**Depends on:** 6
**Files:**
- Modify: `apps/erp/app/routes/x+/accounting+/revenue-recognition-runs.new.tsx` (`:93-95`)
- Modify: `apps/erp/app/routes/x+/revenue-recognition-run+/$runId.repeat.tsx` (`:86-88`)
- Modify: `apps/erp/app/routes/x+/revenue-recognition-run+/$runId.recalculate.tsx` (`:28-30`)
- Modify: `apps/erp/app/routes/x+/accounting+/periods.$periodId.close.tsx` (`:255-257`)
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` (`getPeriodRunPreview` `:3222`, its callers `:3296`, `:3660`)
- Modify: `packages/jobs/src/inngest/functions/scheduled/revenue-recognition-proposal.ts` (`:92-94`)

**Steps:**
1. In each route and in the job, import `projectRevenueSynthesizers` from `@carbon/ee/project-revenue.server`. Pass `revenueRunSynthesizers: projectRevenueSynthesizers` to `serverFns.system({ … })`.
2. 🛑 `accounting.service.ts` is bundled for the browser. Never import a `.server` module there.
3. Add `revenueRunSynthesizers: RunRowSynthesizer[]` to the args of `getPeriodRunPreview`. Use `import type`.
4. Thread the argument through its two callers in the file. Find the routes that call them with `grep -rn "getPeriodRunPreview\|<the outer function names>" apps/erp/app/routes`. Pass `projectRevenueSynthesizers` from each route.
5. List every call site to check none was missed:

```bash
grep -rn "propose-revenue-recognition-run\"\|recalculate-revenue-recognition-run\"\|preview-revenue-recognition-run\"" apps packages --include='*.ts' --include='*.tsx' | grep -v "test\|invoke.ts\|defineServerFn\|name:"
```

   Each listed file must pass the synthesizers. If a file cannot import ee code, STOP and report.

**Verify:**
```bash
grep -rln "projectRevenueSynthesizers" apps/erp/app packages/jobs/src | wc -l
# Expected: at least 6 files (5 routes or their loaders, and the job)
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/jobs
# Expected: exit code 0
```

**Out of scope:** the run posting (Task 8).

---

## Task 8: Post Cost Relief and Loss Provision rows

**Depends on:** 2
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.server.ts` (`RevenueRecognitionDimensionIds` `:1195-1201`, contract lines `:1439-1463`, descriptions `:1522-1525`, dimensions `:1608-1645`)
- Modify: `apps/erp/app/routes/x+/revenue-recognition-run+/$runId.post.tsx` (`dimensionIds` `:112-117`)
- Create: `apps/erp/test/revenue-run-descriptions.test.ts`

**Steps:**
1. Add `projectElement?: string` to `RevenueRecognitionDimensionIds`. The post route fills it from the dimension with `entityType === "ProjectElement"`.
2. Select `ccl.projectElementId` with the contract lines. Add it to the contract source.
3. When `dimensionIds.projectElement` and the source's `projectElementId` are set, add the Project Element dimension value to both journal lines.
4. Move the description choice into an exported pure function `revenueRowDescriptions(row)`. Keep "Contract asset accrued" for a contract `Accrual` row. Use `REVENUE_LINE_DESCRIPTIONS` for the rest, including the two keys 4a Task 3 added.
5. A negative `Loss Provision` row (a release) posts with its sides swapped by the existing sign logic (`:1563-1576`). Change nothing there.
6. Write `revenue-run-descriptions.test.ts`:
   1. A contract `Accrual` row gives "Contract asset accrued".
   2. A `Cost Relief` row gives "Contract cost recognized" / "Project WIP relieved".
   3. A `Loss Provision` row gives "Contract loss provided" / "Contract loss provision".

**Verify:**
```bash
pnpm --filter erp test -- revenue-run-descriptions && pnpm exec turbo run typecheck --filter=erp
# Expected: 3 passed; typecheck exits 0
```

**Out of scope:** the reversal of a posted run (`$runId.reverse.tsx`). It reverses journals by row and needs no change. Check that with the Task 14 browser run.

---

## Task 9: Add the Percent Complete database tests

**Depends on:** 6, 7, 8
**Files:**
- Create: `packages/ee/src/project-revenue/percent-complete.test.ts`
- Copy from (precedent): `packages/server-functions/src/post-customer-contract/contract-lifecycle.test.ts:185` (fixture, `ServerFnContext.system`); `packages/server-functions/src/propose-revenue-recognition-run/run-test-fixture.ts`

**Steps:**
1. Import `databaseTest` and `connectLocalTestDatabase` from `@carbon/server-functions/test-fixture` (R11).
2. Propose each run through `ServerFnContext.system({ db, companyId, userId, revenueRunSynthesizers: projectRevenueSynthesizers })`.
3. Mock `companyHasFeature` from `../plan.server` with `vi.mock`. Return true, and false for the degrade case.
4. Cover the spec's Phase 4b criteria:
   1. **Percent Complete:** a Cost Plus line, EAC 100,000.00, fee 8 %, no ceiling. With 25,000.00 actual at month end, the run recognizes 27,000.00 and relieves 25,000.00.
   2. **Next month:** 40,000.00 actual and EAC 120,000.00. The run recognizes 16,200.00.
   3. **Ceiling:** with a ceiling of 115,000.00, the second month's snapshot `transactionPrice` is 115,000.00.
   4. **Loss:** a Fixed line, price 100,000.00, EAC 110,000.00, progress 40 %, posts a Loss Provision row of 6,000.00. At 100 % the balance returns to 0.
   5. **No double relief:** propose, delete the Draft run, propose again. Each ledger row has one `projectCostRelief` row.
   6. **Degrade:** with `companyHasFeature` false, the run writes no Percent Complete month.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- percent-complete
# Expected: 6 passed (or skipped when no local database is up)
```

**Out of scope:** UI tests.

---

## Task 10: Show progress in the run review

**Depends on:** 4
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` (`getRevenueRecognitionRunLines` `:7499`)
- Modify: `apps/erp/app/routes/x+/revenue-recognition-run+/$runId.tsx`
- Create: `apps/erp/app/modules/accounting/ui/RevenueRecognition/ProjectRevenueProgress.ee.tsx`
- Copy from (precedent): the lines table already on `$runId.tsx`

**Steps:**
1. Extend the run lines select with the schedule row's `customerContractRevenue(earnedToDate, estimateAtCompletion, transactionPrice, progress)` and the contract line's billing element.
2. `ProjectRevenueProgress.ee.tsx` renders one row per progress line of the run, with these columns:
   - contract line and billing element;
   - EAC, price and progress (percent);
   - earned to date and this month;
   - cost relieved and the loss provision change.
3. Render it above the lines table when the run holds a `Cost Relief`, `Loss Provision` or progress month row.
4. Show the Right to Invoice rows in the same table with EAC, price and progress empty.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** editing the EAC from the run page (the Costs tab owns it).

---

## Task 11: Show progress on the Billing tab and the contract

**Depends on:** 4
**Files:**
- Modify: `apps/erp/app/modules/projects/projects.service.ts` — `getProjectContractRevenue`
- Modify: `apps/erp/app/routes/x+/project+/$projectId.billing.tsx`
- Modify: `apps/erp/app/modules/projects/ui/Billing/ProjectBillingLines.tsx` (the optional `revenue` prop from 4a Task 18)
- Modify: `apps/erp/app/modules/sales/ui/Contracts/ContractProjectBilling.tsx`, `apps/erp/app/routes/x+/contract+/$id.details.tsx`

**Steps:**
1. `getProjectContractRevenue(client, { companyId, lineIds })` returns per line: Σ Recognized `customerContractRevenue.amount`, and the latest month row's `progress`, `estimateAtCompletion` and `transactionPrice`.
2. The Billing tab loader calls it once for the project's contract lines. `ProjectBillingLines` shows **Percent complete** and **Revenue recognized** columns.
3. `ContractProjectBilling` shows **Revenue recognized** per line, with the same call in `$id.details.tsx`.
4. For a Right to Invoice line, show percent complete as "—".

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** a revenue chart.

---

## Task 12: Add the Contract Loss Provision account default

**Depends on:** 2
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.models.ts` (`defaultBalanceSheetAccountValidator` `:418`)
- Modify: `apps/erp/app/modules/accounting/ui/AccountDefaults/AccountDefaultsForm.tsx`
- Copy from (precedent): the **Deferred Revenue** field in the same form

**Steps:**
1. Add `contractLossProvisionAccount` (optional) to the validator.
2. Add **Contract Loss Provision** beside **Deferred Revenue**, limited to Liability leaf accounts as that field is.
3. Check that the save action writes the column. Its service spreads the validated fields; confirm it with `grep -n "deferredRevenueAccount" apps/erp/app/modules/accounting/accounting.service.ts`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** other account defaults.

---

## Task 13: Update the rules, AGENTS.md, docs, spec and changelog

**Depends on:** 1–12
**Files:**
- Modify: `.claude/rules/project-billing.md` (created by 4a Task 20)
- Modify: `.claude/rules/commercial-licensing.md` (rollout status: Project revenue)
- Modify: `apps/erp/app/modules/accounting/AGENTS.md` (Revenue recognition: the synthesizer order, the call-site rule)
- Modify: `packages/server-functions/AGENTS.md` (`revenueRunSynthesizers`, `@carbon/server-functions/project-revenue`)
- Modify: `docs/content/docs/reference/project-billing.mdx`
- Modify: `.ai/specs/2026-10-09-project-billing.md`
- Create: `docs/content/changelog/<YYYY-MM-DD>-project-billing.mdx` (use the `changelog-entry` skill)

**Steps:**
1. Document only committed code. Ground every claim in a file.
2. In the rule, state the run order and the rule that every run call site passes `projectRevenueSynthesizers` (R1).
3. In the spec:
   1. Record decisions R1–R11.
   2. Correct `projectCostRelief`: it keys on the schedule row, with a unique ledger row (R2).
   3. Correct the Right to Invoice cost relief (R3).
   4. Mark Phase 4b done, and Phase 4 done, in *Delivery phases*.
4. Write one changelog entry for Phases 4a and 4b together. State that Cost Plus and Percent Complete are on the Business plan.
5. Run the STE-80 review pass on every `.ai/` file you changed.

**Verify:**
```bash
cd docs && pnpm typecheck
# Expected: exit code 0
pnpm --filter @carbon/checks license-headers
# Expected: no files changed
```

**Out of scope:** moving the spec to `.ai/specs/implemented/` (after the release).

---

## Task 14: Verify in the browser

**Depends on:** 1–13
**Files:**
- Create: `.ai/playbooks/project-billing-phase-4b.md` (written by `/test`)

**Steps:**
1. Run `/test` on a local dev company with accounting on, after the Phase 4a playbook.
2. Cover the spec's Phase 4b acceptance criteria:
   1. **Right to Invoice:** with 9,000.00 of October items and 6,000.00 invoiced, the October run recognizes 9,000.00. The proposal shows 6,000.00 from Deferred Revenue and 3,000.00 into Contract Assets. It relieves 5,500.00, Dr COGS / Cr Project WIP.
   2. **Percent Complete:** the run page shows EAC 100,000.00, price 108,000.00, progress 25 % and 27,000.00 recognized.
   3. **Ceiling:** the second month's price shows 115,000.00.
   4. **Loss:** the provision row of 6,000.00 posts Dr COGS / Cr Contract Loss Provision.
   5. **No double relief:** delete the Draft run and propose again. The relief amount is unchanged.
3. Post one run. Open its journal. Check the Project and Project Element dimensions on the Cost Relief lines.
4. Reverse the posted run. Check the reversal journal mirrors it.
5. Save the playbook to `.ai/playbooks/project-billing-phase-4b.md`.

**Verify:**
```bash
ls .ai/playbooks/project-billing-phase-4b.md
# Expected: the file exists, and the /test run reports every step passed
```

**Out of scope:** indirect rates and the year-end true-up (projects Phase 5).

## Execution notes

- Task 1: the `progress` CHECK is a named constraint (`customerContractRevenue_progress_check`) added in a guarded `DO` block, so the migration stays re-runnable. The unique key on (`projectLedgerId`, `companyId`) indexes the ledger FK, so only `companyId` and the schedule FK get their own indexes; `contractLossProvisionAccount` gets an index too. RLS is turned on by the generated authz migration (Task 2), as for `customerContractLaborRate`. `crbn migrate` applied the migration and then stopped at `authz sync` (no rule for `projectCostRelief` yet); Task 2 adds the rule. The commit used `CARBON_SKIP_MANIFEST_CHECK=1`, as 4a Task 2 did: the regenerated types sit in the working tree until Task 2 commits them.
- Task 2: `id-refs.ts` needs no entry: both id columns of `projectCostRelief` have FKs, and the file lists only id columns with no FK. The generated RLS migration is `20261011141454_project-revenue-rls.sql`. The MCP digest changed by one line (the regenerated types); `check:manifest` passes.
- Task 3: `runRowSynthesizers` leaves `synthesizeProjectRevenue` out until Task 4 adds it, as the task says. `synthesizer-order.test.ts` has 2 cases: a pure case pins the order (rental accruals, the passed synthesizers, contract revenue), and a database case proposes September with a fake synthesizer that writes one due Deferral row in the run's transaction, then expects one call and the row claimed into the run. The test seeds the `revenueRecognitionRun` sequence, as the recalculate test does. `pnpm --filter @carbon/server-functions test -- <names>` runs the whole suite (81 files), not only the named files; everything else passed.
- Task 4: the shared writers live in `packages/server-functions/src/lib/project-revenue.ts`, exported as `@carbon/server-functions/lib/project-revenue`, not in `src/project-revenue/index.ts`. `permissions-manifest.test.ts` requires every `src/<dir>/index.ts` to be a registered server function, so a plain module there fails it. The precedent is `./lib/service-orders`. Task 6 imports from the new path. The test is `src/lib/right-to-invoice.test.ts`.
- Task 4: `loadProgressLines` also skips a line that starts after the period end (`startDate <= periodEnd`). Such a line has no work to recognize yet; its first month after the start catches up.
- Task 4: `clearProgressMonth` deletes the line's Planned schedule rows of the month of the 4 types (`Deferral`, `Accrual`, `Cost Relief`, `Loss Provision`) before the month row. The schedule FK to `customerContractRevenue` is `ON DELETE SET NULL`, not a cascade, so the schedule rows must go first. Their contract ledger entries and `projectCostRelief` rows cascade from the schedule rows.
- Task 4: `writeCostRelief` pairs each new Cost Relief row with its ledger rows by (line, account) from `RETURNING`, never by position (lesson "Never correlate bulk-insert results by RETURNING position"). A group that nets to 0 writes no row; its ledger rows stay unrelieved and still net to 0. The COGS check runs only when there is cost to relieve.
- Task 4: the test uses September and October, not October and November: the proposal refuses a month that has not started (today is 2026-10-11). It extends `project-billing-test-fixture.ts` with `addAccounting`, `addJournalLines` (Draft journals on Project WIP), a `journalLineId` on `post`, and the `revenueRecognitionRun` sequence. The invoice is a contract ledger `Invoice` entry of 6,000.00 Deferred Revenue and a Billed item, not a full invoice posting. Two extra ledger rows pin R4: an expensed row and a row with no journal line are never relieved. The whole server-functions suite passed (82 files, 534 tests).
- Task 5: `percentCompleteRevenue` computes earned to date from the exact ratio (`price × actual ÷ EAC`) and rounds only the returned `progress`. With progress rounded first, the spec's second month gives 129,600.00 × 0.33333 = 43,199.57, not 43,200.00 (the three-boundary rule: round at persist, display and compare). `lossProvisionBalance` takes the rounded progress; at 5 decimals its error is under 0.00001 of the forecast loss.
- Task 6: the synthesizer reads `get_project_cost_summary` for every project in ONE statement (`unnest(projectIds)` with `LATERAL`), not one call per project, so it has no query in a loop. It imports the shared writers from `@carbon/server-functions/lib/project-revenue` (see Task 4) and adds `monthStartOf` to them. A line with no project or billing element is skipped (the CHECKs refuse that pair for Percent Complete). The Loss Provision balance reads every earlier Loss Provision row of the line, any status. The task's verify is the ee typecheck; a throwaway database run (deleted, not committed) proposed September for a Cost Plus Percent Complete line (EAC 100,000.00, fee 8 %, 25,000.00 actual) and got an Accrual of 27,000.00, a Cost Relief of 25,000.00, the month's snapshot (EAC 100,000.00, price 108,000.00, progress 0.25) and a generated Cost Plus item of 27,000.00. Task 9 owns the committed tests.
- Task 6, for Task 9: `ServerFnContext` has no package subpath. `@carbon/server-functions/test-fixture` gives `databaseTest` and `connectLocalTestDatabase` only. An ee test also needs `vi.mock("@carbon/auth/client.server")`, because `projectRevenueEnabledForCompany` imports it and it boots the server env.
