-- Project billing (.ai/specs/2026-10-09-project-billing.md). Enums only: a new enum value
-- cannot share a transaction with statements that use it. Phase 4b uses the last two
-- values; they are here so 4b needs no enum migration.
DO $$ BEGIN CREATE TYPE "contractBillingMethod" AS ENUM ('Fixed', 'Time & Materials', 'Cost Plus');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TYPE "contractRevenueMethod" ADD VALUE IF NOT EXISTS 'Right to Invoice';
ALTER TYPE "contractRevenueMethod" ADD VALUE IF NOT EXISTS 'Percent Complete';
ALTER TYPE "revenueScheduleType" ADD VALUE IF NOT EXISTS 'Cost Relief';
ALTER TYPE "revenueScheduleType" ADD VALUE IF NOT EXISTS 'Loss Provision';
