-- Job completion to a fixed asset (complete_job_to_inventory, Make to Asset).
-- Isolated fixture company; no existing business data is read or edited. Always rolls back.
-- Run: pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -f packages/database/supabase/tests/job-completion-to-asset.test.sql
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '60s';

-- A job for p_item_id with p_quantity units. For a serial item, p_split splits
-- the job's serial placeholder into numbered single units (<job>-01, -02, ...),
-- as the item serial sequence does at job creation; otherwise the placeholder is
-- left as created. Every job consumes 2 of p_part_id per unit, pulled from
-- inventory.
CREATE FUNCTION pg_temp.make_job(
  p_company_id text, p_location_id text, p_item_id text, p_part_id text,
  p_readable_id text, p_quantity numeric, p_split boolean DEFAULT true
) RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE
  v_job_id text;
  v_make_method_id text;
  v_seed record;
BEGIN
  INSERT INTO job ("jobId", "itemId", quantity, "locationId", "companyId", "createdBy", "unitOfMeasureCode")
    VALUES (p_readable_id, p_item_id, p_quantity, p_location_id, p_company_id, 'system', 'EA')
    RETURNING id INTO v_job_id;

  SELECT id INTO STRICT v_make_method_id
  FROM "jobMakeMethod" WHERE "jobId" = v_job_id AND "parentMaterialId" IS NULL;

  INSERT INTO "jobMaterial" ("jobId", "jobMakeMethodId", "itemId", description, "methodType",
      "itemType", quantity, "estimatedQuantity", "companyId", "createdBy")
    VALUES (v_job_id, v_make_method_id, p_part_id, 'Stocked part', 'Pull from Inventory',
      'Part', 2, 2 * p_quantity, p_company_id, 'system');

  SELECT * INTO v_seed FROM "trackedEntity" WHERE attributes->>'Job Make Method' = v_make_method_id;
  IF v_seed.id IS NOT NULL AND p_split THEN
    UPDATE "trackedEntity" SET quantity = 1, "readableId" = p_readable_id || '-01' WHERE id = v_seed.id;
    FOR n IN 2..p_quantity::int LOOP
      INSERT INTO "trackedEntity" ("sourceDocument", "sourceDocumentId", "sourceDocumentReadableId",
          quantity, status, "companyId", "createdBy", attributes, "itemId", "readableId")
        VALUES (v_seed."sourceDocument", v_seed."sourceDocumentId", v_seed."sourceDocumentReadableId",
          1, 'Reserved', p_company_id, 'system', v_seed.attributes, v_seed."itemId",
          p_readable_id || '-' || lpad(n::text, 2, '0'));
    END LOOP;
  END IF;

  RETURN v_job_id;
END;
$fn$;

-- Completes the job; returns the error message, or NULL when it succeeded.
-- The exception block rolls a refused completion back, so state is unchanged.
CREATE FUNCTION pg_temp.try_complete(p_job_id text, p_quantity numeric) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v_job record;
BEGIN
  SELECT * INTO STRICT v_job FROM job WHERE id = p_job_id;
  PERFORM complete_job_to_inventory(p_job_id, p_quantity, NULL, v_job."locationId", v_job."companyId", 'system');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END;
$fn$;

-- One hour of labor on p_work_center against a new operation of the job, not
-- yet posted: the completion's catch-up loop turns it into WIP at the work
-- center's labor rate.
CREATE FUNCTION pg_temp.log_labor(p_job_id text, p_process text, p_work_center text, p_company_id text) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE v_operation text;
BEGIN
  INSERT INTO "jobOperation" ("jobId", "jobMakeMethodId", "processId", "workCenterId", "operationQuantity", status, "companyId", "createdBy")
    SELECT p_job_id, m.id, p_process, p_work_center, j.quantity, 'In Progress', p_company_id, 'system'
    FROM "jobMakeMethod" m JOIN job j ON j.id = m."jobId"
    WHERE m."jobId" = p_job_id AND m."parentMaterialId" IS NULL
    RETURNING id INTO v_operation;
  INSERT INTO "productionEvent" ("jobOperationId", "workCenterId", type, "startTime", "endTime", "companyId", "createdBy")
    VALUES (v_operation, p_work_center, 'Labor', now() - interval '1 hour', now(), p_company_id, 'system');
END;
$fn$;

-- Net WIP posted against a job.
CREATE FUNCTION pg_temp.wip(p_job_id text, p_wip_account text) RETURNS numeric LANGUAGE sql AS $fn$
  SELECT round(COALESCE(sum(amount), 0), 5) FROM "journalLine"
  WHERE "documentId" = p_job_id AND "accountId" = p_wip_account;
$fn$;

-- Rounded to the internal quantity scale, as the sibling job-completion test does.
CREATE FUNCTION pg_temp.issued(p_job_id text) RETURNS numeric LANGUAGE sql AS $fn$
  SELECT round(sum("quantityIssued"), 5) FROM "jobMaterial" WHERE "jobId" = p_job_id;
$fn$;

-- "<serial>:<status>:<asset id or ->" for every serial on the job, by serial number.
CREATE FUNCTION pg_temp.serials(p_job_id text) RETURNS text LANGUAGE sql AS $fn$
  SELECT string_agg(te."readableId" || ':' || te.status || ':' || COALESCE(te.attributes->>'Fixed Asset', '-'), ',' ORDER BY te."readableId")
  FROM "trackedEntity" te
  JOIN "jobMakeMethod" m ON m.id = te.attributes->>'Job Make Method' AND m."parentMaterialId" IS NULL
  WHERE m."jobId" = p_job_id;
$fn$;

DO $cases$
DECLARE
  v_group_id text; v_company_id text; v_location_id text;
  v_serial_item text; v_stocked_item text; v_part text;
  v_job text; v_error text; v_row record; v_defaults jsonb;
  v_process text; v_wc_fleet text; v_wc_cip text;
  v_wip_account text; v_finished_account text; v_labor_account text; v_other_account text;
  v_fleet_account text; v_cip_account text;
  v_fleet_class text; v_cip_class text; v_cip_asset text; v_journal text;
  v_assets int; v_transfers int; v_journals int; v_activities int;
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy") VALUES ('Job to asset test', 'system') RETURNING id INTO v_group_id;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Job to asset test', v_group_id, 'USD', 'UTC') RETURNING id INTO v_company_id;
  INSERT INTO location (name, "addressLine1", city, "postalCode", "companyId", "createdBy", timezone)
    VALUES ('Plant', '1 Test Way', 'Testville', '00000', v_company_id, 'system', 'UTC') RETURNING id INTO v_location_id;
  INSERT INTO "unitOfMeasure" (code, name, "companyId", "createdBy")
    VALUES ('EA', 'Each', v_company_id, 'system') ON CONFLICT DO NOTHING;
  INSERT INTO item ("readableId", name, type, "replenishmentSystem", "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
    VALUES ('T-VEHICLE', 'Utility vehicle', 'Part', 'Make', 'Serial', 'EA', v_company_id, 'system') RETURNING id INTO v_serial_item;
  INSERT INTO item ("readableId", name, type, "replenishmentSystem", "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
    VALUES ('T-STOCKED', 'Stocked assembly', 'Part', 'Make', 'Inventory', 'EA', v_company_id, 'system') RETURNING id INTO v_stocked_item;
  INSERT INTO item ("readableId", name, type, "replenishmentSystem", "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
    VALUES ('T-PART', 'Stocked part', 'Part', 'Buy', 'Inventory', 'EA', v_company_id, 'system') RETURNING id INTO v_part;

  -- Accounting on, with the defaults, sequences and asset classes a fleet needs.
  UPDATE "companySettings" SET "accountingEnabled" = true WHERE id = v_company_id;
  IF NOT FOUND THEN
    INSERT INTO "companySettings" (id, "accountingEnabled") VALUES (v_company_id, true);
  END IF;
  INSERT INTO "sequence" ("table", name, prefix, "companyId", "updatedBy") VALUES
    ('journalEntry', 'Journal entries', 'JE-', v_company_id, 'system'),
    ('fixedAsset', 'Fixed assets', 'FA-', v_company_id, 'system'),
    ('fixedAssetTransfer', 'Asset transfers', 'FAT-', v_company_id, 'system')
  ON CONFLICT DO NOTHING;
  INSERT INTO account (name, class, "accountType", "incomeBalance", "companyGroupId", "createdBy")
    VALUES ('WIP', 'Asset', 'Bank', 'Balance Sheet', v_group_id, 'system') RETURNING id INTO v_wip_account;
  INSERT INTO account (name, class, "accountType", "incomeBalance", "companyGroupId", "createdBy")
    VALUES ('Finished goods', 'Asset', 'Bank', 'Balance Sheet', v_group_id, 'system') RETURNING id INTO v_finished_account;
  INSERT INTO account (name, class, "accountType", "incomeBalance", "companyGroupId", "createdBy")
    VALUES ('Labor absorption', 'Expense', 'Expense', 'Income Statement', v_group_id, 'system') RETURNING id INTO v_labor_account;
  INSERT INTO account (name, class, "accountType", "incomeBalance", "companyGroupId", "createdBy")
    VALUES ('Other', 'Expense', 'Expense', 'Income Statement', v_group_id, 'system') RETURNING id INTO v_other_account;
  INSERT INTO account (name, class, "accountType", "incomeBalance", "companyGroupId", "createdBy")
    VALUES ('Rental Fleet', 'Asset', 'Bank', 'Balance Sheet', v_group_id, 'system') RETURNING id INTO v_fleet_account;
  INSERT INTO account (name, class, "accountType", "incomeBalance", "companyGroupId", "createdBy")
    VALUES ('Construction in Progress', 'Asset', 'Bank', 'Balance Sheet', v_group_id, 'system') RETURNING id INTO v_cip_account;
  SELECT jsonb_object_agg(attname, to_jsonb(v_other_account)) INTO v_defaults
    FROM pg_attribute WHERE attrelid = '"accountDefault"'::regclass AND attnum > 0 AND NOT attisdropped AND attnotnull AND attname <> 'companyId';
  INSERT INTO "accountDefault" SELECT (jsonb_populate_record(NULL::"accountDefault", v_defaults || jsonb_build_object(
    'companyId', v_company_id, 'workInProgressAccount', v_wip_account, 'finishedGoodsAccount', v_finished_account,
    'laborAbsorptionAccount', v_labor_account))).*;

  INSERT INTO "fixedAssetClass" (name, "usefulLifeMonths", "residualValuePercent", "assetAccountId", "accumulatedDepreciationAccountId",
      "depreciationExpenseAccountId", "writeOffAccountId", "writeDownAccountId", "lossOnDisposalAccountId", "gainOnDisposalAccountId",
      "companyId", "createdBy")
    VALUES ('Rental Fleet', 60, 20, v_fleet_account, v_other_account, v_other_account, v_other_account, v_other_account, v_other_account, v_other_account,
      v_company_id, 'system') RETURNING id INTO v_fleet_class;
  INSERT INTO "fixedAssetClass" (name, "isConstructionInProgress", "assetAccountId", "accumulatedDepreciationAccountId",
      "depreciationExpenseAccountId", "writeOffAccountId", "writeDownAccountId", "lossOnDisposalAccountId", "gainOnDisposalAccountId",
      "companyId", "createdBy")
    VALUES ('Construction in Progress', true, v_cip_account, v_other_account, v_other_account, v_other_account, v_other_account, v_other_account, v_other_account,
      v_company_id, 'system') RETURNING id INTO v_cip_class;

  -- Labor rates chosen so one logged hour is the WIP each case expects.
  INSERT INTO process (name, "processType", "defaultStandardFactor", "companyId", "createdBy")
    VALUES ('Assembly', 'Process', 'Hours/Piece', v_company_id, 'system') RETURNING id INTO v_process;
  INSERT INTO "workCenter" (name, "locationId", "laborRate", "machineRate", "overheadRate", "defaultStandardFactor", "companyId", "createdBy")
    VALUES ('Fleet line', v_location_id, 84000, 0, 0, 'Hours/Piece', v_company_id, 'system') RETURNING id INTO v_wc_fleet;
  INSERT INTO "workCenter" (name, "locationId", "laborRate", "machineRate", "overheadRate", "defaultStandardFactor", "companyId", "createdBy")
    VALUES ('Fabrication', v_location_id, 1500, 0, 0, 'Hours/Piece', v_company_id, 'system') RETURNING id INTO v_wc_cip;

  -- (a) A serial job of 2 targeting the Rental Fleet class, with 84,000 of WIP:
  -- two assets at 42,000 each, no stock, one Asset Transfer journal.
  v_job := pg_temp.make_job(v_company_id, v_location_id, v_serial_item, v_part, 'FJ', 2);
  UPDATE job SET "fixedAssetClassId" = v_fleet_class WHERE id = v_job;
  PERFORM pg_temp.log_labor(v_job, v_process, v_wc_fleet, v_company_id);

  v_error := pg_temp.try_complete(v_job, 2);
  ASSERT v_error IS NULL, 'Fleet job at 2 failed: ' || COALESCE(v_error, '');

  SELECT status, "quantityComplete", "quantityReceivedToInventory" INTO v_row FROM job WHERE id = v_job;
  ASSERT v_row.status = 'Completed' AND v_row."quantityComplete" = 2 AND v_row."quantityReceivedToInventory" = 2, 'The fleet job must record 2 completed';
  ASSERT (SELECT count(*) FROM "fixedAsset" WHERE "companyId" = v_company_id AND "fixedAssetClassId" = v_fleet_class) = 2, 'Two fleet assets must be created';
  ASSERT (SELECT count(*) FROM "fixedAsset" WHERE "companyId" = v_company_id AND "fixedAssetClassId" = v_fleet_class
            AND status = 'Active' AND "acquisitionCost" = 42000 AND "itemId" = v_serial_item AND "trackedEntityId" IS NOT NULL
            AND "locationId" = v_location_id AND "usefulLifeMonths" = 60 AND "residualValuePercent" = 20 AND "serialNumber" IS NOT NULL) = 2,
    'Both fleet assets must be Active at 42,000 with their unit, location and the class terms';
  ASSERT (SELECT string_agg(name, ',' ORDER BY name) FROM "fixedAsset" WHERE "companyId" = v_company_id AND "fixedAssetClassId" = v_fleet_class)
    = 'Utility vehicle FJ-01,Utility vehicle FJ-02', 'Assets are named after the item and serial';
  ASSERT (SELECT count(*) FROM "fixedAssetTransfer" WHERE "companyId" = v_company_id AND "jobId" = v_job AND type = 'Capitalization'
            AND "sourceType" = 'Job' AND amount = 42000 AND status = 'Posted' AND "journalId" IS NOT NULL AND "trackedEntityId" IS NOT NULL) = 2,
    'Two posted Job transfers at 42,000 must point at the journal';
  ASSERT (SELECT count(*) FROM "itemLedger" WHERE "documentId" = v_job AND "documentType" = 'Job Receipt') = 0, 'A fleet job must not receive stock';
  ASSERT (SELECT count(*) FROM "costLedger" WHERE "documentId" = v_job) = 0, 'A fleet job must not create a cost layer';
  ASSERT NOT EXISTS (SELECT 1 FROM "pickMethod" WHERE "itemId" = v_serial_item AND "companyId" = v_company_id), 'A fleet job must not create a pick method';
  ASSERT pg_temp.serials(v_job) = 'FJ-01:Consumed:' || (SELECT id FROM "fixedAsset" WHERE "companyId" = v_company_id AND "serialNumber" = 'FJ-01')
    || ',FJ-02:Consumed:' || (SELECT id FROM "fixedAsset" WHERE "companyId" = v_company_id AND "serialNumber" = 'FJ-02'),
    'Both units must be Consumed into their asset: ' || pg_temp.serials(v_job);
  ASSERT (SELECT count(*) FROM "trackedActivity" ta JOIN "trackedActivityInput" tai ON tai."trackedActivityId" = ta.id
            WHERE ta."companyId" = v_company_id AND ta.type = 'Capitalize' AND ta."sourceDocument" = 'Fixed Asset' AND ta.attributes->>'Job' = v_job) = 2,
    'Each unit must carry a Capitalize activity';

  SELECT j.id INTO v_journal FROM journal j WHERE j."companyId" = v_company_id AND j."sourceType" = 'Asset Transfer';
  ASSERT v_journal IS NOT NULL, 'The WIP discharge must post as an Asset Transfer journal';
  ASSERT (SELECT description FROM journal WHERE id = v_journal) = 'Job Completion to Fixed Asset FJ', 'Journal description names the job';
  ASSERT NOT EXISTS (SELECT 1 FROM journal WHERE "companyId" = v_company_id AND "sourceType" = 'Job Receipt'), 'No Job Receipt journal for a fleet job';
  ASSERT (SELECT count(*) FROM "journalLine" WHERE "journalId" = v_journal AND "accountId" = v_fleet_account AND amount = 84000
            AND "documentType" = 'Asset Transfer' AND "documentId" = v_job AND description = 'Fixed Asset') = 1,
    'The debit must land on the class asset account for the whole WIP';
  ASSERT (SELECT count(*) FROM "journalLine" WHERE "journalId" = v_journal AND "accountId" = v_wip_account AND amount = -84000
            AND "documentType" = 'Asset Transfer' AND "documentId" = v_job) = 1,
    'The WIP credit must stay documented against the job';
  ASSERT pg_temp.wip(v_job, v_wip_account) = 0, 'The fleet job WIP must net to zero: ' || pg_temp.wip(v_job, v_wip_account);
  ASSERT pg_temp.issued(v_job) = 4, 'Backflush still consumes for 2 units: ' || pg_temp.issued(v_job);

  -- Completing again changes nothing.
  SELECT count(*) INTO v_assets FROM "fixedAsset" WHERE "companyId" = v_company_id;
  SELECT count(*) INTO v_transfers FROM "fixedAssetTransfer" WHERE "companyId" = v_company_id;
  SELECT count(*) INTO v_journals FROM journal WHERE "companyId" = v_company_id;
  SELECT count(*) INTO v_activities FROM "trackedActivity" WHERE "companyId" = v_company_id;
  v_error := pg_temp.try_complete(v_job, 2);
  ASSERT v_error IS NULL, 'Fleet re-completion failed: ' || COALESCE(v_error, '');
  ASSERT (SELECT count(*) FROM "fixedAsset" WHERE "companyId" = v_company_id) = v_assets, 'Re-completion must not create assets';
  ASSERT (SELECT count(*) FROM "fixedAssetTransfer" WHERE "companyId" = v_company_id) = v_transfers, 'Re-completion must not create transfers';
  ASSERT (SELECT count(*) FROM journal WHERE "companyId" = v_company_id) = v_journals, 'Re-completion must not post';
  ASSERT (SELECT count(*) FROM "trackedActivity" WHERE "companyId" = v_company_id) = v_activities, 'Re-completion must not log activities';
  ASSERT (SELECT count(*) FROM "fixedAsset" WHERE "companyId" = v_company_id AND "acquisitionCost" = 42000) = 2, 'Re-completion must not reprice';

  -- (b) An untracked job of 3 with a class target is refused before anything moves.
  v_job := pg_temp.make_job(v_company_id, v_location_id, v_stocked_item, v_part, 'UJ', 3);
  UPDATE job SET "fixedAssetClassId" = v_fleet_class WHERE id = v_job;
  v_error := pg_temp.try_complete(v_job, 3);
  ASSERT v_error LIKE 'Make to Asset needs a serialized item or a quantity of one%', 'An untracked job of 3 must be refused, got: ' || COALESCE(v_error, 'success');
  ASSERT (SELECT status FROM job WHERE id = v_job) <> 'Completed', 'A refused asset completion must not complete the job';
  ASSERT (SELECT count(*) FROM "fixedAsset" WHERE "companyId" = v_company_id) = v_assets, 'A refused asset completion must not create assets';

  -- A single untracked unit is fine: one asset named after the job.
  v_job := pg_temp.make_job(v_company_id, v_location_id, v_stocked_item, v_part, 'OJ', 1);
  UPDATE job SET "fixedAssetClassId" = v_fleet_class WHERE id = v_job;
  v_error := pg_temp.try_complete(v_job, 1);
  ASSERT v_error IS NULL, 'Untracked job at 1 failed: ' || COALESCE(v_error, '');
  ASSERT (SELECT count(*) FROM "fixedAsset" WHERE "companyId" = v_company_id AND name = 'Stocked assembly OJ' AND "trackedEntityId" IS NULL
            AND "itemId" = v_stocked_item AND status = 'Active' AND "acquisitionCost" = 0) = 1,
    'A single untracked unit becomes one asset at cost 0 when the job carried no WIP';
  ASSERT (SELECT count(*) FROM "itemLedger" WHERE "documentId" = v_job AND "documentType" = 'Job Receipt') = 0, 'The untracked asset unit must not enter stock';

  -- (c) Construction in Progress: a job attached to a CIP asset sweeps 1,500 of
  -- WIP onto it as one CIP cost row; the asset is Under Construction.
  INSERT INTO "fixedAsset" ("fixedAssetId", "fixedAssetClassId", name, "companyId", "createdBy")
    VALUES ('FA-CIP', v_cip_class, 'Prototype rig', v_company_id, 'system') RETURNING id INTO v_cip_asset;
  v_job := pg_temp.make_job(v_company_id, v_location_id, v_stocked_item, v_part, 'CJ', 1);
  UPDATE job SET "fixedAssetId" = v_cip_asset WHERE id = v_job;
  PERFORM pg_temp.log_labor(v_job, v_process, v_wc_cip, v_company_id);

  v_error := pg_temp.try_complete(v_job, 1);
  ASSERT v_error IS NULL, 'CIP job at 1 failed: ' || COALESCE(v_error, '');
  ASSERT (SELECT count(*) FROM "fixedAssetCipCost" WHERE "companyId" = v_company_id AND "fixedAssetId" = v_cip_asset
            AND "sourceType" = 'Job' AND "jobId" = v_job AND amount = 1500 AND "journalId" IS NOT NULL) = 1,
    'The CIP asset must get one cost row of 1,500 linked to the journal';
  SELECT status, "acquisitionCost" INTO v_row FROM "fixedAsset" WHERE id = v_cip_asset;
  ASSERT v_row.status = 'Under Construction' AND v_row."acquisitionCost" = 1500, 'The CIP asset must be Under Construction at 1,500';
  ASSERT (SELECT count(*) FROM "fixedAssetTransfer" WHERE "companyId" = v_company_id AND "fixedAssetId" = v_cip_asset
            AND type = 'Capitalization' AND "sourceType" = 'Job' AND "jobId" = v_job AND amount = 1500 AND "journalId" IS NOT NULL) = 1,
    'The sweep must be recorded as one Job transfer';
  ASSERT (SELECT count(*) FROM "fixedAsset" WHERE "companyId" = v_company_id) = v_assets + 2, 'A CIP sweep must not create a new asset';
  ASSERT (SELECT count(*) FROM "itemLedger" WHERE "documentId" = v_job AND "documentType" = 'Job Receipt') = 0, 'A CIP job must not receive stock';
  ASSERT (SELECT count(*) FROM "costLedger" WHERE "documentId" = v_job) = 0, 'A CIP job must not create a cost layer';
  ASSERT (SELECT count(*) FROM "journalLine" jl JOIN journal j ON j.id = jl."journalId"
            WHERE j."companyId" = v_company_id AND j."sourceType" = 'Asset Transfer' AND jl."accountId" = v_cip_account
              AND jl.amount = 1500 AND jl."documentId" = v_job AND jl."documentType" = 'Asset Transfer') = 1,
    'The CIP debit must land on the CIP class asset account';
  ASSERT pg_temp.wip(v_job, v_wip_account) = 0, 'The CIP job WIP must net to zero: ' || pg_temp.wip(v_job, v_wip_account);

  -- A job attached to a live (non-CIP) asset is refused: WIP never restates a
  -- depreciating asset's basis.
  v_job := pg_temp.make_job(v_company_id, v_location_id, v_stocked_item, v_part, 'LJ', 1);
  UPDATE job SET "fixedAssetId" = (SELECT id FROM "fixedAsset" WHERE "companyId" = v_company_id AND "serialNumber" = 'FJ-01') WHERE id = v_job;
  v_error := pg_temp.try_complete(v_job, 1);
  ASSERT v_error LIKE 'Job LJ targets fixed asset % which is not in a Construction in Progress class%', 'A live asset target must be refused, got: ' || COALESCE(v_error, 'success');
  ASSERT (SELECT "acquisitionCost" FROM "fixedAsset" WHERE "companyId" = v_company_id AND "serialNumber" = 'FJ-01') = 42000, 'A refused sweep must not touch the asset';

  RAISE NOTICE 'ALL JOB COMPLETION TO ASSET CASES PASSED (serial fleet job priced from WIP, no stock/cost layer, Asset Transfer journal, units consumed, re-completion no-op, untracked qty>1 refused, single untracked unit, CIP sweep, live asset refused)';
END;
$cases$;
ROLLBACK;
