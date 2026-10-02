CREATE OR REPLACE FUNCTION public.dispatch_event_after_interceptors()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  func_name TEXT;
  payload_data JSONB;
  old_payload_data JSONB;
  i INTEGER;
BEGIN
  -- A. Normalize Data
  IF TG_OP = 'DELETE' THEN
    payload_data := row_to_json(OLD)::jsonb;
    old_payload_data := payload_data;
  ELSIF TG_OP = 'INSERT' THEN
    payload_data := row_to_json(NEW)::jsonb;
    old_payload_data := NULL;
  ELSE -- UPDATE
    payload_data := row_to_json(NEW)::jsonb;
    old_payload_data := row_to_json(OLD)::jsonb;
  END IF;

  -- B. Execute AFTER Interceptor Functions
  -- Same calling convention as dispatch_event_interceptors():
  --   function_name(table_name TEXT, operation TEXT, new_data JSONB, old_data JSONB)
  FOR i IN 0 .. (TG_NARGS - 1) LOOP
    func_name := TG_ARGV[i];
    EXECUTE format('SELECT public.%I($1, $2, $3, $4)', func_name)
    USING TG_TABLE_NAME::TEXT, TG_OP, payload_data, old_payload_data;
  END LOOP;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;
