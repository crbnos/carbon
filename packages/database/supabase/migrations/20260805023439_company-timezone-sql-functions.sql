-- Ledger-scoped "today" must match the app's company-timezone derivation.
-- 20260805020925_company-timezone.sql pinned the DB session to UTC and added
-- company."timezone"; app code now derives posting dates and accounting-period
-- membership in the company's timezone. The ledger-posting SQL functions below
-- still derived "today" from the UTC session clock, so a posting near a month
-- boundary could land in a different accounting period than an app-posted
-- document for the same business day. One set of books needs one calendar:
-- every timezone-sensitive session-date site in these functions now uses
-- company_today(companyId).
--
-- Each function is recreated VERBATIM from its newest committed definition
-- (backflush_job_materials: 20260804111631_picked-material-return-timing.sql;
-- complete_job_to_inventory + recompute_service_line_fulfillment:
-- 20260731164213_service-only-completion-fulfillment.sql), changing ONLY the
-- session-date sites plus one added v_company_today declaration per function.

-- Company-calendar "today". STABLE (one timestamp per statement), and safe
-- under SECURITY DEFINER SET search_path = public: the lookup is
-- schema-qualified and falls back to UTC for a missing company row.
CREATE OR REPLACE FUNCTION company_today(p_company_id TEXT)
RETURNS DATE
LANGUAGE sql
STABLE
AS $$
  SELECT (now() AT TIME ZONE COALESCE(
    (SELECT "timezone" FROM public."company" WHERE "id" = p_company_id),
    'UTC'
  ))::date
$$;

CREATE OR REPLACE FUNCTION backflush_job_materials(
  p_job_id TEXT,
  p_quantity_complete NUMERIC,
  p_company_id TEXT,
  p_user_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_quantity NUMERIC;
  v_job_location_id TEXT;
  v_job_id_readable TEXT;
  v_ratio NUMERIC;
  v_target NUMERIC;
  v_material RECORD;
  v_material_qty_to_issue NUMERIC;
  v_material_storage_unit_id TEXT;
  v_bin_work_center_id TEXT;
  v_bin_on_hand NUMERIC;
  v_material_costing_method TEXT;
  v_material_standard_cost NUMERIC;
  v_material_unit_cost NUMERIC;
  v_material_item_posting_group_id TEXT;
  v_material_cogs_total NUMERIC;
  v_cost_layer RECORD;
  v_remaining_to_consume NUMERIC;
  v_layer_unit_cost NUMERIC;
  v_quantity_from_layer NUMERIC;
  v_adjustment_child RECORD;
  v_child_budget NUMERIC;
  v_child_apply NUMERIC;
  v_child_per_unit NUMERIC;
  v_accounting_enabled BOOLEAN;
  v_company_group_id TEXT;
  v_raw_materials_account TEXT;
  v_finished_goods_account TEXT;
  v_material_inventory_account TEXT;
  v_material_inventory_description TEXT;
  v_wip_account TEXT;
  v_dimension_item_posting_group TEXT;
  v_dimension_item TEXT;
  v_dimension_location TEXT;
  v_bf_item_ids TEXT[] := '{}';
  v_bf_quantities NUMERIC[] := '{}';
  v_bf_storage_unit_ids TEXT[] := '{}';
  v_bf_journal_id TEXT;
  v_bf_journal_entry_id TEXT;
  v_bf_accounting_period_id TEXT;
  v_bf_journal_line_ref TEXT;
  v_bf_jl_id TEXT;
  v_bf_jl_ids TEXT[];
  v_bf_posting_group_ids TEXT[];
  v_bf_line_item_ids TEXT[];
  v_company_today DATE := company_today(p_company_id);
BEGIN
  -- Never let a NULL user reach NOT NULL audit columns; fall back to the job creator
  p_user_id := COALESCE(p_user_id, (SELECT "createdBy" FROM "job" WHERE id = p_job_id));

  -- Fetch job details
  SELECT quantity, "locationId", "jobId"
  INTO STRICT v_job_quantity, v_job_location_id, v_job_id_readable
  FROM "job"
  WHERE id = p_job_id;

  IF v_job_quantity IS NULL OR v_job_quantity <= 0 THEN
    RETURN;
  END IF;

  v_ratio := p_quantity_complete / v_job_quantity;

  -- Backflush non-tracked materials
  FOR v_material IN
    SELECT jm.id, jm."itemId", jm."quantityToIssue", jm."quantityIssued",
           jm."estimatedQuantity", jm."storageUnitId", jm."defaultStorageUnit"
    FROM "jobMaterial" jm
    WHERE jm."jobId" = p_job_id
      AND jm."itemType" IN ('Material', 'Part', 'Consumable')
      AND jm."methodType" != 'Make to Order'
      AND jm."requiresBatchTracking" = false
      AND jm."requiresSerialTracking" = false
      AND jm."quantityToIssue" > 0
  LOOP
    -- Prorate: only issue what's needed for the completed quantity
    v_target := v_material."estimatedQuantity" * v_ratio;
    v_material_qty_to_issue := GREATEST(v_target - COALESCE(v_material."quantityIssued", 0), 0);

    IF v_material_qty_to_issue <= 0 THEN
      CONTINUE;
    END IF;

    -- Resolve storage unit
    v_material_storage_unit_id := v_material."storageUnitId";

    IF v_material_storage_unit_id IS NULL AND v_material."defaultStorageUnit" THEN
      SELECT "defaultStorageUnitId" INTO v_material_storage_unit_id
      FROM "pickMethod"
      WHERE "itemId" = v_material."itemId"
        AND "locationId" = v_job_location_id
        AND "companyId" = p_company_id;
    END IF;

    IF v_material_storage_unit_id IS NULL THEN
      SELECT "storageUnitId" INTO v_material_storage_unit_id
      FROM "itemLedger"
      WHERE "itemId" = v_material."itemId"
        AND "locationId" = v_job_location_id
        AND "storageUnitId" IS NOT NULL
      GROUP BY "storageUnitId"
      HAVING SUM(quantity) > 0
      ORDER BY SUM(quantity) DESC
      LIMIT 1;
    END IF;

    -- Clamp lineside draws to actual untracked on-hand. An early per-operation
    -- return (returnPickedMaterialTiming = 'operation') or a manual transfer can
    -- leave the lineside bin short of the prorated target; never post a
    -- consumption the bin cannot supply. Warehouse bins (no workCenterId) keep
    -- the historical unclamped behavior.
    v_bin_work_center_id := NULL;
    IF v_material_storage_unit_id IS NOT NULL THEN
      SELECT su."workCenterId" INTO v_bin_work_center_id
      FROM "storageUnit" su
      WHERE su.id = v_material_storage_unit_id;

      IF v_bin_work_center_id IS NOT NULL THEN
        SELECT COALESCE(SUM(quantity), 0) INTO v_bin_on_hand
        FROM "itemLedger"
        WHERE "itemId" = v_material."itemId"
          AND "storageUnitId" = v_material_storage_unit_id
          AND "locationId" = v_job_location_id
          AND "companyId" = p_company_id
          AND "trackedEntityId" IS NULL;

        v_material_qty_to_issue := LEAST(v_material_qty_to_issue, GREATEST(v_bin_on_hand, 0));

        IF v_material_qty_to_issue <= 0 THEN
          CONTINUE;
        END IF;
      END IF;
    END IF;

    INSERT INTO "itemLedger" (
      "entryType", "documentType", "documentId", "companyId",
      "itemId", quantity, "locationId", "storageUnitId", "createdBy"
    ) VALUES (
      'Consumption', 'Job Consumption', p_job_id, p_company_id,
      v_material."itemId", -v_material_qty_to_issue,
      v_job_location_id, v_material_storage_unit_id, p_user_id
    );

    UPDATE "jobMaterial"
    SET "quantityIssued" = COALESCE("quantityIssued", 0) + v_material_qty_to_issue
    WHERE id = v_material.id;

    v_bf_item_ids := v_bf_item_ids || v_material."itemId";
    v_bf_quantities := v_bf_quantities || v_material_qty_to_issue;
    v_bf_storage_unit_ids := v_bf_storage_unit_ids || COALESCE(v_material_storage_unit_id, '');
  END LOOP;

  -- Check if accounting is enabled
  SELECT "accountingEnabled"
  INTO v_accounting_enabled
  FROM "companySettings"
  WHERE id = p_company_id;

  v_accounting_enabled := COALESCE(v_accounting_enabled, false);

  IF NOT v_accounting_enabled THEN
    RETURN;
  END IF;

  IF array_length(v_bf_item_ids, 1) IS NULL OR array_length(v_bf_item_ids, 1) = 0 THEN
    RETURN;
  END IF;

  -- Fetch company group
  SELECT "companyGroupId"
  INTO STRICT v_company_group_id
  FROM company
  WHERE id = p_company_id;

  -- Fetch account defaults
  SELECT "rawMaterialsAccount", "finishedGoodsAccount", "workInProgressAccount"
  INTO STRICT v_raw_materials_account, v_finished_goods_account, v_wip_account
  FROM "accountDefault"
  WHERE "companyId" = p_company_id;

  -- Fetch dimension IDs
  SELECT
    MAX(CASE WHEN "entityType" = 'ItemPostingGroup' THEN id END),
    MAX(CASE WHEN "entityType" = 'Item' THEN "id" END),
    MAX(CASE WHEN "entityType" = 'Location' THEN id END)
  INTO v_dimension_item_posting_group, v_dimension_item, v_dimension_location
  FROM dimension
  WHERE "companyGroupId" = v_company_group_id
    AND active = true
    AND "entityType" IN ('ItemPostingGroup', 'Item', 'Location');

  -- Get accounting period
  SELECT id INTO v_bf_accounting_period_id
  FROM "accountingPeriod"
  WHERE "companyId" = p_company_id
    AND "startDate" <= v_company_today
    AND "endDate" >= v_company_today
    AND status = 'Active'
  LIMIT 1;

  IF v_bf_accounting_period_id IS NULL THEN
    UPDATE "accountingPeriod"
    SET status = 'Inactive'
    WHERE status = 'Active' AND "companyId" = p_company_id;

    UPDATE "accountingPeriod"
    SET status = 'Active'
    WHERE "companyId" = p_company_id
      AND "startDate" <= v_company_today
      AND "endDate" >= v_company_today
    RETURNING id INTO v_bf_accounting_period_id;

    IF v_bf_accounting_period_id IS NULL THEN
      INSERT INTO "accountingPeriod" (
        "startDate", "endDate", "companyId", status, "createdBy"
      ) VALUES (
        date_trunc('month', v_company_today)::DATE,
        (date_trunc('month', v_company_today) + INTERVAL '1 month' - INTERVAL '1 day')::DATE,
        p_company_id, 'Active', 'system'
      )
      RETURNING id INTO v_bf_accounting_period_id;
    END IF;
  END IF;

  v_bf_journal_entry_id := get_next_sequence('journalEntry', p_company_id);

  INSERT INTO journal (
    "journalEntryId", "accountingPeriodId", description,
    "postingDate", "companyId", "sourceType", status,
    "postedAt", "postedBy", "createdBy"
  ) VALUES (
    v_bf_journal_entry_id, v_bf_accounting_period_id,
    'Material Issue — Job ' || v_job_id_readable,
    v_company_today, p_company_id, 'Job Consumption', 'Posted',
    NOW(), p_user_id, p_user_id
  )
  RETURNING id INTO v_bf_journal_id;

  v_bf_jl_ids := '{}';
  v_bf_posting_group_ids := '{}';
  v_bf_line_item_ids := '{}';

  FOR i IN 1..array_length(v_bf_item_ids, 1)
  LOOP
    -- Get itemCost for COGS calculation
    SELECT "costingMethod", "standardCost", "unitCost", "itemPostingGroupId"
    INTO v_material_costing_method, v_material_standard_cost, v_material_unit_cost, v_material_item_posting_group_id
    FROM "itemCost"
    WHERE "itemId" = v_bf_item_ids[i]
      AND "companyId" = p_company_id;

    IF v_material_costing_method IS NULL THEN
      CONTINUE;
    END IF;

    -- Calculate COGS based on costing method
    v_material_cogs_total := 0;

    IF v_material_costing_method = 'Standard' THEN
      v_material_cogs_total := COALESCE(v_material_standard_cost, 0) * v_bf_quantities[i];

    ELSIF v_material_costing_method = 'Average' THEN
      v_material_cogs_total := COALESCE(v_material_unit_cost, 0) * v_bf_quantities[i];

    ELSIF v_material_costing_method IN ('FIFO', 'LIFO') THEN
      v_remaining_to_consume := v_bf_quantities[i];

      FOR v_cost_layer IN
        SELECT id, quantity, cost, "remainingQuantity"
        FROM "costLedger"
        WHERE "itemId" = v_bf_item_ids[i]
          AND "companyId" = p_company_id
          AND "remainingQuantity" > 0
          -- adjustment child rows are consumed with their parent, not as layers
          AND adjustment = false
          AND "appliesToCostLedgerId" IS NULL
          -- 'Purchase Order' rows are planning/cost-history artifacts, not layers
          AND ("documentType" IS NULL OR "documentType" <> 'Purchase Order')
        ORDER BY
          CASE WHEN v_material_costing_method = 'FIFO' THEN "postingDate" END ASC,
          CASE WHEN v_material_costing_method = 'LIFO' THEN "postingDate" END DESC,
          CASE WHEN v_material_costing_method = 'FIFO' THEN "createdAt" END ASC,
          CASE WHEN v_material_costing_method = 'LIFO' THEN "createdAt" END DESC
      LOOP
        EXIT WHEN v_remaining_to_consume <= 0;

        v_layer_unit_cost := CASE
          WHEN v_cost_layer.quantity > 0 THEN v_cost_layer.cost / v_cost_layer.quantity
          ELSE 0
        END;

        v_quantity_from_layer := LEAST(v_remaining_to_consume, v_cost_layer."remainingQuantity");
        v_material_cogs_total := v_material_cogs_total + v_quantity_from_layer * v_layer_unit_cost;
        v_remaining_to_consume := v_remaining_to_consume - v_quantity_from_layer;

        UPDATE "costLedger"
        SET "remainingQuantity" = "remainingQuantity" - v_quantity_from_layer
        WHERE id = v_cost_layer.id;

        -- Consume the layer's cost-adjustment children (invoice-vs-receipt
        -- price corrections linked via "appliesToCostLedgerId") alongside the
        -- parent: each adjusted unit carries a bump of child.cost/child.quantity.
        -- Mirrors shared/calculate-cogs.ts.
        v_child_budget := v_quantity_from_layer;
        FOR v_adjustment_child IN
          SELECT id, quantity, cost, "remainingQuantity"
          FROM "costLedger"
          WHERE "appliesToCostLedgerId" = v_cost_layer.id
            AND "remainingQuantity" > 0
          ORDER BY "createdAt" ASC
        LOOP
          EXIT WHEN v_child_budget <= 0;

          v_child_per_unit := CASE
            WHEN v_adjustment_child.quantity > 0
              THEN v_adjustment_child.cost / v_adjustment_child.quantity
            ELSE 0
          END;

          v_child_apply := LEAST(v_adjustment_child."remainingQuantity", v_child_budget);
          v_material_cogs_total := v_material_cogs_total + v_child_apply * v_child_per_unit;
          v_child_budget := v_child_budget - v_child_apply;

          UPDATE "costLedger"
          SET "remainingQuantity" = "remainingQuantity" - v_child_apply
          WHERE id = v_adjustment_child.id;
        END LOOP;
      END LOOP;

      -- Fallback for negative inventory
      IF v_remaining_to_consume > 0 THEN
        v_material_cogs_total := v_material_cogs_total + v_remaining_to_consume * COALESCE(v_material_unit_cost, 0);
      END IF;
    END IF;

    IF v_material_cogs_total <= 0 THEN
      CONTINUE;
    END IF;

    -- Resolve Raw Materials vs Finished Goods from the consumed item:
    -- Buy → Raw Materials; Make / Buy and Make → Finished Goods.
    SELECT
      CASE WHEN i2."replenishmentSystem" = 'Buy' THEN v_raw_materials_account ELSE v_finished_goods_account END,
      CASE WHEN i2."replenishmentSystem" = 'Buy' THEN 'Raw Materials Account' ELSE 'Finished Goods Account' END
    INTO v_material_inventory_account, v_material_inventory_description
    FROM "item" i2
    WHERE i2."id" = v_bf_item_ids[i]
      AND i2."companyId" = p_company_id;

    v_bf_journal_line_ref := nanoid();

    -- DR WIP
    INSERT INTO "journalLine" (
      "journalId", "accountId", description, amount, quantity,
      "documentType", "documentId", "documentLineReference",
      "journalLineReference", "companyId"
    ) VALUES (
      v_bf_journal_id, v_wip_account, 'WIP Account',
      v_material_cogs_total, v_bf_quantities[i],
      'Job Consumption', p_job_id, 'job:' || p_job_id,
      v_bf_journal_line_ref, p_company_id
    )
    RETURNING id INTO v_bf_jl_id;

    v_bf_jl_ids := v_bf_jl_ids || v_bf_jl_id;
    v_bf_posting_group_ids := v_bf_posting_group_ids || COALESCE(v_material_item_posting_group_id, '');
    v_bf_line_item_ids := v_bf_line_item_ids || COALESCE(v_bf_item_ids[i], '');

    -- CR Inventory (Raw Materials or Finished Goods by item)
    INSERT INTO "journalLine" (
      "journalId", "accountId", description, amount, quantity,
      "documentType", "documentId", "documentLineReference",
      "journalLineReference", "companyId"
    ) VALUES (
      v_bf_journal_id, v_material_inventory_account, v_material_inventory_description,
      -v_material_cogs_total, v_bf_quantities[i],
      'Job Consumption', p_job_id, 'job:' || p_job_id,
      v_bf_journal_line_ref, p_company_id
    )
    RETURNING id INTO v_bf_jl_id;

    v_bf_jl_ids := v_bf_jl_ids || v_bf_jl_id;
    v_bf_posting_group_ids := v_bf_posting_group_ids || COALESCE(v_material_item_posting_group_id, '');
    v_bf_line_item_ids := v_bf_line_item_ids || COALESCE(v_bf_item_ids[i], '');

    -- Cost ledger entry for consumption
    INSERT INTO "costLedger" (
      "itemLedgerType", "costLedgerType", adjustment,
      "documentType", "documentId", "itemId",
      quantity, cost, "remainingQuantity", "companyId"
    ) VALUES (
      'Consumption', 'Direct Cost', false,
      'Job Consumption', p_job_id, v_bf_item_ids[i],
      -v_bf_quantities[i], -v_material_cogs_total,
      0, p_company_id
    );
  END LOOP;

  -- Dimensions for material consumption journal lines
  IF array_length(v_bf_jl_ids, 1) IS NOT NULL THEN
    FOR i IN 1..array_length(v_bf_jl_ids, 1)
    LOOP
      IF v_bf_posting_group_ids[i] != '' AND v_dimension_item_posting_group IS NOT NULL THEN
        INSERT INTO "journalLineDimension" (
          "journalLineId", "dimensionId", "valueId", "companyId"
        ) VALUES (
          v_bf_jl_ids[i], v_dimension_item_posting_group, v_bf_posting_group_ids[i], p_company_id
        );
      END IF;

      IF v_dimension_item IS NOT NULL AND v_bf_line_item_ids[i] != '' THEN
        INSERT INTO "journalLineDimension" (
          "journalLineId", "dimensionId", "valueId", "companyId"
        ) VALUES (
          v_bf_jl_ids[i], v_dimension_item, v_bf_line_item_ids[i], p_company_id
        );
      END IF;

      IF v_job_location_id IS NOT NULL AND v_dimension_location IS NOT NULL THEN
        INSERT INTO "journalLineDimension" (
          "journalLineId", "dimensionId", "valueId", "companyId"
        ) VALUES (
          v_bf_jl_ids[i], v_dimension_location, v_job_location_id, p_company_id
        );
      END IF;
    END LOOP;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION complete_job_to_inventory(
  p_job_id TEXT,
  p_quantity_complete NUMERIC,
  p_storage_unit_id TEXT DEFAULT NULL,
  p_location_id TEXT DEFAULT NULL,
  p_company_id TEXT DEFAULT NULL,
  p_user_id TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  v_company_today DATE := company_today(p_company_id);
BEGIN
  -- Never let a NULL user reach NOT NULL audit columns; fall back to the job creator
  p_user_id := COALESCE(p_user_id, (SELECT "createdBy" FROM "job" WHERE id = p_job_id));

  -- Fetch job details
  SELECT "itemId", "quantityReceivedToInventory", "jobId", "locationId", "salesOrderLineId", "companyId"
  INTO STRICT v_item_id, v_prior_quantity_received, v_job_id_readable, v_job_location_id, v_sales_order_line_id, v_job_company_id
  FROM "job"
  WHERE id = p_job_id;

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
  -- Non-Inventory items (services) never enter inventory.
  IF v_item_tracking_type IS DISTINCT FROM 'Non-Inventory' THEN
  IF v_job_make_method."requiresBatchTracking" THEN
    SELECT *
    INTO v_tracked_entity
    FROM "trackedEntity"
    WHERE attributes->>'Job Make Method' = v_job_make_method.id
      AND status != 'Consumed'
    ORDER BY "createdAt" DESC
    LIMIT 1;

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
    FOR v_tracked_entity IN
      SELECT *
      FROM "trackedEntity"
      WHERE attributes->>'Job Make Method' = v_job_make_method.id
        -- Rejected units (scrapped at inspection) must not be received.
        AND status NOT IN ('Consumed', 'Rejected')
    LOOP
      INSERT INTO "itemLedger" (
        "entryType", "documentType", "documentId", "companyId",
        "itemId", quantity, "locationId", "storageUnitId",
        "trackedEntityId", "createdBy"
      ) VALUES (
        'Assembly Output', 'Job Receipt', p_job_id, p_company_id,
        v_item_id, 1, p_location_id, p_storage_unit_id,
        v_tracked_entity.id, p_user_id
      );
    END LOOP;

    UPDATE "trackedEntity"
    SET status = 'Available'
    WHERE attributes->>'Job Make Method' = v_job_make_method.id
      -- Rejected units (scrapped at inspection) stay Rejected, out of stock.
      AND status NOT IN ('Consumed', 'Rejected');

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
$$;

CREATE OR REPLACE FUNCTION recompute_service_line_fulfillment(
  p_sales_order_line_id TEXT,
  p_company_id TEXT,
  p_user_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_tracking_type "itemTrackingType";
  v_line_type "salesOrderLineType";
  v_fulfilled NUMERIC;
  v_company_today DATE := company_today(p_company_id);
BEGIN
  IF p_sales_order_line_id IS NULL OR p_company_id IS NULL THEN
    RETURN;
  END IF;

  -- Only genuine Service lines fulfill by completion (kept in sync with
  -- complete_job_to_inventory). A Non-Inventory Part ships via post-shipment.
  SELECT i."itemTrackingType", sol."salesOrderLineType"
  INTO v_item_tracking_type, v_line_type
  FROM "salesOrderLine" sol
  JOIN "item" i ON i.id = sol."itemId" AND i."companyId" = sol."companyId"
  WHERE sol.id = p_sales_order_line_id
    AND sol."companyId" = p_company_id;

  IF v_item_tracking_type IS DISTINCT FROM 'Non-Inventory'
     OR v_line_type IS DISTINCT FROM 'Service' THEN
    RETURN;
  END IF;

  -- Fulfilled quantity = sum over this line's jobs that are actually completed.
  SELECT COALESCE(SUM("quantityComplete"), 0)
  INTO v_fulfilled
  FROM "job"
  WHERE "salesOrderLineId" = p_sales_order_line_id
    AND "companyId" = p_company_id
    AND status IN ('Completed', 'Closed');

  UPDATE "salesOrderLine" sol
  SET "quantitySent" = v_fulfilled,
      "sentComplete" = (COALESCE(sol."saleQuantity", 0) > 0 AND v_fulfilled >= sol."saleQuantity"),
      "sentDate" = CASE
        WHEN COALESCE(sol."saleQuantity", 0) > 0 AND v_fulfilled >= sol."saleQuantity"
          THEN COALESCE(sol."sentDate", v_company_today)
        ELSE NULL
      END,
      "updatedBy" = p_user_id,
      "updatedAt" = NOW()
  WHERE sol.id = p_sales_order_line_id
    AND sol."companyId" = p_company_id;
END;
$$;
