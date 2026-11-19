-- Who can read and write one document's edits, as the real caller.
-- Run from the repository root against an existing local database:
-- pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/document-edit-authz.test.sql
-- All fixtures and role changes are confined to the rolled-back transaction.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL "app.sync_in_progress" = 'true';
SET LOCAL statement_timeout = '30s';

CREATE FUNCTION pg_temp.act_as(user_id text) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.path', '/test', true);
END;
$fn$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

DO $proof$
DECLARE
  grp text; company_a text; company_b text;
  sales text := gen_random_uuid()::text;      -- sales rights, no invoicing rights
  invoicing text := gen_random_uuid()::text;  -- invoicing rights, no sales rights
  plain text := gen_random_uuid()::text;      -- an employee with no rights
  other text := gen_random_uuid()::text;      -- an employee of company B
  n int;
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy") VALUES ('Edit authz ' || id(), 'system') RETURNING id INTO grp;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Edit A', grp, 'USD', 'America/New_York') RETURNING id INTO company_a;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Edit B', grp, 'USD', 'America/New_York') RETURNING id INTO company_b;
  INSERT INTO "user" (id, email) VALUES
    (sales, sales || '@authz.invalid'), (invoicing, invoicing || '@authz.invalid'),
    (plain, plain || '@authz.invalid'), (other, other || '@authz.invalid');
  INSERT INTO "userToCompany" ("userId", "companyId", role) VALUES
    (sales, company_a, 'employee'), (invoicing, company_a, 'employee'),
    (plain, company_a, 'employee'), (other, company_b, 'employee');
  INSERT INTO "userPermission" (id, permissions) VALUES
    (sales, jsonb_build_object('sales_view', jsonb_build_array(company_a), 'sales_update', jsonb_build_array(company_a))),
    (invoicing, jsonb_build_object('invoicing_view', jsonb_build_array(company_a), 'invoicing_update', jsonb_build_array(company_a))),
    (plain, '{}'::jsonb),
    (other, jsonb_build_object('sales_view', jsonb_build_array(company_b), 'invoicing_view', jsonb_build_array(company_b)));
  INSERT INTO "documentEdit" ("companyId", "documentType", "documentId", "createdBy") VALUES
    (company_a, 'salesInvoice', 'invoice', 'system'),
    (company_a, 'quote', 'quote', 'system'),
    (company_a, 'stockTransfer', 'transfer', 'system');

  EXECUTE 'SET LOCAL ROLE authenticated';

  PERFORM pg_temp.act_as(invoicing);
  SELECT count(*) INTO n FROM "documentEdit" WHERE "documentType" = 'salesInvoice';
  IF n <> 1 THEN RAISE EXCEPTION 'invoicing_view must read an invoice''s edit, read %', n; END IF;
  SELECT count(*) INTO n FROM "documentEdit" WHERE "documentType" = 'quote';
  IF n <> 0 THEN RAISE EXCEPTION 'invoicing_view must not read a quote''s edit, read %', n; END IF;

  PERFORM pg_temp.act_as(sales);
  SELECT count(*) INTO n FROM "documentEdit" WHERE "documentType" = 'salesInvoice';
  IF n <> 0 THEN RAISE EXCEPTION 'sales_view must not read an invoice''s edit, read %', n; END IF;

  PERFORM pg_temp.act_as(plain);
  SELECT count(*) INTO n FROM "documentEdit";
  IF n <> 1 THEN RAISE EXCEPTION 'a plain employee reads only what any employee can (a transfer), read %', n; END IF;

  PERFORM pg_temp.act_as(other);
  SELECT count(*) INTO n FROM "documentEdit";
  IF n <> 0 THEN RAISE EXCEPTION 'another company must read nothing, read %', n; END IF;

  -- Nobody writes through the API, whatever their rights.
  PERFORM pg_temp.act_as(sales);
  BEGIN
    INSERT INTO "documentEdit" ("companyId", "documentType", "documentId", settings, "createdBy")
      VALUES (company_a, 'quote', 'typed', '{"valueEdits":{"document":{"quote.total":"$1"}}}', sales);
    RAISE EXCEPTION 'an API insert must be refused';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE "documentEdit" SET settings = '{}' WHERE "documentType" = 'quote';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'an API update must touch nothing, touched %', n; END IF;
  DELETE FROM "documentEdit" WHERE "documentType" = 'quote';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'an API delete must touch nothing, touched %', n; END IF;

  EXECUTE 'RESET ROLE';

  -- A record's edit goes with it, on every record table the editor knows.
  SELECT count(*) INTO n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE t.tgname = 'delete_document_edit'
      AND c.relname IN ('purchaseOrder', 'purchaseReturnOrder', 'purchasingRfq', 'quote', 'salesOrder',
        'salesReturnOrder', 'salesInvoice', 'shipment', 'stockTransfer', 'job', 'nonConformance');
  IF n <> 11 THEN RAISE EXCEPTION 'expected the cleanup trigger on 11 record tables, found %', n; END IF;

  -- The trigger removes only that document's row, in that company. Fired on a
  -- stand-in table, because a real record needs every module's fixtures.
  INSERT INTO "documentEdit" ("companyId", "documentType", "documentId", "createdBy") VALUES
    (company_a, 'quote', 'gone', 'system'),
    (company_b, 'quote', 'gone', 'system'),
    (company_a, 'salesOrder', 'gone', 'system');
  CREATE TEMP TABLE record_stand_in (id text, "companyId" text) ON COMMIT DROP;
  CREATE TRIGGER delete_stand_in AFTER DELETE ON record_stand_in
    FOR EACH ROW EXECUTE FUNCTION public.delete_document_edit('quote');
  INSERT INTO record_stand_in VALUES ('gone', company_a);
  DELETE FROM record_stand_in;
  SELECT count(*) INTO n FROM "documentEdit" WHERE "documentId" = 'gone';
  IF n <> 2 THEN RAISE EXCEPTION 'deleting a record must remove its one edit, % left of 3', n; END IF;

  -- A template takes no API writes either.
  SELECT count(*) INTO n FROM pg_policies
    WHERE tablename IN ('documentEdit', 'documentTemplate') AND cmd <> 'SELECT';
  IF n <> 0 THEN RAISE EXCEPTION 'documents must take no API writes, found % write policies', n; END IF;
  RAISE NOTICE 'document-edit-authz: all checks passed';
END;
$proof$;

ROLLBACK;
