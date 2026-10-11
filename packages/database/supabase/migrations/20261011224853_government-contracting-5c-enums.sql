-- Government Contracting Phase 5c: control and reporting.
-- Spec: .ai/specs/2026-10-09-government-contracting.md (Phase 5c)
-- Plan: .ai/plans/2026-10-09-government-contracting-phase-5c.md (Task 1)
-- Enum values ship alone: a new value cannot be used in the transaction that adds it.

DO $$ BEGIN
  CREATE TYPE "budgetControl" AS ENUM ('None', 'Warn', 'Block');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "earnedValueTechnique" AS ENUM ('0/100', '50/50', 'Percent Complete', 'Milestone', 'Level of Effort', 'Apportioned');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
