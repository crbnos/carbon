# An employee's Job page cannot save outside DCAA timekeeping

People → employee → Job: Save does nothing and shows no message. This happens when the company does not use DCAA timekeeping and the employee's Officer flag is off. It also happens when the company has no labor category and the employee's Timesheet Required flag is off.

Cause: `PersonJob` posts each hidden flag as a `Hidden` field with the value `"on"` or `""`. `employeeJobValidator` reads both flags with `zfd.checkbox().optional()`, which refuses `""`. `ValidatedForm` validates the post in the browser, so the save stops on a field that the user cannot see. #2003 (f62fb04667f) added the hidden flags.

Scope: the Job form and its hidden fields. No schema change. No user-facing text changes.

- [x] Reproduce the validator result. `zfd.checkbox().optional()` refuses `""`, gives `true` for `"on"` and gives `undefined` for a missing field.
- [x] Move the hidden fields into `employeeJobHiddenFields` in `people.utils.ts`. The function returns the name and value of each field that the form posts without showing it.
- [x] Post a hidden flag as `"on"` when it is on. Leave the field out when it is off.
- [x] Keep Labor Category and FLSA Status as they were: each posts its saved value, or `""`.
- [x] Make `PersonJob` render one `Hidden` for each entry that `employeeJobHiddenFields` returns.
- [x] Correct the comment in the `$personId.job.tsx` action. The form does not always show both switches. The action reads a missing flag as off, and a hidden flag is missing only when it is off.
- [x] Add `people.utils.test.ts` with 4 cases: Officer off, Timesheet Required off, both flags on, and both groups shown.
- [x] Prove red then green. With the old mapping (`value ? "on" : ""`, always posted), the 2 "off" cases fail. With the fix, all 4 cases pass.
- [x] Look for the same pattern in other forms. List each `Hidden` field whose name is a `zfd.checkbox()` field, and each `Hidden` value made from a boolean.
- [x] Update `apps/erp/app/modules/people/AGENTS.md` and `.ai/lessons.md`.

Result of the search: no other form posts `""` for a `zfd.checkbox()` field.

| Form | Field | Why it is safe |
|---|---|---|
| `QuoteFinalizeModal`, `PriceOverrideForm`, `TimesheetChangeModal`, `WorkCenterForm`, `UnitOfMeasureForm` | a checkbox field | each posts `"on"` |
| `settings+/projects.tsx` | `enabled` | the action reads `=== "true"`, not `zfd.checkbox()` |
| `Suggestion`, `QuoteBillOfMaterial`, `StockTransferLineForm`, `InventoryStorageUnits`, `TrainingExplorer` | `"true"` / `"false"` values | each validator reads the text and compares it with `"true"` |
| `UserAttributesForm` (file), MES `Step` | `value` | a text field in that form's validator |
