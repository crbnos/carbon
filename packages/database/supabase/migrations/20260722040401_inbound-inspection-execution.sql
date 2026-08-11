-- Inbound inspection execution: document assignment, per-feature sampling,
-- per-lot feature plans, per-sample measurements.
-- Spec: .ai/specs/2026-07-21-inbound-inspection-execution.md

-- 1) Usage enum (extensible: 'FAI', 'Production' later)
DO $$ BEGIN
  CREATE TYPE "inspectionDocumentUsage" AS ENUM ('Receipt');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Item-level document assignment per usage slot
CREATE TABLE IF NOT EXISTS "itemInspectionDocumentAssignment" (
  "itemId" TEXT NOT NULL,
  "usage" "inspectionDocumentUsage" NOT NULL,
  "inspectionDocumentId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,

  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "itemInspectionDocumentAssignment_pkey" PRIMARY KEY ("itemId", "usage"),
  CONSTRAINT "itemInspectionDocumentAssignment_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "itemInspectionDocumentAssignment_inspectionDocumentId_fkey" FOREIGN KEY ("inspectionDocumentId") REFERENCES "inspectionDocument"("id") ON DELETE CASCADE,
  CONSTRAINT "itemInspectionDocumentAssignment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "itemInspectionDocumentAssignment_companyId_idx" ON "itemInspectionDocumentAssignment" ("companyId");
CREATE INDEX IF NOT EXISTS "itemInspectionDocumentAssignment_inspectionDocumentId_idx" ON "itemInspectionDocumentAssignment" ("inspectionDocumentId");
CREATE INDEX IF NOT EXISTS "itemInspectionDocumentAssignment_createdBy_idx" ON "itemInspectionDocumentAssignment" ("createdBy");

ALTER TABLE "public"."itemInspectionDocumentAssignment" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "SELECT" ON "public"."itemInspectionDocumentAssignment"
  FOR SELECT USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('quality_view'))::text[]
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "INSERT" ON "public"."itemInspectionDocumentAssignment"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('quality_create'))::text[]
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "UPDATE" ON "public"."itemInspectionDocumentAssignment"
  FOR UPDATE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('quality_update'))::text[]
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "DELETE" ON "public"."itemInspectionDocumentAssignment"
  FOR DELETE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('quality_delete'))::text[]
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) Per-feature sampling rule (nullable = inherit itemSamplingPlan)
ALTER TABLE "inspectionFeature"
  ADD COLUMN IF NOT EXISTS "samplingPlanType" "samplingPlanType",
  ADD COLUMN IF NOT EXISTS "samplingSampleSize" INTEGER,
  ADD COLUMN IF NOT EXISTS "samplingPercentage" NUMERIC,
  ADD COLUMN IF NOT EXISTS "samplingAql" NUMERIC,
  ADD COLUMN IF NOT EXISTS "samplingInspectionLevel" "inspectionLevel",
  ADD COLUMN IF NOT EXISTS "samplingSeverity" "inspectionSeverity";

-- 4) Lot -> document live reference
ALTER TABLE "inboundInspection"
  ADD COLUMN IF NOT EXISTS "inspectionDocumentId" TEXT;

DO $$ BEGIN
  ALTER TABLE "inboundInspection"
    ADD CONSTRAINT "inboundInspection_inspectionDocumentId_fkey"
    FOREIGN KEY ("inspectionDocumentId") REFERENCES "inspectionDocument"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "inboundInspection_inspectionDocumentId_idx" ON "inboundInspection" ("inspectionDocumentId");

-- 5) Per-lot per-feature resolved sampling plan
CREATE TABLE IF NOT EXISTS "inboundInspectionFeature" (
  "id" TEXT NOT NULL DEFAULT id('iif'),
  "inboundInspectionId" TEXT NOT NULL,
  "inspectionFeatureId" TEXT NOT NULL,
  "sampleSize" INTEGER NOT NULL,
  "acceptanceNumber" INTEGER NOT NULL,
  "rejectionNumber" INTEGER NOT NULL,
  "codeLetter" TEXT,
  "companyId" TEXT NOT NULL,

  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "inboundInspectionFeature_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inboundInspectionFeature_unique" UNIQUE ("inboundInspectionId", "inspectionFeatureId"),
  CONSTRAINT "inboundInspectionFeature_inboundInspectionId_fkey" FOREIGN KEY ("inboundInspectionId") REFERENCES "inboundInspection"("id") ON DELETE CASCADE,
  CONSTRAINT "inboundInspectionFeature_inspectionFeatureId_fkey" FOREIGN KEY ("inspectionFeatureId") REFERENCES "inspectionFeature"("id") ON DELETE CASCADE,
  CONSTRAINT "inboundInspectionFeature_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "inboundInspectionFeature_companyId_idx" ON "inboundInspectionFeature" ("companyId");
CREATE INDEX IF NOT EXISTS "inboundInspectionFeature_inboundInspectionId_idx" ON "inboundInspectionFeature" ("inboundInspectionId");
CREATE INDEX IF NOT EXISTS "inboundInspectionFeature_inspectionFeatureId_idx" ON "inboundInspectionFeature" ("inspectionFeatureId");
CREATE INDEX IF NOT EXISTS "inboundInspectionFeature_createdBy_idx" ON "inboundInspectionFeature" ("createdBy");

ALTER TABLE "public"."inboundInspectionFeature" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "SELECT" ON "public"."inboundInspectionFeature"
  FOR SELECT USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('quality_view'))::text[]
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "INSERT" ON "public"."inboundInspectionFeature"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('quality_create'))::text[]
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "UPDATE" ON "public"."inboundInspectionFeature"
  FOR UPDATE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('quality_update'))::text[]
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "DELETE" ON "public"."inboundInspectionFeature"
  FOR DELETE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('quality_delete'))::text[]
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 6) Per sample x feature measurement
CREATE TABLE IF NOT EXISTS "inboundInspectionMeasurement" (
  "id" TEXT NOT NULL DEFAULT id('iim'),
  "inboundInspectionId" TEXT NOT NULL,
  "inboundInspectionSampleId" TEXT NOT NULL,
  "inspectionFeatureId" TEXT NOT NULL,
  "value" NUMERIC,
  "status" "inboundInspectionSampleStatus" NOT NULL DEFAULT 'Pending',
  "notes" TEXT,
  "inspectedBy" TEXT,
  "inspectedAt" TIMESTAMP WITH TIME ZONE,
  "companyId" TEXT NOT NULL,

  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "inboundInspectionMeasurement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inboundInspectionMeasurement_unique" UNIQUE ("inboundInspectionSampleId", "inspectionFeatureId"),
  CONSTRAINT "inboundInspectionMeasurement_inboundInspectionId_fkey" FOREIGN KEY ("inboundInspectionId") REFERENCES "inboundInspection"("id") ON DELETE CASCADE,
  CONSTRAINT "inboundInspectionMeasurement_sampleId_fkey" FOREIGN KEY ("inboundInspectionSampleId") REFERENCES "inboundInspectionSample"("id") ON DELETE CASCADE,
  CONSTRAINT "inboundInspectionMeasurement_inspectionFeatureId_fkey" FOREIGN KEY ("inspectionFeatureId") REFERENCES "inspectionFeature"("id") ON DELETE CASCADE,
  CONSTRAINT "inboundInspectionMeasurement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "inboundInspectionMeasurement_inspectedBy_fkey" FOREIGN KEY ("inspectedBy") REFERENCES "user"("id")
);

CREATE INDEX IF NOT EXISTS "inboundInspectionMeasurement_companyId_idx" ON "inboundInspectionMeasurement" ("companyId");
CREATE INDEX IF NOT EXISTS "inboundInspectionMeasurement_inboundInspectionId_idx" ON "inboundInspectionMeasurement" ("inboundInspectionId");
CREATE INDEX IF NOT EXISTS "inboundInspectionMeasurement_sampleId_idx" ON "inboundInspectionMeasurement" ("inboundInspectionSampleId");
CREATE INDEX IF NOT EXISTS "inboundInspectionMeasurement_inspectionFeatureId_idx" ON "inboundInspectionMeasurement" ("inspectionFeatureId");
CREATE INDEX IF NOT EXISTS "inboundInspectionMeasurement_createdBy_idx" ON "inboundInspectionMeasurement" ("createdBy");

ALTER TABLE "public"."inboundInspectionMeasurement" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "SELECT" ON "public"."inboundInspectionMeasurement"
  FOR SELECT USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('quality_view'))::text[]
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "INSERT" ON "public"."inboundInspectionMeasurement"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('quality_create'))::text[]
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "UPDATE" ON "public"."inboundInspectionMeasurement"
  FOR UPDATE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('quality_update'))::text[]
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "DELETE" ON "public"."inboundInspectionMeasurement"
  FOR DELETE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('quality_delete'))::text[]
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 7) Fork save_inspection_document_atomic (newest prior definition:
-- 20260526142837_inspection-feature-type.sql) to persist the six per-feature
-- sampling columns. Signature is unchanged, so CREATE OR REPLACE suffices (no
-- DROP; the supabase CLI statement splitter also mis-chunks DROP+CREATE here).
-- Body preserved verbatim apart from: the six columns added to the feature
-- create INSERT, the feature update SET, and the returned features payload.
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
      "updatedBy" = p_user_id,
      "updatedAt" = NOW()
    WHERE "id" = v_item->>'id'
      AND "inspectionDocumentId" = p_inspection_document_id
      AND "companyId" = p_company_id;
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
