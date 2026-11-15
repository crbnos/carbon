-- Current warehouse stock by bin for each line of one picking list. A line's
-- saved source bin is only the suggestion made when the list was created.
CREATE OR REPLACE FUNCTION get_picking_list_live_bins(
  p_company_id TEXT,
  p_picking_list_id TEXT
)
RETURNS TABLE (
  "pickingListLineId" TEXT,
  "storageUnitId" TEXT,
  "storageUnitName" TEXT,
  quantity NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH list AS (
    SELECT "id", "companyId", "locationId"
    FROM "pickingList"
    WHERE "id" = p_picking_list_id
      AND "companyId" = p_company_id
  ),
  lines AS (
    SELECT pll."id", pll."itemId", pll."projectId"
    FROM "pickingListLine" pll
    JOIN list ON list."id" = pll."pickingListId"
    WHERE pll."status" <> 'Cancelled'
  ),
  line_items AS (
    SELECT DISTINCT "itemId", "projectId" FROM lines
  ),
  bins AS (
    SELECT
      il."itemId",
      il."projectId",
      il."storageUnitId",
      su."name" AS "storageUnitName",
      SUM(il."quantity") AS quantity
    FROM "itemLedger" il
    JOIN list
      ON list."companyId" = il."companyId"
     AND list."locationId" = il."locationId"
    JOIN line_items li
      ON li."itemId" = il."itemId"
     AND li."projectId" IS NOT DISTINCT FROM il."projectId"
    LEFT JOIN "storageUnit" su
      ON su."id" = il."storageUnitId"
     AND su."companyId" = il."companyId"
    LEFT JOIN "trackedEntity" te
      ON te."id" = il."trackedEntityId"
     AND te."companyId" = il."companyId"
    WHERE get_effective_work_center_id(il."storageUnitId") IS NULL
      AND storage_unit_is_nettable(il."storageUnitId")
      AND (il."trackedEntityId" IS NULL OR te."status" = 'Available')
    GROUP BY il."itemId", il."projectId", il."storageUnitId", su."name"
    HAVING SUM(il."quantity") > 0
  )
  SELECT
    lines."id" AS "pickingListLineId",
    bins."storageUnitId",
    bins."storageUnitName",
    bins.quantity
  FROM lines
  JOIN bins
    ON bins."itemId" = lines."itemId"
   AND bins."projectId" IS NOT DISTINCT FROM lines."projectId"
  ORDER BY lines."id", bins.quantity DESC, bins."storageUnitName";
$$;

-- Issue pickers can include every revision of a material. Read their available
-- tracked stock together instead of calling get_available_tracked_entities once
-- per revision. Keep that function's stripe, nettable-bin, and primary-bin rules.
CREATE OR REPLACE FUNCTION get_issue_tracked_entity_stock(
  p_company_id TEXT,
  p_location_id TEXT,
  p_item_ids TEXT[],
  p_project_ids TEXT[] DEFAULT ARRAY[NULL]::TEXT[]
)
RETURNS TABLE (
  "trackedEntityId" TEXT,
  "storageUnitName" TEXT,
  "availableQuantity" NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH bin_onhand AS (
    SELECT
      il."trackedEntityId",
      il."projectId",
      il."storageUnitId",
      su."name" AS storage_unit_name,
      SUM(il."quantity") AS on_hand
    FROM "itemLedger" il
    LEFT JOIN "storageUnit" su
      ON su."id" = il."storageUnitId"
     AND su."companyId" = il."companyId"
    WHERE il."companyId" = p_company_id
      AND il."locationId" = p_location_id
      AND il."itemId" = ANY(p_item_ids)
      AND il."trackedEntityId" IS NOT NULL
      AND COALESCE(il."projectId", '') = ANY (
        ARRAY(SELECT COALESCE(stripe, '') FROM unnest(COALESCE(p_project_ids, ARRAY[NULL]::TEXT[])) AS stripe)
      )
      AND storage_unit_is_nettable(il."storageUnitId")
    GROUP BY il."trackedEntityId", il."projectId", il."storageUnitId", su."name"
    HAVING SUM(il."quantity") > 0
  ),
  entity_total AS (
    SELECT "trackedEntityId", "projectId", SUM(on_hand) AS total_on_hand
    FROM bin_onhand
    GROUP BY "trackedEntityId", "projectId"
  ),
  primary_bin AS (
    SELECT DISTINCT ON ("trackedEntityId", "projectId")
      "trackedEntityId", "projectId", storage_unit_name
    FROM bin_onhand
    ORDER BY "trackedEntityId", "projectId", on_hand DESC
  )
  SELECT
    et."trackedEntityId",
    pb.storage_unit_name AS "storageUnitName",
    et.total_on_hand AS "availableQuantity"
  FROM entity_total et
  JOIN "trackedEntity" te
    ON te."id" = et."trackedEntityId"
   AND te."companyId" = p_company_id
  JOIN primary_bin pb
    ON pb."trackedEntityId" = et."trackedEntityId"
   AND pb."projectId" IS NOT DISTINCT FROM et."projectId"
  WHERE te."status" = 'Available';
$$;

-- One read for the bins of every material on a job. Warehouse stock is
-- positive per eligible stripe; picked lineside stock belongs to this job.
CREATE OR REPLACE FUNCTION get_job_issue_bins(
  p_company_id TEXT,
  p_job_id TEXT,
  p_item_ids TEXT[]
)
RETURNS TABLE (
  "itemId" TEXT,
  "storageUnitId" TEXT,
  "storageUnitName" TEXT,
  quantity NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH target_job AS (
    SELECT j."id", j."companyId", j."locationId", j."projectId",
      COALESCE(p."projectStock", false) AS project_stock
    FROM "job" j
    LEFT JOIN "project" p
      ON p."id" = j."projectId" AND p."companyId" = j."companyId"
    WHERE j."id" = p_job_id AND j."companyId" = p_company_id
  ),
  stock_by_stripe AS (
    SELECT il."itemId", il."projectId", il."storageUnitId",
      su."name" AS "storageUnitName", SUM(il."quantity") AS quantity
    FROM "itemLedger" il
    JOIN target_job j
      ON j."companyId" = il."companyId"
     AND j."locationId" = il."locationId"
    LEFT JOIN "storageUnit" su
      ON su."id" = il."storageUnitId" AND su."companyId" = il."companyId"
    LEFT JOIN "trackedEntity" te
      ON te."id" = il."trackedEntityId" AND te."companyId" = il."companyId"
    WHERE il."itemId" = ANY(p_item_ids)
      AND (
        il."projectId" IS NULL
        OR (j.project_stock AND il."projectId" = j."projectId")
      )
      AND (il."trackedEntityId" IS NULL OR te."status" = 'Available')
    GROUP BY il."itemId", il."projectId", il."storageUnitId", su."name"
    HAVING SUM(il."quantity") > 0
  ),
  picked AS (
    SELECT pll."itemId", pll."projectId", pll."toStorageUnitId",
      SUM(GREATEST(0, COALESCE(pll."quantityPicked", 0)
        - COALESCE(pll."quantityReturned", 0))) AS staged
    FROM "pickingListLine" pll
    JOIN "pickingList" pl
      ON pl."id" = pll."pickingListId" AND pl."companyId" = pll."companyId"
    JOIN target_job j
      ON j."id" = pll."jobId" AND j."companyId" = pll."companyId"
    WHERE pll."itemId" = ANY(p_item_ids)
      AND pll."toStorageUnitId" IS NOT NULL
      AND pll."status" <> 'Cancelled'
      AND pl."status" <> 'Cancelled'
    GROUP BY pll."itemId", pll."projectId", pll."toStorageUnitId"
    HAVING SUM(GREATEST(0, COALESCE(pll."quantityPicked", 0)
      - COALESCE(pll."quantityReturned", 0))) > 0
  ),
  consumed AS (
    SELECT il."itemId", il."projectId", il."storageUnitId",
      GREATEST(0, -SUM(il."quantity")) AS quantity
    FROM "itemLedger" il
    JOIN target_job j
      ON j."id" = il."documentId"
     AND j."companyId" = il."companyId"
     AND j."locationId" = il."locationId"
    WHERE il."itemId" = ANY(p_item_ids)
      AND il."documentType" = 'Job Consumption'
    GROUP BY il."itemId", il."projectId", il."storageUnitId"
  ),
  visible AS (
    SELECT s."itemId", s."storageUnitId", s."storageUnitName",
      CASE WHEN get_effective_work_center_id(s."storageUnitId") IS NULL
        THEN s.quantity
        ELSE LEAST(s.quantity, GREATEST(0, p.staged - COALESCE(c.quantity, 0)))
      END AS quantity
    FROM stock_by_stripe s
    LEFT JOIN picked p
      ON p."itemId" = s."itemId"
     AND p."projectId" IS NOT DISTINCT FROM s."projectId"
     AND p."toStorageUnitId" = s."storageUnitId"
    LEFT JOIN consumed c
      ON c."itemId" = s."itemId"
     AND c."projectId" IS NOT DISTINCT FROM s."projectId"
     AND c."storageUnitId" IS NOT DISTINCT FROM s."storageUnitId"
    WHERE (
      get_effective_work_center_id(s."storageUnitId") IS NULL
      AND storage_unit_is_nettable(s."storageUnitId")
    ) OR p.staged > COALESCE(c.quantity, 0)
  )
  SELECT "itemId", "storageUnitId", "storageUnitName", SUM(quantity) AS quantity
  FROM visible
  WHERE quantity > 0
  GROUP BY "itemId", "storageUnitId", "storageUnitName"
  ORDER BY "itemId", quantity DESC, "storageUnitName";
$$;
