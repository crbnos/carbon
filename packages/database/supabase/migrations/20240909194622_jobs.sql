-- Create jobStatus type
CREATE TYPE "public"."jobStatus" AS ENUM (
  'Draft',
  'Ready',
  'In Progress',
  'Paused',
  'Completed',
  'Cancelled'
);

-- Create deadlineType type
CREATE TYPE "public"."deadlineType" AS ENUM (
  'No Deadline',
  'ASAP',
  'Soft Deadline',
  'Hard Deadline'
);

-- Create job table
CREATE TABLE "public"."job" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "jobId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "type" "itemType" NOT NULL,
  "customerId" TEXT,
  "salesOrderLineId" TEXT,
  "status" "jobStatus" NOT NULL DEFAULT 'Draft',
  "dueDate" DATE,
  "deadlineType" "deadlineType" NOT NULL DEFAULT 'No Deadline',
  "description" TEXT,
  "notes" JSONB DEFAULT '{}'::jsonb,
  "assignee" TEXT,
  "customFields" JSONB,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "job_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "job_jobId_key" UNIQUE ("jobId", "companyId"),
  CONSTRAINT "job_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "job_type_check" CHECK ("type" IN ('Part', 'Material', 'Tool', 'Service', 'Consumable', 'Fixture')),
  CONSTRAINT "job_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "job_salesOrderLineId_fkey" FOREIGN KEY ("salesOrderLineId") REFERENCES "salesOrderLine" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "job_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "job_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "job_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "job_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Add comments for the job table
COMMENT ON TABLE "public"."job" IS 'Stores information about jobs';
COMMENT ON COLUMN "public"."job"."jobId" IS 'Unique identifier for the job within the company';
COMMENT ON COLUMN "public"."job"."status" IS 'Current status of the job (e.g., Draft, In Progress, Completed)';
COMMENT ON COLUMN "public"."job"."dueDate" IS 'Due date for the job';
COMMENT ON COLUMN "public"."job"."description" IS 'Brief description of the job';
COMMENT ON COLUMN "public"."job"."notes" IS 'Additional notes or comments about the job';
COMMENT ON COLUMN "public"."job"."assignee" IS 'User assigned to manage or oversee the job';

-- Create index for faster lookups
CREATE INDEX "idx_job_companyId" ON "public"."job" ("companyId");
CREATE INDEX "idx_job_customerId" ON "public"."job" ("customerId");
CREATE INDEX "idx_job_status" ON "public"."job" ("status");
CREATE INDEX "idx_job_salesOrderLineId" ON "public"."job" ("salesOrderLineId");

-- Create jobMaterial table
CREATE TABLE "public"."jobMaterial" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "jobId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "itemReadableId" TEXT NOT NULL,
  "itemType" TEXT NOT NULL DEFAULT 'Part',
  "methodType" "methodType" NOT NULL DEFAULT 'Make',
  "order" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "description" TEXT NOT NULL,
  "quantity" NUMERIC(10, 4) NOT NULL DEFAULT 0,
  "unitOfMeasureCode" TEXT,
  "unitCost" NUMERIC(10, 4) NOT NULL DEFAULT 0,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,
  "customFields" JSONB,

  CONSTRAINT "jobMaterial_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "jobMaterial_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "jobMaterial_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "jobMaterial_unitOfMeasureCode_fkey" FOREIGN KEY ("unitOfMeasureCode", "companyId") REFERENCES "unitOfMeasure" ("code", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "jobMaterial_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "jobMaterial_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "jobMaterial_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "jobMaterial_jobId_idx" ON "public"."jobMaterial" ("jobId");

-- Create jobOperation table
CREATE TABLE "public"."jobOperation" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "jobId" TEXT NOT NULL,
  "order" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "processId" TEXT NOT NULL,
  "workCenterId" TEXT,
  "description" TEXT,
  "setupTime" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "setupUnit" factor NOT NULL DEFAULT 'Total Hours',
  "laborTime" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "laborUnit" factor NOT NULL DEFAULT 'Hours/Piece',
  "machineTime" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "machineUnit" factor NOT NULL DEFAULT 'Hours/Piece',
  "operationOrder" "methodOperationOrder" NOT NULL DEFAULT 'After Previous',
  "quotingRate" NUMERIC(10,4) NOT NULL DEFAULT 0,
  "laborRate" NUMERIC(10,4) NOT NULL DEFAULT 0,
  "overheadRate" NUMERIC(10,4) NOT NULL DEFAULT 0,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,
  "customFields" JSONB,

  CONSTRAINT "jobOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "jobOperation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "jobOperation_processId_fkey" FOREIGN KEY ("processId") REFERENCES "process" ("id") ON DELETE RESTRICT,
  CONSTRAINT "jobOperation_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "workCenter" ("id") ON DELETE RESTRICT,
  CONSTRAINT "jobOperation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "jobOperation_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "jobOperation_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "jobOperation_jobId_idx" ON "public"."jobOperation" ("jobId");

-- Add jobOperationId to jobMaterial table
ALTER TABLE "public"."jobMaterial" ADD COLUMN "jobOperationId" TEXT,
  ADD CONSTRAINT "jobMaterial_jobOperationId_fkey" FOREIGN KEY ("jobOperationId") REFERENCES "jobOperation" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "jobMaterial_jobOperationId_idx" ON "public"."jobMaterial" ("jobOperationId");

-- Add comments for the new tables
COMMENT ON TABLE "public"."jobMaterial" IS 'Stores information about materials used in jobs';
COMMENT ON TABLE "public"."jobOperation" IS 'Stores information about operations performed in jobs';

-- Create jobOperationWorkInstruction table
CREATE TABLE "public"."jobOperationWorkInstruction" (
  "jobOperationId" TEXT NOT NULL,
  "content" JSON DEFAULT '{}'::json,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "jobOperationWorkInstruction_pkey" PRIMARY KEY ("jobOperationId"),
  CONSTRAINT "jobOperationWorkInstruction_jobOperationId_fkey" FOREIGN KEY ("jobOperationId") REFERENCES "jobOperation" ("id") ON DELETE CASCADE,
  CONSTRAINT "jobOperationWorkInstruction_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "jobOperationWorkInstruction_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE FUNCTION public.create_job_operation_work_instruction()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public."jobOperationWorkInstruction"("jobOperationId", "createdBy", "companyId")
  VALUES (new."id", new."createdBy", new."companyId");
  
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER create_job_operation_related_records
  AFTER INSERT on public."jobOperation"
  FOR EACH ROW EXECUTE PROCEDURE public.create_job_operation_work_instruction();