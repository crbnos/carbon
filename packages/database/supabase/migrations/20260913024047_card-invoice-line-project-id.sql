-- Project coding on the two Ramp-fed line tables, mirroring their existing
-- costCenterId columns. A project chosen in Ramp is decoded (codeSelections)
-- and staged onto these columns, then post-card-transaction / post-purchase-invoice
-- write it as a Project journalLineDimension. The `project` PK is composite
-- ("id","companyId") with no standalone unique on "id", so the FK is
-- tenant-composite (unlike the pre-existing single-column costCenter FK on
-- purchaseInvoiceLine). Idempotent: guard every statement for the retryable
-- deploy runner.

ALTER TABLE "cardTransactionLine" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cardTransactionLine_projectId_fkey'
  ) THEN
    ALTER TABLE "cardTransactionLine"
      ADD CONSTRAINT "cardTransactionLine_projectId_fkey"
      FOREIGN KEY ("projectId", "companyId")
      REFERENCES "project"("id", "companyId")
      ON UPDATE CASCADE ON DELETE SET NULL ("projectId");
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "cardTransactionLine_projectId_idx"
  ON "cardTransactionLine"("projectId");

ALTER TABLE "purchaseInvoiceLine" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchaseInvoiceLine_projectId_fkey'
  ) THEN
    ALTER TABLE "purchaseInvoiceLine"
      ADD CONSTRAINT "purchaseInvoiceLine_projectId_fkey"
      FOREIGN KEY ("projectId", "companyId")
      REFERENCES "project"("id", "companyId")
      ON UPDATE CASCADE ON DELETE SET NULL ("projectId");
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "purchaseInvoiceLine_projectId_idx"
  ON "purchaseInvoiceLine"("projectId");
