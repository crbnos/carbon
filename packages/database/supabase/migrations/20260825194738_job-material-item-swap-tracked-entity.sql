-- Repoint the existing tracked entity when a Make to Order job material is
-- swapped to a different item, instead of inserting a second one.
--
-- `sync_update_job_material_make_method_item_id` has two branches. The first
-- (no jobMakeMethod yet) creates the make method AND its 'Reserved'
-- trackedEntity — correct. The second (make method already exists) updated the
-- make method and then inserted ANOTHER trackedEntity, unguarded, even though
-- the row created at insert time is still there.
--
-- Every made-component supersession swap therefore left two 'Reserved' entities
-- for one job material, and they were not duplicates of each other: the first
-- kept the PREDECESSOR's itemId and readable id and was never repointed. Both
-- carry the same 'Job Material' / 'Job Make Method' attributes, so every
-- consumer that keys off those sees both — MES walks the operator through a
-- phantom unit, an extra label prints bearing the retired part number, and
-- `existingEntityCount` in the issue function is inflated, which suppresses
-- legitimate scrap-replacement units.
--
-- Inventory and GL are unaffected: on-hand comes from `itemLedger`, and a
-- 'Reserved' entity with no ledger row contributes zero.
--
-- The fix updates in place, so the stale predecessor row is corrected rather
-- than merely being left un-duplicated. The insert is kept as a fallback for
-- when no reserved entity exists (the row was consumed, or history predates
-- the insert-time interceptor) so the branch can never leave the material with
-- no entity at all.
--
-- Scope note: this branch is not supersession-specific. It runs whenever a
-- Make to Order material's item changes on a job that already has a make
-- method — editing a made material's item by hand hits the same path, and had
-- the same duplicate.

CREATE OR REPLACE FUNCTION sync_update_job_material_make_method_item_id(
  p_table TEXT, p_operation TEXT, p_new JSONB, p_old JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_item_readable_id TEXT;
  v_item_tracking_type TEXT;
  v_job_make_method_id TEXT;
  -- Bare NUMERIC: the repo bans a precision spec on NUMERIC, and the
  -- conformance gate scans migration TEXT — so carrying the original
  -- declaration's precision forward registered as a new violation (as does
  -- quoting it in a comment). Behaviour is identical: makeMethod.version is
  -- itself a constrained numeric, so the value round-trips through this local
  -- unchanged and lands back in the same column.
  v_version NUMERIC;
  v_attributes JSONB;
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;

  IF NOT (
    ((p_old->>'methodType') = 'Make to Order' AND (p_old->>'itemId') IS DISTINCT FROM (p_new->>'itemId'))
    OR ((p_new->>'methodType') = 'Make to Order' AND (p_old->>'methodType') != 'Make to Order')
  ) THEN
    RETURN;
  END IF;

  -- Both lookups are company-scoped: "item" is keyed ("id", "companyId") and
  -- "activeMakeMethods" is per company, so matching on the item id alone could
  -- read another tenant's row. Pre-existing in the definition this replaces.
  SELECT "readableIdWithRevision", "itemTrackingType"
    INTO v_item_readable_id, v_item_tracking_type
  FROM "item"
  WHERE "id" = p_new->>'itemId'
    AND "companyId" = p_new->>'companyId';

  SELECT "version" INTO v_version FROM "activeMakeMethods"
  WHERE "itemId" = p_new->>'itemId'
    AND "companyId" = p_new->>'companyId';

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
      "quantity", "status", "companyId", "createdBy", "attributes", "itemId"
    ) VALUES (
      'Item', p_new->>'itemId', v_item_readable_id,
      (p_new->>'quantity')::numeric, 'Reserved',
      p_new->>'companyId', p_new->>'createdBy',
      jsonb_build_object('Job', p_new->>'jobId', 'Job Make Method', v_job_make_method_id, 'Job Material', p_new->>'id'),
      p_new->>'itemId'
    );
  ELSE
    UPDATE "jobMakeMethod"
    SET "itemId" = p_new->>'itemId',
        "requiresSerialTracking" = (v_item_tracking_type = 'Serial'),
        "requiresBatchTracking" = (v_item_tracking_type = 'Batch'),
        "version" = v_version
    WHERE "jobId" = p_new->>'jobId' AND "parentMaterialId" = p_new->>'id'
    RETURNING "id" INTO v_job_make_method_id;

    v_attributes := jsonb_build_object(
      'Job', p_new->>'jobId',
      'Job Make Method', v_job_make_method_id,
      'Job Material', p_new->>'id'
    );

    -- Repoint what is already there. Restricted to 'Reserved': an entity that
    -- has been consumed or received is history, and rewriting its item would
    -- falsify what was actually built.
    UPDATE "trackedEntity"
    SET "sourceDocumentId" = p_new->>'itemId',
        "sourceDocumentReadableId" = v_item_readable_id,
        "itemId" = p_new->>'itemId',
        "quantity" = (p_new->>'quantity')::numeric,
        -- Merge, don't replace: the shelf-life stamp writes expirationDate into
        -- this same attributes object, and an assignment would silently drop it.
        "attributes" = "attributes" || v_attributes
    WHERE "companyId" = p_new->>'companyId'
      AND "status" = 'Reserved'
      AND "attributes"->>'Job Material' = p_new->>'id';

    -- Only when there was nothing to repoint.
    IF NOT FOUND THEN
      INSERT INTO "trackedEntity" (
        "sourceDocument", "sourceDocumentId", "sourceDocumentReadableId",
        "quantity", "status", "companyId", "createdBy", "attributes", "itemId"
      ) VALUES (
        'Item', p_new->>'itemId', v_item_readable_id,
        (p_new->>'quantity')::numeric, 'Reserved',
        p_new->>'companyId', p_new->>'createdBy',
        v_attributes,
        p_new->>'itemId'
      );
    END IF;
  END IF;
END;
$$;
