# Sales Order Delivery Date Check

Last tested: 2026-11-10
Routes: /x/settings/sales · /x/sales-order/<id>/new · /x/sales-order/<id>/<lineId>/details · /x/part/<itemId>/planning?location=<id> · /x/quote/<id>/details (Won)

## Prerequisites
- Carbon Development demo data.
- A demo sales rule "ITAR spacecraft — US ship-to only" BLOCKS any line whose order has no Customer Location with a country. Demo customers created through the UI have none. Set `salesOrder.customerLocationId` to the customer's US location in the local DB, or pick it in the order header.
- A second demo rule "Research orders need program sign-off" is only a warning: click "Acknowledge & continue".
- SO000005 (Draft) has no exchange rate, so no line can be added to it. Create a new order instead.

## Steps
### 1. Company level
- Open /x/settings/sales. The card "Delivery Date Check" has a combobox "Check".
- Pick "Lead Time — …". requestSubmit the form that holds the h3 "Delivery Date Check".
- Verify: toast "Delivery date check updated"; `companySettings.deliveryDateControl = 'Lead Time'`.

### 2. Warning inside the fence
- Create a sales order (customer Apex Space Research), then open its /new line route.
- Item combobox: type "PCB-EPS-R1" and pick the option. The method becomes Make to Order.
- Promised Date: click the "day" spinbutton, type 20, 11, 2026 (the order is day, month, year), then press Tab.
- Verify: the alert "This date cannot be met" — "The lead time is 28 days. The earliest delivery date is 8 Dec 2026." (own 7 + PCB-BARE-REV3 21).

### 3. Use the earliest date
- Click the button "Use 8 Dec 2026". Verify `input[name=promisedDate]` is 2026-12-08 and the alert is gone.

### 4. Keep a failing date
- Set the date back inside the fence. Fill "Reason for keeping this date". requestSubmit "Save" and acknowledge the research warning.
- Verify in the DB: `deliveryDateStatus = Missed`, `deliveryDateConstraint = Lead Time`, the earliest date, `deliveryDateOverriddenBy` = test user, the reason. The explorer row shows the image "Date kept". The Inngest dev server (`/v1/events`) has `carbon/workflow-moment.raised` with `moment: sales.deliveryDateOverridden`.

### 5. A passing date clears the record
- On the line's details route, set a date after the fence and save. Verify: `Met`, and the 3 override columns are NULL.

### 6. Item override
- /x/part/<itemId>/planning?location=<lineLocation>: the combobox "Delivery Date Check" set to "None", then save. A date inside the fence shows no alert. "Clear Delivery Date Check", then save, sets NULL and the alert returns.

### 7. Quote conversion
- Q000002 (Sent): click "Won", then "Skip", pick one break per line, Next, Convert. A line whose quote lead time is inside its fence gets the explorer image "Date not confirmed" (amber).

### 8. Stock and Capacity (live endpoint)
- From the browser: POST JSON `{ salesOrderLineType, itemId, locationId, methodType, saleQuantity, promisedDate }` to `/x/sales-order/<id>/delivery-date`. The response is `{ data: { control, result }, error }`.

## Selector Notes
- Date fields are react-aria spinbuttons: click "day, Promised Date", then use `keyboard type` for each part and press Tab.
- The item picker: click the combobox, `keyboard type` the readable id, then click the option.

## Common Failures
- "Failed to create sales order line." with "has no exchange rate" in the server log: a demo order without an exchange rate (SO000005).
- The Rule Violation dialog with a disabled "Confirm": the ITAR rule (no ship-to country), not this feature.
