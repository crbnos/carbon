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

  -- projectModule: the project's type decides the module (projectElement, project,
  -- projectElementLabel via the element, timesheetEntry). A Standard project follows
  -- projects_* (any employee still reads it); a Service project follows service_*.
  DECLARE
    pj text := gen_random_uuid()::text;  -- employee of A with projects_* only
    sv text := gen_random_uuid()::text;  -- employee of A with service_* only
    std_project text; svc_project text; std_state text; svc_state text;
    std_element text; svc_element text;
    std_row jsonb; svc_row jsonb;
  BEGIN
    RESET ROLE;
    INSERT INTO "user" (id, email) VALUES (pj, pj || '@authz.invalid'), (sv, sv || '@authz.invalid');
    INSERT INTO "userToCompany" ("userId", "companyId", role) VALUES (pj, company_a, 'employee'), (sv, company_a, 'employee');
    INSERT INTO "userPermission" (id, permissions) VALUES
      (pj, jsonb_build_object(
        'projects_view', jsonb_build_array(company_a), 'projects_create', jsonb_build_array(company_a),
        'projects_update', jsonb_build_array(company_a), 'projects_delete', jsonb_build_array(company_a))),
      (sv, jsonb_build_object(
        'service_view', jsonb_build_array(company_a), 'service_create', jsonb_build_array(company_a),
        'service_update', jsonb_build_array(company_a), 'service_delete', jsonb_build_array(company_a)));

    INSERT INTO project (name, identifier, "companyId", "createdBy")
      VALUES ('Pieces standard', 'PCS', company_a, 'system') RETURNING id INTO std_project;
    INSERT INTO project (name, identifier, "projectType", "costTreatment", "companyId", "createdBy")
      VALUES ('Pieces service', 'SVC999001', 'Service', 'By Coverage', company_a, 'system') RETURNING id INTO svc_project;
    INSERT INTO "projectState" ("projectId", name, "group", color, "companyId", "createdBy")
      VALUES (std_project, 'Pieces', 'Unstarted', '#60646C', company_a, 'system') RETURNING id INTO std_state;
    INSERT INTO "projectState" ("projectId", name, "group", color, "companyId", "createdBy")
      VALUES (svc_project, 'Pieces', 'Unstarted', '#60646C', company_a, 'system') RETURNING id INTO svc_state;
    INSERT INTO "projectElement" ("projectId", type, name, "stateId", "companyId", "createdBy")
      VALUES (std_project, 'Task', 'Standard task', std_state, company_a, 'system') RETURNING id INTO std_element;
    INSERT INTO "projectElement" ("projectId", type, name, "stateId", "companyId", "createdBy")
      VALUES (svc_project, 'Task', 'Service node', svc_state, company_a, 'system') RETURNING id INTO svc_element;

    std_row := jsonb_build_object('projectId', std_project, 'companyId', company_a);
    svc_row := jsonb_build_object('projectId', svc_project, 'companyId', company_a);

    -- projects_* only: the Standard project as before, nothing of the Service project.
    PERFORM pg_temp.act_as(pj);
    ASSERT pg_temp.allows('projectElement', 'SELECT', 'using', std_row), 'projects user reads a Standard element';
    ASSERT pg_temp.allows('projectElement', 'INSERT', 'check', std_row), 'projects user adds a Standard element';
    ASSERT pg_temp.allows('projectElement', 'UPDATE', 'check', std_row), 'projects user updates a Standard element';
    ASSERT pg_temp.allows('projectElement', 'DELETE', 'using', std_row), 'projects user deletes a Standard element';
    ASSERT NOT pg_temp.allows('projectElement', 'SELECT', 'using', svc_row), 'projects user does not read a Service element';
    ASSERT NOT pg_temp.allows('projectElement', 'UPDATE', 'using', svc_row), 'projects user does not update a Service element';
    ASSERT pg_temp.allows('project', 'UPDATE', 'using', jsonb_build_object('projectType', 'Standard', 'companyId', company_a)),
      'projects user updates a Standard project';
    ASSERT NOT pg_temp.allows('project', 'SELECT', 'using', jsonb_build_object('projectType', 'Service', 'companyId', company_a)),
      'projects user does not read a Service project';
    ASSERT pg_temp.allows('projectElementLabel', 'INSERT', 'check', jsonb_build_object('projectElementId', std_element, 'companyId', company_a)),
      'projects user labels a Standard element';
    ASSERT NOT pg_temp.allows('projectElementLabel', 'SELECT', 'using', jsonb_build_object('projectElementId', svc_element, 'companyId', company_a)),
      'projects user does not read a Service element''s labels';
    ASSERT pg_temp.allows('timesheetEntry', 'SELECT', 'using', std_row || jsonb_build_object('employeeId', w)),
      'projects user reads a colleague''s Standard time';
    ASSERT NOT pg_temp.allows('timesheetEntry', 'SELECT', 'using', svc_row || jsonb_build_object('employeeId', w)),
      'projects user does not read a colleague''s Service time';

    -- service_* only: the Service project, and no write to the Standard one.
    PERFORM pg_temp.act_as(sv);
    ASSERT pg_temp.allows('projectElement', 'SELECT', 'using', svc_row), 'service user reads a Service element';
    ASSERT pg_temp.allows('projectElement', 'INSERT', 'check', svc_row), 'service user adds a Service element';
    ASSERT pg_temp.allows('projectElement', 'UPDATE', 'check', svc_row), 'service user updates a Service element';
    ASSERT NOT pg_temp.allows('projectElement', 'INSERT', 'check', std_row), 'service user does not add a Standard element';
    ASSERT NOT pg_temp.allows('projectElement', 'UPDATE', 'using', std_row), 'service user does not update a Standard element';
    ASSERT pg_temp.allows('project', 'INSERT', 'check', jsonb_build_object('projectType', 'Service', 'companyId', company_a)),
      'service user creates a Service project';
    ASSERT NOT pg_temp.allows('project', 'INSERT', 'check', jsonb_build_object('projectType', 'Standard', 'companyId', company_a)),
      'service user does not create a Standard project';
    ASSERT pg_temp.allows('projectElementLabel', 'SELECT', 'using', jsonb_build_object('projectElementId', svc_element, 'companyId', company_a)),
      'service user reads a Service element''s labels';
    ASSERT pg_temp.allows('timesheetEntry', 'UPDATE', 'check', svc_row || jsonb_build_object('employeeId', w, 'status', 'Submitted')),
      'service user updates a colleague''s Service time';
    ASSERT NOT pg_temp.allows('timesheetEntry', 'UPDATE', 'check', std_row || jsonb_build_object('employeeId', w, 'status', 'Submitted')),
      'service user does not update a colleague''s Standard time';
    ASSERT NOT pg_temp.allows('projectElement', 'SELECT', 'using', jsonb_build_object('projectId', svc_project, 'companyId', company_b)),
      'the project must be in the row''s own company';

    -- an employee with neither: reads the Standard project as before, not the Service one.
    PERFORM pg_temp.act_as(w);
    ASSERT pg_temp.allows('projectElement', 'SELECT', 'using', std_row), 'any employee still reads a Standard element';
    ASSERT NOT pg_temp.allows('projectElement', 'UPDATE', 'using', std_row), 'but does not update it';
    ASSERT NOT pg_temp.allows('projectElement', 'SELECT', 'using', svc_row), 'nor reads a Service element';
    RAISE NOTICE 'PASS projectModule';
  END;

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
