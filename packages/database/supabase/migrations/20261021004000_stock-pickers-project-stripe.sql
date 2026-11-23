-- Project stock (Projects Phase 2a): the bin and lot pickers read stock by stripe.
--
-- A stripe is "itemLedger"."projectId": a project id for that project's stock,
-- NULL for common stock. A stripe set is a TEXT[] in draw order, where a NULL
-- element is common stock. "x" = ANY(array) never matches NULL, so each filter
-- compares COALESCE("projectId", '') with the set mapped the same way.
--
-- 1. get_available_tracked_entities (forked from
--    20260709125411_available-tracked-entities-sort-method.sql) gains
--    p_project_ids, default common stock only. It returns one row per entity and
--    stripe, with "projectId".
-- 2. get_item_quantities_by_tracking_id (forked from
--    20260925121735_rpc-function-guards.sql) returns "projectId" and groups by
--    it. It has no stripe filter: its callers need every stripe.
-- 3. get_picking_list_availability (forked from 20260730143512_picking-supersession.sql)
--    counts the on-hand of each line's own stripe ("pickingListLine"."projectId").
-- 4. get_picking_list_tracked_available (forked from
--    20260617142853_picking-list-tracked-available.sql) lists entities of the
--    stripes the list's lines draw, with "projectId", so a caller assigns an
--    entity only to a line of its stripe.
--
-- With no project stock every row is common, so each function returns the rows
-- it returned before, plus a NULL "projectId" where the return type gains it.
-- Each signature or return type changes, so each function is dropped first.
-- Each keeps its SECURITY setting.

-- ============================================================================
-- 1. get_available_tracked_entities
-- ============================================================================
DROP FUNCTION IF EXISTS get_available_tracked_entities(
  TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT
);

CREATE OR REPLACE FUNCTION get_available_tracked_entities(
  p_item_id TEXT,
  p_company_id TEXT,
  p_location_id TEXT,
  p_exclude_lineside BOOLEAN DEFAULT false,
  p_exclude_allocated BOOLEAN DEFAULT false,
  p_exclude_line_id TEXT DEFAULT NULL,
  p_sort_method TEXT DEFAULT 'Default',
  p_project_ids TEXT[] DEFAULT ARRAY[NULL]::TEXT[]
)
RETURNS TABLE (
  "trackedEntityId" TEXT,
  "readableId" TEXT,
  "storageUnitId" TEXT,
  "storageUnitName" TEXT,
  "availableQuantity" NUMERIC,
  "createdAt" TIMESTAMPTZ,
  "expirationDate" DATE,
  "status" TEXT,
  "projectId" TEXT
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
      s."name" AS storage_unit_name,
      SUM(il."quantity") AS on_hand
    FROM "itemLedger" il
    LEFT JOIN "storageUnit" s ON s."id" = il."storageUnitId"
    WHERE il."itemId" = p_item_id
      AND il."companyId" = p_company_id
      AND il."locationId" = p_location_id
      AND il."trackedEntityId" IS NOT NULL
      AND COALESCE(il."projectId", '') = ANY (
        ARRAY(SELECT COALESCE(stripe, '') FROM unnest(COALESCE(p_project_ids, ARRAY[NULL]::TEXT[])) AS stripe)
      )
      AND (
        NOT p_exclude_lineside
        OR get_effective_work_center_id(il."storageUnitId") IS NULL
      )
    GROUP BY il."trackedEntityId", il."projectId", il."storageUnitId", s."name"
    HAVING SUM(il."quantity") > 0
  ),
  entity_total AS (
    SELECT "trackedEntityId", "projectId", SUM(on_hand) AS total_on_hand
    FROM bin_onhand
    GROUP BY "trackedEntityId", "projectId"
  ),
  primary_bin AS (
    SELECT DISTINCT ON ("trackedEntityId", "projectId")
      "trackedEntityId", "projectId", "storageUnitId", storage_unit_name
    FROM bin_onhand
    ORDER BY "trackedEntityId", "projectId", on_hand DESC
  ),
  allocated AS (
    SELECT pllte."trackedEntityId", SUM(pllte."quantity") AS allocated_qty
    FROM "pickingListLineTrackedEntity" pllte
    JOIN "pickingListLine" pll ON pll."id" = pllte."pickingListLineId"
    JOIN "pickingList" pl ON pl."id" = pll."pickingListId"
    WHERE pl."status" <> 'Cancelled'
      AND pll."status" <> 'Cancelled'
      AND (p_exclude_line_id IS NULL OR pll."id" <> p_exclude_line_id)
    GROUP BY pllte."trackedEntityId"
  )
  SELECT
    et."trackedEntityId",
    te."readableId",
    pb."storageUnitId",
    pb.storage_unit_name AS "storageUnitName",
    et.total_on_hand
      - CASE WHEN p_exclude_allocated THEN COALESCE(a.allocated_qty, 0) ELSE 0 END
      AS "availableQuantity",
    te."createdAt",
    te."expirationDate",
    te."status",
    et."projectId"
  FROM entity_total et
  JOIN "trackedEntity" te ON te."id" = et."trackedEntityId"
  JOIN primary_bin pb
    ON pb."trackedEntityId" = et."trackedEntityId"
   AND pb."projectId" IS NOT DISTINCT FROM et."projectId"
  LEFT JOIN allocated a ON a."trackedEntityId" = et."trackedEntityId"
  WHERE te."status" = 'Available'
    AND (
      et.total_on_hand
        - CASE WHEN p_exclude_allocated THEN COALESCE(a.allocated_qty, 0) ELSE 0 END
    ) > 0
  ORDER BY
    CASE WHEN COALESCE(p_sort_method, 'Default') IN ('Default', 'FEFO')
         THEN te."expirationDate" END ASC NULLS LAST,
    CASE WHEN COALESCE(p_sort_method, 'Default') = 'LIFO'
         THEN te."createdAt" END DESC,
    te."createdAt" ASC;
$$;

-- ============================================================================
-- 2. get_item_quantities_by_tracking_id
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_item_quantities_by_tracking_id(text, text, text);

CREATE OR REPLACE FUNCTION public.get_item_quantities_by_tracking_id(item_id text, company_id text, location_id text)
 RETURNS TABLE("itemId" text, "storageUnitId" text, "storageUnitName" text, "trackedEntityId" text, "readableId" text, quantity numeric, "projectId" text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
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
    SUM(il."quantity") AS "quantity",
    il."projectId"
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
    te."readableId",
    il."projectId";
END;
$function$;

-- ============================================================================
-- 3. get_picking_list_availability
-- ============================================================================
CREATE OR REPLACE FUNCTION get_picking_list_availability(p_picking_list_id TEXT)
RETURNS TABLE (
  "pickingListLineId" TEXT,
  "availableQuantity" NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    pll."id" AS "pickingListLineId",
    -- Warehouse (non-lineside) on-hand of the line's OWN pick item — exactly what
    -- this line consumes. A supersession redirect is already resolved at
    -- generation time (a substituted line's "itemId" is the effective successor),
    -- so availability reflects the real pick item without any fold-in.
    --
    -- We deliberately do NOT add a successor's on-hand to a line still targeting
    -- the predecessor: with no line-splitting, such a line consumes the
    -- PREDECESSOR, so folding in successor stock would (a) mask a genuine
    -- predecessor shortage (suppressing the "No Stock" warning while the line
    -- cannot actually be covered) and (b) double-count the successor's stock when
    -- the same list also carries a separate line for that successor item.
    --
    -- Only the line's own stripe counts: a line stamped with a project draws
    -- that project's stock, and a line with no project draws common stock.
    COALESCE((
      SELECT SUM(il."quantity")
      FROM "itemLedger" il
      WHERE il."itemId" = pll."itemId"
        AND il."companyId" = pl."companyId"
        AND il."locationId" = pl."locationId"
        AND il."projectId" IS NOT DISTINCT FROM pll."projectId"
        AND get_effective_work_center_id(il."storageUnitId") IS NULL
    ), 0) AS "availableQuantity"
  FROM "pickingListLine" pll
  JOIN "pickingList" pl ON pl."id" = pll."pickingListId"
  WHERE pll."pickingListId" = p_picking_list_id;
$$;

-- ============================================================================
-- 4. get_picking_list_tracked_available
-- ============================================================================
DROP FUNCTION IF EXISTS get_picking_list_tracked_available(TEXT);

CREATE OR REPLACE FUNCTION get_picking_list_tracked_available(p_picking_list_id TEXT)
RETURNS TABLE (
  "itemId" TEXT,
  "trackedEntityId" TEXT,
  "readableId" TEXT,
  "storageUnitId" TEXT,
  "storageUnitName" TEXT,
  "availableQuantity" NUMERIC,
  "createdAt" TIMESTAMPTZ,
  "expirationDate" DATE,
  "projectId" TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH pl AS (
    SELECT "id", "companyId", "locationId"
    FROM "pickingList"
    WHERE "id" = p_picking_list_id
  ),
  -- Each item with each stripe its lines draw ('' = common).
  list_items AS (
    SELECT DISTINCT pll."itemId", COALESCE(pll."projectId", '') AS stripe
    FROM "pickingListLine" pll
    WHERE pll."pickingListId" = p_picking_list_id
      AND pll."status" <> 'Cancelled'
  ),
  bin_onhand AS (
    SELECT
      il."itemId",
      il."trackedEntityId",
      il."projectId",
      il."storageUnitId",
      s."name" AS storage_unit_name,
      SUM(il."quantity") AS on_hand
    FROM "itemLedger" il
    JOIN pl ON il."companyId" = pl."companyId" AND il."locationId" = pl."locationId"
    JOIN list_items li
      ON li."itemId" = il."itemId"
     AND li.stripe = COALESCE(il."projectId", '')
    LEFT JOIN "storageUnit" s ON s."id" = il."storageUnitId"
    WHERE il."trackedEntityId" IS NOT NULL
      AND get_effective_work_center_id(il."storageUnitId") IS NULL
    GROUP BY il."itemId", il."trackedEntityId", il."projectId", il."storageUnitId", s."name"
    HAVING SUM(il."quantity") > 0
  ),
  entity_total AS (
    SELECT "itemId", "trackedEntityId", "projectId", SUM(on_hand) AS total_on_hand
    FROM bin_onhand
    GROUP BY "itemId", "trackedEntityId", "projectId"
  ),
  primary_bin AS (
    SELECT DISTINCT ON ("trackedEntityId", "projectId")
      "trackedEntityId", "projectId", "storageUnitId", storage_unit_name
    FROM bin_onhand
    ORDER BY "trackedEntityId", "projectId", on_hand DESC
  ),
  allocated AS (
    SELECT pllte."trackedEntityId", SUM(pllte."quantity") AS allocated_qty
    FROM "pickingListLineTrackedEntity" pllte
    JOIN "pickingListLine" pll ON pll."id" = pllte."pickingListLineId"
    JOIN "pickingList" pl2 ON pl2."id" = pll."pickingListId"
    WHERE pl2."status" <> 'Cancelled'
      AND pll."status" <> 'Cancelled'
    GROUP BY pllte."trackedEntityId"
  )
  SELECT
    et."itemId",
    et."trackedEntityId",
    te."readableId",
    pb."storageUnitId",
    pb.storage_unit_name AS "storageUnitName",
    et.total_on_hand - COALESCE(a.allocated_qty, 0) AS "availableQuantity",
    te."createdAt",
    te."expirationDate",
    et."projectId"
  FROM entity_total et
  JOIN "trackedEntity" te ON te."id" = et."trackedEntityId"
  JOIN primary_bin pb
    ON pb."trackedEntityId" = et."trackedEntityId"
   AND pb."projectId" IS NOT DISTINCT FROM et."projectId"
  CROSS JOIN pl
  LEFT JOIN "pickMethod" pm
    ON pm."itemId" = et."itemId"
   AND pm."locationId" = pl."locationId"
   AND pm."companyId" = pl."companyId"
  LEFT JOIN allocated a ON a."trackedEntityId" = et."trackedEntityId"
  WHERE te."status" = 'Available'
    AND (et.total_on_hand - COALESCE(a.allocated_qty, 0)) > 0
  ORDER BY
    et."itemId",
    CASE
      WHEN COALESCE(pm."sortMethod", 'Default') IN ('Default', 'FEFO')
      THEN te."expirationDate"
    END ASC NULLS LAST,
    CASE
      WHEN COALESCE(pm."sortMethod", 'Default') = 'LIFO'
      THEN te."createdAt"
    END DESC,
    te."createdAt" ASC;
$$;

NOTIFY pgrst, 'reload schema';
