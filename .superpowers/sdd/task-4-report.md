# Task 4 Report: Report CSV Exports

## Status

Implemented scoped CSV exports for the table-based AR aging, AP aging, and inventory valuation workbenches.

## Changed Files

- `apps/erp/app/modules/invoicing/ui/Workbench/ARAPWorkbench.tsx`
- `apps/erp/app/modules/invoicing/ui/Workbench/arapExport.ts`
- `apps/erp/app/modules/invoicing/ui/Workbench/arapExport.test.ts`
- `apps/erp/app/modules/inventory/ui/Valuation/InventoryValuationWorkbench.tsx`
- `apps/erp/app/modules/inventory/ui/Valuation/inventoryValuationExport.ts`
- `apps/erp/app/modules/inventory/ui/Valuation/inventoryValuationExport.test.ts`
- `.superpowers/sdd/task-4-report.md`

## Implementation Notes

- Added pure AR/AP export row mapping that emits counterparty aging rows plus every loaded open invoice row, independent of the expanded table state.
- Added pure inventory valuation export row mapping over the loaded valuation source rows, independent of grouped/expanded display rows.
- Added disabled `Download` buttons to the existing workbench header action stacks.
- Reused `downloadCsv` from `~/modules/accounting/ui/Reports`.
- Kept tie-out, reconcile, adjusting-entry, and payment controls out of the exported data.
- Did not touch report catalog or reports hub files.

## TDD Evidence

RED:

```text
vitest run app/modules/invoicing/ui/Workbench/arapExport.test.ts app/modules/inventory/ui/Valuation/inventoryValuationExport.test.ts
Test Files 2 failed (2)
Tests 4 failed (4)
```

GREEN:

```text
vitest run app/modules/invoicing/ui/Workbench/arapExport.test.ts app/modules/inventory/ui/Valuation/inventoryValuationExport.test.ts
Test Files 2 passed (2)
Tests 4 passed (4)
```

Final focused verification:

```text
vitest run app/modules/invoicing/ui/Workbench/arapExport.test.ts app/modules/inventory/ui/Valuation/inventoryValuationExport.test.ts
Test Files 2 passed (2)
Tests 4 passed (4)
```

```text
biome check --no-errors-on-unmatched [6 task files]
Checked 6 files in 24ms. No fixes applied.
```

```text
git diff --check -- [6 task files]
Exit code 0; only CRLF conversion warnings for the two pre-existing TSX files.
```

## Typecheck

Attempted app typecheck with local binaries because the global `pnpm` shim fails:

```text
pnpm --filter erp exec vitest ...
Error: Cannot find module 'C:\Program Files\nodejs\node_modules\corepack\dist\pnpm.js'
```

`tsc --noEmit` initially ran out of heap. Retried with `NODE_OPTIONS=--max-old-space-size=8192`; it reached diagnostics but failed on repository/environment issues outside this task:

```text
Cannot find module '@lingui/react/macro' or its corresponding type declarations.
Cannot find module '@lingui/core/macro' or its corresponding type declarations.
app/utils/dev-login.ts: 'configuredEmail' is possibly 'undefined'.
```

## Self-Review

- Export rows are built from `aging`/`open` and `rows` source arrays, not `displayRows`.
- Empty exports do not call `downloadCsv`; the buttons are disabled and the handlers return early.
- Dynamic aging bucket headers reflect active `bucketDays`.
- AR/AP filename uses the active workbench title and as-of date.
- Inventory filename includes report name, group-by mode, and as-of date.
- No route authorization, report catalog, or reports hub changes were made.
- Existing unrelated dirty worktree changes were not modified or staged.

## Concerns

- App-wide typecheck is blocked by the checkout's unresolved Lingui module declarations and an unrelated existing `dev-login.ts` diagnostic.
- The global `pnpm` shim is broken in this environment, so verification used local app/root binaries directly.
