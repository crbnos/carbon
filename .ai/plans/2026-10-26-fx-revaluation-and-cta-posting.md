# Period-End FX Revaluation and Posted CTA — implementation plan

**Spec:** .ai/specs/2026-10-26-fx-revaluation-and-cta-posting.md
**Research:** .ai/research/2026-10-26-fx-revaluation-and-cta-posting.md
**Closest sibling:** the depreciation run (routes `x+/accounting+/depreciation-runs*.tsx`, `x+/depreciation-run+/`, UI `modules/accounting/ui/FixedAssets/DepreciationRun*.tsx`)
**Branch:** tianjin

## Plan decisions not in the spec

| # | Decision | Why |
|---|---|---|
| P1 | The pure math goes in a new `packages/database/src/currency-revaluation.ts`, tested by value. | Same home as `run-journals.ts`. The ERP and the tests import it as `@carbon/database/currency-revaluation`. |
| P2 | New run tables copy the revenue recognition run DDL (`id('…')`, composite PK, no RLS in the migration). They do not copy `depreciationRun` (`xid()`, single PK). | House convention. RLS comes from the authz manifest. |
| P3 | The account form fix (`consolidatedRate`) ships in Phase 2, in the same task as Account Currency. | Both change `ChartOfAccountForm.tsx`. Phase 3 needs it first. |
| P4 | The demo datasets get no revaluation runs. | `journalEntrySourceType` is not a coverage set in `datasets/validate.ts`. The new tables are not in `COVERAGE_FLOORS`. Seeding a posted run is a follow-up. |
| P5 | No `sync_advance_document_sequence` entry for the run. | Nobody types a run id by hand. |
| P6 | Sort orders: `fx-revaluation` = 4, `cta-posted` = 6. | 4 sorts after depreciation and before the intercompany task (5). 6 sorts after it. |
| P7 | Building blocks call RPCs from Kysely with raw `sql`. | Precedent: `packages/database/src/accounting-cutover/open-items.ts:196-205`. |

## Conventions for every task

- Read `.ai/lessons.md` lines 124-142, 352-360, 1977-1983, 2005, 4049 before the first task.
- Run the SPDX fixer on each new file: `git add <file>`, then `pnpm --filter @carbon/checks license-headers -- <file>`.
- Never use JS `Date`. Use `@internationalized/date` and `@carbon/utils` (`.claude/rules/date-handling.md`).
- Round only with `round` from `@carbon/database/precision`. Never use `Math.round` or `toFixed`.
- Mark every UI string with Lingui (`t` from `useLingui()`, `<Trans>`, `msg` in breadcrumbs).
- Scope every Kysely read and write by `companyId`.
- A route action validates, makes one `carbon(request)` call, and returns or redirects. It holds no write of its own.
- Never edit a migration that `pnpm db:migrate` has applied. Create a new one.
- Never rebuild the database.
- If a fact in a step turns out false, STOP and report. Do not improvise.

## Progress

Phase 1 — Currency Revaluation run
- [x] Task 1: Add the two journal source types (enum migration)
- [x] Task 2: Create the Phase 1 schema migration
- [x] Task 3: Add the RLS manifest rules, apply, and generate types
- [x] Task 4: Add the account defaults to the seed and the lists
- [x] Task 5: Wire the two source types into the ledger code
- [x] Task 6: Add the four accounts to the account defaults form
- [x] Task 7: Write the pure revaluation math with tests
- [x] Task 8: Write the exposure reader
- [x] Task 9: Write the run create, recalculate, rate and delete building blocks
- [x] Task 10: Write the post and Undo building blocks
- [x] Task 11: Add the service functions
- [x] Task 12: Add the `fx-revaluation` close check
- [x] Task 13: Add the paths and routes
- [x] Task 14: Build the run UI
- [x] Task 15: Add the Create Run button to the period close page

Phase 2 — Foreign-currency balance accounts
- [x] Task 16: Add `account.currencyCode` and recreate the `accounts` view
- [x] Task 17: Add Account Currency and fix `consolidatedRate` in the account form
- [x] Task 18: Add Account Balance lines to the run

Phase 3 — Posted CTA
- [x] Task 19: Create the offset account default
- [x] Task 20: Change `applyReportCta` for a posted CTA
- [x] Task 21: Write the CTA preview and post
- [x] Task 22: Add the `cta-posted` check and the CTA modal

Finish
- [x] Task 23: Update docs, AGENTS.md and rules
- [ ] Task 24: Run the full verification sweep
- [ ] Task 25: Extract and translate the new strings
- [ ] Task 26: Verify in the browser

## Dependencies

- Task 2 needs Task 1. Task 3 needs Task 2. Tasks 4–15 need Task 3 (types).
- Tasks 4, 5, 6 and 7 are independent of each other.
- Task 8 needs Task 7. Task 9 needs Task 8. Task 10 needs Task 9. Task 11 needs Tasks 9–10.
- Task 12 needs Task 8. Task 13 needs Task 11. Task 14 needs Task 13. Task 15 needs Tasks 12–13.
- Task 17 needs Task 16. Task 18 needs Tasks 14 and 16.
- Task 19 needs Task 1. Task 20 needs Task 19. Task 21 needs Task 20. Task 22 needs Task 21.
- Tasks 23–26 run last, in order.

---

## Task 1: Add the two journal source types (enum migration)

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_fx-revaluation-enums.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20261011163133_lessee-lease-enums.sql`

**Steps:**
1. Make sure no `crbn up`, `crbn migrate` or `pnpm db:migrate` is running (`.ai/lessons.md:2300`).
2. Run `pnpm db:migrate:new fx-revaluation-enums`.
3. Write this SQL in the new file:

```sql
-- Enum additions live alone: ADD VALUE cannot be used in the same transaction as the value.
-- Spec: .ai/specs/2026-10-26-fx-revaluation-and-cta-posting.md
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Currency Revaluation';
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Currency Translation';
```

**Verify:**
```bash
ls packages/database/supabase/migrations | tail -1
# Expected: <timestamp>_fx-revaluation-enums.sql, HHMMSS not 000000, newer than every other file
```

**Out of scope:** `journalLineDocumentType`. The revaluation lines reuse the source document's own type.

---

## Task 2: Create the Phase 1 schema migration

**Depends on:** Task 1
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_currency-revaluation.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20261011163211_lessee-leases.sql` lines 12-150 (columns, FKs, accounts, backfill, sequence, close task) and `20261006220201_revenue-recognition-core.sql` lines 245-299 (run table DDL)

**Steps:**
1. Run `pnpm db:migrate:new currency-revaluation`.
2. Write section 1, the account default columns:

```sql
ALTER TABLE "accountDefault"
  ADD COLUMN IF NOT EXISTS "unrealizedExchangeGainAccount" TEXT,
  ADD COLUMN IF NOT EXISTS "unrealizedExchangeLossAccount" TEXT,
  ADD COLUMN IF NOT EXISTS "arRevaluationAccount" TEXT,
  ADD COLUMN IF NOT EXISTS "apRevaluationAccount" TEXT;
```

3. Write section 2, the FKs. Copy the `DO $leasefk$` block (lessee-leases lines 21-40). Rename it `$fxfk$`. Use the four column names above.
4. Write section 3, the accounts. Copy the `DO $leaseaccounts$` block (lines 46-96). Rename it `$fxaccounts$`. Replace its `VALUES` with:

```sql
('4160', 'Unrealized Exchange Gains',  'Revenue',   'Other Income',            'Income Statement', 'Average', 'Other Income',   ARRAY['4120', '4110']),
('7030', 'Unrealized Exchange Losses', 'Expense',   'Other Expense',           'Income Statement', 'Average', 'Other Expenses', ARRAY['7060', '7010']),
('1170', 'AR Revaluation Adjustment',  'Asset',     'Other Current Asset',     'Balance Sheet',    'Current', 'Receivables',    ARRAY['1110', '1130']),
('2030', 'AP Revaluation Adjustment',  'Liability', 'Other Current Liability', 'Balance Sheet',    'Current', 'Payables',       ARRAY['2010', '2020'])
```

5. Write section 4, the backfill. Copy lines 98-129. Map the columns:

| Column | Number | Name |
|---|---|---|
| `unrealizedExchangeGainAccount` | 4160 | Unrealized Exchange Gains |
| `unrealizedExchangeLossAccount` | 7030 | Unrealized Exchange Losses |
| `arRevaluationAccount` | 1170 | AR Revaluation Adjustment |
| `apRevaluationAccount` | 2030 | AP Revaluation Adjustment |

6. Write section 5, the run tables:

```sql
CREATE TABLE IF NOT EXISTS "currencyRevaluationRun" (
  "id" TEXT NOT NULL DEFAULT id('fxr'),
  "currencyRevaluationRunId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "periodEnd" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Draft',
  "journalId" TEXT,
  "reversalJournalId" TEXT,
  "postedAt" TIMESTAMP WITH TIME ZONE,
  "postedBy" TEXT REFERENCES "user"("id"),
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "currencyRevaluationRun_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "currencyRevaluationRun_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "currencyRevaluationRun_status_check" CHECK ("status" IN ('Draft', 'Posted'))
);

CREATE TABLE IF NOT EXISTS "currencyRevaluationRate" (
  "id" TEXT NOT NULL DEFAULT id('fxrr'),
  "companyId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "currencyCode" TEXT NOT NULL REFERENCES "currencyCode"("code"),
  "rate" NUMERIC NOT NULL,
  "rateSource" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "currencyRevaluationRate_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "currencyRevaluationRate_run_fkey" FOREIGN KEY ("runId", "companyId")
    REFERENCES "currencyRevaluationRun"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "currencyRevaluationRate_rate_check" CHECK ("rate" > 0 AND "rate" <> 'NaN'::numeric),
  CONSTRAINT "currencyRevaluationRate_source_check" CHECK ("rateSource" IN ('Market', 'Override', 'Manual'))
);

CREATE TABLE IF NOT EXISTS "currencyRevaluationLine" (
  "id" TEXT NOT NULL DEFAULT id('fxrl'),
  "companyId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "exposureType" TEXT NOT NULL,
  "documentType" TEXT,
  "documentId" TEXT,
  "documentNumber" TEXT,
  "accountId" TEXT NOT NULL REFERENCES "account"("id"),
  "currencyCode" TEXT NOT NULL REFERENCES "currencyCode"("code"),
  "openAmount" NUMERIC,
  "openAmountEnteredBy" TEXT REFERENCES "user"("id"),
  "openAmountEnteredAt" TIMESTAMP WITH TIME ZONE,
  "bookedBaseAmount" NUMERIC NOT NULL,
  "revaluedBaseAmount" NUMERIC,
  "differenceAmount" NUMERIC,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "currencyRevaluationLine_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "currencyRevaluationLine_run_fkey" FOREIGN KEY ("runId", "companyId")
    REFERENCES "currencyRevaluationRun"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "currencyRevaluationLine_exposureType_check" CHECK ("exposureType" IN (
    'Receivable', 'Payable', 'Unapplied Receipt', 'Unapplied Disbursement', 'Account Balance'))
);
```

7. Add the named constraints and indexes. Guard each constraint with a `pg_constraint` check, as in step 3:

```sql
-- constraints (inside one DO block, each guarded)
--   currencyRevaluationRun_readable_key UNIQUE ("currencyRevaluationRunId", "companyId")
--   currencyRevaluationRun_period_key   UNIQUE ("companyId", "periodEnd")
--   currencyRevaluationRate_run_currency_key UNIQUE ("runId", "currencyCode")
CREATE INDEX IF NOT EXISTS "currencyRevaluationRun_companyId_idx" ON "currencyRevaluationRun" ("companyId");
CREATE INDEX IF NOT EXISTS "currencyRevaluationRate_runId_idx" ON "currencyRevaluationRate" ("runId", "companyId");
CREATE INDEX IF NOT EXISTS "currencyRevaluationLine_runId_idx" ON "currencyRevaluationLine" ("runId", "companyId");
CREATE INDEX IF NOT EXISTS "currencyRevaluationLine_accountId_idx" ON "currencyRevaluationLine" ("accountId");
CREATE INDEX IF NOT EXISTS "currencyRevaluationLine_currencyCode_idx" ON "currencyRevaluationLine" ("currencyCode");
CREATE INDEX IF NOT EXISTS "currencyRevaluationRate_currencyCode_idx" ON "currencyRevaluationRate" ("currencyCode");
-- RLS: the policies are rendered from packages/database/src/authz/manifest.ts.
```

8. Add the journal FKs. Copy the style of the `journalId` FK on `revenueRecognitionRun` in `20261006220201`. Add one FK for `journalId` and one for `reversalJournalId`. Add an index on each column.
9. Write section 6, the sequence. Copy lessee-leases lines 132-140 with `'currencyRevaluationRun', 'Currency Revaluation Run', 'FXR', NULL, 0, 6, 1`.
10. Write section 7, the close task. Copy lessee-leases lines 142-150 with these values:
    - `name`: `'Revalue foreign currency balances'`
    - `autoCheckKey`: `'fx-revaluation'`
    - `sortOrder`: 4
    - `severity`: `'Warning'`
11. Write no `CREATE POLICY`, no `ENABLE ROW LEVEL SECURITY` and no `set_event_triggers`.

**Verify:**
```bash
grep -c "CREATE POLICY\|ENABLE ROW LEVEL SECURITY\|set_event_triggers" packages/database/supabase/migrations/*_currency-revaluation.sql
# Expected: 0
grep -c "Other Current Liability" packages/database/supabase/migrations/20260229000003_chart-of-accounts-tree.sql
# Expected: 1 or more (the account type exists)
```

If a Receivables or Payables group does not exist in `seed-data.ts`, STOP and report.

**Out of scope:** the offset account (Task 19). `account.currencyCode` (Task 16).

---

## Task 3: Add the RLS manifest rules, apply, and generate types

**Depends on:** Task 2
**Files:**
- Modify: `packages/database/src/authz/manifest.ts` — add three rules in alphabetical order
- Create: the generated RLS migration (by command)
- Modify: `packages/database/src/types.ts` (generated)
- Copy from (precedent): `packages/database/src/authz/manifest.ts:1364-1365` (`revenueRecognitionRun`)

**Steps:**
1. Add these lines to the manifest, each in its alphabetical place:

```ts
currencyRevaluationLine: company("accounting", { read: "accounting_view" }),
currencyRevaluationRate: company("accounting", { read: "accounting_view" }),
currencyRevaluationRun: company("accounting", { read: "accounting_view" }),
```

2. Run `pnpm db:migrate`.
3. Run `pnpm --filter @carbon/database authz migration currency-revaluation-rls`.
4. Run `pnpm db:migrate`.
5. Run `pnpm run generate:types`.

**Verify:**
```bash
pnpm --filter @carbon/database exec vitest run src/authz/migration.test.ts
# Expected: passes
pnpm --filter @carbon/database authz check
# Expected: exit 0, no drift
grep -n '"Currency Revaluation"' packages/database/src/types.ts | head -2
# Expected: matches in the journalEntrySourceType enum
grep -n 'currencyRevaluationRun: {' packages/database/src/types.ts | head -1
# Expected: a match
```

**Out of scope:** `audit.config.ts` (Ask First). `event-system/attachments.ts` (P5).

---

## Task 4: Add the account defaults to the seed and the lists

**Depends on:** Task 3
**Files:**
- Modify: `packages/database/src/seed-data.ts` — four accounts, `accountDefaults`, `sequences`, `periodCloseTaskDefinitions`
- Modify: `packages/database/src/accounting-cutover/shared.ts` — `ACCOUNT_DEFAULT_COLUMNS` (lines 57-125)
- Modify: `packages/database/src/journal-posting-status.ts` — `OPTIONAL_DEFAULT_ROLES` (72-97), `OPTIONAL_DEFAULT_LABELS` (124-150)
- Modify: `packages/database/src/account-import.ts` — `ROLE_NAMES` (51-122)
- Copy from (precedent): the `leaseInterestExpenseAccount` entries in each of those files

**Steps:**
1. In `seed-data.ts`, add four account entries, each beside its sibling:
   - after 4120 (line 1664): `{ key: "4160", number: "4160", name: "Unrealized Exchange Gains", isGroup: false, parentKey: "other-income", accountType: "Other Income", incomeBalance: "Income Statement", class: "Revenue", consolidatedRate: "Average", createdBy: "system" }`
   - after 7020: 7030 "Unrealized Exchange Losses", `parentKey: "other-expenses"`, `accountType: "Other Expense"`, class Expense, Average
   - after 1160: 1170 "AR Revaluation Adjustment", `parentKey: "receivables"`, `accountType: "Other Current Asset"`, Balance Sheet, Asset, Current
   - after 2020: 2030 "AP Revaluation Adjustment", `parentKey: "payables"`, `accountType: "Other Current Liability"`, Balance Sheet, Liability, Current
2. In `accountDefaults` (line 2241), add `unrealizedExchangeGainAccount: "4160"`, `unrealizedExchangeLossAccount: "7030"`, `arRevaluationAccount: "1170"` and `apRevaluationAccount: "2030"`.
3. In `sequences`, add `{ table: "currencyRevaluationRun", name: "Currency Revaluation Run", prefix: "FXR", suffix: null, next: 0, size: 6, step: 1 }`.
4. In `periodCloseTaskDefinitions` (line 2402), add the Task 2 close task with `sortOrder: 4`.
5. Add the four columns to `ACCOUNT_DEFAULT_COLUMNS`, `OPTIONAL_DEFAULT_ROLES`, `OPTIONAL_DEFAULT_LABELS` and `ROLE_NAMES`. Use these labels:
   - "Unrealized Exchange Gain"
   - "Unrealized Exchange Loss"
   - "AR Revaluation Adjustment"
   - "AP Revaluation Adjustment"

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: 0 errors (UnlistedAccountDefaultColumn and ROLE_NAMES compile)
pnpm --filter @carbon/database test
# Expected: passes
```

**Out of scope:** `settings.service.ts` `arApDefaultFallbacks`. It holds NOT NULL columns only.

---

## Task 5: Wire the two source types into the ledger code

**Depends on:** Task 3
**Files:**
- Modify: `packages/ee/src/accounting/core/models.ts` — `POSTING_POLICY` (425-645)
- Modify: `apps/erp/app/modules/accounting/accounting.models.ts` — `journalEntrySourceTypes` (716-749), `RUN_JOURNAL_SOURCES` (1223-1227)
- Modify: `apps/erp/app/components/Icons.tsx` — `JournalEntrySourceTypeIcon` (602-675)
- Copy from (precedent): the `"Lease Run"` entry in each file

**Steps:**
1. Add to `POSTING_POLICY`:

```ts
// Period-end FX revaluation (valuation + day-1 reversal). Off by default, like
// every newer type, so an existing integration never starts pushing it unasked.
"Currency Revaluation": { representation: "journal", defaultEnabled: false, defaultGranularity: "individual" },
// The posted CTA lives on an elimination entity, which has no integration.
"Currency Translation": { representation: "journal", syncable: false, defaultEnabled: false, defaultGranularity: "individual" },
```

2. Add both values to `journalEntrySourceTypes`.
3. Add `"Currency Revaluation": "currency revaluation"` to `RUN_JOURNAL_SOURCES`.
4. Map both values to `LuArrowLeftRight` in the icon map. Import it from `react-icons/lu`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=erp
# Expected: 0 errors
```

**Out of scope:** `run-type.ts`. The revaluation run is not a `runType`.

---

## Task 6: Add the four accounts to the account defaults form

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/modules/accounting/ui/AccountDefaults/AccountDefaultsForm.tsx` — `useAccountDefaultGroups()` (69-608)
- Modify: `apps/erp/app/modules/accounting/accounting.models.ts` — `defaultBalanceSheetAccountValidator` (431-508), `defaultIncomeAcountValidator` (510-602)
- Modify: `apps/erp/app/modules/accounting/accounting.server.ts` — `updateDefaultAccounts` input (3039-3106)
- Copy from (precedent): the `realizedExchangeGainAccount` field (form 396-401, validator 583) and `leaseInterestExpenseAccount` (`.optional()`, validator 601)

**Steps:**
1. Add the fields to the form:

| Field | Group | Label | `badgeType` |
|---|---|---|---|
| `arRevaluationAccount` | `receivables` | AR Revaluation Adjustment | Asset |
| `apRevaluationAccount` | `payables` | AP Revaluation Adjustment | Liability |
| `unrealizedExchangeGainAccount` | `revenue`, after Realized Exchange Gain | Unrealized Exchange Gain | Revenue |
| `unrealizedExchangeLossAccount` | `expenses`, after Realized Exchange Loss | Unrealized Exchange Loss | Expense |

2. Give each field a one-sentence description. Example: "Other Income account for FX gains when period-end revaluation restates an open foreign-currency balance".
3. Add each field to its validator as `zfd.text(z.string().optional())`, the same as `leaseInterestExpenseAccount`.
4. Add each key to the `updateDefaultAccounts` input object.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** glossary `termId` entries.

---

## Task 7: Write the pure revaluation math with tests

**Depends on:** Task 3
**Files:**
- Create: `packages/database/src/currency-revaluation.ts`
- Create: `packages/database/src/currency-revaluation.test.ts`
- Modify: `packages/database/package.json` — add the export `"./currency-revaluation"`
- Copy from (precedent): `packages/database/src/run-journals.ts` (`RunJournal`, `RunJournalLine`, `buildDepreciationJournals`) and `packages/database/src/run-journals.test.ts`

**Steps:**
1. Define the types:

```ts
export type ExposureType =
  | "Receivable" | "Payable" | "Unapplied Receipt" | "Unapplied Disbursement" | "Account Balance";

export type RevaluationExposure = {
  exposureType: ExposureType;
  documentType: string | null;
  documentId: string | null;
  documentNumber: string | null;
  accountId: string;          // adjustment account, or the balance account
  accountClass: "Asset" | "Liability";
  currencyCode: string;
  openAmount: number | null;  // document currency, natural sign; null = not entered
  bookedBaseAmount: number;   // base, natural sign
};

export type RevaluedLine = RevaluationExposure & {
  revaluedBaseAmount: number | null;
  differenceAmount: number | null; // positive = gain
};
```

2. Write `exposureSide(exposure): 1 | -1`. `Receivable` and `Unapplied Disbursement` return 1. `Payable` and `Unapplied Receipt` return −1. `Account Balance` returns 1 for Asset and −1 for Liability.
3. Write `revalueExposure(exposure, rate: number): RevaluedLine`:
   1. If `openAmount` is null, return the line with both results null.
   2. Set `revaluedBaseAmount = toBaseAmount(openAmount, rate)` (`./accounting-currency`).
   3. Set `differenceAmount = round(exposureSide(exposure) * (revaluedBaseAmount - bookedBaseAmount))`.
4. Write `buildCurrencyRevaluationJournals(args)`:

```ts
export function buildCurrencyRevaluationJournals(args: {
  readableId: string;
  lines: RevaluedLine[];
  gainAccountId: string;
  lossAccountId: string;
}): { valuation: RunJournal; reversal: RunJournal }
```

   For each line with a non-zero `differenceAmount`:
   1. Post one line on `accountId`, debit `differenceAmount` when positive and credit it when negative. Sign the amount with `debit()` / `credit()` and `accountTypeFromClass` from `./ledger`.
   2. Keep `documentType` and `documentId` on that line.

   Then post the gain and loss totals:
   1. One credit line on `gainAccountId` for the sum of positive differences ("Unrealized FX Gain").
   2. One debit line on `lossAccountId` for the sum of negative differences ("Unrealized FX Loss").
   3. Leave out a total line that is 0.

   `reversal` holds every valuation line with its amount negated. Its description is "Reversal of {readableId}". Both journals use `sourceType: "Currency Revaluation"`. Call `assertBalanced` on both before you return them.
5. Write the tests with one `base({...})` fixture builder. Use literal expected values:
   - A Receivable of €1,000 booked at $1,111.11, at rate 0.85: revalued $1,176.47 and difference +65.36. Show the arithmetic in a comment.
   - A Payable with the same numbers: difference −65.36.
   - An AR credit memo (openAmount −100, booked −111.11, rate 0.85): difference −6.54.
   - `it.each` over the five exposure types for the side.
   - A null `openAmount` gives null results and no journal line.
   - The journals for one gain line and one loss line: the full `toEqual` result for `valuation` and `reversal`.
   - A zero difference adds no line.

**Verify:**
```bash
pnpm --filter @carbon/database exec vitest run src/currency-revaluation.test.ts
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: 0 errors
```

**Out of scope:** database reads. Rate lookup.

---

## Task 8: Write the exposure reader

**Depends on:** Task 7
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — add `readRevaluationExposures`
- Copy from (precedent): `packages/database/src/accounting-cutover/open-items.ts:196-205` (raw RPC call from Kysely), `apps/erp/app/modules/invoicing/invoicing.service.ts:2822` `loadOnAccountSources` (how it feeds `remainingFundingSources`)

**Steps:**
1. Add the signature:

```ts
export async function readRevaluationExposures(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; periodEnd: string; defaults: {
    arRevaluationAccount: string; apRevaluationAccount: string } }
): Promise<{ exposures: RevaluationExposure[]; notRevalued: { documentType: string; documentId: string; documentNumber: string }[] }>
```

2. Read the company's `baseCurrencyCode`.
3. Read `get_ar_open_by_customer(companyId, periodEnd)` with raw `sql`. Keep the rows whose `currencyCode` differs from the base. Each row becomes a `Receivable` exposure on `arRevaluationAccount` with class Asset, `openAmount = openInCurrency` and `bookedBaseAmount = openInBase`.
4. Do the same with `get_ap_open_by_supplier` for `Payable` exposures on `apRevaluationAccount` with class Liability.
5. Apply the invoice fallback:
   1. Find the invoices from steps 3–4 that have a settlement with a NULL `sourceAmount`. Use one Kysely query on `invoiceSettlement` with `targetSalesInvoiceId` / `targetPurchaseInvoiceId`, scoped by `companyId`.
   2. For each such invoice, set `openAmount = toDocumentAmount(openInBase, exchangeRate, decimalPlaces)`.
   3. Read `decimalPlaces` with `currencyDecimals` (`shared.service.ts:14912`).
6. Add the legacy memo warnings:
   1. Select the Posted memos in a non-base currency, dated on or before `periodEnd`.
   2. Keep the memos that have a settlement with a NULL `sourceAmount`.
   3. Return them as `notRevalued`.
7. Build the unapplied cash:
   1. Select the Posted payments with `postingDate <= periodEnd` and a non-base `currencyCode`.
   2. Take customer receipts (`customerId` set, `salesOrderId` and `rentalAgreementId` null) and supplier disbursements (`supplierId` set).
   3. Select their settlements where the applying payment (`paymentId`) is Posted with `postingDate <= periodEnd`.
   4. Call `remainingFundingSources` once for receipts (`isAR: true`) and once for disbursements (`isAR: false`).
   5. Each source becomes an exposure with `openAmount = remainingDocument` and `bookedBaseAmount = remainingBase`:
      - a receipt: `Unapplied Receipt` on `arRevaluationAccount`, class Asset;
      - a disbursement: `Unapplied Disbursement` on `apRevaluationAccount`, class Liability.
8. Make no query inside a loop. Batch every id list into one `.where(…, "in", ids)`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: errors only from files later tasks create (none in accounting.service.ts)
```
Task 26 tests the reader end to end. If `remainingFundingSources` throws on a legacy payment, STOP and report.

**Out of scope:** `Account Balance` exposures (Task 18).

---

## Task 9: Write the run create, recalculate, rate and delete building blocks

**Depends on:** Task 8
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts`
- Copy from (precedent): `createDepreciationRun` (:7723), `replaceDepreciationRunLines` (:10393), `insertDepreciationRun` (:7452), `getDepreciationRuns`, `getDepreciationRun`, `getDepreciationRunLines`

**Steps:**
1. Write `resolveRevaluationRates(db, { companyId, periodEnd, currencyCodes })`. For each currency:
   1. Call `SELECT get_exchange_rate(companyId, code, periodEnd::date)` with raw `sql`.
   2. Set `rateSource` to `Override` when an `exchangeRateOverride` row exists for (company, code), else `Market`.
   3. Read every override row in one query.
2. Write `createCurrencyRevaluationRun(db, { companyId, periodEnd, userId })`:
   1. Read the cutover with `readAccountingCutoverDate`. If none, throw `ACCOUNTING_NOT_STARTED`.
   2. Read the four new defaults. If one is empty, throw "Set the Unrealized Exchange Gain, Unrealized Exchange Loss, AR Revaluation Adjustment and AP Revaluation Adjustment account defaults first".
   3. Read the exposures (Task 8).
   4. Resolve the rates.
   5. Revalue each line with `revalueExposure`.
   6. Insert the run, its rates and its lines in one `withTransaction`.
   7. Number the run with `getNextSequenceInTransaction(trx, "currencyRevaluationRun", companyId)`.
   8. Return `{ id, readableId }`.
3. Write `recalculateCurrencyRevaluationRun(db, { runId, companyId, userId })`:
   1. Lock the run `FOR UPDATE`. Refuse unless it is Draft.
   2. Read the exposures again.
   3. Add a rate row for each new currency, with the default rate.
   4. Keep the stored rates for the existing currencies.
   5. Rebuild the lines.
   6. Return `{ changed: boolean }`.
4. Write `updateCurrencyRevaluationRate(db, { runId, currencyCode, rate, companyId, userId })`. It refuses unless the run is Draft. It sets `rate` and `rateSource = 'Manual'`, then recalculates the lines of that currency.
5. Write `deleteCurrencyRevaluationRun(db, { runId, companyId })`. It deletes a Draft run only. The lines and rates cascade.
6. Write the reads with the Supabase client:
   - `getCurrencyRevaluationRuns(client, companyId, args)`, copying `getDepreciationRuns` (search, paging, sorts, filters)
   - `getCurrencyRevaluationRun(client, id)`
   - `getCurrencyRevaluationLines(client, runId)`, paged with `fetchAllFromTable`
   - `getCurrencyRevaluationRates(client, runId)`

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors in accounting.service.ts
```

**Out of scope:** posting.

---

## Task 10: Write the post and Undo building blocks

**Depends on:** Task 9
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts`
- Copy from (precedent): `postDepreciationRun` (:10550-10793), `insertPostedRunJournal` (:10019), `reverseDepreciationRun` (:11698), `reverseRunJournals` (:11340)

**Steps:**
1. Write `postCurrencyRevaluationRun(db, args)`:

```ts
export async function postCurrencyRevaluationRun(db: Kysely<KyselyDatabase>, args: {
  runId: string; readableId: string;
  valuationPeriod: { accountingPeriodId: string; postingDate: string };
  reversalPeriod: { accountingPeriodId: string; postingDate: string };
  expectedLineIds: string[]; gainAccountId: string; lossAccountId: string;
  companyId: string; userId: string;
}): Promise<{ journalId: string; reversalJournalId: string }>
```

   Follow these steps:
   1. Throw `ACCOUNTING_NOT_STARTED` if the cutover is missing.
   2. Open `db.transaction()`.
   3. Lock the run `FOR UPDATE`. If it is not Draft, throw `RunOutOfDateError`.
   4. Read the lines. If their ids differ from `expectedLineIds`, throw `RunOutOfDateError`.
   5. If any `Account Balance` line has a null `openAmount`, throw `RunOutOfDateError("Enter the statement balance for every account before posting")`.
   6. Call `buildCurrencyRevaluationJournals`.
   7. Insert the valuation journal with `insertPostedRunJournal` on `valuationPeriod`.
   8. Insert the reversal journal on `reversalPeriod`.
   9. Set `journalId`, `reversalJournalId`, `status = 'Posted'`, `postedAt` and `postedBy` on the run.
   10. Never set `journal.reversedById`.
2. Write `reverseCurrencyRevaluationRun(db, { runId, periods, companyId, userId })`:
   1. Lock the run. Refuse with `RunReversalError` unless it is Posted.
   2. Call `reverseRunJournals` with both journal ids.
   3. Set the run to Draft. Clear `journalId`, `reversalJournalId`, `postedAt` and `postedBy`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors in accounting.service.ts
```

**Out of scope:** period resolution. The service function in Task 11 does it before the transaction.

---

## Task 11: Add the service functions

**Depends on:** Tasks 9, 10
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.server.ts`
- Copy from (precedent): `createDepreciationRun` (:47), `postDepreciationRun` (:113), `recalculateDepreciationRun` (:304), `reverseDepreciationRun` (:468), `createRunForPeriod` (:994)

**Steps:**
1. Add these operations with `defineServiceFn`, each with an `@mcp` TSDoc. Reverse and delete get `@mcp destructive`.

| Operation | `input` | `permission` |
|---|---|---|
| `createCurrencyRevaluationRun` | `{ periodEnd: z.string() }` | `{ create: "accounting" }` |
| `recalculateCurrencyRevaluationRun` | `{ runId: z.string() }` | `{ update: "accounting" }` |
| `updateCurrencyRevaluationRate` | `{ runId, currencyCode, rate: z.number().positive() }` | `{ update: "accounting" }` |
| `postCurrencyRevaluationRun` | `{ runId: z.string() }` | `{ update: "accounting" }` |
| `reverseCurrencyRevaluationRun` | `{ runId: z.string() }` | `{ update: "accounting" }` |
| `deleteCurrencyRevaluationRun` | `{ runId: z.string() }` | `{ delete: "accounting" }` |

2. In `createCurrencyRevaluationRun`:
   1. Snap `periodEnd` to the month end with `monthEndOf`.
   2. Refuse a future period with `futureRunPeriodError`.
   3. Refuse with `conflict` when a run exists for the period end. Pass `{ draftRunId }` so `existingDraftRunId` reads it.
   4. Call the building block with `ctx.asSystem.pg`.
   5. Map the errors with `service.refusal`.
3. In `postCurrencyRevaluationRun`, do these steps before calling the building block:
   1. Load the run (`notFound`, or `conflict` when not Draft).
   2. Run `futureRunPeriodError`.
   3. Read the exposures again and compare them with the stored lines: the set of documents, `openAmount` and `bookedBaseAmount`.
   4. If they differ, return `conflict` "The run is out of date. Recalculate it, then post."
   5. Resolve `valuationPeriod` with `getOrCreateAccountingPeriod(client, companyId, periodEnd, "accounting")`.
   6. Resolve `reversalPeriod` the same way, for the day after `periodEnd` (`parseDate(periodEnd).add({ days: 1 })`).
   7. Call the building block. Map `RunOutOfDateError` to `conflict`, and everything else through `service.refusal`.
4. In `reverseCurrencyRevaluationRun`:
   1. Read the posting dates of both journals.
   2. Call `resolveReversalPeriods`.
   3. Call the building block. Map `RunReversalError` to `rule`.
5. In `createRunForPeriod`:
   1. Extend the enum to `z.enum([...runTypes, "Depreciation", "Currency Revaluation"])`.
   2. Add a branch for `"Currency Revaluation"`. It calls the same logic as `createCurrencyRevaluationRun` with the period's `endDate`.
6. Run `pnpm run generate:mcp`.

**Verify:**
```bash
pnpm run generate:mcp && git diff --stat apps/erp/app/routes/api+/mcp+/lib/tool-manifest.digest.json
# Expected: the digest file shows a change
```

**Out of scope:** the balance-entry operation (Task 18). CTA operations (Task 21).

---

## Task 12: Add the `fx-revaluation` close check

**Depends on:** Task 8
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — `PeriodRunPreview` (:3695), `getPeriodRunPreview` (:3726), `periodRunChecks` (:3815), `computePeriodReadiness` (:3919)
- Modify: `apps/erp/app/modules/accounting/accounting.periods.test.ts` — fixtures and new cases
- Copy from (precedent): the `draft-depreciation` check (:3815-3917) and its tests (`accounting.periods.test.ts:220`, `:343`)

**Steps:**
1. Add `currencyRevaluation: RunPreview` to `PeriodRunPreview`.
2. In `getPeriodRunPreview`, compute it:
   1. Read the Posted run for `periodEnd`, if one exists.
   2. Read the exposures with `readRevaluationExposures`.
   3. If there are no exposures, return `{ count: 0, amount: 0, error: null }`.
   4. If a Posted run exists, revalue the fresh exposures at the run's stored rates. If every line equals a stored line within `EPSILON`, return count 0.
   5. Otherwise return `count` = the number of exposures and `amount` = the rounded Σ |difference|.
   6. Catch every failure into `error`, as the other previews do.
3. In `periodRunChecks`, add one check:

```ts
{ autoCheckKey: "fx-revaluation", severity: "Warning",
  label: "Revalue foreign currency balances",
  failing: runPreview.currencyRevaluation.count > 0 || runPreview.currencyRevaluation.error !== null,
  count: runPreview.currencyRevaluation.count,
  amount: runPreview.currencyRevaluation.amount,
  due: runPreview.currencyRevaluation,
  draftRuns: <Draft currency revaluation runs in the period, read in computePeriodReadiness> }
```

4. In `computePeriodReadiness`, read the Draft `currencyRevaluationRun` rows in the period, the same way it reads `depreciationRun` (:3972-3981).
5. Add `currencyRevaluation` to the `nothingDue` fixture (`accounting.periods.test.ts:221`).
6. Add three tests:
   - The check passes with no exposures.
   - The check fails with two exposures and no run, with count 2.
   - The check fails when a Draft run exists.

**Verify:**
```bash
pnpm --dir apps/erp exec vitest run app/modules/accounting/accounting.periods.test.ts
# Expected: all tests pass
```

**Out of scope:** the close page UI (Task 15).

---

## Task 13: Add the paths and routes

**Depends on:** Task 11
**Files:**
- Modify: `apps/erp/app/utils/path.ts` — add `currencyRevaluationRuns`, `newCurrencyRevaluationRun`, `currencyRevaluationRun(id)`, `recalculateCurrencyRevaluationRun(id)`, `reverseCurrencyRevaluationRun(id)`, `deleteCurrencyRevaluationRun(id)`, `currencyRevaluationRunRate(id)`
- Create: `apps/erp/app/routes/x+/accounting+/currency-revaluation-runs.tsx`
- Create: `apps/erp/app/routes/x+/accounting+/currency-revaluation-runs.new.tsx`
- Create: `apps/erp/app/routes/x+/currency-revaluation-run+/_layout.tsx`
- Create: `apps/erp/app/routes/x+/currency-revaluation-run+/$runId.tsx`
- Create: `apps/erp/app/routes/x+/currency-revaluation-run+/$runId.post.tsx`
- Create: `apps/erp/app/routes/x+/currency-revaluation-run+/$runId.recalculate.tsx`
- Create: `apps/erp/app/routes/x+/currency-revaluation-run+/$runId.reverse.tsx`
- Create: `apps/erp/app/routes/x+/currency-revaluation-run+/$runId.delete.tsx`
- Create: `apps/erp/app/routes/x+/currency-revaluation-run+/$runId.rate.tsx`
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — `getJournalEntryRelatedItems` (6633-6660)
- Modify: `apps/erp/app/modules/accounting/ui/JournalEntries/JournalEntryDocuments.tsx` — `kinds` map (124-135)
- Copy from (precedent): the depreciation route of the same role (`depreciation-runs.tsx`, `depreciation-runs.new.tsx`, `depreciation-run+/_layout.tsx`, `$depreciationRunId*.tsx`)

**Steps:**
1. Add the path entries in alphabetical order. Copy the depreciation entries (`path.ts:827, 1077, 1079, 1753, 2208, 2297`).
2. Copy each depreciation route. Rename the ids and the calls.
3. Leave out `repeat`. Each period needs its own rates.
4. Use `carbon(request)` in every action, including `delete`. Do not copy the legacy `requirePermissions` action shape of `$depreciationRunId.delete.tsx`.
5. In `$runId.tsx`, load the run, lines and rates in parallel.
6. Also load `notRevalued` from `readRevaluationExposures`.
7. Stream the `relatedItems` with `getPeriodRunRelatedItems`, passing `journalId` and `reversalJournalId`.
8. Make `$runId.rate.tsx` an action only:
   1. Validate `{ currencyCode, rate }` with `zfd`.
   2. Call `api.accounting.updateCurrencyRevaluationRate`.
   3. Return the result for the grid's `useCellSave`.
9. In `currency-revaluation-runs.tsx`, the New Run date picker defaults to the month end after the last run.
10. In `getJournalEntryRelatedItems`, link a `Currency Revaluation` journal to its run. Match the run whose `journalId` or `reversalJournalId` is the journal id. Copy the `Lease Run` branch.
11. Add a `currencyRevaluationRun` kind to `JournalEntryDocuments.tsx`. It links to `path.to.currencyRevaluationRun(id)`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors once Task 14's components exist; run after Task 14 if the UI imports are missing
```

**Out of scope:** the balance route (Task 18).

---

## Task 14: Build the run UI

**Depends on:** Task 13
**Files:**
- Create: `apps/erp/app/modules/accounting/ui/CurrencyRevaluation/CurrencyRevaluationRunStatus.tsx` (copy `ui/FixedAssets/DepreciationRunStatus.tsx`)
- Create: `.../CurrencyRevaluationRunHeader.tsx` (copy `DepreciationRunHeader.tsx`, without Repeat)
- Create: `.../CurrencyRevaluationRunTable.tsx` (copy `DepreciationRunTable.tsx`)
- Create: `.../CurrencyRevaluationRunDocuments.tsx` (copy `DepreciationRunDocuments.tsx`; reuse `ui/PeriodRunDocuments.tsx`)
- Create: `.../CurrencyRevaluationRatesGrid.tsx` (copy `apps/erp/app/modules/purchasing/ui/Leases/LeaseAssetsGrid.tsx` with `useCellSave` from `components/Setup/setupGrid.tsx`)
- Create: `.../CurrencyRevaluationLinesTable.tsx` (copy the lines `Card` grid in `routes/x+/depreciation-run+/$depreciationRunId.tsx`)
- Create: `.../index.ts` (copy `ui/FixedAssets/index.ts`)
- Modify: `apps/erp/app/modules/accounting/ui/useAccountingSubmodules.tsx` — the Closing group (80-107)
- Modify: `apps/erp/app/modules/accounting/ui/AccountingBetaGate.tsx` — `gatedRoutes` (24-30)
- Modify: `apps/erp/app/modules/accounting/types.ts` — `CurrencyRevaluationRunListItem`

**Steps:**
1. Copy each depreciation component and rename it. Keep the same props and layout.
2. In the rates grid, show one row per currency:
   - columns: Currency, Rate (`EditableNumber` while Draft and `can("update")`), Source (`Enumerable`);
   - format the rate with `INPUT_FORMAT` / `INPUT_STEP.exchangeRate` (`.claude/rules/numeric-precision.md`).
3. In the lines table, show these columns:
   - Exposure, Document (a link when `documentId` is set), Currency
   - Open Amount, Booked, Revalued, Difference
4. Total the gains and the losses below the lines table.
5. Format money with `useCurrencyFormatter`. Format the open amount in its own currency.
6. Show a "Not revalued" callout listing the `notRevalued` memos, when there are any.
7. Add "Currency Revaluation" to the Closing group after Depreciation, with `LuArrowLeftRight` and `role: "employee"`.
8. Add `path.to.currencyRevaluationRuns` to `gatedRoutes`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
pnpm exec biome check --write apps/erp/app/modules/accounting/ui/CurrencyRevaluation apps/erp/app/routes/x+/currency-revaluation-run+ apps/erp/app/routes/x+/accounting+/currency-revaluation-runs.tsx apps/erp/app/routes/x+/accounting+/currency-revaluation-runs.new.tsx
# Expected: no errors
```

**Out of scope:** the editable balance cell (Task 18).

---

## Task 15: Add the Create Run button to the period close page

**Depends on:** Tasks 12, 13
**Files:**
- Modify: `apps/erp/app/routes/x+/accounting+/periods.$periodId.close.tsx`
- Copy from (precedent): the depreciation branches at :110-129, :156-169, :308-309, :345-360, :437-457, :613-659

**Steps:**
1. Add `"create-currency-revaluation-run"` to the intent enum and to `RUN_OF_INTENT` (value `"Currency Revaluation"`).
2. On success, redirect to `path.to.currencyRevaluationRun(runId)` with "Currency revaluation run created".
3. Add a tooltip description for `fx-revaluation`.
4. Map `fx-revaluation` to the new intent in `createRunIntent`.
5. Add a `"currencyRevaluation"` branch to `PeriodRunDue` and a "Go to currency revaluation runs" link.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** the CTA row (Task 22).

---

## Task 16: Add `account.currencyCode` and recreate the `accounts` view

**Depends on:** Task 3
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_account-currency.sql`
- Modify: `packages/database/src/types.ts` (generated)
- Copy from (precedent): the `accounts` view in `20260405000000_protect-root-accounts.sql:13-14`

**Steps:**
1. Run `pnpm db:migrate:new account-currency`.
2. Write:

```sql
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "currencyCode" TEXT;
DO $acctccy$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_currencyCode_fkey') THEN
    ALTER TABLE "account" ADD CONSTRAINT "account_currencyCode_fkey"
      FOREIGN KEY ("currencyCode") REFERENCES "currencyCode"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $acctccy$;
CREATE INDEX IF NOT EXISTS "account_currencyCode_idx" ON "account" ("currencyCode");

DROP VIEW IF EXISTS "accounts";
CREATE VIEW "accounts" WITH (SECURITY_INVOKER = true) AS
  SELECT "account".* FROM "account";
```

3. Before you write the view, read the newest definition of `accounts` (`grep -l 'VIEW "accounts"' packages/database/supabase/migrations/* | tail -1`). If its body is not `SELECT "account".* FROM "account"`, copy that newer body instead.
4. Run `pnpm db:migrate`.
5. Run `pnpm run generate:types`.

**Verify:**
```bash
grep -n "currencyCode" packages/database/src/types.ts | grep -c "account"
# Expected: 1 or more
```

**Out of scope:** any posting restriction by currency.

---

## Task 17: Add Account Currency and fix `consolidatedRate` in the account form

**Depends on:** Task 16
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.models.ts` — `accountValidator` (329-389)
- Modify: `apps/erp/app/modules/accounting/ui/ChartOfAccounts/ChartOfAccountForm.tsx`
- Modify: `apps/erp/app/routes/x+/accounting+/charts.new.tsx`, `charts.$accountId.tsx` — default values
- Create: `apps/erp/app/modules/accounting/accounting.utils.test.ts` cases (the file exists; add cases)
- Copy from (precedent): the `class` read-only label block in `ChartOfAccountForm.tsx:142-171`, and a currency `Select` in `apps/erp/app/modules/accounting/ui/ExchangeRates/ExchangeRateForm.tsx`

**Steps:**
1. Add `currencyCode: zfd.text(z.string().optional())` to `accountValidator`.
2. Add a refine: `currencyCode` is allowed only when `class` is Asset or Liability.
3. Add a pure helper `defaultConsolidatedRate(accountClass)` to `accounting.utils.ts`. Asset and Liability return Current. Equity returns Historical. Revenue and Expense return Average.
4. In `ChartOfAccountForm.tsx`, replace `<Hidden name="consolidatedRate" value="Average" />` with a visible `Select` of `consolidatedRateTypes`.
5. On create, default the select with `defaultConsolidatedRate(accountClass)` when the parent group changes. On edit, keep `initialValues.consolidatedRate`.
6. Add an "Account Currency" select. Show it only when `accountClass` is Asset or Liability. Leave it empty by default.
7. In both chart routes, stop setting `consolidatedRate: "Average"` for a leaf account. Pass the stored value on edit. A group (`intent === "group"`) keeps its current behavior.
8. Add `it.each` tests for `defaultConsolidatedRate`.

**Verify:**
```bash
pnpm --dir apps/erp exec vitest run app/modules/accounting/accounting.utils.test.ts
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** changing the rate of existing accounts. The Phase 3 migration only lists them (Task 19).

---

## Task 18: Add Account Balance lines to the run

**Depends on:** Tasks 14, 16
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — `readRevaluationExposures`, new `updateCurrencyRevaluationBalance`
- Modify: `apps/erp/app/modules/accounting/accounting.server.ts` — new operation
- Create: `apps/erp/app/routes/x+/currency-revaluation-run+/$runId.balance.tsx`
- Modify: `apps/erp/app/utils/path.ts` — `currencyRevaluationRunBalance(id)`
- Modify: `apps/erp/app/modules/accounting/ui/CurrencyRevaluation/CurrencyRevaluationLinesTable.tsx` — editable cell
- Copy from (precedent): `getAccountLedgerSummary` (`accounting.service.ts:731`) for the GL balance; `LeaseAssetsGrid.tsx` for the editable cell

**Steps:**
1. In `readRevaluationExposures`, read every non-group account with `currencyCode` not null and not the base currency.
2. Read their balances at `periodEnd` in one call to `accountTreeBalancesByCompany(companyGroupId, companyId, NULL, periodEnd)`.
3. Each account becomes an `Account Balance` exposure:
   - `accountId` = the account, `accountClass` from the account;
   - `bookedBaseAmount = balanceAtDate`, `openAmount = null`.
4. In `recalculateCurrencyRevaluationRun`, keep the stored `openAmount`, `openAmountEnteredBy` and `openAmountEnteredAt` of each `Account Balance` line, matched by `accountId`.
5. Write `updateCurrencyRevaluationBalance(db, { runId, lineId, openAmount, companyId, userId })`:
   1. Refuse unless the run is Draft and the line is an `Account Balance` line.
   2. Set `openAmount`, `openAmountEnteredBy` and `openAmountEnteredAt`.
   3. Revalue the line at the run's rate for its currency.
6. Add the operation `updateCurrencyRevaluationBalance` (`{ update: "accounting" }`, `@mcp`).
7. Add the route `$runId.balance.tsx`, an action only. Copy `$runId.rate.tsx`.
8. Make the Open Amount cell an `EditableNumber` for `Account Balance` lines on a Draft run.
9. Show "Entered by {name} on {date}" under the cell.
10. Run `pnpm run generate:mcp`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```
The refusal to post with a missing balance is in Task 10, step 1.5.

**Out of scope:** prefilling from `journalLine.sourceAmount` (bank reconciliation spec).

---

## Task 19: Create the offset account default

**Depends on:** Task 1
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_currency-translation-posting.sql`
- Modify: `packages/database/src/seed-data.ts`, `accounting-cutover/shared.ts`, `journal-posting-status.ts`, `account-import.ts`
- Modify: `AccountDefaultsForm.tsx`, `accounting.models.ts`, `accounting.server.ts` (`updateDefaultAccounts`)
- Copy from (precedent): Task 2 sections 1–4 and Task 4. The form field copies `currencyTranslationAccount` (`AccountDefaultsForm.tsx:347-353`).

**Steps:**
1. Run `pnpm db:migrate:new currency-translation-posting`.
2. Add `"currencyTranslationOffsetAccount" TEXT` to `accountDefault`, with its FK. Copy Task 2 steps 2–3.
3. Seed `('3210', 'Currency Translation Offset', 'Equity', 'Equity - Close', 'Balance Sheet', 'Historical', 'Equity', ARRAY['3200'])`. Set `"isSystem" = false`.
4. Backfill by number and name, then by name. Copy Task 2 step 5.
5. Add the close task with `name: 'Post currency translation adjustment'`, `autoCheckKey: 'cta-posted'`, `sortOrder: 6` and severity `'Warning'`.
6. Add a `RAISE NOTICE` per company group. It lists the leaf Asset and Liability accounts whose `consolidatedRate` is `'Average'`. It changes nothing.
7. Run `pnpm db:migrate`.
8. Run `pnpm run generate:types`.
9. Add 3210 to `seed-data.ts` after 3200, and add `currencyTranslationOffsetAccount: "3210"` to `accountDefaults`. Add the `cta-posted` close task with `sortOrder: 6`.
10. Add the column to `ACCOUNT_DEFAULT_COLUMNS`, `OPTIONAL_DEFAULT_ROLES`, `OPTIONAL_DEFAULT_LABELS` and `ROLE_NAMES`, with the label "Currency Translation Offset".
11. Add the form field beside Currency Translation in the `equity` group, `badgeType: "Equity"`. Add it to the validator (optional) and to `updateDefaultAccounts`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database --filter=erp
# Expected: 0 errors
pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -c 'SELECT count(*) FROM "account" WHERE "number" = '"'"'3210'"'"' AND "isSystem"'
# Expected: 0 (the offset account is not a system account)
```

**Out of scope:** changing existing accounts' `consolidatedRate`.

---

## Task 20: Change `applyReportCta` for a posted CTA

**Depends on:** Task 19
**Files:**
- Modify: `apps/erp/app/modules/accounting/types.ts` — add `UNPOSTED_CTA_ACCOUNT_ID = "unposted-cta"` beside `NET_INCOME_ACCOUNT_ID` (:52)
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — `applyCtaToReportPeriodSeries` (:1074), `applyReportCta` (:1109)
- Modify: `apps/erp/app/modules/accounting/ui/Reports/MultiPeriodStatementTree.tsx` — the drill-down exclusion (:224-225)
- Modify: `apps/erp/app/modules/accounting/accounting.report-cta.test.ts`
- Copy from (precedent): the synthetic Net Income row (`accounting.service.ts:1711-1755`), the tests in `accounting.report-cta.test.ts:119-124`

**Steps:**
1. In `applyCtaToReportPeriodSeries`, read `currencyTranslationOffsetAccount` with `currencyTranslationAccount`. Pass it to `applyReportCta` as `offsetAccountId` (`string | null`).
2. In `applyReportCta`, find the offset row by id. If the row is absent, or its `translatedBalance` is 0 in every bucket, keep today's behavior exactly.
3. Otherwise, for each bucket:
   1. Set `postedCta = -offset.translatedBalance`.
   2. Set `residual = round(ctaByBucket[key] - postedCta)`.
   3. Leave the CTA row's own value as it is.
4. If any bucket's `residual` is not 0, push a synthetic leaf row:
   - `id: UNPOSTED_CTA_ACCOUNT_ID`, `name: "Unposted translation adjustment"`;
   - `parentId` = the CTA row's `parentId`, `class: "Equity"`, `incomeBalance: "Balance Sheet"`, `isGroup: false`, `isSystem: false`;
   - each bucket's `translatedBalance` = its residual.
5. Remove the offset row from the list before `rollUpTranslatedGroups`.
6. Exclude `UNPOSTED_CTA_ACCOUNT_ID` from drill-down in `MultiPeriodStatementTree.tsx`, beside `NET_INCOME_ACCOUNT_ID`.
7. Keep every existing test green. Add these tests:
   - An offset row of −40 with a CTA of 40: no synthetic row, no offset row, and a root of 0.
   - With an offset of −30 and a CTA of 40: a synthetic row of 10, and the root becomes 0.
   - With no offset row: the result equals today's for the same input.
   - Repeat the call: the input does not change.

**Verify:**
```bash
pnpm --dir apps/erp exec vitest run app/modules/accounting/accounting.report-cta.test.ts app/modules/accounting/accounting.translation.test.ts
# Expected: all tests pass
```

**Out of scope:** the trial balance (it ignores the CTA today). Single-company translated views (no offset row).

---

## Task 21: Write the CTA preview and post

**Depends on:** Task 20
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — new `previewCurrencyTranslation`, `insertCurrencyTranslationJournal`
- Modify: `apps/erp/app/modules/accounting/accounting.utils.ts` — new pure `ctaMovement`
- Modify: `apps/erp/app/modules/accounting/accounting.utils.test.ts`
- Modify: `apps/erp/app/modules/accounting/accounting.server.ts` — `previewCurrencyTranslation`, `postCurrencyTranslation`
- Copy from (precedent): `getConsolidatedPeriodSeriesForReport` (`accounting.service.ts:9934`), the root check in `applyCtaToReportPeriodSeriesForReport` (:9891-9925), `insertPostedRunJournal` (:10019), `resolveAccountingPeriod` (`apps/erp/app/modules/shared/shared.service.ts:15188`)

**Steps:**
1. Write the pure `ctaMovement({ liveCta, offsetBalance, decimalPlaces })`. It returns `{ postedCta: -offsetBalance, movement: round(liveCta + offsetBalance) }`. Treat a movement smaller than one minor unit (`10 ** -decimalPlaces`) as 0. Test it with `it.each`.
2. Write `previewCurrencyTranslation(client, systemClient, args)`:

```ts
args: { companyGroupId: string; rootCompanyId: string; periodStart: string; periodEnd: string }
// returns { liveCta, postedCta, movement, eliminationCompanyId, contributions: { companyId, name, cta }[], unrevaluedCompanyIds: string[] }
```

   1. Read the group's operating companies with `getCompaniesInGroup`.
   2. Call `getConsolidatedPeriodSeries` with every operating company, the root's base currency, one bucket `{ key: "cta", start: periodStart, end: periodEnd }` and `systemClient` as `eliminationClient`.
   3. Read `liveCta` from `ctaByBucket.cta`.
   4. Find the elimination entity with `parentCompanyId = rootCompanyId` and `isEliminationEntity = true`. If none exists, return an error "The group has no elimination entity".
   5. Read the offset account's balance on that entity at `periodEnd` with `accountTreeBalancesByCompany`.
   6. Call `ctaMovement`.
   7. List the subsidiaries whose `fx-revaluation` preview count is above 0.
3. Write `insertCurrencyTranslationJournal(db, args)`:
   1. In one transaction, resolve the period with `resolveAccountingPeriod(trx, eliminationCompanyId, periodEnd, "historical")`. This refuses a Locked or Closed period.
   2. Insert one journal with `sourceType: "Currency Translation"`, `status: "Posted"` and no `eliminationKind`.
   3. Add two lines, signed with `credit()` / `debit()` for class Equity. For a positive movement, credit the CTA account and debit the offset account. For a negative movement, do the opposite.
   4. Number the journal with `getNextSequenceInTransaction(trx, "journalEntry", eliminationCompanyId)`.
4. Add the operation `previewCurrencyTranslation` (`{ view: "accounting" }`, `@mcp read`):
   1. Refuse unless `ctx.company.id` is the group root.
   2. Refuse unless the root has an accounting cutover (`requireAccountingCutover`).
5. Add the operation `postCurrencyTranslation` (`{ update: "accounting" }`, `@mcp`):
   1. Run the same checks as the preview.
   2. Recompute the preview.
   3. If `movement` is 0, return `{ posted: false }`.
   4. Otherwise call `insertCurrencyTranslationJournal` with `ctx.asSystem.pg`.
6. Run `pnpm run generate:mcp`.

**Verify:**
```bash
pnpm --dir apps/erp exec vitest run app/modules/accounting/accounting.utils.test.ts
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

If `getConsolidatedPeriodSeries` cannot take one custom bucket, STOP and report.

**Out of scope:** the `generateEliminations` caller-client issue (fact E in the CTA research). It is a separate bug.

---

## Task 22: Add the `cta-posted` check and the CTA modal

**Depends on:** Task 21
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — `periodRunChecks`, `computePeriodReadiness`
- Modify: `apps/erp/app/modules/accounting/accounting.periods.test.ts`
- Create: `apps/erp/app/routes/x+/accounting+/periods.$periodId.cta.tsx`
- Modify: `apps/erp/app/routes/x+/accounting+/periods.$periodId.close.tsx`
- Modify: `apps/erp/app/utils/path.ts` — `accountingPeriodCta(id)`
- Copy from (precedent): the `draft-depreciation` check (Task 12), the `Confirm` modal in `apps/erp/app/routes/x+/accounting+/depreciation-runs.tsx`, the modal route pattern of `periods.$periodId.delete.tsx`

**Steps:**
1. Add the `cta-posted` check to `periodRunChecks`:
   1. Make it pass when the company is not the group root.
   2. Make it pass when no active operating company has a different base currency.
   3. Otherwise make it fail while `movement` is not 0.
2. In `computePeriodReadiness`, compute the movement only for the root company.
3. Add three tests:
   - a non-root company passes;
   - a one-currency group passes;
   - a root with movement 2,600 fails.
4. Make `periods.$periodId.cta.tsx` a modal route:
   1. The loader calls `api.accounting.previewCurrencyTranslation`.
   2. The page shows a table of the per-company contributions.
   3. The page shows the live, posted and movement totals.
   4. The page warns with the list of subsidiaries that are not revalued.
   5. The action calls `api.accounting.postCurrencyTranslation` and redirects to the close page with "Currency translation adjustment posted".
5. On the close page, show a "Preview CTA" button on the `cta-posted` row. It links to `path.to.accountingPeriodCta(periodId)`.

**Verify:**
```bash
pnpm --dir apps/erp exec vitest run app/modules/accounting/accounting.periods.test.ts
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** a CTA roll-forward report.

---

## Task 23: Update docs, AGENTS.md and rules

**Depends on:** Tasks 1–22
**Files:**
- Modify: `apps/erp/app/modules/accounting/AGENTS.md`:
  - :15 Chart of Accounts: `currencyCode`
  - :33-style paragraph: a new "Currency revaluation" entry
  - :38 Currency translation / CTA: the posted CTA, offset account and residual row
  - :322-347 Key Data Model
  - :349, :382: the service functions
- Modify: `packages/database/AGENTS.md` — the `./currency-revaluation` export
- Modify: `.claude/rules/accounting-sync-handlers.md` (:704-738) — the default-off paragraph gets `'Currency Revaluation'` and `'Currency Translation'`
- Modify: `docs/content/docs/reference/accounting.mdx` — the source-type table (:27-38) and the account defaults table (:41-52)
- Modify: `.ai/specs/2026-10-26-fx-revaluation-and-cta-posting.md` — status `in-progress`, changelog entry

**Steps:**
1. Write each new paragraph from the code you merged, not from the spec.
2. Name every file, function and table exactly.
3. Use the `carbon-docs` skill for the `.mdx` page.
4. Do the STE-80 review pass on the spec after you edit it.

**Verify:**
```bash
grep -n "currencyRevaluationRun" apps/erp/app/modules/accounting/AGENTS.md
# Expected: 1 or more matches
pnpm --filter docs typecheck
# Expected: 0 errors
```

**Out of scope:** changelog entries.

---

## Task 24: Run the full verification sweep

**Depends on:** Task 23
**Files:** none

**Steps:**
1. Run `pnpm db:migrate`.
2. Run `pnpm --filter @carbon/checks license-headers -- <every new file>`.
3. Run each command below and read its output.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database --filter=@carbon/utils --filter=@carbon/ee --filter=erp
# Expected: 0 errors in all four packages
pnpm run lint
# Expected: no errors
pnpm --filter @carbon/database test
# Expected: passes
pnpm --dir apps/erp exec vitest run app/modules/accounting
# Expected: passes
pnpm --filter @carbon/database authz check
# Expected: exit 0
pnpm --filter @carbon/checks clobbers
# Expected: no clobbered functions
pnpm db:check:datasets
# Expected: all five datasets pass
pnpm db:check:backups
# Expected: backups would restore; manifest regenerated
pnpm run generate:mcp && pnpm check:manifest
# Expected: digest current
```

If a dataset fails on a new NOT NULL column or a missing account, STOP and report.

**Out of scope:** a whole-repo typecheck (it runs out of memory).

---

## Task 25: Extract and translate the new strings

**Depends on:** Task 24
**Files:**
- Modify: `packages/locale/locales/*/*.po`

**Steps:**
1. Run `pnpm lingui:extract`.
2. Run the `/translate` skill.
3. Run `pnpm lingui:check`.

**Verify:**
```bash
pnpm lingui:check
# Expected: no missing translations
```

**Out of scope:** changing the locale list.

---

## Task 26: Verify in the browser

**Depends on:** Task 25
**Files:** none (playbook cached under `.ai/playbooks/` by `/test`)

**Steps:**
1. Ask the user for permission to run the browser check. Do not use `localhost:3000`.
2. Run `/auth`, then `/test` with the spec's acceptance criteria.
3. Set up a USD company with an EUR customer invoice of €1,000 at 0.90. Set an EUR override of 0.85.
4. Check each Phase 1 criterion:
   1. Open Accounting → Currency Revaluation → New Run for the period end. Confirm one Receivable line with a difference of $65.36.
   2. Post the run. Open each journal from the Documents panel, and confirm the period-end journal and the day-1 reversal.
   3. Open Invoicing → Receivables for the period end. Confirm the AR tie-out shows no difference.
   4. Run Undo. Confirm the run is Draft and both journals are reversed.
   5. Open the period close page. Confirm the `fx-revaluation` row and its Create Run button.
5. Check Phase 2:
   1. Set Account Currency EUR on a Bank account. Recalculate the run.
   2. Try to post with no statement balance, and confirm the refusal.
   3. Enter €50,000 and post.
6. Check Phase 3:
   1. On the root company, open the close page, then Preview CTA. Post it.
   2. Open the consolidated balance sheet. Confirm one CTA row, no offset row and no residual row.
7. Save a screenshot of each step under `.context/`.

**Verify:**
```bash
ls .context/*.png | wc -l
# Expected: 1 or more screenshots, one per checked criterion
```

**Out of scope:** load testing.
