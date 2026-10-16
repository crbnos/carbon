-- Strict backflush (.ai/specs/2026-10-14-strict-backflush.md).
--
-- companySettings.requireBackflushStorageUnit turns it on (off by default).
-- companySettings.preventNegativeBackflush (on by default) decides what a
-- short bin does under it: refuse, or let the bin go negative.
-- backflush_job_materials is copied from its live definition
-- (20261009010412_job-costing-always-post.sql) with one change: when strict
-- backflush is on at the job's location, a stocked material is consumed only
-- from its Pull From — a missing bin raises, and a short bin raises only while
-- preventNegativeBackflush is on — instead of falling back to the pick
-- method's bin or the fullest bin. A picked line is drawn from its lineside
-- bin first and the rest from its Pull From. With strict backflush off the
-- function is unchanged.

ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "requireBackflushStorageUnit" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "preventNegativeBackflush" BOOLEAN NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.backflush_job_materials(p_job_id text, p_quantity_complete numeric, p_company_id text, p_user_id text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  v_strict BOOLEAN;
  v_prevent_negative BOOLEAN;
  v_storage_unit_name TEXT;
  v_strict_problems TEXT[] := '{}';
  v_pull_from TEXT;
  v_lineside_take NUMERIC;
  v_issue_total NUMERIC;
  v_lock_key BIGINT;
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
  v_posting_status "journalEntryStatus";
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

  -- Strict backflush (.ai/specs/2026-10-14-strict-backflush.md): a stocked
  -- material is consumed only from its own storage unit. A short bin refuses
  -- the whole completion while preventNegativeBackflush is on; with it off the
  -- bin is drawn below zero instead of drawing from another bin.
  SELECT COALESCE("requireBackflushStorageUnit", false),
         COALESCE("preventNegativeBackflush", true)
  INTO v_strict, v_prevent_negative
  FROM "companySettings"
  WHERE id = p_company_id;
  v_strict := COALESCE(v_strict, false);
  v_prevent_negative := COALESCE(v_prevent_negative, true);

  -- Strict backflush applies only where activation asks for a Pull From: a
  -- location with an active work center and an active storage unit
  -- (getPullFromLocations in @carbon/database/strict-backflush).
  v_strict := v_strict
    AND EXISTS (
      SELECT 1 FROM "workCenter"
      WHERE "locationId" = v_job_location_id
        AND "companyId" = p_company_id
        AND active = true
    )
    AND EXISTS (
      SELECT 1 FROM "storageUnit"
      WHERE "locationId" = v_job_location_id
        AND "companyId" = p_company_id
        AND active = true
    );

  -- Lock every Pull From this completion may draw, in one order (by key hash),
  -- before the first draw: two completions drawing the same bins then cannot
  -- deadlock. lockStrictBins in @carbon/server-functions locks in the same
  -- order with the same keys.
  IF v_strict AND v_prevent_negative THEN
    FOR v_lock_key IN
      SELECT DISTINCT hashtextextended(
        'strict-backflush:' || p_company_id || ':' || pf."pullFrom" || ':' || jm."itemId",
        0
      )
      FROM "jobMaterial" jm
      LEFT JOIN "item" i ON i.id = jm."itemId" AND i."companyId" = p_company_id
      CROSS JOIN LATERAL (
        SELECT COALESCE((
          SELECT pll."storageUnitId"
          FROM "pickingListLine" pll
          WHERE pll."jobMaterialId" = jm.id
            AND pll."companyId" = p_company_id
            AND pll."toStorageUnitId" = jm."storageUnitId"
            AND pll."storageUnitId" IS NOT NULL
            AND pll."storageUnitId" <> jm."storageUnitId"
          ORDER BY pll."createdAt", pll.id
          LIMIT 1
        ), jm."storageUnitId") AS "pullFrom"
      ) pf
      WHERE jm."jobId" = p_job_id
        AND jm."companyId" = p_company_id
        AND jm."itemType" IN ('Material', 'Part', 'Consumable')
        AND jm."methodType" != 'Make to Order'
        AND jm."requiresBatchTracking" = false
        AND jm."requiresSerialTracking" = false
        AND jm."quantityToIssue" > 0
        AND COALESCE(i."itemTrackingType", 'Inventory') <> 'Non-Inventory'
        AND pf."pullFrom" IS NOT NULL
      ORDER BY 1
    LOOP
      PERFORM pg_advisory_xact_lock(v_lock_key);
    END LOOP;
  END IF;

  -- Backflush non-tracked materials
  FOR v_material IN
    SELECT jm.id, jm."itemId", jm."quantityToIssue", jm."quantityIssued",
           jm."estimatedQuantity", jm."storageUnitId", jm."defaultStorageUnit",
           i."itemTrackingType", i."readableIdWithRevision" AS "itemReadableId"
    FROM "jobMaterial" jm
    LEFT JOIN "item" i ON i.id = jm."itemId" AND i."companyId" = p_company_id
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

    IF v_strict AND COALESCE(v_material."itemTrackingType", 'Inventory') <> 'Non-Inventory' THEN
      v_issue_total := v_material_qty_to_issue;

      -- Every material the bins cannot cover is collected and refused together
      -- after the loop, so the material controller sees them all at once.
      IF v_material."storageUnitId" IS NULL THEN
        v_strict_problems := v_strict_problems || format(
          '%s has no Pull From storage unit on job %s',
          COALESCE(v_material."itemReadableId", v_material."itemId"), v_job_id_readable
        );
        CONTINUE;
      END IF;

      -- A pick points the line at the lineside bin it was picked to. The
      -- oldest pick line into that bin still names the Pull From
      -- (pullFromStorageUnit in @carbon/database/strict-backflush).
      v_pull_from := COALESCE((
        SELECT pll."storageUnitId"
        FROM "pickingListLine" pll
        WHERE pll."jobMaterialId" = v_material.id
          AND pll."companyId" = p_company_id
          AND pll."toStorageUnitId" = v_material."storageUnitId"
          AND pll."storageUnitId" IS NOT NULL
          AND pll."storageUnitId" <> v_material."storageUnitId"
        ORDER BY pll."createdAt", pll.id
        LIMIT 1
      ), v_material."storageUnitId");

      -- A picked line: what was picked is drawn from lineside first, up to
      -- what the bin holds.
      IF v_pull_from <> v_material."storageUnitId" THEN
        SELECT COALESCE(SUM(quantity), 0) INTO v_bin_on_hand
        FROM "itemLedger"
        WHERE "itemId" = v_material."itemId"
          AND "storageUnitId" = v_material."storageUnitId"
          AND "locationId" = v_job_location_id
          AND "companyId" = p_company_id
          AND "trackedEntityId" IS NULL;

        v_lineside_take := LEAST(v_material_qty_to_issue, GREATEST(v_bin_on_hand, 0));

        IF v_lineside_take > 0 THEN
          INSERT INTO "itemLedger" (
            "entryType", "documentType", "documentId", "companyId",
            "itemId", quantity, "locationId", "storageUnitId", "createdBy"
          ) VALUES (
            'Consumption', 'Job Consumption', p_job_id, p_company_id,
            v_material."itemId", -v_lineside_take,
            v_job_location_id, v_material."storageUnitId", p_user_id
          );

          v_bf_item_ids := v_bf_item_ids || v_material."itemId";
          v_bf_quantities := v_bf_quantities || v_lineside_take;
          v_bf_storage_unit_ids := v_bf_storage_unit_ids || v_material."storageUnitId";

          v_material_qty_to_issue := v_material_qty_to_issue - v_lineside_take;
        END IF;
      END IF;

      -- The rest comes from the Pull From only. A short Pull From is refused
      -- only while negative stock is prevented; with it allowed, the material
      -- is drawn from its Pull From even below zero. A refused material still
      -- writes its row below (the function raises before anything commits),
      -- so a later material on the same bin counts this need too. The lock
      -- was taken before the loop.
      v_material_storage_unit_id := v_pull_from;

      IF v_material_qty_to_issue > 0 AND v_prevent_negative THEN
        SELECT COALESCE(SUM(quantity), 0) INTO v_bin_on_hand
        FROM "itemLedger"
        WHERE "itemId" = v_material."itemId"
          AND "storageUnitId" = v_material_storage_unit_id
          AND "locationId" = v_job_location_id
          AND "companyId" = p_company_id
          AND "trackedEntityId" IS NULL;

        IF round(v_bin_on_hand, 5) < round(v_material_qty_to_issue, 5) THEN
          SELECT name INTO v_storage_unit_name
          FROM "storageUnit"
          WHERE id = v_material_storage_unit_id
            AND "companyId" = p_company_id;

          v_strict_problems := v_strict_problems || format(
            'Not enough %s in %s: need %s, have %s',
            COALESCE(v_material."itemReadableId", v_material."itemId"),
            COALESCE(v_storage_unit_name, v_material_storage_unit_id),
            trim_scale(round(v_material_qty_to_issue, 5)),
            trim_scale(round(GREATEST(v_bin_on_hand, 0), 5))
          );
        END IF;
      END IF;
    ELSE
    -- Resolve storage unit (strict backflush off: the pre-existing fallbacks)
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
    v_issue_total := v_material_qty_to_issue;
    END IF;

    -- Strict: a picked line can be covered by lineside alone.
    IF v_material_qty_to_issue > 0 THEN
      INSERT INTO "itemLedger" (
        "entryType", "documentType", "documentId", "companyId",
        "itemId", quantity, "locationId", "storageUnitId", "createdBy"
      ) VALUES (
        'Consumption', 'Job Consumption', p_job_id, p_company_id,
        v_material."itemId", -v_material_qty_to_issue,
        v_job_location_id, v_material_storage_unit_id, p_user_id
      );

      v_bf_item_ids := v_bf_item_ids || v_material."itemId";
      v_bf_quantities := v_bf_quantities || v_material_qty_to_issue;
      v_bf_storage_unit_ids := v_bf_storage_unit_ids || COALESCE(v_material_storage_unit_id, '');
    END IF;

    UPDATE "jobMaterial"
    SET "quantityIssued" = COALESCE("quantityIssued", 0) + v_issue_total
    WHERE id = v_material.id;
  END LOOP;

  -- The refusal is shown as a toast: name the first three shortfalls and
  -- count the rest (strictBackflushRefusal in @carbon/server-functions does
  -- the same), so a long BoM cannot produce a wall of text.
  IF array_length(v_strict_problems, 1) > 3 THEN
    RAISE EXCEPTION '%; and % more',
      array_to_string(v_strict_problems[1:3], '; '),
      array_length(v_strict_problems, 1) - 3;
  ELSIF array_length(v_strict_problems, 1) > 0 THEN
    RAISE EXCEPTION '%', array_to_string(v_strict_problems, '; ');
  END IF;

  -- Every company posts; the accounting cutover decides the status
  -- (.ai/specs/2026-10-08-accounting-cutover.md section 1).
  v_posting_status := journal_posting_status(p_company_id);

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

  IF v_bf_accounting_period_id IS NULL AND v_posting_status = 'Posted' THEN
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

  -- A Provisional journal has no accounting period (spec section 1).
  IF v_posting_status <> 'Posted' THEN
    v_bf_accounting_period_id := NULL;
  END IF;

  v_bf_journal_entry_id := get_next_sequence('journalEntry', p_company_id);

  INSERT INTO journal (
    "journalEntryId", "accountingPeriodId", description,
    "postingDate", "companyId", "sourceType", status,
    "postedAt", "postedBy", "createdBy"
  ) VALUES (
    v_bf_journal_entry_id, v_bf_accounting_period_id,
    'Material Issue — Job ' || v_job_id_readable,
    v_company_today, p_company_id, 'Job Consumption', v_posting_status,
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
$function$;
