-- 1. Integration registry seed
INSERT INTO "integration" ("id", "jsonschema")
VALUES ('mcmaster-carr', '{}'::json)
ON CONFLICT ("id") DO NOTHING;

-- 2. Enums
DO $$ BEGIN
  CREATE TYPE "punchoutSessionStatus" AS ENUM ('Pending', 'Returned', 'Consumed', 'Cancelled', 'Expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "cxmlDocumentType" AS ENUM ('Purchase Order', 'Order Confirmation', 'Ship Notice', 'Invoice', 'Credit Memo');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "cxmlDocumentDirection" AS ENUM ('Inbound', 'Outbound');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "cxmlDocumentStatus" AS ENUM ('Received', 'Needs Review', 'Posted', 'Rejected', 'Pending', 'Sent', 'Failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. punchoutSession
CREATE TABLE IF NOT EXISTS "punchoutSession" (
    "id" TEXT NOT NULL DEFAULT id('pnch'),
    "companyId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "buyerCookie" TEXT NOT NULL,
    "status" "punchoutSessionStatus" NOT NULL DEFAULT 'Pending',
    "purchaseOrderId" TEXT,
    "cart" JSONB,
    "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "punchoutSession_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "punchoutSession_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "punchoutSession_supplierId_fkey" FOREIGN KEY ("supplierId", "companyId")
      REFERENCES "supplier"("id", "companyId"),
    CONSTRAINT "punchoutSession_integrationId_fkey" FOREIGN KEY ("integrationId")
      REFERENCES "integration"("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "punchoutSession_buyerCookie_idx" ON "punchoutSession" ("buyerCookie");
CREATE INDEX IF NOT EXISTS "punchoutSession_companyId_idx" ON "punchoutSession" ("companyId");

ALTER TABLE "punchoutSession" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SELECT" ON "punchoutSession";
CREATE POLICY "SELECT" ON "punchoutSession" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_view'))::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "punchoutSession";
CREATE POLICY "INSERT" ON "punchoutSession" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_create'))::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "punchoutSession";
CREATE POLICY "UPDATE" ON "punchoutSession" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_update'))::text[])
);
-- No DELETE policy: sessions expire, never user-deleted.

-- 4. cxmlDocument
CREATE TABLE IF NOT EXISTS "cxmlDocument" (
    "id" TEXT NOT NULL DEFAULT id('cxml'),
    "companyId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "direction" "cxmlDocumentDirection" NOT NULL,
    "documentType" "cxmlDocumentType" NOT NULL,
    "status" "cxmlDocumentStatus" NOT NULL,
    "payloadId" TEXT NOT NULL,
    "externalId" TEXT,
    "payload" JSONB NOT NULL,
    "issues" JSONB NOT NULL DEFAULT '[]',
    "purchaseOrderId" TEXT,
    "sourceDocument" TEXT,
    "sourceDocumentId" TEXT,
    "sourceDocumentReadableId" TEXT,
    "releasedBy" TEXT REFERENCES "user"("id"),
    "releasedAt" TIMESTAMP WITH TIME ZONE,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "cxmlDocument_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "cxmlDocument_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "cxmlDocument_supplierId_fkey" FOREIGN KEY ("supplierId", "companyId")
      REFERENCES "supplier"("id", "companyId"),
    CONSTRAINT "cxmlDocument_integrationId_fkey" FOREIGN KEY ("integrationId")
      REFERENCES "integration"("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "cxmlDocument_dedup_idx"
  ON "cxmlDocument" ("companyId", "integrationId", "direction", "documentType", "payloadId");
CREATE INDEX IF NOT EXISTS "cxmlDocument_companyId_status_idx" ON "cxmlDocument" ("companyId", "status");

ALTER TABLE "cxmlDocument" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SELECT" ON "cxmlDocument";
CREATE POLICY "SELECT" ON "cxmlDocument" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_view'))::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "cxmlDocument";
CREATE POLICY "UPDATE" ON "cxmlDocument" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_update'))::text[])
);
-- No INSERT/DELETE policies: rows are written by service-role (webhook/job) only.

-- 5. Opaque punchout cookie on PO lines
ALTER TABLE "purchaseOrderLine" ADD COLUMN IF NOT EXISTS "supplierPartAuxiliaryId" TEXT;

-- 6. Recreate the purchaseOrderLines view so pl.* picks up the new column.
-- Forked verbatim from 20260811123616_widen-purchasing-scale.sql (the newest definition).
DROP VIEW IF EXISTS "purchaseOrderLines";
CREATE VIEW "purchaseOrderLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT DISTINCT ON (pl.id)
    pl.*,
    sp."supplierPartId" as "supplierPartIdFromSupplier",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    i.name as "itemName",
    i."readableIdWithRevision" as "itemReadableId",
    i.description as "itemDescription",
    COALESCE(mu.id, imu.id) as "modelId",
    COALESCE(mu."autodeskUrn", imu."autodeskUrn") as "autodeskUrn",
    COALESCE(mu."modelPath", imu."modelPath") as "modelPath",
    COALESCE(mu."name", imu."name") as "modelName",
    COALESCE(mu."size", imu."size") as "modelSize",
    ic."unitCost" as "unitCost",
    jo."description" as "jobOperationDescription",
    a."name" as "accountName",
    fa."fixedAssetId" as "assetReadableId",
    fa."name" as "assetName"
  FROM "purchaseOrderLine" pl
  INNER JOIN "purchaseOrder" so ON so.id = pl."purchaseOrderId"
  LEFT JOIN "modelUpload" mu ON pl."modelUploadId" = mu."id"
  LEFT JOIN "item" i ON i.id = pl."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "jobOperation" jo ON jo."id" = pl."jobOperationId"
  LEFT JOIN "account" a ON a.id = pl."accountId"
  LEFT JOIN "fixedAsset" fa ON fa.id = pl."assetId"
  LEFT JOIN "supplierPart" sp ON sp."supplierId" = so."supplierId" AND sp."itemId" = i.id
);
