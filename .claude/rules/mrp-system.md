---
description: MRP (Material Requirements Planning) — run flow, data model, planning UI
paths:
  - "packages/jobs/src/inngest/functions/scheduled/mrp.ts"
  - "packages/planning/src/mrp/**"
  - "packages/database/supabase/functions/lib/mrp-engine.ts"
  - "apps/erp/app/modules/{production,purchasing}/ui/Planning/**"
---

# MRP (Material Requirements Planning)

MRP nets demand against supply per item/location/period and projects on-hand
forward so users can create planned purchase orders (purchasing) and jobs
(production). It runs **IN-PROCESS in Node** via `runMrp` (exported from
`@carbon/planning`, source `packages/planning/src/mrp/mrp.ts`), driven
either by an **Inngest** scheduled cron or a manual route POST — NOT a Supabase
edge function (the old `mrp` Deno function and its `config.toml` entry were
DELETED), and NOT Trigger.dev. `runMrp(client, db, payload)` takes an injected
service-role Supabase client (PostgREST reads) and a Kysely handle (the atomic
Phase-7 write) and throws on failure.

## Run flow (inputs → compute → outputs)

1. **Scheduled job** — `packages/jobs/src/inngest/functions/scheduled/mrp.ts`.
   `inngest.createFunction({ id: "mrp", retries: 2 }, { cron: "0 */3 * * *" }, …)`
   — every 3 hours. A `find-companies` step selects all rows from `company`,
   then **one `step.run` per company** (`mrp-<companyId>`) calls
   `runMrp(serviceRole, getJobDatabaseClient(), { type: "company", id,
   companyId, userId: "system" })` **in-process** (`runMrp` throws on failure;
   the loop try/catches per step and returns `{ companies, failed }`). Every
   Inngest step is one HTTP request to `/api/inngest`, so a step's ceiling is
   that Vercel function's max duration — set project-wide in the Vercel
   dashboard (Settings → Functions), NOT via a route `config` export: a
   `maxDuration` in the route config splits a second server bundle in the
   @vercel/react-router preset and the Vite 8 css-post plugin fails the build
   ("Unable to get file name for unknown file"). All companies in ONE step was one invocation, hit
   `FUNCTION_INVOCATION_TIMEOUT` as the tenant count grew after the
   `company`-enumeration change below, and every retry restarted from company
   #1. There is no location-scoped cron — only company-wide.

   It enumerated `companyPlan` until 2026-08-26. MRP is not in `FEATURE_PLANS`,
   so that was never a billing gate — just a convenient list of companies — but
   the table is only written by Stripe checkout and is seeded nowhere, so every
   self-hosted, community and local-dev install had an empty work list and
   silently never ran MRP, reporting a green Inngest run. Do not reintroduce it:
   the work list is `company`, and a company with no plan row must still run.
   On **Cloud only**, companies whose `stripeSubscriptionStatus` is `'Canceled'`
   are skipped, because `weekly.ts` deletes those. The selection rule is the pure
   `selectCompaniesForMrp` (`scheduled/mrp-companies.ts`), unit-tested in its
   sibling `.test.ts`; the scheduler logs a `warn` when the list comes back
   empty, so "no work" can never again look like "worked fine".

   Both reads go through `fetchAllFromTable` with a stable `.order("id")` — the
   same reason the edge function pages (below): `max_rows = 1000` truncates a
   bare select, and the dev stack does not enforce the cap, so a dropped tail is
   invisible locally. A failed `company` read **throws**; returning would make
   the step succeed having planned for nobody, which is this function's whole
   bug class. A failed `companyPlan` read does not — it leaves `plans` null and
   plans for everyone, which is the fail-safe direction.

2. **Manual trigger** — POST `apps/erp/app/routes/api+/mrp.ts` (permission
   `update: "inventory"`). Reads `?location` query param; calls
   `runMRP(getCarbonServiceRole(), { type: locationId ? "location" : "company",
   id: locationId ?? companyId, companyId, userId })`. `runMRP` lives in
   `apps/erp/app/modules/production/production.service.ts`; it dynamic-imports
   `runMrp` from `@carbon/planning`, gets a Kysely handle via
   `getSchedulingDb()`, calls `runMrp(client, db, params)` **in-process**, and
   preserves the `{ data, error }` shape (catching the throw). The planning tables
   submit to this via `path.to.api.mrp(locationId)`.

3. **In-process engine** — `packages/planning/src/mrp/mrp.ts`
   (`runMrp(client, db, payload)`, Node, ~1130 lines). Reads go through the
   injected service-role Supabase client (PostgREST); the atomic Phase-7 write
   goes through the injected Kysely handle. Payload validator accepts
   `type: "company" | "location" | "item" | "job" | "purchaseOrder" |
   "salesOrder"`, `id?` (required for non-company), `companyId`, `userId`.
   Computation engine is
   `packages/database/supabase/functions/lib/mrp-engine.ts` (`explodeBom(...)`),
   which STAYS in the edge-lib (still used by the Deno `recalculate` function +
   job-quantities-engine) and is reached from Node via the
   `@carbon/database/mrp-engine` barrel.

   - **Periods**: generates/fetches weekly `period` rows ~18 weeks (126 days)
     forward from today (`"Week"` granularity). <!-- UNVERIFIED: exact week count not re-confirmed line-by-line; old doc said 72, code comment said 18 -->
   - **Inputs (demand)**: views `openSalesOrderLines`, `openJobMaterialLines`,
     plus the user-entered `demandProjection`. Don't conflate it with the
     output: MRP reads `demandProjection` (user-entered) and **writes
     `demandForecast`** (rebuilt each run — see Outputs below).
   - **Forecast consumption** (`forecast-consumption.ts`, wired in Phase 4):
     actual demand consumes the projections for the same (item, location) —
     own weekly bucket first, then backward
     `companySettings.forecastConsumptionBackwardPeriods` (default 4) then
     forward `forecastConsumptionForwardPeriods` (default 1) buckets. Only the
     unconsumed remainder enters gross demand/contributors; SO lines consume at
     `openSalesOrderLines.quantityToConsume` (PRE-job-dedup, so an MTO line
     covered by its job still consumes) while demand still uses the deduped
     `quantityToSend`; job materials consume at `quantityToIssue`. Runs BEFORE
     the Phase-4.5 supersession redirect on purpose (read paths don't redirect
     either). Phase 7 persists `demandProjection.consumedQuantity` (batched
     `UPDATE … FROM (VALUES …)`, an UPDATE never an upsert) and every read
     path nets with `GREATEST("forecastQuantity" - "consumedQuantity", 0)`:
     both planning RPCs, `generatePlanningActions`' union,
     `get_inventory_quantities`, and `getItemDemand`. Regenerative: nothing to
     un-consume — cancelled orders/edited forecasts re-net on the next run.
     Unit tests: `forecast-consumption.test.ts`. Spec:
     `.ai/specs/2026-09-11-demand-forecast-consumption.md`.
   - **Inputs (supply)**: views `openProductionOrders`, `openPurchaseOrderLines`.
   - **Inputs (on-hand)**: the `itemStockQuantities` table (trigger-maintained,
     `20260812002454`) — an indexed per-company read, replacing the old full
     `itemLedger` GROUP BY that grew with total history. Excludes `Rejected`
     tracked stock (matching `get_inventory_quantities`); the raw scan counted it.
   - **Reads paginate**: every PostgREST read goes through `fetchAll`
     (`@carbon/database/fetch-all`, 1000-row pages + stable `.order()`) —
     production `max_rows = 1000`
     truncates bare `.select("*")` reads, and the dev stack does NOT enforce
     the cap, so truncation is invisible locally.
   - **Writes are atomic**: the Phase-7 delete-and-rewrite of
     `demandForecast`/`demandForecastSource`/`supplyForecast` + actual inserts
     runs in ONE Kysely transaction — a failed run leaves prior planning data
     intact.
   - **Key encoding**: every composite map key goes through `makeKey` /
     `makeLocationItemKey` / `makeActualKey` in `lib/mrp-engine.ts` (joined on
     `KEY_SEP = "\x1f"`). Never build `${a}-${b}` keys — ids are caller-supplied
     TEXT (imports mint hyphenated UUIDs); "-"-joined keys truncated them on
     parse and MRP 500'd for those tenants (Postgres 21000). Regression tests:
     `lib/mrp-engine.test.ts` (deno test).
   - **BOM explosion**: for `Make` items, explodes the active make method to
     derive child demand with low-level-code ordering, per-period inventory
     netting, and lead-time offsetting.
   - **Outputs (DB writes)**: deletes prior MRP forecast rows, then batch-inserts
     (500/chunk) `demandForecast` (`forecastMethod: "mrp"`), `demandForecastSource`
     (lineage), `demandActual`, and `supplyActual`. Writes are stamped with the
     payload `userId` (`"system"` for cron).

## Planning data model (tables — all in newest schema)

Base tables defined in `20250610000433_demand-planning.sql`; lineage table in
`20260527110002_demand-forecast-source.sql`.

| Table | PK | Key cols | Notes |
|-------|----|----|-------|
| `period` | `id` | `startDate`, `endDate`, `periodType` | enum `'Week'\|'Day'\|'Month'`; no companyId (uniform RLS) |
| `demandProjection` | `(itemId, locationId, periodId)` | `forecastQuantity`, `consumedQuantity` | user-authored forecast; `consumedQuantity` is MRP-written derived state (`20260911150012`), never user-edited |
| `demandForecast` | `(itemId, locationId, periodId)` | `forecastQuantity`, `forecastMethod` | MRP writes `forecastMethod='mrp'` |
| `demandActual` | `(itemId, locationId, periodId, sourceType)` | `actualQuantity`, `sourceType` | `sourceType` enum `demandSourceType` = `'Sales Order'\|'Job Material'` |
| `supplyForecast` | `(itemId, locationId, periodId)` | `forecastQuantity`, `forecastMethod` | written by **planning.update** routes (planned POs/jobs), not by MRP |
| `supplyActual` | `(itemId, locationId, periodId, sourceType)` | `actualQuantity`, `sourceType` | `sourceType` enum `supplySourceType` = `'Purchase Order'\|'Production Order'` |
| `demandForecastSource` | surrogate `id` | `sourceType`, `jobId`/`salesOrderLineId`/`demandProjectionId`, `parentItemId`, `quantity` | MRP lineage; enum `demandForecastSourceType` = `'Job Material'\|'Sales Order'\|'Demand Projection'`; CHECK exactly one source id set |

`locationId` is declared `TEXT` (no `NOT NULL`) on all five planning tables, but
it is part of the PRIMARY KEY of every one of them (see the PK column above), so
Postgres makes it **implicitly NOT NULL** — a null `locationId` raises 23502, and
it is also an FK to `location(id)`, so a bogus value (e.g. the empty string
`runMrp` used to write via a `?? ""` key fallback for a source line with no
location) raises 23503 `*_locationId_fkey` and rolls the whole run back. `runMrp`
therefore SKIPS any source line (sales/job-material/production/PO/projection) with
no `locationId` rather than fabricating one. Audit cols (`createdBy/At`,
`updatedBy/At`) present except on `period` and `demandForecastSource`
(created-only).

## Planning split functions

Latest definition of BOTH: `20260911150012_demand-forecast-consumption.sql`
(supersedes `20260715195226` for production, `20260831190142` for purchasing).
Their `demand_data` CTEs read the projection arm net of consumption
(`GREATEST("forecastQuantity" - "consumedQuantity", 0)`).

- `get_purchasing_planning(company_id, location_id, periods[])` — items where
  `replenishmentSystem != 'Make'` (includes "Buy" and "Buy and Make"),
  `itemTrackingType != 'Non-Inventory'`, `active`.
- `get_production_planning(company_id, location_id, periods[])` — items where
  `replenishmentSystem = 'Make'` (same other filters).
- Both union `supplyActual`+`supplyForecast` and `demandActual`+`demandForecast`,
  project on-hand period-by-period (`week1`…`week52`), and compute `quantityToOrder`
  via `calculate_quantity_to_order(...)`, which branches on `reorderingPolicy`:
  `'Manual Reorder'` → 0; `'Demand-Based Reorder'`; `'Fixed Reorder Quantity'`;
  `'Maximum Quantity'`. All respect min/max OQ, `orderMultiple`, `lotSize`.

## "Buy and Make" coercion + BOM decision

In `mrp-engine.ts`, `effectiveReplenishment()` coerces `"Buy and Make"` → `"Buy"`
before processing, so "Buy and Make" items are never exploded — their demand flows
to purchasing planning. Only `replenishmentSystem = 'Make'` items explode their BOM
to child demand. Note current `methodType` enum is
`'Make to Order' | 'Pull from Inventory' | 'Purchase to Order'`
(NOT the old `'Make'/'Pick'/'Buy'` names).

## Source views (open demand/supply)

Newest defs in `20260417000300_storage-unit-recreate-dependents.sql`
(`openPurchaseOrderLines` in `20260529074512_open-po-lines-required-date.sql`,
`openSalesOrderLines` in `20260710051147_mto-sales-lines-drive-demand.sql`).
All join through `itemReplenishment` to expose `replenishmentSystem`, `leadTime`,
`itemTrackingType`.

- `openSalesOrderLines` — `salesOrderLineType != 'Service'`, status IN
  `('To Ship','To Ship and Invoice')`. Newest def:
  `20260911150012_demand-forecast-consumption.sql`. Make to Order lines ARE
  included, but their `quantityToSend` is netted down by the remaining output
  (`quantity − quantityReceivedToInventory − quantityShipped`) of live jobs
  linked via `job.salesOrderLineId` (statuses Planned/Ready/In Progress/Paused —
  the same set as `openJobMaterialLines`, so each unit is counted exactly once:
  SO line while unjobbed, job materials once a job is released, inventory once
  produced). Draft/Cancelled jobs do not suppress line demand. The view also
  exposes `quantityToConsume` — the PRE-job-dedup open quantity, used only by
  forecast consumption (a job-covered MTO line still consumes forecast).
- `openJobMaterialLines` — job status IN `('Planned','Ready','In Progress','Paused')`,
  `methodType != 'Make to Order'`.
- `openProductionOrders` — job status IN those 4, `salesOrderId IS NULL`
  (make-to-stock jobs only); `quantityToReceive = productionQuantity − received`.
- `openPurchaseOrderLines` — `purchaseOrderLineType != 'Service'`, status IN
  `('To Receive','To Receive and Invoice','Planned')`; `dueDate` = requiredDate
  (falls back to receiptPromisedDate).

## Planning UI

- Production: `apps/erp/app/routes/x+/production+/planning.tsx`
  (`view: "production"`) + `ProductionPlanningTable` under
  `apps/erp/app/modules/production/ui/Planning/`.
- Purchasing: `apps/erp/app/routes/x+/purchasing+/planning.tsx`
  (`view: "purchasing"`) + `PurchasingPlanningTable` under
  `apps/erp/app/modules/purchasing/ui/Planning/`.
- **Weeks are one column, not 48.** Both grids render the per-period projection
  (`week1`…`weekN`) as a single **Stock Availability** strip
  (`modules/production/ui/Planning/PlanningWeekStrip.tsx`): a small column
  chart on a zero line — stock above it in a neutral tone, a shortfall hanging
  below it in red, a tick on the line for an exact zero, nothing when MRP wrote
  no projection. Red is the only hue, so a healthy row stays quiet and sign is
  carried by direction as well as colour (it replaced a flat red / grey / green
  strip that said nothing about depth and turned a short row into a wall of
  colour). Each row is scaled to its OWN range (`planningWeekGeometry`,
  `planning-week-geometry.ts`, unit-tested): heights compare along a row, not
  between rows. One tooltip per row follows the hovered week (the shared
  `TooltipContent` takes an `anchor` for this) and shows the week label, its
  date range and the projected quantity; the hovered week is marked by an
  overlay band that is cleared on `pointerleave` — it used to stay on the last
  week touched. The per-week numbers stay in the CSV as
  `exportOnlyColumn`s keyed `week1`…`weekN`, so an export is unchanged.
- **Latest Order Date** (both grids, after Qty to Order): the last day the
  row's NEXT planned order can be placed and still arrive on time — the date
  the supply is required less the item's lead time. It is the `startDate` of
  the earliest planned order from `getNextPlannedOrder`
  (`items/ui/Item/ItemReorderPolicy.tsx`), which reads the same cached
  `calculateOrders` sizing the order drawer uses, so grid and drawer cannot
  disagree. Red once the day has passed (the order's `isASAP`); "-" when
  nothing needs ordering. The tooltip shows the required date and lead time;
  the CSV carries the ISO date. Cell: `ui/Planning/LatestOrderDate.tsx`.
- Both have a "Recalculate" button (`mrpFetcher.Form` POST to
  `path.to.api.mrp(locationId)`) tooltip: *"MRP runs automatically every 3 hours,
  but you can run it manually here."*
- **Planning actions (the MRP worklist, spec §P1.7) live INSIDE each grid**, not
  in a separate list. Both routes load the location's persisted `planningAction`
  rows (`getPlanningActions`, Buy/Make by kind) and pass them to the grid, which
  renders an **Actions** column (one ICON chip per open type with a count and
  the type name in a tooltip, the ASAP flag, a muted dismissed chip; always one
  line so busy rows are no taller than the rest; static type filter) and an
  **expandable row** (`renderExpandedRow`/`canExpandRow`, gated to items with
  actions) listing the item's actions as child lines — type, target PO/job
  hyperlink, quantity, `DateTime` (red when past), reason, assignee — each with
  ONE button: **Apply** (open change action on an uncommitted target), **Review
  on PO/Job** (`requiresManualAction`), or **Order…/Make…** (opens the grid's
  order drawer; Order/Make rows are fulfilled by the existing Order button, never
  applied as a change). A per-line ⋯ holds Assign to Me and Dismiss/Reopen. The
  bulk menu gains **Apply Suggested Changes** (every applyable action on the
  selected items, ONE batched request). Shared UI:
  `modules/production/ui/Planning/PlanningActionLines.tsx`; every mutation posts
  to the existing `planning.update.tsx` cases (`apply`/`dismiss`/`reopen`/`assign`).
  The Actions column filter (`filter=planningActions:eq:<type>`) and the
  `headerActions` **Assigned to me** switch (`?actions=mine`) are not grid RPC
  columns: the loader strips them with `resolvePlanningActionScope`
  (`ui/Planning/planning-action-scope.ts`, pure, unit-tested) and passes them to
  the grid RPC as ARGUMENTS (`action_types`, `action_assignee`), which keeps the
  items with a matching OPEN action inside the item's planning horizon. The
  loader then reads the actions for the rows ON THE PAGE (`getPlanningActions`
  with `itemIds`, paged). An earlier version loaded the location's first 500
  actions and resolved item ids from them — it silently dropped items past the
  cap and could not see the horizon.
- **Planning horizon (time fence).** `itemPlanning.planningHorizonDays` (per
  item + location, Part → Planning) else `companySettings.defaultPlanningHorizonDays`
  (Settings → Planning) else none. **0 means "no fence"** at either level
  (`NULLIF(COALESCE(item, company), 0)` in the grid RPCs): an item's 0 is how it
  opts out of a company default, which an empty field would inherit. It is not
  "zero days" — that put the fence on today and hid nearly everything. It is a READ-TIME LENS, never an engine input:
  `generatePlanningActions` writes actions for the whole window and stamps each
  with `horizonDate` — the earlier of the target order's current date and the
  suggested date, so a Defer counts from where its order sits today and an
  Expedite from when it is needed — and the grids surface only rows with
  `horizonDate <= today + days`. That is what lets a planner move ONE row's
  fence in the **Time Fence** column (`useTimeFenceOverrides`, page state, gone
  on reload, never written to the item) without an MRP run. Named
  `planningHorizonDays` on purpose: `planningTimeFenceDays` is reserved by the
  MRP v2 spec for the auto-firm fence, a different concept.
  - The fence comparison exists twice and must stay one inclusive `<=` on ISO
    dates: in SQL (`get_*_planning_grid`, the saved horizon, for the Actions
    filter) and in `ui/Planning/planning-fence.ts` (on screen, override
    included; unit-tested). Sort and filter therefore use the SAVED horizon —
    an on-screen override changes what a row shows, not which rows match.
  - Inside the fence: the Actions chips, the expanded row, **Apply Suggested
    Changes**, the row's Order/Make quantity, and a bulk **Order Parts /
    Create Jobs** on rows never opened in the drawer. The drawer opens on the
    suggested orders REQUIRED on or before the fence. A "N More After <date>"
    button EXTENDS the row's fence to the last suggested order rather than
    copying rows in — the fence is the one piece of state, so the order list
    and the grid row follow together. The drawer marks the fence on the chart
    and carries the same Time Fence control as the grid cell.
  - Moving a row's fence DROPS that item's entry in the grid's `ordersMap`
    (`onFenceChange`): the drawer's draft list is kept per item once opened,
    and a stale one would neither show the newly included orders nor offer
    them. That discards manual edits to the draft, by design.
- **The order drawer is two tables with two save models**
  (`ui/Planning/PlanningOrderGrids.tsx`, both on the shared `Grid`), because a
  row that does not exist yet cannot autosave:
  - **Suggested Orders / Suggested Jobs** (`SuggestedOrdersGrid`) — a DRAFT.
    Quantity and due date are click-to-edit; the edits live in the planning
    grid's `ordersMap` and nothing is written until Order / Make. The Order By
    / Start By column is derived (due date less lead time).
  - **Open Orders / Open Jobs** (`OpenOrdersGrid`) — existing PO lines / jobs.
    A cell edit SAVES that one field (optimistic, reverted with a toast on
    failure) through `planning.update`'s `updateLine` / `updateJob` action,
    which re-reads the record under the company and applies the same
    commitment gate as Apply: a PO past Planned, or a job past Planned, returns
    409 and is never edited from planning. Locked rows render as plain cells
    (`Grid isRowEditable`). Each row carries the planning action that targets
    it — type, suggested value, reason, Apply / Review — so there is no
    separate action table. Released jobs (Ready / In Progress / Paused) are
    listed read-only for that reason: an action needs its job's row to sit on.
    An action whose order is not in the list still gets a read-only row.
  - **The order's status is an icon, not a column.** `Status iconOnly`
    (`@carbon/react`, passed through `PurchasingStatus` / `JobStatus`) renders
    the status colour and icon in front of the PO / job number, with the name
    in its tooltip — it says why a row is Review rather than Apply without
    adding row height or a column the drawer has no width for. The drawer
    takes it from the open line / job (`OpenOrdersGrid renderStatusIcon`); the
    grid's expanded row (`PlanningActionLines`) and the drawer's read-only
    fallback rows take it from the action, which `getPlanningActions` enriches
    with `purchaseOrderStatus` / `jobStatus` in the lookups it already makes.
  - Purchasing quantities are in PURCHASE units (the line's
    `purchaseQuantity`; the open-lines view reports inventory units), and an
    action's suggested quantity is converted and rounded up as Apply does. The
    chart still receives existing orders in inventory units.
  - A manual edit does NOT resolve the suggestion on that row: the action stays
    until the next MRP run re-evaluates the order.
  The earlier single list mixed both: an edit to an existing order sat unsaved
  until Order was pressed and was dropped by Close.
- **Grid RPCs are wrappers.** `get_purchasing_planning_grid` /
  `get_production_planning_grid` (`20260930233016_planning-horizon.sql`) select
  `p.*` from the base RPC and add `itemPostingGroupId` (**Item Group** column +
  filter), `planningHorizonDays`, `timeFenceDate`, `firstNegativeDate` (**1st
  Negative On Hand**: the start of the first week whose projection is below
  zero — weekly, because MRP buckets by week) and `latestOrderDate` (the MIN of
  the item's open new-supply actions, which makes **Latest Order Date**
  sortable; the cell still shows the live sizing, equal to it as of the last
  run). The base RPCs stay the one definition of the projection and are what
  `generatePlanningActions` reads. Adding a column to a base RPC means
  re-creating its wrapper with the same column — it fails loudly (return type
  mismatch) until then. Generated types mark every RPC column non-null; the new
  ones are not (`PlanningGridColumns` in `production/types.ts`).
- **Create planned orders** — `planning.update.tsx` in each module:
  - production (`create: "production"`, role `employee`): inserts jobs +
    job methods, upserts `supplyForecast` (`'Production Order'`), then
    `recalculateJobRequirements()`.
  - purchasing (`create: "purchasing"`, role `employee`): one PO per supplier
    per submit — reuses the supplier's open Draft/Planned `Purchase` PO whose
    delivery location is the planning location (header lookup, not a
    line-in-period match), else inserts one. Lines are matched on item +
    `requiredDate`, so orders for different weeks stay as separate lines on
    the same PO. Upserts `supplyForecast` (`'Purchase Order'`) per order period.

## Gotchas

- The cron is **Inngest**, not Trigger.dev. There is no `apps/erp/app/trigger/mrp.ts`.
  The engine itself is in-process Node (`runMrp` from `@carbon/planning`), NOT
  a Supabase edge function — the `mrp` Deno function was deleted.
- MRP itself writes `demandForecast`/`demandActual`/`supplyActual`/
  `demandForecastSource`; it does **not** write `supplyForecast` — that comes from
  the user-driven `planning.update` routes (planned orders).
- The engine currently runs full MRP regardless of `type`/`id` scope
  (effectively company-wide). <!-- UNVERIFIED: scope-narrowing TODO not re-confirmed in current code -->
- Don't rebuild the DB to test schema; ask the user (per AGENTS.md).
