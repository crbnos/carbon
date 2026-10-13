-- Regression tests for the RLS and helper fixes made through packages/database/src/authz.
-- Run from the repository root against an existing local database:
-- pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/authz-fixes.test.sql
-- All fixtures and role changes are confined to the rolled-back transaction.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL "app.sync_in_progress" = 'true';
SET LOCAL statement_timeout = '30s';

-- Evaluates the live policy expression (USING, or WITH CHECK — which an UPDATE without one
-- takes from USING) of one command against a synthetic row, as the current role. Tests a
-- policy without building its whole fixture chain.
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
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.path', '/test', true);
END;
$fn$;

DO $proof$
DECLARE
  group_a text; group_b text; company_a text; company_b text;
  u text := gen_random_uuid()::text;  -- employee of A, several permissions, some naming B
  w text := gen_random_uuid()::text;  -- plain employee of A, no permissions at all
  c text := gen_random_uuid()::text;  -- customer-portal account of A
  v text := gen_random_uuid()::text;  -- employee of B only
  bank text; customer_a text; draft_payment text; posted_payment text;
  note_id text; view_id text; category_a text; category_b text;
  attribute_a text; attribute_b text; attribute_locked text;
  companies text[]; n int;
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy") VALUES ('Authz A ' || id(), 'system') RETURNING id INTO group_a;
  INSERT INTO "companyGroup" (name, "createdBy") VALUES ('Authz B ' || id(), 'system') RETURNING id INTO group_b;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Authz A', group_a, 'USD', 'America/New_York') RETURNING id INTO company_a;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Authz B', group_b, 'USD', 'America/New_York') RETURNING id INTO company_b;

  INSERT INTO "user" (id, email) VALUES
    (u, u || '@authz.invalid'), (w, w || '@authz.invalid'), (v, v || '@authz.invalid'),
    (c, c || '@authz.invalid');
  INSERT INTO "userToCompany" ("userId", "companyId", role) VALUES
    (u, company_a, 'employee'), (w, company_a, 'employee'), (v, company_b, 'employee'),
    (c, company_a, 'customer');
  INSERT INTO "userPermission" (id, permissions) VALUES
    (u, jsonb_build_object(
      'users_create', jsonb_build_array(company_a),
      'resources_update', jsonb_build_array(company_a),
      'invoicing_update', jsonb_build_array(company_a),
      'documents_view', jsonb_build_array(company_a, company_b),  -- names a company u is not in
      'inventory_view', jsonb_build_array('0')                    -- the old global wildcard
    )),
    (w, '{}'::jsonb), (v, '{}'::jsonb), (c, '{}'::jsonb);

  INSERT INTO account (name, class, "incomeBalance", "isGroup", "companyGroupId", "createdBy")
    VALUES ('Authz bank', 'Asset', 'Balance Sheet', false, group_a, 'system') RETURNING id INTO bank;
  INSERT INTO customer (name, "companyId", "createdBy") VALUES ('Authz customer', company_a, 'system')
    RETURNING id INTO customer_a;
  INSERT INTO payment ("paymentId", "paymentType", "customerId", "paymentDate", "currencyCode", "totalAmount", "bankAccount", "companyId", "createdBy", status)
    VALUES ('AUTHZ-D-' || id(), 'Receipt', customer_a, '2026-09-01', 'USD', 10, bank, company_a, 'system', 'Draft')
    RETURNING id INTO draft_payment;
  INSERT INTO payment ("paymentId", "paymentType", "customerId", "paymentDate", "currencyCode", "totalAmount", "bankAccount", "companyId", "createdBy", status)
    VALUES ('AUTHZ-P-' || id(), 'Receipt', customer_a, '2026-09-01', 'USD', 10, bank, company_a, 'system', 'Posted')
    RETURNING id INTO posted_payment;

  INSERT INTO note ("documentId", note, "companyId", "createdBy") VALUES ('doc', 'hello', company_a, u)
    RETURNING id INTO note_id;
  INSERT INTO "tableView" (name, "table", "companyId", "createdBy") VALUES ('mine', 'item', company_a, u)
    RETURNING id INTO view_id;
  INSERT INTO "userAttributeCategory" (name, "companyId", "createdBy") VALUES ('Skills', company_a, 'system')
    RETURNING id INTO category_a;
  INSERT INTO "userAttributeCategory" (name, "companyId", "createdBy") VALUES ('Skills', company_b, 'system')
    RETURNING id INTO category_b;
  INSERT INTO "userAttribute" (name, "userAttributeCategoryId", "attributeDataTypeId", "canSelfManage", "createdBy")
    VALUES ('Welding', category_a, 1, true, 'system') RETURNING id INTO attribute_a;
  INSERT INTO "userAttribute" (name, "userAttributeCategoryId", "attributeDataTypeId", "canSelfManage", "createdBy")
    VALUES ('Clearance', category_a, 1, false, 'system') RETURNING id INTO attribute_locked;
  INSERT INTO "userAttribute" (name, "userAttributeCategoryId", "attributeDataTypeId", "canSelfManage", "createdBy")
    VALUES ('Welding', category_b, 1, true, 'system') RETURNING id INTO attribute_b;

  -- ── The deprecated permission helpers stay dropped (audit H3, then retired) ──
  -- They admitted customer and supplier portal accounts; nothing may bring them back.
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('has_role', 'has_company_permission', 'get_companies_with_permission', 'get_permission_companies')
  ), 'a deprecated RLS helper exists again';
  RAISE NOTICE 'PASS deprecated permission helpers are gone';
  PERFORM pg_temp.act_as(u);
  SET LOCAL ROLE authenticated;

  -- ── userToCompany: an admin cannot attach another user to their company ──
  BEGIN
    INSERT INTO "userToCompany" ("userId", "companyId", role) VALUES (v, company_a, 'employee');
    RAISE EXCEPTION 'an admin attached another user to their company through the API';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'PASS memberships cannot be written through the API';

  -- ── Owner-only rows: the author edits, but cannot move the row into another company ──
  UPDATE note SET note = 'edited' WHERE id = note_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 1, 'the author can still edit their note';
  BEGIN
    -- No WHERE: a filtered UPDATE also checks the new row against the SELECT policy, which
    -- already refuses company B. The unfiltered form meets only the UPDATE policy.
    UPDATE note SET "companyId" = company_b;
    RAISE EXCEPTION 'a note was moved into another company';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE "tableView" SET "companyId" = company_b WHERE id = view_id;
    RAISE EXCEPTION 'a table view was moved into another company';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  ASSERT pg_temp.allows('maintenanceDispatchComment', 'UPDATE', 'check',
    jsonb_build_object('createdBy', u, 'companyId', company_a)),
    'the author can still edit their dispatch comment';
  ASSERT NOT pg_temp.allows('maintenanceDispatchComment', 'UPDATE', 'check',
    jsonb_build_object('createdBy', u, 'companyId', company_b)),
    'a dispatch comment cannot be moved into another company';
  ASSERT NOT pg_temp.allows('maintenanceDispatchComment', 'UPDATE', 'using',
    jsonb_build_object('createdBy', w, 'companyId', company_a)),
    'only the author edits a dispatch comment';
  RAISE NOTICE 'PASS owner-only rows stay in their company';

  -- ── invoiceSettlement: writable while its payment is Draft, not once Posted ──
  ASSERT pg_temp.allows('invoiceSettlement', 'UPDATE', 'using',
    jsonb_build_object('paymentId', draft_payment, 'companyId', company_a)),
    'a settlement of a Draft payment is editable';
  ASSERT NOT pg_temp.allows('invoiceSettlement', 'UPDATE', 'using',
    jsonb_build_object('paymentId', posted_payment, 'companyId', company_a)),
    'a settlement of a Posted payment is not editable';
  RAISE NOTICE 'PASS settlements follow their payment''s status';

  -- ── maintenanceDispatchItemTrackedEntity: resources_update can update ──
  ASSERT pg_temp.allows('maintenanceDispatchItemTrackedEntity', 'UPDATE', 'using',
    jsonb_build_object('companyId', company_a)),
    'resources_update can update a dispatch item''s tracked entity';
  RAISE NOTICE 'PASS maintenance dispatch tracked entities use the resources permission';
  RESET ROLE;

  -- ── userAttributeValue: an employee with no resources permission at all saves their own
  --    value for a self-managed attribute of their own company, and nothing else ──
  PERFORM pg_temp.act_as(w);
  SET LOCAL ROLE authenticated;
  ASSERT (SELECT count(*) FROM "userAttribute" WHERE id = attribute_a) = 1,
    'an employee sees the attributes they manage themselves';
  ASSERT (SELECT count(*) FROM "userAttribute" WHERE id IN (attribute_locked, attribute_b)) = 0,
    'but not other attributes, nor another company''s';
  INSERT INTO "userAttributeValue" ("userAttributeId", "userId", "valueBoolean", "createdBy")
    VALUES (attribute_a, w, true, w);
  BEGIN
    INSERT INTO "userAttributeValue" ("userAttributeId", "userId", "valueBoolean", "createdBy")
      VALUES (attribute_b, w, true, w);
    RAISE EXCEPTION 'a value was attached to another company''s attribute';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO "userAttributeValue" ("userAttributeId", "userId", "valueBoolean", "createdBy")
      VALUES (attribute_locked, w, true, w);
    RAISE EXCEPTION 'a user set their own value for an attribute that is not self-managed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO "userAttributeValue" ("userAttributeId", "userId", "valueBoolean", "createdBy")
      VALUES (attribute_a, v, true, w);
    RAISE EXCEPTION 'a plain employee set another user''s value';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  ASSERT pg_temp.allows('userAttributeValue', 'DELETE', 'using',
    jsonb_build_object('userAttributeId', attribute_a, 'userId', w)),
    'a user can clear their own self-managed value';
  ASSERT NOT pg_temp.allows('userAttributeValue', 'DELETE', 'using',
    jsonb_build_object('userAttributeId', attribute_a, 'userId', v)),
    'a plain employee cleared another user''s value';
  ASSERT NOT pg_temp.allows('userAttributeValue', 'DELETE', 'using',
    jsonb_build_object('userAttributeId', attribute_locked, 'userId', w)),
    'a user cleared their own value of an attribute that is not self-managed';
  RESET ROLE;
  PERFORM pg_temp.act_as(c);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO "userAttributeValue" ("userAttributeId", "userId", "valueBoolean", "createdBy")
      VALUES (attribute_a, c, true, c);
    RAISE EXCEPTION 'a customer-portal account set a self-managed employee attribute';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'PASS users save and clear their own attribute values, only in their own company';
  RESET ROLE;

  -- ── get_company_id_from_foreign_key: refused as an API endpoint, fine inside a query ──
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
  PERFORM set_config('request.path', '/rpc/get_company_id_from_foreign_key', true);
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM get_company_id_from_foreign_key(note_id, 'note');
    RAISE EXCEPTION 'get_company_id_from_foreign_key answered a direct API call';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.path', '/rpc/Get_Company_Id_From_Foreign_Key/', true);
  BEGIN
    PERFORM get_company_id_from_foreign_key(note_id, 'note');
    RAISE EXCEPTION 'get_company_id_from_foreign_key answered a direct API call spelled differently';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  PERFORM set_config('request.path', '/test', true);
  ASSERT get_company_id_from_foreign_key(note_id, 'note') = company_a,
    'inside an ordinary request the helper still resolves the company';
  RAISE NOTICE 'PASS get_company_id_from_foreign_key is not an API endpoint';
END
$proof$;

ROLLBACK;
