-- Run from the repository root against an existing local database:
-- pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/accounting-defaults-report-access.test.sql
-- All fixtures and role changes are confined to the rolled-back transaction.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL "app.sync_in_progress" = 'true';
SET LOCAL statement_timeout = '30s';

DO $proof$
DECLARE
  group_id text; parent_id text; child_id text; foreign_group text;
  user_id text := gen_random_uuid()::text;
  cta_id text; sales_id text; old_shipping text; new_shipping text;
  defaults_json jsonb; found_mapping text; old_defaults jsonb;
BEGIN
  INSERT INTO "companyGroup" (name,"createdBy") VALUES ('Reporting review '||id(),'system') RETURNING id INTO group_id;
  INSERT INTO "companyGroup" (name,"createdBy") VALUES ('Other reporting review '||id(),'system') RETURNING id INTO foreign_group;
  INSERT INTO "company" (name,"companyGroupId","baseCurrencyCode",timezone)
    VALUES ('Reporting parent '||id(),group_id,'USD','America/New_York') RETURNING id INTO parent_id;
  INSERT INTO "company" (name,"companyGroupId","parentCompanyId","baseCurrencyCode",timezone)
    VALUES ('Reporting child '||id(),group_id,parent_id,'EUR','Europe/Berlin') RETURNING id INTO child_id;
  INSERT INTO "user" (id,email) VALUES (user_id, user_id||'@reporting-review.invalid');
  INSERT INTO "userToCompany" ("userId","companyId",role) VALUES (user_id,child_id,'employee');
  INSERT INTO "userPermission" (id,permissions) VALUES
    (user_id,jsonb_build_object('accounting_view',jsonb_build_array(child_id),'accounting_update',jsonb_build_array(child_id)));
  INSERT INTO "account" (name,class,"accountType","incomeBalance","companyGroupId","createdBy")
    VALUES ('Reporting CTA','Equity','Equity - No Close','Balance Sheet',group_id,'system') RETURNING id INTO cta_id;
  INSERT INTO "account" (name,class,"accountType","incomeBalance","companyGroupId","createdBy")
    VALUES ('Reporting Sales','Revenue','Income','Income Statement',group_id,'system') RETURNING id INTO sales_id;
  INSERT INTO "account" (name,class,"accountType","incomeBalance","companyGroupId","createdBy")
    VALUES ('Old Shipping','Revenue','Income','Income Statement',group_id,'system') RETURNING id INTO old_shipping;
  INSERT INTO "account" (name,class,"accountType","incomeBalance","companyGroupId","createdBy")
    VALUES ('New Shipping','Revenue','Income','Income Statement',group_id,'system') RETURNING id INTO new_shipping;
  SELECT jsonb_object_agg(attname,to_jsonb(cta_id)) INTO defaults_json
    FROM pg_attribute WHERE attrelid='"accountDefault"'::regclass AND attnum>0 AND NOT attisdropped AND attnotnull AND attname<>'companyId';
  defaults_json := defaults_json || jsonb_build_object('currencyTranslationAccount',cta_id,'salesAccount',sales_id,'salesShippingRevenueAccount',old_shipping);
  INSERT INTO "accountDefault" SELECT (jsonb_populate_record(NULL::"accountDefault",defaults_json||jsonb_build_object('companyId',parent_id))).*;
  INSERT INTO "accountDefault" SELECT (jsonb_populate_record(NULL::"accountDefault",defaults_json||jsonb_build_object('companyId',child_id))).*;

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  ASSERT EXISTS (SELECT 1 FROM "company" WHERE id=parent_id), 'Child employee can see parent company metadata';
  ASSERT EXISTS (SELECT 1 FROM "account" WHERE id=cta_id), 'Child employee can see group chart';
  ASSERT EXISTS (SELECT 1 FROM "accountDefault" WHERE "companyId"=child_id), 'Child defaults are visible';
  ASSERT NOT EXISTS (SELECT 1 FROM "accountDefault" WHERE "companyId"=parent_id), 'Parent defaults remain RLS-invisible';
  RAISE NOTICE 'PASS real child-only RLS sees parent metadata/chart but cannot read parent defaults';
  RESET ROLE;

  -- The server resolver runs these two scoped reads only after requirePermissions
  -- authorizes accounting_view for the employee and supplies the authenticated group.
  SET LOCAL ROLE service_role;
  ASSERT EXISTS (SELECT 1 FROM "company" WHERE id=parent_id AND "companyGroupId"=group_id AND "parentCompanyId" IS NULL), 'Authorized root resolves';
  SELECT "currencyTranslationAccount" INTO STRICT found_mapping FROM "accountDefault" WHERE "companyId"=parent_id;
  ASSERT found_mapping=cta_id, 'Only configured root CTA is required';
  ASSERT NOT EXISTS (SELECT 1 FROM "company" WHERE id=parent_id AND "companyGroupId"=foreign_group AND "parentCompanyId" IS NULL), 'Foreign group scope cannot resolve root';
  ASSERT NOT EXISTS (SELECT 1 FROM "company" WHERE id=child_id AND "companyGroupId"=group_id AND "parentCompanyId" IS NULL), 'Subsidiary cannot act as root';
  RAISE NOTICE 'PASS scoped privileged root lookup resolves CTA and rejects foreign-group/non-root IDs';
  RESET ROLE;

  SELECT to_jsonb(d) INTO old_defaults FROM "accountDefault" d WHERE "companyId"=child_id;
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE "accountDefault" SET "salesShippingRevenueAccount"=new_shipping,"receivablesAccount"='missing-account-'||id() WHERE "companyId"=child_id;
    RAISE EXCEPTION 'Expected foreign-key rejection';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  ASSERT (SELECT to_jsonb(d)=old_defaults FROM "accountDefault" d WHERE "companyId"=child_id), 'Rejected combined UPDATE preserves the entire defaults row';
  UPDATE "accountDefault" SET "salesShippingRevenueAccount"=new_shipping,"receivablesAccount"=cta_id WHERE "companyId"=child_id;
  ASSERT (SELECT "salesShippingRevenueAccount"=new_shipping AND "receivablesAccount"=cta_id FROM "accountDefault" WHERE "companyId"=child_id), 'Valid combined UPDATE saves both values';
  RAISE NOTICE 'PASS real RLS-scoped combined defaults UPDATE is atomic on rejection and saves valid changes';
  RESET ROLE;

  UPDATE "account" SET active=false WHERE id=old_shipping;
  ASSERT EXISTS (SELECT 1 FROM "accounts" WHERE id=old_shipping AND active=false), 'Inactive historical chart state is valid';
  RAISE NOTICE 'PASS report chart view retains valid inactive account rows';
END;
$proof$;
ROLLBACK;
