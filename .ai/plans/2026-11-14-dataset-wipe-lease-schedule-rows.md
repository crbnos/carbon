# Dataset wipe: delete lessee lease schedule rows before the FK-nulling pass

## Context

- Once a company has an activated lessee lease, every dataset re-apply (Settings → Demo
  Data, `db:seed:dev`) fails with `revenueRecognitionSchedule_lease_pairing_check`
  (migration `20261012191455`: `leaseId` and `leaseScheduleLineId` both set or both null).
- `wipeCompanyBusinessData` (`packages/database/src/datasets/wipe.ts`) nulls one nullable
  foreign key per statement, so the first of the pair it nulls trips the CHECK.
- Deleting the schedule rows before that pass is not enough once a lease run exists:
  `revenueRecognitionRunLine.scheduleId` is NOT NULL with ON DELETE RESTRICT
  (`20261006220201`), so the run must go first. Its lines cascade from it.
- `db:check:datasets` cannot catch it: no dataset seeds a lessee lease or any
  `revenueRecognitionSchedule` row.

## Approach

- Add `revenueRecognitionRun`, then `revenueRecognitionSchedule`, to `PARENT_CHECK_TABLES`.
- Add `Lease` and `Lease Run` to `DOCUMENT_JOURNAL_SOURCES`, and add `lease` to the
  document match in `reverseDocumentJournals`. Then the wipe voids the lease's posted
  journals before it deletes the lease.
- Widen the list's comment and the two rules (`conventions-database.md`,
  `onboarding-company-templates.md`) to both-or-neither pairings and to tables only the app
  writes.
- Extend the existing lesson in `.ai/lessons.md`.

## Out of scope

Same failure shape, not seeded, left for follow-ups: `receiptFixedAssetLine_source_check`,
`customerItemRentalRate_scope_check`, `customerContractLaborRate_subject_check`,
`projectBillableItem_source_check`, `indirectExpenseStatement_source_check`.

## Tasks

- [x] `wipe.ts`: the two list entries.
- [x] `wipe-check-tables.test.ts`: a database case with an activated lease, its schedule
  row and a posted lease run, in the `metric-company.test.ts` harness (skips without
  `SUPABASE_DB_URL`).
- [x] Rules and lesson.
- [x] Run the database test against a local stack, with the mutation check.
