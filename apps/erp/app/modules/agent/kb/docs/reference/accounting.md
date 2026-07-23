# Accounting & the ledger

> How operations become journal entries: accounts, periods, and the postings behind every flow.

Carbon's flows all end the same way: shipping, receiving, finishing a job, depreciating an asset each post to the **general ledger**. This page covers the machinery they share.

## Accounting is a switch

A company setting, **accounting enabled**, is **off by default**. With it off, the physical world still moves (the item ledger records quantities, orders and jobs change status), but no journal entries are written. Every posting below is gated on it.

A shop can run operationally (receiving, building, shipping) before it keeps books. Turn accounting on and those same actions begin posting to the ledger; until then the financial entries are simply skipped.

## The journal

Every posting is a **journal** with balanced **journal lines**: debits positive, credits negative. The journal carries a **source type** naming what produced it; each line carries an account and can be tagged with dimensions. A journal is *Posted* (the normal state), *Draft*, or *Reversed* — voiding writes a reversing journal rather than deleting one.

| Source type | Posted by |
| --- | --- |
| Sales Shipment | Posting a shipment: relieves inventory to COGS. |
| Sales Invoice | Posting a sales invoice: receivable against revenue. |
| Purchase Receipt | Posting a receipt: inventory or WIP against GR/IR. |
| Purchase Invoice | Posting a supplier bill: payables, clearing GR/IR. |
| Inventory Adjustment | Manual adjustments and inventory count variances: stock gains and losses against the inventory adjustment account. |
| Job Consumption / Production Event / Job Receipt | A job consuming material, logging time, and finishing into inventory. |
| Job Close | Sweeping a job's residual work-in-process to variance. |
| Asset Depreciation / Asset Disposal | Depreciation runs and asset write-offs. |

## Accounts come from one place

Carbon resolves the accounts to post to from a **single company-level set of defaults**. There are no per-group posting groups. The ones that recur across the flows:

| Account | Used for |
| --- | --- |
| Inventory | Value of stock on hand. |
| Work in process | Cost accumulating on open jobs. |
| Cost of goods sold | Cost relieved when goods are sold. |
| Accounts receivable / payable | Customer and supplier balances. |
| Goods received, not invoiced | The accrual between receiving goods and being billed for them. |
| Variance | Differences swept at job close or from purchase price. |

## Dimensions

A journal line can be tagged with **dimensions**: location, department, cost center, item posting group, work center, process, fixed-asset class. The same handful of accounts can then be sliced for reporting without multiplying the chart of accounts.

## Periods

Every posting lands in an **accounting period**, created and activated on demand as you post. Each period also carries a close status — **Open**, **Closed**, or **Locked** — and operational documents (receipts, shipments, invoices, payments) can't post into a Closed or Locked period. Reopen or unlock the period first, or move the posting date into an open one.

## Related

  - Manufacturing accounting The job-cost postings: consumption, production events, close.
  - Ship, invoice, get paid Where the sales shipment and invoice postings come from.

## Troubleshooting

Exact errors from period close and journal immutability.

### "Accounting period is closed. Reopen it before posting."
The posting date falls in a period whose close status is **Closed**. Reopen the period from the accounting periods screen, or change the document's posting date to fall in an Open period, then post again.

### "Accounting period is locked. Unlock it before posting operational documents."
Same as above, but the period is **Locked** — the stricter state. It must be unlocked before receipts, shipments, invoices, or payments can post into it.

### "Cannot delete journal …: accounting period is closed"
A journal in a closed period can't be deleted. Reopen the period, or reverse the journal instead of deleting it.

### "Posted journal … is immutable and cannot be deleted; reverse it instead"
Posted journals are never deleted. Use the reverse action, which writes an offsetting journal and preserves history.

### "Posted journal … is immutable; only the Posted -> Reversed transition is permitted"
The only state change allowed on a posted journal is reversal. To correct an entry, reverse it and post a new one.

### "Journal line … is immutable because journal … is posted"
Lines of a posted journal can't be edited. Reverse the journal and re-enter it.

### "Cannot post to a group account"
A journal line references a heading/group account in the chart of accounts. Only leaf (posting) accounts accept entries — pick a detailed account instead.

### "Account not found"
The full message names the account id. The referenced account doesn't exist in the chart of accounts — usually a default-account setting pointing at a deleted account. Check the company's default accounts configuration.
