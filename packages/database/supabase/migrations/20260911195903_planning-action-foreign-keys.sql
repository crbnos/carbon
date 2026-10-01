-- Foreign keys for planningAction references (review follow-up on
-- 20260911041811_mrp-planning-actions.sql, which shipped without them).
-- All five referenced tables have single-column ("id") primary keys.
--
-- ON DELETE CASCADE throughout: a planning action is regenerable MRP output —
-- when its item/location/target disappears, the suggestion is meaningless and
-- must never block the delete or linger as an orphan until the next run.

-- Planning actions are rebuilt every MRP run, so purging pre-FK orphans is
-- safe and makes this migration idempotent against dirty data.
DELETE FROM "planningAction" pa
WHERE NOT EXISTS (SELECT 1 FROM "item" i WHERE i."id" = pa."itemId")
   OR NOT EXISTS (SELECT 1 FROM "location" l WHERE l."id" = pa."locationId")
   OR NOT EXISTS (SELECT 1 FROM "period" p WHERE p."id" = pa."periodId")
   OR (pa."purchaseOrderLineId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "purchaseOrderLine" pol WHERE pol."id" = pa."purchaseOrderLineId"))
   OR (pa."jobId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "job" j WHERE j."id" = pa."jobId"));

DO $$ BEGIN
  ALTER TABLE "planningAction"
    ADD CONSTRAINT "planningAction_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "planningAction"
    ADD CONSTRAINT "planningAction_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "planningAction"
    ADD CONSTRAINT "planningAction_periodId_fkey"
    FOREIGN KEY ("periodId") REFERENCES "period"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "planningAction"
    ADD CONSTRAINT "planningAction_purchaseOrderLineId_fkey"
    FOREIGN KEY ("purchaseOrderLineId") REFERENCES "purchaseOrderLine"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "planningAction"
    ADD CONSTRAINT "planningAction_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Cascade-delete performance: job / purchaseOrderLine deletes scan these
-- columns. itemId/locationId lead the existing planningAction_item_loc_idx
-- via companyId only, so give the two nullable target FKs their own indexes.
CREATE INDEX IF NOT EXISTS "planningAction_jobId_idx"
  ON "planningAction" ("jobId") WHERE "jobId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "planningAction_purchaseOrderLineId_idx"
  ON "planningAction" ("purchaseOrderLineId") WHERE "purchaseOrderLineId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "planningAction_itemId_idx"
  ON "planningAction" ("itemId");
CREATE INDEX IF NOT EXISTS "planningAction_periodId_idx"
  ON "planningAction" ("periodId");
CREATE INDEX IF NOT EXISTS "planningAction_locationId_idx"
  ON "planningAction" ("locationId");
