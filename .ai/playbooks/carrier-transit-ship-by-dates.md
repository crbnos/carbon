# Carrier transit time and ship-by dates

Last tested: 2026-11-17
Routes: /x/inventory/shipping-methods/<id> · /x/customer/<id>/shipping · /x/sales-order/<id>/details · /x/sales-order/<id>/new · /x/shipment/<id>/details · MES /x/jobs, /x/operations, /x/assigned

## Prerequisites
- Demo data. A stack seeded before 2026-11-17 has no transit days on its shipping methods: set them in the drawer first.
- The sales order must be Draft, Needs Approval or Confirmed. "To Ship and Invoice" and later statuses lock the Shipping card (`SALES_ORDER_LOCKED_STATUSES`). In a local test, set `salesOrder.status = 'Draft'`.
- A shipment needs a line with a shipped quantity. Every demo order line is Make to Order; for a test, set one line to `Pull from Inventory` with a `storageUnitId` that holds the item, then create the shipment from the order's Shipments menu.

## Steps
### 1. Transit days on the shipping method
- Open /x/inventory/shipping-methods/<id>. The field "Transit Days" is a react-aria number: fill, then click "Name" to blur.
- -1 cannot be typed (minValue 0 clears it). Posting `transitDays=-1` to the route returns 422.
- requestSubmit the form whose button reads "Save". Verify `shippingMethod.transitDays`.

### 2. Ship-to override
- /x/customer/<id>/shipping, card "Transit Times", link "Add" → drawer.
- "Ship To" combobox → the customer's location; "Shipping Method" combobox → the method; "Transit Days" fill.
- requestSubmit the form whose action contains `/shipping/transit/new`. Verify the `customerLocationTransitTime` row.

### 3. Recalculate prompt
- On the order, the Shipping card "Promised Date": click "day, Promised Date", keyboard type day, month, year, press Tab.
- requestSubmit the form whose action contains `/shipment`. The dialog "Recalculate ship dates" says "… on N lines" (fully shipped lines are not counted).
- "Keep dates": no line changes. "Recalculate": every open line moves to arrive-by − transit days.

### 4. Late to arrive
- A line whose `promisedDate` + transit days is after the arrive-by date shows the image "Late to arrive" next to its item id in the explorer.

### 5. Shipment estimate and Mark Delivered
- Post the shipment ("Post" → "Post Shipment", "Acknowledge & continue" for the demo research rule).
- Verify `shipment.estimatedDeliveryDate` = posting date + transit business days, and the header "Arrives … (estimated)".
- "Mark Delivered" → modal "Delivered on" (default today) → "Save". Header then reads "Delivered …" and the button "Edit Delivery".
- Server refusals: POST `deliveredDate` to `/x/shipment/<id>/delivered` with tomorrow, a date before posting, or a non-date.

### 6. Measured transit
- With 5 or more delivered shipments of the method in 90 days, the drawer shows "Last 90 days: …" and "Use N days". Clicking it saves N and the field shows N.

### 7. MES countdown
- Move a job's ship-by date with `UPDATE "salesOrderLine" SET "promisedDate" = …` (the trigger copies it to `job.shipByDate`).
- MES /x/operations, /x/jobs and /x/assigned (board and List view) show "Ships in N days" or "N days late".

## Selector Notes
- The customer Shipping card's add button is the link "Add", not "New".
- On the sales order details page, an iframe can cover the Properties panel's "Add promised date" button; use the Shipping card date instead.
- An Academy video dialog may open on a shipment page; click "Dismiss".

## Common Failures
- Shipping card dates disabled: the order status locks it.
- A new shipment with no lines: the order line is Make to Order with no finished job.
