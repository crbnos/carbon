CREATE OR REPLACE FUNCTION public.jsonb_to_text_array(jsonb)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
    SELECT array_agg(value::text) FROM jsonb_array_elements_text($1) AS t(value);
$function$;
