-- Goods-in storage units may be nettable. A location's inspection and rejected
-- storage units are ordinary storage units: whether their stock is supply is
-- the unit's own Non-nettable setting. The hold guard (check_inspection_hold)
-- keeps held stock from moving whatever the unit's setting.
--
-- The roll-up used to count only lots in a non-nettable unit, which is how it
-- left out lots opened before the hold existed. A lot now records where its
-- stock is held whatever the unit, so the roll-up counts every lot that names
-- a unit. Only a lot with no unit of its own (from before the hold) still
-- needs its receipt line's unit to be non-nettable.

SET lock_timeout = '5s';

-- The receipt's inspection roll-up. Rules in order (spec, Proposed Solution 7).
-- Cancelled lots are ignored.

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

  -- Locked first: two writers on one receipt would otherwise each miss the
  -- other's uncommitted change, and neither refresh would see both.
  PERFORM 1 FROM "receipt" WHERE "id" = p_receipt_id FOR NO KEY UPDATE;

  WITH lots AS (
    SELECT
      i."sourceDocumentLineId" AS "receiptLineId",
      i."status",
      CASE
        WHEN i."status" = 'Passed' THEN COALESCE(i."acceptedQuantity", i."lotSize")
        WHEN i."status" = 'Partial' THEN COALESCE(i."acceptedQuantity", 0)
        ELSE 0
      END AS "passed"
    FROM "inspection" i
    LEFT JOIN "receiptLine" rl ON rl."id" = i."sourceDocumentLineId"
    JOIN "storageUnit" su
      ON su."id" = COALESCE(i."storageUnitId", CASE WHEN i."status" = 'Failed' THEN rl."storageUnitId" END)
     AND (i."storageUnitId" IS NOT NULL OR su."effectiveNettable" = false)
    JOIN "receipt" r
      ON r."id" = i."sourceDocumentId"
     AND r."status" <> 'Voided'
    JOIN "item" it
      ON it."id" = i."itemId"
     AND it."companyId" = i."companyId"
     AND it."itemTrackingType" <> 'Non-Inventory'
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
      AND st."companyId" = (SELECT "companyId" FROM "receipt" WHERE "id" = p_receipt_id)
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

-- A data fix, not user activity: keep it out of the event queue (audit log,
-- webhooks, workflows). Transaction-local.
SELECT set_config('app.sync_in_progress', 'true', true);

-- Until now a lot opened in a nettable unit could only be from before the hold
-- (a Passed lot the backfill gave its line's unit). The roll-up left those out;
-- without a unit it still does.
UPDATE "inspection" i
SET "storageUnitId" = NULL
FROM "storageUnit" su
WHERE su."id" = i."storageUnitId"
  AND su."effectiveNettable" = true
  AND i."sourceDocument" = 'Receipt'
  AND i."status" = 'Passed';

NOTIFY pgrst, 'reload schema';

RESET lock_timeout;
