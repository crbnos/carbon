---
paths: []
triggers: []
promoted: null
---
# A rule on a posting belongs in the posting, not in the operation that wraps it

**Context:** The purchase order funds gate was first placed in the `postPurchaseInvoice` operation (`invoicing.server.ts`), ahead of the `post-purchase-invoice` posting.
**Problem:** The Ramp bill sync and `@carbon/jobs` call the posting through `posting()` from `@carbon/api/postings.server`, never the operation. They posted invoices against unapproved orders, and the PR had to list it as a known gap.
**Rule:** A check that must hold for every caller of a posting goes in the posting body (`<module>.service.ts`), thrown as a `ServerFnError` with a status whose category fits (422 for a rule). The operation adds only what is specific to the route's caller.
**Applies to:** every posting registered in `apps/erp/app/modules/postings.server.ts`.
