-- Projects Phase 1b: saved views and per-user preferences of the Elements page.
-- Verification has no SQL function: a pure TypeScript function computes it from the
-- rows the page already loads.
-- Spec: .ai/specs/2026-10-03-projects.md (Views)

CREATE TABLE IF NOT EXISTS "projectView" (
  "id" TEXT NOT NULL DEFAULT id('pjv'),
  "companyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isShared" BOOLEAN NOT NULL DEFAULT FALSE,
  "layout" "projectLayout" NOT NULL DEFAULT 'list',
  "filters" JSONB NOT NULL DEFAULT '{}',
  "displayOptions" JSONB NOT NULL DEFAULT '{}',
  "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "projectView_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectView_name_key" UNIQUE ("projectId", "name", "createdBy", "companyId"),
  CONSTRAINT "projectView_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectView_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "projectView_companyId_idx" ON "projectView" ("companyId");
CREATE INDEX IF NOT EXISTS "projectView_projectId_idx" ON "projectView" ("projectId", "companyId");
CREATE INDEX IF NOT EXISTS "projectView_createdBy_idx" ON "projectView" ("createdBy");
CREATE INDEX IF NOT EXISTS "projectView_updatedBy_idx" ON "projectView" ("updatedBy");

CREATE TABLE IF NOT EXISTS "projectUserPreference" (
  "projectId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user"("id"),
  "companyId" TEXT NOT NULL,
  "layout" "projectLayout" NOT NULL DEFAULT 'list',
  "filters" JSONB NOT NULL DEFAULT '{}',
  "displayOptions" JSONB NOT NULL DEFAULT '{}',
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "projectUserPreference_pkey" PRIMARY KEY ("projectId", "userId", "companyId"),
  CONSTRAINT "projectUserPreference_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectUserPreference_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "projectUserPreference_companyId_idx" ON "projectUserPreference" ("companyId");
CREATE INDEX IF NOT EXISTS "projectUserPreference_projectId_idx" ON "projectUserPreference" ("projectId", "companyId");
CREATE INDEX IF NOT EXISTS "projectUserPreference_userId_idx" ON "projectUserPreference" ("userId");

-- RLS: the policies are rendered from packages/database/src/authz/manifest.ts.
