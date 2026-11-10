-- Enums for lessee leases and the lease run.
-- Enum additions live alone: ADD VALUE cannot be used in the same transaction as the value.
-- Spec: .ai/specs/2026-10-11-lessee-leases.md

ALTER TYPE "payableLineType" ADD VALUE IF NOT EXISTS 'Lease';
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Lease';
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Lease Run';
ALTER TYPE "revenueScheduleType" ADD VALUE IF NOT EXISTS 'Amortization';

DO $leaseenums$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leaseStatus') THEN
    CREATE TYPE "leaseStatus" AS ENUM ('Draft', 'Active', 'Expired', 'Terminated', 'Purchased', 'Cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lesseeClassification') THEN
    CREATE TYPE "lesseeClassification" AS ENUM ('Operating', 'Finance', 'Short-Term');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leasePaymentFrequency') THEN
    CREATE TYPE "leasePaymentFrequency" AS ENUM ('Monthly', 'Quarterly', 'Annual');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leasePaymentStatus') THEN
    CREATE TYPE "leasePaymentStatus" AS ENUM ('Pending', 'Invoiced', 'Skipped');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leasePaymentType') THEN
    CREATE TYPE "leasePaymentType" AS ENUM ('Rent', 'Purchase Option', 'Termination Penalty');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leaseEventType') THEN
    CREATE TYPE "leaseEventType" AS ENUM ('Modification', 'Termination', 'Purchase');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'runType') THEN
    CREATE TYPE "runType" AS ENUM ('Revenue Recognition', 'Lease');
  END IF;
END $leaseenums$;
