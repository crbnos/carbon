CREATE OR REPLACE FUNCTION public.sync_update_customer_type_group(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;

  IF (p_new->>'customerTypeId') IS DISTINCT FROM (p_old->>'customerTypeId') THEN
    IF p_old->>'customerTypeId' IS NOT NULL THEN
      DELETE FROM "membership"
      WHERE "groupId" = p_old->>'customerTypeId' AND "memberGroupId" = p_new->>'id';
    END IF;
    -- Only the type's own group, in this company: the type id is caller-set.
    INSERT INTO "membership" ("groupId", "memberGroupId")
    SELECT g.id, p_new->>'id'
    FROM "group" g
    WHERE g.id = p_new->>'customerTypeId'
      AND g."isCustomerTypeGroup"
      AND g."companyId" = p_new->>'companyId';
  END IF;

  UPDATE "group" SET "name" = p_new->>'name'
  WHERE "id" = p_new->>'id' AND "isCustomerOrgGroup" = TRUE;
END;
$function$;
