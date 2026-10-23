-- Charge at receipt is charged once (audit 2026-10-22, C2).
--
-- A project with project stock and "Charge at receipt" is charged when its
-- PO receipt puts the goods in its stock: the receipt's Material row points
-- at the inventory debit. Every issue path then charged the same units a
-- second time. Now the units of the project's own stock that its receipts
-- charged and no issue has moved yet write a zero-net pair instead of a new
-- cost: +cost on the project debit (Project WIP) and -cost on the inventory
-- credit, both flagged "relocatesReceiptCharge". The pair bills nothing and
-- nets to 0 in every total; the revenue run relieves the project-account row
-- and never a row on an inventory account. A Return of those units writes
-- the mirror pair.
--
-- 1. projectLedger."relocatesReceiptCharge".
-- 2. project_receipt_charge_quantities: per (project, element, item), the
--    receipt-charged quantity still on the shelf and the quantity relocated
--    to the project account. Both the TypeScript issue paths and the SQL
--    backflush read it, so they agree.
-- 3. backflush_job_materials: the body of 20261021013400 with the split. The
--    projectLedger rows move after the inventory credit line, whose id the
--    pair needs. Nothing else changes. complete_job_to_inventory writes no
--    Material row (it backflushes through this function), so it is not
--    redefined.

ALTER TABLE "projectLedger"
  ADD COLUMN IF NOT EXISTS "relocatesReceiptCharge" BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN "projectLedger"."relocatesReceiptCharge" IS
  'True on the two rows of a zero-net pair that move cost a Charge at receipt project was charged at receipt from inventory to the project account when the stock is issued (or back on a Return). Not new cost: billing skips it and it nets to 0 in every total.';

CREATE OR REPLACE FUNCTION public.project_receipt_charge_quantities(
  p_company_id TEXT,
  p_project_ids TEXT[],
  p_item_ids TEXT[]
)
RETURNS TABLE (
  "projectId" TEXT,
  "projectElementId" TEXT,
  "itemId" TEXT,
  "onShelfQuantity" NUMERIC,
  "relocatedQuantity" NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  -- On the shelf: the receipt Material rows and the relocation rows whose
  -- journal line is on an inventory account (a receipt +, an issue -, a
  -- return +). Relocated: the relocation rows on any other account (the
  -- project account: an issue +, a return -). Only projects with project
  -- stock that charge at receipt.
  WITH accounts AS (
    SELECT ARRAY[ad."rawMaterialsAccount", ad."finishedGoodsAccount"] AS "inventory"
    FROM "accountDefault" ad
    WHERE ad."companyId" = p_company_id
  ),
  charge_rows AS (
    SELECT
      pl."projectId",
      pl."projectElementId",
      pl."itemId",
      pl."quantity",
      pl."relocatesReceiptCharge",
      COALESCE(jl."accountId" = ANY(a."inventory"), FALSE) AS "onInventory"
    FROM "projectLedger" pl
    JOIN "project" p
      ON p."id" = pl."projectId" AND p."companyId" = pl."companyId"
    LEFT JOIN "journalLine" jl
      ON jl."id" = pl."journalLineId" AND jl."companyId" = pl."companyId"
    LEFT JOIN accounts a ON TRUE
    WHERE pl."companyId" = p_company_id
      AND pl."projectId" = ANY(p_project_ids)
      AND pl."itemId" = ANY(p_item_ids)
      AND p."projectStock"
      AND p."chargeAtReceipt"
      AND (
        pl."relocatesReceiptCharge"
        OR (pl."documentType" = 'Purchase Receipt' AND pl."costType" = 'Material')
      )
  )
  SELECT
    r."projectId",
    r."projectElementId",
    r."itemId",
    COALESCE(SUM(r."quantity") FILTER (WHERE r."onInventory"), 0),
    COALESCE(SUM(r."quantity") FILTER (WHERE r."relocatesReceiptCharge" AND NOT r."onInventory"), 0)
  FROM charge_rows r
  GROUP BY r."projectId", r."projectElementId", r."itemId"
$$;

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
  v_strict BOOLEAN;
  v_prevent_negative BOOLEAN;
  v_storage_unit_name TEXT;
  v_strict_problems TEXT[] := '{}';
  v_pull_from TEXT;
  v_lineside RECORD;
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
  v_bf_wip_jl_id TEXT;
  v_bf_on_shelf NUMERIC;
  v_bf_charged_qty NUMERIC;
  v_bf_charged_cost NUMERIC;
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
  v_project_stock BOOLEAN := FALSE;
  v_stripes TEXT[] := ARRAY[NULL]::TEXT[];
  v_stripe_keys TEXT[] := ARRAY['']::TEXT[];
  v_stripe TEXT;
  v_stripe_on_hand NUMERIC;
  v_stripe_draw NUMERIC;
  v_left_to_draw NUMERIC;
  v_bf_project_ids TEXT[] := '{}';
  v_planning_group_id TEXT;
  v_member_stripes TEXT[];
BEGIN
  -- Never let a NULL user reach NOT NULL audit columns; fall back to the job creator
  p_user_id := COALESCE(p_user_id, (SELECT "createdBy" FROM "job" WHERE id = p_job_id));

  -- Fetch job details
  SELECT quantity, "locationId", "jobId", "consumeToProject", "projectId", "projectElementId", "fixedAssetId",
         "planningGroupId"
  INTO STRICT v_job_quantity, v_job_location_id, v_job_id_readable,
              v_consume_to_project, v_project_id, v_project_element_id, v_job_asset_id,
              v_planning_group_id
  FROM "job"
  WHERE id = p_job_id;

  IF v_job_quantity IS NULL OR v_job_quantity <= 0 THEN
    RETURN;
  END IF;

  v_ratio := p_quantity_complete / v_job_quantity;

  -- The stripes this job's demand may draw, in order: its project's stock
  -- (when the project has project stock), then common stock (NULL).
  -- v_stripe_keys holds the same set with '' for common, for ANY() filters.
  IF v_project_id IS NOT NULL THEN
    SELECT COALESCE("projectStock", FALSE) INTO v_project_stock
    FROM "project"
    WHERE id = v_project_id AND "companyId" = p_company_id;

    IF COALESCE(v_project_stock, FALSE) THEN
      v_stripes := ARRAY[v_project_id, NULL]::TEXT[];
      v_stripe_keys := ARRAY[v_project_id, '']::TEXT[];
    END IF;
  END IF;

  -- A job made for a planning group (Projects Phase 3) has no project. It
  -- draws its members' stock in the order of its current pegs (the order
  -- harden_pegs_for_supply walks), then common stock.
  IF v_planning_group_id IS NOT NULL THEN
    SELECT array_agg(m."projectId" ORDER BY m.first_rank)
    INTO v_member_stripes
    FROM (
      SELECT ranked."projectId", MIN(ranked.rank) AS first_rank
      FROM (
        SELECT pp."projectId",
               ROW_NUMBER() OVER (
                 ORDER BY pp."needDate" NULLS LAST, p."planningPriority", pp."demandSourceId", pp."id"
               ) AS rank
        FROM "projectPeg" pp
        LEFT JOIN "project" p
          ON p."id" = pp."projectId" AND p."companyId" = pp."companyId"
        WHERE pp."companyId" = p_company_id
          AND pp."supplyType" = 'Job'
          AND pp."supplyId" = p_job_id
          AND pp."supersededAt" IS NULL
      ) ranked
      GROUP BY ranked."projectId"
    ) m;

    IF array_length(v_member_stripes, 1) > 0 THEN
      v_stripes := v_member_stripes || ARRAY[NULL]::TEXT[];
      v_stripe_keys := v_member_stripes || ARRAY['']::TEXT[];
    END IF;
  END IF;

  SELECT COALESCE("requireBackflushStorageUnit", false),
         COALESCE("preventNegativeBackflush", true)
  INTO v_strict, v_prevent_negative
  FROM "companySettings"
  WHERE id = p_company_id;
  v_strict := COALESCE(v_strict, false);
  v_prevent_negative := COALESCE(v_prevent_negative, true);

  -- Only where activation asks for a Pull From (getPullFromLocations).
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

  -- Lock in key-hash order before the first draw, as lockStrictBins does, so
  -- two completions cannot deadlock.
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

      IF v_material."storageUnitId" IS NULL THEN
        v_strict_problems := v_strict_problems || format(
          '%s has no Pull From storage unit on job %s',
          COALESCE(v_material."itemReadableId", v_material."itemId"), v_job_id_readable
        );
        CONTINUE;
      END IF;

      -- A pick points the line at lineside; the oldest pick line into it names
      -- the Pull From (pullFromStorageUnit).
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

      -- Every storage unit this material's live picks went to, most staged
      -- first (getPickedBudgets), not only the line's latest one.
      FOR v_lineside IN
        SELECT dest.id
        FROM (
          SELECT pll."toStorageUnitId" AS id,
            SUM(GREATEST(COALESCE(pll."quantityPicked", 0) - COALESCE(pll."quantityReturned", 0), 0)) AS staged
          FROM "pickingListLine" pll
          JOIN "pickingList" pl ON pl.id = pll."pickingListId"
          WHERE pll."jobMaterialId" = v_material.id
            AND pll."companyId" = p_company_id
            AND pll.status <> 'Cancelled'
            AND pl.status <> 'Cancelled'
            AND pll."toStorageUnitId" IS NOT NULL
          GROUP BY pll."toStorageUnitId"
          UNION ALL
          SELECT v_material."storageUnitId", 0
        ) dest
        WHERE dest.id <> v_pull_from
        GROUP BY dest.id
        ORDER BY SUM(dest.staged) DESC, dest.id
      LOOP
        EXIT WHEN v_material_qty_to_issue <= 0;

        -- Merge: each lineside unit is drawn stripe by stripe, in the job's
        -- stripe order, each stripe up to its own untracked on-hand there.
        FOR v_stripe_index IN 1..array_length(v_stripes, 1)
        LOOP
          EXIT WHEN v_material_qty_to_issue <= 0;
          v_stripe := v_stripes[v_stripe_index];

          SELECT COALESCE(SUM(quantity), 0) INTO v_bin_on_hand
          FROM "itemLedger"
          WHERE "itemId" = v_material."itemId"
            AND "storageUnitId" = v_lineside.id
            AND "locationId" = v_job_location_id
            AND "companyId" = p_company_id
            AND "trackedEntityId" IS NULL
            AND "projectId" IS NOT DISTINCT FROM v_stripe;

          v_lineside_take := LEAST(v_material_qty_to_issue, GREATEST(v_bin_on_hand, 0));

          IF v_lineside_take > 0 THEN
            INSERT INTO "itemLedger" (
              "entryType", "documentType", "documentId", "companyId",
              "itemId", quantity, "locationId", "storageUnitId", "projectId", "createdBy"
            ) VALUES (
              'Consumption', 'Job Consumption', p_job_id, p_company_id,
              v_material."itemId", -v_lineside_take,
              v_job_location_id, v_lineside.id, v_stripe, p_user_id
            );

            v_bf_item_ids := v_bf_item_ids || v_material."itemId";
            v_bf_quantities := v_bf_quantities || v_lineside_take;
            v_bf_storage_unit_ids := v_bf_storage_unit_ids || v_lineside.id;
            v_bf_project_ids := array_append(v_bf_project_ids, v_stripe);

            v_material_qty_to_issue := v_material_qty_to_issue - v_lineside_take;
          END IF;
        END LOOP;
      END LOOP;

      -- A refused material still writes its row (the function raises before
      -- commit), so a later material on the bin counts this need.
      v_material_storage_unit_id := v_pull_from;

      -- Merge: only the stripes this job may draw count as on-hand, as in the
      -- clamp below.
      IF v_material_qty_to_issue > 0 AND v_prevent_negative THEN
        SELECT COALESCE(SUM(quantity), 0) INTO v_bin_on_hand
        FROM "itemLedger"
        WHERE "itemId" = v_material."itemId"
          AND "storageUnitId" = v_material_storage_unit_id
          AND "locationId" = v_job_location_id
          AND "companyId" = p_company_id
          AND "trackedEntityId" IS NULL
          AND COALESCE("projectId", '') = ANY(v_stripe_keys);

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
        AND COALESCE("projectId", '') = ANY(v_stripe_keys)
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
          AND "trackedEntityId" IS NULL
          AND COALESCE("projectId", '') = ANY(v_stripe_keys);

        v_material_qty_to_issue := LEAST(v_material_qty_to_issue, GREATEST(v_bin_on_hand, 0));

        IF v_material_qty_to_issue <= 0 THEN
          CONTINUE;
        END IF;
      END IF;
    END IF;
    v_issue_total := v_material_qty_to_issue;
    END IF;

    -- One Consumption row per stripe drawn. A stripe before the last takes
    -- at most its untracked on-hand at the bin; the last stripe takes the rest.
    IF v_material_qty_to_issue > 0 THEN
      v_left_to_draw := v_material_qty_to_issue;
      FOR v_stripe_index IN 1..array_length(v_stripes, 1)
      LOOP
        EXIT WHEN v_left_to_draw <= 0;
        v_stripe := v_stripes[v_stripe_index];

        IF v_stripe_index < array_length(v_stripes, 1) THEN
          SELECT COALESCE(SUM(quantity), 0) INTO v_stripe_on_hand
          FROM "itemLedger"
          WHERE "itemId" = v_material."itemId"
            AND "locationId" = v_job_location_id
            AND "companyId" = p_company_id
            AND "storageUnitId" IS NOT DISTINCT FROM v_material_storage_unit_id
            AND "trackedEntityId" IS NULL
            AND "projectId" IS NOT DISTINCT FROM v_stripe;

          v_stripe_draw := LEAST(v_left_to_draw, GREATEST(v_stripe_on_hand, 0));
        ELSE
          v_stripe_draw := v_left_to_draw;
        END IF;

        CONTINUE WHEN v_stripe_draw <= 0;

        INSERT INTO "itemLedger" (
          "entryType", "documentType", "documentId", "companyId",
          "itemId", quantity, "locationId", "storageUnitId", "projectId", "createdBy"
        ) VALUES (
          'Consumption', 'Job Consumption', p_job_id, p_company_id,
          v_material."itemId", -v_stripe_draw,
          v_job_location_id, v_material_storage_unit_id, v_stripe, p_user_id
        );

        v_bf_item_ids := v_bf_item_ids || v_material."itemId";
        v_bf_quantities := v_bf_quantities || v_stripe_draw;
        v_bf_storage_unit_ids := v_bf_storage_unit_ids || COALESCE(v_material_storage_unit_id, '');
        v_bf_project_ids := array_append(v_bf_project_ids, v_stripe);

        v_left_to_draw := v_left_to_draw - v_stripe_draw;
      END LOOP;
    END IF;

    UPDATE "jobMaterial"
    SET "quantityIssued" = COALESCE("quantityIssued", 0) + v_issue_total
    WHERE id = v_material.id;
  END LOOP;

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
          -- only the stripe this row drew (calculateCOGS projectId)
          AND "projectId" IS NOT DISTINCT FROM v_bf_project_ids[i]
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

      -- The projectLedger rows are written after the inventory credit line,
      -- which a draw of stock charged at receipt points at.
      v_bf_wip_jl_id := v_bf_jl_id;
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

    IF v_consume_to_project OR v_capital_job THEN
      -- Charge at receipt (C2): the units of the project's own stock that its
      -- receipts charged and no issue has moved yet are already the project's
      -- cost. They write the zero-net relocation pair (Project WIP debit,
      -- inventory credit); the rest of the draw writes the ordinary row. The
      -- function re-reads the ledger, so an earlier row of this loop counts.
      v_bf_charged_qty := 0;
      IF v_project_id IS NOT NULL
         AND v_bf_project_ids[i] IS NOT DISTINCT FROM v_project_id THEN
        SELECT COALESCE(SUM(q."onShelfQuantity"), 0)
        INTO v_bf_on_shelf
        FROM project_receipt_charge_quantities(
          p_company_id, ARRAY[v_project_id], ARRAY[v_bf_item_ids[i]]
        ) q;
        v_bf_charged_qty := LEAST(v_bf_quantities[i], GREATEST(v_bf_on_shelf, 0));
      END IF;
      v_bf_charged_cost := CASE
        WHEN v_bf_quantities[i] > 0
          THEN ROUND(v_material_cogs_total * v_bf_charged_qty / v_bf_quantities[i], 5)
        ELSE 0
      END;

      IF v_bf_charged_qty > 0 THEN
        INSERT INTO "projectLedger" (
          "companyId", "projectId", "projectElementId", "postingDate", "costType",
          "documentType", "documentId", "jobId", "itemId", quantity, amount,
          "journalLineId", "relocatesReceiptCharge", "createdBy"
        ) VALUES
          (
            p_company_id, v_project_id, v_project_element_id, v_company_today, 'Material',
            'Job Consumption', p_job_id, p_job_id, v_bf_item_ids[i],
            ROUND(v_bf_charged_qty, 5), v_bf_charged_cost,
            v_bf_wip_jl_id, TRUE, p_user_id
          ),
          (
            p_company_id, v_project_id, v_project_element_id, v_company_today, 'Material',
            'Job Consumption', p_job_id, p_job_id, v_bf_item_ids[i],
            -ROUND(v_bf_charged_qty, 5), -v_bf_charged_cost,
            v_bf_jl_id, TRUE, p_user_id
          );
      END IF;

      IF v_bf_quantities[i] - v_bf_charged_qty > 0 THEN
        INSERT INTO "projectLedger" (
          "companyId", "projectId", "projectElementId", "postingDate", "costType",
          "documentType", "documentId", "jobId", "itemId", quantity, amount,
          "journalLineId", "createdBy"
        ) VALUES (
          p_company_id, v_project_id, v_project_element_id, v_company_today, 'Material',
          'Job Consumption', p_job_id, p_job_id, v_bf_item_ids[i],
          ROUND(v_bf_quantities[i] - v_bf_charged_qty, 5),
          ROUND(v_material_cogs_total, 5) - v_bf_charged_cost,
          v_bf_wip_jl_id, p_user_id
        );
      END IF;
    END IF;

    -- Cost ledger entry for consumption
    INSERT INTO "costLedger" (
      "itemLedgerType", "costLedgerType", adjustment,
      "documentType", "documentId", "itemId",
      quantity, cost, "remainingQuantity", "projectId", "companyId"
    ) VALUES (
      'Consumption', 'Direct Cost', false,
      'Job Consumption', p_job_id, v_bf_item_ids[i],
      -v_bf_quantities[i], -v_material_cogs_total,
      0, v_bf_project_ids[i], p_company_id
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
