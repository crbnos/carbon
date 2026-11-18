-- A document saved with a number it was given (typed by hand, sent through the
-- API or MCP) moves its sequence past that number, so get_next_sequence never
-- hands it out again (sync_advance_document_sequence + util.document_sequence_number).
-- Run from the repository root against an existing local database that has at
-- least one company with a sales order:
-- pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/document-sequence.test.sql
-- Everything is confined to the rolled-back transaction.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '30s';

CREATE FUNCTION pg_temp.expect(label text, expected anyelement, actual anyelement)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION '%: expected %, got %', label, expected, actual;
  END IF;
END;
$fn$;

-- Parsing: only a number in the sequence's own format counts.
SELECT pg_temp.expect('plain number', 116::bigint, util.document_sequence_number('SO000116', 'SO', NULL, 6));
SELECT pg_temp.expect('longer than size', 1234567::bigint, util.document_sequence_number('SO1234567', 'SO', NULL, 6));
SELECT pg_temp.expect('shorter than size', NULL::bigint, util.document_sequence_number('SO1', 'SO', NULL, 6));
SELECT pg_temp.expect('custom id', NULL::bigint, util.document_sequence_number('ACME-1', 'SO', NULL, 6));
SELECT pg_temp.expect('text before prefix', NULL::bigint, util.document_sequence_number('XSO000116', 'SO', NULL, 6));
SELECT pg_temp.expect('date tokens', 123::bigint, util.document_sequence_number('JE-2026-10-000123', 'JE-%{yyyy}-%{mm}-', NULL, 6));
SELECT pg_temp.expect('week, hour and second tokens', 7::bigint, util.document_sequence_number('W41-13-05-000007', 'W%{ww}-%{hh}-%{ss}-', NULL, 6));
SELECT pg_temp.expect('wrong date width', NULL::bigint, util.document_sequence_number('JE-26-10-000123', 'JE-%{yyyy}-%{mm}-', NULL, 6));
SELECT pg_temp.expect('regex characters in prefix and suffix', 42::bigint, util.document_sequence_number('Q.(0042)-26', 'Q.(', ')-%{yy}', 4));
SELECT pg_temp.expect('regex character is literal', NULL::bigint, util.document_sequence_number('QX(0042)-26', 'Q.(', ')-%{yy}', 4));
SELECT pg_temp.expect('too long for bigint', NULL::bigint, util.document_sequence_number('SO99999999999999999999', 'SO', NULL, 6));

-- Saving a sales order moves its company's counter.
CREATE TEMP TABLE picked AS
SELECT "id", "companyId" FROM "salesOrder" ORDER BY "createdAt" LIMIT 1;

UPDATE "sequence" SET "prefix" = 'SO', "suffix" = NULL, "size" = 6, "next" = 10
WHERE "table" = 'salesOrder' AND "companyId" = (SELECT "companyId" FROM picked);

CREATE FUNCTION pg_temp.next_of(sequence_table text) RETURNS integer LANGUAGE sql AS $fn$
  SELECT "next" FROM "sequence"
  WHERE "table" = sequence_table AND "companyId" = (SELECT "companyId" FROM picked)
$fn$;

UPDATE "salesOrder" SET "salesOrderId" = 'SO000500' WHERE "id" = (SELECT "id" FROM picked);
SELECT pg_temp.expect('a higher number moves the counter', 500, pg_temp.next_of('salesOrder'));

UPDATE "salesOrder" SET "salesOrderId" = 'ACME-77' WHERE "id" = (SELECT "id" FROM picked);
SELECT pg_temp.expect('a custom id leaves it', 500, pg_temp.next_of('salesOrder'));

UPDATE "salesOrder" SET "salesOrderId" = 'SO000300' WHERE "id" = (SELECT "id" FROM picked);
SELECT pg_temp.expect('a lower number leaves it', 500, pg_temp.next_of('salesOrder'));

SELECT pg_temp.expect(
  'the next number issued is past it',
  'SO000501',
  get_next_sequence('salesOrder', (SELECT "companyId" FROM picked))
);

-- A counter past its size is issued in full, not truncated to the size.
UPDATE "sequence" SET "next" = 999999
WHERE "table" = 'salesOrder' AND "companyId" = (SELECT "companyId" FROM picked);
SELECT pg_temp.expect(
  'a number longer than the size is not truncated',
  'SO1000000',
  get_next_sequence('salesOrder', (SELECT "companyId" FROM picked))
);
UPDATE "sequence" SET "next" = 501
WHERE "table" = 'salesOrder' AND "companyId" = (SELECT "companyId" FROM picked);

-- Beside a week, with no month or day, the year is the week's: Friday
-- 1 January 2027 is in ISO week 53 of 2026, and in US week 1 of 2027. Beside a
-- month the year stays the calendar year.
SELECT pg_temp.expect('ISO week and its year at a new year', '2653', interpolate_sequence_date('%{yy}%{ww}', '2027-01-01 13:05:09', 'iso'));
SELECT pg_temp.expect('US week and its year at a new year', '2701', interpolate_sequence_date('%{yy}%{ww}', '2027-01-01 13:05:09', 'us'));
SELECT pg_temp.expect('a month keeps the calendar year', '2027-01-W53', interpolate_sequence_date('%{yyyy}-%{mm}-W%{ww}', '2027-01-01 13:05:09', 'iso'));
SELECT pg_temp.expect('the whole format decides the year', '26-', interpolate_sequence_date('%{yy}-', '2027-01-01 13:05:09', 'iso', '%{yy}-W%{ww}'));
SELECT pg_temp.expect('serial segment keeps its location', 'HQ-2653-', interpolate_serial_segment('%{location}-%{yy}%{ww}-', '2027-01-03 23:59:59', 'HQ'));
SELECT pg_temp.expect('serial segment counts US weeks', 'HQ-2702-', interpolate_serial_segment('%{location}-%{yy}%{ww}-', '2027-01-03 23:59:59', 'HQ', 'us'));

-- A document number takes the company's week numbering in its timezone.
UPDATE "sequence" SET "prefix" = 'WK%{yy}%{ww}-', "suffix" = '/%{yyyy}', "size" = 4, "next" = 501
WHERE "table" = 'salesOrder' AND "companyId" = (SELECT "companyId" FROM picked);
SELECT pg_temp.expect(
  'a document number in ISO 8601 weeks',
  (SELECT 'WK' || to_char(v, 'IY') || to_char(v, 'IW') || '-0502/' || to_char(v, 'IYYY')
   FROM (SELECT now() AT TIME ZONE COALESCE(
     (SELECT "timezone" FROM "company" WHERE "id" = (SELECT "companyId" FROM picked)), 'UTC') AS v) t),
  get_next_sequence('salesOrder', (SELECT "companyId" FROM picked))
);
UPDATE "companySettings" SET "sequenceWeekNumbering" = 'us'
WHERE "id" = (SELECT "companyId" FROM picked);
SELECT pg_temp.expect(
  'a document number in US weeks',
  (SELECT interpolate_sequence_date('WK%{yy}%{ww}-', v, 'us', 'WK%{yy}%{ww}-/%{yyyy}')
     || '0503' || interpolate_sequence_date('/%{yyyy}', v, 'us', 'WK%{yy}%{ww}-/%{yyyy}')
   FROM (SELECT now() AT TIME ZONE COALESCE(
     (SELECT "timezone" FROM "company" WHERE "id" = (SELECT "companyId" FROM picked)), 'UTC') AS v) t),
  get_next_sequence('salesOrder', (SELECT "companyId" FROM picked))
);
UPDATE "companySettings" SET "sequenceWeekNumbering" = 'iso'
WHERE "id" = (SELECT "companyId" FROM picked);
UPDATE "sequence" SET "prefix" = 'SO', "suffix" = NULL, "size" = 6, "next" = 501
WHERE "table" = 'salesOrder' AND "companyId" = (SELECT "companyId" FROM picked);

-- A memo's direction picks its sequence.
UPDATE "sequence" SET "prefix" = 'CM', "suffix" = NULL, "size" = 6, "next" = 1
WHERE "table" = 'creditMemo' AND "companyId" = (SELECT "companyId" FROM picked);
UPDATE "sequence" SET "prefix" = 'DM', "suffix" = NULL, "size" = 6, "next" = 1
WHERE "table" = 'debitMemo' AND "companyId" = (SELECT "companyId" FROM picked);

SELECT sync_advance_document_sequence('memo', 'INSERT',
  jsonb_build_object('companyId', (SELECT "companyId" FROM picked), 'memoId', 'DM000040', 'direction', 'Debit'), NULL);
SELECT sync_advance_document_sequence('memo', 'INSERT',
  jsonb_build_object('companyId', (SELECT "companyId" FROM picked), 'memoId', 'CM000020', 'direction', 'Credit'), NULL);
SELECT pg_temp.expect('a debit memo moves debitMemo', 40, pg_temp.next_of('debitMemo'));
SELECT pg_temp.expect('a credit memo moves creditMemo', 20, pg_temp.next_of('creditMemo'));

-- A journal's counter is journalEntry, not journal.
UPDATE "sequence" SET "prefix" = 'JE-%{yyyy}-%{mm}-', "suffix" = NULL, "size" = 6, "next" = 1
WHERE "table" = 'journalEntry' AND "companyId" = (SELECT "companyId" FROM picked);
SELECT sync_advance_document_sequence('journal', 'INSERT',
  jsonb_build_object('companyId', (SELECT "companyId" FROM picked), 'journalEntryId', 'JE-2026-10-000077'), NULL);
SELECT pg_temp.expect('a journal moves journalEntry', 77, pg_temp.next_of('journalEntry'));

-- A delete never moves a counter.
SELECT sync_advance_document_sequence('salesOrder', 'DELETE', NULL,
  jsonb_build_object('companyId', (SELECT "companyId" FROM picked), 'salesOrderId', 'SO009999'));
SELECT pg_temp.expect('a delete leaves it', 501, pg_temp.next_of('salesOrder'));

\echo 'document-sequence: all checks passed'
ROLLBACK;
