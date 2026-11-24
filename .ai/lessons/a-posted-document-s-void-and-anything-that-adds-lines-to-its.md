---
paths: []
triggers: []
promoted: null
---
# A posted document's void and anything that adds lines to its journal take one lock

- **Context:** Change GL Account adds two journal lines to a posted sales or purchase invoice; the invoice void reverses every journal line of the document.
- **Problem:** The change locked the invoice `FOR UPDATE`, but both voids read the lines they reverse before their transaction and never locked the invoice. A change that committed between the void's read and its write survived on a Voided invoice: its amount stayed on the new account with nothing left to reverse it.
- **Rule:** Anything that adds journal lines to a posted document must be serialized with the void's read under the same lock. Lock the document row `FOR UPDATE` inside the void's transaction, then read and build the reversal from that locked state, taking the lock at the same point in the order as the writer (after the posting-status read, before the period) so neither deadlocks.
- **Applies to:** `postSalesInvoice` / `postPurchaseInvoice` void, `changeInvoiceLineAccount`, and any future correction that posts onto an existing document's journal (memos, payments, receipts, shipments).
