-- The cost of an outside processing purchase order never reached the job's
-- finished goods. Its receipt debits WIP under the receipt's id, with the
-- purchase order line in "documentLineReference" ('receipt:' || the line,
-- journalReference.to.receipt in packages/database/src/utils.ts), while every
-- reader of a job's WIP summed only the lines whose "documentId" is the job.
-- So the completion left the supplier's cost out, and closing the job never
-- wrote it off. A posted journal line cannot change
-- (check_posted_record_immutable), so the readers find these lines from the
-- purchase order line, not the other way round.
--
-- job_receipt_line_references is the one rule for which receipt lines are a
-- job's cost: a purchase order line is the job's by its own jobId, else by its
-- operation's (the operation link is nulled when the operation is deleted).
-- job_wip_balance reads it, and so do getWorkInProgressItems
-- (packages/database/src/accounting-cutover/open-items.ts) and the job lock
-- and close check of an outside processing receipt (inventory and production
-- services).
--
-- job_wip_balance is the one definition of what is in WIP for a job: its own
-- WIP lines, plus the WIP lines of those receipts. complete_job_to_inventory,
-- closeJob and attachJob all read it.

-- SQL, STABLE, SECURITY INVOKER and no SET clause, so the planner inlines it
-- into job_wip_balance and filters by the job there.
CREATE OR REPLACE FUNCTION public.job_receipt_line_references(
  p_company_id text,
  p_job_id text DEFAULT NULL
)
 RETURNS TABLE (
   "jobId" text,
   "purchaseOrderLineId" text,
   "documentLineReference" text
 )
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    COALESCE(pol."jobId", jo."jobId") AS "jobId",
    pol.id AS "purchaseOrderLineId",
    'receipt:' || pol.id AS "documentLineReference"
  FROM public."purchaseOrderLine" pol
  LEFT JOIN public."jobOperation" jo
    ON jo.id = pol."jobOperationId"
   AND jo."companyId" = pol."companyId"
  WHERE pol."companyId" = p_company_id
    AND COALESCE(pol."jobId", jo."jobId") IS NOT NULL
    AND (p_job_id IS NULL OR COALESCE(pol."jobId", jo."jobId") = p_job_id);
$function$;

-- SECURITY INVOKER: from complete_job_to_inventory it runs as the owner, and
-- from the API under the caller's RLS.
CREATE OR REPLACE FUNCTION public.job_wip_balance(
  p_job_id text,
  p_company_id text,
  p_exclude_project_lines boolean DEFAULT false
)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(jl.amount), 0)
  FROM "journalLine" jl
  INNER JOIN "journal" j
    ON j.id = jl."journalId"
   AND j."companyId" = jl."companyId"
  WHERE jl."companyId" = p_company_id
    AND jl."accountId" = (
      SELECT ad."workInProgressAccount"
      FROM "accountDefault" ad
      WHERE ad."companyId" = p_company_id
    )
    -- DOCUMENT_JOURNAL_STATUSES (@carbon/database/accounting-posting).
    AND j.status IN ('Provisional', 'Posted', 'Reversed')
    AND (
      jl."documentId" = p_job_id
      OR jl."documentLineReference" = ANY (ARRAY(
        SELECT ref."documentLineReference"
        FROM job_receipt_line_references(p_company_id, p_job_id) ref
      ))
    )
    -- A line that charged a project in place of WIP is the project's cost.
    AND (
      NOT p_exclude_project_lines
      OR NOT EXISTS (
        SELECT 1
        FROM "projectLedger" pl
        WHERE pl."journalLineId" = jl.id
          AND pl."companyId" = p_company_id
      )
    );
$function$;

-- Fork of 20261117205342_job-receipt-location-fallback.sql. The only change
-- is the accumulated WIP cost, which is now job_wip_balance, taken signed.

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
  v_posting_status "journalEntryStatus";
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
  v_issued_units_received NUMERIC := 0;
  v_units_taken INTEGER;
  v_seed_units_left NUMERIC := 0;
  v_units_without_row NUMERIC := 0;
  -- Merge: the units issued before the receipt, per stripe, so each stripe's
  -- Output layer leaves them out of its remaining quantity.
  v_stripe_issued_units NUMERIC[] := '{}';
  v_company_today DATE := company_today(p_company_id);
  v_job_asset_class_id TEXT;
  v_job_asset_id TEXT;
  v_asset_target TEXT;
  v_target_class RECORD;
  v_asset_ids TEXT[] := '{}';
  v_transfer_ids TEXT[] := '{}';
  v_asset_unit_ids TEXT[];
  v_split_done BOOLEAN := false;
  v_new_asset_id TEXT;
  v_transfer_id TEXT;
  v_per_unit_cost NUMERIC;
  v_activity_id TEXT;
  v_asset_class_id TEXT;
  v_journal_source_type "journalEntrySourceType" := 'Job Receipt';
  v_journal_document_type "journalLineDocumentType" := 'Job Receipt';
  v_journal_description TEXT;
  v_dimension_fixed_asset_class TEXT;
  i INTEGER;
  v_consume_to_project BOOLEAN;
  v_project_id TEXT;
  v_project_element_id TEXT;
  v_debit_account TEXT;
  v_dimension_project TEXT;
  v_dimension_project_element TEXT;
  v_capital_job BOOLEAN := FALSE;
  v_receive_to_project_stock BOOLEAN;
  v_output_project_id TEXT;
  v_planning_group_id TEXT;
  -- The stripes this completion receives into, in order: one stripe (the
  -- output project, or common stock) for every job but a grouped one.
  v_stripe_project_ids TEXT[];
  v_stripe_quantities NUMERIC[];
  v_stripe_peg_ids TEXT[];
  v_stripe_index INTEGER;
  v_unit_offset INTEGER;
  v_stripe_units INTEGER;
  v_ledger_id TEXT;
  v_layer_cost NUMERIC;
  v_layer_cost_left NUMERIC;
BEGIN
  PERFORM assert_company_access(p_company_id);

  -- Never let a NULL user reach NOT NULL audit columns; fall back to the job creator
  p_user_id := COALESCE(p_user_id, (SELECT "createdBy" FROM "job" WHERE id = p_job_id));

  -- Fetch job details. The row lock makes a concurrent completion wait and then
  -- read this completion's cumulative quantity, so both cannot compute the same
  -- receipt delta.
  SELECT "itemId", "quantityReceivedToInventory", "jobId", "locationId", "salesOrderLineId", "companyId",
         "fixedAssetClassId", "fixedAssetId", "consumeToProject", "projectId", "projectElementId",
         "receiveToProjectStock", "planningGroupId"
  INTO STRICT v_item_id, v_prior_quantity_received, v_job_id_readable, v_job_location_id, v_sales_order_line_id, v_job_company_id,
              v_job_asset_class_id, v_job_asset_id, v_consume_to_project, v_project_id, v_project_element_id,
              v_receive_to_project_stock, v_planning_group_id
  FROM "job"
  WHERE id = p_job_id
  FOR UPDATE;

  -- Receive to project stock: the output enters the stock stripe of the job's
  -- project, when that project has project stock. Every other job receives
  -- into common stock (NULL).
  IF COALESCE(v_receive_to_project_stock, FALSE) AND v_project_id IS NOT NULL THEN
    SELECT CASE WHEN "projectStock" THEN v_project_id END
    INTO v_output_project_id
    FROM "project"
    WHERE id = v_project_id
      AND "companyId" = p_company_id;
  END IF;

  -- SECURITY DEFINER bypasses RLS: bind the call to the job's own company so a
  -- caller can never complete another tenant's job or post into a mismatched
  -- company's ledger/journal.
  IF p_company_id IS NULL OR v_job_company_id IS DISTINCT FROM p_company_id THEN
    RAISE EXCEPTION 'Job % does not belong to company %', p_job_id, COALESCE(p_company_id, '<null>');
  END IF;

  -- A caller that names no location receives into the job's own location. A
  -- bin of another location would split the units between two counts, so:
  --   * a storage unit the caller names must be at that location, else refused;
  --   * with none named, the job's own storage unit is used when it is at that
  --     location, and skipped when it is not (a stale default must not block
  --     the completion).
  -- A caller that names a location keeps its own storage unit choice: the job's
  -- storage unit belongs to the job's location.
  IF p_location_id IS NULL THEN
    p_location_id := v_job_location_id;
    IF p_storage_unit_id IS NULL THEN
      SELECT j."storageUnitId"
      INTO p_storage_unit_id
      FROM "job" j
      INNER JOIN "storageUnit" su
        ON su.id = j."storageUnitId"
        AND su."companyId" = p_company_id
        AND su."locationId" = v_job_location_id
      WHERE j.id = p_job_id
        AND j."companyId" = p_company_id;
    ELSIF NOT EXISTS (
      SELECT 1
      FROM "storageUnit"
      WHERE id = p_storage_unit_id
        AND "companyId" = p_company_id
        AND "locationId" = v_job_location_id
    ) THEN
      RAISE EXCEPTION 'Storage unit % is not at the location of job %', p_storage_unit_id, v_job_id_readable;
    END IF;
  END IF;

  -- Make to Asset: a job that targets a fixed asset class completes into one
  -- new asset per unit; a job attached to a Construction in Progress asset
  -- sweeps its cost onto that asset. Either way the units never enter stock.
  v_asset_target := CASE
    WHEN v_job_asset_id IS NOT NULL THEN 'asset'
    WHEN v_job_asset_class_id IS NOT NULL THEN 'class'
  END;

  IF v_asset_target IS NOT NULL AND v_sales_order_line_id IS NOT NULL THEN
    RAISE EXCEPTION 'A job linked to a sales order line cannot complete to a fixed asset';
  END IF;

  -- Consume to project: the job's material, labor and overhead were charged to
  -- the project as they were incurred, so its output never enters stock or WIP.
  -- Nothing is left to sweep onto an asset.
  IF v_consume_to_project AND v_asset_target IS NOT NULL THEN
    RAISE EXCEPTION 'A job that consumes to a project cannot complete to a fixed asset';
  END IF;

  -- Non-Inventory items (services) never enter inventory
  SELECT "itemTrackingType"
  INTO v_item_tracking_type
  FROM "item"
  WHERE id = v_item_id
    AND "companyId" = p_company_id;

  -- A job that targets a class makes new assets, and every one of them is a
  -- fleet unit that rental, return to inventory and capitalization follow by
  -- its serial. So the item must be serialized, whatever the quantity.
  IF v_asset_target = 'class'
     AND v_item_tracking_type IS DISTINCT FROM 'Serial' THEN
    RAISE EXCEPTION 'A job that completes to a fixed asset class needs a serialized item';
  END IF;

  -- A sweep onto an asset under construction makes no new unit, so an
  -- unserialized item is fine there, but only as a single unit: an untracked
  -- or batch quantity cannot be told apart.
  IF v_asset_target = 'asset'
     AND v_item_tracking_type IS DISTINCT FROM 'Serial'
     AND COALESCE(p_quantity_complete, 0) <> 1 THEN
    RAISE EXCEPTION 'Make to Asset needs a serialized item or a quantity of one';
  END IF;

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
  -- never receive to inventory, so their value is left unchanged. Neither does
  -- the output of a consume-to-project job.
  UPDATE "job"
  SET status = 'Completed',
      "completedDate" = NOW(),
      "quantityComplete" = p_quantity_complete,
      "quantityReceivedToInventory" = CASE
        WHEN v_item_tracking_type = 'Non-Inventory' OR v_consume_to_project THEN v_prior_quantity_received
        ELSE p_quantity_complete
      END,
      "updatedAt" = NOW(),
      "updatedBy" = p_user_id
  WHERE id = p_job_id;

  -- Make to Asset: the newly completed units leave the job as fixed assets
  -- instead of stock. Assets and their transfers are created at cost 0 here and
  -- priced once the WIP journal exists below; with accounting disabled they stay
  -- at 0, the same posture as registering an asset with accounting off.
  IF v_asset_target IS NOT NULL AND v_quantity_received_to_inventory > 0 THEN
    IF v_asset_target = 'class' THEN
      SELECT fac.*
      INTO STRICT v_target_class
      FROM "fixedAssetClass" fac
      WHERE fac.id = v_job_asset_class_id
        AND fac."companyId" = p_company_id;
    ELSE
      SELECT fac.*
      INTO STRICT v_target_class
      FROM "fixedAsset" fa
      JOIN "fixedAssetClass" fac ON fac.id = fa."fixedAssetClassId"
      WHERE fa.id = v_job_asset_id
        AND fa."companyId" = p_company_id;

      -- Only a Construction in Progress asset accumulates cost; sweeping WIP
      -- onto a live, depreciating asset would restate its basis.
      IF NOT v_target_class."isConstructionInProgress" THEN
        RAISE EXCEPTION 'Job % targets fixed asset % which is not in a Construction in Progress class',
          v_job_id_readable, v_job_asset_id;
      END IF;
    END IF;
    v_asset_class_id := v_target_class.id;

    IF v_job_make_method."requiresSerialTracking" THEN
      -- The same unit order as a receipt: shop-floor-finished units first, then
      -- by serial number. A unit already turned into an asset is never taken
      -- twice (it is Consumed and carries the asset id).
      --
      -- Units still on the job's unsplit seed (a deferred serial number timing)
      -- are split off and the units picked again, then the units taken are
      -- numbered: the completion is their first touch.
      LOOP
        v_asset_unit_ids := ARRAY(
          SELECT te.id
          FROM "trackedEntity" te
          WHERE te.attributes->>'Job Make Method' = v_job_make_method.id
            AND te."companyId" = p_company_id
            AND te.status NOT IN ('Consumed', 'Rejected', 'Scrapped')
            AND te.quantity = 1
            AND NOT (te.attributes ? 'Fixed Asset')
          ORDER BY
            CASE te.status WHEN 'Available' THEN 0 WHEN 'Reserved' THEN 1 ELSE 2 END,
            te."readableId" NULLS LAST,
            te."createdAt",
            te.id
          FOR UPDATE OF te
        );
        EXIT WHEN v_split_done
          OR COALESCE(array_length(v_asset_unit_ids, 1), 0) >= v_quantity_received_to_inventory;
        v_split_done := true;
        EXIT WHEN split_serial_units_for_completion(
          p_job_id, v_job_make_method.id, p_company_id,
          v_quantity_received_to_inventory::INTEGER - COALESCE(array_length(v_asset_unit_ids, 1), 0)
        ) = 0;
      END LOOP;

      IF COALESCE(array_length(v_asset_unit_ids, 1), 0) < v_quantity_received_to_inventory THEN
        RAISE EXCEPTION 'Job % has % serial unit(s) left to capitalize, fewer than the % being completed',
          v_job_id_readable, COALESCE(array_length(v_asset_unit_ids, 1), 0), v_quantity_received_to_inventory;
      END IF;

      v_asset_unit_ids := v_asset_unit_ids[1:v_quantity_received_to_inventory::INTEGER];
      PERFORM number_serial_units_for_receipt(
        v_asset_unit_ids, v_item_id, p_company_id, v_job_location_id
      );
    ELSE
      -- A class target makes one asset per serial unit. A job created before
      -- its item was serialized has no units to follow, and would otherwise
      -- make ONE asset for the whole quantity.
      IF v_asset_target = 'class' THEN
        RAISE EXCEPTION 'Job % does not track serial numbers, so it cannot complete to a fixed asset class',
          v_job_id_readable;
      END IF;
      -- One untracked or batch unit swept onto an asset under construction; the
      -- guard above holds the quantity at 1.
      v_asset_unit_ids := ARRAY[NULL::TEXT];
    END IF;

    FOR i IN 1..array_length(v_asset_unit_ids, 1) LOOP
      IF v_asset_target = 'class' THEN
        INSERT INTO "fixedAsset" (
          "fixedAssetId", "fixedAssetClassId", name, "serialNumber",
          "itemId", "trackedEntityId", quantity, status,
          "depreciationMethod", "usefulLifeMonths", "residualValuePercent",
          "acquisitionCost", "acquisitionDate", "depreciationStartDate",
          "locationId", "companyId", "createdBy"
        )
        SELECT
          get_next_sequence('fixedAsset', p_company_id), v_job_asset_class_id,
          it.name || ' ' || COALESCE(te."readableId", v_job_id_readable), te."readableId",
          v_item_id, v_asset_unit_ids[i], 1,
          CASE WHEN v_target_class."isConstructionInProgress" THEN 'Under Construction' ELSE 'Active' END::"fixedAssetStatus",
          v_target_class."depreciationMethod", v_target_class."usefulLifeMonths", v_target_class."residualValuePercent",
          0, v_company_today, v_company_today,
          v_job_location_id, p_company_id, p_user_id
        FROM "item" it
        LEFT JOIN "trackedEntity" te ON te.id = v_asset_unit_ids[i]
        WHERE it.id = v_item_id
        RETURNING id INTO v_new_asset_id;

        INSERT INTO "fixedAssetTransfer" (
          "transferId", type, "sourceType", "fixedAssetId", "itemId", "trackedEntityId",
          "jobId", "locationId", quantity, "transferDate", amount, status,
          "postedAt", "postedBy", "companyId", "createdBy"
        ) VALUES (
          get_next_sequence('fixedAssetTransfer', p_company_id), 'Capitalization', 'Job',
          v_new_asset_id, v_item_id, v_asset_unit_ids[i],
          p_job_id, v_job_location_id, 1, v_company_today, 0, 'Posted',
          NOW(), p_user_id, p_company_id, p_user_id
        )
        RETURNING id INTO v_transfer_id;

        v_asset_ids := v_asset_ids || v_new_asset_id;
        v_transfer_ids := v_transfer_ids || v_transfer_id;
      ELSE
        v_new_asset_id := v_job_asset_id;
      END IF;

      -- The unit is consumed into the asset: it is no longer stock, and the
      -- asset id on its attributes is how the fleet finds it again.
      IF v_asset_unit_ids[i] IS NOT NULL THEN
        UPDATE "trackedEntity"
        SET status = 'Consumed',
            attributes = COALESCE(attributes, '{}'::jsonb) || jsonb_build_object('Fixed Asset', v_new_asset_id)
        WHERE id = v_asset_unit_ids[i];

        INSERT INTO "trackedActivity" (
          type, "sourceDocument", "sourceDocumentId", "sourceDocumentReadableId",
          attributes, "companyId", "createdBy"
        )
        SELECT
          'Capitalize', 'Fixed Asset', fa.id, fa."fixedAssetId",
          jsonb_build_object('Fixed Asset', fa.id, 'Job', p_job_id), p_company_id, p_user_id
        FROM "fixedAsset" fa
        WHERE fa.id = v_new_asset_id
        RETURNING id INTO v_activity_id;

        INSERT INTO "trackedActivityInput" (
          "trackedActivityId", "trackedEntityId", quantity, "companyId", "createdBy"
        ) VALUES (
          v_activity_id, v_asset_unit_ids[i], 1, p_company_id, p_user_id
        );
      END IF;
    END LOOP;
  END IF;

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
  -- the quantity already received has nothing new to receive. The output of a
  -- consume-to-project job is consumed by the project, so it is never received.
  IF v_item_tracking_type IS DISTINCT FROM 'Non-Inventory'
     AND v_asset_target IS NULL
     AND NOT v_consume_to_project
     AND v_quantity_received_to_inventory > 0 THEN
  -- One stripe for every job but a grouped one: the output project (Receive
  -- to project stock) or common stock, with the whole delta.
  v_stripe_project_ids := ARRAY[v_output_project_id]::TEXT[];
  v_stripe_quantities := ARRAY[v_quantity_received_to_inventory]::NUMERIC[];
  v_stripe_peg_ids := ARRAY[NULL]::TEXT[];

  -- A job made for a planning group (Projects Phase 3) receives into its
  -- members' stripes by its pegs: harden_pegs_for_supply, the one peg split
  -- rule, turns the pegs it covers Hard and returns one row per stripe; the
  -- last row is the excess under the group's excess rule.
  IF v_planning_group_id IS NOT NULL THEN
    SELECT array_agg(h."projectId" ORDER BY h.ord),
           array_agg(h."quantity" ORDER BY h.ord),
           array_agg(h."pegId" ORDER BY h.ord)
    INTO v_stripe_project_ids, v_stripe_quantities, v_stripe_peg_ids
    FROM harden_pegs_for_supply(
      p_company_id, p_user_id, 'Job', p_job_id, v_quantity_received_to_inventory
    ) WITH ORDINALITY AS h("projectId", "quantity", "pegId", ord);
  END IF;

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

    -- A lot that spans 2 stripes gets 2 rows with the same tracked entity.
    FOR v_stripe_index IN 1..array_length(v_stripe_project_ids, 1) LOOP
      INSERT INTO "itemLedger" (
        "entryType", "documentType", "documentId", "companyId",
        "itemId", quantity, "locationId", "storageUnitId",
        "trackedEntityId", "projectId", "createdBy"
      ) VALUES (
        'Assembly Output', 'Job Receipt', p_job_id, p_company_id,
        v_item_id, v_stripe_quantities[v_stripe_index], p_location_id, p_storage_unit_id,
        v_tracked_entity.id, v_stripe_project_ids[v_stripe_index], p_user_id
      )
      RETURNING id INTO v_ledger_id;

      IF v_stripe_peg_ids[v_stripe_index] IS NOT NULL THEN
        UPDATE "projectPeg" SET "itemLedgerId" = v_ledger_id
        WHERE id = v_stripe_peg_ids[v_stripe_index] AND "companyId" = p_company_id;
      END IF;
    END LOOP;

  ELSIF v_job_make_method."requiresSerialTracking" THEN
    -- Receive exactly the newly completed units: finished units first (Available
    -- on the shop floor, or already issued elsewhere), then by serial number. A
    -- unit this job already received is never received again, so re-completion
    -- cannot double-count. Rejected (failed inspection) and Scrapped units never
    -- enter stock. The candidates are locked so a concurrent completion cannot
    -- take the same units.
    --
    -- A finished unit can leave before its job is received: the MES issues it
    -- into another job (or a shipment takes it), which marks it Consumed and
    -- books it out of stock. It was still made here, so it is received too.
    -- Skipping it left the job short of units, and its last unit could never
    -- be completed. Only a unit that was booked out counts: receiving one that
    -- never left stock would add a unit that is not there.
    --
    -- Units still on the job's unsplit seed (a deferred serial number timing)
    -- are split off and the units picked again, then the units taken are
    -- numbered: the completion is their first touch.
    LOOP
      v_serial_unit_ids := ARRAY(
        SELECT te.id
        FROM "trackedEntity" te
        WHERE te.attributes->>'Job Make Method' = v_job_make_method.id
          AND te."companyId" = p_company_id
          AND (
            te.status NOT IN ('Consumed', 'Rejected', 'Scrapped')
            OR (
              te.status = 'Consumed'
              AND EXISTS (
                SELECT 1
                FROM "itemLedger" il
                WHERE il."trackedEntityId" = te.id
                  AND il."companyId" = p_company_id
                  AND il.quantity < 0
              )
            )
          )
          AND te.quantity = 1
          AND NOT EXISTS (
            SELECT 1
            FROM "itemLedger" il
            WHERE il."trackedEntityId" = te.id
              AND il."documentType" = 'Job Receipt'
              AND il."documentId" = p_job_id
          )
        ORDER BY
          CASE te.status WHEN 'Available' THEN 0 WHEN 'Consumed' THEN 0 WHEN 'Reserved' THEN 1 ELSE 2 END,
          te."readableId" NULLS LAST,
          te."createdAt",
          te.id
        FOR UPDATE OF te
      );
      EXIT WHEN v_split_done
        OR COALESCE(array_length(v_serial_unit_ids, 1), 0) >= v_quantity_received_to_inventory;
      v_split_done := true;
      EXIT WHEN split_serial_units_for_completion(
        p_job_id, v_job_make_method.id, p_company_id,
        v_quantity_received_to_inventory::INTEGER - COALESCE(array_length(v_serial_unit_ids, 1), 0)
      ) = 0;
    END LOOP;

    -- Short of single units: an item with no serial sequence is never split,
    -- so the units the shop floor has not touched are still on its seed (one
    -- entity holding several). The single units are received first, then the
    -- rest against that seed, the way the batch branch receives. Raising
    -- instead would abort the jobOperation UPDATE itself: completion also runs
    -- inside sync_finish_job_operation, a BEFORE trigger interceptor.
    v_units_taken := LEAST(
      COALESCE(array_length(v_serial_unit_ids, 1), 0),
      v_quantity_received_to_inventory::INTEGER
    );
    IF v_units_taken < v_quantity_received_to_inventory THEN
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

      -- The seed gives the units this job has not received from it, and the
      -- units no row holds yet (the job quantity was raised after the seed was
      -- made), as the sequence path creates them; a scrapped unit does not
      -- count: the job still owes it.
      IF v_tracked_entity.id IS NOT NULL THEN
        SELECT v_tracked_entity.quantity - COALESCE(SUM(il.quantity), 0)
        INTO v_seed_units_left
        FROM "itemLedger" il
        WHERE il."trackedEntityId" = v_tracked_entity.id
          AND il."companyId" = p_company_id
          AND il."documentType" = 'Job Receipt'
          AND il."documentId" = p_job_id;

        SELECT GREATEST(
          (SELECT j.quantity FROM "job" j WHERE j.id = p_job_id AND j."companyId" = p_company_id)
            - COALESCE(SUM(te.quantity), 0),
          0
        )
        INTO v_units_without_row
        FROM "trackedEntity" te
        WHERE te.attributes->>'Job Make Method' = v_job_make_method.id
          AND te."companyId" = p_company_id
          AND te.status <> 'Scrapped';
      END IF;

      -- Genuinely short of units (some scrapped, some already received) rather
      -- than un-numbered: receiving fewer than completed would leave the job's
      -- received quantity ahead of the ledger.
      IF v_tracked_entity.id IS NULL
        OR GREATEST(v_seed_units_left, 0) + v_units_without_row
          < v_quantity_received_to_inventory - v_units_taken THEN
        RAISE EXCEPTION 'Job % has % serial unit(s) left to receive, fewer than the % being completed',
          v_job_id_readable,
          COALESCE(array_length(v_serial_unit_ids, 1), 0)
            + GREATEST(v_seed_units_left, 0) + v_units_without_row,
          v_quantity_received_to_inventory;
      END IF;
    END IF;

    IF v_units_taken > 0 THEN
      PERFORM number_serial_units_for_receipt(
        v_serial_unit_ids[1:v_units_taken],
        v_item_id, p_company_id, v_job_location_id
      );

      -- The units take the stripes in order. Merge: only the v_units_taken
      -- single units; what they leave of a stripe is received against the seed
      -- below, in that stripe.
      v_unit_offset := 0;
      FOR v_stripe_index IN 1..array_length(v_stripe_project_ids, 1) LOOP
        v_stripe_units := LEAST(
          v_stripe_quantities[v_stripe_index]::INTEGER,
          v_units_taken - v_unit_offset
        );
        CONTINUE WHEN v_stripe_units <= 0;

        -- An issued unit is received where it was booked out, so its own
        -- movements net to nothing in that bin. Merge: and in that stripe —
        -- it takes the projectId of the row that booked it out, not the
        -- receipt's stripe, or one project would show the unit on hand while
        -- the stripe it left went negative.
        WITH inserted AS (
          INSERT INTO "itemLedger" (
            "entryType", "documentType", "documentId", "companyId",
            "itemId", quantity, "locationId", "storageUnitId",
            "trackedEntityId", "projectId", "createdBy"
          )
          SELECT
            'Assembly Output', 'Job Receipt', p_job_id, p_company_id,
            v_item_id, 1,
            CASE WHEN issued.id IS NULL THEN p_location_id ELSE issued."locationId" END,
            CASE WHEN issued.id IS NULL THEN p_storage_unit_id ELSE issued."storageUnitId" END,
            te.id,
            CASE WHEN issued.id IS NULL THEN v_stripe_project_ids[v_stripe_index] ELSE issued."projectId" END,
            p_user_id
          FROM unnest(v_serial_unit_ids[v_unit_offset + 1:v_unit_offset + v_stripe_units]) AS unit_id
          JOIN "trackedEntity" te ON te.id = unit_id
          LEFT JOIN LATERAL (
            SELECT il.id, il."locationId", il."storageUnitId", il."projectId"
            FROM "itemLedger" il
            WHERE il."trackedEntityId" = te.id
              AND il."companyId" = p_company_id
              AND il.quantity < 0
              AND te.status = 'Consumed'
            ORDER BY il."createdAt" DESC
            LIMIT 1
          ) issued ON true
          RETURNING id
        )
        SELECT id INTO v_ledger_id FROM inserted LIMIT 1;

        SELECT COUNT(*)
        INTO v_issued_units_received
        FROM "trackedEntity"
        WHERE id = ANY(v_serial_unit_ids[v_unit_offset + 1:v_unit_offset + v_stripe_units])
          AND status = 'Consumed';
        v_stripe_issued_units[v_stripe_index] := v_issued_units_received;

        IF v_stripe_peg_ids[v_stripe_index] IS NOT NULL THEN
          UPDATE "projectPeg" SET "itemLedgerId" = v_ledger_id
          WHERE id = v_stripe_peg_ids[v_stripe_index] AND "companyId" = p_company_id;
        END IF;

        v_unit_offset := v_unit_offset + v_stripe_units;
      END LOOP;

      -- An issued unit stays Consumed: it is in the job it went to.
      UPDATE "trackedEntity"
      SET status = 'Available'
      WHERE id = ANY(v_serial_unit_ids[1:v_units_taken])
        AND status <> 'Consumed';
    END IF;

    IF v_units_taken < v_quantity_received_to_inventory THEN
      -- Merge: each stripe's rest (what its single units above did not cover)
      -- is received against the seed, in that stripe.
      v_unit_offset := 0;
      FOR v_stripe_index IN 1..array_length(v_stripe_project_ids, 1) LOOP
        v_stripe_units := LEAST(
          v_stripe_quantities[v_stripe_index]::INTEGER,
          GREATEST(v_units_taken - v_unit_offset, 0)
        );
        v_unit_offset := v_unit_offset + v_stripe_quantities[v_stripe_index]::INTEGER;
        CONTINUE WHEN v_stripe_quantities[v_stripe_index] - v_stripe_units <= 0;

        INSERT INTO "itemLedger" (
          "entryType", "documentType", "documentId", "companyId",
          "itemId", quantity, "locationId", "storageUnitId",
          "trackedEntityId", "projectId", "createdBy"
        ) VALUES (
          'Assembly Output', 'Job Receipt', p_job_id, p_company_id,
          v_item_id, v_stripe_quantities[v_stripe_index] - v_stripe_units,
          p_location_id, p_storage_unit_id,
          v_tracked_entity.id, v_stripe_project_ids[v_stripe_index], p_user_id
        )
        RETURNING id INTO v_ledger_id;

        -- A stripe its single units already received keeps that receipt row.
        IF v_stripe_peg_ids[v_stripe_index] IS NOT NULL AND v_stripe_units = 0 THEN
          UPDATE "projectPeg" SET "itemLedgerId" = v_ledger_id
          WHERE id = v_stripe_peg_ids[v_stripe_index] AND "companyId" = p_company_id;
        END IF;
      END LOOP;

      -- The seed grows by the units no row held, so it holds what it received.
      UPDATE "trackedEntity"
      SET status = 'Available',
          quantity = quantity + GREATEST(
            v_quantity_received_to_inventory - v_units_taken
              - GREATEST(v_seed_units_left, 0),
            0
          )
      WHERE id = v_tracked_entity.id;
    END IF;

  ELSE
    FOR v_stripe_index IN 1..array_length(v_stripe_project_ids, 1) LOOP
      INSERT INTO "itemLedger" (
        "entryType", "documentType", "documentId", "companyId",
        "itemId", quantity, "locationId", "storageUnitId", "projectId", "createdBy"
      ) VALUES (
        'Assembly Output', 'Job Receipt', p_job_id, p_company_id,
        v_item_id, v_stripe_quantities[v_stripe_index], p_location_id, p_storage_unit_id,
        v_stripe_project_ids[v_stripe_index], p_user_id
      )
      RETURNING id INTO v_ledger_id;

      IF v_stripe_peg_ids[v_stripe_index] IS NOT NULL THEN
        UPDATE "projectPeg" SET "itemLedgerId" = v_ledger_id
        WHERE id = v_stripe_peg_ids[v_stripe_index] AND "companyId" = p_company_id;
      END IF;
    END LOOP;
  END IF;
  END IF;

  -- Update pickMethod defaultStorageUnitId if needed. Never to a non-nettable
  -- (quarantine) unit: nobody chose it as the item's default bin.
  IF v_item_tracking_type IS DISTINCT FROM 'Non-Inventory' AND v_asset_target IS NULL AND NOT v_consume_to_project AND p_storage_unit_id IS NOT NULL AND p_location_id IS NOT NULL AND storage_unit_is_nettable(p_storage_unit_id) THEN
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

  -- Every company posts; the accounting cutover decides the status
  -- (.ai/specs/2026-10-08-accounting-cutover.md section 1).
  v_posting_status := journal_posting_status(p_company_id);

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
    MAX(CASE WHEN "entityType" = 'Employee' THEN id END),
    MAX(CASE WHEN "entityType" = 'FixedAssetClass' THEN id END),
    MAX(CASE WHEN "entityType" = 'Project' THEN id END),
    MAX(CASE WHEN "entityType" = 'ProjectElement' THEN id END)
  INTO v_dimension_item_posting_group, v_dimension_item, v_dimension_location,
       v_dimension_cost_center, v_dimension_employee, v_dimension_fixed_asset_class,
       v_dimension_project, v_dimension_project_element
  FROM dimension
  WHERE "companyGroupId" = v_company_group_id
    AND active = true
    AND "entityType" IN ('ItemPostingGroup', 'Item', 'Location', 'CostCenter', 'Employee', 'FixedAssetClass', 'Project', 'ProjectElement');

  -- A consume-to-project job charges its catch-up labor and overhead to the
  -- project account (the cost treatment) instead of WIP. A Statistical project
  -- has no account, and a consume-to-project job cannot charge one.
  -- A capital job (a Capitalize charge number, not consume-to-project, an
  -- asset under construction as its target) keeps WIP, which completion sweeps
  -- onto the asset. Its costs still write projectLedger rows, as issue and
  -- post-production-event do (loadJobProjectCharge, keepsWip).
  v_capital_job := v_project_id IS NOT NULL
    AND NOT COALESCE(v_consume_to_project, FALSE)
    AND v_job_asset_id IS NOT NULL
    AND project_cost_treatment(p_company_id, v_project_id, v_project_element_id, v_company_today) = 'Capitalize';

  v_debit_account := v_wip_account;
  IF v_consume_to_project THEN
    v_debit_account := project_posting_account(p_company_id, v_project_id, v_project_element_id, v_company_today);
    IF v_debit_account IS NULL THEN
      RAISE EXCEPTION 'Job % consumes to a Statistical project, which has no account to charge', v_job_id_readable;
    END IF;
    -- Only a capital job's completion sweep builds an asset: a job that consumed
    -- here would debit the asset account with no asset cost row.
    IF project_cost_treatment(p_company_id, v_project_id, v_project_element_id, v_company_today) = 'Capitalize' THEN
      RAISE EXCEPTION 'Job % consumes to a project that capitalizes this cost. A capital job builds its asset under construction, so it cannot consume to the project.', v_job_id_readable;
    END IF;
  END IF;

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
    ORDER BY pe.id
    -- Waits for a concurrent post-production-event, then skips the event if
    -- it posted it (the WHERE is re-checked on the committed row).
    FOR UPDATE OF pe
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

      IF v_labor_accounting_period_id IS NULL AND v_posting_status = 'Posted' THEN
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

      -- A Provisional journal has no accounting period (spec section 1).
      IF v_posting_status <> 'Posted' THEN
        v_labor_accounting_period_id := NULL;
      END IF;

      v_labor_journal_entry_id := get_next_sequence('journalEntry', p_company_id);

      INSERT INTO journal (
        "journalEntryId", "accountingPeriodId", description,
        "postingDate", "companyId", "sourceType", status,
        "postedAt", "postedBy", "createdBy"
      ) VALUES (
        v_labor_journal_entry_id, v_labor_accounting_period_id,
        v_event.type || ' Time — Job ' || v_job_id_readable,
        v_company_today, p_company_id, 'Production Event', v_posting_status,
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
          v_labor_journal_id, v_debit_account,
          CASE WHEN v_consume_to_project THEN 'Project Labor' ELSE 'WIP Account' END,
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

        -- Project tags and the projectLedger row on the project debit
        -- (mirrors post-production-event)
        IF v_consume_to_project OR v_capital_job THEN
          IF v_dimension_project IS NOT NULL THEN
            INSERT INTO "journalLineDimension" (
              "journalLineId", "dimensionId", "valueId", "companyId"
            ) VALUES (
              v_labor_jl_id, v_dimension_project, v_project_id, p_company_id
            );
          END IF;
          IF v_dimension_project_element IS NOT NULL AND v_project_element_id IS NOT NULL THEN
            INSERT INTO "journalLineDimension" (
              "journalLineId", "dimensionId", "valueId", "companyId"
            ) VALUES (
              v_labor_jl_id, v_dimension_project_element, v_project_element_id, p_company_id
            );
          END IF;

          INSERT INTO "projectLedger" (
            "companyId", "projectId", "projectElementId", "postingDate", "costType",
            "documentType", "documentId", "jobId", "employeeId", "laborCategoryId", quantity, amount,
            "journalLineId", "createdBy"
          ) VALUES (
            p_company_id, v_project_id, v_project_element_id, v_company_today, CASE WHEN v_event.type = 'Machine' THEN 'Machine' ELSE 'Labor' END::"projectCostType",
            'Production Event', v_event.id, p_job_id, v_event."employeeId",
            -- A labor row bills by its category, as post-production-event stamps it.
            CASE WHEN v_event.type = 'Machine' THEN NULL ELSE (
              SELECT ej."laborCategoryId" FROM "employeeJob" ej
              WHERE ej."id" = v_event."employeeId" AND ej."companyId" = p_company_id
            ) END,
            ROUND(v_duration_hours, 5), ROUND(v_labor_cost, 5),
            v_labor_jl_id, p_user_id
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
          v_labor_journal_id, v_debit_account,
          CASE WHEN v_consume_to_project THEN 'Project Overhead' ELSE 'WIP Account (Overhead)' END,
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

        -- Project tags and the projectLedger row on the project overhead debit
        IF v_consume_to_project OR v_capital_job THEN
          IF v_dimension_project IS NOT NULL THEN
            INSERT INTO "journalLineDimension" (
              "journalLineId", "dimensionId", "valueId", "companyId"
            ) VALUES (
              v_labor_jl_id, v_dimension_project, v_project_id, p_company_id
            );
          END IF;
          IF v_dimension_project_element IS NOT NULL AND v_project_element_id IS NOT NULL THEN
            INSERT INTO "journalLineDimension" (
              "journalLineId", "dimensionId", "valueId", "companyId"
            ) VALUES (
              v_labor_jl_id, v_dimension_project_element, v_project_element_id, p_company_id
            );
          END IF;

          INSERT INTO "projectLedger" (
            "companyId", "projectId", "projectElementId", "postingDate", "costType",
            "documentType", "documentId", "jobId", "employeeId", quantity, amount,
            "journalLineId", "createdBy"
          ) VALUES (
            p_company_id, v_project_id, v_project_element_id, v_company_today, 'Overhead'::"projectCostType",
            'Production Event', v_event.id, p_job_id, v_event."employeeId",
            ROUND(v_duration_hours, 5), ROUND(v_overhead_cost, 5),
            v_labor_jl_id, p_user_id
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

  -- Consume to project: every cost already sits on the project account, so
  -- there is no WIP to discharge, no output cost layer and no unit cost to
  -- update. The completed quantities were set above, as for Non-Inventory.
  IF v_consume_to_project THEN
    RETURN;
  END IF;

  -- A negative balance (a returned outside processing receipt) is not moved
  -- to finished goods; it stays in WIP for the close.
  v_accumulated_wip_cost := job_wip_balance(p_job_id, p_company_id);

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

  -- Make to Asset: the swept WIP lands on the target class's asset account as
  -- an Asset Transfer journal. Both lines stay documented against the job so
  -- the WIP credit still nets this job's WIP to zero for a re-completion.
  IF v_asset_target IS NOT NULL THEN
    v_item_inventory_account := v_target_class."assetAccountId";
    v_item_inventory_description := 'Fixed Asset';
    v_journal_source_type := 'Asset Transfer';
    v_journal_document_type := 'Asset Transfer';
    v_journal_description := 'Job Completion to Fixed Asset ' || v_job_id_readable;
  ELSE
    v_journal_description := 'Job Completion ' || v_job_id_readable;
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

  IF v_accounting_period_id IS NULL AND v_posting_status = 'Posted' THEN
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

  -- A Provisional journal has no accounting period (spec section 1).
  IF v_posting_status <> 'Posted' THEN
    v_accounting_period_id := NULL;
  END IF;

  v_journal_entry_id := get_next_sequence('journalEntry', p_company_id);

  INSERT INTO journal (
    "journalEntryId", "accountingPeriodId", description,
    "postingDate", "companyId", "sourceType", status,
    "postedAt", "postedBy", "createdBy"
  ) VALUES (
    v_journal_entry_id, v_accounting_period_id,
    v_journal_description,
    v_today, p_company_id, v_journal_source_type, v_posting_status,
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
    v_journal_document_type, p_job_id, 'job:' || p_job_id,
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
    v_journal_document_type, p_job_id, 'job:' || p_job_id,
    v_journal_line_reference, p_company_id
  )
  RETURNING id INTO v_labor_jl_id;

  v_jl_ids := v_jl_ids || v_labor_jl_id;

  -- Write costLedger entry for finished good (skipped for Non-Inventory: no
  -- output layer exists for a service — its cost went straight to COGS above)
  -- One Output layer per stripe of the receipt rows above, each at the job's
  -- unit cost; the last stripe takes the rounding rest. The unit cost already
  -- carries the scrap cost, so scrap spreads over the stripes by quantity.
  IF v_item_tracking_type IS DISTINCT FROM 'Non-Inventory' AND v_asset_target IS NULL THEN
    v_layer_cost_left := v_accumulated_wip_cost;
    FOR v_stripe_index IN 1..array_length(v_stripe_project_ids, 1) LOOP
      v_layer_cost := CASE
        WHEN v_stripe_index = array_length(v_stripe_project_ids, 1) THEN v_layer_cost_left
        ELSE ROUND(v_accumulated_wip_cost * v_stripe_quantities[v_stripe_index] / v_quantity_received_to_inventory, 5)
      END;
      v_layer_cost_left := v_layer_cost_left - v_layer_cost;

      INSERT INTO "costLedger" (
        "itemLedgerType", "costLedgerType", adjustment,
        "documentType", "documentId", "itemId",
        quantity, cost, "remainingQuantity", "projectId", "companyId"
      ) VALUES (
        'Output', 'Direct Cost', false,
        'Job Receipt', p_job_id, v_item_id,
        v_stripe_quantities[v_stripe_index], v_layer_cost,
        -- Units issued before the receipt are already gone: only the rest can
        -- still be consumed from this layer.
        v_stripe_quantities[v_stripe_index] - COALESCE(v_stripe_issued_units[v_stripe_index], 0),
        v_stripe_project_ids[v_stripe_index], p_company_id
      );
    END LOOP;
  END IF;

  -- Update item cost
  SELECT "costingMethod", "unitCost", "itemPostingGroupId"
  INTO v_costing_method, v_existing_unit_cost, v_item_posting_group_id
  FROM "itemCost"
  WHERE "itemId" = v_item_id
    AND "companyId" = p_company_id;

  -- Update itemCost.unitCost (skipped for Non-Inventory: a service has no
  -- stocked unit cost; the read above still feeds the dimension inserts below)
  IF v_item_tracking_type IS DISTINCT FROM 'Non-Inventory' AND v_asset_target IS NULL THEN
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

  -- Make to Asset: price the assets created above from the swept WIP and link
  -- their transfers to the journal. A Construction in Progress target takes the
  -- whole cost as one CIP cost row and one transfer.
  IF v_asset_target = 'class' THEN
    -- Rounded at persist; the last asset takes the residual so the assets add
    -- up to exactly the WIP the journal debits to the asset account.
    v_per_unit_cost := ROUND(v_accumulated_wip_cost / array_length(v_asset_ids, 1), 5);

    UPDATE "fixedAsset"
    SET "acquisitionCost" = CASE
          WHEN id = v_asset_ids[array_length(v_asset_ids, 1)]
            THEN v_accumulated_wip_cost - v_per_unit_cost * (array_length(v_asset_ids, 1) - 1)
          ELSE v_per_unit_cost
        END,
        "updatedAt" = NOW(),
        "updatedBy" = p_user_id
    WHERE id = ANY(v_asset_ids);

    UPDATE "fixedAssetTransfer"
    SET amount = CASE
          WHEN id = v_transfer_ids[array_length(v_transfer_ids, 1)]
            THEN v_accumulated_wip_cost - v_per_unit_cost * (array_length(v_transfer_ids, 1) - 1)
          ELSE v_per_unit_cost
        END,
        "journalId" = v_journal_id,
        "updatedAt" = NOW(),
        "updatedBy" = p_user_id
    WHERE id = ANY(v_transfer_ids);
  ELSIF v_asset_target = 'asset' THEN
    -- A capital job's sweep row names its project and element. The
    -- projectLedger already holds each cost, so the sweep writes no ledger row.
    INSERT INTO "fixedAssetCipCost" (
      "fixedAssetId", "sourceType", "jobId", amount, "costDate", "journalId", "companyId", "createdBy",
      "projectId", "projectElementId"
    ) VALUES (
      v_job_asset_id, 'Job', p_job_id, v_accumulated_wip_cost, v_company_today, v_journal_id, p_company_id, p_user_id,
      v_project_id, v_project_element_id
    );

    UPDATE "fixedAsset"
    SET "acquisitionCost" = "acquisitionCost" + v_accumulated_wip_cost,
        status = 'Under Construction',
        "updatedAt" = NOW(),
        "updatedBy" = p_user_id
    WHERE id = v_job_asset_id;

    INSERT INTO "fixedAssetTransfer" (
      "transferId", type, "sourceType", "fixedAssetId", "itemId", "jobId",
      "locationId", quantity, "transferDate", amount, "journalId", status,
      "postedAt", "postedBy", "companyId", "createdBy"
    ) VALUES (
      get_next_sequence('fixedAssetTransfer', p_company_id), 'Capitalization', 'Job',
      v_job_asset_id, v_item_id, p_job_id,
      v_job_location_id, v_quantity_received_to_inventory, v_company_today, v_accumulated_wip_cost, v_journal_id, 'Posted',
      NOW(), p_user_id, p_company_id, p_user_id
    );
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

      IF v_asset_class_id IS NOT NULL AND v_dimension_fixed_asset_class IS NOT NULL THEN
        INSERT INTO "journalLineDimension" (
          "journalLineId", "dimensionId", "valueId", "companyId"
        ) VALUES (
          v_jl_ids[i], v_dimension_fixed_asset_class, v_asset_class_id, p_company_id
        );
      END IF;
    END LOOP;
  END IF;
END;
$function$;
