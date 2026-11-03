-- Benchmark one view against another, multi-tenant, with RLS. Everything is
-- rolled back.
--
-- The copy step copies the existing purchase invoices, lines and settlements
-- over many companies. Copy number g goes to the test user's company when
-- g % own_every = 0, else to one of `companies` other companies.
--
-- Variables:
--   user_email    the test user; it must see the company of the first invoice
--   newview       a file that creates the view under test (/dev/null for none)
--   newview_name  the view the file creates, or an existing view
--   oldview       the view to compare against
--   shapes        a file that inserts rows (n, shape, sql) into bench_shapes;
--                 each sql has %s for the view and %L for the company id
--   copies, companies, own_every   the copy step (see above)
--
--   psql "$DB_URL" -v user_email=test@carbon.ms -v newview=new_view.sql \
--     -v newview_name=purchaseInvoices_new -v oldview=purchaseInvoices \
--     -v shapes=.ai/runs/perf-shapes/purchase-invoices.sql \
--     -v copies=6000 -v companies=96 -v own_every=10 -f .ai/runs/2026-11-03-perf-bench.sql

\set ON_ERROR_STOP on
BEGIN;
-- Copies skip triggers and foreign keys; they are thrown away at the end.
SET LOCAL session_replication_role = replica;

SELECT id AS bench_user FROM "user" WHERE email = :'user_email' \gset
SELECT "companyId" AS own_company FROM "purchaseInvoice" LIMIT 1 \gset

CREATE FUNCTION pg_temp.cols(t text) RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(quote_ident(column_name), ',' ORDER BY ordinal_position)
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = t
    AND is_generated = 'NEVER' AND generation_expression IS NULL
$$;

CREATE FUNCTION pg_temp.company(g int, own text, n int) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN g % current_setting('bench.own_every')::int = 0 THEN own
    ELSE 'bench-' || (g % n) END
$$;

SELECT set_config('bench.copies', :'copies', true),
  set_config('bench.companies', :'companies', true),
  set_config('bench.own', :'own_company', true),
  set_config('bench.own_every', :'own_every', true) \gset

DO $$
DECLARE
  c text;
  copies int := current_setting('bench.copies')::int;
  n int := current_setting('bench.companies')::int;
  own text := current_setting('bench.own');
BEGIN
  c := pg_temp.cols('purchaseInvoice');
  EXECUTE format($q$
    INSERT INTO "purchaseInvoice" (%1$s)
    SELECT %1$s FROM (
      SELECT (jsonb_populate_record(NULL::"purchaseInvoice", to_jsonb(pi) || jsonb_build_object(
        'id', 'bench' || g || '_' || pi.id,
        'invoiceId', 'BENCH' || g || '-' || pi."invoiceId",
        'companyId', pg_temp.company(g, %2$L, %3$s),
        'dateDue', (CURRENT_DATE - ((g %% 60) - 30))::text,
        'dateIssued', (CURRENT_DATE - (g %% 365))::text
      ))).*
      FROM "purchaseInvoice" pi, generate_series(1, %4$s) g
    ) r$q$, c, own, n, copies);

  c := pg_temp.cols('purchaseInvoiceLine');
  EXECUTE format($q$
    INSERT INTO "purchaseInvoiceLine" (%1$s)
    SELECT %1$s FROM (
      SELECT (jsonb_populate_record(NULL::"purchaseInvoiceLine", to_jsonb(l) || jsonb_build_object(
        'id', 'bench' || g || '_' || k || '_' || l.id,
        'invoiceId', 'bench' || g || '_' || l."invoiceId",
        'companyId', pg_temp.company(g, %2$L, %3$s)
      ))).*
      FROM "purchaseInvoiceLine" l, generate_series(1, %4$s) g, generate_series(1, 4) k
    ) r$q$, c, own, n, copies);

  c := pg_temp.cols('invoiceSettlement');
  EXECUTE format($q$
    INSERT INTO "invoiceSettlement" (%1$s)
    SELECT %1$s FROM (
      SELECT (jsonb_populate_record(NULL::"invoiceSettlement", to_jsonb(s) || jsonb_build_object(
        'id', 'bench' || g || '_' || s.id,
        'targetPurchaseInvoiceId', 'bench' || g || '_' || s."targetPurchaseInvoiceId",
        'companyId', pg_temp.company(g, %2$L, %3$s)
      ))).*
      FROM "invoiceSettlement" s, generate_series(1, %4$s) g
      WHERE s."targetPurchaseInvoiceId" IS NOT NULL
    ) r$q$, c, own, n, copies);
END $$;

ANALYZE "purchaseInvoice";
ANALYZE "purchaseInvoiceLine";
ANALYZE "invoiceSettlement";

\i :newview
GRANT SELECT ON :"newview_name" TO authenticated;

SELECT count(*) FILTER (WHERE "companyId" = :'own_company') AS own_invoices,
  count(*) AS all_invoices,
  count(DISTINCT "companyId") AS companies
FROM "purchaseInvoice";

-- Best of 3 runs, in milliseconds.
CREATE FUNCTION public.bench_ms(q text) RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE p json; best numeric := 1e9;
BEGIN
  FOR i IN 1..3 LOOP
    EXECUTE 'EXPLAIN (ANALYZE, FORMAT JSON) ' || q INTO p;
    best := least(best, (p->0->>'Execution Time')::numeric);
  END LOOP;
  RETURN round(best, 1);
END $$;
GRANT EXECUTE ON FUNCTION public.bench_ms(text) TO authenticated;

CREATE TEMP TABLE bench_shapes(n int, shape text, sql text);
GRANT SELECT ON bench_shapes TO authenticated;
\i :shapes

-- Run as the user, so RLS applies.
SELECT set_config('request.jwt.claims',
  jsonb_build_object('sub', :'bench_user', 'role', 'authenticated')::text, true) \gset
SET LOCAL ROLE authenticated;

\echo 'Without a (companyId, invoiceId) index'
SELECT shape,
  public.bench_ms(format(sql, quote_ident(:'oldview'), :'own_company')) AS old_ms,
  public.bench_ms(format(sql, quote_ident(:'newview_name'), :'own_company')) AS new_ms
FROM bench_shapes ORDER BY n;

RESET ROLE;
CREATE INDEX bench_purchaseInvoice_company_invoice
  ON "purchaseInvoice" ("companyId", "invoiceId");
ANALYZE "purchaseInvoice";
SET LOCAL ROLE authenticated;

\echo 'With a (companyId, invoiceId) index'
SELECT shape,
  public.bench_ms(format(sql, quote_ident(:'oldview'), :'own_company')) AS old_ms,
  public.bench_ms(format(sql, quote_ident(:'newview_name'), :'own_company')) AS new_ms
FROM bench_shapes ORDER BY n;

ROLLBACK;
