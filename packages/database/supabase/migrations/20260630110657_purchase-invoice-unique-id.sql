-- ============================================================
-- Enforce unique readable invoice ids on purchaseInvoice.
--
-- salesInvoice has had `UNIQUE ("invoiceId", "companyId")` since
-- 20250507143421_sales-invoice.sql, but purchaseInvoice (from the 2023
-- accounts-payable migration) only ever got a plain, NON-unique index. So while
-- a duplicate readable id on a sales invoice is rejected by the DB, the same
-- collision on a purchase invoice slips through — `invoiceId` is generated in
-- app code (get_next_sequence) with no DB guard. This adds the matching
-- constraint so the two sides are symmetric.
-- ============================================================

-- Resolve any pre-existing duplicates before building the unique index (it can't
-- build over duplicate rows). Keep the earliest-created row's id; suffix the rest
-- with their own row id, which is the PK and therefore guaranteed unique — so the
-- rename itself can never collide. No-op when there are no duplicates.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "companyId", "invoiceId" ORDER BY "createdAt", "id"
    ) AS rn
  FROM "purchaseInvoice"
)
UPDATE "purchaseInvoice" pi
SET "invoiceId" = pi."invoiceId" || '-' || pi."id"
FROM ranked
WHERE ranked."id" = pi."id" AND ranked.rn > 1;

-- Idempotent: drop-then-add so a retry after a partial commit doesn't trip on an
-- already-created constraint (the deploy runner is not transactional).
ALTER TABLE "purchaseInvoice"
  DROP CONSTRAINT IF EXISTS "purchaseInvoice_invoiceId_key";
ALTER TABLE "purchaseInvoice"
  ADD CONSTRAINT "purchaseInvoice_invoiceId_key" UNIQUE ("invoiceId", "companyId");

-- The old non-unique composite index is now redundant with the unique index
-- (which covers the same columns). Mirror salesInvoice, which keeps only the
-- single-column idx_*_invoiceId alongside its unique key.
DROP INDEX IF EXISTS "purchaseInvoice_invoiceId_idx";
