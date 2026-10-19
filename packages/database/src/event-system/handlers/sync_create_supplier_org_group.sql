CREATE OR REPLACE FUNCTION public.sync_create_supplier_org_group(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  INSERT INTO "group" ("id", "name", "isSupplierOrgGroup", "companyId")
  VALUES (p_new->>'id', p_new->>'name', TRUE, p_new->>'companyId');

  IF p_new->>'supplierTypeId' IS NOT NULL THEN
    INSERT INTO "membership"("groupId", "memberGroupId")
    VALUES (p_new->>'supplierTypeId', p_new->>'id');
  END IF;
END;
$function$;
