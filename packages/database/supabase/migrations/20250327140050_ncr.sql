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
  CONSTRAINT "nonConformance_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformance_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformance_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

-- Create join tables for many-to-one relationships

CREATE TABLE "nonConformanceSupplier" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "nonConformanceId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "nonConformanceSupplier_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nonConformanceSupplier_nonConformanceId_fkey" FOREIGN KEY ("nonConformanceId") REFERENCES "nonConformance"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceSupplier_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "nonConformanceSupplier_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceSupplier_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceSupplier_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE TABLE "nonConformanceCustomer" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "nonConformanceId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "nonConformanceCustomer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nonConformanceCustomer_nonConformanceId_fkey" FOREIGN KEY ("nonConformanceId") REFERENCES "nonConformance"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceCustomer_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "nonConformanceCustomer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceCustomer_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceCustomer_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE TABLE "nonConformanceJob" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "nonConformanceId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "nonConformanceJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nonConformanceJob_nonConformanceId_fkey" FOREIGN KEY ("nonConformanceId") REFERENCES "nonConformance"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceJob_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "nonConformanceJob_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceJob_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceJob_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE TABLE "nonConformanceJobOperation" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "nonConformanceId" TEXT NOT NULL,
  "jobOperationId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "nonConformanceJobOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nonConformanceJobOperation_nonConformanceId_fkey" FOREIGN KEY ("nonConformanceId") REFERENCES "nonConformance"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceJobOperation_jobOperationId_fkey" FOREIGN KEY ("jobOperationId") REFERENCES "jobOperation"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "nonConformanceJobOperation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceJobOperation_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceJobOperation_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE TABLE "nonConformancePurchaseOrder" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "nonConformanceId" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "nonConformancePurchaseOrder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nonConformancePurchaseOrder_nonConformanceId_fkey" FOREIGN KEY ("nonConformanceId") REFERENCES "nonConformance"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformancePurchaseOrder_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchaseOrder"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "nonConformancePurchaseOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformancePurchaseOrder_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformancePurchaseOrder_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE TABLE "nonConformancePurchaseOrderLine" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "nonConformanceId" TEXT NOT NULL,
  "purchaseOrderLineId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "nonConformancePurchaseOrderLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nonConformancePurchaseOrderLine_nonConformanceId_fkey" FOREIGN KEY ("nonConformanceId") REFERENCES "nonConformance"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformancePurchaseOrderLine_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "purchaseOrderLine"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "nonConformancePurchaseOrderLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformancePurchaseOrderLine_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformancePurchaseOrderLine_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE TABLE "nonConformanceSalesOrder" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "nonConformanceId" TEXT NOT NULL,
  "salesOrderId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "nonConformanceSalesOrder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nonConformanceSalesOrder_nonConformanceId_fkey" FOREIGN KEY ("nonConformanceId") REFERENCES "nonConformance"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceSalesOrder_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "salesOrder"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "nonConformanceSalesOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceSalesOrder_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceSalesOrder_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE TABLE "nonConformanceSalesOrderLine" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "nonConformanceId" TEXT NOT NULL,
  "salesOrderLineId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "nonConformanceSalesOrderLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nonConformanceSalesOrderLine_nonConformanceId_fkey" FOREIGN KEY ("nonConformanceId") REFERENCES "nonConformance"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceSalesOrderLine_salesOrderLineId_fkey" FOREIGN KEY ("salesOrderLineId") REFERENCES "salesOrderLine"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "nonConformanceSalesOrderLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceSalesOrderLine_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceSalesOrderLine_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE TABLE "nonConformanceShipment" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "nonConformanceId" TEXT NOT NULL,
  "shipmentId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "nonConformanceShipment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nonConformanceShipment_nonConformanceId_fkey" FOREIGN KEY ("nonConformanceId") REFERENCES "nonConformance"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceShipment_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipment"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "nonConformanceShipment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceShipment_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceShipment_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE TABLE "nonConformanceShipmentLine" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "nonConformanceId" TEXT NOT NULL,
  "shipmentLineId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "nonConformanceShipmentLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nonConformanceShipmentLine_nonConformanceId_fkey" FOREIGN KEY ("nonConformanceId") REFERENCES "nonConformance"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceShipmentLine_shipmentLineId_fkey" FOREIGN KEY ("shipmentLineId") REFERENCES "shipmentLine"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "nonConformanceShipmentLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceShipmentLine_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceShipmentLine_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "nonConformance_companyId_idx" ON "nonConformance" ("companyId");
CREATE INDEX "nonConformance_locationId_idx" ON "nonConformance" ("locationId");
CREATE INDEX "nonConformance_nonConformanceTypeId_idx" ON "nonConformance" ("nonConformanceTypeId");
CREATE INDEX "nonConformance_itemId_idx" ON "nonConformance" ("itemId");
CREATE INDEX "nonConformance_assignee_idx" ON "nonConformance" ("assignee");

-- Create indexes for join tables
CREATE INDEX "nonConformanceSupplier_nonConformanceId_idx" ON "nonConformanceSupplier" ("nonConformanceId");
CREATE INDEX "nonConformanceSupplier_supplierId_idx" ON "nonConformanceSupplier" ("supplierId");
CREATE INDEX "nonConformanceCustomer_nonConformanceId_idx" ON "nonConformanceCustomer" ("nonConformanceId");
CREATE INDEX "nonConformanceCustomer_customerId_idx" ON "nonConformanceCustomer" ("customerId");
CREATE INDEX "nonConformanceJob_nonConformanceId_idx" ON "nonConformanceJob" ("nonConformanceId");
CREATE INDEX "nonConformanceJob_jobId_idx" ON "nonConformanceJob" ("jobId");
CREATE INDEX "nonConformanceJobOperation_nonConformanceId_idx" ON "nonConformanceJobOperation" ("nonConformanceId");
CREATE INDEX "nonConformanceJobOperation_jobOperationId_idx" ON "nonConformanceJobOperation" ("jobOperationId");
CREATE INDEX "nonConformancePurchaseOrder_nonConformanceId_idx" ON "nonConformancePurchaseOrder" ("nonConformanceId");
CREATE INDEX "nonConformancePurchaseOrder_purchaseOrderId_idx" ON "nonConformancePurchaseOrder" ("purchaseOrderId");
CREATE INDEX "nonConformancePurchaseOrderLine_nonConformanceId_idx" ON "nonConformancePurchaseOrderLine" ("nonConformanceId");
CREATE INDEX "nonConformancePurchaseOrderLine_purchaseOrderLineId_idx" ON "nonConformancePurchaseOrderLine" ("purchaseOrderLineId");
CREATE INDEX "nonConformanceSalesOrder_nonConformanceId_idx" ON "nonConformanceSalesOrder" ("nonConformanceId");
CREATE INDEX "nonConformanceSalesOrder_salesOrderId_idx" ON "nonConformanceSalesOrder" ("salesOrderId");
CREATE INDEX "nonConformanceSalesOrderLine_nonConformanceId_idx" ON "nonConformanceSalesOrderLine" ("nonConformanceId");
CREATE INDEX "nonConformanceSalesOrderLine_salesOrderLineId_idx" ON "nonConformanceSalesOrderLine" ("salesOrderLineId");
CREATE INDEX "nonConformanceShipment_nonConformanceId_idx" ON "nonConformanceShipment" ("nonConformanceId");
CREATE INDEX "nonConformanceShipment_shipmentId_idx" ON "nonConformanceShipment" ("shipmentId");
CREATE INDEX "nonConformanceShipmentLine_nonConformanceId_idx" ON "nonConformanceShipmentLine" ("nonConformanceId");
CREATE INDEX "nonConformanceShipmentLine_shipmentLineId_idx" ON "nonConformanceShipmentLine" ("shipmentLineId");

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

