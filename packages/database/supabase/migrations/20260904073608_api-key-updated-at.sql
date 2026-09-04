-- `apiKey` carried `updatedBy` (20260701143512) but never `updatedAt`, so a
-- secret regeneration left no record of WHEN it happened — only a changed
-- preview. Regeneration and edits now stamp both, per the standard audit pair.
-- Set by the app, not a trigger, matching every other `updatedAt` in the schema.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS) per the migration convention.

ALTER TABLE "apiKey" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP WITH TIME ZONE;
