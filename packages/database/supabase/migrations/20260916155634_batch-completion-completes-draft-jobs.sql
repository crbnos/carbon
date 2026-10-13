-- Batch completion completes Draft member jobs.
--
-- A released batch puts Draft/Planned jobs' operations on the shop floor
-- (batch release outranks job release), but sync_finish_job_operation only
-- auto-completed and received jobs in Ready/In Progress/Paused. A completed
-- batch of Draft jobs therefore left every member job in Draft, its receipts
-- unposted, and a merged output lot holding only the one received job's
-- stock instead of the combined quantity.
--
-- sync_finish_job_operation is redefined verbatim from
-- 20260914095239_complete-job-received-quantity.sql with one widened gate:
-- Draft/Planned jobs proceed when the completed operation belongs to a
-- batch. Nothing changes for single (non-batched) operations -- a Draft
-- job's operation cannot flip Done outside a batch on the floor.

CREATE OR REPLACE FUNCTION sync_finish_job_operation(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_location_id TEXT;
  v_job_storage_unit_id TEXT;
  v_job_quantity NUMERIC;
  v_sales_order_id TEXT;
  v_quantity_complete NUMERIC;
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

    v_quantity_complete := (
      SELECT COALESCE(SUM(terminal_jo."quantityComplete"), 0)
      FROM "jobOperation" terminal_jo
      INNER JOIN "jobMakeMethod" terminal_jmm ON terminal_jmm.id = terminal_jo."jobMakeMethodId"
      WHERE terminal_jo."jobId" = p_new->>'jobId'
        AND terminal_jmm."parentMaterialId" IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "jobOperationDependency" dep
          INNER JOIN "jobOperation" child_jo ON child_jo.id = dep."operationId"
          INNER JOIN "jobMakeMethod" child_jmm ON child_jmm.id = child_jo."jobMakeMethodId"
          WHERE dep."dependsOnId" = terminal_jo.id
            AND child_jmm."parentMaterialId" IS NULL
        )
    );

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

    PERFORM complete_job_to_inventory(
      p_job_id := p_new->>'jobId',
      p_quantity_complete := v_quantity_complete,
      p_storage_unit_id := v_job_storage_unit_id,
      p_location_id := v_job_location_id,
      p_company_id := p_new->>'companyId',
      p_user_id := COALESCE(p_new->>'updatedBy', p_new->>'createdBy')
    );
  END IF;
END;
$$;