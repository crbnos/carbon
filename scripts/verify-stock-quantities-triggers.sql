-- Trigger proof for the incrementally-maintained itemStockQuantities.
--
-- Runs inside a transaction that is ROLLED BACK, so the restored snapshot is
-- left untouched. Every assertion RAISEs on failure -- a silent pass is not
-- possible.
--
-- Covers the three write shapes that actually occur:
--   A. single-row INSERT            (a posting)
--   B. multi-row INSERT             (a bulk posting -- one statement, one upsert)
--   C. trackedEntity status flip    (the multi-row UPDATE issued by
--                                    sync_item_ledger_on_tracked_entity_status_change)
-- plus a global drift check after each.

\set ON_ERROR_STOP on
\pset pager off

BEGIN;

CREATE OR REPLACE VIEW _recompute AS
SELECT
  "itemId",
  "companyId",
  COALESCE("locationId", '') AS "locationId",
  COALESCE(SUM(item_ledger_on_hand_contribution("quantity", "trackedEntityStatus")), 0) AS "quantityOnHand"
FROM "itemLedger"
GROUP BY "itemId", "companyId", COALESCE("locationId", '');

CREATE OR REPLACE FUNCTION _assert_no_drift(label TEXT)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE extra INT; missing INT;
BEGIN
  SELECT count(*) INTO extra FROM (
    SELECT * FROM "itemStockQuantities" EXCEPT SELECT * FROM _recompute) t;
  SELECT count(*) INTO missing FROM (
    SELECT * FROM _recompute EXCEPT SELECT * FROM "itemStockQuantities") t;
  IF extra <> 0 OR missing <> 0 THEN
    RAISE EXCEPTION '% -> DRIFT: % extra, % missing', label, extra, missing;
  END IF;
  RAISE NOTICE '% -> no drift', label;
END $$;

-- ---------------------------------------------------------------------------
-- A. Single-row INSERT
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_item TEXT; v_company TEXT; v_location TEXT;
  before_qty NUMERIC; after_qty NUMERIC;
BEGIN
  SELECT "itemId", "companyId", "locationId", "quantityOnHand"
    INTO v_item, v_company, v_location, before_qty
  FROM "itemStockQuantities"
  WHERE "locationId" <> ''
  ORDER BY "quantityOnHand" DESC
  LIMIT 1;

  INSERT INTO "itemLedger" ("entryType", "itemId", "locationId", "quantity", "companyId")
  VALUES ('Positive Adjmt.', v_item, v_location, 7, v_company);

  SELECT "quantityOnHand" INTO after_qty FROM "itemStockQuantities"
  WHERE "itemId" = v_item AND "companyId" = v_company AND "locationId" = v_location;

  IF after_qty <> before_qty + 7 THEN
    RAISE EXCEPTION 'A: single INSERT: expected %, got %', before_qty + 7, after_qty;
  END IF;
  RAISE NOTICE 'A: single INSERT +7 -> % (was %)', after_qty, before_qty;
END $$;

SELECT _assert_no_drift('A: after single INSERT');

-- ---------------------------------------------------------------------------
-- B. Multi-row INSERT in ONE statement (the statement-level path)
--    Two rows for the SAME key must aggregate into a single upsert.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_item TEXT; v_company TEXT; v_location TEXT;
  before_qty NUMERIC; after_qty NUMERIC;
BEGIN
  SELECT "itemId", "companyId", "locationId", "quantityOnHand"
    INTO v_item, v_company, v_location, before_qty
  FROM "itemStockQuantities"
  WHERE "locationId" <> ''
  ORDER BY "quantityOnHand" DESC
  LIMIT 1;

  INSERT INTO "itemLedger" ("entryType", "itemId", "locationId", "quantity", "companyId")
  SELECT 'Positive Adjmt.', v_item, v_location, q, v_company
  FROM (VALUES (100), (250), (-50)) AS v(q);

  SELECT "quantityOnHand" INTO after_qty FROM "itemStockQuantities"
  WHERE "itemId" = v_item AND "companyId" = v_company AND "locationId" = v_location;

  IF after_qty <> before_qty + 300 THEN
    RAISE EXCEPTION 'B: bulk INSERT: expected %, got %', before_qty + 300, after_qty;
  END IF;
  RAISE NOTICE 'B: bulk INSERT (3 rows, net +300) -> % (was %)', after_qty, before_qty;
END $$;

SELECT _assert_no_drift('B: after bulk INSERT');

-- ---------------------------------------------------------------------------
-- C. trackedEntity status flip -> Rejected and back
--    This is the ONLY in-place UPDATE that happens in production, and it is
--    issued as a multi-row UPDATE by the status sync trigger.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_entity TEXT; v_item TEXT; v_company TEXT; v_location TEXT;
  v_status "trackedEntityStatus";
  entity_qty NUMERIC; before_qty NUMERIC; after_qty NUMERIC; restored_qty NUMERIC;
BEGIN
  SELECT il."trackedEntityId", il."itemId", il."companyId", COALESCE(il."locationId", ''),
         te."status", SUM(il."quantity")
    INTO v_entity, v_item, v_company, v_location, v_status, entity_qty
  FROM "itemLedger" il
  JOIN "trackedEntity" te ON te."id" = il."trackedEntityId"
  WHERE il."trackedEntityId" IS NOT NULL
    AND (il."trackedEntityStatus" IS NULL OR il."trackedEntityStatus" <> 'Rejected')
    AND il."quantity" <> 0
  GROUP BY 1, 2, 3, 4, 5
  HAVING SUM(il."quantity") <> 0
  LIMIT 1;

  IF v_entity IS NULL THEN
    RAISE NOTICE 'C: SKIPPED - no eligible tracked entity in this snapshot';
    RETURN;
  END IF;

  SELECT "quantityOnHand" INTO before_qty FROM "itemStockQuantities"
  WHERE "itemId" = v_item AND "companyId" = v_company AND "locationId" = v_location;

  UPDATE "trackedEntity" SET "status" = 'Rejected' WHERE "id" = v_entity;

  SELECT "quantityOnHand" INTO after_qty FROM "itemStockQuantities"
  WHERE "itemId" = v_item AND "companyId" = v_company AND "locationId" = v_location;

  IF after_qty <> before_qty - entity_qty THEN
    RAISE EXCEPTION 'C: flip to Rejected: expected %, got %', before_qty - entity_qty, after_qty;
  END IF;
  RAISE NOTICE 'C: entity % -> Rejected, on-hand % -> % (-%)', v_entity, before_qty, after_qty, entity_qty;

  UPDATE "trackedEntity" SET "status" = v_status WHERE "id" = v_entity;

  SELECT "quantityOnHand" INTO restored_qty FROM "itemStockQuantities"
  WHERE "itemId" = v_item AND "companyId" = v_company AND "locationId" = v_location;

  IF restored_qty <> before_qty THEN
    RAISE EXCEPTION 'C: flip back: expected %, got %', before_qty, restored_qty;
  END IF;
  RAISE NOTICE 'C: entity % -> %, on-hand restored to %', v_entity, v_status, restored_qty;
END $$;

SELECT _assert_no_drift('C: after tracked-entity status flip');

-- ---------------------------------------------------------------------------
-- D. Reconciliation is a no-op when the triggers have kept up
-- ---------------------------------------------------------------------------
SELECT reconcile_item_stock_quantities();
SELECT _assert_no_drift('D: after reconciliation');

ROLLBACK;
