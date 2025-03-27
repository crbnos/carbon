CREATE TABLE "nonConformanceType" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL,
  "companyId" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "nonConformanceType_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nonConformanceType_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceType_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceType_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE TYPE "nonConformanceSource" AS ENUM (
  'Internal',
  'External'
);

CREATE STATUS "nonConformanceStatus" AS ENUM (
  'Registered',
  'Open',
  'Completed'
);

CREATE TABLE "nonConformance" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL,
  "source" "nonConformanceSource" NOT NULL,
  "status" "nonConformanceStatus" NOT NULL DEFAULT 'Registered',
  -- "nonConformanceWorkflowId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "nonConformanceTypeId" TEXT NOT NULL,
  "openDate" DATE NOT NULL,
  "dueDate" DATE,
  "closeDate" DATE,
  "description" JSON DEFAULT '{}',
  "itemId" TEXT,
  "quantity" NUMERIC NOT NULL DEFAULT 0,
  "trackedEntityId" TEXT,
  "customerId" TEXT,
  "supplierId" TEXT,
  "jobId" TEXT,
  "jobOperationId" TEXT,
  "purchaseOrderId" TEXT,
  "purchaseOrderLineId" TEXT,
  "salesOrderId" TEXT,
  "salesOrderLineId" TEXT,
  "shipmentId" TEXT,
  "shipmentLineId" TEXT,
  "assignee" TEXT,
  "companyId" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "nonConformance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nonConformance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformance_nonConformanceTypeId_fkey" FOREIGN KEY ("nonConformanceTypeId") REFERENCES "nonConformanceType"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformance_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "nonConformance_trackedEntityId_fkey" FOREIGN KEY ("trackedEntityId") REFERENCES "trackedEntity"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "nonConformance_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "nonConformance_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "nonConformance_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "nonConformance_jobOperationId_fkey" FOREIGN KEY ("jobOperationId") REFERENCES "jobOperation"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "nonConformance_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchaseOrder"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "nonConformance_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "purchaseOrderLine"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "nonConformance_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "salesOrder"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "nonConformance_salesOrderLineId_fkey" FOREIGN KEY ("salesOrderLineId") REFERENCES "salesOrderLine"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "nonConformance_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipment"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "nonConformance_shipmentLineId_fkey" FOREIGN KEY ("shipmentLineId") REFERENCES "shipmentLine"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "nonConformance_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformance_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformance_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "nonConformance_companyId_idx" ON "nonConformance" ("companyId");
CREATE INDEX "nonConformance_locationId_idx" ON "nonConformance" ("locationId");
CREATE INDEX "nonConformance_nonConformanceTypeId_idx" ON "nonConformance" ("nonConformanceTypeId");
CREATE INDEX "nonConformance_itemId_idx" ON "nonConformance" ("itemId");
CREATE INDEX "nonConformance_supplierId_idx" ON "nonConformance" ("supplierId");
CREATE INDEX "nonConformance_assigneeId_idx" ON "nonConformance" ("assigneeId");


CREATE TABLE "nonConformanceReviewer" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "nonConformanceId" TEXT NOT NULL,
  "reviewerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,

  CONSTRAINT "nonConformanceReviewer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nonConformanceReviewer_nonConformanceId_fkey" FOREIGN KEY ("nonConformanceId") REFERENCES "nonConformance"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceReviewer_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "nonConformanceReviewer_nonConformanceId_idx" ON "nonConformanceReviewer" ("nonConformanceId");
CREATE INDEX "nonConformanceReviewer_reviewerId_idx" ON "nonConformanceReviewer" ("reviewerId");


CREATE TABLE "nonConformanceOwner" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "nonConformanceId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,

  CONSTRAINT "nonConformanceOwner_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nonConformanceOwner_nonConformanceId_fkey" FOREIGN KEY ("nonConformanceId") REFERENCES "nonConformance"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceOwner_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON UPDATE CASCADE 
);

