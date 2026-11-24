CREATE OR REPLACE FUNCTION public.check_row_identity_change(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- A party's or type's id is also the id of the group that mirrors it, and
  -- interceptors put members into the group the id names: re-pointed, it could
  -- name any group (the Admin type's). Reads the request role.
  IF p_operation = 'UPDATE'
     AND current_setting('role', true) IN ('anon', 'authenticated')
     AND (
       (p_new->>'id') IS DISTINCT FROM (p_old->>'id')
       OR (p_new->>'companyId') IS DISTINCT FROM (p_old->>'companyId')
     ) THEN
    RAISE EXCEPTION 'A record''s id and company can only be changed by the server'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$function$;
