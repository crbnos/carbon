CREATE OR REPLACE FUNCTION public.sync_contact_to_parent(table_name text, operation text, new_data jsonb, old_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  contact_id TEXT;
BEGIN
  IF operation = 'DELETE' THEN
    RETURN;
  END IF;

  IF current_setting('app.sync_in_progress', true) = 'true' THEN
    RETURN;
  END IF;

  contact_id := COALESCE(new_data->>'id', old_data->>'id');

  UPDATE "customer" c
  SET "updatedAt" = NOW()
  FROM "customerContact" cc
  WHERE cc."contactId" = contact_id
    AND cc."customerId" = c.id;

  UPDATE "supplier" s
  SET "updatedAt" = NOW()
  FROM "supplierContact" sc
  WHERE sc."contactId" = contact_id
    AND sc."supplierId" = s.id;
END;
$function$;
