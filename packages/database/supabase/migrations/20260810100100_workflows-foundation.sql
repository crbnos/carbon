-- Workflows: module enum, five tables, indexes, RLS, realtime

ALTER TYPE "module" ADD VALUE IF NOT EXISTS 'Workflows';

COMMIT;

DROP VIEW IF EXISTS "modules";
CREATE VIEW "modules" AS
    SELECT unnest(enum_range(NULL::module)) AS name;

INSERT INTO "employeeTypePermission" ("employeeTypeId", "module", "create", "delete", "update", "view")
SELECT
    et.id AS "employeeTypeId",
    'Workflows'::module AS "module",
    ARRAY[et."companyId"] AS "create",
    ARRAY[et."companyId"] AS "delete",
    ARRAY[et."companyId"] AS "update",
    ARRAY[et."companyId"] AS "view"
FROM "employeeType" et
WHERE et.name IN ('Admin', 'Management')
ON CONFLICT ("employeeTypeId", "module") DO NOTHING;

-- Seed Workflows keys from each user's existing Settings permissions
UPDATE "userPermission"
SET "permissions" = "permissions" || jsonb_build_object(
  'workflows_view', COALESCE("permissions"->'settings_view', '[]'::jsonb),
  'workflows_create', COALESCE("permissions"->'settings_create', '[]'::jsonb),
  'workflows_update', COALESCE("permissions"->'settings_update', '[]'::jsonb),
  'workflows_delete', COALESCE("permissions"->'settings_delete', '[]'::jsonb)
);

CREATE TABLE "workflow" (
    "id" TEXT NOT NULL DEFAULT id('wf'),
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerId" TEXT NOT NULL REFERENCES "user"("id"),
    "active" BOOLEAN NOT NULL DEFAULT FALSE,
    "activeVersionId" TEXT,
    "nextRunAt" TIMESTAMP WITH TIME ZONE,
    -- Builder canvas view state: `{ x, y, zoom, panOnScroll }`. Per workflow, not
    -- per user — a shared canvas should reopen where the team left it.
    "canvasState" JSONB,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    CONSTRAINT "workflow_name_companyId_key" UNIQUE ("companyId", "name")
);

-- One canvas version
CREATE TABLE "workflowVersion" (
    "id" TEXT NOT NULL DEFAULT id('wfv'),
    "companyId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "formatVersion" INTEGER NOT NULL DEFAULT 1,
    "nodes" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "edges" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    FOREIGN KEY ("workflowId", "companyId")
        REFERENCES "workflow"("id", "companyId") ON DELETE CASCADE,
    CONSTRAINT "workflowVersion_workflowId_versionNumber_key"
        UNIQUE ("workflowId", "companyId", "versionNumber")
);

-- SET NULL names the column explicitly, or Postgres would null "companyId" too.
ALTER TABLE "workflow"
    ADD CONSTRAINT "workflow_activeVersionId_fkey"
    FOREIGN KEY ("activeVersionId", "companyId")
    REFERENCES "workflowVersion"("id", "companyId")
    ON DELETE SET NULL ("activeVersionId");

-- Derived dispatch index, rewritten on promote/toggle: a row exists iff the
-- workflow is active and its promoted version's trigger nodes list this event id.
CREATE TABLE "workflowTriggerEvent" (
    "id" TEXT NOT NULL DEFAULT id('wfe'),
    "companyId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "workflowVersionId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'Both'
        CHECK ("origin" IN ('Person', 'Automation', 'Both')),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    FOREIGN KEY ("workflowId", "companyId")
        REFERENCES "workflow"("id", "companyId") ON DELETE CASCADE,
    FOREIGN KEY ("workflowVersionId", "companyId")
        REFERENCES "workflowVersion"("id", "companyId") ON DELETE CASCADE,
    CONSTRAINT "workflowTriggerEvent_workflowId_eventId_key"
        UNIQUE ("workflowId", "companyId", "eventId")
);

CREATE INDEX "workflowTriggerEvent_dispatch_idx"
    ON "workflowTriggerEvent" ("companyId", "eventId");

-- One row per firing
CREATE TABLE "workflowRun" (
    "id" TEXT NOT NULL DEFAULT id('wfr'),
    "companyId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "workflowVersionId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "sourceEventId" TEXT NOT NULL,
    "triggerTable" TEXT,
    "triggerRecordId" TEXT,
    "ownerId" TEXT NOT NULL REFERENCES "user"("id"),
    "status" TEXT NOT NULL DEFAULT 'Queued'
        CHECK ("status" IN ('Queued', 'Running', 'Succeeded', 'Failed', 'Blocked', 'Skipped')),
    "statusReason" TEXT,
    -- A builder test run has real side effects, so it gets a real row. This flag is
    -- the only thing separating it from a run the matcher queued.
    "isTest" BOOLEAN NOT NULL DEFAULT FALSE,
    -- Not FKs: a retention purge of an aged-out ancestor would cascade to newer
    -- descendants, and SET NULL would make NULL ambiguous with "I am the root".
    "rootRunId" TEXT,
    "causedByRunId" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "path" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "startedAt" TIMESTAMP WITH TIME ZONE,
    "completedAt" TIMESTAMP WITH TIME ZONE,
    "durationMs" INTEGER,
    "error" TEXT,
    "compactedAt" TIMESTAMP WITH TIME ZONE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    FOREIGN KEY ("workflowId", "companyId")
        REFERENCES "workflow"("id", "companyId") ON DELETE CASCADE,
    FOREIGN KEY ("workflowVersionId", "companyId")
        REFERENCES "workflowVersion"("id", "companyId") ON DELETE CASCADE,
    CONSTRAINT "workflowRun_dedupe_key"
        UNIQUE ("workflowId", "companyId", "workflowVersionId", "sourceEventId")
);

-- One row per node execution
CREATE TABLE "workflowStepRun" (
    "id" TEXT NOT NULL DEFAULT id('wfs'),
    "companyId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "nodeId" TEXT NOT NULL,
    "nodeType" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL
        CHECK ("status" IN ('Running', 'Succeeded', 'Failed', 'Skipped')),
    "statusReason" TEXT,
    "input" JSONB,
    "output" JSONB,
    "branchTaken" TEXT,
    "startedAt" TIMESTAMP WITH TIME ZONE,
    "completedAt" TIMESTAMP WITH TIME ZONE,
    "durationMs" INTEGER,
    "error" TEXT,
    "compactedAt" TIMESTAMP WITH TIME ZONE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    FOREIGN KEY ("runId", "companyId")
        REFERENCES "workflowRun"("id", "companyId") ON DELETE CASCADE,
    CONSTRAINT "workflowStepRun_idempotency_key"
        UNIQUE ("runId", "companyId", "nodeId", "itemKey")
);

CREATE INDEX "workflow_companyId_idx" ON "workflow" ("companyId");
CREATE INDEX "workflow_ownerId_idx" ON "workflow" ("ownerId");
CREATE INDEX "workflow_createdBy_idx" ON "workflow" ("createdBy");
CREATE INDEX "workflow_updatedBy_idx" ON "workflow" ("updatedBy");
-- Both predicate halves matter: deleting the promoted version leaves "active" set.
CREATE INDEX "workflow_due_idx" ON "workflow" ("nextRunAt")
    WHERE "active" = TRUE AND "nextRunAt" IS NOT NULL
      AND "activeVersionId" IS NOT NULL;

CREATE INDEX "workflowVersion_companyId_idx" ON "workflowVersion" ("companyId");
CREATE INDEX "workflowVersion_workflowId_idx"
    ON "workflowVersion" ("workflowId", "companyId", "versionNumber" DESC);
CREATE INDEX "workflowVersion_createdBy_idx" ON "workflowVersion" ("createdBy");
CREATE INDEX "workflowVersion_updatedBy_idx" ON "workflowVersion" ("updatedBy");

CREATE INDEX "workflowTriggerEvent_workflowId_idx"
    ON "workflowTriggerEvent" ("workflowId", "companyId");

CREATE INDEX "workflowRun_companyId_workflowId_idx"
    ON "workflowRun" ("companyId", "workflowId", "createdAt" DESC);
-- The global run log at /x/workflows/runs filters companyId alone and sorts
-- createdAt DESC, which the index above cannot serve: it orders by workflowId first.
CREATE INDEX "workflowRun_companyId_createdAt_idx"
    ON "workflowRun" ("companyId", "createdAt" DESC);
CREATE INDEX "workflowRun_companyId_status_idx" ON "workflowRun" ("companyId", "status");
CREATE INDEX "workflowRun_rootRunId_idx" ON "workflowRun" ("rootRunId");
-- hasActiveRun runs once per due workflow per scheduler wake. Partial, because
-- non-terminal runs are a tiny fraction of the table and this stays hot.
CREATE INDEX "workflowRun_active_idx" ON "workflowRun" ("companyId", "workflowId")
    WHERE "status" IN ('Queued', 'Running');
CREATE INDEX "workflowRun_eventId_idx" ON "workflowRun" ("companyId", "eventId");
CREATE INDEX "workflowRun_ownerId_idx" ON "workflowRun" ("ownerId");

-- No companyId-alone index on workflowStepRun: every query filters runId (covered
-- below) or id (the PK), and this is the highest-insert table in the subsystem.
CREATE INDEX "workflowStepRun_runId_idx"
    ON "workflowStepRun" ("runId", "companyId", "sequence");

ALTER TABLE "public"."workflow" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."workflow"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('workflows_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."workflow"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('workflows_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."workflow"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('workflows_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."workflow"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('workflows_delete'))::text[])
);

ALTER TABLE "public"."workflowVersion" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."workflowVersion"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('workflows_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."workflowVersion"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('workflows_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."workflowVersion"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('workflows_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."workflowVersion"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('workflows_delete'))::text[])
);

-- No UPDATE policy: the promote path rewrites rows as delete-then-insert.
ALTER TABLE "public"."workflowTriggerEvent" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."workflowTriggerEvent"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('workflows_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."workflowTriggerEvent"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('workflows_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."workflowTriggerEvent"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('workflows_update'))::text[])
);

-- Written by the engine as service-role; SELECT-only so no user can forge a run log.
ALTER TABLE "public"."workflowRun" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."workflowRun"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('workflows_view'))::text[])
);

ALTER TABLE "public"."workflowStepRun" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."workflowStepRun"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('workflows_view'))::text[])
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'workflowRun'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE "workflowRun";
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'workflowStepRun'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE "workflowStepRun";
  END IF;
END $$;
