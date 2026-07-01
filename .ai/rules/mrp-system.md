---
description: MRP (Material Requirements Planning) — run flow, data model, planning UI
paths:
  - "packages/jobs/src/inngest/functions/scheduled/mrp.ts"
  - "packages/database/supabase/functions/mrp/**"
  - "packages/database/supabase/functions/lib/mrp-engine.ts"
  - "apps/erp/app/modules/{production,purchasing}/ui/Planning/**"
---

# MRP (Material Requirements Planning)

MRP nets demand against supply per item/location/period and projects on-hand
forward so users can create planned purchase orders (purchasing) and jobs
(production). It runs as an **Inngest** scheduled job that invokes a **Supabase
Deno edge function** — NOT Trigger.dev, and not inline in the app server.

## Run flow (inputs → compute → outputs)

1. **Scheduled job** — `packages/jobs/src/inngest/functions/scheduled/mrp.ts`.
   `inngest.createFunction({ id: "mrp", retries: 2 }, { cron: "0 */3 * * *" }, …)`
   — every 3 hours. Fans out **per company**: selects all rows from `companyPlan`
   and, for each, calls `serviceRole.functions.invoke("mrp", { body: { type:
   "company", id, companyId, userId: "system" } })`. There is no location-scoped
   cron — only company-wide.

2. **Manual trigger** — POST `apps/erp/app/routes/api+/mrp.ts` (permission
   `update: "inventory"`). Reads `?location` query param; calls
   `runMRP(getCarbonServiceRole(), { type: locationId ? "location" : "company",
   id: locationId ?? companyId, companyId, userId })`. `runMRP` lives in
   `apps/erp/app/modules/production/production.service.ts` and just wraps
   `client.functions.invoke("mrp", { body })`. The planning tables submit to this
   via `path.to.api.mrp(locationId)`.

3. **Edge function** — `packages/database/supabase/functions/mrp/index.ts` (Deno,
   ~880 lines). Payload validator accepts `type: "company" | "location" | "item"
   | "job" | "purchaseOrder" | "salesOrder"`, `id?` (required for non-company),
   `companyId`, `userId`. Computation engine is
   `packages/database/supabase/functions/lib/mrp-engine.ts` (`explodeBom(...)`).

   - **Periods**: generates/fetches weekly `period` rows ~18 weeks (126 days)
     forward from today (`"Week"` granularity). <!-- UNVERIFIED: exact week count not re-confirmed line-by-line; old doc said 72, code comment said 18 -->
   - **Inputs (demand)**: views `openSalesOrderLines`, `openJobMaterialLines`,
     plus `demandProjection`/`demandProjection` forecast netting.
   - **Inputs (supply)**: views `openProductionOrders`, `openPurchaseOrderLines`.
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
| `demandForecast` | `(itemId, locationId, periodId)` | `forecastQuantity`, `forecastMethod` | MRP writes `forecastMethod='mrp'` |
| `demandActual` | `(itemId, locationId, periodId, sourceType)` | `actualQuantity`, `sourceType` | `sourceType` enum `demandSourceType` = `'Sales Order'\|'Job Material'` |
| `supplyForecast` | `(itemId, locationId, periodId)` | `forecastQuantity`, `forecastMethod` | written by **planning.update** routes (planned POs/jobs), not by MRP |
| `supplyActual` | `(itemId, locationId, periodId, sourceType)` | `actualQuantity`, `sourceType` | `sourceType` enum `supplySourceType` = `'Purchase Order'\|'Production Order'` |
| `demandForecastSource` | surrogate `id` | `sourceType`, `jobId`/`salesOrderLineId`/`demandProjectionId`, `parentItemId`, `quantity` | MRP lineage; enum `demandForecastSourceType` = `'Job Material'\|'Sales Order'\|'Demand Projection'`; CHECK exactly one source id set |

`locationId` is nullable on all five planning tables. Audit cols
(`createdBy/At`, `updatedBy/At`) present except on `period` and
`demandForecastSource` (created-only).

## Planning split functions

Latest definition: `20260324120000_planning-quantity-to-order.sql` (supersedes the
old `20251205000037_include-reorder-quantity-in-planning.sql`).

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
(`openPurchaseOrderLines` in `20260529074512_open-po-lines-required-date.sql`).
All join through `itemReplenishment` to expose `replenishmentSystem`, `leadTime`,
`itemTrackingType`.

- `openSalesOrderLines` — `salesOrderLineType != 'Service'`,
  `methodType != 'Make to Order'`, status IN `('To Ship','To Ship and Invoice')`.
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
- Both have a "Recalculate" button (`mrpFetcher.Form` POST to
  `path.to.api.mrp(locationId)`) tooltip: *"MRP runs automatically every 3 hours,
  but you can run it manually here."*
- **Create planned orders** — `planning.update.tsx` in each module:
  - production (`create: "production"`, role `employee`): inserts jobs +
    job methods, upserts `supplyForecast` (`'Production Order'`), then
    `recalculateJobRequirements()`.
  - purchasing (`create: "purchasing"`, role `employee`): inserts purchase
    orders/lines grouped by supplier+period, upserts `supplyForecast`
    (`'Purchase Order'`).

## Gotchas

- It is **Inngest**, not Trigger.dev. There is no `apps/erp/app/trigger/mrp.ts`.
- MRP itself writes `demandForecast`/`demandActual`/`supplyActual`/
  `demandForecastSource`; it does **not** write `supplyForecast` — that comes from
  the user-driven `planning.update` routes (planned orders).
- The edge function currently runs full MRP regardless of `type`/`id` scope
  (effectively company-wide). <!-- UNVERIFIED: scope-narrowing TODO not re-confirmed in current code -->
- Don't rebuild the DB to test schema; ask the user (per AGENTS.md).
