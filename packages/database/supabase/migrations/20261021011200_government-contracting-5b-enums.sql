-- Government Contracting Phase 5b: indirect rates and burden.
-- Spec: .ai/specs/2026-10-09-government-contracting.md (Phase 5b)
-- Plan: .ai/plans/2026-10-09-government-contracting-phase-5b.md (Task 1)
-- Enum values ship alone: a new value cannot be used in the transaction that adds it.

DO $$ BEGIN
  CREATE TYPE "indirectPoolType" AS ENUM ('Fringe', 'Overhead', 'Material Handling', 'G&A', 'Service Center');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "indirectBaseType" AS ENUM ('Total Labor Dollars', 'Direct Labor Dollars', 'Direct Labor Hours',
    'Direct Material Dollars', 'Total Cost Input', 'Value Added');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "indirectRateType" AS ENUM ('Provisional', 'Target', 'Actual', 'Final');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "indirectPoolAccountRole" AS ENUM ('Cost', 'Base');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Burden';
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Burden';
