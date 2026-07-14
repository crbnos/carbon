-- Per-step process data for assembly instructions: tools, fixtures,
-- consumables, notes, and media attachments. Tools/fixtures/consumables can
-- link to the item catalog (same FK target as jobOperationTool.toolId) or be
-- free text; "name" is always snapshotted so display never needs a join and
-- survives catalog item deletion.

CREATE TYPE "assemblyRequirementType" AS ENUM (
  'Tool',
  'Fixture',
  'Consumable',
  'Note',
  'Media'
);

CREATE TYPE "assemblyNoteSeverity" AS ENUM ('Info', 'Caution', 'Warning');

CREATE TABLE "assemblyInstructionStepRequirement" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "stepId" TEXT NOT NULL,
  "type" "assemblyRequirementType" NOT NULL,
  -- Catalog link for Tool/Fixture/Consumable rows
  "itemId" TEXT,
  -- Display name: snapshot of the catalog item name, free text, or media filename
  "name" TEXT,
  -- Note body, or an optional caption for other types
  "text" TEXT,
  -- Note classification (null for non-notes)
  "severity" "assemblyNoteSeverity",
  -- Private-bucket storage path for Media rows
  "filePath" TEXT,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "assemblyInstructionStepRequirement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assemblyInstructionStepRequirement_stepId_fkey"
    FOREIGN KEY ("stepId") REFERENCES "assemblyInstructionStep"("id") ON DELETE CASCADE,
  -- SET NULL (not CASCADE): a deleted catalog item degrades to the snapshotted
  -- name instead of silently vanishing from authored instructions
  CONSTRAINT "assemblyInstructionStepRequirement_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE SET NULL,
  CONSTRAINT "assemblyInstructionStepRequirement_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assemblyInstructionStepRequirement_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assemblyInstructionStepRequirement_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "assemblyInstructionStepRequirement_stepId_idx"
  ON "assemblyInstructionStepRequirement" ("stepId");
CREATE INDEX "assemblyInstructionStepRequirement_stepId_sortOrder_idx"
  ON "assemblyInstructionStepRequirement" ("stepId", "sortOrder");
CREATE INDEX "assemblyInstructionStepRequirement_companyId_idx"
  ON "assemblyInstructionStepRequirement" ("companyId");
CREATE INDEX "assemblyInstructionStepRequirement_itemId_idx"
  ON "assemblyInstructionStepRequirement" ("itemId");

-- Company-level reusable note templates. Inserting one into a step copies its
-- content into a Note requirement (no FK), so editing a template never
-- changes already-authored instructions.
CREATE TABLE "assemblyStandardNote" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "severity" "assemblyNoteSeverity" NOT NULL DEFAULT 'Info',
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "assemblyStandardNote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assemblyStandardNote_name_companyId_key" UNIQUE ("name", "companyId"),
  CONSTRAINT "assemblyStandardNote_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assemblyStandardNote_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assemblyStandardNote_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "assemblyStandardNote_companyId_idx"
  ON "assemblyStandardNote" ("companyId");

ALTER TABLE "assemblyInstructionStepRequirement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assemblyStandardNote" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "assemblyInstructionStepRequirement"
  FOR SELECT USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_view')::text[]
    )
  );

CREATE POLICY "INSERT" ON "assemblyInstructionStepRequirement"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_create')::text[]
    )
  );

CREATE POLICY "UPDATE" ON "assemblyInstructionStepRequirement"
  FOR UPDATE USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_update')::text[]
    )
  );

CREATE POLICY "DELETE" ON "assemblyInstructionStepRequirement"
  FOR DELETE USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_delete')::text[]
    )
  );

CREATE POLICY "SELECT" ON "assemblyStandardNote"
  FOR SELECT USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_view')::text[]
    )
  );

CREATE POLICY "INSERT" ON "assemblyStandardNote"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_create')::text[]
    )
  );

CREATE POLICY "UPDATE" ON "assemblyStandardNote"
  FOR UPDATE USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_update')::text[]
    )
  );

CREATE POLICY "DELETE" ON "assemblyStandardNote"
  FOR DELETE USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_delete')::text[]
    )
  );

-- Bill-of-material parts consumed at a step. Stores itemId (not a
-- methodMaterial FK) so associations survive make-method re-versioning; the
-- UI picker is limited to items on the instruction item's make-method BOM.
-- Unlike requirements, these rows are meaningless without the item, so the
-- FK cascades instead of degrading to a snapshot.
CREATE TABLE "assemblyInstructionStepMaterial" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "stepId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  -- Quantity consumed at this step; null = "as needed"
  "quantity" NUMERIC,
  "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "assemblyInstructionStepMaterial_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assemblyInstructionStepMaterial_stepId_fkey"
    FOREIGN KEY ("stepId") REFERENCES "assemblyInstructionStep"("id") ON DELETE CASCADE,
  CONSTRAINT "assemblyInstructionStepMaterial_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "assemblyInstructionStepMaterial_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assemblyInstructionStepMaterial_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assemblyInstructionStepMaterial_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assemblyInstructionStepMaterial_stepId_itemId_key"
    UNIQUE ("stepId", "itemId")
);

CREATE INDEX "assemblyInstructionStepMaterial_stepId_idx"
  ON "assemblyInstructionStepMaterial" ("stepId");
CREATE INDEX "assemblyInstructionStepMaterial_stepId_sortOrder_idx"
  ON "assemblyInstructionStepMaterial" ("stepId", "sortOrder");
CREATE INDEX "assemblyInstructionStepMaterial_companyId_idx"
  ON "assemblyInstructionStepMaterial" ("companyId");
CREATE INDEX "assemblyInstructionStepMaterial_itemId_idx"
  ON "assemblyInstructionStepMaterial" ("itemId");

ALTER TABLE "assemblyInstructionStepMaterial" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "assemblyInstructionStepMaterial"
  FOR SELECT USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_view')::text[]
    )
  );

CREATE POLICY "INSERT" ON "assemblyInstructionStepMaterial"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_create')::text[]
    )
  );

CREATE POLICY "UPDATE" ON "assemblyInstructionStepMaterial"
  FOR UPDATE USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_update')::text[]
    )
  );

CREATE POLICY "DELETE" ON "assemblyInstructionStepMaterial"
  FOR DELETE USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_delete')::text[]
    )
  );
