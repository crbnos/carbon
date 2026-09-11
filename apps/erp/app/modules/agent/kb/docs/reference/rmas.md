# RMAs

> Customer return authorizations: receive shipped goods, disposition them, issue credit, and create replacements.

A **return merchandise authorization (RMA)** records what a customer is allowed to send back. It ties the returned quantity to the original sale when possible, then keeps receiving, material disposition, customer credit, and replacement fulfillment connected without treating them as one event.

## What an RMA controls

Confirming an RMA authorizes a return; it does not move inventory or post accounting. The physical movement begins when you choose **Receive** and post the resulting receipt. Credit and replacement actions are separate, so you can receive goods before deciding the final commercial outcome.

Whenever the original delivery is known, add lines from a posted shipment. Carbon shows shipped lines for the selected customer that still have quantity available to return. A source-linked line retains links to its sales order, shipment, and invoice, and confirmation prevents the combined quantity on active RMAs from exceeding what originally shipped.

Use **Add manually** for a blind return when the original document is unavailable. A manual line is not checked against a source-document return limit, so review its item and quantity before confirmation.

An RMA is the authorization, not the receipt. Inventory, cost, and the received counter change only when the return receipt is posted.

## Header fields

  - **RMA ID**: The readable return number. Carbon assigns the next `RMA` sequence when you do not enter one.
  - **Customer**: The customer returning the goods; required.
  - **Sales Order**: Optional link to the order behind the return.
  - **Customer Reference**: The customer's case, ticket, or authorization reference.
  - **Customer Contact / Location**: Who is coordinating the return and the customer address involved.
  - **Order Date**: The date of the authorization; required.
  - **Expiration Date**: The date shown as the authorization's expiry. Carbon does not currently block receiving after this date.
  - **Return Location**: The Carbon location that will receive the goods.
  - **Currency**: The currency used to value customer credit.
  - **Assignee**: The employee responsible for the RMA.

## Line fields

  - **Item**: The item being returned.
  - **Return Quantity**: The quantity authorized to come back.
  - **Unit Price**: The commercial price used as the basis for customer credit, not the inventory cost of the returned stock.
  - **Restock Fee Percent**: The percentage deducted from the gross credit for this line.
  - **Return Reason**: A company-defined reason such as Defective, Warranty, or Damaged in Transit.
  - **Disposition**: What to do with received material: *Pending*, *Use As Is*, *Return to Customer*, *Scrap*, or *Rework*.
  - **Received**: The posted received quantity compared with the authorized quantity.

After confirmation, the item, quantity, unit, price, restock fee, and source links are fixed. Reopen the RMA before changing those structural fields. Return reason and disposition remain the operational controls while the RMA is open.

## Status

  - **Draft**: Build the authorization and add its lines.
  - **To Receive**: Confirmed; at least one line still expects goods.
  - **Completed**: Every line is fully received or marked **Stop Receiving**.
  - **Cancelled**: The authorization was withdrawn before a return remained against it.

Status is driven only by receiving. Posting receipts increases each line's received quantity; voiding a receipt reverses it. **Stop Receiving** short-closes an outstanding line, while **Resume Receiving** makes that remainder expected again. There is no manual Complete action, and issuing credit, setting disposition, creating a replacement, or shipping goods back does not complete the RMA.

Only one Draft receipt can exist for an RMA. Choosing **Receive** again opens that receipt instead of creating a duplicate, and it includes only quantities that are still outstanding.

## Tracked items and disposition

For a Serial- or Batch-tracked item, select the identity that physically arrived on the receipt. The RMA line itself does not reserve an expected identity. Carbon offers consumed identities from posted shipments to the same customer; a blind return can use the normal serial or batch entry flow.

Posting the receipt puts returned tracked stock **On Hold**. Disposition determines what happens next:

- **Use As Is** releases held tracked stock to Available.
- **Scrap** or **Rework** opens a linked quality issue. Closing that issue performs the material disposition; Rework currently releases the tracked stock and does not create a production job.
- **Return to Customer** makes received quantity eligible for a no-revenue shipment back to the customer.

A fully received RMA becomes Completed immediately. Set the intended disposition while the RMA is still open when possible, especially on a one-line return.

## Credit and replacement orders

**Issue Credit** creates a Draft customer credit memo for received quantity that is not already reserved by another non-voided memo. The amount is quantity × unit price, less the restock fee. Creating the memo does not post it, apply it to an invoice, or refund cash; finish those steps in the normal memo and settlement flow.

**Create Replacement** creates a separate Draft sales order. It copies every authorized RMA line at its full return quantity and resolves current pricing, so review the new order if the replacement should be free or use warranty pricing. Replacement shipment has no effect on RMA completion.

## Related

  - Sales orders See the customer commitment and source lines behind an RMA.
  - Receipts Learn when posting brings returned goods into inventory.
  - Issues Resolve Scrap and Rework dispositions through quality.
  - Invoices and credit memos Post and settle the customer credit created from an RMA.

## Troubleshooting

### "Cannot confirm a return order with no lines"
Add at least one return line, then confirm again.

### "Line …: cannot authorize … — only … remains returnable for the linked document line"
Another active RMA already reserves part of the source quantity, or the requested quantity exceeds what shipped. Reduce the line, cancel the competing authorization, or use the correct source line.

### "Cannot reopen: quantity has already been received. Void the receipt first."
A posted receipt still owns returned quantity. Void it before reopening the RMA to Draft.

### "Cannot cancel: a receipt exists for this return order. Delete or void it first."
Even a Draft receipt blocks cancellation. Delete a Draft receipt or void a Posted one, then cancel.

### "Cannot void: a credit memo exists for this return order. Void it first."
A non-Voided memo reserves credit against the return. Void the memo before voiding its receipt.

### "Cannot void: stock received on this return was already consumed. Correct the remainder with an inventory adjustment instead."
Something has already consumed the receipt's cost layer. The receipt can no longer be reversed safely; correct the remaining inventory instead.

### "Configure at least one Issue Type and a location to escalate this line to an Issue"
Scrap and Rework need a quality issue type plus either a return location or user-default location. Configure both, then choose the disposition again.
