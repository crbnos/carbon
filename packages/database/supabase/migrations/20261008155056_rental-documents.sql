-- Rental shipments and receipts (.ai/specs/2026-10-07-rental-shipments-and-receipts.md).
-- A rental unit rides on the fixed-asset line tables. Exactly one source line per row.

ALTER TABLE "shipmentFixedAssetLine" ALTER COLUMN "salesOrderLineId" DROP NOT NULL;
ALTER TABLE "shipmentFixedAssetLine" ADD COLUMN IF NOT EXISTS "rentalAgreementLineId" TEXT;
ALTER TABLE "shipmentFixedAssetLine" ADD COLUMN IF NOT EXISTS "meter" NUMERIC;
DO $$ BEGIN
  ALTER TABLE "shipmentFixedAssetLine" ADD CONSTRAINT "shipmentFixedAssetLine_rentalAgreementLineId_fkey"
    FOREIGN KEY ("rentalAgreementLineId", "companyId")
    REFERENCES "rentalAgreementLine"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "shipmentFixedAssetLine" ADD CONSTRAINT "shipmentFixedAssetLine_source_check"
    CHECK (num_nonnulls("salesOrderLineId", "rentalAgreementLineId") = 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "shipmentFixedAssetLine_rentalAgreementLineId_idx"
  ON "shipmentFixedAssetLine" ("rentalAgreementLineId");

ALTER TABLE "receiptFixedAssetLine" ALTER COLUMN "purchaseOrderLineId" DROP NOT NULL;
ALTER TABLE "receiptFixedAssetLine" ADD COLUMN IF NOT EXISTS "rentalAgreementLineId" TEXT;
ALTER TABLE "receiptFixedAssetLine" ADD COLUMN IF NOT EXISTS "meter" NUMERIC;
ALTER TABLE "receiptFixedAssetLine" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "receiptFixedAssetLine" ADD COLUMN IF NOT EXISTS "takeOutOfService" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "receiptFixedAssetLine" ADD COLUMN IF NOT EXISTS "outOfServiceReason" TEXT;
ALTER TABLE "receiptFixedAssetLine" ADD COLUMN IF NOT EXISTS "residualDestination" TEXT;
DO $$ BEGIN
  ALTER TABLE "receiptFixedAssetLine" ADD CONSTRAINT "receiptFixedAssetLine_residualDestination_check"
    CHECK ("residualDestination" IN ('Fleet', 'Inventory'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "receiptFixedAssetLine" ADD CONSTRAINT "receiptFixedAssetLine_rentalAgreementLineId_fkey"
    FOREIGN KEY ("rentalAgreementLineId", "companyId")
    REFERENCES "rentalAgreementLine"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "receiptFixedAssetLine" ADD CONSTRAINT "receiptFixedAssetLine_source_check"
    CHECK (num_nonnulls("purchaseOrderLineId", "rentalAgreementLineId") = 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "receiptFixedAssetLine" ADD CONSTRAINT "receiptFixedAssetLine_outOfService_check"
    CHECK (NOT "takeOutOfService" OR "outOfServiceReason" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "receiptFixedAssetLine_rentalAgreementLineId_idx"
  ON "receiptFixedAssetLine" ("rentalAgreementLineId");

-- One open Draft per agreement: backs the header's open-the-existing-draft behavior.
CREATE UNIQUE INDEX IF NOT EXISTS "shipment_oneOpenDraftPerRentalAgreement_idx"
  ON "shipment" ("sourceDocumentId", "companyId")
  WHERE "status" = 'Draft' AND "sourceDocument" = 'Rental Agreement';
CREATE UNIQUE INDEX IF NOT EXISTS "receipt_oneOpenDraftPerRentalAgreement_idx"
  ON "receipt" ("sourceDocumentId", "companyId")
  WHERE "status" = 'Draft' AND "sourceDocument" = 'Rental Agreement';
