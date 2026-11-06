CREATE OR REPLACE FUNCTION public.sync_item_tracking_type_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_problem RECORD;
BEGIN
  -- A seed, a restore or a sync loads items with their stock and jobs as they
  -- were; nothing in them is stale.
  IF TG_OP <> 'UPDATE' OR current_setting('app.sync_in_progress', true) = 'true' THEN
    RETURN NULL;
  END IF;

  -- Stock held in a form the new tracking type cannot use. Untracked draws read
  -- only rows with no tracked entity, and tracked draws only rows with one:
  -- - Inventory cannot use batch or serial stock.
  -- - Serial cannot use untracked stock, nor a lot of more than one unit.
  -- - Non-Inventory holds no stock at all.
  -- Batch takes any stock: untracked stock becomes stock with no batch number,
  -- which assignBatchToUnnumberedStock numbers in place, and lots left from an
  -- earlier change are batches again.
  SELECT o."readableIdWithRevision" AS "item", n."itemTrackingType" AS "newType",
         tracked.lots, tracked.quantity AS "trackedQuantity",
         tracked."multiUnitLot", tracked."multiUnitQuantity",
         untracked.bins, untracked.quantity AS "untrackedQuantity"
  INTO v_problem
  FROM batched_new n
  JOIN batched_old o ON o.id = n.id AND o."companyId" = n."companyId"
  CROSS JOIN LATERAL (
    SELECT count(*) AS lots, sum(per_lot.net) AS quantity,
           min(te."readableId") FILTER (WHERE round(per_lot.net, 5) <> 1) AS "multiUnitLot",
           max(per_lot.net) FILTER (WHERE round(per_lot.net, 5) <> 1) AS "multiUnitQuantity"
    FROM (
      SELECT il."trackedEntityId", sum(il.quantity) AS net
      FROM "itemLedger" il
      WHERE il."itemId" = n.id
        AND il."companyId" = n."companyId"
        AND il."trackedEntityId" IS NOT NULL
      GROUP BY il."trackedEntityId"
      HAVING round(sum(il.quantity), 5) <> 0
    ) per_lot
    LEFT JOIN "trackedEntity" te
      ON te.id = per_lot."trackedEntityId" AND te."companyId" = n."companyId"
  ) tracked
  CROSS JOIN LATERAL (
    SELECT count(*) AS bins, sum(net) AS quantity
    FROM (
      SELECT sum(il.quantity) AS net
      FROM "itemLedger" il
      WHERE il."itemId" = n.id
        AND il."companyId" = n."companyId"
        AND il."trackedEntityId" IS NULL
      GROUP BY il."locationId", il."storageUnitId", il."projectId"
      HAVING round(sum(il.quantity), 5) <> 0
    ) per_bin
  ) untracked
  WHERE n."itemTrackingType" IS DISTINCT FROM o."itemTrackingType"
    AND CASE n."itemTrackingType"
      WHEN 'Inventory' THEN tracked.lots > 0
      WHEN 'Serial' THEN untracked.bins > 0 OR tracked."multiUnitQuantity" IS NOT NULL
      WHEN 'Non-Inventory' THEN tracked.lots > 0 OR untracked.bins > 0
      ELSE false
    END
  LIMIT 1;

  IF FOUND THEN
    IF v_problem."newType" = 'Inventory' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = format(
        '%s still has stock in %s batch or serial numbers (%s in total). Adjust each to zero before you change the tracking type to Inventory.',
        v_problem."item", v_problem.lots,
        trim_scale(round(v_problem."trackedQuantity", 5))
      );
    END IF;
    IF v_problem."newType" = 'Serial' AND v_problem.bins > 0 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = format(
        '%s still has stock with no serial number in %s storage units (%s in total). Adjust each to zero before you change the tracking type to Serial.',
        v_problem."item", v_problem.bins,
        trim_scale(round(v_problem."untrackedQuantity", 5))
      );
    END IF;
    IF v_problem."newType" = 'Serial' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = format(
        '%s has %s on hand in batch %s. A serial number holds one unit: adjust that stock before you change the tracking type to Serial.',
        v_problem."item", trim_scale(round(v_problem."multiUnitQuantity", 5)),
        coalesce(v_problem."multiUnitLot", 'with no number')
      );
    END IF;
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = format(
      '%s still has stock in %s storage units or batch or serial numbers (%s in total). Adjust each to zero before you change the tracking type to Non-Inventory.',
      v_problem."item", v_problem.lots + v_problem.bins,
      trim_scale(round(coalesce(v_problem."trackedQuantity", 0) + coalesce(v_problem."untrackedQuantity", 0), 5))
    );
  END IF;

  -- A released job keeps the tracking type its materials and assemblies had
  -- when it was made, and its issues read that copy. A change now would make
  -- the copy and the item disagree, so it waits until the job is finished.
  SELECT o."readableIdWithRevision" AS "item",
         (array_agg(DISTINCT j."jobId"))[1:5] AS "jobs",
         count(DISTINCT j.id) AS "jobCount"
  INTO v_problem
  FROM batched_new n
  JOIN batched_old o ON o.id = n.id AND o."companyId" = n."companyId"
  JOIN "job" j ON j."companyId" = n."companyId"
  WHERE n."itemTrackingType" IS DISTINCT FROM o."itemTrackingType"
    AND j.status NOT IN ('Draft', 'Planned', 'Completed', 'Cancelled', 'Closed')
    AND (
      EXISTS (
        SELECT 1 FROM "jobMaterial" jm
        WHERE jm."jobId" = j.id AND jm."companyId" = j."companyId" AND jm."itemId" = n.id
      )
      OR EXISTS (
        SELECT 1 FROM "jobMakeMethod" jmm
        WHERE jmm."jobId" = j.id AND jmm."companyId" = j."companyId" AND jmm."itemId" = n.id
      )
    )
  GROUP BY o."readableIdWithRevision"
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = format(
      '%s is on released jobs that are not finished: %s%s. Complete or cancel them before you change the tracking type.',
      v_problem."item",
      array_to_string(v_problem."jobs", ', '),
      CASE WHEN v_problem."jobCount" > 5 THEN ', …' ELSE '' END
    );
  END IF;

  -- The open documents that copied the tracking type take the new one: the
  -- materials and assemblies of Draft and Planned jobs, and the lines of Draft
  -- receipts, shipments and stock transfers.
  UPDATE "jobMakeMethod" t
  SET "requiresSerialTracking" = n."itemTrackingType" = 'Serial',
      "requiresBatchTracking" = n."itemTrackingType" = 'Batch',
      "updatedBy" = COALESCE(n."updatedBy", n."createdBy"),
      "updatedAt" = NOW()
  FROM batched_new n
  JOIN batched_old o ON o.id = n.id AND o."companyId" = n."companyId"
  JOIN "job" j ON j."companyId" = n."companyId" AND j.status IN ('Draft', 'Planned')
  WHERE n."itemTrackingType" IS DISTINCT FROM o."itemTrackingType"
    AND t."itemId" = n.id
    AND t."companyId" = n."companyId"
    AND t."jobId" = j.id;

  UPDATE "jobMaterial" t
  SET "requiresSerialTracking" = n."itemTrackingType" = 'Serial',
      "requiresBatchTracking" = n."itemTrackingType" = 'Batch',
      "updatedBy" = COALESCE(n."updatedBy", n."createdBy"),
      "updatedAt" = NOW()
  FROM batched_new n
  JOIN batched_old o ON o.id = n.id AND o."companyId" = n."companyId"
  JOIN "job" j ON j."companyId" = n."companyId" AND j.status IN ('Draft', 'Planned')
  WHERE n."itemTrackingType" IS DISTINCT FROM o."itemTrackingType"
    AND t."itemId" = n.id
    AND t."companyId" = n."companyId"
    AND t."jobId" = j.id;

  UPDATE "receiptLine" t
  SET "requiresSerialTracking" = n."itemTrackingType" = 'Serial',
      "requiresBatchTracking" = n."itemTrackingType" = 'Batch',
      "updatedBy" = COALESCE(n."updatedBy", n."createdBy"),
      "updatedAt" = NOW()
  FROM batched_new n
  JOIN batched_old o ON o.id = n.id AND o."companyId" = n."companyId"
  JOIN "receipt" d ON d."companyId" = n."companyId" AND d.status = 'Draft'
  WHERE n."itemTrackingType" IS DISTINCT FROM o."itemTrackingType"
    AND t."itemId" = n.id
    AND t."companyId" = n."companyId"
    AND t."receiptId" = d.id;

  UPDATE "shipmentLine" t
  SET "requiresSerialTracking" = n."itemTrackingType" = 'Serial',
      "requiresBatchTracking" = n."itemTrackingType" = 'Batch',
      "updatedBy" = COALESCE(n."updatedBy", n."createdBy"),
      "updatedAt" = NOW()
  FROM batched_new n
  JOIN batched_old o ON o.id = n.id AND o."companyId" = n."companyId"
  JOIN "shipment" d ON d."companyId" = n."companyId" AND d.status = 'Draft'
  WHERE n."itemTrackingType" IS DISTINCT FROM o."itemTrackingType"
    AND t."itemId" = n.id
    AND t."companyId" = n."companyId"
    AND t."shipmentId" = d.id;

  UPDATE "stockTransferLine" t
  SET "requiresSerialTracking" = n."itemTrackingType" = 'Serial',
      "requiresBatchTracking" = n."itemTrackingType" = 'Batch',
      "updatedBy" = COALESCE(n."updatedBy", n."createdBy"),
      "updatedAt" = NOW()
  FROM batched_new n
  JOIN batched_old o ON o.id = n.id AND o."companyId" = n."companyId"
  JOIN "stockTransfer" d ON d."companyId" = n."companyId" AND d.status = 'Draft'
  WHERE n."itemTrackingType" IS DISTINCT FROM o."itemTrackingType"
    AND t."itemId" = n.id
    AND t."companyId" = n."companyId"
    AND t."stockTransferId" = d.id;

  RETURN NULL;
END;
$function$;
