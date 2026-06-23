-- ============================================================================
-- Fix: a Short line must NOT auto-complete (and lock) a picking list.
--
-- Previously `update_picking_list_status` treated a line marked Short as fully
-- "resolved", so once every other line was picked the header jumped to
-- Completed — even with an unresolved shortage. This bit hardest after a
-- reopen (header → Draft, lines still resolved): picking a single item slammed
-- the list back to Completed and re-locked it.
--
-- Now an outstanding Short line keeps the list In Progress. Cancelled lines are
-- still terminal (the requirement is gone). The list completes via the explicit
-- Complete button — so a shortage is always acknowledged by a human, never
-- silently finalized.
-- ============================================================================

CREATE OR REPLACE FUNCTION update_picking_list_status()
RETURNS TRIGGER AS $$
BEGIN
  -- Only react to picked-quantity or status changes
  IF (OLD."quantityPicked" IS DISTINCT FROM NEW."quantityPicked")
     OR (OLD."status" IS DISTINCT FROM NEW."status") THEN

    IF NOT EXISTS (
      -- no line still outstanding (fully picked, or Cancelled). A Short line
      -- that isn't fully picked still counts as outstanding work.
      SELECT 1 FROM "pickingListLine"
      WHERE "pickingListId" = NEW."pickingListId"
        AND "status" <> 'Cancelled'
        AND ("quantityPicked" IS NULL OR "quantityPicked" < "quantityToPick")
    ) THEN
      -- All lines resolved → Completed (never override a Cancelled header).
      UPDATE "pickingList"
      SET "status" = 'Completed'
      WHERE "id" = NEW."pickingListId"
        AND "status" <> 'Cancelled';
    ELSE
      -- Work remains: never leave the header stuck on Completed (e.g. after an
      -- unpick), and move a still-Draft list to In Progress on first progress.
      UPDATE "pickingList"
      SET "status" = 'In Progress'
      WHERE "id" = NEW."pickingListId"
        AND ("status" = 'Completed'
             OR ("status" = 'Draft' AND EXISTS (
               SELECT 1 FROM "pickingListLine"
               WHERE "pickingListId" = NEW."pickingListId"
                 AND (COALESCE("quantityPicked", 0) > 0
                      OR "status" IN ('Picked', 'Short', 'Cancelled'))
             )));
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
