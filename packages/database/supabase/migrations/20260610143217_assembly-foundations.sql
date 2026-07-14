-- Assembly instructions (production module): automated/animated 3D work
-- instructions from CAD models. Foundations: model processing columns and
-- the plan job table. Access is governed by the existing production_*
-- permissions.

-- 1. Server-side model processing state on modelUpload
CREATE TYPE "modelProcessingStatus" AS ENUM (
  'Idle',
  'Queued',
  'Processing',
  'Success',
  'Failed'
);

ALTER TABLE "modelUpload" ADD COLUMN "processingStatus" "modelProcessingStatus" NOT NULL DEFAULT 'Idle';
ALTER TABLE "modelUpload" ADD COLUMN "processingError" TEXT;
ALTER TABLE "modelUpload" ADD COLUMN "glbPath" TEXT;
ALTER TABLE "modelUpload" ADD COLUMN "graphPath" TEXT;
ALTER TABLE "modelUpload" ADD COLUMN "componentCount" INTEGER;
ALTER TABLE "modelUpload" ADD COLUMN "processedAt" TIMESTAMP WITH TIME ZONE;

-- 2. Geometry pipeline runs (conversion now, sequence planning later)
CREATE TABLE "assemblyPlanJob" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "modelUploadId" TEXT NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('convert', 'plan')),
  "status" "modelProcessingStatus" NOT NULL DEFAULT 'Queued',
  "planPath" TEXT,
  "stats" JSONB,
  "error" TEXT,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "assemblyPlanJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assemblyPlanJob_modelUploadId_fkey" FOREIGN KEY ("modelUploadId") REFERENCES "modelUpload"("id") ON DELETE CASCADE,
  CONSTRAINT "assemblyPlanJob_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assemblyPlanJob_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "assemblyPlanJob_modelUploadId_idx" ON "assemblyPlanJob"("modelUploadId");
CREATE INDEX "assemblyPlanJob_companyId_idx" ON "assemblyPlanJob"("companyId");

ALTER TABLE "assemblyPlanJob" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "assemblyPlanJob"
  FOR SELECT USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_view')::text[]
    )
  );

CREATE POLICY "INSERT" ON "assemblyPlanJob"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_create')::text[]
    )
  );

CREATE POLICY "UPDATE" ON "assemblyPlanJob"
  FOR UPDATE USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_update')::text[]
    )
  );

CREATE POLICY "DELETE" ON "assemblyPlanJob"
  FOR DELETE USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_delete')::text[]
    )
  );
