CREATE OR REPLACE FUNCTION public.sync_insert_job_make_method(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_item_readable_id TEXT;
  v_item_tracking_type TEXT;
  v_job_make_method_id TEXT;
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  SELECT "readableIdWithRevision", "itemTrackingType"
    INTO v_item_readable_id, v_item_tracking_type
  FROM "item"
  WHERE "id" = p_new->>'itemId';

  INSERT INTO "jobMakeMethod" (
    "jobId", "itemId", "companyId", "createdBy",
    "requiresSerialTracking", "requiresBatchTracking"
  ) VALUES (
    p_new->>'id', p_new->>'itemId', p_new->>'companyId', p_new->>'createdBy',
    v_item_tracking_type = 'Serial', v_item_tracking_type = 'Batch'
  )
  RETURNING "id" INTO v_job_make_method_id;

  INSERT INTO "trackedEntity" (
    "sourceDocument", "sourceDocumentId", "sourceDocumentReadableId",
    "quantity", "status", "companyId", "createdBy", "attributes", "itemId"
  ) VALUES (
    'Item', p_new->>'itemId', v_item_readable_id,
    COALESCE((p_new->>'quantity')::numeric, 1), 'Reserved',
    p_new->>'companyId', p_new->>'createdBy',
    jsonb_build_object('Job', p_new->>'id', 'Job Make Method', v_job_make_method_id),
    p_new->>'itemId'
  );
END;
$function$;
