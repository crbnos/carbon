-- ============================================================================
-- Migration: rename `itemShelfLife.inheritEarliestInputExpiry` to
--            `itemShelfLife.calculateFromBom`
--
-- The flag was originally introduced in
-- 20260427010000_inventory-shelf-life-settings-and-inherit-input-expiry.sql.
-- The user-facing copy in inventory company settings already calls the
-- BOM-driven option "Calculate from BOM"; the per-item override should
-- match that nomenclature instead of the verbose "inherit earliest input
-- expiry". Behavior is unchanged — this is a pure rename plus a refresh
-- of the stamp helper to read the new column.
-- ============================================================================

ALTER TABLE "itemShelfLife"
  RENAME COLUMN "inheritEarliestInputExpiry" TO "calculateFromBom";

ALTER TABLE "itemShelfLife"
  DROP CONSTRAINT "itemShelfLife_inheritEarliestInputExpiry_only_fixed_duration";

ALTER TABLE "itemShelfLife"
  ADD CONSTRAINT "itemShelfLife_calculateFromBom_only_fixed_duration"
    CHECK (
      "mode" = 'Fixed Duration'
      OR "calculateFromBom" = false
    );


-- Re-define the stamp helper to read the renamed column. Body is
-- otherwise identical to the version installed by the original migration.
CREATE OR REPLACE FUNCTION set_shelf_life_for_operation(
  p_job_operation_id TEXT,
  p_event            "shelfLifeTriggerTiming"
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_job_id                       TEXT;
  v_job_make_method_id           TEXT;
  v_operation_process_id         TEXT;
  v_item_id                      TEXT;
  v_company_id                   TEXT;
  v_shelf_life_mode              "shelfLifeMode";
  v_shelf_life_days              NUMERIC;
  v_shelf_life_trigger_process   TEXT;
  v_shelf_life_trigger_timing    "shelfLifeTriggerTiming";
  v_calc_from_bom                BOOLEAN;
  v_input_scope                  TEXT;
  v_computed_expiry              DATE;
  v_input_min                    DATE;
BEGIN
  SELECT
    jo."jobId",
    jo."jobMakeMethodId",
    jo."processId",
    jmm."itemId",
    i."companyId"
  INTO
    v_job_id,
    v_job_make_method_id,
    v_operation_process_id,
    v_item_id,
    v_company_id
  FROM "jobOperation" jo
  JOIN "jobMakeMethod" jmm ON jmm."id" = jo."jobMakeMethodId"
  JOIN "item"          i  ON i."id"  = jmm."itemId"
  WHERE jo."id" = p_job_operation_id;

  IF v_item_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    "mode", "days", "triggerProcessId", "triggerTiming",
    "calculateFromBom"
  INTO
    v_shelf_life_mode, v_shelf_life_days, v_shelf_life_trigger_process,
    v_shelf_life_trigger_timing, v_calc_from_bom
  FROM "itemShelfLife"
  WHERE "itemId" = v_item_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_shelf_life_mode = 'Fixed Duration' THEN
    IF v_shelf_life_days IS NULL THEN
      RETURN;
    END IF;

    IF v_shelf_life_trigger_process IS NULL THEN
      IF p_event <> 'After' THEN
        RETURN;
      END IF;
    ELSE
      IF v_operation_process_id IS DISTINCT FROM v_shelf_life_trigger_process THEN
        RETURN;
      END IF;
      IF p_event <> v_shelf_life_trigger_timing THEN
        RETURN;
      END IF;
    END IF;

    v_computed_expiry := (CURRENT_DATE + (v_shelf_life_days || ' days')::INTERVAL)::DATE;

    -- Cap by earliest input expiry when the flag is on.
    IF v_calc_from_bom THEN
      SELECT COALESCE(
        "inventoryShelfLife"->>'calculatedInputScope',
        'AllInputs'
      )
      INTO v_input_scope
      FROM "companySettings"
      WHERE "id" = v_company_id;

      IF v_input_scope IS NULL THEN
        v_input_scope := 'AllInputs';
      END IF;

      IF v_input_scope = 'AllInputs' THEN
        SELECT MIN(te."expirationDate")
        INTO v_input_min
        FROM "trackedActivityInput" tai
        JOIN "trackedActivity" ta ON ta."id" = tai."trackedActivityId"
        JOIN "trackedEntity"   te ON te."id" = tai."trackedEntityId"
        WHERE ta.attributes->>'Job Make Method' = v_job_make_method_id
          AND te."expirationDate" IS NOT NULL;
      ELSE
        SELECT MIN(te."expirationDate")
        INTO v_input_min
        FROM "trackedActivityInput" tai
        JOIN "trackedActivity" ta  ON ta."id"      = tai."trackedActivityId"
        JOIN "trackedEntity"   te  ON te."id"      = tai."trackedEntityId"
        JOIN "itemShelfLife"   isl ON isl."itemId" = te."sourceDocumentId"
        WHERE ta.attributes->>'Job Make Method' = v_job_make_method_id
          AND isl."mode" IN ('Fixed Duration', 'Calculated')
          AND te."expirationDate" IS NOT NULL;
      END IF;

      IF v_input_min IS NOT NULL AND v_input_min < v_computed_expiry THEN
        v_computed_expiry := v_input_min;
      END IF;
    END IF;

  ELSIF v_shelf_life_mode = 'Calculated' THEN
    IF p_event <> 'After' THEN
      RETURN;
    END IF;

    SELECT COALESCE(
      "inventoryShelfLife"->>'calculatedInputScope',
      'AllInputs'
    )
    INTO v_input_scope
    FROM "companySettings"
    WHERE "id" = v_company_id;

    IF v_input_scope IS NULL THEN
      v_input_scope := 'AllInputs';
    END IF;

    IF v_input_scope = 'AllInputs' THEN
      SELECT MIN(te."expirationDate")
      INTO v_computed_expiry
      FROM "trackedActivityInput" tai
      JOIN "trackedActivity" ta ON ta."id" = tai."trackedActivityId"
      JOIN "trackedEntity"   te ON te."id" = tai."trackedEntityId"
      WHERE ta.attributes->>'Job Make Method' = v_job_make_method_id
        AND te."expirationDate" IS NOT NULL;
    ELSE
      SELECT MIN(te."expirationDate")
      INTO v_computed_expiry
      FROM "trackedActivityInput" tai
      JOIN "trackedActivity" ta  ON ta."id"      = tai."trackedActivityId"
      JOIN "trackedEntity"   te  ON te."id"      = tai."trackedEntityId"
      JOIN "itemShelfLife"   isl ON isl."itemId" = te."sourceDocumentId"
      WHERE ta.attributes->>'Job Make Method' = v_job_make_method_id
        AND isl."mode" IN ('Fixed Duration', 'Calculated')
        AND te."expirationDate" IS NOT NULL;
    END IF;

    IF v_computed_expiry IS NULL THEN
      RETURN;
    END IF;

  ELSIF v_shelf_life_mode = 'Set on Receipt' THEN
    RETURN;

  ELSE
    RETURN;
  END IF;

  UPDATE "trackedEntity"
  SET "expirationDate" = v_computed_expiry
  WHERE "sourceDocument" = 'Item'
    AND "sourceDocumentId" = v_item_id
    AND "attributes"->>'Job Make Method' = v_job_make_method_id
    AND "expirationDate" IS NULL;
END;
$$;
