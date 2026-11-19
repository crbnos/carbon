-- An operator scrapping parts at an operation: loose parts, or parts inside a
-- kit. The parts are replaced from the shelf, so the stock movement is a scrap
-- from the part's shelf bin (itemLedger, documentType 'Scrap', documentLineId
-- = this row). One row per part scrapped; the rows of one scrap share its
-- idempotency key, which is their retry guard.
-- RLS ships through the authz manifest (packages/database/src/authz/manifest.ts).

SET lock_timeout = '5s';

DO $$ BEGIN
  CREATE TYPE "jobMaterialScrapReplacement" AS ENUM ('Shelf', 'Water Spider');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "jobMaterialScrap" (
  "id" TEXT NOT NULL DEFAULT id('jms'),
  "companyId" TEXT NOT NULL,
  -- Soft references, as trackedActivity.sourceDocumentId: getting a job's
  -- method again replaces its materials and operations, and the scrap record
  -- (and the ledger rows that point at it) must outlive them.
  "jobMaterialId" TEXT NOT NULL,
  "jobOperationId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL REFERENCES "item"("id") ON DELETE RESTRICT,
  -- The serial or batch scrapped, for a tracked part.
  "trackedEntityId" TEXT REFERENCES "trackedEntity"("id") ON DELETE RESTRICT,
  "quantity" NUMERIC NOT NULL CHECK ("quantity" > 0),
  "scrapReasonId" TEXT NOT NULL REFERENCES "scrapReason"("id") ON DELETE RESTRICT,
  "replacement" "jobMaterialScrapReplacement" NOT NULL,
  "materialRequestId" TEXT,
  "notes" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "jobMaterialScrap_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "jobMaterialScrap_idempotencyKey_key"
    UNIQUE NULLS NOT DISTINCT
      ("companyId", "idempotencyKey", "jobMaterialId", "itemId", "trackedEntityId"),
  CONSTRAINT "jobMaterialScrap_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "jobMaterialScrap_materialRequestId_fkey" FOREIGN KEY ("materialRequestId", "companyId")
    REFERENCES "materialRequest"("id", "companyId") ON DELETE SET NULL ("materialRequestId")
);

CREATE INDEX IF NOT EXISTS "jobMaterialScrap_jobMaterialId_idx" ON "jobMaterialScrap" ("jobMaterialId");
CREATE INDEX IF NOT EXISTS "jobMaterialScrap_jobOperationId_idx" ON "jobMaterialScrap" ("jobOperationId");
CREATE INDEX IF NOT EXISTS "jobMaterialScrap_itemId_idx" ON "jobMaterialScrap" ("itemId");
CREATE INDEX IF NOT EXISTS "jobMaterialScrap_trackedEntityId_idx" ON "jobMaterialScrap" ("trackedEntityId");
CREATE INDEX IF NOT EXISTS "jobMaterialScrap_scrapReasonId_idx" ON "jobMaterialScrap" ("scrapReasonId");
CREATE INDEX IF NOT EXISTS "jobMaterialScrap_materialRequestId_idx" ON "jobMaterialScrap" ("materialRequestId");
CREATE INDEX IF NOT EXISTS "jobMaterialScrap_createdBy_idx" ON "jobMaterialScrap" ("createdBy");

ALTER TABLE "public"."jobMaterialScrap" ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

RESET lock_timeout;
