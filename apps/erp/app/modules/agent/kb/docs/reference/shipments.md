# Shipments

> Goods going out — one posting model serving sales orders, returns, and transfers.

A **shipment** moves goods out the door. One shipment model serves several source documents: a sales order, a purchase return, an outbound transfer. Each is tagged by what it came from, so the same posting logic handles them all.

Creating a shipment changes nothing on hand. **Posting** it is the event that matters: it relieves inventory, advances the source document, and, when accounting is enabled, books the cost of what left. A shipment can be partial, so an order can go out in several.

## Fields

  - **Source document**: The order, return, or transfer being shipped.
  - **Shipped quantity**: Units on this shipment, per line.
  - **Fulfillment**: Where a line is sourced: *Inventory* (from stock) or *Job* (from a production job).

## Status

  - **Draft**: Being prepared; nothing posted.
  - **Pending**: Queued to post.
  - **Posted**: Inventory relieved and the source document advanced.
  - **Voided**: Reversed after posting.

Posting decrements inventory and bumps the source line's sent quantity; a sales order line's *sent complete* flag flips only once the cumulative shipped quantity reaches the ordered quantity. Posting a shipment does **not** create the invoice — billing is a separate step.

## Related

  - Ship, invoice, get paid Posting a shipment in the quote-to-cash flow.
  - Sales orders The document a sales shipment advances.

## Troubleshooting

Exact errors users hit when posting, voiding, or picking shipments.

### "Shipment is empty"
The post dialog blocks posting when no line has a shipped quantity above zero (and no fixed-asset line is marked shipped). Enter the shipped quantity on at least one line first.

### "Tracked entity is not available"
A batch assigned to a shipment line isn't in **Available** status — it may be Reserved, On Hold (for example pending inbound inspection), Consumed, or Rejected. Free it up (clear the hold, finish the inspection) or allocate a different batch.

### "Serial numbers are missing or unavailable"
A serial-tracked line doesn't have enough available serial units to cover the shipped quantity. Allocate more available serials or reduce the shipped quantity.

### "Cannot post shipment with expired batch"
The full message names the batch id. The company's expired-entity rule is **Block** and a batch on the shipment is past its expiration date. Options: allocate a different batch, correct the expiration date on the tracked entity (reason required), or change the expired-entity rule in Settings → Inventory to Warn. See `docs/reference/shelf-life`.

### "Posted shipment with expired batch"
The Warn-policy counterpart of the error above — the shipment posted, this is informational. Switch the company rule to Block if this should stop future posts.

### "Batch has insufficient quantity"
The quantity allocated to the line exceeds what that batch has on hand. Reduce the allocation or pick an additional batch.

### "Can only void posted shipments"
Voiding applies only to a shipment at **"Posted"**. A Draft or Pending shipment can be edited or deleted instead.

### "Cannot delete a posted shipment"
A posted shipment can't be deleted — void it instead, which writes reversing entries.

### "Failed to post shipment"
Generic wrapper when the posting function fails. Common underlying causes: the `docs/reference/accounting` for the posting date is closed or locked, or default accounts are missing ("Error getting account defaults"). Ask the user for the full error text if available.
