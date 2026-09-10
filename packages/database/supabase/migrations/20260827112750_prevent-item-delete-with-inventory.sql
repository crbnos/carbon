-- ============================================================================
-- Migration: prevent-item-delete-with-inventory
--
-- Problem:
--   Hard-deleting an "item" that still has inventory history silently destroys
--   and orphans data. The delete path (client.from("item").delete()) does no
--   application-level checks and relies entirely on FK behavior, which is
--   inconsistent across the inventory ledgers:
--
--     * "itemLedger".itemId  -> ON DELETE CASCADE  (on-hand source of truth):
--         deleting the item CASCADE-deletes every ledger row, destroying the
--         on-hand quantity + movement history with no warning.
--     * "costLedger".itemId  -> NO foreign key at all (cost/valuation layers):
--         the rows are left orphaned, pointing at a now-deleted item, so the
--         GL inventory value can no longer be traced back to a part.
--
--   Serial/Batch items are already protected -- "trackedEntity".itemId has an
--   ON DELETE RESTRICT FK (20260426000000_tracked-entity-item-fk.sql) -- but a
--   plain "Inventory" tracking-type item with stock has no such guard.
--
-- Fix:
--   Make an item with inventory history un-deletable, so callers deactivate
--   (item.active = false) instead -- the same "deactivate the item instead"
--   pattern the trackedEntity FK already establishes.
--
--     1. Repoint "itemLedger".itemId FK from ON DELETE CASCADE to NO ACTION.
--     2. Add a "costLedger".itemId FK to "item"("id") with ON DELETE NO ACTION
--        (NOT VALID -- pre-existing orphan rows from past deletions must not
--        block the migration; the constraint is still enforced for new/changed
--        rows and for the referential action going forward).
--
-- Why NO ACTION and not RESTRICT:
--   The whole-company delete (settings.service.ts deleteSubsidiary ->
--   DELETE FROM "company") relies on "company" CASCADE-ing to "item",
--   "itemLedger" and "costLedger" together. RESTRICT is checked immediately
--   (mid-cascade) and would abort that delete if the item row is removed before
--   its ledger rows. NO ACTION defers the check to end-of-statement, by which
--   time the company->itemLedger / company->costLedger cascades have emptied the
--   children -- so the company delete still succeeds, while a single-item delete
--   (nothing else removes the ledger rows) is still blocked with SQLSTATE 23503.
--   The bulk wipe (datasets/wipe.ts) and backup restore (company-backup.ts) are
--   unaffected: they delete children before parents / disable RI triggers.
--
-- The route x+/items+/delete.$itemId.tsx maps the resulting 23503 to a friendly
-- "Item has inventory transactions or stock on hand..." message.
-- ============================================================================

-- 1. itemLedger.itemId: CASCADE -> NO ACTION. Re-created under the same name so
--    the app's error mapper keeps matching "itemLedger_itemId_fkey".
--
--    The DROP + ADD run together in this migration's transaction (the Supabase
--    CLI wraps each migration file in one txn -- which is why enum ADD VALUE
--    cannot share a file with statements that use it), so there is never a
--    window where itemLedger has no FK to item.
--
--    Added NOT VALID here, and VALIDATEd in a SEPARATE later migration
--    (20260827115500_validate-item-ledger-item-fk). Splitting the validation
--    into its own transaction is what makes it cheap: the NOT VALID add takes
--    the write-blocking ShareRowExclusive lock only momentarily (no scan) and
--    already enforces ON DELETE NO ACTION plus the check on new/changed rows;
--    the follow-up VALIDATE scans existing rows under the lighter
--    ShareUpdateExclusive lock, which does not block reads or writes. In the
--    same file the ShareRowExclusive lock would be held until COMMIT, so the
--    scan would still block writes -- the split is pointless unless VALIDATE
--    runs after this migration commits. (Repo convention, cf.
--    20260703143904_composite-tenant-fks.sql.)
ALTER TABLE "itemLedger"
  DROP CONSTRAINT "itemLedger_itemId_fkey";

ALTER TABLE "itemLedger"
  ADD CONSTRAINT "itemLedger_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id")
    ON DELETE NO ACTION ON UPDATE CASCADE
    NOT VALID;

-- 2. costLedger.itemId: add the missing FK. NOT VALID skips the scan of
--    existing rows (past deletions left orphans with itemId pointing at a
--    now-deleted item), but the ON DELETE NO ACTION action and the check on
--    new/changed rows are enforced immediately. costLedger.itemId is nullable,
--    so a NULL itemId trivially satisfies the constraint.
ALTER TABLE "costLedger"
  ADD CONSTRAINT "costLedger_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id")
    ON DELETE NO ACTION ON UPDATE CASCADE
    NOT VALID;
