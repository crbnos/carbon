# Sales order delivery date check — implementation plan

**Spec:** .ai/specs/2026-11-10-sales-order-delivery-date-check.md
**Research:** .ai/research/order-promising-time-fence.md
**Closest sibling:** the quote lead-time check (`routes/x+/quote+/$quoteId.$lineId.lead-time.tsx`, `QuoteLeadTimeModal.tsx`)
**Branch:** naveenkash/time-fence-exception-messages

## Deviations (recorded at Task 18)
- Task 8: the result write lives inside `checkSalesOrderDeliveryDates`, not a separate `writeDeliveryDateResults`. The check is split into `runDeliveryDateCheck`, so the read-only operation shares it.
- Task 10: the escape hatch triggered. The catalog has no `salesOrderLine` entity, so the moment outputs are `salesOrder` and `overriddenBy`.
- Task 14: the alert uses a plain `fetch`, not a fetcher, so the order page does not revalidate on each change.

## Progress
- [x] Task 1: Start the local stack for this worktree
- [x] Task 2: Add the migration and regenerate the types
- [x] Task 3: Calculate the cumulative lead time
- [x] Task 4: Calculate free stock by week (ATP)
- [x] Task 5: Feed an item routing to the quote engine (CTP)
- [x] Task 6: Decide the result and export `checkDeliveryDates`
- [x] Task 7: Extend the sales models
- [x] Task 8: Add the check operation and the result write
- [x] Task 9: Run the check on line save and on quote conversion
- [x] Task 10: Register the moment `sales.deliveryDateOverridden`
- [x] Task 11: Add the check route
- [x] Task 12: Add the company level to Settings → Sales
- [x] Task 13: Add the item override to the Planning form
- [x] Task 14: Show the warning and the requested date in the line form
- [x] Task 15: Flag a failing line in the explorer
- [x] Task 16: Fill the translations and run the gates
- [x] Task 17: Verify in the browser
- [x] Task 18: Review the branch

## Dependencies
- Task 2 needs Task 1.
- Tasks 3, 4 and 5 are independent of each other. Each one needs Task 2 (types).
- Task 6 needs Tasks 3, 4 and 5.
- Task 7 needs Task 2. Task 8 needs Tasks 6 and 7. Task 9 needs Tasks 8 and 10.
- Task 10 is independent after Task 2.
- Tasks 11, 12 and 13 need Task 8. They are independent of each other.
- Task 14 needs Task 11. Task 15 needs Task 2.
- Task 16 needs Tasks 3–15. Task 17 needs Task 16. Task 18 needs Task 17.

---

## Task 1: Start the local stack for this worktree

**Depends on:** none
**Files:** none

**Steps:**
1. Run `crbn status`.
2. If the mode is "not started", run `crbn up` (shared mode).
3. Run `crbn status` again.

**Verify:**
```bash
crbn status
# Expected: a port assignment and a running mode for this worktree
```

**Out of scope:** `crbn reset`, `crbn restore`, any rebuild of a database. If `crbn up` fails, STOP and report — do not improvise.

## Task 2: Add the migration and regenerate the types

**Depends on:** Task 1
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_delivery-date-check.sql` (from `pnpm db:migrate:new delivery-date-check`)
- Copy from (precedent): the `salesOrderLines` view body in `packages/database/supabase/migrations/20261006220201_revenue-recognition-core.sql:174-202`

**Steps:**
1. Run `pnpm db:migrate:new delivery-date-check`.
2. Write the enums, the columns and the index from the spec, section "Data Model Changes". Guard each `CREATE TYPE` with a `DO $$ … EXCEPTION WHEN duplicate_object` block. Use `ADD COLUMN IF NOT EXISTS`.
3. Copy the view body from the precedent unchanged, after `DROP VIEW IF EXISTS "salesOrderLines";`.
4. Run `pnpm db:migrate`.
5. Run `pnpm run generate:types` if `db:migrate` did not regenerate them.

**Verify:**
```bash
grep -c "deliveryDateOverriddenBy" packages/database/src/types.ts
# Expected: a number of 3 or more (table Row/Insert/Update and the view)
```

**Out of scope:** authz manifest changes (no new table); demo datasets (all columns are nullable or defaulted). If a later migration than `20261006220201` changes `salesOrderLines`, STOP and report.

## Task 3: Calculate the cumulative lead time

**Depends on:** Task 2
**Files:**
- Create: `packages/planning/src/promising/cumulative-lead-time.ts`
- Create: `packages/planning/src/promising/cumulative-lead-time.test.ts`
- Copy from (precedent): `packages/planning/src/scheduling/quote-lead-time.test.ts` (test style)

**Steps:**
1. Export `DEFAULT_LEAD_TIME_DAYS = 7`.
2. Export the pure `cumulativeLeadTimes(items: Map<string, { leadTime: number; replenishmentSystem: string }>, edges: { parentItemId: string; childItemId: string }[]): Map<string, number>`.
3. For a `Buy` item, return its own lead time. For another item, return its own lead time + the largest value of its children.
4. Memoize each item. Treat an item seen again on the current path as 0, so a cycle ends.
5. Export `loadCumulativeLeadTimes(db: Kysely<KyselyDatabase>, companyId: string, itemIds: string[])`.
6. In it, run one recursive query: `activeMakeMethods` → `methodMaterial` → the child item, from the root items down, with `UNION`.
7. Read `item.replenishmentSystem` and `itemReplenishment.leadTime` for every item of the tree in one more query.
8. Write 4 tests: a 3-level tree (5 + 7 + 14 = 26), a `Buy` root, a shared sub-assembly and a cycle.

**Verify:**
```bash
pnpm --filter @carbon/planning test -- cumulative-lead-time
# Expected: all tests pass
```

**Out of scope:** any change to MRP's `explodeBom`.

## Task 4: Calculate free stock by week (ATP)

**Depends on:** Task 2
**Files:**
- Create: `packages/planning/src/promising/available-to-promise.ts`
- Create: `packages/planning/src/promising/available-to-promise.test.ts`
- Copy from (precedent): the input reads in `packages/planning/src/mrp/mrp.ts:138-202` and the bucketing in `packages/planning/src/mrp/plan-company.ts:428-475, 556-620`

**Steps:**
1. Export the pure `weekStarts(todayIso: string, lastIso: string): string[]`. Use `startOfWeek(date, "en-US")`.
2. Export the pure `freeStockByWeek({ onHand, supply, demand, weeks, todayIso })`. `supply` and `demand` are `{ date: string; quantity: number }[]`. A date before today goes to week 0.
3. Compute the balance of each week.
4. Set the free stock of week `w` to the smallest balance from week `w` on, floored at 0.
4a. Export the pure `earliestWeekWithStock(freeStock: number[], quantity: number): number | null`.
5. Export `loadSupplyAndDemand(client: SupabaseClient<Database>, companyId: string, keys: { itemId: string; locationId: string }[], excludeSalesOrderLineIds: string[])`.
6. In it, read `itemStockQuantities` (common stock), `openPurchaseOrderLines`, `openProductionOrders`, `openSalesOrderLines` and `openJobMaterialLines` once each, filtered with `.in("itemId", …)`.
7. Keep only rows whose `planningSegmentId` is empty or NULL.
8. Date each row with `purchaseOrderLineArrivalDate`, `jobCompletionDate`, `promisedDate ?? today` and `dueDate − leadTime`.
9. Write tests for the 2 Stock acceptance criteria of the spec, plus a past-due row and the look-ahead case.

**Verify:**
```bash
pnpm --filter @carbon/planning test -- available-to-promise
# Expected: all tests pass
```

**Out of scope:** forecasts, planned orders, project segments, the stored MRP tables.

## Task 5: Feed an item routing to the quote engine (CTP)

**Depends on:** Task 2
**Files:**
- Modify: `packages/planning/src/scheduling/quote-lead-time.ts` — `runQuoteLeadTimeWhatIf` takes an optional `routing`
- Create: `packages/planning/src/promising/item-routing.ts`
- Create: `packages/planning/src/promising/item-routing.test.ts`

**Steps:**
1. Export `type QuoteLineRouting = { makeMethods: QuoteMakeMethodRow[]; materials: QuoteMaterialRow[]; operations: QuoteOperationRow[] }`.
2. Add `routing?: QuoteLineRouting` to the params of `runQuoteLeadTimeWhatIf`. Use `params.routing ?? (await loadQuoteLineRouting(…))`.
3. In `item-routing.ts`, export the pure `buildItemRouting({ rootMethodId, methods, materials, operations, activeMethodByItem })`.
4. Start one occurrence at the root method. For each `Make to Order` material, add one occurrence of the child item's active method.
5. Build occurrence ids from the path (`<parentOccurrence>/<materialId>`). Prefix the material and operation ids with the occurrence id.
6. Map `methodOperation` to `QuoteOperationRow` with `operationLeadTime ?? 0`. Map `methodMaterial.methodOperationId` to the prefixed operation id.
7. Export `loadItemRouting(db, companyId, itemId)`. It reads the active methods of the tree, then `methodMaterial` (with `item.readableId`) and `methodOperation` for those methods, in 3 queries.
8. Return null if the root has no active method or the tree has no operation.
9. Write 3 tests: a shared sub-assembly, the operation times, and a Pull from Inventory material that does not explode.

**Verify:**
```bash
pnpm --filter @carbon/planning test -- item-routing quote-lead-time
# Expected: all tests pass, including the unchanged quote-lead-time tests
```

**Out of scope:** any change to the quote route, the quote modal or `buildQuoteSimulation`.

## Task 6: Decide the result and export `checkDeliveryDates`

**Depends on:** Tasks 3, 4, 5
**Files:**
- Create: `packages/planning/src/promising/delivery-date-check.ts`
- Create: `packages/planning/src/promising/delivery-date-check.test.ts`
- Modify: `packages/planning/src/index.ts` — export `checkDeliveryDates` and its types

**Steps:**
1. Export the types `DeliveryDateControl`, `DeliveryDateLine` (`key`, `salesOrderLineId?`, `itemId`, `locationId`, `quantity`, `promisedDate`, `methodType`, `control`) and `DeliveryDateResult` (`key`, `status`, `constraint`, `earliestDate`, `cumulativeLeadTimeDays`, `freeQuantity`, `cause`).
2. Export the pure `decideDeliveryDate(...)`. It follows the table in spec section 3.
3. Export `checkDeliveryDates({ db, client, companyId, userId, lines })`.
4. In it, resolve "today" at each location with `getLocationTimeZone` and `datetime.today`.
5. Call `loadCumulativeLeadTimes` once and `loadSupplyAndDemand` once for all the lines.
6. Run CTP (`loadItemRouting` + `runQuoteLeadTimeWhatIf` with `routing` and `quoteLineId = "salesOrderLine:<key>"`) only for a line that needs it.
7. Write tests for `decideDeliveryDate`: each cell of the spec table, the fence pass, and the no-routing fallback.

**Verify:**
```bash
pnpm --filter @carbon/planning test && pnpm exec turbo run typecheck --filter=@carbon/planning
# Expected: all tests pass; typecheck has 0 errors
```

**Out of scope:** writes to the database; the planning package does not write.

## Task 7: Extend the sales models

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.models.ts` — `salesOrderLineValidator` (about line 996), a new `deliveryDateCheckValidator`, `deliveryDateControl` options

**Steps:**
1. Add `requestedDate: zfd.text(z.string().optional())` and `deliveryDateOverrideReason: zfd.text(z.string().max(500).optional())` to `salesOrderLineValidator`.
2. Export `deliveryDateControlTypes = ["None", "Lead Time", "Stock", "Capacity"] as const`.
3. Export `deliveryDateCheckValidator`: `lineId?`, `itemId`, `locationId?`, `saleQuantity`, `promisedDate` (`YYYY-MM-DD`), `methodType`, `salesOrderLineType`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** other validators.

## Task 8: Add the check operation and the result write

**Depends on:** Tasks 6, 7
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.service.ts` — new `resolveDeliveryDateControls`, `checkSalesOrderDeliveryDates`, `writeDeliveryDateResults`
- Modify: `apps/erp/app/modules/sales/sales.server.ts` — new `checkSalesOrderLineDeliveryDate`

**Steps:**
1. `resolveDeliveryDateControls(ctx, keys)`: read `companySettings.deliveryDateControl` and `itemPlanning.deliveryDateControl` for the keys in 2 queries. The item value wins.
2. Add `checkSalesOrderDeliveryDates(ctx, { salesOrderId, lineIds?, overrideReason?, recordOverride })`. It reads the lines of the order.
2a. Skip the lines of spec section 6 and Make to Order lines with an open job (`job.salesOrderLineId`).
2b. Call `checkDeliveryDates` for the other lines.
3. `writeDeliveryDateResults(ctx, rows)`: one Kysely `UPDATE "salesOrderLine" … FROM (VALUES …)` with `.where("companyId", "=", ctx.company.id)`.
4. If `recordOverride` and the status is `Missed`, set the 3 override columns. If the status is `Met` or NULL, clear them.
5. Return the lines whose override this call set, for the moment.
6. `checkSalesOrderLineDeliveryDate`: `defineServiceFn`, `permission: { view: "sales" }`, input `deliveryDateCheckValidator` + `salesOrderId`. TSDoc with `@mcp read`. It writes nothing.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm --filter @carbon/checks clobbers
# Expected: 0 errors; the clobbers check passes
```

**Out of scope:** the sales-rule gate (`salesOrderLineGate`).

## Task 9: Run the check on line save and on quote conversion

**Depends on:** Tasks 8, 10
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.server.ts` — `createSalesOrderLine` (about line 2238), `updateSalesOrderLine` (about line 2310), `convertQuote` (about line 1241), `acceptDigitalQuote` (about line 1567)

**Steps:**
1. In `createSalesOrderLine` and `updateSalesOrderLine`, after the upsert, call `checkSalesOrderDeliveryDates` for the line with `recordOverride: true` and the form's reason.
2. For each override the call set, call `raiseMoment("sales.deliveryDateOverridden", …)` after the write.
3. Do not fail the save if the check fails. Log the error.
4. In `convertQuote` and `acceptDigitalQuote`, after a successful conversion, call `checkSalesOrderDeliveryDates` for the new order with `recordOverride: false`.
5. Strip `deliveryDateOverrideReason` from the line before `upsertSalesOrderLine`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** `convertDocument` in `shared.service.ts`.

## Task 10: Register the moment `sales.deliveryDateOverridden`

**Depends on:** Task 2
**Files:**
- Modify: `packages/workflows-core/src/moments.ts` — add `"sales.deliveryDateOverridden": ["salesOrder", "salesOrderLine", "overriddenBy"]`
- Modify: `packages/ee/src/workflows/catalog/moments.ts` — add the declaration
- Copy from (precedent): `"sales.quoteAccepted"` in both files

**Steps:**
1. Add the output keys to `MOMENT_OUTPUT_KEYS`.
2. Add the declaration with label "A sales order line keeps a date it cannot meet", permission `sales`.
3. If `t.entity("salesOrderLine")` is not a catalog entity, STOP and report.
4. Run `pnpm run generate:workflow-catalog`.

**Verify:**
```bash
pnpm run generate:workflow-catalog && git status --short packages/ee/src/workflows/catalog
# Expected: the generated catalog files change; the command exits 0
```

**Out of scope:** new workflow operations.

## Task 11: Add the check route

**Depends on:** Task 8
**Files:**
- Create: `apps/erp/app/routes/x+/sales-order+/$orderId.delivery-date.tsx`
- Modify: `apps/erp/app/utils/path.ts` — add `salesOrderDeliveryDate(orderId)`
- Copy from (precedent): `apps/erp/app/routes/x+/quote+/$quoteId.$lineId.lead-time.tsx`

**Steps:**
1. Write an action only. Read the JSON body with `deliveryDateCheckValidator`.
2. Call `api.sales.checkSalesOrderLineDeliveryDate`. Return the result.
3. Add the path helper beside `quoteLineLeadTime`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** a loader or UI in the route.

## Task 12: Add the company level to Settings → Sales

**Depends on:** Task 8
**Files:**
- Modify: `apps/erp/app/modules/settings/settings.server.ts` — `updateSalesSettings` (about line 726) accepts `deliveryDateControl`
- Modify: `apps/erp/app/routes/x+/settings+/sales.tsx` — a new intent and a new card
- Create: `apps/erp/app/modules/settings/ui/Sales/DeliveryDateCheckCard.tsx`
- Copy from (precedent): `apps/erp/app/modules/settings/ui/Planning/PlanningHorizonCard.tsx`

**Steps:**
1. Add `deliveryDateControl: z.enum(deliveryDateControlTypes).optional()` to the `updateSalesSettings` input.
2. Add the intent `deliveryDateControl` to the route's discriminated union.
3. Build the card with `ValidatedForm`, `Hidden intent`, a `Select` of the 4 levels, and one help sentence per level.
4. Place the card in the Documents section of the page.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** other settings cards.

## Task 13: Add the item override to the Planning form

**Depends on:** Task 8
**Files:**
- Modify: `apps/erp/app/modules/items/items.models.ts` — the item planning validator (about line 691)
- Modify: `apps/erp/app/modules/items/ui/Item/ItemPlanningForm.tsx` — a new Select
- Copy from (precedent): `planningHorizonDays` in the same 2 files

**Steps:**
1. Add `deliveryDateControl: zfd.text(z.enum(deliveryDateControlTypes).optional())`. An empty value means "Company default".
2. Add a Select with "Company default" and the 4 levels below the planning horizon field.
3. Confirm that `upsertItemPlanning` passes the field through `sanitize`. If it does not, STOP and report.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** `itemReplenishment` forms.

## Task 14: Show the warning and the requested date in the line form

**Depends on:** Task 11
**Files:**
- Create: `apps/erp/app/modules/sales/ui/SalesOrder/DeliveryDateCheckAlert.tsx`
- Modify: `apps/erp/app/modules/sales/ui/SalesOrder/SalesOrderLineForm.tsx` — the item tab, about line 785
- Modify: `apps/erp/app/routes/x+/sales-order+/$orderId.new.tsx` — default `requestedDate` from `salesOrder.receiptRequestedDate`
- Copy from (precedent): the JSON fetcher in `apps/erp/app/modules/sales/ui/Quotes/QuoteLeadTimeModal.tsx:85-110`; the `Alert` use in `SalesOrderSummary.tsx`

**Steps:**
1. Hold `promisedDate` in state. Pass `value` and `onChange` to the Promised Date `DatePicker`.
2. Add a `DatePicker` "Requested Date" (`requestedDate`) beside Promised Date. Hide both for a Service line, as today.
3. In `DeliveryDateCheckAlert`, post the line fields as JSON to `path.to.salesOrderDeliveryDate(orderId)` when they change. Skip the post while a field is empty.
4. If the result is `Missed`, show a warning `Alert` with the message of spec "UI Changes" item 3.
5. Add a button "Use {date}" that calls `onUseEarliestDate(date)`.
6. Add an optional `Input` "Reason for keeping this date" named `deliveryDateOverrideReason`.
7. Use `useLingui` and `formatDate` for every string and date.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm exec biome check apps/erp/app/modules/sales/ui/SalesOrder
# Expected: 0 errors
```

**Out of scope:** the Fixed Asset tab; the sales-rule modal.

## Task 15: Flag a failing line in the explorer

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/sales/ui/SalesOrder/SalesOrderExplorer.tsx` — `SalesOrderLineItem` (about line 325)
- Copy from (precedent): the `QuoteLineStatusIcon` placement in `apps/erp/app/modules/sales/ui/Quotes/QuoteExplorer.tsx:465-471`

**Steps:**
1. If `line.deliveryDateStatus === "Missed"`, show a calendar icon at the right of the row title.
2. Use amber with the tooltip "Date not confirmed. Earliest: {date}" when `deliveryDateOverriddenBy` is NULL.
3. Use the muted color with the tooltip "Date kept. Earliest: {date}" otherwise.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** `SalesOrderSummary.tsx`.

## Task 16: Fill the translations and run the gates

**Depends on:** Tasks 3–15
**Files:**
- Modify: `packages/locale/locales/*/*.po` (generated)

**Steps:**
1. Run the license header fixer: `pnpm --filter @carbon/checks license-headers`.
2. Run `pnpm run lint`.
3. Run the `/translate` skill to fill the new strings.
4. Run `pnpm db:check:datasets`.
5. Run `pnpm db:check:backups`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/planning && pnpm --filter @carbon/planning test && pnpm --filter erp test
# Expected: 0 type errors; all tests pass
```

**Out of scope:** whole-repo typecheck.

## Task 17: Verify in the browser

**Depends on:** Task 16
**Files:** none

**Steps:**
1. Run `/auth`, then `/test` with the acceptance criteria of the spec.
2. Test the edge cases first. Start with a line inside the fence, "Use {date}" and a kept date with a reason.
3. Then test a quote conversion and the item override.

**Verify:**
```bash
# Expected: every acceptance criterion in the spec passes in the browser, with screenshots in .context/
```

**Out of scope:** the MES app.

## Task 18: Review the branch

**Depends on:** Task 17
**Files:** none

**Steps:**
1. Run `/self-review` on the branch.
2. Fix every Must-fix item.
3. Update the spec changelog with any change from the design.

**Verify:**
```bash
git diff origin/main --stat
# Expected: only the files listed in this plan, plus generated types, catalog and .po files
```

**Out of scope:** pushing or opening a PR — ask the user first.
