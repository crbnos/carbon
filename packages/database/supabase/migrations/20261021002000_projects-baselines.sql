-- Projects Phase 1c: baselines, change requests and the plan lock.

ALTER TABLE "project"
  ADD COLUMN IF NOT EXISTS "lockPlanAfterMilestoneId" TEXT,
  ADD COLUMN IF NOT EXISTS "nextChangeRequestSequence" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "nextBaselineSequence" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "project" ADD CONSTRAINT "project_lockMilestone_fkey"
  FOREIGN KEY ("lockPlanAfterMilestoneId", "companyId") REFERENCES "projectMilestone"("id", "companyId") ON DELETE SET NULL ("lockPlanAfterMilestoneId");
CREATE INDEX IF NOT EXISTS "project_lockPlanAfterMilestoneId_idx" ON "project" ("lockPlanAfterMilestoneId", "companyId");

CREATE TABLE IF NOT EXISTS "projectBaseline" (
  "id" TEXT NOT NULL DEFAULT id('pjbl'),
  "companyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "source" "projectBaselineSource" NOT NULL,
  "milestoneId" TEXT,
  "changeRequestId" TEXT,
  "formatVersion" INTEGER NOT NULL DEFAULT 1,
  "snapshot" JSONB NOT NULL,          -- { elements, links, materials, labor, costs }
  "elementCount" INTEGER NOT NULL,
  "linkCount" INTEGER NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "projectBaseline_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectBaseline_sequence_key" UNIQUE ("projectId", "sequence", "companyId"),
  CONSTRAINT "projectBaseline_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectBaseline_milestone_fkey" FOREIGN KEY ("milestoneId", "companyId") REFERENCES "projectMilestone"("id", "companyId") ON DELETE SET NULL ("milestoneId"),
  CONSTRAINT "projectBaseline_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "projectBaseline_companyId_idx" ON "projectBaseline" ("companyId");
CREATE INDEX IF NOT EXISTS "projectBaseline_projectId_idx" ON "projectBaseline" ("projectId", "companyId");
CREATE INDEX IF NOT EXISTS "projectBaseline_milestoneId_idx" ON "projectBaseline" ("milestoneId", "companyId");
CREATE INDEX IF NOT EXISTS "projectBaseline_changeRequestId_idx" ON "projectBaseline" ("changeRequestId", "companyId");
CREATE INDEX IF NOT EXISTS "projectBaseline_createdBy_idx" ON "projectBaseline" ("createdBy");

CREATE TABLE IF NOT EXISTS "projectChangeRequest" (
  "id" TEXT NOT NULL DEFAULT id('pjcr'),
  "companyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "readableId" TEXT NOT NULL DEFAULT '',     -- '<identifier>-CR-<n>', set by the service
  "title" TEXT NOT NULL,
  "reason" JSONB,
  "status" "projectChangeRequestStatus" NOT NULL DEFAULT 'Draft',
  "baseBaselineId" TEXT,                      -- the baseline the draft started from
  "appliedBaselineId" TEXT,
  "submittedAt" TIMESTAMP WITH TIME ZONE,
  "decidedBy" TEXT REFERENCES "user"("id"),
  "decidedAt" TIMESTAMP WITH TIME ZONE,
  "decisionNotes" TEXT,
  "appliedAt" TIMESTAMP WITH TIME ZONE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "projectChangeRequest_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectChangeRequest_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectChangeRequest_baseBaseline_fkey" FOREIGN KEY ("baseBaselineId", "companyId") REFERENCES "projectBaseline"("id", "companyId") ON DELETE SET NULL ("baseBaselineId"),
  CONSTRAINT "projectChangeRequest_appliedBaseline_fkey" FOREIGN KEY ("appliedBaselineId", "companyId") REFERENCES "projectBaseline"("id", "companyId") ON DELETE SET NULL ("appliedBaselineId"),
  CONSTRAINT "projectChangeRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
ALTER TABLE "projectBaseline" ADD CONSTRAINT "projectBaseline_changeRequest_fkey"
  FOREIGN KEY ("changeRequestId", "companyId") REFERENCES "projectChangeRequest"("id", "companyId") ON DELETE SET NULL ("changeRequestId");

CREATE INDEX IF NOT EXISTS "projectChangeRequest_companyId_idx" ON "projectChangeRequest" ("companyId");
CREATE INDEX IF NOT EXISTS "projectChangeRequest_projectId_idx" ON "projectChangeRequest" ("projectId", "companyId");
CREATE INDEX IF NOT EXISTS "projectChangeRequest_baseBaselineId_idx" ON "projectChangeRequest" ("baseBaselineId", "companyId");
CREATE INDEX IF NOT EXISTS "projectChangeRequest_appliedBaselineId_idx" ON "projectChangeRequest" ("appliedBaselineId", "companyId");
CREATE INDEX IF NOT EXISTS "projectChangeRequest_decidedBy_idx" ON "projectChangeRequest" ("decidedBy");
CREATE INDEX IF NOT EXISTS "projectChangeRequest_createdBy_idx" ON "projectChangeRequest" ("createdBy");
CREATE INDEX IF NOT EXISTS "projectChangeRequest_updatedBy_idx" ON "projectChangeRequest" ("updatedBy");

CREATE TABLE IF NOT EXISTS "projectChangeRequestItem" (
  "id" TEXT NOT NULL DEFAULT id('pjci'),
  "companyId" TEXT NOT NULL,
  "changeRequestId" TEXT NOT NULL,
  "operation" "projectChangeOperation" NOT NULL,
  "targetTable" "projectPlanTable" NOT NULL,
  "targetId" TEXT NOT NULL,           -- the live row id; for Add, a pre-generated id the apply step inserts with
  "payload" JSONB,                    -- the proposed row (Add, Update)
  "baseRow" JSONB,                    -- the live row when the draft first touched it (Update, Delete)
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "projectChangeRequestItem_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectChangeRequestItem_target_key" UNIQUE ("changeRequestId", "targetTable", "targetId", "companyId"),
  CONSTRAINT "projectChangeRequestItem_cr_fkey" FOREIGN KEY ("changeRequestId", "companyId") REFERENCES "projectChangeRequest"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectChangeRequestItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "projectChangeRequestItem_companyId_idx" ON "projectChangeRequestItem" ("companyId");
CREATE INDEX IF NOT EXISTS "projectChangeRequestItem_changeRequestId_idx" ON "projectChangeRequestItem" ("changeRequestId", "companyId");
CREATE INDEX IF NOT EXISTS "projectChangeRequestItem_createdBy_idx" ON "projectChangeRequestItem" ("createdBy");
CREATE INDEX IF NOT EXISTS "projectChangeRequestItem_updatedBy_idx" ON "projectChangeRequestItem" ("updatedBy");

CREATE TABLE IF NOT EXISTS "projectChangeRequestComment" (
  "id" TEXT NOT NULL DEFAULT id('pjcc'),
  "companyId" TEXT NOT NULL,
  "changeRequestId" TEXT NOT NULL,
  "targetTable" "projectPlanTable",
  "targetId" TEXT,
  "field" TEXT,                       -- null = a comment on the whole change or the whole row
  "comment" TEXT NOT NULL,
  "resolvedAt" TIMESTAMP WITH TIME ZONE,
  "resolvedBy" TEXT REFERENCES "user"("id"),
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "projectChangeRequestComment_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectChangeRequestComment_cr_fkey" FOREIGN KEY ("changeRequestId", "companyId") REFERENCES "projectChangeRequest"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectChangeRequestComment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "projectChangeRequestComment_companyId_idx" ON "projectChangeRequestComment" ("companyId");
CREATE INDEX IF NOT EXISTS "projectChangeRequestComment_changeRequestId_idx" ON "projectChangeRequestComment" ("changeRequestId", "companyId");
CREATE INDEX IF NOT EXISTS "projectChangeRequestComment_resolvedBy_idx" ON "projectChangeRequestComment" ("resolvedBy");
CREATE INDEX IF NOT EXISTS "projectChangeRequestComment_createdBy_idx" ON "projectChangeRequestComment" ("createdBy");
CREATE INDEX IF NOT EXISTS "projectChangeRequestComment_updatedBy_idx" ON "projectChangeRequestComment" ("updatedBy");

CREATE TABLE IF NOT EXISTS "projectChangeRequestView" (
  "changeRequestId" TEXT NOT NULL,
  "targetTable" "projectPlanTable" NOT NULL,
  "targetId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user"("id"),
  "companyId" TEXT NOT NULL,
  "viewedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "projectChangeRequestView_pkey" PRIMARY KEY ("changeRequestId", "targetTable", "targetId", "userId", "companyId"),
  CONSTRAINT "projectChangeRequestView_cr_fkey" FOREIGN KEY ("changeRequestId", "companyId") REFERENCES "projectChangeRequest"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectChangeRequestView_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "projectChangeRequestView_companyId_idx" ON "projectChangeRequestView" ("companyId");
CREATE INDEX IF NOT EXISTS "projectChangeRequestView_changeRequestId_idx" ON "projectChangeRequestView" ("changeRequestId", "companyId");
CREATE INDEX IF NOT EXISTS "projectChangeRequestView_userId_idx" ON "projectChangeRequestView" ("userId");

-- Recreate approvalRequests view to include the project change request document type
DROP VIEW IF EXISTS "approvalRequests";
CREATE OR REPLACE VIEW "approvalRequests" WITH (SECURITY_INVOKER=true) AS
SELECT
  ar."id",
  ar."documentType",
  ar."documentId",
  ar."status",
  ar."requestedBy",
  ar."requestedAt",
  ar."decisionBy",
  ar."decisionAt",
  ar."decisionNotes",
  ar."companyId",
  ar."createdAt",
  CASE
    WHEN ar."documentType" = 'purchaseOrder' THEN po."purchaseOrderId"
    WHEN ar."documentType" = 'qualityDocument' THEN qd."name"
    WHEN ar."documentType" = 'supplier' THEN sup."name"
    WHEN ar."documentType" = 'projectChangeRequest' THEN pcr."readableId"
    ELSE NULL
  END AS "documentReadableId",
  CASE
    WHEN ar."documentType" = 'purchaseOrder' THEN s."name"
    WHEN ar."documentType" = 'qualityDocument' THEN qd."description"
    WHEN ar."documentType" = 'supplier' THEN NULL
    WHEN ar."documentType" = 'projectChangeRequest' THEN pcr."title"
    ELSE NULL
  END AS "documentDescription"
FROM "approvalRequest" ar
LEFT JOIN "purchaseOrder" po ON ar."documentType" = 'purchaseOrder' AND ar."documentId" = po."id"
LEFT JOIN "supplier" s ON po."supplierId" = s."id"
LEFT JOIN "qualityDocument" qd ON ar."documentType" = 'qualityDocument' AND ar."documentId" = qd."id"
LEFT JOIN "supplier" sup ON ar."documentType" = 'supplier' AND ar."documentId" = sup."id"
LEFT JOIN "projectChangeRequest" pcr ON ar."documentType" = 'projectChangeRequest' AND ar."documentId" = pcr."id" AND ar."companyId" = pcr."companyId";
