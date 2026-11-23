-- Field Service Phase C: refurbishment completion.
-- Spec: .ai/specs/2026-10-08-field-service.md (Accounting → Refurbishment completion).
--
-- A Refurbishment order completes once. The completion moves the order's WIP into
-- the serial's own cost layer, capped at the sale price. The order keeps what the
-- completion did: the amount capitalized, the write-down, the journal and the
-- costing method the item had at that moment.

ALTER TABLE "serviceOrder"
  ADD COLUMN IF NOT EXISTS "capitalizedAmount" NUMERIC,
  ADD COLUMN IF NOT EXISTS "writeDownAmount" NUMERIC,
  ADD COLUMN IF NOT EXISTS "completionJournalId" TEXT REFERENCES "journal"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "completionCostingMethod" "itemCostingMethod";

ALTER TABLE "serviceOrder" ADD CONSTRAINT "serviceOrder_refurbishment_check"
  CHECK ("type" = 'Refurbishment' OR ("capitalizedAmount" IS NULL AND "writeDownAmount" IS NULL));

CREATE INDEX IF NOT EXISTS "serviceOrder_completionJournalId_idx" ON "serviceOrder" ("completionJournalId")
  WHERE "completionJournalId" IS NOT NULL;
