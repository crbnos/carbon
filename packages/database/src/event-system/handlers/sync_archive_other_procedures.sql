CREATE OR REPLACE FUNCTION public.sync_archive_other_procedures(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;
  IF NOT ((p_new->>'status') = 'Active' AND ((p_old->>'status') IS NULL OR (p_old->>'status') != 'Active')) THEN
    RETURN;
  END IF;

  UPDATE procedure
  SET status = 'Archived'
  WHERE name = p_new->>'name'
    AND "companyId" = p_new->>'companyId'
    AND id != p_new->>'id'
    AND status = 'Active';
END;
$function$;
