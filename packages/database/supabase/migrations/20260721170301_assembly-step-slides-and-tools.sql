-- Assembly step parity with the BOP step definition: a step supports parts,
-- tools, and slides. Adds per-step slides (image XOR 3D model, mirroring
-- methodOperationStepSlide) and per-step tools (tool-type items + quantity,
-- mirroring assemblyInstructionStepMaterial), salvages catalog-linked Tool
-- requirements into the new tools table, then retires the requirements /
-- standard-notes surface entirely (fixtures, consumables, notes, and media
-- have no step-definition equivalent and are dropped by design).
-- All DDL is idempotent: guarded creates first, ON CONFLICT salvage, IF EXISTS
-- drops last — a retried run over committed partial state is a no-op.

-- 1. Per-step slides (image XOR model), mirroring methodOperationStepSlide +
--    the model/size/annotations columns it gained later.
CREATE TABLE IF NOT EXISTS "assemblyInstructionStepSlide" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "stepId" TEXT NOT NULL,
  "imagePath" TEXT,
  "modelUploadId" TEXT,
  "caption" TEXT,
  "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "size" TEXT NOT NULL DEFAULT 'medium',
  "annotations" JSONB NOT NULL DEFAULT '[]',
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "assemblyInstructionStepSlide_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assemblyInstructionStepSlide_stepId_fkey"
    FOREIGN KEY ("stepId") REFERENCES "assemblyInstructionStep"("id") ON DELETE CASCADE,
  CONSTRAINT "assemblyInstructionStepSlide_modelUploadId_fkey"
    FOREIGN KEY ("modelUploadId") REFERENCES "modelUpload"("id") ON DELETE CASCADE,
  CONSTRAINT "assemblyInstructionStepSlide_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assemblyInstructionStepSlide_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assemblyInstructionStepSlide_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  -- A slide is an image or a 3D model, never neither
  CONSTRAINT "assemblyInstructionStepSlide_content_check"
    CHECK ("imagePath" IS NOT NULL OR "modelUploadId" IS NOT NULL),
  CONSTRAINT "assemblyInstructionStepSlide_size_check"
    CHECK ("size" IN ('small', 'medium', 'large'))
);

CREATE INDEX IF NOT EXISTS "assemblyInstructionStepSlide_stepId_idx"
  ON "assemblyInstructionStepSlide" ("stepId");
CREATE INDEX IF NOT EXISTS "assemblyInstructionStepSlide_stepId_sortOrder_idx"
  ON "assemblyInstructionStepSlide" ("stepId", "sortOrder");
CREATE INDEX IF NOT EXISTS "assemblyInstructionStepSlide_companyId_idx"
  ON "assemblyInstructionStepSlide" ("companyId");
CREATE INDEX IF NOT EXISTS "assemblyInstructionStepSlide_modelUploadId_idx"
  ON "assemblyInstructionStepSlide" ("modelUploadId");

ALTER TABLE "public"."assemblyInstructionStepSlide" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."assemblyInstructionStepSlide";
CREATE POLICY "SELECT" ON "public"."assemblyInstructionStepSlide"
  FOR SELECT USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('production_view'))::text[]
    )
  );

DROP POLICY IF EXISTS "INSERT" ON "public"."assemblyInstructionStepSlide";
CREATE POLICY "INSERT" ON "public"."assemblyInstructionStepSlide"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('production_create'))::text[]
    )
  );

DROP POLICY IF EXISTS "UPDATE" ON "public"."assemblyInstructionStepSlide";
CREATE POLICY "UPDATE" ON "public"."assemblyInstructionStepSlide"
  FOR UPDATE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('production_update'))::text[]
    )
  );

DROP POLICY IF EXISTS "DELETE" ON "public"."assemblyInstructionStepSlide";
CREATE POLICY "DELETE" ON "public"."assemblyInstructionStepSlide"
  FOR DELETE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('production_delete'))::text[]
    )
  );

-- 2. Per-step tools, mirroring assemblyInstructionStepMaterial. itemId is a
--    tool-type item — the same target jobOperationTool.toolId references, so
--    the BOP sync maps rows 1:1. Quantity is INTEGER DEFAULT 1 to match
--    jobOperationTool.quantity.
CREATE TABLE IF NOT EXISTS "assemblyInstructionStepTool" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "stepId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "assemblyInstructionStepTool_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assemblyInstructionStepTool_stepId_fkey"
    FOREIGN KEY ("stepId") REFERENCES "assemblyInstructionStep"("id") ON DELETE CASCADE,
  CONSTRAINT "assemblyInstructionStepTool_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "assemblyInstructionStepTool_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assemblyInstructionStepTool_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assemblyInstructionStepTool_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assemblyInstructionStepTool_stepId_itemId_key"
    UNIQUE ("stepId", "itemId")
);

CREATE INDEX IF NOT EXISTS "assemblyInstructionStepTool_stepId_idx"
  ON "assemblyInstructionStepTool" ("stepId");
CREATE INDEX IF NOT EXISTS "assemblyInstructionStepTool_stepId_sortOrder_idx"
  ON "assemblyInstructionStepTool" ("stepId", "sortOrder");
CREATE INDEX IF NOT EXISTS "assemblyInstructionStepTool_companyId_idx"
  ON "assemblyInstructionStepTool" ("companyId");
CREATE INDEX IF NOT EXISTS "assemblyInstructionStepTool_itemId_idx"
  ON "assemblyInstructionStepTool" ("itemId");

ALTER TABLE "public"."assemblyInstructionStepTool" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."assemblyInstructionStepTool";
CREATE POLICY "SELECT" ON "public"."assemblyInstructionStepTool"
  FOR SELECT USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('production_view'))::text[]
    )
  );

DROP POLICY IF EXISTS "INSERT" ON "public"."assemblyInstructionStepTool";
CREATE POLICY "INSERT" ON "public"."assemblyInstructionStepTool"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('production_create'))::text[]
    )
  );

DROP POLICY IF EXISTS "UPDATE" ON "public"."assemblyInstructionStepTool";
CREATE POLICY "UPDATE" ON "public"."assemblyInstructionStepTool"
  FOR UPDATE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('production_update'))::text[]
    )
  );

DROP POLICY IF EXISTS "DELETE" ON "public"."assemblyInstructionStepTool";
CREATE POLICY "DELETE" ON "public"."assemblyInstructionStepTool"
  FOR DELETE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('production_delete'))::text[]
    )
  );

-- 3. Salvage catalog-linked Tool requirements into the new tools table before
--    the requirements surface is dropped. Guarded so a retry after the drop
--    (committed partial state) is a no-op.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'assemblyInstructionStepRequirement'
  ) THEN
    INSERT INTO "assemblyInstructionStepTool"
      ("stepId", "itemId", "quantity", "sortOrder", "companyId", "createdBy", "createdAt")
    SELECT
      r."stepId",
      r."itemId",
      GREATEST(COALESCE(r."quantity", 1), 1),
      r."sortOrder",
      r."companyId",
      r."createdBy",
      r."createdAt"
    FROM "assemblyInstructionStepRequirement" r
    WHERE r."type" = 'Tool' AND r."itemId" IS NOT NULL
    ON CONFLICT ("stepId", "itemId") DO NOTHING;
  END IF;
END $$;

-- 4. Retire the requirements / standard-notes surface. Fixtures, consumables,
--    notes, and media cannot be expressed on a step definition and are
--    eliminated by design (internal-only feature).
DROP TABLE IF EXISTS "assemblyInstructionStepRequirement";
DROP TABLE IF EXISTS "assemblyStandardNote";
DROP TYPE IF EXISTS "assemblyRequirementType";
DROP TYPE IF EXISTS "assemblyNoteSeverity";
