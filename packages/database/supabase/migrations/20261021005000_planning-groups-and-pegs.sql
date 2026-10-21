-- Projects Phase 3: planning groups pool projects with project stock into one
-- netting segment (the group id); projectPeg records which member each piece of
-- the group's supply is for, versioned (a row is superseded, never updated).

CREATE TABLE IF NOT EXISTS "planningGroup" (
  "id" TEXT NOT NULL DEFAULT id('plg'),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "locationId" TEXT NOT NULL REFERENCES "location"("id"),
  "excessRule" "planningGroupExcessRule" NOT NULL DEFAULT 'Common Stock',
  "exceptionProjectId" TEXT,
  "priorityRule" "planningGroupPriorityRule" NOT NULL DEFAULT 'Earliest Need',
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "planningGroup_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "planningGroup_name_key" UNIQUE ("name", "companyId"),
  CONSTRAINT "planningGroup_exception_fkey" FOREIGN KEY ("exceptionProjectId", "companyId") REFERENCES "project"("id", "companyId") ON DELETE SET NULL ("exceptionProjectId"),
  CONSTRAINT "planningGroup_exception_check" CHECK ("excessRule" <> 'Exception Project' OR "exceptionProjectId" IS NOT NULL),
  CONSTRAINT "planningGroup_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "planningGroup_companyId_idx" ON "planningGroup" ("companyId");
CREATE INDEX IF NOT EXISTS "planningGroup_locationId_idx" ON "planningGroup" ("locationId");
CREATE INDEX IF NOT EXISTS "planningGroup_exceptionProjectId_idx" ON "planningGroup" ("exceptionProjectId", "companyId");
CREATE INDEX IF NOT EXISTS "planningGroup_createdBy_idx" ON "planningGroup" ("createdBy");
CREATE INDEX IF NOT EXISTS "planningGroup_updatedBy_idx" ON "planningGroup" ("updatedBy");

ALTER TABLE "project"
  ADD COLUMN IF NOT EXISTS "planningGroupId" TEXT,
  ADD COLUMN IF NOT EXISTS "planningPriority" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "project" ADD CONSTRAINT "project_planningGroup_fkey"
  FOREIGN KEY ("planningGroupId", "companyId") REFERENCES "planningGroup"("id", "companyId") ON DELETE SET NULL ("planningGroupId");
ALTER TABLE "project" ADD CONSTRAINT "project_planningGroup_stock_check"
  CHECK ("planningGroupId" IS NULL OR "projectStock");
CREATE INDEX IF NOT EXISTS "project_planningGroupId_idx" ON "project" ("planningGroupId", "companyId") WHERE "planningGroupId" IS NOT NULL;

ALTER TABLE "purchaseOrderLine" ADD COLUMN IF NOT EXISTS "planningGroupId" TEXT;
ALTER TABLE "purchaseOrderLine" ADD CONSTRAINT "purchaseOrderLine_planningGroup_fkey"
  FOREIGN KEY ("planningGroupId", "companyId") REFERENCES "planningGroup"("id", "companyId");
ALTER TABLE "purchaseOrderLine" ADD CONSTRAINT "purchaseOrderLine_owner_check"
  CHECK ("planningGroupId" IS NULL OR "projectId" IS NULL);
CREATE INDEX IF NOT EXISTS "purchaseOrderLine_planningGroupId_idx" ON "purchaseOrderLine" ("planningGroupId", "companyId") WHERE "planningGroupId" IS NOT NULL;

ALTER TABLE "job" ADD COLUMN IF NOT EXISTS "planningGroupId" TEXT;
ALTER TABLE "job" ADD CONSTRAINT "job_planningGroup_fkey"
  FOREIGN KEY ("planningGroupId", "companyId") REFERENCES "planningGroup"("id", "companyId");
ALTER TABLE "job" ADD CONSTRAINT "job_owner_check"
  CHECK ("planningGroupId" IS NULL OR "projectId" IS NULL);
CREATE INDEX IF NOT EXISTS "job_planningGroupId_idx" ON "job" ("planningGroupId", "companyId") WHERE "planningGroupId" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "projectPeg" (
  "id" TEXT NOT NULL DEFAULT id('peg'),
  "companyId" TEXT NOT NULL,
  "planningGroupId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL REFERENCES "item"("id"),
  "locationId" TEXT NOT NULL REFERENCES "location"("id"),
  "supplyType" "projectPegSupplyType" NOT NULL,
  "supplyId" TEXT NOT NULL,                  -- purchaseOrderLine.id, job.id or planningAction.id
  "projectId" TEXT NOT NULL,
  "projectElementId" TEXT,
  "demandSourceType" "demandForecastSourceType" NOT NULL,
  "demandSourceId" TEXT NOT NULL,
  "parentPegId" TEXT,
  "quantity" NUMERIC NOT NULL CHECK ("quantity" > 0),
  "needDate" DATE,
  "state" "projectPegState" NOT NULL DEFAULT 'Soft',
  "manualReason" TEXT,
  "exception" TEXT,                          -- set by the run when a Manual peg's demand is gone
  "createdByRunId" TEXT,
  "supersededAt" TIMESTAMP WITH TIME ZONE,
  "supersededByRunId" TEXT,
  "hardenedAt" TIMESTAMP WITH TIME ZONE,
  "itemLedgerId" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "projectPeg_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectPeg_group_fkey" FOREIGN KEY ("planningGroupId", "companyId") REFERENCES "planningGroup"("id", "companyId"),
  CONSTRAINT "projectPeg_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId"),
  CONSTRAINT "projectPeg_manual_check" CHECK ("state" <> 'Manual' OR "manualReason" IS NOT NULL),
  CONSTRAINT "projectPeg_hard_check" CHECK ("state" <> 'Hard' OR "hardenedAt" IS NOT NULL),
  CONSTRAINT "projectPeg_planned_check" CHECK ("supplyType" <> 'Planning Action' OR "state" = 'Soft'),
  CONSTRAINT "projectPeg_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "projectPeg_current_idx" ON "projectPeg" ("companyId", "planningGroupId", "itemId") WHERE "supersededAt" IS NULL;
CREATE INDEX IF NOT EXISTS "projectPeg_project_idx" ON "projectPeg" ("companyId", "projectId") WHERE "supersededAt" IS NULL;
CREATE INDEX IF NOT EXISTS "projectPeg_supply_idx" ON "projectPeg" ("supplyType", "supplyId") WHERE "supersededAt" IS NULL;
CREATE INDEX IF NOT EXISTS "projectPeg_history_idx" ON "projectPeg" ("companyId", "planningGroupId", "createdAt");

CREATE INDEX IF NOT EXISTS "projectPeg_companyId_idx" ON "projectPeg" ("companyId");
CREATE INDEX IF NOT EXISTS "projectPeg_planningGroupId_idx" ON "projectPeg" ("planningGroupId", "companyId");
CREATE INDEX IF NOT EXISTS "projectPeg_projectId_idx" ON "projectPeg" ("projectId", "companyId");
CREATE INDEX IF NOT EXISTS "projectPeg_itemId_idx" ON "projectPeg" ("itemId");
CREATE INDEX IF NOT EXISTS "projectPeg_locationId_idx" ON "projectPeg" ("locationId");
CREATE INDEX IF NOT EXISTS "projectPeg_createdBy_idx" ON "projectPeg" ("createdBy");
