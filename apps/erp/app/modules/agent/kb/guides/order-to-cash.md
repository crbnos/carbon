# Ship, invoice, get paid

> Fulfill the order, post the shipment and invoice, then record payment.

You have a sales order sitting at **"To Ship and Invoice"**. Cash is four moves away: fulfill the lines, post a shipment, raise an invoice, apply a payment against it. None of them auto-chain. Each is a discrete, posted step you take when the work is actually ready.

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

Posting the invoice writes the general ledger (Accounts Receivable against Sales, and COGS against Inventory), but only when accounting is switched on for the company. Posting also bumps each line's `quantityInvoiced`, stamps the posting date, and moves the invoice to **"Submitted"**. Note what it is *not*: posting never marks an invoice **"Paid"**.

Payment is its own posted entity now, not a checkbox on the invoice. You record a **payment** (a **"Receipt"** on the sales side) and apply it to one or more invoices through a **settlement**. Each settlement line carries the principal it applies, plus any early-payment discount or write-off. A **credit memo** works the same way: it's a posted balance you apply via a settlement rather than cash. The payment itself moves through **"Draft"**, **"Posted"**, **"Voided"**, and posting it writes the cash-account and Accounts-Receivable entries.

The invoice's paid status is *derived* from those settlements, not stored by hand. Once applied settlements cover the total the invoice reads **"Paid"**; part-way there it reads **"Partially Paid"**; past its due date and unsettled it reads **"Overdue"**. Need to undo a posted invoice? Voiding writes compensating reversing entries; you can't simply delete it.

There's a real payment record (a **"Receipt"** for cash in) that you apply to invoices through settlements, and credit memos settle the same way. The invoice's **"Paid"** / **"Partially Paid"** status is computed from what's been applied, so the ledger and the balance always agree. All postings are gated on accounting being enabled.

That's quote to cash end to end: an opportunity priced into a quote, accepted into an order, shipped, invoiced, and settled by an applied payment, each step its own posted move, each leaving a trail you can stand behind.
