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
  v_inconsistent_units BOOLEAN;
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
    -- The status read above takes no lock, so a Close or Cancel can commit
    -- after it. Read the status again under the job lock the receipt takes
    -- anyway. util.receive_job_output refuses a Closed or Cancelled job, and a
    -- refusal here would roll back the Done update itself, so skip instead.
    SELECT "locationId", "storageUnitId", quantity, "salesOrderId", "quantityReceivedToInventory", status
    INTO v_job_location_id, v_job_storage_unit_id, v_job_quantity, v_sales_order_id, v_quantity_received, v_job_status
    FROM "job"
    WHERE id = p_new->>'jobId'
    FOR UPDATE;

    IF v_job_status IN ('Closed', 'Cancelled') THEN
      RETURN;
    END IF;

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
    -- Replace the all-quantity fallback with named units plus the anonymous
    -- remainder. A single ambiguous historical output cannot erase its peers.
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
             bool_and(te.quantity = 1 AND (te.attributes->>'Job Make Method') IS NOT DISTINCT FROM op."jobMakeMethodId") AS valid
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
        AND te.quantity = 1 AND te.attributes ? ('Operation ' || op.id)
      WHERE op."requiresSerialTracking"
      UNION
      SELECT operation_id, "reworkId", unit_id FROM activity_units WHERE valid
    ), counts AS MATERIALIZED (
      SELECT op.*, (SELECT count(*) FROM worked w WHERE w.operation_id = op.id) AS named
      FROM terminal op
    ), normal_units AS MATERIALIZED (
      -- A fully identified parallel operation rules out every other serial.
      -- A quantity-only or partly named operation can cover a peer's named
      -- serial with one of its anonymous completions.
      SELECT w.unit_id
      FROM worked w JOIN counts op ON op.id = w.operation_id
      WHERE op."reworkId" IS NULL
      GROUP BY w.unit_id
      HAVING count(*) FILTER (WHERE op.named = op.quantity) = (
        SELECT count(*) FROM counts
        WHERE "reworkId" IS NULL AND quantity > 0 AND named = quantity
      )
    ), credited AS (
      SELECT unit_id FROM normal_units
      UNION ALL
      SELECT unit_id FROM worked WHERE "reworkId" IS NOT NULL
    ), totals AS (
      SELECT COALESCE(MIN(quantity) FILTER (WHERE "reworkId" IS NULL AND quantity > 0), 0) AS normal,
             COALESCE(SUM(quantity) FILTER (WHERE "reworkId" IS NOT NULL), 0) AS reworked
      FROM counts
    )
    SELECT normal + reworked, (SELECT array_agg(unit_id ORDER BY unit_id) FROM credited),
      (SELECT count(*) FROM normal_units) > normal
      OR EXISTS (SELECT 1 FROM credited GROUP BY unit_id HAVING count(*) > 1)
      -- With no fully named operation, a serial named only on a longer
      -- parallel branch might be one of its excess completions.
      OR (NOT EXISTS (
        SELECT 1 FROM counts WHERE "reworkId" IS NULL AND quantity > 0 AND named = quantity
      ) AND EXISTS (
        SELECT 1 FROM normal_units n WHERE NOT EXISTS (
          SELECT 1 FROM worked w JOIN counts op ON op.id = w.operation_id
          WHERE w.unit_id = n.unit_id AND op."reworkId" IS NULL AND op.quantity = normal
        )
      ))
      OR EXISTS (
        SELECT 1 FROM counts op WHERE op.named > op.quantity OR (
          op."requiresSerialTracking" AND op."reworkId" IS NULL AND op.quantity > 0
          AND normal > op.quantity - op.named + (
            SELECT count(*) FROM worked w JOIN normal_units n USING (unit_id)
            WHERE w.operation_id = op.id
          )
        )
      )
    INTO v_quantity_complete, v_worked_unit_ids, v_inconsistent_units
    FROM totals;

    IF v_inconsistent_units THEN
      RAISE EXCEPTION 'The final operations do not identify the serials for every completed unit';
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
