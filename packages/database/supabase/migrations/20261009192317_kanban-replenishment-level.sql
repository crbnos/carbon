-- Kanban replenishment level: a Transfer kanban fires when the projected
-- quantity at its To storage unit is below this level.
-- Spec: .ai/specs/2026-10-06-kanban-internal-replenishment-level.md

-- 1. The level on the kanban
ALTER TABLE "kanban" ADD COLUMN IF NOT EXISTS "replenishmentLevel" NUMERIC;

ALTER TABLE "kanban" DROP CONSTRAINT IF EXISTS "kanban_replenishmentLevel_check";
ALTER TABLE "kanban"
  ADD CONSTRAINT "kanban_replenishmentLevel_check"
  CHECK ("replenishmentLevel" IS NULL OR "replenishmentLevel" >= 0);

COMMENT ON COLUMN "kanban"."replenishmentLevel" IS
  'Transfer kanbans only. When the projected quantity at the To storage unit is below this level, Carbon creates a Released stock transfer for "quantity". NULL = scan-only.';

-- A Transfer kanban must not feed itself. The zod refine exists; this stops API writes.
ALTER TABLE "kanban" DROP CONSTRAINT IF EXISTS "kanban_transfer_distinct_storage_units_check";
ALTER TABLE "kanban"
  ADD CONSTRAINT "kanban_transfer_distinct_storage_units_check"
  CHECK (
    "replenishmentSystem" <> 'Transfer'
    OR "fromStorageUnitId" IS NULL
    OR "storageUnitId" IS NULL
    OR "fromStorageUnitId" <> "storageUnitId"
  );

-- From a ledger row to its armed kanbans
CREATE INDEX IF NOT EXISTS "kanban_level_lookup_idx"
  ON "kanban" ("companyId", "itemId", "storageUnitId")
  WHERE "replenishmentSystem" = 'Transfer' AND "replenishmentLevel" IS NOT NULL;

-- 2. The kanbans view expands k.* at creation, so recreate it to expose the new column.
DROP VIEW IF EXISTS "kanbans";
CREATE VIEW "kanbans" WITH(SECURITY_INVOKER=true) AS
SELECT
  k.*,
  i.name,
  i."readableIdWithRevision",
  j."jobId" as "jobReadableId",
  l.name as "locationName",
  s.name as "storageUnitName",
  fs.name as "fromStorageUnitName",
  su.name as "supplierName",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END AS "thumbnailPath"
FROM "kanban" k
JOIN "item" i ON k."itemId" = i."id"
LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
JOIN "location" l ON k."locationId" = l."id"
LEFT JOIN "storageUnit" s ON k."storageUnitId" = s."id"
LEFT JOIN "storageUnit" fs ON k."fromStorageUnitId" = fs."id"
LEFT JOIN "supplier" su ON k."supplierId" = su."id"
LEFT JOIN "job" j ON k."jobId" = j."id";

-- 3. The origin on the stock transfer
ALTER TABLE "stockTransfer" ADD COLUMN IF NOT EXISTS "kanbanId" TEXT;

ALTER TABLE "stockTransfer" DROP CONSTRAINT IF EXISTS "stockTransfer_kanbanId_fkey";
ALTER TABLE "stockTransfer"
  ADD CONSTRAINT "stockTransfer_kanbanId_fkey"
  FOREIGN KEY ("kanbanId", "companyId") REFERENCES "kanban" ("id", "companyId")
  ON DELETE SET NULL ("kanbanId");

CREATE INDEX IF NOT EXISTS "stockTransfer_kanbanId_idx"
  ON "stockTransfer" ("kanbanId") WHERE "kanbanId" IS NOT NULL;

-- 4. Projected quantity for the armed kanbans of one company.
-- kanban_ids NULL = every armed kanban of the company.
-- On-hand uses item_ledger_on_hand_contribution, the itemStockQuantities definition.
CREATE OR REPLACE FUNCTION get_kanban_projected_quantities(
  company_id TEXT,
  kanban_ids TEXT[] DEFAULT NULL
)
RETURNS TABLE ("kanbanId" TEXT, "replenishmentLevel" NUMERIC, "projectedQuantity" NUMERIC)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    k."id",
    k."replenishmentLevel",
    COALESCE(on_hand."quantity", 0) + COALESCE(inbound."quantity", 0)
  FROM "kanban" k
  LEFT JOIN LATERAL (
    SELECT SUM(item_ledger_on_hand_contribution(il."quantity", il."trackedEntityStatus")) AS "quantity"
    FROM "itemLedger" il
    WHERE il."companyId" = k."companyId"
      AND il."locationId" = k."locationId"
      AND il."itemId" = k."itemId"
      AND il."storageUnitId" = k."storageUnitId"
  ) on_hand ON true
  LEFT JOIN LATERAL (
    SELECT SUM(stl."outstandingQuantity") AS "quantity"
    FROM "stockTransferLine" stl
    JOIN "stockTransfer" st
      ON st."id" = stl."stockTransferId" AND st."companyId" = stl."companyId"
    WHERE stl."companyId" = k."companyId"
      AND st."status" IN ('Released', 'In Progress')
      AND stl."itemId" = k."itemId"
      AND stl."toStorageUnitId" = k."storageUnitId"
  ) inbound ON true
  WHERE k."companyId" = company_id
    AND (kanban_ids IS NULL OR k."id" = ANY (kanban_ids))
    AND k."replenishmentSystem" = 'Transfer'
    AND k."replenishmentLevel" IS NOT NULL
    AND k."fromStorageUnitId" IS NOT NULL
    AND k."storageUnitId" IS NOT NULL;
$$;

-- 5. Backstop sweep: every armed kanban below its level, one row per company.
CREATE OR REPLACE FUNCTION util.kanban_level_breaches()
RETURNS TABLE ("companyId" TEXT, "kanbanIds" TEXT[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c."companyId", array_agg(p."kanbanId" ORDER BY p."kanbanId")
  FROM (
    SELECT DISTINCT "companyId" FROM "kanban"
    WHERE "replenishmentSystem" = 'Transfer' AND "replenishmentLevel" IS NOT NULL
  ) c
  CROSS JOIN LATERAL get_kanban_projected_quantities(c."companyId") p
  WHERE p."projectedQuantity" < p."replenishmentLevel"
  GROUP BY c."companyId";
$$;

CREATE OR REPLACE FUNCTION util.sweep_kanban_levels()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  breach RECORD;
BEGIN
  FOR breach IN SELECT * FROM util.kanban_level_breaches() LOOP
    PERFORM util.send_inngest_event(
      'carbon/kanban.level-check',
      jsonb_build_object('companyId', breach."companyId", 'kanbanIds', to_jsonb(breach."kanbanIds"))
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION util.kanban_level_breaches() FROM PUBLIC;
REVOKE ALL ON FUNCTION util.sweep_kanban_levels() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'kanban-level-sweeper') THEN
    PERFORM cron.unschedule('kanban-level-sweeper');
  END IF;
  PERFORM cron.schedule('kanban-level-sweeper', '7 * * * *', 'SELECT util.sweep_kanban_levels();');
END;
$$;
