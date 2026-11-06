-- The SQL backflush (backflush_job_materials) takes untracked stock from the
-- bins that hold it (20261105230630_backflush-split-across-bins.sql, the rule
-- of planStripedUntrackedDraw): the named bin gives what it holds, then nettable
-- warehouse bins and no storage unit give the rest, fullest first. A guess
-- never takes from a non-nettable unit, and a real shortfall stays on the
-- named bin, else the first bin drawn.
-- Isolated fixture company; no existing business data is read or edited. Always rolls back.
-- Run: pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -f packages/database/supabase/tests/backflush-split-across-bins.test.sql
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
  v_assembly text; v_part text; v_bin_b text; v_quarantine text;
  v_wip_account text; v_raw_account text; v_other_account text;
  v_job text;
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy") VALUES ('Backflush split test', 'system') RETURNING id INTO v_group_id;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Backflush split test', v_group_id, 'USD', 'UTC') RETURNING id INTO v_company_id;
  INSERT INTO location (name, "addressLine1", city, "postalCode", "companyId", "createdBy", timezone)
    VALUES ('Plant', '1 Test Way', 'Testville', '00000', v_company_id, 'system', 'UTC') RETURNING id INTO v_location_id;
  INSERT INTO "storageUnit" (name, "locationId", "companyId", "createdBy")
    VALUES ('A-1', v_location_id, v_company_id, 'system') RETURNING id INTO v_storage_unit_id;
  INSERT INTO "storageUnit" (name, "locationId", "companyId", "createdBy")
    VALUES ('B-1', v_location_id, v_company_id, 'system') RETURNING id INTO v_bin_b;
  INSERT INTO "storageUnit" (name, "locationId", nettable, "companyId", "createdBy")
    VALUES ('QUARANTINE', v_location_id, false, v_company_id, 'system') RETURNING id INTO v_quarantine;
  INSERT INTO "unitOfMeasure" (code, name, "companyId", "createdBy")
    VALUES ('EA', 'Each', v_company_id, 'system') ON CONFLICT DO NOTHING;
  INSERT INTO item ("readableId", name, type, "replenishmentSystem", "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
    VALUES ('SP-ASSY', 'Assembly', 'Part', 'Make', 'Inventory', 'EA', v_company_id, 'system') RETURNING id INTO v_assembly;
  INSERT INTO item ("readableId", name, type, "replenishmentSystem", "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
    VALUES ('SP-PART', 'Split part', 'Part', 'Buy', 'Inventory', 'EA', v_company_id, 'system') RETURNING id INTO v_part;
  -- An item insert may already have created its cost row.
  DELETE FROM "itemCost" WHERE "companyId" = v_company_id AND "itemId" = v_part;
  INSERT INTO "itemCost" ("itemId", "costingMethod", "unitCost", "companyId", "createdBy")
    VALUES (v_part, 'FIFO', 0, v_company_id, 'system');

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

  -- Each case uses its own part, so its bins start empty.
  -- (a) The named bin A-1 is empty and 5 sit with no storage unit: the 2 come
  -- from no storage unit, and A-1 stays at 0.
  PERFORM pg_temp.stock(v_company_id, v_location_id, NULL, v_part, 5, 50, '2026-01-01', NULL);
  v_job := pg_temp.backflush(v_company_id, v_location_id, v_assembly, v_part, 'SP-A', 2, v_storage_unit_id, NULL);
  ASSERT (SELECT count(*) FROM "itemLedger" WHERE "documentId" = v_job AND "entryType" = 'Consumption') = 1,
    'An empty named bin must not be drawn';
  ASSERT (SELECT quantity FROM "itemLedger" WHERE "documentId" = v_job AND "entryType" = 'Consumption' AND "storageUnitId" IS NULL) = -2,
    'The 2 must come from no storage unit, which holds the stock';
  ASSERT (SELECT "quantityIssued" FROM "jobMaterial" WHERE "jobId" = v_job) = 2, 'The material must be issued in full';

  -- (b) A-1 holds 3 and B-1 holds 10 (no storage unit still holds 3): 5 take
  -- A-1's 3, then 2 from B-1, the fullest other bin.
  PERFORM pg_temp.stock(v_company_id, v_location_id, v_storage_unit_id, v_part, 3, 30, '2026-01-02', NULL);
  PERFORM pg_temp.stock(v_company_id, v_location_id, v_bin_b, v_part, 10, 100, '2026-01-03', NULL);
  v_job := pg_temp.backflush(v_company_id, v_location_id, v_assembly, v_part, 'SP-B', 5, v_storage_unit_id, NULL);
  ASSERT (SELECT quantity FROM "itemLedger" WHERE "documentId" = v_job AND "entryType" = 'Consumption' AND "storageUnitId" = v_storage_unit_id) = -3,
    'The named bin must give the 3 it holds';
  ASSERT (SELECT quantity FROM "itemLedger" WHERE "documentId" = v_job AND "entryType" = 'Consumption' AND "storageUnitId" = v_bin_b) = -2,
    'The fullest other bin must give the other 2';

  -- (c) No bin named, 20 in QUARANTINE (non-nettable): a 20 draw takes B-1's
  -- 8, no storage unit's 3, and leaves the shortfall of 9 on B-1, never on
  -- QUARANTINE.
  PERFORM pg_temp.stock(v_company_id, v_location_id, v_quarantine, v_part, 20, 200, '2026-01-04', NULL);
  v_job := pg_temp.backflush(v_company_id, v_location_id, v_assembly, v_part, 'SP-C', 20, NULL, NULL);
  ASSERT (SELECT count(*) FROM "itemLedger" WHERE "documentId" = v_job AND "storageUnitId" = v_quarantine) = 0,
    'A guess must never draw a non-nettable unit';
  ASSERT (SELECT quantity FROM "itemLedger" WHERE "documentId" = v_job AND "entryType" = 'Consumption' AND "storageUnitId" = v_bin_b) = -17,
    'B-1 must give its 8 and carry the shortfall of 9';
  ASSERT (SELECT quantity FROM "itemLedger" WHERE "documentId" = v_job AND "entryType" = 'Consumption' AND "storageUnitId" IS NULL) = -3,
    'No storage unit must give its 3';

  RAISE NOTICE 'ALL BACKFLUSH SPLIT CASES PASSED (empty named bin, short named bin, no bin named with quarantine)';
END;
$cases$;
ROLLBACK;
