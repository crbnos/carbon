# Forecast Consumption

Last tested: 2026-10-06
Routes: `/x/settings/planning`, `/x/production/demand-forecasts`,
`/x/production/planning`, `/x/inventory/quantities`

## Prerequisites

- An item with open sales order lines in status `To Ship` or `To Ship and Invoice`,
  each with a promised date, and with no forecast of its own. MRP reads only these
  statuses (`openSalesOrderLines`). A `Confirmed` or `In Progress` order is not demand.
- In the Carbon Development company, SAW-001 (`item_5gqknUZj6kFeQn4fxTHz5a`) at
  Manufacturing Plant (`loc_U6GKN77Hz2XnBM8h9hSyFv`) fits: 3 lines of 30, promised
  10/14, 11/4 and 11/25. Check the dates again before each run, because they move.
- Ask the user before you create the forecast. The test writes to the database.

## Steps

### 1. Settings card (read-only)

1. Open `/x/settings/planning`.
2. Expect the "Forecast Consumption" card with "Look back (weeks)" = 4 and
   "Look ahead (weeks)" = 1.

### 2. Create the forecast

1. Open `/x/production/demand-forecasts/new`.
2. Item (first combobox): click it, type the part number, click the option.
3. Location (second combobox): check that it shows the right location.
4. Fill the weeks. The hidden inputs are 0-based: "Week 2 (10/11)" is `week1`.
   - In the 2026-10-06 run: Week 2 = 20, Week 4 = 30, Week 9 = 10, Week 10 = 15.
5. Click another week input after each fill, so the value commits.
6. requestSubmit the form whose button includes "Create Forecast".

### 3. Baseline before MRP

1. Open `/x/production/planning?location=<loc>&search=<part>`.
2. Expect "Qty to Order" = sales orders + full forecast (165 in the 2026-10-06 run).
   A new forecast counts at full value until the next run.

### 4. Run MRP

1. Click "Recalculate" (top right of Material Planning). No dialog opens.
2. Poll `demandProjection.consumedQuantity` until it changes. It took under 10 s.

### 5. Verify

| Surface | 2026-10-06 expected and seen |
|---|---|
| `demandProjection.consumedQuantity` | 20, 30, 10, 0 |
| Material Planning "Qty to Order" | 105; actions Make 30 (10/11) + 60 (11/1) + 15 (12/6) |
| Demand forecast edit drawer | "20 consumed", "30 consumed", "10 consumed" under the inputs |
| Inventory quantities "Demand Forecast" | 105 (90 actual + 15 forecast remainder) |
| `/api/items/<id>/<loc>/forecast` → `demandForecast` | only the 12/6 row, quantity 15 |
| `demandProjection.updatedAt` | unchanged by the MRP run |

### 6. Clean up

1. On `/x/production/demand-forecasts`, open the row's "Actions" menu.
2. Click "Delete", then click "Delete" in the dialog.
3. Click "Recalculate" on Material Planning again.
4. Expect "Qty to Order" back at the sales-order total (90).

## Selector Notes

- `/x/production/demand-forecasts/delete/<item>/<loc>` is an action-only route.
  A GET shows raw JSON. Delete through the row menu.
- The "Recalculate" button has no confirmation. Find it with `snapshot -i`.
- `agent-browser screenshot <path>` needs an absolute path.

## Common Failures

- An item whose sales orders are `Confirmed` or `In Progress` shows them in the
  Inventory "On Sales Order" column, but MRP ignores them. Nothing is consumed.
