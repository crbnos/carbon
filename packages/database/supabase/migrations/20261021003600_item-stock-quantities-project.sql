-- Projects Phase 2a: on-hand per project stock stripe.
-- The project is part of the key, with '' for common stock (a key column cannot be NULL),
-- matching the '' bucket "locationId" already uses. Existing rows are common stock.
-- 🛑 Ships with the generated authz migration that follows it: that one changes the
-- apply_item_stock_quantities handler's ON CONFLICT to the new key. Between the two, every
-- itemLedger insert fails.
-- Spec: .ai/specs/2026-10-03-projects.md (Phase 2: Project stock)

ALTER TABLE "itemStockQuantities" ADD COLUMN IF NOT EXISTS "projectId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "itemStockQuantities" DROP CONSTRAINT "itemStockQuantities_pkey";
ALTER TABLE "itemStockQuantities" ADD PRIMARY KEY ("itemId", "companyId", "locationId", "projectId");

-- The nightly backstop recomputes per stripe too. Redefined from
-- 20260812002454_item-stock-quantities-incremental.sql, with the SECURITY INVOKER that
-- 20260925121735_rpc-function-guards.sql set.
CREATE OR REPLACE FUNCTION reconcile_item_stock_quantities()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- The triggers apply RELATIVE deltas, which is safe under concurrency. This
  -- function writes an ABSOLUTE recompute, which is not: at READ COMMITTED a
  -- ledger write committing between this statement's snapshot and its row lock
  -- would have its delta overwritten — the drift repair would itself create
  -- drift. Hold a SHARE lock so no ledger write can interleave. SHARE conflicts
  -- with ROW EXCLUSIVE (INSERT/UPDATE/DELETE) but not with other readers, and
  -- this runs once nightly.
  LOCK TABLE "itemLedger" IN SHARE MODE;

  INSERT INTO "itemStockQuantities" AS isq
    ("itemId", "companyId", "locationId", "projectId", "quantityOnHand")
  SELECT
    "itemId",
    "companyId",
    COALESCE("locationId", ''),
    COALESCE("projectId", ''),
    COALESCE(SUM(item_ledger_on_hand_contribution("quantity", "trackedEntityStatus")), 0)
  FROM "itemLedger"
  GROUP BY "itemId", "companyId", COALESCE("locationId", ''), COALESCE("projectId", '')
  ORDER BY 1, 2, 3, 4
  ON CONFLICT ("itemId", "companyId", "locationId", "projectId")
  DO UPDATE SET "quantityOnHand" = EXCLUDED."quantityOnHand"
  WHERE isq."quantityOnHand" IS DISTINCT FROM EXCLUDED."quantityOnHand";

  DELETE FROM "itemStockQuantities" isq
  WHERE NOT EXISTS (
    SELECT 1
    FROM "itemLedger" il
    WHERE il."itemId" = isq."itemId"
      AND il."companyId" = isq."companyId"
      AND COALESCE(il."locationId", '') = isq."locationId"
      AND COALESCE(il."projectId", '') = isq."projectId"
  );
END;
$$;
