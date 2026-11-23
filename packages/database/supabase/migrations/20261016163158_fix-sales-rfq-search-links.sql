-- Sales RFQ search results linked to /x/rfq/<id>, a route that does not
-- exist (the RFQ page is /x/sales-rfq/<id>), so every RFQ opened from search
-- 404'd. The sync job now writes the right link; repair the stored rows.
DO $$
DECLARE
  company_record RECORD;
  v_table_name TEXT;
BEGIN
  FOR company_record IN SELECT "companyId" FROM "searchIndexRegistry"
  LOOP
    v_table_name := 'searchIndex_' || company_record."companyId";
    IF to_regclass(format('%I', v_table_name)) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format(
      'UPDATE %I SET "link" = ''/x/sales-rfq/'' || "entityId"
       WHERE "entityType" = ''salesRfq'' AND "link" IS DISTINCT FROM ''/x/sales-rfq/'' || "entityId"',
      v_table_name
    );
  END LOOP;
END $$;
