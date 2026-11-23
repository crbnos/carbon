CREATE OR REPLACE FUNCTION public.sync_add_customer_account_to_group(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  -- A user is in a group once ("membership_groupId_memberUserId_key"). A
  -- membership left behind for this pair must not fail the parent insert.
  INSERT INTO "membership" ("groupId", "memberUserId")
  VALUES (
    p_new->>'customerId',
    p_new->>'id'
  )
  ON CONFLICT ("groupId", "memberUserId") DO NOTHING;
END;
$function$;
