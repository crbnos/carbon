-- Cut Lists — foundation.
--
-- A cut list tells a saw operator which pieces to cut, at what dimensions, from
-- which stock. Carbon had no length anywhere in the schema, so 144" of bar on
-- hand could be one full bar or three drops and nothing could tell them apart.
--
-- Adds:
--   1. itemStockDimension — numeric stock sizes for material size-items
--   2. cutList / cutListLine / cutPattern — the document, its demand, its plans
--   3. cut fields on the three material-line tables (method/quote/job)
--   4. process.isCuttingProcess + default saw parameters
--   5. materialForm.dimensionality (1D bar/tube vs 2D sheet/plate)
--   6. the CL sequence for existing companies
--
-- Permission scopes follow the tables these sit beside: cut lists are
-- production-floor work (production_*), stock dimensions are item master data
-- (parts_*, matching "material"). No new permission family — see .ai/lessons.md
-- "Features live inside existing permission modules".
--
-- FK note: item/job/jobMaterial/location/workCenter/process/trackedEntity all
-- have SINGLE-column PKs, so FKs out to them are single-column. The new tables
-- here use the current composite ("id", "companyId") convention, so
-- cutListLine/cutPattern reference cutList with a composite FK.
--
-- The 'Cut List Consumption' itemLedgerDocumentType value ships in its own
-- migration — ALTER TYPE ... ADD VALUE cannot be used by other statements in
-- the same transaction.

-- -----------------------------------------------------------------------------
-- 1. Status enum
-- -----------------------------------------------------------------------------
-- CREATE TYPE has no IF NOT EXISTS; guard so a re-run after a partial deploy
-- doesn't trip on an already-created type.
DO $$ BEGIN
  CREATE TYPE "cutListStatus" AS ENUM ('Draft', 'Released', 'In Progress', 'Completed', 'Cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -----------------------------------------------------------------------------
-- 2. itemStockDimension — numeric stock sizes (1:1 with a material size-item)
-- -----------------------------------------------------------------------------
-- Each purchasable size stays its own item revision (unchanged behavior); this
-- sidecar makes the size queryable data instead of a free-text string.
CREATE TABLE IF NOT EXISTS "itemStockDimension" (
  "id" TEXT NOT NULL DEFAULT id('isd'),
  "companyId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "stockLength" NUMERIC,
  "stockWidth" NUMERIC,
  "stockThickness" NUMERIC,
  "unitOfDimension" TEXT NOT NULL DEFAULT 'in',
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "itemStockDimension_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "itemStockDimension_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "itemStockDimension_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "itemStockDimension_itemId_companyId_key" UNIQUE ("itemId", "companyId"),
  CONSTRAINT "itemStockDimension_unitOfDimension_check" CHECK ("unitOfDimension" IN ('in', 'ft', 'mm', 'cm', 'm')),
  CONSTRAINT "itemStockDimension_stockLength_check" CHECK ("stockLength" IS NULL OR "stockLength" > 0),
  CONSTRAINT "itemStockDimension_stockWidth_check" CHECK ("stockWidth" IS NULL OR "stockWidth" > 0),
  CONSTRAINT "itemStockDimension_stockThickness_check" CHECK ("stockThickness" IS NULL OR "stockThickness" > 0)
);

CREATE INDEX IF NOT EXISTS "itemStockDimension_companyId_idx" ON "itemStockDimension" ("companyId");
CREATE INDEX IF NOT EXISTS "itemStockDimension_itemId_idx" ON "itemStockDimension" ("itemId");
CREATE INDEX IF NOT EXISTS "itemStockDimension_createdBy_idx" ON "itemStockDimension" ("createdBy");

ALTER TABLE "public"."itemStockDimension" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."itemStockDimension"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE POLICY "INSERT" ON "public"."itemStockDimension"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."itemStockDimension"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."itemStockDimension"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_delete'))::text[])
);

-- -----------------------------------------------------------------------------
-- 3. cutList — the stateful document
-- -----------------------------------------------------------------------------
-- Saw parameters live on the header, seeded from the process defaults but
-- overridable per run (a worn blade cuts a wider kerf than the machine default).
CREATE TABLE IF NOT EXISTS "cutList" (
  "id" TEXT NOT NULL DEFAULT id('cutl'),
  "companyId" TEXT NOT NULL,
  "cutListId" TEXT NOT NULL,
  "locationId" TEXT,
  "processId" TEXT,
  "workCenterId" TEXT,
  "status" "cutListStatus" NOT NULL DEFAULT 'Draft',
  "kerf" NUMERIC NOT NULL DEFAULT 0,
  "endTrim" NUMERIC NOT NULL DEFAULT 0,
  "gripMargin" NUMERIC NOT NULL DEFAULT 0,
  "minRemnantLength" NUMERIC NOT NULL DEFAULT 0,
  "unitOfDimension" TEXT NOT NULL DEFAULT 'in',
  "plannedYieldPct" NUMERIC,
  "actualYieldPct" NUMERIC,
  "assignee" TEXT REFERENCES "user"("id"),
  "notes" JSONB,
  "completedDate" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "cutList_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "cutList_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "cutList_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE SET NULL,
  CONSTRAINT "cutList_processId_fkey" FOREIGN KEY ("processId") REFERENCES "process"("id") ON DELETE SET NULL,
  CONSTRAINT "cutList_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "workCenter"("id") ON DELETE SET NULL,
  CONSTRAINT "cutList_companyId_cutListId_key" UNIQUE ("companyId", "cutListId"),
  CONSTRAINT "cutList_unitOfDimension_check" CHECK ("unitOfDimension" IN ('in', 'ft', 'mm', 'cm', 'm')),
  CONSTRAINT "cutList_kerf_check" CHECK ("kerf" >= 0),
  CONSTRAINT "cutList_endTrim_check" CHECK ("endTrim" >= 0),
  CONSTRAINT "cutList_gripMargin_check" CHECK ("gripMargin" >= 0),
  CONSTRAINT "cutList_minRemnantLength_check" CHECK ("minRemnantLength" >= 0)
);

CREATE INDEX IF NOT EXISTS "cutList_companyId_idx" ON "cutList" ("companyId");
CREATE INDEX IF NOT EXISTS "cutList_createdBy_idx" ON "cutList" ("createdBy");
CREATE INDEX IF NOT EXISTS "cutList_processId_idx" ON "cutList" ("processId");
CREATE INDEX IF NOT EXISTS "cutList_locationId_idx" ON "cutList" ("locationId");
CREATE INDEX IF NOT EXISTS "cutList_workCenterId_idx" ON "cutList" ("workCenterId");
CREATE INDEX IF NOT EXISTS "cutList_assignee_idx" ON "cutList" ("assignee");
CREATE INDEX IF NOT EXISTS "cutList_status_idx" ON "cutList" ("companyId", "status");

ALTER TABLE "public"."cutList" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."cutList"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE POLICY "INSERT" ON "public"."cutList"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."cutList"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."cutList"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_delete'))::text[])
);

-- -----------------------------------------------------------------------------
-- 4. cutListLine — demand: N pieces of one length, for one job
-- -----------------------------------------------------------------------------
-- jobId/jobMaterialId are the demand pedigree. Keeping them on every line is
-- what lets one run serve many jobs and still settle cost and traceability back
-- per job — the thing job-batching in other ERPs gets wrong.
CREATE TABLE IF NOT EXISTS "cutListLine" (
  "id" TEXT NOT NULL DEFAULT id('cutln'),
  "companyId" TEXT NOT NULL,
  "cutListId" TEXT NOT NULL,
  "jobId" TEXT,
  "jobMaterialId" TEXT,
  "itemId" TEXT NOT NULL,
  "pieceLength" NUMERIC NOT NULL,
  "pieceWidth" NUMERIC,
  "quantity" INTEGER NOT NULL,
  "quantityCut" INTEGER NOT NULL DEFAULT 0,
  "order" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "cutListLine_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "cutListLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "cutListLine_cutListId_fkey" FOREIGN KEY ("cutListId", "companyId") REFERENCES "cutList"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "cutListLine_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE SET NULL,
  CONSTRAINT "cutListLine_jobMaterialId_fkey" FOREIGN KEY ("jobMaterialId") REFERENCES "jobMaterial"("id") ON DELETE SET NULL,
  CONSTRAINT "cutListLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cutListLine_pieceLength_check" CHECK ("pieceLength" > 0),
  CONSTRAINT "cutListLine_pieceWidth_check" CHECK ("pieceWidth" IS NULL OR "pieceWidth" > 0),
  CONSTRAINT "cutListLine_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "cutListLine_quantityCut_check" CHECK ("quantityCut" >= 0)
);

CREATE INDEX IF NOT EXISTS "cutListLine_companyId_idx" ON "cutListLine" ("companyId");
CREATE INDEX IF NOT EXISTS "cutListLine_cutListId_idx" ON "cutListLine" ("cutListId");
CREATE INDEX IF NOT EXISTS "cutListLine_jobId_idx" ON "cutListLine" ("jobId");
CREATE INDEX IF NOT EXISTS "cutListLine_jobMaterialId_idx" ON "cutListLine" ("jobMaterialId");
CREATE INDEX IF NOT EXISTS "cutListLine_itemId_idx" ON "cutListLine" ("itemId");
CREATE INDEX IF NOT EXISTS "cutListLine_createdBy_idx" ON "cutListLine" ("createdBy");

ALTER TABLE "public"."cutListLine" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."cutListLine"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE POLICY "INSERT" ON "public"."cutListLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."cutListLine"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."cutListLine"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_delete'))::text[])
);

-- -----------------------------------------------------------------------------
-- 5. cutPattern — one stock unit's cut sequence, produced by the optimizer
-- -----------------------------------------------------------------------------
-- "pattern" holds the ordered cuts as [{ cutListLineId, pieceLength }, ...].
-- The optimizer rewrites these wholesale (delete + insert) on every run, so
-- nothing downstream may hold a long-lived reference to a pattern id.
CREATE TABLE IF NOT EXISTS "cutPattern" (
  "id" TEXT NOT NULL DEFAULT id('cutp'),
  "companyId" TEXT NOT NULL,
  "cutListId" TEXT NOT NULL,
  "stockItemId" TEXT NOT NULL,
  "trackedEntityId" TEXT,
  "sequence" INTEGER NOT NULL,
  "pattern" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "stockLength" NUMERIC,
  "piecesLength" NUMERIC,
  "expectedRemnant" NUMERIC,
  "actualRemnant" NUMERIC,
  "isComplete" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "cutPattern_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "cutPattern_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "cutPattern_cutListId_fkey" FOREIGN KEY ("cutListId", "companyId") REFERENCES "cutList"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "cutPattern_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "item"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cutPattern_trackedEntityId_fkey" FOREIGN KEY ("trackedEntityId") REFERENCES "trackedEntity"("id") ON DELETE SET NULL,
  CONSTRAINT "cutPattern_sequence_check" CHECK ("sequence" > 0)
);

CREATE INDEX IF NOT EXISTS "cutPattern_companyId_idx" ON "cutPattern" ("companyId");
CREATE INDEX IF NOT EXISTS "cutPattern_cutListId_idx" ON "cutPattern" ("cutListId");
CREATE INDEX IF NOT EXISTS "cutPattern_stockItemId_idx" ON "cutPattern" ("stockItemId");
CREATE INDEX IF NOT EXISTS "cutPattern_trackedEntityId_idx" ON "cutPattern" ("trackedEntityId");
CREATE INDEX IF NOT EXISTS "cutPattern_createdBy_idx" ON "cutPattern" ("createdBy");

ALTER TABLE "public"."cutPattern" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."cutPattern"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE POLICY "INSERT" ON "public"."cutPattern"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."cutPattern"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."cutPattern"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_delete'))::text[])
);

-- -----------------------------------------------------------------------------
-- 6. Cut requirements on the material lines
-- -----------------------------------------------------------------------------
-- cutLength is the length of ONE piece. Quantity stays "quantity per parent" —
-- a part needing 4 pieces of 5.7" sets quantity 4 and cutLength 5.7, instead of
-- smearing 22.8 into quantity and losing the piece count.
ALTER TABLE "methodMaterial"
  ADD COLUMN IF NOT EXISTS "cutLength" NUMERIC,
  ADD COLUMN IF NOT EXISTS "cutWidth" NUMERIC,
  ADD COLUMN IF NOT EXISTS "grainLocked" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "quoteMaterial"
  ADD COLUMN IF NOT EXISTS "cutLength" NUMERIC,
  ADD COLUMN IF NOT EXISTS "cutWidth" NUMERIC,
  ADD COLUMN IF NOT EXISTS "grainLocked" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "jobMaterial"
  ADD COLUMN IF NOT EXISTS "cutLength" NUMERIC,
  ADD COLUMN IF NOT EXISTS "cutWidth" NUMERIC,
  ADD COLUMN IF NOT EXISTS "grainLocked" BOOLEAN NOT NULL DEFAULT FALSE;

-- -----------------------------------------------------------------------------
-- 7. Cutting processes and their machine defaults
-- -----------------------------------------------------------------------------
-- The flag goes on the process, not the part: a bracket is cut on the saw and
-- formed on the brake — the machine decides, not the item.
ALTER TABLE "process"
  ADD COLUMN IF NOT EXISTS "isCuttingProcess" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "defaultKerf" NUMERIC,
  ADD COLUMN IF NOT EXISTS "defaultEndTrim" NUMERIC,
  ADD COLUMN IF NOT EXISTS "defaultGripMargin" NUMERIC,
  ADD COLUMN IF NOT EXISTS "defaultMinRemnantLength" NUMERIC;

-- -----------------------------------------------------------------------------
-- 8. Material form dimensionality — drives which optimizer and which fields
-- -----------------------------------------------------------------------------
ALTER TABLE "materialForm"
  ADD COLUMN IF NOT EXISTS "dimensionality" TEXT;

ALTER TABLE "materialForm"
  DROP CONSTRAINT IF EXISTS "materialForm_dimensionality_check";
ALTER TABLE "materialForm"
  ADD CONSTRAINT "materialForm_dimensionality_check"
  CHECK ("dimensionality" IS NULL OR "dimensionality" IN ('1D', '2D'));

-- Seed the system shapes (companyId IS NULL). Linear stock cuts to length; area
-- stock nests in two dimensions. Company-created shapes stay NULL until someone
-- sets one — a NULL dimensionality simply means "not cut stock".
UPDATE "materialForm"
SET "dimensionality" = '1D'
WHERE "companyId" IS NULL
  AND "code" IN ('roundbar', 'roundtube', 'recttube', 'squaretube', 'flatbar', 'hexbar', 'angle', 'channel', 'wbeam')
  AND "dimensionality" IS NULL;

UPDATE "materialForm"
SET "dimensionality" = '2D'
WHERE "companyId" IS NULL
  AND "code" IN ('sheet', 'plate', 'treadplate')
  AND "dimensionality" IS NULL;

-- -----------------------------------------------------------------------------
-- 9. Sequence seed — CL000001 per company
-- -----------------------------------------------------------------------------
-- seed.data.ts covers NEW companies; this covers the ones that already exist.
-- Both are required — see .ai/lessons.md on seed/migration drift.
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'cutList', 'Cut List', 'CL', NULL, 0, 6, 1, "id"
FROM "company"
ON CONFLICT ("table", "companyId") DO NOTHING;

-- -----------------------------------------------------------------------------
-- 10. List view
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW "cutLists" WITH(SECURITY_INVOKER=true) AS
SELECT
  cl.*,
  l."name" AS "locationName",
  p."name" AS "processName",
  wc."name" AS "workCenterName",
  u."fullName" AS "createdByFullName",
  a."fullName" AS "assigneeFullName",
  COALESCE(lines."lineCount", 0) AS "lineCount",
  COALESCE(lines."totalPieces", 0) AS "totalPieces",
  COALESCE(lines."totalPiecesCut", 0) AS "totalPiecesCut"
FROM "cutList" cl
LEFT JOIN "location" l ON l."id" = cl."locationId"
LEFT JOIN "process" p ON p."id" = cl."processId"
LEFT JOIN "workCenter" wc ON wc."id" = cl."workCenterId"
LEFT JOIN "user" u ON u."id" = cl."createdBy"
LEFT JOIN "user" a ON a."id" = cl."assignee"
LEFT JOIN (
  SELECT
    "cutListId",
    "companyId",
    COUNT(*) AS "lineCount",
    SUM("quantity") AS "totalPieces",
    SUM("quantityCut") AS "totalPiecesCut"
  FROM "cutListLine"
  GROUP BY "cutListId", "companyId"
) lines ON lines."cutListId" = cl."id" AND lines."companyId" = cl."companyId";
