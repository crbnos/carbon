# Planning horizon (time fence) for MRP planning actions

Adds a per-item **planning horizon** (days from today) that limits which planning
actions and suggested orders the two planning grids surface. MRP keeps generating
actions over the full 48 weeks; the horizon is a **read-time lens**, so a buyer can
widen it on one row without an MRP rerun and without saving anything.

Source request: `.context/attachments/7lixQz/pasted_text_2026-10-01_04-35-37.txt`.
Builds on `.ai/plans/2026-09-08-mrp-planning-actions.md` and
`.ai/plans/2026-09-29-planning-actions-grid-rows.md`.

## Decisions (agreed Oct 1)

- **One engine.** The request's four aggregate rules (supply vs demand inside the
  fence) are NOT implemented. The existing per-document actions map onto them:
  New = Order/Make/Increase, Cancel = Cancel/Decrease, Reschedule In = Expedite,
  Reschedule Out = Defer.
- **Planned POs stay supply.** Carbon has no requisition document.
- **Empty horizon = no fence** (today's behaviour). Resolution:
  `itemPlanning.planningHorizonDays` else `companySettings.defaultPlanningHorizonDays`
  else none.
- **Weekly dates.** "1st negative on-hand" is the start of the first week whose
  projection is below zero.
- **Per-row fence edit**, page state only. Sort/filter use the saved horizon.
- **No primary action / priority.** The Actions chips stay; no sort by action.
- **Bulk Order respects the fence.**
- Column name is `planningHorizonDays`, NOT `planningTimeFenceDays` — the MRP v2
  spec reserves that name for the auto-firm fence, a different concept.

## Tasks

- [x] 1. Migration `planning-horizon`: `itemPlanning.planningHorizonDays`,
      `companySettings.defaultPlanningHorizonDays`, `planningAction.horizonDate` +
      `latestOrderDate` (backfilled), and the two grid wrappers
      `get_purchasing_planning_grid` / `get_production_planning_grid` (base RPC +
      item group, horizon, time fence date, first negative week, latest order date,
      and the action-type / assignee filter evaluated inside the fence).
- [x] 2. `pnpm db:migrate` (regenerates types).
- [x] 3. Engine: `horizonDate` + `latestOrderDate` on every candidate, carried
      through the diff-write; unit tests.
- [x] 4. Pure fence helpers + tests (`planning-fence.ts`); scope resolver returns
      filter inputs instead of item ids.
- [x] 5. Services + loaders: grid RPCs, actions loaded for the page's items only
      (removes the 500-action cap).
- [x] 6. Grids (both): Item Group, Planning Horizon (editable), 1st Negative columns;
      fence-aware Actions cell, expanded row, bulk apply and bulk Order.
- [x] 7. Drawers (both): orders trimmed to the fence with an "include the rest"
      control, fence marker on the chart, the item's change actions listed.
- [x] 8. Item Planning tab field + Settings → Planning company default.
- [x] 9. Docs (`.claude/rules/mrp-system.md`), MCP digest, lint, typecheck, tests.

## As built

- Grid RPCs are WRAPPERS (`get_*_planning_grid`) around the base planning RPCs, not
  redefinitions: the base stays the one definition of the projection.
- `planningAction.horizonDate` = earlier of the target order's current date and the
  suggested date; `latestOrderDate` = required date less lead time (new supply only).
- The drawer lists suggested changes with the open-orders grid (`OpenOrdersGrid` in `PlanningOrderGrids.tsx`, each open order carrying its action), not the
  grid's `PlanningActionLines` — see the `@container` lesson in `.ai/lessons.md`.
- The drawer has its own Planning Horizon control; moving the fence re-splits the suggested
  orders and re-merges the existing ones.
- Browser pass done on the demo company at 1440 and 1100 px (fence in grid and drawer,
  pull-in, suggested-changes table, expanded row, chart marker).
- The drawer is two editable grids (`PlanningOrderGrids.tsx`): a draft Suggested Orders
  table and an Open Orders table whose cells autosave through new `updateLine` /
  `updateJob` actions; planning actions sit on the row of the order they target. New
  shared pieces: `EditableDate` and `Grid isRowEditable`. Drawer widened to `xl`.
- Browser-checked: draft edits (quantity, date), locked rows, refusal paths of both save
  actions (409 / 400 / 404). NOT exercised: a successful autosave, since that writes to
  the database.
- Not done: translations for the new strings (`pnpm translate` at commit time).

## Verification

- `pnpm --filter @carbon/planning test`, `pnpm --filter erp test` (touched files)
- `pnpm exec turbo run typecheck --filter=erp --filter=@carbon/planning`
- `pnpm run lint`
- SQL: call both grid RPCs against the local DB with and without a horizon and
  with the action filter.
