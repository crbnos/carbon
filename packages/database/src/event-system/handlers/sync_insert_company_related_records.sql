CREATE OR REPLACE FUNCTION public.sync_insert_company_related_records(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  INSERT INTO "terms" ("id")
  VALUES (p_new->>'id');

  INSERT INTO "companySettings" ("id")
  VALUES (p_new->>'id');
END;
$function$;
