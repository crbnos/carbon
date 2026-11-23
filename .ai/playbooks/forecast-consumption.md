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

## Test: 0/0 window

1. On `/x/settings/planning`, set "Look back (weeks)" and "Look ahead (weeks)" to 0.
   The last 2 textboxes on the page are these fields. requestSubmit the form of
   `input[name=backwardPeriods]`.
2. Add a SAW-001 forecast: Week 2 = 20, Week 4 = 30, Week 9 = 10.
3. Click "Recalculate". On 2026-10-06: consumed 20, 0, 0, and Qty to Order 130.
4. Set 4 / 1 again and click "Recalculate". Expect consumed 20, 30, 10, and Qty
   to Order 90. This proves that the next run heals the result.
5. Delete the forecast.

## Test: late orders consume no forecast

1. Use a part with no other demand. On 2026-10-06: ANT-PATCH-01
   (`item_8ErCmrbQ6o6EPQabHXDKMt`).
2. Add a forecast of 25 in Week 1 (the current week).
3. Create a sales order at `/x/sales-order/new`. Customer: "Apex Space Research".
4. Add a line at `/x/sales-order/<id>/new`: the part, quantity 10, a promised date
   in the current week. Type the date into the day segment as `DDMMYYYY`.
5. Click "Confirm", then requestSubmit the "Confirm" button in the dialog. The
   confirm action runs MRP. Expect consumed 10 and Qty to Order 25.
6. Click "More options" → "Reopen". Open `/x/sales-order/<id>/<lineId>/details`.
   Set the day to a date before the current week. Save.
7. Confirm again. Expect consumed 0 and Qty to Order 35 (10 + 25).
8. Check that `demandActual.updatedAt` is later than the order's confirm time.
   Then you know that the run counted the order.
9. Clean up: Reopen, then "More options" → "Delete Sales Order". Delete the
   forecast. Click "Recalculate".

Leftovers after cleanup: deleting a sales order keeps its `opportunity` row and
the confirm PDFs in storage (`<companyId>/opportunity/<oppId>/`). MRP sets a
`demandActual` row to 0. It does not delete the row.

## Selector Notes

- `/x/production/demand-forecasts/delete/<item>/<loc>` is an action-only route.
  A GET shows raw JSON. Delete through the row menu.
- The "Recalculate" button has no confirmation. Find it with `snapshot -i`.
- `agent-browser screenshot <path>` needs an absolute path.

## Common Failures

- A `To Ship` or `To Ship and Invoice` order is locked. Reopen it before you edit a
  line.
- If the dev server rebuilds (for example after another session changes files),
  the browser can hang. Check `ps` for the `react-router dev` process. When its CPU
  use drops, open the page again.

- An item whose sales orders are `Confirmed` or `In Progress` shows them in the
  Inventory "On Sales Order" column, but MRP ignores them. Nothing is consumed.
