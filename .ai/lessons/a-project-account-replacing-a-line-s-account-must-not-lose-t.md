---
paths: ["apps/erp/app/modules/projects/project-posting.ts", "apps/erp/app/modules/invoicing/project-charges.ts"]
triggers: ["resolveProjectLineCharges", "loadInvoiceProjectCharges", "isUnallowableCharge", "projectLedger"]
promoted: null
---
# A project account replacing a line's account must not lose that account's meaning

**Context:** A card charge, reimbursement or G/L Account invoice line charged to a project debits the project account in place of its own.

**Problem:** `isUnallowableCharge` read the account the row posts to, Project WIP, so a line on an Expressly Unallowable account (Entertainment) posted `unallowable = false` and would have billed the customer. A scenario test on the journal alone passed: the debit was right, only the ledger flag was wrong.

**Rule:** Read the facts of the line's own account before it is replaced. Check the `projectLedger` row as well as the journal when verifying a project posting.

**Applies to:** `resolveProjectLineCharges`, `loadInvoiceProjectCharges`, any new entry point that charges a project from a coded line.
