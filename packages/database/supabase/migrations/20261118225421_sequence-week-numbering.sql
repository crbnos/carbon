-- %{ww} was always the ISO 8601 week, and %{yyyy} / %{yy} always the calendar
-- year, so a format such as %{yy}%{ww} named the wrong year for up to three
-- days around each new year: Friday 1 January 2027 is in week 53 of 2026 and
-- was issued as 2753.
--
-- companySettings."sequenceWeekNumbering" picks how %{ww} counts weeks:
--   iso  ISO 8601 (the default, and what %{ww} meant before). Weeks start on
--        Monday; week 1 is the week with the year's first Thursday.
--   us   Weeks start on Sunday; week 1 is the week of 1 January, and the last
--        week ends on 31 December. The week's year is the calendar year.
-- In a format with %{ww} and no %{mm} or %{dd}, %{yyyy} and %{yy} are the year
-- the week belongs to; beside a month or a day they stay the calendar year. So
-- 1 January 2027 is 2653 under iso and 2701 under us, and %{yyyy}%{mm}%{dd} is
-- 20270101 under both.
--
-- interpolate_sequence_date holds the date tokens for both callers:
-- get_next_sequence (document numbers) and interpolate_serial_segment (serial
-- and batch numbers, through get_next_serial_numbers). Its TypeScript twin is
-- interpolateSequenceDate (@carbon/database/sequence-tokens).
-- util.document_sequence_pattern needs no change: every date token still reads
-- back as digits of the same width. get_next_sequence is forked from
-- 20261012043729_get-next-sequence-no-truncate.sql, interpolate_serial_segment
-- and get_next_serial_numbers from 20261028153518_serial-number-timing-completion.sql;
-- only the interpolation differs.

ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "sequenceWeekNumbering" TEXT NOT NULL DEFAULT 'iso'
  CHECK ("sequenceWeekNumbering" IN ('iso', 'us'));

-- p_format is the whole format (prefix and suffix together): whether it has a
-- week, a month or a day decides which year %{yyyy} and %{yy} are. It defaults
-- to p_value.
CREATE OR REPLACE FUNCTION public.interpolate_sequence_date(
  p_value text,
  p_now timestamp,
  p_week_numbering text DEFAULT 'iso',
  p_format text DEFAULT NULL
)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_format text := COALESCE(p_format, p_value, '');
  v_week integer;
  v_week_year integer;
  v_year integer;
BEGIN
  IF p_week_numbering = 'us' THEN
    v_week := (extract(doy FROM p_now)::integer
      + extract(dow FROM date_trunc('year', p_now))::integer - 1) / 7 + 1;
    v_week_year := extract(year FROM p_now)::integer;
  ELSE
    v_week := extract(week FROM p_now)::integer;
    v_week_year := extract(isoyear FROM p_now)::integer;
  END IF;

  v_year := CASE
    WHEN strpos(v_format, '%{ww}') > 0
      AND strpos(v_format, '%{mm}') = 0
      AND strpos(v_format, '%{dd}') = 0
    THEN v_week_year
    ELSE extract(year FROM p_now)::integer
  END;

  RETURN replace(replace(replace(replace(replace(replace(replace(
    COALESCE(p_value, ''),
    '%{yyyy}', v_year::text),
    '%{yy}', right(v_year::text, 2)),
    '%{mm}', to_char(p_now, 'MM')),
    '%{ww}', lpad(v_week::text, 2, '0')),
    '%{dd}', to_char(p_now, 'DD')),
    '%{hh}', to_char(p_now, 'HH24')),
    '%{ss}', to_char(p_now, 'SS'));
END;
$function$;

-- The new arguments have defaults, so a call with the old three still works.
-- The old signature is dropped so that call is not ambiguous.
DROP FUNCTION IF EXISTS public.interpolate_serial_segment(text, timestamp, text);

CREATE OR REPLACE FUNCTION public.interpolate_serial_segment(
  p_value text,
  p_now timestamp,
  p_location text,
  p_week_numbering text DEFAULT 'iso',
  p_format text DEFAULT NULL
)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT replace(
    interpolate_sequence_date(p_value, p_now, p_week_numbering, p_format),
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
  v_week_numbering text;
  v_format text;
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
  -- interpolateSequenceFormat(prefix, suffix, { timezone, weekNumbering }).
  v_now := now() AT TIME ZONE COALESCE(
    (SELECT "timezone" FROM "company" WHERE "id" = company_id),
    'UTC'
  );
  v_week_numbering := COALESCE(
    (SELECT "sequenceWeekNumbering" FROM "companySettings" WHERE "id" = company_id),
    'iso'
  );
  v_format := COALESCE(v_prefix, '') || COALESCE(v_suffix, '');

  RETURN interpolate_sequence_date(v_prefix, v_now, v_week_numbering, v_format)
    || v_next_sequence
    || interpolate_sequence_date(v_suffix, v_now, v_week_numbering, v_format);
END;
$function$;

-- Reserve and format the next p_count serial numbers of an item's
-- itemSerialSequence. Empty when the item has no sequence. Runs as the caller:
-- the ERP and MES call it on a direct connection, and the completion as
-- whoever runs the completion.
CREATE OR REPLACE FUNCTION public.get_next_serial_numbers(
  p_item_id text,
  p_company_id text,
  p_count integer,
  p_location_code text DEFAULT NULL,
  p_location_name text DEFAULT NULL
)
 RETURNS text[]
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_next integer;
  v_prefix text;
  v_suffix text;
  v_size integer;
  v_step integer;
  v_now timestamp;
  v_location text;
  v_week_numbering text;
  v_format text;
  v_value integer;
  v_serials text[] := '{}';
BEGIN
  IF p_count IS NULL OR p_count < 1 THEN
    RETURN v_serials;
  END IF;

  UPDATE "itemSerialSequence"
  SET next = next + p_count * step,
      "updatedBy" = 'system',
      "updatedAt" = now()
  WHERE "itemId" = p_item_id
    AND "companyId" = p_company_id
  RETURNING next, prefix, suffix, size, step
  INTO v_next, v_prefix, v_suffix, v_size, v_step;

  IF NOT FOUND THEN
    RETURN v_serials;
  END IF;

  v_now := now() AT TIME ZONE COALESCE(
    (SELECT "timezone" FROM "company" WHERE "id" = p_company_id),
    'UTC'
  );
  v_week_numbering := COALESCE(
    (SELECT "sequenceWeekNumbering" FROM "companySettings" WHERE "id" = p_company_id),
    'iso'
  );
  -- The location code, falling back to its name, with surrounding space trimmed.
  v_location := regexp_replace(
    COALESCE(p_location_code, p_location_name, ''),
    '^\s+|\s+$', '', 'g'
  );
  v_format := COALESCE(v_prefix, '') || COALESCE(v_suffix, '');
  v_prefix := interpolate_serial_segment(v_prefix, v_now, v_location, v_week_numbering, v_format);
  v_suffix := interpolate_serial_segment(v_suffix, v_now, v_location, v_week_numbering, v_format);

  FOR i IN 1..p_count LOOP
    v_value := v_next - p_count * v_step + i * v_step;
    v_serials := v_serials || (
      v_prefix
      || CASE
        WHEN length(v_value::text) >= COALESCE(v_size, 5) THEN v_value::text
        ELSE lpad(v_value::text, COALESCE(v_size, 5), '0')
      END
      || v_suffix
    );
  END LOOP;

  RETURN v_serials;
END;
$function$;
