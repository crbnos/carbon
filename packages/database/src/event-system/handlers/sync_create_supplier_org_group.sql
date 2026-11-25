CREATE OR REPLACE FUNCTION public.sync_create_supplier_org_group(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  INSERT INTO "group" ("id", "name", "isSupplierOrgGroup", "companyId")
  VALUES (p_new->>'id', p_new->>'name', TRUE, p_new->>'companyId');

  -- Only the type's own group, in this company: the type id is caller-set.
  INSERT INTO "membership"("groupId", "memberGroupId")
  SELECT g.id, p_new->>'id'
  FROM "group" g
  WHERE g.id = p_new->>'supplierTypeId'
    AND g."isSupplierTypeGroup"
    AND g."companyId" = p_new->>'companyId';
END;
$function$;
