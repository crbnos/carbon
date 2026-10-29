CREATE OR REPLACE FUNCTION public.apply_item_stock_quantities()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- quantityNonNettable is the part of quantityOnHand that sits in a storage
  -- unit whose effectiveNettable is false. A row with no storage unit, or one
  -- whose unit no longer exists, is nettable.
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "itemStockQuantities" AS isq
      ("itemId", "companyId", "locationId", "quantityOnHand", "quantityNonNettable")
    SELECT
      b."itemId",
      b."companyId",
      COALESCE(b."locationId", ''),
      SUM(item_ledger_on_hand_contribution(b."quantity", b."trackedEntityStatus")),
      COALESCE(SUM(item_ledger_on_hand_contribution(b."quantity", b."trackedEntityStatus"))
        FILTER (WHERE su."effectiveNettable" = false), 0)
    FROM batched_new b
    LEFT JOIN "storageUnit" su ON su."id" = b."storageUnitId"
    GROUP BY b."itemId", b."companyId", COALESCE(b."locationId", '')
    ORDER BY 1, 2, 3
    ON CONFLICT ("itemId", "companyId", "locationId")
    DO UPDATE SET
      "quantityOnHand" = isq."quantityOnHand" + EXCLUDED."quantityOnHand",
      "quantityNonNettable" = isq."quantityNonNettable" + EXCLUDED."quantityNonNettable";

  ELSIF TG_OP = 'UPDATE' THEN
    -- Generic old-vs-new: subtract every old row's contribution at its old key
    -- and add every new row's at its new key. Covers the real case (a
    -- trackedEntityStatus flip) and any future quantity/location/item edit
    -- without special-casing.
    INSERT INTO "itemStockQuantities" AS isq
      ("itemId", "companyId", "locationId", "quantityOnHand", "quantityNonNettable")
    SELECT "itemId", "companyId", "locationId", SUM(delta), SUM(non_nettable_delta)
    FROM (
      SELECT
        b."itemId",
        b."companyId",
        COALESCE(b."locationId", '') AS "locationId",
        -item_ledger_on_hand_contribution(b."quantity", b."trackedEntityStatus") AS delta,
        CASE WHEN su."effectiveNettable" = false
          THEN -item_ledger_on_hand_contribution(b."quantity", b."trackedEntityStatus")
          ELSE 0
        END AS non_nettable_delta
      FROM batched_old b
      LEFT JOIN "storageUnit" su ON su."id" = b."storageUnitId"
      UNION ALL
      SELECT
        b."itemId",
        b."companyId",
        COALESCE(b."locationId", ''),
        item_ledger_on_hand_contribution(b."quantity", b."trackedEntityStatus"),
        CASE WHEN su."effectiveNettable" = false
          THEN item_ledger_on_hand_contribution(b."quantity", b."trackedEntityStatus")
          ELSE 0
        END
      FROM batched_new b
      LEFT JOIN "storageUnit" su ON su."id" = b."storageUnitId"
    ) d
    GROUP BY "itemId", "companyId", "locationId"
    -- A key whose net deltas are zero already holds the right numbers; skipping
    -- it avoids taking a lock on every row a wide UPDATE happened to touch.
    HAVING SUM(delta) <> 0 OR SUM(non_nettable_delta) <> 0
    ORDER BY 1, 2, 3
    ON CONFLICT ("itemId", "companyId", "locationId")
    DO UPDATE SET
      "quantityOnHand" = isq."quantityOnHand" + EXCLUDED."quantityOnHand",
      "quantityNonNettable" = isq."quantityNonNettable" + EXCLUDED."quantityNonNettable";

  ELSIF TG_OP = 'DELETE' THEN
    -- Defensive: no application path deletes itemLedger rows today. A key left
    -- at zero with no backing ledger rows is removed by the nightly
    -- reconciliation.
    INSERT INTO "itemStockQuantities" AS isq
      ("itemId", "companyId", "locationId", "quantityOnHand", "quantityNonNettable")
    SELECT
      b."itemId",
      b."companyId",
      COALESCE(b."locationId", ''),
      -SUM(item_ledger_on_hand_contribution(b."quantity", b."trackedEntityStatus")),
      -COALESCE(SUM(item_ledger_on_hand_contribution(b."quantity", b."trackedEntityStatus"))
        FILTER (WHERE su."effectiveNettable" = false), 0)
    FROM batched_old b
    LEFT JOIN "storageUnit" su ON su."id" = b."storageUnitId"
    GROUP BY b."itemId", b."companyId", COALESCE(b."locationId", '')
    ORDER BY 1, 2, 3
    ON CONFLICT ("itemId", "companyId", "locationId")
    DO UPDATE SET
      "quantityOnHand" = isq."quantityOnHand" + EXCLUDED."quantityOnHand",
      "quantityNonNettable" = isq."quantityNonNettable" + EXCLUDED."quantityNonNettable";
  END IF;

  RETURN NULL;
END;
$function$;
