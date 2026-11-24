---
paths: ["apps/erp/app/modules/purchasing/purchasing.service.ts", "apps/erp/app/modules/sales/sales.service.ts", "apps/erp/app/modules/invoicing/invoicing.service.ts"]
triggers: ["buildMemoJournal", "createPurchaseReturnOrderCredit", "createSalesReturnOrderCredit", "debitMemo", "direction: \"Credit\""]
promoted: null
---
# A memo's `direction` means OPPOSITE things on AR and AP

**Context:** Supplier returns settle through an AP `memo`. The RMA spec and
`createPurchaseReturnOrderCredit` both used `direction: "Credit"` — the same
value the (correct) customer-side credit uses.

**Problem:** `direction` alone decides the CONTROL side for both parties
(`buildMemoJournal`): a Credit memo CREDITS the control account, a Debit memo
DEBITS it. On AR (an asset) a credit REDUCES the balance — right for a customer
refund. On AP (a liability) a credit INCREASES it — so returning goods made
Carbon show we owed the supplier MORE, and the reason leg re-debited GR/IR
instead of clearing what the return shipment had debited, leaving a permanent
2x residual in a suspense account. Every entry still BALANCED, so no guard
fired, and it survived four review rounds. The rest of invoicing already
assumed the opposite (`getAvailableCredits` selects supplier memos with
`direction = 'Debit'`), so the memos were also invisible to "Apply Credit".

**Rule:** A vendor return is a **Debit** memo (`debitMemo` `DR-` sequence); a
customer return is a **Credit** memo. Never reason about `direction` without
naming the party — write out which way the control account moves and whether
that account is an asset or a liability. Balanced ≠ correct: when a posting has
a suspense account (GR/IR), assert the CYCLE nets to zero, not just that each
entry balances.

**Applies to:** `apps/erp/app/modules/purchasing/purchasing.service.ts`
(`createPurchaseReturnOrderCredit`), `apps/erp/app/modules/sales/sales.service.ts`
(`createSalesReturnOrderCredit`), `apps/erp/app/modules/invoicing/invoicing.service.ts`,
any new `memo` writer.
