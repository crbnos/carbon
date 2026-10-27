CREATE OR REPLACE FUNCTION public.sync_delete_unlinked_contact(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_operation != 'DELETE' THEN RETURN; END IF;

  DELETE FROM "contact" c
  WHERE c."id" = p_old->>'contactId'
    AND NOT EXISTS (SELECT 1 FROM "customerContact" cc WHERE cc."contactId" = c."id")
    AND NOT EXISTS (SELECT 1 FROM "supplierContact" sc WHERE sc."contactId" = c."id");
END;
$function$;
