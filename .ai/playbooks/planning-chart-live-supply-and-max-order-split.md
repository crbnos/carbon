# Planning chart live supply, legend what-if, max order split, surplus Cancel

Last tested: 2026-10-13
Routes: /x/production/planning, /x/purchasing/planning, /x/part/$itemId/planning

## Prerequisites
- Dev stack up and migrations applied (`crbn migrate`). A migration edited after
  its version was recorded is NOT re-applied; run the file with `psql -f`.
- A Buy item with an open Order suggestion, a supplier part (conversion factor 1
  keeps the drawer in inventory units), and policy Demand-Based Reorder.
- A make-to-stock job (Planned/Ready) on an item with no demand, for the Cancel.
- MRP has run at least once after the data exists (Recalculate button, or wait
  for the 3-hourly cron on the hour UTC).

## Steps

### 1. Surplus item on Production planning (issue 10)
Open `/x/production/planning?location=<plant>`. The item with the demand-less
job is listed with a "Cancel" chip in the Actions column. Expand the row: the
line reads "Cancel job <J…>" with Review/Apply.

### 2. Purchasing planning loads (RPC)
Open `/x/purchasing/planning?location=<plant>`. Grid renders rows; the row's
button reads "Order <qty>".

### 3. Max order quantity splits (issue 6)
Open `/x/part/<itemId>/planning?location=<plant>`. In the Planning card set
"Maximum Order Quantity" (react-aria number: `fill`, then click another field
to blur; verify `input[name=maximumOrderQuantity]`). Submit with
`requestSubmit` on the FIRST button whose text starts with "Save" (the card has
its own form; a later Save belongs to Supersession). The save re-runs MRP.
Back on Purchasing planning, click the row's "Order <qty>" button: Suggested
Orders lists several rows each <= the maximum (2280 with max 1000 → 1,000,
1,000, 280), due dates spread across the week.

### 4. Order, then the chart (issues 2 and 9)
Click the drawer's "Order" button. PO lines are created with `requiredDate`
only. Open the part planning tab: the "Incoming" card grows by the ordered
quantity before any MRP run, and every new PO row in Supply & Demand shows a
date (no "No due date").

### 5. Legend what-if (issue 7)
Read `path.recharts-line-curve`'s `d`. Click the "Supply" legend button: `d`
changes. Click again: `d` is identical to the first read.

## Selector Notes
- Legend buttons are plain buttons named "Projected on hand", "Safety stock",
  "Supply", "Planned", "Demand", "Demand Forecast" under the "Projected
  inventory" heading.
- The planning card's number fields have no accessible name; locate by the
  "What is Maximum Order Quantity?" help button, the textbox follows it.
- Summary cards: generic "Quantity on Hand<N>", "Incoming<N>", "Outgoing<N>".

## Common Failures
- `psql -c "a; b"` prints only the last statement's result — one statement per
  call when reading probes.
- A sizing function without the accumulation-period clamp spins forever on a
  stored period of 0; set `statement_timeout` on probes.
