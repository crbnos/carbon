-- Job completion receives exactly the completed quantity (complete_job_to_inventory).
-- Isolated fixture company; no existing business data is read or edited. Always rolls back.
-- Run: pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -f packages/database/supabase/tests/job-completion-received-quantity.test.sql
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '60s';

-- A job for p_item_id with p_quantity units. For a serial item the job's serial
-- placeholder is split into numbered single units (<job>-01, -02, ...), as the
-- item serial sequence does at job creation. Every job consumes 2 of p_part_id
-- per unit, pulled from inventory.
CREATE FUNCTION pg_temp.make_job(
  p_company_id text, p_location_id text, p_item_id text, p_part_id text,
  p_readable_id text, p_quantity numeric
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
  IF v_seed.id IS NOT NULL THEN
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

-- "<serial>:<status>:<units received>" for every serial on the job, by serial number.
CREATE FUNCTION pg_temp.serials(p_job_id text) RETURNS text LANGUAGE sql AS $fn$
  SELECT string_agg(te."readableId" || ':' || te.status || ':' ||
      COALESCE((SELECT sum(il.quantity) FROM "itemLedger" il
        WHERE il."trackedEntityId" = te.id AND il."documentType" = 'Job Receipt'
          AND il."documentId" = p_job_id), 0)::int,
    ',' ORDER BY te."readableId")
  FROM "trackedEntity" te
  JOIN "jobMakeMethod" m ON m.id = te.attributes->>'Job Make Method' AND m."parentMaterialId" IS NULL
  WHERE m."jobId" = p_job_id;
$fn$;

-- Rounded to the internal quantity scale: backflush prorates by a ratio such as
-- 2/3, which leaves float noise far below it.
CREATE FUNCTION pg_temp.issued(p_job_id text) RETURNS numeric LANGUAGE sql AS $fn$
  SELECT round(sum("quantityIssued"), 5) FROM "jobMaterial" WHERE "jobId" = p_job_id;
$fn$;

DO $cases$
DECLARE
  v_group_id text; v_company_id text; v_location_id text;
  v_serial_item text; v_stocked_item text; v_service_item text; v_part text;
  v_job text; v_error text; v_row record;
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy") VALUES ('Job completion test', 'system') RETURNING id INTO v_group_id;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Job completion test', v_group_id, 'USD', 'UTC') RETURNING id INTO v_company_id;
  INSERT INTO location (name, "addressLine1", city, "postalCode", "companyId", "createdBy", timezone)
    VALUES ('Plant', '1 Test Way', 'Testville', '00000', v_company_id, 'system', 'UTC') RETURNING id INTO v_location_id;
  INSERT INTO "unitOfMeasure" (code, name, "companyId", "createdBy")
    VALUES ('EA', 'Each', v_company_id, 'system') ON CONFLICT DO NOTHING;
  INSERT INTO item ("readableId", name, type, "replenishmentSystem", "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
    VALUES ('T-SERIAL', 'Serial machine', 'Part', 'Make', 'Serial', 'EA', v_company_id, 'system') RETURNING id INTO v_serial_item;
  INSERT INTO item ("readableId", name, type, "replenishmentSystem", "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
    VALUES ('T-STOCKED', 'Stocked assembly', 'Part', 'Make', 'Inventory', 'EA', v_company_id, 'system') RETURNING id INTO v_stocked_item;
  INSERT INTO item ("readableId", name, type, "replenishmentSystem", "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
    VALUES ('T-SERVICE', 'Service', 'Part', 'Make', 'Non-Inventory', 'EA', v_company_id, 'system') RETURNING id INTO v_service_item;
  INSERT INTO item ("readableId", name, type, "replenishmentSystem", "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
    VALUES ('T-PART', 'Stocked part', 'Part', 'Buy', 'Inventory', 'EA', v_company_id, 'system') RETURNING id INTO v_part;

  -- Serial job: refusals leave the job untouched.
  v_job := pg_temp.make_job(v_company_id, v_location_id, v_serial_item, v_part, 'SJ', 3);
  v_error := pg_temp.try_complete(v_job, 0);
  ASSERT v_error LIKE 'Quantity completed must be greater than 0%', 'Serial job at 0 must be refused, got: ' || COALESCE(v_error, 'success');
  v_error := pg_temp.try_complete(v_job, 1.5);
  ASSERT v_error LIKE 'Quantity completed must be a whole number%', 'Serial job at 1.5 must be refused, got: ' || COALESCE(v_error, 'success');
  ASSERT pg_temp.serials(v_job) = 'SJ-01:Reserved:0,SJ-02:Reserved:0,SJ-03:Reserved:0', 'Refusals must not receive units: ' || pg_temp.serials(v_job);
  ASSERT (SELECT status FROM job WHERE id = v_job) <> 'Completed', 'Refusals must not complete the job';

  -- Completing 2 of 3 receives exactly 2 units and consumes for 2 units.
  v_error := pg_temp.try_complete(v_job, 2);
  ASSERT v_error IS NULL, 'Serial job at 2 failed: ' || COALESCE(v_error, '');
  ASSERT pg_temp.serials(v_job) = 'SJ-01:Available:1,SJ-02:Available:1,SJ-03:Reserved:0', 'Completing 2 must receive exactly 2 units: ' || pg_temp.serials(v_job);
  SELECT status, "quantityComplete", "quantityReceivedToInventory" INTO v_row FROM job WHERE id = v_job;
  ASSERT v_row.status = 'Completed' AND v_row."quantityComplete" = 2 AND v_row."quantityReceivedToInventory" = 2, 'Job must record 2 completed and received';
  ASSERT pg_temp.issued(v_job) = 4, 'Backflush must consume for 2 units: ' || pg_temp.issued(v_job);

  -- Completing the rest receives only the remaining unit.
  v_error := pg_temp.try_complete(v_job, 3);
  ASSERT v_error IS NULL, 'Serial job at 3 failed: ' || COALESCE(v_error, '');
  ASSERT pg_temp.serials(v_job) = 'SJ-01:Available:1,SJ-02:Available:1,SJ-03:Available:1', 'Completing 3 must receive the third unit once: ' || pg_temp.serials(v_job);
  ASSERT pg_temp.issued(v_job) = 6, 'Backflush must consume for 3 units: ' || pg_temp.issued(v_job);

  -- Completing again at the same quantity receives and consumes nothing more.
  v_error := pg_temp.try_complete(v_job, 3);
  ASSERT v_error IS NULL, 'Re-completion failed: ' || COALESCE(v_error, '');
  ASSERT pg_temp.serials(v_job) = 'SJ-01:Available:1,SJ-02:Available:1,SJ-03:Available:1', 'Re-completion must not receive a unit twice: ' || pg_temp.serials(v_job);
  ASSERT pg_temp.issued(v_job) = 6, 'Re-completion must not consume again: ' || pg_temp.issued(v_job);

  -- A unit finished on the shop floor is received ahead of lower serial numbers.
  v_job := pg_temp.make_job(v_company_id, v_location_id, v_serial_item, v_part, 'MJ', 3);
  UPDATE "trackedEntity" SET status = 'Available' WHERE "readableId" = 'MJ-03' AND "companyId" = v_company_id;
  v_error := pg_temp.try_complete(v_job, 1);
  ASSERT v_error IS NULL, 'Mixed job at 1 failed: ' || COALESCE(v_error, '');
  ASSERT pg_temp.serials(v_job) = 'MJ-01:Reserved:0,MJ-02:Reserved:0,MJ-03:Available:1', 'The shop-floor unit must be received first: ' || pg_temp.serials(v_job);

  -- A scrapped unit is never received.
  v_job := pg_temp.make_job(v_company_id, v_location_id, v_serial_item, v_part, 'XJ', 2);
  UPDATE "trackedEntity" SET status = 'Scrapped' WHERE "readableId" = 'XJ-01' AND "companyId" = v_company_id;
  v_error := pg_temp.try_complete(v_job, 2);
  ASSERT v_error IS NULL, 'Scrap job at 2 failed: ' || COALESCE(v_error, '');
  ASSERT pg_temp.serials(v_job) = 'XJ-01:Scrapped:0,XJ-02:Available:1', 'A scrapped unit must not be received: ' || pg_temp.serials(v_job);

  -- Inventory-tracked job: fractions are allowed, zero is refused.
  v_job := pg_temp.make_job(v_company_id, v_location_id, v_stocked_item, v_part, 'IJ', 2);
  v_error := pg_temp.try_complete(v_job, 0);
  ASSERT v_error LIKE 'Quantity completed must be greater than 0%', 'Inventory job at 0 must be refused, got: ' || COALESCE(v_error, 'success');
  v_error := pg_temp.try_complete(v_job, 1.5);
  ASSERT v_error IS NULL, 'Inventory job at 1.5 failed: ' || COALESCE(v_error, '');
  ASSERT (SELECT sum(quantity) FROM "itemLedger" WHERE "documentId" = v_job AND "documentType" = 'Job Receipt') = 1.5, 'Inventory job must receive 1.5';
  ASSERT pg_temp.issued(v_job) = 3, 'Inventory job must consume for 1.5 units: ' || pg_temp.issued(v_job);

  -- Non-Inventory (service) job may still complete at zero.
  v_job := pg_temp.make_job(v_company_id, v_location_id, v_service_item, v_part, 'NJ', 1);
  v_error := pg_temp.try_complete(v_job, 0);
  ASSERT v_error IS NULL, 'Non-Inventory job at 0 must be allowed, got: ' || COALESCE(v_error, '');
  ASSERT (SELECT status FROM job WHERE id = v_job) = 'Completed', 'Non-Inventory job must complete';

  RAISE NOTICE 'ALL JOB COMPLETION CASES PASSED (zero/fraction refusal, partial and full serial receipt, re-completion, shop-floor-first, scrapped, inventory, non-inventory)';
END;
$cases$;
ROLLBACK;
