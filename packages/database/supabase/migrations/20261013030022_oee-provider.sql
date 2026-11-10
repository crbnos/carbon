-- OEE provider integration (spec: .ai/specs/2026-10-12-oee-provider-integration.md)

-- 1. Provider role 'oee'
ALTER TABLE "integration" DROP CONSTRAINT IF EXISTS "integration_providerRole_check";
ALTER TABLE "integration" ADD CONSTRAINT "integration_providerRole_check"
  CHECK ("providerRole" IS NULL OR "providerRole" IN ('accounting', 'spend', 'oee'));

-- Forked from 20260924133915_integration-provider-role.sql. One change: the
-- 'oee' role may have several active integrations per company.
CREATE OR REPLACE FUNCTION public.check_single_active_provider_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_conflict TEXT;
BEGIN
  IF NEW."active" IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."active" IS TRUE THEN
    RETURN NEW;
  END IF;

  SELECT "providerRole" INTO v_role FROM "integration" WHERE id = NEW."id";
  IF v_role IS NULL THEN
    RETURN NEW;
  END IF;

  -- Several OEE providers may be active at once. The one-device-per-work-center
  -- rule lives on "workCenterDevice" instead.
  IF v_role = 'oee' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      NEW."companyId" || E'\x1f' || 'providerRole' || E'\x1f' || v_role, 0
    )
  );

  SELECT ci."id" INTO v_conflict
  FROM "companyIntegration" ci
  JOIN "integration" i ON i.id = ci."id"
  WHERE ci."companyId" = NEW."companyId"
    AND ci."active" IS TRUE
    AND ci."id" <> NEW."id"
    AND i."providerRole" = v_role
  LIMIT 1;

  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION
      'Only one active % integration is allowed per company; % is already active',
      v_role, v_conflict
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

INSERT INTO "integration" ("id", "jsonschema")
VALUES ('sense', '{"type": "object", "properties": {}}'::json)
ON CONFLICT ("id") DO NOTHING;

UPDATE "integration" SET "providerRole" = 'oee'
  WHERE "id" = 'sense' AND "providerRole" IS DISTINCT FROM 'oee';

-- 2. Loaded operation (community)
ALTER TABLE "workCenter"
  ADD COLUMN IF NOT EXISTS "loadedJobOperationId" TEXT REFERENCES "jobOperation"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "loadedAt" TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS "workCenter_loadedJobOperationId_idx"
  ON "workCenter" ("loadedJobOperationId");

-- 3. Machine state
DO $$ BEGIN
  CREATE TYPE "machineState" AS ENUM ('Running', 'Idle', 'Down', 'Offline');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "unattributedMachineTimeStatus" AS ENUM ('Open', 'Assigned', 'Dismissed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "workCenterDevice" (
  "id" TEXT NOT NULL DEFAULT id('wcd'),
  "companyId" TEXT NOT NULL,
  "workCenterId" TEXT NOT NULL REFERENCES "workCenter"("id") ON DELETE CASCADE,
  "integration" TEXT NOT NULL REFERENCES "integration"("id"),
  "externalDeviceId" TEXT NOT NULL,
  "externalSiteId" TEXT,
  "siteTimezone" TEXT,
  "deviceName" TEXT NOT NULL,
  "currentState" "machineState",
  "currentStateAt" TIMESTAMP WITH TIME ZONE,
  "appliedThrough" TIMESTAMP WITH TIME ZONE,
  "lastEventAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "lastManualChangeAt" TIMESTAMP WITH TIME ZONE,
  "lastSyncedAt" TIMESTAMP WITH TIME ZONE,
  "lastSyncError" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "workCenterDevice_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "workCenterDevice_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workCenterDevice_workCenter_key" UNIQUE ("workCenterId", "companyId"),
  CONSTRAINT "workCenterDevice_device_key" UNIQUE ("integration", "externalDeviceId", "companyId")
);

CREATE INDEX IF NOT EXISTS "workCenterDevice_companyId_idx" ON "workCenterDevice" ("companyId");
CREATE INDEX IF NOT EXISTS "workCenterDevice_integration_idx" ON "workCenterDevice" ("integration");
CREATE INDEX IF NOT EXISTS "workCenterDevice_createdBy_idx" ON "workCenterDevice" ("createdBy");

CREATE TABLE IF NOT EXISTS "machineStateChange" (
  "id" TEXT NOT NULL DEFAULT id('msc'),
  "companyId" TEXT NOT NULL,
  "workCenterDeviceId" TEXT NOT NULL,
  "workCenterId" TEXT NOT NULL REFERENCES "workCenter"("id") ON DELETE CASCADE,
  "externalEventId" TEXT NOT NULL,
  "state" "machineState" NOT NULL,
  "changedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "machineStateChange_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "machineStateChange_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "machineStateChange_event_key"
    UNIQUE ("workCenterDeviceId", "externalEventId", "companyId")
);

CREATE INDEX IF NOT EXISTS "machineStateChange_companyId_idx" ON "machineStateChange" ("companyId");
CREATE INDEX IF NOT EXISTS "machineStateChange_workCenter_changedAt_idx"
  ON "machineStateChange" ("workCenterId", "changedAt");
CREATE INDEX IF NOT EXISTS "machineStateChange_device_changedAt_idx"
  ON "machineStateChange" ("workCenterDeviceId", "changedAt");

CREATE TABLE IF NOT EXISTS "unattributedMachineTime" (
  "id" TEXT NOT NULL DEFAULT id('umt'),
  "companyId" TEXT NOT NULL,
  "workCenterId" TEXT NOT NULL REFERENCES "workCenter"("id") ON DELETE CASCADE,
  "startTime" TIMESTAMP WITH TIME ZONE NOT NULL,
  "endTime" TIMESTAMP WITH TIME ZONE,
  "status" "unattributedMachineTimeStatus" NOT NULL DEFAULT 'Open',
  "productionEventId" TEXT REFERENCES "productionEvent"("id") ON DELETE SET NULL,
  "dismissReason" TEXT,
  "resolvedBy" TEXT REFERENCES "user"("id"),
  "resolvedAt" TIMESTAMP WITH TIME ZONE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "unattributedMachineTime_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "unattributedMachineTime_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "unattributedMachineTime_dismiss_check"
    CHECK ("status" <> 'Dismissed' OR "dismissReason" IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS "unattributedMachineTime_companyId_idx" ON "unattributedMachineTime" ("companyId");
CREATE INDEX IF NOT EXISTS "unattributedMachineTime_workCenterId_idx" ON "unattributedMachineTime" ("workCenterId");
CREATE INDEX IF NOT EXISTS "unattributedMachineTime_productionEventId_idx" ON "unattributedMachineTime" ("productionEventId");
CREATE INDEX IF NOT EXISTS "unattributedMachineTime_createdBy_idx" ON "unattributedMachineTime" ("createdBy");
CREATE INDEX IF NOT EXISTS "unattributedMachineTime_open_idx"
  ON "unattributedMachineTime" ("companyId", "workCenterId") WHERE "status" = 'Open';

-- 4. The engine reads the open events of one work center
CREATE INDEX IF NOT EXISTS "productionEvent_workCenterId_open_idx"
  ON "productionEvent" ("workCenterId") WHERE "endTime" IS NULL;

-- 5. Re-declare the work-center views so wc.* includes the new columns.
-- DROP first, not CREATE OR REPLACE: the new wc.* columns expand before
-- "locationName". Forked verbatim from 20260905132037_job-operation-batching.sql.
DROP VIEW IF EXISTS "workCenters";
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

DROP VIEW IF EXISTS "workCentersWithBlockingStatus";
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
  ) AS "blockingDispatchReadableId"
FROM "workCenter" wc
LEFT JOIN "location" l ON wc."locationId" = l.id;
