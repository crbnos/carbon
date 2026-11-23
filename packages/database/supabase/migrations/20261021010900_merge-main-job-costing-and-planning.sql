-- Merge of origin/main into the projects branch: three functions that both
-- sides redefined. Each body below carries both changes.
--
-- 1. get_purchasing_planning. Main's 20261009181437_supplier-part-currency
--    reports each supplier's price as quoted ("supplierUnitPrice" and
--    "currencyCode"). The branch's 20261021004800_planning-rpcs-segment
--    returns one row per (item, segment), with "planningSegmentId". The body
--    is the branch's, with main's two supplier keys. The return type differs
--    from main's, so the function is dropped and created. The grid wrapper
--    get_purchasing_planning_grid does not change.
--
-- 2. complete_job_to_inventory and 3. backflush_job_materials. Main's
--    20261009010412_job-costing-always-post removes the accountingEnabled
--    early return: every company posts, and journal_posting_status() makes
--    each journal Provisional before the company's accounting cutover and
--    Posted after it. A Provisional journal has no accounting period and
--    creates none. The WIP sum reads Provisional, Posted and Reversed
--    journals. The branch's 20261021005500_complete-job-grouped adds the
--    project behavior (consume-to-project, capital jobs, project stock,
--    grouped jobs). Each body is the branch's, with main's changes only.
--    Each keeps its security mode: complete_job_to_inventory DEFINER,
--    backflush_job_materials INVOKER. The 'Posted' status of a
--    fixedAssetTransfer row is not a journal status and does not change.
--
-- Local databases that applied 20261021004800 before 20261009181437 must
-- drop get_purchasing_planning before `pnpm db:migrate` (see .ai/lessons.md).

-- ============================================================
-- 1. get_purchasing_planning
-- ============================================================
DROP FUNCTION IF EXISTS get_purchasing_planning(TEXT, TEXT, TEXT[]);
CREATE FUNCTION public.get_purchasing_planning(company_id text, location_id text, periods text[])
 RETURNS TABLE(id text, "planningSegmentId" text, "readableIdWithRevision" text, name text, active boolean, type "itemType", "itemTrackingType" "itemTrackingType", "replenishmentSystem" "itemReplenishmentSystem", "thumbnailPath" text, "unitOfMeasureCode" text, "leadTime" integer, "purchasingBlocked" boolean, "lotSize" integer, "reorderingPolicy" "itemReorderingPolicy", "demandAccumulationPeriod" integer, "demandAccumulationSafetyStock" numeric, "reorderPoint" integer, "reorderQuantity" integer, "minimumOrderQuantity" integer, "maximumOrderQuantity" integer, "orderMultiple" integer, "quantityOnHand" numeric, "maximumInventoryQuantity" numeric, suppliers jsonb, "preferredSupplierId" text, "purchasingUnitOfMeasureCode" text, "conversionFactor" numeric, "quantityToOrder" numeric, "supersessionMode" text, "minimumReserveQuantity" numeric, week1 numeric, week2 numeric, week3 numeric, week4 numeric, week5 numeric, week6 numeric, week7 numeric, week8 numeric, week9 numeric, week10 numeric, week11 numeric, week12 numeric, week13 numeric, week14 numeric, week15 numeric, week16 numeric, week17 numeric, week18 numeric, week19 numeric, week20 numeric, week21 numeric, week22 numeric, week23 numeric, week24 numeric, week25 numeric, week26 numeric, week27 numeric, week28 numeric, week29 numeric, week30 numeric, week31 numeric, week32 numeric, week33 numeric, week34 numeric, week35 numeric, week36 numeric, week37 numeric, week38 numeric, week39 numeric, week40 numeric, week41 numeric, week42 numeric, week43 numeric, week44 numeric, week45 numeric, week46 numeric, week47 numeric, week48 numeric, week49 numeric, week50 numeric, week51 numeric, week52 numeric)
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT assert_company_access(company_id);
  WITH RECURSIVE
  supply_data AS (
    SELECT
      combined."itemId",
      combined."planningSegmentId",
      combined."periodId",
      SUM(COALESCE(combined."actualQuantity", 0) + COALESCE(combined."forecastQuantity", 0)) AS "supply"
    FROM (
      SELECT sa."itemId", sa."planningSegmentId", sa."periodId", sa."actualQuantity", NULL as "forecastQuantity"
      FROM "supplyActual" sa
      WHERE sa."companyId" = company_id
        AND sa."locationId" = location_id
        AND sa."periodId" = ANY(periods)
      UNION ALL
      SELECT sf."itemId", sf."planningSegmentId", sf."periodId", NULL as "actualQuantity", sf."forecastQuantity"
      FROM "supplyForecast" sf
      WHERE sf."companyId" = company_id
        AND sf."locationId" = location_id
        AND sf."periodId" = ANY(periods)
    ) combined
    GROUP BY combined."itemId", combined."planningSegmentId", combined."periodId"
  ),
  demand_data AS (
    SELECT
      combined."itemId",
      combined."planningSegmentId",
      combined."periodId",
      SUM(COALESCE(combined."actualQuantity", 0) + COALESCE(combined."forecastQuantity", 0)) AS "demand"
    FROM (
      SELECT da."itemId", da."planningSegmentId", da."periodId", da."actualQuantity", NULL as "forecastQuantity"
      FROM "demandActual" da
      WHERE da."companyId" = company_id
        AND da."locationId" = location_id
        AND da."periodId" = ANY(periods)
      UNION ALL
      SELECT df."itemId", df."planningSegmentId", df."periodId", NULL as "actualQuantity", df."forecastQuantity"
      FROM "demandForecast" df
      WHERE df."companyId" = company_id
        AND df."locationId" = location_id
        AND df."periodId" = ANY(periods)
      UNION ALL
      -- Top-level manual projections, net of forecast consumption: actual
      -- demand consumed them during the MRP run (consumedQuantity), so only
      -- the unconsumed remainder still drives demand here. Without this arm a
      -- purchased item whose only demand is a projection never appears in
      -- purchasing planning and never drives a suggested order.
      -- Projections are common demand only.
      SELECT dp."itemId", ''::TEXT AS "planningSegmentId", dp."periodId", NULL as "actualQuantity",
             GREATEST(dp."forecastQuantity" - dp."consumedQuantity", 0) AS "forecastQuantity"
      FROM "demandProjection" dp
      WHERE dp."companyId" = company_id
        AND dp."locationId" = location_id
        AND dp."periodId" = ANY(periods)
    ) combined
    GROUP BY combined."itemId", combined."planningSegmentId", combined."periodId"
  ),
  base_items AS (
    SELECT DISTINCT ON (i."id", seg."planningSegmentId")
      i."id",
      seg."planningSegmentId",
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
      -- On-hand of the row's segment: project_planning_segment maps a stripe
      -- to its project when the project has project stock, else to ''. The
      -- CASE skips the project lookup for common rows (null projectId).
      COALESCE((
        SELECT SUM(il."quantity")
        FROM "itemLedger" il
        WHERE il."companyId" = company_id
          AND il."locationId" = location_id
          AND il."itemId" = i."id"
          AND CASE
                WHEN il."projectId" IS NULL THEN ''
                ELSE project_planning_segment(il."projectId")
              END = seg."planningSegmentId"
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
            'supplierUnitPrice', ps."supplierUnitPrice",
            'currencyCode', ps."currencyCode",
            'supplierId', ps."supplierId",
            'supplierPartId', ps."supplierPartId"
          )
        ) AS "suppliers"
      FROM "supplierPart" ps
      WHERE ps."companyId" = company_id
        AND ps.active = true
      GROUP BY ps."itemId"
    ) ps ON ps."itemId" = i."id"
    -- One row per segment: common always, plus each project segment with
    -- demand at this location.
    CROSS JOIN LATERAL (
      SELECT ''::TEXT AS "planningSegmentId"
      UNION
      SELECT d."planningSegmentId" FROM demand_data d WHERE d."itemId" = i."id"
    ) seg
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
            AND d."planningSegmentId" = seg."planningSegmentId"
        )
        -- Reorder policy is common only: project segments are lot-for-lot.
        OR (
          seg."planningSegmentId" = ''
          AND ip."reorderPoint" > 0
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
    LEFT JOIN supply_data s ON bi."id" = s."itemId" AND s."planningSegmentId" = bi."planningSegmentId" AND s."periodId" = periods[1]
    LEFT JOIN demand_data d ON bi."id" = d."itemId" AND d."planningSegmentId" = bi."planningSegmentId" AND d."periodId" = periods[1]

    UNION ALL

    SELECT
      p."id",
      p."planningSegmentId",
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
    LEFT JOIN supply_data s ON p."id" = s."itemId" AND s."planningSegmentId" = p."planningSegmentId" AND s."periodId" = periods[p.period_index + 1]
    LEFT JOIN demand_data d ON p."id" = d."itemId" AND d."planningSegmentId" = p."planningSegmentId" AND d."periodId" = periods[p.period_index + 1]
    WHERE p.period_index < array_length(periods, 1)
  ),
  order_quantities AS (
    SELECT
      p."id",
      p."planningSegmentId",
      CASE
        -- A project segment is lot-for-lot: order its whole shortfall.
        WHEN p."planningSegmentId" <> '' THEN GREATEST(0, -MIN(p."projection"))
        ELSE calculate_quantity_to_order(
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
      )
      END AS "quantityToOrder"
    FROM projections p
    GROUP BY
      p."id",
      p."planningSegmentId",
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
  SELECT DISTINCT ON (p."id", p."planningSegmentId")
    p."id",
    p."planningSegmentId",
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
      -- Supersession is common only.
      WHEN ss."supersessionMode" = 'Stock Only' AND p."planningSegmentId" = ''
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
  LEFT JOIN order_quantities oq ON p."id" = oq."id" AND oq."planningSegmentId" = p."planningSegmentId"
  LEFT JOIN "itemSupersession" ss ON ss."itemId" = p."id"
  LEFT JOIN "itemPlanning" rsv ON rsv."itemId" = p."id" AND rsv."locationId" = location_id
  LEFT JOIN (
    SELECT sd."itemId", sd."planningSegmentId", SUM(sd."supply") AS "incomingSupply"
    FROM supply_data sd GROUP BY sd."itemId", sd."planningSegmentId"
  ) sup ON sup."itemId" = p."id" AND sup."planningSegmentId" = p."planningSegmentId"
  GROUP BY
    p."id",
    p."planningSegmentId",
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
    sup."incomingSupply"
  ORDER BY p."id", p."planningSegmentId";
$function$;

-- ============================================================
-- 2. backflush_job_materials
-- ============================================================
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

    -- One Consumption row per stripe drawn. A stripe before the last takes
    -- at most its untracked on-hand at the bin; the last stripe takes the rest.
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

    UPDATE "jobMaterial"
    SET "quantityIssued" = COALESCE("quantityIssued", 0) + v_material_qty_to_issue
    WHERE id = v_material.id;
  END LOOP;

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


-- ============================================================
-- 3. complete_job_to_inventory
-- ============================================================
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
  v_company_today DATE := company_today(p_company_id);
  v_job_asset_class_id TEXT;
  v_job_asset_id TEXT;
  v_asset_target TEXT;
  v_target_class RECORD;
  v_asset_ids TEXT[] := '{}';
  v_transfer_ids TEXT[] := '{}';
  v_asset_unit_ids TEXT[];
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

      IF COALESCE(array_length(v_asset_unit_ids, 1), 0) < v_quantity_received_to_inventory THEN
        RAISE EXCEPTION 'Job % has % serial unit(s) left to capitalize, fewer than the % being completed',
          v_job_id_readable, COALESCE(array_length(v_asset_unit_ids, 1), 0), v_quantity_received_to_inventory;
      END IF;

      v_asset_unit_ids := v_asset_unit_ids[1:v_quantity_received_to_inventory::INTEGER];
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
      -- The units take the stripes in order.
      v_unit_offset := 0;
      FOR v_stripe_index IN 1..array_length(v_stripe_project_ids, 1) LOOP
        v_stripe_units := v_stripe_quantities[v_stripe_index]::INTEGER;
        CONTINUE WHEN v_stripe_units <= 0;

        WITH inserted AS (
          INSERT INTO "itemLedger" (
            "entryType", "documentType", "documentId", "companyId",
            "itemId", quantity, "locationId", "storageUnitId",
            "trackedEntityId", "projectId", "createdBy"
          )
          SELECT
            'Assembly Output', 'Job Receipt', p_job_id, p_company_id,
            v_item_id, 1, p_location_id, p_storage_unit_id,
            unit_id, v_stripe_project_ids[v_stripe_index], p_user_id
          FROM unnest(v_serial_unit_ids[v_unit_offset + 1:v_unit_offset + v_stripe_units]) AS unit_id
          RETURNING id
        )
        SELECT id INTO v_ledger_id FROM inserted LIMIT 1;

        IF v_stripe_peg_ids[v_stripe_index] IS NOT NULL THEN
          UPDATE "projectPeg" SET "itemLedgerId" = v_ledger_id
          WHERE id = v_stripe_peg_ids[v_stripe_index] AND "companyId" = p_company_id;
        END IF;

        v_unit_offset := v_unit_offset + v_stripe_units;
      END LOOP;

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

      UPDATE "trackedEntity"
      SET status = 'Available'
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

  -- Update pickMethod defaultStorageUnitId if needed
  IF v_item_tracking_type IS DISTINCT FROM 'Non-Inventory' AND v_asset_target IS NULL AND NOT v_consume_to_project AND p_storage_unit_id IS NOT NULL AND p_location_id IS NOT NULL THEN
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
            "documentType", "documentId", "jobId", "employeeId", quantity, amount,
            "journalLineId", "createdBy"
          ) VALUES (
            p_company_id, v_project_id, v_project_element_id, v_company_today, CASE WHEN v_event.type = 'Machine' THEN 'Machine' ELSE 'Labor' END::"projectCostType",
            'Production Event', v_event.id, p_job_id, v_event."employeeId",
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

  -- Calculate accumulated WIP cost for this job
  SELECT COALESCE(ABS(SUM(jl.amount)), 0)
  INTO v_accumulated_wip_cost
  FROM "journalLine" jl
  INNER JOIN journal j ON j.id = jl."journalId"
  WHERE jl."accountId" = v_wip_account
    AND jl."documentId" = p_job_id
    AND j."companyId" = p_company_id
    AND j."status" IN ('Provisional', 'Posted', 'Reversed');

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
        v_stripe_quantities[v_stripe_index], v_stripe_project_ids[v_stripe_index], p_company_id
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
$$;

