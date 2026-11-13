-- Serial traveler and line flow, slice 1 schema
-- (.ai/specs/2026-11-12-serial-traveler-line-flow.md, Data Model Changes).
-- RLS for "materialRequest" ships through the authz manifest
-- (packages/database/src/authz/manifest.ts), never as a policy statement in a migration.

SET lock_timeout = '5s';

-- 1. Company settings. Each is off by default, so no company changes.
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "travelerLabels" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "requireTrackedMaterialsIssued" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "autoPickingListOnRelease" BOOLEAN NOT NULL DEFAULT false;

-- 2. Finished-good label per item.
ALTER TABLE "itemSerialSequence"
  ADD COLUMN IF NOT EXISTS "printLabelOnCompletion" BOOLEAN NOT NULL DEFAULT false;

-- The view expanded iss.* when it was created, so it is rebuilt to carry the
-- new column (a new column inside iss.* moves the joined ones, which CREATE OR
-- REPLACE refuses).
DROP VIEW IF EXISTS "itemSerialSequences";
CREATE VIEW "itemSerialSequences" WITH(SECURITY_INVOKER=true) AS
SELECT
  iss.*,
  i."readableIdWithRevision" AS "itemReadableId",
  i."name" AS "itemName",
  i."itemTrackingType"
FROM "itemSerialSequence" iss
INNER JOIN "item" i ON i."id" = iss."itemId";

-- 3. "Need material" requests.
DO $$ BEGIN
  CREATE TYPE "materialRequestStatus" AS ENUM ('Open', 'Resolved');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "materialRequest" (
  "id" TEXT NOT NULL DEFAULT id('mreq'),
  "companyId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "workCenterId" TEXT,
  "jobOperationId" TEXT REFERENCES "jobOperation"("id") ON DELETE SET NULL,
  "itemId" TEXT REFERENCES "item"("id") ON DELETE SET NULL,
  "note" TEXT,
  "status" "materialRequestStatus" NOT NULL DEFAULT 'Open',
  "resolvedBy" TEXT REFERENCES "user"("id"),
  "resolvedAt" TIMESTAMP WITH TIME ZONE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "materialRequest_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "materialRequest_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "materialRequest_locationId_fkey" FOREIGN KEY ("locationId", "companyId")
    REFERENCES "location"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "materialRequest_workCenterId_fkey" FOREIGN KEY ("workCenterId", "companyId")
    REFERENCES "workCenter"("id", "companyId") ON DELETE SET NULL ("workCenterId"),
  -- A resolved request records when; an open one does not.
  CONSTRAINT "materialRequest_resolvedAt_check"
    CHECK (("status" = 'Resolved') = ("resolvedAt" IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS "materialRequest_companyId_idx" ON "materialRequest" ("companyId");
CREATE INDEX IF NOT EXISTS "materialRequest_locationId_idx" ON "materialRequest" ("locationId");
CREATE INDEX IF NOT EXISTS "materialRequest_workCenterId_idx" ON "materialRequest" ("workCenterId");
CREATE INDEX IF NOT EXISTS "materialRequest_jobOperationId_idx" ON "materialRequest" ("jobOperationId");
CREATE INDEX IF NOT EXISTS "materialRequest_itemId_idx" ON "materialRequest" ("itemId");
CREATE INDEX IF NOT EXISTS "materialRequest_createdBy_idx" ON "materialRequest" ("createdBy");
CREATE INDEX IF NOT EXISTS "materialRequest_updatedBy_idx" ON "materialRequest" ("updatedBy");
CREATE INDEX IF NOT EXISTS "materialRequest_resolvedBy_idx" ON "materialRequest" ("resolvedBy");
CREATE INDEX IF NOT EXISTS "materialRequest_open_idx"
  ON "materialRequest" ("companyId", "locationId") WHERE "status" = 'Open';

ALTER TABLE "public"."materialRequest" ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

RESET lock_timeout;
