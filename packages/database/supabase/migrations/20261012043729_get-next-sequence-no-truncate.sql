-- get_next_sequence truncated a number longer than the sequence's size
-- (lpad('1000000', 6) is '100000'), so a counter past 10^size handed out a
-- shorter, often already-used number. getNextSequence (@carbon/database/sequence)
-- pads with padStart and never truncates; this makes the two agree. A counter
-- can now pass 10^size because a saved document number moves it
-- (sync_advance_document_sequence). Only the padding line differs from
-- 20260925121735_rpc-function-guards.sql.
CREATE OR REPLACE FUNCTION public.get_next_sequence(sequence_name text, company_id text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prefix text;
  v_suffix text;
  v_next_value integer;
  v_size integer;
  v_next_sequence text;
  v_derived_prefix text;
  v_derived_suffix text;
  v_now timestamp;
BEGIN
  PERFORM assert_company_access(company_id);

  UPDATE sequence
  SET next = next + step,
      "updatedBy" = 'system'
  WHERE "table" = sequence_name
  AND "companyId" = company_id
  RETURNING next, prefix, suffix, size
  INTO v_next_value, v_prefix, v_suffix, v_size;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sequence not found for table % and company %', sequence_name, company_id;
  END IF;

  -- Format sequence number
  v_next_sequence := CASE
    WHEN length(v_next_value::text) >= COALESCE(v_size, 4) THEN v_next_value::text
    ELSE lpad(v_next_value::text, COALESCE(v_size, 4), '0')
  END;

  -- Wall-clock in the company's timezone: document prefixes must roll over at
  -- the company's midnight, not the database's. Matches the TypeScript twin
  -- interpolateSequenceDate(value, companyTimezone).
  v_now := now() AT TIME ZONE COALESCE(
    (SELECT "timezone" FROM "company" WHERE "id" = company_id),
    'UTC'
  );

  -- Interpolate date variables in prefix/suffix
  v_derived_prefix := COALESCE(v_prefix, '');
  v_derived_prefix := replace(v_derived_prefix, '%{yyyy}', to_char(v_now, 'YYYY'));
  v_derived_prefix := replace(v_derived_prefix, '%{yy}', to_char(v_now, 'YY'));
  v_derived_prefix := replace(v_derived_prefix, '%{mm}', to_char(v_now, 'MM'));
  v_derived_prefix := replace(v_derived_prefix, '%{ww}', to_char(v_now, 'IW'));
  v_derived_prefix := replace(v_derived_prefix, '%{dd}', to_char(v_now, 'DD'));
  v_derived_prefix := replace(v_derived_prefix, '%{hh}', to_char(v_now, 'HH24'));
  v_derived_prefix := replace(v_derived_prefix, '%{ss}', to_char(v_now, 'SS'));

  v_derived_suffix := COALESCE(v_suffix, '');
  v_derived_suffix := replace(v_derived_suffix, '%{yyyy}', to_char(v_now, 'YYYY'));
  v_derived_suffix := replace(v_derived_suffix, '%{yy}', to_char(v_now, 'YY'));
  v_derived_suffix := replace(v_derived_suffix, '%{mm}', to_char(v_now, 'MM'));
  v_derived_suffix := replace(v_derived_suffix, '%{ww}', to_char(v_now, 'IW'));
  v_derived_suffix := replace(v_derived_suffix, '%{dd}', to_char(v_now, 'DD'));
  v_derived_suffix := replace(v_derived_suffix, '%{hh}', to_char(v_now, 'HH24'));
  v_derived_suffix := replace(v_derived_suffix, '%{ss}', to_char(v_now, 'SS'));

  RETURN v_derived_prefix || v_next_sequence || v_derived_suffix;
END;
$function$;
