---
paths: []
triggers: []
promoted: null
---
# A posting that restates a document's status can release it past its approval

**Context:** Purchase order approval enforcement (TCK-36). Receipt and invoice postings set the order's status from its lines: Completed, To Receive, To Invoice or To Receive and Invoice.
**Problem:** The postings were gated, but their voids were not, and none of the four writes checked the status they replaced. Voiding an invoice on an order waiting for re-approval set it to a released status with no approval, and posting an invoice against a Closed order reopened it.
**Rule:** A write that derives a document's status from its lines matches the statuses it may replace in its own `WHERE` (`.where("status", "in", PURCHASE_ORDER_RELEASED_STATUSES)`). Audit the voids and reversals along with the posts.
**Applies to:** Every posting and void that writes `purchaseOrder.status`, `salesOrder.status` or a similar derived header status.
