# Plan: Part Bill of Material and Bill of Process Tabs

Spec: `.ai/specs/2026-11-05-part-bom-bop-tabs.md`. Branch: `feat/bom-bop-redesign`.

## Progress

- [x] Task 1: Add pure helpers and tests
- [x] Task 2: Add the server read and path helpers
- [x] Task 3: Export the existing forms
- [x] Task 4: Add the method frame and the 2 tables
- [x] Task 5: Add the 2 line workspaces
- [x] Task 6: Add the 8 routes and the make redirect
- [x] Task 7: Wire navigation, Explorer, Details and version links
- [x] Task 8: Update translations and guides
- [x] Task 9: Verify in a browser
- [x] Task 10: Run the thermo-nuclear review and fix blockers

## Task 1: Add pure helpers and tests

**Files:** create `apps/erp/app/modules/items/ui/Item/methodPageUtils.ts` and `methodPageUtils.test.ts`.

1. Add `getOperationTabStates(operation)`. It returns the source of each tab: `own`, `procedure`, `linked` or `notUsed`.
2. Add `getPartMethodNodeLink`. It returns the tree link for the current record tab.
3. Add `getAdjacentLineIds(ids, currentId)`.

**Verify:** `pnpm --filter erp exec vitest run app/modules/items/ui/Item/methodPageUtils.test.ts`. Expect all tests to pass.

## Task 2: Add the server read and path helpers

**Files:** modify `apps/erp/app/modules/items/items.service.ts` and `apps/erp/app/utils/path.ts`.

1. Add `getPartMethodPage`. Copy the read order from `routes/x+/part+/$itemId.details.tsx`.
2. Add `partBillOfMaterial`, `partBillOfMaterialLine`, `partBillOfMaterialNew`, `partBillOfProcess`, `partBillOfProcessOperation` and `partBillOfProcessNew`.

**Verify:** the scoped typecheck in Task 9.

## Task 3: Export the existing forms

**Files:** modify `BillOfProcess.tsx` and `BillOfMaterial.tsx`.

1. Export `OperationForm`, `ParametersForm`, `AttributesForm`, `ToolsForm`, `OperationPreview`, `initialOperation`, and the row types.
2. Export `MaterialForm`, `initialMethodMaterial`, and the row types.
3. Pass the saved id to `onSubmit`. Existing callers ignore it.

**Verify:** the scoped typecheck. The Tool page renders today's cards in Task 9.

## Task 4: Add the method frame and the 2 tables

**Files:** create `MethodPageFrame.tsx`, `BillOfProcessTable.tsx`, `BillOfMaterialTable.tsx`. **Precedent:** `BillOfProcess.tsx` for reorder, delete and configure. `ProductionPlanningOrderDrawer.tsx` for `TableBase`.

## Task 5: Add the 2 line workspaces

**Files:** create `OperationWorkspace.tsx` and `MaterialLineWorkspace.tsx`. **Precedent:** tab content in `BillOfProcess.tsx:528-770`.

## Task 6: Add the 8 routes and the make redirect

**Files:** create the routes in the spec. Modify `routes/x+/part+/$itemId.make.$makeMethodId.tsx`. **Precedent:** `$itemId.purchasing.tsx`, `$itemId.purchasing.$supplierPartId.tsx`.

## Task 7: Wire navigation, Explorer, Details and version links

**Files:** modify `usePartNavigation.tsx`, `routes/x+/part+/$itemId.tsx`, `routes/x+/part+/$itemId.details.tsx`, `BoMExplorer.tsx`, `MakeMethodTools.tsx`, `PartProperties.tsx`, and `StrictBackflushTables.tsx` if it needs a change. Create `MethodLineExplorer.tsx`.

## Task 8: Update translations and guides

1. Run `pnpm lingui:extract`, then `pnpm lingui:clean`.
2. Update `apps/erp/app/modules/items/AGENTS.md`.

## Task 9: Verify in a browser

1. Run `pnpm exec turbo run typecheck --filter=erp --concurrency=1`.
2. Run `pnpm --filter erp test`, scoped to the items module first.
3. Run `CARBON_DEV_APPS=erp crbn up`.
4. Check each acceptance criterion in the spec, at 1440, 1024 and 390 px.

## Task 10: Run the thermo-nuclear review and fix blockers

1. Run the review on the full diff. Write the result to `.ai/plans/2026-11-05-part-bom-bop-tabs-review.md`.
2. Fix each blocker.
3. Run Task 9 again.
4. Review once more. The cap is 2 rounds.
