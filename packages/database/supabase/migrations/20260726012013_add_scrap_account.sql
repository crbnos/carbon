-- Scrap / cost-of-quality write-off account for inspection rejects and NCR
-- dispositions (Scrap / Return to Supplier). Kept distinct from the physical
-- inventory-count offset (inventoryAdjustmentVarianceAccount) so cost of quality
-- is separable on the P&L. Flat company-level default (no posting-group matrix).

ALTER TABLE "accountDefault"
  ADD COLUMN IF NOT EXISTS "scrapAccount" TEXT;

-- RESTRICT (not SET NULL): deleting the account must not silently disable scrap
-- posting. Drop-and-recreate so a re-run over a partial apply is corrected.
ALTER TABLE "accountDefault"
  DROP CONSTRAINT IF EXISTS "accountDefault_scrapAccount_fkey";
ALTER TABLE "accountDefault"
  ADD CONSTRAINT "accountDefault_scrapAccount_fkey"
  FOREIGN KEY ("scrapAccount") REFERENCES "account"("id")
  ON UPDATE CASCADE ON DELETE RESTRICT;

-- Backfill existing companies to their inventory-adjustment variance account so
-- none is left null (both are account.id FKs). Idempotent (guarded on NULL);
-- a company whose variance account is itself null keeps NULL and relies on the
-- edge function's runtime fallback (scrapAccount ?? inventoryAdjustmentVarianceAccount).
UPDATE "accountDefault"
SET "scrapAccount" = "inventoryAdjustmentVarianceAccount"
WHERE "scrapAccount" IS NULL
  AND "inventoryAdjustmentVarianceAccount" IS NOT NULL;
