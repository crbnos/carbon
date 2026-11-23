-- Field Service Phase A: customer assets, service orders, visits and installed components,
-- plus the warranty months, the invoice stamp, the technician's van and the labor item.
-- RLS lives in packages/database/src/authz/manifest.ts.
-- Spec: .ai/specs/2026-10-08-field-service.md (Data Model Changes)

-- One row per shipped serial: where it is, whose it is, and its warranty.
CREATE TABLE IF NOT EXISTS "customerAsset" (
  "id" TEXT NOT NULL DEFAULT id('cas'),
  "companyId" TEXT NOT NULL,
  "trackedEntityId" TEXT NOT NULL REFERENCES "trackedEntity"("id"),
  "itemId" TEXT NOT NULL REFERENCES "item"("id"),
  "customerId" TEXT NOT NULL REFERENCES "customer"("id"),
  "customerLocationId" TEXT REFERENCES "customerLocation"("id") ON DELETE SET NULL,
  "status" "customerAssetStatus" NOT NULL DEFAULT 'In Service',
  "shippedDate" DATE,
  "laborWarrantyEndDate" DATE,
  "partsWarrantyEndDate" DATE,
  "shipmentId" TEXT REFERENCES "shipment"("id") ON DELETE SET NULL,  -- the shipment that created or last moved it
  "source" TEXT NOT NULL DEFAULT 'Shipment' CHECK ("source" IN ('Shipment', 'Manual')),
  "notes" JSONB,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "customerAsset_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerAsset_trackedEntity_key" UNIQUE ("trackedEntityId", "companyId"),
  CONSTRAINT "customerAsset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "customerAsset_companyId_idx" ON "customerAsset" ("companyId");
CREATE INDEX IF NOT EXISTS "customerAsset_itemId_idx" ON "customerAsset" ("itemId");
CREATE INDEX IF NOT EXISTS "customerAsset_customerId_idx" ON "customerAsset" ("customerId");
CREATE INDEX IF NOT EXISTS "customerAsset_customerLocationId_idx" ON "customerAsset" ("customerLocationId");
CREATE INDEX IF NOT EXISTS "customerAsset_shipmentId_idx" ON "customerAsset" ("shipmentId");
CREATE INDEX IF NOT EXISTS "customerAsset_createdBy_idx" ON "customerAsset" ("createdBy");
CREATE INDEX IF NOT EXISTS "customerAsset_updatedBy_idx" ON "customerAsset" ("updatedBy");

-- Work on one subject serial. The order owns its Service project (the work tree).
CREATE TABLE IF NOT EXISTS "serviceOrder" (
  "id" TEXT NOT NULL DEFAULT id('svc'),
  "companyId" TEXT NOT NULL,
  "serviceOrderId" TEXT NOT NULL,                    -- readable, sequence 'serviceOrder' prefix SVC
  "type" "serviceOrderType" NOT NULL,
  "status" "serviceOrderStatus" NOT NULL DEFAULT 'Draft',
  "trackedEntityId" TEXT NOT NULL REFERENCES "trackedEntity"("id"),   -- the subject
  "itemId" TEXT NOT NULL REFERENCES "item"("id"),
  "customerAssetId" TEXT,                            -- Field Visit, Depot Repair
  "customerId" TEXT REFERENCES "customer"("id"),     -- null for Refurbishment
  "customerLocationId" TEXT REFERENCES "customerLocation"("id") ON DELETE SET NULL,
  "customerContactId" TEXT REFERENCES "customerContact"("id") ON DELETE SET NULL,
  "locationId" TEXT NOT NULL REFERENCES "location"("id"),  -- the company location that does the work
  "customerContractId" TEXT,                         -- coverage contract
  "projectId" TEXT NOT NULL,                         -- the order's own Service project (the work tree)
  "serviceTemplateId" TEXT,                          -- the template project the tree came from
  "invoiceDetail" "serviceInvoiceDetail" NOT NULL DEFAULT 'Itemized',
  "priority" "projectElementPriority" NOT NULL DEFAULT 'None',
  "problem" JSONB,
  "resolution" JSONB,
  "assignee" TEXT REFERENCES "user"("id"),
  "expectedSellingPrice" NUMERIC,                    -- Refurbishment: overrides the sale price cap
  "abnormalRework" BOOLEAN NOT NULL DEFAULT FALSE,   -- Refurbishment
  "completedAt" TIMESTAMP WITH TIME ZONE,
  "completedBy" TEXT REFERENCES "user"("id"),
  "salesInvoiceId" TEXT REFERENCES "salesInvoice"("id") ON DELETE SET NULL,  -- stamp
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "serviceOrder_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "serviceOrder_readable_key" UNIQUE ("serviceOrderId", "companyId"),
  CONSTRAINT "serviceOrder_asset_fkey" FOREIGN KEY ("customerAssetId", "companyId") REFERENCES "customerAsset"("id", "companyId"),
  CONSTRAINT "serviceOrder_contract_fkey" FOREIGN KEY ("customerContractId", "companyId") REFERENCES "customerContract"("id", "companyId"),
  CONSTRAINT "serviceOrder_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId"),
  CONSTRAINT "serviceOrder_project_key" UNIQUE ("projectId", "companyId"),
  CONSTRAINT "serviceOrder_template_fkey" FOREIGN KEY ("serviceTemplateId", "companyId") REFERENCES "project"("id", "companyId") ON DELETE SET NULL ("serviceTemplateId"),
  CONSTRAINT "serviceOrder_customer_check" CHECK (("type" = 'Refurbishment') = ("customerId" IS NULL)),
  CONSTRAINT "serviceOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
-- At most one open order per subject serial.
CREATE UNIQUE INDEX IF NOT EXISTS "serviceOrder_open_subject_key" ON "serviceOrder" ("trackedEntityId", "companyId")
  WHERE "status" NOT IN ('Closed', 'Cancelled');

CREATE INDEX IF NOT EXISTS "serviceOrder_companyId_idx" ON "serviceOrder" ("companyId");
CREATE INDEX IF NOT EXISTS "serviceOrder_trackedEntityId_idx" ON "serviceOrder" ("trackedEntityId");
CREATE INDEX IF NOT EXISTS "serviceOrder_itemId_idx" ON "serviceOrder" ("itemId");
CREATE INDEX IF NOT EXISTS "serviceOrder_customerAssetId_idx" ON "serviceOrder" ("customerAssetId", "companyId");
CREATE INDEX IF NOT EXISTS "serviceOrder_customerId_idx" ON "serviceOrder" ("customerId");
CREATE INDEX IF NOT EXISTS "serviceOrder_customerLocationId_idx" ON "serviceOrder" ("customerLocationId");
CREATE INDEX IF NOT EXISTS "serviceOrder_customerContactId_idx" ON "serviceOrder" ("customerContactId");
CREATE INDEX IF NOT EXISTS "serviceOrder_locationId_idx" ON "serviceOrder" ("locationId");
CREATE INDEX IF NOT EXISTS "serviceOrder_customerContractId_idx" ON "serviceOrder" ("customerContractId", "companyId");
CREATE INDEX IF NOT EXISTS "serviceOrder_serviceTemplateId_idx" ON "serviceOrder" ("serviceTemplateId", "companyId");
CREATE INDEX IF NOT EXISTS "serviceOrder_assignee_idx" ON "serviceOrder" ("assignee");
CREATE INDEX IF NOT EXISTS "serviceOrder_completedBy_idx" ON "serviceOrder" ("completedBy");
CREATE INDEX IF NOT EXISTS "serviceOrder_salesInvoiceId_idx" ON "serviceOrder" ("salesInvoiceId");
CREATE INDEX IF NOT EXISTS "serviceOrder_createdBy_idx" ON "serviceOrder" ("createdBy");
CREATE INDEX IF NOT EXISTS "serviceOrder_updatedBy_idx" ON "serviceOrder" ("updatedBy");

-- One trip or work session.
CREATE TABLE IF NOT EXISTS "serviceVisit" (
  "id" TEXT NOT NULL DEFAULT id('svv'),
  "companyId" TEXT NOT NULL,
  "serviceOrderId" TEXT NOT NULL,
  "technicianId" TEXT NOT NULL REFERENCES "user"("id"),
  "status" "serviceVisitStatus" NOT NULL DEFAULT 'Scheduled',
  "plannedStart" TIMESTAMP WITH TIME ZONE,
  "plannedEnd" TIMESTAMP WITH TIME ZONE,
  "travelStartedAt" TIMESTAMP WITH TIME ZONE,
  "arrivedAt" TIMESTAMP WITH TIME ZONE,
  "completedAt" TIMESTAMP WITH TIME ZONE,
  "notes" JSONB,
  "signaturePath" TEXT,                              -- private bucket path of the PNG
  "signedByName" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "serviceVisit_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "serviceVisit_order_fkey" FOREIGN KEY ("serviceOrderId", "companyId") REFERENCES "serviceOrder"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "serviceVisit_window_check" CHECK ("plannedEnd" IS NULL OR "plannedStart" IS NULL OR "plannedEnd" >= "plannedStart"),
  CONSTRAINT "serviceVisit_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "serviceVisit_companyId_idx" ON "serviceVisit" ("companyId");
CREATE INDEX IF NOT EXISTS "serviceVisit_serviceOrderId_idx" ON "serviceVisit" ("serviceOrderId", "companyId");
CREATE INDEX IF NOT EXISTS "serviceVisit_technician_start_idx" ON "serviceVisit" ("companyId", "technicianId", "plannedStart");
CREATE INDEX IF NOT EXISTS "serviceVisit_technicianId_idx" ON "serviceVisit" ("technicianId");
CREATE INDEX IF NOT EXISTS "serviceVisit_createdBy_idx" ON "serviceVisit" ("createdBy");
CREATE INDEX IF NOT EXISTS "serviceVisit_updatedBy_idx" ON "serviceVisit" ("updatedBy");

-- A part installed in a customer asset, written by a part issue to a node.
CREATE TABLE IF NOT EXISTS "customerAssetComponent" (
  "id" TEXT NOT NULL DEFAULT id('cac'),
  "companyId" TEXT NOT NULL,
  "customerAssetId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL REFERENCES "item"("id"),
  "trackedEntityId" TEXT REFERENCES "trackedEntity"("id"),   -- null for an untracked part
  "quantity" NUMERIC NOT NULL DEFAULT 1,
  "installedDate" DATE NOT NULL,
  "partsWarrantyEndDate" DATE,
  "serviceOrderId" TEXT NOT NULL,
  "projectElementId" TEXT,                           -- the node it was issued to
  "projectLedgerId" TEXT,                            -- the issue
  "removedDate" DATE,
  "removedByServiceOrderId" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "customerAssetComponent_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerAssetComponent_asset_fkey" FOREIGN KEY ("customerAssetId", "companyId") REFERENCES "customerAsset"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "customerAssetComponent_order_fkey" FOREIGN KEY ("serviceOrderId", "companyId") REFERENCES "serviceOrder"("id", "companyId"),
  CONSTRAINT "customerAssetComponent_element_fkey" FOREIGN KEY ("projectElementId", "companyId") REFERENCES "projectElement"("id", "companyId") ON DELETE SET NULL ("projectElementId"),
  CONSTRAINT "customerAssetComponent_ledger_fkey" FOREIGN KEY ("projectLedgerId", "companyId") REFERENCES "projectLedger"("id", "companyId") ON DELETE SET NULL ("projectLedgerId"),
  CONSTRAINT "customerAssetComponent_removedBy_fkey" FOREIGN KEY ("removedByServiceOrderId", "companyId") REFERENCES "serviceOrder"("id", "companyId") ON DELETE SET NULL ("removedByServiceOrderId"),
  CONSTRAINT "customerAssetComponent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "customerAssetComponent_asset_idx" ON "customerAssetComponent" ("customerAssetId", "companyId") WHERE "removedDate" IS NULL;

CREATE INDEX IF NOT EXISTS "customerAssetComponent_companyId_idx" ON "customerAssetComponent" ("companyId");
CREATE INDEX IF NOT EXISTS "customerAssetComponent_customerAssetId_idx" ON "customerAssetComponent" ("customerAssetId", "companyId");
CREATE INDEX IF NOT EXISTS "customerAssetComponent_itemId_idx" ON "customerAssetComponent" ("itemId");
CREATE INDEX IF NOT EXISTS "customerAssetComponent_trackedEntityId_idx" ON "customerAssetComponent" ("trackedEntityId");
CREATE INDEX IF NOT EXISTS "customerAssetComponent_serviceOrderId_idx" ON "customerAssetComponent" ("serviceOrderId", "companyId");
CREATE INDEX IF NOT EXISTS "customerAssetComponent_projectElementId_idx" ON "customerAssetComponent" ("projectElementId", "companyId");
CREATE INDEX IF NOT EXISTS "customerAssetComponent_projectLedgerId_idx" ON "customerAssetComponent" ("projectLedgerId", "companyId");
CREATE INDEX IF NOT EXISTS "customerAssetComponent_removedByServiceOrderId_idx" ON "customerAssetComponent" ("removedByServiceOrderId", "companyId");
CREATE INDEX IF NOT EXISTS "customerAssetComponent_createdBy_idx" ON "customerAssetComponent" ("createdBy");
CREATE INDEX IF NOT EXISTS "customerAssetComponent_updatedBy_idx" ON "customerAssetComponent" ("updatedBy");

-- The visit FKs on the projects tables, which could not exist before "serviceVisit".
ALTER TABLE "timesheetEntry" ADD CONSTRAINT "timesheetEntry_visit_fkey"
  FOREIGN KEY ("serviceVisitId", "companyId") REFERENCES "serviceVisit"("id", "companyId") ON DELETE SET NULL ("serviceVisitId");
ALTER TABLE "projectExpenseEntry" ADD CONSTRAINT "projectExpenseEntry_visit_fkey"
  FOREIGN KEY ("serviceVisitId", "companyId") REFERENCES "serviceVisit"("id", "companyId") ON DELETE SET NULL ("serviceVisitId");

-- Warranty months on the item's sales settings; they set the asset's end dates at shipment.
ALTER TABLE "itemUnitSalePrice"
  ADD COLUMN IF NOT EXISTS "laborWarrantyMonths" INTEGER CHECK ("laborWarrantyMonths" >= 0),
  ADD COLUMN IF NOT EXISTS "partsWarrantyMonths" INTEGER CHECK ("partsWarrantyMonths" >= 0);

-- The service order an invoice bills.
ALTER TABLE "salesInvoice" ADD COLUMN IF NOT EXISTS "serviceOrderId" TEXT;
ALTER TABLE "salesInvoice" ADD CONSTRAINT "salesInvoice_serviceOrder_fkey"
  FOREIGN KEY ("serviceOrderId", "companyId") REFERENCES "serviceOrder"("id", "companyId") ON DELETE SET NULL ("serviceOrderId");
CREATE INDEX IF NOT EXISTS "salesInvoice_serviceOrderId_idx" ON "salesInvoice" ("serviceOrderId", "companyId");

-- The technician's van: the default storage unit of a part issue.
ALTER TABLE "employeeJob" ADD COLUMN IF NOT EXISTS "defaultStorageUnitId" TEXT;
ALTER TABLE "employeeJob" ADD CONSTRAINT "employeeJob_defaultStorageUnit_fkey"
  FOREIGN KEY ("defaultStorageUnitId") REFERENCES "storageUnit"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "employeeJob_defaultStorageUnitId_idx" ON "employeeJob" ("defaultStorageUnitId");

-- The item whose sale price prices service time.
ALTER TABLE "companySettings" ADD COLUMN IF NOT EXISTS "serviceLaborItemId" TEXT;
ALTER TABLE "companySettings" ADD CONSTRAINT "companySettings_serviceLaborItem_fkey"
  FOREIGN KEY ("serviceLaborItemId") REFERENCES "item"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "companySettings_serviceLaborItemId_idx" ON "companySettings" ("serviceLaborItemId");
