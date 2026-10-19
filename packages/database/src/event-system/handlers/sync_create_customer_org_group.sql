CREATE OR REPLACE FUNCTION public.sync_create_customer_org_group(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  INSERT INTO "group" ("id", "name", "isCustomerOrgGroup", "companyId")
  VALUES (p_new->>'id', p_new->>'name', TRUE, p_new->>'companyId');

  IF p_new->>'customerTypeId' IS NOT NULL THEN
    INSERT INTO "membership"("groupId", "memberGroupId")
    VALUES (p_new->>'customerTypeId', p_new->>'id');
  END IF;
END;
$function$;
