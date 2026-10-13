CREATE OR REPLACE FUNCTION util.document_sequence_number(p_value text, p_prefix text, p_suffix text, p_size integer)
 RETURNS bigint
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_digits text;
BEGIN
  -- The number get_next_sequence would have formatted as p_value, or NULL when
  -- p_value is not in the sequence's format (a custom id such as "ACME-1").
  v_digits := substring(p_value FROM util.document_sequence_pattern(p_prefix, p_suffix, p_size));

  IF v_digits IS NULL OR length(v_digits) > 18 THEN
    RETURN NULL;
  END IF;

  RETURN v_digits::bigint;
END;
$function$;
