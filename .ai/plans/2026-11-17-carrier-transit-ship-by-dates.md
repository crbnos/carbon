# Carrier transit time and ship-by dates — implementation plan

**Spec:** .ai/specs/2026-11-17-carrier-transit-ship-by-dates.md
**Research:** .ai/research/2026-11-17-carrier-transit-ship-by-dates.md
**Closest sibling:** the shipping method form (transit days), customer contacts (transit overrides), the MES "Due" text (countdown), the rental **Delivered on** field (Mark Delivered)
**Branch:** naveenkash/shipping-priority-queue

## Progress

- [x] Task 1: Add the business-day and countdown helpers to `@carbon/utils`
- [x] Task 2: Create the schema migration
- [x] Task 3: Create the MES read migration (the `jobs` view and 2 RPCs)
- [x] Task 4: Add the RLS rule, apply the migrations, regenerate the types
- [x] Task 5: Add the pure planners and guards, with tests
- [x] Task 6: Add the building blocks `resolveTransitDays` and `recordShipmentDelivery`
- [x] Task 7: Add transit days and the measured statistics to the shipping method
- [x] Task 8: Add the transit overrides on the customer Shipping tab
- [x] Task 9: Set the arrive-by date in quote → order
- [x] Task 10: Default the ship-by date on a new sales order line
- [x] Task 11: Add the ship-by recalculation prompt
- [x] Task 12: Show "Late to arrive" on the sales order lines
- [x] Task 13: Store the estimated delivery date when a sales shipment posts
- [x] Task 14: Add Mark Delivered and the delivery dates on the shipment screens
- [x] Task 15: Show the ship countdown on the MES screens
- [x] Task 16: Add the glossary terms and the translations
- [x] Task 17: Update the module AGENTS.md files
- [x] Task 18: Run the full gates
- [ ] Task 19: Browser-verify the flows
- [ ] Task 20: Self-review the branch

## Dependencies

- Task 1 has no dependency.
- Tasks 2 and 3 are independent of each other. Task 4 needs both.
- Task 5 needs Task 1. Task 6 needs Tasks 4 and 5.
- Tasks 7 to 15 need Task 6. Tasks 7, 8, 13 and 15 touch different files, so they can run in parallel.
- Tasks 9, 10, 11 and 12 touch `sales.server.ts` or `sales.service.ts`. Run them in order.
- Task 14 needs Task 13.
- Tasks 16 to 20 run last, in order.

## Rules for every task

- Write a new source file with its SPDX header: run `pnpm --filter @carbon/checks license-headers`.
- Never use JavaScript `Date`. Use `@internationalized/date` (`.claude/rules/date-handling.md`).
- Wrap every new UI string in Lingui (`t` or `<Trans>`).
- A building block takes `db: Kysely<KyselyDatabase>` or a Supabase client as its first argument. It never creates a client.
- Scope every query by `companyId`.
- Only the main agent runs `pnpm exec turbo run typecheck --filter=erp`, `pnpm generate:mcp` and `pnpm check:manifest`.

---

## Task 1: Add the business-day and countdown helpers to `@carbon/utils`

**Depends on:** none
**Files:**
- Modify: `packages/utils/src/date.ts` — add 4 exported functions
- Modify: `packages/utils/src/date.test.ts` — add tests
- Copy from (precedent): `formatRelativeCalendarDays` in `packages/utils/src/date.ts`

**Steps:**
1. Import `parseDate` and `getDayOfWeek` from `@internationalized/date`. Use the locale `"en-US"` for `getDayOfWeek`, so Sunday is 0 and Saturday is 6.
2. Add `isBusinessDay(date: string, holidays: ReadonlySet<string>): boolean`. Return false for Saturday, Sunday and a date in `holidays`.
3. Add `addBusinessDays(date: string, days: number, holidays: ReadonlySet<string> = new Set()): string`. Step forward one calendar day at a time. Count a step only when the new day is a business day. Stop after `days` counted steps. With `days` = 0, return `date`.
4. Add `subtractBusinessDays(date, days, holidays = new Set())` with the same rule, stepping back.
5. Add `businessDaysBetween(start, end, holidays = new Set()): number`. Count the business days after `start`, up to and including `end`. If `end` is not after `start`, return 0.
6. Add `getShipCountdown(shipByDate: string | null, today: string): { days: number; tone: "neutral" | "warning" | "late" } | null`. Return null for a null date. `days` is calendar days from `today` to `shipByDate`. The tone is `"late"` below 0, `"warning"` at 0 and 1, else `"neutral"`.
7. Add tests for each example in spec section 1. Add one test with `"2026-11-23"` in the holiday set. Add tests for each tone of `getShipCountdown`.

**Verify:**
```bash
pnpm --filter @carbon/utils test -- date.test.ts
# Expected: all tests pass, including the new describe blocks
pnpm exec turbo run typecheck --filter=@carbon/utils
# Expected: 0 errors
```

**Out of scope:** `packages/planning` calendar utilities. Do not change them.

---

## Task 2: Create the schema migration

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/{timestamp}_carrier-transit-ship-by-dates.sql`

**Steps:**
1. Run `pnpm db:migrate:new carrier-transit-ship-by-dates`.
2. Write the SQL from spec "Data Model Changes" parts 1, 2, 3 and 4. Guard each statement:
   - `ADD COLUMN IF NOT EXISTS` for each column.
   - A `DO $$ … EXCEPTION WHEN duplicate_object` block for the enum and for each named CHECK constraint.
   - `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`.
3. Add these indexes on `customerLocationTransitTime`: `companyId`, `customerLocationId`, `shippingMethodId`, `createdBy`.
4. Add the function `job_set_ship_by_date()` (`LANGUAGE plpgsql`). It sets `NEW."shipByDate"` to the `promisedDate` of the `salesOrderLine` row with `id = NEW."salesOrderLineId"`. If `NEW."salesOrderLineId"` is null, it sets null.
5. Create the trigger `job_set_ship_by_date` `BEFORE INSERT OR UPDATE OF "salesOrderLineId" ON "job" FOR EACH ROW`. Drop it first with `DROP TRIGGER IF EXISTS`.
6. Add the function `sales_order_line_sync_job_ship_by_date()`. It runs `UPDATE "job" SET "shipByDate" = NEW."promisedDate" WHERE "salesOrderLineId" = NEW."id" AND "companyId" = NEW."companyId" AND "shipByDate" IS DISTINCT FROM NEW."promisedDate"`.
7. Create the trigger `sales_order_line_sync_job_ship_by_date` `AFTER UPDATE OF "promisedDate" ON "salesOrderLine" FOR EACH ROW WHEN (OLD."promisedDate" IS DISTINCT FROM NEW."promisedDate")`.
8. Add the backfill: `UPDATE "job" j SET "shipByDate" = sol."promisedDate" FROM "salesOrderLine" sol WHERE sol."id" = j."salesOrderLineId" AND j."shipByDate" IS DISTINCT FROM sol."promisedDate";`.
9. Use `SECURITY INVOKER` (the default) for both functions. If a related trigger in the newest migrations uses `SECURITY DEFINER` with `SET search_path`, copy that pattern instead.

**Verify:**
```bash
ls packages/database/supabase/migrations/*_carrier-transit-ship-by-dates.sql
# Expected: one file, timestamp later than every other migration on main
grep -c "IF NOT EXISTS" packages/database/supabase/migrations/*_carrier-transit-ship-by-dates.sql
# Expected: 8 or more
```

**Out of scope:** RLS policies (Task 4). The `jobs` view and the RPCs (Task 3).

---

## Task 3: Create the MES read migration

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/{timestamp}_ship-by-date-mes-reads.sql`
- Copy from (precedent): `20261006220401_fleet-bridge.sql` (the `jobs` view), `20261006021134_mes-hide-outside-processing.sql` (`get_active_job_operations_by_location`), `20260304000000_add-operation-due-date-to-functions.sql` (`get_assigned_job_operations`)

🛑 Before you copy each object, search every migration for a newer definition. Use the newest one (`.ai/lessons.md`, "Forking a SQL function migration").

**Steps:**
1. Run `pnpm db:migrate:new ship-by-date-mes-reads`. The timestamp must be after the Task 2 migration.
2. Find the newest definition of each object:
   ```bash
   grep -l 'VIEW "jobs"' packages/database/supabase/migrations/*.sql | tail -1
   grep -l 'FUNCTION get_active_job_operations_by_location' packages/database/supabase/migrations/*.sql | tail -1
   grep -l 'FUNCTION get_assigned_job_operations' packages/database/supabase/migrations/*.sql | tail -1
   ```
3. Copy the `jobs` view as `DROP VIEW IF EXISTS "jobs"; CREATE VIEW "jobs" …`, unchanged. Its `j.*` now includes `shipByDate`. Copy the `WITH (SECURITY_INVOKER=true)` clause and every `GRANT` that follows the view, if any.
4. Copy `get_active_job_operations_by_location`. Add `"jobShipByDate" DATE` to `RETURNS TABLE`, right after `"jobDeadlineType"`. Add `rj."shipByDate"` at the same position in the `SELECT`.
5. A `RETURNS TABLE` change needs `DROP FUNCTION IF EXISTS get_active_job_operations_by_location(TEXT, TEXT[]);` before the `CREATE`. Match the argument types to the newest definition.
6. Do steps 4 and 5 for `get_assigned_job_operations`, with `j."shipByDate"`.
7. Copy each `GRANT EXECUTE` and each `SECURITY` or `SET search_path` clause of the newest definitions.

**Verify:**
```bash
f=$(ls packages/database/supabase/migrations/*_ship-by-date-mes-reads.sql); grep -c "jobShipByDate" "$f"
# Expected: 2 in RETURNS TABLE lists, plus the 2 SELECT lines are rj/j."shipByDate"
diff <(grep -o '"[a-zA-Z]*" [A-Z]' $(grep -l 'FUNCTION get_assigned_job_operations' packages/database/supabase/migrations/*.sql | grep -v ship-by-date | tail -1)) <(grep -o '"[a-zA-Z]*" [A-Z]' "$f") | head
# Expected: only added lines, no removed lines from the previous definition
```

**Out of scope:** `get_job_operations_by_work_center`. No screen in scope reads it.

---

## Task 4: Add the RLS rule, apply the migrations, regenerate the types

**Depends on:** Tasks 2, 3
**Files:**
- Modify: `packages/database/src/authz/manifest.ts` — add the rule next to `customerItemRentalRate` (line 443)
- Create: the generated authz migration
- Modify: `packages/database/src/types.ts` (generated, never by hand)

**Steps:**
1. Add `customerLocationTransitTime: company("sales", { read: "sales_view" }),`.
2. If the worktree has no `.env.local`, run `crbn up` (shared mode). It creates this worktree's database.
3. Run `pnpm db:migrate`.
4. Run `pnpm --filter @carbon/database authz migration customer-location-transit-time`.
5. Run `pnpm db:migrate` again, so the generated migration applies.
6. Run `pnpm run generate:types`.

**Verify:**
```bash
grep -n '"shipByDate"\|"transitDays"\|"deliveredSource"\|customerLocationTransitTime' packages/database/src/types.ts | head
# Expected: matches for job.shipByDate, shippingMethod.transitDays, shipment.deliveredSource, the new table
pnpm --filter @carbon/database test -- migration.test.ts
# Expected: pass
```

If `crbn up` or `pnpm db:migrate` fails, STOP and report. Do not reset the database.

**Out of scope:** `pnpm db:check:datasets` and `pnpm db:check:backups` run in the pre-commit hook. Fix what they report; do not skip the hook.

---

## Task 5: Add the pure planners and guards, with tests

**Depends on:** Task 1
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.utils.ts` — add `planShipByDates`, `estimateArrival`
- Modify: `apps/erp/app/modules/inventory/inventory.utils.ts` — add `summarizeTransitStats`, `shipmentDeliveryRefusal`
- Create: `apps/erp/app/modules/sales/sales.ship-by.test.ts`
- Create: `apps/erp/app/modules/inventory/inventory.delivery.test.ts`
- Copy from (precedent): `nextDeliveryDateRecord` in `sales.utils.ts` and its tests

**Steps:**
1. Add `estimateArrival(shipBy: string | null, transitDays: number | null, holidays): string | null`. Return `addBusinessDays(shipBy, transitDays, holidays)`, or null when either input is null.
2. Add `planShipByDates(args: { arriveBy: string | null; transitDays: number | null; holidays: ReadonlySet<string>; lines: { id; salesOrderLineType; sentComplete; promisedDate }[] })`.
3. `planShipByDates` returns, for each line, `{ id, promisedDate, proposedShipBy, estimatedArrival, lateToArrive, changes }`:
   - `proposedShipBy` = `subtractBusinessDays(arriveBy, transitDays)`, or null when either input is null.
   - `estimatedArrival` = `estimateArrival(promisedDate, transitDays)`.
   - `lateToArrive` = `estimatedArrival` is after `arriveBy`.
   - `changes` = the line type is in `DELIVERY_CHECKED_LINE_TYPES`, `sentComplete` is false, `proposedShipBy` is not null, and `proposedShipBy` differs from `promisedDate`.
4. Add `summarizeTransitStats(rows: { postingDate; deliveredDate; estimatedDeliveryDate; promisedArrival }[], holidays)`. Return `{ count, averageDays, byEstimateRate, byPromiseRate, suggestedDays }`. Return `averageDays`, the rates and `suggestedDays` as null when `count` < 5. Round `averageDays` to 1 decimal. `suggestedDays` = `Math.ceil(averageDays)`. A rate skips the rows with no reference date and is null when no row is left.
5. Add `shipmentDeliveryRefusal(shipment: { status; sourceDocument; postingDate; deliveredSource }, args: { deliveredDate: string | null; source: "Manual" | "Carrier"; today: string }): string | null`. Return these messages, in order:
   1. "Only a posted shipment can be marked delivered" — status is not `Posted`.
   2. "Only a sales order shipment can be marked delivered" — `sourceDocument` is not `Sales Order`.
   3. "The delivery date cannot be in the future" — `deliveredDate` is after `today`.
   4. "The delivery date cannot be before the shipment posted" — `deliveredDate` is before `postingDate`.
   5. "A carrier update cannot replace a date a user entered" — `source` is `Carrier` and `deliveredSource` is `Manual`.
   6. Else null.
6. Write tests for each branch of the 4 functions. Include the spec criteria: 3 lines with 1 fully shipped, a 4-shipment window, and an early delivery that counts as on time.

**Verify:**
```bash
pnpm --filter erp test -- sales.ship-by.test.ts inventory.delivery.test.ts
# Expected: all tests pass
```

**Out of scope:** any database call in these files. They stay pure.

---

## Task 6: Add the building blocks `resolveTransitDays` and `recordShipmentDelivery`

**Depends on:** Tasks 4, 5
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.service.ts` — add `TransitLane`, `TransitDays`, `resolveTransitDays`
- Modify: `apps/erp/app/modules/inventory/inventory.service.ts` — add `recordShipmentDelivery`

**Steps:**
1. Add the types and `resolveTransitDays(db: Kysely<KyselyDatabase>, lane: TransitLane)` exactly as spec section 2 defines them.
2. Read the override with one query on `customerLocationTransitTime` (`companyId`, `customerLocationId`, `shippingMethodId`). Skip the query when `customerLocationId` is null.
3. Read `shippingMethod.transitDays` with one query on `id` and `companyId`.
4. Add a TSDoc comment on `resolveTransitDays` that names the carrier integration seam (spec section 8).
5. Add `recordShipmentDelivery(db, { companyId, shipmentId, deliveredDate, source, userId, today })` in `inventory.service.ts`:
   1. Read the shipment row `FOR UPDATE` by `id` and `companyId`.
   2. Return `{ error: message }` when `shipmentDeliveryRefusal` returns a message.
   3. Update `deliveredDate`, `deliveredSource` (null when `deliveredDate` is null), `updatedBy` and `updatedAt`.
   4. Return `{ error: null }`.
6. Add a TSDoc comment: "The only writer of `deliveredDate`. A carrier tracking webhook calls it with `source: 'Carrier'`."

**Verify:**
```bash
grep -n "export async function resolveTransitDays\|export async function recordShipmentDelivery" apps/erp/app/modules/sales/sales.service.ts apps/erp/app/modules/inventory/inventory.service.ts
# Expected: 2 matches
pnpm --filter @carbon/checks no-db-client-in-service 2>&1 | tail -3
# Expected: no failure for sales.service.ts or inventory.service.ts (if the script name differs, run `pnpm --filter @carbon/checks` and read its script list)
```

**Out of scope:** the callers (Tasks 9 to 14).

---

## Task 7: Add transit days and the measured statistics to the shipping method

**Depends on:** Task 6
**Files:**
- Modify: `apps/erp/app/modules/inventory/inventory.models.ts:543-551` — add `transitDays: zfd.numeric(z.number().int().min(0).optional())`
- Modify: `apps/erp/app/modules/inventory/inventory.service.ts:4776` — `upsertShippingMethod` saves `transitDays` (null when empty)
- Modify: `apps/erp/app/modules/inventory/inventory.server.ts` — add `getShippingMethodTransitStats` and `applyShippingMethodTransitSuggestion`
- Modify: `apps/erp/app/modules/inventory/ui/ShippingMethods/ShippingMethodForm.tsx` — the **Transit Days** field and the statistics line
- Modify: `apps/erp/app/routes/x+/inventory+/shipping-methods.$shippingMethodId.tsx` — load the statistics; handle the **Use N days** intent
- Modify: `apps/erp/app/modules/inventory/ui/ShippingMethods/ShippingMethodsTable.tsx` — a **Transit Days** column
- Copy from (precedent): the other fields of `ShippingMethodForm.tsx`; a `Number` input from `@carbon/form` used in a sibling inventory form

**Steps:**
1. Add `transitDays` to the validator and to the form with `<Number name="transitDays" label={t`Transit Days`} minValue={0} />`.
2. Add `getShippingMethodTransitStats` (`permission: { view: "inventory" }`):
   1. Read the shipments: `status = 'Posted'`, `sourceDocument = 'Sales Order'`, this `shippingMethodId`, `deliveredDate` not null, `postingDate` ≥ company today − 90 days.
   2. Join `salesOrderShipment` on `shipment.sourceDocumentId` to read `receiptPromisedDate` as `promisedArrival`.
   3. Read holidays with `getHolidayDates` for the same 90 days plus the latest delivered date.
   4. Return `summarizeTransitStats(rows, holidays)`.
3. Add `applyShippingMethodTransitSuggestion` (`permission: { update: "inventory" }`). It recomputes the statistics and saves `suggestedDays`. It refuses when `suggestedDays` is null.
4. In the route loader, load the statistics only for an existing shipping method.
5. In the form, show the line from spec section 7. Show "Not enough deliveries yet" when `count` < 5.
6. The **Use N days** button submits `intent=applyTransitSuggestion` to the same route. The action calls `applyShippingMethodTransitSuggestion`.
7. Format each rate as a whole percent with `Intl.NumberFormat` of the user's locale.

**Verify:**
```bash
pnpm --filter erp test -- inventory.models.test.ts
# Expected: pass
```
Browser check in Task 19: save 5, see 5; -1 is refused.

**Out of scope:** the shipping method new route gets the field through the shared form, nothing else.

---

## Task 8: Add the transit overrides on the customer Shipping tab

**Depends on:** Task 6
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.models.ts` — `customerLocationTransitTimeValidator` (`id` optional, `customerLocationId`, `shippingMethodId`, `transitDays` int ≥ 0)
- Modify: `apps/erp/app/modules/sales/sales.service.ts` — `getCustomerLocationTransitTimes`, `upsertCustomerLocationTransitTime`, `deleteCustomerLocationTransitTime`
- Modify: `apps/erp/app/modules/sales/sales.server.ts` — 3 operations with `view`, `create`/`update` and `delete` on `sales`
- Create: `apps/erp/app/modules/sales/ui/Customer/CustomerTransitTimes.tsx`, `CustomerTransitTimeForm.tsx`
- Create: `apps/erp/app/routes/x+/customer+/$customerId.shipping.transit.new.tsx`, `$customerId.shipping.transit.$transitTimeId.tsx`, `$customerId.shipping.transit.delete.$transitTimeId.tsx`
- Modify: `apps/erp/app/routes/x+/customer+/$customerId.shipping.tsx` — load the overrides, render the card and an `<Outlet />`
- Modify: `apps/erp/app/utils/path.ts` — 3 path helpers
- Copy from (precedent): `CustomerContacts` + `CustomerContactForm` and the routes `$customerId.contacts.new.tsx`, `$customerId.contacts.$customerContactId.tsx`, `$customerId.contacts.delete.$customerContactId.tsx`

**Steps:**
1. Copy the contacts routes and components. Rename each entity to the transit time.
2. The card lists the ship-to address name, the shipping method name and the transit days. It has a **New** button.
3. The drawer form has the `CustomerLocation` picker (scoped to this customer), the `ShippingMethod` picker (`apps/erp/app/components/Form/ShippingMethod.tsx`) and **Transit Days**.
4. The upsert refuses a ship-to address of another customer: check `customerLocation.customerId` against the route's `customerId`.
5. A duplicate pair returns the message "This ship-to address already has transit days for this shipping method".
6. The delete route uses `ConfirmDelete`, as the contacts delete route does.

**Verify:**
```bash
pnpm --filter erp test -- sales.models.test.ts
# Expected: pass
```
Browser check in Task 19.

**Out of scope:** the customer location drawer. The list lives on the Shipping tab (spec Closest Sibling deviation).

---

## Task 9: Set the arrive-by date in quote → order

**Depends on:** Task 6
**Files:**
- Modify: `apps/erp/app/modules/shared/shared.service.ts` (around lines 10035-10052, `convertDocument`)

**Steps:**
1. Before the `salesOrderShipment` insert, call `resolveTransitDays(trx, lane)`. The lane uses `quoteShipping.data.shippingMethodId`, the new order's `customerLocationId`, the shipment `locationId` and the latest line `promisedDate`.
2. If the result is not null, read holidays for the latest line date + 60 days. Set `receiptPromisedDate = addBusinessDays(latest, transitDays, holidays)`.
3. Else keep today's value.
4. Keep the `receiptRequestedDate` fallback: the quote's date, else the new `receiptPromisedDate`.
5. Update the code comment above the block to say that arrive-by = ship-by + transit days.

If `convertDocument` reads holidays inside the Kysely transaction, read them with a Kysely query on `holiday` there. Do not call a Supabase client inside the transaction.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors (main agent only)
```
Browser check in Task 19: the quote criterion of the spec.

**Out of scope:** the line `promisedDate` of quote → order. It stays today + lead time.

---

## Task 10: Default the ship-by date on a new sales order line

**Depends on:** Task 9
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.server.ts:2351` — `createSalesOrderLine`

**Steps:**
1. If the input has no `promisedDate` and the line type is in `DELIVERY_CHECKED_LINE_TYPES`, read the order's `salesOrderShipment` (`receiptPromisedDate`, `shippingMethodId`, `locationId`) and its ship-to (`resolveSalesOrderShipTo`).
2. Call `resolveTransitDays`. If the arrive-by date and the transit days are known, set `promisedDate = subtractBusinessDays(arriveBy, transitDays, holidays)`.
3. Do steps 1 and 2 before the call to `service.deliveryDateForSave`, so the delivery date check reads the default date.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors (main agent only)
```

**Out of scope:** `updateSalesOrderLine`. A user's date on an edit stays as the user typed it.

---

## Task 11: Add the ship-by recalculation prompt

**Depends on:** Task 10
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.server.ts` — `getSalesOrderShipByDates` (`view: sales`), `recalculateSalesOrderShipByDates` (`update: sales`)
- Create: `apps/erp/app/routes/x+/sales-order+/$orderId.ship-by-dates.tsx`
- Create: `apps/erp/app/modules/sales/ui/SalesOrder/ShipByRecalculateModal.tsx`
- Modify: `apps/erp/app/modules/sales/ui/SalesOrder/SalesOrderProperties.tsx` — open the modal check after a `receiptPromisedDate` save
- Modify: `apps/erp/app/modules/sales/ui/SalesOrder/SalesOrderShipmentForm.tsx` — open the modal check after a successful save
- Modify: `apps/erp/app/utils/path.ts` — `salesOrderShipByDates(id)`
- Copy from (precedent): `ConfirmDelete`'s modal shape (`apps/erp/app/components/Modals`), and a `useFetcher` resource route in `x+/sales-order+/`

**Steps:**
1. `getSalesOrderShipByDates` reads the order's arrive-by date, the lane, the holidays and the lines. It returns `planShipByDates(...)` and the transit days.
2. `recalculateSalesOrderShipByDates` takes `{ salesOrderId }`. In one `ctx.transaction`:
   1. Compute the plan again.
   2. Update `promisedDate` on each line with `changes` true.
3. After the transaction, run `checkSalesOrderDeliveryDates` with `capacity: "defer"` for the changed line ids.
4. The route loader returns `{ changes: number, lines }`. The route action calls the recalculation and returns `{ success: true }`.
5. The modal shows "Recalculate the ship date on {N} lines?" with **Recalculate** and **Keep dates**.
6. In `SalesOrderProperties`, after the `receiptPromisedDate` fetcher returns success, load the route. Open the modal when `changes` > 0.
7. In `SalesOrderShipmentForm`, do step 6 after a save that changed `receiptPromisedDate`, `shippingMethodId` or the drop-ship `customerLocationId`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors (main agent only)
```
Browser check in Task 19: "No" leaves 3 lines, "Yes" moves them, a shipped line keeps its date.

**Out of scope:** a change of the header ship-to on `salesOrder` (not drop-ship). If the Properties panel can change `customerLocationId`, add the same check there. If it cannot, skip it.

---

## Task 12: Show "Late to arrive" on the sales order lines

**Depends on:** Task 11
**Files:**
- Modify: the sales order route loader that feeds `SalesOrderExplorer` (find it: `grep -rn "SalesOrderExplorer" apps/erp/app/routes`) — add `shipByPlan` from `getSalesOrderShipByDates`
- Modify: `apps/erp/app/modules/sales/ui/SalesOrder/SalesOrderExplorer.tsx` — add `LateToArriveFlag` next to `DeliveryDateFlag` (line 450)
- Modify: `apps/erp/app/modules/sales/ui/SalesOrder/SalesOrderLineForm.tsx` — an `Alert` near `DeliveryDateCheckAlert` (line 868) when the line is late to arrive
- Copy from (precedent): `DeliveryDateFlag` in `SalesOrderExplorer.tsx:339-385`

**Steps:**
1. Return `shipByPlan` from the loader as a promise, if the loader already defers data. Else return it as data.
2. `LateToArriveFlag` takes the line's plan entry. It renders nothing unless `lateToArrive` is true.
3. The tooltip text is "Late to arrive: estimated {date}, promised {arriveBy}".
4. The form alert uses the same text and the existing `Alert` variant of `DeliveryDateCheckAlert`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors (main agent only)
```

**Out of scope:** the `DeliveryDateFlag` logic. Do not change it.

---

## Task 13: Store the estimated delivery date when a sales shipment posts

**Depends on:** Task 6
**Files:**
- Modify: `apps/erp/app/modules/inventory/inventory.service.ts` — `postShipment`, `case "Sales Order"` (around line 20520)

**Steps:**
1. Before the update that sets `status: "Posted"`, build the lane from the shipment: `shippingMethodId`, `locationId`, `postingDate: today`, and the ship-to from `resolveSalesOrderShipTo` for `sourceDocumentId`.
2. Call `resolveTransitDays(trx, lane)`.
3. If the result is not null, read holidays from `today` to `today` + 60 days with a Kysely query on `holiday`. Set `estimatedDeliveryDate = addBusinessDays(today, transitDays, holidays)` in the same update.
4. If `resolveSalesOrderShipTo` needs a Supabase client, call it before the transaction starts. Pass its result in.

If the posting code has no point before the transaction where the shipment is known, STOP and report.

**Verify:**
```bash
pnpm --filter erp test -- inventory
# Expected: the existing inventory tests still pass
```

**Out of scope:** the void branch. A void leaves both dates (spec section 6).

---

## Task 14: Add Mark Delivered and the delivery dates on the shipment screens

**Depends on:** Task 13
**Files:**
- Modify: `apps/erp/app/modules/inventory/inventory.models.ts` — `shipmentDeliveredValidator` (`deliveredDate` optional string)
- Modify: `apps/erp/app/modules/inventory/inventory.server.ts` — `markShipmentDelivered` (`update: inventory`)
- Create: `apps/erp/app/routes/x+/shipment+/$shipmentId.delivered.tsx`
- Create: `apps/erp/app/modules/inventory/ui/Shipments/ShipmentDeliveredModal.tsx`
- Modify: `apps/erp/app/modules/inventory/ui/Shipments/ShipmentHeader.tsx` — the button and the 2 meta entries
- Modify: `apps/erp/app/modules/inventory/ui/Shipments/ShipmentsTable.tsx` — 2 date columns
- Modify: `apps/erp/app/utils/path.ts` — `shipmentDelivered(id)`
- Copy from (precedent): `ShipmentPostModal.tsx:301-313` (the **Delivered on** DatePicker with `maxValue`), `ShipmentVoidModal.tsx` (the modal shell)

**Steps:**
1. `markShipmentDelivered` takes `{ shipmentId, deliveredDate }`. It reads company today and calls `recordShipmentDelivery` with `source: "Manual"` in a `ctx.transaction`. It maps the refusal to `ctx.error("conflict", message)`.
2. The route action validates the form and calls the operation. It redirects back with a flash message.
3. The modal has one **Delivered on** DatePicker. Its default is `useCompanyToday()`, with `maxValue` = company today and `minValue` = `postingDate`. It has a **Clear** button when a date exists.
4. Show the **Mark Delivered** button in `ShipmentHeader` `actions` when the shipment is Posted and `sourceDocument` is `Sales Order`. Gate it on `permissions.can("update", "inventory")`. After delivery, the label is **Edit Delivery**.
5. Add the meta entries: "Arrives {date} (estimated)" when `estimatedDeliveryDate` is set and `deliveredDate` is null. "Delivered {date}" when `deliveredDate` is set.
6. Add the **Estimated Delivery** and **Delivered** columns to `ShipmentsTable` with the date cell the table uses for `postingDate`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors (main agent only)
```

**Out of scope:** a carrier webhook route. The integration adds it.

---

## Task 15: Show the ship countdown on the MES screens

**Depends on:** Task 6
**Files:**
- Create: `apps/mes/app/components/ShipCountdown.tsx` — the label component
- Modify: `apps/mes/app/components/Kanban/types.ts:41` — `shipByDate: z.string().nullable().optional()` on `itemValidator`
- Modify: `apps/mes/app/components/Kanban/components/ItemCard.tsx:307-347` — render `ShipCountdown` next to the "Due" text
- Modify: `apps/mes/app/routes/x+/operations.tsx:446-464` — map `shipByDate: op.jobShipByDate`; carry it through `collapseBatches` (take the earliest date of a batch)
- Modify: `apps/mes/app/services/operations.service.ts:163` — add `shipByDate` to the `getOpenJobs` select
- Modify: `apps/mes/app/routes/x+/jobs.tsx` — the loader returns the plant's today; render `ShipCountdown` at lines 256-260 and 336-340
- Modify: `apps/mes/app/routes/x+/assigned.tsx` — the loader returns the plant's today; map `shipByDate: operation.jobShipByDate`; pass `today` to `OperationsList`
- Modify: `apps/mes/app/components/OperationsList.tsx:121-123,187-215` — take `today` and render `ShipCountdown`
- Copy from (precedent): `ItemCard.tsx:102-119` (today and the overdue tone), `operations.tsx:286-290` (the plant's today)

**Steps:**
1. `ShipCountdown` takes `{ shipByDate, today, status }`. It calls `getShipCountdown`. It renders nothing for a null result or for the job status `Completed` or `Cancelled`.
2. It renders the labels of spec section 5 with Lingui plurals: `plural(days, { one: "Ships in # day", other: "Ships in # days" })`, "Ships tomorrow", "Ships today", and `plural(-days, { one: "# day late", other: "# days late" })`.
3. It uses the existing text tones: the red class of the overdue "Due" text for `late`, an amber text class for `warning`. Find the amber class in `apps/mes/app/components` before you add one.
4. In `assigned.tsx`, compute today as `operations.tsx` does: `datetime.today(await getLocationTimeZone(serviceRole, locationId, companyId))`. Return it from the loader, so `ItemCard`'s `useRouteData` fallback is not used.
5. In `OperationsList`, keep the existing `isOverdue` logic. Only add the countdown.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: 0 errors
pnpm --filter mes test
# Expected: pass
```

**Out of scope:** the sort orders and `isOverdue`. Picking lists (spec Q5).

---

## Task 16: Add the glossary terms and the translations

**Depends on:** Tasks 7 to 15
**Files:**
- Modify: `docs/content/src/glossary/terms.ts` — 5 terms near lines 1140-1150, 1946-1950 and 1564
- Modify: each `termId` in the new form fields
- Modify: `packages/locale/locales/*/*.po` (through the tools)

**Steps:**
1. Add the terms `shipping-method-transit-days`, `customer-location-transit-time`, `shipment-estimated-delivery-date`, `shipment-delivered-date`, `job-ship-by-date`. Write each definition in one STE-80 sentence.
2. Edit `sales-order-shipment-receipt-promised-date`: "When the goods must reach the customer. Carbon subtracts the transit days to get each line's ship-by date."
3. Set `termId` on the **Transit Days** fields and the **Delivered on** field.
4. Run `pnpm --filter @carbon/locale lingui:extract` (if the script name differs, read `packages/locale/package.json`).
5. Run `/translate` to fill the empty `msgstr` entries.

**Verify:**
```bash
git diff --stat packages/locale/locales | tail -1
# Expected: the .po files changed
grep -c 'msgstr ""' packages/locale/locales/de/*.po
# Expected: the same count as on main, or lower
```

**Out of scope:** docs pages beyond the glossary.

---

## Task 17: Update the module AGENTS.md files

**Depends on:** Task 16
**Files:**
- Modify: `apps/erp/app/modules/sales/AGENTS.md` — the transit lookup, the arrive-by and ship-by rule, the override table, the recalculation
- Modify: `apps/erp/app/modules/inventory/AGENTS.md` — `estimatedDeliveryDate`, `recordShipmentDelivery` as the only writer, the statistics
- Modify: `apps/erp/app/modules/production/AGENTS.md` — `job.shipByDate` and its 2 triggers
- Modify: `apps/mes/AGENTS.md` if it lists the board fields — the countdown

**Steps:**
1. Add one short section to each file. Name each function, table and trigger exactly.
2. State the integration seams in the sales and inventory files.

**Verify:**
```bash
grep -n "resolveTransitDays\|recordShipmentDelivery\|shipByDate" apps/erp/app/modules/*/AGENTS.md
# Expected: matches in sales, inventory, production
```

**Out of scope:** `.claude/rules/` files, unless a rule names a changed function.

---

## Task 18: Run the full gates

**Depends on:** Task 17
**Steps:**
1. Run `pnpm run lint`.
2. Run `pnpm exec turbo run typecheck --filter=erp --filter=mes --filter=@carbon/utils`.
3. Run `pnpm --filter erp test`, `pnpm --filter mes test`, `pnpm --filter @carbon/utils test`.
4. Run `pnpm generate:mcp`, then `pnpm check:manifest`.
5. Run `pnpm --filter @carbon/checks license-headers`.
6. Run `pnpm db:check:datasets` and `pnpm db:check:backups`.

**Verify:**
```bash
pnpm check:manifest
# Expected: exit code 0
```

---

## Task 19: Browser-verify the flows

**Depends on:** Task 18
**Steps:**
1. Run `/test` against the running stack. Run `/auth` first.
2. Test the edge cases of the spec criteria first:
   1. -1 transit days is refused.
   2. An override wins over the shipping method.
   3. "Keep dates" changes nothing.
   4. A shipped line keeps its date after "Recalculate".
   5. **Mark Delivered** refuses tomorrow.
   6. A 4-shipment method shows "Not enough deliveries yet".
   7. A late job shows "N days late" on the MES board.
3. Save screenshots under `.context/`.

If the stack cannot start, record the flows as not verified. Do not claim them done.

---

## Task 20: Self-review the branch

**Depends on:** Task 19
**Steps:**
1. Run `/self-review` on `git diff origin/main...`.
2. Fix each Must-fix item. Run the gates of Task 18 again for the files you changed.
3. Update the spec changelog with each deviation from this plan.
