-- Assembly instructions: editable, versioned, animated 3D work instructions
-- authored against a processed model upload.

CREATE TYPE "assemblyInstructionStatus" AS ENUM (
  'Draft',
  'Published',
  'Archived'
);

CREATE TABLE "assemblyInstruction" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL,
  "modelUploadId" TEXT NOT NULL,
  "itemId" TEXT,
  "assemblyPlanJobId" TEXT,
  "status" "assemblyInstructionStatus" NOT NULL DEFAULT 'Draft',
  "version" INTEGER NOT NULL DEFAULT 1,
  "publishedAt" TIMESTAMP WITH TIME ZONE,
  "settings" JSONB,
  "companyId" TEXT NOT NULL,
  "customFields" JSONB,
  "tags" TEXT[],
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "assemblyInstruction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assemblyInstruction_modelUploadId_fkey" FOREIGN KEY ("modelUploadId") REFERENCES "modelUpload"("id") ON DELETE CASCADE,
  CONSTRAINT "assemblyInstruction_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE SET NULL,
  CONSTRAINT "assemblyInstruction_assemblyPlanJobId_fkey" FOREIGN KEY ("assemblyPlanJobId") REFERENCES "assemblyPlanJob"("id") ON DELETE SET NULL,
  CONSTRAINT "assemblyInstruction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assemblyInstruction_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assemblyInstruction_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "assemblyInstruction_companyId_idx" ON "assemblyInstruction"("companyId");
CREATE INDEX "assemblyInstruction_modelUploadId_idx" ON "assemblyInstruction"("modelUploadId");
CREATE INDEX "assemblyInstruction_itemId_idx" ON "assemblyInstruction"("itemId");

CREATE TABLE "assemblyInstructionStep" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "assemblyInstructionId" TEXT NOT NULL,
  "parentStepId" TEXT,
  "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "title" TEXT,
  -- Typed-step shape mirrors "jobOperationStep" so steps can eventually be
  -- copied into job operations. "instructionText" is a derived plain-text
  -- snapshot of "description" (tiptap JSON) consumed by the 3D viewer overlay.
  "type" "procedureStepType" NOT NULL DEFAULT 'Task',
  "description" JSON DEFAULT '{}',
  "instructionText" TEXT,
  "required" BOOLEAN DEFAULT FALSE,
  "unitOfMeasureCode" TEXT,
  "minValue" NUMERIC,
  "maxValue" NUMERIC,
  "listValues" TEXT[],
  "fileTypes" TEXT[],
  "notes" JSON,
  "componentNodeIds" TEXT[] NOT NULL DEFAULT '{}',
  "motion" JSONB NOT NULL DEFAULT '{"type": "none"}',
  "camera" JSONB,
  "explode" JSONB,
  "fastener" JSONB,
  "warnings" JSONB,
  "planConfidence" TEXT NOT NULL DEFAULT 'manual' CHECK ("planConfidence" IN ('high', 'low', 'manual')),
  "durationSeconds" NUMERIC,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "assemblyInstructionStep_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assemblyInstructionStep_assemblyInstructionId_fkey" FOREIGN KEY ("assemblyInstructionId") REFERENCES "assemblyInstruction"("id") ON DELETE CASCADE,
  CONSTRAINT "assemblyInstructionStep_parentStepId_fkey" FOREIGN KEY ("parentStepId") REFERENCES "assemblyInstructionStep"("id") ON DELETE SET NULL,
  CONSTRAINT "assemblyInstructionStep_unitOfMeasureCode_fkey" FOREIGN KEY ("unitOfMeasureCode", "companyId") REFERENCES "unitOfMeasure"("code", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assemblyInstructionStep_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assemblyInstructionStep_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assemblyInstructionStep_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "assemblyInstructionStep_assemblyInstructionId_idx" ON "assemblyInstructionStep"("assemblyInstructionId");
CREATE INDEX "assemblyInstructionStep_assemblyInstructionId_sortOrder_idx" ON "assemblyInstructionStep"("assemblyInstructionId", "sortOrder");
CREATE INDEX "assemblyInstructionStep_companyId_idx" ON "assemblyInstructionStep"("companyId");

ALTER TABLE "assemblyInstruction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assemblyInstructionStep" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "assemblyInstruction"
  FOR SELECT USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_view')::text[]
    )
  );

CREATE POLICY "INSERT" ON "assemblyInstruction"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_create')::text[]
    )
  );

CREATE POLICY "UPDATE" ON "assemblyInstruction"
  FOR UPDATE USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_update')::text[]
    )
  );

CREATE POLICY "DELETE" ON "assemblyInstruction"
  FOR DELETE USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_delete')::text[]
    )
  );

CREATE POLICY "SELECT" ON "assemblyInstructionStep"
  FOR SELECT USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_view')::text[]
    )
  );

CREATE POLICY "INSERT" ON "assemblyInstructionStep"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_create')::text[]
    )
  );

CREATE POLICY "UPDATE" ON "assemblyInstructionStep"
  FOR UPDATE USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_update')::text[]
    )
  );

CREATE POLICY "DELETE" ON "assemblyInstructionStep"
  FOR DELETE USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_delete')::text[]
    )
  );

-- Opt-in linkage for MES playback and method authoring
DROP VIEW IF EXISTS "jobOperationsWithDependencies";
DROP VIEW IF EXISTS "jobOperationsWithMakeMethods";

ALTER TABLE "jobOperation" ADD COLUMN "assemblyInstructionId" TEXT;
ALTER TABLE "jobOperation" ADD CONSTRAINT "jobOperation_assemblyInstructionId_fkey"
  FOREIGN KEY ("assemblyInstructionId") REFERENCES "assemblyInstruction"("id") ON DELETE SET NULL;
CREATE INDEX "jobOperation_assemblyInstructionId_idx" ON "jobOperation"("assemblyInstructionId");

ALTER TABLE "methodOperation" ADD COLUMN "assemblyInstructionId" TEXT;
ALTER TABLE "methodOperation" ADD CONSTRAINT "methodOperation_assemblyInstructionId_fkey"
  FOREIGN KEY ("assemblyInstructionId") REFERENCES "assemblyInstruction"("id") ON DELETE SET NULL;
CREATE INDEX "methodOperation_assemblyInstructionId_idx" ON "methodOperation"("assemblyInstructionId");

CREATE OR REPLACE VIEW "jobOperationsWithMakeMethods" WITH(SECURITY_INVOKER=true) AS
  SELECT
    mm.id AS "makeMethodId",
    jo.*
  FROM "jobOperation" jo
  INNER JOIN "jobMakeMethod" jmm
    ON jo."jobMakeMethodId" = jmm.id
  LEFT JOIN "makeMethod" mm
    ON jmm."itemId" = mm."itemId" AND jmm."version" = mm."version";

CREATE VIEW "jobOperationsWithDependencies"
WITH (security_invoker = true)
AS
SELECT
  jo.*,
  COALESCE(
    (
      SELECT array_agg(jod."dependsOnId")
      FROM "jobOperationDependency" jod
      WHERE jod."operationId" = jo.id
    ),
    '{}'::text[]
  ) AS "dependencies"
FROM "jobOperation" jo;
