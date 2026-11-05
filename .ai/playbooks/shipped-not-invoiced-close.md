# Shipped-not-invoiced close warning

Last tested: 2026-11-05
Route: /x/accounting/periods/<periodId>/close

## Prerequisites
- A local dev server running the review branch, an authenticated test user, an open accounting period, and posted sales-order shipments with quantities not fully invoiced by period end.

## Steps
1. Open Accounting → Accounting Periods → October 2026.
2. In the close checklist, find Invoice shipped sales orders.
3. Verify status Open / severity Warning and the button “2 uninvoiced shipments”.
4. Open that button. Verify Uninvoiced Shipments explains posted COGS with invoice quantities missing by period end, and links SHP000002 / SHP000003 with Posted status.

## Selector notes
- The checklist is a dialog on top of the periods list; wait for hydration.
- Opening the shipment button scrolls the task into view.
- Do not lock or close the period as part of this read-only check.

## Evidence
- .ai/scratch/e2e/babbage-ui/02-uninvoiced-shipments.jpg
- .ai/scratch/e2e/babbage-ui/02a-close-warning-row.jpg
