-- Run from the repository root against an existing local database:
-- pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/journal-update-tenant-check.test.sql
-- All fixtures and role changes are confined to the rolled-back transaction.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL "app.sync_in_progress" = 'true';
SET LOCAL statement_timeout = '30s';

DO $proof$
DECLARE
  group_a text; group_b text; company_a text; company_b text;
  user_id text := gen_random_uuid()::text;
  cash_id text; sales_id text; draft_id text; posted_id text; moved int;
BEGIN
  INSERT INTO "companyGroup" (name,"createdBy") VALUES ('Journal tenant A '||id(),'system') RETURNING id INTO group_a;
  INSERT INTO "companyGroup" (name,"createdBy") VALUES ('Journal tenant B '||id(),'system') RETURNING id INTO group_b;
  INSERT INTO company (name,"companyGroupId","baseCurrencyCode",timezone)
    VALUES ('Journal tenant A',group_a,'USD','America/New_York') RETURNING id INTO company_a;
  INSERT INTO company (name,"companyGroupId","baseCurrencyCode",timezone)
    VALUES ('Journal tenant B',group_b,'USD','America/New_York') RETURNING id INTO company_b;
  INSERT INTO account (name,class,"incomeBalance","isGroup","companyGroupId","createdBy")
    VALUES ('Cash','Asset','Balance Sheet',false,group_a,'system') RETURNING id INTO cash_id;
  INSERT INTO account (name,class,"incomeBalance","isGroup","companyGroupId","createdBy")
    VALUES ('Sales','Revenue','Income Statement',false,group_a,'system') RETURNING id INTO sales_id;
  INSERT INTO "accountingPeriod" ("startDate","endDate",status,"companyId","createdBy","fiscalYear","periodNumber")
    VALUES ('2026-07-01','2026-07-31','Active',company_a,'system',2026,7);

  INSERT INTO "user" (id,email) VALUES (user_id, user_id||'@journal-tenant.invalid');
  -- Employee of both companies: may view B's journals but update only A's. Postgres
  -- checks an UPDATE's new row against the SELECT policy too, so a user who cannot
  -- see B was never able to move a journal there; this user can see B.
  INSERT INTO "userToCompany" ("userId","companyId",role)
    VALUES (user_id,company_a,'employee'),(user_id,company_b,'employee');
  INSERT INTO "userPermission" (id,permissions)
    VALUES (user_id,jsonb_build_object(
      'accounting_view',jsonb_build_array(company_a,company_b),
      'accounting_update',jsonb_build_array(company_a)));

  INSERT INTO journal ("journalEntryId","companyId","postingDate",status,"sourceType","createdBy")
    VALUES ('TENANT-DRAFT-'||id(),company_a,'2026-07-15','Draft','Manual','system') RETURNING id INTO draft_id;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;

  UPDATE journal SET description='edited' WHERE id=draft_id;
  GET DIAGNOSTICS moved = ROW_COUNT;
  ASSERT moved = 1, 'A Draft journal in the caller''s company stays editable';

  BEGIN
    UPDATE journal SET "companyId"=company_b WHERE id=draft_id;
    RAISE EXCEPTION 'A Draft journal was moved into another company';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- No WHERE: the statement reads no columns, so the SELECT policy is not applied
  -- to the new rows and only the UPDATE policy's WITH CHECK stands in the way.
  BEGIN
    UPDATE journal SET "companyId"=company_b;
    RAISE EXCEPTION 'Journals were moved into another company by an unfiltered update';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'PASS a Draft journal cannot be moved into another company';
  RESET ROLE;

  -- Posted only now: the unfiltered update above must meet Draft rows alone, since the
  -- immutability trigger fires before the policy check.
  INSERT INTO journal ("journalEntryId","companyId","postingDate",status,"sourceType","createdBy")
    VALUES ('TENANT-POSTED-'||id(),company_a,'2026-07-15','Draft','Manual','system') RETURNING id INTO posted_id;
  INSERT INTO "journalLine" ("journalId","accountId",amount,"journalLineReference","companyId")
    VALUES (posted_id,cash_id,10,id(),company_a),(posted_id,sales_id,10,id(),company_a);
  UPDATE journal SET status='Posted' WHERE id=posted_id AND "companyId"=company_a;
  SET LOCAL ROLE authenticated;

  BEGIN
    UPDATE journal SET status='Reversed', "companyId"=company_b WHERE id=posted_id;
    RAISE EXCEPTION 'A reversed journal was moved into another company';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  UPDATE journal SET status='Reversed' WHERE id=posted_id;
  GET DIAGNOSTICS moved = ROW_COUNT;
  ASSERT moved = 1, 'Posted -> Reversed still passes the policy';
  RAISE NOTICE 'PASS Posted -> Reversed works in-company and cannot cross companies';
  RESET ROLE;
END
$proof$;

ROLLBACK;
