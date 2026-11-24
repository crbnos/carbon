---
paths: []
triggers: []
promoted: null
---
# A nullable column added by migration needs a reader that tolerates NULL

**Context:** The accounting corrections release added `invoiceSettlement.sourceAmount` (document-currency principal) without backfilling rows written before it, and the migration comment explicitly declared legacy NULLs valid.

**Problem:** The shared TypeScript reducer that computes an invoice's remaining balance and a payment's remaining funding threw "Settlement is missing its document principal" on any NULL. Every invoice with a pre-release partial payment or credit became unpayable: the New Payment loader seeded from such an invoice returned a 500, and posting a payment for that party would have failed the same way. The schema and the code disagreed about what a valid row is.

**Rule:** When a migration adds a nullable column and leaves existing rows NULL, every reader added in the same change must define what NULL means and handle it, or the migration must backfill. Keep the throw only where a DB constraint already guarantees the value (source-linked rows). Derive legacy values from the columns that did exist (`appliedAmount` at the applicable exchange rate) and cover the NULL case in the pure-function tests.

**Applies to:** `payment-funding.ts` reducers, any future column added to `invoiceSettlement`, `journalLine`, or other high-volume tables where a backfill is skipped.
