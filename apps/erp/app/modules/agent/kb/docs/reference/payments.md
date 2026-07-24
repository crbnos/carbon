# Payments

> Cash receipts, disbursements, and credit or debit memos — the posted transactions that settle AR and AP.

A **payment** is a posted cash event that settles what a party owes you or you owe them. A **Receipt** is money in from a customer; a **Disbursement** is money out to a supplier. Alongside cash, a **credit or debit memo** adjusts a balance without cash. Both are standalone documents with their own lifecycle, and both settle invoices through one shared row: the `docs/reference/invoices`. This page is the entity view. For settlement seen from the invoice's side, see `docs/reference/invoices`.

A payment is a real transaction record, not a field on an invoice. You create a payment, stage which invoices it applies to, then post it. Marking an invoice "Paid" is a *derived* status that follows from posted settlements, not something you set.

## Payments

A payment carries a party, a bank account, a date, a currency, an exchange rate, and a total. Exactly one counterparty is set: a customer **or** a supplier, never both. Direction and party are deliberately decoupled so refunds work: a Disbursement can pay a *customer* (refunding an AR credit) and a Receipt can come from a *supplier* (refunding an AP debit).

| Field | What it is |
| --- | --- |
| `paymentType` | **Receipt** (AR, money in) or **Disbursement** (AP, money out) |
| `customerId` / `supplierId` | Exactly one — a Receipt requires a customer, a Disbursement a supplier |
| `bankAccount` | The GL account the cash moves through |
| `totalAmount` | Cash amount. **May be zero** — see pure credit-application below |
| `currencyCode`, `exchangeRate` | The payment's currency and its rate to base currency |
| `reference`, `memo` | Free-text reference and note |

Payments number per company from a `PAY-YYYY-MM-` sequence.

## Credit and debit memos

A **memo** is payment-shaped but non-cash: a party, an amount, and a **reason** general-ledger account instead of a bank account. It's its own document (not an invoice line). `direction` is whether it credits or debits the party's control account, and the four party-by-direction combinations map cleanly to AR/AP movement:

| Party + direction | Effect |
| --- | --- |
| Customer + **Credit** | AR down (a return or allowance to the customer) |
| Customer + **Debit** | AR up (an additional charge) |
| Supplier + **Debit** | AP down (a credit the supplier owes you) |
| Supplier + **Credit** | AP up (an additional amount you owe) |

A memo belongs to exactly one party. Its reason account is **not** a user choice: at posting Carbon derives it from the company's account defaults by party side (a customer memo uses the sales-discount account, a supplier memo the supplier-payment-discount account) and stamps it on the memo for the audit trail. Direction only flips which side of the entry the control and reason accounts land on.

Credit and debit memos number independently, from `CR-YYYY-MM-` and `DR-YYYY-MM-` sequences.

## The settlement row

Cash and memos both settle open items through one primitive: the **invoice settlement**. Each row nets one **source** against one **target**.

  - **source**: Exactly one of a `paymentId` (cash) or a `memoId` (memo) funds the settlement.
  - **target**: Exactly one of a sales invoice, a purchase invoice, or a memo. (A balance-increasing memo is itself an open item, settled by targeting it.)
  - **appliedAmount**: Principal that reduces the target's balance.
  - **discountAmount**: An early-payment discount you're granting. **Cash payments only** — a memo-sourced settlement can't carry one.
  - **writeOffAmount**: A remainder you're forgiving to the write-off account. **Cash payments only.**
  - **appliedDate**: When the application takes effect.

At least one of applied, discount, or write-off must be positive. An AR source only settles AR targets for the same counterparty, and an AP source only settles AP targets — the posting functions enforce party and side consistency (a Receipt rejects purchase invoices, a Disbursement rejects sales invoices, and a payment can only settle its own party's invoices).

Settlements are **staged while their source is Draft** and only go live when it posts. This includes a memo-sourced "apply credit" made through a payment: even though the memo itself is posted, its credit application is tied to the payment applying it and doesn't count until *that* payment posts — so the composer stays consistent with cash applications.

## Lifecycle

Payments and memos share one lifecycle. Draft is freely editable; posting books the GL entries and freezes the applications; voiding reverses. Voided is terminal.

  - **Draft**: The document is being composed. You edit the amount, party, and staged applications, and you can delete it outright. Nothing has hit the ledger.
  - **Posted**: The GL journal is written and the settlements go live. Applications are frozen — to change how a posted payment lands, void it and re-enter it.
  - **Voided**: A reversing (mirror-image) journal is written and the document is closed. It can't be edited or reused.

Only a **Draft** can be deleted; a **Posted** payment or memo must be voided instead, which preserves history. Voiding is only allowed from **Posted**.

## What posts to the general ledger

Posting only touches the ledger when accounting is enabled for the company; otherwise the document still moves to **Posted** and its settlements still apply, but no journal is written.

- **A payment** books the **bank account** against the **AR or AP control account** (receivables for a customer, payables for a supplier), split per application. Each settlement's discount goes to the discount account and its write-off to the write-off account. A single realized-FX plug reconciles the base-currency difference when the payment's rate differs from the invoice's, to the realized exchange gain or loss account.
- **A memo** books a balanced two-line entry: the **control account** against the derived **reason account**. Applying a balance-reducing memo to an invoice afterward is GL-neutral — both sit in AR/AP — except for any realized FX.

Every payment and memo journal line is tagged with the counterparty's type and entity dimensions, so AR and AP can be reported by customer or supplier. Voiding emits a paired reversing journal rather than mutating the original, and carries the same dimensions so dimension-filtered balances net to zero. See `docs/reference/accounting` for where these entries land.

## On-account credit and overpayment

Applying **more than an invoice's open balance** is blocked per invoice — a settlement can't exceed what's left to collect on that invoice, and the cap counts every posted settlement against it, cash and memo alike.

A payment's **cash total**, though, need not equal what it applies:

- **Overpayment** — when a payment's cash exceeds the invoices it applies to, the remainder stays on the party's account as **on-account credit**, ready to apply to a later invoice.
- **Pure credit-application** — a payment with **zero cash** that only applies the party's existing posted credits to open invoices. This is why `totalAmount` may be zero.
- **Applying more than cash** — when applications exceed the payment's cash, the excess draws down the party's available on-account credit (the net unapplied cash on their other posted same-direction payments). Only same-direction payments contribute: a Receipt from a customer leaves credit, a Disbursement to the same customer consumes it. Applying more credit than the party actually has errors out.

Carbon forgives **dust**. When settlements leave a balance under one cent — smaller than the currency can represent — the invoice reads fully **Paid** rather than sitting a fraction of a cent short.

## The AR / AP workbench

The **Receivables** and **Payables** workbenches present each side as an aged tree: counterparties at the root carrying the current and past-due aging buckets, expanding to the open documents (invoices, credit memos, debit memos) beneath them, plus any unapplied on-account credit. Each side also runs a **GL tie-out** that compares the subledger balance to the AR or AP control-account balance and flags any variance. Payments and memos are the transactions that move those numbers.

## Related

  - Invoices The open items a payment or memo settles, and settlement from the invoice's angle.
  - Accounting Where a posted payment or memo's ledger entries land.
  - Customers & suppliers The parties a payment or memo is drawn against.

## Troubleshooting

Exact errors users hit when posting or voiding payments and memos.

### "Cannot post payment in status … (only Draft)"
Only a Draft payment can be posted. A Posted payment is already booked; a Voided one is closed.

### "Cannot void payment in status … (only Posted)" / "Cannot void memo in status … (only Posted)"
Voiding applies only to a Posted document. A Draft can simply be edited or deleted.

### "Receipt cannot apply to purchase invoices" / "Disbursement cannot apply to sales invoices"
Payment direction mismatch. A Receipt (customer, money in) settles sales invoices; a Disbursement (supplier, money out) settles purchase invoices.

### "Invoice … belongs to a different customer/supplier than the payment"
The invoice's party doesn't match the payment's. Apply the payment only to that party's invoices.

### "Cannot apply payment to invoice … (must be Submitted/Open)"
The target invoice isn't in its posted-and-payable state (Submitted for sales, Open for purchase). Post the invoice first.

### "Application total … exceeds remaining open amount … on invoice …"
The applied + discount + write-off across the payment's settlements would over-settle the invoice, netting all prior posted settlements (cash and memos). Reduce the amount.

### "Applied exceeds payment cash by … but only … of on-account credit is available"
The payment applies more than its cash, and the shortfall exceeds the party's unapplied on-account credit. Add cash, apply less, or post more credit for the party first.

### "Cannot post payment: memo … is … (must be Posted)" / "Staged credit … exceeds remaining amount … on memo …"
A credit staged on this payment draws on a memo that was voided, or already drawn down, since staging. Post or re-select an available credit memo.

### "Accounting is enabled but this company has no account defaults configured"
Posting a payment or memo to the GL needs the company's account defaults (control, discount, write-off, realized-FX, and — for memos — the reason account). Configure account defaults in accounting settings.
