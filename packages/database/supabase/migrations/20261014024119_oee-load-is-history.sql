-- The open workCenterLoad row is the load. workCenter."loadedJobOperationId"
-- and "loadedAt" held the same fact twice, and an unload cleared "loadedAt",
-- which let a late event load an operation that had been replaced and made
-- history rows overlap. The interceptors now write only the history.

-- 1. Repair the history before the constraints: an end before its start
--    becomes the start, and only the newest open row per work center stays
--    open (an older one ends where the newer one starts).
UPDATE "workCenterLoad"
SET "unloadedAt" = "loadedAt"
WHERE "unloadedAt" < "loadedAt";

UPDATE "workCenterLoad" l
SET "unloadedAt" = GREATEST(newer."loadedAt", l."loadedAt")
FROM (
  SELECT "id", "companyId", "workCenterId", "loadedAt",
    row_number() OVER (
      PARTITION BY "workCenterId", "companyId" ORDER BY "loadedAt" DESC, "createdAt" DESC
    ) AS position
  FROM "workCenterLoad"
  WHERE "unloadedAt" IS NULL
) newer
WHERE newer.position = 1
  AND l."unloadedAt" IS NULL
  AND l."workCenterId" = newer."workCenterId"
  AND l."companyId" = newer."companyId"
  AND l."id" <> newer."id";

ALTER TABLE "workCenterLoad"
  DROP CONSTRAINT IF EXISTS "workCenterLoad_interval_check",
  ADD CONSTRAINT "workCenterLoad_interval_check"
    CHECK ("unloadedAt" IS NULL OR "unloadedAt" >= "loadedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "workCenterLoad_one_open_idx"
  ON "workCenterLoad" ("workCenterId", "companyId")
  WHERE "unloadedAt" IS NULL;

-- 2. The work center display reads the load from the open row. Both views
--    select wc.*, so they are rebuilt around the dropped columns.
DROP VIEW IF EXISTS "workCentersWithBlockingStatus";
DROP VIEW IF EXISTS "workCenters";

ALTER TABLE "workCenter"
  DROP COLUMN IF EXISTS "loadedJobOperationId",
  DROP COLUMN IF EXISTS "loadedAt";

CREATE VIEW "workCenters" WITH(SECURITY_INVOKER=true) AS
  SELECT
     wc.*,
     l.name as "locationName",
     d.name as "departmentName",
     wcp.processes
  FROM "workCenter" wc
  LEFT JOIN "location" l
    ON wc."locationId" = l.id
  LEFT JOIN "department" d
    ON wc."departmentId" = d.id
  LEFT JOIN (
    SELECT
      "workCenterId",
      array_agg("processId"::text) as processes
    FROM "workCenterProcess" wcp
    INNER JOIN "process" p ON wcp."processId" = p.id
    GROUP BY "workCenterId"
  ) wcp ON wc.id = wcp."workCenterId";

CREATE VIEW "workCentersWithBlockingStatus" WITH (security_invoker = true) AS
SELECT
  wc.*,
  l.name AS "locationName",
  COALESCE(
    (SELECT COUNT(*) > 0
     FROM "maintenanceDispatch" md
     WHERE md."workCenterId" = wc.id
       AND md.status = 'In Progress'
       AND md."oeeImpact" IN ('Down', 'Planned')
    ), false
  ) AS "isBlocked",
  (
    SELECT md.id
    FROM "maintenanceDispatch" md
    WHERE md."workCenterId" = wc.id
      AND md.status = 'In Progress'
      AND md."oeeImpact" IN ('Down', 'Planned')
    ORDER BY md."createdAt" DESC
    LIMIT 1
  ) AS "blockingDispatchId",
  (
    SELECT md."maintenanceDispatchId"
    FROM "maintenanceDispatch" md
    WHERE md."workCenterId" = wc.id
      AND md.status = 'In Progress'
      AND md."oeeImpact" IN ('Down', 'Planned')
    ORDER BY md."createdAt" DESC
    LIMIT 1
  ) AS "blockingDispatchReadableId",
  (
    SELECT wl."jobOperationId"
    FROM "workCenterLoad" wl
    WHERE wl."workCenterId" = wc.id
      AND wl."companyId" = wc."companyId"
      AND wl."unloadedAt" IS NULL
  ) AS "loadedJobOperationId"
FROM "workCenter" wc
LEFT JOIN "location" l ON wc."locationId" = l.id;

-- 3. The earliest press since the last sync. A press sets it; the sync plans
--    from it and clears it, so two presses between syncs both count.
ALTER TABLE "workCenterDevice"
  ADD COLUMN IF NOT EXISTS "unplannedPressAt" TIMESTAMP WITH TIME ZONE;

-- 4. The sync reads a work center's Machine events (the latest end, and the
--    time already recorded) and its maintenance dispatches every 2 minutes.
CREATE INDEX IF NOT EXISTS "productionEvent_machine_workCenter_endTime_idx"
  ON "productionEvent" ("workCenterId", "endTime")
  WHERE "type" = 'Machine';
CREATE INDEX IF NOT EXISTS "maintenanceDispatch_workCenterId_idx"
  ON "maintenanceDispatch" ("workCenterId");

-- 5. A load stays 7 days after its unload, and longer while a device on its
--    work center has not planned past it: a device that fails for a week
--    still finds the loads its late runs belong to.
CREATE OR REPLACE FUNCTION util.purge_work_center_loads()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM "workCenterLoad" l
  WHERE l."unloadedAt" < NOW() - INTERVAL '7 days'
    AND NOT EXISTS (
      SELECT 1 FROM "workCenterDevice" d
      WHERE d."workCenterId" = l."workCenterId"
        AND d."companyId" = l."companyId"
        AND (d."appliedThrough" IS NULL OR d."appliedThrough" < l."unloadedAt")
    );
$$;

REVOKE ALL ON FUNCTION util.purge_work_center_loads() FROM PUBLIC;
