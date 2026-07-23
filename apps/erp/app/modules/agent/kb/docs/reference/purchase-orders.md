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

## Troubleshooting

### "Cannot modify a confirmed purchase order." / "Cannot delete lines on a confirmed purchase order."
A purchase order is locked at **"To Receive"**, **"To Receive and Invoice"**, **"To Invoice"**, **"Completed"**, and **"Closed"** — from release onward. Only Draft (and pre-release) orders are freely editable. Reopen the order to make structural changes.

### "Cannot finalize: supplier is not approved (Active)"
The company requires approved suppliers, and this order's supplier is *Pending*, *Inactive*, or *Rejected*. Set the supplier's status to **Active** (or get it approved), then finalize again.

### "You are not authorized to finalize this purchase order"
The order belongs to a different company than the one the user is signed into. Switch to the owning company.

### "Receiving can only be closed or reopened on a released purchase order"
Short-closing a line only applies once the order is released (at "To Receive", "To Receive and Invoice", "To Invoice", or "Completed"). Release the order first.

### "This line cannot be received"
The line is a comment or G/L account line — only item lines carry a receivable quantity.

### "This line has no outstanding quantity to receive"
The line is already fully received; there's nothing left to short-close. Reopen receiving on the line if more goods are expected.

### "Receiving is already closed for this line" / "Receiving is not closed for this line"
The close/reopen action was applied twice. The line is already in the requested state — refresh the page to see the current state.

### "Failed to finalize purchase order"
Generic wrapper. Common underlying causes: no PO number sequence configured for the company, or a PDF/email step failing (separate "Failed to generate PDF" / "Failed to send email" messages). Ask for the full error text and check the supplier contact's email if sending failed.
