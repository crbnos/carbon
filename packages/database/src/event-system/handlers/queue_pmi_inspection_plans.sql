CREATE OR REPLACE FUNCTION public.queue_pmi_inspection_plans()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  link RECORD;
BEGIN
  -- A seed, a restore or a sync loads items in bulk; their plans come with them.
  IF TG_OP = 'DELETE' OR current_setting('app.sync_in_progress', true) = 'true' THEN
    RETURN NULL;
  END IF;

  -- An item that starts using a model whose PMI was already read gets an
  -- inspection plan made from that PMI (a new revision, a converted quote
  -- line, an existing model attached to a part). A model whose PMI is read
  -- later is covered by model-optimize, which sends the same event.
  IF TG_OP = 'INSERT' THEN
    FOR link IN
      SELECT n."id" AS "itemId", n."companyId", n."modelUploadId"
      FROM batched_new n
      JOIN "modelUpload" m ON m."id" = n."modelUploadId"
      WHERE m."pmiPath" IS NOT NULL
    LOOP
      PERFORM util.send_inngest_event(
        'carbon/pmi-inspection-plan',
        jsonb_build_object(
          'companyId', link."companyId",
          'modelUploadId', link."modelUploadId",
          'itemId', link."itemId"
        )
      );
    END LOOP;
  ELSE
    FOR link IN
      SELECT n."id" AS "itemId", n."companyId", n."modelUploadId"
      FROM batched_new n
      JOIN batched_old o ON o."id" = n."id"
      JOIN "modelUpload" m ON m."id" = n."modelUploadId"
      WHERE n."modelUploadId" IS DISTINCT FROM o."modelUploadId"
        AND m."pmiPath" IS NOT NULL
    LOOP
      PERFORM util.send_inngest_event(
        'carbon/pmi-inspection-plan',
        jsonb_build_object(
          'companyId', link."companyId",
          'modelUploadId', link."modelUploadId",
          'itemId', link."itemId"
        )
      );
    END LOOP;
  END IF;

  RETURN NULL;
END;
$function$;
