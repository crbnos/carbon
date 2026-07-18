# Ship, invoice, get paid

> Fulfill the order, post the shipment and invoice, then record payment.

You have a sales order sitting at **"To Ship and Invoice"**. Cash is four moves away: fulfill the lines, post a shipment, raise an invoice, record payment. None of them auto-chain. Each is a discrete, posted step you take when the work is actually ready.

## The line stays open

A sales order line keeps score. It tracks `saleQuantity` against `quantitySent` and `quantityInvoiced`, with the remaining `quantityToSend` and `quantityToInvoice` computed for you. The line only closes when it is **both** fully sent and fully invoiced. That single rule is what lets one order ship and bill in pieces without losing the remainder.

## Three ways to fulfill a line

The method type on each line decides where the goods come from:

- **Make to Order** raises a production job for the line, the `guides/order` in full.
- **Pull from Inventory** ships from stock you already hold: no job, just a pick.
- **Purchase to Order** buys it in for this order; its **drop-ship** variant has the supplier ship straight to your customer, so the goods never touch your dock.

However a line is sourced, every fulfillment resolves to one of two kinds, from **inventory** or from a **job**, and that's what the shipment posts against.

The sales order list computes a display status: while a make-to-order line still has incomplete jobs, it shows **"In Progress"** even though the order's stored status is **"To Ship and Invoice"**. The raw status drives filtering and the flow; the display status reflects what's really happening on the floor.

## Post the shipment

Create a shipment against the order. One shipment table serves sales orders, purchase orders, and transfers alike, tagged here with a "Sales Order" source. It opens at **"Draft"**.

Creating it changes nothing on hand: **posting** is the event that matters. Post the shipment and four things happen at once: the shipment moves to **"Posted"**, inventory drops via the item ledger, the line's `quantitySent` rises, and the order advances to **"To Invoice"** (or **"Completed"** once everything is both shipped and billed). `sentComplete` flips only when the cumulative shipped quantity reaches the ordered quantity, so partial and repeated shipments are first-class.

A posted shipment decrements stock and advances the order, and if accounting is enabled it writes the COGS journal entries. What it does **not** do is create the invoice. Fulfillment and billing are deliberately separate steps.

## Raise the invoice

A sales invoice has two possible sources. You can bill straight from the **sales order**, or from a **posted shipment**. The shipment path links the invoice back to that shipment and clamps the billed quantity to what actually shipped. Bill-on-ship or bill-on-order: Carbon supports both.

The invoice opens at **"Draft"**, fully editable. The moment it leaves "Draft" it locks, a guard against changing numbers that have already entered the books.

## Post and get paid

Posting the invoice writes the general ledger (Accounts Receivable against Sales, and COGS against Inventory), but only when accounting is switched on for the company. Posting also bumps each line's `quantityInvoiced`, stamps the posting date, and sets the invoice to **"Submitted"**. Note what it is *not*: posting never marks an invoice **"Paid"**.

Payment isn't a separate record in Carbon. It's the invoice's own state: its status, `datePaid`, and `balance`. When you mark the invoice **"Paid"**, Carbon stamps the payment date. Need to undo a posted invoice? Voiding writes compensating reversing entries; you can't simply delete it.

The invoice carries its own status, paid date, and balance. Posting lands it on **"Submitted"**; moving it to **"Paid"** is the deliberate act that records the cash. All ledger postings along the way are gated on accounting being enabled.

That's quote to cash end to end: an opportunity priced into a quote, accepted into an order, shipped, invoiced, and settled, each step its own posted move, each leaving a trail you can stand behind.
