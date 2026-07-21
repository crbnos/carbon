-- ===== 20260616132744_operation-view-rpc.sql =====
-- Surface the operation's classification (operationType) through the MES operation
-- RPC so the execution-view router can read it. See
-- .ai/specs/2026-07-20-operation-type-consolidation.md and
-- .ai/specs/2026-07-14-mes-execution-views.md (§5.1 view routing). At this point in
-- history operationType is still the legacy Inside/Outside enum; the
-- operation-type-consolidation migration converts it to
-- Process/Assembly/Inspection/Outside Processing and re-binds this function to the
-- new type. Tracking type stays orthogonal. NOTE: the inspection-plan link
-- (inspectionDocumentId) is deliberately deferred to the Inspection workstream
-- (Phase 3) so this keystone migration does not depend on the inspection tables —
-- see §5.4 of the execution-views spec.

-- Mirrors 20260531084723_rework-serial-flow.sql; only the trailing column is new.
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
  "operationType" "operationType"
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
    jo."operationType"
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

-- ===== 20260628161500_method-tree-step-link.sql / 20260628163000_method-tree-step-base.sql =====
-- (definitions removed in the operation-type consolidation)
-- These sub-migrations redefined get_method_tree to surface the scalar
-- methodMaterial.methodOperationStepId. The defs were LANGUAGE sql (bodies are
-- validated at CREATE) and referenced the effectivity columns that main's
-- 20260714084035_remove-bom-line-effectivity.sql drops — on any remote that has
-- already applied that migration, re-creating those bodies hard-fails. Since this
-- file is a squash, the intermediate definitions are transient anyway: the final
-- get_method_tree (join-table step links, no effectivity) is landed once, in
-- 20260721004140_operation-type-consolidation.sql, which is timestamped after
-- every definition on main.

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
-- 20260702143500 (below).

-- Materials ---------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "methodMaterialStep" (
  "methodMaterialId" TEXT NOT NULL REFERENCES "methodMaterial"("id") ON DELETE CASCADE,
  "methodOperationStepId" TEXT NOT NULL REFERENCES "methodOperationStep"("id") ON DELETE CASCADE,
  PRIMARY KEY ("methodMaterialId", "methodOperationStepId")
);
CREATE INDEX IF NOT EXISTS "methodMaterialStep_methodOperationStepId_idx" ON "methodMaterialStep" ("methodOperationStepId");

CREATE TABLE IF NOT EXISTS "jobMaterialStep" (
  "jobMaterialId" TEXT NOT NULL REFERENCES "jobMaterial"("id") ON DELETE CASCADE,
  "jobOperationStepId" TEXT NOT NULL REFERENCES "jobOperationStep"("id") ON DELETE CASCADE,
  PRIMARY KEY ("jobMaterialId", "jobOperationStepId")
);
CREATE INDEX IF NOT EXISTS "jobMaterialStep_jobOperationStepId_idx" ON "jobMaterialStep" ("jobOperationStepId");

CREATE TABLE IF NOT EXISTS "quoteMaterialStep" (
  "quoteMaterialId" TEXT NOT NULL REFERENCES "quoteMaterial"("id") ON DELETE CASCADE,
  "quoteOperationStepId" TEXT NOT NULL REFERENCES "quoteOperationStep"("id") ON DELETE CASCADE,
  PRIMARY KEY ("quoteMaterialId", "quoteOperationStepId")
);
CREATE INDEX IF NOT EXISTS "quoteMaterialStep_quoteOperationStepId_idx" ON "quoteMaterialStep" ("quoteOperationStepId");

-- Tools -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "methodOperationToolStep" (
  "methodOperationToolId" TEXT NOT NULL REFERENCES "methodOperationTool"("id") ON DELETE CASCADE,
  "methodOperationStepId" TEXT NOT NULL REFERENCES "methodOperationStep"("id") ON DELETE CASCADE,
  PRIMARY KEY ("methodOperationToolId", "methodOperationStepId")
);
CREATE INDEX IF NOT EXISTS "methodOperationToolStep_methodOperationStepId_idx" ON "methodOperationToolStep" ("methodOperationStepId");

CREATE TABLE IF NOT EXISTS "jobOperationToolStep" (
  "jobOperationToolId" TEXT NOT NULL REFERENCES "jobOperationTool"("id") ON DELETE CASCADE,
  "jobOperationStepId" TEXT NOT NULL REFERENCES "jobOperationStep"("id") ON DELETE CASCADE,
  PRIMARY KEY ("jobOperationToolId", "jobOperationStepId")
);
CREATE INDEX IF NOT EXISTS "jobOperationToolStep_jobOperationStepId_idx" ON "jobOperationToolStep" ("jobOperationStepId");

CREATE TABLE IF NOT EXISTS "quoteOperationToolStep" (
  "quoteOperationToolId" TEXT NOT NULL REFERENCES "quoteOperationTool"("id") ON DELETE CASCADE,
  "quoteOperationStepId" TEXT NOT NULL REFERENCES "quoteOperationStep"("id") ON DELETE CASCADE,
  PRIMARY KEY ("quoteOperationToolId", "quoteOperationStepId")
);
CREATE INDEX IF NOT EXISTS "quoteOperationToolStep_quoteOperationStepId_idx" ON "quoteOperationToolStep" ("quoteOperationStepId");

-- RLS -- reach companyId through the parent (tool/material). SELECT: any employee of the
-- parent's company. Writes: the parent's module permission (job->production, method->parts,
-- quote->sales), matching the parent tables' own policies.

-- methodMaterialStep (parts)
ALTER TABLE "public"."methodMaterialStep" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SELECT" ON "public"."methodMaterialStep";
DROP POLICY IF EXISTS "INSERT" ON "public"."methodMaterialStep";
DROP POLICY IF EXISTS "UPDATE" ON "public"."methodMaterialStep";
DROP POLICY IF EXISTS "DELETE" ON "public"."methodMaterialStep";
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
DROP POLICY IF EXISTS "SELECT" ON "public"."jobMaterialStep";
DROP POLICY IF EXISTS "INSERT" ON "public"."jobMaterialStep";
DROP POLICY IF EXISTS "UPDATE" ON "public"."jobMaterialStep";
DROP POLICY IF EXISTS "DELETE" ON "public"."jobMaterialStep";
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
DROP POLICY IF EXISTS "SELECT" ON "public"."quoteMaterialStep";
DROP POLICY IF EXISTS "INSERT" ON "public"."quoteMaterialStep";
DROP POLICY IF EXISTS "UPDATE" ON "public"."quoteMaterialStep";
DROP POLICY IF EXISTS "DELETE" ON "public"."quoteMaterialStep";
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
DROP POLICY IF EXISTS "SELECT" ON "public"."methodOperationToolStep";
DROP POLICY IF EXISTS "INSERT" ON "public"."methodOperationToolStep";
DROP POLICY IF EXISTS "UPDATE" ON "public"."methodOperationToolStep";
DROP POLICY IF EXISTS "DELETE" ON "public"."methodOperationToolStep";
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
DROP POLICY IF EXISTS "SELECT" ON "public"."jobOperationToolStep";
DROP POLICY IF EXISTS "INSERT" ON "public"."jobOperationToolStep";
DROP POLICY IF EXISTS "UPDATE" ON "public"."jobOperationToolStep";
DROP POLICY IF EXISTS "DELETE" ON "public"."jobOperationToolStep";
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
DROP POLICY IF EXISTS "SELECT" ON "public"."quoteOperationToolStep";
DROP POLICY IF EXISTS "INSERT" ON "public"."quoteOperationToolStep";
DROP POLICY IF EXISTS "UPDATE" ON "public"."quoteOperationToolStep";
DROP POLICY IF EXISTS "DELETE" ON "public"."quoteOperationToolStep";
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
-- Guarded on the scalar columns still existing: on a re-run after 20260702143500
-- (below) has dropped them, the backfill is a no-op instead of a hard failure.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'methodMaterial'
      AND column_name = 'methodOperationStepId'
  ) THEN
    INSERT INTO "methodMaterialStep" ("methodMaterialId", "methodOperationStepId")
      SELECT "id", "methodOperationStepId" FROM "methodMaterial" WHERE "methodOperationStepId" IS NOT NULL
      ON CONFLICT DO NOTHING;
    INSERT INTO "jobMaterialStep" ("jobMaterialId", "jobOperationStepId")
      SELECT "id", "jobOperationStepId" FROM "jobMaterial" WHERE "jobOperationStepId" IS NOT NULL
      ON CONFLICT DO NOTHING;
    INSERT INTO "quoteMaterialStep" ("quoteMaterialId", "quoteOperationStepId")
      SELECT "id", "quoteOperationStepId" FROM "quoteMaterial" WHERE "quoteOperationStepId" IS NOT NULL
      ON CONFLICT DO NOTHING;
    INSERT INTO "methodOperationToolStep" ("methodOperationToolId", "methodOperationStepId")
      SELECT "id", "methodOperationStepId" FROM "methodOperationTool" WHERE "methodOperationStepId" IS NOT NULL
      ON CONFLICT DO NOTHING;
    INSERT INTO "jobOperationToolStep" ("jobOperationToolId", "jobOperationStepId")
      SELECT "id", "jobOperationStepId" FROM "jobOperationTool" WHERE "jobOperationStepId" IS NOT NULL
      ON CONFLICT DO NOTHING;
    INSERT INTO "quoteOperationToolStep" ("quoteOperationToolId", "quoteOperationStepId")
      SELECT "id", "quoteOperationStepId" FROM "quoteOperationTool" WHERE "quoteOperationStepId" IS NOT NULL
      ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- ===== 20260702143500_method-tree-step-many-drop-scalar.sql =====
-- Paired with 20260702143000. Now that methodMaterialStep exists and is backfilled,
-- drop the six scalar columns. The matching get_method_tree redefinition (surfacing
-- methodOperationStepIds JSONB aggregated from the join tables) lives in
-- 20260721004140_operation-type-consolidation.sql — see the note at 20260628161500
-- above for why no definition is created here. The pre-existing definition does not
-- reference these scalar columns (they were added by this branch), so dropping them
-- with that definition still in place is safe.

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

