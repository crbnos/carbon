CREATE OR REPLACE FUNCTION public.sync_create_user_identity_group(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  INSERT INTO "group" ("id", "name", "isIdentityGroup")
  VALUES (
    p_new->>'id',
    p_new->>'fullName',
    TRUE
  );

  INSERT INTO "membership" ("groupId", "memberUserId")
  VALUES (
    p_new->>'id',
    p_new->>'id'
  );
END;
$function$;
