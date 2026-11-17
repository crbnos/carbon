-- Line feed: where a part's stock is, whatever bin it is in.
--
-- get_line_feed_lanes named a place to grab a part only when a bin held it.
-- Stock received into no storage unit read "None on the shelf", and a Transfer
-- kanban's empty source bin read "Nothing ordered" while another bin was full.
--
-- The raw/source row changes (20261116150000_line-feed-lanes.sql is the body
-- this one starts from):
--
--   raw   source   one row per part a station consumes (open demand, the part
--                  of a Transfer kanban into the station, or a part of a kit
--                  it consumes), always. A bin under a lineside unit is
--                  lineside, never a source.
--                  "storageUnitId" = the item's default bin when it holds stock,
--                  else the fullest bin, else NULL: the stock is in no bin, or
--                  there is none. quantity = on hand there (0 for none).
--                  need = every usable unit at the location off the line,
--                  in any bin or none. replenishing = an open purchase order
--                  line or job.
--
-- Two rows are new. They give the board the order of the process:
--
--   flow  step     a work center a made item's routing runs at; "itemId" = the
--                  made item, quantity = the operation order, replenishing =
--                  an open job makes the item
--   flow  feed     a made item ("itemId") that the routing of
--                  "parentKitItemId" consumes at this work center; quantity =
--                  the operation order
--
-- Every other row is unchanged.

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
    INNER JOIN "item" i
      ON i."id" = jm."itemId"
      AND i."companyId" = p_company_id
    LEFT JOIN first_open_operation fo
      ON jm."jobOperationId" IS NULL
      AND fo."jobMakeMethodId" = jm."jobMakeMethodId"
    INNER JOIN open_operation oo
      ON oo."id" = COALESCE(jm."jobOperationId", fo."id")
      AND oo."jobId" = jm."jobId"
    WHERE jm."companyId" = p_company_id
      AND jm."methodType" = 'Pull from Inventory'
      AND i."itemTrackingType" <> 'Non-Inventory'
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
  -- Every part a station consumes: its open demand, the parts of the Transfer
  -- kanbans into it, and the parts of the kits it consumes.
  consumed AS (
    SELECT d."workCenterId", d."itemId" FROM demand d
    UNION
    SELECT s."workCenterId", s."itemId" FROM shelf s WHERE s."workCenterId" IS NOT NULL
    UNION
    SELECT k."workCenterId", s."itemId"
    FROM shelf s
    INNER JOIN kit k ON k."itemId" = s."kitItemId"
  ),
  -- The bins a part can be grabbed from: active, nettable, not a kit rack and
  -- not lineside. A child of a lineside unit is lineside too.
  warehouse_unit AS (
    SELECT su."id"
    FROM "storageUnit" su
    WHERE su."companyId" = p_company_id
      AND su."locationId" = p_location_id
      AND su."active"
      AND su."effectiveNettable"
      AND NOT su."kitRack"
      AND get_effective_work_center_id(su."id") IS NULL
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
  -- Unassigned, nettable stock off the line: in a bin, or in no bin. A bin
  -- comes first. A kit has none: it comes from its rack.
  source AS (
    SELECT DISTINCT ON (held."itemId") held."itemId", held."storageUnitId", held."quantity"
    FROM (
      SELECT il."itemId", il."storageUnitId", SUM(il."quantity") AS "quantity"
      FROM "itemLedger" il
      WHERE il."companyId" = p_company_id
        AND il."locationId" = p_location_id
        AND il."itemId" IN (SELECT c."itemId" FROM consumed c)
        AND il."projectId" IS NULL
        AND (il."trackedEntityStatus" IS NULL OR il."trackedEntityStatus" NOT IN ('Rejected', 'Scrapped'))
        AND (
          il."storageUnitId" IS NULL
          OR il."storageUnitId" IN (SELECT wu."id" FROM warehouse_unit wu)
        )
      GROUP BY il."itemId", il."storageUnitId"
      HAVING SUM(il."quantity") > 0
    ) held
    LEFT JOIN "pickMethod" pm
      ON pm."itemId" = held."itemId"
      AND pm."locationId" = p_location_id
      AND pm."companyId" = p_company_id
    ORDER BY held."itemId",
      (held."storageUnitId" IS NULL),
      (pm."defaultStorageUnitId" = held."storageUnitId") DESC NULLS LAST,
      held."quantity" DESC,
      held."storageUnitId"
  ),
  -- Every usable unit of a consumed part at the location off the line: the
  -- bins a source can be, summed.
  site_stock AS (
    SELECT il."itemId", SUM(il."quantity") AS "quantity"
    FROM "itemLedger" il
    WHERE il."companyId" = p_company_id
      AND il."locationId" = p_location_id
      AND il."itemId" IN (SELECT c."itemId" FROM consumed c)
      AND il."projectId" IS NULL
      AND (il."trackedEntityStatus" IS NULL OR il."trackedEntityStatus" NOT IN ('Rejected', 'Scrapped'))
      AND (
        il."storageUnitId" IS NULL
        OR il."storageUnitId" IN (SELECT wu."id" FROM warehouse_unit wu)
      )
    GROUP BY il."itemId"
  ),
  -- The routing of each item made at the location: its newest make method's
  -- operations (activeMakeMethods' ranking), in order.
  routing AS (
    SELECT DISTINCT ON (m."itemId") m."id", m."itemId"
    FROM "makeMethod" m
    WHERE m."companyId" = p_company_id
      AND m."status" <> 'Archived'
    ORDER BY m."itemId", (m."status" = 'Active') DESC, m."version" DESC
  ),
  step AS (
    SELECT r."itemId", mo."id", mo."order", mo."workCenterId", mo."processId"
    FROM routing r
    INNER JOIN "methodOperation" mo ON mo."makeMethodId" = r."id"
  ),
  local_work_center AS (
    SELECT wc."id"
    FROM "workCenter" wc
    WHERE wc."companyId" = p_company_id
      AND wc."locationId" = p_location_id
      AND wc."active"
  ),
  -- A step runs at its operation's work center, and at every other work
  -- center of its process that the routing gives no step of its own (parallel
  -- stations).
  step_station AS (
    SELECT s."itemId", s."order", s."workCenterId"
    FROM step s
    WHERE s."workCenterId" IN (SELECT lw."id" FROM local_work_center lw)
    UNION
    SELECT s."itemId", s."order", wp."workCenterId"
    FROM step s
    INNER JOIN "workCenterProcess" wp
      ON wp."processId" = s."processId"
      AND wp."companyId" = p_company_id
    WHERE wp."workCenterId" IN (SELECT lw."id" FROM local_work_center lw)
      AND NOT EXISTS (
        SELECT 1 FROM step fixed
        WHERE fixed."itemId" = s."itemId" AND fixed."workCenterId" = wp."workCenterId"
      )
  ),
  -- The card that refills a rack slot (Make) or a shelf bin (Buy or Make). A
  -- card with no storage unit refills the item's default one, where its job or
  -- purchase order line lands.
  card AS (
    SELECT k."itemId",
      COALESCE(k."storageUnitId", pm."defaultStorageUnitId") AS "storageUnitId",
      MIN(k."id") AS "id",
      SUM(k."quantity") AS "quantity"
    FROM "kanban" k
    LEFT JOIN "pickMethod" pm
      ON pm."itemId" = k."itemId"
      AND pm."locationId" = k."locationId"
      AND pm."companyId" = k."companyId"
    WHERE k."companyId" = p_company_id
      AND k."locationId" = p_location_id
      AND k."replenishmentSystem" IN ('Buy', 'Make')
    GROUP BY k."itemId", COALESCE(k."storageUnitId", pm."defaultStorageUnitId")
  ),
  stocked_item AS (
    SELECT ki."itemId" FROM kit_item ki
    UNION
    SELECT s."itemId" FROM shelf s
    UNION
    SELECT c."itemId" FROM consumed c
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
  SELECT c."workCenterId", 'raw', 'source', c."itemId", NULL, src."storageUnitId", NULL,
    NULL, NULL, NULL, COALESCE(src."quantity", 0), COALESCE(ss."quantity", 0), NULL,
    i."itemId" IS NOT NULL
  FROM consumed c
  LEFT JOIN source src ON src."itemId" = c."itemId"
  LEFT JOIN site_stock ss ON ss."itemId" = c."itemId"
  LEFT JOIN inbound i ON i."itemId" = c."itemId"

  UNION ALL
  SELECT st."workCenterId", 'flow', 'step', st."itemId", NULL, NULL, NULL, NULL, NULL, NULL,
    MIN(st."order")::NUMERIC, NULL, NULL,
    EXISTS (
      SELECT 1 FROM "job" j
      WHERE j."companyId" = p_company_id
        AND j."locationId" = p_location_id
        AND j."itemId" = st."itemId"
        AND j."status" IN ('Ready', 'In Progress', 'Paused')
    )
  FROM step_station st
  GROUP BY st."workCenterId", st."itemId"

  UNION ALL
  -- A made item one of its parents' routings consumes: at the operation the
  -- material names, else at the parent's first step.
  SELECT feed."workCenterId", 'flow', 'feed', feed."itemId", feed."parentItemId", NULL, NULL,
    NULL, NULL, NULL, feed."order"::NUMERIC, NULL, NULL, NULL
  FROM (
    SELECT DISTINCT ON (mm."itemId", r."itemId")
      st."workCenterId", mm."itemId", r."itemId" AS "parentItemId", st."order"
    FROM routing r
    INNER JOIN "methodMaterial" mm ON mm."makeMethodId" = r."id"
    INNER JOIN step_station st
      ON st."itemId" = r."itemId"
      AND (mm."methodOperationId" IS NULL OR st."order" = (
        SELECT s."order" FROM step s WHERE s."id" = mm."methodOperationId"
      ))
    WHERE mm."itemId" IN (SELECT made."itemId" FROM step_station made)
      AND mm."itemId" <> r."itemId"
    ORDER BY mm."itemId", r."itemId", st."order", st."workCenterId"
  ) feed;
$$;
