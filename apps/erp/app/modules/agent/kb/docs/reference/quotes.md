# Quotes

> A priced offer to a customer — the front of the sales flow.

A **quote** is a priced offer to a customer: the line items they asked about, what each costs, and for how long. It's where a sale begins, before there's any commitment to build or ship. Accept it and it becomes a sales order; let it lapse and it closes on its own.

A quote is where pricing is negotiated and recorded. Lines support quantity breaks, so the price for ten can differ from the price for a hundred, and the number you settle on is what carries forward to the order. Quotes are optional, since an order can be raised directly, but when used, a quote and its eventual order are tied together through a shared opportunity rather than a rigid link.

## Fields

  - **Customer**: Who the offer is for.
  - **Lines**: The items quoted, each with quantity-break pricing.
  - **Revision**: Bumped as the quote is reworked, so history isn't overwritten.
  - **Expiration**: When the offer lapses.
  - **Status**: Where the quote is in its lifecycle (below).

## Status lifecycle

  - **Draft**: Being prepared; pricing still in progress.
  - **Sent**: Finalized and issued to the customer, the state that unlocks digital acceptance.
  - **Ordered**: Converted into a sales order.
  - **Partial**: Some lines converted to an order, others not.
  - **Lost**: The customer declined.
  - **Cancelled**: Withdrawn before a decision.
  - **Expired**: Lapsed past its expiration date.

Each line tracks its own progress too: **Not Started**, **In Progress**, **Complete**, or **No Quote** for a line you decline to bid. Finalizing a quote moves it to **Sent** and marks its lines **Complete**.

## Digital quotes

A **Sent** quote can be shared with the customer over a private link — no login. From it the customer **accepts**, optionally attaching their PO, and the quote converts straight to a sales order; or they **reject**, and it moves to **Lost**. Internal notes are stripped before anything reaches the customer.

Digital acceptance is gated: the quote must be **Sent** and the company must have digital quotes enabled. A companion customer portal then shows the buyer live order and job status as the work proceeds.

## Becoming an order

Converting a quote, internally or by the customer accepting, builds a sales order from its lines at the negotiated price and opens it at **To Ship and Invoice**. The quote itself flips to **Ordered**, or **Partial** if only some lines converted.

There's no path from a quote straight to a production job. A job is raised from a *sales order* line, so the sequence is always quote → order → job.

## Related

  - Sales orders What a quote becomes once it's accepted.
  - Quote to cash The full narrative: quote, order, ship, invoice, paid.

## Troubleshooting

### "Cannot modify a locked quote. Reopen it first."
A quote locks the moment it leaves **Draft** — any other status (Sent, Ordered, Lost, and so on) is read-only. Use the quote's reopen action to bring it back to Draft (which bumps the revision) before editing.

### "An item cannot be added to itself."
In the quote line's bill of materials, the item being made was selected as one of its own components. Pick a different item for the sub-assembly or material line.

### "Failed to convert quote to order"
The conversion action failed after line selection. Have the user retry with the lines re-selected; if it persists, check that the selected lines have valid quantities and pricing, and ask for the full error text.
