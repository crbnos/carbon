CREATE OR REPLACE FUNCTION public.sync_check_job_material_self_reference(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  job_item_id TEXT;
BEGIN
  IF p_operation NOT IN ('INSERT', 'UPDATE') THEN RETURN; END IF;

  SELECT "itemId" INTO job_item_id
  FROM job
  WHERE "id" = p_new->>'jobId'
    AND "companyId" = p_new->>'companyId';

  IF job_item_id = p_new->>'itemId' THEN
    RAISE EXCEPTION 'A job cannot consume the item it produces as a material'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$function$;
