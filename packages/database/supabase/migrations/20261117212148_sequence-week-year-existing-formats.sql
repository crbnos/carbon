-- Formats that label the ISO week with the calendar year (%{yy}%{ww},
-- %{yyyy}-W%{ww}) and have no month or day move to the year of the week
-- (%{wyy}, %{wyyyy}). Before this, such a format named the wrong year on the
-- days a week crosses the new year, under any week convention: 30 December
-- 2024 was issued as 2401 (week 1 of 2025), 1 January 2027 as 2753 (week 53
-- of 2026). The numbers it issues on every other day are unchanged, the counter
-- does not move, and numbers already issued keep their text. A format with a
-- month or a day keeps the calendar year, which belongs to that date, and so
-- does a format that already has a week year token beside it.
-- usesCalendarYearForWeek (@carbon/database/sequence-tokens) is the same test.

DO $$
DECLARE
  v_documents integer;
  v_serials integer;
BEGIN
  UPDATE "sequence"
  SET "prefix" = replace(replace("prefix", '%{yyyy}', '%{wyyyy}'), '%{yy}', '%{wyy}'),
      "suffix" = replace(replace("suffix", '%{yyyy}', '%{wyyyy}'), '%{yy}', '%{wyy}'),
      "updatedBy" = 'system',
      "updatedAt" = now()
  WHERE strpos(COALESCE("prefix", '') || COALESCE("suffix", ''), '%{ww}') > 0
    AND (
      strpos(COALESCE("prefix", '') || COALESCE("suffix", ''), '%{yyyy}') > 0
      OR strpos(COALESCE("prefix", '') || COALESCE("suffix", ''), '%{yy}') > 0
    )
    AND strpos(COALESCE("prefix", '') || COALESCE("suffix", ''), '%{mm}') = 0
    AND strpos(COALESCE("prefix", '') || COALESCE("suffix", ''), '%{dd}') = 0
    AND strpos(COALESCE("prefix", '') || COALESCE("suffix", ''), '%{wyy}') = 0
    AND strpos(COALESCE("prefix", '') || COALESCE("suffix", ''), '%{wyyyy}') = 0;
  GET DIAGNOSTICS v_documents = ROW_COUNT;

  UPDATE "itemSerialSequence"
  SET "prefix" = replace(replace("prefix", '%{yyyy}', '%{wyyyy}'), '%{yy}', '%{wyy}'),
      "suffix" = replace(replace("suffix", '%{yyyy}', '%{wyyyy}'), '%{yy}', '%{wyy}'),
      "updatedBy" = 'system',
      "updatedAt" = now()
  WHERE strpos(COALESCE("prefix", '') || COALESCE("suffix", ''), '%{ww}') > 0
    AND (
      strpos(COALESCE("prefix", '') || COALESCE("suffix", ''), '%{yyyy}') > 0
      OR strpos(COALESCE("prefix", '') || COALESCE("suffix", ''), '%{yy}') > 0
    )
    AND strpos(COALESCE("prefix", '') || COALESCE("suffix", ''), '%{mm}') = 0
    AND strpos(COALESCE("prefix", '') || COALESCE("suffix", ''), '%{dd}') = 0
    AND strpos(COALESCE("prefix", '') || COALESCE("suffix", ''), '%{wyy}') = 0
    AND strpos(COALESCE("prefix", '') || COALESCE("suffix", ''), '%{wyyyy}') = 0;
  GET DIAGNOSTICS v_serials = ROW_COUNT;

  RAISE NOTICE 'Moved % document and % serial number formats to the week year',
    v_documents, v_serials;
END
$$;
