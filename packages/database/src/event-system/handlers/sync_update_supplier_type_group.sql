CREATE OR REPLACE FUNCTION public.sync_update_supplier_type_group(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;

  IF p_old->>'supplierTypeId' IS NOT NULL THEN
    IF p_new->>'supplierTypeId' IS NOT NULL THEN
      UPDATE "membership" SET "groupId" = p_new->>'supplierTypeId'
      WHERE "groupId" = p_old->>'supplierTypeId' AND "memberGroupId" = p_new->>'id';
    ELSE
      DELETE FROM "membership"
      WHERE "groupId" = p_old->>'supplierTypeId' AND "memberGroupId" = p_new->>'id';
    END IF;
  ELSE
    IF p_new->>'supplierTypeId' IS NOT NULL THEN
      INSERT INTO "membership" ("groupId", "memberGroupId")
      VALUES (p_new->>'supplierTypeId', p_new->>'id');
    END IF;
  END IF;

  UPDATE "group" SET "name" = p_new->>'name'
  WHERE "id" = p_new->>'id' AND "isSupplierOrgGroup" = TRUE;
END;
$function$;
