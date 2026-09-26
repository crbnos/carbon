-- Enum additions live alone: ADD VALUE cannot be used in the same transaction as the value.
-- Spec: .ai/specs/2026-09-22-revenue-recognition-and-rentals.md §3
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Rental Agreement';
ALTER TYPE "itemLedgerDocumentType"  ADD VALUE IF NOT EXISTS 'Rental Agreement';
ALTER TYPE "salesInvoiceLineType"    ADD VALUE IF NOT EXISTS 'Rental';

DO $rentenums$
BEGIN
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
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rentalInvoiceLineKind') THEN
    CREATE TYPE "rentalInvoiceLineKind" AS ENUM ('Rent', 'Charge', 'Purchase Option');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rentalRateUnit') THEN
    CREATE TYPE "rentalRateUnit" AS ENUM ('Day', 'Week', 'Month');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rentalRateMode') THEN
    CREATE TYPE "rentalRateMode" AS ENUM ('Best Rate', 'Fixed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lessorClassification') THEN
    CREATE TYPE "lessorClassification" AS ENUM ('Operating', 'Sales-Type', 'Direct Financing');
  END IF;
END $rentenums$;
