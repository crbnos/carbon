-- A payment request's invoice belongs to the request's company, including direct API writes.
-- Run: pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/payment-request-tenant.test.sql
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL "app.sync_in_progress" = 'true';
SET LOCAL statement_timeout = '30s';

DO $proof$
DECLARE
  group_id text; company_a text; company_b text;
  supplier_a text; supplier_b text; interaction_a text; interaction_b text;
  invoice_a text; invoice_b text; request_a text;
  user_id text := gen_random_uuid()::text;
  failed_constraint text;
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy")
    VALUES ('Payment request tenant proof ' || id(), 'system') RETURNING id INTO group_id;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Request A', group_id, 'USD', 'America/New_York') RETURNING id INTO company_a;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Request B', group_id, 'USD', 'America/New_York') RETURNING id INTO company_b;
  INSERT INTO supplier (name, "readableId", "companyId", "createdBy")
    VALUES ('Supplier A', 'REQ-A', company_a, 'system') RETURNING id INTO supplier_a;
  INSERT INTO supplier (name, "readableId", "companyId", "createdBy")
    VALUES ('Supplier B', 'REQ-B', company_b, 'system') RETURNING id INTO supplier_b;
  INSERT INTO "supplierInteraction" ("companyId", "supplierId")
    VALUES (company_a, supplier_a) RETURNING id INTO interaction_a;
  INSERT INTO "supplierInteraction" ("companyId", "supplierId")
    VALUES (company_b, supplier_b) RETURNING id INTO interaction_b;
  INSERT INTO "purchaseInvoice" ("invoiceId", "supplierId", "supplierInteractionId",
      "currencyCode", "exchangeRate", "companyId", "createdBy", status)
    VALUES ('REQ-A', supplier_a, interaction_a, 'USD', 1, company_a, 'system', 'Draft')
    RETURNING id INTO invoice_a;
  INSERT INTO "purchaseInvoice" ("invoiceId", "supplierId", "supplierInteractionId",
      "currencyCode", "exchangeRate", "companyId", "createdBy", status)
    VALUES ('REQ-B', supplier_b, interaction_b, 'USD', 1, company_b, 'system', 'Draft')
    RETURNING id INTO invoice_b;

  INSERT INTO "user" (id, email) VALUES (user_id, user_id || '@requests.invalid');
  INSERT INTO "userToCompany" ("userId", "companyId", role)
    VALUES (user_id, company_a, 'employee');
  INSERT INTO "userPermission" (id, permissions) VALUES (user_id, jsonb_build_object(
    'invoicing_view', jsonb_build_array(company_a),
    'invoicing_create', jsonb_build_array(company_a),
    'invoicing_update', jsonb_build_array(company_a)
  ));
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.path', '/test', true);
  SET LOCAL ROLE authenticated;

  INSERT INTO "paymentRequest" ("companyId", "purchaseInvoiceId", "requestNumber", "currencyCode", "createdBy")
    VALUES (company_a, invoice_a, 1, 'USD', user_id) RETURNING id INTO request_a;

  BEGIN
    INSERT INTO "paymentRequest" ("companyId", "purchaseInvoiceId", "requestNumber", "currencyCode", "createdBy")
      VALUES (company_a, invoice_b, 2, 'USD', user_id);
    ASSERT false, 'A request accepted another company''s invoice';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS failed_constraint = CONSTRAINT_NAME;
    ASSERT failed_constraint = 'paymentRequest_purchaseInvoiceId_fkey';
  END;

  BEGIN
    UPDATE "paymentRequest" SET "purchaseInvoiceId" = invoice_b
      WHERE id = request_a AND "companyId" = company_a;
    ASSERT false, 'A request could be retargeted to another company''s invoice';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS failed_constraint = CONSTRAINT_NAME;
    ASSERT failed_constraint = 'paymentRequest_purchaseInvoiceId_fkey';
  END;

  RESET ROLE;
  DELETE FROM "purchaseInvoice" WHERE id = invoice_a AND "companyId" = company_a;
  ASSERT NOT EXISTS (SELECT 1 FROM "paymentRequest" WHERE id = request_a AND "companyId" = company_a),
    'Deleting an invoice must still cascade to its requests';
END;
$proof$;

ROLLBACK;
