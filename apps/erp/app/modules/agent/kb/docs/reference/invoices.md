# Invoices

> The billing documents — what you charge customers, and what suppliers charge you.

An **invoice** records money owed. Carbon has two kinds that behave almost identically: a **sales invoice** is what you bill a customer, and a **purchase invoice** is the bill a supplier sends you. Both are drawn from an upstream document, both post to the ledger, and both are settled by a **separate posted transaction** — a payment or a credit or debit memo applied to the invoice, not a field you flip.

## Where they come from

A **sales invoice** is raised from a sales order, or from a **posted shipment**: billing on the order or billing on what actually shipped. A **purchase invoice** is raised from a purchase order, keeping the lines that still have something to bill. Either way the new invoice opens at **Draft**, fully editable, and links each line back to the order line it bills.

A purchase invoice reconciles on the **purchase order line**, not on a receipt. There's no direct receipt link, and a receipt isn't even required to bill. Posting clears the goods-received-not-invoiced accrual against the shared order line and books any price difference to variance.

## Status lifecycle

Both start at **Draft** and lock the moment they leave it — numbers that have entered the books can't be edited in place. The two sides share a shape but name a few states differently.

| | Sales invoice | Purchase invoice |
| --- | --- | --- |
| Drafting | Draft, Pending | Draft, Pending |
| Posted | **Submitted** | **Open** |
| Paying | Partially Paid → Paid | Partially Paid → Paid |
| Reversed | Voided | Voided |
| Memo applied | Credit Note Issued | Debit Note Issued |
| Past due | Overdue | Overdue |

The posted state has a different name on each side, **Submitted** for sales and **Open** for purchase, but means the same thing: posted to the ledger, awaiting payment. **Overdue**, **Partially Paid**, and **Paid** aren't set by hand; they're computed from the invoice's settlements and due date. An unpaid invoice past its `dateDue` reads **Overdue**; once settlements cover the whole balance it reads **Paid**.

## Line types

An invoice line is one of a handful of types, most of which pull an item's details in for you. The two sides differ in one place:

| Type | Sales invoice | Purchase invoice |
| --- | --- | --- |
| Part, Service, Material, Tool, Consumable | Yes | Yes |
| Comment (a note, no charge) | Yes | Yes |
| Fixed Asset | Yes | — |
| G/L Account (charge straight to an account) | — | Yes |

A **G/L Account** line lets a purchase invoice book a cost directly to a ledger account with a description — freight, a fee, anything without an item behind it. Sales invoices don't offer it; they carry a **Fixed Asset** line instead, for billing a capitalized asset.

## Posting

Posting an invoice writes its general-ledger entries, but only when accounting is enabled for the company: receivables against sales for a sale, payables against inventory or WIP for a purchase. Posting also bumps the invoiced quantity on each order line and stamps the posting date.

Posting never marks an invoice **Paid** — it lands on **Submitted** or **Open**. Settling it is a separate, deliberate step. A posted invoice can't be deleted either; to undo one you **void** it, which writes reversing entries rather than erasing history.

## Settling an invoice

A posted invoice is settled by a separate posted document applied to it, never by flipping a field. Two kinds of document do the settling, and an **invoice settlement** is the row that links one to an invoice for a given amount.

A **payment** moves cash. A **Receipt** is money in from a customer (it settles sales invoices); a **Disbursement** is money out to a supplier (it settles purchase invoices). A payment carries a bank account, a date, a currency, and a total, and moves **Draft → Posted → Voided** like the invoice itself. While it's **Draft** you stage which invoices it applies to and for how much; posting it books the cash to the ledger — bank against the receivables or payables control account — and freezes those applications.

A **credit or debit memo** settles without cash. It's a party, an amount, and a reason: a **Credit** memo lowers what a customer owes (a return or allowance) or raises what you owe a supplier; a **Debit** memo does the reverse. Its offset is a general-ledger reason account, not the bank. A memo posts **Draft → Posted → Voided** too, and posting an applied credit against a customer invoice is what flips that invoice to **Credit Note Issued** (a supplier invoice reads **Debit Note Issued**). A memo belongs to exactly one party — a customer or a supplier, never both.

An **invoice settlement** carries three amounts, not one: **applied** (cash or credit that reduces the balance), **discount** (an early-payment discount you're granting), and **write-off** (a tiny remainder you're forgiving to the write-off account). At least one has to be positive. A memo-sourced settlement can only carry an applied amount — discounts and write-offs are for cash payments.

### What if a payment overpays?

Applying **more than an invoice's open balance** is blocked per-invoice — a settlement can't exceed what's left to collect on that invoice. But a payment's **cash total can exceed everything it applies**: the excess stays on the party's account as an unapplied credit, ready to apply to a later invoice. You can also run the reverse — a payment with **zero cash** that only applies the party's existing posted credits to open invoices. Applying more credit than the party actually has, though, errors out.

### Voiding and dust

Void reverses, it doesn't erase. Voiding a posted payment or memo writes a mirror-image journal and moves it to **Voided**. You can't void an invoice that still has payments applied — reverse (or unapply) those first. And you can't edit a payment's applications once it's posted; to change how a posted payment lands, void it and re-enter it.

Carbon forgives **dust**. When settlements leave a balance under one cent — smaller than the currency can represent — the invoice is treated as fully **Paid** and its balance reads zero, rather than sitting forever a fraction of a cent short.

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
