---
paths: ["apps/erp/app/modules/invoicing/invoicing.service.ts", "apps/erp/app/modules/invoicing/invoicing.server.ts"]
triggers: ["decideDocumentForceDelete", "reverseDocumentByJournal", "unapplyForceDeleteSettlements", "rebuildPaymentJournal"]
promoted: null
---
# A force delete treats the void's refusal as a fallback, not a stop

- **Context:** the Admin force delete of invoices, receipts and payments (`decideDocumentForceDelete`).
- **Problem:** The first version refused whenever the document's own void refused, or when payments, memos or other documents still held it. Force delete exists for emergencies where a user error has broken that normal process, so those refusals left the Admin stuck.
- **Rule:** In a force delete, a void's rule refusal is the trigger for `reverseDocumentByJournal`: negate its postings, adjust its stock back, restore its sources. Anything applied to the document is unapplied first (`unapplyForceDeleteSettlements`). To change a posted payment's journal, build it again with and without the change (`rebuildPaymentJournal`) and post the difference, rather than hand-building reversal lines.
- **Applies to:** `invoicing.service.ts` force delete blocks, any future force delete type.
