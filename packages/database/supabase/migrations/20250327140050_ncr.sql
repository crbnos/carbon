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

-- Insert non-conformance types for all existing companies
WITH nc_types AS (
  SELECT unnest(ARRAY[
    'Design Error',
    'Manufacturing Defect',
    'Process Deviation',
    'Material Non-Conformance',
    'Testing Failure',
    'Documentation Error',
    'Training Issue',
    'Equipment Malfunction',
    'Supplier Non-Conformance',
    'Customer Complaint'
  ]) AS name
)
INSERT INTO "nonConformanceType" ("name", "companyId", "createdBy")
SELECT 
  nc_types.name,
  c.id,
  'system'
FROM 
  "company" c,
  nc_types;


CREATE TYPE "nonConformanceSource" AS ENUM (
  'Internal',
  'External'
);

CREATE TYPE "nonConformancePriority" AS ENUM (
  'Low',
  'Medium',
  'High',
  'Critical'
);

CREATE TYPE "nonConformanceStatus" AS ENUM (
  'Registered',
  'In Progress',
  'Closed'
);

CREATE TYPE "nonConformanceInvestigation" AS ENUM (
  'Root Cause Analysis',
  'Inventory',
  'WIP',
  'Finished Goods',
  'Incoming Materials',
  'Process',
  'Documentation'
);

CREATE TYPE "nonConformanceAction" AS ENUM (
  'Corrective Action',
  'Preventive Action',
  'Containment Action',
  'Verification',
  'Customer Communication'
);

CREATE TYPE "nonConformanceApproval" AS ENUM (
  'MRB'
);

CREATE TYPE "nonConformanceTaskStatus" AS ENUM (
  'Pending',
  'In Progress',
  'Completed',
  'Skipped'
);

CREATE TABLE "nonConformanceWorkflow" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL,
  "description" TEXT,
  "content" JSON NOT NULL DEFAULT '{}',
  "priority" "nonConformancePriority" NOT NULL DEFAULT 'Medium',
  "source" "nonConformanceSource" NOT NULL DEFAULT 'Internal',
  "investigationTypes" "nonConformanceInvestigation"[] DEFAULT '{}',
  "requiredActions" "nonConformanceAction"[] DEFAULT '{}',
  "approvalRequirements" "nonConformanceApproval"[] DEFAULT '{}',
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "nonConformanceWorkflow_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nonConformanceWorkflow_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceWorkflow_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceWorkflow_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);


CREATE TABLE "nonConformance" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "nonConformanceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "source" "nonConformanceSource" NOT NULL,
  "status" "nonConformanceStatus" NOT NULL DEFAULT 'Registered',
  "priority" "nonConformancePriority",
  "investigationTypes" "nonConformanceInvestigation"[],
  "requiredActions" "nonConformanceAction"[],
  "approvalRequirements" "nonConformanceApproval"[],
  "nonConformanceWorkflowId" TEXT NOT NULL,
  "content" JSON NOT NULL DEFAULT '{}',
  "locationId" TEXT NOT NULL,
  "nonConformanceTypeId" TEXT NOT NULL,
  "openDate" DATE NOT NULL,
  "dueDate" DATE,
  "closeDate" DATE,
  "quantity" NUMERIC NOT NULL DEFAULT 0,
  "itemId" TEXT,
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
  "customFields" JSONB,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "companyId" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "nonConformance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nonConformance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformance_nonConformanceTypeId_fkey" FOREIGN KEY ("nonConformanceTypeId") REFERENCES "nonConformanceType"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformance_nonConformanceWorkflowId_fkey" FOREIGN KEY ("nonConformanceWorkflowId") REFERENCES "nonConformanceWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformance_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON UPDATE CASCADE ON DELETE CASCADE,
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
CREATE INDEX "nonConformance_assignee_idx" ON "nonConformance" ("assignee");

INSERT INTO "customFieldTable" ("table", "name", "module") 
VALUES ('nonConformance', 'Non-Conformance', 'Quality');

CREATE TABLE "nonConformanceInvestigationTask" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "nonConformanceId" TEXT NOT NULL,
  "investigationType" "nonConformanceInvestigation",
  "status" "nonConformanceTaskStatus" NOT NULL DEFAULT 'Pending',
  "dueDate" DATE,
  "completedDate" DATE,
  "assignee" TEXT,
  "notes" JSON NOT NULL DEFAULT '{}',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "nonConformanceInvestigationTask_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nonConformanceInvestigationTask_nonConformanceId_fkey" FOREIGN KEY ("nonConformanceId") REFERENCES "nonConformance"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceInvestigationTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceInvestigationTask_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceInvestigationTask_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceInvestigationTask_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "nonConformanceInvestigationTask_nonConformanceId_idx" ON "nonConformanceInvestigationTask" ("nonConformanceId");
CREATE INDEX "nonConformanceInvestigationTask_assignee_idx" ON "nonConformanceInvestigationTask" ("assignee");
CREATE INDEX "nonConformanceInvestigationTask_status_idx" ON "nonConformanceInvestigationTask" ("status");

CREATE TABLE "nonConformanceActionTask" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "nonConformanceId" TEXT NOT NULL,
  "actionType" "nonConformanceAction",
  "status" "nonConformanceTaskStatus" NOT NULL DEFAULT 'Pending',
  "dueDate" DATE,
  "completedDate" DATE,
  "assignee" TEXT,
  "notes" JSON NOT NULL DEFAULT '{}',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "nonConformanceActionTask_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nonConformanceActionTask_nonConformanceId_fkey" FOREIGN KEY ("nonConformanceId") REFERENCES "nonConformance"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceActionTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceActionTask_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceActionTask_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceActionTask_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "nonConformanceActionTask_nonConformanceId_idx" ON "nonConformanceActionTask" ("nonConformanceId");
CREATE INDEX "nonConformanceActionTask_assignee_idx" ON "nonConformanceActionTask" ("assignee");
CREATE INDEX "nonConformanceActionTask_status_idx" ON "nonConformanceActionTask" ("status");

CREATE TABLE "nonConformanceApprovalTask" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "nonConformanceId" TEXT NOT NULL,
  "approvalType" "nonConformanceApproval",
  "status" "nonConformanceTaskStatus" NOT NULL DEFAULT 'Pending',
  "dueDate" DATE,
  "completedDate" DATE,
  "assignee" TEXT,
  "notes" JSON NOT NULL DEFAULT '{}',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "nonConformanceApprovalTask_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nonConformanceApprovalTask_nonConformanceId_fkey" FOREIGN KEY ("nonConformanceId") REFERENCES "nonConformance"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceApprovalTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceApprovalTask_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceApprovalTask_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceApprovalTask_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "nonConformanceApprovalTask_nonConformanceId_idx" ON "nonConformanceApprovalTask" ("nonConformanceId");
CREATE INDEX "nonConformanceApprovalTask_assignee_idx" ON "nonConformanceApprovalTask" ("assignee");
CREATE INDEX "nonConformanceApprovalTask_status_idx" ON "nonConformanceApprovalTask" ("status");


CREATE TABLE "nonConformanceReviewer" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "title" TEXT NOT NULL,
  "status" "nonConformanceTaskStatus" NOT NULL DEFAULT 'Pending',
  "nonConformanceId" TEXT NOT NULL,
  "notes" JSON NOT NULL DEFAULT '{}',
  "assignee" TEXT,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "nonConformanceReviewer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nonConformanceReviewer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceReviewer_nonConformanceId_fkey" FOREIGN KEY ("nonConformanceId") REFERENCES "nonConformance"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceReviewer_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceReviewer_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceReviewer_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "nonConformanceReviewer_nonConformanceId_idx" ON "nonConformanceReviewer" ("nonConformanceId");
CREATE INDEX "nonConformanceReviewer_assignee_idx" ON "nonConformanceReviewer" ("assignee");


INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 
  'nonConformance',
  'Non-Conformance',
  'NCR',
  NULL,
  0,
  6,
  1,
  "id"
FROM "company";

