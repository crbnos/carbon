-- itemStockQuantities: materialized view -> incrementally maintained table.
--
-- The matview was a full scan of itemLedger refreshed by pg_cron every 30 min,
-- so the item-dropdown badge could be ~40 min stale (30 min cron + the client's
-- 10 min poll). Scan cost also grew with total ledger history, for every tenant
-- at once, 48 times a day.
--
-- itemLedger is effectively append-only -- the only in-place UPDATE is the
-- denormalized "trackedEntityStatus" column, itself maintained by
-- sync_item_ledger_on_tracked_entity_status_change (20260420112047) -- so the
-- aggregate can be maintained by signed deltas at O(rows written) instead of
-- recomputed at O(all history).
--
-- Relation name and columns are unchanged: RealtimeDataProvider.tsx and the
-- workflow engine's item.quantityOnHand operation read it by name.

-- ---------------------------------------------------------------------------
-- 1. Stop the periodic refresh
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-item-stock-quantities') THEN
    PERFORM cron.unschedule('refresh-item-stock-quantities');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. The on-hand filter, defined exactly once
--
-- Every delta the triggers apply and the reconciliation recompute go through
-- this, so the incremental path cannot drift from the batch path. Mirrors the
-- matview's `SUM(quantity) FILTER (WHERE status IS NULL OR status <> 'Rejected')`.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION item_ledger_on_hand_contribution(
  quantity NUMERIC,
  tracked_entity_status "trackedEntityStatus"
)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN tracked_entity_status IS NULL OR tracked_entity_status <> 'Rejected'
      THEN COALESCE(quantity, 0)
    ELSE 0
  END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Replace the matview with a real table
--
-- quantityOnHand is NOT NULL DEFAULT 0 where the matview's SUM(...) FILTER
-- could yield NULL (a group whose rows are all Rejected). Both consumers
-- already coerce null -> 0, so this normalizes rather than changes behaviour.
-- ---------------------------------------------------------------------------

DROP MATERIALIZED VIEW IF EXISTS "itemStockQuantities";

-- Convention exceptions, deliberate: this is DERIVED state, not an entity.
-- The natural key (itemId, companyId, locationId) IS the identity — a surrogate
-- id() would add no meaning and would break the ON CONFLICT upserts the trigger
-- depends on. Audit columns are omitted for the same reason: every row is
-- written by a trigger or the reconciliation job, never by a user, so
-- createdBy/updatedBy would record 'system' forever on a hot-path table. The
-- matview this replaces had neither.
CREATE TABLE "itemStockQuantities" (
  "itemId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  -- '' is the bucket for ledger rows with no location, matching the matview's
  -- COALESCE("locationId", ''). Part of the key, so it cannot be NULL.
  "locationId" TEXT NOT NULL DEFAULT '',
  "quantityOnHand" NUMERIC NOT NULL DEFAULT 0,

  PRIMARY KEY ("itemId", "companyId", "locationId")
);

CREATE INDEX "itemStockQuantities_companyId_idx"
  ON "itemStockQuantities" ("companyId");

-- ---------------------------------------------------------------------------
-- 4. Backfill from the ledger (same statement the matview used)
-- ---------------------------------------------------------------------------

INSERT INTO "itemStockQuantities" ("itemId", "companyId", "locationId", "quantityOnHand")
SELECT
  "itemId",
  "companyId",
  COALESCE("locationId", ''),
  COALESCE(SUM(item_ledger_on_hand_contribution("quantity", "trackedEntityStatus")), 0)
FROM "itemLedger"
GROUP BY "itemId", "companyId", COALESCE("locationId", '');

-- ---------------------------------------------------------------------------
-- 5. Incremental maintenance -- a statement-level event handler
--
-- Statement-level so a bulk posting is one upsert rather than N (this includes
-- the multi-row UPDATE the trackedEntity status sync issues). SECURITY DEFINER
-- because itemLedger has no UPDATE RLS policy and writers hold no grants on the
-- aggregate. ORDER BY on the key so concurrent statements take row locks in a
-- consistent order (deadlock avoidance).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION apply_item_stock_quantities()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql
SECURITY DEFINER
-- Pinned: this runs on every itemLedger write, so the caller is an ordinary
-- application role. Without it, unqualified names resolve through a
-- caller-controlled search_path.
SET search_path = public, pg_temp;

SELECT attach_statement_handler('itemLedger', ARRAY['apply_item_stock_quantities']);

-- ---------------------------------------------------------------------------
-- 6. RLS
--
-- The matview could not carry RLS at all -- tenant isolation depended on every
-- caller remembering .eq("companyId", ...). A real table closes that.
--
-- Reads only: the triggers and reconciliation are SECURITY DEFINER, so no
-- INSERT/UPDATE/DELETE policy exists and PostgREST clients cannot write.
-- get_companies_with_employee_role() is wrapped in a SELECT so it is evaluated
-- once per query rather than once per row.
-- ---------------------------------------------------------------------------

ALTER TABLE "public"."itemStockQuantities" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."itemStockQuantities"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

GRANT SELECT ON "public"."itemStockQuantities" TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Realtime: let the client patch the badge instead of waiting for its poll
-- ---------------------------------------------------------------------------

ALTER PUBLICATION supabase_realtime ADD TABLE "itemStockQuantities";

-- ---------------------------------------------------------------------------
-- 8. Nightly reconciliation
--
-- The triggers are the source of truth; this is the backstop that converges any
-- drift (a write path that bypassed the triggers, a hand-run SQL fix) and drops
-- keys whose ledger rows are gone. One pass a night costs about the same as a
-- single one of the 48 daily refreshes this migration removes.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION reconcile_item_stock_quantities()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
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
    ("itemId", "companyId", "locationId", "quantityOnHand")
  SELECT
    "itemId",
    "companyId",
    COALESCE("locationId", ''),
    COALESCE(SUM(item_ledger_on_hand_contribution("quantity", "trackedEntityStatus")), 0)
  FROM "itemLedger"
  GROUP BY "itemId", "companyId", COALESCE("locationId", '')
  ORDER BY 1, 2, 3
  ON CONFLICT ("itemId", "companyId", "locationId")
  DO UPDATE SET "quantityOnHand" = EXCLUDED."quantityOnHand"
  WHERE isq."quantityOnHand" IS DISTINCT FROM EXCLUDED."quantityOnHand";

  DELETE FROM "itemStockQuantities" isq
  WHERE NOT EXISTS (
    SELECT 1
    FROM "itemLedger" il
    WHERE il."itemId" = isq."itemId"
      AND il."companyId" = isq."companyId"
      AND COALESCE(il."locationId", '') = isq."locationId"
  );
END;
$$;

SELECT cron.schedule(
  'reconcile-item-stock-quantities',
  '15 3 * * *',
  $$SELECT reconcile_item_stock_quantities();$$
);
