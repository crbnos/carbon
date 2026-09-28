-- Close the API surface of `public` functions.
--
-- Every function in "public" is a PostgREST RPC, callable with the anon key
-- published in the apps' HTML (API-key requests also arrive as anon, plus a
-- `carbon-key` header). SECURITY DEFINER functions run as the owner and bypass
-- RLS, so each one that trusted a caller-supplied company or user id, and each
-- internal helper that was never meant to be called directly, was a
-- cross-tenant read or write for anyone.
--
-- REVOKE EXECUTE is not the fix on this image: calling a revoked function as
-- anon/authenticated segfaults the backend (20260924192316). Instead:
--
--   1. A caller-facing SECURITY DEFINER function authorizes the company it was
--      handed with assert_company_access, first thing.
--   2. An internal SECURITY DEFINER function becomes SECURITY INVOKER. From a
--      SECURITY DEFINER caller (the event dispatchers, now SECURITY DEFINER
--      themselves) it still runs as the owner; through the API it runs under
--      the caller's RLS, so it can do nothing the REST API would not allow.
--   3. The RLS helpers return '{}' instead of NULL, so `x = ANY(helper())` is
--      false rather than NULL and `IF NOT (...)` guards raise as intended.

-- It raises rather than returns a boolean: `IF NOT (a OR b)` is NULL, not
-- true, when a membership lookup finds nothing, and never raises — which is
-- exactly how the older inline guards failed open.
CREATE OR REPLACE FUNCTION assert_company_access(p_company_id text, p_permission text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- service_role, and direct connections (jobs, Kysely, edge functions) are already trusted.
  IF current_setting('role', true) NOT IN ('anon', 'authenticated') THEN
    RETURN;
  END IF;

  IF p_company_id = ANY (
    CASE WHEN p_permission IS NULL
      THEN get_companies_with_employee_role()
      ELSE get_companies_with_employee_permission(p_permission)
    END
  ) THEN
    RETURN;
  END IF;

  RAISE EXCEPTION 'Not authorized for this company'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE OR REPLACE FUNCTION public.get_companies_with_any_role()
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  user_companies text[];
  api_key_company text;
BEGIN
  api_key_company := get_company_id_from_api_key();

  IF api_key_company IS NOT NULL THEN
    RETURN ARRAY[api_key_company];
  END IF;

  SELECT array_agg("companyId"::text)
  INTO user_companies
  FROM "userToCompany"
  WHERE "userId" = auth.uid()::text;

  RETURN COALESCE(user_companies, '{}');
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_companies_with_employee_role()
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  user_companies text[];
  api_key_company text;
BEGIN
  api_key_company := get_company_id_from_api_key();

  IF api_key_company IS NOT NULL THEN
    RETURN ARRAY[api_key_company];
  END IF;

  SELECT array_agg("companyId"::text)
  INTO user_companies
  FROM "userToCompany"
  WHERE "userId" = auth.uid()::text AND "role" = 'employee';

  RETURN COALESCE(user_companies, '{}');
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_companies_with_employee_permission(permission text)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  permission_companies text[];
  api_key_company text;
  employee_companies text[];
  api_key_scopes JSONB;
BEGIN
  api_key_company := get_company_id_from_api_key();

  IF api_key_company IS NOT NULL THEN
    api_key_scopes := get_api_key_scopes();
    IF api_key_scopes IS NULL OR api_key_scopes = '{}'::jsonb THEN
      RETURN '{}';
    END IF;
    IF (api_key_scopes ? permission)
       AND api_key_company = ANY(jsonb_to_text_array(api_key_scopes->permission)) THEN
      RETURN ARRAY[api_key_company];
    ELSE
      RETURN '{}';
    END IF;
  END IF;

  SELECT array_agg("companyId"::text)
  INTO employee_companies
  FROM "userToCompany"
  WHERE "userId" = auth.uid()::text AND "role" = 'employee';

  SELECT jsonb_to_text_array(COALESCE(permissions->permission, '[]'))
  INTO permission_companies
  FROM public."userPermission"
  WHERE id::text = auth.uid()::text;

  IF permission_companies IS NOT NULL AND employee_companies IS NOT NULL THEN
    SELECT array_agg(company)
    INTO permission_companies
    FROM unnest(permission_companies) company
    WHERE company = ANY(employee_companies);
  ELSE
    permission_companies := '{}';
  END IF;

  RETURN COALESCE(permission_companies, '{}');
END;
$function$;

CREATE OR REPLACE FUNCTION public.has_role(required_role text, company text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    DECLARE
      user_role text;
    BEGIN
      SELECT role INTO user_role FROM public."userToCompany" WHERE "userId" = (SELECT auth.uid()::text) AND "companyId" = company;
      RETURN COALESCE(user_role = required_role, false);
    END;
$function$;

CREATE OR REPLACE FUNCTION public.get_company_id_from_foreign_key(foreign_key text, tbl text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    DECLARE
      company_id text;
    BEGIN
      EXECUTE format('SELECT "companyId" FROM %I WHERE id = $1', tbl) INTO company_id USING foreign_key;
      RETURN company_id;
    END;
$function$;

CREATE OR REPLACE FUNCTION public.get_next_sequence(sequence_name text, company_id text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prefix text;
  v_suffix text;
  v_next_value integer;
  v_size integer;
  v_next_sequence text;
  v_derived_prefix text;
  v_derived_suffix text;
  v_now timestamp;
BEGIN
  PERFORM assert_company_access(company_id);

  UPDATE sequence
  SET next = next + step,
      "updatedBy" = 'system'
  WHERE "table" = sequence_name
  AND "companyId" = company_id
  RETURNING next, prefix, suffix, size
  INTO v_next_value, v_prefix, v_suffix, v_size;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sequence not found for table % and company %', sequence_name, company_id;
  END IF;

  -- Format sequence number
  v_next_sequence := lpad(v_next_value::text, COALESCE(v_size, 4), '0');

  -- Wall-clock in the company's timezone: document prefixes must roll over at
  -- the company's midnight, not the database's. Matches the TypeScript twin
  -- interpolateSequenceDate(value, companyTimezone).
  v_now := now() AT TIME ZONE COALESCE(
    (SELECT "timezone" FROM "company" WHERE "id" = company_id),
    'UTC'
  );

  -- Interpolate date variables in prefix/suffix
  v_derived_prefix := COALESCE(v_prefix, '');
  v_derived_prefix := replace(v_derived_prefix, '%{yyyy}', to_char(v_now, 'YYYY'));
  v_derived_prefix := replace(v_derived_prefix, '%{yy}', to_char(v_now, 'YY'));
  v_derived_prefix := replace(v_derived_prefix, '%{mm}', to_char(v_now, 'MM'));
  v_derived_prefix := replace(v_derived_prefix, '%{ww}', to_char(v_now, 'IW'));
  v_derived_prefix := replace(v_derived_prefix, '%{dd}', to_char(v_now, 'DD'));
  v_derived_prefix := replace(v_derived_prefix, '%{hh}', to_char(v_now, 'HH24'));
  v_derived_prefix := replace(v_derived_prefix, '%{ss}', to_char(v_now, 'SS'));

  v_derived_suffix := COALESCE(v_suffix, '');
  v_derived_suffix := replace(v_derived_suffix, '%{yyyy}', to_char(v_now, 'YYYY'));
  v_derived_suffix := replace(v_derived_suffix, '%{yy}', to_char(v_now, 'YY'));
  v_derived_suffix := replace(v_derived_suffix, '%{mm}', to_char(v_now, 'MM'));
  v_derived_suffix := replace(v_derived_suffix, '%{ww}', to_char(v_now, 'IW'));
  v_derived_suffix := replace(v_derived_suffix, '%{dd}', to_char(v_now, 'DD'));
  v_derived_suffix := replace(v_derived_suffix, '%{hh}', to_char(v_now, 'HH24'));
  v_derived_suffix := replace(v_derived_suffix, '%{ss}', to_char(v_now, 'SS'));

  RETURN v_derived_prefix || v_next_sequence || v_derived_suffix;
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_job_to_inventory(p_job_id text, p_quantity_complete numeric, p_storage_unit_id text DEFAULT NULL::text, p_location_id text DEFAULT NULL::text, p_company_id text DEFAULT NULL::text, p_user_id text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item_id TEXT;
  v_item_tracking_type "itemTrackingType";
  v_cogs_account TEXT;
  v_sales_order_line_id TEXT;
  v_line_quantity_complete NUMERIC;
  v_job_company_id TEXT;
  v_prior_quantity_received NUMERIC;
  v_quantity_received_to_inventory NUMERIC;
  v_job_id_readable TEXT;
  v_job_make_method RECORD;
  v_tracked_entity RECORD;
  v_accounting_enabled BOOLEAN;
  v_company_group_id TEXT;
  v_raw_materials_account TEXT;
  v_finished_goods_account TEXT;
  v_item_inventory_account TEXT;
  v_item_inventory_description TEXT;
  v_wip_account TEXT;
  v_labor_absorption_account TEXT;
  v_overhead_absorption_account TEXT;
  v_dimension_item_posting_group TEXT;
  v_dimension_item TEXT;
  v_dimension_location TEXT;
  v_dimension_cost_center TEXT;
  v_dimension_employee TEXT;
  v_event RECORD;
  v_duration_hours NUMERIC;
  v_rate NUMERIC;
  v_labor_cost NUMERIC;
  v_overhead_cost NUMERIC;
  v_event_reference TEXT;
  v_labor_journal_line_reference TEXT;
  v_labor_accounting_period_id TEXT;
  v_labor_journal_entry_id TEXT;
  v_labor_journal_id TEXT;
  v_labor_jl_id TEXT;
  v_accumulated_wip_cost NUMERIC;
  v_today DATE;
  v_journal_line_reference TEXT;
  v_accounting_period_id TEXT;
  v_journal_entry_id TEXT;
  v_journal_id TEXT;
  v_jl_ids TEXT[];
  v_new_per_unit_cost NUMERIC;
  v_costing_method TEXT;
  v_existing_unit_cost NUMERIC;
  v_item_posting_group_id TEXT;
  v_job_location_id TEXT;
  v_total_qty_on_hand NUMERIC;
  v_prior_qty NUMERIC;
  v_prior_value NUMERIC;
  v_new_unit_cost NUMERIC;
  v_serial_unit_ids TEXT[];
  v_company_today DATE := company_today(p_company_id);
BEGIN
  PERFORM assert_company_access(p_company_id);

  -- Never let a NULL user reach NOT NULL audit columns; fall back to the job creator
  p_user_id := COALESCE(p_user_id, (SELECT "createdBy" FROM "job" WHERE id = p_job_id));

  -- Fetch job details. The row lock makes a concurrent completion wait and then
  -- read this completion's cumulative quantity, so both cannot compute the same
  -- receipt delta.
  SELECT "itemId", "quantityReceivedToInventory", "jobId", "locationId", "salesOrderLineId", "companyId"
  INTO STRICT v_item_id, v_prior_quantity_received, v_job_id_readable, v_job_location_id, v_sales_order_line_id, v_job_company_id
  FROM "job"
  WHERE id = p_job_id
  FOR UPDATE;

  -- SECURITY DEFINER bypasses RLS: bind the call to the job's own company so a
  -- caller can never complete another tenant's job or post into a mismatched
  -- company's ledger/journal.
  IF p_company_id IS NULL OR v_job_company_id IS DISTINCT FROM p_company_id THEN
    RAISE EXCEPTION 'Job % does not belong to company %', p_job_id, COALESCE(p_company_id, '<null>');
  END IF;

  -- Non-Inventory items (services) never enter inventory
  SELECT "itemTrackingType"
  INTO v_item_tracking_type
  FROM "item"
  WHERE id = v_item_id
    AND "companyId" = p_company_id;

  -- A stocked item completed at zero marks the job Completed, receives nothing
  -- and backflushes nothing. Refuse it at the one function every completion path
  -- crosses (ERP complete route, API/MCP, sync_finish_job_operation).
  IF v_item_tracking_type IS DISTINCT FROM 'Non-Inventory'
     AND COALESCE(p_quantity_complete, 0) <= 0 THEN
    RAISE EXCEPTION 'Quantity completed must be greater than 0 for job %', v_job_id_readable;
  END IF;

  -- Delta for this completion: drives the itemLedger/costLedger quantities and
  -- the WIP-discharge journal. The job column itself stores the CUMULATIVE
  -- quantity (get_inventory_quantities computes on-production supply as
  -- production + scrap - received - shipped, which requires cumulative).
  v_quantity_received_to_inventory := p_quantity_complete - COALESCE(v_prior_quantity_received, 0);

  -- Fetch jobMakeMethod for the top-level (no parentMaterialId)
  SELECT *
  INTO STRICT v_job_make_method
  FROM "jobMakeMethod"
  WHERE "jobId" = p_job_id
    AND "parentMaterialId" IS NULL;

  -- Serial units are received one tracked entity at a time, so a fractional
  -- quantity cannot be honoured; it would be stored on the job and rounded by
  -- the receipt.
  IF v_job_make_method."requiresSerialTracking"
     AND p_quantity_complete <> trunc(p_quantity_complete) THEN
    RAISE EXCEPTION 'Quantity completed must be a whole number for serial-tracked job %', v_job_id_readable;
  END IF;

  -- The quantity is cumulative, so a stocked job cannot be completed at less than
  -- it has already received: the negative delta would post a negative receipt,
  -- cost layer and WIP journal. Received stock is corrected through inventory
  -- adjustments, not by re-completing the job. Non-Inventory jobs never receive.
  IF v_item_tracking_type IS DISTINCT FROM 'Non-Inventory'
     AND p_quantity_complete < COALESCE(v_prior_quantity_received, 0) THEN
    RAISE EXCEPTION 'Quantity completed cannot be lower than the % already received for job %',
      COALESCE(v_prior_quantity_received, 0), v_job_id_readable;
  END IF;

  -- Update job status. quantityReceivedToInventory is CUMULATIVE (not the
  -- delta): re-completions previously overwrote it with the delta, corrupting
  -- get_inventory_quantities' on-production supply math. Non-Inventory items
  -- never receive to inventory, so their value is left unchanged.
  UPDATE "job"
  SET status = 'Completed',
      "completedDate" = NOW(),
      "quantityComplete" = p_quantity_complete,
      "quantityReceivedToInventory" = CASE
        WHEN v_item_tracking_type = 'Non-Inventory' THEN v_prior_quantity_received
        ELSE p_quantity_complete
      END,
      "updatedAt" = NOW(),
      "updatedBy" = p_user_id
  WHERE id = p_job_id;

  -- Complete the quantities behind the status: raise the terminal operations so
  -- the routing agrees with a Completed job, and refuse a serial job whose units
  -- still need serial numbers.
  --
  -- AFTER the status flip, never before. Closing an operation fires
  -- sync_finish_job_operation, which re-enters this function for a job in
  -- Ready/In Progress/Paused. Being a BEFORE row trigger it runs mid-statement,
  -- so it reads the operation's OLD quantityComplete (still 0 on a desk
  -- completion), falls back to the job's planned quantity and receives a second
  -- time — while this call's own receipt delta was computed further up, before
  -- any of it happened. With the job already Completed the interceptor's status
  -- gate returns early, so the operations close without a second receipt.
  PERFORM complete_job_remaining_quantities(p_job_id, p_quantity_complete, p_user_id);

  -- Services never ship, so job completion is the fulfillment event: advance
  -- the linked sales-order line the way post-shipment does for physical lines.
  -- Lives HERE (not in app code) because completion has multiple entry points —
  -- the ERP complete route AND the sync_finish_job_operation interceptor that
  -- auto-completes when the last operation finishes. Recomputed from ALL jobs
  -- on the line, so it is idempotent and lot-split safe. Runs before the
  -- accounting-enabled / zero-WIP early returns.
  -- NARROWED: only genuine Service lines (salesOrderLineType = 'Service') fulfill
  -- by completion. They never receive a shipment line (the `create` edge fn skips
  -- salesOrderLineType='Service'), so completion is their only fulfillment event.
  -- A Non-Inventory *Part* (or Material/Tool/etc.) still ships via post-shipment and
  -- must NOT be auto-fulfilled here — that was marking SO lines "Shipped" with no shipment.
  IF v_item_tracking_type = 'Non-Inventory' AND v_sales_order_line_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM "salesOrderLine" sol
       WHERE sol.id = v_sales_order_line_id
         AND sol."companyId" = p_company_id
         AND sol."salesOrderLineType" = 'Service'
     ) THEN
    SELECT COALESCE(SUM("quantityComplete"), 0)
    INTO v_line_quantity_complete
    FROM "job"
    WHERE "salesOrderLineId" = v_sales_order_line_id
      AND "companyId" = p_company_id
      AND status != 'Cancelled';

    UPDATE "salesOrderLine" sol
    SET "quantitySent" = v_line_quantity_complete,
        "sentComplete" = (COALESCE(sol."saleQuantity", 0) > 0 AND v_line_quantity_complete >= sol."saleQuantity"),
        "sentDate" = CASE
          WHEN COALESCE(sol."saleQuantity", 0) > 0
            AND v_line_quantity_complete >= sol."saleQuantity"
            AND sol."sentDate" IS NULL
          THEN v_company_today
          ELSE sol."sentDate"
        END,
        "updatedBy" = p_user_id,
        "updatedAt" = NOW()
    WHERE sol.id = v_sales_order_line_id
      AND sol."companyId" = p_company_id;
  END IF;

  -- Insert itemLedger entries based on tracking type.
  -- Non-Inventory items (services) never enter inventory, and a re-completion at
  -- the quantity already received has nothing new to receive.
  IF v_item_tracking_type IS DISTINCT FROM 'Non-Inventory'
     AND v_quantity_received_to_inventory > 0 THEN
  IF v_job_make_method."requiresBatchTracking" THEN
    SELECT *
    INTO v_tracked_entity
    FROM "trackedEntity"
    WHERE attributes->>'Job Make Method' = v_job_make_method.id
      AND "companyId" = p_company_id
      AND status != 'Consumed'
    ORDER BY "createdAt" DESC
    LIMIT 1;

    -- The job's own lot can already be Consumed by a lot MERGE: the batch
    -- completion prompt offers the merge before member jobs are received,
    -- and the merge is identity-only (it moves no unreceived stock). This
    -- job's receipt must then land on the merge's output lot — walk Merge
    -- activities from the job's lot to the terminal, still-live output.
    IF v_tracked_entity.id IS NULL THEN
      WITH RECURSIVE merge_walk(id) AS (
        SELECT te.id
        FROM "trackedEntity" te
        WHERE te.attributes->>'Job Make Method' = v_job_make_method.id
          AND te."companyId" = p_company_id
        UNION
        SELECT tao."trackedEntityId"
        FROM merge_walk
        JOIN "trackedActivityInput" tai
          ON tai."trackedEntityId" = merge_walk.id
         AND tai."companyId" = p_company_id
        JOIN "trackedActivity" ta
          ON ta.id = tai."trackedActivityId"
         AND ta."companyId" = p_company_id
         AND ta.type = 'Merge'
        JOIN "trackedActivityOutput" tao
          ON tao."trackedActivityId" = ta.id
         AND tao."companyId" = p_company_id
      )
      SELECT te.*
      INTO v_tracked_entity
      FROM merge_walk
      JOIN "trackedEntity" te ON te.id = merge_walk.id
      WHERE te.status != 'Consumed'
      ORDER BY te."createdAt" DESC
      LIMIT 1;
    END IF;

    IF v_tracked_entity.id IS NULL THEN
      RAISE EXCEPTION 'Tracked entity not found';
    END IF;

    INSERT INTO "itemLedger" (
      "entryType", "documentType", "documentId", "companyId",
      "itemId", quantity, "locationId", "storageUnitId",
      "trackedEntityId", "createdBy"
    ) VALUES (
      'Assembly Output', 'Job Receipt', p_job_id, p_company_id,
      v_item_id, v_quantity_received_to_inventory, p_location_id, p_storage_unit_id,
      v_tracked_entity.id, p_user_id
    );

  ELSIF v_job_make_method."requiresSerialTracking" THEN
    -- Receive exactly the newly completed units: units finished on the shop floor
    -- (Available) first, then by serial number. A unit this job already received
    -- is never received again, so re-completion cannot double-count. Rejected
    -- (failed inspection) and Scrapped units never enter stock. The candidates
    -- are locked so a concurrent completion cannot take the same units.
    v_serial_unit_ids := ARRAY(
      SELECT te.id
      FROM "trackedEntity" te
      WHERE te.attributes->>'Job Make Method' = v_job_make_method.id
        AND te."companyId" = p_company_id
        AND te.status NOT IN ('Consumed', 'Rejected', 'Scrapped')
        AND te.quantity = 1
        AND NOT EXISTS (
          SELECT 1
          FROM "itemLedger" il
          WHERE il."trackedEntityId" = te.id
            AND il."documentType" = 'Job Receipt'
            AND il."documentId" = p_job_id
        )
      ORDER BY
        CASE te.status WHEN 'Available' THEN 0 WHEN 'Reserved' THEN 1 ELSE 2 END,
        te."readableId" NULLS LAST,
        te."createdAt",
        te.id
      FOR UPDATE OF te
    );

    IF COALESCE(array_length(v_serial_unit_ids, 1), 0) >= v_quantity_received_to_inventory THEN
      INSERT INTO "itemLedger" (
        "entryType", "documentType", "documentId", "companyId",
        "itemId", quantity, "locationId", "storageUnitId",
        "trackedEntityId", "createdBy"
      )
      SELECT
        'Assembly Output', 'Job Receipt', p_job_id, p_company_id,
        v_item_id, 1, p_location_id, p_storage_unit_id,
        unit_id, p_user_id
      FROM unnest(v_serial_unit_ids[1:v_quantity_received_to_inventory::INTEGER]) AS unit_id;

      UPDATE "trackedEntity"
      SET status = 'Available'
      WHERE id = ANY(v_serial_unit_ids[1:v_quantity_received_to_inventory::INTEGER]);

    ELSE
      -- An item with no serial sequence never reaches assign-serial-numbers, so
      -- the job still holds ONE seed entity covering every unit and there is
      -- nothing to receive one at a time. Receive the delta against that seed,
      -- the way the batch branch does. Raising here instead would abort the
      -- jobOperation UPDATE itself: completion also runs inside
      -- sync_finish_job_operation, a BEFORE trigger interceptor.
      SELECT *
      INTO v_tracked_entity
      FROM "trackedEntity" te
      WHERE te.attributes->>'Job Make Method' = v_job_make_method.id
        AND te."companyId" = p_company_id
        AND te.status NOT IN ('Consumed', 'Rejected', 'Scrapped')
        AND te.quantity > 1
      ORDER BY te."createdAt"
      LIMIT 1
      FOR UPDATE;

      -- Genuinely short of units (some scrapped, some already received) rather
      -- than un-numbered: receiving fewer than completed would leave the job's
      -- received quantity ahead of the ledger.
      IF v_tracked_entity.id IS NULL THEN
        RAISE EXCEPTION 'Job % has % serial unit(s) left to receive, fewer than the % being completed',
          v_job_id_readable, COALESCE(array_length(v_serial_unit_ids, 1), 0), v_quantity_received_to_inventory;
      END IF;

      INSERT INTO "itemLedger" (
        "entryType", "documentType", "documentId", "companyId",
        "itemId", quantity, "locationId", "storageUnitId",
        "trackedEntityId", "createdBy"
      ) VALUES (
        'Assembly Output', 'Job Receipt', p_job_id, p_company_id,
        v_item_id, v_quantity_received_to_inventory, p_location_id, p_storage_unit_id,
        v_tracked_entity.id, p_user_id
      );

      UPDATE "trackedEntity"
      SET status = 'Available'
      WHERE id = v_tracked_entity.id;
    END IF;

  ELSE
    INSERT INTO "itemLedger" (
      "entryType", "documentType", "documentId", "companyId",
      "itemId", quantity, "locationId", "storageUnitId", "createdBy"
    ) VALUES (
      'Assembly Output', 'Job Receipt', p_job_id, p_company_id,
      v_item_id, v_quantity_received_to_inventory, p_location_id, p_storage_unit_id,
      p_user_id
    );
  END IF;
  END IF;

  -- Update pickMethod defaultStorageUnitId if needed
  IF v_item_tracking_type IS DISTINCT FROM 'Non-Inventory' AND p_storage_unit_id IS NOT NULL AND p_location_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM "itemLedger"
      WHERE "itemId" = v_item_id
        AND "locationId" = p_location_id
        AND "storageUnitId" IS NOT NULL
        AND "storageUnitId" != p_storage_unit_id
      LIMIT 1
    ) THEN
      IF EXISTS (
        SELECT 1 FROM "pickMethod"
        WHERE "itemId" = v_item_id AND "locationId" = p_location_id
      ) THEN
        UPDATE "pickMethod"
        SET "defaultStorageUnitId" = p_storage_unit_id,
            "updatedBy" = p_user_id,
            "updatedAt" = NOW()
        WHERE "itemId" = v_item_id
          AND "locationId" = p_location_id;
      ELSE
        INSERT INTO "pickMethod" (
          "itemId", "locationId", "defaultStorageUnitId",
          "companyId", "createdBy", "createdAt"
        ) VALUES (
          v_item_id, p_location_id, p_storage_unit_id,
          p_company_id, p_user_id, NOW()
        );
      END IF;
    END IF;
  END IF;

  -- Backflush unissued materials (delegated to shared function)
  PERFORM backflush_job_materials(p_job_id, p_quantity_complete, p_company_id, p_user_id);

  -- Check if accounting is enabled
  SELECT "accountingEnabled"
  INTO v_accounting_enabled
  FROM "companySettings"
  WHERE id = p_company_id;

  v_accounting_enabled := COALESCE(v_accounting_enabled, false);

  IF NOT v_accounting_enabled THEN
    RETURN;
  END IF;

  -- Fetch company group
  SELECT "companyGroupId"
  INTO STRICT v_company_group_id
  FROM company
  WHERE id = p_company_id;

  -- Fetch account defaults
  SELECT "rawMaterialsAccount", "finishedGoodsAccount", "workInProgressAccount", "laborAbsorptionAccount", "overheadAbsorptionAccount", "costOfGoodsSoldAccount"
  INTO STRICT v_raw_materials_account, v_finished_goods_account, v_wip_account, v_labor_absorption_account, v_overhead_absorption_account, v_cogs_account
  FROM "accountDefault"
  WHERE "companyId" = p_company_id;

  -- Resolve Raw Materials vs Finished Goods from the produced item:
  -- Buy → Raw Materials; Make / Buy and Make → Finished Goods.
  SELECT
    CASE WHEN i."replenishmentSystem" = 'Buy' THEN v_raw_materials_account ELSE v_finished_goods_account END,
    CASE WHEN i."replenishmentSystem" = 'Buy' THEN 'Raw Materials Account' ELSE 'Finished Goods Account' END
  INTO v_item_inventory_account, v_item_inventory_description
  FROM "item" i
  WHERE i."id" = v_item_id
    AND i."companyId" = p_company_id;

  -- Non-Inventory (Service): the produced output is never stocked, so completion
  -- relieves WIP straight to Cost of Goods Sold (Epicor "Make Direct" pattern).
  -- >>> REV-REC SEAM (spec .ai/specs/2026-07-04-revenue-recognition.md, issue #1048):
  -- when revenue recognition lands, Percent-of-Completion elements will gate THIS
  -- branch off and post COGS as-incurred in the recognition run instead. <<<
  IF v_item_tracking_type = 'Non-Inventory' THEN
    v_item_inventory_account := v_cogs_account;
    v_item_inventory_description := 'Cost of Goods Sold';
  END IF;

  -- Fetch dimension IDs
  SELECT
    MAX(CASE WHEN "entityType" = 'ItemPostingGroup' THEN id END),
    MAX(CASE WHEN "entityType" = 'Item' THEN "id" END),
    MAX(CASE WHEN "entityType" = 'Location' THEN id END),
    MAX(CASE WHEN "entityType" = 'CostCenter' THEN id END),
    MAX(CASE WHEN "entityType" = 'Employee' THEN id END)
  INTO v_dimension_item_posting_group, v_dimension_item, v_dimension_location,
       v_dimension_cost_center, v_dimension_employee
  FROM dimension
  WHERE "companyGroupId" = v_company_group_id
    AND active = true
    AND "entityType" IN ('ItemPostingGroup', 'Item', 'Location', 'CostCenter', 'Employee');

  -- Post unposted production events as labor/machine + overhead absorption JEs
  -- (mirrors post-production-event; this is the catch-up path for events that
  -- were never posted individually)
  FOR v_event IN
    SELECT
      pe.id,
      pe.duration,
      pe.type,
      pe."employeeId",
      wc."laborRate",
      wc."machineRate",
      wc."overheadRate"
    FROM "productionEvent" pe
    INNER JOIN "jobOperation" jo ON jo.id = pe."jobOperationId"
    INNER JOIN "workCenter" wc ON wc.id = pe."workCenterId"
    WHERE jo."jobId" = p_job_id
      AND pe."endTime" IS NOT NULL
      AND pe."postedToGL" = false
      AND pe.duration > 0
  LOOP
    v_duration_hours := v_event.duration::NUMERIC / 3600;
    v_rate := CASE
      WHEN v_event.type = 'Machine' THEN COALESCE(v_event."machineRate", 0)
      ELSE COALESCE(v_event."laborRate", 0)
    END;
    v_labor_cost := v_duration_hours * v_rate;
    v_overhead_cost := v_duration_hours * COALESCE(v_event."overheadRate", 0);
    v_event_reference := 'production-event:' || v_event.id;

    IF (v_labor_cost > 0 AND v_labor_absorption_account IS NOT NULL)
       OR (v_overhead_cost > 0 AND v_overhead_absorption_account IS NOT NULL) THEN
      v_labor_journal_line_reference := nanoid();

      -- Get current accounting period
      SELECT id INTO v_labor_accounting_period_id
      FROM "accountingPeriod"
      WHERE "companyId" = p_company_id
        AND "startDate" <= v_company_today
        AND "endDate" >= v_company_today
        AND status = 'Active'
      LIMIT 1;

      IF v_labor_accounting_period_id IS NULL THEN
        UPDATE "accountingPeriod"
        SET status = 'Inactive'
        WHERE status = 'Active' AND "companyId" = p_company_id;

        UPDATE "accountingPeriod"
        SET status = 'Active'
        WHERE "companyId" = p_company_id
          AND "startDate" <= v_company_today
          AND "endDate" >= v_company_today
        RETURNING id INTO v_labor_accounting_period_id;

        IF v_labor_accounting_period_id IS NULL THEN
          INSERT INTO "accountingPeriod" (
            "startDate", "endDate", "companyId", status, "createdBy"
          ) VALUES (
            date_trunc('month', v_company_today)::DATE,
            (date_trunc('month', v_company_today) + INTERVAL '1 month' - INTERVAL '1 day')::DATE,
            p_company_id, 'Active', 'system'
          )
          RETURNING id INTO v_labor_accounting_period_id;
        END IF;
      END IF;

      v_labor_journal_entry_id := get_next_sequence('journalEntry', p_company_id);

      INSERT INTO journal (
        "journalEntryId", "accountingPeriodId", description,
        "postingDate", "companyId", "sourceType", status,
        "postedAt", "postedBy", "createdBy"
      ) VALUES (
        v_labor_journal_entry_id, v_labor_accounting_period_id,
        v_event.type || ' Time — Job ' || v_job_id_readable,
        v_company_today, p_company_id, 'Production Event', 'Posted',
        NOW(), p_user_id, p_user_id
      )
      RETURNING id INTO v_labor_journal_id;

      IF v_labor_cost > 0 AND v_labor_absorption_account IS NOT NULL THEN
        -- DR WIP (labor/machine)
        INSERT INTO "journalLine" (
          "journalId", "accountId", description, amount, quantity,
          "documentType", "documentId", "documentLineReference",
          "journalLineReference", "companyId"
        ) VALUES (
          v_labor_journal_id, v_wip_account, 'WIP Account',
          v_labor_cost, 1,
          'Production Event', p_job_id, v_event_reference,
          v_labor_journal_line_reference, p_company_id
        )
        RETURNING id INTO v_labor_jl_id;

        -- Employee dimension on WIP line
        IF v_dimension_employee IS NOT NULL AND v_event."employeeId" IS NOT NULL THEN
          INSERT INTO "journalLineDimension" (
            "journalLineId", "dimensionId", "valueId", "companyId"
          ) VALUES (
            v_labor_jl_id, v_dimension_employee, v_event."employeeId", p_company_id
          );
        END IF;

        -- Item dimension on WIP line (the finished good this labor rolls into)
        IF v_dimension_item IS NOT NULL AND v_item_id IS NOT NULL THEN
          INSERT INTO "journalLineDimension" (
            "journalLineId", "dimensionId", "valueId", "companyId"
          ) VALUES (
            v_labor_jl_id, v_dimension_item, v_item_id, p_company_id
          );
        END IF;

        -- CR Labor/Machine Absorption
        INSERT INTO "journalLine" (
          "journalId", "accountId", description, amount, quantity,
          "documentType", "documentId", "documentLineReference",
          "journalLineReference", "companyId"
        ) VALUES (
          v_labor_journal_id, v_labor_absorption_account, 'Labor/Machine Absorption',
          -v_labor_cost, 1,
          'Production Event', p_job_id, v_event_reference,
          v_labor_journal_line_reference, p_company_id
        )
        RETURNING id INTO v_labor_jl_id;

        -- Employee dimension on absorption line
        IF v_dimension_employee IS NOT NULL AND v_event."employeeId" IS NOT NULL THEN
          INSERT INTO "journalLineDimension" (
            "journalLineId", "dimensionId", "valueId", "companyId"
          ) VALUES (
            v_labor_jl_id, v_dimension_employee, v_event."employeeId", p_company_id
          );
        END IF;

        -- Item dimension on absorption line
        IF v_dimension_item IS NOT NULL AND v_item_id IS NOT NULL THEN
          INSERT INTO "journalLineDimension" (
            "journalLineId", "dimensionId", "valueId", "companyId"
          ) VALUES (
            v_labor_jl_id, v_dimension_item, v_item_id, p_company_id
          );
        END IF;
      END IF;

      IF v_overhead_cost > 0 AND v_overhead_absorption_account IS NOT NULL THEN
        -- DR WIP (overhead)
        INSERT INTO "journalLine" (
          "journalId", "accountId", description, amount, quantity,
          "documentType", "documentId", "documentLineReference",
          "journalLineReference", "companyId"
        ) VALUES (
          v_labor_journal_id, v_wip_account, 'WIP Account (Overhead)',
          v_overhead_cost, 1,
          'Production Event', p_job_id, v_event_reference,
          v_labor_journal_line_reference, p_company_id
        )
        RETURNING id INTO v_labor_jl_id;

        -- Employee dimension on WIP overhead line
        IF v_dimension_employee IS NOT NULL AND v_event."employeeId" IS NOT NULL THEN
          INSERT INTO "journalLineDimension" (
            "journalLineId", "dimensionId", "valueId", "companyId"
          ) VALUES (
            v_labor_jl_id, v_dimension_employee, v_event."employeeId", p_company_id
          );
        END IF;

        -- Item dimension on WIP overhead line
        IF v_dimension_item IS NOT NULL AND v_item_id IS NOT NULL THEN
          INSERT INTO "journalLineDimension" (
            "journalLineId", "dimensionId", "valueId", "companyId"
          ) VALUES (
            v_labor_jl_id, v_dimension_item, v_item_id, p_company_id
          );
        END IF;

        -- CR Overhead Absorption
        INSERT INTO "journalLine" (
          "journalId", "accountId", description, amount, quantity,
          "documentType", "documentId", "documentLineReference",
          "journalLineReference", "companyId"
        ) VALUES (
          v_labor_journal_id, v_overhead_absorption_account, 'Overhead Absorption',
          -v_overhead_cost, 1,
          'Production Event', p_job_id, v_event_reference,
          v_labor_journal_line_reference, p_company_id
        )
        RETURNING id INTO v_labor_jl_id;

        -- Employee dimension on overhead absorption line
        IF v_dimension_employee IS NOT NULL AND v_event."employeeId" IS NOT NULL THEN
          INSERT INTO "journalLineDimension" (
            "journalLineId", "dimensionId", "valueId", "companyId"
          ) VALUES (
            v_labor_jl_id, v_dimension_employee, v_event."employeeId", p_company_id
          );
        END IF;

        -- Item dimension on overhead absorption line
        IF v_dimension_item IS NOT NULL AND v_item_id IS NOT NULL THEN
          INSERT INTO "journalLineDimension" (
            "journalLineId", "dimensionId", "valueId", "companyId"
          ) VALUES (
            v_labor_jl_id, v_dimension_item, v_item_id, p_company_id
          );
        END IF;
      END IF;
    END IF;

    UPDATE "productionEvent"
    SET "postedToGL" = true
    WHERE id = v_event.id;
  END LOOP;

  -- Calculate accumulated WIP cost for this job
  SELECT COALESCE(ABS(SUM(jl.amount)), 0)
  INTO v_accumulated_wip_cost
  FROM "journalLine" jl
  INNER JOIN journal j ON j.id = jl."journalId"
  WHERE jl."accountId" = v_wip_account
    AND jl."documentId" = p_job_id
    AND j."companyId" = p_company_id;

  IF v_accumulated_wip_cost <= 0 THEN
    RETURN;
  END IF;

  -- A stocked re-completion at the quantity already received has no units to
  -- carry this cost. The catch-up WIP above stays in WIP and is discharged with
  -- the next receipt; the per-unit cost below would otherwise divide by zero.
  IF v_item_tracking_type IS DISTINCT FROM 'Non-Inventory'
     AND v_quantity_received_to_inventory <= 0 THEN
    RETURN;
  END IF;

  v_today := v_company_today;
  v_journal_line_reference := nanoid();

  -- Get accounting period for WIP discharge
  SELECT id INTO v_accounting_period_id
  FROM "accountingPeriod"
  WHERE "companyId" = p_company_id
    AND "startDate" <= v_today
    AND "endDate" >= v_today
    AND status = 'Active'
  LIMIT 1;

  IF v_accounting_period_id IS NULL THEN
    UPDATE "accountingPeriod"
    SET status = 'Inactive'
    WHERE status = 'Active' AND "companyId" = p_company_id;

    UPDATE "accountingPeriod"
    SET status = 'Active'
    WHERE "companyId" = p_company_id
      AND "startDate" <= v_today
      AND "endDate" >= v_today
    RETURNING id INTO v_accounting_period_id;

    IF v_accounting_period_id IS NULL THEN
      INSERT INTO "accountingPeriod" (
        "startDate", "endDate", "companyId", status, "createdBy"
      ) VALUES (
        date_trunc('month', v_today)::DATE,
        (date_trunc('month', v_today) + INTERVAL '1 month' - INTERVAL '1 day')::DATE,
        p_company_id, 'Active', 'system'
      )
      RETURNING id INTO v_accounting_period_id;
    END IF;
  END IF;

  v_journal_entry_id := get_next_sequence('journalEntry', p_company_id);

  INSERT INTO journal (
    "journalEntryId", "accountingPeriodId", description,
    "postingDate", "companyId", "sourceType", status,
    "postedAt", "postedBy", "createdBy"
  ) VALUES (
    v_journal_entry_id, v_accounting_period_id,
    'Job Completion ' || v_job_id_readable,
    v_today, p_company_id, 'Job Receipt', 'Posted',
    NOW(), p_user_id, p_user_id
  )
  RETURNING id INTO v_journal_id;

  -- DR Inventory (Raw Materials or Finished Goods by item)
  INSERT INTO "journalLine" (
    "journalId", "accountId", description, amount, quantity,
    "documentType", "documentId", "documentLineReference",
    "journalLineReference", "companyId"
  ) VALUES (
    v_journal_id, v_item_inventory_account, v_item_inventory_description,
    v_accumulated_wip_cost, v_quantity_received_to_inventory,
    'Job Receipt', p_job_id, 'job:' || p_job_id,
    v_journal_line_reference, p_company_id
  )
  RETURNING id INTO v_labor_jl_id;

  v_jl_ids := ARRAY[v_labor_jl_id];

  -- CR WIP
  INSERT INTO "journalLine" (
    "journalId", "accountId", description, amount, quantity,
    "documentType", "documentId", "documentLineReference",
    "journalLineReference", "companyId"
  ) VALUES (
    v_journal_id, v_wip_account, 'WIP Account',
    -v_accumulated_wip_cost, v_quantity_received_to_inventory,
    'Job Receipt', p_job_id, 'job:' || p_job_id,
    v_journal_line_reference, p_company_id
  )
  RETURNING id INTO v_labor_jl_id;

  v_jl_ids := v_jl_ids || v_labor_jl_id;

  -- Write costLedger entry for finished good (skipped for Non-Inventory: no
  -- output layer exists for a service — its cost went straight to COGS above)
  IF v_item_tracking_type IS DISTINCT FROM 'Non-Inventory' THEN
    INSERT INTO "costLedger" (
      "itemLedgerType", "costLedgerType", adjustment,
      "documentType", "documentId", "itemId",
      quantity, cost, "remainingQuantity", "companyId"
    ) VALUES (
      'Output', 'Direct Cost', false,
      'Job Receipt', p_job_id, v_item_id,
      v_quantity_received_to_inventory, v_accumulated_wip_cost,
      v_quantity_received_to_inventory, p_company_id
    );
  END IF;

  -- Update item cost
  SELECT "costingMethod", "unitCost", "itemPostingGroupId"
  INTO v_costing_method, v_existing_unit_cost, v_item_posting_group_id
  FROM "itemCost"
  WHERE "itemId" = v_item_id
    AND "companyId" = p_company_id;

  -- Update itemCost.unitCost (skipped for Non-Inventory: a service has no
  -- stocked unit cost; the read above still feeds the dimension inserts below)
  IF v_item_tracking_type IS DISTINCT FROM 'Non-Inventory' THEN
    v_new_per_unit_cost := v_accumulated_wip_cost / v_quantity_received_to_inventory;

    IF v_costing_method = 'Average' THEN
      SELECT COALESCE(SUM(quantity), 0)
      INTO v_total_qty_on_hand
      FROM "itemLedger"
      WHERE "itemId" = v_item_id
        AND "companyId" = p_company_id;

      v_prior_qty := v_total_qty_on_hand - v_quantity_received_to_inventory;
      v_prior_value := v_prior_qty * COALESCE(v_existing_unit_cost, 0);

      IF v_total_qty_on_hand > 0 THEN
        v_new_unit_cost := (v_prior_value + v_accumulated_wip_cost) / v_total_qty_on_hand;
        UPDATE "itemCost"
        SET "unitCost" = v_new_unit_cost
        WHERE "itemId" = v_item_id
          AND "companyId" = p_company_id;
      END IF;

    ELSIF v_costing_method IN ('FIFO', 'LIFO') THEN
      UPDATE "itemCost"
      SET "unitCost" = v_new_per_unit_cost
      WHERE "itemId" = v_item_id
        AND "companyId" = p_company_id;
    END IF;
  END IF;

  -- Insert dimensions on WIP discharge journal lines
  IF v_jl_ids IS NOT NULL AND array_length(v_jl_ids, 1) > 0 THEN
    FOR i IN 1..array_length(v_jl_ids, 1)
    LOOP
      IF v_item_posting_group_id IS NOT NULL AND v_dimension_item_posting_group IS NOT NULL THEN
        INSERT INTO "journalLineDimension" (
          "journalLineId", "dimensionId", "valueId", "companyId"
        ) VALUES (
          v_jl_ids[i], v_dimension_item_posting_group, v_item_posting_group_id, p_company_id
        );
      END IF;

      IF v_dimension_item IS NOT NULL AND v_item_id IS NOT NULL THEN
        INSERT INTO "journalLineDimension" (
          "journalLineId", "dimensionId", "valueId", "companyId"
        ) VALUES (
          v_jl_ids[i], v_dimension_item, v_item_id, p_company_id
        );
      END IF;

      IF v_job_location_id IS NOT NULL AND v_dimension_location IS NOT NULL THEN
        INSERT INTO "journalLineDimension" (
          "journalLineId", "dimensionId", "valueId", "companyId"
        ) VALUES (
          v_jl_ids[i], v_dimension_location, v_job_location_id, p_company_id
        );
      END IF;
    END LOOP;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_custom_field_unique_values(table_name text, field_key text, company_id text)
 RETURNS TABLE(value jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  PERFORM assert_company_access(company_id);

  RETURN QUERY EXECUTE format(
    'SELECT DISTINCT jsonb_extract_path("customFields", $1) as value
     FROM %I 
     WHERE "companyId" = $2
     AND "customFields" ? $1
     AND jsonb_extract_path("customFields", $1) IS NOT NULL',
    table_name
  ) USING field_key, company_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_inventory_quantities(company_id text, location_id text, item_id text DEFAULT NULL::text)
 RETURNS TABLE(id text, "readableId" text, "readableIdWithRevision" text, name text, active boolean, type "itemType", "itemTrackingType" "itemTrackingType", "replenishmentSystem" "itemReplenishmentSystem", "materialSubstanceId" text, "materialFormId" text, "dimensionId" text, dimension text, "finishId" text, finish text, "gradeId" text, grade text, "materialType" text, "materialTypeId" text, "thumbnailPath" text, "unitOfMeasureCode" text, "leadTime" integer, "lotSize" integer, "reorderingPolicy" "itemReorderingPolicy", "demandAccumulationPeriod" integer, "demandAccumulationSafetyStock" numeric, "reorderPoint" integer, "reorderQuantity" integer, "minimumOrderQuantity" integer, "maximumOrderQuantity" integer, "maximumInventoryQuantity" numeric, "orderMultiple" integer, "quantityOnHand" numeric, "quantityOnHold" numeric, "quantityRejected" numeric, "quantityOnSalesOrder" numeric, "quantityOnPurchaseOrder" numeric, "quantityOnProductionOrder" numeric, "quantityOnProductionDemand" numeric, "demandForecast" numeric, "usageLast30Days" numeric, "usageLast90Days" numeric, "daysRemaining" numeric, "storageTypeIds" text[], "storageUnitIds" text[], tags text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
  DECLARE
    v_cutoff TIMESTAMPTZ;
  BEGIN
  PERFORM assert_company_access(company_id);

    SELECT MAX("snapshotCutoff") INTO v_cutoff
    FROM "itemLedgerSnapshot"
    WHERE "companyId" = company_id;

    RETURN QUERY

WITH
  open_purchase_orders AS (
    SELECT
      pol."itemId",
      SUM(pol."quantityToReceive" * pol."conversionFactor") AS "quantityOnPurchaseOrder"
    FROM
      "purchaseOrder" po
      INNER JOIN "purchaseOrderLine" pol
        ON pol."purchaseOrderId" = po."id"
    WHERE
      po."status" IN (
        'Planned',
        'To Receive',
        'To Receive and Invoice'
      )
      AND po."companyId" = company_id
      AND pol."locationId" = location_id
      AND (item_id IS NULL OR pol."itemId" = item_id)
    GROUP BY pol."itemId"
  ),
  open_sales_orders AS (
    SELECT
      sol."itemId",
      SUM(sol."quantityToSend") AS "quantityOnSalesOrder"
    FROM
      "salesOrder" so
      INNER JOIN "salesOrderLine" sol
        ON sol."salesOrderId" = so."id"
    WHERE
      so."status" IN (
        'Confirmed',
        'To Ship and Invoice',
        'To Ship',
        'To Invoice',
        'In Progress'
      )
      AND so."companyId" = company_id
      AND sol."locationId" = location_id
      AND (item_id IS NULL OR sol."itemId" = item_id)
    GROUP BY sol."itemId"
  ),
  open_job_requirements AS (
    SELECT
      jm."itemId",
      SUM(jm."quantityToIssue") AS "quantityOnProductionDemand"
    FROM "jobMaterial" jm
    INNER JOIN "job" j ON jm."jobId" = j."id"
    WHERE j."status" IN (
        'Planned',
        'Ready',
        'In Progress',
        'Paused'
      )
    AND jm."methodType" != 'Make to Order'
    AND j."companyId" = company_id
    AND j."locationId" = location_id
    AND (item_id IS NULL OR jm."itemId" = item_id)
    GROUP BY jm."itemId"
  ),
  open_jobs AS (
    SELECT
      j."itemId",
      SUM(j."productionQuantity" + j."scrapQuantity" - j."quantityReceivedToInventory" - j."quantityShipped") AS "quantityOnProductionOrder"
    FROM job j
    WHERE j."status" IN (
      'Planned',
      'Ready',
      'In Progress',
      'Paused'
    )
    AND j."companyId" = company_id
    AND j."locationId" = location_id
    AND (item_id IS NULL OR j."itemId" = item_id)
    GROUP BY j."itemId"
  ),
  -- Snapshot (immutable untracked rows) + live tracked rows + live untracked
  -- rows past the snapshot cutoff. With no snapshot (v_cutoff NULL) the third
  -- arm is the full untracked history — the pre-snapshot behavior.
  item_ledgers AS (
    SELECT
      combined."itemId",
      SUM(combined."quantityOnHand") AS "quantityOnHand",
      SUM(combined."quantityOnHold") AS "quantityOnHold",
      SUM(combined."quantityRejected") AS "quantityRejected",
      SUM(combined."consumed30") / 30 AS "usageLast30Days",
      SUM(combined."consumed90") / 90 AS "usageLast90Days"
    FROM (
      SELECT
        s."itemId",
        s."quantity" AS "quantityOnHand",
        0::NUMERIC AS "quantityOnHold",
        0::NUMERIC AS "quantityRejected",
        s."consumed30",
        s."consumed90"
      FROM "itemLedgerSnapshot" s
      WHERE s."companyId" = company_id
        AND s."locationId" = location_id
        AND (item_id IS NULL OR s."itemId" = item_id)

      UNION ALL

      SELECT
        il."itemId",
        CASE WHEN il."trackedEntityStatus" IS NULL
               OR il."trackedEntityStatus" != 'Rejected'
             THEN il."quantity" ELSE 0 END,
        CASE WHEN il."trackedEntityStatus" = 'On Hold'
             THEN il."quantity" ELSE 0 END,
        CASE WHEN il."trackedEntityStatus" = 'Rejected'
             THEN il."quantity" ELSE 0 END,
        CASE WHEN il."entryType" IN ('Negative Adjmt.', 'Sale', 'Consumption', 'Assembly Consumption')
               AND il."createdAt" >= CURRENT_DATE - INTERVAL '30 days'
             THEN -il."quantity" ELSE 0 END,
        CASE WHEN il."entryType" IN ('Negative Adjmt.', 'Sale', 'Consumption', 'Assembly Consumption')
               AND il."createdAt" >= CURRENT_DATE - INTERVAL '90 days'
             THEN -il."quantity" ELSE 0 END
      FROM "itemLedger" il
      WHERE il."companyId" = company_id
        AND il."locationId" = location_id
        AND (item_id IS NULL OR il."itemId" = item_id)
        AND il."trackedEntityId" IS NOT NULL

      UNION ALL

      SELECT
        il."itemId",
        CASE WHEN il."trackedEntityStatus" IS NULL
               OR il."trackedEntityStatus" != 'Rejected'
             THEN il."quantity" ELSE 0 END,
        CASE WHEN il."trackedEntityStatus" = 'On Hold'
             THEN il."quantity" ELSE 0 END,
        CASE WHEN il."trackedEntityStatus" = 'Rejected'
             THEN il."quantity" ELSE 0 END,
        CASE WHEN il."entryType" IN ('Negative Adjmt.', 'Sale', 'Consumption', 'Assembly Consumption')
               AND il."createdAt" >= CURRENT_DATE - INTERVAL '30 days'
             THEN -il."quantity" ELSE 0 END,
        CASE WHEN il."entryType" IN ('Negative Adjmt.', 'Sale', 'Consumption', 'Assembly Consumption')
               AND il."createdAt" >= CURRENT_DATE - INTERVAL '90 days'
             THEN -il."quantity" ELSE 0 END
      FROM "itemLedger" il
      WHERE il."companyId" = company_id
        AND il."locationId" = location_id
        AND (item_id IS NULL OR il."itemId" = item_id)
        AND il."trackedEntityId" IS NULL
        AND (v_cutoff IS NULL OR il."createdAt" >= v_cutoff)
    ) combined
    GROUP BY combined."itemId"
  ),
  -- Distinct storage units the item is stocked in: snapshot arrays plus the
  -- same live arms. NULL storageUnitId rows are excluded.
  item_storage_units AS (
    SELECT
      u."itemId",
      ARRAY_AGG(DISTINCT u."storageUnitId") AS "storageUnitIds"
    FROM (
      SELECT s."itemId", su_id AS "storageUnitId"
      FROM "itemLedgerSnapshot" s
      CROSS JOIN LATERAL unnest(s."storageUnitIds") AS su_id
      WHERE s."companyId" = company_id
        AND s."locationId" = location_id
        AND (item_id IS NULL OR s."itemId" = item_id)

      UNION ALL

      SELECT il."itemId", il."storageUnitId"
      FROM "itemLedger" il
      WHERE il."companyId" = company_id
        AND il."locationId" = location_id
        AND il."storageUnitId" IS NOT NULL
        AND (item_id IS NULL OR il."itemId" = item_id)
        AND il."trackedEntityId" IS NOT NULL

      UNION ALL

      SELECT il."itemId", il."storageUnitId"
      FROM "itemLedger" il
      WHERE il."companyId" = company_id
        AND il."locationId" = location_id
        AND il."storageUnitId" IS NOT NULL
        AND (item_id IS NULL OR il."itemId" = item_id)
        AND il."trackedEntityId" IS NULL
        AND (v_cutoff IS NULL OR il."createdAt" >= v_cutoff)
    ) u
    GROUP BY u."itemId"
  ),
  -- Distinct storage types, derived from the merged storage-unit ids.
  item_storage_types AS (
    SELECT
      isu."itemId",
      ARRAY_AGG(DISTINCT t) AS "storageTypeIds"
    FROM item_storage_units isu
    INNER JOIN "storageUnit" su
      ON su."id" = ANY(isu."storageUnitIds")
     AND su."companyId" = company_id
    CROSS JOIN LATERAL unnest(su."storageTypeIds") AS t
    GROUP BY isu."itemId"
  ),
  demand_forecast AS (
    SELECT combined."itemId", SUM(qty) AS "demandForecast"
    FROM (
      SELECT da."itemId", da."actualQuantity" AS qty
      FROM "demandActual" da
      WHERE da."companyId" = company_id AND da."locationId" = location_id
        AND (item_id IS NULL OR da."itemId" = item_id)
      UNION ALL
      SELECT df."itemId", df."forecastQuantity" AS qty
      FROM "demandForecast" df
      WHERE df."companyId" = company_id AND df."locationId" = location_id
        AND (item_id IS NULL OR df."itemId" = item_id)
    ) combined
    GROUP BY combined."itemId"
  )

SELECT
  i."id",
  i."readableId",
  i."readableIdWithRevision",
  i."name",
  i."active",
  i."type",
  i."itemTrackingType",
  i."replenishmentSystem",
  m."materialSubstanceId",
  m."materialFormId",
  m."dimensionId",
  md."name" AS "dimension",
  m."finishId",
  mf."name" AS "finish",
  m."gradeId",
  mg."name" AS "grade",
  mt."name" AS "materialType",
  m."materialTypeId",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END AS "thumbnailPath",
  i."unitOfMeasureCode",
  ir."leadTime",
  ir."lotSize",
  ip."reorderingPolicy",
  ip."demandAccumulationPeriod",
  ip."demandAccumulationSafetyStock",
  ip."reorderPoint",
  ip."reorderQuantity",
  ip."minimumOrderQuantity",
  ip."maximumOrderQuantity",
  ip."maximumInventoryQuantity",
  ip."orderMultiple",
  COALESCE(il."quantityOnHand", 0) AS "quantityOnHand",
  COALESCE(il."quantityOnHold", 0) AS "quantityOnHold",
  COALESCE(il."quantityRejected", 0) AS "quantityRejected",
  COALESCE(so."quantityOnSalesOrder", 0) AS "quantityOnSalesOrder",
  COALESCE(po."quantityOnPurchaseOrder", 0) AS "quantityOnPurchaseOrder",
  COALESCE(jo."quantityOnProductionOrder", 0) AS "quantityOnProductionOrder",
  COALESCE(jr."quantityOnProductionDemand", 0) AS "quantityOnProductionDemand",
  COALESCE(df."demandForecast", 0) AS "demandForecast",
  COALESCE(il."usageLast30Days", 0) AS "usageLast30Days",
  COALESCE(il."usageLast90Days", 0) AS "usageLast90Days",
  CASE
    WHEN COALESCE(il."usageLast30Days", 0) > 0
    THEN ROUND(COALESCE(il."quantityOnHand", 0) / il."usageLast30Days", 2)
    ELSE NULL
  END AS "daysRemaining",
  COALESCE(ist."storageTypeIds", ARRAY[]::TEXT[]) AS "storageTypeIds",
  COALESCE(isu."storageUnitIds", ARRAY[]::TEXT[]) AS "storageUnitIds",
  COALESCE(m."tags", p."tags", t."tags", c."tags") AS "tags"
FROM
  "item" i
  LEFT JOIN item_ledgers il ON i."id" = il."itemId"
  LEFT JOIN item_storage_types ist ON i."id" = ist."itemId"
  LEFT JOIN item_storage_units isu ON i."id" = isu."itemId"
  LEFT JOIN open_sales_orders so ON i."id" = so."itemId"
  LEFT JOIN open_purchase_orders po ON i."id" = po."itemId"
  LEFT JOIN open_jobs jo ON i."id" = jo."itemId"
  LEFT JOIN open_job_requirements jr ON i."id" = jr."itemId"
  LEFT JOIN demand_forecast df ON i."id" = df."itemId"
  LEFT JOIN material m ON i."readableId" = m."id" AND m."companyId" = company_id
  LEFT JOIN part p ON i."readableId" = p."id" AND p."companyId" = company_id
  LEFT JOIN tool t ON i."readableId" = t."id" AND t."companyId" = company_id
  LEFT JOIN consumable c ON i."readableId" = c."id" AND c."companyId" = company_id
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  LEFT JOIN "materialDimension" md ON m."dimensionId" = md."id"
  LEFT JOIN "materialFinish" mf ON m."finishId" = mf."id"
  LEFT JOIN "materialGrade" mg ON m."gradeId" = mg."id"
  LEFT JOIN "materialType" mt ON m."materialTypeId" = mt."id"
  LEFT JOIN "itemReplenishment" ir ON i."id" = ir."itemId" AND ir."companyId" = company_id
  LEFT JOIN "itemPlanning" ip ON i."id" = ip."itemId" AND ip."locationId" = location_id
WHERE
  i."itemTrackingType" <> 'Non-Inventory' AND i."companyId" = company_id
  AND (item_id IS NULL OR i."id" = item_id);
  END;
$function$;

CREATE OR REPLACE FUNCTION public.get_inventory_tie_out(company_id text, as_of_date date DEFAULT NULL::date)
 RETURNS TABLE("accountKind" text, "accountId" text, "accountName" text, "subledgerValue" numeric, "glBalance" numeric, variance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_as_of DATE := COALESCE(as_of_date, CURRENT_DATE);
  v_rm_account TEXT;
  v_fg_account TEXT;
BEGIN
  PERFORM assert_company_access(company_id);

  SELECT ad."rawMaterialsAccount", ad."finishedGoodsAccount"
  INTO v_rm_account, v_fg_account
  FROM "accountDefault" ad
  WHERE ad."companyId" = company_id;

  IF v_rm_account IS NULL OR v_fg_account IS NULL THEN
    RETURN; -- company has no account defaults (accounting never configured)
  END IF;

  RETURN QUERY
  WITH subledger AS (
    SELECT
      CASE WHEN v."replenishmentSystem" IN ('Make', 'Buy and Make')
           THEN 'finishedGoods' ELSE 'rawMaterials' END AS "kind",
      SUM(v."totalValue") AS "value"
    FROM get_inventory_valuation(company_id, as_of_date, NULL) v
    GROUP BY 1
  ),
  gl AS (
    SELECT jl."accountId" AS "account", SUM(jl."amount") AS "balance"
    FROM "journal" j
    INNER JOIN "journalLine" jl
      ON jl."journalId" = j."id" AND jl."companyId" = j."companyId"
    WHERE j."companyId" = company_id
      AND j."status" <> 'Draft'
      AND j."postingDate" <= v_as_of
      AND jl."accountId" IN (v_rm_account, v_fg_account)
    GROUP BY jl."accountId"
  ),
  accounts AS (
    SELECT 'rawMaterials' AS "kind", v_rm_account AS "account"
    UNION ALL
    SELECT 'finishedGoods' AS "kind", v_fg_account AS "account"
  )
  SELECT
    a."kind" AS "accountKind",
    a."account" AS "accountId",
    acc."name" AS "accountName",
    COALESCE(s."value", 0) AS "subledgerValue",
    COALESCE(g."balance", 0) AS "glBalance",
    COALESCE(s."value", 0) - COALESCE(g."balance", 0) AS "variance"
  -- account is companyGroup-scoped (no companyId); the ids come from the
  -- company-scoped accountDefault row, so joining by id alone is correct.
  FROM accounts a
  LEFT JOIN "account" acc ON acc."id" = a."account"
  LEFT JOIN subledger s ON s."kind" = a."kind"
  LEFT JOIN gl g ON g."account" = a."account"
  ORDER BY a."kind" DESC; -- rawMaterials first
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_inventory_valuation(company_id text, as_of_date date DEFAULT NULL::date, location_id text DEFAULT NULL::text)
 RETURNS TABLE("locationId" text, "locationName" text, "itemId" text, "readableIdWithRevision" text, name text, "thumbnailPath" text, type "itemType", "replenishmentSystem" "itemReplenishmentSystem", "unitOfMeasureCode" text, "costingMethod" "itemCostingMethod", "quantityOnHand" numeric, "quantityOnHold" numeric, "quantityRejected" numeric, "unitCost" numeric, "totalValue" numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_cutoff TIMESTAMPTZ;
  v_dated BOOLEAN := as_of_date IS NOT NULL AND as_of_date < CURRENT_DATE;
BEGIN
  PERFORM assert_company_access(company_id);

  SELECT MAX("snapshotCutoff") INTO v_cutoff
  FROM "itemLedgerSnapshot"
  WHERE "companyId" = company_id;

  RETURN QUERY
  WITH quantities AS (
    SELECT
      combined."itemId",
      combined."locationId",
      SUM(combined."quantity") AS "quantityOnHand",
      SUM(combined."onHold") AS "quantityOnHold",
      SUM(combined."rejected") AS "quantityRejected"
    FROM (
      -- Arm 1: snapshot (untracked, immutable). Skipped on dated queries —
      -- the snapshot has no postingDate grain.
      SELECT
        s."itemId",
        NULLIF(s."locationId", '') AS "locationId",
        s."quantity",
        0::NUMERIC AS "onHold",
        0::NUMERIC AS "rejected"
      FROM "itemLedgerSnapshot" s
      WHERE NOT v_dated
        AND s."companyId" = company_id
        AND (location_id IS NULL OR s."locationId" = location_id)

      UNION ALL

      -- Arm 2: tracked rows, always live (status flips in place).
      SELECT
        il."itemId",
        il."locationId",
        il."quantity",
        CASE WHEN il."trackedEntityStatus" = 'On Hold' THEN il."quantity" ELSE 0 END,
        CASE WHEN il."trackedEntityStatus" = 'Rejected' THEN il."quantity" ELSE 0 END
      FROM "itemLedger" il
      WHERE il."companyId" = company_id
        AND il."trackedEntityId" IS NOT NULL
        AND (location_id IS NULL OR il."locationId" = location_id)
        AND (NOT v_dated OR il."postingDate" <= as_of_date)

      UNION ALL

      -- Arm 3: untracked delta past the cutoff (current path) OR the full
      -- untracked history filtered by postingDate (dated path / no snapshot).
      SELECT
        il."itemId",
        il."locationId",
        il."quantity",
        0::NUMERIC,
        0::NUMERIC
      FROM "itemLedger" il
      WHERE il."companyId" = company_id
        AND il."trackedEntityId" IS NULL
        AND (location_id IS NULL OR il."locationId" = location_id)
        AND (v_dated OR v_cutoff IS NULL OR il."createdAt" >= v_cutoff)
        AND (NOT v_dated OR il."postingDate" <= as_of_date)
    ) combined
    GROUP BY combined."itemId", combined."locationId"
    HAVING SUM(combined."quantity") <> 0
  ),
  carrying AS (
    -- Company-level effective unit cost per item, by costing method.
    SELECT
      ic."itemId",
      ic."costingMethod",
      CASE ic."costingMethod"
        WHEN 'Standard' THEN ic."standardCost"
        WHEN 'Average' THEN ic."unitCost"
        ELSE COALESCE(layers."layerUnitCost", ic."unitCost")
      END AS "unitCost"
    FROM "itemCost" ic
    LEFT JOIN LATERAL (
      SELECT
        SUM(
          cl."remainingQuantity"
          * (cl."cost" + COALESCE(adj."applied", 0))
          / NULLIF(cl."quantity", 0)
        ) / NULLIF(SUM(cl."remainingQuantity"), 0) AS "layerUnitCost"
      FROM "costLedger" cl
      LEFT JOIN LATERAL (
        SELECT SUM(a."cost") AS "applied"
        FROM "costLedger" a
        WHERE a."appliesToCostLedgerId" = cl."id"
          AND a."companyId" = cl."companyId"
      ) adj ON TRUE
      WHERE cl."itemId" = ic."itemId"
        AND cl."companyId" = ic."companyId"
        AND cl."remainingQuantity" > 0
    ) layers ON ic."costingMethod" IN ('FIFO', 'LIFO')
    WHERE ic."companyId" = company_id
  )
  SELECT
    l."id" AS "locationId",
    l."name" AS "locationName",
    i."id" AS "itemId",
    i."readableIdWithRevision",
    i."name",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      ELSE i."thumbnailPath"
    END AS "thumbnailPath",
    i."type",
    i."replenishmentSystem",
    i."unitOfMeasureCode",
    c."costingMethod",
    q."quantityOnHand",
    q."quantityOnHold",
    q."quantityRejected",
    COALESCE(c."unitCost", 0) AS "unitCost",
    q."quantityOnHand" * COALESCE(c."unitCost", 0) AS "totalValue"
  FROM quantities q
  INNER JOIN "item" i ON q."itemId" = i."id" AND i."companyId" = company_id
  INNER JOIN "location" l ON q."locationId" = l."id" AND l."companyId" = company_id
  LEFT JOIN "modelUpload" mu ON mu."id" = i."modelUploadId" AND mu."companyId" = company_id
  LEFT JOIN carrying c ON c."itemId" = q."itemId"
  ORDER BY l."name", i."readableIdWithRevision";
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_item_quantities_by_tracking_id(item_id text, company_id text, location_id text)
 RETURNS TABLE("itemId" text, "storageUnitId" text, "storageUnitName" text, "trackedEntityId" text, "readableId" text, quantity numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  PERFORM assert_company_access(company_id);

  RETURN QUERY
  SELECT
    il."itemId",
    il."storageUnitId",
    s."name" AS "storageUnitName",
    il."trackedEntityId",
    te."readableId",
    SUM(il."quantity") AS "quantity"
  FROM
    "itemLedger" il
  LEFT JOIN
    "storageUnit" s ON il."storageUnitId" = s."id"
  LEFT JOIN
    "trackedEntity" te ON il."trackedEntityId" = te."id"
  WHERE
    il."itemId" = item_id
    AND il."companyId" = company_id
    AND il."locationId" = location_id
  GROUP BY
    il."itemId",
    il."storageUnitId",
    s."name",
    il."trackedEntityId",
    te."readableId";
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_job_quantity_on_hand(job_id text, company_id text, location_id text)
 RETURNS TABLE(id text, "jobMaterialItemId" text, "jobMakeMethodId" text, "itemReadableId" text, name text, description text, "itemTrackingType" "itemTrackingType", "methodType" "methodType", type "itemType", "thumbnailPath" text, "unitOfMeasureCode" text, "quantityPerParent" numeric, "estimatedQuantity" numeric, "quantityIssued" numeric, "quantityOnHandInStorageUnit" numeric, "quantityOnHandNotInStorageUnit" numeric, "quantityOnSalesOrder" numeric, "quantityOnPurchaseOrder" numeric, "quantityOnProductionOrder" numeric, "quantityFromProductionOrderInStorageUnit" numeric, "quantityFromProductionOrderNotInStorageUnit" numeric, "quantityInTransitToStorageUnit" numeric, "storageUnitId" text, "storageUnitName" text, "itemScrapPercentage" numeric, "substitutedFromItemId" text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  BEGIN
  PERFORM assert_company_access(company_id);

    RETURN QUERY

WITH
  job_materials AS (
    SELECT
      jm."id",
      jm."itemId",
      jm."jobMakeMethodId",
      jm."description",
      jm."methodType",
      jm."quantity",
      jm."estimatedQuantity",
      jm."quantityIssued",
      jm."storageUnitId",
      jm."itemScrapPercentage",
      jm."substitutedFromItemId"
    FROM
      "jobMaterial" jm
    WHERE
      jm."jobId" = job_id
      -- SECURITY DEFINER bypasses RLS, so the caller's company must be checked
      -- here: without it a valid job id from another tenant returns its rows.
      AND jm."companyId" = company_id
  ),
  -- Distinct item / item+unit sets used to FILTER the aggregate CTEs below.
  -- Joining the raw job_materials rows fans out (multiplies) the aggregates when
  -- an item is on more than one BoM line — these dedupe so each item is counted
  -- once.
  job_material_items AS (
    SELECT DISTINCT jm."itemId" FROM job_materials jm
  ),
  job_material_item_units AS (
    SELECT DISTINCT jm."itemId", jm."storageUnitId" FROM job_materials jm
  ),
  open_purchase_orders AS (
    SELECT
      pol."itemId" AS "purchaseOrderItemId",
      SUM(pol."quantityToReceive" * COALESCE(pol."conversionFactor", 1)) AS "quantityOnPurchaseOrder"
    FROM
      "purchaseOrder" po
      INNER JOIN "purchaseOrderLine" pol
        ON pol."purchaseOrderId" = po."id"
      INNER JOIN job_material_items jm
        ON jm."itemId" = pol."itemId"
    WHERE
      po."status" IN (
        'Planned',
        'Needs Approval',
        'To Review',
        'To Receive',
        'To Receive and Invoice'
      )
      AND po."companyId" = company_id
      AND pol."locationId" = location_id
      AND pol."receivedComplete" = false
    GROUP BY pol."itemId"
  ),
  open_stock_transfers_to AS (
    SELECT
      stl."itemId",
      stl."toStorageUnitId" AS "storageUnitId",
      SUM(stl."outstandingQuantity") AS "quantityOnStockTransferTo"
    FROM "stockTransferLine" stl
    INNER JOIN "stockTransfer" st ON stl."stockTransferId" = st."id"
    INNER JOIN job_material_items jm ON jm."itemId" = stl."itemId"
    WHERE st."status" IN ('Released', 'In Progress')
    AND st."companyId" = company_id
    AND st."locationId" = location_id
    GROUP BY stl."itemId", stl."toStorageUnitId"
  ),
  open_stock_transfers_from AS (
    SELECT
      stl."itemId",
      stl."fromStorageUnitId" AS "storageUnitId",
      SUM(stl."outstandingQuantity") AS "quantityOnStockTransferFrom"
    FROM "stockTransferLine" stl
    INNER JOIN "stockTransfer" st ON stl."stockTransferId" = st."id"
    INNER JOIN job_material_items jm ON jm."itemId" = stl."itemId"
    WHERE st."status" IN ('Released', 'In Progress')
    AND st."companyId" = company_id
    AND st."locationId" = location_id
    GROUP BY stl."itemId", stl."fromStorageUnitId"
  ),
  stock_transfers_in_transit AS (
    SELECT
      COALESCE(stt."itemId", stf."itemId") AS "itemId",
      COALESCE(stt."storageUnitId", stf."storageUnitId") AS "storageUnitId",
      COALESCE(stt."quantityOnStockTransferTo", 0) - COALESCE(stf."quantityOnStockTransferFrom", 0) AS "quantityInTransit"
    FROM open_stock_transfers_to stt
    FULL OUTER JOIN open_stock_transfers_from stf ON stt."itemId" = stf."itemId" AND stt."storageUnitId" = stf."storageUnitId"
  ),
  open_sales_orders AS (
    SELECT
      sol."itemId" AS "salesOrderItemId",
      SUM(sol."quantityToSend") AS "quantityOnSalesOrder"
    FROM
      "salesOrder" so
      INNER JOIN "salesOrderLine" sol
        ON sol."salesOrderId" = so."id"
      INNER JOIN job_material_items jm
        ON jm."itemId" = sol."itemId"
    WHERE
      so."status" IN (
        'Confirmed',
        'To Ship and Invoice',
        'To Ship',
        'To Invoice',
        'In Progress'
      )
      AND so."companyId" = company_id
      AND sol."locationId" = location_id
    GROUP BY sol."itemId"
  ),
  open_jobs AS (
    SELECT
      j."itemId" AS "jobItemId",
      SUM(j."productionQuantity" + j."scrapQuantity" - j."quantityReceivedToInventory" - j."quantityShipped") AS "quantityOnProductionOrder"
    FROM job j
    WHERE j."status" IN (
      'Planned',
      'Ready',
      'In Progress',
      'Paused'
    )
    AND j."companyId" = company_id
    AND j."locationId" = location_id
    GROUP BY j."itemId"
  ),
  open_job_requirements AS (
    SELECT
      jm."itemId",
      jm."storageUnitId",
      SUM(jm."quantityToIssue") AS "quantityOnProductionDemand"
    FROM "jobMaterial" jm
    INNER JOIN "job" j ON jm."jobId" = j."id"
    INNER JOIN job_material_items jmat
      ON jmat."itemId" = jm."itemId"
    WHERE j."status" IN (
        'Planned',
        'Ready',
        'In Progress',
        'Paused'
      )
    AND jm."methodType" != 'Make to Order'
    AND j."companyId" = company_id
    AND j."locationId" = location_id
    GROUP BY jm."itemId", jm."storageUnitId"
  ),
  open_job_requirements_in_storage_unit AS (
    SELECT
      ojr."itemId",
      SUM(ojr."quantityOnProductionDemand") AS "quantityOnProductionDemandInStorageUnit"
    FROM open_job_requirements ojr
    INNER JOIN job_material_item_units jm
      ON jm."itemId" = ojr."itemId" AND jm."storageUnitId" = ojr."storageUnitId"
    GROUP BY ojr."itemId"
  ),
  open_job_requirements_not_in_storage_unit AS (
    SELECT
      ojr."itemId",
      SUM(ojr."quantityOnProductionDemand") AS "quantityOnProductionDemandNotInStorageUnit"
    FROM open_job_requirements ojr
    INNER JOIN job_material_item_units jm
      ON jm."itemId" = ojr."itemId" AND (jm."storageUnitId" IS NULL OR ojr."storageUnitId" IS NULL OR jm."storageUnitId" != ojr."storageUnitId")
    GROUP BY ojr."itemId"
  ),
  item_ledgers AS (
    SELECT
      il."itemId" AS "ledgerItemId",
      il."storageUnitId",
      -- quantityOnHand excludes only Rejected tracked entities. On Hold
      -- units are still physically in the warehouse and count toward
      -- on-hand. Rows with no tracked entity always count.
      SUM(il."quantity") FILTER (
        WHERE il."trackedEntityStatus" IS NULL
           OR il."trackedEntityStatus" != 'Rejected'
      ) AS "quantityOnHand"
    FROM "itemLedger" il
    INNER JOIN job_material_items jm
      ON jm."itemId" = il."itemId"
    WHERE il."companyId" = company_id
      AND il."locationId" = location_id
    GROUP BY il."itemId", il."storageUnitId"
  ),
  item_ledgers_in_storage_unit AS (
    SELECT
      il."ledgerItemId",
      SUM(il."quantityOnHand") AS "quantityOnHandInStorageUnit"
    FROM item_ledgers il
    INNER JOIN job_material_item_units jm
      ON jm."itemId" = il."ledgerItemId" AND jm."storageUnitId" = il."storageUnitId"
    GROUP BY il."ledgerItemId"
  ),
  item_ledgers_not_in_storage_unit AS (
    SELECT
      il."ledgerItemId",
      SUM(il."quantityOnHand") AS "quantityOnHandNotInStorageUnit"
    FROM item_ledgers il
    INNER JOIN job_material_item_units jm
      ON jm."itemId" = il."ledgerItemId" AND (jm."storageUnitId" IS NULL OR il."storageUnitId" IS NULL OR jm."storageUnitId" != il."storageUnitId")
    GROUP BY il."ledgerItemId"
  )

SELECT
  jm."id",
  jm."itemId" AS "jobMaterialItemId",
  jm."jobMakeMethodId",
  i."readableId" AS "itemReadableId",
  i."name",
  jm."description",
  i."itemTrackingType",
  jm."methodType",
  i."type",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END AS "thumbnailPath",
  i."unitOfMeasureCode",
  jm."quantity" as "quantityPerParent",
  jm."estimatedQuantity",
  jm."quantityIssued",
  COALESCE(ils."quantityOnHandInStorageUnit", 0) AS "quantityOnHandInStorageUnit",
  COALESCE(ilns."quantityOnHandNotInStorageUnit", 0) AS "quantityOnHandNotInStorageUnit",
  COALESCE(so."quantityOnSalesOrder", 0) AS "quantityOnSalesOrder",
  COALESCE(po."quantityOnPurchaseOrder", 0) AS "quantityOnPurchaseOrder",
  COALESCE(oj."quantityOnProductionOrder", 0) AS "quantityOnProductionOrder",
  COALESCE(ojis."quantityOnProductionDemandInStorageUnit", 0) AS "quantityFromProductionOrderInStorageUnit",
  COALESCE(ojns."quantityOnProductionDemandNotInStorageUnit", 0) AS "quantityFromProductionOrderNotInStorageUnit",
  COALESCE(stit."quantityInTransit", 0) AS "quantityInTransitToStorageUnit",
  jm."storageUnitId",
  s."name" AS "storageUnitName",
  jm."itemScrapPercentage",
  jm."substitutedFromItemId"
FROM
  job_materials jm
  INNER JOIN "item" i ON i."id" = jm."itemId"
  LEFT JOIN "storageUnit" s ON s."id" = jm."storageUnitId"
  LEFT JOIN item_ledgers_in_storage_unit ils ON i."id" = ils."ledgerItemId"
  LEFT JOIN item_ledgers_not_in_storage_unit ilns ON i."id" = ilns."ledgerItemId"
  LEFT JOIN open_sales_orders so ON i."id" = so."salesOrderItemId"
  LEFT JOIN open_purchase_orders po ON i."id" = po."purchaseOrderItemId"
  LEFT JOIN open_jobs oj ON i."id" = oj."jobItemId"
  LEFT JOIN open_job_requirements_in_storage_unit ojis ON i."id" = ojis."itemId"
  LEFT JOIN open_job_requirements_not_in_storage_unit ojns ON i."id" = ojns."itemId"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  LEFT JOIN stock_transfers_in_transit stit ON jm."itemId" = stit."itemId" AND jm."storageUnitId" = stit."storageUnitId";
  END;
$function$;

CREATE OR REPLACE FUNCTION public.get_training_assignment_status(p_company_id text, p_employee_id text DEFAULT NULL::text)
 RETURNS TABLE("trainingAssignmentId" text, "trainingId" text, "trainingName" text, frequency "trainingFrequency", "trainingType" "trainingType", "employeeId" text, "employeeName" text, "avatarUrl" text, "employeeStartDate" date, "companyId" text, "currentPeriod" text, "completionId" integer, "completedAt" timestamp with time zone, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  PERFORM assert_company_access(p_company_id);

  RETURN QUERY
  WITH group_users AS (
    -- Get distinct users from all training assignment groups for this company
    SELECT DISTINCT
      ta.id AS assignment_id,
      jsonb_array_elements_text(users_for_groups(ta."groupIds")) AS user_id
    FROM "trainingAssignment" ta
    WHERE ta."companyId" = p_company_id
  ),
  assigned_employees AS (
    SELECT DISTINCT
      ta.id AS "trainingAssignmentId",
      ta."trainingId" AS "trainingId",
      t."name" AS "trainingName",
      t."frequency",
      t."type" AS "trainingType",
      u.id AS "employeeId",
      u."fullName" AS "employeeName",
      u."avatarUrl" AS "avatarUrl",
      ej."startDate" AS "employeeStartDate",
      ta."companyId" AS "companyId"
    FROM "trainingAssignment" ta
    JOIN "training" t ON t.id = ta."trainingId" AND t."status" = 'Active'
    JOIN group_users gu ON gu.assignment_id = ta.id
    JOIN "user" u ON u.id = gu.user_id AND u.active = TRUE
    JOIN "employee" e ON e.id = u.id AND e."companyId" = ta."companyId"
    LEFT JOIN "employeeJob" ej ON ej.id = u.id AND ej."companyId" = ta."companyId"
    WHERE ta."companyId" = p_company_id
      AND (p_employee_id IS NULL OR u.id = p_employee_id)
  ),
  with_period AS (
    SELECT ae.*, get_current_training_period(ae."frequency") AS "currentPeriod"
    FROM assigned_employees ae
  )
  SELECT
    wp."trainingAssignmentId",
    wp."trainingId",
    wp."trainingName",
    wp."frequency",
    wp."trainingType",
    wp."employeeId",
    wp."employeeName",
    wp."avatarUrl",
    wp."employeeStartDate",
    wp."companyId",
    wp."currentPeriod",
    tc.id AS "completionId",
    tc."completedAt" AS "completedAt",
    CASE
      WHEN wp."frequency" = 'Once' THEN
        CASE WHEN tc.id IS NOT NULL THEN 'Completed' ELSE 'Pending' END
      WHEN tc.id IS NOT NULL THEN 'Completed'
      WHEN NOT employee_requires_period(wp."employeeStartDate", wp."currentPeriod") THEN 'Not Required'
      WHEN get_period_end_date(wp."currentPeriod") < CURRENT_DATE THEN 'Overdue'
      ELSE 'Pending'
    END AS status
  FROM with_period wp
  LEFT JOIN "trainingCompletion" tc ON
    tc."trainingAssignmentId" = wp."trainingAssignmentId"
    AND tc."employeeId" = wp."employeeId"
    AND ((wp."frequency" = 'Once' AND tc."period" IS NULL) OR tc."period" = wp."currentPeriod");
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_training_assignment_summary(p_company_id text)
 RETURNS TABLE("trainingId" text, "trainingName" text, frequency "trainingFrequency", "currentPeriod" text, "totalAssigned" bigint, completed bigint, pending bigint, overdue bigint, "completionPercent" numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  PERFORM assert_company_access(p_company_id);

  RETURN QUERY
  SELECT
    tas."trainingId",
    tas."trainingName",
    tas.frequency,
    tas."currentPeriod",
    COUNT(*) FILTER (WHERE tas.status != 'Not Required'),
    COUNT(*) FILTER (WHERE tas.status = 'Completed'),
    COUNT(*) FILTER (WHERE tas.status = 'Pending'),
    COUNT(*) FILTER (WHERE tas.status = 'Overdue'),
    CASE
      WHEN COUNT(*) FILTER (WHERE tas.status != 'Not Required') = 0 THEN 100
      ELSE ROUND(COUNT(*) FILTER (WHERE tas.status = 'Completed')::NUMERIC * 100 /
           NULLIF(COUNT(*) FILTER (WHERE tas.status != 'Not Required'), 0), 1)
    END
  FROM get_training_assignment_status(p_company_id) tas
  GROUP BY tas."trainingId", tas."trainingName", tas.frequency, tas."currentPeriod";
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_production_projections(company_id text, location_id text, periods text[])
 RETURNS TABLE(id text, "readableIdWithRevision" text, name text, active boolean, type "itemType", "itemTrackingType" "itemTrackingType", "replenishmentSystem" "itemReplenishmentSystem", "thumbnailPath" text, "unitOfMeasureCode" text, "leadTime" integer, "manufacturingBlocked" boolean, "lotSize" integer, "reorderingPolicy" "itemReorderingPolicy", "demandAccumulationPeriod" integer, "demandAccumulationSafetyStock" numeric, "reorderPoint" integer, "reorderQuantity" integer, "minimumOrderQuantity" integer, "maximumOrderQuantity" integer, "orderMultiple" integer, "quantityOnHand" numeric, "maximumInventoryQuantity" numeric, week1 numeric, week2 numeric, week3 numeric, week4 numeric, week5 numeric, week6 numeric, week7 numeric, week8 numeric, week9 numeric, week10 numeric, week11 numeric, week12 numeric, week13 numeric, week14 numeric, week15 numeric, week16 numeric, week17 numeric, week18 numeric, week19 numeric, week20 numeric, week21 numeric, week22 numeric, week23 numeric, week24 numeric, week25 numeric, week26 numeric, week27 numeric, week28 numeric, week29 numeric, week30 numeric, week31 numeric, week32 numeric, week33 numeric, week34 numeric, week35 numeric, week36 numeric, week37 numeric, week38 numeric, week39 numeric, week40 numeric, week41 numeric, week42 numeric, week43 numeric, week44 numeric, week45 numeric, week46 numeric, week47 numeric, week48 numeric, week49 numeric, week50 numeric, week51 numeric, week52 numeric)
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT assert_company_access(company_id);
  SELECT
    i."id",
    i."readableIdWithRevision",
    i."name",
    i."active",
    i."type",
    i."itemTrackingType",
    i."replenishmentSystem",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      ELSE i."thumbnailPath"
    END AS "thumbnailPath",
    i."unitOfMeasureCode",
    ir."leadTime",
    ir."manufacturingBlocked",
    ir."lotSize",
    ip."reorderingPolicy",
    ip."demandAccumulationPeriod",
    ip."demandAccumulationSafetyStock",
    ip."reorderPoint",
    ip."reorderQuantity",
    ip."minimumOrderQuantity",
    ip."maximumOrderQuantity",
    ip."orderMultiple",
    COALESCE((
      SELECT SUM("quantity")
      FROM "itemLedger"
      WHERE "companyId" = company_id
        AND "locationId" = location_id
        AND "itemId" = i."id"
    ), 0) AS "quantityOnHand",
    ip."maximumInventoryQuantity",
    MAX(CASE WHEN df."periodId" = periods[1] THEN df."forecastQuantity" END) AS "week1",
    MAX(CASE WHEN df."periodId" = periods[2] THEN df."forecastQuantity" END) AS "week2",
    MAX(CASE WHEN df."periodId" = periods[3] THEN df."forecastQuantity" END) AS "week3",
    MAX(CASE WHEN df."periodId" = periods[4] THEN df."forecastQuantity" END) AS "week4",
    MAX(CASE WHEN df."periodId" = periods[5] THEN df."forecastQuantity" END) AS "week5",
    MAX(CASE WHEN df."periodId" = periods[6] THEN df."forecastQuantity" END) AS "week6",
    MAX(CASE WHEN df."periodId" = periods[7] THEN df."forecastQuantity" END) AS "week7",
    MAX(CASE WHEN df."periodId" = periods[8] THEN df."forecastQuantity" END) AS "week8",
    MAX(CASE WHEN df."periodId" = periods[9] THEN df."forecastQuantity" END) AS "week9",
    MAX(CASE WHEN df."periodId" = periods[10] THEN df."forecastQuantity" END) AS "week10",
    MAX(CASE WHEN df."periodId" = periods[11] THEN df."forecastQuantity" END) AS "week11",
    MAX(CASE WHEN df."periodId" = periods[12] THEN df."forecastQuantity" END) AS "week12",
    MAX(CASE WHEN df."periodId" = periods[13] THEN df."forecastQuantity" END) AS "week13",
    MAX(CASE WHEN df."periodId" = periods[14] THEN df."forecastQuantity" END) AS "week14",
    MAX(CASE WHEN df."periodId" = periods[15] THEN df."forecastQuantity" END) AS "week15",
    MAX(CASE WHEN df."periodId" = periods[16] THEN df."forecastQuantity" END) AS "week16",
    MAX(CASE WHEN df."periodId" = periods[17] THEN df."forecastQuantity" END) AS "week17",
    MAX(CASE WHEN df."periodId" = periods[18] THEN df."forecastQuantity" END) AS "week18",
    MAX(CASE WHEN df."periodId" = periods[19] THEN df."forecastQuantity" END) AS "week19",
    MAX(CASE WHEN df."periodId" = periods[20] THEN df."forecastQuantity" END) AS "week20",
    MAX(CASE WHEN df."periodId" = periods[21] THEN df."forecastQuantity" END) AS "week21",
    MAX(CASE WHEN df."periodId" = periods[22] THEN df."forecastQuantity" END) AS "week22",
    MAX(CASE WHEN df."periodId" = periods[23] THEN df."forecastQuantity" END) AS "week23",
    MAX(CASE WHEN df."periodId" = periods[24] THEN df."forecastQuantity" END) AS "week24",
    MAX(CASE WHEN df."periodId" = periods[25] THEN df."forecastQuantity" END) AS "week25",
    MAX(CASE WHEN df."periodId" = periods[26] THEN df."forecastQuantity" END) AS "week26",
    MAX(CASE WHEN df."periodId" = periods[27] THEN df."forecastQuantity" END) AS "week27",
    MAX(CASE WHEN df."periodId" = periods[28] THEN df."forecastQuantity" END) AS "week28",
    MAX(CASE WHEN df."periodId" = periods[29] THEN df."forecastQuantity" END) AS "week29",
    MAX(CASE WHEN df."periodId" = periods[30] THEN df."forecastQuantity" END) AS "week30",
    MAX(CASE WHEN df."periodId" = periods[31] THEN df."forecastQuantity" END) AS "week31",
    MAX(CASE WHEN df."periodId" = periods[32] THEN df."forecastQuantity" END) AS "week32",
    MAX(CASE WHEN df."periodId" = periods[33] THEN df."forecastQuantity" END) AS "week33",
    MAX(CASE WHEN df."periodId" = periods[34] THEN df."forecastQuantity" END) AS "week34",
    MAX(CASE WHEN df."periodId" = periods[35] THEN df."forecastQuantity" END) AS "week35",
    MAX(CASE WHEN df."periodId" = periods[36] THEN df."forecastQuantity" END) AS "week36",
    MAX(CASE WHEN df."periodId" = periods[37] THEN df."forecastQuantity" END) AS "week37",
    MAX(CASE WHEN df."periodId" = periods[38] THEN df."forecastQuantity" END) AS "week38",
    MAX(CASE WHEN df."periodId" = periods[39] THEN df."forecastQuantity" END) AS "week39",
    MAX(CASE WHEN df."periodId" = periods[40] THEN df."forecastQuantity" END) AS "week40",
    MAX(CASE WHEN df."periodId" = periods[41] THEN df."forecastQuantity" END) AS "week41",
    MAX(CASE WHEN df."periodId" = periods[42] THEN df."forecastQuantity" END) AS "week42",
    MAX(CASE WHEN df."periodId" = periods[43] THEN df."forecastQuantity" END) AS "week43",
    MAX(CASE WHEN df."periodId" = periods[44] THEN df."forecastQuantity" END) AS "week44",
    MAX(CASE WHEN df."periodId" = periods[45] THEN df."forecastQuantity" END) AS "week45",
    MAX(CASE WHEN df."periodId" = periods[46] THEN df."forecastQuantity" END) AS "week46",
    MAX(CASE WHEN df."periodId" = periods[47] THEN df."forecastQuantity" END) AS "week47",
    MAX(CASE WHEN df."periodId" = periods[48] THEN df."forecastQuantity" END) AS "week48",
    MAX(CASE WHEN df."periodId" = periods[49] THEN df."forecastQuantity" END) AS "week49",
    MAX(CASE WHEN df."periodId" = periods[50] THEN df."forecastQuantity" END) AS "week50",
    MAX(CASE WHEN df."periodId" = periods[51] THEN df."forecastQuantity" END) AS "week51",
    MAX(CASE WHEN df."periodId" = periods[52] THEN df."forecastQuantity" END) AS "week52"
  FROM "item" i
  INNER JOIN "itemReplenishment" ir ON i."id" = ir."itemId"
  INNER JOIN "itemPlanning" ip ON i."id" = ip."itemId" AND ip."locationId" = location_id
  LEFT JOIN "modelUpload" mu ON mu."id" = i."modelUploadId"
  INNER JOIN "demandProjection" df ON df."itemId" = i."id" 
    AND df."companyId" = company_id 
    AND df."locationId" = location_id
    AND df."periodId" = ANY(periods)
  WHERE i."companyId" = company_id
    AND i."replenishmentSystem" = 'Make'
    AND i."itemTrackingType" != 'Non-Inventory'
    AND i."active" = TRUE
  GROUP BY
    i."id",
    i."readableIdWithRevision",
    i."name",
    i."active",
    i."type",
    i."itemTrackingType",
    i."replenishmentSystem",
    i."thumbnailPath",
    mu."thumbnailPath",
    i."unitOfMeasureCode",
    ir."leadTime",
    ir."manufacturingBlocked",
    ir."lotSize",
    ip."reorderingPolicy",
    ip."demandAccumulationPeriod",
    ip."demandAccumulationSafetyStock",
    ip."reorderPoint",
    ip."reorderQuantity",
    ip."minimumOrderQuantity",
    ip."maximumOrderQuantity",
    ip."orderMultiple",
    ip."maximumInventoryQuantity";
$function$;

CREATE OR REPLACE FUNCTION public.get_purchasing_planning(company_id text, location_id text, periods text[])
 RETURNS TABLE(id text, "readableIdWithRevision" text, name text, active boolean, type "itemType", "itemTrackingType" "itemTrackingType", "replenishmentSystem" "itemReplenishmentSystem", "thumbnailPath" text, "unitOfMeasureCode" text, "leadTime" integer, "purchasingBlocked" boolean, "lotSize" integer, "reorderingPolicy" "itemReorderingPolicy", "demandAccumulationPeriod" integer, "demandAccumulationSafetyStock" numeric, "reorderPoint" integer, "reorderQuantity" integer, "minimumOrderQuantity" integer, "maximumOrderQuantity" integer, "orderMultiple" integer, "quantityOnHand" numeric, "maximumInventoryQuantity" numeric, suppliers jsonb, "preferredSupplierId" text, "purchasingUnitOfMeasureCode" text, "conversionFactor" numeric, "quantityToOrder" numeric, "supersessionMode" text, "minimumReserveQuantity" numeric, week1 numeric, week2 numeric, week3 numeric, week4 numeric, week5 numeric, week6 numeric, week7 numeric, week8 numeric, week9 numeric, week10 numeric, week11 numeric, week12 numeric, week13 numeric, week14 numeric, week15 numeric, week16 numeric, week17 numeric, week18 numeric, week19 numeric, week20 numeric, week21 numeric, week22 numeric, week23 numeric, week24 numeric, week25 numeric, week26 numeric, week27 numeric, week28 numeric, week29 numeric, week30 numeric, week31 numeric, week32 numeric, week33 numeric, week34 numeric, week35 numeric, week36 numeric, week37 numeric, week38 numeric, week39 numeric, week40 numeric, week41 numeric, week42 numeric, week43 numeric, week44 numeric, week45 numeric, week46 numeric, week47 numeric, week48 numeric, week49 numeric, week50 numeric, week51 numeric, week52 numeric)
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT assert_company_access(company_id);
  WITH RECURSIVE
  supply_data AS (
    SELECT
      "itemId",
      "periodId",
      SUM(COALESCE("actualQuantity", 0) + COALESCE("forecastQuantity", 0)) AS "supply"
    FROM (
      SELECT "itemId", "periodId", "actualQuantity", NULL as "forecastQuantity"
      FROM "supplyActual"
      WHERE "companyId" = company_id
        AND "locationId" = location_id
        AND "periodId" = ANY(periods)
      UNION ALL
      SELECT "itemId", "periodId", NULL as "actualQuantity", "forecastQuantity"
      FROM "supplyForecast"
      WHERE "companyId" = company_id
        AND "locationId" = location_id
        AND "periodId" = ANY(periods)
    ) combined
    GROUP BY "itemId", "periodId"
  ),
  demand_data AS (
    SELECT
      "itemId",
      "periodId",
      SUM(COALESCE("actualQuantity", 0) + COALESCE("forecastQuantity", 0)) AS "demand"
    FROM (
      SELECT "itemId", "periodId", "actualQuantity", NULL as "forecastQuantity"
      FROM "demandActual"
      WHERE "companyId" = company_id
        AND "locationId" = location_id
        AND "periodId" = ANY(periods)
      UNION ALL
      SELECT "itemId", "periodId", NULL as "actualQuantity", "forecastQuantity"
      FROM "demandForecast"
      WHERE "companyId" = company_id
        AND "locationId" = location_id
        AND "periodId" = ANY(periods)
      UNION ALL
      -- Top-level manual projections. The "Demand Forecast" drawer writes the
      -- demandProjection table; MRP explodes these into child demand
      -- (demandForecast) but the projected item's OWN demand lives only here —
      -- without this arm a purchased item whose only demand is a projection never
      -- appears in purchasing planning and never drives a suggested order.
      SELECT "itemId", "periodId", NULL as "actualQuantity", "forecastQuantity"
      FROM "demandProjection"
      WHERE "companyId" = company_id
        AND "locationId" = location_id
        AND "periodId" = ANY(periods)
    ) combined
    GROUP BY "itemId", "periodId"
  ),
  base_items AS (
    SELECT DISTINCT ON (i."id")
      i."id",
      i."readableIdWithRevision",
      i."name",
      i."active",
      i."type",
      i."itemTrackingType",
      i."replenishmentSystem",
      CASE
        WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
        ELSE i."thumbnailPath"
      END AS "thumbnailPath",
      i."unitOfMeasureCode",
      ir."leadTime",
      ir."purchasingBlocked",
      ir."lotSize",
      ir."preferredSupplierId",
      ir."purchasingUnitOfMeasureCode",
      ir."conversionFactor",
      ip."reorderingPolicy",
      ip."demandAccumulationPeriod",
      ip."demandAccumulationSafetyStock",
      ip."reorderPoint",
      ip."reorderQuantity",
      ip."minimumOrderQuantity",
      ip."maximumOrderQuantity",
      ip."orderMultiple",
      ip."maximumInventoryQuantity",
      COALESCE(ps."suppliers", '[]'::jsonb) as "suppliers",
      COALESCE((
        SELECT SUM("quantity")
        FROM "itemLedger"
        WHERE "companyId" = company_id
          AND "locationId" = location_id
          AND "itemId" = i."id"
      ), 0) AS "quantityOnHand"
    FROM "item" i
    INNER JOIN "itemReplenishment" ir ON i."id" = ir."itemId"
    INNER JOIN "itemPlanning" ip ON i."id" = ip."itemId" AND ip."locationId" = location_id
    LEFT JOIN "modelUpload" mu ON mu."id" = i."modelUploadId"
    LEFT JOIN (
      SELECT
        ps."itemId",
        jsonb_agg(
          jsonb_build_object(
            'id', ps."id",
            'minimumOrderQuantity', ps."minimumOrderQuantity",
            'supplierUnitOfMeasureCode', ps."supplierUnitOfMeasureCode",
            'conversionFactor', ps."conversionFactor",
            'unitPrice', ps."unitPrice",
            'supplierId', ps."supplierId",
            'supplierPartId', ps."supplierPartId"
          )
        ) AS "suppliers"
      FROM "supplierPart" ps
      WHERE ps."companyId" = company_id
        AND ps.active = true
      GROUP BY ps."itemId"
    ) ps ON ps."itemId" = i."id"
    WHERE i."companyId" = company_id
      AND i."replenishmentSystem" != 'Make'
      AND i."itemTrackingType" != 'Non-Inventory'
      AND i."active" = TRUE
      -- Supersession: drop obsolete items and items past their discontinuation
      -- date so no new orders are suggested.
      AND NOT EXISTS (
        SELECT 1 FROM "itemSupersession" ss
        WHERE ss."itemId" = i."id"
          AND (
            ss."supersessionMode" = 'No Stock'
            OR (
              -- date-based suppression applies only to the phase-out modes; Stock
              -- Only keeps replenishing to its reserve floor regardless of date.
              ss."supersessionMode" IN ('Consume First', 'Prefer New')
              AND ss."discontinuationDate" IS NOT NULL
              AND ss."discontinuationDate" <= CURRENT_DATE
            )
          )
      )
      AND (
        EXISTS (
          SELECT 1 FROM demand_data d
          WHERE d."itemId" = i."id"
        )
        OR (
          ip."reorderPoint" > 0
          AND ip."reorderingPolicy" IN ('Fixed Reorder Quantity', 'Maximum Quantity')
        )
      )
  ),
  projections AS (
    SELECT
      bi.*,
      periods[1] as "periodId",
      bi."quantityOnHand" + COALESCE(s."supply", 0) - COALESCE(d."demand", 0) AS "projection",
      1 as period_index
    FROM base_items bi
    LEFT JOIN supply_data s ON bi."id" = s."itemId" AND s."periodId" = periods[1]
    LEFT JOIN demand_data d ON bi."id" = d."itemId" AND d."periodId" = periods[1]

    UNION ALL

    SELECT
      p."id",
      p."readableIdWithRevision",
      p."name",
      p."active",
      p."type",
      p."itemTrackingType",
      p."replenishmentSystem",
      p."thumbnailPath",
      p."unitOfMeasureCode",
      p."leadTime",
      p."purchasingBlocked",
      p."lotSize",
      p."preferredSupplierId",
      p."purchasingUnitOfMeasureCode",
      p."conversionFactor",
      p."reorderingPolicy",
      p."demandAccumulationPeriod",
      p."demandAccumulationSafetyStock",
      p."reorderPoint",
      p."reorderQuantity",
      p."minimumOrderQuantity",
      p."maximumOrderQuantity",
      p."orderMultiple",
      p."maximumInventoryQuantity",
      p."suppliers",
      p."quantityOnHand",
      periods[p.period_index + 1] as "periodId",
      p."projection" + COALESCE(s."supply", 0) - COALESCE(d."demand", 0) AS "projection",
      p.period_index + 1 as period_index
    FROM projections p
    LEFT JOIN supply_data s ON p."id" = s."itemId" AND s."periodId" = periods[p.period_index + 1]
    LEFT JOIN demand_data d ON p."id" = d."itemId" AND d."periodId" = periods[p.period_index + 1]
    WHERE p.period_index < array_length(periods, 1)
  ),
  order_quantities AS (
    SELECT
      p."id",
      calculate_quantity_to_order(
        p."reorderingPolicy",
        p."reorderPoint",
        p."reorderQuantity",
        p."minimumOrderQuantity",
        p."maximumOrderQuantity",
        p."orderMultiple",
        p."lotSize",
        p."maximumInventoryQuantity",
        p."demandAccumulationPeriod",
        p."demandAccumulationSafetyStock",
        array_agg(p."projection" ORDER BY p.period_index)
      ) AS "quantityToOrder"
    FROM projections p
    GROUP BY
      p."id",
      p."reorderingPolicy",
      p."reorderPoint",
      p."reorderQuantity",
      p."minimumOrderQuantity",
      p."maximumOrderQuantity",
      p."orderMultiple",
      p."lotSize",
      p."maximumInventoryQuantity",
      p."demandAccumulationPeriod",
      p."demandAccumulationSafetyStock"
  )
  SELECT DISTINCT ON (p."id")
    p."id",
    p."readableIdWithRevision",
    p."name",
    p."active",
    p."type",
    p."itemTrackingType",
    p."replenishmentSystem",
    p."thumbnailPath",
    p."unitOfMeasureCode",
    p."leadTime",
    p."purchasingBlocked",
    p."lotSize",
    p."reorderingPolicy",
    p."demandAccumulationPeriod",
    p."demandAccumulationSafetyStock",
    p."reorderPoint",
    p."reorderQuantity",
    p."minimumOrderQuantity",
    p."maximumOrderQuantity",
    p."orderMultiple",
    p."quantityOnHand",
    p."maximumInventoryQuantity",
    p."suppliers",
    p."preferredSupplierId",
    p."purchasingUnitOfMeasureCode",
    p."conversionFactor",
    CASE
      WHEN ss."supersessionMode" = 'Stock Only'
        THEN GREATEST(
          0,
          COALESCE(rsv."minimumReserveQuantity", 0)
            - p."quantityOnHand"
            - COALESCE(sup."incomingSupply", 0)
        )
      ELSE COALESCE(oq."quantityToOrder", 0)
    END AS "quantityToOrder",
    ss."supersessionMode" AS "supersessionMode",
    COALESCE(rsv."minimumReserveQuantity", 0) AS "minimumReserveQuantity",
    MAX(CASE WHEN p."periodId" = periods[1] THEN p."projection" END) AS "week1",
    MAX(CASE WHEN p."periodId" = periods[2] THEN p."projection" END) AS "week2",
    MAX(CASE WHEN p."periodId" = periods[3] THEN p."projection" END) AS "week3",
    MAX(CASE WHEN p."periodId" = periods[4] THEN p."projection" END) AS "week4",
    MAX(CASE WHEN p."periodId" = periods[5] THEN p."projection" END) AS "week5",
    MAX(CASE WHEN p."periodId" = periods[6] THEN p."projection" END) AS "week6",
    MAX(CASE WHEN p."periodId" = periods[7] THEN p."projection" END) AS "week7",
    MAX(CASE WHEN p."periodId" = periods[8] THEN p."projection" END) AS "week8",
    MAX(CASE WHEN p."periodId" = periods[9] THEN p."projection" END) AS "week9",
    MAX(CASE WHEN p."periodId" = periods[10] THEN p."projection" END) AS "week10",
    MAX(CASE WHEN p."periodId" = periods[11] THEN p."projection" END) AS "week11",
    MAX(CASE WHEN p."periodId" = periods[12] THEN p."projection" END) AS "week12",
    MAX(CASE WHEN p."periodId" = periods[13] THEN p."projection" END) AS "week13",
    MAX(CASE WHEN p."periodId" = periods[14] THEN p."projection" END) AS "week14",
    MAX(CASE WHEN p."periodId" = periods[15] THEN p."projection" END) AS "week15",
    MAX(CASE WHEN p."periodId" = periods[16] THEN p."projection" END) AS "week16",
    MAX(CASE WHEN p."periodId" = periods[17] THEN p."projection" END) AS "week17",
    MAX(CASE WHEN p."periodId" = periods[18] THEN p."projection" END) AS "week18",
    MAX(CASE WHEN p."periodId" = periods[19] THEN p."projection" END) AS "week19",
    MAX(CASE WHEN p."periodId" = periods[20] THEN p."projection" END) AS "week20",
    MAX(CASE WHEN p."periodId" = periods[21] THEN p."projection" END) AS "week21",
    MAX(CASE WHEN p."periodId" = periods[22] THEN p."projection" END) AS "week22",
    MAX(CASE WHEN p."periodId" = periods[23] THEN p."projection" END) AS "week23",
    MAX(CASE WHEN p."periodId" = periods[24] THEN p."projection" END) AS "week24",
    MAX(CASE WHEN p."periodId" = periods[25] THEN p."projection" END) AS "week25",
    MAX(CASE WHEN p."periodId" = periods[26] THEN p."projection" END) AS "week26",
    MAX(CASE WHEN p."periodId" = periods[27] THEN p."projection" END) AS "week27",
    MAX(CASE WHEN p."periodId" = periods[28] THEN p."projection" END) AS "week28",
    MAX(CASE WHEN p."periodId" = periods[29] THEN p."projection" END) AS "week29",
    MAX(CASE WHEN p."periodId" = periods[30] THEN p."projection" END) AS "week30",
    MAX(CASE WHEN p."periodId" = periods[31] THEN p."projection" END) AS "week31",
    MAX(CASE WHEN p."periodId" = periods[32] THEN p."projection" END) AS "week32",
    MAX(CASE WHEN p."periodId" = periods[33] THEN p."projection" END) AS "week33",
    MAX(CASE WHEN p."periodId" = periods[34] THEN p."projection" END) AS "week34",
    MAX(CASE WHEN p."periodId" = periods[35] THEN p."projection" END) AS "week35",
    MAX(CASE WHEN p."periodId" = periods[36] THEN p."projection" END) AS "week36",
    MAX(CASE WHEN p."periodId" = periods[37] THEN p."projection" END) AS "week37",
    MAX(CASE WHEN p."periodId" = periods[38] THEN p."projection" END) AS "week38",
    MAX(CASE WHEN p."periodId" = periods[39] THEN p."projection" END) AS "week39",
    MAX(CASE WHEN p."periodId" = periods[40] THEN p."projection" END) AS "week40",
    MAX(CASE WHEN p."periodId" = periods[41] THEN p."projection" END) AS "week41",
    MAX(CASE WHEN p."periodId" = periods[42] THEN p."projection" END) AS "week42",
    MAX(CASE WHEN p."periodId" = periods[43] THEN p."projection" END) AS "week43",
    MAX(CASE WHEN p."periodId" = periods[44] THEN p."projection" END) AS "week44",
    MAX(CASE WHEN p."periodId" = periods[45] THEN p."projection" END) AS "week45",
    MAX(CASE WHEN p."periodId" = periods[46] THEN p."projection" END) AS "week46",
    MAX(CASE WHEN p."periodId" = periods[47] THEN p."projection" END) AS "week47",
    MAX(CASE WHEN p."periodId" = periods[48] THEN p."projection" END) AS "week48",
    MAX(CASE WHEN p."periodId" = periods[49] THEN p."projection" END) AS "week49",
    MAX(CASE WHEN p."periodId" = periods[50] THEN p."projection" END) AS "week50",
    MAX(CASE WHEN p."periodId" = periods[51] THEN p."projection" END) AS "week51",
    MAX(CASE WHEN p."periodId" = periods[52] THEN p."projection" END) AS "week52"
  FROM projections p
  LEFT JOIN order_quantities oq ON p."id" = oq."id"
  LEFT JOIN "itemSupersession" ss ON ss."itemId" = p."id"
  LEFT JOIN "itemPlanning" rsv ON rsv."itemId" = p."id" AND rsv."locationId" = location_id
  LEFT JOIN (
    SELECT "itemId", SUM("supply") AS "incomingSupply"
    FROM supply_data GROUP BY "itemId"
  ) sup ON sup."itemId" = p."id"
  GROUP BY
    p."id",
    p."readableIdWithRevision",
    p."name",
    p."active",
    p."type",
    p."itemTrackingType",
    p."replenishmentSystem",
    p."thumbnailPath",
    p."unitOfMeasureCode",
    p."leadTime",
    p."purchasingBlocked",
    p."lotSize",
    p."reorderingPolicy",
    p."demandAccumulationPeriod",
    p."demandAccumulationSafetyStock",
    p."reorderPoint",
    p."reorderQuantity",
    p."minimumOrderQuantity",
    p."maximumOrderQuantity",
    p."orderMultiple",
    p."quantityOnHand",
    p."maximumInventoryQuantity",
    p."suppliers",
    p."preferredSupplierId",
    p."purchasingUnitOfMeasureCode",
    p."conversionFactor",
    oq."quantityToOrder",
    ss."supersessionMode",
    rsv."minimumReserveQuantity",
    sup."incomingSupply";
$function$;

CREATE OR REPLACE FUNCTION public.get_returnable_receipt_lines(company_id text, supplier_id text, purchase_order_id text DEFAULT NULL::text, search text DEFAULT NULL::text, limit_count integer DEFAULT 5, offset_count integer DEFAULT 0)
 RETURNS TABLE("receiptLineId" text, "receiptReadableId" text, "purchaseOrderReadableId" text, "purchaseOrderLineId" text, "itemId" text, "itemReadableId" text, "itemName" text, "itemTrackingType" text, "receivedQuantity" numeric, "alreadyReturned" numeric, "returnableQuantity" numeric, "unitPrice" numeric, "unitOfMeasureCode" text, "totalCount" bigint)
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT assert_company_access(company_id);
  WITH candidate AS (
    SELECT
      rl.id AS receipt_line_id,
      r."receiptId" AS receipt_readable_id,
      r."sourceDocumentReadableId" AS po_readable_id,
      rl."lineId" AS po_line_id,
      rl."itemId" AS item_id,
      i."readableIdWithRevision" AS item_readable_id,
      i."name" AS item_name,
      i."itemTrackingType"::text AS item_tracking_type,
      rl."receivedQuantity" AS received_quantity,
      rl."unitOfMeasure" AS unit_of_measure_code,
      r."postingDate" AS posting_date,
      r."createdAt" AS created_at,
      -- supplierUnitPrice is per purchase unit; the return order + credit memo
      -- are in inventory units, so divide by the conversion factor.
      COALESCE(pol."supplierUnitPrice", 0)
        / NULLIF(COALESCE(pol."conversionFactor", 1), 0) AS unit_price,
      COALESCE(auth.total_authorized, 0) AS already_returned
    FROM "receiptLine" rl
    JOIN "receipt" r
      ON r.id = rl."receiptId" AND r."companyId" = rl."companyId"
    JOIN "item" i
      ON i.id = rl."itemId"
    LEFT JOIN "purchaseOrderLine" pol
      ON pol.id = rl."lineId" AND pol."companyId" = rl."companyId"
    LEFT JOIN (
      SELECT prol."receiptLineId", SUM(prol."quantity") AS total_authorized
      FROM "purchaseReturnOrderLine" prol
      JOIN "purchaseReturnOrder" pro
        ON pro.id = prol."purchaseReturnOrderId"
        AND pro."companyId" = prol."companyId"
      WHERE prol."companyId" = company_id
        AND prol."receiptLineId" IS NOT NULL
        AND pro."status" <> 'Cancelled'
      GROUP BY prol."receiptLineId"
    ) auth ON auth."receiptLineId" = rl.id
    WHERE rl."companyId" = company_id
      AND r."supplierId" = supplier_id
      AND r."sourceDocument" = 'Purchase Order'
      AND r."status" = 'Posted'
      AND (purchase_order_id IS NULL OR r."sourceDocumentId" = purchase_order_id)
      AND (
        search IS NULL OR search = '' OR
        r."receiptId" ILIKE '%' || search || '%' OR
        r."sourceDocumentReadableId" ILIKE '%' || search || '%' OR
        i."readableIdWithRevision" ILIKE '%' || search || '%' OR
        i."name" ILIKE '%' || search || '%'
      )
  ),
  returnable AS (
    SELECT *, (received_quantity - already_returned) AS returnable_quantity
    FROM candidate
    WHERE (received_quantity - already_returned) > 0.000001
  )
  SELECT
    receipt_line_id,
    receipt_readable_id,
    po_readable_id,
    po_line_id,
    item_id,
    item_readable_id,
    item_name,
    item_tracking_type,
    received_quantity,
    already_returned,
    returnable_quantity,
    unit_price,
    unit_of_measure_code,
    COUNT(*) OVER () AS total_count
  FROM returnable
  ORDER BY posting_date DESC NULLS LAST, created_at DESC, receipt_line_id
  LIMIT limit_count OFFSET offset_count;
$function$;

CREATE OR REPLACE FUNCTION public.get_returnable_shipment_lines(company_id text, customer_id text, sales_order_id text DEFAULT NULL::text, search text DEFAULT NULL::text, limit_count integer DEFAULT 5, offset_count integer DEFAULT 0)
 RETURNS TABLE("shipmentLineId" text, "shipmentReadableId" text, "salesOrderReadableId" text, "salesOrderLineId" text, "itemId" text, "itemReadableId" text, "itemName" text, "itemTrackingType" text, "shippedQuantity" numeric, "alreadyReturned" numeric, "returnableQuantity" numeric, "unitPrice" numeric, "unitOfMeasureCode" text, "totalCount" bigint)
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT assert_company_access(company_id);
  WITH candidate AS (
    SELECT
      sl.id AS shipment_line_id,
      s."shipmentId" AS shipment_readable_id,
      s."sourceDocumentReadableId" AS so_readable_id,
      sl."lineId" AS so_line_id,
      sl."itemId" AS item_id,
      i."readableIdWithRevision" AS item_readable_id,
      i."name" AS item_name,
      i."itemTrackingType"::text AS item_tracking_type,
      sl."shippedQuantity" AS shipped_quantity,
      COALESCE(sol."unitOfMeasureCode", sl."unitOfMeasure") AS unit_of_measure_code,
      s."postingDate" AS posting_date,
      s."createdAt" AS created_at,
      COALESCE(sol."unitPrice", 0) AS unit_price,
      COALESCE(auth.total_authorized, 0) AS already_returned
    FROM "shipmentLine" sl
    JOIN "shipment" s
      ON s.id = sl."shipmentId" AND s."companyId" = sl."companyId"
    JOIN "item" i
      ON i.id = sl."itemId"
    LEFT JOIN "salesOrderLine" sol
      ON sol.id = sl."lineId" AND sol."companyId" = sl."companyId"
    LEFT JOIN (
      SELECT srol."shipmentLineId", SUM(srol."quantity") AS total_authorized
      FROM "salesReturnOrderLine" srol
      JOIN "salesReturnOrder" sro
        ON sro.id = srol."salesReturnOrderId"
        AND sro."companyId" = srol."companyId"
      WHERE srol."companyId" = company_id
        AND srol."shipmentLineId" IS NOT NULL
        AND sro."status" <> 'Cancelled'
      GROUP BY srol."shipmentLineId"
    ) auth ON auth."shipmentLineId" = sl.id
    WHERE sl."companyId" = company_id
      AND s."customerId" = customer_id
      AND s."sourceDocument" = 'Sales Order'
      AND s."status" = 'Posted'
      AND (sales_order_id IS NULL OR s."sourceDocumentId" = sales_order_id)
      AND (
        search IS NULL OR search = '' OR
        s."shipmentId" ILIKE '%' || search || '%' OR
        s."sourceDocumentReadableId" ILIKE '%' || search || '%' OR
        i."readableIdWithRevision" ILIKE '%' || search || '%' OR
        i."name" ILIKE '%' || search || '%'
      )
  ),
  returnable AS (
    SELECT *, (shipped_quantity - already_returned) AS returnable_quantity
    FROM candidate
    WHERE (shipped_quantity - already_returned) > 0.000001
  )
  SELECT
    shipment_line_id,
    shipment_readable_id,
    so_readable_id,
    so_line_id,
    item_id,
    item_readable_id,
    item_name,
    item_tracking_type,
    shipped_quantity,
    already_returned,
    returnable_quantity,
    unit_price,
    unit_of_measure_code,
    COUNT(*) OVER () AS total_count
  FROM returnable
  ORDER BY posting_date DESC NULLS LAST, created_at DESC, shipment_line_id
  LIMIT limit_count OFFSET offset_count;
$function$;

CREATE OR REPLACE FUNCTION public.get_claims(uid text, company text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  DECLARE company_role text;
  DECLARE role_object jsonb;
  DECLARE perms jsonb;
  BEGIN
    -- Your own claims, or those of someone in a company where you may view or
    -- update users (the permission editor reads them with users_update alone).
    IF current_setting('role', true) IN ('anon', 'authenticated')
       AND uid IS DISTINCT FROM auth.uid()::text
       AND NOT EXISTS (
         SELECT 1 FROM "userToCompany" utc
         WHERE utc."userId" = uid
           AND utc."companyId" = ANY (
             get_companies_with_employee_permission('users_view')
             || get_companies_with_employee_permission('users_update')
           )
       ) THEN
      RAISE EXCEPTION 'Not authorized to read claims for this user'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    select role from "userToCompany" into company_role where "userId" = uid AND "companyId" = company;
    select permissions from "userPermission" into perms where id = uid;
    role_object := jsonb_build_object('role', company_role);


    return (role_object || perms)::jsonb;
  END;
$function$;

CREATE OR REPLACE FUNCTION public.groups_for_user(uid text)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  DECLARE retval TEXT[];
  BEGIN
    WITH RECURSIVE "groupsForUser" AS (
      SELECT "groupId", "memberGroupId", "memberUserId" FROM "membership"
      WHERE "memberUserId" = uid::text
      UNION
        SELECT g1."groupId", g1."memberGroupId", g1."memberUserId" FROM "membership" g1
        INNER JOIN "groupsForUser" g2 ON g2."groupId" = g1."memberGroupId"
    ) SELECT COALESCE(array_agg("groupId"), '{}') INTO retval FROM "groupsForUser";

    -- Someone else's groups: only those in a company the caller belongs to.
    IF current_setting('role', true) IN ('anon', 'authenticated')
       AND uid IS DISTINCT FROM auth.uid()::text THEN
      SELECT COALESCE(array_agg(g.id), '{}') INTO retval
      FROM "group" g
      WHERE g.id = ANY (retval)
        AND g."companyId" = ANY (get_companies_with_employee_role());
    END IF;

    RETURN retval;
  END;
$function$;

CREATE OR REPLACE FUNCTION public.users_for_groups(groups text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  DECLARE retval jsonb;
  BEGIN
    IF current_setting('role', true) IN ('anon', 'authenticated') THEN
      groups := ARRAY(
        SELECT g.id FROM "group" g
        WHERE g.id = ANY (groups)
          AND g."companyId" = ANY (get_companies_with_employee_role())
      );
    END IF;

    WITH RECURSIVE "usersForGroups" AS (
    SELECT "groupId", "memberGroupId", "memberUserId" FROM "membership"
    WHERE "groupId" = ANY(groups)
    UNION
      SELECT g1."groupId", g1."memberGroupId", g1."memberUserId" FROM "membership" g1
      INNER JOIN "usersForGroups" g2 ON g2."memberGroupId" = g1."groupId"
    ) SELECT coalesce(jsonb_agg("memberUserId"), '[]') AS groups INTO retval FROM "usersForGroups" WHERE "memberUserId" IS NOT NULL;
    RETURN retval;
  END;
$function$;

-- The event-system dispatchers call interceptors by name through dynamic SQL.
-- Run them as the owner so the interceptors below can be SECURITY INVOKER and
-- still behave exactly as before on every write. 59 of the 63 interceptors were
-- SECURITY DEFINER already; the other four only refuse deletes of posted
-- invoices or bump the parent's "updatedAt".
ALTER FUNCTION dispatch_event_interceptors() SECURITY DEFINER SET search_path = public;
ALTER FUNCTION dispatch_event_after_interceptors() SECURITY DEFINER SET search_path = public;

-- Internal SECURITY DEFINER functions, from the live catalog: every one that is
-- not a trigger, not called by the apps with a user or API-key client, not an
-- RLS helper, and not already guarded by current_setting('role'). They are
-- event interceptors, helpers called only from other SECURITY DEFINER
-- functions, or called only by service_role and direct connections. All tables
-- in "public", including the per-company searchIndex/auditLog tables, have RLS.
ALTER FUNCTION backflush_job_materials(text,numeric,text,text) SECURITY INVOKER;
ALTER FUNCTION check_api_key_rate_limit(text,integer,text) SECURITY INVOKER;
ALTER FUNCTION check_operation_dependencies(text) SECURITY INVOKER;
ALTER FUNCTION create_rfq_from_models_v1(text,text,text,json[]) SECURITY INVOKER;
ALTER FUNCTION create_rfq_from_models_v2(text,text,text,json[]) SECURITY INVOKER;
ALTER FUNCTION create_rfq_from_model_v1(text,text,text,text,text,text,json) SECURITY INVOKER;
ALTER FUNCTION delete_from_search_index(text,text,text) SECURITY INVOKER;
ALTER FUNCTION get_inventory_value_by_location(text) SECURITY INVOKER;
ALTER FUNCTION get_training_assignments_by_user(text) SECURITY INVOKER;
ALTER FUNCTION increment_webhook_error(text) SECURITY INVOKER;
ALTER FUNCTION increment_webhook_success(text) SECURITY INVOKER;
ALTER FUNCTION is_last_job_operation(text) SECURITY INVOKER;
ALTER FUNCTION items_search(vector,double precision,integer,text) SECURITY INVOKER;
ALTER FUNCTION populate_company_search_index(text) SECURITY INVOKER;
ALTER FUNCTION populate_sales_search_results(text) SECURITY INVOKER;
ALTER FUNCTION recompute_service_line_fulfillment(text,text,text) SECURITY INVOKER;
ALTER FUNCTION reconcile_item_stock_quantities() SECURITY INVOKER;
ALTER FUNCTION set_shelf_life_for_operation(text,"shelfLifeTriggerTiming") SECURITY INVOKER;
ALTER FUNCTION set_shelf_life_on_operation_done(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION set_shelf_life_on_operation_started(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION "snapshotAccountingPeriodBalances"(text,text,text) SECURITY INVOKER;
ALTER FUNCTION storage_unit_block_location_change_with_children(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION storage_unit_enforce_no_cycle(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION storage_unit_enforce_same_location(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION suppliers_search(vector,double precision,integer,text) SECURITY INVOKER;
ALTER FUNCTION sync_add_customer_account_to_group(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_add_employee_to_type_group(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_add_supplier_account_to_group(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_archive_other_procedures(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_archive_other_quality_documents(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_check_job_material_self_reference(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_check_method_material_self_reference(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_create_customer_entries(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_create_customer_org_group(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_create_customer_type_group(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_create_employee_type_group(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_create_item_related_records(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_create_location_related_records(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_create_make_method_related_records(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_create_nc_external_link(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_create_supplier_entries(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_create_supplier_org_group(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_create_supplier_type_group(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_create_user_identity_group(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_delete_tracked_entity_on_job_make_method(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_delete_user_identity_group(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_edit_document_transaction(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_finish_job_operation(jsonb,jsonb,text) SECURITY INVOKER;
ALTER FUNCTION sync_finish_job_operation(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_insert_company_related_records(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_insert_job_make_method(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_insert_job_material_make_method(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_insert_quote_line_make_method(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_insert_quote_material_make_method(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_job_complete_or_canceled(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_job_recompute_service_line(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_on_maintenance_dispatch_complete(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_propagate_item_readable_id_to_tracked_entity(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_protect_system_required_actions(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_purchase_invoice_line_price_change(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_set_initial_dependency_status(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_set_job_operation_in_progress(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_update_customer_type_group_name(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_update_customer_type_group(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_update_employee_type_group(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_update_employee_type_membership(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_update_job_material_make_method_item_id(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_update_job_operation_quantities(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_update_quote_exchange_rate(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_update_quote_line_make_method_item_id(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_update_quote_material_make_method_item_id(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_update_sales_order_exchange_rate(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_update_stock_transfer_status(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_update_supplier_type_group_name(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_update_supplier_type_group(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_update_tracked_entity_on_job_make_method(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_update_user_identity_group(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_upload_document_transaction(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_verify_integration(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION sync_webhook_subscription(text,text,jsonb,jsonb) SECURITY INVOKER;
ALTER FUNCTION upsert_to_search_index(text,text,text,text,text,text,text[],jsonb) SECURITY INVOKER;
