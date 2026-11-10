# Lessee leases and the lease run — implementation plan

**Spec:** .ai/specs/2026-10-11-lessee-leases.md
**Research:** .ai/research/2026-10-11-lessee-lease-accounting.md
**Run log:** .ai/runs/2026-10-11-lessee-leases.md
**Branch:** tirana

## Plan decisions not in the spec

| # | Decision | Reason |
|---|----------|--------|
| P1 | The run pages stay at `x+/revenue-recognition-run+/$runId*` for both run types. Only the list and "new" routes are new (`x+/accounting+/lease-runs*.tsx`). The run page reads `run.type` for its title, breadcrumb and confirm texts. | One set of post / reverse / recalculate / repeat / delete actions; the user sees two lists. |
| P2 | A `leases` view feeds the list (supplier name, current liability, next due date). | Same as the `rentalAgreements` view. |
| P3 | A lease month runs from the commencement day: month `m` covers `addMonths(commencement, m)` to the day before `addMonths(commencement, m + 1)`. `periodDate` is its last day. | A mid-month commencement needs no proration; the run posts each row in the calendar month of its `periodDate`. |
| P4 | A payment's discount exponent `k` (months from commencement): Advance = months from commencement to `periodStart`; Arrears = months from commencement to the day after `periodEnd`; the purchase option and a termination penalty = the term length. | One rule for edited rows and generated rows. |
| P5 | A last payment period shorter than the frequency is prorated by days (`round(amount × days ÷ daysInFullPeriod, decimals)`). | Terms that do not divide evenly still close on `endDate`. |
| P6 | "Posted" for a lease month means its `revenueRecognitionSchedule` rows have `status = 'Posted'`. | The enable's step 5 sets pre-cutover rows Posted without stamping `leaseScheduleLine`. |
| P7 | The ROU cost lives on `lease.rouAssetCost`; accumulated amortization is the sum of `rouAmortization` of Posted months. | Termination and Purchase need both numbers; no GL read. |
| P8 | Payment rows can be edited only while the lease is Draft. After activation, rows change only through Modify, Terminate and Purchase. | The PV and the schedule read the rows. |

## Progress

- [x] Task 1: Add the enum migration
- [x] Task 2: Add the lessee lease migration
- [x] Task 3: Add RLS, audit, backup refs; apply and regenerate types
- [x] Task 4: Fix the type fallout and register the new accounts and source type
- [x] Task 5: Add the pure lease math (`lease-math.ts`)
- [x] Task 6: Give the run server functions a run type
- [x] Task 7: Give the run journal builder a run type and a lessee source
- [x] Task 8: Make post, reverse and delete type-aware
- [x] Task 9: Thread the run type through the legacy backfill
- [x] Task 10: Add the Lease Runs list and make the run page type-aware
- [x] Task 11: Add the lease run to the close wizard, the monthly job and the journal guards
- [x] Task 12: Add the lease validators
- [x] Task 13: Add the lease service functions
- [x] Task 14: Add the `post-lease` server function: activate and cancel
- [x] Task 15: Add Modify, Terminate and Purchase to `post-lease`
- [x] Task 16: Add the lease list, new, shell, details and update routes
- [x] Task 17: Add the payment row routes
- [x] Task 18: Add the lifecycle routes
- [x] Task 19: Build the lease UI components
- [x] Task 20: Add the nav entry and paths
- [x] Task 21: Add the Lease line type to the purchase invoice form
- [x] Task 22: Post and void Lease lines
- [x] Task 23: Release payment rows when a purchase invoice or line is deleted
- [x] Task 24: Add the `create-lease-invoices` server function
- [x] Task 25: Run lease invoicing, expiry and reminders from the daily job
- [x] Task 26: Add the lease policy settings
- [x] Task 27: Add the cutover open items
- [x] Task 28: Add the Lease Liabilities report
- [x] Task 29: Link journals to leases
- [x] Task 30: Opening journal for a lease entered after the enable
- [x] Task 31: Update AGENTS.md, rules and docs
- [x] Task 32: Run the full verification sweep
- [x] Task 33: Extract and translate the new strings
- [x] Task 34: Verify in the browser

## Dependencies

- Task 2 needs Task 1. Task 3 needs Task 2. Task 4 needs Task 3.
- Task 5 needs nothing. It can run in parallel with Tasks 1–4.
- Tasks 6–9 need Task 4. Task 7 is independent of Task 6. Task 8 needs Tasks 6 and 7. Task 9 needs Task 7.
- Task 10 needs Task 8. Task 11 needs Tasks 6 and 8.
- Task 12 needs Task 4. Task 13 needs Task 12.
- Task 14 needs Tasks 5, 7 and 13. Task 15 needs Task 14.
- Tasks 16–18 need Tasks 13–15. Task 19 needs Task 16. Task 20 is independent of Tasks 16–19 but lands with them.
- Task 21 needs Task 4. Task 22 needs Task 21. Task 23 needs Task 21.
- Task 24 needs Tasks 13 and 22. Task 25 needs Task 24.
- Tasks 26, 27, 28 and 29 need Task 14. They are independent of each other.
- Task 30 needs Task 14.
- Task 31 needs Tasks 1–29. Task 32 needs Task 31. Task 33 needs Task 32. Task 34 needs Task 33.

## Merge notes (projects branch `projects-wbs-research-spec`, worktree kelowna)

- Both branches add `20261011…` migrations. The branch that merges second re-stamps its migrations after the other's, then runs `pnpm --filter @carbon/checks clobbers`.
- Expect textual conflicts in `post-purchase-invoice/index.ts`, `scheduled/recurring-billing.ts`, `packages/notifications/src/index.ts`, `POSTING_POLICY`, `seed-data.ts`, `seed-company` and `AccountDefaultsForm.tsx`. Keep both sides.
- The run page's Project Revenue card (projects branch) shows only when `run.type === "Revenue Recognition"`.
- Task 6 step 3 states the merged `runRowSynthesizers(type, extra)` signature.

## Conventions for every task

- Read `.ai/lessons.md` sections "A migration file created while migrations are running is recorded as applied — empty", "A new FK on a busy table breaks bare PostgREST embeds of it (TS2589)" and "A sales invoice's documents…" (the opportunity lesson) before Task 1.
- Never create or edit a migration file while `pnpm db:migrate` or `crbn up` runs.
- In a server function, every Kysely read and write filters on `companyId`.
- Refusals the user must read throw `InvalidInputError` from `../errors`. A missing record throws `NotFoundError`.
- Every new source file starts with its SPDX header. Run `pnpm --filter @carbon/checks license-headers` after you create files. Do not type the header by hand.
- Never use JS `Date`. Use `YYYY-MM-DD` strings with the helpers in `@carbon/database/revenue-schedule` (`parseIsoDate`, `formatIsoDate`, `addDays`, `monthEnd`, `daysBetweenInclusive`) and `datetime` / `getCompanyTimeZone` for "today".
- Never round with `Math.round` or `.toFixed`. Use `round` from `@carbon/database/precision` (internal scale) and `currency.decimalPlaces` for billed amounts.
- Never rebuild the database. Never run a whole-repo typecheck.
- A database test skips without a local `SUPABASE_DB_URL`. Before a database test, export the worktree's URL from `.env.local` (`export SUPABASE_DB_URL=$(grep '^SUPABASE_DB_URL' .env.local | cut -d= -f2-)`). A shell value overrides the worktree's.
- Scoped checks: `pnpm exec turbo run typecheck --filter=<pkg>`; tests `pnpm --filter <pkg> test`; ERP tests `cd apps/erp && pnpm exec vitest run <file>`.
- UI copy goes through Lingui (`t\`…\``, `<Trans>`). Read `.claude/rules/i18n-lingui-system.md` before Task 16.

---

## Task 1: Add the enum migration

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_lessee-lease-enums.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20261006220301_fleet-rental-lease-enums.sql`

**Steps:**
1. Run `pnpm db:migrate:new lessee-lease-enums`.
2. Write this SQL into the new file:

```sql
-- Enums for lessee leases and the lease run.
-- Enum additions live alone: ADD VALUE cannot be used in the same transaction as the value.
-- Spec: .ai/specs/2026-10-11-lessee-leases.md

ALTER TYPE "payableLineType" ADD VALUE IF NOT EXISTS 'Lease';
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Lease';
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Lease Run';
ALTER TYPE "revenueScheduleType" ADD VALUE IF NOT EXISTS 'Amortization';

DO $leaseenums$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leaseStatus') THEN
    CREATE TYPE "leaseStatus" AS ENUM ('Draft', 'Active', 'Expired', 'Terminated', 'Purchased', 'Cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lesseeClassification') THEN
    CREATE TYPE "lesseeClassification" AS ENUM ('Operating', 'Finance', 'Short-Term');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leasePaymentFrequency') THEN
    CREATE TYPE "leasePaymentFrequency" AS ENUM ('Monthly', 'Quarterly', 'Annual');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leasePaymentStatus') THEN
    CREATE TYPE "leasePaymentStatus" AS ENUM ('Pending', 'Invoiced', 'Skipped');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leasePaymentType') THEN
    CREATE TYPE "leasePaymentType" AS ENUM ('Rent', 'Purchase Option', 'Termination Penalty');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leaseEventType') THEN
    CREATE TYPE "leaseEventType" AS ENUM ('Modification', 'Termination', 'Purchase');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'runType') THEN
    CREATE TYPE "runType" AS ENUM ('Revenue Recognition', 'Lease');
  END IF;
END $leaseenums$;
```

**Verify:**
```bash
ls packages/database/supabase/migrations | tail -1
# Expected: <timestamp>_lessee-lease-enums.sql, with a timestamp newer than 20261010031417 and HHMMSS not 000000
```

**Out of scope:** tables, data. Do not apply yet.

---

## Task 2: Add the lessee lease migration

**Depends on:** Task 1
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_lessee-leases.sql`
- Copy from (precedent): `20261006220201_revenue-recognition-core.sql` lines 6–152 (account defaults, accounts, backfill, sequence, close task); `20261006220501_rental-agreements.sql` lines 135–194 (table style); `20260811123616_widen-purchasing-scale.sql` (the `purchaseInvoiceLines` view); `20261006221701_period-run-months.sql:47` (the Draft index)

**Steps:**
1. Run `pnpm db:migrate:new lessee-leases`.
2. Write section 1, settings:

```sql
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "leaseIncrementalBorrowingRate" NUMERIC NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS "leaseShortTermExpedient" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "leaseReminderDays" INTEGER NOT NULL DEFAULT 90;
```

3. Write section 2, account defaults. Copy the `$rrfk$` block (ADD COLUMN IF NOT EXISTS + FK loop) for these 7 columns: `rightOfUseAssetAccount`, `accumulatedRightOfUseAmortizationAccount`, `leaseLiabilityAccount`, `operatingLeaseExpenseAccount`, `variableLeaseExpenseAccount`, `rightOfUseAmortizationExpenseAccount`, `leaseInterestExpenseAccount`. Name the DO block `$leasefk$`.
4. Write section 3, accounts. Copy the `$rraccounts$` block as `$leaseaccounts$` with these VALUES rows (number, name, class, accountType, incomeBalance, consolidatedRate, parent group name, sibling numbers):

| number | name | class | accountType | incomeBalance | consolidatedRate | parent | siblings |
|---|---|---|---|---|---|---|---|
| 1450 | Right-of-Use Assets | Asset | Other Asset | Balance Sheet | Current | Other Assets | 1410, 1420 |
| 1460 | Accumulated Amortization – Right-of-Use Assets | Asset | Other Asset | Balance Sheet | Current | Other Assets | 1410, 1420 |
| 2440 | Lease Liabilities | Liability | Long Term Liability | Balance Sheet | Current | Long-Term Liabilities | 2410, 2420 |
| 6140 | Operating Lease Expense | Expense | Expense | Income Statement | Average | Operating Expenses | 6100, 6110 |
| 6130 | Variable Lease Expense | Expense | Expense | Income Statement | Average | Operating Expenses | 6100, 6110 |
| 6330 | Amortization – Right-of-Use Assets | Expense | Other Expense | Income Statement | Average | Depreciation & Amortization | 6310, 6320 |
| 7020 | Interest Expense – Leases | Expense | Other Expense | Income Statement | Average | Other Expenses | 7010 |

   If an `accountType` or `consolidatedRate` value above is not in its enum, STOP and report — read the seeded rows for 1420, 2410, 6110, 6320 and 7010 in `packages/database/src/seed-data.ts` and use their values.
5. Write section 4, backfill. Copy the `$rrdefaults$` block as `$leasedefaults$` with the 7 (column, number, name) rows from steps 3–4.
6. Write section 5, sequences, copying the `rentalAgreement` sequence insert twice: (`'lease'`, `'Lease'`, `'LSE'`) and (`'leaseRun'`, `'Lease Run'`, `'LR'`).
7. Write section 6, the close task. Copy the close-task insert with name `'Post lease journals'`, `autoCheckKey 'unposted-lease-schedules'`, `sortOrder 5`, severity `'Warning'`.
8. Write section 7, the tables. Use the spec's "Data Model Changes" SQL for `lease`, `leasePayment`, `leaseScheduleLine` and `leaseEvent`, with these additions:
   - Every table: `createdBy`/`createdAt`/`updatedBy`/`updatedAt` audit columns, `CONSTRAINT "<t>_pkey" PRIMARY KEY ("id", "companyId")`, the company FK `ON DELETE CASCADE ON UPDATE CASCADE`, and `CREATE INDEX IF NOT EXISTS` on `companyId`, `createdBy` and every FK column.
   - `lease`: add `"invoiceFromDate" DATE NOT NULL` and `"rouAssetCost" NUMERIC`; FKs `(supplierId, companyId) → supplier`, `(locationId) → location`, `assignee → user`; `"customFields" JSONB`.
   - `leasePayment`, `leaseScheduleLine`, `leaseEvent`: FK `("leaseId", "companyId") REFERENCES "lease"("id", "companyId") ON DELETE CASCADE`.
   - `leasePayment`: unique index `("companyId", "leaseId", "dueDate", "paymentType")`; index `("companyId", "status", "dueDate")`.
9. Write section 8, links:

```sql
ALTER TABLE "purchaseInvoiceLine"
  ADD COLUMN IF NOT EXISTS "leaseId" TEXT,
  ADD COLUMN IF NOT EXISTS "leasePaymentId" TEXT;
-- FKs: ("leaseId","companyId") → lease ON DELETE RESTRICT;
--      ("leasePaymentId","companyId") → leasePayment ON DELETE SET NULL ("leasePaymentId")
-- CHECK "purchaseInvoiceLine_lease_check":
--   ("invoiceLineType" = 'Lease') = ("leaseId" IS NOT NULL) AND ("leasePaymentId" IS NULL OR "leaseId" IS NOT NULL)
-- Indexes on leaseId and leasePaymentId.

ALTER TABLE "revenueRecognitionSchedule"
  ADD COLUMN IF NOT EXISTS "leaseId" TEXT,
  ADD COLUMN IF NOT EXISTS "leaseScheduleLineId" TEXT;
-- FKs: ("leaseId","companyId") → lease ON DELETE CASCADE;
--      ("leaseScheduleLineId","companyId") → leaseScheduleLine ON DELETE CASCADE
-- Index ("companyId","leaseId").

ALTER TABLE "revenueRecognitionRun"
  ADD COLUMN IF NOT EXISTS "type" "runType" NOT NULL DEFAULT 'Revenue Recognition';
DROP INDEX IF EXISTS "revenueRecognitionRun_one_draft_per_period";
CREATE UNIQUE INDEX IF NOT EXISTS "revenueRecognitionRun_one_draft_per_period"
  ON "revenueRecognitionRun" ("companyId", "type", "periodEnd")
  WHERE "status" = 'Draft';
```

   Write each FK as a guarded `ALTER TABLE … ADD CONSTRAINT` inside a `DO` block that checks `pg_constraint`, as `20261006220501` lines 380–387 do.
10. Write section 9, release rental rows from Draft revenue runs:

```sql
WITH released AS (
  DELETE FROM "revenueRecognitionRunLine" l
  USING "revenueRecognitionRun" r, "revenueRecognitionSchedule" s
  WHERE l."runId" = r."id" AND l."companyId" = r."companyId"
    AND r."status" = 'Draft' AND r."type" = 'Revenue Recognition'
    AND s."id" = l."scheduleId" AND s."companyId" = l."companyId"
    AND s."rentalAgreementLineId" IS NOT NULL
  RETURNING l."scheduleId", l."companyId"
)
UPDATE "revenueRecognitionSchedule" s SET "runLineId" = NULL
FROM released
WHERE s."id" = released."scheduleId" AND s."companyId" = released."companyId";

DELETE FROM "revenueRecognitionRun" r
WHERE r."status" = 'Draft'
  AND NOT EXISTS (
    SELECT 1 FROM "revenueRecognitionRunLine" l
    WHERE l."runId" = r."id" AND l."companyId" = r."companyId"
  );
```

11. Write section 10, the `purchaseInvoiceLines` view. Copy the latest `CREATE OR REPLACE VIEW "purchaseInvoiceLines"` from `20260811123616_widen-purchasing-scale.sql` verbatim. Add `ls."leaseId" AS "leaseReadableId"` and `ls."name" AS "leaseName"` from `LEFT JOIN "lease" ls ON ls."id" = pl."leaseId" AND ls."companyId" = pl."companyId"`. Keep `WITH(SECURITY_INVOKER=true)`.
12. Write section 11, the `leases` view:

```sql
CREATE OR REPLACE VIEW "leases" WITH(SECURITY_INVOKER=true) AS
SELECT
  l.*,
  s."name" AS "supplierName",
  (SELECT p."dueDate" FROM "leasePayment" p
    WHERE p."leaseId" = l."id" AND p."companyId" = l."companyId" AND p."status" = 'Pending'
    ORDER BY p."dueDate" LIMIT 1) AS "nextDueDate",
  COALESCE(
    (SELECT sl."closingLiability" FROM "leaseScheduleLine" sl
      JOIN "revenueRecognitionSchedule" rs
        ON rs."leaseScheduleLineId" = sl."id" AND rs."companyId" = sl."companyId"
      WHERE sl."leaseId" = l."id" AND sl."companyId" = l."companyId" AND rs."status" = 'Posted'
      ORDER BY sl."periodDate" DESC LIMIT 1),
    l."initialLiability"
  ) AS "currentLiability"
FROM "lease" l
JOIN "supplier" s ON s."id" = l."supplierId" AND s."companyId" = l."companyId";
```

13. End the file with `NOTIFY pgrst, 'reload schema';`.

**Verify:**
```bash
grep -c "CREATE TABLE IF NOT EXISTS" packages/database/supabase/migrations/*_lessee-leases.sql
# Expected: 4
grep -c "CREATE POLICY" packages/database/supabase/migrations/*_lessee-leases.sql
# Expected: 0
```

**Out of scope:** RLS policies (Task 3), demo datasets (spec: out of v1).

---

## Task 3: Add RLS, audit, backup refs; apply and regenerate types

**Depends on:** Task 2
**Files:**
- Modify: `packages/database/src/authz/manifest.ts` — four rules, alphabetical
- Modify: `packages/database/src/audit.config.ts` — a `lease` entity
- Modify: `packages/database/src/event-system/attachments.ts` — `lease: { events: true }`
- Modify: `packages/jobs/src/backups/id-refs.ts` — no-FK id columns
- Create (generated): `packages/database/supabase/migrations/<timestamp>_lessee-leases-rls.sql`

**Steps:**
1. Add to `manifest.ts`, in alphabetical position:
   ```ts
   lease: company("purchasing", { read: "purchasing_view" }),
   leaseEvent: company("purchasing", { read: "purchasing_view" }),
   leasePayment: company("purchasing", { read: "purchasing_view" }),
   leaseScheduleLine: company("purchasing", { read: "purchasing_view" }),
   ```
2. Add to `audit.config.ts`, beside `rentalAgreement` (lines 285–292): `lease: { label: "Lease", tables: { lease: { role: "root" }, leasePayment: { entityIdColumn: "leaseId" } } }`. Add `lease: "Lease"` and `leasePayment: "Payment"` to the table-label map (lines 735–736).
3. Add `lease: { events: true },` to `attachments.ts` in alphabetical position.
4. Add to `ID_REF_COLUMNS` in `id-refs.ts`: `lease: ["fixedAssetId"]`, `leaseEvent: ["fixedAssetId"]`, `leasePayment: ["purchaseInvoiceLineId", "voidedPurchaseInvoiceId"]`.
5. Run `pnpm db:migrate`.
6. Run `pnpm --filter @carbon/database authz migration lessee-leases-rls`.
7. Run `pnpm db:migrate` again to record the generated migration.
8. Run `pnpm run generate:types`.

**Verify:**
```bash
grep -n '"leaseStatus"\|"Lease Run"\|leaseIncrementalBorrowingRate' packages/database/src/types.ts | head
# Expected: matches for all three
pnpm --filter @carbon/database exec vitest run src/authz/migration.test.ts
# Expected: passes
```

If `pnpm db:migrate` reports the enum migration as applied but `types.ts` lacks `"Lease Run"`, run the lesson's query on `supabase_migrations.schema_migrations`, then STOP and report.

**Out of scope:** typecheck fixes (Task 4).

---

## Task 4: Fix the type fallout and register the new accounts and source type

**Depends on:** Task 3
**Files:**
- Modify: `packages/database/src/seed-data.ts` — 7 accounts, 7 defaults, 2 sequences, 1 close task
- Modify: `packages/database/src/journal-posting-status.ts` — `OPTIONAL_DEFAULT_ROLES`, `OPTIONAL_DEFAULT_LABELS`
- Modify: `packages/database/src/accounting-cutover/shared.ts` — `ACCOUNT_DEFAULT_COLUMNS`
- Modify: `packages/database/src/run-journals.ts` — `REVENUE_LINE_DESCRIPTIONS.Amortization`
- Modify: `packages/ee/src/accounting/core/models.ts` — `POSTING_POLICY["Lease Run"]`
- Modify: `apps/erp/app/modules/accounting/accounting.models.ts` — validators, `journalEntrySourceTypes`, `revenueScheduleTypes`
- Modify: `apps/erp/app/modules/accounting/ui/AccountDefaults/AccountDefaultsForm.tsx` — a "Leases (lessee)" group
- Modify: `apps/erp/app/components/Icons.tsx` — `case "Lease Run"`
- Modify: `apps/erp/app/routes/x+/revenue-recognition-run+/$runId.tsx` — `sectionLabels.Amortization`
- Create: `packages/database/supabase/migrations/<timestamp>_lease-run-sync-policy.sql` (only if step 8 finds stored settings)

**Steps:**
1. In `seed-data.ts` `accounts`, add the 7 accounts of Task 2 step 4 after their siblings, each with `key` = number and `parentKey` from `other-assets`, `long-term-liabilities`, `operating-expenses`, `depreciation`, `other-expenses`.
2. In `accountDefaults`, add the 7 columns → numbers.
3. In `sequences`, add `lease` (`LSE`) and `leaseRun` (`LR`) beside `rentalAgreement`.
4. In `periodCloseTaskDefinitions`, add "Post lease journals" (`unposted-lease-schedules`, `sortOrder: 5`, `Warning`, `required: true`) after "Recognize revenue for the period".
5. Add the 7 columns to `OPTIONAL_DEFAULT_ROLES` (alphabetical) and labels to `OPTIONAL_DEFAULT_LABELS` ("Right-of-Use Assets", "Accumulated Amortization – ROU", "Lease Liabilities", "Operating Lease Expense", "Variable Lease Expense", "Amortization – ROU Assets", "Interest Expense – Leases").
6. Add the 7 columns to `ACCOUNT_DEFAULT_COLUMNS` before `"migrationClearingAccount"`.
7. Add `Amortization: { debit: "Lease cost recognized", credit: "Right-of-use asset amortized" }` to `REVENUE_LINE_DESCRIPTIONS`.
8. Add `"Lease Run": { representation: "journal", defaultEnabled: false, defaultGranularity: "individual" }` to `POSTING_POLICY` after `Lease`, with a comment "Lease runs. Off by default, as 'Revenue Recognition'." Then find where per-integration `sourceTypes` settings are stored: `grep -rn "sourceTypes" packages/ee/src/accounting --include=*.ts | grep -v test`. If they are stored in a table or JSON column, create migration `lease-run-sync-policy` that copies each stored `sourceTypes."Revenue Recognition"` object to `sourceTypes."Lease Run"` where `"Lease Run"` is absent. If the storage is not a single JSON column, STOP and report.
9. In `accounting.models.ts`: add `rightOfUseAssetAccount`, `accumulatedRightOfUseAmortizationAccount`, `leaseLiabilityAccount` to `defaultBalanceSheetAccountValidator` and `operatingLeaseExpenseAccount`, `variableLeaseExpenseAccount`, `rightOfUseAmortizationExpenseAccount`, `leaseInterestExpenseAccount` to `defaultIncomeAcountValidator` (all `z.string().optional()`); add `"Lease Run"` to `journalEntrySourceTypes`; add `"Amortization"` to `revenueScheduleTypes`.
10. In `AccountDefaultsForm.tsx`, add a group `id: "leases"`, title `t\`Leases (Lessee)\``, after `fixed-assets`, with the 7 fields. Copy the field shape of `netInvestmentInLeasesAccount` (label, description, `badgeType`); leave out `termId`.
11. In `Icons.tsx`, add `case "Lease Run":` falling through to the `"Lease"` icon.
12. In `$runId.tsx`, add `Amortization: t\`Amortization\`` to `sectionLabels`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database --filter=@carbon/ee --filter=@carbon/server-functions --filter=erp
# Expected: 0 errors
pnpm --filter @carbon/ee test -- posting-policy
# Expected: passes
```

**Out of scope:** run engine behavior (Tasks 6–11).

---

## Task 5: Add the pure lease math (`lease-math.ts`)

**Depends on:** none
**Files:**
- Create: `packages/utils/src/lease-math.ts`
- Create: `packages/utils/src/lease-math.test.ts`
- Modify: `packages/utils/src/index.ts` — `export * from "./lease-math";`
- Copy from (precedent): `packages/utils/src/lessor-lease.ts` (`presentValue`, `classifyLessorLease`, `buildLessorSchedule`, `wholeMonthsInTerm`)

**Steps:**
1. Import `round` from `@carbon/database/precision`, the date helpers from `./revenue-schedule.ts`, and `classifyLessorLease`, `wholeMonthsInTerm`, `Timing` from `./lessor-lease.ts`.
2. Export `addMonths(date: string, months: number): string`. It clamps the day to the target month's length (2027-01-31 + 1 → 2027-02-28).
3. Export `type LeasePaymentRowInput = { periodStart: string; periodEnd: string; dueDate: string; amount: number; paymentType: "Rent" | "Purchase Option" | "Termination Penalty" }`.
4. Export `generateLeasePayments(args: { commencementDate: string; endDate: string; paymentAmount: number; frequency: "Monthly" | "Quarterly" | "Annual"; timing: Timing; annualEscalationPercent: number; purchaseOptionAmount: number; decimals: number }): LeasePaymentRowInput[]`:
   - Step months = 1, 3 or 12. Period `i` starts at `addMonths(commencement, i × step)` and ends the day before the next start, capped at `endDate`.
   - Amount = `round(paymentAmount × (1 + e/100)^floor(monthsFromStart / 12), decimals)`.
   - A last period shorter than `step` months is prorated by days (plan decision P5).
   - `dueDate` = `periodStart` for Advance, `periodEnd` for Arrears.
   - If `purchaseOptionAmount > 0`, append one `Purchase Option` row with `periodStart = periodEnd = dueDate = endDate`.
5. Export `paymentMonthIndex(row, commencementDate, timing, termMonths): number` per plan decision P4.
6. Export `presentValueOfPayments(args: { payments: { monthIndex: number; amount: number }[]; annualRate: number }): number` = `round(Σ amount × (1 + r)^−monthIndex)`, `r = annualRate / 100 / 12`.
7. Export `classifyLesseeLease(args: { termMonths: number; pvPayments: number; fairValue: number | null; economicLifeMonths: number | null; ownershipTransfers: boolean; purchaseOptionReasonablyCertain: boolean; specializedAsset: boolean; shortTermExpedient: boolean }, thresholds): { classification: "Operating" | "Finance" | "Short-Term"; tests; pvToFairValuePercent; termToLifePercent }`. Return `Short-Term` when `shortTermExpedient && termMonths <= 12 && !purchaseOptionReasonablyCertain`. Otherwise call `classifyLessorLease` and map `Sale → Finance`, `Rental → Operating`.
8. Export `type LesseeScheduleLine = { periodDate; openingLiability; paymentAmount; interestAmount; principalAmount; closingLiability; leaseCost; rouAmortization; closingRouAsset }`.
9. Export `buildLesseeSchedule(args: { openingLiability: number; openingRouAsset: number; payments: { monthIndex: number; amount: number }[]; months: number; annualRate: number; timing: Timing; classification: "Operating" | "Finance"; amortizationMonths: number; periodDates: string[] }): LesseeScheduleLine[]`:
   - Month `m` pays `advance` = Σ Advance-type amounts with `monthIndex = m` first, and `arrears` = Σ amounts with `monthIndex = m + 1` last. (Pass each payment with its own index; the function needs only the index. For Advance timing a `Purchase Option` row has index = `months`, so it lands as `arrears` of the last month.)
   - `interest = round((opening − advance) × r)`; `closing = round(opening − advance + interest − arrears)`. The last month sets `closing = 0` and `interest` to the value that closes it.
   - Operating: `leaseCost = round((Σ payments + openingRouAsset − openingLiability) ÷ months)`, the last month absorbing; `rouAmortization = leaseCost − interest`.
   - Finance: `rouAmortization = round(openingRouAsset ÷ amortizationMonths)`; when `amortizationMonths = months` the last month takes the remainder; `leaseCost = interest + rouAmortization`.
   - `closingRouAsset` runs down from `openingRouAsset`.
10. Export `remeasureLease(args: { carryingLiability: number; carryingRouAsset: number; remainingPayments: { monthIndex: number; amount: number }[]; annualRate: number }): { liability: number; adjustment: number; rouAsset: number; gain: number }`. `liability` = PV of the remaining payments; `adjustment = liability − carryingLiability`; `rouAsset = carryingRouAsset + adjustment`; when that is negative, `gain = −rouAsset` and `rouAsset = 0`.
11. Write tests (`describe` per function):
    - The worked example: 36 rows of 10,000, Arrears, 6% → PV 328,710.16; schedule line 1 interest 1,643.55, principal 8,356.45, closing 320,353.71; line 36 closing 0; Operating month 1 `leaseCost` 10,000 and `rouAmortization` 8,356.45; Finance month 1 `rouAmortization` 9,130.84; Σ `leaseCost` = 360,000 for both; final `closingRouAsset` 0.
    - Advance timing: PV = arrears PV × 1.005 (±0.01).
    - Quarterly: 12 rows; Annual: 3 rows.
    - Escalation 3%: rows 13–24 are 10,300, rows 25–36 are 10,609.
    - A 45-day last period is prorated.
    - A purchase option of 20,000: PV = 345,423.06; Finance with `amortizationMonths = 84` amortizes 4,112.18 a month.
    - `classifyLesseeLease`: 12 months → `Short-Term`; fair value 340,000 → `Finance`; no inputs → `Operating`.
    - `remeasureLease`: an increase adds to ROU; a decrease larger than ROU returns a gain.

**Verify:**
```bash
pnpm --filter @carbon/utils test -- lease-math
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=@carbon/utils
# Expected: 0 errors
```

**Out of scope:** journal lines (Task 14), lessor code (no behavior change in `lessor-lease.ts`).

---

## Task 6: Give the run server functions a run type

**Depends on:** Task 4
**Files:**
- Create: `packages/server-functions/src/lib/run-type.ts`
- Modify: `packages/server-functions/src/propose-revenue-recognition-run/index.ts`
- Modify: `packages/server-functions/src/preview-revenue-recognition-run/index.ts`
- Modify: `packages/server-functions/src/recalculate-revenue-recognition-run/index.ts`
- Modify: `packages/server-functions/src/propose-revenue-recognition-run/run-test-fixture.ts` — `holdInDraftRun` takes a type
- Modify: `packages/server-functions/src/__snapshots__/permissions-manifest.test.ts.snap` (only if it changes)
- Modify tests: `preview-revenue-recognition-run.test.ts`, `recalculate-revenue-recognition-run.test.ts`

**Steps:**
1. In `lib/run-type.ts`, export `type RunType = Database["public"]["Enums"]["runType"]`, `RUN_SEQUENCE: Record<RunType, string> = { "Revenue Recognition": "revenueRecognitionRun", Lease: "leaseRun" }`, and `whereRunType(qb, type)`. For `Lease` it adds `where(eb => eb.or([eb("rentalAgreementLineId", "is not", null), eb("leaseId", "is not", null)]))`; for `Revenue Recognition` it adds `where("rentalAgreementLineId", "is", null).where("leaseId", "is", null)`. Type it over a Kysely select or update builder on `revenueRecognitionSchedule`.
2. Add `type: RunType` to `RunProposalContext`.
3. Replace the constant `RUN_ROW_SYNTHESIZERS` with a function `runRowSynthesizers(type: RunType): RunRowSynthesizer[]`. `Revenue Recognition` returns `[synthesizeContractRevenue]`; `Lease` returns `[synthesizeRentalAccruals]`. Update every caller to call `runRowSynthesizers(ctx.type)`.
   - Merge note (projects branch `projects-wbs-research-spec`): there the function is `runRowSynthesizers(extra)`, returning `[synthesizeRentalAccruals, ...extra, synthesizeProjectRevenue, synthesizeContractRevenue]`. The merged form is `runRowSynthesizers(type, extra)`: `Revenue Recognition` → `[...extra, synthesizeProjectRevenue, synthesizeContractRevenue]`; `Lease` → `[synthesizeRentalAccruals]`. The project and Percent Complete synthesizers never run in a lease run. Every call site passes both the type and `revenueRunSynthesizers`.
4. In `selectDueScheduleRows`, apply `whereRunType(…, ctx.type)`.
5. In `createRevenueRecognitionRunProposal`, filter the Draft refusal on `type`, draw the sequence from `RUN_SEQUENCE[type]`, and insert `type`. Change the message to `${draft.runId} is already a draft for this period. Recalculate it instead.` (unchanged text, now per type).
6. Add `type: z.enum(["Revenue Recognition", "Lease"]).default("Revenue Recognition")` to the propose and preview inputs. Pass it through.
7. In recalculate, select `type` from the locked run and pass it to the synthesizers and `selectDueScheduleRows`.
8. Give `holdInDraftRun` an optional `type` (default `Revenue Recognition`).
9. Add tests:
   - preview with `type: "Lease"` counts a due rental Accrual row; preview with the default type does not.
   - recalculate of a Lease Draft re-claims rental rows only.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- revenue-recognition-run permissions-manifest
# Expected: passes (review any snapshot diff before `-u`)
pnpm exec turbo run typecheck --filter=@carbon/server-functions
# Expected: 0 errors
```

**Out of scope:** posting (Task 8), lessee rows (written in Task 14).

---

## Task 7: Give the run journal builder a run type and a lessee source

**Depends on:** Task 4
**Files:**
- Modify: `packages/database/src/run-journals.ts`
- Modify: `packages/database/src/run-journals.test.ts`

**Steps:**
1. Add `runType: "Revenue Recognition" | "Lease"` to the `buildRecognitionJournals` args.
2. Set the journal `sourceType` to `"Revenue Recognition"` or `"Lease Run"` and the description to `Revenue Recognition ${runReadableId}` or `Lease Run ${runReadableId}`.
3. Add `leaseId` and `leaseScheduleLineId` to `RecognitionScheduleRow`.
4. Add `leases: Map<string, { supplierId: string; locationId: string | null }>` to `RecognitionSources`.
5. In `recognitionSource`, after the contract branch, map a row with `leaseId` to `documentType: "Lease"`, `documentId: leaseId`, dimensions `{ Supplier: supplierId, Location: locationId }`. Add `Supplier` to the dimensions type (null for the other sources).
6. Rename the journal field `leaseScheduleLineIds` to `rentalLeaseScheduleLineIds` and add `lesseeScheduleLineIds` (from `row.leaseScheduleLineId`). Update the one consumer in `accounting.server.ts`.
7. Add tests: a `Lease` run with one lessee Interest row and one Amortization row builds one `Lease Run` journal with `documentType "Lease"`, balanced, and both ids in `lesseeScheduleLineIds`.

**Verify:**
```bash
pnpm --filter @carbon/database test -- run-journals
# Expected: passes
```

**Out of scope:** reading the sources from the database (Task 8).

---

## Task 8: Make post, reverse and delete type-aware

**Depends on:** Tasks 6, 7
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.server.ts` — `postRevenueRecognitionRun`, `reverseRevenueRecognitionRun`
- Modify: `apps/erp/app/routes/x+/revenue-recognition-run+/$runId.post.tsx` — the Supplier dimension

**Steps:**
1. In `postRevenueRecognitionRun`, select `type` with the run.
2. Filter the unclaimed-due-rows check (lines 1163–1170) with the same predicate as `whereRunType` (inline Kysely; the ERP cannot import the server-functions lib).
3. Run the unsynthesized-contract check (1175–1198) only when `run.type === "Revenue Recognition"`.
4. Select `s.leaseId` and `s.leaseScheduleLineId` with the rows. Read the leases: `selectFrom("lease").select(["id", "supplierId", "locationId"]).where("id", "in", leaseIds).where("companyId", "=", companyId)`. Put them in `sources.leases`.
5. Pass `runType: run.type` to `buildRecognitionJournals`.
6. Add `Supplier` to `RevenueRecognitionDimensionIds` and to the dimension map. In `$runId.post.tsx`, load the Supplier dimension the same way as Customer.
7. After the `rentalLeaseScheduleLine` stamp (1401–1417), stamp `leaseScheduleLine` with `journal.lesseeScheduleLineIds` the same way.
8. In `reverseRevenueRecognitionRun`:
   1. Filter the one-Draft check on `type`.
   2. Select `s.leaseScheduleLineId`. Clear `leaseScheduleLine.journalId` and `postedAt` like the rental block.
   3. After the rows return to Planned, delete the run lines of rows that do NOT match the run's type. Set those rows' `runLineId` to null (spec §6, "Reverse Run releases the other family").
9. `deleteRevenueRecognitionRun` needs no change. Confirm it by reading it.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** the routes' Draft lookups (Task 10), the legacy backfill (Task 9).

---

## Task 9: Thread the run type through the legacy backfill

**Depends on:** Task 7
**Files:**
- Modify: `packages/database/src/legacy-documents.ts` — `legacyRecognitionSchedule` selects `run.type`
- Modify: `packages/server-functions/src/activate-accounting/legacy/runs.ts` — pass `runType`; stamp `leaseScheduleLine`

**Steps:**
1. In `legacyRecognitionSchedule` (lines 1102–1145), select the run's `type` and add it to the returned row type.
2. In `buildLegacyRecognitionJournals` (runs.ts 223–260), pass `runType` per run to `buildRecognitionJournals`.
3. Beside the `rentalLeaseScheduleLine` stamp (581–586), add a `leaseScheduleLine` stamp keyed by `leaseScheduleLineId`.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- legacy-runs runs.test legacy-documents
# Expected: passes
```

**Out of scope:** new legacy behavior for lessee documents.

---

## Task 10: Add the Lease Runs list and make the run page type-aware

**Depends on:** Task 8
**Files:**
- Create: `apps/erp/app/routes/x+/accounting+/lease-runs.tsx`
- Create: `apps/erp/app/routes/x+/accounting+/lease-runs.new.tsx`
- Modify: `apps/erp/app/routes/x+/accounting+/revenue-recognition-runs.tsx`, `revenue-recognition-runs.new.tsx` — filter on `type`
- Modify: `apps/erp/app/routes/x+/revenue-recognition-run+/$runId.tsx`, `$runId.repeat.tsx`, `_layout.tsx` — read `type`
- Modify: `apps/erp/app/modules/accounting/ui/RevenueRecognition/RevenueRecognitionRunsTable.tsx`, `RevenueRecognitionRunHeader.tsx` — a `type` prop / read
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — `getRevenueRecognitionRuns(…, type)`; `getDeferredRevenueWaterfall` excludes lessee rows
- Modify: `apps/erp/app/modules/accounting/ui/useAccountingSubmodules.tsx` — "Lease Runs"
- Modify: `apps/erp/app/utils/path.ts` — `leaseRuns`, `newLeaseRun`
- Copy from (precedent): `revenue-recognition-runs.tsx`, `revenue-recognition-runs.new.tsx`

**Steps:**
1. Add a `type` argument to `getRevenueRecognitionRuns` and `.eq("type", type)`.
2. Copy `revenue-recognition-runs.tsx` to `lease-runs.tsx` with `type = "Lease"`, breadcrumb `msg\`Lease Runs\``, and the New Run action `path.to.newLeaseRun`. Filter its "latest run" read on `type`.
3. Copy `revenue-recognition-runs.new.tsx` to `lease-runs.new.tsx`; filter `existingDraft` on `type`; invoke `propose-revenue-recognition-run` with `{ periodEnd, type: "Lease" }`; redirect to `path.to.revenueRecognitionRun(id)`.
4. In the two revenue routes, filter on `type = 'Revenue Recognition'`.
5. Give `RevenueRecognitionRunsTable` a `type` prop. Title: `t\`Lease Runs\`` or `t\`Revenue Recognition\``.
6. In `$runId.tsx`, select `type`. Use it for the breadcrumb (`Lease Runs` → `path.to.leaseRuns`), the page title and the header confirm texts ("lease run" vs "revenue recognition run").
7. In `$runId.repeat.tsx`, filter `existingDraft` on the source run's type and pass `type` to propose.
8. In `getDeferredRevenueWaterfall`, add `.is("leaseId", null)`.
9. Add `{ name: t\`Lease Runs\`, to: path.to.leaseRuns, role: "employee", icon: <LuCalendarClock /> }` after Revenue Recognition in the Closing group.
10. Add `leaseRuns: \`${x}/accounting/lease-runs\`` and `newLeaseRun: \`${x}/accounting/lease-runs/new\`` to `path.ts` in alphabetical position.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** the close wizard (Task 11).

---

## Task 11: Add the lease run to the close wizard, the monthly job and the journal guards

**Depends on:** Tasks 6, 8
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — `PeriodRunPreview`, `getPeriodRunPreview`, `computePeriodReadiness`, `getJournalEntryRelatedItems` run lookup, `reverseJournalEntry`
- Modify: `apps/erp/app/modules/accounting/accounting.models.ts` — `RUN_JOURNAL_SOURCES`
- Modify: `apps/erp/app/modules/accounting/ui/JournalEntries/JournalEntryHeader.tsx`, `JournalEntryDocuments.tsx`
- Modify: `apps/erp/app/routes/x+/accounting+/periods.$periodId.close.tsx`
- Modify: `packages/jobs/src/inngest/functions/scheduled/revenue-recognition-proposal.ts`
- Modify: `packages/server-functions/src/post-rental-agreement/validators.ts`, `post-rental-agreement/return-unit.ts`, `post-memo/index.ts` — "lease run" wording
- Modify: `apps/erp/app/modules/accounting/accounting.periods.test.ts`

**Steps:**
1. `PeriodRunPreview` becomes `{ revenue; lease; depreciation }`. `getPeriodRunPreview` invokes the preview twice (`type` default and `"Lease"`). Update every caller and test fixture.
2. In `computePeriodReadiness`, filter `heldRevenueRows` on `run.type = 'Revenue Recognition'`; add `heldLeaseRows` the same way for `Lease`. Add a check `{ autoCheckKey: "unposted-lease-schedules", severity: "Warning", label: "Lease entries a lease run would post by this period end, and lease Draft runs hold", failing, count, amount, due: runPreview.lease, draftRuns }`.
3. In the close page: add action intent `create-lease-run` (copy `create-revenue-run`, type `Lease`, Draft check filtered on `type`); add `case "unposted-lease-schedules"` to the task description; map the intent; pass `runType="lease"` to `PeriodRunDue`; add a "Go to lease runs" link. Extend `PeriodRunDue`'s `runType` union with `"lease"` and its strings.
4. In the monthly job, propose twice per company: once per type, each with its own Draft check and step id (`rev-rec-${id}`, `lease-run-${id}`).
5. Add `"Lease Run": "lease"` to `RUN_JOURNAL_SOURCES`. Confirm `JournalEntryHeader` reads the map, so the Reverse button hides.
6. In `getJournalEntryRelatedItems`, take the run lookup when `sourceType` is `"Revenue Recognition"` or `"Lease Run"`. Select `type` with the run and return `kind: "revenueRecognitionRun"` with a `runType` field. In `JournalEntryDocuments.tsx`, label it "Lease Run" when `runType === "Lease"`.
7. Replace "revenue recognition run" with "lease run" in the three rental messages.
8. Extend `accounting.periods.test.ts`: a period with due lease rows fails `unposted-lease-schedules` and passes with none.

**Verify:**
```bash
cd apps/erp && pnpm exec vitest run app/modules/accounting/accounting.periods.test.ts
# Expected: passes
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/jobs --filter=@carbon/server-functions
# Expected: 0 errors
```

**Out of scope:** the external sync engine itself.

---

## Task 12: Add the lease validators

**Depends on:** Task 4
**Files:**
- Modify: `apps/erp/app/modules/purchasing/purchasing.models.ts` — a "Leases" section
- Copy from (precedent): `rentalAgreementValidator` (`sales.models.ts:1416–1467`), `rentalAgreementLineClassificationValidator` (1538)

**Steps:**
1. Export option arrays from the DB enums: `leaseStatuses`, `lesseeClassifications`, `leasePaymentFrequencies`, `leasePaymentTimings` (`["Advance", "Arrears"]`), `leasePaymentStatuses`.
2. Export `leaseValidator`: `id`, `leaseId` optional; `name` required; `description`, `supplierId` required; `supplierLocationId`, `supplierContactId`, `locationId`, `assignee` optional; `commencementDate`, `endDate` required; `noticeDate`, `invoiceFromDate` optional; `paymentAmount` (≥ 0), `paymentFrequency`, `paymentTiming`, `annualEscalationPercent` (≥ 0, default 0), `discountRate` (≥ 0), `currencyCode`; `fairValue`, `economicLifeMonths` optional; `ownershipTransfers`, `specializedAsset`, `purchaseOptionReasonablyCertain` (`zfd.checkbox()`); `purchaseOptionAmount` optional. Refine: end ≥ commencement; `noticeDate` ≤ `endDate`; `invoiceFromDate` ≥ `commencementDate`; reasonably certain needs `purchaseOptionAmount > 0`.
3. Export `leasePaymentValidator`: `id` optional, `leaseId`, `periodStart`, `periodEnd`, `dueDate`, `amount` (≥ 0), `paymentType` (default `Rent`). Refine `periodEnd ≥ periodStart`.
4. Export `leaseClassificationValidator` = `{ classification: z.enum(["Operating", "Finance"]), reason: min 1 }`.
5. Export `leaseModifyValidator` = `{ effectiveDate, endDate, discountRate, paymentAmount, paymentFrequency, annualEscalationPercent }` (the remaining rows are regenerated from these terms from the effective date; row edits after a Modify are not in v1).
6. Export `leaseTerminateValidator` = `{ terminationDate, penaltyAmount (≥ 0, default 0), notes optional }`.
7. Export `leasePurchaseValidator` = `{ exerciseDate, purchasePrice (≥ 0), fixedAssetClassId required, name required }`.
8. Add a test file `purchasing.models.test.ts` case for each refine.

**Verify:**
```bash
cd apps/erp && pnpm exec vitest run app/modules/purchasing/purchasing.models.test.ts
# Expected: passes
```

**Out of scope:** server-side rules (Task 14).

---

## Task 13: Add the lease service functions

**Depends on:** Task 12
**Files:**
- Modify: `apps/erp/app/modules/purchasing/purchasing.service.ts` — a "Leases" section
- Modify: `apps/erp/app/modules/purchasing/purchasing.server.ts` — `generateLeaseInvoicesNow`
- Modify: `apps/erp/app/modules/purchasing/types.ts` — `Lease`, `LeasePayment`, `LeaseScheduleLine`, `LeaseEvent` row types
- Copy from (precedent): the rental agreement section of `sales.service.ts` (8629–9135), `generateRentalInvoicesNow` (`sales.server.ts:400`)

**Steps:**
1. Add, each `(client, …) → {data, error}`, with `@mcp read` / `create` / `update` / `delete` JSDoc tags like the rental ones:
   - `getLeases(client, companyId, args: GenericQueryFilters & { search })` over the `leases` view, search on `name` and `leaseId`.
   - `getLease(client, id)`; `insertLease(client, lease & { leaseId; companyId; createdBy; customFields? })` returning `id, leaseId`; `updateLease(client, lease & { id; updatedBy })` refusing non-Draft by `.eq("status", "Draft")`; `deleteLease(client, id)` with `.eq("status", "Draft")`.
   - `getLeasePayments(client, leaseId)` ordered by `dueDate`; `upsertLeasePayment`; `deleteLeasePayment` (both refuse unless the lease is Draft: read the lease first and return an error object).
   - `regenerateLeasePayments(client, args: { leaseId; companyId; userId; decimals })`: reads the lease, deletes its payment rows, inserts `generateLeasePayments(...)` rows (status `Skipped` when `dueDate < invoiceFromDate`).
   - `getLeaseSchedule(client, leaseId)` joined to its `revenueRecognitionSchedule` rows' `status` and `journalId`.
   - `getLeaseEvents(client, leaseId)`; `getLeaseRelatedDocuments(client, leaseId)` (purchase invoices from `purchaseInvoiceLine.leaseId`, journals from `journalLine.documentId`).
2. Add `generateLeaseInvoicesNow(db, { companyId, asOf, leaseId, userId })` to `purchasing.server.ts`, copying `generateRentalInvoicesNow` with `"create-lease-invoices"`.
3. Export the new functions from the module barrel if the barrel lists exports explicitly.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
pnpm run generate:mcp 2>/dev/null || true; git diff --stat apps/erp/app/routes/api+/mcp+/lib/
# Expected: the digest lists the new purchasing_* lease tools
```

**Out of scope:** activation (Task 14). `generateLeaseInvoicesNow` fails until Task 24; that is expected.

---

## Task 14: Add the `post-lease` server function: activate and cancel

**Depends on:** Tasks 5, 7, 13
**Files:**
- Create: `packages/server-functions/src/post-lease/index.ts` — definition and dispatch
- Create: `packages/server-functions/src/post-lease/lease.ts` — `lockLease`, `loadLesseeAccounting`, `postLesseeJournal`, `writeSchedule`
- Create: `packages/server-functions/src/post-lease/lessee.ts` — pure journal-line builders
- Create: `packages/server-functions/src/post-lease/validators.ts` — payload union and pure blockers
- Create: `packages/server-functions/src/post-lease/lessee.test.ts`, `lease-test-fixture.ts`, `activate.test.ts`
- Modify: `packages/server-functions/src/invoke.ts` — register `"post-lease"`
- Modify: `packages/server-functions/src/__snapshots__/permissions-manifest.test.ts.snap`
- Copy from (precedent): `post-rental-agreement/index.ts` (1045–1080), `agreement.ts` (`lockAgreement` 55, `loadLeaseAccounting` 170, `postLeaseJournal` 262), `lessor.ts` (`toPostingLines` 222), `post-charge/post-charge-void.ts`, `rental-test-fixture.ts`

**Steps:**
1. `validators.ts`: `payloadValidator = z.discriminatedUnion("type", [activate {leaseId}, cancel {leaseId}, modify {leaseId, ...leaseModify}, terminate {leaseId, ...leaseTerminate}, purchase {leaseId, ...leasePurchase}])`. Pure blockers: `activateBlocker(lease, payments, baseCurrencyCode)` ("A lease needs at least one payment", "Leases in a foreign currency are not supported yet", "The lease is not a Draft").
2. `lessee.ts`: copy `naturalAmount`, `Leg` and `toPostingLines` from `lessor.ts` and add `"liability"` (credit-positive) to `AccountType`. Export `commencementLines({ liability, accounts })` (Dr ROU / Cr Lease liability). Unit-test it balanced.
3. `lease.ts`:
   - `lockLease(trx, companyId, id)`: copy `lockAgreement`; DATE columns as `::text`; numerics via `Number`.
   - `loadLesseeAccounting(trx, { companyId, companyGroupId, today })`: copy `loadLeaseAccounting` for the 7 lessee defaults, plus `assetGainOnDisposalAccount`, `assetLossOnDisposalAccount`; dimensions `Supplier`, `Location`. After the cutover a missing default throws `InvalidInputError("Set the lease (lessee) accounts in Accounting → Defaults")`.
   - `postLesseeJournal(trx, { accounting, companyId, userId, postingDate, description, lines, leaseId, tags: { supplierId, locationId } })`: copy `postLeaseJournal` with `sourceType: "Lease"`, `documentType: "Lease"`, `documentId: leaseId`, `documentLineReference: null`.
   - `writeSchedule(trx, { lease, lines, accounts, fromMonthIndex, userId })`: insert `leaseScheduleLine` rows, then two Planned `revenueRecognitionSchedule` rows per line (`type` `Interest` and `Amortization`, `leaseId`, `leaseScheduleLineId`, `periodStart` = the lease month's first day, `periodEnd` = `scheduledDate` = `periodDate`, debit/credit per spec §3). Skip a row whose amount is 0.
4. `index.ts` `activate`:
   1. Lock the lease; run `activateBlocker`.
   2. Read thresholds and `leaseShortTermExpedient` from `companySettings`; read payment rows.
   3. `termMonths = wholeMonthsInTerm(commencementDate, endDate)`; payments → `{ monthIndex, amount }` with `paymentMonthIndex`; `pv = presentValueOfPayments`.
   4. Classify with `classifyLesseeLease`, unless `classificationOverride` is set.
   5. If `Short-Term`: set `status Active`, `lesseeClassification`, `classificationInputs`, `activatedAt`; stop.
   6. Else: post `commencementLines` dated `commencementDate` through `postLesseeJournal`; build the schedule with `buildLesseeSchedule` (`amortizationMonths` = `economicLifeMonths` when ownership transfers or the purchase option is reasonably certain, else `termMonths`); `writeSchedule`; set `initialLiability = initialRouAsset = rouAssetCost = pv`, `commencementJournalId`, status, classification, `activatedAt`.
   7. If the company has a cutover and `commencementDate` is before it, STOP with `InvalidInputError("This lease started before accounting was set up. Opening balances for it are not supported yet.")` — Task 30 replaces this refusal.
5. `index.ts` `cancel`: allowed for Draft (delete the lease), or Active with no `Invoiced` payment row and no Posted schedule row. For Active, void the commencement journal with a negated entry (copy `post-charge-void.ts` steps 1–7, description `VOID Lease ${leaseId}`), delete the schedule rows (cascade deletes the Planned recognition rows), set status `Cancelled`. Refuse while a Draft run holds a row of the lease: "LR… holds this lease's entries; delete or recalculate it first".
6. Register `"post-lease": () => import("./post-lease")` in `invoke.ts`. Permissions `{ update: "purchasing" }`.
7. `lease-test-fixture.ts`: copy `rental-test-fixture.ts` for a supplier, a location, the 7 accounts + defaults, sequences (`lease`, `journalEntry`, `fixedAsset`, `leaseRun`), and one Draft lease with generated payment rows (the worked example).
8. `activate.test.ts` (`databaseTest`): activation writes 36 schedule lines, 72 Planned rows, one journal Dr ROU 328,710.16 / Cr liability; a 12-month lease activates Short-Term with no journal; cancel of an untouched Active lease voids the journal.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- post-lease permissions-manifest
# Expected: passes (review the snapshot diff, then `-u`)
pnpm exec turbo run typecheck --filter=@carbon/server-functions
# Expected: 0 errors
```

**Out of scope:** Modify / Terminate / Purchase (Task 15), the opening journal (Task 30).

---

## Task 15: Add Modify, Terminate and Purchase to `post-lease`

**Depends on:** Task 14
**Files:**
- Modify: `packages/server-functions/src/post-lease/index.ts`, `lessee.ts`, `validators.ts`
- Create: `packages/server-functions/src/post-lease/lifecycle.test.ts`
- Copy from (precedent): `post-rental-agreement/return-unit.ts` 456–526 (fixed asset insert)

**Steps:**
1. Add a shared pre-check `lifecycleBlocker`. It refuses when any of these holds:
   - The lease is not Active.
   - The effective date is not a lease-month boundary.
   - A lease month before the effective date has a row that is not Posted (plan decision P6).
   - A run holds a row of the lease from the effective month on (`runLineId is not null`). The message names the run (`LR…`).
   - Purchase only: the lease is Short-Term. (Modify and Terminate allow Short-Term; they only change payment rows.)
2. Compute the carrying amounts at the effective month `e`:
   - `carryingLiability` = `closingLiability` of month `e − 1`, or `initialLiability` when `e = 0`.
   - `accumulated` = Σ `rouAmortization` of the Posted months.
   - `carryingRou` = `rouAssetCost − accumulated`.
3. **Modify:**
   1. Delete the Pending payment rows due on or after the effective date.
   2. Insert new rows from `generateLeasePayments` over `[effectiveDate, newEndDate]`.
   3. Call `remeasureLease` at the new rate, with month indexes relative to `e`.
   4. Reclassify with `classifyLesseeLease` (new term, same inputs).
   5. Post `remeasurementLines`: Dr ROU / Cr liability for an increase; the reverse for a decrease; the `gain` to `assetGainOnDisposalAccount`.
   6. Delete the schedule lines from month `e`. Call `writeSchedule` from the new liability and ROU.
   7. Update `endDate`, `discountRate` and the terms. Add the adjustment to `rouAssetCost`.
   8. Insert a `leaseEvent`.
   9. If the lease is Short-Term, do only sub-steps 1, 2, 7 and 8: it has no schedule and no journal.
4. **Terminate:**
   1. Delete the Pending payment rows due after the date.
   2. If `penaltyAmount > 0`, insert a `Termination Penalty` row due on the date.
   3. Post `terminationLines`: Dr liability `carryingLiability − penalty`, Dr accumulated, Cr ROU `rouAssetCost`, and the gain or loss.
   4. Delete the schedule lines from month `e`.
   5. Set status `Terminated`. Insert a `leaseEvent`.
   6. If the lease is Short-Term, skip sub-steps 3 and 4: it has no schedule and no journal.
5. **Purchase:**
   1. Delete the Pending payment rows due after the date and the `Purchase Option` row.
   2. Insert a `Purchase Option` row for `purchasePrice`, due on the date.
   3. Insert the `fixedAsset`. Copy `return-unit.ts`: sequence `fixedAsset`, the class fields, `locationId` = the lease's, `status Active`.
   4. Set its `acquisitionCost` = `carryingRou + purchasePrice − carryingLiability` and `acquisitionDate` = `depreciationStartDate` = `exerciseDate`.
   5. Post `purchaseLines`: Dr class `assetAccountId` (the cost), Dr accumulated, Cr ROU `rouAssetCost`, Dr liability `carryingLiability`, Cr liability `purchasePrice`.
   6. Delete the schedule lines from month `e`.
   7. Set status `Purchased` and `fixedAssetId`. Insert a `leaseEvent`.
6. Unit-test each builder balanced, with the spec's numbers (termination at month 24 with a 5,000 penalty; purchase with a 20,000 option).
7. `lifecycle.test.ts` (`databaseTest`): post months 1–12 by setting their recognition rows to `Posted`; Modify at month 13 (extend 12 months, 7%) replaces only unposted lines and closes at 0; Modify is refused when a Draft run holds month 13; Terminate and Purchase write their events and statuses.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- post-lease
# Expected: passes
```

**Out of scope:** partial termination, impairment (spec: out of v1).

---

## Task 16: Add the lease list, new, shell, details and update routes

**Depends on:** Tasks 13–15
**Files:**
- Create: `apps/erp/app/routes/x+/purchasing+/leases.tsx`
- Create: `apps/erp/app/routes/x+/lease+/_layout.tsx`, `new.tsx`, `$id.tsx`, `$id._index.tsx`, `$id.details.tsx`, `$id.schedule.tsx`, `$id.events.tsx`, `update.tsx`, `$id.delete.tsx`
- Copy from (precedent): `x+/sales+/rental-agreements.tsx`, `x+/rental-agreement+/{_layout,new,$id,$id._index,$id.details,update,$id.delete}.tsx`

**Steps:**
1. `leases.tsx`: copy `rental-agreements.tsx`; `view: "purchasing"`; `getLeases`; `LeasesTable`; `handle.breadcrumb msg\`Leases\``.
2. `_layout.tsx`: meta `Carbon | Lease`, `handle { breadcrumb: msg\`Purchasing\`, to: path.to.purchasing, module: "purchasing" }`.
3. `new.tsx`: loader `create: "purchasing"` returns `defaultDiscountRate: companySettings.leaseIncrementalBorrowingRate` and the base currency. Action: validate `leaseValidator`; `getNextSequence(client, "lease", companyId)`; `insertLease` with `invoiceFromDate ?? commencementDate`; `regenerateLeasePayments`; redirect to `path.to.leaseDetails(id)`. Component: a `ValidatedForm` card with `LeaseForm` (Task 19).
4. `$id.tsx`: loader `view: "purchasing"` reads the lease (company check), payments, schedule, events, related documents and lease policy (`leaseMajorPartThresholdPercent`, `leaseSubstantiallyAllThresholdPercent`, `leaseShortTermExpedient`). Layout: `PanelProvider` > `LeaseHeader` > `ResizablePanels explorer={<LeaseExplorer />} content={<RecordOutlet />} properties={<LeaseProperties />}`. Export `LeaseRouteData`.
5. `$id._index.tsx`: redirect to details.
6. `$id.details.tsx`: `LeaseSummary`; while Draft a "Accounting Treatment" card with `LeaseClassificationPreview`; `LeasePayments`.
7. `$id.schedule.tsx`: `LeaseSchedule`. `$id.events.tsx`: `LeaseEvents`.
8. `update.tsx`: copy the rental `update.tsx` field-by-field pattern with `TERM_FIELDS` = the lease validator's term fields and `BOOLEAN_FIELDS` = the three checkboxes; Draft only. When a payment-term field changes, call `regenerateLeasePayments` after the update.
9. `$id.delete.tsx`: Draft only, `delete: "purchasing"`, `deleteLease`, redirect to `path.to.leases`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** lifecycle actions (Task 18).

---

## Task 17: Add the payment row routes

**Depends on:** Task 16
**Files:**
- Create: `apps/erp/app/routes/x+/lease+/$id.payments.new.tsx`, `$id.payments.$paymentId.tsx`, `$id.payments.$paymentId.delete.tsx`, `$id.payments.regenerate.tsx`
- Copy from (precedent): `x+/rental-agreement+/$id.charges.new.tsx`, `$id.charges.$chargeId.delete.tsx`

**Steps:**
1. Each action requires `update: "purchasing"` and a Draft lease (read it, refuse with a flash otherwise).
2. `new` and `$paymentId`: validate `leasePaymentValidator`; `upsertLeasePayment`; redirect to `requestReferrer(request)`.
3. `delete`: `deleteLeasePayment`.
4. `regenerate`: `regenerateLeasePayments` with the currency's `decimalPlaces`; flash "Payments regenerated from the terms".

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** editing rows after activation (plan decision P8).

---

## Task 18: Add the lifecycle routes

**Depends on:** Task 16
**Files:**
- Create: `apps/erp/app/routes/x+/lease+/$id.activate.tsx`, `$id.status.tsx` (cancel), `$id.modify.tsx`, `$id.terminate.tsx`, `$id.purchase.tsx`, `$id.invoice.tsx`, `$id.classification.tsx`
- Copy from (precedent): `x+/rental-agreement+/$id.activate.tsx`, `$id.status.tsx`, `$id.invoice.tsx`, `$id.$lineId.classification.tsx`

**Steps:**
1. `activate`, `status` (intent `cancel`), `modify`, `terminate`, `purchase`: `update: "purchasing"`; validate the matching validator; `serverFns.system({ db: getDatabaseClient(), companyId, userId }).invoke("post-lease", { type, leaseId: id, ... })`; flash the error with `getErrorMessage`; redirect to `path.to.leaseDetails(id)`.
2. `invoice`: `{ update: "purchasing", create: "invoicing" }`; Active only; `generateLeaseInvoicesNow` with today in the company time zone; flash "N invoices drafted".
3. `classification`: copy the rental override route with `update: "accounting"`, the service role, Draft only, `.is("lesseeClassification", null)` guard, and the audit entry.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** the modals' UI (Task 19).

---

## Task 19: Build the lease UI components

**Depends on:** Task 16
**Files:**
- Create in `apps/erp/app/modules/purchasing/ui/Leases/`: `LeasesTable.tsx`, `LeaseForm.tsx`, `LeaseHeader.tsx`, `LeaseExplorer.tsx`, `LeaseProperties.tsx`, `LeaseSummary.tsx`, `LeasePayments.tsx`, `LeasePaymentForm.tsx`, `LeaseSchedule.tsx`, `LeaseEvents.tsx`, `LeaseStatus.tsx`, `LeaseClassificationPreview.tsx`, `LeaseModifyModal.tsx`, `LeaseTerminateModal.tsx`, `LeasePurchaseModal.tsx`, `index.ts`
- Copy from (precedent, `apps/erp/app/modules/sales/ui/Rentals/`): `RentalAgreementsTable`, `RentalAgreementDetailsForm`, `RentalAgreementHeader`, `RentalAgreementExplorer`, `RentalAgreementProperties`, `RentalAgreementSummary`, `RentalBillingPeriods`, `RentalAgreementChargeForm`, `RentalStatus`, `RentalLeaseClassification` (`LeaseClassificationPreview`, `LeaseClassificationPanel`, `LeaseClassificationOverrideModal`)

**Steps:**
1. Load the `carbon-design` skill first. Use only components from `@carbon/react` and `~/components`.
2. `LeasesTable`: columns `leaseId` (link), `name`, `supplierName`, `status` (`LeaseStatus`), `lesseeClassification`, `commencementDate`, `endDate`, `paymentAmount` (`useCurrencyFormatter`), `currentLiability`, `nextDueDate`. Primary action "New Lease" (`create: purchasing`).
3. `LeaseForm`: the spec §1 fields in groups Party / What / Term / Payments / Measurement / Classification inputs; `Supplier`, `Location`, `Employee` (assignee) pickers from `~/components/Form`; money via `INPUT_FORMAT.money` and percents via `INPUT_FORMAT.percentPoints` with `INPUT_STEP.*`.
4. `LeaseHeader`: status, classification badge, and actions by status — Draft: Activate (confirm modal showing PV, classification, commencement journal), Delete; Active: Invoice now, Modify, Terminate, Purchase (only with a purchase option), Cancel (only when allowed). Copy the rental header's dropdown layout.
5. `LeaseExplorer`: a short list — Details, Payments, Schedule, Events.
6. `LeaseProperties`: copy `RentalAgreementProperties`' `PropertyForm` + `onUpdate` pattern, posting to `path.to.leaseUpdate`; `isDisabled = status !== "Draft" || !permissions.can("update", "purchasing")`.
7. `LeaseSummary`: terms, treatment, liability and net ROU today (from the last Posted schedule line), next payment.
8. `LeasePayments`: copy `RentalBillingPeriods`; while Draft show Add Row, edit (opens `LeasePaymentForm`), delete, and "Regenerate from terms" (confirm: "Edited rows will be replaced"); after activation show status and the invoice link. Show `Skipped` as "Paid outside Carbon".
9. `LeaseSchedule`: a table of the schedule lines with a Posted badge per row.
10. `LeaseEvents`: event type, effective date, liability before → after, ROU before → after, gain/loss, journal link, fixed asset link.
11. `LeaseClassificationPreview`: compute client-side with `generateLeasePayments` → `presentValueOfPayments` → `classifyLesseeLease`; render tests a–e like the rental panel; an "Override" button for `update: accounting` opens the override modal posting to `path.to.leaseClassification(id)`.
12. The three modals: `ValidatedForm` with the Task 12 validators, posting to the Task 18 routes; Modify and Terminate show the effective date picker and a note "Effective dates must follow the last posted lease run".

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
pnpm exec biome check apps/erp/app/modules/purchasing/ui/Leases
# Expected: no errors
```

**Out of scope:** new shared components.

---

## Task 20: Add the nav entry and paths

**Depends on:** Task 16
**Files:**
- Modify: `apps/erp/app/modules/purchasing/ui/usePurchasingSubmodules.tsx`
- Modify: `apps/erp/app/utils/path.ts`

**Steps:**
1. Add `{ name: t\`Leases\`, to: path.to.leases, icon: <LuKeyRound />, table: "lease" }` after Purchase Orders in the Manage group.
2. Add to `path.ts`, alphabetically: `lease`, `leaseActivate`, `leaseClassification`, `leaseDetails`, `leaseEvents`, `leaseInvoice`, `leaseModify`, `leasePayment(id, paymentId)`, `leasePaymentDelete`, `leasePaymentNew`, `leasePaymentsRegenerate`, `leasePurchase`, `leaseSchedule`, `leaseStatus`, `leaseTerminate`, `leaseUpdate` (`${x}/lease/update`), `leases` (`${x}/purchasing/leases`), `newLease` (`${x}/lease/new`), `deleteLease(id)`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** saved views setup for `table: "lease"` beyond the nav key. If `table` must be a registered table name and `lease` is not accepted, drop the `table` key and report.

---

## Task 21: Add the Lease line type to the purchase invoice form

**Depends on:** Task 4
**Files:**
- Modify: `apps/erp/app/modules/invoicing/invoicing.models.ts` — both line-type lists, the validator, a refine
- Modify: `apps/erp/app/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoiceLineForm.tsx` — a Lease tab
- Modify: `apps/erp/app/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoiceExplorer.tsx`, `PurchaseInvoiceSummary.tsx` — line labels
- Modify: `apps/erp/app/modules/invoicing/invoicing.service.ts` — `getActiveLeasesForSupplier`

**Steps:**
1. Add `"Lease"` to `purchaseInvoiceLineType` (line 13) and to the validator enum (line 150). Add `leaseId`, `leasePaymentId` (`zfd.text(z.string().optional())`). Refine: Lease needs `leaseId` and `description`. Refine: a Lease line refuses `projectId` ("A lease line cannot be charged to a project"). The Lease tab shows no project field.
2. Add `getActiveLeasesForSupplier(client, companyId, supplierId)` (`status in (Active, Expired, Terminated, Purchased)`, `id, leaseId, name`).
3. In the form, add a tab `lease` (only when not editing) with `<Hidden name="invoiceLineType" value="Lease" />`, a lease `Combobox` loaded through a fetcher route or the invoice loader, `description`, `quantity` fixed at 1, `supplierUnitPrice`. A line with `leasePaymentId` (drafted by the job) opens read-only for amount and lease.
4. In the explorer and summary, label a Lease line `${leaseReadableId} · ${description}` from the `purchaseInvoiceLines` view's `leaseReadableId`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** posting (Task 22).

---

## Task 22: Post and void Lease lines

**Depends on:** Task 21
**Files:**
- Modify: `packages/server-functions/src/post-purchase-invoice/posting-lines.ts` — `kind: "lease"`, `PurchaseInvoiceAccountDefaults`
- Modify: `packages/server-functions/src/post-purchase-invoice/index.ts` — classification `case "Lease"`, VOID release
- Modify: `packages/server-functions/src/activate-accounting/legacy/purchase-invoice.ts` — `case "Lease"`
- Modify: `packages/server-functions/src/post-purchase-invoice/posting-lines.test.ts`

**Steps:**
1. Add `leaseLiabilityAccount`, `operatingLeaseExpenseAccount`, `variableLeaseExpenseAccount` to `PurchaseInvoiceAccountDefaults`.
2. Add `{ kind: "lease"; leaseId: string; account: { id: string; name: string; class: AccountClass } }` to the posting-line union. Build it like `glAccount` (lines 649–678), with the debit amount `round(debit(accountTypeFromClass(line.account.class), total))` (`debit` and `accountTypeFromClass` from `@carbon/database/ledger`: a debit to the Liability-class lease liability stores a negative amount, a debit to an Expense stores a positive one). Credit `payable` as `glAccount` does. `documentType`/`documentId` stay the invoice's.
3. In `index.ts`, load the leases of Lease lines (`id, lesseeClassification`). `case "Lease"`: account = `leaseLiabilityAccount` when the line has `leasePaymentId` and the lease is Operating or Finance; `operatingLeaseExpenseAccount` when it has `leasePaymentId` and the lease is Short-Term; `variableLeaseExpenseAccount` when it has no `leasePaymentId`. A missing default throws "Set the lease (lessee) accounts in Accounting → Defaults". A Lease line with a `projectId` throws "A lease line cannot be charged to a project"; set `projectId: null` on the `lease` posting line. (The projects branch charges a project from any line with `projectId`; this keeps Lease lines out of it.)
4. In the VOID transaction (from line 521), before the status update, set `leasePayment` rows with `purchaseInvoiceLineId in` the invoice's line ids to `status: "Pending", purchaseInvoiceLineId: null, voidedPurchaseInvoiceId: invoiceId`. Copy `post-sales-invoice/index.ts:1694–1730`.
5. Mirror step 3 in the legacy switch (`purchase-invoice.ts:438`).
6. Add tests: a fixed Lease line debits the liability and credits AP 10,000; a Short-Term line debits operating lease expense; a variable line debits variable lease expense.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- post-purchase-invoice
# Expected: passes
```

**Out of scope:** drafting invoices (Task 24).

---

## Task 23: Release payment rows when a purchase invoice or line is deleted

**Depends on:** Task 21
**Files:**
- Modify: `apps/erp/app/modules/invoicing/invoicing.server.ts` — two functions
- Modify: `apps/erp/app/routes/x+/purchase-invoice+/$invoiceId.delete.tsx`, `$invoiceId.$lineId.delete.tsx`
- Modify: `apps/erp/app/routes/api+/mcp+/lib/mcp-blocked-tools.ts`
- Copy from (precedent): `deleteSalesInvoiceReleasingRentals` and `deleteSalesInvoiceLineReleasingRentals` (`sales.server.ts:527`, `627`)

**Steps:**
1. Add `deletePurchaseInvoiceReleasingLeases(db, { companyId, invoiceId, userId })`: lock the invoice `forUpdate`, refuse non-Draft, set its Lease lines' `leasePayment` rows back to `Pending` with `purchaseInvoiceLineId: null`, delete the invoice.
2. Add `deletePurchaseInvoiceLineReleasingLeases(db, { companyId, invoiceId, lineId, userId })` the same way for one line.
3. Make both routes call them with `getDatabaseClient()` in a try/catch that flashes the error.
4. Add `"invoicing_deletePurchaseInvoice"` and `"invoicing_deletePurchaseInvoiceLine"` to the blocked list, with a comment like the sales one.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** VOID (Task 22).

---

## Task 24: Add the `create-lease-invoices` server function

**Depends on:** Tasks 13, 22
**Files:**
- Create: `packages/server-functions/src/create-lease-invoices/index.ts`, `create-lease-invoices.test.ts`
- Modify: `packages/server-functions/src/invoke.ts`, the permissions snapshot
- Copy from (precedent): `create-rental-invoices/index.ts` (`createRentalInvoicesForDuePeriods` 88, `insertRentalInvoice` 541, definition 806–830); `convert/index.ts:357–454` (purchase invoice insert)

**Steps:**
1. Input `{ asOf: YYYY-MM-DD, leaseId?: string }`; permissions `{ update: "purchasing", create: "invoicing" }`.
2. Find Active leases (or ended leases with a Pending row) with a `Pending` payment row due on or before `asOf`, optionally one lease.
3. Per lease, in its own transaction (failures collected like rentals): lock the lease; lock its due Pending rows; group them by `dueDate`; for each group insert one Draft purchase invoice:
   - `invoiceId` from `getNextSequence(trx, "purchaseInvoice", companyId)`; `supplierId`; `invoiceSupplierId`, `paymentTermId`, contact and location from `supplierPayment`; `currencyCode` = the lease's; `exchangeRate` 1 (base currency only); `locationId` = the lease's; `dateIssued` = the group's `dueDate`; totals from the rows; `createdBy` = `userId`.
   - a `purchaseInvoiceDelivery` row with `id` = the invoice id (copy `convert`).
   - one line per row: `invoiceLineType "Lease"`, `leaseId`, `leasePaymentId`, `description` = `${lease.name} — ${periodStart} to ${periodEnd}` (Purchase Option / Termination Penalty rows say so), `quantity 1`, `supplierUnitPrice` = amount, `exchangeRate 1`, `locationId`, `sortOrder`.
   - stamp the rows `Invoiced` with their line ids.
4. Return `{ invoices: { invoiceId, leaseId }[], invoiceIds, failures }`.
5. Register in `invoke.ts`.
6. Test (`databaseTest`, the Task 14 fixture): an Active lease with two rows due drafts two invoices with one Lease line each; a second run drafts none; a row due before `invoiceFromDate` (status `Skipped`) is never drafted.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- create-lease-invoices permissions-manifest
# Expected: passes
```

**Out of scope:** posting the drafts (users post them).

---

## Task 25: Run lease invoicing, expiry and reminders from the daily job

**Depends on:** Task 24
**Files:**
- Modify: `packages/jobs/src/inngest/functions/scheduled/recurring-billing.ts`
- Modify: `packages/jobs/src/invoicing/digest.ts`, `digest.test.ts`
- Create: `packages/jobs/src/invoicing/lease-reminders.ts`, `lease-reminders.test.ts`
- Modify: `packages/notifications/src/index.ts` — `LeaseCriticalDate`
- Modify: `packages/jobs/src/inngest/functions/notifications/notify.ts`, `content.ts`
- Modify: `apps/erp/app/components/Layout/Topbar/Notifications.tsx`, `apps/erp/app/routes/api+/link.ts`

**Steps:**
1. In `find-companies`, add companies with an Active lease (`hasLeases`).
2. Add a step `lease-billing-${id}` that invokes `create-lease-invoices` with today in the company time zone. Push each draft as `{ invoiceId, sourceId: leaseId, outcome: "drafted" }`. Lease drafts skip the automation steps.
3. In `digest.ts`: add `"drafted"` to `InvoiceRunOutcome`; exclude it from `posted`; body `${posted} posted, ${emailed} emailed, ${review} need review, ${drafted} drafted` (omit the drafted clause when 0); `documentIds` prefer review, then drafted, then posted. Extend `digest.test.ts`.
4. In `digest-recipients`, also read `lease` `["id", "assignee", "createdBy"]`; owner = `assignee ?? createdBy`.
5. In `lease-reminders.ts`, export the pure `dueLeaseReminders(leases, today, leadDays)` → `{ leaseId, kind: "notice" | "end", date }[]` for dates exactly `leadDays` away or less and not yet reminded (`noticeRemindedFor`/`endRemindedFor` ≠ date). Test it.
6. Add a step `lease-reminders-${id}`: read Active leases with `noticeDate` or `endDate`, `leaseReminderDays`; send `carbon/notify` with `event: NotificationEvent.LeaseCriticalDate`, `documentId: lease.id`, recipient = owner, plus the "Also notify" group; stamp `noticeRemindedFor` / `endRemindedFor`.
7. Add a step `lease-expiry-${id}`: set `Expired` on Active leases whose rows are all Posted and whose payment rows are all `Invoiced` or `Skipped`.
8. In `notifications/src/index.ts`, add `LeaseCriticalDate = "lease-critical-date"`; topic `Purchasing`; email heading "Lease date coming up"; CTA "Open lease". In `notify.ts` destinations `[InApp, Email]`. In `content.ts`, the description `Lease ${readableId}: ${body}`.
9. In `Notifications.tsx` and `api+/link.ts`, link `LeaseCriticalDate` to `path.to.leaseDetails(documentId)`. For `RecurringInvoicing`, link to purchase invoices when the first document id is a purchase invoice (look it up), else keep the sales link.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- digest lease-reminders
# Expected: passes
pnpm exec turbo run typecheck --filter=@carbon/jobs --filter=@carbon/notifications --filter=erp
# Expected: 0 errors
```

**Out of scope:** automated posting of lease invoices.

---

## Task 26: Add the lease policy settings

**Depends on:** Task 14
**Files:**
- Modify: `apps/erp/app/modules/settings/settings.service.ts` — `updateLeasePolicySettings`
- Modify: `apps/erp/app/routes/x+/settings+/accounting.tsx` — validator, defaults, three inputs

**Steps:**
1. Add `leaseIncrementalBorrowingRate`, `leaseShortTermExpedient`, `leaseReminderDays` to the service's settings type.
2. Add them to `leasePolicySettingsValidator` (`zfd.numeric(min 0)`, `zfd.checkbox()`, `zfd.numeric(int, min 0)`) and the form's `defaultValues`.
3. Add a `NumberInput` "Incremental Borrowing Rate (%)" (`INPUT_FORMAT.percentPoints`), a `Boolean` "Short-term lease expedient", and a `NumberInput` "Lease reminder days". Rename the existing "Default Discount Rate" label to "Lessor Discount Rate (%)".

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** per-class policies.

---

## Task 27: Add the cutover open items

**Depends on:** Task 14
**Files:**
- Modify: `packages/database/src/accounting-cutover.ts` — `OpenItemType`
- Modify: `packages/database/src/accounting-cutover/open-items.ts` — `getLeaseLiabilityItems`, wiring
- Modify: `packages/database/src/accounting-cutover/trial-balance.ts` — control accounts
- Modify: `apps/erp/app/routes/x+/accounting+/activation.enable.tsx` — `AGGREGATE_ITEM_TYPES`
- Create: `packages/server-functions/src/activate-accounting/legacy/lessee-leases.test.ts`
- Copy from (precedent): `getLeaseNetInvestmentItems` (`open-items.ts:1164–1245`), `legacy-runs.test.ts:357–466`

**Steps:**
1. Add `"Lease Liability" | "Right-of-Use Asset" | "Accumulated ROU Amortization"` to `OpenItemType`.
2. Add `getLeaseLiabilityItems(db, companyId, cutoverDate, defaults)`: Active / Expired / Terminated / Purchased leases with `initialLiability is not null` and `commencementDate < cutoverDate`. Per lease:
   - liability = `closingLiability` of the last schedule line with `periodDate < cutoverDate` (`DISTINCT ON`), else `initialLiability`; item `basis "debit"`, `original: -round(liability)` on `leaseLiabilityAccount`.
   - ROU = `initialRouAsset` + Σ `leaseEvent` (`rouAssetAfter − rouAssetBefore`) with `effectiveDate < cutoverDate`; item `original: round(rou)` on `rightOfUseAssetAccount`.
   - accumulated = Σ `rouAmortization` of lines with `periodDate < cutoverDate`; item `original: -round(accumulated)` on `accumulatedRightOfUseAmortizationAccount`.
   - `documentType: "Lease"`, `documentId: lease.id`. Skip zero items. A missing default throws `Set the <column> account default`.
   - Leases ended (Terminated / Purchased) before the cutover produce no items.
3. Wire it into `openItemsFor` after `getLeaseNetInvestmentItems`.
4. Add the three lease defaults to `controlAccountIds` beside `netInvestmentInLeasesAccount`.
5. Add the three types to `AGGREGATE_ITEM_TYPES` if Lease Net Investment is there.
6. Test with `activationFixture()`: a lease with 12 schedule lines before the cutover yields three items equal to the rows.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- lessee-leases legacy-runs
# Expected: passes
```

**Out of scope:** leases entered after the enable (Task 30).

---

## Task 28: Add the Lease Liabilities report

**Depends on:** Task 14
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — `getLeaseLiabilities`
- Create: `apps/erp/app/routes/x+/reports+/lease-liabilities.tsx`
- Modify: `apps/erp/app/routes/x+/accounting+/reports.tsx` — hub card
- Modify: `apps/erp/app/utils/path.ts` — `leaseLiabilities`
- Create: `apps/erp/app/modules/accounting/lease-liabilities.test.ts`
- Copy from (precedent): `getLeaseNetInvestment` (`accounting.service.ts:7899–8110`), `x+/reports+/lease-net-investment.tsx`

**Steps:**
1. Put the arithmetic in a pure `summarizeLeaseLiabilities(leases, lines, payments, { asOf, startMonth })` in `accounting.utils.ts` and call it from `getLeaseLiabilities(client, companyId, { asOf, from, to })` (`@mcp read`).
2. Per lease row: `leaseId`, `name`, `supplierName`, `classification`, `remainingMonths`, `discountRate`, `liability` (closing of the last line with `periodDate <= asOf`), `currentPortion` (Σ principal of lines in the next 12 months), `nonCurrentPortion`, `netRou`, `maturityByFiscalYear` (undiscounted Pending/Invoiced-after-asOf payments by `fiscalYearAndPeriodFor`; years beyond 5 summed as "Thereafter").
3. Totals per classification: undiscounted total, imputed interest (= undiscounted − liability), weighted-average remaining term (years, weighted by liability), weighted-average rate (weighted by remaining undiscounted payments).
4. Period costs for `[from, to]`: operating lease cost, finance amortization, finance interest (posted rows by `type`), short-term cost and variable cost (posted purchase invoice Lease lines), cash paid (posted Lease lines with `leasePaymentId`).
5. The route copies `lease-net-investment.tsx`: asOf picker, the lease table with `exportValue` on every column, then two small tables (totals; period costs) with their own pickers for `from`/`to`.
6. Hub card `key "lease-liabilities"`, name "Lease Liabilities", description "Lessee lease balances, maturity analysis and lease cost", category Close Reports.
7. Test `summarizeLeaseLiabilities` with two leases: maturity − imputed interest = Σ liability; the weighted averages match a hand calculation.

**Verify:**
```bash
cd apps/erp && pnpm exec vitest run app/modules/accounting/lease-liabilities.test.ts
# Expected: passes
```

**Out of scope:** posted current / non-current reclass (spec: out of v1).

---

## Task 29: Link journals to leases

**Depends on:** Task 14
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — `JournalSourceDocument.kind`, a `Lease` branch
- Modify: `apps/erp/app/modules/accounting/ui/JournalEntries/JournalEntryDocuments.tsx` — `lease` kind

**Steps:**
1. Add `"lease"` to the `kind` union.
2. Copy the Rental Agreement branch (5928–5941) for `idsOf("Lease")` from `lease` selecting `id, leaseId`.
3. Add `lease: { label: t\`Lease\`, to: path.to.leaseDetails, icon: "Lease" }`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** run journals (Task 11).

---

## Task 30: Opening journal for a lease entered after the enable

**Depends on:** Task 14
**Files:**
- Modify: `packages/server-functions/src/post-lease/index.ts`, `lessee.ts`
- Modify: `packages/server-functions/src/post-lease/activate.test.ts`

**Steps:**
1. Spec Q8 (resolved): when the company has a cutover and `commencementDate` < cutover, the as-of date = the later of the cutover date and the first day of the earliest open accounting period.
2. Build the full schedule from commencement. Insert the lines; insert the recognition rows with `scheduledDate < asOf` as `status: "Posted"`, `journalId: null`.
3. Post one `Lease` journal dated the as-of date: Dr ROU `rouAssetCost`, Cr accumulated (Σ amortization before as-of), Cr liability (carrying at as-of), and the difference to `retainedEarningsAccount`.
4. Replace the Task 14 refusal with this path. Add a test.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- post-lease
# Expected: passes
```

**Out of scope:** Migration Clearing (never posted by this path).

---

## Task 31: Update AGENTS.md, rules and docs

**Depends on:** Tasks 1–29
**Files:**
- Modify: `apps/erp/app/modules/purchasing/AGENTS.md` — a "Leases (sub-area)" section
- Modify: `apps/erp/app/modules/accounting/AGENTS.md` — run types, Lease Run source, Lease Liabilities report, lessee open items
- Modify: `apps/erp/app/modules/sales/AGENTS.md` — rental rows post in lease runs
- Modify: `apps/erp/app/modules/invoicing/AGENTS.md` (if present) — the Lease line type
- Modify: `.claude/rules/fixed-asset-lifecycle.md` — purchase option creates an asset
- Create: `docs/content/docs/reference/leases.mdx`
- Modify: `docs/content/docs/reference/rental-agreements.mdx`, `accounting.mdx` — lease runs
- Modify: `docs/content/src/glossary/terms.ts` — Lease (lessee), Right-of-Use Asset, Lease Liability, Lease Run
- Modify: `AGENTS.md` (root Task Router) — the lessee leases row

**Steps:**
1. Load the `carbon-docs` skill for the docs pages. Ground every claim in the code from Tasks 1–29.
2. Write the module AGENTS.md sections with the real file paths, tables and functions.
3. Run the docs link check from `.claude/rules/changelog-authoring.md` ("Every internal link must resolve").

**Verify:**
```bash
pnpm --filter docs typecheck
# Expected: 0 errors
```

**Out of scope:** a changelog entry (separate, after merge).

---

## Task 32: Run the full verification sweep

**Depends on:** Task 31
**Files:** none new

**Steps:**
1. `pnpm --filter @carbon/checks license-headers`
2. `pnpm run lint`
3. `pnpm exec turbo run typecheck --filter=@carbon/database --filter=@carbon/utils --filter=@carbon/ee --filter=@carbon/server-functions --filter=@carbon/jobs --filter=@carbon/notifications --filter=erp --filter=docs`
4. `pnpm --filter @carbon/utils test`, `pnpm --filter @carbon/database test`, `pnpm --filter @carbon/server-functions test`, `pnpm --filter @carbon/jobs test`, `cd apps/erp && pnpm exec vitest run app/modules/accounting app/modules/purchasing`
5. `pnpm db:check:datasets` and `pnpm db:check:backups` (after `pnpm db:migrate`)
6. `pnpm --filter @carbon/checks clobbers`

**Verify:**
```bash
# Every command above exits 0.
```

**Out of scope:** fixing unrelated pre-existing failures — report them.

---

## Task 33: Extract and translate the new strings

**Depends on:** Task 32
**Files:** `packages/locale/locales/*/*.po`

**Steps:**
1. Run the lingui extract command from `.claude/rules/i18n-lingui-system.md`.
2. Run the `/translate` skill.

**Verify:**
```bash
git diff --stat packages/locale/locales | tail -1
# Expected: the catalogs changed; /translate reports 0 missing
```

**Out of scope:** changing existing translations.

---

## Task 34: Verify in the browser

**Depends on:** Task 33
**Files:** none

**Steps:**
1. Ask the user for permission, then run `/auth` and `/test` against the worktree's ERP (never localhost:3000).
2. Flows:
   1. Purchasing → Leases → New Lease (36 months, $10,000 Monthly, Arrears, 6%); see 36 payment rows; edit row 4 to 0; regenerate.
   2. Activate; see Operating, liability $328,710.16 and the commencement journal.
   3. Invoice now (or wait for the job); post the drafted purchase invoice; open its journal (Dr Lease liability / Cr AP).
   4. Accounting → Lease Runs → New run for the first month; post it; see one Lease Run journal; Revenue Recognition has no run for the month.
   5. Close wizard for that period shows "Post lease journals" passing.
   6. Modify at month 2; Terminate on a second lease; Purchase on a third lease with a purchase option.
   7. Reports → Lease Liabilities shows the leases and reconciles.
   8. A rental agreement's accrual rows now appear in a Lease Run.
3. Save screenshots under `.context/`.

**Verify:** every flow passes in the `/test` result table.

**Out of scope:** load tests.
