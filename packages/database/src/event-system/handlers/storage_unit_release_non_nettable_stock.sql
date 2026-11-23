CREATE OR REPLACE FUNCTION public.storage_unit_release_non_nettable_stock(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_operation <> 'DELETE' THEN
    RETURN;
  END IF;

  IF COALESCE((p_old->>'effectiveNettable')::boolean, true) THEN
    RETURN;
  END IF;

  -- Deleting a unit sets its ledger rows' storageUnitId to NULL (the FK is ON
  -- DELETE SET NULL), and stock in no unit is nettable. The ledger handler
  -- cannot tell that this stock was non-nettable, because by then the unit row
  -- is gone. So release it here, before the row is deleted. Stock is kept per
  -- project stripe, so each stripe's row is released on its own.
  INSERT INTO "itemStockQuantities" AS isq
    ("itemId", "companyId", "locationId", "projectId", "quantityOnHand", "quantityNonNettable")
  SELECT
    il."itemId",
    il."companyId",
    COALESCE(il."locationId", ''),
    COALESCE(il."projectId", ''),
    0,
    -SUM(item_ledger_on_hand_contribution(il."quantity", il."trackedEntityStatus"))
  FROM "itemLedger" il
  WHERE il."storageUnitId" = p_old->>'id'
  GROUP BY il."itemId", il."companyId", COALESCE(il."locationId", ''), COALESCE(il."projectId", '')
  HAVING SUM(item_ledger_on_hand_contribution(il."quantity", il."trackedEntityStatus")) <> 0
  ORDER BY 1, 2, 3, 4
  ON CONFLICT ("itemId", "companyId", "locationId", "projectId")
  DO UPDATE SET "quantityNonNettable" = isq."quantityNonNettable" + EXCLUDED."quantityNonNettable";
END;
$function$;
