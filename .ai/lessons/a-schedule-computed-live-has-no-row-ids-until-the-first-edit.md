---
paths: []
triggers: []
promoted: null
---
# A schedule computed live has no row ids until the first edit writes it

**Context:** An unedited Draft contract has no `customerContractInvoice` rows. The loader computes the invoice schedule from the lines with the pure planner (`@carbon/database/contract-schedule`). The first edit writes the rows (plan decision 2).

**Problem:** The page sent the edit with the ids of computed rows that were not in the database. The server function wrote the schedule, then looked up those ids, found nothing, and refused the edit. So the first edit of every Draft failed. No test covered an edit from the computed state.

**Rule:** When a page shows rows that the server computes and does not store, give each row a reference by position, not an id. Contracts use `planned:<invoiceDate>` for an invoice and `planned:<invoiceDate>:<lineId>:<periodStart>[:adjustment]` for a row. The server writes the rows first, then resolves each reference against them. Test the first edit from the computed state with a database test, not from stored rows (`contract-lifecycle.test.ts`, fix commit `56fa0f7b8e`).

**Applies to:** `post-customer-contract` `edit-schedule`, `ContractInvoiceGrid` / `ContractAmountsModal` (and `ContractRevenueGrid` for the revenue plan), and any future editable preview that persists on first edit.
