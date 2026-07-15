-- =============================================================================
-- complete_job_to_inventory: handle Non-Inventory items (e.g. Service items).
--
-- Body forked verbatim from 20260630092517_job-costing-item-dimension.sql with
-- one addition: when the job's item is Non-Inventory, completion must not touch
-- inventory. Specifically:
--   - no 'Assembly Output' / 'Job Receipt' itemLedger entries
--   - no pickMethod default-storage-unit update
--   - no costLedger 'Output' layer and no itemCost.unitCost update
--   - WIP discharges to Cost of Goods Sold instead of FG Inventory. Services
--     never ship, so completion is the only event that can relieve WIP.
-- Labor/machine absorption journals and the material backflush are unchanged.
-- =============================================================================
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
  v_quantity_received_to_inventory NUMERIC;
  v_job_id_readable TEXT;
  v_job_make_method RECORD;
  v_tracked_entity RECORD;
  v_accounting_enabled BOOLEAN;
  v_company_group_id TEXT;
  v_inventory_account TEXT;
  v_wip_account TEXT;
  v_labor_absorption_account TEXT;
  v_cogs_account TEXT;
  v_dimension_item_posting_group TEXT;
  v_dimension_item TEXT;
  v_dimension_location TEXT;
  v_dimension_cost_center TEXT;
  v_dimension_employee TEXT;
  v_event RECORD;
  v_duration_hours NUMERIC;
  v_rate NUMERIC;
  v_labor_cost NUMERIC;
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
BEGIN
  -- Fetch job details
  SELECT "itemId", "quantityReceivedToInventory", "jobId", "locationId"
  INTO STRICT v_item_id, v_quantity_received_to_inventory, v_job_id_readable, v_job_location_id
  FROM "job"
  WHERE id = p_job_id;

  SELECT "itemTrackingType"
  INTO v_item_tracking_type
  FROM "item"
  WHERE id = v_item_id;

  v_quantity_received_to_inventory := p_quantity_complete - COALESCE(v_quantity_received_to_inventory, 0);

  -- Fetch jobMakeMethod for the top-level (no parentMaterialId)
  SELECT *
  INTO STRICT v_job_make_method
  FROM "jobMakeMethod"
  WHERE "jobId" = p_job_id
    AND "parentMaterialId" IS NULL;

  -- Update job status
  UPDATE "job"
  SET status = 'Completed',
      "completedDate" = NOW(),
      "quantityComplete" = p_quantity_complete,
      "quantityReceivedToInventory" = v_quantity_received_to_inventory,
      "updatedAt" = NOW(),
      "updatedBy" = p_user_id
  WHERE id = p_job_id;

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
          AND status != 'Consumed'
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
        AND status != 'Consumed';

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

    -- Update pickMethod defaultStorageUnitId if needed
    IF p_storage_unit_id IS NOT NULL AND p_location_id IS NOT NULL THEN
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
  SELECT "inventoryAccount", "workInProgressAccount", "laborAbsorptionAccount", "costOfGoodsSoldAccount"
  INTO STRICT v_inventory_account, v_wip_account, v_labor_absorption_account, v_cogs_account
  FROM "accountDefault"
  WHERE "companyId" = p_company_id;

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

  -- Post unposted production events as labor/machine absorption JEs
  FOR v_event IN
    SELECT
      pe.id,
      pe.duration,
      pe.type,
      pe."employeeId",
      wc."laborRate",
      wc."machineRate"
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

    IF v_labor_cost > 0 AND v_labor_absorption_account IS NOT NULL THEN
      v_labor_journal_line_reference := nanoid();

      -- Get current accounting period
      SELECT id INTO v_labor_accounting_period_id
      FROM "accountingPeriod"
      WHERE "companyId" = p_company_id
        AND "startDate" <= CURRENT_DATE
        AND "endDate" >= CURRENT_DATE
        AND status = 'Active'
      LIMIT 1;

      IF v_labor_accounting_period_id IS NULL THEN
        UPDATE "accountingPeriod"
        SET status = 'Inactive'
        WHERE status = 'Active' AND "companyId" = p_company_id;

        UPDATE "accountingPeriod"
        SET status = 'Active'
        WHERE "companyId" = p_company_id
          AND "startDate" <= CURRENT_DATE
          AND "endDate" >= CURRENT_DATE
        RETURNING id INTO v_labor_accounting_period_id;

        IF v_labor_accounting_period_id IS NULL THEN
          INSERT INTO "accountingPeriod" (
            "startDate", "endDate", "companyId", status, "createdBy"
          ) VALUES (
            date_trunc('month', CURRENT_DATE)::DATE,
            (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::DATE,
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
        CURRENT_DATE, p_company_id, 'Production Event', 'Posted',
        NOW(), p_user_id, p_user_id
      )
      RETURNING id INTO v_labor_journal_id;

      -- DR WIP
      INSERT INTO "journalLine" (
        "journalId", "accountId", description, amount, quantity,
        "documentType", "documentId", "documentLineReference",
        "journalLineReference", "companyId"
      ) VALUES (
        v_labor_journal_id, v_wip_account, 'WIP Account',
        v_labor_cost, 1,
        'Production Event', p_job_id, 'job:' || p_job_id,
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
        'Production Event', p_job_id, 'job:' || p_job_id,
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

  v_today := CURRENT_DATE;
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

  -- DR FG Inventory — or COGS for Non-Inventory items, which never ship
  IF v_item_tracking_type IS DISTINCT FROM 'Non-Inventory' THEN
    INSERT INTO "journalLine" (
      "journalId", "accountId", description, amount, quantity,
      "documentType", "documentId", "documentLineReference",
      "journalLineReference", "companyId"
    ) VALUES (
      v_journal_id, v_inventory_account, 'Finished Goods Inventory',
      v_accumulated_wip_cost, v_quantity_received_to_inventory,
      'Job Receipt', p_job_id, 'job:' || p_job_id,
      v_journal_line_reference, p_company_id
    )
    RETURNING id INTO v_labor_jl_id;
  ELSE
    INSERT INTO "journalLine" (
      "journalId", "accountId", description, amount, quantity,
      "documentType", "documentId", "documentLineReference",
      "journalLineReference", "companyId"
    ) VALUES (
      v_journal_id, v_cogs_account, 'Cost of Goods Sold',
      v_accumulated_wip_cost, v_quantity_received_to_inventory,
      'Job Receipt', p_job_id, 'job:' || p_job_id,
      v_journal_line_reference, p_company_id
    )
    RETURNING id INTO v_labor_jl_id;
  END IF;

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

  IF v_item_tracking_type IS DISTINCT FROM 'Non-Inventory' THEN
    -- Write costLedger entry for finished good
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

    -- Update item cost
    SELECT "costingMethod", "unitCost", "itemPostingGroupId"
    INTO v_costing_method, v_existing_unit_cost, v_item_posting_group_id
    FROM "itemCost"
    WHERE "itemId" = v_item_id
      AND "companyId" = p_company_id;

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
  ELSE
    -- Dimensions on the WIP discharge lines still want the posting group
    SELECT "itemPostingGroupId"
    INTO v_item_posting_group_id
    FROM "itemCost"
    WHERE "itemId" = v_item_id
      AND "companyId" = p_company_id;
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
