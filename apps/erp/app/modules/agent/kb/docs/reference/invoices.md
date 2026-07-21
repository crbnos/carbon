# Invoices

> The billing documents — what you charge customers, and what suppliers charge you.

An **invoice** records money owed. Carbon has two kinds that behave almost identically: a **sales invoice** is what you bill a customer, and a **purchase invoice** is the bill a supplier sends you. Both are drawn from an upstream document, both post to the ledger, and in both, payment is a state on the invoice rather than a separate record.

## Where they come from

A **sales invoice** is raised from a sales order, or from a **posted shipment**: billing on the order or billing on what actually shipped. A **purchase invoice** is raised from a purchase order, keeping the lines that still have something to bill. Either way the new invoice opens at **Draft**, fully editable, and links each line back to the order line it bills.

A purchase invoice reconciles on the **purchase order line**, not on a receipt. There's no direct receipt link, and a receipt isn't even required to bill. Posting clears the goods-received-not-invoiced accrual against the shared order line and books any price difference to variance.

## Status lifecycle

Both start at **Draft** and lock the moment they leave it — numbers that have entered the books can't be edited in place.

| | Sales invoice | Purchase invoice |
| --- | --- | --- |
| Drafting | Draft, Pending | Draft, Pending |
| Posted | **Submitted** | **Open** |
| Paying | Partially Paid → Paid | Partially Paid → Paid |
| Reversed | Voided | Voided |
| Credit | Credit Note Issued | Debit Note Issued, Return |
| Past due | Overdue | Overdue |

The posted state has a different name on each side, **Submitted** for sales and **Open** for purchase, but means the same thing: posted to the ledger, awaiting payment. **Overdue** isn't set by hand; it's computed when an unpaid invoice passes its due date.

## Posting

Posting an invoice writes its general-ledger entries, but only when accounting is enabled for the company: receivables against sales for a sale, payables against inventory or WIP for a purchase. Posting also bumps the invoiced quantity on each order line and stamps the posting date.

Posting never marks an invoice **Paid** — it lands on **Submitted** or **Open**. Recording payment is a separate, deliberate step. A posted invoice can't be deleted either; to undo one you **void** it, which writes reversing entries rather than erasing history.

## Payment

Payment in Carbon is **field-based**: an invoice carries its own status, paid date, and balance. There's no separate payment transaction. Marking an invoice **Paid** stamps the date and settles the balance. That keeps the whole money story on one record, from draft through posted to paid.

## Related

  - Sales orders The order a sales invoice bills against.
  - Purchase orders The order a purchase invoice reconciles to, line by line.
  - Accounting Where a posted invoice's ledger entries land.

## Troubleshooting

Exact errors users hit when posting, voiding, deleting, or paying invoices.

### "Can only void posted purchase invoices"
Voiding applies only after posting. A Draft invoice can simply be edited or deleted.

### "Purchase invoice is already voided"
No action needed — the invoice was already reversed.

### "Cannot void a purchase invoice with payments applied. Reverse the payment first."
The invoice has settled payments against it. Reverse (or unapply) those payments, then void the invoice.

### "Cannot delete purchase invoice with status … Only Draft invoices can be deleted."
A database guard (same wording for sales invoices). Once an invoice leaves Draft it can't be deleted — void a posted invoice instead, which writes reversing entries.

### "Cannot modify a confirmed purchase invoice." / "Cannot modify a locked sales invoice."
Invoices lock the moment they leave Draft; posted numbers can't be edited in place. To change a posted invoice, void it and raise a new one (or issue a credit/debit note).

### "Applications can only be edited while the payment is Draft"
Once a payment is posted, its invoice applications are frozen. Reverse the payment and re-enter it to change how it's applied.

### "A receipt can only be applied to sales invoices" / "A disbursement can only be applied to purchase invoices"
Payment direction mismatch: a customer payment (receipt) settles sales invoices, a supplier payment (disbursement) settles purchase invoices. Check the payment's type.

### "A payment can only be applied to its own customer's invoices"
The invoice belongs to a different customer (or, for the supplier-side variant, a different supplier) than the payment. Apply the payment only to that party's invoices.

### "Only posted credits can be applied"
The credit memo being applied is still Draft (or voided). Post the credit memo first.

### "Applied amount must be greater than 0"
Enter a positive amount when applying a payment or credit.
