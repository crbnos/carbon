-- Goods-in inspection hold: the receipt roll-up counts held lots only
-- (spec .ai/specs/2026-11-03-goods-in-inspection-hold.md).
--
-- Lots from before the hold sit in ordinary (nettable) bins, and their stock
-- was never held. The two earlier backfills (20261104091544,
-- 20261104091659) rolled those lots up too, so old receipts showed as
-- "Inspection Passed" or "Partially Passed" and appeared in Ready for putaway,
-- offering free stock for a putaway transfer. The roll-up now counts only a
-- lot whose storage unit is non-nettable. Every inspected receipt from now on
-- posts into one, so this changes nothing for a held lot. The rerun below sets
-- the older receipts back to "Not Required".

CREATE OR REPLACE FUNCTION public.refresh_receipt_inspection_status(p_receipt_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_total INT;
  v_pending INT;
  v_open INT;
  v_passed INT;
  v_failed INT;
  v_passed_qty NUMERIC;
  v_all_put_away BOOLEAN;
  v_status "receiptInspectionStatus";
BEGIN
  IF p_receipt_id IS NULL THEN
    RETURN;
  END IF;

  WITH lots AS (
    SELECT
      i."sourceDocumentLineId" AS "receiptLineId",
      i."status",
      CASE
        WHEN i."status" = 'Passed' THEN i."lotSize"
        WHEN i."status" = 'Partial' THEN COALESCE(i."acceptedQuantity", 0)
        ELSE 0
      END AS "passed"
    FROM "inspection" i
    -- Held stock only: a lot in a nettable unit (or none) never held its stock.
    JOIN "storageUnit" su
      ON su."id" = i."storageUnitId"
     AND su."effectiveNettable" = false
    WHERE i."sourceDocument" = 'Receipt'
      AND i."sourceDocumentId" = p_receipt_id
      AND i."status" <> 'Cancelled'
  ),
  put_away AS (
    SELECT stl."receiptLineId", SUM(stl."pickedQuantity") AS "quantity"
    FROM "stockTransferLine" stl
    JOIN "stockTransfer" st
      ON st."id" = stl."stockTransferId" AND st."companyId" = stl."companyId"
    WHERE st."receiptId" = p_receipt_id
      AND st."status" = 'Completed'
      AND stl."receiptLineId" IS NOT NULL
    GROUP BY stl."receiptLineId"
  )
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE l."status" = 'Pending'),
    COUNT(*) FILTER (WHERE l."status" IN ('Pending', 'In Progress')),
    COUNT(*) FILTER (WHERE l."status" = 'Passed'),
    COUNT(*) FILTER (WHERE l."status" = 'Failed'),
    COALESCE(SUM(l."passed"), 0),
    COALESCE(bool_and(l."passed" <= 0 OR COALESCE(p."quantity", 0) >= l."passed"), false)
  INTO v_total, v_pending, v_open, v_passed, v_failed, v_passed_qty, v_all_put_away
  FROM lots l
  LEFT JOIN put_away p ON p."receiptLineId" = l."receiptLineId";

  v_status := CASE
    WHEN v_total = 0 THEN 'Not Required'
    WHEN v_pending = v_total THEN 'Pending Inspection'
    WHEN v_open > 0 THEN 'Inspection In Progress'
    WHEN v_passed_qty > 0 AND v_all_put_away THEN 'Put Away'
    WHEN v_failed = v_total THEN 'Inspection Failed'
    WHEN v_passed = v_total THEN 'Inspection Passed'
    ELSE 'Partially Passed'
  END;

  UPDATE "receipt"
  SET "inspectionStatus" = v_status
  WHERE "id" = p_receipt_id
    AND "inspectionStatus" IS DISTINCT FROM v_status;
END;
$$;

-- A data fix, not user activity: keep it out of the event queue.
SELECT set_config('app.sync_in_progress', 'true', true);

-- Every receipt the earlier backfills rolled up.
SELECT public.refresh_receipt_inspection_status(r."id")
FROM "receipt" r
WHERE r."inspectionStatus" <> 'Not Required';

NOTIFY pgrst, 'reload schema';
