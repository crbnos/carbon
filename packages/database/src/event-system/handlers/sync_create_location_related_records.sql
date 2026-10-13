CREATE OR REPLACE FUNCTION public.sync_create_location_related_records(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  -- Only create itemPlanning records for the new location
  -- Skip the postingGroupInventory inserts since that table no longer exists
  INSERT INTO "itemPlanning" ("itemId", "locationId", "createdBy", "companyId", "createdAt", "updatedAt")
  SELECT
    i.id AS "itemId",
    p_new->>'id' AS "locationId",
    i."createdBy",
    i."companyId",
    NOW(),
    NOW()
  FROM "item" i
  WHERE i."companyId" = p_new->>'companyId';
END;
$function$;
