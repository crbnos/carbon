CREATE OR REPLACE FUNCTION public.sync_update_job_operation_quantities(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job_operation_id TEXT;
  v_job_id TEXT;
  v_user_id TEXT;
BEGIN
  v_user_id := COALESCE(
    p_new->>'updatedBy', p_new->>'createdBy',
    p_old->>'updatedBy', p_old->>'createdBy'
  );

  v_job_operation_id := CASE WHEN p_operation = 'DELETE' THEN p_old->>'jobOperationId'
                             ELSE p_new->>'jobOperationId' END;

  -- A terminal quantity updates both job and operation and can receive the
  -- job. Take the receipt's own lock (FOR UPDATE) first, even for a direct
  -- insert (e.g. inspection scrap), so the receipt never upgrades a weaker
  -- job lock; other operations update only their own counts.
  SELECT j.id INTO v_job_id
  FROM "jobOperation" jo
  JOIN "jobMakeMethod" method ON method.id = jo."jobMakeMethodId" AND method."companyId" = jo."companyId"
  JOIN "job" j ON j.id = jo."jobId" AND j."companyId" = jo."companyId"
  WHERE jo.id = v_job_operation_id AND method."parentMaterialId" IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "jobOperationDependency" dep
      JOIN "jobOperation" child ON child.id = dep."operationId"
      JOIN "jobMakeMethod" child_method ON child_method.id = child."jobMakeMethodId"
      WHERE dep."dependsOnId" = jo.id AND child_method."parentMaterialId" IS NULL
    )
  FOR UPDATE OF j;

  IF p_operation = 'INSERT' THEN
    UPDATE "jobOperation"
    SET
      "quantityComplete" = "quantityComplete" +
        CASE WHEN (p_new->>'type') = 'Production' THEN (p_new->>'quantity')::numeric ELSE 0 END,
      "quantityReworked" = "quantityReworked" +
        CASE WHEN (p_new->>'type') = 'Rework' THEN (p_new->>'quantity')::numeric ELSE 0 END,
      "quantityScrapped" = "quantityScrapped" +
        CASE WHEN (p_new->>'type') = 'Scrap' THEN (p_new->>'quantity')::numeric ELSE 0 END
    WHERE id = v_job_operation_id;

  ELSIF p_operation = 'UPDATE' THEN
    UPDATE "jobOperation"
    SET
      "quantityComplete" = "quantityComplete"
        - CASE WHEN (p_old->>'type') = 'Production' THEN (p_old->>'quantity')::numeric ELSE 0 END
        + CASE WHEN (p_new->>'type') = 'Production' THEN (p_new->>'quantity')::numeric ELSE 0 END,
      "quantityReworked" = "quantityReworked"
        - CASE WHEN (p_old->>'type') = 'Rework' THEN (p_old->>'quantity')::numeric ELSE 0 END
        + CASE WHEN (p_new->>'type') = 'Rework' THEN (p_new->>'quantity')::numeric ELSE 0 END,
      "quantityScrapped" = "quantityScrapped"
        - CASE WHEN (p_old->>'type') = 'Scrap' THEN (p_old->>'quantity')::numeric ELSE 0 END
        + CASE WHEN (p_new->>'type') = 'Scrap' THEN (p_new->>'quantity')::numeric ELSE 0 END
    WHERE id = v_job_operation_id;

  ELSIF p_operation = 'DELETE' THEN
    UPDATE "jobOperation"
    SET
      "quantityComplete" = "quantityComplete" -
        CASE WHEN (p_old->>'type') = 'Production' THEN (p_old->>'quantity')::numeric ELSE 0 END,
      "quantityReworked" = "quantityReworked" -
        CASE WHEN (p_old->>'type') = 'Rework' THEN (p_old->>'quantity')::numeric ELSE 0 END,
      "quantityScrapped" = "quantityScrapped" -
        CASE WHEN (p_old->>'type') = 'Scrap' THEN (p_old->>'quantity')::numeric ELSE 0 END
    WHERE id = v_job_operation_id;
  END IF;

  UPDATE "jobOperation"
  SET "status" = 'Done',
      "updatedBy" = COALESCE(v_user_id, "updatedBy", "createdBy"),
      "updatedAt" = NOW()
  WHERE id = v_job_operation_id
    AND "status" NOT IN ('Done', 'Canceled')
    AND "targetQuantity" > 0
    AND ("quantityComplete" + "quantityReworked") >= "targetQuantity";

  IF v_job_id IS NOT NULL THEN
    UPDATE "job"
    -- Counted as sync_finish_job_operation counts the receipt: the smallest of
    -- the routing's own final operations (parallel ones each see every unit)
    -- plus what rework branches completed.
    SET "quantityComplete" = (
      SELECT COALESCE(MIN(terminal_jo."quantityComplete") FILTER (
               WHERE terminal_jo."reworkId" IS NULL AND terminal_jo."quantityComplete" > 0
             ), 0)
           + COALESCE(SUM(terminal_jo."quantityComplete") FILTER (
               WHERE terminal_jo."reworkId" IS NOT NULL
             ), 0)
      FROM "jobOperation" terminal_jo
      INNER JOIN "jobMakeMethod" terminal_jmm ON terminal_jmm.id = terminal_jo."jobMakeMethodId"
      WHERE terminal_jo."jobId" = v_job_id
        AND terminal_jmm."parentMaterialId" IS NULL
        AND terminal_jo.status <> 'Canceled'
        AND NOT EXISTS (
          SELECT 1
          FROM "jobOperationDependency" dep
          INNER JOIN "jobOperation" child_jo ON child_jo.id = dep."operationId"
          INNER JOIN "jobMakeMethod" child_jmm ON child_jmm.id = child_jo."jobMakeMethodId"
          WHERE dep."dependsOnId" = terminal_jo.id
            AND child_jmm."parentMaterialId" IS NULL
        )
    )
    WHERE id = v_job_id
      AND status NOT IN ('Completed', 'Cancelled');
  END IF;
END;
$function$;
