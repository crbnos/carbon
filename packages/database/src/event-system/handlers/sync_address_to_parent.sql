CREATE OR REPLACE FUNCTION public.sync_address_to_parent(table_name text, operation text, new_data jsonb, old_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  address_id TEXT;
BEGIN
  IF operation = 'DELETE' THEN
    RETURN;
  END IF;

  IF current_setting('app.sync_in_progress', true) = 'true' THEN
    RETURN;
  END IF;

  address_id := COALESCE(new_data->>'id', old_data->>'id');

  UPDATE "customer" c
  SET "updatedAt" = NOW()
  FROM "customerLocation" cl
  WHERE cl."addressId" = address_id
    AND cl."customerId" = c.id;

  UPDATE "supplier" s
  SET "updatedAt" = NOW()
  FROM "supplierLocation" sl
  WHERE sl."addressId" = address_id
    AND sl."supplierId" = s.id;
END;
$function$;
