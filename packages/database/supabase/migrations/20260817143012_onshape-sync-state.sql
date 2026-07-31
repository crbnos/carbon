-- Onshape CAD sync state: one row per item x asset kind, plus one row per
-- backfill run. Both tables are written exclusively by the service role
-- (Inngest jobs and API routes); employees of the company get read access only.

CREATE TABLE "onshapeItemSyncState" (
    "id" TEXT NOT NULL DEFAULT id('osis'),
    "companyId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "assetKind" TEXT NOT NULL CHECK ("assetKind" IN ('model','drawing')),
    "status" TEXT NOT NULL CHECK ("status" IN ('queued','running','synced','skipped','failed')),
    "source" TEXT NOT NULL CHECK ("source" IN ('webhook','backfill','manual')),
    "skipReason" TEXT,
    "error" TEXT,
    "observedOnly" BOOLEAN NOT NULL DEFAULT false,
    "partNumber" TEXT,
    "revision" TEXT,
    "revisionId" TEXT,
    "documentId" TEXT,
    "versionId" TEXT,
    "elementId" TEXT,
    "releaseState" TEXT,
    "modelUploadId" TEXT,
    "documentPath" TEXT,
    -- intentionally not an FK to "onshapeSyncRun": runs are retention-pruned to the
    -- newest 50 per company, and losing that attribution must not delete state rows
    "runId" TEXT,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    -- intentionally a single-column FK: "item" has no (id, companyId) unique key,
    -- and adding one to that production table was declined — cross-tenant
    -- integrity relies on companyId scoping in every (service-role) write path
    FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
    CONSTRAINT "onshapeItemSyncState_itemId_assetKind_companyId_key" UNIQUE ("itemId", "assetKind", "companyId")
);

CREATE INDEX "onshapeItemSyncState_companyId_status_idx" ON "onshapeItemSyncState" ("companyId", "status");
CREATE INDEX "onshapeItemSyncState_companyId_updatedAt_idx" ON "onshapeItemSyncState" ("companyId", "updatedAt");
CREATE INDEX "onshapeItemSyncState_createdBy_idx" ON "onshapeItemSyncState" ("createdBy");

ALTER TABLE "public"."onshapeItemSyncState" ENABLE ROW LEVEL SECURITY;

-- SELECT only: every write path uses the service role, which bypasses RLS. Adding
-- INSERT/UPDATE/DELETE policies would open sync state to direct client writes.
CREATE POLICY "SELECT" ON "public"."onshapeItemSyncState" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE TABLE "onshapeSyncRun" (
    "id" TEXT NOT NULL DEFAULT id('osr'),
    "companyId" TEXT NOT NULL,
    "status" TEXT NOT NULL CHECK ("status" IN ('queued','running','completed','failed','cancelled')),
    "startedAt" TIMESTAMP WITH TIME ZONE,
    "finishedAt" TIMESTAMP WITH TIME ZONE,
    "pagesProcessed" INTEGER NOT NULL DEFAULT 0,
    "revisionsScanned" INTEGER NOT NULL DEFAULT 0,
    "matched" INTEGER NOT NULL DEFAULT 0,
    "synced" INTEGER NOT NULL DEFAULT 0,
    "skippedNoItem" INTEGER NOT NULL DEFAULT 0,
    "skippedAlreadySynced" INTEGER NOT NULL DEFAULT 0,
    "skippedNonModel" INTEGER NOT NULL DEFAULT 0,
    "skippedTooLarge" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "totalRevisions" INTEGER,
    "unmatchedReleases" JSONB NOT NULL DEFAULT '[]',
    "unmatchedOverflow" INTEGER NOT NULL DEFAULT 0,
    "ambiguousReleases" JSONB NOT NULL DEFAULT '[]',
    "ambiguousOverflow" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "cancelledBy" TEXT REFERENCES "user"("id"),
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX "onshapeSyncRun_companyId_createdAt_idx" ON "onshapeSyncRun" ("companyId", "createdAt" DESC);
CREATE INDEX "onshapeSyncRun_createdBy_idx" ON "onshapeSyncRun" ("createdBy");

ALTER TABLE "public"."onshapeSyncRun" ENABLE ROW LEVEL SECURITY;

-- SELECT only, for the same reason as "onshapeItemSyncState" above.
CREATE POLICY "SELECT" ON "public"."onshapeSyncRun" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
