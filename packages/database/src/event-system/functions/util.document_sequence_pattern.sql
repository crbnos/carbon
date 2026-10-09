CREATE OR REPLACE FUNCTION util.document_sequence_pattern(p_prefix text, p_suffix text, p_size integer)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_prefix text;
  v_suffix text;
BEGIN
  -- A regular expression matching what get_next_sequence (and its TypeScript
  -- twin, getNextSequence in @carbon/database/sequence) formats for a
  -- sequence, capturing the number. Date tokens match any date: the counter
  -- does not reset per period. get_next_sequence pads to p_size, so a shorter
  -- number is never one it issues.
  v_prefix := regexp_replace(COALESCE(p_prefix, ''), '([.^$*+?()\[\]{}|\\])', '\\\1', 'g');
  v_prefix := replace(v_prefix, '%\{yyyy\}', '[0-9]{4}');
  v_prefix := replace(v_prefix, '%\{yy\}', '[0-9]{2}');
  v_prefix := replace(v_prefix, '%\{mm\}', '[0-9]{2}');
  v_prefix := replace(v_prefix, '%\{ww\}', '[0-9]{2}');
  v_prefix := replace(v_prefix, '%\{dd\}', '[0-9]{2}');
  v_prefix := replace(v_prefix, '%\{hh\}', '[0-9]{2}');
  v_prefix := replace(v_prefix, '%\{ss\}', '[0-9]{2}');

  v_suffix := regexp_replace(COALESCE(p_suffix, ''), '([.^$*+?()\[\]{}|\\])', '\\\1', 'g');
  v_suffix := replace(v_suffix, '%\{yyyy\}', '[0-9]{4}');
  v_suffix := replace(v_suffix, '%\{yy\}', '[0-9]{2}');
  v_suffix := replace(v_suffix, '%\{mm\}', '[0-9]{2}');
  v_suffix := replace(v_suffix, '%\{ww\}', '[0-9]{2}');
  v_suffix := replace(v_suffix, '%\{dd\}', '[0-9]{2}');
  v_suffix := replace(v_suffix, '%\{hh\}', '[0-9]{2}');
  v_suffix := replace(v_suffix, '%\{ss\}', '[0-9]{2}');

  RETURN '^' || v_prefix || '([0-9]{' || COALESCE(p_size, 4) || ',})' || v_suffix || '$';
END;
$function$;
