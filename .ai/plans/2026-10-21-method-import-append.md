# Method import: append to existing methods

The BOM, Operations and Parts with Methods CSV imports (`importMethods`,
`apps/erp/app/modules/shared/shared.service.ts`) write a make method version
only when it has no materials and no operations. So a file cannot add BOM lines
or a bill of process to a part that already has a BOM. If a user imports a BOM
and then imports Operations for the same parts, the second import skips every
part.

This change makes the import append to the target version. The import becomes
the bulk form of the add buttons in the BOM and Bill of Process editors. A
re-run of a file stays safe: the import skips and reports the lines and
operations that are already on the target version.

## Behavior

- Target version
  - Explicit Make Method Version: that version. The import creates it as a
    Draft when it does not exist (unchanged).
  - Blank: the highest non-archived version. Before this change, blank
    preferred the Active version, which the editors never change.
- Refusals. The import checks these per part before it writes. A refused part
  gets one error and writes nothing. Other parts continue.
  - The target version is not a Draft. The editors are read-only on any other
    status (`BillOfMaterial.tsx`, `BillOfProcess.tsx`:
    `makeMethod.status !== "Draft"`).
  - The target version belongs to a change notice whose engineering content is
    locked. `checkRevisionLock` applies the same check
    (`getChangeNoticeEngineeringLock`) to every BOM and BOP mutation route.
  - The item is a released (Production) revision and `plmReleaseControl` is
    `enforce` (`getLockVerdict`).
- BOM lines
  - The import orders new lines after the highest existing line
    (`max(order) + 1`, as `onAddItem` in `BillOfMaterial.tsx`).
  - The import skips and reports a line whose material item is already on the
    target version. Lines repeated inside one file are all written (unchanged).
- Operations
  - An Op No equal to the order of an existing operation refers to that
    operation. The import skips and reports the BOP row. STEP, TOOL and PARAM
    rows with that Op No attach to the existing operation.
  - If two existing operations have that order, the row is an error.
  - A new numeric Op No becomes the order of the new operation (unchanged).
  - A new non-numeric Op No goes after the highest existing or assigned order.
  - A STEP, TOOL or PARAM row can reference an existing operation with no BOP
    row in the file.
- Steps, tools and parameters on an existing operation
  - The import skips and reports a step with the same name, a tool with the
    same tool item, and a parameter with the same key.
  - The import sorts new steps after the highest existing step.
- Counts: a part counts as inserted (new part) or updated (existing part) when
  the import writes at least one row for it. Each skipped line is listed.
  `added` gives the rows written by kind, and the results dialog and the toast
  show it.

## Out of scope

- Updates to existing lines (quantity, unit, times) and deletes.
- A new version that copies another version.
- The other findings from the PR #911 review: same-file sub-assembly order,
  Unique ID not written by Parts with Methods, and the unused Supplier Process
  column.

## Hardening after a break-it pass

An adversarial pass on the local stack found these problems. Each fix makes the
import match the BOM and Bill of Process editors.

| Problem | Fix |
|---|---|
| Two imports of one file at the same time wrote every line twice. | `writeGroup` locks the target `makeMethod` row before it reads the lines. |
| A BOM line with no unit was stored in `EA`, even for a material stocked in yards. | The line takes the material's unit, as the BOM editor does. |
| A service or a tool was accepted as a BOM line, a part as a tool, and the part as its own line. | The import refuses them, as the editors' validators and item pickers do. |
| A negative quantity, time or cost, a tool quantity of 0, a step max below its min and an empty List step were accepted. | The import refuses them with the editors' rules. |
| A blank Operation Type became Process and a blank description stayed empty. | They take the process's type and name. The wizard no longer presets Process. |
| An Inspection operation was created with no Inspection Plan, which the editor never allows. | The import refuses Inspection operations. |
| A non-numeric Make Method Version became version 1. | The import refuses it. |
| `customFields` was null where the editors write `{}`. | The import writes `{}`. |
| CodeRabbit: a non-numeric Op No never matched an existing operation, so a re-run added it again, and its fallback order could collide with a numeric Op No. | Op No must be a number. Op Nos compare by value. |
| CodeRabbit: the change notice approval check ran a separate request while a part's transaction was open. | The import reads every change notice lock before any transaction. |
| CodeRabbit: the status check read the version before the row lock, so a Draft activated in that gap was still written. | The refusals read the locked row. |
| CodeRabbit: two imports that created the same new version at once both inserted it, and the second failed on the unique constraint. | `writeGroup` locks the part's item row (`FOR NO KEY UPDATE`) before it reads the versions. |
| CodeRabbit: a PART row for a part that exists counted it as inserted. | A PART row counts as inserted only when it created the part. For an existing part it is listed as skipped. |
| CodeRabbit: the toast dropped the skipped count when rows also needed fixing. | The toast gives both counts. |
| The BOM wizard preset EA as the Unit of Measure, so a blank unit never reached the import's fallback to the material's unit. | The wizard presets no BOM unit. |
| The results said "4 updated" for 4 parts and 6 BOM lines, and counted skipped rows in the same sentence. | Method imports also return the rows added by kind (`added`). The results dialog and the toast name the parts, then the rows. |

The parity test (`method-import-parity.test.ts`) and the guards test
(`method-import-guards.test.ts`) pin the fixes.

Open for a decision: the method imports need only `update: parts`, but the
editors' create routes need `create: parts`.

## Steps

- [x] Export `getChangeNoticeEngineeringLock` from `items.service.ts`.
- [x] `importMethods`: load `plmReleaseControl` once; add `revisionStatus` to the
      item lookup.
- [x] `writeGroup`: replace the fill-if-empty gate with target resolution,
      refusals, existing-state reads and append writes.
- [x] Move the STEP/TOOL/PARAM Op No check from the pure validation into the
      transaction, where existing operations are known.
- [x] Pure helpers for the append decisions, with unit tests.
- [x] Database test (`apps/erp/test/database/method-import-append.test.ts`, 6 cases, pass on the local stack): append BOM lines, add
      operations to a part with a BOM, attach steps to an existing operation,
      re-run writes nothing, Active and locked targets refused.
- [x] Update `.claude/rules/csv-import-system.md` and the import docs.
- [x] Scoped typecheck, Biome, unit tests.
- [x] Browser check on the local stack: BOM and Operations imports, then the Operations file again (4 rows skipped, nothing written).
