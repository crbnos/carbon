CREATE OR REPLACE FUNCTION public.sync_verify_integration(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  integration_schema JSON;
BEGIN
  IF p_operation NOT IN ('INSERT', 'UPDATE') THEN RETURN; END IF;

  SELECT jsonschema INTO integration_schema
  FROM public.integration
  WHERE id = p_new->>'id';

  IF (p_new->>'active')::boolean = TRUE
     AND NOT extensions.json_matches_schema(integration_schema, (p_new->'metadata')::json) THEN
    RAISE EXCEPTION 'metadata does not match jsonschema';
  END IF;
END;
$function$;
