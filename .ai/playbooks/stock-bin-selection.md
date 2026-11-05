# Stock bin selection: job issues, shipments, double issue

Last tested: 2026-11-05
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
6. Verify: the shipment line names the bin with stock.
7. Click the line's bin button and pick an empty bin. Click "Post", then `requestSubmit` "Post Shipment".
8. Verify: a "Rule Violation" dialog with "Not enough stock in the storage unit" names the bin with stock.
9. Either Cancel and pick that bin, then post: no dialog, and the row is on that bin. Or click "Acknowledge & continue": it posts from the chosen bin.

## Selector Notes
- The sales order page has several forms with a Save button. Find the line form by `input[name=itemId]` together with `input[name=saleQuantity]`.
- Pressing Escape in the line drawer closes it.
- The shipment line's bin picker is a button labelled with the current bin name.

## Common Failures
- "Customer country is required" on a line save: the order has no customer location.
- "0 of 0" completed in MES: the seeded operation has `targetQuantity` 0.
