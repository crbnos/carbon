-- Projects Phase 2b: project-aware MRP. New source and action types.
-- Postgres refuses a new enum value in the transaction that adds it, so the
-- segment migration (which names 'Transfer' and 'Borrow' in a CHECK) runs after.
ALTER TYPE "demandSourceType" ADD VALUE IF NOT EXISTS 'Project Material';
ALTER TYPE "demandSourceType" ADD VALUE IF NOT EXISTS 'Project Borrow';
ALTER TYPE "supplySourceType" ADD VALUE IF NOT EXISTS 'Project Borrow';
ALTER TYPE "demandForecastSourceType" ADD VALUE IF NOT EXISTS 'Project Material';
ALTER TYPE "planningActionType" ADD VALUE IF NOT EXISTS 'Transfer';
ALTER TYPE "planningActionType" ADD VALUE IF NOT EXISTS 'Borrow';
