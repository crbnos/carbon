# PO Receipt Promised Date after confirmation

Last tested: 2026-10-26
Route: /x/purchase-order/<purchaseOrder.id>/details (properties panel, right side)

## Prerequisites
- A seeded dev company (`pnpm db:seed:dev`) has POs in every status: Draft, To Receive,
  To Receive and Invoice, To Invoice, Completed, Closed. Find them with
  `select po.id, po."purchaseOrderId", po.status from "purchaseOrder" po` scoped to
  the test user's company.
- Seeded POs have no promised dates and no line with its own date or received
  complete. To test those line cases, set them with SQL on the local DB
  (`purchaseOrderLine."promisedDate"`, `"receivedComplete"`) and restore after.

## Steps
### 1. Navigate
Open the PO details page. In the snapshot the properties panel renders four
"Calendar" buttons: Receipt Requested Date, Receipt Promised Date, Delivery Date,
then others. Find the right one with
`agent-browser snapshot | grep "Receipt Promised Date" -A4` (full snapshot, not -i).

### 2. Pick a date
Click that "Calendar" button, click "Next" to change month if needed, then click the
gridcell button by its full label, e.g. `button "Tuesday, 10 November 2026"`. The
date saves on selection (no Save button). Press Escape to close the popover.

### 3. Verify
Read `purchaseOrderDelivery."receiptPromisedDate"` and the order's
`purchaseOrderLine."promisedDate"` rows with psql (`SUPABASE_DB_URL` in `.env.local`).

### 4. Server refusal
From the logged-in page, `fetch('/x/purchase-order/update', {method:'POST', body})`
with FormData `ids`, `field=receiptPromisedDate`, `value=YYYY-MM-DD`. A To Invoice /
Completed / Closed order answers
`{"error":{"category":"rule","message":"Cannot change the promised date of a fully received purchase order."}}`.

## Expected
- To Receive / To Receive and Invoice / Draft: Receipt Promised Date enabled;
  Receipt Requested Date disabled on the confirmed ones.
- To Invoice / Completed / Closed: Receipt Promised Date disabled.
- A new date moves lines whose date is empty or equal to the previous order date;
  a line with its own date and a received-complete line keep theirs.
- The Shipping card on the page stays fully disabled on confirmed orders (by design).

## Common Failures
- Login: after clicking Continue the buttons go disabled for ~10 s before the
  redirect to /x; wait, don't retry.
- `psql -c` with two statements prints only the last result; run them separately.
