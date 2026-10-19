CREATE OR REPLACE FUNCTION util.clear_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    clear_column text := TG_ARGV[0];
BEGIN
    NEW := NEW #= hstore(clear_column, NULL);
    RETURN NEW;
END;
$function$;
