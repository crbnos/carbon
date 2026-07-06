-- Inspection document tables
-- - "inspectionDocument" is the parent entity
-- - "inspectionFeature" stores characteristic grid data (label, tolerances, etc.)
-- - "balloon" stores drawing geometry only; optional 1:1 placement per feature (hard delete)

CREATE TABLE "inspectionDocument" (
  "id" TEXT NOT NULL DEFAULT id('idc'),
  "companyId" TEXT NOT NULL,
  "partId" TEXT NOT NULL,
  "drawingNumber" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "storagePath" TEXT,
  "fileName" TEXT,
  "pageCount" INTEGER,
  "defaultPageWidth" DOUBLE PRECISION,
  "defaultPageHeight" DOUBLE PRECISION,
  "uploadedBy" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "inspectionDocument_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "inspectionDocument_id_unique" UNIQUE ("id"),
  CONSTRAINT "inspectionDocument_version_check" CHECK ("version" >= 0),
  CONSTRAINT "inspectionDocument_pageCount_check" CHECK ("pageCount" > 0),
  CONSTRAINT "inspectionDocument_defaultPageWidth_check" CHECK ("defaultPageWidth" > 0),
  CONSTRAINT "inspectionDocument_defaultPageHeight_check" CHECK ("defaultPageHeight" > 0),

  CONSTRAINT "inspectionDocument_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "inspectionDocument_partId_fkey"
    FOREIGN KEY ("partId") REFERENCES "item"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inspectionDocument_uploadedBy_fkey"
    FOREIGN KEY ("uploadedBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "inspectionDocument_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "inspectionDocument_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE TABLE "inspectionFeature" (
  "id" TEXT NOT NULL DEFAULT id('ift'),
  "inspectionDocumentId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "pageNumber" INTEGER NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT,
  "nominalValue" TEXT,
  "tolerancePlus" TEXT,
  "toleranceMinus" TEXT,
  "unit" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "inspectionFeature_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "inspectionFeature_id_unique" UNIQUE ("id"),
  CONSTRAINT "inspectionFeature_pageNumber_check" CHECK ("pageNumber" > 0),

  CONSTRAINT "inspectionFeature_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "inspectionFeature_document_company_fkey"
    FOREIGN KEY ("inspectionDocumentId", "companyId")
    REFERENCES "inspectionDocument"("id", "companyId")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "inspectionFeature_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "inspectionFeature_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE TABLE "balloon" (
  "id" TEXT NOT NULL DEFAULT id('bbn'),
  "inspectionDocumentId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "inspectionFeatureId" TEXT NOT NULL,
  "pageNumber" INTEGER NOT NULL,
  "regionX" DOUBLE PRECISION NOT NULL,
  "regionY" DOUBLE PRECISION NOT NULL,
  "regionWidth" DOUBLE PRECISION NOT NULL,
  "regionHeight" DOUBLE PRECISION NOT NULL,
  "xCoordinate" DOUBLE PRECISION NOT NULL,
  "yCoordinate" DOUBLE PRECISION NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "balloon_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "balloon_id_unique" UNIQUE ("id"),
  CONSTRAINT "balloon_inspectionFeatureId_unique" UNIQUE ("inspectionFeatureId"),
  CONSTRAINT "balloon_pageNumber_check" CHECK ("pageNumber" > 0),
  CONSTRAINT "balloon_regionX_check" CHECK ("regionX" >= 0 AND "regionX" <= 1),
  CONSTRAINT "balloon_regionY_check" CHECK ("regionY" >= 0 AND "regionY" <= 1),
  CONSTRAINT "balloon_regionWidth_check" CHECK ("regionWidth" > 0 AND "regionWidth" <= 1),
  CONSTRAINT "balloon_regionHeight_check" CHECK ("regionHeight" > 0 AND "regionHeight" <= 1),
  CONSTRAINT "balloon_region_xw_bounds_check" CHECK ("regionX" + "regionWidth" <= 1),
  CONSTRAINT "balloon_region_yh_bounds_check" CHECK ("regionY" + "regionHeight" <= 1),
  CONSTRAINT "balloon_xCoordinate_check" CHECK ("xCoordinate" >= 0 AND "xCoordinate" <= 1),
  CONSTRAINT "balloon_yCoordinate_check" CHECK ("yCoordinate" >= 0 AND "yCoordinate" <= 1),

  CONSTRAINT "balloon_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "balloon_document_company_fkey"
    FOREIGN KEY ("inspectionDocumentId", "companyId")
    REFERENCES "inspectionDocument"("id", "companyId")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "balloon_inspectionFeatureId_fkey"
    FOREIGN KEY ("inspectionFeatureId", "companyId")
    REFERENCES "inspectionFeature"("id", "companyId")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "balloon_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "balloon_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "inspectionDocument_companyId_idx" ON "inspectionDocument" ("companyId");
CREATE INDEX "inspectionDocument_partId_idx" ON "inspectionDocument" ("partId");

CREATE INDEX "inspectionFeature_companyId_idx" ON "inspectionFeature" ("companyId");
CREATE INDEX "inspectionFeature_inspectionDocumentId_idx"
  ON "inspectionFeature" ("inspectionDocumentId");
CREATE INDEX "inspectionFeature_document_page_idx"
  ON "inspectionFeature" ("inspectionDocumentId", "companyId", "pageNumber");

CREATE INDEX "balloon_companyId_idx" ON "balloon" ("companyId");
CREATE INDEX "balloon_inspectionDocumentId_idx" ON "balloon" ("inspectionDocumentId");
CREATE INDEX "balloon_document_page_idx" ON "balloon" ("inspectionDocumentId", "companyId", "pageNumber");

CREATE OR REPLACE FUNCTION enforce_unique_inspection_feature_label_per_page()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "inspectionFeature"
    WHERE "inspectionDocumentId" = NEW."inspectionDocumentId"
      AND "companyId" = NEW."companyId"
      AND "pageNumber" = NEW."pageNumber"
      AND "label" = NEW."label"
      AND "id" <> COALESCE(NEW."id", '')
  ) THEN
    RAISE EXCEPTION 'duplicate feature label "%" on inspectionDocument page %', NEW."label", NEW."pageNumber";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_inspection_feature_unique_label_per_page"
BEFORE INSERT OR UPDATE OF "inspectionDocumentId", "pageNumber", "label"
ON "inspectionFeature"
FOR EACH ROW
EXECUTE FUNCTION enforce_unique_inspection_feature_label_per_page();

ALTER TABLE "inspectionDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inspectionFeature" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "balloon" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."inspectionDocument"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."inspectionDocument"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('quality_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."inspectionDocument"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('quality_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."inspectionDocument"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('quality_delete')
    )::text[]
  )
);

CREATE POLICY "SELECT" ON "public"."inspectionFeature"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."inspectionFeature"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('quality_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."inspectionFeature"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('quality_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."inspectionFeature"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('quality_delete'))::text[]
  )
);

CREATE POLICY "SELECT" ON "public"."balloon"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."balloon"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('quality_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."balloon"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('quality_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."balloon"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('quality_delete')
    )::text[]
  )
);

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
