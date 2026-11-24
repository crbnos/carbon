---
paths: []
triggers: []
promoted: null
---
# Every sales invoice needs an opportunity

**Context:** A sales invoice's documents, including the PDF written when it is posted,
live under `{companyId}/opportunity/{opportunityId}/`. `insertSalesInvoice` and
`upsertSalesInvoice` mint an opportunity and `convert` copies the sales order's, but
`salesInvoice.opportunityId` is nullable.

**Problem:** Rental billing inserted invoices with `opportunityId: null`. The invoice's
documents card crashed on `opportunity.id` (shown as "Couldn't load documents", since
`DeferredFiles` catches render errors too), and posting wrote the PDF to a literal
`opportunity/null/` folder.

**Rule:** Any new code path that inserts a `salesInvoice` (or `salesOrder` / `quote`)
creates an opportunity for it in the same transaction. Nullable in the schema does not
mean optional in the app.

**Applies to:** `apps/erp/app/modules/sales/sales.service.ts`, any Kysely/server-function writer
of `salesInvoice`; backfilled by `20261006220901_sales-invoice-opportunity-backfill.sql`.
