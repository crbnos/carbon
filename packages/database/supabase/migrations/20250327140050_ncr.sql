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

CREATE INDEX "nonConformanceType_companyId_idx" ON "nonConformanceType" ("companyId");

CREATE POLICY "SELECT" ON "public"."nonConformanceType"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."nonConformanceType"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."nonConformanceType"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."nonConformanceType"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_delete')
    )::text[]
  )
);

-- Insert issue types for all existing companies
WITH nc_types AS (
  SELECT unnest(ARRAY[
    'Design Error',
    'Manufacturing Defect',
    'Process Deviation',
    'Material Issue',
    'Testing Failure',
    'Documentation Error',
    'Training Issue',
    'Equipment Malfunction',
    'Supplier Issue',
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


CREATE POLICY "SELECT" ON "public"."nonConformanceWorkflow"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."nonConformanceWorkflow"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."nonConformanceWorkflow"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."nonConformanceWorkflow"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_delete')
    )::text[]
  )
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
  "nonConformanceWorkflowId" TEXT,
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

CREATE INDEX "nonConformance_companyId_idx" ON "nonConformance" ("companyId");
CREATE INDEX "nonConformance_nonConformanceWorkflowId_idx" ON "nonConformance" ("nonConformanceWorkflowId");
CREATE INDEX "nonConformance_nonConformanceTypeId_idx" ON "nonConformance" ("nonConformanceTypeId");
CREATE INDEX "nonConformance_locationId_idx" ON "nonConformance" ("locationId");
CREATE INDEX "nonConformance_itemId_idx" ON "nonConformance" ("itemId");
CREATE INDEX "nonConformance_assignee_idx" ON "nonConformance" ("assignee");


CREATE POLICY "SELECT" ON "public"."nonConformance"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."nonConformance"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."nonConformance"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."nonConformance"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_delete')
    )::text[]
  )
);

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


CREATE POLICY "SELECT" ON "public"."nonConformanceSupplier"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."nonConformanceSupplier"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."nonConformanceSupplier"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."nonConformanceSupplier"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_delete')
    )::text[]
  )
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


CREATE POLICY "SELECT" ON "public"."nonConformanceCustomer"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."nonConformanceCustomer"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."nonConformanceCustomer"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."nonConformanceCustomer"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_delete')
    )::text[]
  )
);

CREATE TABLE "nonConformanceJobOperation" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "nonConformanceId" TEXT NOT NULL,
  "jobOperationId" TEXT NOT NULL,
  "jobId" TEXT,
  "jobReadableId" TEXT,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "nonConformanceJobOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nonConformanceJobOperation_nonConformanceId_fkey" FOREIGN KEY ("nonConformanceId") REFERENCES "nonConformance"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceJobOperation_jobOperationId_fkey" FOREIGN KEY ("jobOperationId") REFERENCES "jobOperation"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "nonConformanceJobOperation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "nonConformanceJobOperation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceJobOperation_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceJobOperation_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);


CREATE POLICY "SELECT" ON "public"."nonConformanceJobOperation"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."nonConformanceJobOperation"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."nonConformanceJobOperation"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."nonConformanceJobOperation"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_delete')
    )::text[]
  )
);

CREATE TABLE "nonConformancePurchaseOrderLine" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "nonConformanceId" TEXT NOT NULL,
  "purchaseOrderLineId" TEXT NOT NULL,
  "purchaseOrderId" TEXT,
  "purchaseOrderReadableId" TEXT,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "nonConformancePurchaseOrderLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nonConformancePurchaseOrderLine_nonConformanceId_fkey" FOREIGN KEY ("nonConformanceId") REFERENCES "nonConformance"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformancePurchaseOrderLine_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "purchaseOrderLine"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "nonConformancePurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchaseOrder"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "nonConformancePurchaseOrderLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformancePurchaseOrderLine_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformancePurchaseOrderLine_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);


CREATE POLICY "SELECT" ON "public"."nonConformancePurchaseOrderLine"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."nonConformancePurchaseOrderLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."nonConformancePurchaseOrderLine"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."nonConformancePurchaseOrderLine"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_delete')
    )::text[]
  )
);

CREATE TABLE "nonConformanceSalesOrderLine" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "nonConformanceId" TEXT NOT NULL,
  "salesOrderLineId" TEXT NOT NULL,
  "salesOrderId" TEXT,
  "salesOrderReadableId" TEXT,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "nonConformanceSalesOrderLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nonConformanceSalesOrderLine_nonConformanceId_fkey" FOREIGN KEY ("nonConformanceId") REFERENCES "nonConformance"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceSalesOrderLine_salesOrderLineId_fkey" FOREIGN KEY ("salesOrderLineId") REFERENCES "salesOrderLine"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "nonConformanceSalesOrderLine_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "salesOrder"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "nonConformanceSalesOrderLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceSalesOrderLine_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceSalesOrderLine_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);


CREATE POLICY "SELECT" ON "public"."nonConformanceSalesOrderLine"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."nonConformanceSalesOrderLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."nonConformanceSalesOrderLine"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."nonConformanceSalesOrderLine"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_delete')
    )::text[]
  )
);

CREATE TABLE "nonConformanceReceiptLine" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "nonConformanceId" TEXT NOT NULL,
  "receiptLineId" TEXT NOT NULL,
  "receiptId" TEXT,
  "receiptReadableId" TEXT,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "nonConformanceReceiptLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nonConformanceReceiptLine_nonConformanceId_fkey" FOREIGN KEY ("nonConformanceId") REFERENCES "nonConformance"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceReceiptLine_receiptLineId_fkey" FOREIGN KEY ("receiptLineId") REFERENCES "receiptLine"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "nonConformanceReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "receipt"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "nonConformanceReceiptLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceReceiptLine_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceReceiptLine_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);


CREATE POLICY "SELECT" ON "public"."nonConformanceReceiptLine"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."nonConformanceReceiptLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."nonConformanceReceiptLine"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."nonConformanceReceiptLine"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_delete')
    )::text[]
  )
);

CREATE TABLE "nonConformanceTrackedEntity" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "nonConformanceId" TEXT NOT NULL,
  "trackedEntityId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "nonConformanceTrackedEntity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nonConformanceTrackedEntity_nonConformanceId_fkey" FOREIGN KEY ("nonConformanceId") REFERENCES "nonConformance"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceTrackedEntity_trackedEntityId_fkey" FOREIGN KEY ("trackedEntityId") REFERENCES "trackedEntity"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "nonConformanceTrackedEntity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceTrackedEntity_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceTrackedEntity_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);


CREATE POLICY "SELECT" ON "public"."nonConformanceTrackedEntity"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."nonConformanceTrackedEntity"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."nonConformanceTrackedEntity"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."nonConformanceTrackedEntity"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_delete')
    )::text[]
  )
);

CREATE TABLE "nonConformanceShipmentLine" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "nonConformanceId" TEXT NOT NULL,
  "shipmentLineId" TEXT NOT NULL,
  "shipmentId" TEXT,
  "shipmentReadableId" TEXT,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "nonConformanceShipmentLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nonConformanceShipmentLine_nonConformanceId_fkey" FOREIGN KEY ("nonConformanceId") REFERENCES "nonConformance"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceShipmentLine_shipmentLineId_fkey" FOREIGN KEY ("shipmentLineId") REFERENCES "shipmentLine"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "nonConformanceShipmentLine_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipment"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "nonConformanceShipmentLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceShipmentLine_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceShipmentLine_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);


CREATE POLICY "SELECT" ON "public"."nonConformanceShipmentLine"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."nonConformanceShipmentLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."nonConformanceShipmentLine"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."nonConformanceShipmentLine"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_delete')
    )::text[]
  )
);

-- Create indexes for join tables
CREATE INDEX "nonConformanceSupplier_nonConformanceId_idx" ON "nonConformanceSupplier" ("nonConformanceId");
CREATE INDEX "nonConformanceSupplier_supplierId_idx" ON "nonConformanceSupplier" ("supplierId");
CREATE INDEX "nonConformanceCustomer_nonConformanceId_idx" ON "nonConformanceCustomer" ("nonConformanceId");
CREATE INDEX "nonConformanceCustomer_customerId_idx" ON "nonConformanceCustomer" ("customerId");
CREATE INDEX "nonConformanceJobOperation_nonConformanceId_idx" ON "nonConformanceJobOperation" ("nonConformanceId");
CREATE INDEX "nonConformanceJobOperation_jobOperationId_idx" ON "nonConformanceJobOperation" ("jobOperationId");
CREATE INDEX "nonConformancePurchaseOrderLine_nonConformanceId_idx" ON "nonConformancePurchaseOrderLine" ("nonConformanceId");
CREATE INDEX "nonConformancePurchaseOrderLine_purchaseOrderLineId_idx" ON "nonConformancePurchaseOrderLine" ("purchaseOrderLineId");
CREATE INDEX "nonConformanceSalesOrderLine_nonConformanceId_idx" ON "nonConformanceSalesOrderLine" ("nonConformanceId");
CREATE INDEX "nonConformanceSalesOrderLine_salesOrderLineId_idx" ON "nonConformanceSalesOrderLine" ("salesOrderLineId");
CREATE INDEX "nonConformanceShipmentLine_nonConformanceId_idx" ON "nonConformanceShipmentLine" ("nonConformanceId");
CREATE INDEX "nonConformanceShipmentLine_shipmentLineId_idx" ON "nonConformanceShipmentLine" ("shipmentLineId");
CREATE INDEX "nonConformanceReceiptLine_nonConformanceId_idx" ON "nonConformanceReceiptLine" ("nonConformanceId");
CREATE INDEX "nonConformanceReceiptLine_receiptLineId_idx" ON "nonConformanceReceiptLine" ("receiptLineId");
CREATE INDEX "nonConformanceTrackedEntity_nonConformanceId_idx" ON "nonConformanceTrackedEntity" ("nonConformanceId");
CREATE INDEX "nonConformanceTrackedEntity_trackedEntityId_idx" ON "nonConformanceTrackedEntity" ("trackedEntityId");

INSERT INTO "customFieldTable" ("table", "name", "module") 
VALUES ('nonConformance', 'Issue', 'Quality');

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


CREATE POLICY "SELECT" ON "public"."nonConformanceInvestigationTask"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."nonConformanceInvestigationTask"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."nonConformanceInvestigationTask"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."nonConformanceInvestigationTask"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_delete')
    )::text[]
  )
);

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

CREATE POLICY "SELECT" ON "public"."nonConformanceActionTask"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."nonConformanceActionTask"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."nonConformanceActionTask"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."nonConformanceActionTask"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_delete')
    )::text[]
  )
);

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


CREATE POLICY "SELECT" ON "public"."nonConformanceApprovalTask"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."nonConformanceApprovalTask"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."nonConformanceApprovalTask"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."nonConformanceApprovalTask"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_delete')
    )::text[]
  )
);


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



CREATE POLICY "SELECT" ON "public"."nonConformanceReviewer"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."nonConformanceReviewer"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."nonConformanceReviewer"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."nonConformanceReviewer"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_delete')
    )::text[]
  )
);

INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 
  'nonConformance',
  'Issue',
  'NCR',
  NULL,
  0,
  6,
  1,
  "id"
FROM "company";
