-- Contracts (.ai/specs/2026-10-02-contracts.md). Enums only: an ADD VALUE cannot
-- share a transaction with statements that use it.
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Contract';

DO $$ BEGIN CREATE TYPE "customerContractStatus" AS ENUM ('Draft', 'Active', 'Ended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "customerContractType" AS ENUM ('New Sales', 'Existing', 'Expansion', 'Reactivation', 'Contraction');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "contractRevenueType" AS ENUM ('One-time', 'Recurring');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "contractRateUnit" AS ENUM ('Day', 'Week', 'Month', 'Quarter', 'Year');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "contractBillingFrequency" AS ENUM ('Week', 'Month', 'Quarter', 'Year');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "contractBillingAlignment" AS ENUM ('Anniversary', 'Calendar');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "contractBillingTiming" AS ENUM ('Advance', 'Arrears');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "contractRenewal" AS ENUM ('Renew', 'End');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- A method, not a pattern: 'As Invoiced' and 'Percent Complete' arrive later as values.
DO $$ BEGIN CREATE TYPE "contractRevenueMethod" AS ENUM ('Daily', 'Even Period');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "contractAmendmentEffect" AS ENUM ('Change Date', 'Next Period');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "contractInvoiceStatus" AS ENUM ('Planned', 'Invoiced', 'Billed Externally');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Planned until the recognition run synthesizes it; Recognized Externally for months
-- before the contract's "Recognize revenue from" (a migrated contract).
DO $$ BEGIN CREATE TYPE "contractRevenueStatus" AS ENUM ('Planned', 'Recognized', 'Recognized Externally');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "contractLedgerEntryType" AS ENUM ('Opening', 'Invoice', 'Recognition', 'Credit Memo', 'Void');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
