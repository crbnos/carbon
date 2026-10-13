# MRP tester fixes (confirmed items)

Source: tester report of 2026-10-12, verified read-only the same day. Fixes
the five items that were confirmed in code. Not in scope: #8 (dependent demand
is lead-time-offset twice — needs a decision on what a demand period means),
#4/#5 remaining gaps (supplier-part order multiple, batch size under Fixed
Reorder Quantity, Increase rounding — product calls).

## Tasks

- [x] **#6 Max order quantity splits, never clamps** —
  `packages/utils/src/planning-sizing.ts` Demand-Based Reorder: size the window
  need (min, then multiple), then split it into orders of
  `perOrder = min(lotSize, maximumOrderQuantity)` (zeros ignored; floored to the
  order multiple when one is set). `orderSizingRules` returns the same
  `perOrder` so the pages' `splitIntoOrders` round-trips. SQL twin
  `calculate_quantity_to_order` drops the `LEAST(total, max)` clamp (new
  migration). Tests: `planning-sizing.test.ts` (replace the "capped to 30"
  pin), `planned-orders-from-actions.test.ts`.
- [x] **#7 Legend toggles drive the projection line** —
  `ItemPlanningChart.tsx` `chartData` reads `hiddenSeries`; a hidden series
  contributes 0 to the running projection and to stockout / below-safety
  detection. Pure helper + test in `planningSupplyDemand.ts`.
- [x] **#9 PO due date in the Supply & Demand list** — `getOpenPurchaseOrderLines`
  selects `promisedDate`, `dueDate` (required), `orderDate`, `leadTime`; the
  forecast route derives the row date with `purchaseOrderLineArrivalDate`
  (exported from `@carbon/planning`).
- [x] **#2 Chart bars from live open orders** — the forecast route buckets
  `openPurchaseOrderLines` / `openProductionOrders` into periods by the same
  dates MRP uses (`purchaseOrderLineArrivalDate`, `jobCompletionDate`, before
  today → first week, past horizon → dropped) instead of reading
  `supplyActual` + `supplyForecast`. Pure `bucketSupplyByPeriod` + test. Chart
  sums per (period, source) instead of assigning.
- [x] **#10 Surplus-only items reach the engine and the screen** — new migration
  re-creating `get_production_planning` and `get_purchasing_planning` with the
  item predicate widened: `OR EXISTS (supply_data with supply > 0)`.
- [x] Rules: `.claude/rules/mrp-system.md` (lot-sizing claim, RPC predicate,
  chart source).
- [x] Verify: `pnpm --filter @carbon/utils test`, `pnpm --filter erp test
  planningSupplyDemand`, scoped typecheck (utils, planning, erp), biome.
  Migrations cannot be applied here (local Supabase down) — flag.
