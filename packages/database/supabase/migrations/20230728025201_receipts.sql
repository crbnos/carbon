CREATE TYPE "receiptSourceDocument" AS ENUM (
  'Sales Order',
  'Sales Invoice',
  'Sales Return Order',
  'Purchase Order',
  'Purchase Invoice',
  'Purchase Return Order',
  'Inbound Transfer',
  'Outbound Transfer',
  'Manufacturing Consumption',
  'Manufacturing Output'
);

CREATE TYPE "receiptStatus" AS ENUM (
  'Draft',
  'Pending',
  'Posted'
);

CREATE TABLE "receipt" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "receiptId" TEXT NOT NULL,
  "locationId" TEXT,
  "sourceDocument" "receiptSourceDocument",
  "sourceDocumentId" TEXT,
  "sourceDocumentReadableId" TEXT,
  "externalDocumentId" TEXT,
  "supplierId" TEXT,
  "status" "receiptStatus" NOT NULL DEFAULT 'Draft',
  "postingDate" DATE,
  "invoiced" BOOLEAN DEFAULT FALSE,
  "assignee" TEXT,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,
  "customFields" JSONB,

  CONSTRAINT "receipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "receipt_receiptId_key" UNIQUE ("receiptId", "companyId"),
  CONSTRAINT "receipt_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "receipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "receipt_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "receipt_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "receipt_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "receipt_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "receipt_receiptId_idx" ON "receipt" ("receiptId", "companyId");
CREATE INDEX "receipt_status_idx" ON "receipt" ("status", "companyId");
CREATE INDEX "receipt_locationId_idx" ON "receipt" ("locationId", "companyId");
CREATE INDEX "receipt_sourceDocumentId_idx" ON "receipt" ("sourceDocumentId", "companyId");
CREATE INDEX "receipt_supplierId_idx" ON "receipt" ("supplierId", "companyId");
CREATE INDEX "receipt_companyId_idx" ON "receipt" ("companyId");

ALTER TABLE "receipt" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with inventory_view can view receipts" ON "receipt"
  FOR SELECT
  USING (
    has_role('employee') AND
    has_company_permission('inventory_view', "companyId")
  );
  

CREATE POLICY "Employees with inventory_create can insert receipts" ON "receipt"
  FOR INSERT
  WITH CHECK (   
    has_role('employee') AND
    has_company_permission('inventory_create', "companyId")
);

CREATE POLICY "Employees with inventory_update can update receipts" ON "receipt"
  FOR UPDATE
  USING (
    has_role('employee') AND
    has_company_permission('inventory_update', "companyId")
  );

CREATE POLICY "Employees with inventory_delete can delete receipts" ON "receipt"
  FOR DELETE
  USING (
    has_role('employee') AND
    has_company_permission('inventory_delete', "companyId")
  );

ALTER publication supabase_realtime ADD TABLE "receipt";

CREATE TABLE "receiptLine" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "receiptId" TEXT NOT NULL,
  "lineId" TEXT,
  "itemId" TEXT NOT NULL,
  "itemReadableId" TEXT,
  "orderQuantity" NUMERIC(18, 4) NOT NULL,
  "outstandingQuantity" NUMERIC(18, 4) NOT NULL DEFAULT 0,
  "receivedQuantity" NUMERIC(18, 4) NOT NULL DEFAULT 0,
  "locationId" TEXT,
  "shelfId" TEXT,
  "unitOfMeasure" TEXT NOT NULL,
  "unitPrice" NUMERIC(18, 4) NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "receiptLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "receiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "receipt" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "receiptLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "receiptLine_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "receiptLine_shelfId_fkey" FOREIGN KEY ("shelfId", "locationId") REFERENCES "shelf" ("id", "locationId") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "receiptLine_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "receiptLine_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "receiptLine_receiptId_idx" ON "receiptLine" ("receiptId");
CREATE INDEX "receiptLine_lineId_idx" ON "receiptLine" ("lineId");
CREATE INDEX "receiptLine_receiptId_lineId_idx" ON "receiptLine" ("receiptId", "lineId");

ALTER TABLE "receiptLine" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with inventory_view can view receipt lines" ON "receiptLine"
  FOR SELECT
  USING (
    has_role('employee') AND
    has_company_permission('inventory_view', "companyId")
  );
  

CREATE POLICY "Employees with inventory_create can insert receipt lines" ON "receiptLine"
  FOR INSERT
  WITH CHECK (   
    has_role('employee') AND
    has_company_permission('inventory_create', "companyId")
);

CREATE POLICY "Employees with inventory_update can update receipt lines" ON "receiptLine"
  FOR UPDATE
  USING (
    has_role('employee') AND
    has_company_permission('inventory_update', "companyId")
  );

CREATE POLICY "Employees with inventory_delete can delete receipt lines" ON "receiptLine"
  FOR DELETE
  USING (
    has_role('employee') AND
    has_company_permission('inventory_delete', "companyId")
  );

CREATE OR REPLACE VIEW "receipts" WITH(SECURITY_INVOKER=true) AS
  SELECT 
    r.*,
    cb."fullName" as "createdByFullName",
    cb."avatarUrl" as "createdByAvatar",
    ub."fullName" as "updatedByFullName",
    ub."avatarUrl" as "updatedByAvatar",
    l."name" as "locationName",
    s."name" as "supplierName"
  FROM "receipt" r
  LEFT JOIN "user" cb
    ON cb.id = r."createdBy"
  LEFT JOIN "user" ub
    ON ub.id = r."updatedBy"
  LEFT JOIN "location" l
    ON l.id = r."locationId"
  LEFT JOIN "supplier" s
    ON s.id = r."supplierId";
  