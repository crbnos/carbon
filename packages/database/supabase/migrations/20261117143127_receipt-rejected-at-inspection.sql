-- receipt."rejectedAtInspection": true while a lot of the receipt rejected
-- stock at inspection. That is a Failed lot, a Partial lot, or a Passed lot
-- whose accepted quantity is less than its lot size (an Accept of a serial lot
-- with failed units sets those units Rejected).
--
-- inspectionStatus cannot say this on its own. A receipt with a Partial lot
-- (or a Failed lot beside a Passed one) reads Partially Passed, and then Put
-- Away once its passed stock is put away, while its rejected stock is still
-- held under an NCR. The Inventory sidebar's "Inspection failed" link filters
-- on this flag instead, so such a receipt stays in it after putaway, as a
-- receipt whose every lot failed does.
--
-- A decided lot does not change, so the flag stays set for good. The flag
-- reads the same lots as the status: a Cancelled lot, a lot of a
-- voided receipt and a Non-Inventory lot do not count.

SET lock_timeout = '5s';

ALTER TABLE "receipt"
  ADD COLUMN IF NOT EXISTS "rejectedAtInspection" BOOLEAN NOT NULL DEFAULT false;

-- Only the flagged receipts are indexed: the filter asks for true, and most
-- receipts have no rejected lot.
CREATE INDEX IF NOT EXISTS "receipt_companyId_rejectedAtInspection_idx"
  ON "receipt" ("companyId")
  WHERE "rejectedAtInspection";

-- Redefined from 20261116122219_receipt-put-away-use-as-is.sql; the only
-- change is the lot's "rejected" test, v_rejected and the column it sets.
CREATE OR REPLACE FUNCTION public.refresh_receipt_inspection_status(p_receipt_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_company_id TEXT;
  v_total INT;
  v_pending INT;
  v_open INT;
  v_passed INT;
  v_failed INT;
  v_rejected INT;
  v_passed_qty NUMERIC;
  v_all_put_away BOOLEAN;
  v_status "receiptInspectionStatus";
BEGIN
  IF p_receipt_id IS NULL THEN
    RETURN;
  END IF;

  -- Locked first: two writers on one receipt would otherwise each miss the
  -- other's uncommitted change, and neither refresh would see both.
  SELECT "companyId" INTO v_company_id
  FROM "receipt"
  WHERE "id" = p_receipt_id
  FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  WITH use_as_is AS (
    SELECT u."inspectionId", SUM(u."quantity") AS "quantity"
    FROM public.inspection_use_as_is(
      v_company_id,
      ARRAY(
        SELECT i."id"
        FROM "inspection" i
        WHERE i."sourceDocument" = 'Receipt'
          AND i."sourceDocumentId" = p_receipt_id
          AND i."companyId" = v_company_id
      )
    ) u
    GROUP BY 1
  ),
  lots AS (
    SELECT
      i."sourceDocumentLineId" AS "receiptLineId",
      i."status",
      (
        i."status" IN ('Failed', 'Partial')
        OR (i."status" = 'Passed' AND i."acceptedQuantity" < i."lotSize")
      ) AS "rejected",
      CASE
        WHEN i."status" = 'Passed' THEN COALESCE(i."acceptedQuantity", i."lotSize")
        WHEN i."status" = 'Partial' THEN COALESCE(i."acceptedQuantity", 0)
        ELSE 0
      END
      -- A lot from before the hold (no unit of its own) offers no Put Away,
      -- so its Use As Is part is not waited for either.
      + CASE WHEN i."storageUnitId" IS NOT NULL THEN COALESCE(k."quantity", 0) ELSE 0 END
        AS "passed"
    FROM "inspection" i
    LEFT JOIN "receiptLine" rl ON rl."id" = i."sourceDocumentLineId"
    LEFT JOIN use_as_is k ON k."inspectionId" = i."id"
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
      AND st."companyId" = v_company_id
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
    COUNT(*) FILTER (WHERE l."rejected"),
    COALESCE(SUM(l."passed"), 0),
    COALESCE(bool_and(l."passed" <= 0 OR COALESCE(p."quantity", 0) >= l."passed"), false)
  INTO v_total, v_pending, v_open, v_passed, v_failed, v_rejected, v_passed_qty, v_all_put_away
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
  SET "inspectionStatus" = v_status,
      "rejectedAtInspection" = v_rejected > 0
  WHERE "id" = p_receipt_id
    AND (
      "inspectionStatus" IS DISTINCT FROM v_status
      OR "rejectedAtInspection" IS DISTINCT FROM (v_rejected > 0)
    );
END;
$$;

-- A data fix, not user activity: keep it out of the event queue (audit log,
-- webhooks, workflows). Transaction-local.
SELECT set_config('app.sync_in_progress', 'true', true);

SELECT public.refresh_receipt_inspection_status(r."id")
FROM "receipt" r
WHERE EXISTS (
  SELECT 1 FROM "inspection" i
  WHERE i."sourceDocument" = 'Receipt'
    AND i."sourceDocumentId" = r."id"
    AND i."companyId" = r."companyId"
    AND (
      i."status" IN ('Failed', 'Partial')
      OR (i."status" = 'Passed' AND i."acceptedQuantity" < i."lotSize")
    )
);

SELECT set_config('app.sync_in_progress', '', true);

NOTIFY pgrst, 'reload schema';

RESET lock_timeout;
