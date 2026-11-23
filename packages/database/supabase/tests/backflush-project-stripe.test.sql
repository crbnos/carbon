-- The SQL backflush (backflush_job_materials) draws stock by stripe (Projects
-- Phase 2a): a job charged to a project with project stock draws that
-- project's stock first, then common stock, one Consumption row per stripe,
-- and relieves the cost layers of each stripe. Every other job draws common
-- stock only.
-- Isolated fixture company; no existing business data is read or edited. Always rolls back.
-- Run: pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -f packages/database/supabase/tests/backflush-project-stripe.test.sql
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '60s';

-- A job of 1 for p_assembly, charged to p_project_id, that pulls p_quantity of
-- p_part from p_storage_unit_id, backflushed for its 1 unit. Returns the job id.
CREATE FUNCTION pg_temp.backflush(
  p_company_id text, p_location_id text, p_assembly text, p_part text,
  p_readable_id text, p_quantity numeric, p_storage_unit_id text, p_project_id text
) RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE
  v_job_id text;
  v_make_method_id text;
BEGIN
  INSERT INTO job ("jobId", "itemId", quantity, "locationId", "projectId", "companyId", "createdBy", "unitOfMeasureCode")
    VALUES (p_readable_id, p_assembly, 1, p_location_id, p_project_id, p_company_id, 'system', 'EA')
    RETURNING id INTO v_job_id;

  SELECT id INTO STRICT v_make_method_id
  FROM "jobMakeMethod" WHERE "jobId" = v_job_id AND "parentMaterialId" IS NULL;

  INSERT INTO "jobMaterial" ("jobId", "jobMakeMethodId", "itemId", description, "methodType",
      "itemType", quantity, "estimatedQuantity", "storageUnitId", "companyId", "createdBy")
    VALUES (v_job_id, v_make_method_id, p_part, 'Stocked part', 'Pull from Inventory',
      'Part', p_quantity, p_quantity, p_storage_unit_id, p_company_id, 'system');

  PERFORM backflush_job_materials(v_job_id, 1, p_company_id, 'system');
  RETURN v_job_id;
END;
$fn$;

-- Opening stock of p_quantity at p_cost in one stripe: the itemLedger row and
-- its cost layer, both with p_project_id (NULL = common).
CREATE FUNCTION pg_temp.stock(
  p_company_id text, p_location_id text, p_storage_unit_id text, p_item_id text,
  p_quantity numeric, p_cost numeric, p_posting_date date, p_project_id text
) RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE
  v_layer text;
BEGIN
  INSERT INTO "itemLedger" ("entryType", "documentType", "itemId", quantity, "locationId",
      "storageUnitId", "projectId", "postingDate", "companyId", "createdBy")
    VALUES ('Positive Adjmt.', NULL, p_item_id, p_quantity, p_location_id,
      p_storage_unit_id, p_project_id, p_posting_date, p_company_id, 'system');
  INSERT INTO "costLedger" ("itemLedgerType", "costLedgerType", adjustment, "itemId", quantity,
      cost, "remainingQuantity", "postingDate", "projectId", "companyId")
    VALUES ('Positive Adjmt.', 'Direct Cost', false, p_item_id, p_quantity,
      p_cost, p_quantity, p_posting_date, p_project_id, p_company_id)
    RETURNING id INTO v_layer;
  RETURN v_layer;
END;
$fn$;

DO $cases$
DECLARE
  v_group_id text; v_company_id text; v_location_id text; v_storage_unit_id text; v_defaults jsonb;
  v_assembly text; v_part text; v_project text; v_plain_project text;
  v_wip_account text; v_raw_account text; v_other_account text;
  v_project_layer text; v_common_layer text; v_job text;
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy") VALUES ('Backflush stripe test', 'system') RETURNING id INTO v_group_id;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Backflush stripe test', v_group_id, 'USD', 'UTC') RETURNING id INTO v_company_id;
  INSERT INTO location (name, "addressLine1", city, "postalCode", "companyId", "createdBy", timezone)
    VALUES ('Plant', '1 Test Way', 'Testville', '00000', v_company_id, 'system', 'UTC') RETURNING id INTO v_location_id;
  INSERT INTO "storageUnit" (name, "locationId", "companyId", "createdBy")
    VALUES ('A-1', v_location_id, v_company_id, 'system') RETURNING id INTO v_storage_unit_id;
  INSERT INTO "unitOfMeasure" (code, name, "companyId", "createdBy")
    VALUES ('EA', 'Each', v_company_id, 'system') ON CONFLICT DO NOTHING;
  INSERT INTO item ("readableId", name, type, "replenishmentSystem", "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
    VALUES ('S-ASSY', 'Assembly', 'Part', 'Make', 'Inventory', 'EA', v_company_id, 'system') RETURNING id INTO v_assembly;
  INSERT INTO item ("readableId", name, type, "replenishmentSystem", "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
    VALUES ('S-PART', 'Striped part', 'Part', 'Buy', 'Inventory', 'EA', v_company_id, 'system') RETURNING id INTO v_part;
  -- An item insert may already have created its cost row.
  DELETE FROM "itemCost" WHERE "companyId" = v_company_id AND "itemId" = v_part;
  INSERT INTO "itemCost" ("itemId", "costingMethod", "unitCost", "companyId", "createdBy")
    VALUES (v_part, 'FIFO', 0, v_company_id, 'system');
  INSERT INTO project (name, identifier, status, "costTreatment", "projectStock", "companyId", "createdBy")
    VALUES ('Stocked project', 'STK', 'Released', 'Expense', true, v_company_id, 'system') RETURNING id INTO v_project;
  INSERT INTO project (name, identifier, status, "costTreatment", "projectStock", "companyId", "createdBy")
    VALUES ('Plain project', 'PLN', 'Released', 'Expense', false, v_company_id, 'system') RETURNING id INTO v_plain_project;

  -- Accounting on: the backflush prices material only when it posts.
  UPDATE "companySettings" SET "accountingEnabled" = true WHERE id = v_company_id;
  IF NOT FOUND THEN
    INSERT INTO "companySettings" (id, "accountingEnabled") VALUES (v_company_id, true);
  END IF;
  INSERT INTO "sequence" ("table", name, prefix, "companyId", "updatedBy")
    VALUES ('journalEntry', 'Journal entries', 'JE-', v_company_id, 'system')
  ON CONFLICT DO NOTHING;
  INSERT INTO account (name, class, "accountType", "incomeBalance", "companyGroupId", "createdBy")
    VALUES ('WIP', 'Asset', 'Bank', 'Balance Sheet', v_group_id, 'system') RETURNING id INTO v_wip_account;
  INSERT INTO account (name, class, "accountType", "incomeBalance", "companyGroupId", "createdBy")
    VALUES ('Raw materials', 'Asset', 'Bank', 'Balance Sheet', v_group_id, 'system') RETURNING id INTO v_raw_account;
  INSERT INTO account (name, class, "accountType", "incomeBalance", "companyGroupId", "createdBy")
    VALUES ('Other', 'Expense', 'Expense', 'Income Statement', v_group_id, 'system') RETURNING id INTO v_other_account;
  SELECT jsonb_object_agg(attname, to_jsonb(v_other_account)) INTO v_defaults
    FROM pg_attribute WHERE attrelid = '"accountDefault"'::regclass AND attnum > 0 AND NOT attisdropped AND attnotnull AND attname <> 'companyId';
  INSERT INTO "accountDefault" SELECT (jsonb_populate_record(NULL::"accountDefault", v_defaults || jsonb_build_object(
    'companyId', v_company_id, 'workInProgressAccount', v_wip_account, 'rawMaterialsAccount', v_raw_account))).*;

  -- 4 in the project's stock at 12.00 (the older layer) and 10 in common stock
  -- at 10.00, all in bin A-1.
  v_project_layer := pg_temp.stock(v_company_id, v_location_id, v_storage_unit_id, v_part, 4, 48, '2026-01-01', v_project);
  v_common_layer := pg_temp.stock(v_company_id, v_location_id, v_storage_unit_id, v_part, 10, 100, '2026-02-01', NULL);

  -- (a) A job of the project issues 6: 4 from the project, then 2 from common.
  v_job := pg_temp.backflush(v_company_id, v_location_id, v_assembly, v_part, 'SJ-A', 6, v_storage_unit_id, v_project);
  ASSERT (SELECT count(*) FROM "itemLedger" WHERE "documentId" = v_job AND "entryType" = 'Consumption') = 2,
    'A project job must write one Consumption row per stripe drawn';
  ASSERT (SELECT quantity FROM "itemLedger" WHERE "documentId" = v_job AND "projectId" = v_project) = -4,
    'The project stripe must give its 4';
  ASSERT (SELECT quantity FROM "itemLedger" WHERE "documentId" = v_job AND "entryType" = 'Consumption' AND "projectId" IS NULL) = -2,
    'Common stock must give the other 2';
  ASSERT (SELECT -cost FROM "costLedger" WHERE "documentId" = v_job AND "documentType" = 'Job Consumption' AND "projectId" = v_project) = 48,
    'The project row must relieve the project layer, 48';
  ASSERT (SELECT -cost FROM "costLedger" WHERE "documentId" = v_job AND "documentType" = 'Job Consumption' AND "projectId" IS NULL) = 20,
    'The common row must relieve the common layer, 20';
  ASSERT (SELECT "remainingQuantity" FROM "costLedger" WHERE id = v_project_layer) = 0, 'The project layer must be used up';
  ASSERT (SELECT "remainingQuantity" FROM "costLedger" WHERE id = v_common_layer) = 8, 'The common layer must keep 8';
  ASSERT (SELECT "quantityIssued" FROM "jobMaterial" WHERE "jobId" = v_job) = 6, 'The material must be issued in full';

  -- (b) The project's stock is back at 2: a job of a project without project
  -- stock, and a job with no project, both draw common stock only.
  v_project_layer := pg_temp.stock(v_company_id, v_location_id, v_storage_unit_id, v_part, 2, 24, '2026-01-15', v_project);
  v_job := pg_temp.backflush(v_company_id, v_location_id, v_assembly, v_part, 'SJ-B1', 3, v_storage_unit_id, v_plain_project);
  ASSERT (SELECT count(*) FROM "itemLedger" WHERE "documentId" = v_job AND "entryType" = 'Consumption' AND "projectId" IS NULL AND quantity = -3) = 1,
    'A job of a project without project stock must draw common stock only';
  v_job := pg_temp.backflush(v_company_id, v_location_id, v_assembly, v_part, 'SJ-B2', 3, v_storage_unit_id, NULL);
  ASSERT (SELECT count(*) FROM "itemLedger" WHERE "documentId" = v_job AND "entryType" = 'Consumption' AND "projectId" IS NULL AND quantity = -3) = 1,
    'A job with no project must draw common stock only';
  ASSERT (SELECT -cost FROM "costLedger" WHERE "documentId" = v_job AND "documentType" = 'Job Consumption') = 30,
    'A common row must relieve common layers only, 30';
  ASSERT (SELECT "remainingQuantity" FROM "costLedger" WHERE id = v_project_layer) = 2, 'The project layer must be untouched';
  ASSERT (SELECT "remainingQuantity" FROM "costLedger" WHERE id = v_common_layer) = 2, 'The common layer must keep 2';
  ASSERT (SELECT "quantityOnHand" FROM "itemStockQuantities" WHERE "itemId" = v_part AND "locationId" = v_location_id AND "projectId" = v_project) = 2,
    'The project stripe must keep its 2 on hand';

  RAISE NOTICE 'ALL BACKFLUSH PROJECT STRIPE CASES PASSED (project then common, one row per stripe, layers per stripe, common demand draws common only)';
END;
$cases$;
ROLLBACK;
