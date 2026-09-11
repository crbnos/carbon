# Demand-forecast ↔ actual-demand audit (branch `mrp-action-suggestions`)

Audited 2026-09-11 by a read-only Explore agent as Phase 0 of the demand-forecast-consumption
feature run (`.ai/runs/2026-09-11-demand-forecast-consumption.md`). Findings below are the
agent's report, verbatim.

## Headline verdict

**The belief that same-period netting already works is REFUTED.** There is no netting, no `max()`, no consumption of any kind between forecast and actual demand — anywhere in the stack. Forecast and actual demand are **summed** in four independent places. A forecast of 10 plus sales orders of 10 in the same week produces **gross demand of 20**.

---

## 1. SCHEMA

### Two look-alike tables — input vs. output

| Table | Role | Written by |
|---|---|---|
| `demandProjection` | **Input.** The authored forecast ("we expect to sell 40 in March") | Planner, via the Demand Forecasts screen |
| `demandForecast` | **Output.** MRP's BOM-exploded *child/component* demand (`forecastMethod = 'mrp'`) | `runMrp`, wiped + rewritten every run |

`demandProjection` — `packages/database/supabase/migrations/20251020183630_mrp-projections.sql:3-25`:
```
itemId TEXT NOT NULL, locationId TEXT, periodId TEXT NOT NULL,
forecastQuantity NUMERIC NOT NULL DEFAULT 0,
forecastMethod TEXT,            -- 'manual','statistical','ml' — never written by the UI
confidence NUMERIC(3,2),        -- never written by the UI
notes TEXT, companyId TEXT NOT NULL,
createdBy/createdAt/updatedAt/updatedBy
PK (itemId, locationId, periodId)  + UNIQUE (itemId, locationId, periodId, companyId)
```
A surrogate `id TEXT DEFAULT id()` was added later (`20260527110002_demand-forecast-source.sql:12-17`) so `demandForecastSource` can FK to it. Note: `mrp.ts:464` cites a migration filename `20260527115843_demand-projection-source.sql` **that does not exist** — minor comment drift.

`demandForecast` — `20250610000433_demand-planning.sql:37-55`: identical column shape; `PK (itemId, locationId, periodId)`, plus `UNIQUE (itemId, locationId, periodId, companyId)` from `20260527110002_demand-forecast-source.sql:1-3`.

`demandActual` — same file, lines 105-120: `PK (itemId, locationId, periodId, sourceType)` where `demandSourceType` is `'Sales Order' | 'Job Material'`. Mirror tables `supplyForecast` / `supplyActual` (`supplySourceType` = `'Purchase Order' | 'Production Order'`) exist for the supply side.

`demandForecastSource` — `20260527110002_demand-forecast-source.sql:30-95`: lineage/pegging for BOM-derived rows. Surrogate PK, `sourceType` enum `'Job Material' | 'Sales Order' | 'Demand Projection'`, exactly one of `jobId`/`salesOrderLineId`/`demandProjectionId` enforced by CHECK. `redirectedFromItemId` added in `20260618171234_material-supersession.sql`.

### Period granularity

`period` table (`20250610000433_demand-planning.sql:26-34`): `id`, `startDate DATE`, `endDate DATE`, `periodType ('Week'|'Day'|'Month')`. **No `companyId`** — periods are globally shared across tenants.

Granularity is **calendar week, Sunday-start (`en-US` locale), 7 days wide**, anchored on "today" in the **company** timezone for MRP and the **location** timezone for the UI:

- MRP: `packages/ee/src/planning/mrp/mrp.ts:105-107` → `datetime.today(await getCompanyTimeZone(db, companyId))`, then `getStartAndEndDates(today, "Week")` at `mrp.ts:1069-1097` → `startOfWeek(today, "en-US")`, 7-day buckets, `WEEKS_TO_FORECAST = 18 * 4 = 72` weeks (`mrp.ts:32`).
- UI: `apps/erp/app/modules/shared/shared.server.ts:498-560` (`getOrCreatePeriods`) → identical `startOfWeek(today, "en-US")` but with `getLocationTimeZone`.
- `'Day'` and `'Month'` both `throw new Error("Not implemented")` (`mrp.ts:1090-1093`).

### Scoping

`companyId` is a column on `demandProjection`/`demandForecast`/`demandActual` with RLS on `inventory_view`/`inventory_create`/`inventory_update`/`inventory_delete`. `locationId` is nullable in the DDL but part of the PK (so effectively NOT NULL). MRP **skips any row with a null `locationId`** rather than writing `""` and violating the FK — `mrp.ts:446-451`, `483`, `521`, `368`, `396`.

### UI to author forecasts

Route tree `apps/erp/app/routes/x+/production+/`:
- `demand-forecasts.tsx` — list; loads `getProductionProjections` RPC over `WEEKS_TO_PROJECT = 12 * 4` (line 26). Plan-gated by `usePlanGate({ feature: "FORECAST" })` (line 90) with `ForecastUpgradeOverlay`.
- `demand-forecasts.new.tsx`, `demand-forecasts.$itemId.$locationId.tsx` (52-week grid; `WEEKS_TO_PROJECT = 52` at line 19), `demand-forecasts.delete.$itemId.$locationId.tsx`.
- Components: `apps/erp/app/modules/production/ui/DemandProjection/DemandProjectionForm.tsx` (382 lines, 52 cells in 4 quarter tabs + live chart) and `DemandProjectionTable.tsx`.
- Services: `production.service.ts:4657` `upsertDemandProjections` (zero → delete, non-zero → upsert on `itemId,locationId,periodId,companyId`), `:857` `getDemandProjections`, `:521` `deleteDemandProjections`. Parallel `*DemandForecasts` functions exist at `:497`, `:843`, `:4624` but operate on the MRP output table.
- Server writes go through `requirePlan({ feature: "FORECAST" })`.

### Forecasting configuration

**There is none, specific to forecasting.** No item-level "forecast consumption period" flag, no company planning setting, no forecast horizon config. `forecastMethod` and `confidence` are schema placeholders the UI never writes. The only planning config is on `itemPlanning` (`20230330024716_parts.sql:847-877` + later ALTERs): `reorderingPolicy`, `safetyStockQuantity`, `safetyStockLeadTime`, `demandAccumulationPeriod` (default forced to 30 by `20250610000433_demand-planning.sql:9-10`), `demandAccumulationSafetyStock`, `reorderPoint`, `reorderQuantity`, `minimumOrderQuantity`, `maximumOrderQuantity`, `orderMultiple`, `maximumInventoryQuantity`, `responsibleEmployee`. `demandReschedulingPeriod` was **dropped** in `20250616131548_production-planning.sql:1`. Company level: only `companySettings.rescheduleToleranceDays` (`20260911041811_mrp-planning-actions.sql:109-110`).

Note: `apps/erp/app/modules/production/forecast.server.ts` / `forecast.test.ts` are **capacity/scheduling** forecast (non-working intervals for the Gantt), unrelated to demand forecasting. Same for `routes/x+/scheduling+/forecast.tsx`.

---

## 2. DEMAND SOURCES in `runMrp`

All in `packages/ee/src/planning/mrp/mrp.ts`. Phase 1 bulk-loads at `:125-183` (all paginated via `fetchAll`). Phase 4 (`:419-552`) merges into a single map:

```ts
// mrp.ts:424
const grossDemand = new Map<string, number>();   // key = locationId ␟ periodId ␟ itemId
```

| # | Source | View/table | Loaded | Merged | Date → period |
|---|---|---|---|---|---|
| 1 | **Demand projections (the forecast)** | `demandProjection` | `:161-171` | `:442-477` | Row already carries `periodId` — no date mapping |
| 2 | **Sales order lines** | `openSalesOrderLines` | `:132-138` | `:480-515` | `promisedDate ?? today` → `findPeriod` (`:485-488`) |
| 3 | **Job materials** | `openJobMaterialLines` | `:139-145` | `:518-552` | `job.dueDate − item leadTime` → `findPeriod` (`:523-526`) |
| 4 | **BOM-exploded child demand** | derived | — | inside `explodeBom` | parent period index − `ceil(leadTime/7)` weeks, floored at period[0] |
| 5 | Open jobs (**supply**, not demand) | `openProductionOrders` | `:146-152` | `:363-389` → `jobSupplyByLocationPeriodItem` | `dueDate`, or `today+30d` if `deadlineType = 'No Deadline'`, else `today` |
| 6 | Open POs (**supply**) | `openPurchaseOrderLines` | `:153-160` | `:393-417` → `poSupplyByLocationPeriodItem` | `promisedDate ?? orderDate+leadTime ?? today+leadTime` |

**Safety stock is NOT a demand source in `runMrp`.** It enters only downstream, in the reorder-policy sizing (`calculate_quantity_to_order` in SQL / `computePlanningOrders` in TS) via `demandAccumulationSafetyStock` and `reorderPoint`.

Bucketing helper — `mrp.ts:1056-1067`:
```ts
function findPeriod(date, today, periods) {
  if (date.compare(today) < 0) return periods[0];   // anything past dumps into week 0
  return periods.find(p => p.startDate.compare(date) <= 0 && p.endDate.compare(date) >= 0);
}
```
A date outside the 72-week horizon returns `undefined` and the line is silently dropped (`:376-377`, `:404-405`, `:488-489`, `:526-527`).

---

## 3. NETTING LOGIC — **it does not exist**

### The decisive code

`packages/ee/src/planning/mrp/mrp.ts:438-477` — the projection (forecast) loop. The variable is *named* `netDemand` but nothing is netted from it:

```ts
// Demand projections. Do NOT net firm job/PO supply here — supply is
// credited exactly once by explodeBom's running balance ...
for (const projection of demandProjections.data ?? []) {
  if (!projection.itemId || !projection.forecastQuantity || !projection.locationId) continue;

  const netDemand = projection.forecastQuantity;        // ← line 453: no netting at all

  if (netDemand > 0) {
    const key = makeKey(projection.locationId ?? "", projection.periodId, projection.itemId);
    grossDemand.set(key, (grossDemand.get(key) ?? 0) + netDemand);   // ← line 461: ADD
```

`mrp.ts:480-492` — the sales-order loop writes to the **same key** and **adds again**:
```ts
const key = makeKey(line.locationId ?? "", period.id ?? "", line.itemId);
grossDemand.set(key, (grossDemand.get(key) ?? 0) + line.quantityToSend);   // ← line 492: ADD
```

There is **no** `Math.max` anywhere in `packages/ee/src/planning/mrp/` except two unrelated clamps (`planning-actions.ts:210`, `:704`). Grep for `Math.max` across `mrp.ts` and `mrp-engine.ts` returns zero hits.

The only netting in `explodeBom` is **demand vs. on-hand + firm supply** — `packages/database/supabase/functions/lib/mrp-engine.ts:244-256`:
```ts
for (const period of periods) {
  running += jobSupply.get(periodKey) ?? 0;
  const grossQty = grossDemand.get(periodKey) ?? 0;
  if (grossQty <= 0) continue;
  const netRequirement = Math.max(0, grossQty - Math.max(0, running));
  running = Math.max(0, running - grossQty);
```
`grossQty` is the already-summed forecast+actual figure. There is no second dimension to reconcile.

### The same addition repeats in the read path — 4 sites total

**(a) `get_production_planning`** — latest definition `packages/database/supabase/migrations/20260715195226_planning-reads-demand-projections.sql:130-158`:
```sql
demand_data AS (
  SELECT "itemId","periodId",
    SUM(COALESCE("actualQuantity",0) + COALESCE("forecastQuantity",0)) AS "demand"
  FROM (
    SELECT ... FROM "demandActual"     WHERE ...   -- line 137
    UNION ALL
    SELECT ... FROM "demandForecast"   WHERE ...   -- line 143
    UNION ALL
    SELECT ... FROM "demandProjection" WHERE ...   -- line 153
  ) combined
  GROUP BY "itemId","periodId"
)
```

**(b) `get_purchasing_planning`** — `20260831190142_purchasing-planning-reads-demand-projections.sql:115-145`, byte-identical union.

**(c) `generatePlanningActions`** — `packages/ee/src/planning/mrp/planning-actions.ts:527-574`, with a comment that *states* the design:
```ts
// ── demand per (item, location, period): actual + forecast + projection,
//    the same union the planning RPCs read
...
byPeriod.set(periodId, (byPeriod.get(periodId) ?? 0) + (Number(quantity) || 0));   // line 560-563
```
called three times, once per table (`:566-574`).

**(d) `get_inventory_quantities`** — `20260316000000_inventory-demand-forecast.sql:141-153`: `demandActual + demandForecast` (notably **omits** `demandProjection`, inconsistent with (a)–(c)).

### The three numeric cases

Take item X, location L, week W. Authored `demandProjection.forecastQuantity = 10`.

| Case | Authored forecast | Open SO lines | MRP `grossDemand[L␟W␟X]` | RPC `demand_data` | Correct answer under consumption |
|---|---|---|---|---|---|
| A | 10 | 10 | **20** | **20** | 10 |
| B | 10 | 5 | **15** | **15** | 10 |
| C | 10 | 12 | **22** | **22** | 12 |

Trace for case A: `mrp.ts:461` sets the key to 10; `mrp.ts:492` adds 10 → 20. `explodeBom` (`mrp-engine.ts:248-251`) reads `grossQty = 20` and drives 20 units of component demand down the BOM. On the read side, the SO's 10 was written to `demandActual` (`mrp.ts:494-503` → `:821-835`), and the projection's 10 still sits in `demandProjection`, so `demand_data` sums 10 + 10 = 20 again.

### So: which formula is it?

**None of the netting formulas.** It is plain `forecast + actual` — pure addition. Not `max(forecast, actual)`, not `(forecast − actual) + actual`.

### Period boundary

Calendar week, **Sunday-start**, `en-US` locale, derived from `startOfWeek(datetime.today(companyTimeZone), "en-US")` and materialized as explicit `period` rows with `startDate`/`endDate` DATE columns. Matching is an **exact `periodId` equality join** on the read side (`d."periodId" = periods[n]`) and an exact map-key match in TS. It is *not* a date range between forecast entries and it is *not* a sliding window.

---

## 4. JOBS

### Make-to-stock jobs (not linked to a sales order)

They are **supply, never demand**, and they do **not** consume forecast. `openProductionOrders` (current definition, `20260811123619_widen-sales-production-scale.sql`, forked from `20260417000300`):
```sql
WHERE j."status" IN ('Planned','Ready','In Progress','Paused')
AND j."salesOrderId" IS NULL
```
They land in `jobSupplyByLocationPeriodItem` (`mrp.ts:363-389`), get merged with PO supply into `jobAndPoSupplyByLocationPeriodItem` (`mrp.ts:618-626`), and are credited **once** in the `explodeBom` running balance (`mrp-engine.ts:246`) and again on the read side via `supplyActual` (`mrp.ts:877-897`) → the RPC's `supply_data` CTE.

The practical consequence: a make-to-stock job reduces the *projected balance*, not the forecast. With forecast 10 + SO 10 = 20 demand and a 10-unit stock job, `netRequirement = 20 − 10 = 10`, and MRP suggests **another 10** — the double count is untouched.

### Sales-order-linked jobs — yes, deliberately excluded, but on the *supply* side

Two complementary guards prevent SO↔job double counting:

1. `openProductionOrders` drops `salesOrderId IS NOT NULL` jobs from supply entirely (above).
2. `openSalesOrderLines` (current, forked from `20260710051147_mto-sales-lines-drive-demand.sql`) **reduces the SO line's demand by its linked jobs' outstanding quantity**:
```sql
CASE
  WHEN sol."methodType" = 'Make to Order' THEN GREATEST(
    sol."quantityToSend" - COALESCE((
      SELECT SUM(GREATEST(j."quantity" - j."quantityReceivedToInventory" - j."quantityShipped", 0))
      FROM "job" j
      WHERE j."salesOrderLineId" = sol."id"
        AND j."companyId" = sol."companyId"
        AND j."status" IN ('Planned','Ready','In Progress','Paused')
    ), 0), 0)
  ELSE sol."quantityToSend"
END AS "quantityToSend"
```

3. `openJobMaterialLines` excludes `jm."methodType" != 'Make to Order'` (a sub-job will be spawned), and `explodeBom` skips writing `bomDerivedDemand` for MTO+Make children for the same reason (`mrp-engine.ts:264-267, 288-293`).

**This proves the codebase already knows how to prevent double counting between two demand-ish sources — it just applies that logic only between an SO line and its own job, never between a forecast and an SO.**

Also note the SO gate: `openSalesOrderLines` requires `so."status" IN ('To Ship','To Ship and Invoice')`. A `Confirmed` or `In Progress` sales order contributes **zero** demand to MRP.

---

## 5. THE GAP BUG — **CONFIRMED (as a special case of "no consumption at all")**

A sales order due in a period with zero forecast consumes **nothing** from any adjacent period. There is no backward consumption, no forward consumption, no consumption window at all.

Structural proof, three independent layers:

1. **Key identity.** Demand is stored in a flat map keyed on the exact triple `locationId ␟ periodId ␟ itemId` (`mrp-engine.ts:71-77`). Reads are `grossDemand.get(periodKey)` — a hash lookup on one exact key (`mrp-engine.ts:248`). Nothing in `mrp.ts` or `mrp-engine.ts` ever iterates neighbouring periods looking for forecast to draw down. The only code that *does* walk periods sequentially is the supersession on-hand draw-down (`mrp.ts:575-606`) and the `explodeBom` running balance (`mrp-engine.ts:244`), and both consume **inventory/supply**, not forecast.

2. **SQL join.** `demand_data` in both RPCs groups by `("itemId","periodId")` and the recursive `projections` CTE joins `d."periodId" = periods[p.period_index + 1]` — an equality join on a single period. A SQL window function or range join would be required for cross-period consumption; there is none.

3. **Nothing survives to a later stage that could do it.** By the time `computePlanningOrders` (`packages/utils/src/planning-sizing.ts:66`) runs, its input is a flat `projections: number[]` of already-collapsed running balances (`:49-50`). The forecast/actual distinction has been destroyed by the `SUM`, so no downstream consumption is even expressible.

**Compounding factor worth flagging:** `projections` is a **cumulative running balance** (recursive CTE, `20260715195226_...:238-241` and `:262-264`: `p."projection" + supply − demand`). So a double count in week 3 depresses weeks 3 through 52, not just week 3. The over-ordering is permanent across the horizon, not a one-week blip.

The nearest existing analog to a window is `itemPlanning.demandAccumulationPeriod`, used by the Demand-Based Reorder branch of `computePlanningOrders` (`planning-sizing.ts:91-120`) to chunk periods for **order sizing**. It operates on the already-summed balance and cannot repair double counting — it only smears the inflated requirement across a wider window.

---

## 6. PLANNED ACTIONS — where a netting change propagates

`runMrp` commits forecasts/actuals in one transaction (`mrp.ts:938-1032`), then calls `generatePlanningActions(client, db, { companyId, userId })` at `mrp.ts:1039` in a separate transaction so the planning RPCs read committed data.

Inside `packages/ee/src/planning/mrp/planning-actions.ts`, the netted demand reaches `planningAction` by **two distinct paths**:

- **New-supply actions (`Order` / `Make`).** Per location, `client.rpc("get_purchasing_planning" | "get_production_planning", ...)` at `:679-690`; the `week1..weekN` projected-balance columns are unpacked at `:735-738` and fed to `computePlanningOrders` at `:739-756`. Those week columns are the recursive `projections` CTE output, i.e. the additively-summed demand.
- **Change actions (`Expedite` / `Defer` / `Cancel` / `Increase` / `Decrease`).** The in-Node additive union at `:529-574` builds `demandByItemLocation`, converted to `demandPeriods` at `:777-785` and passed to `deriveChangeActions` at `:787-795`. That function runs a chronological *supply*-consumption walk (`:181-206`) — demand draws down on-hand, then the earliest open orders — and emits exactly one action per document.

Candidates are then diff-written against `planningAction` on the natural key `(item, location, type, period, target document)`.

**A netting change must therefore land in three places to stay consistent** — plus a fourth for UI truth:
1. `mrp.ts` Phase 4 (`:442-515`) — the gross-demand construction that drives BOM explosion.
2. Both SQL RPCs' `demand_data` CTE — `20260715195226_...:130-158` and `20260831190142_...:115-145`.
3. `planning-actions.ts:529-574` — the in-Node union.
4. (`get_inventory_quantities` `demand_forecast` CTE, `20260316000000_...:141-153`, if the Inventory table's `demandForecast` column should agree.)

Changing only one produces a grid and a worklist that disagree — exactly the failure mode the MRP-v2 spec calls out at `.ai/specs/2026-08-22-mrp-v2-planned-order-generation.md:376`.

---

## 7. LOOSE ENDS

**No prior attempt at forecast consumption exists.** Searches for `consumption`, `consumeForecast`, `forecastConsum*`, `netting`, and "double count" across `packages/ee/src`, `packages/database/src`, and the ERP production/items modules return only: accounting netting, scheduling remaining-work netting, `explodeBom`'s inventory netting, and `planning-actions.ts:181`'s supply-consumption walk. No `consumedQuantity` / `consumptionPeriod` / `forecastConsumed` columns exist on any table. No TODOs about forecast double counting.

**The additive behavior is documented as intentional** — `apps/erp/app/modules/agent/kb/docs/reference/forecast.md`:
> "A projection's full `forecastQuantity` enters gross demand at face value — it is *not* pre-netted against open production. ... Actual **sales orders** and **job material** demand are firm too — **they're added in full alongside the projection**."

That paragraph is accurate about the code and is the clearest statement that the "same-period netting" belief is mistaken. Note the doc also cites stale paths (`ui/Projection/...`, `routes/.../projections.new.tsx`) that are now `ui/DemandProjection/...` and `demand-forecasts.new.tsx`.

**MRP v2 spec touches the area but does not fix it** — `.ai/specs/2026-08-22-mrp-v2-planned-order-generation.md`:
- `:622` describes gross demand as "independent demand (sales orders, demand projections)" — still additive.
- `:851-868` (§8) proposes *suggested* projections (trailing average, `forecastMethod = 'suggested'`, CV gate), never auto-applied. `:1230-1231` explicitly says "`demandProjection` gains no columns."
- `:1225-1231` relates the forecast tables to the proposed `plannedOrder` entity; `plannedOrderPeg` (`:1027`, `:1122-1124`) mirrors `demandForecastSource`.

**Supersession interaction with forecasts — partially applied, and inconsistent.** `buildSupersessionRedirectMap` (`packages/database/supabase/functions/lib/supersession-pick.ts:33-84`, re-exported via `packages/database/src/supersession-pick.ts`) is built at `mrp.ts:256-259` gated on `today`, and Phase 4.5 (`mrp.ts:563-608`) redirects `grossDemand` — which by then **includes projection demand** — to the successor, stamping contributors with `redirectedFromItemId` (`:595-599`). So yes, supersession applies to forecasts *inside the explosion*.

But it does **not** apply on the read path:
- `demandProjection` rows still carry the **old** `itemId`, and the RPCs' third UNION arm reads that table raw. So in production/purchasing planning and in `planning-actions.ts`, a projection for a superseded part shows up under the old part, not the successor.
- Same for `demandActual`: `salesDemandByKey` / `jobMaterialDemandByKey` are populated at `mrp.ts:494-503` and `:531-540`, **before** Phase 4.5, and Phase 4.5 mutates only `grossDemand` and `topLevelContributors`. Actuals are written under the pre-redirect item.
- `base_items` in the RPCs then filters superseded items out (`20260715195226_...:216-231`), so that demand can vanish from the grid entirely.

**Other inconsistencies found:**
- `getItemDemand` (`apps/erp/app/modules/items/items.service.ts:647-683`, backing `ItemPlanningChart` via `routes/api+/items.$id.$locationId.forecast.ts`) reads `demandActual` + `demandForecast` but **not** `demandProjection` — so a top-level Make item whose only demand is a projection shows zero demand on its planning chart, while the planning grid shows it.
- `get_inventory_quantities` `demand_forecast` CTE likewise omits `demandProjection` (`20260316000000_...:141-153`).
- `mrp.ts:453` `const netDemand = projection.forecastQuantity` is a vestigial name from a version that netted supply here; the comment at `:438-441` explains why that netting was removed but the variable name was never updated. Likely a source of the "netting already works" belief.
- `mrp.ts:464` cites a non-existent migration filename.
- `getStartAndEndDates` is duplicated between `mrp.ts:1069-1097` and `shared.server.ts:498-560` (`getOrCreatePeriods`), differing only in company vs. location timezone — a company/location timezone mismatch can bucket the same date into different weeks for MRP vs. the authoring UI.
- Horizon mismatch: MRP plans 72 weeks (`mrp.ts:32`), `generatePlanningActions` 48 (`planning-actions.ts:37`), the forecast list 48 (`demand-forecasts.tsx:26`), the forecast edit grid 52 (`demand-forecasts.$itemId.$locationId.tsx:19`), and the RPCs take up to 52 `week` columns.

**Test coverage:** only `packages/database/supabase/functions/lib/mrp-engine.test.ts` exercises the engine, and it contains **no** `demandProjection` / `demandForecast` / `demandActual` references — `explodeBom` is tested purely on gross demand + on-hand + supply. `planning-actions.test.ts` tests `deriveChangeActions` / `convertOrdersToIncreases` in isolation. **No test pins the current additive behavior**, so a netting change would not be caught (in either direction) by the existing suite.
