-- One depreciation run line per asset per month (FAM's depreciation history
-- record). A catch-up run posts each month in its own accounting period.
ALTER TABLE "depreciationRunLine" ADD COLUMN IF NOT EXISTS "periodEnd" DATE;

UPDATE "depreciationRunLine" l
SET "periodEnd" = r."periodEnd"
FROM "depreciationRun" r
WHERE r."id" = l."depreciationRunId"
  AND l."periodEnd" IS NULL;

-- Nullable on purpose: a backup taken before this migration has lines with
-- no periodEnd, and a NOT NULL column with no default would make it
-- unrestorable. Every writer sets it; readers fall back to the run's periodEnd.

-- The deferred tax journal of the line's month. Reverse Run reads it.
ALTER TABLE "depreciationRunLine" ADD COLUMN IF NOT EXISTS "deferredTaxJournalId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'depreciationRunLine_deferredTaxJournalId_fkey'
  ) THEN
    ALTER TABLE "depreciationRunLine"
      ADD CONSTRAINT "depreciationRunLine_deferredTaxJournalId_fkey"
      FOREIGN KEY ("deferredTaxJournalId") REFERENCES "journal" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "depreciationRunLine_deferredTaxJournalId_idx"
  ON "depreciationRunLine" ("deferredTaxJournalId");

-- Before this migration a run posted one deferred tax journal, named only by
-- its description. Link it to the run's lines.
UPDATE "depreciationRunLine" l
SET "deferredTaxJournalId" = j."id"
FROM "depreciationRun" r, "journal" j
WHERE r."id" = l."depreciationRunId"
  AND j."companyId" = r."companyId"
  AND j."sourceType" = 'Asset Depreciation'
  AND j."description" = 'Deferred Tax: Depreciation ' || r."depreciationRunId"
  AND l."deferredTaxJournalId" IS NULL;

-- A revenue recognition period can have more than one run, but one Draft at a
-- time.
CREATE UNIQUE INDEX IF NOT EXISTS "revenueRecognitionRun_one_draft_per_period"
  ON "revenueRecognitionRun" ("companyId", "periodEnd")
  WHERE "status" = 'Draft';
