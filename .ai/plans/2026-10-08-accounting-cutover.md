# Accounting Cutover — implementation plan

**Spec:** .ai/specs/2026-10-08-accounting-cutover.md
**Research:** .ai/research/accounting-cutover.md
**Branch:** accounting-reset-plan

## Progress

### Phase A — Foundation (no behavior change)
- [x] Task 1: Add the Provisional and Superseded journal statuses
- [x] Task 2: Add the cutover columns, the stand-in role column, triggers and the status function
- [x] Task 3: Add Migration Clearing to the seed data
- [x] Task 4: Regenerate the database types
- [x] Task 5: Add the journal status lists and `journalPostingStatus`
- [x] Task 6: Change the SQL readers that filter on `<> 'Draft'`
- [x] Task 7: Exclude the new statuses from the dataset coverage check
- [x] Task 8: Add the `journal-status-filter` conformance check
- [x] Task 9: Change the journal readers in the server functions
- [x] Task 10: Change the journal counts in the ERP period services

### Phase B — Post journals for every company
- [ ] Task 11: Always post in the shared adjustment journal and its callers
- [ ] Task 12: Always post in `post-receipt`
- [ ] Task 13: Always post in `post-shipment`
- [ ] Task 14: Always post in `post-sales-invoice`
- [ ] Task 15: Always post in `post-purchase-invoice`
- [ ] Task 16: Always post in `post-payment` and `post-memo`
- [ ] Task 17: Always post in `post-charge` and `post-reimbursement`
- [ ] Task 18: Always post in `issue`
- [ ] Task 19: Always post in `close-job` and `post-production-event`
- [ ] Task 20: Always post in `post-asset-transfer` and `post-rental-agreement`
- [ ] Task 21: Always post in the SQL job-costing functions
- [ ] Task 22: Always post in the ERP fixed-asset paths, Stripe fees and the revenue recognition cron
- [ ] Task 23: Refuse manual accounting work before the cutover
- [ ] Task 24: Prove a company with no cutover can post every document

### Phase C — The cutover
- [ ] Task 25: Accept the Opening Balance source type in the AR/AP readers and payment lookups
- [ ] Task 26: Add the pure cutover planner
- [ ] Task 27: Add the cutover read services
- [ ] Task 28: Add the `activate-accounting` server function
- [ ] Task 29: Handle voids of documents dated before the cutover
- [ ] Task 30: Start depreciation at the cutover
- [ ] Task 31: Build the 5-step enable wizard

### Phase D — Retire the flag
- [ ] Task 32: Replace every ERP read of `accountingEnabled`
- [ ] Task 33: Remove Mark Paid and Mark Unpaid
- [ ] Task 34: Replace the settings switch
- [ ] Task 35: Set the cutover for new companies and demo datasets
- [ ] Task 36: Show the Provisional and Superseded statuses
- [ ] Task 37: Update the docs, rules and AGENTS.md files

### Phase E — Verify
- [ ] Task 38: Run every gate and verify the enable flow in the browser

## Dependencies

- Task 1 must commit before Task 2 (a new enum value cannot be used in the transaction that adds it).
- Task 4 needs Tasks 1–3. Every later task needs Task 4.
- Tasks 6, 7, 8, 9 and 10 need Task 5. They are independent of each other.
- 🛑 Phase B (Tasks 11–24) must not start until every Phase A task is done. A Provisional journal written before the readers change counts in the balances.
- Tasks 11–20 need Task 5 and are independent of each other. Task 21 needs Task 2.
- Task 24 needs Tasks 11–23.
- Phase C needs Phase B. Task 28 needs Tasks 26 and 27. Task 31 needs Tasks 27 and 28.
- Phase D needs Task 31. Tasks 32–37 are independent of each other.
- Task 38 needs every other task.

## Shared conventions for every task

- Run every command from the repository root `/Users/barbinbrad/conductor/workspaces/carbon/lagos`.
- Create each migration with `pnpm db:migrate:new <name>`. Never pick a timestamp by hand.
- Apply migrations with `pnpm db:migrate`. It needs the local stack (`crbn up`). If the stack is down, STOP and ask the user to start it.
- Typecheck one package at a time: `pnpm exec turbo run typecheck --filter=<pkg>`. Never run a whole-repo typecheck.
- Read `.ai/lessons.md` sections "Journal debit/credit is derived from account class + amount sign" and "Carbon journal amounts are natural-balance-signed" before you write a journal line.
- A server function database test uses `databaseTest` from `packages/server-functions/src/local-database-test-fixture.ts`. It skips without a local database. Run it with the stack up.
- The 3 status lists from Task 5 are the only allowed journal status filters in new code.

---

## Task 1: Add the Provisional and Superseded journal statuses

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_journal-provisional-status.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20260901165008_opening-balance-source-type.sql`

**Steps:**
1. Run `pnpm db:migrate:new journal-provisional-status`.
2. Write this SQL in the new file:
   ```sql
   -- A journal written before the company's accounting cutover counts nowhere
   -- (Provisional). At the cutover, Provisional journals dated before the
   -- cutover date become Superseded. See .ai/specs/2026-10-08-accounting-cutover.md.
   ALTER TYPE "journalEntryStatus" ADD VALUE IF NOT EXISTS 'Provisional';
   ALTER TYPE "journalEntryStatus" ADD VALUE IF NOT EXISTS 'Superseded';
   ```
3. Run `pnpm db:migrate`.

**Verify:**
```bash
docker exec carbon-carbon-accounting-reset-plan-postgres-1 psql -U postgres -d postgres -Atc "select enum_range(null::\"journalEntryStatus\")"
# Expected: {Draft,Posted,Reversed,Provisional,Superseded}
```
If the container has another name, find it with `docker ps --format '{{.Names}}' | grep postgres`.

**Out of scope:** any use of the new values. Task 2 uses them in a separate migration.

---

## Task 2: Add the cutover columns, the stand-in role column, triggers and the status function

**Depends on:** Task 1
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_accounting-cutover.sql`
- Copy from (precedent):
  - `packages/database/supabase/migrations/20260712142905_reconcile-period-close-definitions.sql:22-63` (`check_posted_record_immutable` and its 2 triggers)
  - `packages/database/supabase/migrations/20260713235930_close-snapshot-posting-lock.sql:33-100` (`check_accounting_period_open`)
  - `.ai/specs/archived/2026-07-04-accounting-cutover-activation.md` lines 140-169 (the config-lock trigger)

**Steps:**
1. Run `pnpm db:migrate:new accounting-cutover`.
2. Add the columns:
   ```sql
   ALTER TABLE "companySettings"
     ADD COLUMN IF NOT EXISTS "accountingCutoverDate" DATE,
     ADD COLUMN IF NOT EXISTS "accountingActivatedAt" TIMESTAMP WITH TIME ZONE,
     ADD COLUMN IF NOT EXISTS "accountingActivatedBy" TEXT REFERENCES "user"("id");

   ALTER TABLE "accountDefault"
     ADD COLUMN IF NOT EXISTS "migrationClearingAccount" TEXT;
   ```
3. Add the stand-in role column:
   ```sql
   -- The accountDefault column a stand-in line wanted. Before the cutover, a
   -- posting that needs an empty default writes the line to
   -- retainedEarningsAccount and names the default here; the enable re-points
   -- it. Null on every other line.
   ALTER TABLE "journalLine" ADD COLUMN IF NOT EXISTS "accountDefaultRole" TEXT;
   ```
4. Do not create any account. Do not fill any `accountDefault` column. Do not add NOT NULL to any column. Account numbers and names are user-editable, so a match by number can point a default at an unrelated account (spec Q7, revised).
5. Add the status function:
   ```sql
   CREATE OR REPLACE FUNCTION journal_posting_status(p_company_id TEXT)
   RETURNS "journalEntryStatus" LANGUAGE sql STABLE SET search_path = public AS $$
     SELECT CASE WHEN cs."accountingCutoverDate" IS NULL
       THEN 'Provisional'::"journalEntryStatus"
       ELSE 'Posted'::"journalEntryStatus" END
     FROM "companySettings" cs WHERE cs."id" = p_company_id;
   $$;
   ```
6. Copy `check_posted_record_immutable` from `20260712142905:22-53`. Make 3 changes:
   - Line 32: refuse DELETE when `OLD."status" IN ('Posted', 'Reversed', 'Superseded')`.
   - Before line 37: refuse any UPDATE when `OLD."status" = 'Superseded'`.
   - Line 43: refuse a line change when `v_parent_status IN ('Posted', 'Reversed', 'Superseded')`.
   Keep `SECURITY DEFINER` as in the source. Do not recreate the triggers; they call the function by name.
7. Copy `check_accounting_period_open` from `20260713235930:33-100`. Change the early return at lines 60-65 to:
    ```sql
    AND NOT (OLD."status" IN ('Draft', 'Provisional') AND NEW."status" = 'Posted') THEN
    ```
    A change from Provisional to Posted now runs the closed-period check.
8. Add the config-lock trigger. Adapt the July SQL: read `accountingActivatedAt` from `"companySettings"` (`cs."id" = company id`), not from `company`. Add 3 triggers:
    - `company`, BEFORE UPDATE: refuse a change of `baseCurrencyCode` once `accountingActivatedAt` is set.
    - `fiscalYearSettings`, BEFORE UPDATE: refuse a change of `startMonth` once it is set.
    - `companySettings`, BEFORE UPDATE: refuse a change of `accountingCutoverDate`, `accountingActivatedAt` or `accountingActivatedBy` once `OLD."accountingActivatedAt"` is set.
9. Set the cutover of the demo-template companies:
    ```sql
    UPDATE "companySettings" cs SET
      "accountingCutoverDate" = sub."cutover",
      "accountingActivatedAt" = NOW(),
      "accountingActivatedBy" = 'system'
    FROM (
      SELECT j."companyId", MIN(ap."startDate") AS "cutover"
      FROM "journal" j JOIN "accountingPeriod" ap ON ap."id" = j."accountingPeriodId"
      WHERE j."status" = 'Posted' GROUP BY j."companyId"
    ) sub
    WHERE sub."companyId" = cs."id" AND cs."accountingEnabled" = true
      AND cs."accountingCutoverDate" IS NULL;
    ```
10. Run `pnpm db:migrate`.

**Verify:**
```bash
docker exec carbon-carbon-accounting-reset-plan-postgres-1 psql -U postgres -d postgres -Atc "select count(*) from information_schema.columns where table_name = 'journalLine' and column_name = 'accountDefaultRole' and is_nullable = 'YES'"
# Expected: 1
docker exec carbon-carbon-accounting-reset-plan-postgres-1 psql -U postgres -d postgres -Atc "select journal_posting_status(id) from company limit 1"
# Expected: Provisional or Posted (not empty)
docker exec carbon-carbon-accounting-reset-plan-postgres-1 psql -U postgres -d postgres -Atc "select count(*) from \"companySettings\" where \"accountingEnabled\" and \"accountingCutoverDate\" is null"
# Expected: 0
```

**Out of scope:** the SQL readers (Task 6), the AR/AP readers (Task 25), the job-costing functions (Task 21). Do not drop `accountingEnabled`. Do not create the Migration Clearing account in existing company groups.

---

## Task 3: Add Migration Clearing to the seed data

**Depends on:** Task 2
**Files:**
- Modify: `packages/database/src/seed-data.ts` — the `accounts` array (Equity block near line 1380) and `accountDefaults` (lines 2125-2186)

**Steps:**
1. In `accounts`, add a leaf after account 3300: `key: "3400"`, `number: "3400"`, `name: "Migration Clearing"`, `class: "Equity"`, `incomeBalance: "Balance Sheet"`, `parentKey: "equity"`. Copy the remaining fields from account 3300.
2. In `accountDefaults`, add `migrationClearingAccount: "3400"`.
3. Do not change `seed-company/index.ts` or `datasets/bootstrap.ts`. Both read `accountDefaults` by key (`seed-company/index.ts:441`, `bootstrap.ts:353-369`).

**Verify:**
```bash
grep -n "migrationClearingAccount" packages/database/src/seed-data.ts
# Expected: 1 line
```

**Out of scope:** existing company groups. Their users pick or create Migration Clearing in the wizard (Task 31).

---

## Task 4: Regenerate the database types

**Depends on:** Tasks 1–3
**Files:**
- Modify (generated): `packages/database/src/types.ts`, `packages/database/src/swagger-docs-schema.ts`

**Steps:**
1. Run `pnpm run generate:types`.

**Verify:**
```bash
grep -c "accountingCutoverDate\|\"Provisional\"\|migrationClearingAccount" packages/database/src/types.ts
# Expected: a number greater than 3
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: Tasks: 1 successful (or more), 0 failed
```

**Out of scope:** hand edits of the generated files.

---

## Task 5: Add the journal status lists and `journalPostingStatus`

**Depends on:** Task 4
**Files:**
- Modify: `packages/database/src/accounting-posting.ts` — add the 3 status lists
- Modify: `packages/database/src/accounting-posting.test.ts`
- Create: `packages/database/src/journal-posting-status.ts`
- Create: `packages/database/src/journal-posting-status.test.ts`
- Modify: `packages/database/package.json` — add the export `"./journal-posting-status": "./src/journal-posting-status.ts"` next to `"./accounting-posting"` (line 54)

**Steps:**
1. Add to `accounting-posting.ts`:
   ```ts
   // Statuses a balance, report, snapshot, tie-out or sync counts.
   export const GL_JOURNAL_STATUSES = ["Posted", "Reversed"] as const;
   // Statuses a reader that follows one document's chain reads (void builders,
   // GR/IR, WIP sums, intercompany lookups).
   export const DOCUMENT_JOURNAL_STATUSES = ["Provisional", "Posted", "Reversed"] as const;
   // Statuses an open-item lookup reads (payment control lines, memo, charge
   // and reimbursement void checks).
   export const OPEN_ITEM_JOURNAL_STATUSES = ["Provisional", "Posted"] as const;
   ```
2. Keep `accounting-posting.ts` free of runtime database imports. `@carbon/utils` re-exports it into client bundles.
3. Write `journal-posting-status.ts`:
   ```ts
   export type AutomaticJournalStatus = "Provisional" | "Posted";
   export function postingStatusFor(cutoverDate: string | null): AutomaticJournalStatus;
   export async function journalPostingStatus(
     db: Kysely<KyselyDatabase>,
     companyId: string
   ): Promise<AutomaticJournalStatus>;
   ```
   `journalPostingStatus` selects `accountingCutoverDate` from `companySettings` where `id = companyId`, with `.forShare()`. It returns `postingStatusFor(row.accountingCutoverDate)`. If the row is missing, it throws `Error("Company settings not found")`.
   Also export the stand-in resolver:
   ```ts
   export const OPTIONAL_DEFAULT_ROLES = [
     "contractAssetAccount", "deferredRevenueAccount", "deferredTaxExpenseAccountId",
     "deferredTaxLiabilityAccountId", "employeeReimbursementsPayableAccount",
     "intercompanyPayablesAccount", "intercompanyReceivablesAccount",
     "laborAbsorptionAccount", "leaseInterestIncomeAccount", "leaseRevenueAccount",
     "netInvestmentInLeasesAccount", "overheadAbsorptionAccount", "rentalIncomeAccount",
     "salesReturnsAccount", "salesShippingRevenueAccount", "scrapAccount",
     "migrationClearingAccount"
   ] as const;
   export type OptionalDefaultRole = (typeof OPTIONAL_DEFAULT_ROLES)[number];
   export function resolveDefaultAccount(
     defaults: Partial<Record<OptionalDefaultRole, string | null>> & { retainedEarningsAccount: string },
     role: OptionalDefaultRole,
     postingStatus: AutomaticJournalStatus
   ): { accountId: string; accountDefaultRole: OptionalDefaultRole | null };
   ```
   - If `defaults[role]` is set, return it with `accountDefaultRole: null`.
   - Else, if `postingStatus` is `"Provisional"`, return `retainedEarningsAccount` with `accountDefaultRole: role`.
   - Else throw `Error(\`Set the ${role} account default in Accounting → Defaults.\`)`.
4. Import `Kysely` as a type only. Import `KyselyDatabase` from `./client` as a type.
5. Write tests:
   - `postingStatusFor(null)` is `"Provisional"`; `postingStatusFor("2026-10-01")` is `"Posted"`.
   - Each list has the members in step 1.
   - `resolveDefaultAccount` returns the default when set, the stand-in with the role before cutover, and throws after cutover.

**Verify:**
```bash
pnpm --filter @carbon/database exec vitest run src/accounting-posting.test.ts src/journal-posting-status.test.ts
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: 0 failed
```

**Out of scope:** using the helper (Phase B).

---

## Task 6: Change the SQL readers that filter on `<> 'Draft'`

**Depends on:** Task 5
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_journal-gl-status-readers.sql`
- Copy from (precedent), the latest definition of each object:

  | Object | Source | Line(s) to change |
  |---|---|---|
  | `accountTreeBalances` | `20260909173619_preserve_inactive_account_report_balances.sql:5-63` | 43-45 |
  | `accountTreeBalancesByCompany` | same file `:65-221` | 123-125, 175 |
  | `accountTreeBalancePeriodSeries` | same file `:223-352` | 284 |
  | `snapshotAccountingPeriodBalances` | same file `:354-408` | 391 |
  | `journalLinesByAccountNumber` | `20260713225803_ledger-balance-posted-filter.sql:145-171` | 162-164 |
  | `journalDimensionPivot` | `20260809204137_analytics-account-filter.sql:18-143` | 66 |
  | `journalDimensionPivotLines` | same file `:145-256` | 200 |
  | `get_inventory_tie_out` | `20260925121735_rpc-function-guards.sql:1425-1486` | 1461 |
  | `journalLines` view | `20260811123614_widen-ledger-amounts.sql:177-188` | 188 |

**Steps:**
1. Run `pnpm db:migrate:new journal-gl-status-readers`.
2. Before you edit, record each function's security mode:
   ```bash
   docker exec carbon-carbon-accounting-reset-plan-postgres-1 psql -U postgres -d postgres -Atc "select proname, prosecdef from pg_proc where proname in ('accountTreeBalances','accountTreeBalancesByCompany','accountTreeBalancePeriodSeries','snapshotAccountingPeriodBalances','journalLinesByAccountNumber','journalDimensionPivot','journalDimensionPivotLines','get_inventory_tie_out') order by 1"
   ```
3. Copy each function into the new migration. Replace each `<> 'Draft'` or `!= 'Draft'` on a journal status with `IN ('Posted', 'Reversed')`. Change nothing else.
4. End each function with the security mode from step 2 (`SECURITY DEFINER` when `prosecdef` is `t`, else `SECURITY INVOKER`). `snapshotAccountingPeriodBalances` was altered to INVOKER by `20260925121735:2781`.
5. Keep the `assert_company_access` call in `get_inventory_tie_out` (`:1435`).
6. For the `journalLines` view: `DROP VIEW IF EXISTS "journalLines";` then `CREATE VIEW` with `WHERE j."status" IN ('Posted', 'Reversed')`. Copy `WITH (SECURITY_INVOKER=true)` if the source has it.
7. If `DROP VIEW` fails because another object depends on the view, STOP and report.
8. Run `pnpm db:migrate`, then `pnpm run generate:types`.

**Verify:**
```bash
docker exec carbon-carbon-accounting-reset-plan-postgres-1 psql -U postgres -d postgres -Atc "select count(*) from pg_proc where prosrc ilike '%status\" <> ''Draft''%' and proname in ('accountTreeBalances','accountTreeBalancesByCompany','accountTreeBalancePeriodSeries','snapshotAccountingPeriodBalances','journalLinesByAccountNumber','journalDimensionPivot','journalDimensionPivotLines','get_inventory_tie_out')"
# Expected: 0
# Then rerun the step 2 query. Expected: the same prosecdef values as before.
```

**Out of scope:** `trialBalance` (it reads `accountTreeBalancesByCompany`), the `= 'Posted'` AR/AP readers (Task 25), `complete_job_to_inventory` (Task 21).

---

## Task 7: Exclude the new statuses from the dataset coverage check

**Depends on:** Task 4
**Files:**
- Modify: `packages/database/src/datasets/validate.ts:387-390`
- Copy from (precedent): `validate.ts:196-198` (`shipmentStatus` with an exclusion)

**Steps:**
1. Change `journalStatus: { values: enumValues("journalEntryStatus") }` to pass exclusions:
   ```ts
   enumValues("journalEntryStatus", {
     Provisional: "a demo company starts with a cutover, so it posts no Provisional journal",
     Superseded: "only the enable turns a Provisional journal into Superseded"
   })
   ```

**Verify:**
```bash
pnpm db:check:datasets
# Expected: all 4 datasets pass (needs the local stack)
```

**Out of scope:** `datasets/types.ts:1776` (`JournalEntrySpec.status` stays 3 values).

---

## Task 8: Add the `journal-status-filter` conformance check

**Depends on:** Task 6
**Files:**
- Create: `packages/checks/src/conformance/journal-status-filter.ts`
- Create: `packages/checks/src/conformance/journal-status-filter.test.ts`
- Modify: `packages/checks/src/run.ts` — register in `CONFORMANCE_CHECKS` (line 70) and `TS_CHECKS` (line 85)
- Modify: `packages/checks/src/index.ts` — export the check
- Modify: `packages/checks/src/conformance/baseline.json` (regenerated)
- Copy from (precedent): `packages/checks/src/conformance/no-derived-percent-column.ts` (SQL side), `no-raw-rounding.ts:14-46` (TS side)

**Steps:**
1. Write one `ConformanceCheck` with `id: "journal-status-filter"`. Its `scan` branches on `file.endsWith(".sql")`.
2. SQL side: flag a line that matches `/"?status"?\s*(<>|!=)\s*'Draft'/` when the file mentions `"journal"` and the migration filename is not older than the Task 6 migration. Set `provenance.since` to that migration's timestamp. Older files have false positives (`j` is also the alias of `job`).
3. TS side: flag a line that matches `.neq("status", "Draft")` or `"status", "<>", "Draft"` or `"status", "!=", "Draft"` when the file contains the text `"journal"`.
4. Set `message` to: "Filter journal status with GL_JOURNAL_STATUSES, DOCUMENT_JOURNAL_STATUSES or OPEN_ITEM_JOURNAL_STATUSES (@carbon/database/accounting-posting)."
5. Write tests: one SQL hit, one SQL miss on an older file, one TS hit, one TS miss in a file without `"journal"`.
6. Run `pnpm --filter @carbon/checks baseline`. Read the diff of `baseline.json`. Each new entry must be an existing hit, never a line you wrote.

**Verify:**
```bash
pnpm --filter @carbon/checks test
# Expected: all tests pass, including run.test.ts "introduces no NEW deprecated patterns"
```

**Out of scope:** fixing the baselined existing hits.

---

## Task 9: Change the journal readers in the server functions

**Depends on:** Task 5
**Files (all under `packages/server-functions/src/`):**

| File:line | Today | Change to |
|---|---|---|
| `post-receipt/index.ts:340`, `:594` | no filter | join `journal`, `DOCUMENT_JOURNAL_STATUSES` |
| `post-receipt/index.ts:1547` | no filter | `DOCUMENT_JOURNAL_STATUSES` |
| `post-shipment/index.ts:3093`, `:4124`, `:4410` | no filter | `DOCUMENT_JOURNAL_STATUSES` |
| `post-sales-invoice/index.ts:2375` | no filter, no `companyId` | `DOCUMENT_JOURNAL_STATUSES` and `.where("companyId", "=", companyId)` |
| `post-sales-invoice/index.ts:2420` | no filter | `DOCUMENT_JOURNAL_STATUSES` |
| `post-purchase-invoice/index.ts:115`, `:906` | no filter | `DOCUMENT_JOURNAL_STATUSES` |
| `post-sales-invoice/index.ts:2212`; `post-purchase-invoice/index.ts:2403`, `:2448` | intercompany lookups | `DOCUMENT_JOURNAL_STATUSES` |
| `close-job/index.ts:66` | no filter | `DOCUMENT_JOURNAL_STATUSES` |
| `post-production-event/index.ts:206`, `:229` | no filter, no join | join `journal`, `DOCUMENT_JOURNAL_STATUSES` |
| `post-maintenance-event/index.ts:84` | no filter, no join | join `journal`, `DOCUMENT_JOURNAL_STATUSES` |
| `post-asset-transfer/index.ts:1090` | `<> 'Draft'` | `DOCUMENT_JOURNAL_STATUSES` |
| `post-payment/post-payment-transaction.ts:162` | no filter | `DOCUMENT_JOURNAL_STATUSES` |
| `post-payment/post-payment-transaction.ts:534`, `:810` | `= 'Posted'` | `OPEN_ITEM_JOURNAL_STATUSES` |
| `post-memo/post-memo-transaction.ts:147`, `:155` | `!== "Posted"`, no filter | `OPEN_ITEM_JOURNAL_STATUSES` / `DOCUMENT_JOURNAL_STATUSES` |
| `post-charge/post-charge-void.ts:38`, `:44` | `!== "Posted"`, no filter | `OPEN_ITEM_JOURNAL_STATUSES` / `DOCUMENT_JOURNAL_STATUSES` |
| `post-reimbursement/post-reimbursement-void.ts:63`, `:69` | `!== "Posted"`, no filter | `OPEN_ITEM_JOURNAL_STATUSES` / `DOCUMENT_JOURNAL_STATUSES` |

**Steps:**
1. Import the lists from `@carbon/database/accounting-posting`.
2. For a Kysely reader, use `.where("journal.status", "in", [...LIST])`. For a check on a loaded row, use `LIST.includes(row.status)`.
3. For a reader with no `journal` join, add `.innerJoin("journal", "journal.id", "journalLine.journalId")` with a `companyId` match, as `post-payment-transaction.ts:498-503` does.
4. Do not change anything else in these files.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/server-functions
# Expected: 0 failed
pnpm --filter @carbon/server-functions test
# Expected: the same pass count as before this task (database tests need the stack)
```

**Out of scope:** the `accountingEnabled` branches (Phase B).

---

## Task 10: Change the journal counts in the ERP period services

**Depends on:** Task 5
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts:2622-2624` (`getFiscalCalendarCommitted`)
- Modify: `apps/erp/app/modules/accounting/accounting.periods.test.ts`

**Steps:**
1. Add `.in("status", [...GL_JOURNAL_STATUSES])` to the journal count in `getFiscalCalendarCommitted`.
2. Leave `getAccountingPeriodDeletability` as it is. A Provisional journal has no period, so it never blocks a delete.
3. Add a test: a Provisional journal does not commit the fiscal calendar.

**Verify:**
```bash
pnpm --filter erp exec vitest run app/modules/accounting/accounting.periods.test.ts
# Expected: all tests pass
```

**Out of scope:** other ERP readers (Task 32).

---

## Tasks 11–20: the shared steps for "always post"

Each of Tasks 11–20 applies these steps to the files it lists. Read them once.

1. Replace the function's `accountingEnabled` read with `const postingStatus = await journalPostingStatus(trx, companyId);` from `@carbon/database/journal-posting-status`. Call it inside the posting transaction, so the `FOR SHARE` lock holds until commit.
2. If the read happens before the transaction opens, move it into the transaction. If the code cannot move it without restructuring the function, STOP and report.
3. Delete each branch on the flag that the task lists. Keep the branch body and make it unconditional.
4. At each journal insert the task lists, replace `status: "Posted"` with `status: postingStatus`. Keep `postedAt` and `postedBy`.
5. A branch marked J* also resolved the accounting period. Resolve it only when `postingStatus` is `"Posted"`. A Provisional journal gets `accountingPeriodId: null`, and no posting creates a period before the cutover (spec section 1 item 3).
6. Where a builder reads one of the `OPTIONAL_DEFAULT_ROLES` from `accountDefault`, call `resolveDefaultAccount(defaults, role, postingStatus)`. Write its `accountId` on the line and its `accountDefaultRole` in the line's `accountDefaultRole` column. Remove any existing runtime fallback for that role only when `resolveDefaultAccount` covers the same case; keep `employeeReimbursementsPayableAccount ?? payablesAccount` (`post-reimbursement-post.ts:80`, `post-payment-transaction.ts:1020`) as it is.
7. Run the task's Verify block. A test that set `accountingEnabled: false` and expected no journal now expects a Provisional journal. Update it.

---

## Task 11: Always post in the shared adjustment journal and its callers

**Depends on:** Task 5
**Files (under `packages/server-functions/src/`):**
- Modify: `lib/post-adjustment.ts` — `createAdjustmentJournal` (:124, status at :142) takes a `status: AutomaticJournalStatus` argument
- Modify: `post-inventory-adjustment/index.ts` — flag :227/:257/:260; branches :262, :266, :275, :308, :311, :440
- Modify: `post-inventory-count/index.ts` — flag :168-179; branches :180, :184, :189, :196, :221
- Modify: `post-nonconformance/index.ts` — flag :127-172; branches :173, :177, :186, :216, :245
- Modify: `correct-stock-movement/index.ts` — flag :157-262; branches :263, :267, :274, :305, :308
- Modify: `import-csv/stock-quantity-import.ts` — flag :257-267; branches :268, :271, :274, :281, :306, :375, :492
- Modify: `recost-serial-unit/index.ts` — flag :128-135, `loadAccounting` :249; branch :188
- Modify: `post-maintenance-event/index.ts` — flag :40-46; early return :46
- Modify: `issue/index.ts` — maintenance branch :1248 and `valueMaintenanceMovements` :1202 only

**Steps:**
1. Add the `status` argument to `createAdjustmentJournal`. Pass it to the insert at :134.
2. `valueMovement` (:313) writes the journal only when `accounting` is non-null. Make every caller pass a non-null `accounting` object, with `postingStatus` from the shared steps.
3. Apply the shared steps to each listed file.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/server-functions
# Expected: 0 failed
pnpm --filter @carbon/server-functions exec vitest run src/post-inventory-count src/post-inventory-adjustment src/import-csv src/post-maintenance-event src/issue
# Expected: all tests pass
grep -rn "accountingEnabled" packages/server-functions/src/lib/post-adjustment.ts packages/server-functions/src/post-inventory-adjustment packages/server-functions/src/post-inventory-count packages/server-functions/src/post-nonconformance packages/server-functions/src/correct-stock-movement packages/server-functions/src/import-csv/stock-quantity-import.ts packages/server-functions/src/recost-serial-unit packages/server-functions/src/post-maintenance-event
# Expected: no output
```

**Out of scope:** the job paths of `issue` (Task 18).

---

## Task 12: Always post in `post-receipt`

**Depends on:** Task 5
**Files:**
- Modify: `packages/server-functions/src/post-receipt/index.ts` — flag :98-104
  - Sales Return Order void: :404 (J*), :440
  - Purchase Order void: :636
  - Purchase Order post: :1506, :1510, **:1521 (S, invoice-first maps)**, :1682 (and its else at :1793), :1944, **:2009 (S, fixed asset cost and CIP rows)**, :2172 (J*), :2419
  - Sales Return Order receipt: :2804, :2809, :3013, :3075 (J*), :3156
  - Inbound Transfer: :3343, :3347, :3401, :3440, :3483 (J*), :3512
  - Journal inserts: :447/:455, :1026/:1034, :2427/:2435, :3167/:3175, :3520/:3528

**Steps:**
1. Apply the shared steps.
2. At :1682, the else branch (:1793) consumed layers for a negative line when the flag was off. Keep one path: the body of the `if` already relieves the layers through `negativeReceiptConsumptions`. Confirm no line consumes layers twice.
3. If both branches at :1682 relieve layers in different ways, STOP and report.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/server-functions
# Expected: 0 failed
pnpm --filter @carbon/server-functions exec vitest run src/post-receipt
# Expected: all tests pass
grep -n "accountingEnabled" packages/server-functions/src/post-receipt/index.ts
# Expected: no output
```

**Out of scope:** the void cost-layer planner (`void-cost-ledger.ts`, done).

---

## Task 13: Always post in `post-shipment`

**Depends on:** Task 5
**Files:**
- Modify: `packages/server-functions/src/post-shipment/index.ts`
  - Flag reads: :232-239, :2023-2026, :2446-2449, :3103-3114, :4113-4116, :4398-4401
  - Sales Order post: :241, :245, :251, **:504 (S+J, COGS lines)**, **:659 (S, fixed asset disposal)**, **:1222 (S+J, `calculateCOGS` :1251 and `costLedger` :1281)**
  - Sales Return Order post: :2028-2053, :2173 (J*), :2238, :2290
  - Purchase Return Order post: :2455-2480, :2647 (J*), :2819, :2872
  - Sales Order void: :3119, :3433 (J*), :3585
  - Sales Return Order void: :4153 (J*), :4210
  - Purchase Return Order void: :4456 (J*), :4513
  - Journal inserts: :1305/:1313, :2300/:2313, :2882/:2890, :3596/:3604, :4245/:4253, :4548/:4556

**Steps:**
1. Apply the shared steps.
2. After the change, a sales-order shipment always calls `calculateCOGS` and writes the Sale `costLedger` row. This is the intended change (spec Q2).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/server-functions
# Expected: 0 failed
pnpm --filter @carbon/server-functions exec vitest run src/post-shipment
# Expected: all tests pass
grep -n "accountingEnabled" packages/server-functions/src/post-shipment/index.ts
# Expected: no output
```

**Out of scope:** `post-shipment/rental-agreement.ts` (no flag, no journal).

---

## Task 14: Always post in `post-sales-invoice`

**Depends on:** Task 5
**Files:**
- Modify: `packages/server-functions/src/post-sales-invoice/index.ts` — flag :113-121
  - Post setup: :173, **:344 (S)**, :316, :320, :349, :401 (G), :504, :508, :527, :545, :551, **:590 (S)**, **:644 (S)**, :673
  - Post lines: **:1157 (S)**, **:1233 (S+J)**, :1323, **:1382 (S)**, **:1483 (S)**, :1659 (J*)
  - Post transaction: **:1880 (S+J)**, **:2144 (S)**
  - Void: :2512, :2568 (J*), **:2782 (S)**, **:2897 (S+J)**
  - Journal inserts: :1888/:1896, :2905/:2913

**Steps:**
1. Apply the shared steps.
2. The guard at :401 (company group and exchange-rate asserts) now runs for every company. If it can refuse an invoice that posts today with accounting off, STOP and report. Do not weaken it.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/server-functions
# Expected: 0 failed
pnpm --filter @carbon/server-functions exec vitest run src/post-sales-invoice
# Expected: all tests pass
grep -n "accountingEnabled" packages/server-functions/src/post-sales-invoice/index.ts
# Expected: no output
```

**Out of scope:** `rental-posting.ts`, `contract-posting.ts` (pure, no flag).

---

## Task 15: Always post in `post-purchase-invoice`

**Depends on:** Task 5
**Files:**
- Modify: `packages/server-functions/src/post-purchase-invoice/index.ts` — flag :73-81
  - Void: :374, :449 (J*)
  - Post: :946, :950, :1074, **:1205 (S+J, purchase price variance children)**, :1545, **:1651 (G)**, **:1657 (S, fixed asset cost and CIP)**, :1979, :2051 (J*), **:2186 (S+J, intercompany :2328-2494)**
  - Journal inserts: :500/:508, :2194/:2202

**Steps:**
1. Apply the shared steps.
2. The guard at :1651 refuses a Fixed Asset line with no asset. It now applies to every company. Keep it.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/server-functions
# Expected: 0 failed
pnpm --filter @carbon/server-functions exec vitest run src/post-purchase-invoice
# Expected: all tests pass
grep -n "accountingEnabled" packages/server-functions/src/post-purchase-invoice/index.ts
# Expected: no output
```

**Out of scope:** none.

---

## Task 16: Always post in `post-payment` and `post-memo`

**Depends on:** Task 5
**Files:**
- Modify: `packages/server-functions/src/post-payment/post-payment-transaction.ts` — flag :108-113; branches :116 (J*), **:144 (G)**, **:644 (G)**, :987, :1156; inserts :170/:182, :1158/:1166
- Modify: `packages/server-functions/src/post-memo/post-memo-transaction.ts` — flag :64-69; branches :72 (J*), **:135 (G)**, **:319 (S+J)**; inserts :165/:177, :560/:569
- Modify: `packages/server-functions/src/post-payment/post-payment-transaction.test.ts` (the test at :169), `post-memo/post-memo-transaction.test.ts` (:234)

**Steps:**
1. Apply the shared steps.
2. Delete the refusals at :144 (payment) and :135 (memo). Each refused a void when a journal existed and the flag was off. A journal now always exists.
3. Change the guard at :644 to:
   ```ts
   if (postingStatus === "Posted" && !targetControlById.has(invoice.id)) {
     throw new Error("Target is missing its original control account");
   }
   ```
4. When the company has no cutover and the target has no control line, use the default control account. Copy the fallback from `packages/database/src/build-payment-journal.ts:274-275`.
5. If the journal builder cannot take a default control account for a target, STOP and report.
6. Update the 2 tests: with no cutover, a payment against an invoice with no journal posts a Provisional journal on the default receivables account.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/server-functions
# Expected: 0 failed
pnpm --filter @carbon/server-functions exec vitest run src/post-payment src/post-memo
# Expected: all tests pass (with the stack up)
```

**Out of scope:** voids of documents dated before the cutover (Task 29).

---

## Task 17: Always post in `post-charge` and `post-reimbursement`

**Depends on:** Task 5
**Files (under `packages/server-functions/src/`):**
- Modify: `post-charge/post-charge-transaction.ts` (flag :60-84, `context.accountingEnabled`), `post-charge/post-charge-post.ts` (:149 J*; insert :211/:219), `post-charge/post-charge-void.ts` (:24 G; insert :66/:74)
- Modify: `post-reimbursement/post-reimbursement-transaction.ts` (flag :65-89), `post-reimbursement-post.ts` (:164 J*; insert :275/:283), `post-reimbursement-void.ts` (:49 G; insert :92/:100)

**Steps:**
1. Replace `context.accountingEnabled` with `context.postingStatus`.
2. Apply the shared steps.
3. Delete the refusals at `post-charge-void.ts:24` and `post-reimbursement-void.ts:49`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/server-functions
# Expected: 0 failed
pnpm --filter @carbon/server-functions exec vitest run src/post-charge src/post-reimbursement
# Expected: all tests pass (with the stack up)
```

**Out of scope:** the paid-out refusal at `post-reimbursement-void.ts:21-44`.

---

## Task 18: Always post in `issue`

**Depends on:** Task 11
**Files:**
- Modify: `packages/server-functions/src/issue/index.ts`
  - Flag reads: :2040-2052, `loadConsumeAccountingContext` :1120/:2118, :2296-2309, :2587-2610, :3029-3041, :3421-3434, :4361-4374, :3935, :3980
  - Branches: **:385 (S+J)**, **:1849 (S+J)**, **:3331 (S+J)**, **:4587 (S+J)**, :2838, :3477 (J*), :3643, :3676, :3988 (J*)
  - Journal inserts: :525/:533, :812/:820, :2893/:2901, :3687/:3695

**Steps:**
1. Apply the shared steps.
2. `issueJobOperationMaterials` (:385) and `createMaterialWipEntries` (:603) now relieve cost layers for every company.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/server-functions
# Expected: 0 failed
pnpm --filter @carbon/server-functions exec vitest run src/issue
# Expected: all tests pass
grep -n "accountingEnabled" packages/server-functions/src/issue/index.ts
# Expected: no output
```

**Out of scope:** the maintenance path (Task 11).

---

## Task 19: Always post in `close-job` and `post-production-event`

**Depends on:** Task 9
**Files:**
- Modify: `packages/server-functions/src/close-job/index.ts` — flag :34-52; early return :54; insert :158/:166
- Modify: `packages/server-functions/src/post-production-event/index.ts` — flag :53-71; early return :73; insert :382/:396; `postedToGL` :267, :490

**Steps:**
1. Delete both early returns.
2. Apply the shared steps.
3. `post-production-event` now sets `postedToGL` for every company.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/server-functions
# Expected: 0 failed
grep -n "accountingEnabled" packages/server-functions/src/close-job/index.ts packages/server-functions/src/post-production-event/index.ts
# Expected: no output
```

**Out of scope:** `complete_job_to_inventory` (Task 21).

---

## Task 20: Always post in `post-asset-transfer` and `post-rental-agreement`

**Depends on:** Task 11
**Files (under `packages/server-functions/src/`):**
- Modify: `post-asset-transfer/index.ts` — `loadAccounting` :100-112; branches :530, :688, :926, **:1088 (S, `fixedAssetTransfer` and `fixedAssetCipCost` :1118-1189)**, :1355, :1446, :1499; journal via `postAssetJournal` :178
- Modify: `post-rental-agreement/index.ts` — flag :136-144, passed at :354; :483 (J*), :538, **:658 (S)**, **:697 (S)**
- Modify: `post-rental-agreement/return-unit.ts` — flag :356-360, :403; :463, :592
- Modify: `post-rental-agreement/agreement.ts` — `postLeaseJournal` :222 passes the status to `createAdjustmentJournal` :237

**Steps:**
1. `loadAccounting` returns null today when the flag is off. Make it always return the accounting context, with `postingStatus`.
2. Apply the shared steps.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/server-functions
# Expected: 0 failed
pnpm --filter @carbon/server-functions exec vitest run src/post-asset-transfer src/post-rental-agreement src/lib
# Expected: all tests pass
grep -rn "accountingEnabled" packages/server-functions/src/post-asset-transfer packages/server-functions/src/post-rental-agreement
# Expected: no output
```

**Out of scope:** none.

---

## Task 21: Always post in the SQL job-costing functions

**Depends on:** Task 4
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_job-costing-always-post.sql`
- Copy from (precedent):
  - `complete_job_to_inventory`: `20261006221601_complete-job-to-asset.sql:13-1132`
  - `backflush_job_materials`: `20260805023439_company-timezone-sql-functions.sql:31-469`

**Steps:**
1. Run `pnpm db:migrate:new job-costing-always-post`.
2. Copy `complete_job_to_inventory`. Make 3 changes:
   - Delete the flag read and early return at :600-610. Delete the variable at :38.
   - Replace `'Posted'` in the journal inserts at :734 and :952 with `journal_posting_status(p_company_id)`.
   - Where the function resolves an accounting period for those journals, insert `NULL` instead when `journal_posting_status(p_company_id)` is `'Provisional'`. Create no period in that case.
   - Add `AND j."status" IN ('Provisional', 'Posted', 'Reversed')` to the WIP sum at :873-880.
3. Copy `backflush_job_materials`. Delete the flag read and early return at :193-203. Replace `'Posted'` at :274 with `journal_posting_status(p_company_id)`. Insert a `NULL` period for a Provisional journal, as in step 2.
4. End `backflush_job_materials` with `SECURITY INVOKER` (set by `20260925121735:2761`). Check `complete_job_to_inventory`'s current `prosecdef` and keep it.
5. Run `pnpm db:migrate`, then `pnpm run generate:types`.

**Verify:**
```bash
docker exec carbon-carbon-accounting-reset-plan-postgres-1 psql -U postgres -d postgres -Atc "select count(*) from pg_proc where proname in ('complete_job_to_inventory','backflush_job_materials') and prosrc ilike '%accountingEnabled%'"
# Expected: 0
```

**Out of scope:** `sync_finish_job_operation` (no flag).

---

## Task 22: Always post in the ERP fixed-asset paths, Stripe fees and the revenue recognition cron

**Depends on:** Task 5
**Files:**
- Modify: `apps/erp/app/routes/x+/fixed-asset+/$fixedAssetId.register.tsx:99-119` — always post the registration journal, with the status from `journalPostingStatus(getDatabaseClient(), companyId)`
- Modify: `apps/erp/app/modules/accounting/accounting.server.ts` — `postAssetRegistration` (:379) and `postDisposal` (:198) take and write the status
- Modify: `packages/ee/src/stripe-connect/payment.server.ts:255-259`, `:353-357` — always resolve the fee account
- Modify: `packages/jobs/src/inngest/functions/scheduled/revenue-recognition-proposal.ts:67-72` — select `companySettings` ids where `accountingCutoverDate` is not null (`.not("accountingCutoverDate", "is", null)`)
- Modify: `packages/jobs/src/inngest/functions/scheduled/revenue-recognition-proposal.test.ts`

**Steps:**
1. Make each change above.
2. Keep `companiesToPropose(companies, ids)` as it is. Only the id source changes.
3. Update the comment above `companiesToPropose` to say "only those with an accounting cutover".

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/ee --filter=@carbon/jobs
# Expected: 0 failed
pnpm --filter @carbon/jobs exec vitest run src/inngest/functions/scheduled/revenue-recognition-proposal.test.ts
# Expected: all tests pass
```

**Out of scope:** the UI reads of the flag (Task 32).

---

## Task 23: Refuse manual accounting work before the cutover

**Depends on:** Task 4
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — add `requireAccountingCutover` and call it
- Modify: `apps/erp/app/modules/accounting/accounting.server.ts` — call it
- Modify: `packages/server-functions/src/propose-revenue-recognition-run/index.ts`, `packages/server-functions/src/recalculate-revenue-recognition-run/index.ts`
- Create: `apps/erp/app/modules/accounting/accounting.cutover.test.ts`

**Steps:**
1. Add to `accounting.service.ts`. It uses only the Supabase client, so the browser-bundled barrel stays safe:
   ```ts
   export const ACCOUNTING_NOT_STARTED =
     "Set up accounting before you post journals, runs or period closes.";
   export async function requireAccountingCutover(
     client: SupabaseClient<Database>,
     companyId: string
   ): Promise<{ error: { message: string } | null }>;
   ```
   It selects `accountingCutoverDate` from `companySettings` where `id = companyId`. It returns `{ error: { message: ACCOUNTING_NOT_STARTED } }` when the date is null, else `{ error: null }`.
2. Call it first in these functions. If it returns an error, return `{ data: null, error }`:
   - `accounting.service.ts`: `lockAccountingPeriod` :2638, `closeAccountingPeriod` :2709, `runIntercompanyMatching` :5598, `generateEliminations` :5608, `postJournalEntry` :6380, `reverseJournalEntry` :6662, `createDepreciationRun` :7370
   - `accounting.server.ts`: `postDisposal` :198, `postDepreciationRun` :723, `postRevenueRecognitionRun` :1231
3. In `propose-revenue-recognition-run/index.ts:639` and `recalculate-revenue-recognition-run/index.ts:37`: select `accountingCutoverDate` with the function's `db`. If it is null, throw `new InvalidInputError("Set up accounting before you post journals, runs or period closes.")` from `../errors`.
4. Write tests for `requireAccountingCutover` with a client stub that returns one `companySettings` row: a null date returns the error; a date returns no error.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/server-functions
# Expected: 0 failed
pnpm --filter erp exec vitest run app/modules/accounting
# Expected: all tests pass
```

**Out of scope:** `previewRevenueRecognitionRun` (read-only), `postAssetRegistration` (Task 22).

---

## Task 24: Prove a company with no cutover can post every document

**Depends on:** Tasks 11–23
**Files:**
- Create: `packages/server-functions/src/always-post.test.ts`
- Copy from (precedent): `packages/server-functions/src/post-receipt/rental-agreement.test.ts` (live database test with `databaseTest`)

**Steps:**
1. Create a company with `create` and the seed path the precedent uses. Leave `accountingCutoverDate` null.
2. Post one of each, in this order: receipt, shipment, sales invoice, purchase invoice, payment, memo, inventory adjustment, job material issue, job completion.
3. After each post, assert that every journal of the document has status `Provisional` and a null `accountingPeriodId`.
   Assert that the company has no `accountingPeriod` row.
4. Assert that `accountTreeBalances` for the company returns 0 on every account.
5. Assert that the shipment wrote a Sale `costLedger` row.
6. Set the company's `scrapAccount` to null. Post an inventory adjustment that scraps stock. Assert the scrap line's `accountId` is the company's `retainedEarningsAccount` and its `accountDefaultRole` is `scrapAccount`.

**Verify:**
```bash
pnpm --filter @carbon/server-functions exec vitest run src/always-post.test.ts
# Expected: all tests pass (the stack must be up, else the test skips — run it with the stack up)
```

**Out of scope:** the cutover (Phase C).

---

## Task 25: Accept the Opening Balance source type in the AR/AP readers and payment lookups

**Depends on:** Task 24
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_opening-balance-subledger-readers.sql`
- Copy from (precedent): `get_ar_open_by_customer` and `get_ap_open_by_supplier` (`20260909174352_account_for_memo_refunds_in_subledger_reports.sql:5-134`, `:136-265`), `get_ap_tie_out` (same file `:338-404`), `get_ar_tie_out` (`20261006221801_ar-subledger-excludes-deposits.sql:10-81`)
- Modify: `packages/server-functions/src/post-payment/post-payment-transaction.ts:521-532`, `:790-810`

**Steps:**
1. Copy the 4 functions. Wherever a query requires `j."sourceType" = 'Sales Invoice'`, `'Purchase Invoice'`, `'Credit Memo'` or `'Debit Memo'`, also accept `'Opening Balance'`. Example: `j."sourceType" IN ('Sales Invoice', 'Opening Balance')`.
2. Keep every `j."status" = 'Posted'` filter.
3. Keep each function's security mode (check `prosecdef` before and after, as in Task 6).
4. In the 2 payment lookups, accept `"Opening Balance"` in the `sourceType` filter.
5. Run `pnpm db:migrate`, then `pnpm run generate:types`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/server-functions
# Expected: 0 failed
docker exec carbon-carbon-accounting-reset-plan-postgres-1 psql -U postgres -d postgres -Atc "select count(*) from pg_proc where proname in ('get_ar_open_by_customer','get_ap_open_by_supplier','get_ar_tie_out','get_ap_tie_out') and prosrc ilike '%Opening Balance%'"
# Expected: 4
```

**Out of scope:** `get_ar_aging`, `get_ap_aging` (no journal join).

---

## Task 26: Add the pure cutover planner

**Depends on:** Task 5
**Files:**
- Create: `packages/database/src/accounting-cutover.ts`
- Create: `packages/database/src/accounting-cutover.test.ts`
- Modify: `packages/database/package.json` — export `"./accounting-cutover": "./src/accounting-cutover.ts"`
- Copy from (precedent): `packages/database/src/build-payment-journal.ts` (pure journal builder), `packages/database/src/accounting-posting.test.ts` (test style)

**Steps:**
1. Define the input types. Each amount is in base currency, positive on the natural side of its account.
   ```ts
   export type OpenItemType =
     | "Receivable" | "Payable" | "Unapplied Credit" | "Customer Deposit"
     | "Received Not Invoiced" | "Work in Progress" | "Inventory"
     | "Fixed Asset Cost" | "Accumulated Depreciation" | "Deferred Revenue"
     | "Lease Net Investment";
   export type OpenItem = {
     openItemType: OpenItemType;
     accountId: string;
     accountClass: "Asset" | "Liability" | "Equity" | "Revenue" | "Expense";
     amount: number;
     documentType: string | null;
     documentId: string | null;
     documentLineReference: string | null;
     description: string;
   };
   export type TrialBalanceLine = { accountId: string; accountClass: OpenItem["accountClass"]; debit: number; credit: number };
   ```
2. Write `buildOpeningJournalLines(items, trialBalance, controlAccountIds, migrationClearing)`. It returns journal line inserts with natural-balance-signed `amount`, as the lessons require:
   - One line per open item, on its account, with its document keys.
   - One Migration Clearing line per control account, offsetting the open items of that account.
   - One line per trial balance row on a non-control account, and one Migration Clearing line offsetting it.
   - No line for a trial balance row on a control account.
3. Write `migrationClearingByAccount(items, trialBalance, controlAccountIds)`. It returns, per control account, `{ accountId, trialBalance, carbon, difference }` and a `total`. Enable needs `equals(total, 0, 0.01)`.
4. Write `planInventoryReset(onHandAtCutover, unitCostByItem, layersBeforeCutover)`. Input on-hand is per item (sum across locations). It returns `layerIdsToClose` and one opening layer per item with on-hand above zero: `{ itemId, quantity, cost: round(quantity × unitCost), remainingQuantity: quantity }`.
5. Write `recostOutbound(layers, outbound)`. `layers` are the opening layers and the inbound layers dated on or after the cutover, oldest first. `outbound` are the outbound `costLedger` rows dated on or after the cutover, in date then `entryNumber` order. It relieves FIFO and returns `{ costLedgerId, newCost, delta }` per outbound row and the new `remainingQuantity` per layer. Copy the FIFO rule from `packages/server-functions/src/lib/calculate-cogs.ts`.
6. Use `round`, `equals` and `distributeRoundingResidual` from `@carbon/utils`. Never use `Math.round`.
7. Write tests for each function:
   - 2 open invoices on one receivables account and a trial balance that matches: difference 0, the journal balances.
   - The same with a trial balance 5.00 higher: difference 5.00 on that account.
   - A trial balance row on cash: one cash line and one clearing line.
   - Inventory reset closes every layer before the cutover and opens 1 layer per item.
   - `recostOutbound` relieves the opening layer first, then the next inbound layer.

**Verify:**
```bash
pnpm --filter @carbon/database exec vitest run src/accounting-cutover.test.ts
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: 0 failed
```

**Out of scope:** database reads (Task 27), writes (Task 28).

---

## Task 27: Add the cutover read services

**Depends on:** Tasks 25, 26
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — add the functions below
- Modify: `apps/erp/app/modules/accounting/accounting.models.ts` — add the validators below
- Copy from (precedent): `computePeriodReadiness` (`accounting.service.ts:3304`, Draft and Pending document queries :3315-3326), `getPeriodCloseChecklist` (:3823)

**Steps:**
1. Add `getActivationReadiness(client, db, { companyId, cutoverDate })`. It returns a list of checks `{ key, label, passed, detail }`:
   - `account-defaults`: every `accountDefault` account column is set, `migrationClearingAccount` included. Return the empty column names in `detail`.
   - `fiscal-settings`: a `fiscalYearSettings` row exists.
   - `cutover-date`: the date is the start of a fiscal period. It is not after today in the company time zone. It is at most 3 periods before the current one.
   - `pending-documents`: no Draft or Pending receipt, shipment, invoice, payment or memo dated before the cutover. Return the documents, as `computePeriodReadiness` does.
   - `legacy-jobs`: no open job created before L. L is `MIN("createdAt")` of the company's journals with status `Provisional` or `Superseded`, else now.
   - `opening-balance`: no Posted journal with `sourceType 'Opening Balance'`.
2. Add `getCutoverOpenItems(client, db, { companyId, cutoverDate })`. It returns `OpenItem[]` (Task 26) from these sources:
   - Receivables and payables: `get_ar_open_by_customer` and `get_ap_open_by_supplier` as of the day before the cutover. An invoice with status Paid and no settlement counts as settled.
   - Unapplied credits and deposits: payments posted before the cutover, cash minus settlements before the cutover. A deposit (`payment.rentalAgreementId` or `payment.salesOrderId`) goes to `prepaymentAccount` with description `CUSTOMER_DEPOSIT_DESCRIPTION`.
   - Received not invoiced: purchase order lines, `quantityReceived − quantityInvoiced` at the cutover × the receipt layer's unit cost. The document line reference is `journalReference.to.receipt(poLineId)`.
   - Work in progress: per open job, the sum of its `DOCUMENT_JOURNAL_STATUSES` lines on `workInProgressAccount` dated before the cutover.
   - Deferred revenue: `revenueRecognitionSchedule` rows still Planned, dated on or after the cutover, on their credit account.
   - Lease net investment: `rentalLeaseScheduleLine.closingNetInvestment` of the last line before the cutover.
3. Add `getCutoverInventory(client, db, { companyId, cutoverDate })`. It returns 3 values per item:
   - On-hand: the sum of `itemLedger.quantity` dated before the cutover.
   - Default unit cost: the average of the open layers, else `itemCost.unitCost`.
   - Inventory account: from the item's posting group.
4. Add `getCutoverFixedAssets(client, { companyId })`. Per asset not Disposed: cost, accumulated depreciation, class accounts.
5. Add `saveOpeningTrialBalance(client, db, { companyId, cutoverDate, userId, lines })`. It keeps one Draft journal with `sourceType 'Opening Balance'`, dated the day before the cutover. It replaces the Draft's lines with `lines`.
6. Add `getMigrationClearing(client, db, { companyId, cutoverDate })`. It calls `migrationClearingByAccount` with the open items, the inventory and asset totals, and the Draft trial balance.
7. Add `updateCutoverAccumulatedDepreciation(client, { companyId, fixedAssetId, accumulatedDepreciation })`.
8. Add validators: `activationCutoverValidator` (cutoverDate), `openingTrialBalanceValidator` (lines JSON `{ accountId, debit, credit }`), `cutoverAccumulatedDepreciationValidator`.
9. Each read uses at most one query per table. Collect ids and use `.in()`. Never query in a loop.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 failed
pnpm --filter erp exec vitest run app/modules/accounting
# Expected: all tests pass
```

**Out of scope:** writes beyond the Draft trial balance and accumulated depreciation (Task 28).

---

## Task 28: Add the `activate-accounting` server function

**Depends on:** Tasks 26, 27
**Files:**
- Create: `packages/server-functions/src/activate-accounting/index.ts`
- Create: `packages/server-functions/src/activate-accounting/activate-accounting.test.ts`
- Modify: the server function registry and permissions manifest. Follow "Adding a server function" in `packages/server-functions/AGENTS.md`.
- Copy from (precedent): `packages/server-functions/src/propose-revenue-recognition-run/index.ts` (structure, `defineServerFn`, input schema, permission)

**Steps:**
1. Input: `{ cutoverDate: string; confirmation: string }`. Permission: `update: accounting`.
2. Open one Kysely transaction. Do these steps in order:
   1. Select `companySettings` for the company `FOR UPDATE`. If `accountingCutoverDate` is set, throw "Accounting is already set up."
   2. If `confirmation` is not the company name, throw "Type the company name to confirm."
   3. Re-run every readiness check and `getMigrationClearing` with the transaction. If one fails, throw its message.
   4. Inventory reset: run `planInventoryReset`. Set `remainingQuantity = 0` on the closed layers. Insert the opening layers with `documentType 'Purchase Receipt'`, `costLedgerType 'Direct Cost'`, `itemLedgerType 'Purchase'`, `postingDate` = the cutover.
   5. Recost: run `recostOutbound`. Update `costLedger.cost` of each outbound row with a delta. Update `remainingQuantity` of each layer.
   6. For each document with a delta: write one Provisional journal dated the document's posting date, description "Cutover recost". Find the document's inventory line and its pair by `journalLineReference`. Move the delta between those 2 accounts.
   7. If a document's inventory line has no pair by `journalLineReference`, STOP and report. Do not guess the offset account.
   8. Set every `Provisional` journal dated before the cutover to `Superseded`.
   9. Set `revenueRecognitionSchedule` rows dated before the cutover with status Planned to Posted, `journalId` null. Do the same for lease Interest rows.
   10. Insert the opening journal with `sourceType 'Opening Balance'` and status Posted. Date it the day before the cutover. Take its lines from `buildOpeningJournalLines`. Resolve its period with `resolveAccountingPeriod`, mode historical. Delete the Draft trial balance journal of Task 27.
   11. Assign periods. For each `Provisional` journal dated on or after the cutover, set `accountingPeriodId` with `resolveAccountingPeriod` (`packages/server-functions/src/lib/get-accounting-period.ts:49`, mode historical). Resolve once per distinct month. Superseded journals keep a null period.
   12. Re-point the stand-in lines. Select the lines with `accountDefaultRole` set, in `Provisional` journals dated on or after the cutover. Set each line's `accountId` to the company's `accountDefault` value for its role. Set `accountDefaultRole` to null. Use one UPDATE per role.
   13. Set every `Provisional` journal dated on or after the cutover to `Posted`, with `postedAt` and `postedBy`.
   14. Close the periods that end before the cutover, oldest first: set `closeStatus 'Closed'`, `closedAt`, `closedBy`, then call `snapshotAccountingPeriodBalances` for each.
   15. Update `companySettings`: `accountingCutoverDate`, `accountingActivatedAt = now`, `accountingActivatedBy = userId`.
3. Write a database test (`databaseTest`) with 1 open invoice, 1 receipt not invoiced and stock of 1 item. Assert after the enable:
   - No journal has status `Provisional`.
   - The opening journal balances and Migration Clearing sums to 0.
   - A payment against the open invoice posts.
   - A second call throws "Accounting is already set up."
   - No line in a Posted journal has `accountDefaultRole` set.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/server-functions
# Expected: 0 failed
pnpm --filter @carbon/server-functions exec vitest run src/activate-accounting
# Expected: all tests pass (with the stack up)
pnpm --filter @carbon/server-functions exec vitest run src/permissions-manifest.test.ts
# Expected: pass
```

**Out of scope:** the UI (Task 31).

---

## Task 29: Handle voids of documents dated before the cutover

**Depends on:** Task 28
**Files:**
- Create: `packages/database/src/accounting-cutover-dates.ts` — `isBeforeCutover(postingDate: string, cutoverDate: string | null): boolean`, with a test
- Modify: `packages/server-functions/src/post-sales-invoice/index.ts` (void at :2512)
- Modify: `packages/server-functions/src/post-purchase-invoice/index.ts` (void at :374)
- Modify: `packages/server-functions/src/post-payment/post-payment-transaction.ts` (void at :116-182)
- Modify: `packages/server-functions/src/post-memo/post-memo-transaction.ts` (void at :135-177)
- Modify: `packages/server-functions/src/post-receipt/index.ts` (void at :275), `post-shipment/index.ts` (voids at :3103, :4113, :4398), `post-inventory-adjustment/index.ts`, `post-inventory-count/index.ts`

**Steps:**
1. For an invoice, payment or memo whose posting date is before the cutover: build the posting again and negate it. Use `buildSalesPostingLines` (`packages/database/src/sales-posting-amounts.ts:299`), `buildPaymentJournal` (`build-payment-journal.ts:128`) and `buildMemoJournal` (`build-memo-journal.ts:100`). Date the void today, in the current period. Status Posted.
2. Never post a void line to `migrationClearingAccount`.
3. If no builder exists for the purchase invoice posting, STOP and report.
4. If an inventory document is dated before the cutover, refuse its void. This covers receipts, shipments, inventory adjustments and inventory counts. Throw: "This document is from before your accounting cutover. Record a return or an inventory adjustment instead."
5. Add 2 database tests:
   - A void of a pre-cutover invoice nets its receivables to 0 against the opening line.
   - A void of a pre-cutover receipt throws the message.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/server-functions --filter=@carbon/database
# Expected: 0 failed
pnpm --filter @carbon/server-functions test
# Expected: all tests pass (with the stack up)
```

**Out of scope:** charges and reimbursements (no cutover rule in the spec).

---

## Task 30: Start depreciation at the cutover

**Depends on:** Task 4
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts:7301` (`buildDepreciationRunLines`)
- Modify: `apps/erp/app/modules/accounting/accounting.utils.test.ts` (near `describe("buildDepreciationLines")` at :946)

**Steps:**
1. Read `companySettings.accountingCutoverDate` in `buildDepreciationRunLines`.
2. At :7301, set `lastPostedPeriodEnd` to the later of the posted run's `periodEnd` and the last day of the month before the cutover. Compare `YYYY-MM-DD` strings; use `@internationalized/date` for the month end.
3. Add a test: an asset that started before the cutover, with no posted run, depreciates from the cutover month only.

**Verify:**
```bash
pnpm --filter erp exec vitest run app/modules/accounting/accounting.utils.test.ts
# Expected: all tests pass
```

**Out of scope:** tax depreciation calculators (they read the same `lastPostedPeriodEnd`).

---

## Task 31: Build the 5-step enable wizard

**Depends on:** Tasks 27, 28
**Files:**
- Create routes under `apps/erp/app/routes/x+/accounting+/`: `activation.tsx` (layout), `activation._index.tsx` (redirect), `activation.readiness.tsx`, `activation.inventory.tsx`, `activation.fixed-assets.tsx`, `activation.trial-balance.tsx`, `activation.enable.tsx`
- Create components in `apps/erp/app/modules/accounting/ui/Activation/`: `ActivationSteps.tsx`, `ReadinessChecklist.tsx`, `InventoryCostTable.tsx`, `FixedAssetDepreciationTable.tsx`, `TrialBalanceEditor.tsx`, `MigrationClearingTable.tsx`, `index.ts`
- Modify: `apps/erp/app/utils/path.ts` — add `accountingActivation` (`${x}/accounting/activation`) and `accountingActivationStep(step)` in the `accounting*` block (:48-66)
- Modify: `apps/erp/app/modules/accounting/ui/AccountingBetaGate.tsx` — never gate the activation routes
- Modify: the Account Defaults form and its validator — add a `migrationClearingAccount` field (Equity accounts). Find the form with `grep -rln "retainedEarningsAccount" apps/erp/app/modules/accounting/ui/AccountDefaults`; the validator is in `accounting.models.ts`
- Copy from (precedent):
  - Wizard: `apps/erp/app/routes/x+/contract+/$id.setup.tsx` (`useCurrentStep` :47-55, footer Back/Next, last-step confirm), `apps/erp/app/modules/sales/ui/Contracts/ContractSetupSteps.tsx`, `apps/erp/app/components/Setup/` (`SetupSteps`, `SetupFrame`, `SetupBody`, `SetupSection`, `SetupFooter`)
  - Readiness rows: `PeriodCloseTaskRow` in `apps/erp/app/routes/x+/accounting+/periods.$periodId.close.tsx:449`; document list: `apps/erp/app/modules/accounting/ui/Periods/PeriodCloseUnpostedDocumentsPopover.tsx`
  - Trial balance editor: the inline Opening Balances mode in `apps/erp/app/routes/x+/accounting+/charts.tsx:132-175` and `ChartOfAccountsTree.tsx:185`, `:288-315`
  - CSV upload: `apps/erp/app/components/ImportCSVModal/UploadCSV.tsx` (PapaParse)
  - Inline unit cost edit: `apps/erp/app/routes/x+/items+/cost.$itemId.tsx` (`path.to.itemCostUpdate`)

**Steps:**
1. Steps, in order: `readiness`, `inventory`, `fixed-assets`, `trial-balance`, `enable`. Labels: "Readiness", "Inventory", "Fixed assets", "Trial balance", "Enable".
2. `activation.tsx` loader: `requirePermissions(request, { view: "accounting" })`. If `accountingCutoverDate` is set, `throw redirect(path.to.accountingPeriods)`. Keep the chosen cutover date in the URL search param `cutover`.
3. `activation._index.tsx`: redirect to the readiness step. Export `middleware = [redirectBeforeLoaders(loader)]`.
4. `readiness`: a period-start date picker (default: start of the current period) and the checklist from `getActivationReadiness`. Next is disabled until every check passes. The `account-defaults` row lists each empty default and links to `path.to.accountingDefaults`.
5. `inventory`: `InventoryCostTable` from `getCutoverInventory`. Each unit cost is an inline `NumberControlled` with `INPUT_FORMAT.rate`. It posts to `path.to.itemCostUpdate`. Show the total per inventory account.
6. `fixed-assets`: `FixedAssetDepreciationTable` from `getCutoverFixedAssets`. Accumulated depreciation is inline editable; the action intent `save-asset` calls `updateCutoverAccumulatedDepreciation`.
7. `trial-balance`: `TrialBalanceEditor` (the chart of accounts with debit and credit inputs) and a CSV upload (`accountNumber, debit, credit`). Map account numbers to ids in the action. List unknown numbers as errors. Intent `save-tb` calls `saveOpeningTrialBalance`. Below it, `MigrationClearingTable` shows `getMigrationClearing`.
8. `enable` shows 4 things:
   - A summary: cutover date, open item count, Migration Clearing total.
   - The text "This cannot be undone."
   - A text field for the company name.
   - The button "Enable accounting". Disable the button unless the clearing total is 0 within 0.01. The action (`update: "accounting"`) invokes `activate-accounting` through `serverFns`, then `throw redirect(path.to.accountingPeriods)` with a success flash.
9. Every action validates with `validator(schema).validate(formData)`. On failure, return `data({}, await flash(request, error(...)))`.
10. Render `<RecordOutlet />` in the layout.
11. Wrap every user-visible string in Lingui (`Trans` or `t`).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 failed
pnpm --filter @carbon/checks test
# Expected: pass (no-bare-outlet, index-redirect-before-loaders)
```

**Out of scope:** the Settings link (Task 34).

---

## Task 32: Replace every ERP read of `accountingEnabled`

**Depends on:** Task 31
**Files (under `apps/erp/app/`):**

| File:line | Change |
|---|---|
| `modules/accounting/ui/AccountingBetaGate.tsx:38` | gate on `accountingCutoverDate == null`; the overlay's button links to `path.to.accountingActivation` with "Set up accounting" |
| `routes/x+/accounting+/_index.tsx:17-21` | redirect to reports when the cutover is set, else to the activation wizard |
| `routes/x+/accounting+/charts.tsx:132-143` | remove the Opening Balances button and mode; the wizard replaces it |
| `modules/accounting/ui/ChartOfAccounts/ChartOfAccountsTree.tsx:131,190,319` | show balances when the cutover is set |
| `routes/x+/get-started+/_layout.tsx:177,241` | read the cutover |
| `routes/x+/reports+/ar-aging.tsx:55-60`, `ap-aging.tsx:55-60`, `inventory-valuation.tsx:42-48` | read the cutover |
| `routes/x+/invoicing+/receivables.tsx:55-60`, `payables.tsx:55-60`, `receivables.adjust.tsx:33-44`, `payables.adjust.tsx:33-44`, `_index.tsx:78-122` | read the cutover |
| `routes/x+/fixed-asset+/capitalize.tsx:113,136,224`, `$fixedAssetId.adjust-cost.tsx:63,72,149` | always show the Offset Account field |
| `modules/inventory/ui/Inventory/InventoryStorageUnits.tsx:343,715,737` | always show the Offset Account field |

**Steps:**
1. Add `hasAccountingCutover(settings): boolean` to `apps/erp/app/modules/accounting/accounting.models.ts`. It returns `settings?.accountingCutoverDate != null`.
2. Make each change in the table. Client components read `useSettings()`. Loaders read `getCompanySettings`.
3. Delete `createOpeningBalanceJournal`, `getExistingOpeningBalanceEntry` (`accounting.service.ts:6472`, `:6497`), `OpeningBalancePostModal.tsx` and `openingBalanceValidator`, if nothing else uses them.

**Verify:**
```bash
grep -rn "accountingEnabled" apps/erp/app packages/ee/src --include='*.ts' --include='*.tsx'
# Expected: no output, except comments you rewrite
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/ee
# Expected: 0 failed
```

**Out of scope:** the settings switch (Task 34), Mark Paid (Task 33).

---

## Task 33: Remove Mark Paid and Mark Unpaid

**Depends on:** Task 31
**Files:**
- Delete: `apps/erp/app/routes/x+/sales-invoice+/$invoiceId.status.tsx`, `apps/erp/app/routes/x+/purchase-invoice+/$invoiceId.status.tsx`
- Modify: `apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoiceHeader.tsx` — delete :116-129, :258-261, :302-341, imports `LuCircleCheck`, `LuCircleX` (:30-31) and `useSettings` (:50); keep `useFetcher`
- Modify: `apps/erp/app/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoiceHeader.tsx` — delete :125-138, :258-297, imports :28-29 and `useSettings` (:45); delete `useFetcher` (:38) only if nothing else uses it
- Modify: `apps/erp/app/utils/path.ts` — delete `salesInvoiceStatus` (:2247) and `purchaseInvoiceStatus` (:1991)
- Modify: `apps/erp/app/modules/invoicing/invoicing.service.ts` — delete `updateSalesInvoiceStatus` (:589) and `updatePurchaseInvoiceStatus` (:542)

**Steps:**
1. Make each change.
2. Grep for each deleted name. If a caller remains, STOP and report.

**Verify:**
```bash
grep -rn "salesInvoiceStatus\|purchaseInvoiceStatus\|updateSalesInvoiceStatus\|updatePurchaseInvoiceStatus\|Mark as Paid" apps/erp/app
# Expected: no output
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 failed
pnpm run generate:mcp
# Expected: the MCP manifest regenerates without errors (the service functions were MCP tools)
```

**Out of scope:** the `.po` files (the pre-commit hook extracts them).

---

## Task 34: Replace the settings switch

**Depends on:** Task 31
**Files:**
- Modify: `apps/erp/app/routes/x+/settings+/accounting.tsx` — delete the intent at :119-127; replace the General Ledger card at :311-338
- Modify: `apps/erp/app/modules/settings/settings.service.ts` — delete `updateAccountingEnabledSetting` (:1031-1040)

**Steps:**
1. In the General Ledger card: if the cutover is set, show "Accounting since {date}" with `formatDate`. Else show a button "Set up accounting" that links to `path.to.accountingActivation`.
2. Delete the switch, the `isInternal` gate and the Alpha badge.
3. Run `pnpm run generate:mcp`. The tool `settings_updateAccountingEnabledSetting` leaves the manifest.

**Verify:**
```bash
grep -rn "updateAccountingEnabledSetting" apps packages --include='*.ts' --include='*.tsx' --include='*.json' | grep -v node_modules
# Expected: no output
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 failed
```

**Out of scope:** the column (it stays).

---

## Task 35: Set the cutover for new companies and demo datasets

**Depends on:** Task 4
**Files:**
- Modify: `packages/server-functions/src/seed-company/index.ts` — inside `if (!identityOnly)` (:234-514), after `fiscalYearSettings` (:484-487)
- Modify: `packages/database/src/datasets/tiers/01-foundation.ts` — `runTier1` (:32)
- Modify: `packages/database/src/datasets/bootstrap.ts:106-109`, `packages/database/src/seed-dev.ts:76-79`
- Copy from (precedent): `packages/database/src/datasets/tiers/04-sales.ts:65-75` (`insertRow` with `onConflict` on `companySettings`)

**Steps:**
1. In `seed-company`, update `companySettings`:
   - `accountingCutoverDate`: the first day of the current period, from `datetime.today(tz)` in the company time zone.
   - `accountingActivatedAt`: `datetime.timestamp()`.
   - `accountingActivatedBy`: the user id.
2. In tier 01: upsert the same 3 columns. The cutover is the first day of `monthBack(ctx.anchor, 11)` from `datasets/dates.ts`, so every seeded journal of tier 09 falls on or after it.
3. Delete the `accountingEnabled = true` updates in `bootstrap.ts` and `seed-dev.ts`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/server-functions --filter=@carbon/database
# Expected: 0 failed
pnpm db:check:datasets
# Expected: all 4 datasets pass
```

**Out of scope:** existing companies (Task 2 step 12).

---

## Task 36: Show the Provisional and Superseded statuses

**Depends on:** Task 4
**Files:**
- Modify: `packages/utils/src/status-colors.ts:259-263` — `Provisional: "yellow"`, `Superseded: "gray"`
- Modify: `apps/erp/app/modules/accounting/ui/JournalEntries/JournalEntryStatus.tsx` — labels "Provisional" and "Before cutover"
- Modify: `apps/erp/app/modules/accounting/accounting.models.ts:781` — add both to `journalEntryStatuses`
- Modify: `apps/erp/app/modules/accounting/ui/JournalEntries/JournalEntriesTable.tsx:142-158` and `accounting.service.ts:5660` (`getJournalEntries`) — exclude `Superseded` unless the filter asks for it
- Modify: `apps/erp/app/modules/invoicing/invoicing.service.ts:2137-2143`, `routes/x+/reimbursements+/$reimbursementId.tsx:86-92`, `routes/x+/invoicing+/charges.$id.tsx:100-106` — select `status` and show the badge

**Steps:**
1. Make each change.
2. Check the 6 importers of `journalEntryStatuses`. If one switches on every value exhaustively, add the 2 cases.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/utils
# Expected: 0 failed
```

**Out of scope:** the MES (it shows no journals).

---

## Task 37: Update the docs, rules and AGENTS.md files

**Depends on:** Tasks 31–36
**Files:**
- Modify: `apps/erp/app/modules/accounting/AGENTS.md` — the cutover, the 3 status lists, `activate-accounting`, the removed opening balance mode
- Modify: `packages/server-functions/AGENTS.md` — `activate-accounting`, `journalPostingStatus`
- Modify: `packages/jobs/AGENTS.md` — the `revenue-recognition-proposal` row (cutover, not the flag)
- Modify: `.claude/rules/accounting-sync-handlers.md` — Provisional and Superseded never sync; promotion syncs
- Modify: `.claude/rules/onboarding-company-templates.md` — tier 01 sets the cutover
- Modify: `docs/content/docs/reference/accounting.mdx` — use the `carbon-docs` skill; describe the enable wizard
- Modify: `.ai/specs/2026-10-08-accounting-cutover.md` — status `implemented` once Task 38 passes; move to `.ai/specs/implemented/`

**Steps:**
1. Update each file. Ground each sentence in the code you wrote.
2. Run `pnpm --filter docs typecheck` after the docs change.

**Verify:**
```bash
pnpm --filter docs typecheck
# Expected: 0 errors
grep -rn "accountingEnabled" apps/erp/app/modules/accounting/AGENTS.md packages/server-functions/AGENTS.md .claude/rules
# Expected: only text that says the column is unused
```

**Out of scope:** a changelog entry (ask the user).

---

## Task 38: Run every gate and verify the enable flow in the browser

**Depends on:** all other tasks
**Files:** none

**Steps:**
1. Run `pnpm db:migrate`.
2. Run `pnpm db:check:datasets` and `pnpm db:check:backups`.
3. Run typecheck for `@carbon/database`, `@carbon/server-functions`, `@carbon/jobs`, `@carbon/ee`, `@carbon/utils`, `erp`, one at a time.
4. Run `pnpm --filter @carbon/database test`, `pnpm --filter @carbon/server-functions test`, `pnpm --filter @carbon/jobs test`, `pnpm --filter @carbon/checks test`, `pnpm --filter erp test`.
5. Invoke `/test` with this playbook, on a company with no cutover:
   1. Post a receipt and a sales invoice. Open Accounting → Journals: the journals show "Provisional"; the trial balance is empty.
   2. Settings → Accounting: click "Set up accounting".
   3. Readiness: choose the start of the current period. Every check passes.
   4. Inventory: change one unit cost.
   5. Fixed assets: continue.
   6. Trial balance: enter a balance that ties. Migration Clearing shows 0.
   7. Enable: type the company name. Click "Enable accounting".
   8. Accounting → Periods: periods before the cutover are Closed.
   9. Pay the sales invoice. The payment posts.
   10. Try to void the receipt. The cutover message shows.

**Verify:**
```bash
# Every command in steps 2-4 exits 0.
# /test reports every playbook step as passed, with screenshots under .context/.
```

**Out of scope:** pushing or opening a pull request (ask the user).

---

## Acceptance criteria coverage

| Spec acceptance criterion | Tasks |
|---|---|
| A company with no cutover posts Provisional journals, and reports show nothing | 6, 11–21, 24 |
| A shipment relieves cost layers with no cutover | 13, 24 |
| A job completion writes the finished-goods layer with no cutover | 21, 24 |
| A payment against a pre-L invoice posts with no cutover | 16, 24 |
| An empty `scrapAccount` gives a stand-in line with its role; the enable re-points it | 5, 11, 24, 28 |
| Readiness lists each empty account default | 27, 31 |
| Mark Paid and Mark Unpaid are gone | 33 |
| The wizard refuses a bad cutover date | 27, 31 |
| One opening line per open invoice | 26, 27, 28 |
| A 5.00 difference keeps Activate disabled | 26, 31 |
| After enable: Provisional on or after D is Posted, before D is Superseded, none remain | 28 |
| A shipment between D and enable carries the reset cost | 26, 28 |
| A payment against a pre-D invoice posts | 25, 28 |
| A purchase invoice clears the opening GR/IR line | 27, 28 |
| A void of a pre-D invoice reverses in the current period, never on Migration Clearing | 29 |
| A void of a pre-D receipt fails with the cutover message | 29 |
| A receipt dated before D fails; currency and fiscal start month are locked | 2, 28 |
| A Superseded journal cannot change; Provisional to Posted in a Closed period fails | 2 |
| A posting waits for the enable lock, then posts as Posted | 5, 28 |
| A new company posts as Posted | 35 |
| `journal-status-filter` flags `<> 'Draft'` | 8 |
| Datasets, typecheck, tests and lint pass | 38 |

## Execution notes

- Task 10 changed while executing: a Provisional journal has no accounting period (spec section 1 item 3). Phase B shared step 5, Task 21, Task 24 and Task 28 follow from it.
- Task 1 widened `journalEntryStatus`; the ERP typecheck then failed in the status badge and the provider journal schema. That fix (labels, colors, `journalEntryStatuses`, `core/models.ts`) is committed with Task 10, ahead of Task 36. Task 36 keeps the journal list filter and the document panels.
- New UI strings are translated in one `/translate` batch at the end of Phase D, not per commit.
- Task 7 is committed with Task 1. The pre-commit dataset check refuses the new enum values until the exclusions exist.
- `pnpm db:migrate:new` waits on stdin when stdin is not a terminal. Run it as `pnpm db:migrate:new <name> < /dev/null`.
- A commit that touches a migration or `packages/database/src` needs `pnpm generate:mcp` first, then stage `apps/erp/app/routes/api+/mcp+/lib/tool-manifest.digest.json`.
- The dataset and backup checks read `SUPABASE_DB_URL` from `.env` (port 54322). This worktree's stack is on `.env.local` (port 55625). Export it before a commit: `export $(grep -E "^SUPABASE_DB_URL=" .env.local | xargs)`.
