-- Tenant-scope "onshapeItemSyncState"."itemId", the way 20260703143904 did it for
-- customer/supplier: a composite FK so the database itself rejects a sync-state
-- row in company A pointing at company B's item.
--
-- Its own migration, separate from 20260827091812, because of what it costs
-- rather than what it does. Adding a UNIQUE constraint takes ACCESS EXCLUSIVE on
-- "item" -- which conflicts with EVERY other lock mode, so it blocks reads too,
-- not just writes: every SELECT on "item", and every query through the many views
-- that join it, queues behind the index build. "item" is also in the realtime
-- publication, and the dev runner already retries migrations on deadlock because
-- PostgREST and Realtime hold catalog locks that race with ALTER TABLE. Postgres
-- holds locks to end of transaction and the supabase CLI applies a file as one
-- transaction, so CREATE UNIQUE INDEX CONCURRENTLY is not available here and the
-- lock spans this whole file. On a large catalog treat it as a maintenance
-- window, not a routine deploy -- and keeping it separate means it can be held
-- back, or run on its own, without stranding the sync-state constraints.
--
-- The constraint itself cannot fail on existing rows: "item_pkey" is PRIMARY KEY
-- ("id") alone, so ("id", "companyId") is trivially unique.
--
-- This also closes the hole for exactly one of the ~78 single-column
-- REFERENCES "item"("id") in the schema. The unique key it adds is what a sweep
-- over the rest would need, so the guard below is deliberate: a later migration
-- can add the same key under the same name and find it already there.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'item_id_companyId_key' AND conrelid = '"item"'::regclass
  ) THEN
    ALTER TABLE "item" ADD CONSTRAINT "item_id_companyId_key" UNIQUE ("id", "companyId");
  END IF;
END $$;

-- Same constraint name, so PostgREST embeds and FK-name hints keep resolving.
ALTER TABLE "onshapeItemSyncState" DROP CONSTRAINT "onshapeItemSyncState_itemId_fkey";

ALTER TABLE "onshapeItemSyncState"
    ADD CONSTRAINT "onshapeItemSyncState_itemId_fkey"
    FOREIGN KEY ("itemId", "companyId")
    REFERENCES "item"("id", "companyId")
    ON DELETE CASCADE
    NOT VALID;

-- NOT VALID above, then validated here inside a subtransaction, so a pre-existing
-- cross-company row leaves the constraint unvalidated with a warning instead of
-- failing the migration and blocking every later one. New writes are enforced
-- either way. This is the precedent's rule -- "written to NEVER fail on
-- pre-existing bad rows" -- and it is the only thing the NOT VALID split buys
-- here: both statements share one transaction, so the lock footprint is the same
-- as adding the constraint validated outright.
DO $$
BEGIN
  ALTER TABLE "onshapeItemSyncState" VALIDATE CONSTRAINT "onshapeItemSyncState_itemId_fkey";
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'item-composite-tenant-key: "onshapeItemSyncState" has pre-existing cross-company itemId rows; constraint stays NOT VALID. Clean them, then: ALTER TABLE "onshapeItemSyncState" VALIDATE CONSTRAINT "onshapeItemSyncState_itemId_fkey";';
END $$;
