-- One behaviour check per rule piece in packages/database/src/authz/rules.ts, on a real table
-- that uses it: who is let in, who is kept out. The converter proved rewritten policies mean
-- the same as the ones they replaced; this proves what that meaning is.
-- Run from the repository root against an existing local database:
-- pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/authz-pieces.test.sql
-- All fixtures and role changes are confined to the rolled-back transaction.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL "app.sync_in_progress" = 'true';
SET LOCAL statement_timeout = '30s';

-- The live policy (USING, or WITH CHECK — which an UPDATE without one takes from USING) of
-- one command, evaluated against a synthetic row as the current role.
CREATE FUNCTION pg_temp.allows(tbl text, command text, clause text, rec jsonb)
RETURNS boolean LANGUAGE plpgsql AS $fn$
DECLARE expr text; ok boolean;
BEGIN
  SELECT CASE clause WHEN 'check' THEN coalesce(with_check, qual) ELSE qual END INTO expr
  FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl AND cmd = command;
  IF expr IS NULL THEN RETURN false; END IF;
  EXECUTE format('SELECT (%s) FROM jsonb_populate_record(NULL::public.%I, $1) AS %I', expr, tbl, tbl)
    INTO ok USING rec;
  RETURN coalesce(ok, false);
END;
$fn$;

CREATE FUNCTION pg_temp.act_as(user_id text) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.path', '/test', true);
  SET LOCAL ROLE authenticated;
END;
$fn$;

DO $proof$
DECLARE
  group_a text; group_b text; company_a text; company_b text;
  u text := gen_random_uuid()::text;  -- employee of A with permissions (some naming B)
  w text := gen_random_uuid()::text;  -- employee of A, no permissions
  v text := gen_random_uuid()::text;  -- employee of B only
  c text := gen_random_uuid()::text;  -- customer-portal user of A, bound to customer_a
  customer_a text; customer_other text; customer_b text;
  a jsonb; b jsonb;
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy") VALUES ('Pieces A ' || id(), 'system') RETURNING id INTO group_a;
  INSERT INTO "companyGroup" (name, "createdBy") VALUES ('Pieces B ' || id(), 'system') RETURNING id INTO group_b;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Pieces A', group_a, 'USD', 'America/New_York') RETURNING id INTO company_a;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Pieces B', group_b, 'USD', 'America/New_York') RETURNING id INTO company_b;

  INSERT INTO "user" (id, email) VALUES
    (u, u || '@authz.invalid'), (w, w || '@authz.invalid'),
    (v, v || '@authz.invalid'), (c, c || '@authz.invalid');
  INSERT INTO "userToCompany" ("userId", "companyId", role) VALUES
    (u, company_a, 'employee'), (w, company_a, 'employee'),
    (v, company_b, 'employee'), (c, company_a, 'customer');
  INSERT INTO "userPermission" (id, permissions) VALUES
    (u, jsonb_build_object(
      'accounting_update', jsonb_build_array(company_a, company_b),  -- B: not a member there
      'parts_view', jsonb_build_array(company_a),
      'sales_update', jsonb_build_array(company_a)
    )),
    (w, '{}'::jsonb), (v, '{}'::jsonb), (c, '{}'::jsonb);

  INSERT INTO customer (name, "readableId", "companyId", "createdBy") VALUES ('Pieces customer', 'customer_a', company_a, 'system')
    RETURNING id INTO customer_a;
  INSERT INTO customer (name, "readableId", "companyId", "createdBy") VALUES ('Pieces other', 'customer_other', company_a, 'system')
    RETURNING id INTO customer_other;
  INSERT INTO customer (name, "readableId", "companyId", "createdBy") VALUES ('Pieces customer B', 'customer_b', company_b, 'system')
    RETURNING id INTO customer_b;
  INSERT INTO "customerAccount" (id, "customerId", "companyId", active) VALUES (c, customer_a, company_a, true);

  a := jsonb_build_object('companyId', company_a, 'companyGroupId', group_a);
  b := jsonb_build_object('companyId', company_b, 'companyGroupId', group_b);

  -- inCompany(employee): any employee reads their own company's rows (costCenter)
  PERFORM pg_temp.act_as(u);
  ASSERT pg_temp.allows('costCenter', 'SELECT', 'using', a), 'employee reads own company';
  ASSERT NOT pg_temp.allows('costCenter', 'SELECT', 'using', b), 'employee does not read another company';
  PERFORM pg_temp.act_as(c);
  ASSERT NOT pg_temp.allows('costCenter', 'SELECT', 'using', a), 'a customer-portal user is not an employee';
  RAISE NOTICE 'PASS inCompany(employee)';

  -- inCompany(permission): the permission, in a company the caller belongs to (costCenter)
  PERFORM pg_temp.act_as(u);
  ASSERT pg_temp.allows('costCenter', 'UPDATE', 'using', a), 'permission holder updates';
  ASSERT pg_temp.allows('costCenter', 'UPDATE', 'check', a), 'the updated row may stay in the company';
  ASSERT NOT pg_temp.allows('costCenter', 'UPDATE', 'check', b), 'a permission naming a company the user is not in grants nothing';
  PERFORM pg_temp.act_as(w);
  ASSERT NOT pg_temp.allows('costCenter', 'UPDATE', 'using', a), 'an employee without the permission cannot update';
  RAISE NOTICE 'PASS inCompany(permission)';

  -- anyOf: any one of the permissions (costLedger: accounting_view or parts_view)
  PERFORM pg_temp.act_as(u);
  ASSERT pg_temp.allows('costLedger', 'SELECT', 'using', a), 'one of the permissions is enough';
  PERFORM pg_temp.act_as(w);
  ASSERT NOT pg_temp.allows('costLedger', 'SELECT', 'using', a), 'none of the permissions is not';
  RAISE NOTICE 'PASS anyOf';

  -- inGroup: group-shared rows by the caller's company group (currency)
  PERFORM pg_temp.act_as(u);
  ASSERT pg_temp.allows('currency', 'SELECT', 'using', a), 'employee reads own group';
  ASSERT NOT pg_temp.allows('currency', 'SELECT', 'using', b), 'employee does not read another group';
  RAISE NOTICE 'PASS inGroup';

  -- through + member: a row reached through a link table (companyGroup via company, member)
  ASSERT pg_temp.allows('companyGroup', 'SELECT', 'using', jsonb_build_object('id', group_a)), 'member reads own group';
  ASSERT NOT pg_temp.allows('companyGroup', 'SELECT', 'using', jsonb_build_object('id', group_b)), 'not another group';
  RAISE NOTICE 'PASS through / member';

  -- viaParent: the parent row's company decides (customerContact → customer)
  ASSERT pg_temp.allows('customerContact', 'UPDATE', 'using', jsonb_build_object('customerId', customer_a)),
    'permission holder updates a child of their company''s parent';
  ASSERT NOT pg_temp.allows('customerContact', 'UPDATE', 'using', jsonb_build_object('customerId', customer_b)),
    'not a child of another company''s parent';
  PERFORM pg_temp.act_as(w);
  ASSERT NOT pg_temp.allows('customerContact', 'UPDATE', 'using', jsonb_build_object('customerId', customer_a)),
    'an employee without the permission cannot';
  RAISE NOTICE 'PASS viaParent';

  -- portal.customer: a portal user sees their own customer only (customer, customerContact)
  PERFORM pg_temp.act_as(c);
  ASSERT pg_temp.allows('customer', 'SELECT', 'using', jsonb_build_object('id', customer_a, 'companyId', company_a)),
    'portal user reads their customer';
  ASSERT NOT pg_temp.allows('customer', 'SELECT', 'using', jsonb_build_object('id', customer_other, 'companyId', company_a)),
    'not another customer of the same company';
  ASSERT pg_temp.allows('customerContact', 'UPDATE', 'using', jsonb_build_object('customerId', customer_a)),
    'portal user updates their customer''s contacts';
  RAISE NOTICE 'PASS portal.customer';

  -- owner: the author only (note)
  PERFORM pg_temp.act_as(u);
  ASSERT pg_temp.allows('note', 'UPDATE', 'using', jsonb_build_object('createdBy', u, 'companyId', company_a)), 'author edits';
  PERFORM pg_temp.act_as(w);
  ASSERT NOT pg_temp.allows('note', 'UPDATE', 'using', jsonb_build_object('createdBy', u, 'companyId', company_a)),
    'a colleague does not';
  RAISE NOTICE 'PASS owner';

  -- authenticated: any signed-in user reads reference data (country); anon does not
  ASSERT pg_temp.allows('country', 'SELECT', 'using', '{}'::jsonb), 'signed-in user reads';
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  ASSERT NOT pg_temp.allows('country', 'SELECT', 'using', '{}'::jsonb), 'anon does not';
  RAISE NOTICE 'PASS authenticated';

  -- serviceOnly: no policy, so nobody through the API (approvalRequest)
  PERFORM pg_temp.act_as(u);
  ASSERT NOT pg_temp.allows('approvalRequest', 'SELECT', 'using', a), 'no API access';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public."approvalRequest"'::regclass),
    'RLS is on, so no policy means no rows';
  RAISE NOTICE 'PASS serviceOnly';
  RESET ROLE;
END
$proof$;

ROLLBACK;
