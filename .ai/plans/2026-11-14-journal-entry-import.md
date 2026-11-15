# Journal entry CSV import — implementation plan

**Spec:** .ai/specs/2026-11-14-journal-entry-import.md
**Closest sibling:** the payroll totals import (file shape, pure reader), the manual journal entry (write path), the trial balance CSV (amounts, accounts).
**Branch:** `feat/journal-entry-import`

## Progress

- [x] Task 1: Read how the latest import types were added (`git log` on `imports.models.ts`: payroll totals in #2003, opening stock in 784666c528). Confirmed: `fieldMappings`, `importSchemas`, `importPermissions` (+ `importRequiresCreate`), the `importCsvInput` enum, one `importCsvTable` case, and the list's `importCSV` prop.
- [x] Task 2: Read the manual journal entry: `createJournalEntry` (Draft from the sequence), `saveJournalEntry` (one-sided line rule), `saveJournalEntryWithLines` (RPC `save_journal_entry_lines`, dimensions per line), `postJournalEntry` (cutover, balance, `getOrCreateAccountingPeriod(…, "accounting")`). Lines carry no currency.
- [x] Task 3: Models: the `journalEntry` fields and schema, `journalEntryImportStatuses`, `dimensionFetcher`, permission `accounting`, `importRequiresCreate`.
- [x] Task 4: `journal-entry-import.ts`: `readJournalEntryRow`, `planJournalEntryImport`, the lookups reader (one read per table), `importJournalEntries`.
- [x] Task 5: `importCsvInput` enum and the `importCsvTable` case.
- [x] Task 6: `JournalEntriesTable` `importCSV`, gated on create and update accounting.
- [x] Task 7: Tests: `shared.journal-entry-import.test.ts` (row parsing, grouping, balance, unknown account, Closed and Locked periods, cutover, re-import, dimensions).
- [x] Task 8: Docs (`import-export.mdx`, `accounting.mdx`), rule (`csv-import-system.md`), accounting `AGENTS.md`.
- [x] Task 9: Lingui extract, Biome, scoped typecheck and tests.
- [ ] Task 10: Live check on a stack (not available to this build): import a file as Draft, as Posted, into a Closed period, and again.

## Addendum 2026-11-15

- [x] Task 11: Rebase onto `origin/main` (clean, no conflicts).
- [x] Task 12: Ask for Dimension N only when Dimension N Value is mapped: `enumData.askWhenMapped` on the `dimensionN` fields, `isEnumStepAsked` (`ImportCSVModal/enumSteps.ts`) in `FieldMappings`, skipped steps send no enum mapping. Tests in `enumSteps.test.ts`, `imports.models.test.ts` and `shared.journal-entry-import.test.ts`; rule, docs and spec updated.
