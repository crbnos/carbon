# Sales orders

> A confirmed customer commitment: what to ship and invoice, tracked line by line.

A **sales order** is a confirmed commitment to deliver items to a customer. It may begin as a quote, or be entered directly; either way it's the document the rest of fulfillment keys off: shipments, invoices, and any make-to-order jobs all trace back to its lines.

The order line is where fulfillment is scored. Each line tracks how much was sold against how much has shipped and how much has been invoiced, and it stays open until both are complete, which is what lets one order be delivered and billed in batches without losing the remainder.

## Line fields

  - **Item**: What's being sold.
  - **Sale quantity**: Ordered quantity.
  - **Quantity sent**: Shipped so far; `quantity to send` is the remainder.
  - **Quantity invoiced**: Billed so far; `quantity to invoice` is the remainder.
  - **Unit price**: Price per unit, net of discounts.
  - **Method**: How the line is fulfilled: *Make to Order*, *Pull from Inventory*, or *Purchase to Order*.

## Status

The stored status reflects what's outstanding, and the order list shows a computed **display status** on top of it.

  - **Draft**: Being built; not yet committed.
  - **Needs Approval**: Held for sign-off (amount-gated).
  - **To Ship and Invoice**: Confirmed; nothing shipped or billed yet.
  - **To Ship**: Fully invoiced, still owes shipment.
  - **To Invoice**: Fully shipped, still owes invoice.
  - **Completed**: Every line shipped and invoiced.
  - **Closed**: Ended early.
  - **Cancelled**: Abandoned.

The order list can read **In Progress** even while the stored status is *To Ship and Invoice* — that's the display status reflecting a make-to-order line whose jobs aren't finished yet. The stored status still drives the flow.

## Related

  - Quote to cash How a quote becomes a sales order, then ships and invoices.
  - Jobs A make-to-order line becomes a job that builds the item.
