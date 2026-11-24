-- The dialog reads this state in the same snapshot as its hold explanations.
-- Keep the sequence identity, but not its next number: other jobs may draw
-- numbers without changing the units this job can receive.
CREATE OR REPLACE FUNCTION util.job_receipt_preview_state(p_job_id text, p_company_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'jobId', j.id, 'itemId', j."itemId", 'itemTrackingType', item."itemTrackingType", 'quantity', j.quantity,
    'salesOrderId', j."salesOrderId", 'salesOrderLineId', j."salesOrderLineId",
    'locationId', j."locationId", 'storageUnitId', j."storageUnitId",
    'projectId', j."projectId", 'projectElementId', j."projectElementId",
    'receiveToProjectStock', j."receiveToProjectStock", 'planningGroupId', j."planningGroupId",
    'quantityReceived', COALESCE(j."quantityReceivedToInventory", 0),
    'methodId', m.id, 'requiresSerialTracking', m."requiresSerialTracking",
    'requiresBatchTracking', m."requiresBatchTracking", 'sequenceId', seq.id,
    'fixedAssetId', j."fixedAssetId", 'fixedAssetClassId', j."fixedAssetClassId",
    'consumeToProject', j."consumeToProject", 'trackedEntities', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id, 'status', u.status, 'quantity', u.quantity, 'readableId', u."readableId",
        'createdAt', u."createdAt" AT TIME ZONE 'UTC',
        'fixedAsset', u.attributes ? 'Fixed Asset',
        'held', EXISTS (SELECT 1 FROM "unitQualityHold" h
                        WHERE h."trackedEntityId" = u.id AND h."companyId" = u."companyId"),
        'issued', u.status = 'Consumed' AND EXISTS (
          SELECT 1 FROM "itemLedger" l
          WHERE l."trackedEntityId" = u.id AND l."companyId" = u."companyId" AND l.quantity < 0),
        'received', (SELECT SUM(l.quantity) FROM "itemLedger" l
                     WHERE l."trackedEntityId" = u.id AND l."companyId" = u."companyId"
                       AND l."documentType" = 'Job Receipt' AND l."documentId" = j.id)
      ) ORDER BY u."readableId" NULLS LAST, u."createdAt", u.id)
      FROM "trackedEntity" u
      WHERE u."companyId" = m."companyId" AND u.attributes->>'Job Make Method' = m.id
        AND (m."requiresSerialTracking" OR m."requiresBatchTracking")
    ), '[]'::jsonb)
  )
  FROM "job" j
  JOIN "item" item ON item.id = j."itemId" AND item."companyId" = j."companyId"
  JOIN "jobMakeMethod" m ON m."jobId" = j.id AND m."companyId" = j."companyId"
                         AND m."parentMaterialId" IS NULL
  LEFT JOIN "itemSerialSequence" seq ON seq."itemId" = j."itemId" AND seq."companyId" = j."companyId"
  WHERE j.id = p_job_id AND j."companyId" = p_company_id
$function$;

-- Preserve direct quantity-only API posting. The interactive dialog supplies
-- its receipt state and, when it lists serials, their exact selected IDs.
CREATE OR REPLACE FUNCTION public.complete_job_from_receipt_preview(
  p_job_id text, p_quantity_complete numeric, p_company_id text, p_user_id text,
  p_expected_preview text, p_expected_unit_ids text[] DEFAULT NULL,
  p_storage_unit_id text DEFAULT NULL, p_location_id text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
-- PostgREST opens the RPC transaction at this isolation level. A replacement
-- row inserted mid-post cannot appear between the comparison and selection.
SET default_transaction_isolation TO 'repeatable read' AS $function$
DECLARE
  v_state jsonb;
BEGIN
  PERFORM assert_company_access(p_company_id);
  PERFORM 1 FROM "job" j WHERE j.id = p_job_id AND j."companyId" = p_company_id FOR UPDATE;
  -- Match receipt lock order. A disposition in flight finishes before the
  -- comparison; one that starts later sees the result of this receipt.
  PERFORM u.id FROM "jobMakeMethod" m
    JOIN "trackedEntity" u ON u."companyId" = m."companyId" AND u.attributes->>'Job Make Method' = m.id
    WHERE m."jobId" = p_job_id AND m."companyId" = p_company_id AND m."parentMaterialId" IS NULL
    ORDER BY u.id FOR UPDATE OF u;
  v_state := util.job_receipt_preview_state(p_job_id, p_company_id);
  IF v_state IS NULL OR p_expected_preview IS DISTINCT FROM md5(v_state::text) THEN
    RAISE EXCEPTION 'The serials available for this receipt changed. Reopen the Complete dialog and review the units.';
  END IF;
  IF p_expected_unit_ids IS NOT NULL THEN
    PERFORM complete_job_to_inventory_previewed(p_job_id, p_quantity_complete, p_company_id, p_user_id,
                                                p_expected_unit_ids, p_storage_unit_id, p_location_id);
  ELSE
    PERFORM complete_job_to_inventory(p_job_id, p_quantity_complete, p_storage_unit_id,
                                      p_location_id, p_company_id, p_user_id);
  END IF;
END;
$function$;
