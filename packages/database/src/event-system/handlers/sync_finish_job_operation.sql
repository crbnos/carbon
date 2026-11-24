CREATE OR REPLACE FUNCTION public.sync_finish_job_operation(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job_location_id TEXT;
  v_job_storage_unit_id TEXT;
  v_job_quantity NUMERIC;
  v_sales_order_id TEXT;
  v_quantity_complete NUMERIC;
  v_worked_unit_ids TEXT[];
  v_missing_worked_units BOOLEAN;
  v_quantity_lost NUMERIC;
  v_quantity_received NUMERIC;
  v_job_status TEXT;
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;
  IF (p_new->>'status') != 'Done' OR (p_old->>'status') = 'Done' THEN RETURN; END IF;

  UPDATE "productionEvent"
  SET "endTime" = NOW()
  WHERE "jobOperationId" = p_new->>'id'
    AND "endTime" IS NULL;

  UPDATE "jobOperation" op
  SET status = 'Ready'
  WHERE EXISTS (
    SELECT 1
    FROM "jobOperationDependency" dep
    WHERE dep."operationId" = op.id
      AND dep."dependsOnId" = p_new->>'id'
      AND op.status = 'Waiting'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "jobOperationDependency" dep2
    JOIN "jobOperation" jo2 ON jo2.id = dep2."dependsOnId"
    WHERE dep2."operationId" = op.id
      AND jo2.status != 'Done'
      AND jo2.id != p_new->>'id'
  );

  SELECT status INTO v_job_status FROM "job" WHERE id = p_new->>'jobId';
  -- A Draft/Planned job's operation can only reach Done through a released
  -- BATCH (batch release outranks job release for floor visibility), so the
  -- run genuinely happened. Completing the batch must complete those jobs
  -- too: otherwise their output lots exist while their receipts never post,
  -- and a merged output lot carries only the received fraction of its
  -- quantity.
  IF v_job_status NOT IN ('Ready', 'In Progress', 'Paused')
     AND NOT (
       (p_new->>'jobOperationBatchId') IS NOT NULL
       AND v_job_status IN ('Draft', 'Planned')
     ) THEN
    RETURN;
  END IF;

  IF is_last_job_operation(p_new->>'id') THEN
    SELECT "locationId", "storageUnitId", quantity, "salesOrderId", "quantityReceivedToInventory"
    INTO v_job_location_id, v_job_storage_unit_id, v_job_quantity, v_sales_order_id, v_quantity_received
    FROM "job"
    WHERE id = p_new->>'jobId';

    -- The units out of the routing's final operations. Two kinds of final
    -- operation report differently:
    --   * the routing's own (parallel "With Previous" operations at the end)
    --     each see EVERY unit, so a unit is finished once it has come through
    --     all of them: the smallest count. Summing them completed a 3-unit job
    --     at 6, which a serial job then refused for want of units. One closed
    --     with Finish and no quantity reports nothing, so it is left out.
    --   * a rework branch triggered at the final operation (trigger-rework)
    --     carries only the reworked units, which the operation it came from
    --     reports as reworked, not complete: those add on top.
    -- This runs BEFORE the update is written, so the table still holds the
    -- finishing operation's old row: its quantity comes from p_new. An outside
    -- processing receipt sets Done and quantityComplete in one update.
    -- Replace the count-only MIN/SUM query with the same quantities plus the
    -- worked serial IDs. Quantity-only finishes still use the original receipt selection.
    WITH terminal AS MATERIALIZED (
      SELECT jo.id, jo."jobMakeMethodId", jo."reworkId", jmm."requiresSerialTracking",
             CASE WHEN jo.id = p_new->>'id' THEN COALESCE((p_new->>'quantityComplete')::NUMERIC, 0)
                  ELSE jo."quantityComplete" END AS quantity
      FROM "jobOperation" jo
      JOIN "jobMakeMethod" jmm ON jmm.id = jo."jobMakeMethodId"
      WHERE jo."jobId" = p_new->>'jobId' AND jo."companyId" = p_new->>'companyId'
        AND jmm."parentMaterialId" IS NULL AND jo.status <> 'Canceled'
        AND NOT EXISTS (
          SELECT 1
          FROM "jobOperationDependency" dep
          JOIN "jobOperation" child ON child.id = dep."operationId"
          JOIN "jobMakeMethod" method ON method.id = child."jobMakeMethodId"
          WHERE dep."dependsOnId" = jo.id AND method."parentMaterialId" IS NULL
        )
    ), activity_units AS MATERIALIZED (
      -- Older serial completions through batch posting have only Produce
      -- genealogy. Each serial must represent exactly one unit of this operation.
      SELECT op.id AS operation_id, op."reworkId", output."trackedEntityId" AS unit_id,
             count(*) = 1 AND sum(output.quantity) = 1 AND
             bool_and((te.attributes->>'Job Make Method') IS NOT DISTINCT FROM op."jobMakeMethodId") AS valid
      FROM terminal op
      JOIN "trackedActivity" a ON a."sourceDocument" = 'Job Operation' AND a."sourceDocumentId" = op.id
        AND a.type IN ('Complete', 'Produce') AND a."companyId" = p_new->>'companyId'
      JOIN "trackedActivityOutput" output ON output."trackedActivityId" = a.id AND output."companyId" = a."companyId"
      LEFT JOIN "trackedEntity" te ON te.id = output."trackedEntityId" AND te."companyId" = a."companyId"
      WHERE op."requiresSerialTracking"
      GROUP BY op.id, op."reworkId", output."trackedEntityId"
    ), worked AS MATERIALIZED (
      SELECT op.id AS operation_id, op."reworkId", te.id AS unit_id
      FROM terminal op
      JOIN "trackedEntity" te ON te."companyId" = p_new->>'companyId'
        AND te.attributes->>'Job Make Method' = op."jobMakeMethodId"
        AND te.attributes ? ('Operation ' || op.id)
      WHERE op."requiresSerialTracking"
      UNION
      SELECT operation_id, "reworkId", unit_id FROM activity_units
    ), credited AS (
      -- Each normal terminal operation must have completed the same unit.
      SELECT unit_id FROM worked WHERE "reworkId" IS NULL
      GROUP BY unit_id
      HAVING count(*) = (SELECT count(*) FROM terminal WHERE "reworkId" IS NULL AND quantity > 0)
      UNION
      SELECT unit_id FROM worked WHERE "reworkId" IS NOT NULL
    )
    SELECT COALESCE(MIN(quantity) FILTER (WHERE "reworkId" IS NULL AND quantity > 0), 0)
         + COALESCE(SUM(quantity) FILTER (WHERE "reworkId" IS NOT NULL), 0),
      CASE WHEN EXISTS (SELECT 1 FROM worked) THEN ARRAY(SELECT unit_id FROM credited ORDER BY unit_id) END,
      EXISTS (SELECT 1 FROM activity_units WHERE valid IS NOT TRUE) OR
      EXISTS (SELECT 1 FROM terminal op WHERE op."requiresSerialTracking"
        AND COALESCE(op.quantity, 0) <> (SELECT count(*) FROM worked w WHERE w.operation_id = op.id))
    INTO v_quantity_complete, v_worked_unit_ids, v_missing_worked_units
    FROM terminal;

    -- When a final operation does not name a serial for every unit it
    -- completed (some recorded by quantity alone, in the ERP or by an edited
    -- production row), receive by quantity as before: the receipt still keeps
    -- held units out. Refusing here would block the Done update itself.
    -- Serials that disagree across parallel final operations are a data
    -- error the operator must correct, so that still refuses.
    IF v_worked_unit_ids IS NOT NULL AND (
      v_missing_worked_units OR cardinality(v_worked_unit_ids) <> v_quantity_complete
    ) THEN
      IF v_missing_worked_units THEN
        v_worked_unit_ids := NULL;
      ELSE
        RAISE EXCEPTION 'The final operations do not identify the serials for every completed unit';
      END IF;
    END IF;

    IF COALESCE(v_quantity_complete, 0) = 0 THEN
      -- The zero fallback exists for the quantity-less Finish flow (no
      -- productionQuantity ever recorded). When the job DID record scrap or
      -- rework, zero completions is a real outcome (e.g. a fully-scrapped
      -- lot) — falling back would receive scrapped units into stock.
      SELECT COALESCE(SUM(COALESCE("quantityScrapped", 0) + COALESCE("quantityReworked", 0)), 0)
      INTO v_quantity_lost
      FROM "jobOperation"
      WHERE "jobId" = p_new->>'jobId';

      IF v_quantity_lost = 0 THEN
        v_quantity_complete := v_job_quantity;
      ELSE
        -- Nothing to receive: close the job without posting Assembly Output.
        -- Materials were already consumed by the scrap/complete flows; WIP
        -- cost disposition for fully-scrapped jobs is a costing follow-up.
        UPDATE "job"
        SET status = 'Completed',
            "completedDate" = NOW(),
            "quantityComplete" = 0,
            "updatedBy" = COALESCE(p_new->>'updatedBy', p_new->>'createdBy'),
            "updatedAt" = NOW()
        WHERE id = p_new->>'jobId';
        RETURN;
      END IF;
    END IF;

    -- A reopened job may already have received more than its operations now
    -- report. complete_job_to_inventory refuses a quantity below what was
    -- received, and refusing here would block the Done update itself.
    v_quantity_complete := GREATEST(v_quantity_complete, COALESCE(v_quantity_received, 0));

    PERFORM util.receive_job_output(
      p_job_id := p_new->>'jobId',
      p_quantity_complete := v_quantity_complete,
      p_storage_unit_id := v_job_storage_unit_id,
      p_location_id := v_job_location_id,
      p_company_id := p_new->>'companyId',
      p_user_id := COALESCE(p_new->>'updatedBy', p_new->>'createdBy'),
      p_worked_unit_ids := v_worked_unit_ids
    );
  END IF;
END;
$function$;
