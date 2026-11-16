-- Use As Is sends a receipt lot's rejected parts to Put Away.
--
-- When an NCR that holds a receipt inspection lot closes with Use As Is, those
-- parts are good stock again. They still sit where inspection left them: the
-- rejected storage unit, or the inspection unit. Put Away now offers them, and
-- the receipt's roll-up counts them, so the receipt reads Put Away only when
-- they are on the shelf too. Every other disposition (Rework, Scrap, Return to
-- Supplier) stays out of Put Away: those parts are moved by hand.
--
-- inspection_use_as_is is the one definition of "the Use As Is part of a lot",
-- read by refresh_receipt_inspection_status here and by getReceiptPutAwayLines
-- (apps/erp inventory.service.ts). Only a Closed NCR counts.
--   - Serial or batch lot: each unit of the lot that the lot rejected (every
--     unit of a Failed lot, else a unit with a Failed sample) and that a Use As
--     Is row of the NCR links, at the link's quantity.
--   - Untracked Failed lot: what closing the NCR put back for its Use As Is
--     rows. closeIssue tags each restore row with the disposition row it is
--     for (itemLedger.documentLineId), so Use As Is stock is told apart from
--     Rework stock restored beside it. A restore lands where a reject wrote
--     stock off; several lots written off in one unit take its Use As Is
--     restore in lot id order, each up to its own write-off there.
--   - Untracked Partial lot: its rejected remainder (still held, nothing is
--     booked), up to the NCR's Use As Is quantity for the item. A Partial lot
--     is the only lot on its NCR.

CREATE OR REPLACE FUNCTION public.inspection_use_as_is(
  p_company_id TEXT, p_inspection_ids TEXT[]
) RETURNS TABLE ("inspectionId" TEXT, "trackedEntityId" TEXT, "quantity" NUMERIC)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH ncrs AS (
    SELECT DISTINCT nci."nonConformanceId"
    FROM "nonConformanceInspection" nci
    JOIN "nonConformance" nc
      ON nc."id" = nci."nonConformanceId" AND nc."companyId" = nci."companyId"
    WHERE nci."companyId" = p_company_id
      AND nci."inspectionId" = ANY (p_inspection_ids)
      AND nc."status" = 'Closed'
  ),
  -- Every receipt lot on those NCRs: an untracked lot's share depends on the
  -- lots beside it, even those of other receipts.
  lots AS (
    SELECT
      nci."nonConformanceId",
      i."id",
      i."itemId",
      i."status",
      i."lotSize",
      i."acceptedQuantity",
      i."sourceDocumentLineId",
      it."itemTrackingType"
    FROM ncrs
    JOIN "nonConformanceInspection" nci
      ON nci."nonConformanceId" = ncrs."nonConformanceId"
     AND nci."companyId" = p_company_id
    JOIN "inspection" i
      ON i."id" = nci."inspectionId" AND i."companyId" = p_company_id
    JOIN "item" it
      ON it."id" = i."itemId" AND it."companyId" = i."companyId"
    WHERE i."sourceDocument" = 'Receipt'
      AND i."status" IN ('Passed', 'Partial', 'Failed')
  ),
  tracked AS (
    -- One link per unit per NCR (nciTrackedEntity_ncUnique); MAX keeps a unit
    -- on two closed NCRs of one lot from counting twice.
    SELECT
      l."id" AS "inspectionId",
      link."trackedEntityId",
      MAX(link."quantity") AS "quantity"
    FROM lots l
    JOIN "nonConformanceItem" r
      ON r."nonConformanceId" = l."nonConformanceId"
     AND r."companyId" = p_company_id
     AND r."itemId" = l."itemId"
     AND r."disposition" = 'Use As Is'
    JOIN "nonConformanceItemTrackedEntity" link
      ON link."nonConformanceItemId" = r."id" AND link."companyId" = p_company_id
    JOIN "trackedEntity" te
      ON te."id" = link."trackedEntityId" AND te."companyId" = p_company_id
    WHERE l."itemTrackingType" IN ('Serial', 'Batch')
      AND l."id" = ANY (p_inspection_ids)
      AND te."attributes" ->> 'Receipt Line' = l."sourceDocumentLineId"
      AND (
        l."status" = 'Failed'
        OR EXISTS (
          SELECT 1
          FROM "inspectionSample" s
          WHERE s."inspectionId" = l."id"
            AND s."trackedEntityId" = link."trackedEntityId"
            AND s."status" = 'Failed'
        )
      )
    GROUP BY 1, 2
  ),
  -- A Failed lot's write-off, per unit it was taken from.
  failed_lots AS (
    SELECT
      l."nonConformanceId",
      l."id",
      l."itemId",
      w."storageUnitId",
      w."quantity" AS "cap"
    FROM lots l
    JOIN LATERAL (
      SELECT il."storageUnitId", -SUM(il."quantity") AS "quantity"
      FROM "itemLedger" il
      WHERE il."documentId" = l."id"
        AND il."companyId" = p_company_id
        AND il."documentType" = 'Inbound Inspection'
        AND il."trackedEntityId" IS NULL
      GROUP BY il."storageUnitId"
    ) w ON w."quantity" > 0
    WHERE l."itemTrackingType" = 'Inventory'
      AND l."status" = 'Failed'
  ),
  -- What closing the NCR put back for its Use As Is rows, per unit.
  kept_restores AS (
    SELECT
      r."nonConformanceId",
      r."itemId",
      il."storageUnitId",
      SUM(il."quantity") AS "quantity"
    FROM "nonConformanceItem" r
    JOIN "itemLedger" il
      ON il."documentId" = r."nonConformanceId"
     AND il."documentLineId" = r."id"
     AND il."companyId" = p_company_id
     AND il."documentType" = 'Non-Conformance'
     AND il."itemId" = r."itemId"
     AND il."trackedEntityId" IS NULL
     AND il."quantity" > 0
    WHERE r."companyId" = p_company_id
      AND r."nonConformanceId" IN (SELECT "nonConformanceId" FROM ncrs)
      AND r."disposition" = 'Use As Is'
    GROUP BY 1, 2, 3
  ),
  failed AS (
    SELECT
      f."id" AS "inspectionId",
      NULL::TEXT AS "trackedEntityId",
      GREATEST(LEAST(
        f."cap",
        k."quantity" - COALESCE(SUM(f."cap") OVER (
          PARTITION BY f."nonConformanceId", f."itemId", f."storageUnitId"
          ORDER BY f."id"
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0)
      ), 0) AS "quantity"
    FROM failed_lots f
    JOIN kept_restores k
      ON k."nonConformanceId" = f."nonConformanceId"
     AND k."itemId" = f."itemId"
     AND k."storageUnitId" IS NOT DISTINCT FROM f."storageUnitId"
  ),
  -- Partial lots book nothing at the close: their Use As Is part is the
  -- NCR's Use As Is quantity for the item, up to the held remainder.
  partial AS (
    SELECT
      l."id" AS "inspectionId",
      NULL::TEXT AS "trackedEntityId",
      GREATEST(LEAST(
        l."lotSize" - COALESCE(l."acceptedQuantity", 0),
        (
          SELECT COALESCE(SUM(r."quantity"), 0)
          FROM "nonConformanceItem" r
          WHERE r."nonConformanceId" = l."nonConformanceId"
            AND r."companyId" = p_company_id
            AND r."itemId" = l."itemId"
            AND r."disposition" = 'Use As Is'
            AND NOT EXISTS (
              SELECT 1
              FROM "nonConformanceItemTrackedEntity" link
              WHERE link."nonConformanceItemId" = r."id"
            )
        )
      ), 0) AS "quantity"
    FROM lots l
    WHERE l."itemTrackingType" = 'Inventory'
      AND l."status" = 'Partial'
  ),
  untracked AS (
    SELECT * FROM failed
    UNION ALL
    SELECT * FROM partial
  )
  SELECT t."inspectionId", t."trackedEntityId", t."quantity"
  FROM tracked t
  WHERE t."quantity" > 0
  UNION ALL
  SELECT u."inspectionId", u."trackedEntityId", u."quantity"
  FROM untracked u
  WHERE u."inspectionId" = ANY (p_inspection_ids)
    AND u."quantity" > 0;
$$;

-- A lot's passed quantity now adds its Use As Is part, so a receipt reads Put
-- Away only once that part is put away too. A Failed lot with a Use As Is part
-- counts it the same way.
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
