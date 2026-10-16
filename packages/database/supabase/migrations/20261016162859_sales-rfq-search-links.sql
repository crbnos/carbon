-- Search indexed sales RFQs at /x/rfq/<id>, a route that does not exist: the
-- page is /x/sales-rfq/<id>. The search handler now writes the right link
-- (search-config.ts); this rewrites the links already in every company's index.
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public' AND tablename LIKE 'searchIndex\_%' ESCAPE '\'
  LOOP
    EXECUTE format(
      'UPDATE %I SET "link" = %L || "entityId" WHERE "entityType" = %L AND "link" LIKE %L',
      t.tablename, '/x/sales-rfq/', 'salesRfq', '/x/rfq/%'
    );
  END LOOP;
END $$;
