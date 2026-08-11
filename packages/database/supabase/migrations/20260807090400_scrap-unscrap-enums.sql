-- Terminal scrap status for tracked entities (Epicor SCRAPPED / SAP ME precedent).
-- Recoverable via ERP Unscrap, unlike 'Consumed'.
ALTER TYPE "trackedEntityStatus" ADD VALUE IF NOT EXISTS 'Scrapped';

-- Scrap movement identity on the two document-type enums. These are DIFFERENT
-- enums with overlapping value sets — both need the value.
ALTER TYPE "itemLedgerDocumentType" ADD VALUE IF NOT EXISTS 'Scrap';
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Scrap';

-- Scrap reason as a journal dimension (single scrapAccount + dimension slicing;
-- valueId on journalLineDimension is polymorphic → scrapReason.id).
ALTER TYPE "dimensionEntityType" ADD VALUE IF NOT EXISTS 'ScrapReason';

-- Reason lands on stock scrap/unscrap movements (MES production scrap keeps its
-- reason on productionQuantity.scrapReasonId).
ALTER TABLE "itemLedger" ADD COLUMN IF NOT EXISTS "scrapReasonId" TEXT;
ALTER TABLE "itemLedger" DROP CONSTRAINT IF EXISTS "itemLedger_scrapReasonId_fkey";
ALTER TABLE "itemLedger" ADD CONSTRAINT "itemLedger_scrapReasonId_fkey"
  FOREIGN KEY ("scrapReasonId") REFERENCES "scrapReason"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "itemLedger_scrapReasonId_idx"
  ON "itemLedger"("scrapReasonId") WHERE "scrapReasonId" IS NOT NULL;
