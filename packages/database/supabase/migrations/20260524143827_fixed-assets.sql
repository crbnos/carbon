-- Fixed Assets Module
-- Adds fixed asset tracking with book and tax depreciation,
-- purchase/sales order integration, and receipt/shipment lines.
-- NOTE: enum ADD VALUE statements are in 20260524143826_fixed-asset-enums.sql

-- New enums (CREATE TYPE is fine within a transaction)
CREATE TYPE "fixedAssetStatus" AS ENUM (
  'Draft',
  'Active',
  'Fully Depreciated',
  'Disposed'
);

CREATE TYPE "depreciationMethod" AS ENUM (
  'Straight Line',
  'Declining Balance',
  'Units of Production'
);

CREATE TYPE "disposalMethod" AS ENUM (
  'Sale',
  'Scrapping'
);

CREATE TYPE "taxDepreciationMethod" AS ENUM (
  'Straight Line',
  'Declining Balance',
  'MACRS'
);

CREATE TYPE "macrsPropertyClass" AS ENUM (
  '3',
  '5',
  '7',
  '10',
  '15',
  '20',
  '27.5',
  '39'
);

CREATE TYPE "macrsConvention" AS ENUM (
  'Half-Year',
  'Mid-Quarter'
);

-- Company settings: tax depreciation toggle and rate
ALTER TABLE "companySettings"
  ADD COLUMN "assetTaxDepreciationEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "assetTaxRate" NUMERIC(5,2) NULL;

-- Account defaults: deferred tax accounts
ALTER TABLE "accountDefault"
  ADD COLUMN "deferredTaxLiabilityAccountId" TEXT NULL REFERENCES "account"("id"),
  ADD COLUMN "deferredTaxExpenseAccountId" TEXT NULL REFERENCES "account"("id");

-- Seed Deferred Tax Expense account and set defaults
DO $$
DECLARE
  cg RECORD;
  parent_id TEXT;
  dtl_id TEXT;
  dte_id TEXT;
BEGIN
  FOR cg IN SELECT id FROM "companyGroup" LOOP
    SELECT a.id INTO parent_id
    FROM "account" a
    WHERE a."companyGroupId" = cg.id
      AND a.number = '7000'
      AND a."isGroup" = true
    LIMIT 1;

    INSERT INTO "account" (
      number, name, "isGroup", "accountType", "incomeBalance",
      class, "parentId", "companyGroupId", "createdBy"
    ) VALUES (
      '7090', 'Deferred Tax Expense', false, 'Other Expense', 'Income Statement',
      'Expense', parent_id, cg.id, 'system'
    ) RETURNING id INTO dte_id;

    SELECT a.id INTO dtl_id
    FROM "account" a
    WHERE a."companyGroupId" = cg.id
      AND a.number = '2420'
      AND a."isGroup" = false
    LIMIT 1;

    UPDATE "accountDefault" ad
    SET "deferredTaxLiabilityAccountId" = dtl_id,
        "deferredTaxExpenseAccountId" = dte_id
    FROM "company" c
    WHERE c.id = ad."companyId"
      AND c."companyGroupId" = cg.id;
  END LOOP;
END $$;

-- Asset Class table
CREATE TABLE "fixedAssetClass" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL,
  "description" TEXT,
  "depreciationMethod" "depreciationMethod" NOT NULL DEFAULT 'Straight Line',
  "usefulLifeMonths" INTEGER NOT NULL DEFAULT 60,
  "residualValuePercent" NUMERIC NOT NULL DEFAULT 0,
  "assetAccountId" TEXT NOT NULL,
  "accumulatedDepreciationAccountId" TEXT NOT NULL,
  "depreciationExpenseAccountId" TEXT NOT NULL,
  "writeOffAccountId" TEXT NOT NULL,
  "writeDownAccountId" TEXT NOT NULL,
  "disposalAccountId" TEXT NOT NULL,
  "taxDepreciationMethod" "taxDepreciationMethod" NULL,
  "taxUsefulLifeMonths" INTEGER NULL,
  "taxResidualValuePercent" NUMERIC(5,2) NULL,
  "macrsPropertyClass" "macrsPropertyClass" NULL,
  "macrsConvention" "macrsConvention" NULL DEFAULT 'Half-Year',
  "bonusDepreciationPercent" NUMERIC(5,2) NULL DEFAULT 0,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,
  "customFields" JSONB,

  CONSTRAINT "fixedAssetClass_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fixedAssetClass_name_companyId_key" UNIQUE ("name", "companyId"),
  CONSTRAINT "fixedAssetClass_assetAccountId_fkey" FOREIGN KEY ("assetAccountId") REFERENCES "account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fixedAssetClass_accumulatedDepreciationAccountId_fkey" FOREIGN KEY ("accumulatedDepreciationAccountId") REFERENCES "account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fixedAssetClass_depreciationExpenseAccountId_fkey" FOREIGN KEY ("depreciationExpenseAccountId") REFERENCES "account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fixedAssetClass_writeOffAccountId_fkey" FOREIGN KEY ("writeOffAccountId") REFERENCES "account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fixedAssetClass_writeDownAccountId_fkey" FOREIGN KEY ("writeDownAccountId") REFERENCES "account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fixedAssetClass_disposalAccountId_fkey" FOREIGN KEY ("disposalAccountId") REFERENCES "account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fixedAssetClass_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fixedAssetClass_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT,
  CONSTRAINT "fixedAssetClass_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT
);

CREATE INDEX "fixedAssetClass_companyId_idx" ON "fixedAssetClass" ("companyId");

ALTER TABLE "fixedAssetClass" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."fixedAssetClass"
  FOR SELECT USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_view'))::text[]
    )
  );

CREATE POLICY "INSERT" ON "public"."fixedAssetClass"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_create'))::text[]
    )
  );

CREATE POLICY "UPDATE" ON "public"."fixedAssetClass"
  FOR UPDATE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_update'))::text[]
    )
  );

CREATE POLICY "DELETE" ON "public"."fixedAssetClass"
  FOR DELETE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_delete'))::text[]
    )
  );

-- Fixed Asset table
CREATE TABLE "fixedAsset" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "fixedAssetId" TEXT NOT NULL,
  "fixedAssetClassId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "serialNumber" TEXT,
  "status" "fixedAssetStatus" NOT NULL DEFAULT 'Draft',
  "depreciationMethod" "depreciationMethod" NOT NULL DEFAULT 'Straight Line',
  "usefulLifeMonths" INTEGER NOT NULL DEFAULT 60,
  "residualValuePercent" NUMERIC NOT NULL DEFAULT 0,
  "taxDepreciationMethod" "taxDepreciationMethod",
  "taxUsefulLifeMonths" INTEGER,
  "taxResidualValuePercent" NUMERIC(5,2),
  "macrsPropertyClass" "macrsPropertyClass",
  "macrsConvention" "macrsConvention" DEFAULT 'Half-Year',
  "bonusDepreciationPercent" NUMERIC(5,2) DEFAULT 0,
  "acquisitionCost" NUMERIC NOT NULL DEFAULT 0,
  "acquisitionDate" DATE,
  "depreciationStartDate" DATE,
  "accumulatedDepreciation" NUMERIC NOT NULL DEFAULT 0,
  "accumulatedTaxDepreciation" NUMERIC NOT NULL DEFAULT 0,
  "assetLifetimeUsage" NUMERIC,
  "locationId" TEXT,
  "disposalDate" DATE,
  "disposalMethod" "disposalMethod",
  "saleProceeds" NUMERIC,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,
  "notes" JSONB,
  "customFields" JSONB,

  CONSTRAINT "fixedAsset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fixedAsset_fixedAssetId_companyId_key" UNIQUE ("fixedAssetId", "companyId"),
  CONSTRAINT "fixedAsset_fixedAssetClassId_fkey" FOREIGN KEY ("fixedAssetClassId") REFERENCES "fixedAssetClass" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fixedAsset_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "fixedAsset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fixedAsset_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT,
  CONSTRAINT "fixedAsset_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT
);

CREATE INDEX "fixedAsset_companyId_idx" ON "fixedAsset" ("companyId");
CREATE INDEX "fixedAsset_fixedAssetClassId_idx" ON "fixedAsset" ("fixedAssetClassId");
CREATE INDEX "fixedAsset_status_idx" ON "fixedAsset" ("companyId", "status");

ALTER TABLE "fixedAsset" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."fixedAsset"
  FOR SELECT USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_view'))::text[]
    )
  );

CREATE POLICY "INSERT" ON "public"."fixedAsset"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_create'))::text[]
    )
  );

CREATE POLICY "UPDATE" ON "public"."fixedAsset"
  FOR UPDATE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_update'))::text[]
    )
  );

CREATE POLICY "DELETE" ON "public"."fixedAsset"
  FOR DELETE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_delete'))::text[]
    )
  );

-- FK from order/invoice lines to fixedAsset
ALTER TABLE "purchaseOrderLine" ADD CONSTRAINT "purchaseOrderLine_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "fixedAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "salesOrderLine" ADD CONSTRAINT "salesOrderLine_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "fixedAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "salesInvoiceLine" ADD CONSTRAINT "salesInvoiceLine_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "fixedAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Depreciation Run table
CREATE TABLE "depreciationRun" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "depreciationRunId" TEXT NOT NULL,
  "periodEnd" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Draft',
  "postedAt" TIMESTAMP WITH TIME ZONE,
  "postedBy" TEXT,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,

  CONSTRAINT "depreciationRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "depreciationRun_depreciationRunId_companyId_key" UNIQUE ("depreciationRunId", "companyId"),
  CONSTRAINT "depreciationRun_postedBy_fkey" FOREIGN KEY ("postedBy") REFERENCES "user" ("id") ON DELETE RESTRICT,
  CONSTRAINT "depreciationRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "depreciationRun_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT,
  CONSTRAINT "depreciationRun_status_check" CHECK ("status" IN ('Draft', 'Posted'))
);

CREATE INDEX "depreciationRun_companyId_idx" ON "depreciationRun" ("companyId");

ALTER TABLE "depreciationRun" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."depreciationRun"
  FOR SELECT USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_view'))::text[]
    )
  );

CREATE POLICY "INSERT" ON "public"."depreciationRun"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_create'))::text[]
    )
  );

CREATE POLICY "UPDATE" ON "public"."depreciationRun"
  FOR UPDATE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_update'))::text[]
    )
  );

CREATE POLICY "DELETE" ON "public"."depreciationRun"
  FOR DELETE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_delete'))::text[]
    )
  );

-- Depreciation Run Line table
CREATE TABLE "depreciationRunLine" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "depreciationRunId" TEXT NOT NULL,
  "fixedAssetId" TEXT NOT NULL,
  "amount" NUMERIC NOT NULL,
  "taxAmount" NUMERIC NULL,
  "journalId" TEXT,
  "companyId" TEXT NOT NULL,

  CONSTRAINT "depreciationRunLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "depreciationRunLine_depreciationRunId_fkey" FOREIGN KEY ("depreciationRunId") REFERENCES "depreciationRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "depreciationRunLine_fixedAssetId_fkey" FOREIGN KEY ("fixedAssetId") REFERENCES "fixedAsset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "depreciationRunLine_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "journal" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "depreciationRunLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "depreciationRunLine_depreciationRunId_idx" ON "depreciationRunLine" ("depreciationRunId");
CREATE INDEX "depreciationRunLine_fixedAssetId_idx" ON "depreciationRunLine" ("fixedAssetId");

ALTER TABLE "depreciationRunLine" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."depreciationRunLine"
  FOR SELECT USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_view'))::text[]
    )
  );

CREATE POLICY "INSERT" ON "public"."depreciationRunLine"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_create'))::text[]
    )
  );

CREATE POLICY "UPDATE" ON "public"."depreciationRunLine"
  FOR UPDATE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_update'))::text[]
    )
  );

CREATE POLICY "DELETE" ON "public"."depreciationRunLine"
  FOR DELETE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_delete'))::text[]
    )
  );

-- Fixed Asset Disposal table
CREATE TABLE "fixedAssetDisposal" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "fixedAssetId" TEXT NOT NULL,
  "disposalMethod" "disposalMethod" NOT NULL,
  "disposalDate" DATE NOT NULL,
  "saleProceeds" NUMERIC NOT NULL DEFAULT 0,
  "netBookValueAtDisposal" NUMERIC NOT NULL,
  "gainLoss" NUMERIC NOT NULL,
  "journalId" TEXT,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,

  CONSTRAINT "fixedAssetDisposal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fixedAssetDisposal_fixedAssetId_fkey" FOREIGN KEY ("fixedAssetId") REFERENCES "fixedAsset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fixedAssetDisposal_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "journal" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "fixedAssetDisposal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fixedAssetDisposal_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT
);

CREATE INDEX "fixedAssetDisposal_fixedAssetId_idx" ON "fixedAssetDisposal" ("fixedAssetId");

ALTER TABLE "fixedAssetDisposal" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."fixedAssetDisposal"
  FOR SELECT USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_view'))::text[]
    )
  );

CREATE POLICY "INSERT" ON "public"."fixedAssetDisposal"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_create'))::text[]
    )
  );

-- Fixed Asset Usage Log table (for Units of Production)
CREATE TABLE "fixedAssetUsageLog" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "fixedAssetId" TEXT NOT NULL,
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "unitsProduced" NUMERIC NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,

  CONSTRAINT "fixedAssetUsageLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fixedAssetUsageLog_fixedAssetId_periodEnd_key" UNIQUE ("fixedAssetId", "periodEnd"),
  CONSTRAINT "fixedAssetUsageLog_fixedAssetId_fkey" FOREIGN KEY ("fixedAssetId") REFERENCES "fixedAsset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fixedAssetUsageLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fixedAssetUsageLog_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT
);

CREATE INDEX "fixedAssetUsageLog_fixedAssetId_idx" ON "fixedAssetUsageLog" ("fixedAssetId");

ALTER TABLE "fixedAssetUsageLog" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."fixedAssetUsageLog"
  FOR SELECT USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_view'))::text[]
    )
  );

CREATE POLICY "INSERT" ON "public"."fixedAssetUsageLog"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_create'))::text[]
    )
  );

CREATE POLICY "UPDATE" ON "public"."fixedAssetUsageLog"
  FOR UPDATE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_update'))::text[]
    )
  );

CREATE POLICY "DELETE" ON "public"."fixedAssetUsageLog"
  FOR DELETE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_delete'))::text[]
    )
  );

-- Receipt/Shipment lines for fixed assets
CREATE TABLE "receiptFixedAssetLine" (
  "id" TEXT NOT NULL DEFAULT id(),
  "receiptId" TEXT NOT NULL,
  "purchaseOrderLineId" TEXT NOT NULL,
  "received" BOOLEAN NOT NULL DEFAULT true,
  "serialNumber" TEXT,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,
  CONSTRAINT "receiptFixedAssetLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "receiptFixedAssetLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "receiptFixedAssetLine_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "purchaseOrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "receiptFixedAssetLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "receiptFixedAssetLine_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "receiptFixedAssetLine_receiptId_idx" ON "receiptFixedAssetLine" ("receiptId");

ALTER TABLE "receiptFixedAssetLine" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."receiptFixedAssetLine"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."receiptFixedAssetLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."receiptFixedAssetLine"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."receiptFixedAssetLine"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_delete'))::text[]
  )
);

CREATE TABLE "shipmentFixedAssetLine" (
  "id" TEXT NOT NULL DEFAULT id(),
  "shipmentId" TEXT NOT NULL,
  "salesOrderLineId" TEXT NOT NULL,
  "shipped" BOOLEAN NOT NULL DEFAULT true,
  "serialNumber" TEXT,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,
  CONSTRAINT "shipmentFixedAssetLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shipmentFixedAssetLine_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "shipmentFixedAssetLine_salesOrderLineId_fkey" FOREIGN KEY ("salesOrderLineId") REFERENCES "salesOrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "shipmentFixedAssetLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "shipmentFixedAssetLine_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "shipmentFixedAssetLine_shipmentId_idx" ON "shipmentFixedAssetLine" ("shipmentId");

ALTER TABLE "shipmentFixedAssetLine" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."shipmentFixedAssetLine"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."shipmentFixedAssetLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."shipmentFixedAssetLine"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."shipmentFixedAssetLine"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_delete'))::text[]
  )
);

-- Audit event trigger
SELECT attach_event_trigger('fixedAsset', ARRAY[]::TEXT[], ARRAY[]::TEXT[]);

-- Sequences
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'fixedAsset', 'Fixed Asset', 'FA', NULL, 1, 6, 1, "id" FROM "company"
ON CONFLICT DO NOTHING;

INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'depreciationRun', 'Depreciation Run', 'DR', NULL, 1, 6, 1, "id" FROM "company"
ON CONFLICT DO NOTHING;

-- Dimension unique constraint: only enforce among active dimensions
ALTER TABLE "dimension" DROP CONSTRAINT IF EXISTS "dimension_name_companyGroupId_key";

CREATE UNIQUE INDEX "dimension_name_companyGroupId_active_idx"
  ON "dimension"("name", "companyGroupId")
  WHERE "active" = true;

-- Work Center: add departmentId
ALTER TABLE "workCenter"
  ADD COLUMN "departmentId" TEXT,
  ADD CONSTRAINT "workCenter_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "department" ("id") ON DELETE SET NULL;

-- Backfill dimensions
INSERT INTO "dimension" ("name", "entityType", "companyGroupId", "createdBy")
SELECT 'Work Center', 'WorkCenter'::"dimensionEntityType", cg."id", 'system'
FROM "companyGroup" cg
ON CONFLICT ("name", "companyGroupId") WHERE "active" = true DO NOTHING;

INSERT INTO "dimension" ("name", "entityType", "companyGroupId", "createdBy")
SELECT 'Process', 'Process'::"dimensionEntityType", cg."id", 'system'
FROM "companyGroup" cg
ON CONFLICT ("name", "companyGroupId") WHERE "active" = true DO NOTHING;

-- Recreate views with fixed asset joins

DROP VIEW IF EXISTS "purchaseOrderLines";
CREATE OR REPLACE VIEW "purchaseOrderLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT DISTINCT ON (pl.id)
    pl.*,
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
    sp."supplierPartId",
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
  LEFT JOIN "supplierPart" sp ON sp."supplierId" = so."supplierId" AND sp."itemId" = i.id
  LEFT JOIN "jobOperation" jo ON jo."id" = pl."jobOperationId"
  LEFT JOIN "account" a ON a.id = pl."accountId"
  LEFT JOIN "fixedAsset" fa ON fa.id = pl."assetId"
);

DROP VIEW IF EXISTS "purchaseInvoiceLines";
CREATE OR REPLACE VIEW "purchaseInvoiceLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    pl.*,
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    i."readableIdWithRevision" as "itemReadableId",
    i.name as "itemName",
    i.description as "itemDescription",
    ic."unitCost" as "unitCost",
    sp."supplierPartId",
    a."name" as "accountName",
    fa."fixedAssetId" as "assetReadableId",
    fa."name" as "assetName"
  FROM "purchaseInvoiceLine" pl
  INNER JOIN "purchaseInvoice" pi ON pi.id = pl."invoiceId"
  LEFT JOIN "modelUpload" mu ON pl."modelUploadId" = mu."id"
  LEFT JOIN "item" i ON i.id = pl."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "supplierPart" sp ON sp."supplierId" = pi."supplierId" AND sp."itemId" = i.id
  LEFT JOIN "account" a ON a.id = pl."accountId"
  LEFT JOIN "fixedAsset" fa ON fa.id = pl."assetId"
);

DROP VIEW IF EXISTS "salesOrderLines";
CREATE OR REPLACE VIEW "salesOrderLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    sl.*,
    i."readableIdWithRevision" as "itemReadableId",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    COALESCE(mu.id, imu.id) as "modelId",
    COALESCE(mu."autodeskUrn", imu."autodeskUrn") as "autodeskUrn",
    COALESCE(mu."modelPath", imu."modelPath") as "modelPath",
    COALESCE(mu."name", imu."name") as "modelName",
    COALESCE(mu."size", imu."size") as "modelSize",
    ic."unitCost" as "unitCost",
    cp."customerPartId",
    cp."customerPartRevision",
    so."orderDate",
    so."customerId",
    so."salesOrderId" as "salesOrderReadableId",
    fa."fixedAssetId" as "assetReadableId",
    fa."name" as "assetName"
  FROM "salesOrderLine" sl
  INNER JOIN "salesOrder" so ON so.id = sl."salesOrderId"
  LEFT JOIN "modelUpload" mu ON sl."modelUploadId" = mu."id"
  LEFT JOIN "item" i ON i.id = sl."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "customerPartToItem" cp ON cp."customerId" = so."customerId" AND cp."itemId" = i.id
  LEFT JOIN "fixedAsset" fa ON fa.id = sl."assetId"
);

DROP VIEW IF EXISTS "salesInvoiceLines";
CREATE OR REPLACE VIEW "salesInvoiceLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    sl.*,
    i."readableIdWithRevision" as "itemReadableId",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    i.name as "itemName",
    i.description as "itemDescription",
    ic."unitCost" as "unitCost",
    (SELECT cp."customerPartId"
     FROM "customerPartToItem" cp
     WHERE cp."customerId" = si."customerId" AND cp."itemId" = i.id
     LIMIT 1) as "customerPartId",
    fa."fixedAssetId" as "assetReadableId",
    fa."name" as "assetName"
  FROM "salesInvoiceLine" sl
  INNER JOIN "salesInvoice" si ON si.id = sl."invoiceId"
  LEFT JOIN "modelUpload" mu ON sl."modelUploadId" = mu."id"
  LEFT JOIN "item" i ON i.id = sl."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "fixedAsset" fa ON fa.id = sl."assetId"
);

-- Recreate workCenters view with departmentName
DROP VIEW IF EXISTS "workCenters";
CREATE OR REPLACE VIEW "workCenters" WITH(SECURITY_INVOKER=true) AS
  SELECT
     wc.*,
     l.name as "locationName",
     d.name as "departmentName",
     wcp.processes
  FROM "workCenter" wc
  LEFT JOIN "location" l
    ON wc."locationId" = l.id
  LEFT JOIN "department" d
    ON wc."departmentId" = d.id
  LEFT JOIN (
    SELECT
      "workCenterId",
      array_agg("processId"::text) as processes
    FROM "workCenterProcess" wcp
    INNER JOIN "process" p ON wcp."processId" = p.id
    GROUP BY "workCenterId"
  ) wcp ON wc.id = wcp."workCenterId";

DROP VIEW IF EXISTS "workCentersWithBlockingStatus";
CREATE OR REPLACE VIEW "workCentersWithBlockingStatus" WITH (security_invoker = true) AS
SELECT
  wc.*,
  l.name AS "locationName",
  COALESCE(
    (SELECT COUNT(*) > 0
     FROM "maintenanceDispatch" md
     WHERE md."workCenterId" = wc.id
       AND md.status = 'In Progress'
       AND md."oeeImpact" IN ('Down', 'Planned')
    ), false
  ) AS "isBlocked",
  (
    SELECT md.id
    FROM "maintenanceDispatch" md
    WHERE md."workCenterId" = wc.id
      AND md.status = 'In Progress'
      AND md."oeeImpact" IN ('Down', 'Planned')
    ORDER BY md."createdAt" DESC
    LIMIT 1
  ) AS "blockingDispatchId",
  (
    SELECT md."maintenanceDispatchId"
    FROM "maintenanceDispatch" md
    WHERE md."workCenterId" = wc.id
      AND md.status = 'In Progress'
      AND md."oeeImpact" IN ('Down', 'Planned')
    ORDER BY md."createdAt" DESC
    LIMIT 1
  ) AS "blockingDispatchReadableId"
FROM "workCenter" wc
LEFT JOIN "location" l ON wc."locationId" = l.id;
