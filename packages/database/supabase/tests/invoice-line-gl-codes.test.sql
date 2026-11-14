-- SPDX-License-Identifier: AGPL-3.0-only
-- Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
-- including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
  customer_b text;
  supplier_a text;
  supplier_interaction_a text;
  sales_invoice_a text;
  sales_invoice_b text;
  purchase_invoice_a text;
  revenue_a text;
  revenue_b text;
  expense_a text;
  user_id text := gen_random_uuid()::text;
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy")
    VALUES ('GL codes proof ' || id(), 'system') RETURNING id INTO group_id;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('GL codes A', group_id, 'USD', 'America/New_York')
    RETURNING id INTO company_a;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('GL codes B', group_id, 'USD', 'America/New_York')
    RETURNING id INTO company_b;
  INSERT INTO customer (name, "readableId", "companyId", "createdBy")
    VALUES ('Customer A', 'GL-A', company_a, 'system') RETURNING id INTO customer_a;
  INSERT INTO customer (name, "readableId", "companyId", "createdBy")
    VALUES ('Customer B', 'GL-B', company_b, 'system') RETURNING id INTO customer_b;
  INSERT INTO supplier (name, "readableId", "companyId", "createdBy")
    VALUES ('Supplier A', 'GL-S', company_a, 'system') RETURNING id INTO supplier_a;
  INSERT INTO "supplierInteraction" ("companyId", "supplierId")
    VALUES (company_a, supplier_a) RETURNING id INTO supplier_interaction_a;
  INSERT INTO account (number, name, class, "incomeBalance", "companyGroupId", "createdBy")
    VALUES ('4000', 'Revenue A', 'Revenue', 'Income Statement', group_id, 'system')
    RETURNING id INTO revenue_a;
  INSERT INTO account (number, name, class, "incomeBalance", "companyGroupId", "createdBy")
    VALUES ('4100', 'Revenue B', 'Revenue', 'Income Statement', group_id, 'system')
    RETURNING id INTO revenue_b;
  INSERT INTO account (number, name, class, "incomeBalance", "companyGroupId", "createdBy")
    VALUES ('5000', 'Expense A', 'Expense', 'Income Statement', group_id, 'system')
    RETURNING id INTO expense_a;

  INSERT INTO "salesInvoice" ("invoiceId", "customerId", "currencyCode",
      "exchangeRate", "companyId", "createdBy", status)
    VALUES ('GL-SI-A', customer_a, 'USD', 1, company_a, 'system', 'Draft')
    RETURNING id INTO sales_invoice_a;
  INSERT INTO "salesInvoice" ("invoiceId", "customerId", "currencyCode",
      "exchangeRate", "companyId", "createdBy", status)
    VALUES ('GL-SI-B', customer_b, 'USD', 1, company_b, 'system', 'Draft')
    RETURNING id INTO sales_invoice_b;
  INSERT INTO "purchaseInvoice" ("invoiceId", "supplierId", "supplierInteractionId",
      "currencyCode", "exchangeRate", "companyId", "createdBy", status)
    VALUES ('GL-PI-A', supplier_a, supplier_interaction_a, 'USD', 1, company_a, 'system', 'Draft')
    RETURNING id INTO purchase_invoice_a;
  INSERT INTO "salesInvoiceLine" ("invoiceId", "invoiceLineType", "unitOfMeasureCode",
      "companyId", "createdBy", quantity, "unitPrice", "exchangeRate", "accountId")
    VALUES
      (sales_invoice_a, 'Service', 'EA', company_a, 'system', 1, 10, 1, revenue_b),
      (sales_invoice_a, 'Service', 'EA', company_a, 'system', 1, 10, 1, revenue_a),
      (sales_invoice_a, 'Service', 'EA', company_a, 'system', 1, 10, 1, revenue_a),
      (sales_invoice_a, 'Service', 'EA', company_a, 'system', 1, 10, 1, NULL),
      (sales_invoice_b, 'Service', 'EA', company_b, 'system', 1, 10, 1, revenue_a);
  INSERT INTO "purchaseInvoiceLine" ("invoiceId", "invoiceLineType",
      "companyId", "createdBy", quantity, "supplierUnitPrice", "exchangeRate", "accountId")
    VALUES (purchase_invoice_a, 'G/L Account', company_a, 'system', 1, 10, 1, expense_a);

  INSERT INTO "user" (id, email)
    VALUES (user_id, user_id || '@gl-codes.invalid');
  INSERT INTO "userToCompany" ("userId", "companyId", role)
    VALUES (user_id, company_a, 'employee');
  INSERT INTO "userPermission" (id, permissions)
    VALUES (user_id, jsonb_build_object('invoicing_view', jsonb_build_array(company_a)));
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  ASSERT (SELECT "glCodes" FROM public.get_invoice_line_gl_codes(
    company_a, 'sales', ARRAY[sales_invoice_a])) = '4000, 4100',
    'Sales codes are distinct, sorted, and omit unassigned lines';
  ASSERT (SELECT "glCodes" FROM public.get_invoice_line_gl_codes(
    company_a, 'purchase', ARRAY[purchase_invoice_a])) = '5000',
    'Purchase codes come from its lines';
  ASSERT NOT EXISTS (SELECT 1 FROM public.get_invoice_line_gl_codes(
    company_a, 'sales', ARRAY[sales_invoice_b])),
    'Foreign company invoice is not returned';
  ASSERT NOT EXISTS (SELECT 1 FROM public.get_invoice_line_gl_codes(
    company_a, 'sales', ARRAY[]::text[])),
    'Empty selection returns no codes';
  BEGIN
    PERFORM * FROM public.get_invoice_line_gl_codes(
      company_b, 'sales', ARRAY[sales_invoice_b]);
    RAISE EXCEPTION 'Expected unauthorized company rejection';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  UPDATE "userPermission" SET permissions = '{}'::jsonb WHERE id = user_id;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM * FROM public.get_invoice_line_gl_codes(
      company_a, 'sales', ARRAY[sales_invoice_a]);
    RAISE EXCEPTION 'Expected permission revocation rejection';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  RAISE NOTICE 'GREEN: sales and purchase codes, tenant scope, empty selection and permission revocation';
END;
$proof$;
ROLLBACK;
