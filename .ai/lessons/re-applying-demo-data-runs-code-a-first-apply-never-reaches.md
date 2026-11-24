---
paths: ["packages/database/src/datasets/**"]
triggers: ["PARENT_CHECK_TABLES"]
promoted: null
---
# Re-applying demo data runs code a first apply never reaches

**Context:** A new table (`customerContractInvoiceLine`) got a CHECK that needs `customerContractInvoiceId` OR `memoId`. The demo datasets seed it with only the invoice.

**Problem:** Settings → Demo Data on a company that already had data failed with "new row … violates check constraint". The wipe that runs first nulls every nullable FK pointing at a table it clears, which emptied both columns. `pnpm db:check:datasets` stayed green: it applied each dataset once, to an empty scratch company, so the wipe never met a seeded row.

**Rule:** A seeded table whose CHECK needs one of several nullable FKs goes in `PARENT_CHECK_TABLES` (`packages/database/src/datasets/wipe.ts`). The dataset check now re-applies each dataset over itself, so this fails before commit. When a test only exercises the first run of an idempotent operation, also run it a second time.

**Applies to:** `packages/database/src/datasets/` (wipe, verify), migrations that add CHECKs over nullable FK columns.
