-- Fleet bridge + Make to Asset: item/serial/work-center links on fixedAsset, job
-- asset targets, the fixedAssetTransfer document and the CIP cost ledger, PP&E
-- accounts, the Rental Fleet and Construction in Progress classes, the fleetAssets
-- view. Idempotent. Spec: .ai/specs/2026-09-22-revenue-recognition-and-rentals.md §2

-- 1) Columns ---------------------------------------------------------------------
ALTER TABLE "fixedAsset"
  ADD COLUMN IF NOT EXISTS "itemId" TEXT REFERENCES "item"("id") ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS "trackedEntityId" TEXT REFERENCES "trackedEntity"("id") ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS "quantity" NUMERIC NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "workCenterId" TEXT REFERENCES "workCenter"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "outOfServiceSince" DATE,
  ADD COLUMN IF NOT EXISTS "outOfServiceReason" TEXT;

ALTER TABLE "fixedAssetClass" ADD COLUMN IF NOT EXISTS "isConstructionInProgress" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "job"
  ADD COLUMN IF NOT EXISTS "fixedAssetClassId" TEXT REFERENCES "fixedAssetClass"("id"),
  ADD COLUMN IF NOT EXISTS "fixedAssetId" TEXT REFERENCES "fixedAsset"("id");

DO $fleetchecks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"fixedAsset"'::regclass AND conname = 'fixedAsset_quantity_v1_check') THEN
    -- v1 is one serialized unit per asset; a later bulk-pool phase relaxes this.
    ALTER TABLE "fixedAsset" ADD CONSTRAINT "fixedAsset_quantity_v1_check" CHECK ("quantity" = 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"fixedAsset"'::regclass AND conname = 'fixedAsset_outOfService_check') THEN
    ALTER TABLE "fixedAsset" ADD CONSTRAINT "fixedAsset_outOfService_check"
      CHECK (("outOfServiceSince" IS NULL) = ("outOfServiceReason" IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"job"'::regclass AND conname = 'job_asset_target_check') THEN
    -- A job completes to inventory, to a new asset of a class, or sweeps its cost
    -- to one Under Construction asset — never two of those.
    ALTER TABLE "job" ADD CONSTRAINT "job_asset_target_check"
      CHECK (num_nonnulls("fixedAssetClassId", "fixedAssetId") <= 1);
  END IF;
END $fleetchecks$;

CREATE UNIQUE INDEX IF NOT EXISTS "fixedAsset_trackedEntity_live_idx"
  ON "fixedAsset" ("companyId", "trackedEntityId")
  WHERE "trackedEntityId" IS NOT NULL AND "status" <> 'Disposed';
CREATE INDEX IF NOT EXISTS "fixedAsset_itemId_idx" ON "fixedAsset" ("itemId");
CREATE INDEX IF NOT EXISTS "fixedAsset_workCenterId_idx" ON "fixedAsset" ("workCenterId");
CREATE INDEX IF NOT EXISTS "job_fixedAssetClassId_idx" ON "job" ("fixedAssetClassId");
CREATE INDEX IF NOT EXISTS "job_fixedAssetId_idx" ON "job" ("fixedAssetId");

-- 2) fixedAssetTransfer ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS "fixedAssetTransfer" (
  "id" TEXT NOT NULL DEFAULT id('fatr'),
  "companyId" TEXT NOT NULL,
  "transferId" TEXT NOT NULL,
  "type" "fixedAssetTransferType" NOT NULL,
  "sourceType" "fixedAssetTransferSourceType" NOT NULL DEFAULT 'Inventory',
  "fixedAssetId" TEXT NOT NULL REFERENCES "fixedAsset"("id") ON DELETE RESTRICT,
  "itemId" TEXT REFERENCES "item"("id"),
  "trackedEntityId" TEXT REFERENCES "trackedEntity"("id"),
  "jobId" TEXT REFERENCES "job"("id") ON DELETE SET NULL,
  "fromClassId" TEXT REFERENCES "fixedAssetClass"("id"),
  "locationId" TEXT NOT NULL REFERENCES "location"("id"),
  "storageUnitId" TEXT,
  "quantity" NUMERIC NOT NULL DEFAULT 1,
  "transferDate" DATE NOT NULL,
  "inServiceDate" DATE,
  "amount" NUMERIC NOT NULL,
  "accumulatedDepreciation" NUMERIC NOT NULL DEFAULT 0,
  "journalId" TEXT REFERENCES "journal"("id") ON DELETE SET NULL,
  "status" TEXT NOT NULL DEFAULT 'Draft' CHECK ("status" IN ('Draft', 'Posted')),
  "postedAt" TIMESTAMP WITH TIME ZONE,
  "postedBy" TEXT REFERENCES "user"("id"),
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "fixedAssetTransfer_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "fixedAssetTransfer_transferId_companyId_key" UNIQUE ("transferId", "companyId"),
  CONSTRAINT "fixedAssetTransfer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "fixedAssetTransfer_companyId_idx" ON "fixedAssetTransfer" ("companyId");
CREATE INDEX IF NOT EXISTS "fixedAssetTransfer_fixedAssetId_idx" ON "fixedAssetTransfer" ("fixedAssetId");
CREATE INDEX IF NOT EXISTS "fixedAssetTransfer_itemId_idx" ON "fixedAssetTransfer" ("itemId");
CREATE INDEX IF NOT EXISTS "fixedAssetTransfer_trackedEntityId_idx" ON "fixedAssetTransfer" ("trackedEntityId");
CREATE INDEX IF NOT EXISTS "fixedAssetTransfer_jobId_idx" ON "fixedAssetTransfer" ("jobId");
CREATE INDEX IF NOT EXISTS "fixedAssetTransfer_fromClassId_idx" ON "fixedAssetTransfer" ("fromClassId");
CREATE INDEX IF NOT EXISTS "fixedAssetTransfer_locationId_idx" ON "fixedAssetTransfer" ("locationId");
CREATE INDEX IF NOT EXISTS "fixedAssetTransfer_journalId_idx" ON "fixedAssetTransfer" ("journalId");
CREATE INDEX IF NOT EXISTS "fixedAssetTransfer_postedBy_idx" ON "fixedAssetTransfer" ("postedBy");
CREATE INDEX IF NOT EXISTS "fixedAssetTransfer_createdBy_idx" ON "fixedAssetTransfer" ("createdBy");

ALTER TABLE "public"."fixedAssetTransfer" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SELECT" ON "public"."fixedAssetTransfer";
CREATE POLICY "SELECT" ON "public"."fixedAssetTransfer" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_view'))::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."fixedAssetTransfer";
CREATE POLICY "INSERT" ON "public"."fixedAssetTransfer" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."fixedAssetTransfer";
CREATE POLICY "UPDATE" ON "public"."fixedAssetTransfer" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
);
DROP POLICY IF EXISTS "DELETE" ON "public"."fixedAssetTransfer";
CREATE POLICY "DELETE" ON "public"."fixedAssetTransfer" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
);

-- 3) fixedAssetCipCost (append-only) ---------------------------------------------
CREATE TABLE IF NOT EXISTS "fixedAssetCipCost" (
  "id" TEXT NOT NULL DEFAULT id('facc'),
  "companyId" TEXT NOT NULL,
  "fixedAssetId" TEXT NOT NULL REFERENCES "fixedAsset"("id") ON DELETE RESTRICT,
  "sourceType" TEXT NOT NULL CHECK ("sourceType" IN ('Purchase Invoice', 'Receipt', 'Job', 'Manual')),
  "sourceDocumentId" TEXT,
  "sourceDocumentLineId" TEXT,
  "jobId" TEXT REFERENCES "job"("id") ON DELETE SET NULL,
  "amount" NUMERIC NOT NULL,
  "costDate" DATE NOT NULL,
  "journalId" TEXT REFERENCES "journal"("id") ON DELETE SET NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "fixedAssetCipCost_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "fixedAssetCipCost_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "fixedAssetCipCost_companyId_idx" ON "fixedAssetCipCost" ("companyId");
CREATE INDEX IF NOT EXISTS "fixedAssetCipCost_asset_idx" ON "fixedAssetCipCost" ("companyId", "fixedAssetId");
CREATE INDEX IF NOT EXISTS "fixedAssetCipCost_jobId_idx" ON "fixedAssetCipCost" ("jobId");
CREATE INDEX IF NOT EXISTS "fixedAssetCipCost_journalId_idx" ON "fixedAssetCipCost" ("journalId");
CREATE INDEX IF NOT EXISTS "fixedAssetCipCost_createdBy_idx" ON "fixedAssetCipCost" ("createdBy");

ALTER TABLE "public"."fixedAssetCipCost" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SELECT" ON "public"."fixedAssetCipCost";
CREATE POLICY "SELECT" ON "public"."fixedAssetCipCost" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_view'))::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."fixedAssetCipCost";
CREATE POLICY "INSERT" ON "public"."fixedAssetCipCost" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."fixedAssetCipCost";
CREATE POLICY "UPDATE" ON "public"."fixedAssetCipCost" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
);
DROP POLICY IF EXISTS "DELETE" ON "public"."fixedAssetCipCost";
CREATE POLICY "DELETE" ON "public"."fixedAssetCipCost" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
);

-- 4) Sequence per company -----------------------------------------------------------
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'fixedAssetTransfer', 'Fixed Asset Transfer', 'FAT', NULL, 0, 6, 1, c.id
FROM "company" c
WHERE NOT EXISTS (SELECT 1 FROM "sequence" s WHERE s."companyId" = c.id AND s."table" = 'fixedAssetTransfer');

-- 5) PP&E accounts, one per company group, parent resolved by group NAME -------------
INSERT INTO "account" ("id", "number", "name", "class", "accountType", "incomeBalance", "consolidatedRate", "parentId", "isGroup", "active", "isSystem", "companyGroupId", "createdBy")
SELECT id('acct'), '1370', 'Rental Fleet', 'Asset', 'Fixed Asset', 'Balance Sheet', 'Current', g.id, false, true, false, g."companyGroupId", 'system'
FROM "account" g
WHERE g."isGroup" = TRUE AND g.name = 'Property, Plant & Equipment'
  AND NOT EXISTS (SELECT 1 FROM "account" a WHERE a."companyGroupId" = g."companyGroupId" AND a.number = '1370');

INSERT INTO "account" ("id", "number", "name", "class", "accountType", "incomeBalance", "consolidatedRate", "parentId", "isGroup", "active", "isSystem", "companyGroupId", "createdBy")
SELECT id('acct'), '1380', 'Accumulated Depreciation – Rental Fleet', 'Asset', 'Accumulated Depreciation', 'Balance Sheet', 'Current', g.id, false, true, false, g."companyGroupId", 'system'
FROM "account" g
WHERE g."isGroup" = TRUE AND g.name = 'Property, Plant & Equipment'
  AND NOT EXISTS (SELECT 1 FROM "account" a WHERE a."companyGroupId" = g."companyGroupId" AND a.number = '1380');

INSERT INTO "account" ("id", "number", "name", "class", "accountType", "incomeBalance", "consolidatedRate", "parentId", "isGroup", "active", "isSystem", "companyGroupId", "createdBy")
SELECT id('acct'), '1390', 'Construction in Progress', 'Asset', 'Fixed Asset', 'Balance Sheet', 'Current', g.id, false, true, false, g."companyGroupId", 'system'
FROM "account" g
WHERE g."isGroup" = TRUE AND g.name = 'Property, Plant & Equipment'
  AND NOT EXISTS (SELECT 1 FROM "account" a WHERE a."companyGroupId" = g."companyGroupId" AND a.number = '1390');

DO $fleetguard$
DECLARE
  n TEXT;
BEGIN
  FOREACH n IN ARRAY ARRAY['1370', '1380', '1390'] LOOP
    IF EXISTS (
      SELECT 1 FROM "account" a
      GROUP BY a."companyGroupId"
      HAVING COALESCE(bool_or(a.number = n), false) = false
    ) THEN
      RAISE EXCEPTION 'fleet-bridge: a company group is missing account % (PP&E group not found)', n;
    END IF;
  END LOOP;
END $fleetguard$;

-- 6) Two classes per company ---------------------------------------------------------
INSERT INTO "fixedAssetClass" (
  "name", "depreciationMethod", "usefulLifeMonths", "residualValuePercent", "isConstructionInProgress",
  "assetAccountId", "accumulatedDepreciationAccountId", "depreciationExpenseAccountId",
  "writeOffAccountId", "writeDownAccountId", "gainOnDisposalAccountId", "lossOnDisposalAccountId",
  "companyId", "createdBy"
)
SELECT
  cls.name, 'Straight Line'::"depreciationMethod", cls.useful_life_months, cls.residual_percent, cls.is_cip,
  a_asset.id, a_accum.id, a6310.id, a6320.id, a6320.id, a4140.id, a6320.id, c.id, 'system'
FROM "company" c
CROSS JOIN (
  VALUES
    ('Rental Fleet', 60, 20, false, '1370', '1380'),
    ('Construction in Progress', 120, 0, true, '1390', '1330')
) AS cls(name, useful_life_months, residual_percent, is_cip, asset_number, accum_number)
JOIN "account" a_asset ON a_asset."companyGroupId" = c."companyGroupId" AND a_asset.number = cls.asset_number
JOIN "account" a_accum ON a_accum."companyGroupId" = c."companyGroupId" AND a_accum.number = cls.accum_number
JOIN "account" a6310 ON a6310."companyGroupId" = c."companyGroupId" AND a6310.number = '6310'
JOIN "account" a6320 ON a6320."companyGroupId" = c."companyGroupId" AND a6320.number = '6320'
JOIN "account" a4140 ON a4140."companyGroupId" = c."companyGroupId" AND a4140.number = '4140'
WHERE c."isEliminationEntity" IS NOT TRUE
  AND EXISTS (SELECT 1 FROM "user" u WHERE u.id = 'system')
ON CONFLICT ("name", "companyId") DO NOTHING;

-- 7) "jobs" selects j.* before aliased columns: DROP + CREATE (never CREATE OR REPLACE).
--    Body copied verbatim from 20260811123619_widen-sales-production-scale.sql.
DROP VIEW IF EXISTS "jobs";
CREATE VIEW "jobs" WITH(SECURITY_INVOKER=true) AS
WITH job_model AS (
  SELECT
    j.id AS job_id,
    j."companyId",
    COALESCE(j."modelUploadId", i."modelUploadId") AS model_upload_id
  FROM "job" j
  INNER JOIN "item" i ON j."itemId" = i."id" AND j."companyId" = i."companyId"
)
SELECT
  j.*,
  jmm."id" as "jobMakeMethodId",
  i.name,
  i."readableIdWithRevision" as "itemReadableIdWithRevision",
  i.type as "itemType",
  i.name as "description",
  i."itemTrackingType",
  i.active,
  i."replenishmentSystem",
  mu.id as "modelId",
  mu."autodeskUrn",
  mu."modelPath",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END as "thumbnailPath",
  mu."name" as "modelName",
  mu."size" as "modelSize",
  so."salesOrderId" as "salesOrderReadableId",
  qo."quoteId" as "quoteReadableId"
FROM "job" j
LEFT JOIN "jobMakeMethod" jmm ON jmm."jobId" = j.id AND jmm."parentMaterialId" IS NULL
INNER JOIN "item" i ON j."itemId" = i."id" AND j."companyId" = i."companyId"
LEFT JOIN job_model jm ON j.id = jm.job_id AND j."companyId" = jm."companyId"
LEFT JOIN "modelUpload" mu ON mu.id = jm.model_upload_id
LEFT JOIN "salesOrder" so on j."salesOrderId" = so.id AND j."companyId" = so."companyId"
LEFT JOIN "quote" qo ON j."quoteId" = qo.id AND j."companyId" = qo."companyId";

-- 8) fleetAssets: fleet status is DERIVED, never stored. Phase C recreates this view
--    with the rental-agreement join (On Rent / Reserved).
DROP VIEW IF EXISTS "fleetAssets";
CREATE VIEW "fleetAssets" WITH(SECURITY_INVOKER=true) AS
SELECT
  fa.*,
  i."readableIdWithRevision" AS "itemReadableId",
  i.name AS "itemName",
  i."thumbnailPath",
  te."readableId" AS "trackedEntityReadableId",
  fac.name AS "className",
  fac."isConstructionInProgress",
  wc.name AS "workCenterName",
  (COALESCE(fa."acquisitionCost", 0) - COALESCE(fa."accumulatedDepreciation", 0)) AS "netBookValue",
  CASE
    WHEN fa.status = 'Disposed' AND fa."disposalMethod" = 'Transfer to Inventory' THEN 'Returned to Stock'
    WHEN fa.status = 'Disposed' THEN 'Sold'
    WHEN fa.status = 'Under Construction' THEN 'Under Construction'
    WHEN fa."outOfServiceSince" IS NOT NULL THEN 'In Maintenance'
    ELSE 'Available'
  END AS "fleetStatus"
FROM "fixedAsset" fa
INNER JOIN "item" i ON i.id = fa."itemId"
INNER JOIN "fixedAssetClass" fac ON fac.id = fa."fixedAssetClassId"
LEFT JOIN "trackedEntity" te ON te.id = fa."trackedEntityId"
LEFT JOIN "workCenter" wc ON wc.id = fa."workCenterId"
WHERE fa."itemId" IS NOT NULL;

NOTIFY pgrst, 'reload schema';
