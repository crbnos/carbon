-- ===== 20260616132744_operation-kind.sql =====
-- Per-operation classification (operationKind) that drives the MES view router.
-- See .ai/specs/2026-07-14-mes-execution-views.md (§5.1 view routing). Tracking type
-- stays orthogonal. NOTE: the inspection-plan link (inspectionDocumentId) is deliberately
-- deferred to the Inspection workstream (Phase 3) so this keystone migration does not
-- depend on the inspection tables — see §5.4 of that spec.

-- 1. Classification enum. 'Operation' preserves today's behavior (the safe default).
-- Guarded so re-running against a DB that already has the type (a shared dev
-- volume whose bookkeeping was pruned by the branch-switch migration repair) is a
-- no-op instead of a hard failure.
DO $$ BEGIN
  CREATE TYPE "operationKind" AS ENUM (
    'Operation',
    'Assembly',
    'Inspection'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. Add operationKind to the three operation tables.
ALTER TABLE "methodOperation"
  ADD COLUMN IF NOT EXISTS "operationKind" "operationKind" NOT NULL DEFAULT 'Operation';

ALTER TABLE "jobOperation"
  ADD COLUMN IF NOT EXISTS "operationKind" "operationKind" NOT NULL DEFAULT 'Operation';

ALTER TABLE "quoteOperation"
  ADD COLUMN IF NOT EXISTS "operationKind" "operationKind" NOT NULL DEFAULT 'Operation';

-- 3. Expose operationKind through the MES operation RPC so the view router can read it.
--    Mirrors 20260531084723_rework-serial-flow.sql; only the trailing column is new.
DROP FUNCTION IF EXISTS get_job_operation_by_id(TEXT);
CREATE OR REPLACE FUNCTION get_job_operation_by_id(operation_id TEXT)
RETURNS TABLE (
  id TEXT,
  "jobId" TEXT,
  "jobMakeMethodId" TEXT,
  "operationOrder" DOUBLE PRECISION,
  "processId" TEXT,
  "workCenterId" TEXT,
  description TEXT,
  "setupTime" NUMERIC,
  "setupUnit" factor,
  "laborTime" NUMERIC,
  "laborUnit" factor,
  "machineTime" NUMERIC,
  "machineUnit" factor,
  "operationOrderType" "methodOperationOrder",
  "jobReadableId" TEXT,
  "jobStatus" "jobStatus",
  "jobDueDate" DATE,
  "jobDeadlineType" "deadlineType",
  "parentMaterialId" TEXT,
  "itemId" TEXT,
  "itemReadableId" TEXT,
  "itemDescription" TEXT,
  "itemUnitOfMeasure" TEXT,
  "itemModelPath" TEXT,
  "itemModelId" TEXT,
  "itemModelName" TEXT,
  "itemModelSize" BIGINT,
  "operationStatus" "jobOperationStatus",
  "targetQuantity" NUMERIC,
  "operationQuantity" NUMERIC,
  "quantityComplete" NUMERIC,
  "quantityReworked" NUMERIC,
  "quantityScrapped" NUMERIC,
  "workInstruction" JSON,
  "operationDueDate" DATE,
  "reworkId" TEXT,
  "operationKind" "operationKind"
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    jo."id",
    jo."jobId",
    jo."jobMakeMethodId",
    jo."order" AS "operationOrder",
    jo."processId",
    jo."workCenterId",
    jo."description",
    jo."setupTime",
    jo."setupUnit",
    jo."laborTime",
    jo."laborUnit",
    jo."machineTime",
    jo."machineUnit",
    jo."operationOrder" AS "operationOrderType",
    j."jobId" AS "jobReadableId",
    j."status" AS "jobStatus",
    j."dueDate"::DATE AS "jobDueDate",
    j."deadlineType" AS "jobDeadlineType",
    jmm."parentMaterialId",
    i."id" as "itemId",
    i."readableIdWithRevision" as "itemReadableId",
    i."name" as "itemDescription",
    uom."name" as "itemUnitOfMeasure",
    m."modelPath" as "itemModelPath",
    m."id" as "itemModelId",
    m."name" as "itemModelName",
    m."size" as "itemModelSize",
    jo."status" AS "operationStatus",
    jo."targetQuantity"::NUMERIC,
    jo."operationQuantity",
    jo."quantityComplete",
    jo."quantityReworked",
    jo."quantityScrapped",
    jo."workInstruction",
    jo."dueDate" AS "operationDueDate",
    jo."reworkId",
    jo."operationKind"
  FROM "jobOperation" jo
  JOIN "job" j ON j.id = jo."jobId"
  LEFT JOIN "jobMakeMethod" jmm ON jo."jobMakeMethodId" = jmm.id
  LEFT JOIN "item" i ON jmm."itemId" = i.id
  LEFT JOIN "unitOfMeasure" uom ON i."unitOfMeasureCode" = uom."code" AND i."companyId" = uom."companyId"
  LEFT JOIN "modelUpload" m ON i."modelUploadId" = m.id
  WHERE jo.id = operation_id
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- ===== 20260621154233_operation-step-slides.sql =====
-- Step reference images ("slides"). A first-class child of an operation step holding a
-- single reference image (+ optional caption + order), authored on the method (template)
-- and copied to the job/quote by get-method, exactly like steps/tools/parameters.
-- See .ai/specs/2026-07-14-mes-execution-views.md §4. Mirrors the *OperationStep tables
-- (single TEXT id PK,
-- companyId column, stepId FK ON DELETE CASCADE, production_* RLS).

-- 1. Template slides (authored in the BOP editor)
-- IF NOT EXISTS / drop-before-create so a re-run (shared dev volume whose bookkeeping
-- was pruned by the branch-switch migration repair) is a no-op instead of a hard failure.
CREATE TABLE IF NOT EXISTS "methodOperationStepSlide" (
  "id" TEXT NOT NULL DEFAULT id('slide'),
  "stepId" TEXT NOT NULL,
  "imagePath" TEXT NOT NULL,
  "caption" TEXT,
  "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "methodOperationStepSlide_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "methodOperationStepSlide_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "methodOperationStep"("id") ON DELETE CASCADE,
  CONSTRAINT "methodOperationStepSlide_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "methodOperationStepSlide_stepId_idx" ON "methodOperationStepSlide" ("stepId");
CREATE INDEX IF NOT EXISTS "methodOperationStepSlide_companyId_idx" ON "methodOperationStepSlide" ("companyId");

-- 2. Job slides (copied from the template by get-method)
CREATE TABLE IF NOT EXISTS "jobOperationStepSlide" (
  "id" TEXT NOT NULL DEFAULT id('slide'),
  "stepId" TEXT NOT NULL,
  "imagePath" TEXT NOT NULL,
  "caption" TEXT,
  "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "jobOperationStepSlide_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "jobOperationStepSlide_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "jobOperationStep"("id") ON DELETE CASCADE,
  CONSTRAINT "jobOperationStepSlide_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "jobOperationStepSlide_stepId_idx" ON "jobOperationStepSlide" ("stepId");
CREATE INDEX IF NOT EXISTS "jobOperationStepSlide_companyId_idx" ON "jobOperationStepSlide" ("companyId");

-- 3. Quote slides (copied from the template by get-method)
CREATE TABLE IF NOT EXISTS "quoteOperationStepSlide" (
  "id" TEXT NOT NULL DEFAULT id('slide'),
  "stepId" TEXT NOT NULL,
  "imagePath" TEXT NOT NULL,
  "caption" TEXT,
  "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "quoteOperationStepSlide_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quoteOperationStepSlide_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "quoteOperationStep"("id") ON DELETE CASCADE,
  CONSTRAINT "quoteOperationStepSlide_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "quoteOperationStepSlide_stepId_idx" ON "quoteOperationStepSlide" ("stepId");
CREATE INDEX IF NOT EXISTS "quoteOperationStepSlide_companyId_idx" ON "quoteOperationStepSlide" ("companyId");

-- RLS — same shape as the *OperationStep parents (any employee reads; production perms write).
ALTER TABLE "public"."methodOperationStepSlide" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."jobOperationStepSlide" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."quoteOperationStepSlide" ENABLE ROW LEVEL SECURITY;

-- methodOperationStepSlide
DROP POLICY IF EXISTS "SELECT" ON "public"."methodOperationStepSlide";
CREATE POLICY "SELECT" ON "public"."methodOperationStepSlide"
FOR SELECT USING ("companyId" = ANY ((SELECT get_companies_with_employee_role())::text[]));
DROP POLICY IF EXISTS "INSERT" ON "public"."methodOperationStepSlide";
CREATE POLICY "INSERT" ON "public"."methodOperationStepSlide"
FOR INSERT WITH CHECK ("companyId" = ANY ((SELECT get_companies_with_employee_permission('production_create'))::text[]));
DROP POLICY IF EXISTS "UPDATE" ON "public"."methodOperationStepSlide";
CREATE POLICY "UPDATE" ON "public"."methodOperationStepSlide"
FOR UPDATE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::text[]));
DROP POLICY IF EXISTS "DELETE" ON "public"."methodOperationStepSlide";
CREATE POLICY "DELETE" ON "public"."methodOperationStepSlide"
FOR DELETE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission('production_delete'))::text[]));

-- jobOperationStepSlide
DROP POLICY IF EXISTS "SELECT" ON "public"."jobOperationStepSlide";
CREATE POLICY "SELECT" ON "public"."jobOperationStepSlide"
FOR SELECT USING ("companyId" = ANY ((SELECT get_companies_with_employee_role())::text[]));
DROP POLICY IF EXISTS "INSERT" ON "public"."jobOperationStepSlide";
CREATE POLICY "INSERT" ON "public"."jobOperationStepSlide"
FOR INSERT WITH CHECK ("companyId" = ANY ((SELECT get_companies_with_employee_permission('production_create'))::text[]));
DROP POLICY IF EXISTS "UPDATE" ON "public"."jobOperationStepSlide";
CREATE POLICY "UPDATE" ON "public"."jobOperationStepSlide"
FOR UPDATE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::text[]));
DROP POLICY IF EXISTS "DELETE" ON "public"."jobOperationStepSlide";
CREATE POLICY "DELETE" ON "public"."jobOperationStepSlide"
FOR DELETE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission('production_delete'))::text[]));

-- quoteOperationStepSlide
DROP POLICY IF EXISTS "SELECT" ON "public"."quoteOperationStepSlide";
CREATE POLICY "SELECT" ON "public"."quoteOperationStepSlide"
FOR SELECT USING ("companyId" = ANY ((SELECT get_companies_with_employee_role())::text[]));
DROP POLICY IF EXISTS "INSERT" ON "public"."quoteOperationStepSlide";
CREATE POLICY "INSERT" ON "public"."quoteOperationStepSlide"
FOR INSERT WITH CHECK ("companyId" = ANY ((SELECT get_companies_with_employee_permission('production_create'))::text[]));
DROP POLICY IF EXISTS "UPDATE" ON "public"."quoteOperationStepSlide";
CREATE POLICY "UPDATE" ON "public"."quoteOperationStepSlide"
FOR UPDATE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::text[]));
DROP POLICY IF EXISTS "DELETE" ON "public"."quoteOperationStepSlide";
CREATE POLICY "DELETE" ON "public"."quoteOperationStepSlide"
FOR DELETE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission('production_delete'))::text[]));

-- ===== 20260628145000_operation-step-part-tool-link.sql =====
-- Associate a material (part/consumable) and a tool with a specific operation STEP, so the
-- MES can show only the parts/tools relevant to the step the operator is on — and scan a
-- serial/batch part at the step where it's actually used.
--
-- Nullable FK = backward compatible: every existing row stays operation-level (NULL = "applies
-- to the whole operation"). Authored on the method template and copied to job/quote by
-- get-method, exactly like steps/slides/tools/parameters. ON DELETE SET NULL because a
-- material/tool is owned by the OPERATION and only *assigned* to a step — deleting the step
-- must not delete the material; it just reverts to operation-level. Mirrors the stepId pattern
-- from 20260621154233_operation-step-slides.sql (which FKs the *OperationStep "id").

-- Materials ---------------------------------------------------------------------------------
-- IF NOT EXISTS so a re-run (shared dev volume whose bookkeeping was pruned by the
-- branch-switch migration repair) is a no-op instead of a hard failure.
ALTER TABLE "methodMaterial"
  ADD COLUMN IF NOT EXISTS "methodOperationStepId" TEXT
    REFERENCES "methodOperationStep"("id") ON DELETE SET NULL;
ALTER TABLE "jobMaterial"
  ADD COLUMN IF NOT EXISTS "jobOperationStepId" TEXT
    REFERENCES "jobOperationStep"("id") ON DELETE SET NULL;
ALTER TABLE "quoteMaterial"
  ADD COLUMN IF NOT EXISTS "quoteOperationStepId" TEXT
    REFERENCES "quoteOperationStep"("id") ON DELETE SET NULL;

-- Tools -------------------------------------------------------------------------------------
ALTER TABLE "methodOperationTool"
  ADD COLUMN IF NOT EXISTS "methodOperationStepId" TEXT
    REFERENCES "methodOperationStep"("id") ON DELETE SET NULL;
ALTER TABLE "jobOperationTool"
  ADD COLUMN IF NOT EXISTS "jobOperationStepId" TEXT
    REFERENCES "jobOperationStep"("id") ON DELETE SET NULL;
ALTER TABLE "quoteOperationTool"
  ADD COLUMN IF NOT EXISTS "quoteOperationStepId" TEXT
    REFERENCES "quoteOperationStep"("id") ON DELETE SET NULL;

-- Index every new FK (per conventions: index companyId and every FK).
CREATE INDEX IF NOT EXISTS "methodMaterial_methodOperationStepId_idx" ON "methodMaterial" ("methodOperationStepId");
CREATE INDEX IF NOT EXISTS "jobMaterial_jobOperationStepId_idx" ON "jobMaterial" ("jobOperationStepId");
CREATE INDEX IF NOT EXISTS "quoteMaterial_quoteOperationStepId_idx" ON "quoteMaterial" ("quoteOperationStepId");
CREATE INDEX IF NOT EXISTS "methodOperationTool_methodOperationStepId_idx" ON "methodOperationTool" ("methodOperationStepId");
CREATE INDEX IF NOT EXISTS "jobOperationTool_jobOperationStepId_idx" ON "jobOperationTool" ("jobOperationStepId");
CREATE INDEX IF NOT EXISTS "quoteOperationTool_quoteOperationStepId_idx" ON "quoteOperationTool" ("quoteOperationStepId");

-- ===== 20260628161500_method-tree-step-link.sql =====
-- Surface methodMaterial.methodOperationStepId on the method tree so get-method can copy
-- the part↔step link to jobOperationStep when a job/quote is created (Phase 2). Mirrors how
-- the tree already exposes "operationId" (= methodMaterial.methodOperationId). Recreated from
-- 20260618171234_material-supersession.sql with one new column added after "operationId".
-- Return signature changes, so DROP first (CREATE OR REPLACE can't alter OUT columns).

DROP FUNCTION IF EXISTS get_method_tree(TEXT);

CREATE OR REPLACE FUNCTION get_method_tree(uid TEXT)
RETURNS TABLE (
    "methodMaterialId" TEXT,
    "makeMethodId" TEXT,
    "materialMakeMethodId" TEXT,
    "itemId" TEXT,
    "itemReadableId" TEXT,
    "itemType" TEXT,
    "description" TEXT,
    "unitOfMeasureCode" TEXT,
    "unitCost" NUMERIC,
    "quantity" NUMERIC,
    "methodType" "methodType",
    "itemTrackingType" TEXT,
    "parentMaterialId" TEXT,
    "order" DOUBLE PRECISION,
    "operationId" TEXT,
    "methodOperationStepId" TEXT,
    "isRoot" BOOLEAN,
    "kit" BOOLEAN,
    "revision" TEXT,
    "externalId" JSONB,
    "version" NUMERIC(10,2),
    "storageUnitIds" JSONB,
    "isPickDescendant" BOOLEAN,
    "replenishmentSystem" "itemReplenishmentSystem",
    "effectiveFrom" DATE,
    "effectiveTo" DATE
) AS $$
WITH RECURSIVE material AS (
    SELECT
        "id",
        "makeMethodId",
        "methodType",
        COALESCE(
            "materialMakeMethodId",
            CASE WHEN "methodType" = 'Pull from Inventory' THEN (
                SELECT amm.id FROM "activeMakeMethods" amm WHERE amm."itemId" = "methodMaterial"."itemId" LIMIT 1
            ) END
        ) AS "materialMakeMethodId",
        "itemId",
        "itemType",
        "quantity",
        "makeMethodId" AS "parentMaterialId",
        NULL AS "operationId",
        NULL AS "methodOperationStepId",
        COALESCE("order", 1) AS "order",
        "kit",
        "storageUnitIds",
        false AS "isPickDescendant",
        "effectiveFrom",
        "effectiveTo"
    FROM
        "methodMaterial"
    WHERE
        "makeMethodId" = uid
    UNION
    SELECT
        child."id",
        child."makeMethodId",
        child."methodType",
        COALESCE(
            child."materialMakeMethodId",
            CASE WHEN child."methodType" = 'Pull from Inventory' THEN (
                SELECT amm.id FROM "activeMakeMethods" amm WHERE amm."itemId" = child."itemId" LIMIT 1
            ) END
        ) AS "materialMakeMethodId",
        child."itemId",
        child."itemType",
        child."quantity",
        parent."id" AS "parentMaterialId",
        child."methodOperationId" AS "operationId",
        child."methodOperationStepId" AS "methodOperationStepId",
        child."order",
        child."kit",
        child."storageUnitIds",
        (parent."methodType" = 'Pull from Inventory' OR parent."isPickDescendant") AS "isPickDescendant",
        child."effectiveFrom",
        child."effectiveTo"
    FROM
        "methodMaterial" child
        INNER JOIN material parent ON parent."materialMakeMethodId" = child."makeMethodId"
)
SELECT
  material.id as "methodMaterialId",
  material."makeMethodId",
  material."materialMakeMethodId",
  material."itemId",
  item."readableIdWithRevision" AS "itemReadableId",
  material."itemType",
  item."name" AS "description",
  item."unitOfMeasureCode",
  cost."unitCost",
  material."quantity",
  material."methodType",
  item."itemTrackingType",
  material."parentMaterialId",
  material."order",
  material."operationId",
  material."methodOperationStepId",
  false AS "isRoot",
  material."kit",
  item."revision",
  (
    SELECT COALESCE(
      jsonb_object_agg(
        eim."integration",
        CASE
          WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
          ELSE to_jsonb(eim."externalId")
        END
      ) FILTER (WHERE eim."externalId" IS NOT NULL),
      '{}'::jsonb
    )
    FROM "externalIntegrationMapping" eim
    WHERE eim."entityType" = 'item' AND eim."entityId" = item.id
  ) AS "externalId",
  mm2."version",
  material."storageUnitIds",
  material."isPickDescendant",
  item."replenishmentSystem",
  material."effectiveFrom",
  material."effectiveTo"
FROM material
INNER JOIN item
  ON material."itemId" = item.id
INNER JOIN "itemCost" cost
  ON item.id = cost."itemId"
INNER JOIN "makeMethod" mm
  ON material."makeMethodId" = mm.id
LEFT JOIN "makeMethod" mm2
  ON material."materialMakeMethodId" = mm2.id
UNION
SELECT
  mm."id" AS "methodMaterialId",
  NULL AS "makeMethodId",
  mm.id AS "materialMakeMethodId",
  mm."itemId",
  item."readableIdWithRevision" AS "itemReadableId",
  item."type"::text,
  item."name" AS "description",
  item."unitOfMeasureCode",
  cost."unitCost",
  1 AS "quantity",
  'Make to Order' AS "methodType",
  item."itemTrackingType",
  NULL AS "parentMaterialId",
  CAST(1 AS DOUBLE PRECISION) AS "order",
  NULL AS "operationId",
  NULL AS "methodOperationStepId",
  true AS "isRoot",
  false AS "kit",
  item."revision",
  (
    SELECT COALESCE(
      jsonb_object_agg(
        eim."integration",
        CASE
          WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
          ELSE to_jsonb(eim."externalId")
        END
      ) FILTER (WHERE eim."externalId" IS NOT NULL),
      '{}'::jsonb
    )
    FROM "externalIntegrationMapping" eim
    WHERE eim."entityType" = 'item' AND eim."entityId" = item.id
  ) AS "externalId",
  mm."version",
  '{}'::JSONB AS "storageUnitIds",
  false AS "isPickDescendant",
  item."replenishmentSystem",
  NULL::DATE AS "effectiveFrom",
  NULL::DATE AS "effectiveTo"
FROM "makeMethod" mm
INNER JOIN item
  ON mm."itemId" = item.id
INNER JOIN "itemCost" cost
  ON item.id = cost."itemId"
WHERE mm.id = uid
ORDER BY "order"
$$ LANGUAGE sql STABLE;

-- ===== 20260628163000_method-tree-step-base.sql =====
-- Fix: the base CTE of get_method_tree (top-level materials of the queried make method)
-- hardcoded methodOperationStepId to NULL — so a part assigned to a step on the ROOT
-- assembly's BoM never reached get-method. Carry the real column in the base term too.
-- Body-only change (signature unchanged from 20260628161500), so CREATE OR REPLACE is safe.
-- operationId is intentionally left NULL in the base term (unchanged existing behavior);
-- the MES filter keys off jobOperationStepId, not jobOperationId.

CREATE OR REPLACE FUNCTION get_method_tree(uid TEXT)
RETURNS TABLE (
    "methodMaterialId" TEXT,
    "makeMethodId" TEXT,
    "materialMakeMethodId" TEXT,
    "itemId" TEXT,
    "itemReadableId" TEXT,
    "itemType" TEXT,
    "description" TEXT,
    "unitOfMeasureCode" TEXT,
    "unitCost" NUMERIC,
    "quantity" NUMERIC,
    "methodType" "methodType",
    "itemTrackingType" TEXT,
    "parentMaterialId" TEXT,
    "order" DOUBLE PRECISION,
    "operationId" TEXT,
    "methodOperationStepId" TEXT,
    "isRoot" BOOLEAN,
    "kit" BOOLEAN,
    "revision" TEXT,
    "externalId" JSONB,
    "version" NUMERIC(10,2),
    "storageUnitIds" JSONB,
    "isPickDescendant" BOOLEAN,
    "replenishmentSystem" "itemReplenishmentSystem",
    "effectiveFrom" DATE,
    "effectiveTo" DATE
) AS $$
WITH RECURSIVE material AS (
    SELECT
        "id",
        "makeMethodId",
        "methodType",
        COALESCE(
            "materialMakeMethodId",
            CASE WHEN "methodType" = 'Pull from Inventory' THEN (
                SELECT amm.id FROM "activeMakeMethods" amm WHERE amm."itemId" = "methodMaterial"."itemId" LIMIT 1
            ) END
        ) AS "materialMakeMethodId",
        "itemId",
        "itemType",
        "quantity",
        "makeMethodId" AS "parentMaterialId",
        NULL AS "operationId",
        "methodOperationStepId",
        COALESCE("order", 1) AS "order",
        "kit",
        "storageUnitIds",
        false AS "isPickDescendant",
        "effectiveFrom",
        "effectiveTo"
    FROM
        "methodMaterial"
    WHERE
        "makeMethodId" = uid
    UNION
    SELECT
        child."id",
        child."makeMethodId",
        child."methodType",
        COALESCE(
            child."materialMakeMethodId",
            CASE WHEN child."methodType" = 'Pull from Inventory' THEN (
                SELECT amm.id FROM "activeMakeMethods" amm WHERE amm."itemId" = child."itemId" LIMIT 1
            ) END
        ) AS "materialMakeMethodId",
        child."itemId",
        child."itemType",
        child."quantity",
        parent."id" AS "parentMaterialId",
        child."methodOperationId" AS "operationId",
        child."methodOperationStepId" AS "methodOperationStepId",
        child."order",
        child."kit",
        child."storageUnitIds",
        (parent."methodType" = 'Pull from Inventory' OR parent."isPickDescendant") AS "isPickDescendant",
        child."effectiveFrom",
        child."effectiveTo"
    FROM
        "methodMaterial" child
        INNER JOIN material parent ON parent."materialMakeMethodId" = child."makeMethodId"
)
SELECT
  material.id as "methodMaterialId",
  material."makeMethodId",
  material."materialMakeMethodId",
  material."itemId",
  item."readableIdWithRevision" AS "itemReadableId",
  material."itemType",
  item."name" AS "description",
  item."unitOfMeasureCode",
  cost."unitCost",
  material."quantity",
  material."methodType",
  item."itemTrackingType",
  material."parentMaterialId",
  material."order",
  material."operationId",
  material."methodOperationStepId",
  false AS "isRoot",
  material."kit",
  item."revision",
  (
    SELECT COALESCE(
      jsonb_object_agg(
        eim."integration",
        CASE
          WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
          ELSE to_jsonb(eim."externalId")
        END
      ) FILTER (WHERE eim."externalId" IS NOT NULL),
      '{}'::jsonb
    )
    FROM "externalIntegrationMapping" eim
    WHERE eim."entityType" = 'item' AND eim."entityId" = item.id
  ) AS "externalId",
  mm2."version",
  material."storageUnitIds",
  material."isPickDescendant",
  item."replenishmentSystem",
  material."effectiveFrom",
  material."effectiveTo"
FROM material
INNER JOIN item
  ON material."itemId" = item.id
INNER JOIN "itemCost" cost
  ON item.id = cost."itemId"
INNER JOIN "makeMethod" mm
  ON material."makeMethodId" = mm.id
LEFT JOIN "makeMethod" mm2
  ON material."materialMakeMethodId" = mm2.id
UNION
SELECT
  mm."id" AS "methodMaterialId",
  NULL AS "makeMethodId",
  mm.id AS "materialMakeMethodId",
  mm."itemId",
  item."readableIdWithRevision" AS "itemReadableId",
  item."type"::text,
  item."name" AS "description",
  item."unitOfMeasureCode",
  cost."unitCost",
  1 AS "quantity",
  'Make to Order' AS "methodType",
  item."itemTrackingType",
  NULL AS "parentMaterialId",
  CAST(1 AS DOUBLE PRECISION) AS "order",
  NULL AS "operationId",
  NULL AS "methodOperationStepId",
  true AS "isRoot",
  false AS "kit",
  item."revision",
  (
    SELECT COALESCE(
      jsonb_object_agg(
        eim."integration",
        CASE
          WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
          ELSE to_jsonb(eim."externalId")
        END
      ) FILTER (WHERE eim."externalId" IS NOT NULL),
      '{}'::jsonb
    )
    FROM "externalIntegrationMapping" eim
    WHERE eim."entityType" = 'item' AND eim."entityId" = item.id
  ) AS "externalId",
  mm."version",
  '{}'::JSONB AS "storageUnitIds",
  false AS "isPickDescendant",
  item."replenishmentSystem",
  NULL::DATE AS "effectiveFrom",
  NULL::DATE AS "effectiveTo"
FROM "makeMethod" mm
INNER JOIN item
  ON mm."itemId" = item.id
INNER JOIN "itemCost" cost
  ON item.id = cost."itemId"
WHERE mm.id = uid
ORDER BY "order"
$$ LANGUAGE sql STABLE;

-- ===== 20260701151200_auto-start-operation-timer.sql =====
-- Passive operation timer (MES): opt-in per company. When ON, the MES assembly view
-- auto-starts the operator's production event on open (so the timer isn't forgotten).
-- It never auto-ends a timer — stopping is always a manual action.
-- Additive + defaulted, no backfill.
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "autoStartOperationTimer" BOOLEAN NOT NULL DEFAULT false;

-- ===== 20260701171540_operation-step-slide-annotations.sql =====
-- Per-slide display size + image annotations (numbered pins) for step reference images.
-- Extends the *OperationStepSlide tables from 20260621154233_operation-step-slides.sql.
--
--   size        — display size in the BOP editor grid and the MES operator view.
--                 'small' | 'medium' | 'large'; defaults to 'medium' (backward compatible:
--                 every existing slide keeps today's medium look).
--   annotations — JSONB array of numbered pins overlaid on the image, shape:
--                 [{ "id": text, "x": 0..1, "y": 0..1, "label"?: text, "color"?: text }, ...].
--                 x/y are fractions of the image box so they survive any rendered size.
--                 Defaults to '[]' (no annotations).
--
-- Authored on the method template and copied to job/quote by get-method (copyStepSlides),
-- exactly like the caption/order columns. IF NOT EXISTS so a re-run on a shared dev volume
-- is a no-op instead of a hard failure (mirrors the parent slides migration).

-- methodOperationStepSlide -------------------------------------------------------------------
ALTER TABLE "methodOperationStepSlide"
  ADD COLUMN IF NOT EXISTS "size" TEXT NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS "annotations" JSONB NOT NULL DEFAULT '[]';

-- jobOperationStepSlide ----------------------------------------------------------------------
ALTER TABLE "jobOperationStepSlide"
  ADD COLUMN IF NOT EXISTS "size" TEXT NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS "annotations" JSONB NOT NULL DEFAULT '[]';

-- quoteOperationStepSlide --------------------------------------------------------------------
ALTER TABLE "quoteOperationStepSlide"
  ADD COLUMN IF NOT EXISTS "size" TEXT NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS "annotations" JSONB NOT NULL DEFAULT '[]';

-- Constrain size to the three allowed values (guard against bad writes; NOT VALID-free since
-- every existing row is the default 'medium'). DROP-before-ADD keeps a re-run idempotent.
ALTER TABLE "methodOperationStepSlide" DROP CONSTRAINT IF EXISTS "methodOperationStepSlide_size_check";
ALTER TABLE "methodOperationStepSlide"
  ADD CONSTRAINT "methodOperationStepSlide_size_check" CHECK ("size" IN ('small', 'medium', 'large'));

ALTER TABLE "jobOperationStepSlide" DROP CONSTRAINT IF EXISTS "jobOperationStepSlide_size_check";
ALTER TABLE "jobOperationStepSlide"
  ADD CONSTRAINT "jobOperationStepSlide_size_check" CHECK ("size" IN ('small', 'medium', 'large'));

ALTER TABLE "quoteOperationStepSlide" DROP CONSTRAINT IF EXISTS "quoteOperationStepSlide_size_check";
ALTER TABLE "quoteOperationStepSlide"
  ADD CONSTRAINT "quoteOperationStepSlide_size_check" CHECK ("size" IN ('small', 'medium', 'large'));

-- ===== 20260702143000_operation-step-link-many-to-many.sql =====
-- Many-to-many tool<->step and part<->step.
--
-- Replaces the single nullable FK *OperationStepId (added in
-- 20260628145000_operation-step-part-tool-link.sql) with six join tables so a tool/material
-- can be scoped to ANY SUBSET of an operation's steps — not just one step, and not only "all".
-- Semantics: NO join rows = operation-level (shown on every step, backward compatible);
-- 1+ rows = shown only on those steps.
--
-- Join tables carry no companyId (like pickingListLineTrackedEntity) — they reach the company
-- through the parent via EXISTS in RLS. Both FKs are ON DELETE CASCADE: deleting the tool/
-- material OR the step removes the link row (a link is meaningless without either side).
--
-- The old scalar columns are backfilled here and dropped in the paired migration
-- 20260702143500 (after get_method_tree stops referencing methodMaterial.methodOperationStepId).

-- Materials ---------------------------------------------------------------------------------
CREATE TABLE "methodMaterialStep" (
  "methodMaterialId" TEXT NOT NULL REFERENCES "methodMaterial"("id") ON DELETE CASCADE,
  "methodOperationStepId" TEXT NOT NULL REFERENCES "methodOperationStep"("id") ON DELETE CASCADE,
  PRIMARY KEY ("methodMaterialId", "methodOperationStepId")
);
CREATE INDEX "methodMaterialStep_methodOperationStepId_idx" ON "methodMaterialStep" ("methodOperationStepId");

CREATE TABLE "jobMaterialStep" (
  "jobMaterialId" TEXT NOT NULL REFERENCES "jobMaterial"("id") ON DELETE CASCADE,
  "jobOperationStepId" TEXT NOT NULL REFERENCES "jobOperationStep"("id") ON DELETE CASCADE,
  PRIMARY KEY ("jobMaterialId", "jobOperationStepId")
);
CREATE INDEX "jobMaterialStep_jobOperationStepId_idx" ON "jobMaterialStep" ("jobOperationStepId");

CREATE TABLE "quoteMaterialStep" (
  "quoteMaterialId" TEXT NOT NULL REFERENCES "quoteMaterial"("id") ON DELETE CASCADE,
  "quoteOperationStepId" TEXT NOT NULL REFERENCES "quoteOperationStep"("id") ON DELETE CASCADE,
  PRIMARY KEY ("quoteMaterialId", "quoteOperationStepId")
);
CREATE INDEX "quoteMaterialStep_quoteOperationStepId_idx" ON "quoteMaterialStep" ("quoteOperationStepId");

-- Tools -------------------------------------------------------------------------------------
CREATE TABLE "methodOperationToolStep" (
  "methodOperationToolId" TEXT NOT NULL REFERENCES "methodOperationTool"("id") ON DELETE CASCADE,
  "methodOperationStepId" TEXT NOT NULL REFERENCES "methodOperationStep"("id") ON DELETE CASCADE,
  PRIMARY KEY ("methodOperationToolId", "methodOperationStepId")
);
CREATE INDEX "methodOperationToolStep_methodOperationStepId_idx" ON "methodOperationToolStep" ("methodOperationStepId");

CREATE TABLE "jobOperationToolStep" (
  "jobOperationToolId" TEXT NOT NULL REFERENCES "jobOperationTool"("id") ON DELETE CASCADE,
  "jobOperationStepId" TEXT NOT NULL REFERENCES "jobOperationStep"("id") ON DELETE CASCADE,
  PRIMARY KEY ("jobOperationToolId", "jobOperationStepId")
);
CREATE INDEX "jobOperationToolStep_jobOperationStepId_idx" ON "jobOperationToolStep" ("jobOperationStepId");

CREATE TABLE "quoteOperationToolStep" (
  "quoteOperationToolId" TEXT NOT NULL REFERENCES "quoteOperationTool"("id") ON DELETE CASCADE,
  "quoteOperationStepId" TEXT NOT NULL REFERENCES "quoteOperationStep"("id") ON DELETE CASCADE,
  PRIMARY KEY ("quoteOperationToolId", "quoteOperationStepId")
);
CREATE INDEX "quoteOperationToolStep_quoteOperationStepId_idx" ON "quoteOperationToolStep" ("quoteOperationStepId");

-- RLS -- reach companyId through the parent (tool/material). SELECT: any employee of the
-- parent's company. Writes: the parent's module permission (job->production, method->parts,
-- quote->sales), matching the parent tables' own policies.

-- methodMaterialStep (parts)
ALTER TABLE "public"."methodMaterialStep" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."methodMaterialStep" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "methodMaterial" p WHERE p."id" = "methodMaterialId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])));
CREATE POLICY "INSERT" ON "public"."methodMaterialStep" FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM "methodMaterial" p WHERE p."id" = "methodMaterialId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_create'))::text[])));
CREATE POLICY "UPDATE" ON "public"."methodMaterialStep" FOR UPDATE USING (
  EXISTS (SELECT 1 FROM "methodMaterial" p WHERE p."id" = "methodMaterialId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_update'))::text[])));
CREATE POLICY "DELETE" ON "public"."methodMaterialStep" FOR DELETE USING (
  EXISTS (SELECT 1 FROM "methodMaterial" p WHERE p."id" = "methodMaterialId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_delete'))::text[])));

-- jobMaterialStep (production)
ALTER TABLE "public"."jobMaterialStep" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."jobMaterialStep" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "jobMaterial" p WHERE p."id" = "jobMaterialId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])));
CREATE POLICY "INSERT" ON "public"."jobMaterialStep" FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM "jobMaterial" p WHERE p."id" = "jobMaterialId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('production_create'))::text[])));
CREATE POLICY "UPDATE" ON "public"."jobMaterialStep" FOR UPDATE USING (
  EXISTS (SELECT 1 FROM "jobMaterial" p WHERE p."id" = "jobMaterialId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::text[])));
CREATE POLICY "DELETE" ON "public"."jobMaterialStep" FOR DELETE USING (
  EXISTS (SELECT 1 FROM "jobMaterial" p WHERE p."id" = "jobMaterialId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('production_delete'))::text[])));

-- quoteMaterialStep (sales)
ALTER TABLE "public"."quoteMaterialStep" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."quoteMaterialStep" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "quoteMaterial" p WHERE p."id" = "quoteMaterialId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])));
CREATE POLICY "INSERT" ON "public"."quoteMaterialStep" FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM "quoteMaterial" p WHERE p."id" = "quoteMaterialId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[])));
CREATE POLICY "UPDATE" ON "public"."quoteMaterialStep" FOR UPDATE USING (
  EXISTS (SELECT 1 FROM "quoteMaterial" p WHERE p."id" = "quoteMaterialId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[])));
CREATE POLICY "DELETE" ON "public"."quoteMaterialStep" FOR DELETE USING (
  EXISTS (SELECT 1 FROM "quoteMaterial" p WHERE p."id" = "quoteMaterialId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[])));

-- methodOperationToolStep (parts)
ALTER TABLE "public"."methodOperationToolStep" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."methodOperationToolStep" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "methodOperationTool" p WHERE p."id" = "methodOperationToolId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])));
CREATE POLICY "INSERT" ON "public"."methodOperationToolStep" FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM "methodOperationTool" p WHERE p."id" = "methodOperationToolId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_create'))::text[])));
CREATE POLICY "UPDATE" ON "public"."methodOperationToolStep" FOR UPDATE USING (
  EXISTS (SELECT 1 FROM "methodOperationTool" p WHERE p."id" = "methodOperationToolId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_update'))::text[])));
CREATE POLICY "DELETE" ON "public"."methodOperationToolStep" FOR DELETE USING (
  EXISTS (SELECT 1 FROM "methodOperationTool" p WHERE p."id" = "methodOperationToolId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_delete'))::text[])));

-- jobOperationToolStep (production)
ALTER TABLE "public"."jobOperationToolStep" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."jobOperationToolStep" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "jobOperationTool" p WHERE p."id" = "jobOperationToolId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])));
CREATE POLICY "INSERT" ON "public"."jobOperationToolStep" FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM "jobOperationTool" p WHERE p."id" = "jobOperationToolId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('production_create'))::text[])));
CREATE POLICY "UPDATE" ON "public"."jobOperationToolStep" FOR UPDATE USING (
  EXISTS (SELECT 1 FROM "jobOperationTool" p WHERE p."id" = "jobOperationToolId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::text[])));
CREATE POLICY "DELETE" ON "public"."jobOperationToolStep" FOR DELETE USING (
  EXISTS (SELECT 1 FROM "jobOperationTool" p WHERE p."id" = "jobOperationToolId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('production_delete'))::text[])));

-- quoteOperationToolStep (sales)
ALTER TABLE "public"."quoteOperationToolStep" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."quoteOperationToolStep" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "quoteOperationTool" p WHERE p."id" = "quoteOperationToolId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])));
CREATE POLICY "INSERT" ON "public"."quoteOperationToolStep" FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM "quoteOperationTool" p WHERE p."id" = "quoteOperationToolId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[])));
CREATE POLICY "UPDATE" ON "public"."quoteOperationToolStep" FOR UPDATE USING (
  EXISTS (SELECT 1 FROM "quoteOperationTool" p WHERE p."id" = "quoteOperationToolId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[])));
CREATE POLICY "DELETE" ON "public"."quoteOperationToolStep" FOR DELETE USING (
  EXISTS (SELECT 1 FROM "quoteOperationTool" p WHERE p."id" = "quoteOperationToolId"
    AND p."companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[])));

-- Backfill existing single-FK assignments into the join tables (no data loss).
INSERT INTO "methodMaterialStep" ("methodMaterialId", "methodOperationStepId")
  SELECT "id", "methodOperationStepId" FROM "methodMaterial" WHERE "methodOperationStepId" IS NOT NULL;
INSERT INTO "jobMaterialStep" ("jobMaterialId", "jobOperationStepId")
  SELECT "id", "jobOperationStepId" FROM "jobMaterial" WHERE "jobOperationStepId" IS NOT NULL;
INSERT INTO "quoteMaterialStep" ("quoteMaterialId", "quoteOperationStepId")
  SELECT "id", "quoteOperationStepId" FROM "quoteMaterial" WHERE "quoteOperationStepId" IS NOT NULL;
INSERT INTO "methodOperationToolStep" ("methodOperationToolId", "methodOperationStepId")
  SELECT "id", "methodOperationStepId" FROM "methodOperationTool" WHERE "methodOperationStepId" IS NOT NULL;
INSERT INTO "jobOperationToolStep" ("jobOperationToolId", "jobOperationStepId")
  SELECT "id", "jobOperationStepId" FROM "jobOperationTool" WHERE "jobOperationStepId" IS NOT NULL;
INSERT INTO "quoteOperationToolStep" ("quoteOperationToolId", "quoteOperationStepId")
  SELECT "id", "quoteOperationStepId" FROM "quoteOperationTool" WHERE "quoteOperationStepId" IS NOT NULL;

-- ===== 20260702143500_method-tree-step-many-drop-scalar.sql =====
-- Paired with 20260702143000. Now that methodMaterialStep exists and is backfilled, switch
-- get_method_tree to surface methodOperationStepIds as a JSONB ARRAY (aggregated from the join
-- table) instead of the single methodOperationStepId TEXT, then drop the six scalar columns.
--
-- get-method copies the array to job/quote by remapping each id via methodStepsToJobSteps.
-- Return signature changes (TEXT -> JSONB), so DROP FUNCTION first.

DROP FUNCTION IF EXISTS get_method_tree(TEXT);

CREATE OR REPLACE FUNCTION get_method_tree(uid TEXT)
RETURNS TABLE (
    "methodMaterialId" TEXT,
    "makeMethodId" TEXT,
    "materialMakeMethodId" TEXT,
    "itemId" TEXT,
    "itemReadableId" TEXT,
    "itemType" TEXT,
    "description" TEXT,
    "unitOfMeasureCode" TEXT,
    "unitCost" NUMERIC,
    "quantity" NUMERIC,
    "methodType" "methodType",
    "itemTrackingType" TEXT,
    "parentMaterialId" TEXT,
    "order" DOUBLE PRECISION,
    "operationId" TEXT,
    "methodOperationStepIds" JSONB,
    "isRoot" BOOLEAN,
    "kit" BOOLEAN,
    "revision" TEXT,
    "externalId" JSONB,
    "version" NUMERIC(10,2),
    "storageUnitIds" JSONB,
    "isPickDescendant" BOOLEAN,
    "replenishmentSystem" "itemReplenishmentSystem",
    "effectiveFrom" DATE,
    "effectiveTo" DATE
) AS $$
WITH RECURSIVE material AS (
    SELECT
        "id",
        "makeMethodId",
        "methodType",
        COALESCE(
            "materialMakeMethodId",
            CASE WHEN "methodType" = 'Pull from Inventory' THEN (
                SELECT amm.id FROM "activeMakeMethods" amm WHERE amm."itemId" = "methodMaterial"."itemId" LIMIT 1
            ) END
        ) AS "materialMakeMethodId",
        "itemId",
        "itemType",
        "quantity",
        "makeMethodId" AS "parentMaterialId",
        NULL AS "operationId",
        COALESCE("order", 1) AS "order",
        "kit",
        "storageUnitIds",
        false AS "isPickDescendant",
        "effectiveFrom",
        "effectiveTo"
    FROM
        "methodMaterial"
    WHERE
        "makeMethodId" = uid
    UNION
    SELECT
        child."id",
        child."makeMethodId",
        child."methodType",
        COALESCE(
            child."materialMakeMethodId",
            CASE WHEN child."methodType" = 'Pull from Inventory' THEN (
                SELECT amm.id FROM "activeMakeMethods" amm WHERE amm."itemId" = child."itemId" LIMIT 1
            ) END
        ) AS "materialMakeMethodId",
        child."itemId",
        child."itemType",
        child."quantity",
        parent."id" AS "parentMaterialId",
        child."methodOperationId" AS "operationId",
        child."order",
        child."kit",
        child."storageUnitIds",
        (parent."methodType" = 'Pull from Inventory' OR parent."isPickDescendant") AS "isPickDescendant",
        child."effectiveFrom",
        child."effectiveTo"
    FROM
        "methodMaterial" child
        INNER JOIN material parent ON parent."materialMakeMethodId" = child."makeMethodId"
)
SELECT
  material.id as "methodMaterialId",
  material."makeMethodId",
  material."materialMakeMethodId",
  material."itemId",
  item."readableIdWithRevision" AS "itemReadableId",
  material."itemType",
  item."name" AS "description",
  item."unitOfMeasureCode",
  cost."unitCost",
  material."quantity",
  material."methodType",
  item."itemTrackingType",
  material."parentMaterialId",
  material."order",
  material."operationId",
  (
    SELECT COALESCE(jsonb_agg(mms."methodOperationStepId"), '[]'::jsonb)
    FROM "methodMaterialStep" mms
    WHERE mms."methodMaterialId" = material.id
  ) AS "methodOperationStepIds",
  false AS "isRoot",
  material."kit",
  item."revision",
  (
    SELECT COALESCE(
      jsonb_object_agg(
        eim."integration",
        CASE
          WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
          ELSE to_jsonb(eim."externalId")
        END
      ) FILTER (WHERE eim."externalId" IS NOT NULL),
      '{}'::jsonb
    )
    FROM "externalIntegrationMapping" eim
    WHERE eim."entityType" = 'item' AND eim."entityId" = item.id
  ) AS "externalId",
  mm2."version",
  material."storageUnitIds",
  material."isPickDescendant",
  item."replenishmentSystem",
  material."effectiveFrom",
  material."effectiveTo"
FROM material
INNER JOIN item
  ON material."itemId" = item.id
INNER JOIN "itemCost" cost
  ON item.id = cost."itemId"
INNER JOIN "makeMethod" mm
  ON material."makeMethodId" = mm.id
LEFT JOIN "makeMethod" mm2
  ON material."materialMakeMethodId" = mm2.id
UNION
SELECT
  mm."id" AS "methodMaterialId",
  NULL AS "makeMethodId",
  mm.id AS "materialMakeMethodId",
  mm."itemId",
  item."readableIdWithRevision" AS "itemReadableId",
  item."type"::text,
  item."name" AS "description",
  item."unitOfMeasureCode",
  cost."unitCost",
  1 AS "quantity",
  'Make to Order' AS "methodType",
  item."itemTrackingType",
  NULL AS "parentMaterialId",
  CAST(1 AS DOUBLE PRECISION) AS "order",
  NULL AS "operationId",
  '[]'::jsonb AS "methodOperationStepIds",
  true AS "isRoot",
  false AS "kit",
  item."revision",
  (
    SELECT COALESCE(
      jsonb_object_agg(
        eim."integration",
        CASE
          WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
          ELSE to_jsonb(eim."externalId")
        END
      ) FILTER (WHERE eim."externalId" IS NOT NULL),
      '{}'::jsonb
    )
    FROM "externalIntegrationMapping" eim
    WHERE eim."entityType" = 'item' AND eim."entityId" = item.id
  ) AS "externalId",
  mm."version",
  '{}'::JSONB AS "storageUnitIds",
  false AS "isPickDescendant",
  item."replenishmentSystem",
  NULL::DATE AS "effectiveFrom",
  NULL::DATE AS "effectiveTo"
FROM "makeMethod" mm
INNER JOIN item
  ON mm."itemId" = item.id
INNER JOIN "itemCost" cost
  ON item.id = cost."itemId"
WHERE mm.id = uid
ORDER BY "order"
$$ LANGUAGE sql STABLE;

-- Drop the now-superseded scalar columns (data already backfilled into the join tables).
ALTER TABLE "methodMaterial" DROP COLUMN IF EXISTS "methodOperationStepId";
ALTER TABLE "jobMaterial" DROP COLUMN IF EXISTS "jobOperationStepId";
ALTER TABLE "quoteMaterial" DROP COLUMN IF EXISTS "quoteOperationStepId";
ALTER TABLE "methodOperationTool" DROP COLUMN IF EXISTS "methodOperationStepId";
ALTER TABLE "jobOperationTool" DROP COLUMN IF EXISTS "jobOperationStepId";
ALTER TABLE "quoteOperationTool" DROP COLUMN IF EXISTS "quoteOperationStepId";

-- ===== 20260705143722_drop-operation-timer-idle-minutes.sql =====
-- The idle auto clock-out was removed from the operation timer: it now only auto-starts
-- (auto clock-in) and never auto-ends, so the company-configurable idle threshold is dead.
-- Drop the column. IF EXISTS so this is a no-op on DBs that never got the column.
ALTER TABLE "companySettings"
  DROP COLUMN IF EXISTS "operationTimerIdleMinutes";

