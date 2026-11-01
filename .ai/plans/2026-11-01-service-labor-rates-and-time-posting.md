# Service labor rates, time posting and revenue recognition — implementation plan

**Spec:** .ai/specs/2026-10-31-service-labor-rates-and-time-posting.md
**Research:** none. The rules come from ASC 606 and Carbon code (see the spec's Closest Sibling).
**Closest sibling:** maintenance dispatch labor (cost posting); rental accruals (revenue); Settings → Time (settings page)
**Branch:** projects-port-main-v1

## Progress
- [x] Task 1: Add the `Labor` invoice line type (migration)
- [x] Task 2: Add the rate, revenue and link columns (migration)
- [x] Task 3: Regenerate types
- [x] Task 4: Add the Service Revenue account default
- [x] Task 5: Add Settings → Service
- [x] Task 6: Add the time reference and generalize the superseded filter
- [x] Task 7: Build the time cost groups (pure)
- [x] Task 8: Add the `post-time` reconcile
- [x] Task 9: Change Complete, Reopen and Set Coverage
- [x] Task 10: Change the ERP time writes
- [x] Task 11: Add the job bill rate and fixed price
- [x] Task 12: Add the Labor estimate line
- [x] Task 13: Bill labor on one Labor invoice line
- [x] Task 14: Post service job invoices to Service Revenue and clear accruals
- [x] Task 15: Accrue service revenue in the revenue recognition run
- [x] Task 16: Sync Service Revenue to QuickBooks, Xero and Rillet
- [x] Task 17: Add the ERP stop clock and the Complete, Invoice and Cancel guards
- [x] Task 18: Change the MES clock, New Job and My Time
- [x] Task 19: Show the missing-rate warning on both job pages
- [x] Task 20: Change the demo data
- [x] Task 21: Update the docs and rules
- [x] Task 22: Verify in the browser

## Dependencies
- Task 3 needs Tasks 1–2. Every later task needs Task 3.
- Tasks 4, 5 and 6 are independent of each other.
- Task 8 needs Tasks 6–7. Task 9 needs Task 8. Task 10 needs Tasks 5 and 8.
- Task 12 needs Task 11. Task 13 needs Task 11.
- Task 14 needs Tasks 4 and 13. Task 15 needs Tasks 4 and 11. Task 16 needs Task 14.
- Task 17 needs Tasks 9 and 11. Task 18 needs Tasks 5 and 8. Task 19 needs Tasks 5 and 11.
- Task 20 needs Tasks 8–15. Task 21 needs all code tasks. Task 22 is last.

## Ground rules for every task
- Read `.claude/rules/service-jobs.md`, `apps/erp/app/modules/service/AGENTS.md` and `.claude/rules/module-files.md` first.
- Use no JavaScript `Date` (`.claude/rules/date-handling.md`).
- Round money only with `@carbon/utils` `round` (`.claude/rules/numeric-precision.md`).
- Start every new file with its SPDX header: run `pnpm --filter @carbon/checks license-headers`.
- Never rebuild the database. Apply migrations with `pnpm db:migrate`.
- Another session may edit `ServiceJobHeader.tsx`, `ServiceJobProperties.tsx`, `apps/erp/app/utils/path.ts`, `apps/mes/app/components/WorkRecord.tsx` and `apps/mes/app/routes/x+/service.$jobId.tsx`. Read the file again just before you edit it. Keep its changes.

---

## Task 1: Add the `Labor` invoice line type (migration)

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_service-labor-invoice-line-type.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20261006220301_fleet-rental-lease-enums.sql`

**Steps:**
1. Run `pnpm db:migrate:new service-labor-invoice-line-type`.
2. Copy the header comment of the precedent. Say that the value is used by a later migration and code only.
3. Write the SQL:
   ```sql
   ALTER TYPE "salesInvoiceLineType" ADD VALUE IF NOT EXISTS 'Labor';
   ```

**Verify:**
```bash
pnpm db:migrate
# Expected: the migration applies with no error.
```

**Out of scope:** any other enum.

## Task 2: Add the rate, revenue and link columns (migration)

**Depends on:** Task 1
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_service-labor-rates.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20261023071039_service-jobs.sql` lines 334–345 (account default FK); `packages/database/supabase/migrations/20261006221301_contracts.sql` lines 307–325 (schedule link FK)

**Steps:**
1. Run `pnpm db:migrate:new service-labor-rates`.
2. Write the SQL:
   ```sql
   ALTER TABLE "companySettings"
     ADD COLUMN IF NOT EXISTS "serviceLaborCostRate" NUMERIC,
     ADD COLUMN IF NOT EXISTS "serviceLaborBillRate" NUMERIC;
   DROP INDEX IF EXISTS "companySettings_serviceLaborItemId_idx";
   ALTER TABLE "companySettings" DROP COLUMN IF EXISTS "serviceLaborItemId";

   ALTER TABLE "serviceJob" ADD COLUMN IF NOT EXISTS "laborBillRate" NUMERIC;
   ALTER TABLE "serviceJob" DROP COLUMN IF EXISTS "completionJournalId";

   ALTER TABLE "serviceJobTime" DROP COLUMN IF EXISTS "laborItemId";

   ALTER TABLE "serviceJobEstimateLine" ALTER COLUMN "itemId" DROP NOT NULL;

   ALTER TABLE "accountDefault" ADD COLUMN IF NOT EXISTS "serviceRevenueAccount" TEXT;
   ALTER TABLE "revenueRecognitionSchedule" ADD COLUMN IF NOT EXISTS "serviceJobId" TEXT;
   ```
3. Add the `serviceRevenueAccount` FK and index. Copy the `DO $$ … pg_constraint` guard of `costOfServiceAccount` in the precedent. Use `ON DELETE RESTRICT ON UPDATE CASCADE`.
4. Add the FK `("serviceJobId", "companyId") REFERENCES "serviceJob"("id", "companyId") ON DELETE SET NULL ("serviceJobId")`. Copy the guard shape of the contract line FK.
5. Add `CREATE INDEX IF NOT EXISTS "revenueRecognitionSchedule_serviceJobId_idx" ON "revenueRecognitionSchedule" ("companyId", "serviceJobId");`.
6. If a column drop fails because a view or function depends on it, STOP and report. Do not add CASCADE.

**Verify:**
```bash
pnpm db:migrate
# Expected: the migration applies with no error.
```

**Out of scope:** data backfill (the spec says no migration of existing data).

## Task 3: Regenerate types

**Depends on:** Tasks 1–2
**Files:**
- Modify: `packages/database/src/types.ts` (generated)

**Steps:**
1. Run `pnpm run generate:types`.

**Verify:**
```bash
grep -c "serviceLaborCostRate\|laborBillRate\|serviceRevenueAccount" packages/database/src/types.ts
# Expected: a number greater than 0.
grep -c "laborItemId" packages/database/src/types.ts
# Expected: 0.
```

**Out of scope:** fixing type errors (later tasks do that).

## Task 4: Add the Service Revenue account default

**Depends on:** Task 3
**Files:**
- Modify: `packages/database/src/journal-posting-status.ts` — add the role to `OPTIONAL_DEFAULT_ROLES` (72–98), `serviceRevenueAccount: "salesAccount"` to `DEFAULT_FALLBACKS` (106–113), and the label "Service Revenue" to `OPTIONAL_DEFAULT_LABELS` (126–153)
- Modify: `packages/database/src/accounting-cutover/shared.ts` — add the column to `ACCOUNT_DEFAULT_COLUMNS` (65–139)
- Modify: `packages/database/src/account-import.ts` — add "Service Revenue" to `ROLE_NAMES` (51–127)
- Modify: `apps/erp/app/modules/accounting/accounting.models.ts` — add `serviceRevenueAccount: z.string().optional()` to `defaultIncomeAcountValidator` (537–634), next to `costOfServiceAccount`
- Modify: `apps/erp/app/modules/accounting/ui/AccountDefaults/AccountDefaultsForm.tsx` — add the field in the "Sales & Revenue" group (375–436), after `salesShippingRevenueAccount`
- Copy from (precedent): the `costOfServiceAccount` entries in the same files

**Steps:**
1. Add the role, fallback and label in `journal-posting-status.ts`.
2. Add the column in the cutover list and the import role names.
3. Add the validator field and the form field. Label: "Service Revenue". Description: "Revenue from service jobs".

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database --filter=erp
# Expected: Tasks: N successful, N total (no errors in these files).
pnpm exec turbo run test --filter=@carbon/database
# Expected: all tests pass.
```

**Out of scope:** seeding a "Service Revenue" account in `seed-data.ts` (the fallback covers it).

## Task 5: Add Settings → Service

**Depends on:** Task 3
**Files:**
- Create: `apps/erp/app/routes/x+/settings+/service.tsx`
- Modify: `apps/erp/app/modules/settings/settings.models.ts` — add `serviceSettingsValidator`; delete `serviceLaborItemValidator` (285–288)
- Modify: `apps/erp/app/modules/settings/settings.server.ts` — add `updateServiceSettings` (copy `updateTimeSettings`, 702); remove the `serviceLabor` branch of `updateInvoicingSettings` (270–303)
- Modify: `apps/erp/app/modules/settings/settings.service.ts` — delete `isCompanyServiceItem` (3301)
- Modify: `apps/erp/app/routes/x+/settings+/invoicing.tsx` — delete the "Service Labor" card (277–320), its union branch (122–126), its import (53) and its toast (151–152)
- Modify: `apps/erp/app/utils/path.ts` — add `serviceSettings: \`${x}/settings/service\`` next to `timeSettings` (2775)
- Modify: `apps/erp/app/modules/settings/ui/useSettingsSubmodules.tsx` — add "Service" next to "Time" (162–166), icon `LuHeadphones`
- Copy from (precedent): `apps/erp/app/routes/x+/settings+/time.tsx`

**Steps:**
1. Write `serviceSettingsValidator`:
   ```ts
   export const serviceSettingsValidator = z.object({
     serviceLaborCostRate: zfd.numeric(z.number().min(0).optional()),
     serviceLaborBillRate: zfd.numeric(z.number().min(0).optional())
   });
   ```
2. Copy `updateTimeSettings` to `updateServiceSettings`. Permission `{ update: "settings" }`. It saves the two columns with `saveCompanySettings`. An empty field saves NULL.
3. Copy `time.tsx` to `service.tsx`. Keep one form with two `Number` fields in one `Card`: "Labor cost per hour" and "Default bill rate per hour". Use `formatOptions={INPUT_FORMAT.rate(...)}` and `step={INPUT_STEP.rate}` as the Time page uses its number inputs.
4. Add the helper text: "A new service job copies the bill rate. Each time entry posts its cost at the cost rate."
5. Remove the Service Labor card and every reference from `invoicing.tsx` and the settings files.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors in settings files. Errors in service files are fixed by later tasks.
pnpm exec biome check apps/erp/app/routes/x+/settings+ apps/erp/app/modules/settings
# Expected: Checked N files … No fixes applied.
```

**Out of scope:** the MES settings; per-employee rates.

## Task 6: Add the time reference and generalize the superseded filter

**Depends on:** Task 3
**Files:**
- Modify: `packages/database/src/utils.ts` — add `serviceJobTime: (id: string) => \`service-job-time:${id}\`` to `journalReference.to` (31–44)
- Modify: `apps/erp/app/modules/resources/resources.service.ts` — change `withoutSupersededEntries` (2428–2465) to take `expenseAccountIds: ReadonlySet<string>` instead of one account id; update its one caller in `postMaintenanceEvent`

**Steps:**
1. Add the reference after `maintenanceEvent`.
2. Change the third parameter of `withoutSupersededEntries` to a set. Replace its equality test with `set.has(...)`.
3. In `postMaintenanceEvent`, pass `new Set([maintenanceAccountId])`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database --filter=erp
# Expected: no new errors in utils.ts or resources.service.ts.
set -a; . ./.env.local; set +a; cd apps/erp && pnpm exec vitest run test/database -t "maintenance"
# Expected: every matched test passes.
```

**Out of scope:** moving the labor helpers to another module.

## Task 7: Build the time cost groups (pure)

**Depends on:** Task 6
**Files:**
- Modify: `apps/erp/app/modules/service/service-job-plan.ts` — delete `ServiceJobTimeCost` and `buildServiceJobCompletionLines` (85–139); add `buildServiceTimeCostGroups`
- Modify: `apps/erp/app/modules/service/service-job-plan.test.ts` — replace the completion-line tests
- Copy from (precedent): the desired-group build in `postMaintenanceEvent` (`resources.service.ts` 2620–2648), and `LaborGroup` / `LaborDimension` (2345–2350)

**Steps:**
1. Write the function. It returns `LaborGroup[]` (import the type from `~/modules/resources/resources.service`):
   ```ts
   export function buildServiceTimeCostGroups(args: {
     entries: { id: string; hours: number; unitCost: number }[];
     coverageAccountId: string;
     laborAbsorptionAccountId: string;
     dimensions: LaborDimension[];
   }): LaborGroup[]
   ```
2. For each entry with `round(hours × unitCost) > EPSILON`, emit two groups with `reference = journalReference.to.serviceJobTime(id)`:
   1. Debit `coverageAccountId`, description "Cost of Service".
   2. Credit `laborAbsorptionAccountId`, description "Labor Absorption".
3. Write tests: 1.5 h × 40 gives 60 / −60; 0 h gives no groups; two entries give four groups with their own references.

**Verify:**
```bash
cd apps/erp && pnpm exec vitest run app/modules/service/service-job-plan.test.ts
# Expected: all tests pass.
```

**Out of scope:** the database reconcile (Task 8).

## Task 8: Add the `post-time` reconcile

**Depends on:** Tasks 6–7
**Files:**
- Modify: `packages/api/src/postings.ts` — add `{ action: "post-time", serviceJobId }` to `postServiceJobInput` (485–508)
- Modify: `apps/erp/app/modules/service/service.service.ts` — add `reconcileServiceJobTime(trx, { companyId, serviceJobId, userId })` and the `post-time` branch in `postServiceJob` (1995–2319)
- Modify: `apps/erp/app/modules/service/service.service.ts` — add `postServiceJobTime(ctx, serviceJobId)` that runs the posting as the system and returns an error message or null
- Create: `apps/erp/test/database/post-service-job/post-time.test.ts`
- Modify: `apps/erp/test/database/fixtures/service-job.ts` — remove the labor item (26–93); set `companySettings.serviceLaborCostRate` 40 and `serviceLaborBillRate` 95; `addTime` writes no `laborItemId`
- Copy from (precedent): `postMaintenanceEvent` (`resources.service.ts` 2478–2781), `postMaintenanceLabor` (2107–2134)

**Steps:**
1. Write `reconcileServiceJobTime`. It runs inside a Kysely transaction:
   1. Lock the job with `lockServiceJob`.
   2. Read `journalPostingStatus(trx, companyId)`.
   3. Read the job's time rows where `hours > 0` and (`startTime` IS NULL or `endTime` IS NOT NULL).
   4. Read `serviceLaborCostRate`. For each row with `unitCost` NULL, set `unitCost` to it in one UPDATE. If the rate is NULL and a row needs it, throw `InvalidInputError("Set the labor cost rate in Settings → Service.")`.
   5. Resolve the coverage account with `serviceCoverageAccount` and `laborAbsorptionAccount` with `resolveDefaultAccount`.
   6. Build the desired groups with `buildServiceTimeCostGroups`. Use the Location dimension of `writeServiceJobJournal`.
   7. Read the prior lines and Superseded lines by `documentLineReference` LIKE `'service-job-time:%'` with `documentId` = the job. Copy the read in `postMaintenanceEvent` (2512–2551).
   8. Pass the prior lines through `withoutSupersededEntries` with the set {Cost of Service, Warranty Expense, COGS} account ids.
   9. Run `diffLaborGroups(desired, prior)`. If it is empty, return null.
   10. Write one journal: `sourceType 'Service Job'`, line `documentType 'Service Job'`, `documentId` = job, `documentLineReference` = the group reference. Copy the journal insert of `postMaintenanceEvent` (2687–2775). Posted → `resolveAccountingPeriod(…, "current")`.
2. Add the `post-time` branch in `postServiceJob`. It calls `reconcileServiceJobTime` and returns `{ success, serviceJobId, status, journalId }`.
3. Write `postServiceJobTime(ctx, serviceJobId)` like `postMaintenanceLabor`: invoke `post-service-job` `post-time` as the system; return the error message or null.
4. Write tests in `post-time.test.ts`:
   1. 1.5 h at rate 40 posts Cost of Service 60 / Labor Absorption −60 with the entry's reference.
   2. Edit to 2 h; reconcile posts 20 / −20.
   3. Delete the entry; reconcile posts −80 / 80.
   4. Change the company rate to 50; a posted entry stays 40; a new entry posts 50.
   5. A running clock entry posts nothing.
   6. No cost rate and an entry: the reconcile refuses with the message above.

**Verify:**
```bash
set -a; . ./.env.local; set +a; cd apps/erp && pnpm exec vitest run test/database/post-service-job/post-time.test.ts
# Expected: 6 tests pass.
```

**Out of scope:** callers (Tasks 9, 10, 17, 18).

## Task 9: Change Complete, Reopen and Set Coverage

**Depends on:** Task 8
**Files:**
- Modify: `apps/erp/app/modules/service/service.service.ts` — `complete` (2012–2153), `reopen` (2155–2228), `set-coverage` (2230–2318)
- Modify: `apps/erp/test/database/post-service-job/post-service-job.test.ts`
- Modify: `apps/erp/app/modules/service/service.server.ts` — TSDoc of `completeServiceJob` (536–546), `reopenServiceJob`, `setServiceJobCoverage`

**Steps:**
1. In `complete`, keep the status check and the running-clock refusal. Delete the cost read, the "no cost per hour" refusal, the journal write, the `unitCost` stamp and the `completionJournalId` write. Call `reconcileServiceJobTime` in the same transaction.
2. In `reopen`, delete the journal void, the `unitCost` clear and the `SERVICE_JOB_BEFORE_CUTOVER_ERROR` check. Keep the status rules and `refuseReopenOfDepartedUnit`. Delete the constant if nothing else uses it.
3. In `set-coverage`, after the parts reclass and the coverage update, call `reconcileServiceJobTime` in the same transaction.
4. Update the tests:
   1. Complete writes no `'Service Job'` journal beyond the reconcile's.
   2. Reopen writes no journal.
   3. A coverage change from Billable to Warranty moves the posted time to Warranty Expense.
   4. Delete the Superseded-completion test (line 395) and the "no cost" refusal test.

**Verify:**
```bash
set -a; . ./.env.local; set +a; cd apps/erp && pnpm exec vitest run test/database/post-service-job
# Expected: all tests pass.
```

**Out of scope:** the ERP dialog (Task 17).

## Task 10: Change the ERP time writes

**Depends on:** Tasks 5, 8
**Files:**
- Modify: `apps/erp/app/modules/service/service.models.ts` — remove `laborItemId` from `serviceJobTimeValidator` (209–222)
- Modify: `apps/erp/app/modules/service/service.server.ts` — `upsertServiceJobTime` (850–878), `deleteServiceJobTime` (884–905), `setServiceJobDayHours` (915–934)
- Modify: `apps/erp/app/modules/service/service.service.ts` — `upsertServiceJobTime` (1031–1069), `setServiceJobDayHours` (1097–1197), `getServiceJobTime` (370–380)
- Modify: `apps/erp/app/modules/service/ui/ServiceJob/ServiceJobTimeForm.tsx` — remove the labor item field (89–94)
- Modify: `apps/erp/app/routes/x+/service-job+/$jobId.time.new.tsx` (18–24, 43, 55), `$jobId.time.$timeId.tsx` (49)
- Modify: `apps/erp/test/database/post-service-job/set-service-job-day-hours.test.ts`
- Copy from (precedent): `deleteMaintenanceEvent` (`resources.server.ts` 1046–1072)

**Steps:**
1. Remove `laborItemId` from the validator, the form, the routes, `getServiceJobTime` and the inserts.
2. In each operation, refuse when `serviceLaborCostRate` is NULL: `"Set the labor cost rate in Settings → Service."`.
3. `upsertServiceJobTime` and `deleteServiceJobTime`: after the write, call `postServiceJobTime(ctx, serviceJobId)`. Return `{ ..., warning }` with its message when it fails.
4. `setServiceJobDayHours`: call `reconcileServiceJobTime(trx, …)` inside its transaction, after the write.
5. Make the ERP time routes show `warning` with `toast.warning`, as the maintenance routes do.
6. Update the day-hours test: no labor item; a saved day posts its cost.

**Verify:**
```bash
set -a; . ./.env.local; set +a; cd apps/erp && pnpm exec vitest run test/database/post-service-job
# Expected: all tests pass.
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors in service time files.
```

**Out of scope:** MES writes (Task 18).

## Task 11: Add the job bill rate and fixed price

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/modules/service/service.models.ts` — add `"laborBillRate"` and `"fixedPrice"` to `serviceJobUpdateFields` (170–186)
- Modify: `apps/erp/app/modules/service/service.service.ts` — `serviceJobFieldValues` (861–964), `ServiceJobHeaderUpdate` (709–729), `insertServiceJob` (544–622)
- Modify: `apps/erp/app/modules/service/service.server.ts` — `updateServiceJob` (400–462): select `estimateStatus`, `billingMethod`; `createServiceJob` (298–381)
- Modify: `apps/erp/app/modules/inventory/receipt-service-return.ts` — job insert (138–167)
- Modify: `apps/erp/app/modules/service/ui/ServiceJob/ServiceJobProperties.tsx` — add Bill Rate and Fixed Price fields
- Create: `apps/erp/test/database/post-service-job/labor-bill-rate.test.ts`
- Copy from (precedent): the inline `NumberControlled` field in `apps/erp/app/modules/production/ui/Jobs/JobProperties.tsx` (435–476)

**Steps:**
1. `insertServiceJob` and the RMA receipt insert copy `companySettings.serviceLaborBillRate` into `laborBillRate`.
2. In `serviceJobFieldValues`, parse both fields as numbers ≥ 0, or NULL when empty.
3. In `updateServiceJob`, refuse `laborBillRate` when `estimateStatus` is `Sent` or `Accepted`: `"The bill rate is locked: the estimate was sent to the customer."`. Refuse `fixedPrice` unless `billingMethod` is `Fixed Price`.
4. When `laborBillRate` changes, update it and set `unitPrice` on the job's estimate lines with `itemId IS NULL`, in one Kysely transaction on `ctx.asSystem.pg`.
5. In `ServiceJobProperties.tsx`, add "Bill Rate" (per hour, Rate kind). Make it read-only with the lock reason as helper text when the estimate is Sent or Accepted.
6. Add "Fixed Price" (Money kind), shown only when the billing method is Fixed Price.
7. Write tests: a new job copies 95; a change to 110 updates a Labor estimate line; a change after Send is refused.

**Verify:**
```bash
set -a; . ./.env.local; set +a; cd apps/erp && pnpm exec vitest run test/database/post-service-job/labor-bill-rate.test.ts
# Expected: 3 tests pass.
```

**Out of scope:** MES New Job (Task 18).

## Task 12: Add the Labor estimate line

**Depends on:** Task 11
**Files:**
- Modify: `apps/erp/app/modules/service/service.models.ts` — `serviceJobEstimateLineValidator` (195–207): `itemId` optional
- Modify: `apps/erp/app/modules/service/service.server.ts` — `upsertServiceJobEstimateLine` (639–664): skip `refuseUnlessOwned` when `itemId` is empty; a Labor line takes `unitPrice` = the job's `laborBillRate`
- Modify: `apps/erp/app/modules/service/ui/ServiceJob/ServiceJobEstimateLineForm.tsx` — a "Labor" / "Item" choice
- Modify: `apps/erp/app/modules/service/ui/ServiceJob/ServiceJobExplorer.tsx` — label a Labor line "Labor" (507–508)
- Modify: `apps/erp/app/routes/file+/service-job-estimate+/$id[.]pdf.tsx` (103–108), `packages/documents/src/pdf/ServiceJobEstimatePDF.tsx` (128–139)
- Copy from (precedent): the `ToggleGroup` in `apps/erp/app/modules/service/ui/ServiceJob/ServiceJobNotes.tsx` (the Repairable control)

**Steps:**
1. Add a Labor / Item toggle at the top of the form. Labor hides the item picker and the price, and shows "Hours".
2. Show the rate as read-only text: "At <bill rate> per hour (the job's bill rate)".
3. In the operation, a line without `itemId` takes `unitPrice` from the job. Refuse it when the job has no `laborBillRate`: `"Set the job's bill rate first."`.
4. In the explorer and the PDF, a line without an item reads "Labor" (or its description), with hours × rate.
5. In `recordServiceJobEstimateResponse` (773–836), keep the total as Σ quantity × `unitPrice`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/documents
# Expected: no errors in estimate files.
```

**Out of scope:** the invoice (Task 13).

## Task 13: Bill labor on one Labor invoice line

**Depends on:** Task 11
**Files:**
- Modify: `apps/erp/app/modules/service/service-job-invoice-plan.ts` (34–42, 55–62, 103–128)
- Modify: `apps/erp/app/modules/service/service-job-invoice-plan.test.ts`
- Modify: `apps/erp/app/modules/service/service.service.ts` — `createServiceInvoice` time read (2391–2427), insert (2570–2591)
- Modify: `apps/erp/test/database/create-service-invoice/create-service-invoice.test.ts`

**Steps:**
1. Replace the per-labor-item lines with one line: `invoiceLineType 'Labor'`, `itemId` null, `description "Labor"`, `quantity` = Σ billable hours, `unitPrice` = the job's `laborBillRate`, `unitOfMeasureCode` null.
2. Refuse a T&M job with billable hours and no `laborBillRate`: `"Set the job's bill rate first."`.
3. Change the Fixed Price refusal text at 85–89 to `"Set the job's fixed price first."`.
4. Update the tests: 3 billable hours at 95 give one Labor line of 285.

**Verify:**
```bash
cd apps/erp && pnpm exec vitest run app/modules/service/service-job-invoice-plan.test.ts
# Expected: all tests pass.
set -a; . ./.env.local; set +a; pnpm exec vitest run test/database/create-service-invoice
# Expected: all tests pass.
```

**Out of scope:** invoice posting (Task 14).

## Task 14: Post service job invoices to Service Revenue and clear accruals

**Depends on:** Tasks 4, 13
**Files:**
- Modify: `packages/database/src/sales-posting-amounts.ts` — add `'Labor'` to the type list (337–350)
- Modify: `apps/erp/app/modules/invoicing/invoicing.service.ts` — `postingAccountNeeds` (6955–6982), `planSalesInvoiceAccounts` (6548–6651), `resolveSalesInvoiceAccounts` (6672–6806), `postingLineRevenue` (6933–6943), `postSalesInvoice` accrual load (8613–8636) and revenue closure (8744–8765), stamp (9169–9198), void (9482+, 9528, 9715–9726), intercompany `revenueAccountIds` (9256–9259)
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — `buildLegacySalesInvoiceJournals` (19572, 19755–19775): map `'Labor'` to `"sales"`
- Modify: `apps/erp/app/modules/invoicing/invoicing.models.ts` (48–57, 374), `ui/SalesInvoice/SalesInvoiceLineForm.tsx` (113–120, 173–175), `SalesInvoiceExplorer.tsx` (255–300), `SalesInvoiceSummary.tsx` (81–86, 223–224), `apps/erp/app/routes/x+/sales-invoice+/$invoiceId.$lineId.details.tsx` (80), `packages/documents/src/utils/sales-invoice.ts` (11–36)
- Create: `apps/erp/test/database/post-sales-invoice/service-job-posting.test.ts`
- Copy from (precedent): `planRentalLine` relief (7819–7861) and its stamp (9169–9198); `apps/erp/test/database/post-sales-invoice/rental-posting.test.ts`

**Steps:**
1. Add `serviceJob: boolean` to `postingAccountNeeds`: true when any line has `serviceJobId`.
2. When `needs.serviceJob`, resolve `serviceRevenueAccount` (with its fallback) and read `contractAssetAccount` in the plan. Expose `serviceRevenue` in `charges()`.
3. Load the unbilled service Accrual rows: `type 'Accrual'`, `serviceJobId` IN the invoice's jobs, `billedBySalesInvoiceLineId IS NULL`, any status.
4. Spread the job's unbilled accrual over the job's invoice lines, in sort order. Each line takes min(accrual left, its revenue). For each line with `serviceJobId`, return `{ book: "legs", legs }`:
   1. A Contract Assets leg (`accountClass "Asset"`, `description "Contract Assets"`, `amount` = the line's share), when the share is not 0.
   2. A Service Revenue leg (`accountClass "Revenue"`, `description "Service Revenue"`) for the remainder.
5. If accrual is left after the last line of the job, write reclass lines outside the builder: Cr Contract Assets / Dr Service Revenue for that excess. Copy the `reclass` lines of `planContractInvoiceLine`. (Correction 2026-11-01: `buildSalesPostingLines` refuses a leg larger than its line, so the whole accrual cannot sit on one line.)
6. Stamp the job's accrual rows with the job's first line id. Copy the CASE UPDATE and its count check.
7. In the void, clear the stamp for the voided lines.
8. Add `'Labor'` to the line-type lists and UI branches. A Labor line shows "Labor" and has no item link.
9. Write tests:
   1. A Labor line of 285 with no accrual: Cr Service Revenue 285.
   2. Accrued 285, invoice 380: Cr Contract Assets 285, Cr Service Revenue 95; the rows are stamped.
   3. Accrued 400, invoice 380: Cr Contract Assets 400, Dr Service Revenue 20.
   4. Void clears the stamp.
   5. No `serviceRevenueAccount`: the credit goes to the sales account.

**Verify:**
```bash
set -a; . ./.env.local; set +a; cd apps/erp && pnpm exec vitest run test/database/post-sales-invoice
# Expected: all tests pass, including service-job-posting.test.ts.
pnpm exec turbo run test --filter=@carbon/database
# Expected: all tests pass.
```

**Out of scope:** sync (Task 16).

## Task 15: Accrue service revenue in the revenue recognition run

**Depends on:** Tasks 4, 11
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — add `synthesizeServiceJobRevenue` after `synthesizeRentalAccruals` (22028–22190); add it to the revenue run list in `runRowSynthesizers` (22439); select `serviceJobId` in `postRevenueRecognitionRun` (11009–11024) and load the jobs into `RecognitionSources` (11265–11271); add `serviceJobId` to `getRevenueRecognitionRunLines` (7984–8004)
- Modify: `packages/database/src/run-journals.ts` — add `serviceJobId` to `RecognitionScheduleRow` (379–395), a `serviceJobs` map to `RecognitionSources` (398–434), a `'Service Job'` branch in `recognitionSource` (461–535), and service accrual descriptions to `REVENUE_LINE_DESCRIPTIONS` (316–341)
- Modify: `apps/erp/test/database/propose-revenue-recognition-run/synthesizer-order.test.ts` (37–77)
- Create: `apps/erp/test/database/propose-revenue-recognition-run/service-job-revenue.test.ts`
- Modify: `packages/database/src/run-journals.test.ts` (359–432)
- Copy from (precedent): `synthesizeRentalAccruals`; `apps/erp/test/database/post-shipment/rental-agreement.test.ts` (225–306)

**Steps:**
1. Write `synthesizeServiceJobRevenue(trx, ctx)`:
   1. Take `lockRecognitionProposals`.
   2. Read Billable jobs not Cancelled, created on or before `periodEnd`, with no invoice or an invoice in Draft or Pending.
   3. Compute earned to date per the spec's table (section 3). Use entries with `entryDate <= periodEnd`, `billable = true`, closed. Parts and Charges are `serviceJobItem` rows with `unitPrice`, `billable`, created on or before `periodEnd`.
   4. Fixed Price: labor hours = Σ `quantity` of the estimate lines with `itemId IS NULL` when `estimateStatus = 'Accepted'`.
   5. Subtract Σ `amount` of the job's Accrual rows with `billedBySalesInvoiceLineId IS NULL`.
   6. Round the difference with `round`. Skip it when `|difference| < EPSILON`.
   7. Read `contractAssetAccount` and `serviceRevenueAccount` (with the fallback). If `contractAssetAccount` is empty and a row is needed, throw `"Set the Contract Assets account default before recognizing service revenue."`.
   8. Insert one row: `type 'Accrual'`, `status 'Planned'`, `serviceJobId`, `periodStart` = the first day of the month, `periodEnd`, `scheduledDate` = `periodEnd`, `amount`, `debitAccountId` = Contract Assets, `creditAccountId` = Service Revenue.
2. Append it to the revenue run list.
3. Add the `'Service Job'` source: `documentType 'Service Job'`, `documentId` = the job, dimensions Customer and Location.
4. Add the descriptions: "Unbilled service accrued" / "Service revenue accrued".
5. Write tests:
   1. 3 billable hours at 95: a 285 row.
   2. A second run with one more hour: a 95 row.
   3. One hour deleted before the second run: a −95 row.
   4. Fixed Price 1,000, estimate 10 labor hours, 4 h logged: a 400 row.
   5. A Warranty job: no row.
   6. A job with a posted invoice: no row.
6. Update the synthesizer-order test.

**Verify:**
```bash
set -a; . ./.env.local; set +a; cd apps/erp && pnpm exec vitest run test/database/propose-revenue-recognition-run test/database/preview-revenue-recognition-run test/database/recalculate-revenue-recognition-run
# Expected: all tests pass.
pnpm exec turbo run test --filter=@carbon/database
# Expected: all tests pass.
```

**Out of scope:** the monthly proposal job (it calls the same list).

## Task 16: Sync Service Revenue to QuickBooks, Xero and Rillet

**Depends on:** Task 14
**Files:**
- Modify: `packages/database/src/accounting-posting.ts` — `classifyAccountingPostingRole` (93–118): "Service Revenue" → `ServiceRevenue`
- Modify: `packages/ee/src/accounting/core/sales-invoice-source.ts` — `loadSalesInvoices` (~87, 133, 159–201, 251): select the line's `serviceJobId`; resolve a `serviceRevenueAccountId` like `salesRevenueAccountId`
- Modify: `packages/ee/src/accounting/core/sales-document-components.ts` — carry `serviceJobId` on each component
- Modify: `packages/ee/src/accounting/providers/quickbooks-online/entities/invoice.ts` (93–145, 359–373), `providers/xero/entities/invoice.ts` (76–130, 153–174, 303–318), `providers/rillet/entities/invoice.ts` (349–372)
- Modify: the provider and core tests next to those files
- Copy from (precedent): the existing `salesRevenueAccountId` path in each file

**Steps:**
1. Add the `ServiceRevenue` role.
2. In the loader, keep one account per role. Return `serviceRevenueAccountId` when the invoice has Service Revenue lines.
3. Ignore Contract Assets lines in the loader: they are not revenue for sync. The run journals that create them do not sync.
4. QuickBooks: `ensureSalesItem({ revenueAccountId: serviceRevenueAccountId })` for components with `serviceJobId`.
5. Xero: the account code of `serviceRevenueAccountId` for those components.
6. Rillet: `ensureSalesProduct` with the service account for those components.
7. If a provider cannot set a per-line account, STOP and report.
8. Add a test per provider: a service job invoice maps its lines to the service account; a part invoice maps to the sales account.

**Verify:**
```bash
pnpm exec turbo run test --filter=@carbon/ee --filter=@carbon/database
# Expected: all tests pass.
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: no errors.
```

**Out of scope:** syncing revenue recognition run journals.

## Task 17: Add the ERP stop clock and the Complete, Invoice and Cancel guards

**Depends on:** Tasks 9, 11
**Files:**
- Modify: `apps/erp/app/modules/service/service.server.ts`, `service.service.ts` — add `stopServiceJobClock({ serviceJobId })`
- Create: `apps/erp/app/routes/x+/service-job+/$jobId.stop-clock.tsx`
- Modify: `apps/erp/app/utils/path.ts` — add `serviceJobStopClock(id)` next to `serviceJobComplete`
- Modify: `apps/erp/app/routes/x+/service-job+/$jobId.complete.tsx`, `$jobId.invoice.tsx` — accept an optional `fixedPrice` and save it before the action
- Modify: `apps/erp/app/modules/service/ui/ServiceJob/ServiceJobHeader.tsx` — Complete (219–235) and Invoice (247–262) open a confirm modal; Cancel (188–195) is disabled with a reason
- Copy from (precedent): MES `stopServiceClock` (`apps/mes/app/services/service.service.ts` 317–348); the Cancel modal in `ServiceJobHeader.tsx` (289–331)

**Steps:**
1. Write `stopServiceJobClock`: permission `{ update: "service" }`. Stop every running clock on the job: `endTime` now, `hours` = `clockHours`, `entryDate` = the business day of the start. Then call `postServiceJobTime`.
2. Complete opens a modal:
   1. With a running clock: the text "A clock is still running on this job." and the button **Stop clock and complete**. It posts to the stop-clock route, then to the complete route.
   2. On a Fixed Price job with no `fixedPrice`: a required "Fixed price" Money field. Submit saves it, then completes.
3. Create Invoice on a Fixed Price job with no `fixedPrice` asks for the price the same way.
4. Disable Cancel when the loader's `time` or Part `items` are not empty. Show a tooltip: "Remove the time entries and return the parts first."

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors.
pnpm exec biome check apps/erp/app/modules/service apps/erp/app/routes/x+/service-job+
# Expected: No fixes applied.
```

**Out of scope:** the MES Complete (it already stops the clock).

## Task 18: Change the MES clock, New Job and My Time

**Depends on:** Tasks 5, 8
**Files:**
- Modify: `apps/mes/app/services/service.service.ts` — delete `getDefaultLaborItemId` (211–221); `startServiceClock` (272–303) writes no `laborItemId`; `saveServiceDayHours` insert (626–637); `insertServiceJob` (151–208) copies `serviceLaborBillRate`; the time select (122) drops the labor item; add `postServiceJobTime(client, { companyId, userId, serviceJobId })` through `erpPosting`
- Modify: `apps/mes/app/routes/x+/service-time.tsx` (16, 93–110, Stop), `apps/mes/app/routes/x+/service.new.tsx` (18, 55–98, 138), `apps/mes/app/routes/x+/timesheet.tsx` (service-cell action), `apps/mes/app/routes/x+/service.$jobId.tsx` (the labor item name in Time Entries)
- Copy from (precedent): `postMaintenanceLabor` call in `apps/mes/app/services/maintenance.service.ts` (176–185) and `apps/mes/app/routes/x+/maintenance-event.tsx` (163, 222)

**Steps:**
1. Start and New Job refuse when `serviceLaborCostRate` is NULL. The flash message: "Set the labor cost rate in Settings → Service." Add a link to the ERP settings page with `path.to.external` if one exists for settings; otherwise the message alone.
2. After Stop and after `saveServiceDayHours`, call `postServiceJobTime`. Show a warning toast when it fails.
3. Remove every labor item reference.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: no errors.
pnpm --filter mes test
# Expected: all tests pass.
```

**Out of scope:** the MES layout.

## Task 19: Show the missing-rate warning on both job pages

**Depends on:** Tasks 5, 11
**Files:**
- Modify: `apps/erp/app/routes/x+/service-job+/$jobId.tsx` — the loader reads `serviceLaborCostRate`; render the warning directly under `<ServiceJobHeader />`
- Modify: `apps/mes/app/routes/x+/service.$jobId.tsx` — the loader reads the cost rate; show the warning at the top of the Details pane
- Copy from (precedent): `Alert` from `@carbon/react` as the batch scope banner in `apps/mes/app/components/JobOperation/JobOperation.tsx` uses it

**Steps:**
1. Show an `Alert` (variant warning) when the cost rate is NULL or the job's `laborBillRate` is NULL and the job is Billable.
2. Text: "Labor rates are not set. Time cannot be logged or billed until they are." Link: "Set rates" to Settings → Service (ERP path; in the MES, the ERP URL).
3. Hide it on a locked job.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=mes
# Expected: no errors.
```

**Out of scope:** other pages.

## Task 20: Change the demo data

**Depends on:** Tasks 8–15
**Files:**
- Modify: `packages/database/src/datasets/types.ts` — `SalesData.serviceLaborItem` (1047–1052) becomes `serviceLaborRates: { cost: number; bill: number }`; `ServiceJobLineSpec.item` (968–973) becomes optional
- Modify: `packages/database/src/datasets/tiers/04-sales.ts` — settings (77–97), `seedServiceJobs` (983–1116), `insertServiceInvoice` (1199–1309)
- Modify: `packages/database/src/datasets/helpers/post-documents.ts` (720–846), `helpers/posting-journals.ts` (542–580), `tiers/09-accounting.ts` (247)
- Modify: `packages/database/src/datasets/validate.ts` (2392–2665)
- Modify: `packages/database/src/datasets/data/{motor,satellite,robotics,precision}/sales.ts` and `items.ts` (the labor items)

**Steps:**
1. Replace each dataset's labor item with rates: motor 58 / 135, satellite 95 / 225, robotics 72 / 165, precision 54 / 125.
2. Tier 04 writes the two settings, copies the bill rate into each job, writes `unitCost` on every closed entry, and writes Labor estimate lines without an item.
3. Tier 04 invoices write one Labor line.
4. Tier 09 writes one Posted `'Service Job'` journal per closed entry with its `documentLineReference`, dated on the entry's day. It writes no completion journal.
5. Change the validator: no labor item checks; a closed entry on or after `OPEN_PERIOD_MIN_OFFSET`; each entry journal balances.
6. If a coverage floor in `coverage.ts` fails, measure the new count and lower the floor in the same change.

**Verify:**
```bash
pnpm db:check:datasets
# Expected: all four datasets pass both layers.
```

**Out of scope:** seeding revenue recognition runs.

## Task 21: Update the docs and rules

**Depends on:** Tasks 1–20
**Files:**
- Modify: `.claude/rules/service-jobs.md` — Labor items, Postings, the estimate, invoicing, MES clock
- Modify: `apps/erp/app/modules/service/AGENTS.md`, `apps/erp/app/modules/accounting/AGENTS.md` (revenue recognition sources)
- Modify: `docs/content/docs/reference/service-jobs.mdx` (29, 40, 51, 72, 139), `rmas.mdx`
- Modify: `.ai/specs/2026-10-31-service-labor-rates-and-time-posting.md` — Status `in-progress`, changelog

**Steps:**
1. Replace every labor-item and post-at-completion statement with the new rules.
2. Add the revenue recognition source to the accounting AGENTS.md list.

**Verify:**
```bash
grep -rn "laborItemId\|serviceLaborItemId\|completionJournalId\|labor item" .claude/rules apps/erp/app/modules/*/AGENTS.md docs/content/docs/reference | head
# Expected: no output.
```

**Out of scope:** changelog entries.

## Task 22: Verify in the browser

**Depends on:** Tasks 1–21
**Files:** none

**Steps:**
1. Run `/test` against the spec's Acceptance Criteria.
2. Cover: Settings → Service, the job bill rate and its lock, the Labor estimate line and PDF, the MES clock posting, the revenue recognition run proposal, the invoice post, the Complete dialog, Cancel disabled, and the warning.

**Verify:**
```bash
# /test writes its report; every acceptance criterion reads PASS.
```

**Out of scope:** accounting sync against live QuickBooks or Xero (covered by Task 16 tests).
