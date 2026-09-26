-- Certificates of Conformance + AS9102 First Article Inspection
-- Spec: .ai/specs/2026-09-25-cofc-fai-reports.md
--
-- 1. Enums for certificates, first articles, bonus tolerance; 'First Article'
--    added to inspectionSourceDocument / inspectionDocumentUsage (never used later
--    in this file — ADD VALUE is not usable in the same transaction).
-- 2. Inspection plan extensions (designator, reference location, MMC/LMC bonus
--    tolerance, drawing revision) and bonus/allowable snapshots on measurements.
-- 3. Requirement switches: customer CofC / first article flags, company first
--    article setting.
-- 4. Plans only on Inspection operations: clear the plans the MES never ran, then
--    enforce it with a CHECK on method/quote/job operations.
-- 5. certificate, complianceStatement(+Assignment), certificateOfConformance,
--    firstArticleInspection (1:1 extension of an inspection lot) and
--    firstArticleInspectionProduct (AS9102 Form 2 rows), with RLS.
-- 6. The COC sequence for existing companies.
-- 7. save_inspection_document_atomic persists the new feature columns and refuses
--    to delete a feature that has recorded results (the cascade used to wipe them).

-- ── 1. Enums ──────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "certificateType" AS ENUM ('Material', 'Special Process', 'Functional Test', 'Other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "firstArticleInspectionStatus" AS ENUM ('Draft', 'Verified', 'Approved');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "firstArticleInspectionScope" AS ENUM ('Full', 'Partial');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "firstArticleInspectionType" AS ENUM ('Detail', 'Assembly');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "firstArticleInspectionReason" AS ENUM (
    'New Part', 'Design Change', 'Manufacturing Source Change', 'Process Change',
    'Inspection Method Change', 'Tooling Change', 'Material Change', 'Location Change',
    'NC Program Change', 'Natural or Man-made Event', 'Production Lapse',
    'Corrective Action', 'Other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "customerApprovalVerification" AS ENUM ('Yes', 'No', 'N/A');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "materialCondition" AS ENUM ('RFS', 'MMC', 'LMC');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "featureOfSizeType" AS ENUM ('Internal', 'External');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TYPE "inspectionSourceDocument" ADD VALUE IF NOT EXISTS 'First Article';
ALTER TYPE "inspectionDocumentUsage" ADD VALUE IF NOT EXISTS 'First Article';

-- ── 2. Plan / measurement extensions ──────────────────────────────────
ALTER TABLE "inspectionDocument" ADD COLUMN IF NOT EXISTS "drawingRevision" TEXT;

ALTER TABLE "inspectionFeature"
  ADD COLUMN IF NOT EXISTS "designator" TEXT,
  ADD COLUMN IF NOT EXISTS "referenceLocation" TEXT,
  ADD COLUMN IF NOT EXISTS "materialCondition" "materialCondition",
  ADD COLUMN IF NOT EXISTS "sizeFeatureId" TEXT,
  ADD COLUMN IF NOT EXISTS "featureOfSize" "featureOfSizeType";

DO $$ BEGIN
  ALTER TABLE "inspectionFeature" ADD CONSTRAINT "inspectionFeature_sizeFeatureId_fkey"
    FOREIGN KEY ("sizeFeatureId") REFERENCES "inspectionFeature"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "inspectionFeature_sizeFeatureId_idx" ON "inspectionFeature" ("sizeFeatureId");

ALTER TABLE "inspectionMeasurement"
  ADD COLUMN IF NOT EXISTS "bonus" NUMERIC,
  ADD COLUMN IF NOT EXISTS "allowable" NUMERIC;

-- ── 3. Requirement switches ───────────────────────────────────────────
ALTER TABLE "customerShipping"
  ADD COLUMN IF NOT EXISTS "requiresCertificateOfConformance" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "requiresFirstArticle" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "requireFirstArticle" BOOLEAN NOT NULL DEFAULT false;

-- ── 4. Plans only on Inspection operations ────────────────────────────
-- The ERP normalizer already keeps a plan only on Inspection operations and the
-- MES never runs a plan anywhere else, so these rows were never inspected.
UPDATE "methodOperation" SET "inspectionDocumentId" = NULL
  WHERE "inspectionDocumentId" IS NOT NULL AND "operationType" IS DISTINCT FROM 'Inspection';
UPDATE "quoteOperation" SET "inspectionDocumentId" = NULL
  WHERE "inspectionDocumentId" IS NOT NULL AND "operationType" IS DISTINCT FROM 'Inspection';
UPDATE "jobOperation" SET "inspectionDocumentId" = NULL
  WHERE "inspectionDocumentId" IS NOT NULL AND "operationType" IS DISTINCT FROM 'Inspection';

DO $$ BEGIN
  ALTER TABLE "methodOperation" ADD CONSTRAINT "methodOperation_inspectionDocument_type_check"
    CHECK ("inspectionDocumentId" IS NULL OR "operationType" = 'Inspection');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "quoteOperation" ADD CONSTRAINT "quoteOperation_inspectionDocument_type_check"
    CHECK ("inspectionDocumentId" IS NULL OR "operationType" = 'Inspection');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "jobOperation" ADD CONSTRAINT "jobOperation_inspectionDocument_type_check"
    CHECK ("inspectionDocumentId" IS NULL OR "operationType" = 'Inspection');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 5a. certificate ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "certificate" (
  "id" TEXT NOT NULL DEFAULT id('cert'),
  "companyId" TEXT NOT NULL,
  "type" "certificateType" NOT NULL DEFAULT 'Material',
  "certificateNumber" TEXT NOT NULL,
  "specification" TEXT,
  "supplierId" TEXT REFERENCES "supplier"("id") ON DELETE SET NULL,
  "receiptLineId" TEXT REFERENCES "receiptLine"("id") ON DELETE CASCADE,
  "jobOperationId" TEXT REFERENCES "jobOperation"("id") ON DELETE CASCADE,
  "documentId" TEXT REFERENCES "document"("id") ON DELETE SET NULL,
  "notes" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "certificate_one_target" CHECK (num_nonnulls("receiptLineId", "jobOperationId") = 1)
);
CREATE INDEX IF NOT EXISTS "certificate_companyId_idx" ON "certificate" ("companyId");
CREATE INDEX IF NOT EXISTS "certificate_supplierId_idx" ON "certificate" ("supplierId");
CREATE INDEX IF NOT EXISTS "certificate_receiptLineId_idx" ON "certificate" ("receiptLineId");
CREATE INDEX IF NOT EXISTS "certificate_jobOperationId_idx" ON "certificate" ("jobOperationId");
CREATE INDEX IF NOT EXISTS "certificate_documentId_idx" ON "certificate" ("documentId");
CREATE INDEX IF NOT EXISTS "certificate_createdBy_idx" ON "certificate" ("createdBy");

-- ── 5b. complianceStatement / complianceStatementAssignment ───────────
CREATE TABLE IF NOT EXISTS "complianceStatement" (
  "id" TEXT NOT NULL DEFAULT id('cst'),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "appliesToAllCustomers" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "complianceStatement_companyId_idx" ON "complianceStatement" ("companyId");
CREATE INDEX IF NOT EXISTS "complianceStatement_createdBy_idx" ON "complianceStatement" ("createdBy");
DO $$ BEGIN
  ALTER TABLE "complianceStatement" ADD CONSTRAINT "complianceStatement_companyId_name_key"
    UNIQUE ("companyId", "name");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "complianceStatementAssignment" (
  "id" TEXT NOT NULL DEFAULT id('csa'),
  "companyId" TEXT NOT NULL,
  "complianceStatementId" TEXT NOT NULL,
  "customerId" TEXT REFERENCES "customer"("id") ON DELETE CASCADE,
  "itemId" TEXT REFERENCES "item"("id") ON DELETE CASCADE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  FOREIGN KEY ("complianceStatementId", "companyId")
    REFERENCES "complianceStatement"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "complianceStatementAssignment_one_target" CHECK (num_nonnulls("customerId", "itemId") = 1)
);
CREATE INDEX IF NOT EXISTS "complianceStatementAssignment_companyId_idx" ON "complianceStatementAssignment" ("companyId");
CREATE INDEX IF NOT EXISTS "complianceStatementAssignment_statement_idx" ON "complianceStatementAssignment" ("complianceStatementId");
CREATE INDEX IF NOT EXISTS "complianceStatementAssignment_customerId_idx" ON "complianceStatementAssignment" ("customerId");
CREATE INDEX IF NOT EXISTS "complianceStatementAssignment_itemId_idx" ON "complianceStatementAssignment" ("itemId");
CREATE INDEX IF NOT EXISTS "complianceStatementAssignment_createdBy_idx" ON "complianceStatementAssignment" ("createdBy");
CREATE UNIQUE INDEX IF NOT EXISTS "complianceStatementAssignment_customer_key"
  ON "complianceStatementAssignment" ("complianceStatementId", "customerId") WHERE "customerId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "complianceStatementAssignment_item_key"
  ON "complianceStatementAssignment" ("complianceStatementId", "itemId") WHERE "itemId" IS NOT NULL;

-- ── 5c. certificateOfConformance (issued records) ─────────────────────
CREATE TABLE IF NOT EXISTS "certificateOfConformance" (
  "id" TEXT NOT NULL DEFAULT id('coc'),
  "companyId" TEXT NOT NULL,
  "certificateId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "shipmentId" TEXT NOT NULL REFERENCES "shipment"("id") ON DELETE CASCADE,
  "customerId" TEXT REFERENCES "customer"("id") ON DELETE SET NULL,
  "reasonForUpdate" TEXT,
  "documentId" TEXT REFERENCES "document"("id") ON DELETE SET NULL,
  "signedBy" TEXT NOT NULL REFERENCES "user"("id"),
  "signedByName" TEXT NOT NULL,
  "signedByTitle" TEXT,
  "signedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "lastSentAt" TIMESTAMP WITH TIME ZONE,
  "lastSentTo" TEXT[],
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "certificateOfConformance_reason_check" CHECK ("revision" = 0 OR "reasonForUpdate" IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS "certificateOfConformance_companyId_idx" ON "certificateOfConformance" ("companyId");
CREATE INDEX IF NOT EXISTS "certificateOfConformance_shipmentId_idx" ON "certificateOfConformance" ("shipmentId");
CREATE INDEX IF NOT EXISTS "certificateOfConformance_customerId_idx" ON "certificateOfConformance" ("customerId");
CREATE INDEX IF NOT EXISTS "certificateOfConformance_documentId_idx" ON "certificateOfConformance" ("documentId");
CREATE INDEX IF NOT EXISTS "certificateOfConformance_signedBy_idx" ON "certificateOfConformance" ("signedBy");
CREATE INDEX IF NOT EXISTS "certificateOfConformance_createdBy_idx" ON "certificateOfConformance" ("createdBy");
DO $$ BEGIN
  ALTER TABLE "certificateOfConformance" ADD CONSTRAINT "certificateOfConformance_certificate_revision_key"
    UNIQUE ("companyId", "certificateId", "revision");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

-- ── 5d. firstArticleInspection (1:1 extension of an inspection lot) ───
CREATE TABLE IF NOT EXISTS "firstArticleInspection" (
  "id" TEXT NOT NULL DEFAULT id('fai'),
  "companyId" TEXT NOT NULL,
  "inspectionId" TEXT NOT NULL REFERENCES "inspection"("id") ON DELETE CASCADE,
  "status" "firstArticleInspectionStatus" NOT NULL DEFAULT 'Draft',
  "itemId" TEXT NOT NULL REFERENCES "item"("id") ON DELETE RESTRICT,
  "jobId" TEXT NOT NULL REFERENCES "job"("id") ON DELETE RESTRICT,
  "jobMakeMethodId" TEXT NOT NULL REFERENCES "jobMakeMethod"("id") ON DELETE RESTRICT,
  "type" "firstArticleInspectionType" NOT NULL DEFAULT 'Detail',
  "scope" "firstArticleInspectionScope" NOT NULL DEFAULT 'Full',
  "reason" "firstArticleInspectionReason" NOT NULL DEFAULT 'New Part',
  "baselineFirstArticleInspectionId" TEXT,
  "baselineReference" TEXT,
  "partNumber" TEXT NOT NULL,
  "partName" TEXT NOT NULL,
  "partRevision" TEXT,
  "drawingNumber" TEXT,
  "drawingRevision" TEXT,
  "additionalChanges" TEXT,
  "manufacturingProcessReference" TEXT NOT NULL,
  "organizationName" TEXT NOT NULL,
  "supplierCode" TEXT,
  "purchaseOrderNumber" TEXT,
  "hasNonconformance" BOOLEAN,
  "comments" TEXT,
  "verifiedBy" TEXT REFERENCES "user"("id"),
  "verifiedByName" TEXT,
  "verifiedByTitle" TEXT,
  "verifiedAt" TIMESTAMP WITH TIME ZONE,
  "approvedBy" TEXT REFERENCES "user"("id"),
  "approvedByName" TEXT,
  "approvedByTitle" TEXT,
  "approvedAt" TIMESTAMP WITH TIME ZONE,
  "customerApprovalName" TEXT,
  "customerApprovalDate" DATE,
  "documentId" TEXT REFERENCES "document"("id") ON DELETE SET NULL,
  "customFields" JSONB,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  FOREIGN KEY ("baselineFirstArticleInspectionId", "companyId")
    REFERENCES "firstArticleInspection"("id", "companyId") ON DELETE SET NULL ("baselineFirstArticleInspectionId")
);
CREATE UNIQUE INDEX IF NOT EXISTS "firstArticleInspection_inspectionId_key" ON "firstArticleInspection" ("inspectionId");
CREATE INDEX IF NOT EXISTS "firstArticleInspection_companyId_idx" ON "firstArticleInspection" ("companyId");
CREATE INDEX IF NOT EXISTS "firstArticleInspection_itemId_idx" ON "firstArticleInspection" ("itemId");
CREATE INDEX IF NOT EXISTS "firstArticleInspection_jobId_idx" ON "firstArticleInspection" ("jobId");
CREATE INDEX IF NOT EXISTS "firstArticleInspection_jobMakeMethodId_idx" ON "firstArticleInspection" ("jobMakeMethodId");
CREATE INDEX IF NOT EXISTS "firstArticleInspection_baseline_idx" ON "firstArticleInspection" ("baselineFirstArticleInspectionId");
CREATE INDEX IF NOT EXISTS "firstArticleInspection_verifiedBy_idx" ON "firstArticleInspection" ("verifiedBy");
CREATE INDEX IF NOT EXISTS "firstArticleInspection_approvedBy_idx" ON "firstArticleInspection" ("approvedBy");
CREATE INDEX IF NOT EXISTS "firstArticleInspection_documentId_idx" ON "firstArticleInspection" ("documentId");
CREATE INDEX IF NOT EXISTS "firstArticleInspection_createdBy_idx" ON "firstArticleInspection" ("createdBy");

-- ── 5e. firstArticleInspectionProduct (AS9102 Form 2 rows) ────────────
CREATE TABLE IF NOT EXISTS "firstArticleInspectionProduct" (
  "id" TEXT NOT NULL DEFAULT id('faid'),
  "companyId" TEXT NOT NULL,
  "firstArticleInspectionId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "kind" "certificateType" NOT NULL,
  "name" TEXT NOT NULL,
  "specification" TEXT,
  "code" TEXT,
  "supplier" TEXT,
  "customerApprovalVerification" "customerApprovalVerification" NOT NULL DEFAULT 'N/A',
  "certificateNumber" TEXT,
  "functionalTestProcedureNumber" TEXT,
  "acceptanceReportNumber" TEXT,
  "comments" TEXT,
  "certificateId" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  FOREIGN KEY ("firstArticleInspectionId", "companyId")
    REFERENCES "firstArticleInspection"("id", "companyId") ON DELETE CASCADE,
  FOREIGN KEY ("certificateId", "companyId")
    REFERENCES "certificate"("id", "companyId") ON DELETE SET NULL ("certificateId")
);
CREATE INDEX IF NOT EXISTS "firstArticleInspectionProduct_companyId_idx" ON "firstArticleInspectionProduct" ("companyId");
CREATE INDEX IF NOT EXISTS "firstArticleInspectionProduct_fai_idx" ON "firstArticleInspectionProduct" ("firstArticleInspectionId");
CREATE INDEX IF NOT EXISTS "firstArticleInspectionProduct_certificateId_idx" ON "firstArticleInspectionProduct" ("certificateId");
CREATE INDEX IF NOT EXISTS "firstArticleInspectionProduct_createdBy_idx" ON "firstArticleInspectionProduct" ("createdBy");

-- ── 5f. RLS ───────────────────────────────────────────────────────────
-- Quality-owned tables
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'complianceStatement',
    'complianceStatementAssignment',
    'firstArticleInspection',
    'firstArticleInspectionProduct'
  ]
  LOOP
    EXECUTE format('ALTER TABLE "public".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "SELECT" ON "public".%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "INSERT" ON "public".%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "UPDATE" ON "public".%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "DELETE" ON "public".%I', t);
    EXECUTE format('CREATE POLICY "SELECT" ON "public".%I FOR SELECT USING ("companyId" = ANY ((SELECT get_companies_with_employee_role())::text[]))', t);
    EXECUTE format('CREATE POLICY "INSERT" ON "public".%I FOR INSERT WITH CHECK ("companyId" = ANY ((SELECT get_companies_with_employee_permission(''quality_create''))::text[]))', t);
    EXECUTE format('CREATE POLICY "UPDATE" ON "public".%I FOR UPDATE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission(''quality_update''))::text[]))', t);
    EXECUTE format('CREATE POLICY "DELETE" ON "public".%I FOR DELETE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission(''quality_delete''))::text[]))', t);
  END LOOP;
END $$;

-- certificateOfConformance: shipments are inventory
ALTER TABLE "public"."certificateOfConformance" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SELECT" ON "public"."certificateOfConformance";
DROP POLICY IF EXISTS "INSERT" ON "public"."certificateOfConformance";
DROP POLICY IF EXISTS "UPDATE" ON "public"."certificateOfConformance";
DROP POLICY IF EXISTS "DELETE" ON "public"."certificateOfConformance";
CREATE POLICY "SELECT" ON "public"."certificateOfConformance" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[]));
CREATE POLICY "INSERT" ON "public"."certificateOfConformance" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_update'))::text[]));
CREATE POLICY "UPDATE" ON "public"."certificateOfConformance" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_update'))::text[]));
CREATE POLICY "DELETE" ON "public"."certificateOfConformance" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_delete'))::text[]));

-- certificate: receiving (inventory) or quality
ALTER TABLE "public"."certificate" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SELECT" ON "public"."certificate";
DROP POLICY IF EXISTS "INSERT" ON "public"."certificate";
DROP POLICY IF EXISTS "UPDATE" ON "public"."certificate";
DROP POLICY IF EXISTS "DELETE" ON "public"."certificate";
CREATE POLICY "SELECT" ON "public"."certificate" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[]));
CREATE POLICY "INSERT" ON "public"."certificate" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_create'))::text[])
  OR "companyId" = ANY ((SELECT get_companies_with_employee_permission('quality_create'))::text[]));
CREATE POLICY "UPDATE" ON "public"."certificate" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_update'))::text[])
  OR "companyId" = ANY ((SELECT get_companies_with_employee_permission('quality_update'))::text[]));
CREATE POLICY "DELETE" ON "public"."certificate" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_delete'))::text[])
  OR "companyId" = ANY ((SELECT get_companies_with_employee_permission('quality_delete'))::text[]));

-- ── 6. Sequence for existing companies ────────────────────────────────
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'certificateOfConformance', 'Certificate of Conformance', 'COC', NULL, 0, 6, 1, c."id"
FROM "company" c
ON CONFLICT DO NOTHING;

-- ── 7. save_inspection_document_atomic ────────────────────────────────
-- Fork of the newest definition (20260722040401_inbound-inspection-execution.sql).
-- Signature unchanged, so CREATE OR REPLACE suffices. Body preserved verbatim apart
-- from: the delete refusal for features with recorded results, the five new
-- feature columns (designator, referenceLocation, materialCondition, featureOfSize
-- in the create INSERT / update SET; sizeFeatureId in a pass after both, so a new
-- feature can reference another new feature by tempId), and the returned payload.
CREATE OR REPLACE FUNCTION save_inspection_document_atomic(
  p_inspection_document_id TEXT,
  p_company_id TEXT,
  p_user_id TEXT,
  p_pdf_url TEXT DEFAULT NULL,
  p_page_count INTEGER DEFAULT NULL,
  p_default_page_width DOUBLE PRECISION DEFAULT NULL,
  p_default_page_height DOUBLE PRECISION DEFAULT NULL,
  p_features JSONB DEFAULT '{}'::jsonb,
  p_balloons JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_document RECORD;
  v_storage_path TEXT;
  v_features_create JSONB := COALESCE(p_features->'create', '[]'::jsonb);
  v_features_update JSONB := COALESCE(p_features->'update', '[]'::jsonb);
  v_features_delete JSONB := COALESCE(p_features->'delete', '[]'::jsonb);
  v_balloons_create JSONB := COALESCE(p_balloons->'create', '[]'::jsonb);
  v_balloons_update JSONB := COALESCE(p_balloons->'update', '[]'::jsonb);
  v_balloons_delete JSONB := COALESCE(p_balloons->'delete', '[]'::jsonb);
  v_item JSONB;
  v_temp_id TEXT;
  v_feature_id TEXT;
  v_balloon_id TEXT;
  v_feature_id_map JSONB := '{}'::jsonb;
  v_balloon_anchor_id_map JSONB := '{}'::jsonb;
  v_blocked_label TEXT;
  v_size_ref TEXT;
BEGIN
  SELECT *
  INTO v_document
  FROM "inspectionDocument"
  WHERE "id" = p_inspection_document_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inspection document not found';
  END IF;

  IF v_document."companyId" <> p_company_id THEN
    RAISE EXCEPTION 'Inspection document does not belong to this company';
  END IF;

  v_storage_path := NULLIF(
    regexp_replace(COALESCE(p_pdf_url, ''), '^/file/preview/private/', ''),
    ''
  );

  UPDATE "inspectionDocument"
  SET
    "storagePath" = CASE
      WHEN v_storage_path IS NOT NULL THEN v_storage_path
      ELSE "storagePath"
    END,
    "fileName" = CASE
      WHEN v_storage_path IS NOT NULL THEN split_part(v_storage_path, '/', array_length(string_to_array(v_storage_path, '/'), 1))
      ELSE "fileName"
    END,
    "uploadedBy" = CASE
      WHEN v_storage_path IS NOT NULL THEN p_user_id
      ELSE "uploadedBy"
    END,
    "pageCount" = CASE
      WHEN p_page_count IS NOT NULL AND p_page_count > 0 THEN p_page_count
      ELSE "pageCount"
    END,
    "defaultPageWidth" = CASE
      WHEN p_default_page_width IS NOT NULL AND p_default_page_width > 0 THEN p_default_page_width
      ELSE "defaultPageWidth"
    END,
    "defaultPageHeight" = CASE
      WHEN p_default_page_height IS NOT NULL AND p_default_page_height > 0 THEN p_default_page_height
      ELSE "defaultPageHeight"
    END,
    "updatedBy" = p_user_id,
    "updatedAt" = NOW()
  WHERE "id" = p_inspection_document_id
    AND "companyId" = p_company_id;

  IF jsonb_array_length(v_features_delete) > 0 THEN
    -- A recorded result is quality evidence: deleting its feature would cascade
    -- the measurement away on every lot, closed ones included.
    SELECT f."label"
    INTO v_blocked_label
    FROM "inspectionFeature" f
    WHERE f."id" = ANY (
      SELECT jsonb_array_elements_text(v_features_delete)
    )
      AND f."inspectionDocumentId" = p_inspection_document_id
      AND f."companyId" = p_company_id
      AND EXISTS (
        SELECT 1 FROM "inspectionMeasurement" m
        WHERE m."inspectionFeatureId" = f."id"
      )
    ORDER BY f."label"
    LIMIT 1;

    IF v_blocked_label IS NOT NULL THEN
      RAISE EXCEPTION 'Feature "%" has recorded results and cannot be deleted', v_blocked_label
        USING ERRCODE = 'P0001';
    END IF;

    DELETE FROM "inspectionFeature"
    WHERE "id" = ANY (
      SELECT jsonb_array_elements_text(v_features_delete)
    )
      AND "inspectionDocumentId" = p_inspection_document_id
      AND "companyId" = p_company_id;
  END IF;

  IF jsonb_array_length(v_balloons_delete) > 0 THEN
    DELETE FROM "balloon"
    WHERE "id" = ANY (
      SELECT jsonb_array_elements_text(v_balloons_delete)
    )
      AND "inspectionDocumentId" = p_inspection_document_id
      AND "companyId" = p_company_id;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_features_create)
  LOOP
    INSERT INTO "inspectionFeature" (
      "inspectionDocumentId",
      "companyId",
      "pageNumber",
      "label",
      "description",
      "nominalValue",
      "tolerancePlus",
      "toleranceMinus",
      "unit",
      "type",
      "samplingPlanType",
      "samplingSampleSize",
      "samplingPercentage",
      "samplingAql",
      "samplingInspectionLevel",
      "samplingSeverity",
      "designator",
      "referenceLocation",
      "materialCondition",
      "featureOfSize",
      "createdBy",
      "updatedBy"
    ) VALUES (
      p_inspection_document_id,
      p_company_id,
      COALESCE((v_item->>'pageNumber')::INTEGER, 1),
      COALESCE(v_item->>'label', ''),
      CASE WHEN v_item ? 'description' THEN v_item->>'description' ELSE NULL END,
      CASE WHEN v_item ? 'nominalValue' THEN v_item->>'nominalValue' ELSE NULL END,
      CASE WHEN v_item ? 'tolerancePlus' THEN v_item->>'tolerancePlus' ELSE NULL END,
      CASE WHEN v_item ? 'toleranceMinus' THEN v_item->>'toleranceMinus' ELSE NULL END,
      CASE WHEN v_item ? 'unit' THEN v_item->>'unit' ELSE NULL END,
      COALESCE((v_item->>'type')::"procedureStepType", 'Measurement'::"procedureStepType"),
      CASE WHEN v_item ? 'samplingPlanType' THEN NULLIF(v_item->>'samplingPlanType', '')::"samplingPlanType" ELSE NULL END,
      CASE WHEN v_item ? 'samplingSampleSize' THEN (v_item->>'samplingSampleSize')::INTEGER ELSE NULL END,
      CASE WHEN v_item ? 'samplingPercentage' THEN (v_item->>'samplingPercentage')::NUMERIC ELSE NULL END,
      CASE WHEN v_item ? 'samplingAql' THEN (v_item->>'samplingAql')::NUMERIC ELSE NULL END,
      CASE WHEN v_item ? 'samplingInspectionLevel' THEN NULLIF(v_item->>'samplingInspectionLevel', '')::"inspectionLevel" ELSE NULL END,
      CASE WHEN v_item ? 'samplingSeverity' THEN NULLIF(v_item->>'samplingSeverity', '')::"inspectionSeverity" ELSE NULL END,
      CASE WHEN v_item ? 'designator' THEN NULLIF(v_item->>'designator', '') ELSE NULL END,
      CASE WHEN v_item ? 'referenceLocation' THEN NULLIF(v_item->>'referenceLocation', '') ELSE NULL END,
      CASE WHEN v_item ? 'materialCondition' THEN NULLIF(v_item->>'materialCondition', '')::"materialCondition" ELSE NULL END,
      CASE WHEN v_item ? 'featureOfSize' THEN NULLIF(v_item->>'featureOfSize', '')::"featureOfSizeType" ELSE NULL END,
      p_user_id,
      p_user_id
    )
    RETURNING "id" INTO v_feature_id;

    v_temp_id := v_item->>'tempId';
    IF v_temp_id IS NOT NULL AND length(v_temp_id) > 0 THEN
      v_feature_id_map := v_feature_id_map || jsonb_build_object(v_temp_id, v_feature_id);
    END IF;
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_balloons_create)
  LOOP
    v_feature_id := NULL;
    IF v_item ? 'inspectionFeatureId' THEN
      v_feature_id := v_item->>'inspectionFeatureId';
    ELSIF v_item ? 'tempInspectionFeatureId' THEN
      v_temp_id := v_item->>'tempInspectionFeatureId';
      IF v_feature_id_map ? v_temp_id THEN
        v_feature_id := v_feature_id_map->>v_temp_id;
      END IF;
    END IF;

    IF v_feature_id IS NULL OR length(v_feature_id) = 0 THEN
      RAISE EXCEPTION 'balloon create requires inspectionFeatureId or tempInspectionFeatureId';
    END IF;

    INSERT INTO "balloon" (
      "inspectionDocumentId",
      "companyId",
      "inspectionFeatureId",
      "pageNumber",
      "regionX",
      "regionY",
      "regionWidth",
      "regionHeight",
      "xCoordinate",
      "yCoordinate",
      "createdBy",
      "updatedBy"
    ) VALUES (
      p_inspection_document_id,
      p_company_id,
      v_feature_id,
      COALESCE((v_item->>'pageNumber')::INTEGER, 1),
      COALESCE((v_item->>'regionX')::DOUBLE PRECISION, 0),
      COALESCE((v_item->>'regionY')::DOUBLE PRECISION, 0),
      COALESCE((v_item->>'regionWidth')::DOUBLE PRECISION, 0.1),
      COALESCE((v_item->>'regionHeight')::DOUBLE PRECISION, 0.1),
      COALESCE((v_item->>'xCoordinate')::DOUBLE PRECISION, 0),
      COALESCE((v_item->>'yCoordinate')::DOUBLE PRECISION, 0),
      p_user_id,
      p_user_id
    )
    RETURNING "id" INTO v_balloon_id;

    v_temp_id := v_item->>'tempBalloonAnchorId';
    IF v_temp_id IS NOT NULL AND length(v_temp_id) > 0 THEN
      v_balloon_anchor_id_map := v_balloon_anchor_id_map || jsonb_build_object(v_temp_id, v_balloon_id);
    END IF;
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_features_update)
  LOOP
    UPDATE "inspectionFeature"
    SET
      "pageNumber" = CASE WHEN v_item ? 'pageNumber' THEN (v_item->>'pageNumber')::INTEGER ELSE "pageNumber" END,
      "label" = CASE WHEN v_item ? 'label' THEN v_item->>'label' ELSE "label" END,
      "description" = CASE WHEN v_item ? 'description' THEN v_item->>'description' ELSE "description" END,
      "nominalValue" = CASE WHEN v_item ? 'nominalValue' THEN v_item->>'nominalValue' ELSE "nominalValue" END,
      "tolerancePlus" = CASE WHEN v_item ? 'tolerancePlus' THEN v_item->>'tolerancePlus' ELSE "tolerancePlus" END,
      "toleranceMinus" = CASE WHEN v_item ? 'toleranceMinus' THEN v_item->>'toleranceMinus' ELSE "toleranceMinus" END,
      "unit" = CASE WHEN v_item ? 'unit' THEN v_item->>'unit' ELSE "unit" END,
      "type" = CASE WHEN v_item ? 'type' THEN (v_item->>'type')::"procedureStepType" ELSE "type" END,
      "samplingPlanType" = CASE WHEN v_item ? 'samplingPlanType' THEN NULLIF(v_item->>'samplingPlanType', '')::"samplingPlanType" ELSE "samplingPlanType" END,
      "samplingSampleSize" = CASE WHEN v_item ? 'samplingSampleSize' THEN (v_item->>'samplingSampleSize')::INTEGER ELSE "samplingSampleSize" END,
      "samplingPercentage" = CASE WHEN v_item ? 'samplingPercentage' THEN (v_item->>'samplingPercentage')::NUMERIC ELSE "samplingPercentage" END,
      "samplingAql" = CASE WHEN v_item ? 'samplingAql' THEN (v_item->>'samplingAql')::NUMERIC ELSE "samplingAql" END,
      "samplingInspectionLevel" = CASE WHEN v_item ? 'samplingInspectionLevel' THEN NULLIF(v_item->>'samplingInspectionLevel', '')::"inspectionLevel" ELSE "samplingInspectionLevel" END,
      "samplingSeverity" = CASE WHEN v_item ? 'samplingSeverity' THEN NULLIF(v_item->>'samplingSeverity', '')::"inspectionSeverity" ELSE "samplingSeverity" END,
      "designator" = CASE WHEN v_item ? 'designator' THEN NULLIF(v_item->>'designator', '') ELSE "designator" END,
      "referenceLocation" = CASE WHEN v_item ? 'referenceLocation' THEN NULLIF(v_item->>'referenceLocation', '') ELSE "referenceLocation" END,
      "materialCondition" = CASE WHEN v_item ? 'materialCondition' THEN NULLIF(v_item->>'materialCondition', '')::"materialCondition" ELSE "materialCondition" END,
      "featureOfSize" = CASE WHEN v_item ? 'featureOfSize' THEN NULLIF(v_item->>'featureOfSize', '')::"featureOfSizeType" ELSE "featureOfSize" END,
      "updatedBy" = p_user_id,
      "updatedAt" = NOW()
    WHERE "id" = v_item->>'id'
      AND "inspectionDocumentId" = p_inspection_document_id
      AND "companyId" = p_company_id;
  END LOOP;

  -- sizeFeatureId last, once every created feature has its real id: the value may
  -- be a real feature id or the tempId of a feature created in this same save.
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_features_create || v_features_update)
  LOOP
    IF v_item ? 'sizeFeatureId' THEN
      v_feature_id := COALESCE(
        NULLIF(v_item->>'id', ''),
        v_feature_id_map->>(v_item->>'tempId')
      );
      v_size_ref := NULLIF(v_item->>'sizeFeatureId', '');

      IF v_feature_id IS NOT NULL THEN
        UPDATE "inspectionFeature"
        SET "sizeFeatureId" = CASE
          WHEN v_size_ref IS NULL THEN NULL
          ELSE COALESCE(v_feature_id_map->>v_size_ref, v_size_ref)
        END
        WHERE "id" = v_feature_id
          AND "inspectionDocumentId" = p_inspection_document_id
          AND "companyId" = p_company_id;
      END IF;
    END IF;
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_balloons_update)
  LOOP
    UPDATE "balloon"
    SET
      "pageNumber" = CASE WHEN v_item ? 'pageNumber' THEN (v_item->>'pageNumber')::INTEGER ELSE "pageNumber" END,
      "regionX" = CASE WHEN v_item ? 'regionX' THEN (v_item->>'regionX')::DOUBLE PRECISION ELSE "regionX" END,
      "regionY" = CASE WHEN v_item ? 'regionY' THEN (v_item->>'regionY')::DOUBLE PRECISION ELSE "regionY" END,
      "regionWidth" = CASE WHEN v_item ? 'regionWidth' THEN (v_item->>'regionWidth')::DOUBLE PRECISION ELSE "regionWidth" END,
      "regionHeight" = CASE WHEN v_item ? 'regionHeight' THEN (v_item->>'regionHeight')::DOUBLE PRECISION ELSE "regionHeight" END,
      "xCoordinate" = CASE WHEN v_item ? 'xCoordinate' THEN (v_item->>'xCoordinate')::DOUBLE PRECISION ELSE "xCoordinate" END,
      "yCoordinate" = CASE WHEN v_item ? 'yCoordinate' THEN (v_item->>'yCoordinate')::DOUBLE PRECISION ELSE "yCoordinate" END,
      "updatedBy" = p_user_id,
      "updatedAt" = NOW()
    WHERE "id" = v_item->>'id'
      AND "inspectionDocumentId" = p_inspection_document_id
      AND "companyId" = p_company_id;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'featureIdMap', v_feature_id_map,
    'balloonAnchorIdMap', v_balloon_anchor_id_map,
    'features', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f."id",
        'inspectionDocumentId', f."inspectionDocumentId",
        'companyId', f."companyId",
        'pageNumber', f."pageNumber",
        'label', f."label",
        'description', f."description",
        'nominalValue', f."nominalValue",
        'tolerancePlus', f."tolerancePlus",
        'toleranceMinus', f."toleranceMinus",
        'unit', f."unit",
        'type', f."type",
        'samplingPlanType', f."samplingPlanType",
        'samplingSampleSize', f."samplingSampleSize",
        'samplingPercentage', f."samplingPercentage",
        'samplingAql', f."samplingAql",
        'samplingInspectionLevel', f."samplingInspectionLevel",
        'samplingSeverity', f."samplingSeverity",
        'designator', f."designator",
        'referenceLocation', f."referenceLocation",
        'materialCondition', f."materialCondition",
        'sizeFeatureId', f."sizeFeatureId",
        'featureOfSize', f."featureOfSize",
        'balloonId', b."id",
        'createdBy', f."createdBy",
        'updatedBy', f."updatedBy",
        'createdAt', f."createdAt",
        'updatedAt', f."updatedAt"
      ) ORDER BY f."createdAt" ASC)
      FROM "inspectionFeature" f
      LEFT JOIN "balloon" b
        ON b."inspectionFeatureId" = f."id"
        AND b."companyId" = f."companyId"
      WHERE f."inspectionDocumentId" = p_inspection_document_id
        AND f."companyId" = p_company_id
    ), '[]'::jsonb),
    'balloons', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', b."id",
        'inspectionDocumentId', b."inspectionDocumentId",
        'companyId', b."companyId",
        'inspectionFeatureId', b."inspectionFeatureId",
        'pageNumber', b."pageNumber",
        'regionX', b."regionX",
        'regionY', b."regionY",
        'regionWidth', b."regionWidth",
        'regionHeight', b."regionHeight",
        'xCoordinate', b."xCoordinate",
        'yCoordinate', b."yCoordinate",
        'createdBy', b."createdBy",
        'updatedBy', b."updatedBy",
        'createdAt', b."createdAt",
        'updatedAt', b."updatedAt"
      ) ORDER BY b."createdAt" ASC)
      FROM "balloon" b
      WHERE b."inspectionDocumentId" = p_inspection_document_id
        AND b."companyId" = p_company_id
    ), '[]'::jsonb),
    'anchors', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', b."id",
        'pageNumber', b."pageNumber",
        'xCoordinate', b."regionX",
        'yCoordinate', b."regionY",
        'width', b."regionWidth",
        'height', b."regionHeight"
      ) ORDER BY b."createdAt" ASC)
      FROM "balloon" b
      WHERE b."inspectionDocumentId" = p_inspection_document_id
        AND b."companyId" = p_company_id
    ), '[]'::jsonb)
  );
END;
$$;
