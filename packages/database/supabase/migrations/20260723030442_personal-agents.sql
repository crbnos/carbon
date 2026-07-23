-- Personal Agents (Kody Pattern) — Phase 1 Foundation
-- Issue: #1145   Spec: .ai/specs/2026-07-23-personal-agents.md
--
-- Two user-owned tables (personalAgent, personalAgentSession) plus a new
-- "PersonalAgents" permission module. RLS enforces BOTH multi-tenant company
-- scoping AND per-user ownership: a user only ever sees their own agents.
--
-- NOTE FOR REVIEWERS: this migration ALTERs the "module" enum and seeds
-- "employeeTypePermission" — the RBAC/permission system. It is additive (a new
-- module, no change to existing grants) and follows the quality-module
-- precedent (20250325103806_quality-module.sql), but merging it applies the
-- schema change in production. This is the intended human approval gate.

-- ---------------------------------------------------------------------------
-- Idempotent teardown (dependency order) so a partial apply can be re-run
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS "personalAgentSession";
DROP TABLE IF EXISTS "personalAgent";

-- ---------------------------------------------------------------------------
-- Permission module registration
--   ALTER TYPE ... ADD VALUE must be committed before the value can be used.
-- ---------------------------------------------------------------------------
ALTER TYPE "module" ADD VALUE IF NOT EXISTS 'PersonalAgents';
COMMIT;

DROP VIEW IF EXISTS "modules";
CREATE VIEW "modules" AS
    SELECT unnest(enum_range(NULL::module)) AS name;

-- Grant the new module to every existing employee type (all four actions),
-- scoped to each employee type's own company. New companies pick this up via
-- seed-company; existing users are re-materialized by the carbon/update-permissions job.
INSERT INTO "employeeTypePermission" ("employeeTypeId", "module", "create", "delete", "update", "view")
SELECT
    et."id",
    'PersonalAgents'::module,
    ARRAY[et."companyId"],
    ARRAY[et."companyId"],
    ARRAY[et."companyId"],
    ARRAY[et."companyId"]
FROM "employeeType" et
ON CONFLICT ("employeeTypeId", "module") DO NOTHING;

-- Materialize the new keys onto EXISTING users' flattened permission set.
-- get_companies_with_employee_permission('personalagents_<action>') reads
-- "userPermission".permissions (NOT employeeTypePermission), so without this the
-- grant above is half-applied: existing users would have the employeeTypePermission
-- row but no personalagents_* key, and every write would be silently denied until
-- the carbon/update-permissions job re-materialized them. Mirrors the quality-module
-- precedent (20250325103806). New companies/users are covered by seed-company.
-- Each employee is granted their own companies — the same all-employee-types grant
-- seeded above (the read helper re-intersects with employee membership anyway).
UPDATE "userPermission" up
SET "permissions" = COALESCE(up."permissions", '{}'::jsonb) || jsonb_build_object(
    'personalagents_view',   uc.companies,
    'personalagents_create', uc.companies,
    'personalagents_update', uc.companies,
    'personalagents_delete', uc.companies
)
FROM (
    SELECT "userId", to_jsonb(array_agg(DISTINCT "companyId"::text)) AS companies
    FROM "userToCompany"
    WHERE "role" = 'employee'
    GROUP BY "userId"
) uc
WHERE up."id"::text = uc."userId";

-- ---------------------------------------------------------------------------
-- personalAgent — one row per user-owned agent
-- ---------------------------------------------------------------------------
CREATE TABLE "personalAgent" (
    "id" TEXT NOT NULL DEFAULT id('pa'),
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    -- Provider model id. Only OpenAI is wired today (see spec §Provider Reality);
    -- Claude requires wiring @ai-sdk/anthropic + ANTHROPIC_API_KEY first.
    "modelId" TEXT NOT NULL DEFAULT 'gpt-4o',
    -- Agent configuration: allowed actions, context-window prefs, TTL, etc.
    -- Shape validated in the app layer (personalAgents.models.ts), not the DB.
    "config" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    "createdBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "updatedBy" TEXT,

    CONSTRAINT "personalAgent_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "personalAgent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "personalAgent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON UPDATE CASCADE,
    CONSTRAINT "personalAgent_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
    CONSTRAINT "personalAgent_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "personalAgent_companyId_idx" ON "personalAgent" ("companyId");
CREATE INDEX "personalAgent_userId_idx" ON "personalAgent" ("userId", "companyId");
CREATE INDEX "personalAgent_createdBy_idx" ON "personalAgent" ("createdBy");

ALTER TABLE "personalAgent" ENABLE ROW LEVEL SECURITY;

-- Per-user ownership AND company scope. The company-permission check keeps the
-- module gate meaningful; the userId check enforces "your agents only".
CREATE POLICY "SELECT" ON "public"."personalAgent"
FOR SELECT USING (
    "userId" = (SELECT auth.uid())::text
    AND "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE POLICY "INSERT" ON "public"."personalAgent"
FOR INSERT WITH CHECK (
    "userId" = (SELECT auth.uid())::text
    AND "companyId" = ANY ((SELECT get_companies_with_employee_permission('personalagents_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."personalAgent"
FOR UPDATE USING (
    "userId" = (SELECT auth.uid())::text
    AND "companyId" = ANY ((SELECT get_companies_with_employee_permission('personalagents_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."personalAgent"
FOR DELETE USING (
    "userId" = (SELECT auth.uid())::text
    AND "companyId" = ANY ((SELECT get_companies_with_employee_permission('personalagents_delete'))::text[])
);

-- ---------------------------------------------------------------------------
-- personalAgentSession — one row per conversation/session for an agent
-- ---------------------------------------------------------------------------
CREATE TABLE "personalAgentSession" (
    "id" TEXT NOT NULL DEFAULT id('pas'),
    "companyId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionKey" TEXT NOT NULL,
    -- Rolling conversation/session context (message history, working memory).
    "context" JSONB NOT NULL DEFAULT '{}',
    "startedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    "endedAt" TIMESTAMP WITH TIME ZONE,
    -- Optional TTL for session expiry (nullable = no expiry).
    "expiresAt" TIMESTAMP WITH TIME ZONE,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    "createdBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "updatedBy" TEXT,

    CONSTRAINT "personalAgentSession_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "personalAgentSession_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "personalAgentSession_agentId_fkey" FOREIGN KEY ("agentId", "companyId") REFERENCES "personalAgent"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "personalAgentSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON UPDATE CASCADE,
    CONSTRAINT "personalAgentSession_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
    CONSTRAINT "personalAgentSession_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "personalAgentSession_companyId_idx" ON "personalAgentSession" ("companyId");
CREATE INDEX "personalAgentSession_agentId_idx" ON "personalAgentSession" ("agentId", "companyId");
CREATE INDEX "personalAgentSession_userId_idx" ON "personalAgentSession" ("userId", "companyId");
CREATE INDEX "personalAgentSession_createdBy_idx" ON "personalAgentSession" ("createdBy");
CREATE UNIQUE INDEX "personalAgentSession_agentId_sessionKey_idx" ON "personalAgentSession" ("agentId", "sessionKey", "companyId");

ALTER TABLE "personalAgentSession" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."personalAgentSession"
FOR SELECT USING (
    "userId" = (SELECT auth.uid())::text
    AND "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE POLICY "INSERT" ON "public"."personalAgentSession"
FOR INSERT WITH CHECK (
    "userId" = (SELECT auth.uid())::text
    AND "companyId" = ANY ((SELECT get_companies_with_employee_permission('personalagents_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."personalAgentSession"
FOR UPDATE USING (
    "userId" = (SELECT auth.uid())::text
    AND "companyId" = ANY ((SELECT get_companies_with_employee_permission('personalagents_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."personalAgentSession"
FOR DELETE USING (
    "userId" = (SELECT auth.uid())::text
    AND "companyId" = ANY ((SELECT get_companies_with_employee_permission('personalagents_delete'))::text[])
);
