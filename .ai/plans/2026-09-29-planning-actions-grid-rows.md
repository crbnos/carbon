# Planning actions as grid column + expandable rows

Replaces the `PlanningActionsTable` card (hand-rolled table above the planning grid) with
Carbon-native surfaces on the existing `Table`: an **Actions** column, an **expandable row**
listing the item's persisted `planningAction` rows, an **Assigned to me** quick filter, and
an **Apply Suggested Changes** bulk item. One table per route, state in the URL.

Design rationale: this conversation's brief (Sept 29). Spec context:
`.ai/specs/2026-08-22-mrp-v2-planned-order-generation.md` §P1.7 / §10.

## Tasks

- [x] 1. Shared UI: `modules/production/ui/Planning/PlanningActionLines.tsx`
      (type badge + icon vocabulary, Actions cell, expanded-row lines, filter options,
      `isApplyablePlanningAction`) + pure `planning-action-scope.ts` (URL keys, loader
      scope resolver, unit-tested). Delete `PlanningActionsTable.tsx`.
- [x] 2. Services: optional `itemIds` restriction on `getPurchasingPlanning` /
      `getProductionPlanning`.
- [x] 3. Loaders (both planning routes): strip the `planningActions` column filter and the
      assignee filter (first an `actions=mine` switch, now the Assignee column's people
      filter, `filter=planningAssignee:in:<userId>,…`) from the grid filters, resolve them to item ids from the loaded
      actions, pass `itemIds`. Drop the card.
- [x] 4. Grids (both): `planningActions` prop, Actions column (static type filter, export
      value), `canExpandRow` / `renderExpandedRow`, `headerActions` switch, worklist
      fetcher (apply / dismiss / reopen / assign-to-me → existing update route),
      "Apply Suggested Changes" in `renderActions`.
- [x] 5. Update routes (both): `reopen` case (mirror `dismiss`, calls the new
      `reopenDismissedPlanningActions`; the existing `reopenPlanningActions` is the apply claim rollback).
- [x] 6. Verify: `pnpm exec turbo run typecheck --filter=erp`, `pnpm run lint`.

## Verification

- typecheck + biome green
- Browser (if a dev server is up): Actions column shows badges; chevron only on items with
  actions; expanded lines show Apply / Review / Order; switch filters the grid; bulk
  "Apply Suggested Changes" posts one batched request.
