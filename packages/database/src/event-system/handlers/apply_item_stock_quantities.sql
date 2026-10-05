CREATE OR REPLACE FUNCTION public.apply_item_stock_quantities()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "itemStockQuantities" AS isq
      ("itemId", "companyId", "locationId", "quantityOnHand")
    SELECT
      "itemId",
      "companyId",
      COALESCE("locationId", ''),
      SUM(item_ledger_on_hand_contribution("quantity", "trackedEntityStatus"))
    FROM batched_new
    GROUP BY "itemId", "companyId", COALESCE("locationId", '')
    ORDER BY 1, 2, 3
    ON CONFLICT ("itemId", "companyId", "locationId")
    DO UPDATE SET "quantityOnHand" = isq."quantityOnHand" + EXCLUDED."quantityOnHand";

  ELSIF TG_OP = 'UPDATE' THEN
    -- Generic old-vs-new: subtract every old row's contribution at its old key
    -- and add every new row's at its new key. Covers the real case (a
    -- trackedEntityStatus flip) and any future quantity/location/item edit
    -- without special-casing.
    INSERT INTO "itemStockQuantities" AS isq
      ("itemId", "companyId", "locationId", "quantityOnHand")
    SELECT "itemId", "companyId", "locationId", SUM(delta)
    FROM (
      SELECT
        "itemId",
        "companyId",
        COALESCE("locationId", '') AS "locationId",
        -item_ledger_on_hand_contribution("quantity", "trackedEntityStatus") AS delta
      FROM batched_old
      UNION ALL
      SELECT
        "itemId",
        "companyId",
        COALESCE("locationId", ''),
        item_ledger_on_hand_contribution("quantity", "trackedEntityStatus")
      FROM batched_new
    ) d
    GROUP BY "itemId", "companyId", "locationId"
    -- A key whose net delta is zero already holds the right number; skipping it
    -- avoids taking a lock on every row a wide UPDATE happened to touch.
    HAVING SUM(delta) <> 0
    ORDER BY 1, 2, 3
    ON CONFLICT ("itemId", "companyId", "locationId")
    DO UPDATE SET "quantityOnHand" = isq."quantityOnHand" + EXCLUDED."quantityOnHand";

  ELSIF TG_OP = 'DELETE' THEN
    -- Defensive: no application path deletes itemLedger rows today. A key left
    -- at zero with no backing ledger rows is removed by the nightly
    -- reconciliation.
    INSERT INTO "itemStockQuantities" AS isq
      ("itemId", "companyId", "locationId", "quantityOnHand")
    SELECT
      "itemId",
      "companyId",
      COALESCE("locationId", ''),
      -SUM(item_ledger_on_hand_contribution("quantity", "trackedEntityStatus"))
    FROM batched_old
    GROUP BY "itemId", "companyId", COALESCE("locationId", '')
    ORDER BY 1, 2, 3
    ON CONFLICT ("itemId", "companyId", "locationId")
    DO UPDATE SET "quantityOnHand" = isq."quantityOnHand" + EXCLUDED."quantityOnHand";
  END IF;

  RETURN NULL;
END;
$function$;
