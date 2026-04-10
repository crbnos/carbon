-- =============================================================================
-- Convert 8 make-method triggers across quoteLine, quoteMaterial, jobMaterial,
-- and jobMakeMethod to event system interceptors.
--
-- Tables already on event system: quoteLine, jobMaterial, jobMakeMethod
-- Tables NOT on event system: quoteMaterial (needs full attach)
-- =============================================================================


-- =============================================================================
-- QUOTE LINE interceptors
-- =============================================================================

-- 1. insert_quote_line_make_method -> sync_insert_quote_line_make_method (AFTER)
CREATE OR REPLACE FUNCTION sync_insert_quote_line_make_method(
  p_table TEXT, p_operation TEXT, p_new JSONB, p_old JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_version NUMERIC(10, 2);
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;
  IF (p_new->>'methodType') != 'Make to Order' THEN RETURN; END IF;
  IF (p_new->>'itemId') IS NULL THEN RETURN; END IF;

  SELECT "version" INTO v_version FROM "activeMakeMethods" WHERE "itemId" = p_new->>'itemId';

  INSERT INTO "quoteMakeMethod" (
    "quoteId", "quoteLineId", "itemId", "companyId", "createdAt", "createdBy", "version"
  ) VALUES (
    p_new->>'quoteId', p_new->>'id', p_new->>'itemId',
    p_new->>'companyId', NOW(), p_new->>'createdBy', v_version
  );
END;
$$;

-- 2. update_quote_line_make_method_item_id -> sync_update_quote_line_make_method_item_id (BEFORE)
CREATE OR REPLACE FUNCTION sync_update_quote_line_make_method_item_id(
  p_table TEXT, p_operation TEXT, p_new JSONB, p_old JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_version NUMERIC(10, 2);
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;

  -- Only fire when methodType/itemId change is relevant to Make to Order
  IF NOT (
    ((p_old->>'methodType') = 'Make to Order' AND (p_old->>'itemId') IS DISTINCT FROM (p_new->>'itemId'))
    OR ((p_new->>'methodType') = 'Make to Order' AND (p_old->>'methodType') != 'Make to Order')
  ) THEN
    RETURN;
  END IF;

  SELECT "version" INTO v_version FROM "activeMakeMethods" WHERE "itemId" = p_new->>'itemId';

  IF NOT EXISTS (
    SELECT 1 FROM "quoteMakeMethod"
    WHERE "quoteLineId" = p_new->>'id' AND "parentMaterialId" IS NULL
  ) THEN
    INSERT INTO "quoteMakeMethod" (
      "quoteId", "quoteLineId", "itemId", "companyId", "createdAt", "createdBy", "version"
    ) VALUES (
      p_new->>'quoteId', p_new->>'id', p_new->>'itemId',
      p_new->>'companyId', NOW(), p_new->>'createdBy', v_version
    );
  ELSE
    UPDATE "quoteMakeMethod"
    SET "itemId" = p_new->>'itemId',
        "version" = v_version
    WHERE "quoteLineId" = p_new->>'id' AND "parentMaterialId" IS NULL;
  END IF;
END;
$$;


-- =============================================================================
-- QUOTE MATERIAL interceptors
-- =============================================================================

-- 3. insert_quote_material_make_method -> sync_insert_quote_material_make_method (AFTER)
CREATE OR REPLACE FUNCTION sync_insert_quote_material_make_method(
  p_table TEXT, p_operation TEXT, p_new JSONB, p_old JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_version NUMERIC(10, 2);
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;
  IF (p_new->>'methodType') != 'Make to Order' THEN RETURN; END IF;
  IF (p_new->>'itemId') IS NULL THEN RETURN; END IF;

  SELECT "version" INTO v_version FROM "activeMakeMethods" WHERE "itemId" = p_new->>'itemId';

  INSERT INTO "quoteMakeMethod" (
    "quoteId", "quoteLineId", "parentMaterialId", "itemId", "companyId", "createdAt", "createdBy", "version"
  ) VALUES (
    p_new->>'quoteId', p_new->>'quoteLineId', p_new->>'id', p_new->>'itemId',
    p_new->>'companyId', NOW(), p_new->>'createdBy', v_version
  );
END;
$$;

-- 4. update_quote_material_make_method_item_id -> sync_update_quote_material_make_method_item_id (BEFORE)
CREATE OR REPLACE FUNCTION sync_update_quote_material_make_method_item_id(
  p_table TEXT, p_operation TEXT, p_new JSONB, p_old JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_version NUMERIC(10, 2);
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;

  IF NOT (
    ((p_old->>'methodType') = 'Make to Order' AND (p_old->>'itemId') IS DISTINCT FROM (p_new->>'itemId'))
    OR ((p_new->>'methodType') = 'Make to Order' AND (p_old->>'methodType') != 'Make to Order')
  ) THEN
    RETURN;
  END IF;

  SELECT "version" INTO v_version FROM "activeMakeMethods" WHERE "itemId" = p_new->>'itemId';

  IF NOT EXISTS (
    SELECT 1 FROM "quoteMakeMethod"
    WHERE "quoteLineId" = p_new->>'quoteLineId' AND "parentMaterialId" = p_new->>'id'
  ) THEN
    INSERT INTO "quoteMakeMethod" (
      "quoteId", "quoteLineId", "parentMaterialId", "itemId", "companyId", "createdAt", "createdBy", "version"
    ) VALUES (
      p_new->>'quoteId', p_new->>'quoteLineId', p_new->>'id', p_new->>'itemId',
      p_new->>'companyId', NOW(), p_new->>'createdBy', v_version
    );
  ELSE
    UPDATE "quoteMakeMethod"
    SET "itemId" = p_new->>'itemId',
        "version" = v_version
    WHERE "quoteLineId" = p_new->>'quoteLineId' AND "parentMaterialId" = p_new->>'id';
  END IF;
END;
$$;


-- =============================================================================
-- JOB MATERIAL interceptors
-- =============================================================================

-- 5. insert_job_material_make_method -> sync_insert_job_material_make_method (AFTER)
CREATE OR REPLACE FUNCTION sync_insert_job_material_make_method(
  p_table TEXT, p_operation TEXT, p_new JSONB, p_old JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_item_readable_id TEXT;
  v_item_tracking_type TEXT;
  v_job_make_method_id TEXT;
  v_version NUMERIC(10, 2);
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;
  IF (p_new->>'methodType') != 'Make to Order' THEN RETURN; END IF;
  IF (p_new->>'itemId') IS NULL THEN RETURN; END IF;

  SELECT "readableIdWithRevision", "itemTrackingType"
    INTO v_item_readable_id, v_item_tracking_type
  FROM "item"
  WHERE "id" = p_new->>'itemId';

  SELECT "version" INTO v_version FROM "activeMakeMethods" WHERE "itemId" = p_new->>'itemId';

  INSERT INTO "jobMakeMethod" (
    "jobId", "parentMaterialId", "itemId", "companyId", "createdBy",
    "requiresSerialTracking", "requiresBatchTracking", "version"
  ) VALUES (
    p_new->>'jobId', p_new->>'id', p_new->>'itemId', p_new->>'companyId', p_new->>'createdBy',
    v_item_tracking_type = 'Serial', v_item_tracking_type = 'Batch', v_version
  )
  RETURNING "id" INTO v_job_make_method_id;

  INSERT INTO "trackedEntity" (
    "sourceDocument", "sourceDocumentId", "sourceDocumentReadableId",
    "quantity", "status", "companyId", "createdBy", "attributes"
  ) VALUES (
    'Item', p_new->>'itemId', v_item_readable_id,
    (p_new->>'quantity')::numeric, 'Reserved',
    p_new->>'companyId', p_new->>'createdBy',
    jsonb_build_object('Job', p_new->>'jobId', 'Job Make Method', v_job_make_method_id, 'Job Material', p_new->>'id')
  );
END;
$$;

-- 6. update_job_material_make_method_item_id -> sync_update_job_material_make_method_item_id (BEFORE)
CREATE OR REPLACE FUNCTION sync_update_job_material_make_method_item_id(
  p_table TEXT, p_operation TEXT, p_new JSONB, p_old JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_item_readable_id TEXT;
  v_item_tracking_type TEXT;
  v_job_make_method_id TEXT;
  v_version NUMERIC(10, 2);
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;

  IF NOT (
    ((p_old->>'methodType') = 'Make to Order' AND (p_old->>'itemId') IS DISTINCT FROM (p_new->>'itemId'))
    OR ((p_new->>'methodType') = 'Make to Order' AND (p_old->>'methodType') != 'Make to Order')
  ) THEN
    RETURN;
  END IF;

  SELECT "readableIdWithRevision", "itemTrackingType"
    INTO v_item_readable_id, v_item_tracking_type
  FROM "item"
  WHERE "id" = p_new->>'itemId';

  SELECT "version" INTO v_version FROM "activeMakeMethods" WHERE "itemId" = p_new->>'itemId';

  IF NOT EXISTS (
    SELECT 1 FROM "jobMakeMethod"
    WHERE "jobId" = p_new->>'jobId' AND "parentMaterialId" = p_new->>'id'
  ) THEN
    INSERT INTO "jobMakeMethod" (
      "jobId", "parentMaterialId", "itemId", "companyId", "createdBy",
      "requiresSerialTracking", "requiresBatchTracking", "version"
    ) VALUES (
      p_new->>'jobId', p_new->>'id', p_new->>'itemId', p_new->>'companyId', p_new->>'createdBy',
      v_item_tracking_type = 'Serial', v_item_tracking_type = 'Batch', v_version
    )
    RETURNING "id" INTO v_job_make_method_id;

    INSERT INTO "trackedEntity" (
      "sourceDocument", "sourceDocumentId", "sourceDocumentReadableId",
      "quantity", "status", "companyId", "createdBy", "attributes"
    ) VALUES (
      'Item', p_new->>'itemId', v_item_readable_id,
      (p_new->>'quantity')::numeric, 'Reserved',
      p_new->>'companyId', p_new->>'createdBy',
      jsonb_build_object('Job', p_new->>'jobId', 'Job Make Method', v_job_make_method_id, 'Job Material', p_new->>'id')
    );
  ELSE
    UPDATE "jobMakeMethod"
    SET "itemId" = p_new->>'itemId',
        "requiresSerialTracking" = (v_item_tracking_type = 'Serial'),
        "requiresBatchTracking" = (v_item_tracking_type = 'Batch'),
        "version" = v_version
    WHERE "jobId" = p_new->>'jobId' AND "parentMaterialId" = p_new->>'id'
    RETURNING "id" INTO v_job_make_method_id;

    INSERT INTO "trackedEntity" (
      "sourceDocument", "sourceDocumentId", "sourceDocumentReadableId",
      "quantity", "status", "companyId", "createdBy", "attributes"
    ) VALUES (
      'Item', p_new->>'itemId', v_item_readable_id,
      (p_new->>'quantity')::numeric, 'Reserved',
      p_new->>'companyId', p_new->>'createdBy',
      jsonb_build_object('Job', p_new->>'jobId', 'Job Make Method', v_job_make_method_id, 'Job Material', p_new->>'id')
    );
  END IF;
END;
$$;


-- =============================================================================
-- JOB MAKE METHOD interceptors (tracked materials)
-- =============================================================================

-- 7. update_tracked_entity_on_job_make_method_update -> sync_update_tracked_entity_on_job_make_method (BEFORE)
-- NOTE: The original trigger was AFTER UPDATE OF "id" with WHEN (OLD."id" IS DISTINCT FROM NEW."id").
-- Since "id" is a primary key that never changes, this trigger was always dead code in the
-- original implementation. We preserve the function for completeness but it will never execute
-- its body (the PK guard ensures early return).
CREATE OR REPLACE FUNCTION sync_update_tracked_entity_on_job_make_method(
  p_table TEXT, p_operation TEXT, p_new JSONB, p_old JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;
  IF (p_old->>'id') IS NOT DISTINCT FROM (p_new->>'id') THEN RETURN; END IF;

  UPDATE "trackedEntity"
  SET "attributes" = jsonb_set(
    "attributes",
    '{Job Make Method}',
    to_jsonb(p_new->>'id')
  )
  WHERE "attributes"->>'Job Make Method' = p_old->>'id';
END;
$$;

-- 8. delete_tracked_entity_on_job_make_method_delete -> sync_delete_tracked_entity_on_job_make_method (BEFORE)
CREATE OR REPLACE FUNCTION sync_delete_tracked_entity_on_job_make_method(
  p_table TEXT, p_operation TEXT, p_new JSONB, p_old JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_operation != 'DELETE' THEN RETURN; END IF;

  DELETE FROM "trackedEntity"
  WHERE "attributes"->>'Job Make Method' = p_old->>'id';
END;
$$;


-- =============================================================================
-- Drop legacy triggers
-- =============================================================================

-- quoteLine triggers
DROP TRIGGER IF EXISTS insert_quote_line_make_method_trigger ON "quoteLine";
DROP TRIGGER IF EXISTS update_quote_line_make_method_item_id_trigger ON "quoteLine";

-- quoteMaterial triggers
DROP TRIGGER IF EXISTS insert_quote_material_make_method_trigger ON "quoteMaterial";
DROP TRIGGER IF EXISTS update_quote_material_make_method_item_id_trigger ON "quoteMaterial";

-- jobMaterial triggers
DROP TRIGGER IF EXISTS insert_job_material_make_method_trigger ON "jobMaterial";
DROP TRIGGER IF EXISTS update_job_material_make_method_item_id_trigger ON "jobMaterial";

-- jobMakeMethod triggers
DROP TRIGGER IF EXISTS update_tracked_entity_on_job_make_method_update_trigger ON "jobMakeMethod";
DROP TRIGGER IF EXISTS delete_tracked_entity_on_job_make_method_delete_trigger ON "jobMakeMethod";


-- =============================================================================
-- Attach event triggers with interceptor arrays
-- =============================================================================

-- quoteLine: already on event system, add BEFORE + AFTER interceptors
SELECT attach_event_trigger('quoteLine',
  ARRAY['sync_update_quote_line_make_method_item_id']::TEXT[],
  ARRAY['sync_insert_quote_line_make_method']::TEXT[]
);

-- quoteMaterial: NOT on event system, full attach with BEFORE + AFTER interceptors
SELECT attach_event_trigger('quoteMaterial',
  ARRAY['sync_update_quote_material_make_method_item_id']::TEXT[],
  ARRAY['sync_insert_quote_material_make_method']::TEXT[]
);

-- jobMaterial: already on event system, add BEFORE + AFTER interceptors
SELECT attach_event_trigger('jobMaterial',
  ARRAY['sync_update_job_material_make_method_item_id']::TEXT[],
  ARRAY['sync_insert_job_material_make_method']::TEXT[]
);

-- jobMakeMethod: already on event system, add BEFORE interceptors
SELECT attach_event_trigger('jobMakeMethod',
  ARRAY['sync_update_tracked_entity_on_job_make_method', 'sync_delete_tracked_entity_on_job_make_method']::TEXT[],
  ARRAY[]::TEXT[]
);
