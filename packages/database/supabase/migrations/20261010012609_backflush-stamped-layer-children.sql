-- The SQL backflush relieves cost layers as calculateCOGS does.
-- packages/server-functions/src/lib/calculate-cogs.ts + cost-layer-order.ts.
--
-- 1. Layer order. A layer stamped for one serial unit ("trackedEntityId" set)
--    belongs to that unit. The backflush issues only untracked material, so no
--    serial leaves here: it takes unstamped layers in FIFO / LIFO order first,
--    and a stamped layer only when the unstamped layers run out
--    (orderLayersForConsumption with no leaving units).
-- 2. Children of a stamped layer. Every child of a layer stamped for one serial
--    (a moved price variance, a refurbishment Revaluation, a write-down) belongs
--    to that unit, so each open child applies in full, up to the quantity taken.
--    Before, the children shared one budget, so a 1-unit stamped layer applied
--    only its first child. Unstamped layers keep the old rule: their children
--    cover its units in turn.
--
-- Layers with no children, and unstamped layers, relieve the same cost as before.
-- The function stays SECURITY INVOKER (no SECURITY DEFINER clause).

CREATE OR REPLACE FUNCTION public.backflush_job_materials(p_job_id text, p_quantity_complete numeric, p_company_id text, p_user_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
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
  v_consume_to_project BOOLEAN;
  v_project_id TEXT;
  v_project_element_id TEXT;
  v_debit_account TEXT;
  v_dimension_project TEXT;
  v_dimension_project_element TEXT;
  v_capital_job BOOLEAN := FALSE;
  v_job_asset_id TEXT;
BEGIN
  -- Never let a NULL user reach NOT NULL audit columns; fall back to the job creator
  p_user_id := COALESCE(p_user_id, (SELECT "createdBy" FROM "job" WHERE id = p_job_id));

  -- Fetch job details
  SELECT quantity, "locationId", "jobId", "consumeToProject", "projectId", "projectElementId", "fixedAssetId"
  INTO STRICT v_job_quantity, v_job_location_id, v_job_id_readable,
              v_consume_to_project, v_project_id, v_project_element_id, v_job_asset_id
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
    MAX(CASE WHEN "entityType" = 'Location' THEN id END),
    MAX(CASE WHEN "entityType" = 'Project' THEN id END),
    MAX(CASE WHEN "entityType" = 'ProjectElement' THEN id END)
  INTO v_dimension_item_posting_group, v_dimension_item, v_dimension_location,
       v_dimension_project, v_dimension_project_element
  FROM dimension
  WHERE "companyGroupId" = v_company_group_id
    AND active = true
    AND "entityType" IN ('ItemPostingGroup', 'Item', 'Location', 'Project', 'ProjectElement');

  -- A consume-to-project job charges its backflushed material to the project
  -- account (the cost treatment) instead of WIP, as issue does.
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
  END IF;

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
        SELECT id, quantity, cost, "remainingQuantity", "trackedEntityId"
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
          -- Unstamped layers first; a layer stamped for a serial unit is the
          -- last resort (orderLayersForConsumption, no leaving units).
          ("trackedEntityId" IS NOT NULL) ASC,
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

        -- Consume the layer's cost-adjustment children (linked via
        -- "appliesToCostLedgerId") alongside the parent: each adjusted unit
        -- carries a bump of child.cost/child.quantity. On an unstamped layer
        -- the children cover its units in turn, so they share one budget. On a
        -- layer stamped for one serial unit every child belongs to that unit,
        -- so each applies in full, up to the quantity taken.
        -- Mirrors packages/server-functions/src/lib/calculate-cogs.ts.
        v_child_budget := v_quantity_from_layer;
        FOR v_adjustment_child IN
          SELECT id, quantity, cost, "remainingQuantity"
          FROM "costLedger"
          WHERE "appliesToCostLedgerId" = v_cost_layer.id
            AND "companyId" = p_company_id
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
          IF v_cost_layer."trackedEntityId" IS NULL THEN
            v_child_budget := v_child_budget - v_child_apply;
          END IF;

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
      v_bf_journal_id, v_debit_account,
      CASE WHEN v_consume_to_project THEN 'Project Material' ELSE 'WIP Account' END,
      v_material_cogs_total, v_bf_quantities[i],
      'Job Consumption', p_job_id, 'job:' || p_job_id,
      v_bf_journal_line_ref, p_company_id
    )
    RETURNING id INTO v_bf_jl_id;

    -- Project tags and the projectLedger row on the project debit (mirrors issue)
    IF v_consume_to_project OR v_capital_job THEN
      IF v_dimension_project IS NOT NULL THEN
        INSERT INTO "journalLineDimension" (
          "journalLineId", "dimensionId", "valueId", "companyId"
        ) VALUES (
          v_bf_jl_id, v_dimension_project, v_project_id, p_company_id
        );
      END IF;
      IF v_dimension_project_element IS NOT NULL AND v_project_element_id IS NOT NULL THEN
        INSERT INTO "journalLineDimension" (
          "journalLineId", "dimensionId", "valueId", "companyId"
        ) VALUES (
          v_bf_jl_id, v_dimension_project_element, v_project_element_id, p_company_id
        );
      END IF;

      INSERT INTO "projectLedger" (
        "companyId", "projectId", "projectElementId", "postingDate", "costType",
        "documentType", "documentId", "jobId", "itemId", quantity, amount,
        "journalLineId", "createdBy"
      ) VALUES (
        p_company_id, v_project_id, v_project_element_id, v_company_today, 'Material',
        'Job Consumption', p_job_id, p_job_id, v_bf_item_ids[i],
        ROUND(v_bf_quantities[i], 5), ROUND(v_material_cogs_total, 5),
        v_bf_jl_id, p_user_id
      );
    END IF;

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

NOTIFY pgrst, 'reload schema';
