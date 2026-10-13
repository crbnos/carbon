-- The project workspace: projects grow, plus states, milestones, labels, elements,
-- element labels and comments, and plan lines (material and other costs).
-- RLS lives in packages/database/src/authz/manifest.ts.
-- Spec: .ai/specs/2026-10-03-projects.md (The project workspace; Plan, budget, actuals)

CREATE TYPE "projectStatus" AS ENUM ('Draft', 'Released', 'On Hold', 'Technically Complete', 'Closed');
CREATE TYPE "projectCostTreatment" AS ENUM ('Statistical', 'Expense', 'Capitalize', 'Contract');
CREATE TYPE "projectElementType" AS ENUM ('Folder', 'System', 'Requirement', 'Function', 'Task', 'Test Case', 'Parameter');
CREATE TYPE "projectStateGroup" AS ENUM ('Backlog', 'Unstarted', 'Started', 'Completed', 'Cancelled');
CREATE TYPE "projectElementPriority" AS ENUM ('Urgent', 'High', 'Medium', 'Low', 'None');

-- project: grow the existing table. Every new column is nullable or has a DEFAULT,
-- so db:check:backups stays green.
ALTER TABLE "project"
  ADD COLUMN IF NOT EXISTS "identifier" TEXT,
  ADD COLUMN IF NOT EXISTS "nextElementSequence" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "status" "projectStatus" NOT NULL DEFAULT 'Released',
  ADD COLUMN IF NOT EXISTS "costTreatment" "projectCostTreatment" NOT NULL DEFAULT 'Statistical',
  ADD COLUMN IF NOT EXISTS "costAccountId" TEXT,
  ADD COLUMN IF NOT EXISTS "customerId" TEXT,
  ADD COLUMN IF NOT EXISTS "ownerId" TEXT REFERENCES "user"("id"),
  ADD COLUMN IF NOT EXISTS "locationId" TEXT,
  ADD COLUMN IF NOT EXISTS "startDate" DATE,
  ADD COLUMN IF NOT EXISTS "endDate" DATE,
  ADD COLUMN IF NOT EXISTS "priority" "projectElementPriority" NOT NULL DEFAULT 'None',
  ADD COLUMN IF NOT EXISTS "isTemplate" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "customFields" JSONB;

ALTER TABLE "project"
  ADD CONSTRAINT "project_identifier_check" CHECK ("identifier" IS NULL OR "identifier" ~ '^[A-Z][A-Z0-9]{1,5}$'),
  ADD CONSTRAINT "project_costAccount_fkey" FOREIGN KEY ("costAccountId") REFERENCES "account"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "project_customer_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "project_location_fkey" FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "project_identifier_key" ON "project" ("companyId", "identifier") WHERE "identifier" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "project_costAccountId_idx" ON "project" ("costAccountId");
CREATE INDEX IF NOT EXISTS "project_customerId_idx" ON "project" ("customerId");
CREATE INDEX IF NOT EXISTS "project_ownerId_idx" ON "project" ("ownerId");
CREATE INDEX IF NOT EXISTS "project_locationId_idx" ON "project" ("locationId");

CREATE TABLE IF NOT EXISTS "projectState" (
  "id" TEXT NOT NULL DEFAULT id('pjs'),
  "companyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "group" "projectStateGroup" NOT NULL,
  "color" TEXT NOT NULL,
  "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "isDefault" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "projectState_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectState_project_key" UNIQUE ("id", "projectId", "companyId"),
  CONSTRAINT "projectState_name_key" UNIQUE ("projectId", "name", "companyId"),
  CONSTRAINT "projectState_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectState_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
-- one default state per group per project
CREATE UNIQUE INDEX IF NOT EXISTS "projectState_default_key" ON "projectState" ("projectId", "group", "companyId") WHERE "isDefault";

CREATE INDEX IF NOT EXISTS "projectState_companyId_idx" ON "projectState" ("companyId");
CREATE INDEX IF NOT EXISTS "projectState_projectId_idx" ON "projectState" ("projectId", "companyId");
CREATE INDEX IF NOT EXISTS "projectState_createdBy_idx" ON "projectState" ("createdBy");
CREATE INDEX IF NOT EXISTS "projectState_updatedBy_idx" ON "projectState" ("updatedBy");

CREATE TABLE IF NOT EXISTS "projectMilestone" (
  "id" TEXT NOT NULL DEFAULT id('pjm'),
  "companyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" JSONB,
  "startDate" DATE,
  "endDate" DATE,
  "completedAt" TIMESTAMP WITH TIME ZONE,
  "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "projectMilestone_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectMilestone_project_key" UNIQUE ("id", "projectId", "companyId"),
  CONSTRAINT "projectMilestone_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectMilestone_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "projectMilestone_dates_check" CHECK ("endDate" IS NULL OR "startDate" IS NULL OR "endDate" >= "startDate")
);

CREATE INDEX IF NOT EXISTS "projectMilestone_companyId_idx" ON "projectMilestone" ("companyId");
CREATE INDEX IF NOT EXISTS "projectMilestone_projectId_idx" ON "projectMilestone" ("projectId", "companyId");
CREATE INDEX IF NOT EXISTS "projectMilestone_createdBy_idx" ON "projectMilestone" ("createdBy");
CREATE INDEX IF NOT EXISTS "projectMilestone_updatedBy_idx" ON "projectMilestone" ("updatedBy");

CREATE TABLE IF NOT EXISTS "projectLabel" (
  "id" TEXT NOT NULL DEFAULT id('pjb'),
  "companyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "color" TEXT NOT NULL,
  "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "projectLabel_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectLabel_project_key" UNIQUE ("id", "projectId", "companyId"),
  CONSTRAINT "projectLabel_name_key" UNIQUE ("projectId", "name", "companyId"),
  CONSTRAINT "projectLabel_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectLabel_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "projectLabel_companyId_idx" ON "projectLabel" ("companyId");
CREATE INDEX IF NOT EXISTS "projectLabel_projectId_idx" ON "projectLabel" ("projectId", "companyId");
CREATE INDEX IF NOT EXISTS "projectLabel_createdBy_idx" ON "projectLabel" ("createdBy");
CREATE INDEX IF NOT EXISTS "projectLabel_updatedBy_idx" ON "projectLabel" ("updatedBy");

CREATE TABLE IF NOT EXISTS "projectElement" (
  "id" TEXT NOT NULL DEFAULT id('pje'),
  "companyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "readableId" TEXT NOT NULL DEFAULT '',            -- set by insertProjectElement: identifier-sequence
  "sequence" INTEGER NOT NULL DEFAULT 0,
  "type" "projectElementType" NOT NULL,
  "parentId" TEXT,
  "name" TEXT NOT NULL,
  "description" JSONB,
  "stateId" TEXT NOT NULL,
  "ownerId" TEXT REFERENCES "user"("id"),
  "priority" "projectElementPriority" NOT NULL DEFAULT 'None',
  "milestoneId" TEXT,
  "startDate" DATE,
  "targetDate" DATE,
  "completedAt" TIMESTAMP WITH TIME ZONE,
  "estimatedHours" NUMERIC,
  "isChargeable" BOOLEAN NOT NULL DEFAULT TRUE,
  "isBilling" BOOLEAN NOT NULL DEFAULT FALSE,
  "budget" NUMERIC,
  "estimateAtCompletion" NUMERIC,
  "costTreatment" "projectCostTreatment",
  "costTreatmentEffectiveFrom" DATE,
  "costAccountId" TEXT REFERENCES "account"("id") ON DELETE SET NULL,
  "itemId" TEXT,
  "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "projectElement_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectElement_project_key" UNIQUE ("id", "projectId", "companyId"),
  CONSTRAINT "projectElement_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectElement_parent_fkey" FOREIGN KEY ("parentId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectElement_state_fkey" FOREIGN KEY ("stateId", "projectId", "companyId") REFERENCES "projectState"("id", "projectId", "companyId"),
  CONSTRAINT "projectElement_milestone_fkey" FOREIGN KEY ("milestoneId", "companyId") REFERENCES "projectMilestone"("id", "companyId") ON DELETE SET NULL ("milestoneId"),
  CONSTRAINT "projectElement_item_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE SET NULL,
  CONSTRAINT "projectElement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "projectElement_parent_check" CHECK ("parentId" IS NULL OR "parentId" <> "id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "projectElement_readable_key" ON "projectElement" ("readableId", "companyId") WHERE "readableId" <> '';

CREATE INDEX IF NOT EXISTS "projectElement_companyId_idx" ON "projectElement" ("companyId");
CREATE INDEX IF NOT EXISTS "projectElement_projectId_idx" ON "projectElement" ("projectId", "companyId");
CREATE INDEX IF NOT EXISTS "projectElement_parentId_idx" ON "projectElement" ("parentId", "projectId", "companyId");
CREATE INDEX IF NOT EXISTS "projectElement_stateId_idx" ON "projectElement" ("stateId", "projectId", "companyId");
CREATE INDEX IF NOT EXISTS "projectElement_ownerId_idx" ON "projectElement" ("ownerId");
CREATE INDEX IF NOT EXISTS "projectElement_milestoneId_idx" ON "projectElement" ("milestoneId", "companyId");
CREATE INDEX IF NOT EXISTS "projectElement_costAccountId_idx" ON "projectElement" ("costAccountId");
CREATE INDEX IF NOT EXISTS "projectElement_itemId_idx" ON "projectElement" ("itemId");
CREATE INDEX IF NOT EXISTS "projectElement_createdBy_idx" ON "projectElement" ("createdBy");
CREATE INDEX IF NOT EXISTS "projectElement_updatedBy_idx" ON "projectElement" ("updatedBy");

CREATE TABLE IF NOT EXISTS "projectElementLabel" (
  "projectElementId" TEXT NOT NULL,
  "projectLabelId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "projectElementLabel_pkey" PRIMARY KEY ("projectElementId", "projectLabelId", "companyId"),
  CONSTRAINT "projectElementLabel_element_fkey" FOREIGN KEY ("projectElementId", "companyId") REFERENCES "projectElement"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectElementLabel_label_fkey" FOREIGN KEY ("projectLabelId", "companyId") REFERENCES "projectLabel"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectElementLabel_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "projectElementLabel_companyId_idx" ON "projectElementLabel" ("companyId");
CREATE INDEX IF NOT EXISTS "projectElementLabel_projectElementId_idx" ON "projectElementLabel" ("projectElementId", "companyId");
CREATE INDEX IF NOT EXISTS "projectElementLabel_projectLabelId_idx" ON "projectElementLabel" ("projectLabelId", "companyId");
CREATE INDEX IF NOT EXISTS "projectElementLabel_createdBy_idx" ON "projectElementLabel" ("createdBy");

CREATE TABLE IF NOT EXISTS "projectElementComment" (
  "id" TEXT NOT NULL DEFAULT id('pjc'),
  "companyId" TEXT NOT NULL,
  "projectElementId" TEXT NOT NULL,
  "content" JSONB NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "projectElementComment_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectElementComment_element_fkey" FOREIGN KEY ("projectElementId", "companyId") REFERENCES "projectElement"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectElementComment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "projectElementComment_companyId_idx" ON "projectElementComment" ("companyId");
CREATE INDEX IF NOT EXISTS "projectElementComment_projectElementId_idx" ON "projectElementComment" ("projectElementId", "companyId");
CREATE INDEX IF NOT EXISTS "projectElementComment_createdBy_idx" ON "projectElementComment" ("createdBy");
CREATE INDEX IF NOT EXISTS "projectElementComment_updatedBy_idx" ON "projectElementComment" ("updatedBy");

-- Plan lines: the BOM-like content of an element.
CREATE TABLE IF NOT EXISTS "projectElementMaterial" (
  "id" TEXT NOT NULL DEFAULT id('pjp'),
  "companyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "projectElementId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL REFERENCES "item"("id"),
  "methodType" "methodType" NOT NULL DEFAULT 'Pull from Inventory',
  "quantity" NUMERIC NOT NULL CHECK ("quantity" > 0),
  "unitOfMeasureCode" TEXT,
  "requiredDate" DATE,
  "quantityIssued" NUMERIC NOT NULL DEFAULT 0,
  "unitCost" NUMERIC,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "projectElementMaterial_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectElementMaterial_element_fkey" FOREIGN KEY ("projectElementId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectElementMaterial_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "projectElementMaterial_companyId_idx" ON "projectElementMaterial" ("companyId");
CREATE INDEX IF NOT EXISTS "projectElementMaterial_projectElementId_idx" ON "projectElementMaterial" ("projectElementId", "projectId", "companyId");
CREATE INDEX IF NOT EXISTS "projectElementMaterial_projectId_idx" ON "projectElementMaterial" ("projectId", "companyId");
CREATE INDEX IF NOT EXISTS "projectElementMaterial_itemId_idx" ON "projectElementMaterial" ("itemId");
CREATE INDEX IF NOT EXISTS "projectElementMaterial_createdBy_idx" ON "projectElementMaterial" ("createdBy");
CREATE INDEX IF NOT EXISTS "projectElementMaterial_updatedBy_idx" ON "projectElementMaterial" ("updatedBy");

CREATE TABLE IF NOT EXISTS "projectElementCost" (
  "id" TEXT NOT NULL DEFAULT id('pjo'),
  "companyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "projectElementId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "amount" NUMERIC NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "projectElementCost_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectElementCost_element_fkey" FOREIGN KEY ("projectElementId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectElementCost_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "projectElementCost_companyId_idx" ON "projectElementCost" ("companyId");
CREATE INDEX IF NOT EXISTS "projectElementCost_projectElementId_idx" ON "projectElementCost" ("projectElementId", "projectId", "companyId");
CREATE INDEX IF NOT EXISTS "projectElementCost_projectId_idx" ON "projectElementCost" ("projectId", "companyId");
CREATE INDEX IF NOT EXISTS "projectElementCost_createdBy_idx" ON "projectElementCost" ("createdBy");
CREATE INDEX IF NOT EXISTS "projectElementCost_updatedBy_idx" ON "projectElementCost" ("updatedBy");
