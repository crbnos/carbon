-- Goods-in inspection hold (spec .ai/specs/2026-11-03-goods-in-inspection-hold.md).
-- A received part with a receipt inspection plan goes to the location's
-- inspection storage unit and stays held there until quality decides its lot.
-- The guard that enforces the hold is a statement handler on itemLedger
-- (event-system/handlers/check_inspection_hold.sql); this file adds the
-- columns, the two functions it and the receipt roll-up read, and a backfill.

SET lock_timeout = '5s';

-- 1. Per-location inspection and rejected storage units -----------------------

ALTER TABLE "location"
  ADD COLUMN IF NOT EXISTS "inspectionStorageUnitId" TEXT,
  ADD COLUMN IF NOT EXISTS "rejectedStorageUnitId" TEXT;

-- Not SET NULL: silently nulling a configured unit would make the next inspected
-- receipt fail with no clue why. Clear the setting first. Deferred, because
-- storageUnit references location: a restore or company delete loads and clears
-- the two tables in one transaction, in either order.
ALTER TABLE "location" DROP CONSTRAINT IF EXISTS "location_inspectionStorageUnitId_fkey";
ALTER TABLE "location" ADD CONSTRAINT "location_inspectionStorageUnitId_fkey"
  FOREIGN KEY ("inspectionStorageUnitId") REFERENCES "storageUnit"("id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "location" DROP CONSTRAINT IF EXISTS "location_rejectedStorageUnitId_fkey";
ALTER TABLE "location" ADD CONSTRAINT "location_rejectedStorageUnitId_fkey"
  FOREIGN KEY ("rejectedStorageUnitId") REFERENCES "storageUnit"("id") DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS "location_inspectionStorageUnitId_idx"
  ON "location" ("inspectionStorageUnitId");
CREATE INDEX IF NOT EXISTS "location_rejectedStorageUnitId_idx"
  ON "location" ("rejectedStorageUnitId");

-- 2. Receipt inspection roll-up and the line flag -----------------------------

ALTER TABLE "receipt"
  ADD COLUMN IF NOT EXISTS "inspectionStatus" "receiptInspectionStatus" NOT NULL DEFAULT 'Not Required';
CREATE INDEX IF NOT EXISTS "receipt_companyId_inspectionStatus_idx"
  ON "receipt" ("companyId", "inspectionStatus");

-- A snapshot taken when the line is created: a later plan change does not
-- rewrite a past receipt.
ALTER TABLE "receiptLine"
  ADD COLUMN IF NOT EXISTS "requiresInspection" BOOLEAN NOT NULL DEFAULT false;

-- rl.* is expanded when the view is created, so the new column needs the view
-- recreated. Body forked from 20260811123616_widen-purchasing-scale.sql.
DROP VIEW IF EXISTS "receiptLines";
CREATE VIEW "receiptLines" WITH(SECURITY_INVOKER=true) AS
  SELECT
    rl.*,
    i."readableIdWithRevision" as "itemReadableId",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      ELSE i."thumbnailPath"
    END AS "thumbnailPath",
    i."name" as "description"
  FROM "receiptLine" rl
  INNER JOIN "item" i ON i."id" = rl."itemId"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId";

-- 3. Where a lot's held stock sits, and the accepted part of a Partial lot -----

ALTER TABLE "inspection"
  ADD COLUMN IF NOT EXISTS "storageUnitId" TEXT,
  ADD COLUMN IF NOT EXISTS "acceptedQuantity" NUMERIC;
ALTER TABLE "inspection" DROP CONSTRAINT IF EXISTS "inspection_storageUnitId_fkey";
ALTER TABLE "inspection" ADD CONSTRAINT "inspection_storageUnitId_fkey"
  FOREIGN KEY ("storageUnitId") REFERENCES "storageUnit"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "inspection_hold_idx"
  ON "inspection" ("storageUnitId", "itemId")
  WHERE "status" IN ('Pending', 'In Progress', 'Partial') AND "storageUnitId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "inspection_storageUnitId_idx"
  ON "inspection" ("storageUnitId");

-- 4. Putaway link (sibling: stockTransfer.kanbanId) ---------------------------

ALTER TABLE "stockTransfer" ADD COLUMN IF NOT EXISTS "receiptId" TEXT;
ALTER TABLE "stockTransfer" DROP CONSTRAINT IF EXISTS "stockTransfer_receiptId_fkey";
ALTER TABLE "stockTransfer" ADD CONSTRAINT "stockTransfer_receiptId_fkey"
  FOREIGN KEY ("receiptId") REFERENCES "receipt"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "stockTransfer_receiptId_idx"
  ON "stockTransfer" ("receiptId") WHERE "receiptId" IS NOT NULL;

ALTER TABLE "stockTransferLine" ADD COLUMN IF NOT EXISTS "receiptLineId" TEXT;
ALTER TABLE "stockTransferLine" DROP CONSTRAINT IF EXISTS "stockTransferLine_receiptLineId_fkey";
ALTER TABLE "stockTransferLine" ADD CONSTRAINT "stockTransferLine_receiptLineId_fkey"
  FOREIGN KEY ("receiptLineId") REFERENCES "receiptLine"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "stockTransferLine_receiptLineId_idx"
  ON "stockTransferLine" ("receiptLineId") WHERE "receiptLineId" IS NOT NULL;

-- 5. The untracked quantity an inspection holds at one storage unit -----------
-- Open lots hold their whole lot size. A Partial lot holds its rejected
-- remainder until its NCR closes. Serial and batch stock is held by its
-- trackedEntity status (On Hold), not here.

CREATE OR REPLACE FUNCTION public.inspection_lot_holds(
  p_inspection_id TEXT, p_status "inspectionStatusType", p_accepted_quantity NUMERIC
) RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
  SELECT p_status IN ('Pending', 'In Progress')
    OR (
      p_status = 'Partial'
      AND p_accepted_quantity IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public."inspection" lot
        JOIN public."item" it ON it."id" = lot."itemId" AND it."companyId" = lot."companyId"
        WHERE lot."id" = p_inspection_id AND it."itemTrackingType" = 'Inventory'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public."nonConformanceInspection" nci
        JOIN public."nonConformance" nc ON nc."id" = nci."nonConformanceId"
        WHERE nci."inspectionId" = p_inspection_id AND nc."status" = 'Closed'
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.inspection_line_lot_open(
  p_company_id TEXT, p_receipt_line_id TEXT
) RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."inspection" i
    WHERE i."sourceDocumentLineId" = p_receipt_line_id
      AND i."companyId" = p_company_id
      AND i."sourceDocument" = 'Receipt'
      AND i."status" IN ('Pending', 'In Progress')
  );
$$;

CREATE OR REPLACE FUNCTION public.inspection_holds_at(
  p_company_id TEXT, p_item_id TEXT, p_storage_unit_id TEXT,
  p_open_lots_only BOOLEAN DEFAULT false
) RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."inspection" h
    WHERE h."storageUnitId" = p_storage_unit_id
      AND h."itemId" = p_item_id
      AND h."companyId" = p_company_id
      AND h."status" IN ('Pending', 'In Progress', 'Partial')
      AND (NOT p_open_lots_only OR h."status" IN ('Pending', 'In Progress'))
      AND public.inspection_lot_holds(h."id", h."status", h."acceptedQuantity")
  );
$$;

CREATE OR REPLACE FUNCTION public.inspection_held_quantity(
  p_company_id TEXT, p_item_id TEXT, p_storage_unit_id TEXT,
  p_open_lots_only BOOLEAN DEFAULT false
) RETURNS NUMERIC
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(SUM(
    CASE
      WHEN i."status" IN ('Pending', 'In Progress') THEN i."lotSize"
      ELSE GREATEST(i."lotSize" - COALESCE(i."acceptedQuantity", 0), 0)
    END
  ), 0)
  FROM "inspection" i
  JOIN "item" it ON it."id" = i."itemId" AND it."companyId" = i."companyId"
  WHERE i."companyId" = p_company_id
    AND i."itemId" = p_item_id
    AND i."storageUnitId" = p_storage_unit_id
    AND it."itemTrackingType" = 'Inventory'
    AND i."status" IN ('Pending', 'In Progress', 'Partial')
    AND (NOT p_open_lots_only OR i."status" IN ('Pending', 'In Progress'))
    AND public.inspection_lot_holds(i."id", i."status", i."acceptedQuantity");
$$;

CREATE OR REPLACE FUNCTION public.inspection_untracked_on_hand(
  p_company_id TEXT, p_item_id TEXT, p_storage_unit_id TEXT
) RETURNS NUMERIC
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(SUM(il."quantity"), 0)
  FROM public."itemLedger" il
  WHERE il."storageUnitId" = p_storage_unit_id
    AND il."itemId" = p_item_id
    AND il."companyId" = p_company_id
    AND il."trackedEntityId" IS NULL;
$$;

-- 6. The receipt's inspection roll-up ------------------------------------------
-- Rules in order (spec, Proposed Solution 7). Cancelled lots are ignored.

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
     AND su."effectiveNettable" = false
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

CREATE INDEX IF NOT EXISTS "trackedEntity_companyId_receiptLine_idx"
  ON "trackedEntity" ("companyId", ("attributes" ->> 'Receipt Line'))
  WHERE ("attributes" ->> 'Receipt Line') IS NOT NULL;

CREATE INDEX IF NOT EXISTS "itemLedger_untracked_storageUnit_item_idx"
  ON "itemLedger" ("storageUnitId", "itemId", "companyId") INCLUDE ("quantity")
  WHERE "trackedEntityId" IS NULL;

-- A data fix, not user activity: keep it out of the event queue (audit log,
-- webhooks, workflows). Transaction-local.
SELECT set_config('app.sync_in_progress', 'true', true);

UPDATE "receiptLine" rl
SET "requiresInspection" = true
WHERE EXISTS (
  SELECT 1 FROM "inspection" i
  WHERE i."sourceDocument" = 'Receipt' AND i."sourceDocumentLineId" = rl."id"
);

UPDATE "inspection" i
SET "storageUnitId" = rl."storageUnitId"
FROM "receiptLine" rl
WHERE i."sourceDocument" = 'Receipt'
  AND i."sourceDocumentLineId" = rl."id"
  AND i."storageUnitId" IS NULL
  AND i."status" <> 'Failed';

UPDATE "inspection" i
SET "storageUnitId" = NULL
FROM "item" it
WHERE it."id" = i."itemId"
  AND it."companyId" = i."companyId"
  AND it."itemTrackingType" = 'Non-Inventory'
  AND i."sourceDocument" = 'Receipt'
  AND i."storageUnitId" IS NOT NULL;

-- A voided receipt left its open lots Pending; close them.
UPDATE "inspection" i
SET "status" = 'Cancelled'
FROM "receipt" r
WHERE i."sourceDocument" = 'Receipt'
  AND i."sourceDocumentId" = r."id"
  AND r."status" = 'Voided'
  AND i."status" IN ('Pending', 'In Progress');

UPDATE "inspection" i
SET "storageUnitId" = NULL
FROM "storageUnit" su
WHERE su."id" = i."storageUnitId"
  AND su."effectiveNettable" = true
  AND i."sourceDocument" = 'Receipt'
  AND i."status" IN ('Pending', 'In Progress', 'Partial');

SELECT public.refresh_receipt_inspection_status(r."id")
FROM "receipt" r
WHERE EXISTS (
  SELECT 1 FROM "inspection" i
  WHERE i."sourceDocument" = 'Receipt' AND i."sourceDocumentId" = r."id"
);

NOTIFY pgrst, 'reload schema';

RESET lock_timeout;
