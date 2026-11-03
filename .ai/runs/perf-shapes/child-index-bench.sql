-- Time a list view before and after an index on its grouped child table (or,
-- with -v child=none, on the parent table itself),
-- multi-tenant, as the test user. Everything is rolled back.
--   psql "$DB_URL" -v parent=nonConformance -v readable=nonConformanceId -v child=nonConformanceItem \
--     -v fk=nonConformanceId -v view=issues -v sort='"nonConformanceId" DESC' \
--     -v idx='("companyId", "nonConformanceId")' -v copies=3000 -v own_every=10 -f child-index-bench.sql
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL session_replication_role = replica;
SELECT "companyId" AS own FROM :"parent" LIMIT 1 \gset
SELECT id AS emp FROM "user" WHERE email = 'test@carbon.ms' \gset
SELECT set_config('b.own', :'own', true), set_config('b.every', :'own_every', true) \gset
CREATE FUNCTION pg_temp.cols(t text) RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(quote_ident(column_name), ',' ORDER BY ordinal_position) FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = t AND is_generated = 'NEVER' AND generation_expression IS NULL $$;
CREATE FUNCTION pg_temp.co(g int) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN g % current_setting('b.every')::int = 0 THEN current_setting('b.own') ELSE 'bench-' || (g % 96) END $$;
SELECT set_config('b.parent', :'parent', true), set_config('b.child', :'child', true), set_config('b.fk', :'fk', true),
  set_config('b.readable', :'readable', true), set_config('b.copies', :'copies', true) \gset
DO $$
DECLARE p text := current_setting('b.parent'); ch text := current_setting('b.child'); fk text := current_setting('b.fk');
  rd text := current_setting('b.readable'); n int := current_setting('b.copies')::int;
BEGIN
  EXECUTE format('INSERT INTO %1$I (%2$s) SELECT %2$s FROM (SELECT (jsonb_populate_record(NULL::%1$I, to_jsonb(x) || jsonb_build_object(''id'', ''b'' || g || ''_'' || (to_jsonb(x)->>''id''), %3$L, ''B'' || g || ''-'' || (to_jsonb(x)->>%3$L), ''companyId'', pg_temp.co(g)))).* FROM %1$I x, generate_series(1, %4$s) g) r',
    p, pg_temp.cols(p), rd, n);
  IF ch <> 'none' THEN
  EXECUTE format('INSERT INTO %1$I (%2$s) SELECT %2$s FROM (SELECT (jsonb_populate_record(NULL::%1$I, to_jsonb(x) || jsonb_build_object(''id'', ''b'' || g || ''_'' || (to_jsonb(x)->>''id''), %3$L, ''b'' || g || ''_'' || (to_jsonb(x)->>%3$L), ''companyId'', pg_temp.co(g)))).* FROM %1$I x, generate_series(1, %4$s) g) r',
    ch, pg_temp.cols(ch), fk, n);
  END IF;
END $$;
SELECT CASE WHEN :'child' = 'none' THEN :'parent' ELSE :'child' END AS target \gset
ANALYZE :"parent"; ANALYZE :"target";
SELECT count(*) FILTER (WHERE "companyId" = :'own') own_rows, count(*) all_rows FROM :"target";
CREATE FUNCTION public.bench_ms(q text) RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE p json; best numeric := 1e9; BEGIN
  FOR i IN 1..3 LOOP EXECUTE 'EXPLAIN (ANALYZE, FORMAT JSON) ' || q INTO p; best := least(best, (p->0->>'Execution Time')::numeric); END LOOP;
  RETURN round(best, 1); END $$;
GRANT EXECUTE ON FUNCTION public.bench_ms(text) TO authenticated;
SELECT format('SELECT * FROM %I WHERE "companyId" = %L ORDER BY %s LIMIT 50', :'view', :'own', :'sort') AS q \gset
SELECT set_config('request.jwt.claims', jsonb_build_object('sub', :'emp', 'role', 'authenticated')::text, true) \gset
SET LOCAL ROLE authenticated;
SELECT 'without index' AS run, public.bench_ms(:'q') AS ms;
RESET ROLE;
SELECT format('CREATE INDEX bench_child_idx ON %I %s', :'target', :'idx') AS ddl \gset
:ddl;
ANALYZE :"target";
SET LOCAL ROLE authenticated;
SELECT 'with index' AS run, public.bench_ms(:'q') AS ms;
ROLLBACK;
