CREATE OR REPLACE FUNCTION public.queue_model_pipeline()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  model RECORD;
BEGIN
  -- Only a new model starts the pipeline. A seed, a restore or a sync loads
  -- rows in bulk whose models are bundled or already processed.
  IF TG_OP <> 'INSERT' OR current_setting('app.sync_in_progress', true) = 'true' THEN
    RETURN NULL;
  END IF;

  -- One optimise per new model, whichever path inserted it (an upload, the
  -- API, an integration). It reads the raw once and writes the preview GLB,
  -- the compacted raw and the thumbnail. Demo-template artwork ships with the
  -- app (`_templates/`) and is never processed.
  FOR model IN
    SELECT "id", "companyId"
    FROM batched_new
    WHERE "optimizeStatus" = 'Idle'
      AND "modelPath" NOT LIKE '\_templates/%'
  LOOP
    PERFORM util.send_inngest_event(
      'carbon/model-optimize',
      jsonb_build_object('modelUploadId', model."id", 'companyId', model."companyId")
    );
  END LOOP;

  RETURN NULL;
END;
$function$;
