-- Enum additions live alone: ADD VALUE cannot be used in the same transaction as the value.
-- Spec: .ai/specs/2026-09-22-revenue-recognition-and-rentals.md §2
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Asset Transfer';
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Asset Transfer';
ALTER TYPE "itemLedgerDocumentType"  ADD VALUE IF NOT EXISTS 'Asset Transfer';
ALTER TYPE "fixedAssetStatus"        ADD VALUE IF NOT EXISTS 'Under Construction';
ALTER TYPE "disposalMethod"          ADD VALUE IF NOT EXISTS 'Transfer to Inventory';

DO $faenums$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fixedAssetTransferType') THEN
    CREATE TYPE "fixedAssetTransferType" AS ENUM ('Capitalization', 'Return to Inventory');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fixedAssetTransferSourceType') THEN
    CREATE TYPE "fixedAssetTransferSourceType" AS ENUM ('Inventory', 'Job', 'Construction in Progress');
  END IF;
END $faenums$;
