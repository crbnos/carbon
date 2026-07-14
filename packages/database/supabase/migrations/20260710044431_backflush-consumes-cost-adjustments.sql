-- backflush_job_materials is the PL/pgSQL twin of shared/calculate-cogs.ts.
-- Fork of the latest definition (20260706182830_fix-null-user-audit-columns.sql)
-- teaching its FIFO/LIFO loop about invoice-vs-receipt cost adjustment children
-- ("appliesToCostLedgerId"): base layers exclude children and 'Purchase Order'
-- pseudo-layers, and consuming a layer also consumes its children pro-rata so
-- job material cost matches the GL inventory value (receipt + invoice write-up).

DROP FUNCTION IF EXISTS backflush_job_materials(TEXT, NUMERIC, TEXT, TEXT);

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
  v_inventory_account TEXT;
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
  SELECT "inventoryAccount", "workInProgressAccount"
  INTO STRICT v_inventory_account, v_wip_account
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
    AND "startDate" <= CURRENT_DATE
    AND "endDate" >= CURRENT_DATE
    AND status = 'Active'
  LIMIT 1;

  IF v_bf_accounting_period_id IS NULL THEN
    UPDATE "accountingPeriod"
    SET status = 'Inactive'
    WHERE status = 'Active' AND "companyId" = p_company_id;

    UPDATE "accountingPeriod"
    SET status = 'Active'
    WHERE "companyId" = p_company_id
      AND "startDate" <= CURRENT_DATE
      AND "endDate" >= CURRENT_DATE
    RETURNING id INTO v_bf_accounting_period_id;

    IF v_bf_accounting_period_id IS NULL THEN
      INSERT INTO "accountingPeriod" (
        "startDate", "endDate", "companyId", status, "createdBy"
      ) VALUES (
        date_trunc('month', CURRENT_DATE)::DATE,
        (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::DATE,
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
    CURRENT_DATE, p_company_id, 'Job Consumption', 'Posted',
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

    -- CR Inventory
    INSERT INTO "journalLine" (
      "journalId", "accountId", description, amount, quantity,
      "documentType", "documentId", "documentLineReference",
      "journalLineReference", "companyId"
    ) VALUES (
      v_bf_journal_id, v_inventory_account, 'Inventory Account',
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
