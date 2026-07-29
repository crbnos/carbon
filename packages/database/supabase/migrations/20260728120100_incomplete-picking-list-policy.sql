-- Part 2 of the MES material-picking behavior change: stop a short-picked list
-- from silently completing.
--
-- 1. A company-wide policy controlling what happens when an operator presses
--    Finish with material still unpicked: 'warn' (acknowledge & continue) or
--    'error' (blocked until resolved). Mirrors the storage-rule severity shape.
-- 2. Teach the automatic header-status trigger about the 'Partial' value added
--    in 20260728120000: when every line is resolved but at least one is Short,
--    the list is Partial rather than Completed, and an unpick must never leave
--    the header stuck on a terminal completion state.

ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "incompletePickingListPolicy" TEXT NOT NULL DEFAULT 'warn'
  CHECK ("incompletePickingListPolicy" IN ('warn', 'error'));

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
        AND "companyId" = NEW."companyId"
        AND "status" <> 'Cancelled'
        AND ("quantityPicked" IS NULL OR "quantityPicked" < "quantityToPick")
    ) THEN
      -- All lines resolved. If any non-Cancelled line is Short, the list came up
      -- short → Partial; otherwise everything was picked → Completed. Never
      -- override a Cancelled header.
      IF EXISTS (
        SELECT 1 FROM "pickingListLine"
        WHERE "pickingListId" = NEW."pickingListId"
          AND "companyId" = NEW."companyId"
          AND "status" = 'Short'
      ) THEN
        UPDATE "pickingList"
        SET "status" = 'Partial'
        WHERE "id" = NEW."pickingListId"
          AND "companyId" = NEW."companyId"
          AND "status" <> 'Cancelled';
      ELSE
        UPDATE "pickingList"
        SET "status" = 'Completed'
        WHERE "id" = NEW."pickingListId"
          AND "companyId" = NEW."companyId"
          AND "status" <> 'Cancelled';
      END IF;
    ELSE
      -- Work remains: never leave the header stuck on a terminal completion
      -- state (Completed or Partial) after an unpick, and move a still-Draft
      -- list to In Progress on first progress.
      UPDATE "pickingList"
      SET "status" = 'In Progress'
      WHERE "id" = NEW."pickingListId"
        AND "companyId" = NEW."companyId"
        AND ("status" IN ('Completed', 'Partial')
             OR ("status" = 'Draft' AND EXISTS (
               SELECT 1 FROM "pickingListLine"
               WHERE "pickingListId" = NEW."pickingListId"
                 AND "companyId" = NEW."companyId"
                 AND (COALESCE("quantityPicked", 0) > 0
                      OR "status" IN ('Picked', 'Short', 'Cancelled'))
             )));
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
