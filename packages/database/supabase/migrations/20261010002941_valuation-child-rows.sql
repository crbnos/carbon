-- Field Service Phase C, decision C5: the inventory valuation report counts a
-- cost adjustment child as a layer of its own.
--
-- A child row (`adjustment = true`, `appliesToCostLedgerId` set) is a cost
-- correction on its parent layer: a purchase price variance, and from Phase C a
-- refurbishment revaluation or write-down. calculateCOGS consumes it with its
-- parent and never as a layer. The report's FIFO / LIFO carrying cost averaged
-- over every open row, so an open child added its remaining quantity to the
-- denominator: one layer of 10 units with one open child of 10 units averaged
-- over 20 units.
--
-- Now only base layers count. Each open child adds its remaining cost
-- (cost × remainingQuantity / quantity) to its parent, as calculateCOGS would
-- relieve it. Everything else is unchanged: the signature, SECURITY DEFINER,
-- the search path and assert_company_access.

CREATE OR REPLACE FUNCTION public.get_inventory_valuation(company_id text, as_of_date date DEFAULT NULL::date, location_id text DEFAULT NULL::text)
 RETURNS TABLE("locationId" text, "locationName" text, "itemId" text, "readableIdWithRevision" text, name text, "thumbnailPath" text, type "itemType", "replenishmentSystem" "itemReplenishmentSystem", "unitOfMeasureCode" text, "costingMethod" "itemCostingMethod", "quantityOnHand" numeric, "quantityOnHold" numeric, "quantityRejected" numeric, "unitCost" numeric, "totalValue" numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
DECLARE
  v_cutoff TIMESTAMPTZ;
  v_dated BOOLEAN := as_of_date IS NOT NULL AND as_of_date < CURRENT_DATE;
BEGIN
  PERFORM assert_company_access(company_id);

  SELECT MAX("snapshotCutoff") INTO v_cutoff
  FROM "itemLedgerSnapshot"
  WHERE "companyId" = company_id;

  RETURN QUERY
  WITH quantities AS (
    SELECT
      combined."itemId",
      combined."locationId",
      SUM(combined."quantity") AS "quantityOnHand",
      SUM(combined."onHold") AS "quantityOnHold",
      SUM(combined."rejected") AS "quantityRejected"
    FROM (
      -- Arm 1: snapshot (untracked, immutable). Skipped on dated queries —
      -- the snapshot has no postingDate grain.
      SELECT
        s."itemId",
        NULLIF(s."locationId", '') AS "locationId",
        s."quantity",
        0::NUMERIC AS "onHold",
        0::NUMERIC AS "rejected"
      FROM "itemLedgerSnapshot" s
      WHERE NOT v_dated
        AND s."companyId" = company_id
        AND (location_id IS NULL OR s."locationId" = location_id)

      UNION ALL

      -- Arm 2: tracked rows, always live (status flips in place).
      SELECT
        il."itemId",
        il."locationId",
        il."quantity",
        CASE WHEN il."trackedEntityStatus" = 'On Hold' THEN il."quantity" ELSE 0 END,
        CASE WHEN il."trackedEntityStatus" = 'Rejected' THEN il."quantity" ELSE 0 END
      FROM "itemLedger" il
      WHERE il."companyId" = company_id
        AND il."trackedEntityId" IS NOT NULL
        AND (location_id IS NULL OR il."locationId" = location_id)
        AND (NOT v_dated OR il."postingDate" <= as_of_date)

      UNION ALL

      -- Arm 3: untracked delta past the cutoff (current path) OR the full
      -- untracked history filtered by postingDate (dated path / no snapshot).
      SELECT
        il."itemId",
        il."locationId",
        il."quantity",
        0::NUMERIC,
        0::NUMERIC
      FROM "itemLedger" il
      WHERE il."companyId" = company_id
        AND il."trackedEntityId" IS NULL
        AND (location_id IS NULL OR il."locationId" = location_id)
        AND (v_dated OR v_cutoff IS NULL OR il."createdAt" >= v_cutoff)
        AND (NOT v_dated OR il."postingDate" <= as_of_date)
    ) combined
    GROUP BY combined."itemId", combined."locationId"
    HAVING SUM(combined."quantity") <> 0
  ),
  carrying AS (
    -- Company-level effective unit cost per item, by costing method.
    SELECT
      ic."itemId",
      ic."costingMethod",
      CASE ic."costingMethod"
        WHEN 'Standard' THEN ic."standardCost"
        WHEN 'Average' THEN ic."unitCost"
        ELSE COALESCE(layers."layerUnitCost", ic."unitCost")
      END AS "unitCost"
    FROM "itemCost" ic
    LEFT JOIN LATERAL (
      SELECT
        SUM(
          cl."remainingQuantity" * cl."cost" / NULLIF(cl."quantity", 0)
          + COALESCE(adj."remainingCost", 0)
        ) / NULLIF(SUM(cl."remainingQuantity"), 0) AS "layerUnitCost"
      FROM "costLedger" cl
      -- The open children of this layer: the cost calculateCOGS has yet to
      -- relieve with it.
      LEFT JOIN LATERAL (
        SELECT SUM(a."cost" * a."remainingQuantity" / NULLIF(a."quantity", 0)) AS "remainingCost"
        FROM "costLedger" a
        WHERE a."appliesToCostLedgerId" = cl."id"
          AND a."companyId" = cl."companyId"
          AND a."remainingQuantity" > 0
      ) adj ON TRUE
      WHERE cl."itemId" = ic."itemId"
        AND cl."companyId" = ic."companyId"
        AND cl."remainingQuantity" > 0
        -- Only base layers are layers; a child is costed with its parent.
        AND cl."adjustment" = false
        AND cl."appliesToCostLedgerId" IS NULL
    ) layers ON ic."costingMethod" IN ('FIFO', 'LIFO')
    WHERE ic."companyId" = company_id
  )
  SELECT
    l."id" AS "locationId",
    l."name" AS "locationName",
    i."id" AS "itemId",
    i."readableIdWithRevision",
    i."name",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      ELSE i."thumbnailPath"
    END AS "thumbnailPath",
    i."type",
    i."replenishmentSystem",
    i."unitOfMeasureCode",
    c."costingMethod",
    q."quantityOnHand",
    q."quantityOnHold",
    q."quantityRejected",
    COALESCE(c."unitCost", 0) AS "unitCost",
    q."quantityOnHand" * COALESCE(c."unitCost", 0) AS "totalValue"
  FROM quantities q
  INNER JOIN "item" i ON q."itemId" = i."id" AND i."companyId" = company_id
  INNER JOIN "location" l ON q."locationId" = l."id" AND l."companyId" = company_id
  LEFT JOIN "modelUpload" mu ON mu."id" = i."modelUploadId" AND mu."companyId" = company_id
  LEFT JOIN carrying c ON c."itemId" = q."itemId"
  ORDER BY l."name", i."readableIdWithRevision";
END;
$function$;
