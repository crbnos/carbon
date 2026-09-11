# Supplier returns

> Return received goods to a supplier, preserve serial or batch identity, claim credit, and create a replacement PO.

A **Supplier Return** records goods your company is authorized to send back to a supplier. It connects the original receipt or purchase order to the outbound shipment, supplier credit, quality issue, and any replacement order while keeping those events independently auditable.

## What a Supplier Return controls

Start from **Purchasing → Returns**, choose **Supplier Return**, and select the supplier. The supplier may give you its own authorization number; record that in **Supplier RMA #**. Carbon's customer-facing RMAs are a different Sales entity.

Whenever possible, choose **Add from receipt**. Carbon lists posted receipt lines for the supplier that still have quantity available to return, newest first. A source-linked line retains its receipt, purchase order, and invoice provenance. At confirmation, Carbon locks the relevant source rows and prevents active returns from authorizing more than was received.

Use **Add manually** for a blind supplier return when no source document is available. A manual line deliberately skips the source-quantity cap, so confirm the item, unit, price, and quantity yourself.

Confirming authorizes the outbound return but does not remove inventory. Stock and cost change only when the linked shipment is posted.

## Header fields

  - **Return ID**: The readable return number. Carbon assigns the next `RTS` sequence when you do not enter one.
  - **Supplier**: The supplier receiving the goods; required.
  - **Purchase Order**: Optional link to the original order.
  - **Supplier RMA #**: The authorization or case number supplied by the vendor.
  - **Supplier Contact / Location**: Who is coordinating the return and the vendor address involved.
  - **Order Date**: The date of the return authorization; required.
  - **Expiration Date**: The authorization expiry shown on the return. Carbon does not currently block shipping after this date.
  - **Return Location**: The Carbon location shipping the goods back.
  - **Currency**: The currency used for the supplier credit.
  - **Assignee**: The employee responsible for the return.

## Line fields

  - **Item**: The item being returned.
  - **Return Quantity**: The quantity authorized to leave, expressed in the item's inventory unit.
  - **Unit Price**: The supplier credit basis per inventory unit.
  - **Restock Fee Percent**: The percentage deducted from the gross supplier credit.
  - **Return Reason**: A shared company-defined reason such as Defective, Warranty, or Wrong Item Shipped.
  - **Serial numbers / Batches to return**: The on-hand tracked identities selected for this line.
  - **Shipped**: The posted returned quantity compared with the authorized quantity.

Purchase quantities may use a supplier pack or other conversion factor, but Supplier Return quantities and prices are stored in the inventory unit. When a line comes from a receipt or purchase order, Carbon converts it during authoring rather than carrying the supplier unit into the return.

After confirmation, the item, quantity, unit, price, restock fee, and source links are fixed. Those fields can only be changed while the return is Draft. Return reason and the selected serials or batches remain operational details while the return is open.

## Status

  - **Draft**: Build the authorization and select what will go back.
  - **To Ship**: Confirmed; at least one line still expects shipment.
  - **Completed**: Every line is fully shipped or marked **Stop Shipping**.
  - **Cancelled**: The authorization was withdrawn before a shipment remained against it.

Status is driven only by shipping. Posting the return shipment increases each line's shipped quantity; voiding it reverses that quantity. **Stop Shipping** short-closes a remainder, while **Resume Shipping** makes it outstanding again. Supplier credit and a replacement purchase order do not participate in completion.

Only one Draft shipment can exist for a Supplier Return. Choosing **Ship** again opens it, and Carbon fills it with the outstanding quantity on lines that have not been short-closed.

## Tracked items

For a Serial- or Batch-tracked item, pick the specific on-hand identities to send. Carbon offers Available identities whose receipt provenance resolves to a posted receipt from this supplier. A receipt-linked line with exactly one eligible identity selects it automatically.

Posting a full serial or batch return changes that tracked entity to Consumed. A partial batch return splits off a consumed departing child while leaving the reduced parent available. Voiding the shipment restores the identities and records a separate genealogy event.

Supplier Return lines do not have a disposition field: the material leaves inventory. If an issue's affected material is marked **Return to Supplier**, Carbon can create a Draft Supplier Return from the issue and preserve its source and tracked-entity links. That issue cannot close until the linked return is shipped, short-closed, or cancelled.

## Supplier credit and replacements

**Issue Credit** is available after quantity ships. It creates a Draft supplier memo for shipped quantity not already reserved by a non-voided memo. Although the button uses the business phrase “Issue Credit,” Carbon stores this AP document as a **Debit** memo because it reduces what you owe the supplier.

The memo amount is quantity × unit price, less the restock fee. Creating it does not post the memo or settle cash. Open it under Credit / Debit Memos and choose **Post**. A Draft memo already reserves the creditable quantity, while the Supplier Returns list counts only Posted credit in its **Credited** total.

A non-Voided debit memo, including a Draft one, blocks voiding the supplier-return shipment. Void the memo first if the physical shipment must be reversed.

**Create Replacement** makes a separate Draft purchase order and links it back to the return. It copies all authorized lines, not only shipped or credited quantities, and converts them back to the appropriate purchase unit. Review pricing and quantities before releasing the replacement PO.

## Related

  - Purchase orders See the supplier commitment and source lines behind a return.
  - Receipts Understand the inbound documents that establish returnable quantity.
  - Shipments Learn when posting removes returned goods from inventory.
  - Issues Create a Supplier Return from affected material marked Return to Supplier.

## Troubleshooting

### "Cannot confirm a return order with no lines"
Add at least one line, then confirm again.

### "Line …: cannot authorize … — only … remains returnable for the linked document line"
The line exceeds what the source says was received after quantities reserved by other active Supplier Returns. Reduce it, cancel a competing authorization, or select the correct source.

### "Cannot reopen: quantity has already shipped. Void the shipment first."
A posted shipment still owns returned quantity. Void it before reopening the return to Draft.

### "Cannot cancel: a shipment exists for this return order. Delete or void it first."
Even a Draft shipment blocks cancellation. Delete a Draft shipment or void a Posted one, then cancel.

### "Cannot void: a debit memo exists for this return order. Void it first."
A Draft or Posted supplier memo reserves credit against the shipment. Void that memo before voiding the shipment.

### "Shipping can only be closed or reopened on a confirmed return order"
Stop Shipping and Resume Shipping apply only after confirmation, while the return is To Ship.

### "Could not resolve a single supplier — select one explicitly"
An issue-based return found either no supplier or more than one possible supplier. Select the supplier in the Create Supplier Return card.

### "Return order confirmed, but the PDF could not be generated"
The Supplier Return is already confirmed. Retry or download the Return to Supplier PDF separately instead of confirming again.
