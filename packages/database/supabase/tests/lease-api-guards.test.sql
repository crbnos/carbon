-- Lessee lease guards (20261012214416_lease-api-guards):
--   1. over the API (anon / authenticated) a lease, its assets and its
--      payment rows change only while the lease is Draft — except a started
--      lease's name, notes, owner, notice date and custom fields — and the
--      status, the journal and an asset's classification and measurement
--      never change; the service role and a direct connection (the server
--      functions) are not guarded;
--   2. deleting a purchase invoice line returns the lease payment row it
--      billed to Pending, and a payment row is Invoiced exactly when it names
--      an invoice line;
--   3. the lease constraints: asset inputs, the escalation, a payment row,
--      schedule line or event belongs to an asset of its own lease, a lease
--      run row names both its lease and its schedule line, and an event's
--      fixed asset exists;
--   4. the `leases` view: a Draft lease has no next due date, and the count,
--      payment and classification cover the active assets of a running lease.
-- Run from the repository root against an existing migrated local database:
-- pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 \
--   -f packages/database/supabase/tests/lease-api-guards.test.sql
-- All fixtures and role changes are confined to the rolled-back transaction.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL "app.sync_in_progress" = 'true';
SET LOCAL statement_timeout = '30s';

DO $proof$
DECLARE
  group_id text; company_id text; supplier_id text; interaction_id text;
  user_id text := gen_random_uuid()::text;
  draft_id text; active_id text; other_id text;
  draft_line text; active_line text; ended_line text; other_line text;
  draft_payment text; active_payment text;
  invoice_id text; invoice_line text;
  schedule_line text;
  moved int;
  view_row record;
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy")
    VALUES ('Lease guards ' || id(), 'system') RETURNING id INTO group_id;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Lease guards', group_id, 'USD', 'America/New_York')
    RETURNING id INTO company_id;
  INSERT INTO supplier (name, "readableId", "companyId")
    VALUES ('Lessor', 'LG-' || id(), company_id) RETURNING id INTO supplier_id;
  INSERT INTO "supplierInteraction" ("companyId", "supplierId")
    VALUES (company_id, supplier_id) RETURNING id INTO interaction_id;

  INSERT INTO lease ("leaseId", status, "supplierId", "commencementDate", "endDate",
      "invoiceFromDate", "discountRate", "currencyCode", "companyId", "createdBy")
    VALUES ('LG-DRAFT', 'Draft', supplier_id, DATE '2027-01-01', DATE '2029-12-31',
      DATE '2027-01-01', 6, 'USD', company_id, 'system')
    RETURNING id INTO draft_id;
  INSERT INTO lease ("leaseId", status, "supplierId", "commencementDate", "endDate",
      "invoiceFromDate", "discountRate", "currencyCode", "companyId", "createdBy")
    VALUES ('LG-ACTIVE', 'Active', supplier_id, DATE '2027-01-01', DATE '2029-12-31',
      DATE '2027-01-01', 6, 'USD', company_id, 'system')
    RETURNING id INTO active_id;
  INSERT INTO lease ("leaseId", status, "supplierId", "commencementDate", "endDate",
      "invoiceFromDate", "discountRate", "currencyCode", "companyId", "createdBy")
    VALUES ('LG-OTHER', 'Draft', supplier_id, DATE '2027-01-01', DATE '2029-12-31',
      DATE '2027-01-01', 6, 'USD', company_id, 'system')
    RETURNING id INTO other_id;

  INSERT INTO "leaseLine" ("leaseId", description, "paymentAmount", "companyId", "createdBy")
    VALUES (draft_id, 'Draft forklift', 1000, company_id, 'system') RETURNING id INTO draft_line;
  INSERT INTO "leaseLine" ("leaseId", description, "paymentAmount", status,
      "lesseeClassification", "initialLiability", "initialRouAsset", "rouAssetCost",
      "companyId", "createdBy")
    VALUES (active_id, 'Active forklift', 1000, 'Active', 'Operating', 30000, 30000, 30000,
      company_id, 'system') RETURNING id INTO active_line;
  INSERT INTO "leaseLine" ("leaseId", description, "paymentAmount", status,
      "lesseeClassification", "companyId", "createdBy")
    VALUES (active_id, 'Returned forklift', 500, 'Terminated', 'Finance',
      company_id, 'system') RETURNING id INTO ended_line;
  INSERT INTO "leaseLine" ("leaseId", description, "paymentAmount", "companyId", "createdBy")
    VALUES (other_id, 'Other forklift', 1000, company_id, 'system') RETURNING id INTO other_line;

  INSERT INTO "leasePayment" ("leaseId", "leaseLineId", "periodStart", "periodEnd",
      "dueDate", amount, "companyId", "createdBy")
    VALUES (draft_id, draft_line, DATE '2027-01-01', DATE '2027-01-31', DATE '2027-01-31',
      1000, company_id, 'system') RETURNING id INTO draft_payment;
  INSERT INTO "leasePayment" ("leaseId", "leaseLineId", "periodStart", "periodEnd",
      "dueDate", amount, "companyId", "createdBy")
    VALUES (active_id, active_line, DATE '2027-01-01', DATE '2027-01-31', DATE '2027-01-31',
      1000, company_id, 'system') RETURNING id INTO active_payment;
  INSERT INTO "leasePayment" ("leaseId", "leaseLineId", "periodStart", "periodEnd",
      "dueDate", amount, "companyId", "createdBy")
    VALUES (active_id, active_line, DATE '2027-02-01', DATE '2027-02-28', DATE '2027-02-28',
      1000, company_id, 'system');

  -- ── 1. The API writes a Draft lease, and only a started lease's notes ─────
  INSERT INTO "user" (id, email) VALUES (user_id, user_id || '@lease-guards.invalid');
  INSERT INTO "userToCompany" ("userId", "companyId", role)
    VALUES (user_id, company_id, 'employee');
  INSERT INTO "userPermission" (id, permissions)
    VALUES (user_id, jsonb_build_object(
      'purchasing_view', jsonb_build_array(company_id),
      'purchasing_create', jsonb_build_array(company_id),
      'purchasing_update', jsonb_build_array(company_id),
      'purchasing_delete', jsonb_build_array(company_id),
      'invoicing_view', jsonb_build_array(company_id),
      'invoicing_create', jsonb_build_array(company_id),
      'invoicing_update', jsonb_build_array(company_id),
      'invoicing_delete', jsonb_build_array(company_id)));
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  UPDATE "leaseLine" SET description = 'Draft forklift FL-12', "paymentAmount" = 1100
    WHERE id = draft_line;
  GET DIAGNOSTICS moved = ROW_COUNT;
  ASSERT moved = 1, 'A Draft lease''s asset stays editable over the API';
  UPDATE "leasePayment" SET amount = 900 WHERE id = draft_payment;
  GET DIAGNOSTICS moved = ROW_COUNT;
  ASSERT moved = 1, 'A Draft lease''s payment row stays editable over the API';
  UPDATE lease SET "paymentFrequency" = 'Quarterly', "discountRate" = 7 WHERE id = draft_id;
  GET DIAGNOSTICS moved = ROW_COUNT;
  ASSERT moved = 1, 'A Draft lease''s terms stay editable over the API';
  RAISE NOTICE 'PASS a Draft lease, its assets and its payment rows are editable';

  BEGIN
    UPDATE "leaseLine" SET "paymentAmount" = 2000 WHERE id = active_line;
    RAISE EXCEPTION 'An Active lease''s asset changed over the API';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO "leaseLine" ("leaseId", description, "paymentAmount", "companyId", "createdBy")
      VALUES (active_id, 'Smuggled', 10, company_id, user_id);
    RAISE EXCEPTION 'An asset was added to an Active lease over the API';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM "leaseLine" WHERE id = active_line;
    RAISE EXCEPTION 'An Active lease''s asset was deleted over the API';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'PASS an Active lease''s assets are closed to the API';

  BEGIN
    UPDATE "leasePayment" SET amount = 1 WHERE id = active_payment;
    RAISE EXCEPTION 'An Active lease''s payment row changed over the API';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO "leasePayment" ("leaseId", "leaseLineId", "periodStart", "periodEnd",
        "dueDate", amount, "companyId", "createdBy")
      VALUES (active_id, active_line, DATE '2027-03-01', DATE '2027-03-31', DATE '2027-03-31',
        1, company_id, user_id);
    RAISE EXCEPTION 'A payment row was added to an Active lease over the API';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM "leasePayment" WHERE id = active_payment;
    RAISE EXCEPTION 'An Active lease''s payment row was deleted over the API';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- Moving a Draft lease's row onto an Active lease is a write to it.
  BEGIN
    UPDATE "leasePayment" SET "leaseId" = active_id, "leaseLineId" = active_line
      WHERE id = draft_payment;
    RAISE EXCEPTION 'A payment row moved onto an Active lease over the API';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'PASS an Active lease''s payment rows are closed to the API';

  BEGIN
    UPDATE "leaseLine"
      SET "classificationOverride" = 'Finance', "classificationOverrideReason" = 'Mine'
      WHERE id = draft_line;
    RAISE EXCEPTION 'A Draft asset''s classification override changed over the API';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE "leaseLine" SET "initialLiability" = 1 WHERE id = draft_line;
    RAISE EXCEPTION 'A Draft asset''s measurement changed over the API';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO "leaseLine" ("leaseId", description, "paymentAmount",
        "lesseeClassification", "companyId", "createdBy")
      VALUES (draft_id, 'Pre-classified', 10, 'Finance', company_id, user_id);
    RAISE EXCEPTION 'An asset was added with a classification over the API';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'PASS an asset''s classification and measurement are closed to the API';

  UPDATE lease
    SET name = 'Warehouse forklifts', description = 'Two trucks',
        "noticeDate" = DATE '2029-06-30', assignee = user_id,
        "customFields" = '{"costCenter": "WH"}'::jsonb,
        "updatedBy" = user_id, "updatedAt" = now()
    WHERE id = active_id;
  GET DIAGNOSTICS moved = ROW_COUNT;
  ASSERT moved = 1, 'An Active lease''s name, notes, owner and notice date stay editable';
  RAISE NOTICE 'PASS an Active lease''s name, notes, owner and notice date are editable';

  BEGIN
    UPDATE lease SET "discountRate" = 9 WHERE id = active_id;
    RAISE EXCEPTION 'An Active lease''s terms changed over the API';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE lease SET status = 'Cancelled' WHERE id = active_id;
    RAISE EXCEPTION 'An Active lease''s status changed over the API';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE lease SET status = 'Active' WHERE id = draft_id;
    RAISE EXCEPTION 'A Draft lease was activated over the API';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO lease ("leaseId", status, "supplierId", "commencementDate",
        "invoiceFromDate", "discountRate", "currencyCode", "companyId", "createdBy")
      VALUES ('LG-SMUGGLED', 'Active', supplier_id, DATE '2027-01-01',
        DATE '2027-01-01', 6, 'USD', company_id, user_id);
    RAISE EXCEPTION 'An Active lease was created over the API';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM lease WHERE id = active_id;
    RAISE EXCEPTION 'An Active lease was deleted over the API';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'PASS an Active lease''s terms, status and existence are closed to the API';

  -- A Draft lease is deleted with its assets and payment rows.
  DELETE FROM lease WHERE id = other_id;
  GET DIAGNOSTICS moved = ROW_COUNT;
  ASSERT moved = 1, 'A Draft lease can be deleted over the API';
  RESET ROLE;
  ASSERT NOT EXISTS (SELECT 1 FROM "leaseLine" WHERE id = other_line),
    'A deleted Draft lease takes its assets with it';
  RAISE NOTICE 'PASS a Draft lease is deleted with its assets';

  -- The service role (the classification route) and a direct connection (the
  -- server functions) are not guarded.
  SET LOCAL ROLE service_role;
  UPDATE "leaseLine"
    SET "classificationOverride" = 'Finance', "classificationOverrideReason" = 'Specialized'
    WHERE id = draft_line;
  GET DIAGNOSTICS moved = ROW_COUNT;
  ASSERT moved = 1, 'The service role sets a classification override';
  UPDATE "leaseLine" SET "paymentAmount" = 1200 WHERE id = active_line;
  GET DIAGNOSTICS moved = ROW_COUNT;
  ASSERT moved = 1, 'The service role writes an Active lease''s asset';
  RESET ROLE;
  UPDATE lease SET status = 'Active', "commencementJournalId" = NULL WHERE id = draft_id;
  UPDATE "leaseLine" SET status = 'Terminated', "rouAssetCost" = 1 WHERE id = active_line;
  GET DIAGNOSTICS moved = ROW_COUNT;
  ASSERT moved = 1, 'A direct connection writes an Active lease''s asset';
  UPDATE "leaseLine" SET status = 'Active' WHERE id = active_line;
  UPDATE lease SET status = 'Draft' WHERE id = draft_id;
  RAISE NOTICE 'PASS the service role and a direct connection are not guarded';

  -- ── 2. Deleting an invoice line releases its payment row ──────────────────
  INSERT INTO "purchaseInvoice" ("invoiceId", "supplierId", "supplierInteractionId",
      "currencyCode", "companyId", "createdBy")
    VALUES ('LG-PI-' || id(), supplier_id, interaction_id, 'USD', company_id, 'system')
    RETURNING id INTO invoice_id;
  INSERT INTO "purchaseInvoiceLine" ("invoiceId", "invoiceLineType", "leaseId",
      "leasePaymentId", quantity, "supplierUnitPrice", "companyId", "createdBy")
    VALUES (invoice_id, 'Lease', active_id, active_payment, 1, 1000, company_id, 'system')
    RETURNING id INTO invoice_line;
  UPDATE "leasePayment" SET status = 'Invoiced', "purchaseInvoiceLineId" = invoice_line
    WHERE id = active_payment;

  BEGIN
    UPDATE "leasePayment" SET "purchaseInvoiceLineId" = NULL WHERE id = active_payment;
    RAISE EXCEPTION 'An Invoiced payment row lost its invoice line';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE "leasePayment" SET "purchaseInvoiceLineId" = invoice_line WHERE id = draft_payment;
    RAISE EXCEPTION 'A Pending payment row named an invoice line';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'PASS a payment row is Invoiced exactly when it names an invoice line';

  -- Over the API, on an Active lease: the release is the database's own write.
  SET LOCAL ROLE authenticated;
  DELETE FROM "purchaseInvoiceLine" WHERE id = invoice_line;
  GET DIAGNOSTICS moved = ROW_COUNT;
  ASSERT moved = 1, 'The API deletes a Draft invoice''s lease line';
  RESET ROLE;
  ASSERT (SELECT status = 'Pending' AND "purchaseInvoiceLineId" IS NULL
          FROM "leasePayment" WHERE id = active_payment),
    'Deleting the invoice line returns its payment row to Pending';
  RAISE NOTICE 'PASS deleting an invoice line returns its payment row to Pending';

  -- ── 3. Constraints ─────────────────────────────────────────────────────────
  BEGIN
    UPDATE "leaseLine" SET "fairValue" = 0 WHERE id = draft_line;
    RAISE EXCEPTION 'An asset took a fair value of 0';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE "leaseLine" SET "economicLifeMonths" = 0 WHERE id = draft_line;
    RAISE EXCEPTION 'An asset took an economic life of 0 months';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE "leaseLine" SET "purchaseOptionAmount" = -1 WHERE id = draft_line;
    RAISE EXCEPTION 'An asset took a negative purchase option';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE lease SET "annualEscalationPercent" = -100 WHERE id = draft_id;
    RAISE EXCEPTION 'A lease took an escalation of -100 %%';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'PASS the asset inputs and the escalation are checked';

  BEGIN
    INSERT INTO "leasePayment" ("leaseId", "leaseLineId", "periodStart", "periodEnd",
        "dueDate", amount, "companyId", "createdBy")
      VALUES (draft_id, active_line, DATE '2027-05-01', DATE '2027-05-31', DATE '2027-05-31',
        1, company_id, 'system');
    RAISE EXCEPTION 'A payment row named an asset of another lease';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO "leaseScheduleLine" ("leaseId", "leaseLineId", "periodDate", "openingLiability",
        "paymentAmount", "interestAmount", "principalAmount", "closingLiability", "leaseCost",
        "rouAmortization", "closingRouAsset", "companyId", "createdBy")
      VALUES (draft_id, active_line, DATE '2027-01-31', 0, 0, 0, 0, 0, 0, 0, 0,
        company_id, 'system');
    RAISE EXCEPTION 'A schedule line named an asset of another lease';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO "leaseEvent" ("leaseId", "leaseLineId", "eventType", "effectiveDate",
        "liabilityBefore", "liabilityAfter", "rouAssetBefore", "rouAssetAfter",
        "classificationBefore", "classificationAfter", "companyId", "createdBy")
      VALUES (draft_id, active_line, 'Modification', DATE '2027-06-01', 0, 0, 0, 0,
        'Operating', 'Operating', company_id, 'system');
    RAISE EXCEPTION 'An event named an asset of another lease';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO "leaseEvent" ("leaseId", "leaseLineId", "eventType", "effectiveDate",
        "liabilityBefore", "liabilityAfter", "rouAssetBefore", "rouAssetAfter",
        "classificationBefore", "classificationAfter", "fixedAssetId", "companyId", "createdBy")
      VALUES (active_id, active_line, 'Purchase', DATE '2027-06-01', 0, 0, 0, 0,
        'Operating', 'Operating', 'no-such-asset', company_id, 'system');
    RAISE EXCEPTION 'An event named a fixed asset that does not exist';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  RAISE NOTICE 'PASS a payment row, schedule line and event belong to their own lease''s asset';

  INSERT INTO "leaseScheduleLine" ("leaseId", "leaseLineId", "periodDate", "openingLiability",
      "paymentAmount", "interestAmount", "principalAmount", "closingLiability", "leaseCost",
      "rouAmortization", "closingRouAsset", "postedAt", "companyId", "createdBy")
    VALUES (active_id, active_line, DATE '2027-01-31', 30000, 1000, 150, 850, 29150, 1000,
      850, 29150, now(), company_id, 'system')
    RETURNING id INTO schedule_line;
  BEGIN
    INSERT INTO "revenueRecognitionSchedule" ("companyId", type, "periodStart", "periodEnd",
        "scheduledDate", amount, "debitAccountId", "creditAccountId", "leaseId", "createdBy")
      VALUES (company_id, 'Interest', DATE '2027-01-01', DATE '2027-01-31', DATE '2027-01-31',
        150, 'a', 'b', active_id, 'system');
    RAISE EXCEPTION 'A lease run row named a lease and no schedule line';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'PASS a lease run row names its lease and its schedule line together';

  -- ── 4. The lease list ──────────────────────────────────────────────────────
  SELECT * INTO view_row FROM leases WHERE id = draft_id;
  ASSERT view_row."nextDueDate" IS NULL, 'A Draft lease has no next due date';
  SELECT * INTO view_row FROM leases WHERE id = active_id;
  ASSERT view_row."nextDueDate" = DATE '2027-01-31',
    format('An Active lease''s next due date is its first Pending row, got %s', view_row."nextDueDate");
  ASSERT view_row."assetCount" = 1,
    format('A running lease counts its active assets, got %s', view_row."assetCount");
  ASSERT view_row."paymentAmount" = 1200,
    format('A running lease pays for its active assets, got %s', view_row."paymentAmount");
  ASSERT view_row.classification = 'Operating',
    format('A running lease is classified by its active assets, got %s', view_row.classification);
  ASSERT view_row."currentLiability" = 29150,
    format('An Active lease owes its last posted line, got %s', view_row."currentLiability");
  RAISE NOTICE 'PASS the lease list reads a running lease''s active assets';
END
$proof$;

ROLLBACK;
