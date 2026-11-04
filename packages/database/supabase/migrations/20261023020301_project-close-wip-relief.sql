-- Project close relieves Project WIP (accounting audit D11, D12).
-- Audit: .ai/runs/2026-10-22-project-accounting-audit.md
-- Plan: .ai/plans/2026-10-22-project-accounting-fixes.md
--
-- Closing a Contract project posts one 'Project Close' journal: Dr cost of goods
-- sold / Cr the account each ledger row's journal line debited, for the WIP no
-- progress contract line owns. Each relieved ledger row gets a projectCostRelief
-- row, which now points at either the revenue run's Cost Relief schedule row or
-- the close journal. UNIQUE ("projectLedgerId", "companyId") stays the one
-- guarantee that a row is relieved once, by the run or by a close.
--
-- Nothing in this file uses the new enum values, so they may ship with it.

ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Project Close';
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Project Close';

ALTER TABLE "projectCostRelief"
  ALTER COLUMN "revenueRecognitionScheduleId" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "journalId" TEXT;

DO $pcrclose$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"projectCostRelief"'::regclass
      AND conname = 'projectCostRelief_journal_fkey'
  ) THEN
    -- Cascade like the schedule FK: a relief without its journal does not exist.
    ALTER TABLE "projectCostRelief"
      ADD CONSTRAINT "projectCostRelief_journal_fkey"
      FOREIGN KEY ("journalId") REFERENCES "journal"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"projectCostRelief"'::regclass
      AND conname = 'projectCostRelief_source_check'
  ) THEN
    -- Every existing row has a schedule row and no journal.
    ALTER TABLE "projectCostRelief"
      ADD CONSTRAINT "projectCostRelief_source_check"
      CHECK (num_nonnulls("revenueRecognitionScheduleId", "journalId") = 1);
  END IF;
END $pcrclose$;

CREATE INDEX IF NOT EXISTS "projectCostRelief_journal_idx"
  ON "projectCostRelief" ("journalId");
