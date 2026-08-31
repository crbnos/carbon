# Demand projections

> Enter expected future demand for a make part, week by week, so planning orders ahead of the sales orders that haven't landed yet.

A demand projection is your best guess at how much of a part you'll need in a given week, entered before any sales order exists to prove it. Planning treats that guess as demand: it nets it against what you already have coming, explodes the part's method to pull in its components, and suggests the jobs and purchase orders you'd need to be ready. Projections are how you tell Carbon "we expect to sell 40 of these in March" so the long-lead parts are ordered in time.

You enter projections under **Production → Projections**, one part at a time, as a 52-week grid. Each cell is the quantity you expect to consume that week. Save it, and the next MRP run reads it.

## What a projection is

A projection lives on the `demandProjection` table, keyed by item, location, and a weekly `period` — one row per part / location / week with a `forecastQuantity` (`packages/database/supabase/migrations/20251020183630_mrp-projections.sql:3-25`). The `period` table is a shared, company-agnostic set of dated week buckets (`startDate`, `endDate`, `periodType`); Carbon creates them on demand as `getOrCreatePeriods` walks forward from today (`packages/database/supabase/migrations/20250610000433_demand-planning.sql:26-34`).

Only **make parts** carry projections. The item picker on the form is fixed to `type="Part"` with `replenishmentSystem="Make"` (`apps/erp/app/modules/production/ui/Projection/DemandProjectionForm.tsx:195-202`), so you project the things you build. Their purchased components inherit demand through the BOM explosion, not through their own projection.

Two tables look alike. `demandProjection` is your input — the numbers you type. `demandForecast` is planning's output — the exploded, per-component demand the MRP run writes back (`forecastMethod` = `"mrp"`). You never edit `demandForecast` by hand; it's rebuilt on every run (`packages/ee/src/planning/mrp/mrp.ts:918-963`). The Projections screen only ever touches `demandProjection`.

## How you enter one

The form is a drawer with a part, a location, and 52 numeric week cells grouped into four quarter tabs, plus a live bar-and-line chart of weekly and cumulative demand (`apps/erp/app/modules/production/ui/Projection/DemandProjectionForm.tsx:264-304`). Week 1 starts at the current week; each cell is labelled with its calendar date.

On save, the action pairs each `week{i}` value with the matching `period` id and upserts the rows (`apps/erp/app/routes/x+/production+/projections.new.tsx:50-78`). A cell you set to zero is deleted rather than stored, so the grid stays sparse (`apps/erp/app/modules/production/production.service.ts:3780-3829`). Editing a part reloads its existing rows back into the grid; deleting a part's projections clears every future week for that item and location (`apps/erp/app/routes/x+/production+/projections.delete.$itemId.$locationId.tsx:30-40`).

The grid spans 52 weeks (`WEEKS_TO_PROJECT = 12 * 4`, `apps/erp/app/routes/x+/production+/projections.tsx:23`). The list view pivots the per-period rows back into week columns for scanning, labelling the first as "Present Week" (`apps/erp/app/modules/production/ui/Projection/DemandProjectionTable.tsx:60-103`). Creating, editing, and deleting projections all require the `production` permission.

## How planning consumes it

Planning runs in-process from `@carbon/ee/planning` (`runMrp`), and it reads `demandProjection` directly as a demand source (`packages/ee/src/planning/mrp/mrp.ts:159-161`). A projected week's full quantity drives gross demand — open production you've already planned is *not* pre-subtracted here; instead firm job and purchase-order supply is credited exactly once during the BOM explosion's running balance, so a projection you're partway to covering doesn't get double-planned.

A projection's full `forecastQuantity` enters gross demand at face value — it is *not* pre-netted against open production (`packages/ee/src/planning/mrp/mrp.ts:430-461`). Firm job/PO supply is instead credited once through the BOM explosion's running on-hand/supply balance, so a projection partway covered by in-flight jobs isn't planned twice. Actual **sales orders** and **job material** demand are firm too — they're added in full alongside the projection (`packages/ee/src/planning/mrp/mrp.ts:463-531`).

That projection demand joins actual demand (open sales order lines and open job materials) in the gross-demand tally, and MRP explodes each make part's method to push component demand down the BOM. The result is written to `demandForecast` and to a `demandForecastSource` lineage table that tags every unit with where it came from: `"Sales Order"`, `"Job Material"`, or `"Demand Projection"` (`packages/ee/src/planning/mrp/mrp.ts:653-712`). On a part's planning page you can open the demand for any week and see exactly which projections, orders, and parent jobs make it up (`apps/erp/app/modules/items/items.service.ts:695-753`).

The run turns projected demand into *suggested* jobs and purchase orders. Nothing is created until you act on a suggestion. See `docs/reference/planning` for how those suggestions surface and how you convert them, and `docs/reference/reordering` for the per-part numbers (lead time, lot size, safety stock) that shape what a projection turns into.

## Fields

  - **Item**: The make part you're projecting demand for. Limited to parts with a **Make** replenishment system.
  - **Location**: The inventory location the demand lands at. Projections are scoped per location, so the same part can carry different numbers in different plants.
  - **Week 1 … Week 52**: Expected quantity consumed in each weekly bucket, starting from the current week. A blank or zero cell stores nothing.

Projections are a deliberately simple, manual input: there's no statistical or ML forecasting engine behind them, no seasonality model, no auto-generation from history. The schema reserves `forecastMethod` and `confidence` columns, but the Projections form writes neither — every projection is a hand-entered number. What makes them useful is the netting and BOM explosion on the planning side, not the forecasting itself.

## Troubleshooting

These are almost all preconditions — projections only exist for make parts, only planning writes the forecast, and creating/editing/deleting needs the `production` permission.

### The item I want to project isn't in the picker
The item picker is fixed to parts with a **Make** replenishment system (`type="Part"`, `replenishmentSystem="Make"`). You project the things you build; purchased components inherit demand through the BOM explosion, not through their own projection. If a part is missing, check that it's a Part with Make replenishment.

### I can't create, edit, or delete a projection
Creating, editing, and deleting projections all require the **`production`** permission. Without it the actions are blocked. Have an admin grant production access.

### I edited `demandForecast` but my change was overwritten
You never edit `demandForecast` by hand — it's planning's **output**, rebuilt on every MRP run (`forecastMethod = "mrp"`). Your input is `demandProjection`, edited only from the Projections screen. If you meant to change the projected numbers, edit them there and re-run MRP.

### Deleting a part's projection removed more than I expected
Deleting a part's projections clears **every future week** for that item and location (current week and beyond), not just the visible tab. It's an all-or-nothing clear per item/location, so delete only when you mean to wipe the whole forward projection.

### My projected quantity didn't turn into a full job/PO
Open production you've already planned reduces what a projection drives — but the credit happens once during the BOM explosion (firm job/PO supply is netted there), not by pre-subtracting from the projection. If you projected 100 and 30 units are already in flight, planning acts on the shortfall. And MRP only *suggests* jobs and POs; nothing is created until you act on a suggestion.

### A zero cell isn't saved
A blank or zero cell stores nothing — it's deleted rather than persisted, so the grid stays sparse. That's expected; only non-zero weeks become `demandProjection` rows.
