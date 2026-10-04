-- Contracts, Phase B (.ai/plans/2026-10-04-contracts-wizard-phase-b.md). Enum values only:
-- an ADD VALUE cannot share a transaction with statements that use it.
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Contract';

-- Planned until the recognition run synthesizes it; Recognized Externally for months
-- before the contract's "Recognize revenue from" (a migrated contract).
DO $$ BEGIN CREATE TYPE "contractRevenueStatus" AS ENUM ('Planned', 'Recognized', 'Recognized Externally');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "contractLedgerEntryType" AS ENUM ('Opening', 'Invoice', 'Recognition', 'Credit Memo', 'Void');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
