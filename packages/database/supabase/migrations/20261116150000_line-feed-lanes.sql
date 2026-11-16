-- Line feed lanes: raw shelf -> kit rack -> station.
-- Spec: .ai/specs/2026-11-16-line-feed-lanes.md

-- A storage unit that holds built kits. One unit per kit item gives each kit a
-- labeled slot on the rack. A kit item is an item whose default storage unit
-- (pickMethod) at the location is a kit rack.
ALTER TABLE "storageUnit" ADD COLUMN "kitRack" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "storageUnit" ADD CONSTRAINT "storageUnit_kitRack_not_lineside"
  CHECK (NOT ("kitRack" AND "workCenterId" IS NOT NULL));

-- The rack and shelf tiers of the line feed, one row per fact. Station
-- shortages, requests and transfers stay with get_line_feed_shortages.
--
--   tier      state        row
--   station   line         a work center with open operations; quantity = its lowest operation order
--   station   kit          a kit at the station; quantity on hand, by serial
--   kit       slot         a kit item the station consumes; need = open station demand,
--                          target = the Make kanban quantity at the slot
--   kit       complete     a kit on the rack; quantity on hand, by serial
--   kit       incomplete   an open kit job with unissued parts; quantity = kits still to build
--   kit       missing      an unissued part of that job; quantity missing
--   raw       bin          a shelf bin; quantity on hand, need = quantity per kit,
--                          target = the bin's kanban quantity
--   raw       source       where to grab a part the station consumes: the item's
--                          default bin when it holds stock, else the fullest bin;
--                          quantity on hand there
--
-- A raw bin with a "parentKitItemId" feeds that kit. Without one it is the
-- source of a Transfer kanban into the station (a part fed directly).
-- On hand leaves out Rejected and Scrapped tracked entities.
--
-- SECURITY INVOKER: the caller's RLS applies.
CREATE OR REPLACE FUNCTION get_line_feed_lanes(
  p_location_id TEXT,
  p_company_id TEXT
)
RETURNS TABLE (
  "workCenterId" TEXT,
  "tier" TEXT,
  "state" TEXT,
  "itemId" TEXT,
  "parentKitItemId" TEXT,
  "storageUnitId" TEXT,
  "jobId" TEXT,
  "trackedEntityId" TEXT,
  "kanbanId" TEXT,
  "readableId" TEXT,
  "quantity" NUMERIC,
  "need" NUMERIC,
  "target" NUMERIC,
  "replenishing" BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH station_bin AS (
    SELECT su."id", su."workCenterId"
    FROM "storageUnit" su
    WHERE su."companyId" = p_company_id
      AND su."locationId" = p_location_id
      AND su."workCenterId" IS NOT NULL
      AND su."active"
  ),
  open_operation AS (
    SELECT jo."id", jo."jobId", jo."jobMakeMethodId", jo."workCenterId", jo."order"
    FROM "jobOperation" jo
    INNER JOIN "job" j ON j."id" = jo."jobId" AND j."companyId" = p_company_id
    WHERE jo."companyId" = p_company_id
      AND j."locationId" = p_location_id
      AND j."status" IN ('Ready', 'In Progress', 'Paused')
      AND jo."status" NOT IN ('Done', 'Canceled')
  ),
  -- A material with no operation counts at the first open operation of its
  -- make method, the same rule as get_line_feed_shortages.
  first_open_operation AS (
    SELECT DISTINCT ON (oo."jobMakeMethodId") oo."jobMakeMethodId", oo."id"
    FROM open_operation oo
    WHERE oo."jobMakeMethodId" IS NOT NULL
    ORDER BY oo."jobMakeMethodId", oo."order", oo."id"
  ),
  demand AS (
    SELECT
      oo."workCenterId",
      jm."itemId",
      SUM(COALESCE(jm."estimatedQuantity", 0) - COALESCE(jm."quantityIssued", 0)) AS "quantity"
    FROM "jobMaterial" jm
    LEFT JOIN first_open_operation fo
      ON jm."jobOperationId" IS NULL
      AND fo."jobMakeMethodId" = jm."jobMakeMethodId"
    INNER JOIN open_operation oo
      ON oo."id" = COALESCE(jm."jobOperationId", fo."id")
      AND oo."jobId" = jm."jobId"
    WHERE jm."companyId" = p_company_id
      AND jm."methodType" = 'Pull from Inventory'
      AND COALESCE(jm."estimatedQuantity", 0) > COALESCE(jm."quantityIssued", 0)
      AND oo."workCenterId" IS NOT NULL
    GROUP BY oo."workCenterId", jm."itemId"
  ),
  kit AS (
    SELECT d."workCenterId", d."itemId", d."quantity" AS "need", pm."defaultStorageUnitId" AS "slotId"
    FROM demand d
    INNER JOIN "pickMethod" pm
      ON pm."itemId" = d."itemId"
      AND pm."locationId" = p_location_id
      AND pm."companyId" = p_company_id
    INNER JOIN "storageUnit" su ON su."id" = pm."defaultStorageUnitId" AND su."kitRack"
  ),
  kit_item AS (
    SELECT DISTINCT k."itemId" FROM kit k
  ),
  -- Usable kits wherever they sit, by serial.
  kit_stock AS (
    SELECT il."itemId", il."storageUnitId", il."trackedEntityId", SUM(il."quantity") AS "quantity"
    FROM "itemLedger" il
    WHERE il."companyId" = p_company_id
      AND il."locationId" = p_location_id
      AND il."itemId" IN (SELECT ki."itemId" FROM kit_item ki)
      AND il."storageUnitId" IS NOT NULL
      AND (il."trackedEntityStatus" IS NULL OR il."trackedEntityStatus" NOT IN ('Rejected', 'Scrapped'))
    GROUP BY il."itemId", il."storageUnitId", il."trackedEntityId"
    HAVING SUM(il."quantity") > 0
  ),
  kit_job AS (
    SELECT j."id", j."jobId" AS "readableId", j."itemId", j."storageUnitId",
      j."quantity" - j."quantityComplete" AS "quantity"
    FROM "job" j
    WHERE j."companyId" = p_company_id
      AND j."locationId" = p_location_id
      AND j."status" IN ('Ready', 'In Progress', 'Paused')
      AND j."itemId" IN (SELECT ki."itemId" FROM kit_item ki)
  ),
  missing AS (
    SELECT kj."id" AS "jobId", jm."itemId",
      SUM(COALESCE(jm."estimatedQuantity", 0) - COALESCE(jm."quantityIssued", 0)) AS "quantity"
    FROM kit_job kj
    INNER JOIN "jobMaterial" jm ON jm."jobId" = kj."id" AND jm."companyId" = p_company_id
    WHERE jm."methodType" = 'Pull from Inventory'
      AND COALESCE(jm."estimatedQuantity", 0) > COALESCE(jm."quantityIssued", 0)
    GROUP BY kj."id", jm."itemId"
  ),
  -- A kit's parts, from its active make method (activeMakeMethods' ranking).
  component AS (
    SELECT ki."itemId" AS "kitItemId", mm."itemId", SUM(mm."quantity") AS "perKit"
    FROM kit_item ki
    CROSS JOIN LATERAL (
      SELECT m."id"
      FROM "makeMethod" m
      WHERE m."itemId" = ki."itemId"
        AND m."companyId" = p_company_id
        AND m."status" <> 'Archived'
      ORDER BY (m."status" = 'Active') DESC, m."version" DESC
      LIMIT 1
    ) method
    INNER JOIN "methodMaterial" mm ON mm."makeMethodId" = method."id"
    WHERE mm."methodType" = 'Pull from Inventory'
    GROUP BY ki."itemId", mm."itemId"
  ),
  shelf AS (
    SELECT NULL::TEXT AS "workCenterId", c."kitItemId", c."itemId",
      pm."defaultStorageUnitId" AS "storageUnitId", c."perKit"
    FROM component c
    LEFT JOIN "pickMethod" pm
      ON pm."itemId" = c."itemId"
      AND pm."locationId" = p_location_id
      AND pm."companyId" = p_company_id
    UNION ALL
    SELECT sb."workCenterId", NULL, k."itemId", k."fromStorageUnitId", NULL
    FROM "kanban" k
    INNER JOIN station_bin sb ON sb."id" = k."storageUnitId"
    INNER JOIN "storageUnit" source ON source."id" = k."fromStorageUnitId" AND NOT source."kitRack"
    WHERE k."companyId" = p_company_id
      AND k."locationId" = p_location_id
      AND k."replenishmentSystem" = 'Transfer'
  ),
  shelf_stock AS (
    SELECT il."itemId", il."storageUnitId", SUM(il."quantity") AS "quantity"
    FROM "itemLedger" il
    WHERE il."companyId" = p_company_id
      AND il."locationId" = p_location_id
      AND (il."itemId", il."storageUnitId") IN (SELECT s."itemId", s."storageUnitId" FROM shelf s)
      AND (il."trackedEntityStatus" IS NULL OR il."trackedEntityStatus" NOT IN ('Rejected', 'Scrapped'))
    GROUP BY il."itemId", il."storageUnitId"
  ),
  -- Unassigned, nettable stock off the line. A kit has none: it comes from
  -- its rack.
  source AS (
    SELECT DISTINCT ON (held."itemId") held."itemId", held."storageUnitId", held."quantity"
    FROM (
      SELECT il."itemId", il."storageUnitId", SUM(il."quantity") AS "quantity"
      FROM "itemLedger" il
      INNER JOIN "storageUnit" su ON su."id" = il."storageUnitId"
      WHERE il."companyId" = p_company_id
        AND il."locationId" = p_location_id
        AND il."itemId" IN (SELECT d."itemId" FROM demand d)
        AND il."projectId" IS NULL
        AND (il."trackedEntityStatus" IS NULL OR il."trackedEntityStatus" NOT IN ('Rejected', 'Scrapped'))
        AND su."workCenterId" IS NULL
        AND NOT su."kitRack"
        AND su."effectiveNettable"
        AND su."active"
      GROUP BY il."itemId", il."storageUnitId"
      HAVING SUM(il."quantity") > 0
    ) held
    LEFT JOIN "pickMethod" pm
      ON pm."itemId" = held."itemId"
      AND pm."locationId" = p_location_id
      AND pm."companyId" = p_company_id
    ORDER BY held."itemId",
      (pm."defaultStorageUnitId" = held."storageUnitId") DESC NULLS LAST,
      held."quantity" DESC,
      held."storageUnitId"
  ),
  -- The card that refills a rack slot (Make) or a shelf bin (Buy or Make).
  card AS (
    SELECT k."itemId", k."storageUnitId", MIN(k."id") AS "id", SUM(k."quantity") AS "quantity"
    FROM "kanban" k
    WHERE k."companyId" = p_company_id
      AND k."locationId" = p_location_id
      AND k."replenishmentSystem" IN ('Buy', 'Make')
      AND k."storageUnitId" IS NOT NULL
    GROUP BY k."itemId", k."storageUnitId"
  ),
  stocked_item AS (
    SELECT ki."itemId" FROM kit_item ki
    UNION
    SELECT s."itemId" FROM shelf s
  ),
  -- Items with an open purchase order line or job at the location.
  inbound AS (
    SELECT pol."itemId"
    FROM "purchaseOrderLine" pol
    INNER JOIN "purchaseOrder" po ON po."id" = pol."purchaseOrderId"
    WHERE pol."companyId" = p_company_id
      AND pol."locationId" = p_location_id
      AND pol."itemId" IN (SELECT si."itemId" FROM stocked_item si)
      AND NOT pol."receivedComplete"
      AND po."status" IN ('Draft', 'Planned', 'To Review', 'Needs Approval', 'To Receive', 'To Receive and Invoice')
    UNION
    SELECT j."itemId"
    FROM "job" j
    WHERE j."companyId" = p_company_id
      AND j."locationId" = p_location_id
      AND j."itemId" IN (SELECT si."itemId" FROM stocked_item si)
      AND j."status" IN ('Draft', 'Planned', 'Ready', 'In Progress', 'Paused')
  )
  SELECT oo."workCenterId", 'station', 'line', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    MIN(oo."order")::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::BOOLEAN
  FROM open_operation oo
  WHERE oo."workCenterId" IS NOT NULL
  GROUP BY oo."workCenterId"

  UNION ALL
  SELECT sb."workCenterId", 'station', 'kit', ks."itemId", NULL, ks."storageUnitId", NULL,
    ks."trackedEntityId", NULL, te."readableId", ks."quantity", NULL, NULL, NULL
  FROM kit_stock ks
  INNER JOIN station_bin sb ON sb."id" = ks."storageUnitId"
  INNER JOIN kit k ON k."workCenterId" = sb."workCenterId" AND k."itemId" = ks."itemId"
  LEFT JOIN "trackedEntity" te ON te."id" = ks."trackedEntityId"

  UNION ALL
  SELECT k."workCenterId", 'kit', 'slot', k."itemId", NULL, k."slotId", NULL, NULL,
    c."id", NULL, NULL, k."need", c."quantity", i."itemId" IS NOT NULL
  FROM kit k
  LEFT JOIN card c ON c."itemId" = k."itemId" AND c."storageUnitId" = k."slotId"
  LEFT JOIN inbound i ON i."itemId" = k."itemId"

  UNION ALL
  SELECT k."workCenterId", 'kit', 'complete', ks."itemId", NULL, ks."storageUnitId", NULL,
    ks."trackedEntityId", NULL, te."readableId", ks."quantity", NULL, NULL, NULL
  FROM kit_stock ks
  INNER JOIN "storageUnit" su ON su."id" = ks."storageUnitId" AND su."kitRack"
  INNER JOIN kit k ON k."itemId" = ks."itemId"
  LEFT JOIN "trackedEntity" te ON te."id" = ks."trackedEntityId"

  UNION ALL
  SELECT k."workCenterId", 'kit', 'incomplete', kj."itemId", NULL, kj."storageUnitId", kj."id",
    NULL, NULL, kj."readableId", kj."quantity", NULL, NULL, NULL
  FROM kit_job kj
  INNER JOIN kit k ON k."itemId" = kj."itemId"
  WHERE EXISTS (SELECT 1 FROM missing m WHERE m."jobId" = kj."id")

  UNION ALL
  SELECT k."workCenterId", 'kit', 'missing', m."itemId", kj."itemId", NULL, m."jobId",
    NULL, NULL, NULL, m."quantity", NULL, NULL, NULL
  FROM missing m
  INNER JOIN kit_job kj ON kj."id" = m."jobId"
  INNER JOIN kit k ON k."itemId" = kj."itemId"

  UNION ALL
  SELECT COALESCE(s."workCenterId", k."workCenterId"), 'raw', 'bin', s."itemId", s."kitItemId",
    s."storageUnitId", NULL, NULL, c."id", NULL, GREATEST(COALESCE(ss."quantity", 0), 0),
    s."perKit", c."quantity", i."itemId" IS NOT NULL
  FROM shelf s
  LEFT JOIN kit k ON k."itemId" = s."kitItemId"
  LEFT JOIN shelf_stock ss ON ss."itemId" = s."itemId" AND ss."storageUnitId" = s."storageUnitId"
  LEFT JOIN card c ON c."itemId" = s."itemId" AND c."storageUnitId" = s."storageUnitId"
  LEFT JOIN inbound i ON i."itemId" = s."itemId"

  UNION ALL
  SELECT d."workCenterId", 'raw', 'source', src."itemId", NULL, src."storageUnitId", NULL,
    NULL, NULL, NULL, src."quantity", NULL, NULL, NULL
  FROM demand d
  INNER JOIN source src ON src."itemId" = d."itemId";
$$;
