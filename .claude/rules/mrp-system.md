---
description: MRP (Material Requirements Planning) — run flow, data model, planning UI
paths:
  - "packages/jobs/src/inngest/functions/scheduled/mrp.ts"
  - "packages/jobs/src/inngest/functions/scheduled/mrp-companies.ts"
  - "packages/planning/src/mrp/**"
  - "packages/database/src/mrp-engine.ts"
  - "packages/utils/src/planning-sizing.ts"
  - "apps/erp/app/modules/{production,purchasing}/ui/Planning/**"
  - "apps/erp/app/modules/production/planning-action-claims.ts"
  - "apps/erp/app/modules/settings/ui/Planning/**"
  - "apps/erp/app/routes/x+/{production,purchasing}+/planning*.tsx"
  - "apps/erp/app/routes/x+/settings+/planning.tsx"
  - "apps/erp/app/modules/production/production.service.ts"
  - "apps/erp/app/modules/production/production.server.ts"
  - "apps/erp/app/modules/purchasing/purchasing.service.ts"
  - "apps/erp/app/modules/settings/settings.service.ts"
  - "apps/erp/app/modules/settings/settings.models.ts"
  - "apps/erp/app/routes/api+/items.$id.$locationId.forecast.ts"
  - "apps/erp/app/hooks/useMrpScheduleDescription.ts"
  - "packages/planning/src/index.ts"
---

# MRP (Material Requirements Planning)

MRP nets demand against supply per item/location/period and projects on-hand
forward so users can create planned purchase orders (purchasing) and jobs
(production). It runs **IN-PROCESS in Node** via `runMrp` (exported from
`@carbon/planning`, source `packages/planning/src/mrp/mrp.ts`), driven
by an **Inngest** scheduled cron, a manual route POST, or a status change on a
document that moves demand or supply (below) — NOT a Supabase edge function
(the old `mrp` Deno function and its `config.toml` entry were
DELETED), and NOT Trigger.dev. `runMrp(client, db, payload)` takes an injected
service-role Supabase client (PostgREST reads) and a Kysely handle (the atomic
Phase-7 write) and throws on failure.

## Run flow (inputs → compute → outputs)

1. **Scheduled job** — `packages/jobs/src/inngest/functions/scheduled/mrp.ts`.
   `inngest.createFunction({ id: "mrp", retries: 2 }, { cron: "*/15 * * * *" }, …)`
   — a tick every 15 minutes, on which a company is **due** either every 3
   hours (the default) or once a day at `companySettings.mrpRunTime` (a `TIME`
   on the company's own clock, `company.timezone`; set in Settings → Planning
   → MRP Schedule (`MrpScheduleCard`, intent `setMrpSchedule`), where the form
   offers whole hours plus the stored time when it is not on the hour — an
   MCP-set 14:30 saves back unchanged rather than cut to 14:00 —
   `mrpScheduleValidator`, normalised to `HH:MM:SS`; the Recalculate tooltip
   names the company's timezone). Setting a time REPLACES the 3-hourly runs for that company. The
   rule is the pure `isMrpDue(tick, { timezone, mrpRunTime })`
   (`scheduled/mrp-companies.ts`, unit-tested): the default is "UTC hour
   divisible by 3, minute 0"; a daily time is due on the FIRST tick at or after
   the run time's instant, tested against the instant (not the local hour) so a
   spring-forward day still runs once and a fall-back day does not run twice,
   and checked for yesterday's date too (23:50 is first reached at 00:00). The
   tick is `mrpTick(event.ts)` — the cron's own timestamp plus one minute,
   floored to the 15-minute slot (the minute absorbs a cron that fires just
   before the boundary), so a retried step answers for its own slot; with no
   `event.ts` it falls back to `now("UTC")`. A tick with nobody due returns
   early, before the plan lookup — and a tick between the
   3-hourly runs with no company on a daily time returns before `company` is
   read at all (the `mrpRunTime` read comes first for that reason). A failed `mrpRunTime` read
   **throws** (defaulting would plan a daily company at the wrong hours and skip
   its own); an unparseable timezone/time falls back to the default cadence for
   that one company. A `find-companies` step selects all rows from `company`,
   narrowed to the due ones and then by `companiesWithPlanningWork`
   (`scheduled/mrp-companies.ts`): one UNION over the open demand/supply views,
   `demandProjection`, and the rows an earlier run wrote (`planningAction`,
   `demandForecast` with
   `forecastMethod = 'mrp'`, `demandForecastSource`, `supplyForecast`, non-zero
   actuals), plus the stock-only sources: an `itemPlanning` row with a positive
   floor its policy reads (minimum reserve; safety stock on Demand-Based
   Reorder; reorder point on Fixed Reorder Quantity / Maximum Quantity) and
   negative `itemStockQuantities` — the planning actions size an Order / Make
   from on-hand alone. A company in none of them would read nothing and write
   nothing, so it is skipped; a failed lookup plans for every due company. Then **one
   `step.run` per company**
   (`mrp-<companyId>`) calls `runMrp(serviceRole, getJobDatabaseClient(),
   { type: "company", id, companyId, userId: "system" })` **in-process** (`runMrp` throws on failure;
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
   are skipped: the company is on its way out (Stripe removes the plan row when
   the subscription ends, and `weekly.ts` then deletes the planless company).
   The selection rule is the pure `selectCompaniesForMrp`
   (`scheduled/mrp-companies.ts`), unit-tested in its sibling `.test.ts`. Every
   tick with someone due logs `Companies scheduled for MRP` (company / due /
   scheduled counts), and a `warn` fires when companies were due but the plan
   and planning-work filters left none. A tick with NOBODY due returns `[]`
   without a log — most ticks are like that. An EMPTY `company` read warns
   (`No companies found to plan for`) before that return: the read happens only
   on a 3-hourly tick or when a company set a time, so empty there is a broken
   work list — the `companyPlan` failure above — never a quiet tick.

   All three reads (`companySettings.mrpRunTime`, `company`, `companyPlan`) go
   through `fetchAllFromTable` with a stable `.order("id")` — the
   same reason every engine read pages (below): `max_rows = 1000` truncates a
   bare select, and the dev stack does not enforce the cap, so a dropped tail is
   invisible locally. A failed `mrpRunTime` or `company` read **throws**;
   returning would make the step succeed having planned for nobody (or for the
   wrong companies), which is this function's whole bug class. A failed `companyPlan` read does not — it leaves `plans` null and
   plans for everyone, which is the fail-safe direction.

2. **Manual trigger** — POST `apps/erp/app/routes/api+/mrp.ts` (permission
   `update: "inventory"`). Reads the `?location` query param, confirms it
   belongs to the company (`requireCompanyRecord`), then calls
   `runMRP(getCarbonServiceRole(), getDatabaseClient(), { type: locationId ?
   "location" : "company", id: locationId ?? companyId, companyId, userId })`.
   `runMRP(client, db, params)` lives in
   `apps/erp/app/modules/production/production.service.ts`; it dynamic-imports
   `runMrp` from `@carbon/planning`, calls it **in-process** with the Kysely
   handle the route passed in (never built in the service file), and preserves
   the `{ data, error }` shape (catching the throw). The planning tables submit
   to this via `path.to.api.mrp(locationId)`.

   **Event triggers** — the same `runMRP` runs after a document changes demand
   or supply: job status changes (`x+/job+/$jobId.status.tsx`, and
   `releaseJobs` in `production.server.ts`), PO status changes
   (`x+/purchase-order+/$orderId.status.tsx`), sales order confirm
   (`x+/sales-order+/$orderId.confirm.tsx`) and kanban
   (`api+/kanban.$id.tsx`). The demo template's `planDemoCompany`
   (`packages/jobs/src/demo-planning.ts`) calls `runMrp` directly. None of these
   is affected by `mrpRunTime`, which only governs the cron.

3. **In-process engine** — `packages/planning/src/mrp/mrp.ts`
   (`runMrp(client, db, payload)`, Node, ~1390 lines). Reads go through the
   injected service-role Supabase client (PostgREST); the atomic Phase-7 write
   goes through the injected Kysely handle. Payload validator accepts
   `type: "company" | "location" | "item" | "job" | "purchaseOrder" |
   "salesOrder"`, `id?` (required for non-company), `companyId`, `userId`.
   Computation engine is
   `packages/database/src/mrp-engine.ts` (`explodeBom(...)`, `@carbon/database/mrp-engine`),
   also used by get-method (`@carbon/server-functions`).

   - **Periods**: generates/fetches weekly `period` rows 72 weeks forward from
     today on the company's clock (`WEEKS_TO_FORECAST = 18 * 4`, `"Week"`
     granularity).
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
     `get_inventory_quantities`, and the item forecast API
     (`api+/items.$id.$locationId.forecast.ts`, which nets the raw projections
     `getItemDemand` returns). Regenerative: nothing to
     un-consume — cancelled orders/edited forecasts re-net on the next run.
     Consumption is re-netted only inside MRP's window, so a PAST week keeps
     its last leftover: every read path must stop at the current week. The
     planning RPCs do by their `periods` argument; `get_inventory_quantities`
     joins `period` and keeps `endDate >= location_today(...)` (without it the
     Inventory screen's Demand Forecast grew by each past week's leftover).
     Unit tests: `forecast-consumption.test.ts`. Spec:
     `.ai/specs/implemented/2026-09-11-demand-forecast-consumption.md`.
     Backlog consumes nothing (`actualConsumesForecast`): an SO line promised,
     or a job material whose job is due, before the first period is still
     demand in that period, but the forecast that predicted it was for a week
     that is gone. Consuming this week's forecast with it left this week's
     predicted customers unplanned. Job materials are judged on the job's due
     date, not the lead-time-shifted required date.
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
     `makeLocationItemKey` / `makeActualKey` in `packages/database/src/mrp-engine.ts` (joined on
     `KEY_SEP = "\x1f"`). Never build `${a}-${b}` keys — ids are caller-supplied
     TEXT (imports mint hyphenated UUIDs); "-"-joined keys truncated them on
     parse and MRP 500'd for those tenants (Postgres 21000). Regression tests:
     `packages/database/src/mrp-engine.test.ts`.
   - **BOM explosion**: for `Make` items, explodes the active make method to
     derive child demand with low-level-code ordering, per-period inventory
     netting, and lead-time offsetting.
   - **Outputs (DB writes)**: deletes prior MRP forecast rows — including EVERY
     `supplyForecast` row at the company's locations (MRP never inserts
     `supplyForecast`; the planning.update routes do) — then batch-inserts
     (500/chunk) `demandForecast` (`forecastMethod: "mrp"`), `demandForecastSource`
     (lineage), `demandActual`, and `supplyActual`, and persists
     `demandProjection.consumedQuantity`. Writes are stamped with the payload
     `userId` (`"system"` for cron).
   - **Planning actions**: after the Phase-7 transaction commits, `runMrp` calls
     `generatePlanningActions` (`planning-actions.ts`), which diff-writes the
     `planningAction` worklist in its own transaction. That transaction takes
     `pg_advisory_xact_lock` on `planning-actions:<companyId>` BEFORE it reads
     the existing rows: nothing else serialises `runMrp` per company (the cron
     and the five route-triggered runs can overlap), and two runs that both
     read "no row" for a natural key both insert — the second fails on
     `planningAction_natural_key_idx` and rolls the whole write back. Under
     the lock the second run reads the first run's rows and updates them in
     place. Its errors propagate, so
     a run whose actions failed reports failure even though the forecast rows
     are already committed. The write is `writePlanningActionDiff`
     (RecordingDriver-tested in `planning-actions.write.test.ts`): its DELETE
     and UPDATE skip `Actioned` rows themselves, because the run read the
     actions before diffing and a row applied in between would otherwise be
     deleted or reopened. Updates go as one `UPDATE … FROM (VALUES …)` per set
     of changed columns (cast through `PATCH_COLUMN_TYPES`), never one per row,
     and each row keeps its own patch — writing every column would drift a
     dismissed row's stored quantity so a changed need never reopens it.
     The shared sizing (`computePlanningOrders`, `@carbon/utils`) suggests
     nothing when a policy's order quantity comes out 0 — a Fixed Reorder
     Quantity item with reorder point and quantity both 0 used to emit an
     "Order 0" action for every short week.

## Planning data model (tables — all in newest schema)

Base tables defined in `20250610000433_demand-planning.sql`; lineage table in
`20260527110002_demand-forecast-source.sql`.

| Table | PK | Key cols | Notes |
|-------|----|----|-------|
| `period` | `id` | `startDate`, `endDate`, `periodType` | enum `'Week'\|'Day'\|'Month'`; no companyId (uniform RLS) |
| `demandProjection` | `(itemId, locationId, periodId)` | `forecastQuantity`, `consumedQuantity` | user-authored forecast; `consumedQuantity` is MRP-written derived state (`20261006130001`), never user-edited |
| `demandForecast` | `(itemId, locationId, periodId)` | `forecastQuantity`, `forecastMethod` | MRP writes `forecastMethod='mrp'` |
| `demandActual` | `(itemId, locationId, periodId, sourceType)` | `actualQuantity`, `sourceType` | `sourceType` enum `demandSourceType` = `'Sales Order'\|'Job Material'` |
| `supplyForecast` | `(itemId, locationId, periodId)` | `forecastQuantity`, `forecastMethod` | written by **planning.update** routes (planned POs/jobs); MRP never inserts it but DELETES every row at the company's locations in Phase 7 |
| `planningAction` | `(id, companyId)` | `type`, `status`, `suggestedQuantity`, `suggestedDate`, `horizonDate`, `latestOrderDate`, `purchaseOrderLineId` / `jobId`, `assignee` | the MRP worklist (`20261006130000`). `type` enum `planningActionType` = Order / Make / Expedite / Defer / Cancel / Increase / Decrease / Release; `status` = Open / Dismissed / Actioned. Diff-written by `generatePlanningActions`; one non-Actioned row per (item, location, type, and the target order — or, for a new Order / Make, its week) via a partial unique index on `COALESCE(purchaseOrderLineId, jobId, periodId)`. `naturalKey` matches rows the same way, with every week up to the current one as one "now" (`keyPeriodFor`), and the diff updates `periodId` in place — so a dismissal or a hand-set assignee survives the weekly roll of the first period |
| `supplyActual` | `(itemId, locationId, periodId, sourceType)` | `actualQuantity`, `sourceType` | `sourceType` enum `supplySourceType` = `'Purchase Order'\|'Production Order'` |
| `demandForecastSource` | surrogate `id` | `sourceType`, `jobId`/`salesOrderLineId`/`demandProjectionId`, `parentItemId`, `quantity` | MRP lineage; enum `demandForecastSourceType` = `'Job Material'\|'Sales Order'\|'Demand Projection'`; CHECK exactly one source id set |
| `itemPostingGroupResponsibility` | `(id, companyId)` | `locationId`, `itemPostingGroupId`, `responsibleEmployee` | one rung of the action owner ladder (`20261006130000`): the owner of an item group AT a location; UNIQUE `(companyId, locationId, itemPostingGroupId)`; RLS employee read, `settings_update` writes (`20261006130100`). Written by `upsertItemPostingGroupResponsibility` (a null employee deletes the row) |

`locationId` is declared `TEXT` (no `NOT NULL`) on the five original planning
tables (`demandProjection`, `demandForecast`, `demandActual`, `supplyForecast`,
`supplyActual`; `planningAction` declares it `NOT NULL` outright), but
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

Latest definition of BOTH, and of `get_inventory_quantities`:
`20261006130001_demand-forecast-consumption.sql`. `get_production_planning`
supersedes `20260715195226`; `get_purchasing_planning` and
`get_inventory_quantities` are forked from the guarded `20260925121735` bodies
and open with `assert_company_access`.
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

Newest defs: `openPurchaseOrderLines` in `20260811123616_widen-purchasing-scale.sql`,
`openProductionOrders` in `20260811123619_widen-sales-production-scale.sql`,
`openJobMaterialLines` in `20260926093417_open-job-material-lines-invoker.sql`,
`openSalesOrderLines` in `20261006130001_demand-forecast-consumption.sql`.
All join through `itemReplenishment` to expose `replenishmentSystem`, `leadTime`,
`itemTrackingType`.

- `openSalesOrderLines` — `salesOrderLineType != 'Service'`, status IN
  `('To Ship','To Ship and Invoice')`. Newest def:
  `20261006130001_demand-forecast-consumption.sql`. Make to Order lines ARE
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
  `('To Receive','To Receive and Invoice','Planned')`; `dueDate` = the line's
  `requiredDate`, `promisedDate` = the line's promised date, else the order
  delivery's `receiptPromisedDate`.

### When a PO line arrives — one rule

`purchaseOrderLineArrivalDate` (`packages/planning/src/mrp/supply-date.ts`,
pure, tested): promised date, else required date, else order date + lead time
(7 days when the item has none; from today when the order has no date). Both
`runMrp` (which week the supply lands in) and `generatePlanningActions` (the
order's "current date" for Expedite / Defer) call it. They used to disagree —
the projection never read the required date, the check read it first — so
applying an Expedite, which writes the required date, moved the action and left
the projected shortage and its Order suggestion in place. Never date a PO line
anywhere else.

A PROMISED date (the line's, else its delivery's `receiptPromisedDate`) is the
supplier's, and planning writes only the required date, which a promise
outranks. So an Expedite / Defer on a promised line is `requiresManualAction`
("Review on PO", `OpenSupplyOrder.dateIsPromised`), and both planning routes
refuse to move its date: Apply sends it to review, and the drawer's inline due
date edit returns 409 (`promisedDateOf`, `purchasing+/planning.update.tsx`).
Applying it used to mark the action done, move nothing, and get the same
action back from the next run. Quantity actions on a promised line are
unaffected.

### When a job finishes — one rule

`jobCompletionDate` (same file, tested): the job's due date, else today + 30
days for a `No Deadline` job (the default on a new job), else today. Both
engines call it. The reschedule check used to skip an undated job that the
projection counted as supply, so the two saw different supply and the job was
never offered a Cancel, Defer or Expedite.

### Reads and the horizon in `generatePlanningActions`

- The generator's reads are grouped: the responsible-employee resolver and
  the two open-supply views in one `Promise.all`, then the three demand
  tables, on-hand and the open jobs in a second (five Kysely reads at once —
  `getJobDatabaseClient()` shares the 16-connection process pool, so a bounded
  group leaves room for the run's other work). They were six waits in a row.
- The two planning RPCs are read through `fetchAll` with `.order("id")`, like
  every other read in the run. A bare `client.rpc(...)` stops at PostgREST's
  `max_rows` (1000); an item missing from those rows has no candidates, and the
  diff then deletes its existing actions, dismissals and assignee overrides
  included.
- Change actions are derived BEFORE new-supply sizing, and sizing reads
  `projectionsWithExpedites`: the projection with every open order counted
  from its need week — every Expedite done, and an order late by no more than
  the reschedule tolerance (no Expedite) counted from its first need too
  (`firstNeedPeriodByOrder`, the same walk as `deriveChangeActions`). Sized on
  the raw projection, a shortage an Expedite covered also got an Order for the
  same week; and a need this week covered by a PO landing a few days into next
  week read as short, so sizing ordered it again and the fold made it
  "Increase from 100 to 200" on that very PO — then a Decrease on the next run.
- **Release** (`deriveReleaseActions`, migration `20261006210557`): every line
  of a Planned PO and every Planned job gets one, dated `releaseByDate` — the
  order's due date (`purchaseOrderLineArrivalDate` / `jobCompletionDate`) less
  the item's lead time less one day, so due in 8 days with a 7-day lead time
  is today. A PO is released once, so all its lines carry the EARLIEST line's
  date (`earlierRelease`). It is raised only from `RELEASE_NOTICE_DAYS` (1)
  before that date — every planned order has one, so raised weeks out it was
  a standing row nobody could act on; the diff-write deletes an Open one whose
  date moves back out. `horizonDate` is that date, `isASAP` once it has come, `latestOrderDate` null (not new
  supply), and an order MRP would Cancel gets none; it sits beside a change to
  the same order (the natural key includes the type). It is never applied
  by the planning routes (Apply Suggested Changes skips it,
  `isApplyablePlanningAction`, and both Apply routes refuse the type): the
  row's **Release** button runs the order's OWN release from the page through
  `PlanningActionHandlers.onRelease` — purchasing opens the PO's Finalize modal
  (`usePurchaseOrderPlanningCommands().finalizePurchaseOrder`), production
  posts the job to the jobs table's release route (`useJobPlanningRelease` →
  `path.to.bulkReleaseJob`: the job page's readiness checks, the release, the
  location's schedule run). A host with no `onRelease` gets a link to the
  order instead. It
  applies only while the order is Planned — MRP stops raising it, and between
  runs the planning pages drop it once the order's live status moves on
  (`isStaleRelease` in `usePlanningActions`; the grid RPCs' Actions filter
  ignores it the same way, `20261006205037`). It lights the Order button's dot
  red on and after its day and not before (every planned order has one); its
  date reads late only once the day has passed. In the drawer a change on the
  same order takes the row's one action slot (`actionForOrder`).
- `deriveChangeActions` measures Expedite / Defer from the order's EXPECTED date:
  its due date, or today when it is overdue (`laterDate`). Measured from the old
  due date, a late order read as early and got a Defer to a date already past.
  The NEED date is clamped the same way: a need in the current week is needed
  today, not on the week's (past) start. Apply writes the suggested date onto
  the order, so an Expedite to last Sunday made the order overdue, read as
  arriving today, and with a tolerance under a week the same Expedite came
  back on every run. `convertOrdersToIncreases` compares both dates clamped.
- **Quantity suggestions are what the order will hold** (`quantityAfterApply`).
  Apply writes a PO line in whole PURCHASE units (`conversionFactor`, read for
  the open lines whose factor is not 1), so a Decrease to 55 on a 10-per-box
  line wrote 60 and the next run asked for 55 again, forever. Decrease and
  Increase on a PO line are rounded up to the purchase multiple, and a line
  already at it gets no action. An Increase names the PO line's supplier, not
  the item's preferred one.
- **A frozen order is never Expedited, Increased or Decreased**
  (`isOrderFrozen`): its due date less the item's lead time is before today —
  every overdue order, and one due sooner than a lead time away. It is already
  being made or shipped, so none of the three can be carried out. A shortfall
  it would have absorbed stays a new Order / Make (`convertOrdersToIncreases`
  skips it), and a frozen order late beyond the tolerance is left where it
  lands in the sizing projection (`firstNeedPeriodByOrder`'s `frozen`
  argument), so the need it misses gets new supply instead of a silent gap.
  Defer, Cancel and Release are unchanged. Before this an overdue job got
  "Increase from 111 to 131" beside a Make for the same week.
- **Change actions keep the policy's order rules** (`orderSizingRules`, the
  same definition the page split reads). A Decrease keeps the policy's
  minimum and lands on its whole multiples — `orderMultiple`, a Fixed Reorder
  Quantity order's fixed quantity, a Maximum Quantity order's lot size
  (`reducedOrderQuantity`, `orderRules` on `deriveChangeActions`). A new-supply
  suggestion folds into an open order only when the result fits the policy's
  `maximum` — a batch or the max order quantity, the fixed reorder quantity
  (`maximumPerOrder` on `convertOrdersToIncreases`); otherwise it stays a new
  Order / Make. Before this a 50-unit batch job was offered "Increase to 100"
  and a 40 on a multiple of 10 "Decrease to 37".
- `deriveChangeActions` claims the policy floor (safety stock, reorder point,
  minimum reserve) FIRST — from on-hand, then the earliest orders — and an
  order holding part of it is never Cancelled, Decreased or Deferred. The floor
  has no date and never Expedites an order by itself. It used to take what the
  demand walk left, undated: an order holding safety stock was dated by a later
  demand and deferred, which put stock under the floor until that date.
- `deriveChangeActions` gives NO verdict on an order due after the last planning
  week (`WEEKS_TO_PLAN` = 48; MRP itself plans 72). Its demand is not loaded, so
  it would otherwise read as "nothing needs it" and be offered for Cancel. Such
  an order is not pulled in to cover an earlier need either.
- `runMrp` throws when the forecast-consumption settings cannot be read; the
  window decides what is persisted as `consumedQuantity`, so defaults are not a
  safe fallback.
- **A job order is measured in GOOD units** — `job.quantity` less
  `quantityReceivedToInventory`, from one read of the company's open jobs
  (the same four statuses as `openProductionOrders`), never the view's
  `quantityToReceive`, which is `productionQuantity` (quantity + scrap) less
  received. A change action is applied to `job.quantity`, so on the view's
  figure every job with a scrap allowance read as over-supplied, got "Only 80
  of 84 is required", and got it again after the Decrease was applied.
  `updatePlanningJob` restates `scrapQuantity` for the new quantity from the
  item's scrap rate, as `insertJob` derives it. (The projection itself still
  books `productionQuantity` as supply — a separate, older choice.)
- The `demandProjection.consumedQuantity` write touches only rows whose value
  changed (`IS DISTINCT FROM`) and leaves `updatedAt` / `updatedBy` alone:
  consumption is derived, and the audit columns name the planner who entered
  the forecast.

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
- **Suggested orders ARE the Order / Make actions.** The order drawer's
  Suggested Orders / Suggested Jobs, the row's Order / Make button quantity
  and a bulk order for rows never opened all read the item's OPEN new-supply
  actions (`openNewSupplyActions` + `plannedOrdersFromActions` /
  `productionOrdersFromActions`, `ui/Planning/planned-orders-from-actions.ts`,
  tested by `apps/erp/test/planned-orders-from-actions.test.ts`): each action
  split back into the orders its policy sized, on the action's own week, in
  purchase units for a PO (rounded up by the chosen supplier part's factor).
  MRP sums the orders a week needs into one action (the natural key), so
  `splitIntoOrders` + `orderSizingRules` (`@carbon/utils`, by the action's
  `policyName`) restore them: Demand-Based Reorder one per batch (`lotSize`)
  spread across the week, Fixed Reorder Quantity one of that quantity per
  day, Maximum Quantity one of at most `maximumOrderQuantity` per day; Stock
  Only one order. A round-trip test pins the split to `computePlanningOrders`.
  One order per action turned a 120 on a batch size of 50 into one job of
  120 and three fixed reorders of 100 into one order of 300. Each suggested
  job carries the action's `policyName` / `reason` / `triggerValues` (the
  chart's order popover reads them), and its `isASAP` is judged per job
  against the page's `locationToday` from its OWN start date — the action's
  flag is one per week as of the run (Maximum Quantity keeps the run's flag
  as a condition, since only the run knows the stock was short). It becomes
  the created job's `deadlineType`. They
  used to be sized again in the browser from the weekly projections (`calculateOrders`), which missed what
  MRP does after sizing — moving expedited supply, folding a shortfall into
  an open order as an Increase, summing each week into one action — so the
  drawer showed daily 10s against weekly 50s and offered a new order for the
  shortfall an Increase already covered. A dismissed Order is not offered;
  a shortfall whose Increase was dismissed gets no Order until MRP writes one,
  and the planner adds it by hand with New. The rows refresh when MRP runs.
- **Latest Order Date** (both grids, after 1st Negative On Hand): the last day the
  row's next suggested order can be placed and still arrive on time — the
  grid RPC's `latestOrderDate`, the MIN order-by date of the item's open
  new-supply actions, so the cell, its sort and the drawer agree. Red once the
  day has passed (before the location's today); "-" when nothing needs
  ordering. The tooltip shows the required date (order-by date plus lead
  time) and the lead time; the CSV carries the ISO date. Cell:
  `ui/Planning/LatestOrderDate.tsx`.
- **Shared, not copied.** The two grids differ only in their own columns (item
  link, supplier, lead time, quantity to order, the Order button) and wiring.
  Everything else lives once in `production/ui/Planning/`: `usePlanningActions`
  (the worklist fetcher and toast, fenced and filtered actions, the batched
  submit, and the `actionHandlers` the action lines and drawers spread),
  `planningColumns` (the shared column definitions, typed to each grid's row)
  and `PlanningDrawerParts` (`PlanningPolicySummary` with a slot for the
  purchasing drawer's supplier rows, `BeyondFenceButton`, `periodIdFor`).
  Change the shared piece; a copy in one grid drifts, as the untranslated
  labels in one drawer did.
- **One "today": the location's.** Every planning surface that marks a date
  late — the Latest Order Date cell, the expanded action lines
  (`PlanningActionLines`) and the drawers — takes the loader's
  `locationToday` as a prop. None reads the browser's zone: a planner in
  another timezone saw an action red in one column and not in the next.
- Both have a "Recalculate" button (`mrpFetcher.Form` POST to
  `path.to.api.mrp(locationId)`) whose tooltip comes from
  `useMrpScheduleDescription` (`~/hooks`): *"MRP runs automatically every 3
  hours…"* or *"…every day at 2:00 PM…"* when the company set
  `companySettings.mrpRunTime`. The Inventory table's button uses the same hook.
- **Planning actions (the MRP worklist, spec §P1.7) live INSIDE each grid**, not
  in a separate list. Both routes load the location's persisted `planningAction`
  rows (`getPlanningActions`, Buy/Make by kind) and pass them to the grid, which
  renders an **Actions** column (one ICON chip per open type with a count and
  the type name in a tooltip, a muted dismissed chip; always one line so busy
  rows are no taller than the rest; static type filter), a pulsing dot on the
  row's Order / Make button (`planningActionDot`, `ui/Planning/planning-review.ts`:
  only open actions that add or advance supply — Order, Make, Expedite,
  Increase — light it: red when one is ASAP, green otherwise; an Increase
  lights it with nothing new to order. A Decrease, Defer or Cancel never
  lights it, and is never drawn late in the expanded row either
  (`isPlanningActionLate`) — its date is where the order sits, not a
  deadline), and an
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
  **Cancel** on a job runs `cancelJob` (`production.server.ts`), the job status
  route's own path: picked material back, picking lists closed, then
  Cancelled. On a PO line it DELETES the line, in one statement that also
  requires a Draft / Planned PO and nothing received or invoiced; when that
  guard holds the row back the action goes back to Open as "Review on PO".
  Never `shortClosePurchaseOrderLine` — it recomputes the header status from
  the lines and turned an unsent Draft into "Completed".
  **Apply is set-based.** Purchasing: `applyPurchasingPlanningActions(db, …)`
  runs the whole batch in ONE Kysely transaction — the claim, one
  `UPDATE … FROM (VALUES …)` for dates, one for quantities, one `DELETE` for
  cancels, and the un-claim of refused rows — about five round trips for any
  batch size, all-or-nothing. Production: `applyProductionPlanningDateActions`
  does the same for Expedite / Defer (claim, the jobs, the jobs already on
  the target dates, one UPDATE of due date + priority via the pure
  `nextJobPriority`), then the route sends ONE `schedule-inputs-changed`
  event for the batch (a "reorder" event re-stamps the whole company whatever
  its job id). Increase / Decrease / Cancel on jobs call server functions
  with their own transactions, so they stay per job — grouped by job, three
  jobs at a time (`async.map`), each claimed right before its own change.
  The claim and release inside a transaction live in
  `modules/production/planning-action-claims.ts`, shared by both services;
  the release reopens the row, or deletes it when an MRP run has meanwhile
  written a fresh Open row for the same need (the natural-key index).
  Tests: `apps/erp/test/apply-purchasing-planning-actions.test.ts`,
  `apply-production-planning-date-actions.test.ts`.
  **Every Apply write carries its own Draft / Planned condition**
  (`updatePlanningJob`, `updatePurchaseOrderLineSchedule`, the Cancel delete),
  so a job released or a PO sent between the route's status read and the write
  is left alone and the action goes to review — a read-then-write gate let it
  through. A failed write gives its claim back through
  `releasePlanningActionClaim`, which deletes the claimed row instead when an
  MRP run has meanwhile written an Open row for the same need (the reopen hits
  the natural-key index, 23505); a failed release is reported, not swallowed.
  Job Cancel is the one exception: `cancelJob`'s cleanup steps run in their own
  transactions, so a release between the read and the cancel is not caught.
  **Permissions:** both `planning.update` routes run with the service role, so
  their `requirePermissions` is the only check — `create` for `order`,
  `update` for everything else, plus `purchasing_delete` (read from the claims)
  for a Cancel that deletes a PO line. An assignee or responsible employee is
  saved only after `isActiveCompanyEmployee` (`shared.server.ts`), and
  `planningAction` is read-only through the API (manifest rule: read is
  `anyOf("production_view", "purchasing_view")`, since both planning pages
  read it with the user's client; MRP and these routes write it with the
  service role).
  The Actions column filter (`filter=planningActions:eq:<type>`) and the
  Assignee column's people filter (`filter=planningAssignee:in:<userId>,…` —
  the same people list every other assignee filter uses; the column is hidden
  by default and shows the row's assignees when turned on) are not grid RPC
  columns: the loader strips them with `resolvePlanningActionScope`
  (`ui/Planning/planning-action-scope.ts`, pure, unit-tested) and passes them to
  the grid RPC as ARGUMENTS (`action_types`, `action_assignees`), which keeps the
  items with a matching OPEN action inside the item's planning horizon. The
  loader then reads the actions for the rows ON THE PAGE (`getPlanningActions`
  with `itemIds`, paged). An earlier version loaded the location's first 500
  actions and resolved item ids from them — it silently dropped items past the
  cap and could not see the horizon.
- **Reschedule tolerance.** `companySettings.rescheduleToleranceDays`
  (`INTEGER NOT NULL DEFAULT 7`, `20261006130000`) is read by
  `generatePlanningActions` as `toleranceDays` into `deriveChangeActions`: an
  open order gets an Expedite / Defer only when its date is STRICTLY more than
  the tolerance from the date it is needed, and a dismissed action stays
  dismissed while its date moves within the tolerance. Authored at Settings →
  Planning (`RescheduleToleranceCard`, intent `setTolerance`,
  `rescheduleToleranceValidator` in `settings.models.ts`, 0–365).
- **Planning ownership (the owner ladder).** `resolveResponsibleEmployee` /
  `loadResponsibleEmployeeResolver` (`packages/planning/src/mrp/responsible-employee.ts`):
  `itemPlanning.responsibleEmployee` → `itemPostingGroupResponsibility` (the
  item group AT the location) → `location.responsibleEmployee` →
  `companySettings.defaultResponsibleEmployee`, first non-null wins. The diff
  re-resolves an action's `assignee` on every run unless `assigneeOverridden`
  (set by Assign) — and the UPDATE re-checks that flag on the row itself, so a
  planner who assigns between the run's read and its write still wins.
- **Settings → Planning** (`x+/settings+/planning.tsx`, cards in
  `apps/erp/app/modules/settings/ui/Planning/`): `ResponsibleEmployeeCard`
  (intents `setCompanyDefault`, `setLocation`, `setItemGroup`; `setLocation`
  writes `location`, a resources table, so a user without `resources_update`
  matches no row under RLS and is told so rather than shown a success),
  `RescheduleToleranceCard` (`setTolerance`), `PlanningPurchaseOrderApprovalCard`
  (`setPlanningPurchaseOrderApproval` → `companySettings.skipApprovalForPlanningPurchaseOrders`,
  default on: a PO the planning Order button created — `purchaseOrder.createdFromPlanning`,
  cleared by any manual line change — finalizes without the approval rule), `PlanningHorizonCard`
  (`setPlanningHorizon`, `planningHorizonValidator`), `ForecastConsumptionCard`
  (`setForecastConsumption`, `forecastConsumptionValidator`, 0–52 weeks each)
  and `MrpScheduleCard` (`setMrpSchedule`, `mrpScheduleValidator`). An employee
  id is saved only after `isActiveCompanyEmployee`; a bad value answers 400.
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
  fence in the **Planning Horizon** column (`useTimeFenceOverrides`, page state,
  gone on reload, never written to the item) without an MRP run. Named
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
    and carries the same Planning Horizon control as the grid cell.
  - Moving a row's fence DROPS that item's entry in the grid's `ordersMap`
    (`onFenceChange`): the drawer's draft list is kept per item once opened,
    and a stale one would neither show the newly included orders nor offer
    them. That discards manual edits to the draft, by design.
- **The order drawer is two tables with two save models**
  (`ui/Planning/PlanningOrderGrids.tsx`, both on the shared `Grid`), because a
  row that does not exist yet cannot autosave:
  - **Suggested Orders / Suggested Jobs** (`SuggestedOrdersGrid`) — a DRAFT.
    Quantity and due date are click-to-edit; the edits live in the planning
    grid's `ordersMap` and nothing is written until Order / Make. The drafts
    survive a loader reload (Apply, Dismiss, Assign inside the drawer
    revalidate it) and are dropped only when the page scope changes (the
    search params), MRP recalculates, or an order is placed — clearing on
    every `data` change wiped the planner's edits mid-task. The Order By
    / Start By column is derived (due date less lead time).
  - **Open Orders / Open Jobs** (`OpenOrdersGrid`) — existing PO lines / jobs
    at the page's location (both drawer reads filter on `locationId`, and
    `updateLine` / `updateJob` refuse another location's record with 409).
    A cell edit SAVES that one field (optimistic, reverted with a toast on
    failure) through `planning.update`'s `updateLine` / `updateJob` action,
    which re-reads the record under the company and refuses a committed record
    with 409. Jobs: `updateJob` and Apply share `isJobEditableFromPlanning`
    (`production.models.ts`), an allowlist of Draft / Planned — anything else
    (on the floor, finished, closed, cancelled) is "Review on Job". POs:
    `updateLine`, Apply and the drawer's editable rows share
    `isPurchaseOrderEditableFromPlanning` (`purchasing.models.ts`), the same
    Draft / Planned allowlist — a PO in approval (Needs Approval, To Review,
    Rejected) or sent is "Review on PO", matching MRP's own
    `isCommittedPurchaseOrderStatus`. A quantity edit restates the line's tax
    pair (`taxPairForQuantity`): the extended price is generated, the tax
    amount is stored. A failed follow-up on a saved job edit (recalculating
    requirements, telling the scheduler) is reported as a warning, never a
    revert — the edit stands.
    A Draft job (listed, editable, charted as new supply, but NOT MRP supply)
    shows a **Plan** button when no action targets it (`renderRowCommand`):
    `planning.update` `planJob` checks the location, that no sales order owns
    it and that it is Draft, then `planDraftJob` (`production.server.ts`) recalculates
    its requirements (a failure leaves it Draft, as `releaseJobs` does), flips
    it to Planned (`updateJobStatus` `fromStatuses: ["Draft"]`) and runs MRP —
    after the flip, so the run counts it and the Make suggestion shrinks by
    it. No scheduler notice: only released jobs are scheduled. The drawer then drops the item's draft
    list to re-seed. Before this a Draft job and a Make for the same need sat
    side by side and could both be built (the pre-#1601 drawer promoted
    Drafts through `order`, which now refuses existing jobs).
    Locked rows render as plain cells
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
    with `purchaseOrderStatus` / `jobStatus`.
- **`getPlanningActions` reads the item, the PO behind a line and the job as
  PostgREST embeds, and chunks the page's item ids (100 per request).** It used
  to look them up afterwards with `.in("id", <one id per action>)`; a page of
  busy parts (2,000+ actions) put 50 kB of ids in the URL, the gateway answered
  431, and the loader's `?? []` turned that into a grid with no actions. The
  loaders now log and throw on a failed read instead — an empty Actions column
  must never be what a failure looks like. The id lists a bulk selection sends
  (Apply, Dismiss, Reopen, Assign, and Apply's job / PO line reads) have no
  page bound at all, so those go through Kysely as ONE statement each
  (`getPlanningActionsByIds`, `markPlanningActionsActioned`,
  `dismissPlanningActions`, `reopenDismissedPlanningActions`,
  `assignPlanningActions` take the `db` handle): the ids are bound
  parameters, never a URL. The set-based Apply claims and changes a batch in
  one transaction; the per-job path claims each action right BEFORE its own
  change, so a request that dies there strands at most the actions in flight.
  Every claim (`claimPlanningActions`, `markPlanningActionsActioned`) RETURNS
  the row's `suggestedQuantity` and `suggestedDate`, and Apply writes THOSE —
  an MRP run between the page's read and the claim can move an Open action in
  place, and the page's values would be the stale suggestion. A date apply
  (`applyProductionPlanningDateActions`, `updatePlanningJob`) also restates a
  "No Deadline" job as `Soft Deadline` (`deadlineTypeForPlanningDate`): the job
  form hides the due-date field for No Deadline, and `nextJobPriority` would
  rank the dated job with the undated weight.
  - Purchasing quantities are in PURCHASE units (the line's
    `purchaseQuantity`; the open-lines view reports inventory units), and an
    action's suggested quantity is converted and rounded up as Apply does. The
    chart still receives existing orders in inventory units.
  - A manual edit does NOT resolve the suggestion on that row: the action stays
    until the next MRP run re-evaluates the order.
  The earlier single list mixed both: an edit to an existing order sat unsaved
  until Order was pressed and was dropped by Close.
- **Grid RPCs are wrappers.** `get_purchasing_planning_grid` /
  `get_production_planning_grid` (latest: `20261006205037_planning-grid-order-quantity.sql`) select
  `p.*` from the base RPC and add `itemPostingGroupId` (**Item Group** column +
  filter), `planningHorizonDays`, `timeFenceDate`, `firstNegativeDate` (**1st
  Negative On Hand**: the start of the first week whose projection is below
  zero — weekly, because MRP buckets by week), `latestOrderDate` (the MIN of
  the item's open new-supply actions, which makes **Latest Order Date**
  sortable; the cell shows the same value) and `orderQuantity` (the SUM of the
  item's open Order / Make actions inside its saved fence, 0 when none — the
  grids' default sort, then the part number; there is no Qty to Order column,
  the row's Order / Make button shows the quantity).
  The base RPC's own `quantityToOrder` (`calculate_quantity_to_order`, a second
  sizing of the projection in SQL) is NOT shown or sorted on any more: it
  never sees what MRP does after sizing (Expedites, Increases, orders placed
  since the last run against a projection only a run refreshes), so it put
  items with nothing to order above real shortages. It stays in `p.*` for
  `generatePlanningActions`' Stock Only path. The base RPCs stay the one definition of the projection and are what
  `generatePlanningActions` reads. Adding a column to a base RPC means
  re-creating its wrapper with the same column — it fails loudly (return type
  mismatch) until then. Generated types mark every RPC column non-null; the new
  ones are not (`PlanningGridColumns` in `production/types.ts`).
- **Create planned orders** — `planning.update.tsx` in each module:
  - production (`create: "production"`, role `employee`): inserts jobs +
    job methods, upserts `supplyForecast` (`'Production Order'`), then
    `recalculateJobRequirements()`.
  - purchasing (`create: "purchasing"`, role `employee`): one PO per supplier
    per WEEK (`planningPurchaseOrderWeek`: Sunday-start, as the grid's
    periods; a late or undated order is in the current week). It reuses the
    oldest open Draft/Planned `Purchase` PO for the supplier, at the planning
    location, in the supplier's currency, whose lines are ALL in that week
    (`findPlanningPurchaseOrder`), else inserts one. A PO with lines in
    several weeks (raised before this rule) takes no more orders; matching
    on ANY line in the week let such a PO keep collecting weeks. Before this, every
    week went on one PO, so finalizing it to send the first week locked the
    later weeks against MRP's Defer / Decrease / Cancel. A PO with no lines is
    never reused. All candidate POs and their lines are read once per submit.
    An order whose item and `requiredDate` match an existing line adds to it,
    restating the tax pair (`taxPairForQuantity`). Upserts `supplyForecast`
    (`'Purchase Order'`) per order period.

## Gotchas

- The cron is **Inngest**, not Trigger.dev. There is no `apps/erp/app/trigger/mrp.ts`.
  The engine itself is in-process Node (`runMrp` from `@carbon/planning`), NOT
  a Supabase edge function — the `mrp` Deno function was deleted.
- MRP itself writes `demandForecast`/`demandActual`/`supplyActual`/
  `demandForecastSource`/`planningAction`; it never inserts `supplyForecast` —
  that comes from the user-driven `planning.update` routes (planned orders) —
  but Phase 7 deletes every `supplyForecast` row at the company's locations.
- The engine runs full MRP regardless of `type`/`id` scope: `type` is only
  logged (`run started`), never used to narrow the reads, so every run is
  company-wide.
- Don't rebuild the DB to test schema; ask the user (per AGENTS.md).
