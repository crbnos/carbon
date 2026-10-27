-- Serial numbers at production: number the units a job completion takes.
--
-- Under the 'production' timing a job's units stay unnumbered until they are
-- first touched, and the completion that receives them is a first touch. Under
-- 'jobRelease' they are numbered at release, so the completion only numbers what
-- release did not (a job completed before release, or units added since). Under
-- 'jobCreation' every unit is numbered at creation, so it numbers nothing, unless
-- a job still holds unnumbered units: one created under another timing before
-- the item or company switched back. The completion numbers whatever it takes
-- unnumbered, whatever the timing. Both completion paths call
-- number_serial_units_for_completion before complete_job_to_inventory: the
-- ERP's completeJob, and the
-- sync_finish_job_operation interceptor when the last operation is marked Done.
-- It splits what the completion takes off the job's unsplit seed and numbers
-- every unit it takes, so the receipt never takes one unnumbered entity holding
-- every unit.
--
-- get_next_serial_numbers is the one serial allocator: the TypeScript
-- getNextSerialNumbers (@carbon/database/sequence) calls it, so job creation,
-- first-touch numbering and completion format serials the same way. Its date
-- tokens follow get_next_sequence: the company's timezone, ISO weeks.

CREATE OR REPLACE FUNCTION public.interpolate_serial_segment(
  p_value text,
  p_now timestamp,
  p_location text
)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT replace(
    replace(replace(replace(replace(replace(replace(replace(
      COALESCE(p_value, ''),
      '%{yyyy}', to_char(p_now, 'YYYY')),
      '%{yy}', to_char(p_now, 'YY')),
      '%{mm}', to_char(p_now, 'MM')),
      '%{ww}', to_char(p_now, 'IW')),
      '%{dd}', to_char(p_now, 'DD')),
      '%{hh}', to_char(p_now, 'HH24')),
      '%{ss}', to_char(p_now, 'SS')),
    '%{location}', COALESCE(p_location, '')
  );
$function$;

-- Reserve and format the next p_count serial numbers of an item's
-- itemSerialSequence. Empty when the item has no sequence. Runs as the caller:
-- the ERP and MES call it on a direct connection, and the completion below as
-- whoever runs the completion.
CREATE OR REPLACE FUNCTION public.get_next_serial_numbers(
  p_item_id text,
  p_company_id text,
  p_count integer,
  p_location_code text DEFAULT NULL,
  p_location_name text DEFAULT NULL
)
 RETURNS text[]
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_next integer;
  v_prefix text;
  v_suffix text;
  v_size integer;
  v_step integer;
  v_now timestamp;
  v_location text;
  v_value integer;
  v_serials text[] := '{}';
BEGIN
  IF p_count IS NULL OR p_count < 1 THEN
    RETURN v_serials;
  END IF;

  UPDATE "itemSerialSequence"
  SET next = next + p_count * step,
      "updatedBy" = 'system',
      "updatedAt" = now()
  WHERE "itemId" = p_item_id
    AND "companyId" = p_company_id
  RETURNING next, prefix, suffix, size, step
  INTO v_next, v_prefix, v_suffix, v_size, v_step;

  IF NOT FOUND THEN
    RETURN v_serials;
  END IF;

  v_now := now() AT TIME ZONE COALESCE(
    (SELECT "timezone" FROM "company" WHERE "id" = p_company_id),
    'UTC'
  );
  -- The location code, falling back to its name, with surrounding space trimmed.
  v_location := regexp_replace(
    COALESCE(p_location_code, p_location_name, ''),
    '^\s+|\s+$', '', 'g'
  );
  v_prefix := interpolate_serial_segment(v_prefix, v_now, v_location);
  v_suffix := interpolate_serial_segment(v_suffix, v_now, v_location);

  FOR i IN 1..p_count LOOP
    v_value := v_next - p_count * v_step + i * v_step;
    v_serials := v_serials || (
      v_prefix
      || CASE
        WHEN length(v_value::text) >= COALESCE(v_size, 5) THEN v_value::text
        ELSE lpad(v_value::text, COALESCE(v_size, 5), '0')
      END
      || v_suffix
    );
  END LOOP;

  RETURN v_serials;
END;
$function$;

-- Receipt as first touch. Takes the units complete_job_to_inventory will take
-- for p_quantity_complete, in its own order (the receipt branch, or the Make to
-- Asset branch), splits what is missing off the unsplit seed and numbers every
-- unit taken. Returns how many numbers it drew. Writes nothing when every unit
-- taken is already numbered, the item is not serial-tracked or has no sequence,
-- or the job cannot cover the completion (the completion then refuses with its
-- own message). It does not read the serial number timing: a job left
-- unnumbered by a timing that has since changed to 'jobCreation' is numbered
-- here too, rather than received as one unnumbered entity.
--
-- A unit can also have no row at all. The shop floor's first completion or
-- scrap of the seed leaves it holding one unit and adds the next units one at a
-- time, so after it the rows cover fewer units than the job quantity. Those
-- units are created here, up to the job quantity less the units already in
-- rows (a scrapped unit does not count: the job still owes it).
--
-- SECURITY INVOKER, like backflush_job_materials: its callers are the
-- sync_finish_job_operation interceptor, which the event dispatcher runs as the
-- owner, and completeJob on a direct connection. Called through the API it runs
-- under the caller's RLS, so it cannot split or number units the caller could
-- not update.
CREATE OR REPLACE FUNCTION public.number_serial_units_for_completion(
  p_job_id text,
  p_quantity_complete numeric,
  p_company_id text
)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job record;
  v_make_method record;
  v_delta numeric;
  v_target text;
  v_taken text[];
  v_to_number text[];
  v_short integer;
  v_seed record;
  v_from_seed integer := 0;
  v_new_units integer := 0;
  v_seed_becomes_unit boolean := false;
  v_missing integer := 0;
  v_unstarted numeric;
  v_template record;
  v_count integer;
  v_serials text[];
  v_location record;
BEGIN
  PERFORM assert_company_access(p_company_id);

  SELECT j."itemId", j.quantity, j."quantityReceivedToInventory", j."fixedAssetClassId",
         j."fixedAssetId", j."locationId", i."itemTrackingType"
  INTO v_job
  FROM "job" j
  JOIN "item" i ON i."id" = j."itemId"
  WHERE j."id" = p_job_id
    AND j."companyId" = p_company_id;
  IF NOT FOUND OR v_job."itemTrackingType" IS DISTINCT FROM 'Serial' THEN
    RETURN 0;
  END IF;
  -- An item with no sequence has nothing to draw from: the completion takes
  -- its units as it always has.
  PERFORM 1
  FROM "itemSerialSequence"
  WHERE "itemId" = v_job."itemId" AND "companyId" = p_company_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  SELECT "id", "requiresSerialTracking"
  INTO v_make_method
  FROM "jobMakeMethod"
  WHERE "jobId" = p_job_id
    AND "parentMaterialId" IS NULL;
  IF NOT FOUND OR NOT COALESCE(v_make_method."requiresSerialTracking", false) THEN
    RETURN 0;
  END IF;

  v_delta := p_quantity_complete - COALESCE(v_job."quantityReceivedToInventory", 0);
  IF v_delta IS NULL OR v_delta <= 0 OR v_delta <> trunc(v_delta) THEN
    RETURN 0;
  END IF;
  v_target := CASE
    WHEN v_job."fixedAssetClassId" IS NOT NULL OR v_job."fixedAssetId" IS NOT NULL
      THEN 'asset'
    ELSE 'receipt'
  END;

  PERFORM 1
  FROM "trackedEntity" te
  WHERE te.attributes->>'Job Make Method' = v_make_method."id"
    AND te."companyId" = p_company_id
  FOR UPDATE;

  -- A completion this call waited on may have received units since the read
  -- above: take the delta from what is received now.
  SELECT COALESCE(j."quantityReceivedToInventory", 0)
  INTO v_job."quantityReceivedToInventory"
  FROM "job" j
  WHERE j."id" = p_job_id
    AND j."companyId" = p_company_id;
  v_delta := p_quantity_complete - v_job."quantityReceivedToInventory";
  IF v_delta IS NULL OR v_delta <= 0 OR v_delta <> trunc(v_delta) THEN
    RETURN 0;
  END IF;

  -- The units the completion takes, by the same filter and order as
  -- complete_job_to_inventory (20261015161847_job-receipt-takes-issued-serial-units).
  IF v_target = 'asset' THEN
    v_taken := ARRAY(
      SELECT te."id"
      FROM "trackedEntity" te
      WHERE te.attributes->>'Job Make Method' = v_make_method."id"
        AND te."companyId" = p_company_id
        AND te.status NOT IN ('Consumed', 'Rejected', 'Scrapped')
        AND te.quantity = 1
        AND NOT (te.attributes ? 'Fixed Asset')
      ORDER BY
        CASE te.status WHEN 'Available' THEN 0 WHEN 'Reserved' THEN 1 ELSE 2 END,
        te."readableId" NULLS LAST,
        te."createdAt",
        te."id"
      LIMIT v_delta::integer
    );
  ELSE
    v_taken := ARRAY(
      SELECT te."id"
      FROM "trackedEntity" te
      WHERE te.attributes->>'Job Make Method' = v_make_method."id"
        AND te."companyId" = p_company_id
        AND (
          te.status NOT IN ('Consumed', 'Rejected', 'Scrapped')
          OR (
            te.status = 'Consumed'
            AND EXISTS (
              SELECT 1
              FROM "itemLedger" il
              WHERE il."trackedEntityId" = te."id"
                AND il."companyId" = p_company_id
                AND il.quantity < 0
            )
          )
        )
        AND te.quantity = 1
        AND NOT EXISTS (
          SELECT 1
          FROM "itemLedger" il
          WHERE il."trackedEntityId" = te."id"
            AND il."documentType" = 'Job Receipt'
            AND il."documentId" = p_job_id
        )
      ORDER BY
        CASE te.status WHEN 'Available' THEN 0 WHEN 'Consumed' THEN 0 WHEN 'Reserved' THEN 1 ELSE 2 END,
        te."readableId" NULLS LAST,
        te."createdAt",
        te."id"
      LIMIT v_delta::integer
    );
  END IF;

  -- Numbered units sort ahead of unnumbered ones of their rank, so once these
  -- are numbered the completion takes the same units.
  v_to_number := ARRAY(
    SELECT te."id"
    FROM "trackedEntity" te
    JOIN unnest(v_taken) WITH ORDINALITY AS t(id, ord) ON t.id = te."id"
    WHERE te."readableId" IS NULL
    ORDER BY t.ord
  );

  v_short := v_delta::integer - COALESCE(array_length(v_taken, 1), 0);
  IF v_short > 0 THEN
    SELECT *
    INTO v_seed
    FROM "trackedEntity" te
    WHERE te.attributes->>'Job Make Method' = v_make_method."id"
      AND te."companyId" = p_company_id
      AND te.status NOT IN ('Consumed', 'Rejected', 'Scrapped')
      AND te.quantity > 1
    ORDER BY te."createdAt"
    LIMIT 1;
    IF FOUND THEN
      v_from_seed := LEAST(v_short, v_seed.quantity::integer);
      v_seed_becomes_unit := v_seed.quantity = v_from_seed;
      v_new_units := CASE WHEN v_seed_becomes_unit THEN v_from_seed - 1 ELSE v_from_seed END;
      IF v_seed_becomes_unit AND v_seed."readableId" IS NULL THEN
        v_to_number := v_to_number || v_seed."id";
      END IF;
    END IF;

    -- Units no row holds yet.
    v_missing := v_short - v_from_seed;
    IF v_missing > 0 THEN
      SELECT v_job.quantity - COALESCE(SUM(te.quantity), 0)
      INTO v_unstarted
      FROM "trackedEntity" te
      WHERE te.attributes->>'Job Make Method' = v_make_method."id"
        AND te."companyId" = p_company_id
        AND te.status <> 'Scrapped';
      IF v_unstarted < v_missing THEN
        RETURN 0;
      END IF;

      SELECT *
      INTO v_template
      FROM "trackedEntity" te
      WHERE te.attributes->>'Job Make Method' = v_make_method."id"
        AND te."companyId" = p_company_id
      ORDER BY te."createdAt", te."id"
      LIMIT 1;
      IF NOT FOUND THEN
        RETURN 0;
      END IF;
    END IF;
  END IF;

  v_count := COALESCE(array_length(v_to_number, 1), 0) + v_new_units + v_missing;
  IF v_count = 0 THEN
    RETURN 0;
  END IF;

  SELECT "code", "name"
  INTO v_location
  FROM "location"
  WHERE "id" = v_job."locationId"
    AND "companyId" = p_company_id;

  v_serials := get_next_serial_numbers(
    v_job."itemId", p_company_id, v_count, v_location."code", v_location."name"
  );
  IF COALESCE(array_length(v_serials, 1), 0) < v_count THEN
    RETURN 0;
  END IF;

  IF COALESCE(array_length(v_to_number, 1), 0) > 0 THEN
    UPDATE "trackedEntity" te
    SET "readableId" = s.serial
    FROM unnest(
      v_to_number,
      v_serials[1:array_length(v_to_number, 1)]
    ) AS s(id, serial)
    WHERE te."id" = s.id
      AND te."companyId" = p_company_id
      AND te."readableId" IS NULL;
  END IF;

  IF v_from_seed > 0 THEN
    UPDATE "trackedEntity"
    SET quantity = CASE WHEN v_seed_becomes_unit THEN 1 ELSE v_seed.quantity - v_new_units END
    WHERE "id" = v_seed."id"
      AND "companyId" = p_company_id;

    -- One millisecond apart, after every existing unit: createdAt is the unit
    -- axis step records are indexed by, so no existing unit moves.
    INSERT INTO "trackedEntity" (
      "createdAt", "sourceDocument", "sourceDocumentId", "sourceDocumentReadableId",
      quantity, status, attributes, "itemId", "expirationDate", "readableId",
      "companyId", "createdBy"
    )
    SELECT
      now() + n * interval '1 millisecond',
      v_seed."sourceDocument", v_seed."sourceDocumentId", v_seed."sourceDocumentReadableId",
      1, v_seed.status, v_seed.attributes, v_seed."itemId", v_seed."expirationDate",
      v_serials[COALESCE(array_length(v_to_number, 1), 0) + n],
      p_company_id, v_seed."createdBy"
    FROM generate_series(1, v_new_units) AS n;
  END IF;

  IF v_missing > 0 THEN
    INSERT INTO "trackedEntity" (
      "createdAt", "sourceDocument", "sourceDocumentId", "sourceDocumentReadableId",
      quantity, status, attributes, "itemId", "readableId",
      "companyId", "createdBy"
    )
    SELECT
      now() + (v_new_units + n) * interval '1 millisecond',
      v_template."sourceDocument", v_template."sourceDocumentId", v_template."sourceDocumentReadableId",
      1, 'Reserved'::"trackedEntityStatus",
      jsonb_build_object('Job', p_job_id, 'Job Make Method', v_make_method."id"),
      v_job."itemId",
      v_serials[COALESCE(array_length(v_to_number, 1), 0) + v_new_units + n],
      p_company_id, v_template."createdBy"
    FROM generate_series(1, v_missing) AS n;
  END IF;

  RETURN v_count;
END;
$function$;
