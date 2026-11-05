-- Invoice viewers can export only their invoices' customer names without sales access.
-- Run against an existing migrated local database with scripts/run-local-accounting-check.ts.
-- All fixtures and role changes are rolled back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL "app.sync_in_progress" = 'true';
SET LOCAL statement_timeout = '30s';

DO $proof$
DECLARE
  group_id text;
  company_a text;
  company_b text;
  customer_a text;
  billing_a text;
  customer_b text;
  invoice_a text;
  invoice_b text;
  user_id text := gen_random_uuid()::text;
  result record;
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy")
    VALUES ('TCK60 proof ' || id(), 'system') RETURNING id INTO group_id;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('TCK60 A', group_id, 'USD', 'America/New_York')
    RETURNING id INTO company_a;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('TCK60 B', group_id, 'USD', 'America/New_York')
    RETURNING id INTO company_b;
  INSERT INTO customer (name, "readableId", "companyId", "createdBy")
    VALUES ('Customer A', 'TCK60-A', company_a, 'system')
    RETURNING id INTO customer_a;
  INSERT INTO customer (name, "readableId", "companyId", "createdBy")
    VALUES ('Billing A', 'TCK60-BILL', company_a, 'system')
    RETURNING id INTO billing_a;
  INSERT INTO customer (name, "readableId", "companyId", "createdBy")
    VALUES ('Customer B', 'TCK60-B', company_b, 'system')
    RETURNING id INTO customer_b;
  INSERT INTO "salesInvoice" (
      "invoiceId", "customerId", "invoiceCustomerId", "currencyCode",
      "exchangeRate", "companyId", "createdBy", status)
    VALUES ('TCK60-A', customer_a, billing_a, 'USD', 1, company_a, 'system', 'Draft')
    RETURNING id INTO invoice_a;
  INSERT INTO "salesInvoice" (
      "invoiceId", "customerId", "invoiceCustomerId", "currencyCode",
      "exchangeRate", "companyId", "createdBy", status)
    VALUES ('TCK60-B', customer_b, customer_b, 'USD', 1, company_b, 'system', 'Draft')
    RETURNING id INTO invoice_b;
  INSERT INTO "user" (id, email)
    VALUES (user_id, user_id || '@tck60.invalid');
  INSERT INTO "userToCompany" ("userId", "companyId", role)
    VALUES (user_id, company_a, 'employee');
  INSERT INTO "userPermission" (id, permissions)
    VALUES (user_id, jsonb_build_object('invoicing_view', jsonb_build_array(company_a)));

  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  ASSERT NOT EXISTS (SELECT 1 FROM customer WHERE id = customer_a),
    'Customer table stays private without sales_view';
  SELECT * INTO STRICT result
    FROM public.get_sales_invoice_customer_names(company_a, ARRAY[invoice_a, invoice_b]);
  ASSERT result.id = invoice_a
    AND result."customerName" = 'Customer A'
    AND result."invoiceCustomerName" = 'Billing A',
    'RPC returns exact authorized invoice names';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.get_sales_invoice_customer_names(company_a, ARRAY[invoice_b])
  ), 'Foreign invoice cannot be looked up through authorized company';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.get_sales_invoice_customer_names(company_a, ARRAY[]::text[])
  ), 'Empty selection returns no names';
  BEGIN
    PERFORM * FROM public.get_sales_invoice_customer_names(company_b, ARRAY[invoice_b]);
    RAISE EXCEPTION 'Expected unauthorized company rejection';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  UPDATE "userPermission" SET permissions = '{}'::jsonb WHERE id = user_id;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM * FROM public.get_sales_invoice_customer_names(company_a, ARRAY[invoice_a]);
    RAISE EXCEPTION 'Expected permission revocation rejection';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM * FROM public.get_sales_invoice_customer_names(company_a, ARRAY[invoice_a]);
    RAISE EXCEPTION 'Expected anonymous rejection';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  RAISE NOTICE 'GREEN: exact invoice names, tenant scoping, empty selection, revoked permission and anon denial';
END;
$proof$;
ROLLBACK;
