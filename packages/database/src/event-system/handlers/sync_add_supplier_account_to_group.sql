CREATE OR REPLACE FUNCTION public.sync_add_supplier_account_to_group(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  -- A user is in a group once ("membership_groupId_memberUserId_key"). A
  -- membership left behind for this pair must not fail the parent insert.
  -- Only the supplier's own organisation group, in this company: the id is caller-set.
  INSERT INTO "membership" ("groupId", "memberUserId")
  SELECT g.id, p_new->>'id'
  FROM "group" g
  WHERE g.id = p_new->>'supplierId'
    AND g."isSupplierOrgGroup"
    AND g."companyId" = p_new->>'companyId'
  ON CONFLICT ("groupId", "memberUserId") DO NOTHING;
END;
$function$;
