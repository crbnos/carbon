-- An event's recordId, and the pairing of an UPDATE's old and new rows, for
-- EVERY table that queues events, on INSERT, UPDATE and DELETE.
--
--   primary key has "id"        -> recordId is the id          ((id, companyId) tables)
--   primary key without "id"    -> every key column joined by ':'
--   no primary key              -> the one column it always sent (the audit log
--                                  files itemPlanning under its itemId)
--
-- Each table is exercised through a temp table of the same name, which shadows
-- it: same columns, defaults, primary key and unique indexes, but no foreign
-- keys, so no fixtures are needed and no real row is touched. The real
-- dispatch_event_batch() runs on it and queues to the real pgmq queue.
--
-- Run from the repository root against an existing local database:
-- pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/event-record-id.test.sql
-- Everything is confined to the rolled-back transaction.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '120s';
SET LOCAL client_min_messages = warning;

DO $proof$
DECLARE
  company text;
  -- Evented tables with no primary key, and the column their recordId is.
  keyless constant jsonb := '{"itemCost":"itemId","itemPlanning":"itemId","itemUnitSalePrice":"itemId"}';
  row_count constant int := 4;
  tbl text;
  real oid;
  pk text[];
  key_cols text[];
  expected_cols text[];
  col record;
  cols text;
  vals text;
  value text;
  op text;
  events int;
  wrong int;
  distinct_ids int;
  tables_checked int := 0;
  composite_checked int := 0;
BEGIN
  SELECT "id" INTO company FROM "company" ORDER BY "id" LIMIT 1;
  ASSERT company IS NOT NULL, 'the local database has a company';

  CREATE TEMP TABLE queued_before ON COMMIT DROP AS
    SELECT msg_id FROM pgmq.q_event_system;

  FOR tbl, real IN
    SELECT c.relname::text, c.oid
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE t.tgname LIKE 'trg_event_async_ins_%'
      AND c.relnamespace = 'public'::regnamespace
    ORDER BY 1
  LOOP
    SELECT array_agg(a.attname::text ORDER BY a.attnum) INTO pk
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
    WHERE i.indrelid = real AND i.indisprimary;

    IF pk IS NULL THEN
      ASSERT keyless ? tbl,
        format('%s queues events but has no primary key: decide its recordId and add it to this test', tbl);
      expected_cols := ARRAY[keyless->>tbl];
    ELSIF 'id' = ANY (pk) THEN
      expected_cols := ARRAY['id'];
    ELSE
      expected_cols := pk;
    END IF;

    EXECUTE format(
      'CREATE TEMP TABLE %1$I (LIKE public.%1$I INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING IDENTITY INCLUDING INDEXES) ON COMMIT DROP',
      tbl);
    real := format('pg_temp.%I', tbl)::regclass;

    -- The columns that identify a row, read from the catalog here rather than
    -- from the function under test: the primary key, else the key columns of
    -- the smallest plain unique index, else the keyless table's one column.
    key_cols := pk;
    IF key_cols IS NULL THEN
      SELECT array_agg(a.attname::text ORDER BY a.attnum) INTO key_cols
      FROM pg_index i
      CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, pos)
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
      WHERE k.pos <= i.indnkeyatts
        AND i.indexrelid = (
          SELECT i2.indexrelid FROM pg_index i2
          WHERE i2.indrelid = real AND i2.indisunique AND i2.indisvalid
            AND i2.indpred IS NULL AND i2.indexprs IS NULL
          ORDER BY i2.indnkeyatts LIMIT 1);
    END IF;
    key_cols := COALESCE(key_cols, expected_cols);
    ASSERT public.get_primary_key_columns(tbl) = key_cols,
      format('%s: get_primary_key_columns returned %s, the row identity is %s',
             tbl, public.get_primary_key_columns(tbl), key_cols);

    -- Unique indexes other than the key would only reject the generated rows
    IF pk IS NOT NULL THEN
      FOR value IN
        SELECT CASE WHEN c.conname IS NULL
                 THEN format('DROP INDEX %s', i.indexrelid::regclass)
                 ELSE format('ALTER TABLE pg_temp.%I DROP CONSTRAINT %I', tbl, c.conname) END
        FROM pg_index i
        LEFT JOIN pg_constraint c ON c.conindid = i.indexrelid AND c.conrelid = i.indrelid
        WHERE i.indrelid = real AND NOT i.indisprimary
      LOOP
        EXECUTE value;
      END LOOP;
    END IF;

    EXECUTE format(
      'CREATE TRIGGER probe_ins AFTER INSERT ON pg_temp.%1$I REFERENCING NEW TABLE AS batched_new
         FOR EACH STATEMENT EXECUTE FUNCTION public.dispatch_event_batch();
       CREATE TRIGGER probe_upd AFTER UPDATE ON pg_temp.%1$I REFERENCING NEW TABLE AS batched_new OLD TABLE AS batched_old
         FOR EACH STATEMENT EXECUTE FUNCTION public.dispatch_event_batch();
       CREATE TRIGGER probe_del AFTER DELETE ON pg_temp.%1$I REFERENCING OLD TABLE AS batched_old
         FOR EACH STATEMENT EXECUTE FUNCTION public.dispatch_event_batch();',
      tbl);

    INSERT INTO "eventSystemSubscription"
      ("name", "companyId", "table", "operations", "handlerType", "config", "filter", "active")
    VALUES ('record-id-probe', company, tbl, ARRAY['INSERT', 'UPDATE', 'DELETE'],
            'WEBHOOK', '{"url":"http://record-id-probe.invalid"}', '{}', TRUE);

    -- Four rows in one statement. Across a composite key they are
    -- (k1,s) (k2,s) (k3,o3) (k1,o4): two share the first column and two share
    -- the rest, so pairing on any single column of the key multiplies events.
    cols := NULL; vals := NULL;
    FOR col IN
      SELECT a.attname::text AS name, t.typname::text AS typ, t.typtype::text AS typtype,
             t.typcategory::text AS cat, a.atttypid AS typid,
             a.attname = ANY (key_cols) AS is_key,
             array_position(key_cols, a.attname::text) AS key_pos,
             (a.attnotnull AND NOT a.atthasdef AND a.attidentity = '') AS required
      FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid
      WHERE a.attrelid = real AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
      ORDER BY a.attnum
    LOOP
      IF col.name = 'companyId' THEN
        value := quote_literal(company);
      ELSIF col.is_key AND col.cat = 'S' THEN
        IF (SELECT count(*) FROM unnest(key_cols) k WHERE k <> 'companyId') = 1 THEN
          value := $v$'k' || n$v$;
        ELSIF col.key_pos = (SELECT min(array_position(key_cols, k)) FROM unnest(key_cols) k WHERE k <> 'companyId') THEN
          value := $v$CASE n WHEN 4 THEN 'k1' ELSE 'k' || n END$v$;
        ELSE
          value := $v$CASE WHEN n <= 2 THEN 's' ELSE 'o' || n END$v$;
        END IF;
      ELSIF col.is_key AND col.cat = 'N' THEN
        value := 'n';
      ELSIF NOT col.required THEN
        CONTINUE;
      ELSIF col.cat = 'S' THEN value := $v$'p' || n$v$;
      ELSIF col.cat = 'N' THEN value := 'n';
      ELSIF col.cat = 'B' THEN value := 'false';
      ELSIF col.cat = 'D' THEN value := 'now()';
      ELSIF col.cat = 'A' THEN value := $v$'{}'$v$;
      ELSIF col.typ IN ('json', 'jsonb') THEN value := $v$'{}'$v$;
      ELSIF col.typ = 'uuid' THEN value := 'gen_random_uuid()';
      ELSIF col.typtype = 'e' THEN
        value := quote_literal((SELECT enumlabel FROM pg_enum WHERE enumtypid = col.typid ORDER BY enumsortorder LIMIT 1));
      ELSE
        RAISE EXCEPTION '%.%: no generated value for type %', tbl, col.name, col.typ;
      END IF;
      cols := concat_ws(', ', cols, quote_ident(col.name));
      vals := concat_ws(', ', vals, format('(%s)::%s', value, col.typid::regtype));
    END LOOP;

    EXECUTE format('INSERT INTO pg_temp.%I (%s) SELECT %s FROM generate_series(1, %s) n',
                   tbl, cols, vals, row_count);
    EXECUTE format('UPDATE pg_temp.%I SET "companyId" = "companyId"', tbl);
    EXECUTE format('DELETE FROM pg_temp.%I', tbl);

    FOREACH op IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
      SELECT count(*),
             count(DISTINCT e.record_id),
             count(*) FILTER (WHERE e.record_id IS DISTINCT FROM (
               SELECT string_agg(e.record->>k.col, ':' ORDER BY k.ord)
               FROM unnest(expected_cols) WITH ORDINALITY AS k(col, ord)))
        INTO events, distinct_ids, wrong
      FROM (
        SELECT message->'event'->>'recordId' AS record_id,
               CASE WHEN op = 'DELETE' THEN message->'event'->'old'
                    ELSE message->'event'->'new' END AS record
        FROM pgmq.q_event_system
        WHERE msg_id NOT IN (SELECT msg_id FROM queued_before)
          AND message->'event'->>'table' = tbl
          AND message->'handlerConfig'->>'url' = 'http://record-id-probe.invalid'
          AND message->'event'->>'operation' = op
      ) e;

      ASSERT events = row_count,
        format('%s %s: %s rows queued %s events', tbl, op, row_count, events);
      ASSERT wrong = 0,
        format('%s %s: %s of %s events carry a recordId that is not %s', tbl, op, wrong, events, expected_cols);
      -- A key names one row, so its recordIds are distinct. A keyless table's
      -- single column is shared (two itemPlanning rows of one item).
      ASSERT pk IS NULL OR distinct_ids = row_count,
        format('%s %s: %s events share %s recordIds', tbl, op, events, distinct_ids);
    END LOOP;

    tables_checked := tables_checked + 1;
    IF array_length(key_cols, 1) > 1 THEN composite_checked := composite_checked + 1; END IF;
  END LOOP;

  ASSERT tables_checked > 50, format('only %s evented tables found', tables_checked);
  SET LOCAL client_min_messages = notice;
  RAISE NOTICE 'ok: % evented tables x INSERT/UPDATE/DELETE, % with a multi-column key',
    tables_checked, composite_checked;
END;
$proof$;

ROLLBACK;
