-- The ISO week token %{ww} had no year to go with: %{yyyy} and %{yy} are the
-- calendar year, so a format such as %{yy}%{ww} named the wrong year for up to
-- three days around each new year (Friday 1 January 2027 is week 53 of 2026,
-- and was issued as 2753). %{wyyyy} and %{wyy} are the year of the ISO week.
--
-- interpolate_sequence_date now holds the date tokens for both callers:
-- get_next_sequence (document numbers) and interpolate_serial_segment (serial
-- and batch numbers). Its TypeScript twin is interpolateSequenceDate
-- (@carbon/database/sequence-tokens); util.document_sequence_pattern reads the
-- same tokens back. get_next_sequence is forked from
-- 20261012043729_get-next-sequence-no-truncate.sql; only the interpolation
-- differs. interpolate_serial_segment is forked from
-- 20261028153518_serial-number-timing-completion.sql.

CREATE OR REPLACE FUNCTION public.interpolate_sequence_date(
  p_value text,
  p_now timestamp
)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT replace(replace(replace(replace(replace(replace(replace(replace(replace(
    COALESCE(p_value, ''),
    '%{wyyyy}', to_char(p_now, 'IYYY')),
    '%{wyy}', to_char(p_now, 'IY')),
    '%{yyyy}', to_char(p_now, 'YYYY')),
    '%{yy}', to_char(p_now, 'YY')),
    '%{mm}', to_char(p_now, 'MM')),
    '%{ww}', to_char(p_now, 'IW')),
    '%{dd}', to_char(p_now, 'DD')),
    '%{hh}', to_char(p_now, 'HH24')),
    '%{ss}', to_char(p_now, 'SS'));
$function$;

CREATE OR REPLACE FUNCTION public.interpolate_serial_segment(
  p_value text,
  p_now timestamp,
  p_location text
)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT replace(
    interpolate_sequence_date(p_value, p_now),
    '%{location}', COALESCE(p_location, '')
  );
$function$;

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

  RETURN interpolate_sequence_date(v_prefix, v_now)
    || v_next_sequence
    || interpolate_sequence_date(v_suffix, v_now);
END;
$function$;
