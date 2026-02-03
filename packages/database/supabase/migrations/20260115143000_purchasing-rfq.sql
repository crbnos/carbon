-- Purchasing RFQ Status Enum
CREATE TYPE "purchasingRfqStatus" AS ENUM (
  'Draft',
  'Ready for request',
  'Requested',
  'Closed'
);

-- Add Purchasing Request for Quote to documentSourceType enum
ALTER TYPE "documentSourceType" ADD VALUE IF NOT EXISTS 'Purchasing Request for Quote';

-- Custom Field Table Entries
INSERT INTO "customFieldTable" ("table", "name", "module")
VALUES ('purchasingRfq', 'Purchasing RFQ', 'Purchasing')
ON CONFLICT DO NOTHING;

INSERT INTO "customFieldTable" ("table", "name", "module")
VALUES ('purchasingRfqLine', 'Purchasing RFQ Line', 'Purchasing')
ON CONFLICT DO NOTHING;

-- Sequence for existing companies (new companies get this from seed-company)
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT
  'purchasingRfq',
  'Purchasing RFQ',
  'PRFQ',
  NULL,
  0,
  6,
  1,
  "id"
FROM "company"
ON CONFLICT DO NOTHING;

-- Main Purchasing RFQ Table
CREATE TABLE "purchasingRfq" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "rfqId" TEXT NOT NULL,
  "revisionId" INTEGER NOT NULL DEFAULT 0,
  "status" "purchasingRfqStatus" NOT NULL DEFAULT 'Draft',
  "employeeId" TEXT,
  "rfqDate" DATE NOT NULL,
  "expirationDate" DATE,
  "internalNotes" TEXT,
  "notes" JSON DEFAULT '{}',
  "locationId" TEXT,
  "assignee" TEXT,
  "companyId" TEXT NOT NULL,
  "customFields" JSONB,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT now(),
  "createdBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT now(),
  "updatedBy" TEXT,

  CONSTRAINT "purchasingRfq_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchasingRfq_rfqId_companyId_key" UNIQUE ("rfqId", "companyId"),
  CONSTRAINT "purchasingRfq_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "user" ("id") ON DELETE SET NULL,
  CONSTRAINT "purchasingRfq_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location" ("id") ON DELETE SET NULL,
  CONSTRAINT "purchasingRfq_assigneeId_fkey" FOREIGN KEY ("assignee") REFERENCES "user" ("id") ON DELETE SET NULL,
  CONSTRAINT "purchasingRfq_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE,
  CONSTRAINT "purchasingRfq_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE SET NULL,
  CONSTRAINT "purchasingRfq_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE SET NULL
);

CREATE INDEX "purchasingRfq_companyId_idx" ON "purchasingRfq" ("companyId");
CREATE INDEX "purchasingRfq_rfqId_idx" ON "purchasingRfq" ("rfqId");
CREATE INDEX "purchasingRfq_status_idx" ON "purchasingRfq" ("status", "companyId");

ALTER TABLE "purchasingRfq" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with purchasing_view can view purchasingRfq"
  ON "purchasingRfq" FOR SELECT USING (
    has_company_permission('purchasing_view', "companyId") AND
    has_role('employee', "companyId")
  );

CREATE POLICY "Employees with purchasing_create can insert purchasingRfq"
  ON "purchasingRfq" FOR INSERT WITH CHECK (
    has_company_permission('purchasing_create', "companyId") AND
    has_role('employee', "companyId")
  );

CREATE POLICY "Employees with purchasing_update can update purchasingRfq"
  ON "purchasingRfq" FOR UPDATE USING (
    has_company_permission('purchasing_update', "companyId") AND
    has_role('employee', "companyId")
  );

CREATE POLICY "Employees with purchasing_delete can delete purchasingRfq"
  ON "purchasingRfq" FOR DELETE USING (
    has_company_permission('purchasing_delete', "companyId") AND
    has_role('employee', "companyId")
  );

-- Purchasing RFQ Supplier Join Table
CREATE TABLE "purchasingRfqSupplier" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "purchasingRfqId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT now(),
  "createdBy" TEXT,

  CONSTRAINT "purchasingRfqSupplier_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchasingRfqSupplier_unique" UNIQUE ("purchasingRfqId", "supplierId"),
  CONSTRAINT "purchasingRfqSupplier_purchasingRfqId_fkey" FOREIGN KEY ("purchasingRfqId") REFERENCES "purchasingRfq" ("id") ON DELETE CASCADE,
  CONSTRAINT "purchasingRfqSupplier_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier" ("id") ON DELETE CASCADE,
  CONSTRAINT "purchasingRfqSupplier_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE,
  CONSTRAINT "purchasingRfqSupplier_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE SET NULL
);

CREATE INDEX "purchasingRfqSupplier_purchasingRfqId_idx" ON "purchasingRfqSupplier" ("purchasingRfqId");
CREATE INDEX "purchasingRfqSupplier_supplierId_idx" ON "purchasingRfqSupplier" ("supplierId");

ALTER TABLE "purchasingRfqSupplier" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with purchasing_view can view purchasingRfqSupplier"
  ON "purchasingRfqSupplier" FOR SELECT USING (
    has_company_permission('purchasing_view', "companyId") AND
    has_role('employee', "companyId")
  );

CREATE POLICY "Employees with purchasing_create can insert purchasingRfqSupplier"
  ON "purchasingRfqSupplier" FOR INSERT WITH CHECK (
    has_company_permission('purchasing_create', "companyId") AND
    has_role('employee', "companyId")
  );

CREATE POLICY "Employees with purchasing_update can update purchasingRfqSupplier"
  ON "purchasingRfqSupplier" FOR UPDATE USING (
    has_company_permission('purchasing_update', "companyId") AND
    has_role('employee', "companyId")
  );

CREATE POLICY "Employees with purchasing_delete can delete purchasingRfqSupplier"
  ON "purchasingRfqSupplier" FOR DELETE USING (
    has_company_permission('purchasing_delete', "companyId") AND
    has_role('employee', "companyId")
  );

-- Purchasing RFQ Line Table
CREATE TABLE "purchasingRfqLine" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "purchasingRfqId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "description" TEXT,
  "quantity" NUMERIC(20, 2)[] DEFAULT ARRAY[1]::NUMERIC(20, 2)[],
  "purchaseUnitOfMeasureCode" TEXT NOT NULL,
  "inventoryUnitOfMeasureCode" TEXT NOT NULL,
  "conversionFactor" NUMERIC(20, 10) DEFAULT 1,
  "order" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "internalNotes" JSON DEFAULT '{}',
  "externalNotes" JSON DEFAULT '{}',
  "companyId" TEXT NOT NULL,
  "customFields" JSONB DEFAULT '{}',
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT now(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "purchasingRfqLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchasingRfqLine_purchasingRfqId_fkey" FOREIGN KEY ("purchasingRfqId") REFERENCES "purchasingRfq" ("id") ON DELETE CASCADE,
  CONSTRAINT "purchasingRfqLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item" ("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "purchasingRfqLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE,
  CONSTRAINT "purchasingRfqLine_purchaseUnitOfMeasureCode_fkey" FOREIGN KEY ("purchaseUnitOfMeasureCode", "companyId") REFERENCES "unitOfMeasure" ("code", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "purchasingRfqLine_inventoryUnitOfMeasureCode_fkey" FOREIGN KEY ("inventoryUnitOfMeasureCode", "companyId") REFERENCES "unitOfMeasure" ("code", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "purchasingRfqLine_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT,
  CONSTRAINT "purchasingRfqLine_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE SET NULL,
  CONSTRAINT "purchasingRfqLine_quantity_check" CHECK (array_length("quantity", 1) > 0)
);

CREATE INDEX "purchasingRfqLine_purchasingRfqId_idx" ON "purchasingRfqLine" ("purchasingRfqId");

ALTER TABLE "purchasingRfqLine" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with purchasing_view can view purchasingRfqLine"
  ON "purchasingRfqLine" FOR SELECT USING (
    has_company_permission('purchasing_view', "companyId") AND
    has_role('employee', "companyId")
  );

CREATE POLICY "Employees with purchasing_create can insert purchasingRfqLine"
  ON "purchasingRfqLine" FOR INSERT WITH CHECK (
    has_company_permission('purchasing_create', "companyId") AND
    has_role('employee', "companyId")
  );

CREATE POLICY "Employees with purchasing_update can update purchasingRfqLine"
  ON "purchasingRfqLine" FOR UPDATE USING (
    has_company_permission('purchasing_update', "companyId") AND
    has_role('employee', "companyId")
  );

CREATE POLICY "Employees with purchasing_delete can delete purchasingRfqLine"
  ON "purchasingRfqLine" FOR DELETE USING (
    has_company_permission('purchasing_delete', "companyId") AND
    has_role('employee', "companyId")
  );

-- Relationship Tables
CREATE TABLE "purchasingRfqToSupplierQuote" (
  "purchasingRfqId" TEXT NOT NULL,
  "supplierQuoteId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,

  PRIMARY KEY ("purchasingRfqId", "supplierQuoteId"),
  FOREIGN KEY ("purchasingRfqId") REFERENCES "purchasingRfq" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("supplierQuoteId") REFERENCES "supplierQuote" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE
);

CREATE INDEX "purchasingRfqToSupplierQuote_companyId_idx" ON "purchasingRfqToSupplierQuote" ("companyId");

ALTER TABLE "purchasingRfqToSupplierQuote" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with purchasing_view can view purchasingRfqToSupplierQuote"
  ON "purchasingRfqToSupplierQuote" FOR SELECT USING (
    has_company_permission('purchasing_view', "companyId") AND
    has_role('employee', "companyId")
  );

CREATE POLICY "Employees with purchasing_create can insert purchasingRfqToSupplierQuote"
  ON "purchasingRfqToSupplierQuote" FOR INSERT WITH CHECK (
    has_company_permission('purchasing_create', "companyId") AND
    has_role('employee', "companyId")
  );

CREATE TABLE "purchasingRfqToPurchaseOrder" (
  "purchasingRfqId" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,

  PRIMARY KEY ("purchasingRfqId", "purchaseOrderId"),
  FOREIGN KEY ("purchasingRfqId") REFERENCES "purchasingRfq" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("purchaseOrderId") REFERENCES "purchaseOrder" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE
);

CREATE INDEX "purchasingRfqToPurchaseOrder_companyId_idx" ON "purchasingRfqToPurchaseOrder" ("companyId");

ALTER TABLE "purchasingRfqToPurchaseOrder" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with purchasing_view can view purchasingRfqToPurchaseOrder"
  ON "purchasingRfqToPurchaseOrder" FOR SELECT USING (
    has_company_permission('purchasing_view', "companyId") AND
    has_role('employee', "companyId")
  );

CREATE POLICY "Employees with purchasing_create can insert purchasingRfqToPurchaseOrder"
  ON "purchasingRfqToPurchaseOrder" FOR INSERT WITH CHECK (
    has_company_permission('purchasing_create', "companyId") AND
    has_role('employee', "companyId")
  );

-- Favorites Table
CREATE TABLE "purchasingRfqFavorite" (
  "rfqId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,

  CONSTRAINT "purchasingRfqFavorites_pkey" PRIMARY KEY ("rfqId", "userId"),
  CONSTRAINT "purchasingRfqFavorites_purchasingRfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "purchasingRfq"("id") ON DELETE CASCADE,
  CONSTRAINT "purchasingRfqFavorites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
);

CREATE INDEX "purchasingRfqFavorites_userId_idx" ON "purchasingRfqFavorite" ("userId");
CREATE INDEX "purchasingRfqFavorites_purchasingRfqId_idx" ON "purchasingRfqFavorite" ("rfqId");

ALTER TABLE "purchasingRfqFavorite" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own purchasingRfq favorites" ON "purchasingRfqFavorite"
  FOR SELECT USING (
    auth.uid()::text = "userId"
  );

CREATE POLICY "Users can create their own purchasingRfq favorites" ON "purchasingRfqFavorite"
  FOR INSERT WITH CHECK (
    auth.uid()::text = "userId"
  );

CREATE POLICY "Users can delete their own purchasingRfq favorites" ON "purchasingRfqFavorite"
  FOR DELETE USING (
    auth.uid()::text = "userId"
  );

-- Views
CREATE OR REPLACE VIEW "purchasingRfqs" WITH(SECURITY_INVOKER=true) AS
  SELECT
    rfq.*,
    l."name" AS "locationName",
    (SELECT COUNT(*) FROM "purchasingRfqSupplier" rs WHERE rs."purchasingRfqId" = rfq.id) AS "supplierCount",
    (SELECT COALESCE(array_agg(s."id" ORDER BY s."id"), ARRAY[]::TEXT[]) FROM "purchasingRfqSupplier" rs JOIN "supplier" s ON s.id = rs."supplierId" WHERE rs."purchasingRfqId" = rfq.id) AS "supplierIds",
    EXISTS(SELECT 1 FROM "purchasingRfqFavorite" rf WHERE rf."rfqId" = rfq.id AND rf."userId" = auth.uid()::text) AS favorite
  FROM "purchasingRfq" rfq
  LEFT JOIN "location" l ON l.id = rfq."locationId";

CREATE OR REPLACE VIEW "purchasingRfqLines" WITH(SECURITY_INVOKER=true) AS
  SELECT
    prl.*,
    i."name" as "itemName",
    i."readableId" AS "itemReadableId",
    i."type" AS "itemType",
    i."thumbnailPath",
    mu."modelPath"
  FROM "purchasingRfqLine" prl
  LEFT JOIN "item" i ON i.id = prl."itemId"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId";

-- Storage Policies for Documents
CREATE POLICY "Purchasing RFQ documents view requires purchasing_view" ON storage.objects
FOR SELECT USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('purchasing_view', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'purchasing-rfq'
);

CREATE POLICY "Purchasing RFQ documents insert requires purchasing_create" ON storage.objects
FOR INSERT WITH CHECK (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('purchasing_create', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'purchasing-rfq'
);

CREATE POLICY "Purchasing RFQ documents update requires purchasing_update" ON storage.objects
FOR UPDATE USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('purchasing_update', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'purchasing-rfq'
);

CREATE POLICY "Purchasing RFQ documents delete requires purchasing_delete" ON storage.objects
FOR DELETE USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('purchasing_delete', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'purchasing-rfq'
);

-- Allow null unitCost in itemCost (for items without cost data)
ALTER TABLE "itemCost" ALTER COLUMN "unitCost" DROP NOT NULL;
