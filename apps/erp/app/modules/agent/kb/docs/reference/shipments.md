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
