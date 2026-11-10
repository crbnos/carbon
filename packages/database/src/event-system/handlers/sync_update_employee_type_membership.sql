CREATE OR REPLACE FUNCTION public.sync_update_employee_type_membership(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;
  IF (p_new->>'employeeTypeId') IS NOT DISTINCT FROM (p_old->>'employeeTypeId') THEN
    RETURN;
  END IF;

  -- Move the membership to the new type's group. When the user is already in
  -- that group, moving it would break "membership_groupId_memberUserId_key",
  -- so the old membership is dropped instead.
  UPDATE "membership"
  SET "groupId" = p_new->>'employeeTypeId'
  WHERE "groupId" = p_old->>'employeeTypeId'
    AND "memberUserId" = p_new->>'id'
    AND NOT EXISTS (
      SELECT 1 FROM "membership" m
      WHERE m."groupId" = p_new->>'employeeTypeId'
        AND m."memberUserId" = p_new->>'id'
    );

  DELETE FROM "membership"
  WHERE "groupId" = p_old->>'employeeTypeId'
    AND "memberUserId" = p_new->>'id';
END;
$function$;
