CREATE OR REPLACE FUNCTION util.anon_key()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  anon_key text;
BEGIN
  SELECT "anonKey" INTO  anon_key FROM "config" LIMIT 1;
  RETURN anon_key;
END;
$function$;
