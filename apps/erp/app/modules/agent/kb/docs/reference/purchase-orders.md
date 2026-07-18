# Purchase orders

> A commitment to a supplier: what to receive, and what you'll be billed for.

A **purchase order** is a commitment to buy from a supplier. It may come from comparing supplier quotes or be raised directly, and it's the document receipts and supplier invoices reconcile against.

Like a sales order in reverse, a purchase order line keeps two independent counters: how much has been received, and how much has been invoiced. It only closes when both are satisfied. Receiving and billing advance the same order along separate axes.

## Line fields

  - **Item**: What's being bought.
  - **Purchase quantity**: Ordered quantity.
  - **Quantity received**: Received so far; `quantity to receive` is the remainder.
  - **Quantity invoiced**: Billed so far; `quantity to invoice` is the remainder.
  - **Conversion factor**: Converts the supplier's purchase unit to the stock unit.

## Types

A purchase order is one of three kinds: a plain **Purchase**, a **Return** to the supplier, or **Outside Processing** — sending parts out to a vendor for a production step, where the line links to a job operation.

## Status

The status is computed from the state of its lines, never set by hand.

  - **Draft**: Being built.
  - **Planned**: Suggested by planning.
  - **Needs Approval**: Held for sign-off (amount-gated); rejection lands on *Rejected*.
  - **To Receive and Invoice**: Confirmed; nothing received or billed yet.
  - **To Receive**: Fully invoiced, still owes receipt.
  - **To Invoice**: Fully received, still owes invoice.
  - **Completed**: Fully received and invoiced.
  - **Closed**: Ended.
  - **Rejected**: Sign-off was declined.

## Related

  - RFQ to bill Shop suppliers, place the order, receive and bill against it.
  - Receipts How goods are received against a purchase order.
  - Approvals Orders at or above a set amount wait for sign-off before they can be sent.
