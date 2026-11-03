-- Time a lookup by a foreign-key column before and after an index on it,
-- multi-tenant, as the test user. Everything is rolled back.
--   psql "$DB_URL" -v tbl=supplierPart -v col=supplierId -v copies=3000 -f fk-index-bench.sql
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL session_replication_role = replica;
SELECT "companyId" AS own, :"col" AS val FROM :"tbl" WHERE :"col" IS NOT NULL LIMIT 1 \gset
SELECT id AS emp FROM "user" WHERE email = 'test@carbon.ms' \gset
SELECT set_config('b.own', :'own', true), set_config('b.tbl', :'tbl', true), set_config('b.col', :'col', true), set_config('b.copies', :'copies', true) \gset
CREATE FUNCTION pg_temp.cols(t text) RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(quote_ident(column_name), ',' ORDER BY ordinal_position) FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = t AND is_generated = 'NEVER' AND generation_expression IS NULL $$;
-- Copies keep the user's company for 1 in 10, and point the foreign key at a new value,
-- so the lookup stays selective, as it is in production.
DO $$
DECLARE t text := current_setting('b.tbl'); c text := current_setting('b.col'); n int := current_setting('b.copies')::int;
BEGIN
  EXECUTE format('INSERT INTO %1$I (%2$s) SELECT %2$s FROM (SELECT (jsonb_populate_record(NULL::%1$I, to_jsonb(x) || jsonb_build_object(''id'', ''b'' || g || ''_'' || (to_jsonb(x)->>''id''), %3$L, ''b'' || g || ''_'' || (to_jsonb(x)->>%3$L), ''companyId'', CASE WHEN g %% 10 = 0 THEN %4$L ELSE ''bench-'' || (g %% 96) END))).* FROM %1$I x, generate_series(1, %5$s) g WHERE to_jsonb(x)->>%3$L IS NOT NULL) r',
    t, pg_temp.cols(t), c, current_setting('b.own'), n);
END $$;
ANALYZE :"tbl";
SELECT count(*) AS rows FROM :"tbl";
CREATE FUNCTION public.bench_ms(q text) RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE p json; best numeric := 1e9; BEGIN
  FOR i IN 1..3 LOOP EXECUTE 'EXPLAIN (ANALYZE, FORMAT JSON) ' || q INTO p; best := least(best, (p->0->>'Execution Time')::numeric); END LOOP;
  RETURN round(best, 2); END $$;
GRANT EXECUTE ON FUNCTION public.bench_ms(text) TO authenticated;
SELECT format('SELECT * FROM %I WHERE %I = %L AND "companyId" = %L', :'tbl', :'col', :'val', :'own') AS q \gset
SELECT set_config('request.jwt.claims', jsonb_build_object('sub', :'emp', 'role', 'authenticated')::text, true) \gset
SET LOCAL ROLE authenticated;
SELECT 'without index' AS run, public.bench_ms(:'q') AS ms;
RESET ROLE;
SELECT format('CREATE INDEX bench_fk_idx ON %I (%I)', :'tbl', :'col') AS ddl \gset
:ddl;
ANALYZE :"tbl";
SET LOCAL ROLE authenticated;
SELECT 'with index' AS run, public.bench_ms(:'q') AS ms;
ROLLBACK;
