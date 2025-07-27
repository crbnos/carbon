-- Warehouse Transfer Status
CREATE TYPE "warehouseTransferStatus" AS ENUM (
  'Draft',
  'To Ship and Receive',
  'To Ship',
  'To Receive',
  'Completed',
  'Cancelled'
);

-- Warehouse Transfer Table
CREATE TABLE "warehouseTransfer" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "transferId" TEXT NOT NULL,
  "fromLocationId" TEXT NOT NULL,
  "toLocationId" TEXT NOT NULL,
  "status" "warehouseTransferStatus" NOT NULL DEFAULT 'Draft',
  "transferDate" DATE,
  "expectedReceiptDate" DATE,
  "notes" TEXT,
  "reference" TEXT,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  "tags" TEXT[],

  CONSTRAINT "warehouseTransfer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "warehouseTransfer_transferId_key" UNIQUE ("transferId", "companyId"),
  CONSTRAINT "warehouseTransfer_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "location"("id") ON DELETE RESTRICT,
  CONSTRAINT "warehouseTransfer_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "location"("id") ON DELETE RESTRICT,
  CONSTRAINT "warehouseTransfer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "warehouseTransfer_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT,
  CONSTRAINT "warehouseTransfer_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT
);

INSERT INTO "customFieldTable" ("table", "name", "module") 
VALUES ('warehouseTransfer', 'Warehouse Transfer', 'Inventory');

-- Warehouse Transfer Line Table
CREATE TABLE "warehouseTransferLine" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "transferId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "quantity" NUMERIC NOT NULL DEFAULT 0,
  "shippedQuantity" NUMERIC NOT NULL DEFAULT 0,
  "receivedQuantity" NUMERIC NOT NULL DEFAULT 0,
  "fromLocationId" TEXT NOT NULL,
  "fromShelfId" TEXT,
  "toLocationId" TEXT NOT NULL,
  "toShelfId" TEXT,
  "unitOfMeasureCode" TEXT,
  "notes" TEXT,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "warehouseTransferLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "warehouseTransferLine_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "warehouseTransfer"("id") ON DELETE CASCADE,
  CONSTRAINT "warehouseTransferLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE RESTRICT,
  CONSTRAINT "warehouseTransferLine_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "location"("id") ON DELETE RESTRICT,
  CONSTRAINT "warehouseTransferLine_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "location"("id") ON DELETE RESTRICT,
  CONSTRAINT "warehouseTransferLine_fromShelfId_fkey" FOREIGN KEY ("fromShelfId") REFERENCES "shelf"("id") ON DELETE SET NULL,
  CONSTRAINT "warehouseTransferLine_toShelfId_fkey" FOREIGN KEY ("toShelfId") REFERENCES "shelf"("id") ON DELETE SET NULL,
  CONSTRAINT "warehouseTransferLine_unitOfMeasureCode_fkey" FOREIGN KEY ("unitOfMeasureCode", "companyId") REFERENCES "unitOfMeasure"("code", "companyId") ON DELETE SET NULL,
  CONSTRAINT "warehouseTransferLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "warehouseTransferLine_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT,
  CONSTRAINT "warehouseTransferLine_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT
);

INSERT INTO "customFieldTable" ("table", "name", "module") 
VALUES ('warehouseTransferLine', 'Warehouse Transfer Line', 'Inventory');

INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 
  'warehouseTransfer',
  'Warehouse Transfer',
  'WT',
  NULL,
  0,
  6,
  1,
  "id"
FROM "company";

-- Indexes
CREATE INDEX "warehouseTransfer_companyId_idx" ON "warehouseTransfer"("companyId");
CREATE INDEX "warehouseTransfer_fromLocationId_idx" ON "warehouseTransfer"("fromLocationId");
CREATE INDEX "warehouseTransfer_toLocationId_idx" ON "warehouseTransfer"("toLocationId");
CREATE INDEX "warehouseTransfer_status_idx" ON "warehouseTransfer"("status");
CREATE INDEX "warehouseTransfer_transferDate_idx" ON "warehouseTransfer"("transferDate");

CREATE INDEX "warehouseTransferLine_transferId_idx" ON "warehouseTransferLine"("transferId");
CREATE INDEX "warehouseTransferLine_itemId_idx" ON "warehouseTransferLine"("itemId");
CREATE INDEX "warehouseTransferLine_fromLocationId_idx" ON "warehouseTransferLine"("fromLocationId");
CREATE INDEX "warehouseTransferLine_toLocationId_idx" ON "warehouseTransferLine"("toLocationId");
CREATE INDEX "warehouseTransferLine_companyId_idx" ON "warehouseTransferLine"("companyId");

-- RLS Policies
ALTER TABLE "warehouseTransfer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "warehouseTransferLine" ENABLE ROW LEVEL SECURITY;

-- Warehouse Transfer Policies
CREATE POLICY "SELECT" ON "warehouseTransfer"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "warehouseTransfer"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "warehouseTransfer"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "warehouseTransfer"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_delete')
    )::text[]
  )
);

-- Warehouse Transfer Line Policies
CREATE POLICY "SELECT" ON "warehouseTransferLine"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "warehouseTransferLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "warehouseTransferLine"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "warehouseTransferLine"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_delete')
    )::text[]
  )
);
