-- ============================================================
-- get_inventory_valuation: method-faithful inventory value by (item, location).
-- Spec: .ai/specs/2026-07-14-inventory-value-report.md
--
--   * quantityOnHand = ALL physical stock (On Hold + Rejected included; they are
--     assets until written off). quantityOnHold / quantityRejected are additive
--     breakdown columns from the denormalized itemLedger.trackedEntityStatus.
--   * unitCost: FIFO/LIFO = remaining cost-layer value incl. applied adjustment
--     children (appliesToCostLedgerId), fallback itemCost.unitCost when no open
--     layers; Average = itemCost.unitCost; Standard = itemCost.standardCost.
--     This is the completeness spec's carrying CTE
--     (.ai/specs/2026-07-04-inventory-valuation-completeness.md §3).
--   * as_of_date NULL/today: snapshot + delta (exact 20260713235406 pattern).
--     as_of_date in the past: raw itemLedger scan filtered by postingDate —
--     the snapshot has no date grain. Costs are ALWAYS current-state; the UI
--     labels dated results accordingly.
--   * Status buckets reflect CURRENT tracked-entity statuses even for past
--     dates (statuses are rewritten in place by 20260420112047).
-- ============================================================

DROP FUNCTION IF EXISTS get_inventory_valuation(TEXT, DATE, TEXT);

CREATE OR REPLACE FUNCTION get_inventory_valuation(
  company_id TEXT,
  as_of_date DATE DEFAULT NULL,
  location_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  "locationId" TEXT,
  "locationName" TEXT,
  "itemId" TEXT,
  "readableIdWithRevision" TEXT,
  "name" TEXT,
  "thumbnailPath" TEXT,
  "type" "itemType",
  "replenishmentSystem" "itemReplenishmentSystem",
  "unitOfMeasureCode" TEXT,
  "costingMethod" "itemCostingMethod",
  "quantityOnHand" NUMERIC,
  "quantityOnHold" NUMERIC,
  "quantityRejected" NUMERIC,
  "unitCost" NUMERIC,
  "totalValue" NUMERIC
) AS $$
DECLARE
  v_cutoff TIMESTAMPTZ;
  v_dated BOOLEAN := as_of_date IS NOT NULL AND as_of_date < CURRENT_DATE;
BEGIN
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
          cl."remainingQuantity"
          * (cl."cost" + COALESCE(adj."applied", 0))
          / NULLIF(cl."quantity", 0)
        ) / NULLIF(SUM(cl."remainingQuantity"), 0) AS "layerUnitCost"
      FROM "costLedger" cl
      LEFT JOIN LATERAL (
        SELECT SUM(a."cost") AS "applied"
        FROM "costLedger" a
        WHERE a."appliesToCostLedgerId" = cl."id"
          AND a."companyId" = cl."companyId"
      ) adj ON TRUE
      WHERE cl."itemId" = ic."itemId"
        AND cl."companyId" = ic."companyId"
        AND cl."remainingQuantity" > 0
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- get_inventory_tie_out: subledger value vs GL balance per stock account
-- (SAP MB5L shape). Subledger side calls get_inventory_valuation so the two
-- surfaces can never disagree. Items classify to accounts exactly like
-- resolveInventoryAccount (functions/shared/get-posting-group.ts):
-- Make / Buy and Make -> finishedGoodsAccount, else rawMaterialsAccount.
-- GL side follows the newest balance convention (20260713233919):
-- journal.status <> 'Draft', journal.postingDate <= as-of, journalLine.accountId.
-- ============================================================

DROP FUNCTION IF EXISTS get_inventory_tie_out(TEXT, DATE);

CREATE OR REPLACE FUNCTION get_inventory_tie_out(
  company_id TEXT,
  as_of_date DATE DEFAULT NULL
)
RETURNS TABLE (
  "accountKind" TEXT,
  "accountId" TEXT,
  "accountName" TEXT,
  "subledgerValue" NUMERIC,
  "glBalance" NUMERIC,
  "variance" NUMERIC
) AS $$
DECLARE
  v_as_of DATE := COALESCE(as_of_date, CURRENT_DATE);
  v_rm_account TEXT;
  v_fg_account TEXT;
BEGIN
  SELECT ad."rawMaterialsAccount", ad."finishedGoodsAccount"
  INTO v_rm_account, v_fg_account
  FROM "accountDefault" ad
  WHERE ad."companyId" = company_id;

  IF v_rm_account IS NULL OR v_fg_account IS NULL THEN
    RETURN; -- company has no account defaults (accounting never configured)
  END IF;

  RETURN QUERY
  WITH subledger AS (
    SELECT
      CASE WHEN v."replenishmentSystem" IN ('Make', 'Buy and Make')
           THEN 'finishedGoods' ELSE 'rawMaterials' END AS "kind",
      SUM(v."totalValue") AS "value"
    FROM get_inventory_valuation(company_id, as_of_date, NULL) v
    GROUP BY 1
  ),
  gl AS (
    SELECT jl."accountId" AS "account", SUM(jl."amount") AS "balance"
    FROM "journal" j
    INNER JOIN "journalLine" jl
      ON jl."journalId" = j."id" AND jl."companyId" = j."companyId"
    WHERE j."companyId" = company_id
      AND j."status" <> 'Draft'
      AND j."postingDate" <= v_as_of
      AND jl."accountId" IN (v_rm_account, v_fg_account)
    GROUP BY jl."accountId"
  ),
  accounts AS (
    SELECT 'rawMaterials' AS "kind", v_rm_account AS "account"
    UNION ALL
    SELECT 'finishedGoods' AS "kind", v_fg_account AS "account"
  )
  SELECT
    a."kind" AS "accountKind",
    a."account" AS "accountId",
    acc."name" AS "accountName",
    COALESCE(s."value", 0) AS "subledgerValue",
    COALESCE(g."balance", 0) AS "glBalance",
    COALESCE(s."value", 0) - COALESCE(g."balance", 0) AS "variance"
  -- account is companyGroup-scoped (no companyId); the ids come from the
  -- company-scoped accountDefault row, so joining by id alone is correct.
  FROM accounts a
  LEFT JOIN "account" acc ON acc."id" = a."account"
  LEFT JOIN subledger s ON s."kind" = a."kind"
  LEFT JOIN gl g ON g."account" = a."account"
  ORDER BY a."kind" DESC; -- rawMaterials first
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Kept per spec decision (grill Q5): superseded but not dropped.
COMMENT ON FUNCTION get_inventory_value_by_location(TEXT) IS
  'Deprecated: superseded by get_inventory_valuation (method-faithful costs, status breakdown, as-of-date). Kept for API compatibility.';
