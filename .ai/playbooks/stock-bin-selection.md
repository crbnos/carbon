# Stock bin selection: job issues, shipments, double issue

Last tested: 2026-11-06
Routes: MES `/x/operation/<jobOperationId>`, ERP `/x/sales-order/new`, `/x/shipment/<id>/details`

## Prerequisites

- The dev company "Carbon Development", location Manufacturing Plant, bins A1-L1 … A3-L3.
- Seed the data with SQL (`.context/seed-bin-test.sql` shape). The UI path to stock and a Ready job is long.
  - Items with `itemTrackingType` Inventory and no `pickMethod` default.
  - Stock as `itemLedger` Positive Adjmt. rows: one item with no storage unit, one in a bin.
  - A Ready job with one `jobOperation` at a work center. Set `targetQuantity`; the default is 0, which shows "0 of 0".
  - `jobMaterial` rows: one named on an empty bin, one with no bin, one with `quantity` 5 / `estimatedQuantity` 10.
- A sales order needs a customer location with a US address. The demo sales rule "ITAR spacecraft — US ship-to only" blocks a line save without one.

## Steps

### 1. MES issue from the bin that holds the stock
1. Open MES `/x/operation/<op>`.
2. Click the row's "Issue Material". The modal title is the material name.
3. Fill "Quantity", click the heading to blur, then `requestSubmit` the form whose button reads "Issue".
4. Verify in `itemLedger`:
   - A named empty bin → the row is on no storage unit.
   - No bin and no default → the row is on the bin with stock.

### 2. Completion does not issue a unit twice
1. Issue a unit's share (5) by hand.
2. Click "Log completed", press "Increase" once, then `requestSubmit` the "Log Completed" form.
3. Verify: no new Consumption row for the material already issued.
4. Make the named bin short with a Transfer pair, then complete the next unit.
5. Verify: the named bin gives what it holds and the fullest other bin gives the rest.

### 3. Shipment fills the bin and warns
1. Create a sales order: Customer, Customer Location, Save.
2. Add a line in the "Add Line Item" drawer. The item search shows stock. The form fills the bin.
3. Clear `salesOrderLine.storageUnitId` with SQL to copy an API-created line.
4. Confirm the order (dialog "Confirm" button, `requestSubmit`).
5. Click "Ship", or `requestSubmit` the line page's "New Shipment" form (`/x/sales-order/<id>/<line>/shipment`).
6. Verify: the shipment line names the bin with stock. A line that names a bin keeps it, even when short; posting warns instead.
7. Click the line's bin button and pick an empty bin. Click "Post", then `requestSubmit` "Post Shipment".
8. Verify: a "Rule Violation" dialog with "Not enough stock in the storage unit" names the bin with stock.
9. Either Cancel and pick that bin, then post: no dialog, and the row is on that bin. Or click "Acknowledge & continue": it posts from the chosen bin.

### 4. Assembly view: step backflush, auto-complete, two tabs (all in the UI)
1. ERP `/x/job/new`: Item `BINTEST-ASSY`, Quantity 2 (fill, then Tab to commit), Save.
2. Job page: dismiss the Academy popup ("Dismiss"). "Add Operation": Process "Clean Room Assembly" (Operation Type becomes Assembly), Work Center, Description, Save.
3. Operation card → "Steps" tab → "Add Step": Name, "Save Step".
4. "Add Item": Part, Quantity (Tab), "Backflush" row → Operation = the new operation, Save. A new-material form has no step field.
5. Link the part to the step: the saved step's ⋯ → Edit → "Add parts" → pick the part.
6. "Release" → "Release Job".
7. MES `/x/operation/<op>` redirects to `/x/assembly/<op>`. "Mark done" on Unit 1.
8. Verify: one Consumption row per material, from the bin that holds stock; production row 1; Quantity 1/2; the view moves to Unit 2. No second issue.
9. Two tabs: `agent-browser tab new <same url>`. Mark done in one tab; the other updates to 1/2 by itself. Still one production row.
10. Save Method (job page) writes the operation and materials to the item, but not the step-part link; a new job from it still issues the loose parts at the step.

### 5. Serial completion repeated
1. MES serial operation with no steps (a `Process` operation of a serial make method) → "Select Serial Number" → Select tab → pick a unit.
2. "Log completed": read the form, `requestSubmit` it and `fetch('/x/complete.data')` the same FormData at once.
3. Verify: one production row; the resend returns `{}` and the ERP log says "This unit is already complete on this operation".

### 6. Quote → order with no default bin
1. `/x/quote/new`: Customer, Customer Location (dismiss the popup first), Save. "Add Line Item": item, Method "Pull from Inventory", Save.
2. Pricing grid: click Unit Price, fill, Enter.
3. "Finalize" → confirm. "Won" → wizard: "Skip" → pick the quantity radio → Next → "Convert".
4. Verify: the order line names the bin that holds the stock.

### 7. ERP job Complete (SQL backflush)
1. Create and release a 1-unit job from the saved method. "Complete" → Quantity Completed 1 (Tab) → "Complete Job".
2. Verify: each material's Consumption row is on the bin that holds the stock; the job is Completed.

## Selector Notes
- The sales order page has several forms with a Save button. Find the line form by `input[name=itemId]` together with `input[name=saleQuantity]`.
- Pressing Escape in the line drawer closes it.
- The shipment line's bin picker is a button labelled with the current bin name.
- An Academy video popup ("Dismiss") covers buttons on job and quote pages; dismiss it first.
- Inventory → Quantities: open an item with its row's "Open" link; a direct URL to the panel can render blank (dev hydration error). "Update Inventory" opens the adjustment form.

## Common Failures
- "Customer country is required" on a line save: the order has no customer location.
- "0 of 0" completed in MES: the seeded operation has `targetQuantity` 0.
