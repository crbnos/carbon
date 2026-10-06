-- Enums for the fleet bridge, rental agreements and sales-type leases.
-- Enum additions live alone: ADD VALUE cannot be used in the same transaction as the value.
-- Spec: .ai/specs/2026-09-22-revenue-recognition-and-rentals.md §2–§4

-- Fleet bridge + Make to Asset (§2)
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Asset Transfer';
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Asset Transfer';
ALTER TYPE "itemLedgerDocumentType"  ADD VALUE IF NOT EXISTS 'Asset Transfer';
ALTER TYPE "fixedAssetStatus"        ADD VALUE IF NOT EXISTS 'Under Construction';
ALTER TYPE "disposalMethod"          ADD VALUE IF NOT EXISTS 'Transfer to Inventory';

-- Rental agreements (§3)
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Rental Agreement';
ALTER TYPE "itemLedgerDocumentType"  ADD VALUE IF NOT EXISTS 'Rental Agreement';
ALTER TYPE "salesInvoiceLineType"    ADD VALUE IF NOT EXISTS 'Rental';

-- Sales-type lease journals (commencement, end of term) post under their own source type (§4)
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Lease';

DO $fleetenums$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fixedAssetTransferType') THEN
    CREATE TYPE "fixedAssetTransferType" AS ENUM ('Capitalization', 'Return to Inventory');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fixedAssetTransferSourceType') THEN
    CREATE TYPE "fixedAssetTransferSourceType" AS ENUM ('Inventory', 'Job', 'Construction in Progress');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rentalAgreementStatus') THEN
    CREATE TYPE "rentalAgreementStatus" AS ENUM ('Draft', 'Active', 'Closed', 'Cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rentalAgreementLineStatus') THEN
    CREATE TYPE "rentalAgreementLineStatus" AS ENUM ('Pending', 'On Rent', 'Returned', 'Sold');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rentalBillingCycle') THEN
    CREATE TYPE "rentalBillingCycle" AS ENUM ('Calendar Month', '28 Days');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rentalBillingTiming') THEN
    CREATE TYPE "rentalBillingTiming" AS ENUM ('Advance', 'Arrears');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rentalBillingPeriodStatus') THEN
    CREATE TYPE "rentalBillingPeriodStatus" AS ENUM ('Pending', 'Invoiced');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rentalInvoiceLineType') THEN
    CREATE TYPE "rentalInvoiceLineType" AS ENUM ('Rent', 'Charge', 'Purchase Option');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rentalRateUnit') THEN
    CREATE TYPE "rentalRateUnit" AS ENUM ('Day', 'Week', 'Month');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lessorClassification') THEN
    CREATE TYPE "lessorClassification" AS ENUM ('Rental', 'Sale', 'Financing');
  END IF;
END $fleetenums$;
