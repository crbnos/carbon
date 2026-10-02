-- Running on-hand balance for the inventory activity feed.
--
-- The feed (Inventory → Quantities → item → Activity) pages itemLedger rows
-- newest→oldest by "entryNumber", 20 at a time. To show "before → after" on
-- every row it needs ONE number per session: the on-hand right after the
-- newest row it loaded. Every other balance is derived client-side by walking
-- the contiguous pages and adding/subtracting each row's quantity, so paging
-- costs no extra queries.
--
-- get_item_ledger_balance returns that number, on the same definition as
-- get_inventory_quantities."quantityOnHand" so the top of the feed matches the
-- On Hand column:
--
--   balance after entry N = on-hand now − Σ rows with entryNumber > N
--
-- "On-hand now" comes from the itemLedgerSnapshot + live delta (cheap however
-- long the item's history is), and the suffix is usually empty or a handful of
-- rows — the feed anchors on the newest entry unless it was opened on a
-- highlighted older one. Both halves count a row through
-- item_ledger_on_hand_contribution, so a Rejected tracked entity's rows add
-- zero, exactly as quantityOnHand does.

-- The feed orders one item's rows at one location by entryNumber. The existing
-- ("companyId", "locationId", "itemId") index found the rows but left a sort of
-- the item's whole history behind every 20-row page; with entryNumber appended
-- both the page and the suffix sum below are a bounded index range scan.
CREATE INDEX IF NOT EXISTS "itemLedger_companyId_locationId_itemId_entryNumber_idx"
  ON "itemLedger" ("companyId", "locationId", "itemId", "entryNumber");

CREATE OR REPLACE FUNCTION get_item_ledger_balance(
  company_id TEXT,
  location_id TEXT,
  item_id TEXT,
  entry_number INTEGER DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff TIMESTAMPTZ;
  v_on_hand NUMERIC;
  v_after NUMERIC := 0;
BEGIN
  PERFORM assert_company_access(company_id);

  SELECT MAX("snapshotCutoff") INTO v_cutoff
  FROM "itemLedgerSnapshot"
  WHERE "companyId" = company_id;

  -- Same three arms as get_inventory_quantities: snapshotted untracked rows,
  -- live tracked rows (their status is rewritten in place, so never
  -- snapshotted), and untracked rows newer than the snapshot cutoff.
  SELECT COALESCE(SUM(combined."quantity"), 0) INTO v_on_hand
  FROM (
    SELECT s."quantity"
    FROM "itemLedgerSnapshot" s
    WHERE s."companyId" = company_id
      AND s."locationId" = location_id
      AND s."itemId" = item_id

    UNION ALL

    SELECT item_ledger_on_hand_contribution(il."quantity", il."trackedEntityStatus")
    FROM "itemLedger" il
    WHERE il."companyId" = company_id
      AND il."locationId" = location_id
      AND il."itemId" = item_id
      AND il."trackedEntityId" IS NOT NULL

    UNION ALL

    SELECT il."quantity"
    FROM "itemLedger" il
    WHERE il."companyId" = company_id
      AND il."locationId" = location_id
      AND il."itemId" = item_id
      AND il."trackedEntityId" IS NULL
      AND (v_cutoff IS NULL OR il."createdAt" >= v_cutoff)
  ) combined;

  IF entry_number IS NOT NULL THEN
    SELECT COALESCE(SUM(
      item_ledger_on_hand_contribution(il."quantity", il."trackedEntityStatus")
    ), 0) INTO v_after
    FROM "itemLedger" il
    WHERE il."companyId" = company_id
      AND il."locationId" = location_id
      AND il."itemId" = item_id
      AND il."entryNumber" > entry_number;
  END IF;

  RETURN v_on_hand - v_after;
END;
$$;
