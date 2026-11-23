-- The SQL backflush (backflush_job_materials) relieves FIFO cost layers as
-- calculateCOGS does (packages/server-functions/src/lib/calculate-cogs.ts):
-- unstamped layers first, the children of an unstamped layer in turn, and every
-- child of a layer stamped for one serial unit in full.
-- Isolated fixture company; no existing business data is read or edited. Always rolls back.
-- Run: pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -f packages/database/supabase/tests/backflush-layer-children.test.sql
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '60s';

-- A job of 1 for p_assembly that pulls p_quantity of p_part from inventory,
-- backflushed for its 1 unit. Returns the job id.
CREATE FUNCTION pg_temp.backflush(
  p_company_id text, p_location_id text, p_assembly text, p_part text,
  p_readable_id text, p_quantity numeric
) RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE
  v_job_id text;
  v_make_method_id text;
BEGIN
  INSERT INTO job ("jobId", "itemId", quantity, "locationId", "companyId", "createdBy", "unitOfMeasureCode")
    VALUES (p_readable_id, p_assembly, 1, p_location_id, p_company_id, 'system', 'EA')
    RETURNING id INTO v_job_id;

  SELECT id INTO STRICT v_make_method_id
  FROM "jobMakeMethod" WHERE "jobId" = v_job_id AND "parentMaterialId" IS NULL;

  INSERT INTO "jobMaterial" ("jobId", "jobMakeMethodId", "itemId", description, "methodType",
      "itemType", quantity, "estimatedQuantity", "companyId", "createdBy")
    VALUES (v_job_id, v_make_method_id, p_part, 'Stocked part', 'Pull from Inventory',
      'Part', p_quantity, p_quantity, p_company_id, 'system');

  PERFORM backflush_job_materials(v_job_id, 1, p_company_id, 'system');
  RETURN v_job_id;
END;
$fn$;

-- The cost the backflush relieved for a job, from its consumption cost entry.
CREATE FUNCTION pg_temp.relieved(p_job_id text) RETURNS numeric LANGUAGE sql AS $fn$
  SELECT round(-sum(cost), 5) FROM "costLedger"
  WHERE "documentId" = p_job_id AND "documentType" = 'Job Consumption';
$fn$;

-- A cost entry for p_item_id: a layer, or a child of p_parent when it is set.
-- now() is fixed inside the transaction, so each entry is stamped p_seq seconds
-- after it: children apply in createdAt order.
CREATE FUNCTION pg_temp.layer(
  p_company_id text, p_item_id text, p_quantity numeric, p_cost numeric,
  p_posting_date date, p_seq int, p_tracked_entity_id text DEFAULT NULL, p_parent text DEFAULT NULL
) RETURNS text LANGUAGE sql AS $fn$
  INSERT INTO "costLedger" ("itemLedgerType", "costLedgerType", adjustment, "appliesToCostLedgerId",
      "itemId", quantity, cost, "remainingQuantity", "postingDate", "trackedEntityId", "companyId", "createdAt")
    VALUES ('Purchase', CASE WHEN p_parent IS NULL THEN 'Direct Cost' ELSE 'Revaluation' END::"costLedgerType",
      p_parent IS NOT NULL, p_parent, p_item_id, p_quantity, p_cost, p_quantity, p_posting_date,
      p_tracked_entity_id, p_company_id, now() + p_seq * interval '1 second')
    RETURNING id;
$fn$;

DO $cases$
DECLARE
  v_group_id text; v_company_id text; v_location_id text; v_defaults jsonb;
  v_assembly text; v_unstamped_item text; v_serial_item text; v_plain_item text;
  v_wip_account text; v_raw_account text; v_other_account text;
  v_layer text; v_child_a text; v_child_b text; v_stamped text; v_newer text;
  v_serial text; v_job text;
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy") VALUES ('Backflush layer test', 'system') RETURNING id INTO v_group_id;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Backflush layer test', v_group_id, 'USD', 'UTC') RETURNING id INTO v_company_id;
  INSERT INTO location (name, "addressLine1", city, "postalCode", "companyId", "createdBy", timezone)
    VALUES ('Plant', '1 Test Way', 'Testville', '00000', v_company_id, 'system', 'UTC') RETURNING id INTO v_location_id;
  INSERT INTO "unitOfMeasure" (code, name, "companyId", "createdBy")
    VALUES ('EA', 'Each', v_company_id, 'system') ON CONFLICT DO NOTHING;
  INSERT INTO item ("readableId", name, type, "replenishmentSystem", "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
    VALUES ('T-ASSY', 'Assembly', 'Part', 'Make', 'Inventory', 'EA', v_company_id, 'system') RETURNING id INTO v_assembly;
  INSERT INTO item ("readableId", name, type, "replenishmentSystem", "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
    VALUES ('T-ADJUSTED', 'Part with price variances', 'Part', 'Buy', 'Inventory', 'EA', v_company_id, 'system') RETURNING id INTO v_unstamped_item;
  INSERT INTO item ("readableId", name, type, "replenishmentSystem", "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
    VALUES ('T-REFURB', 'Part with a refurbished unit', 'Part', 'Buy', 'Inventory', 'EA', v_company_id, 'system') RETURNING id INTO v_serial_item;
  INSERT INTO item ("readableId", name, type, "replenishmentSystem", "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
    VALUES ('T-PLAIN', 'Part with no children', 'Part', 'Buy', 'Inventory', 'EA', v_company_id, 'system') RETURNING id INTO v_plain_item;
  -- An item insert may already have created its cost row.
  DELETE FROM "itemCost" WHERE "companyId" = v_company_id AND "itemId" IN (v_unstamped_item, v_serial_item, v_plain_item);
  INSERT INTO "itemCost" ("itemId", "costingMethod", "unitCost", "companyId", "createdBy")
    SELECT unnest(ARRAY[v_unstamped_item, v_serial_item, v_plain_item]), 'FIFO', 0, v_company_id, 'system';
  ASSERT (SELECT count(*) FROM "itemCost" WHERE "companyId" = v_company_id AND "costingMethod" = 'FIFO'
            AND "itemId" IN (v_unstamped_item, v_serial_item, v_plain_item)) = 3,
    'Each part must have a FIFO item cost';

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

  -- (a) An unstamped layer of 10 at 10.00 with two price variances, each on 5
  -- units: +2.00 and +4.00 a unit. The children cover the layer's units in
  -- turn, so 6 units relieve 6 x 10 + 5 x 2 + 1 x 4 = 74.
  v_layer := pg_temp.layer(v_company_id, v_unstamped_item, 10, 100, '2026-01-01', 1);
  v_child_a := pg_temp.layer(v_company_id, v_unstamped_item, 5, 10, '2026-01-01', 2, NULL, v_layer);
  v_child_b := pg_temp.layer(v_company_id, v_unstamped_item, 5, 20, '2026-01-01', 3, NULL, v_layer);
  v_job := pg_temp.backflush(v_company_id, v_location_id, v_assembly, v_unstamped_item, 'BJ-A', 6);
  ASSERT pg_temp.relieved(v_job) = 74, 'Unstamped layer with two children must relieve 74, got ' || COALESCE(pg_temp.relieved(v_job)::text, 'nothing');
  ASSERT (SELECT "remainingQuantity" FROM "costLedger" WHERE id = v_layer) = 4, 'The layer must keep 4 units';
  ASSERT (SELECT "remainingQuantity" FROM "costLedger" WHERE id = v_child_a) = 0, 'The first child must be used up';
  ASSERT (SELECT "remainingQuantity" FROM "costLedger" WHERE id = v_child_b) = 4, 'The second child must keep 4 units';

  -- (b) A unit stamped for one serial: its own layer at 100.00 (older) with a
  -- 200.00 revaluation and a 50.00 write-down, and an unstamped layer at 80.00
  -- (newer). The unstamped layer goes first, then the stamped unit leaves with
  -- both of its children: 100 + 200 - 50 = 250.
  INSERT INTO "trackedEntity" ("readableId", "itemId", quantity, "sourceDocument", "sourceDocumentId", "companyId", "createdBy")
    VALUES ('SN-0050', v_serial_item, 1, 'Item', v_serial_item, v_company_id, 'system') RETURNING id INTO v_serial;
  v_stamped := pg_temp.layer(v_company_id, v_serial_item, 1, 100, '2026-01-01', 1, v_serial);
  v_child_a := pg_temp.layer(v_company_id, v_serial_item, 1, 200, '2026-01-01', 2, NULL, v_stamped);
  v_child_b := pg_temp.layer(v_company_id, v_serial_item, 1, -50, '2026-01-01', 3, NULL, v_stamped);
  v_newer := pg_temp.layer(v_company_id, v_serial_item, 1, 80, '2026-02-01', 4);

  v_job := pg_temp.backflush(v_company_id, v_location_id, v_assembly, v_serial_item, 'BJ-B1', 1);
  ASSERT pg_temp.relieved(v_job) = 80, 'The unstamped layer must go before the stamped one, got ' || COALESCE(pg_temp.relieved(v_job)::text, 'nothing');
  ASSERT (SELECT "remainingQuantity" FROM "costLedger" WHERE id = v_stamped) = 1, 'The stamped layer must be untouched';

  v_job := pg_temp.backflush(v_company_id, v_location_id, v_assembly, v_serial_item, 'BJ-B2', 1);
  ASSERT pg_temp.relieved(v_job) = 250, 'The stamped layer must relieve both children, 250, got ' || COALESCE(pg_temp.relieved(v_job)::text, 'nothing');
  ASSERT (SELECT "remainingQuantity" FROM "costLedger" WHERE id = v_stamped) = 0, 'The stamped layer must be used up';
  ASSERT (SELECT "remainingQuantity" FROM "costLedger" WHERE id = v_child_a) = 0, 'The revaluation must be used up';
  ASSERT (SELECT "remainingQuantity" FROM "costLedger" WHERE id = v_child_b) = 0, 'The write-down must be used up';

  -- (c) Layers with no children relieve as before: 2 of a layer of 3 at 10.00.
  v_layer := pg_temp.layer(v_company_id, v_plain_item, 3, 30, '2026-01-01', 1);
  v_job := pg_temp.backflush(v_company_id, v_location_id, v_assembly, v_plain_item, 'BJ-C', 2);
  ASSERT pg_temp.relieved(v_job) = 20, 'A layer with no children must relieve 20, got ' || COALESCE(pg_temp.relieved(v_job)::text, 'nothing');
  ASSERT (SELECT "remainingQuantity" FROM "costLedger" WHERE id = v_layer) = 1, 'The plain layer must keep 1 unit';

  RAISE NOTICE 'ALL BACKFLUSH LAYER CHILDREN CASES PASSED (unstamped children in turn, unstamped before stamped, stamped children in full, no-children layer unchanged)';
END;
$cases$;
ROLLBACK;
