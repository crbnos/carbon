# Receipts

> Goods coming in: receiving against a purchase order and posting to inventory.

A **receipt** brings goods in. Like shipments, one receipt model serves several sources: most often a purchase order, but also inbound transfers. Posting is what turns a delivery into stock on hand.

A receipt line soft-links back to the purchase order line it fulfills. Posting adds the quantity to inventory, raises the order line's received quantity, and advances the order. When accounting is enabled, it also debits inventory (or work-in-process, for outside processing) against a goods-received-not-invoiced accrual that the supplier invoice later clears.

## Fields

  - **Source document**: The purchase order (or transfer) being received.
  - **Received quantity**: Units on this receipt, per line.
  - **Conversion factor**: Converts the supplier's purchase unit to the stock unit.
  - **Location**: Where the goods land.

## Status

  - **Draft**: Being prepared; nothing posted.
  - **Pending**: Queued to post.
  - **Posted**: Inventory increased and the order advanced.
  - **Voided**: Reversed after posting.

Receive an item flagged for inspection and its units land **On Hold**, with an inbound inspection opened at *Pending* — they don't become available stock until the inspection clears.

## Related

  - Receive, match, bill Posting a receipt in the RFQ-to-bill flow.
  - Purchase orders The document a receipt advances.
