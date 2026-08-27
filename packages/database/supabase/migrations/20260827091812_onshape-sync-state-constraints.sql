-- Constraints and indexes for the Onshape sync-state tables, plus the corrected
-- engineering-data view.
--
-- These belong to 20260827091500 / 20260827091640 by subject, and are kept
-- separate because that is how they were landed: both were discovered after those
-- two had been applied on development databases, and the runner reconciles by
-- VERSION only -- there is no content checksum. Editing an applied file reaches
-- nothing that already ran it while a fresh database gets it, which produces a
-- constraint existing only where it was never exercised -- worse than not having
-- it at all. The rule that follows is the point worth keeping: anything
-- schema-shaped discovered after a migration is applied has to arrive as a new
-- version, never as an edit to the old one.

-- The index below is built against existing rows, and the very race it exists to
-- close could already have left two live runs for one company on a database that
-- ran this branch. A duplicate would fail the CREATE and, since the file is one
-- transaction, roll back this migration and block every later one for that
-- workspace. So settle the duplicates first: keep the newest live run per company
-- and mark the rest failed, which is the same terminal state the start route
-- writes when it cannot queue a job.
UPDATE "onshapeSyncRun" AS "stale"
SET "status" = 'failed',
    "error" = COALESCE("stale"."error", 'Superseded by a newer run'),
    "finishedAt" = COALESCE("stale"."finishedAt", NOW())
WHERE "stale"."status" IN ('queued', 'running')
  AND EXISTS (
    SELECT 1 FROM "onshapeSyncRun" AS "newer"
    WHERE "newer"."companyId" = "stale"."companyId"
      AND "newer"."status" IN ('queued', 'running')
      AND ("newer"."createdAt", "newer"."id") > ("stale"."createdAt", "stale"."id")
  );

-- One live run per company. The start route already reads the latest run and
-- refuses with a 409, but a read-then-insert cannot exclude a start that lands
-- between the two, and both would then spend Onshape quota on the same releases.
-- Only a terminal status leaves the predicate, which is the rule the route
-- documents; the route maps the resulting unique violation onto the same 409.
CREATE UNIQUE INDEX "onshapeSyncRun_oneLivePerCompany_idx" ON "onshapeSyncRun" ("companyId")
  WHERE "status" IN ('queued', 'running');

-- Retention has been pruning runs with no FK in place, so a sync-state row may
-- already point at a run that is gone. Clear those before the constraint exists,
-- or adding it fails on exactly the rows it is meant to govern.
UPDATE "onshapeItemSyncState" AS "orphaned"
SET "runId" = NULL
WHERE "orphaned"."runId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "onshapeSyncRun" AS "run"
    WHERE "run"."id" = "orphaned"."runId"
      AND "run"."companyId" = "orphaned"."companyId"
  );

-- Tenant-scoped attribution. SET NULL rather than CASCADE because runs are
-- retention-pruned to the newest 50 per company and losing a run must never
-- delete the per-item history it wrote. The column list is load-bearing: a bare
-- SET NULL would try to null the NOT NULL "companyId" and every prune would fail.
ALTER TABLE "onshapeItemSyncState"
    ADD CONSTRAINT "onshapeItemSyncState_runId_fkey"
    FOREIGN KEY ("runId", "companyId")
    REFERENCES "onshapeSyncRun"("id", "companyId")
    ON DELETE SET NULL ("runId");

-- Postgres enforces that SET NULL with one UPDATE ... WHERE "runId" = $1 AND
-- "companyId" = $2 per pruned run, and pruning happens inside the interactive
-- start request. Without an index leading with "runId" that is a scan of the
-- company's sync-state rows per pruned run.
CREATE INDEX "onshapeItemSyncState_runId_idx" ON "onshapeItemSyncState" ("runId", "companyId");

-- Every FK gets an index (repo convention); this one was missed when the column
-- was added. Small table, but a "user" delete would otherwise scan it.
CREATE INDEX "onshapeSyncRun_cancelledBy_idx" ON "onshapeSyncRun" ("cancelledBy");

-- Re-issued so databases that already applied 20260827091640 pick up the
-- "entityType" filter. `entityType` is part of a mapping's identity, so without it
-- a future non-item 'onshapeData' mapping joins to any item sharing its entityId
-- and duplicates the row.
CREATE OR REPLACE VIEW "onshapeEngineeringData" WITH(SECURITY_INVOKER=true) AS
SELECT
  "eim"."companyId",
  "eim"."entityId" AS "itemId",
  "i"."readableId",
  "i"."revision",
  "i"."name",
  COALESCE(
    "s"."releaseState",
    "eim"."metadata" -> 'engineering' ->> 'state'
  ) AS "releaseState",
  "s"."updatedAt" AS "stateSyncedAt",
  "eim"."metadata" -> 'engineering' ->> 'mass' AS "mass",
  "eim"."metadata" -> 'engineering' ->> 'material' AS "material",
  "eim"."metadata" -> 'engineering' ->> 'vendor' AS "vendor",
  "eim"."updatedAt" AS "bomSyncedAt"
FROM "externalIntegrationMapping" "eim"
JOIN "item" "i"
  ON "i"."id" = "eim"."entityId"
  AND "i"."companyId" = "eim"."companyId"
LEFT JOIN "onshapeItemSyncState" "s"
  ON "s"."itemId" = "i"."id"
  AND "s"."companyId" = "eim"."companyId"
  AND "s"."assetKind" = 'model'
WHERE "eim"."integration" = 'onshapeData'
  AND "eim"."entityType" = 'item';

