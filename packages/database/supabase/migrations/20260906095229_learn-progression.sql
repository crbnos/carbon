-- Carbon Learn: learning-path progress, XP ledger, hands-on challenge attempts,
-- exam attempts, certificates, assignments, learner preferences.
-- Spec: .ai/specs/2026-08-29-learning-paths-certification.md
-- Engine tables are written ONLY by the service-role client after server-side
-- grading; learners may read their own rows; managers read a projection built
-- in resources_view-gated routes. learnAttemptAnswer has no policies at all.

CREATE TYPE "learnAttemptKind" AS ENUM ('Unit Quiz', 'Certification Exam', 'Renewal Quiz');

-- ---------------------------------------------------------------- progress
CREATE TABLE "learnUnitProgress" (
    "id" TEXT NOT NULL DEFAULT id('lup'),
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "trackSlug" TEXT NOT NULL,
    "moduleSlug" TEXT NOT NULL,
    "unitSlug" TEXT NOT NULL,
    "quizAttempts" INTEGER NOT NULL DEFAULT 0,
    "bestScore" NUMERIC,
    "completedAt" TIMESTAMP WITH TIME ZONE,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
ALTER TABLE "learnUnitProgress" ADD CONSTRAINT "learnUnitProgress_userId_unitSlug_companyId_key"
    UNIQUE ("userId", "unitSlug", "companyId");
CREATE INDEX "learnUnitProgress_companyId_idx" ON "learnUnitProgress" ("companyId");
CREATE INDEX "learnUnitProgress_user_track_idx" ON "learnUnitProgress" ("userId", "companyId", "trackSlug");

-- ---------------------------------------------------------------- attempts
CREATE TABLE "learnAttempt" (
    "id" TEXT NOT NULL DEFAULT id('lat'),
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "kind" "learnAttemptKind" NOT NULL,
    "trackSlug" TEXT NOT NULL,
    "unitSlug" TEXT,
    "questionSlugs" TEXT[] NOT NULL,
    "questionCount" INTEGER NOT NULL,
    "correctCount" INTEGER,
    "passed" BOOLEAN,
    "contentVersion" TEXT NOT NULL,
    "startedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "submittedAt" TIMESTAMP WITH TIME ZONE,
    "expiresAt" TIMESTAMP WITH TIME ZONE,
    "voidedAt" TIMESTAMP WITH TIME ZONE,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX "learnAttempt_companyId_idx" ON "learnAttempt" ("companyId");
CREATE INDEX "learnAttempt_cooldown_idx" ON "learnAttempt"
    ("userId", "companyId", "kind", "trackSlug", "submittedAt");

-- Per-question grading: service-role only. A learner who could read `correct`
-- per question across retries would reconstruct the answer key.
CREATE TABLE "learnAttemptAnswer" (
    "id" TEXT NOT NULL DEFAULT id('laa'),
    "companyId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionSlug" TEXT NOT NULL,
    "selected" JSONB NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "answeredAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("attemptId", "companyId") REFERENCES "learnAttempt"("id", "companyId") ON DELETE CASCADE,
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
ALTER TABLE "learnAttemptAnswer" ADD CONSTRAINT "learnAttemptAnswer_attemptId_questionSlug_companyId_key"
    UNIQUE ("attemptId", "questionSlug", "companyId");
CREATE INDEX "learnAttemptAnswer_companyId_idx" ON "learnAttemptAnswer" ("companyId");
CREATE INDEX "learnAttemptAnswer_question_idx" ON "learnAttemptAnswer" ("companyId", "questionSlug");

-- One row per server-owned start; checks update the row. One open attempt per
-- learner x challenge x company.
CREATE TABLE "learnChallengeAttempt" (
    "id" TEXT NOT NULL DEFAULT id('lch'),
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "trackSlug" TEXT NOT NULL,
    "challengeSlug" TEXT NOT NULL,
    "contentVersion" TEXT NOT NULL,
    "startedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "checkCount" INTEGER NOT NULL DEFAULT 0,
    "passed" BOOLEAN NOT NULL DEFAULT FALSE,
    "passedAt" TIMESTAMP WITH TIME ZONE,
    "failedRequirement" TEXT,
    "message" TEXT,
    "evidence" JSONB,
    "lastCheckedAt" TIMESTAMP WITH TIME ZONE,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX "learnChallengeAttempt_companyId_idx" ON "learnChallengeAttempt" ("companyId");
CREATE UNIQUE INDEX "learnChallengeAttempt_open_idx" ON "learnChallengeAttempt"
    ("userId", "companyId", "challengeSlug") WHERE "passed" = FALSE;
CREATE INDEX "learnChallengeAttempt_user_idx" ON "learnChallengeAttempt"
    ("userId", "companyId", "challengeSlug", "passed");

-- ---------------------------------------------------------------- XP ledger
CREATE TABLE "learnXpEvent" (
    "id" TEXT NOT NULL DEFAULT id('lxp'),
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "amount" INTEGER NOT NULL,
    "kind" TEXT NOT NULL CHECK ("kind" IN ('unit_quiz','challenge','module_badge','certification','renewal')),
    "refSlug" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX "learnXpEvent_companyId_idx" ON "learnXpEvent" ("companyId");
CREATE UNIQUE INDEX "learnXpEvent_once_idx" ON "learnXpEvent" ("userId", "companyId", "kind", "refSlug");
CREATE INDEX "learnXpEvent_activity_idx" ON "learnXpEvent" ("userId", "companyId", "createdAt");

-- Daily rollup (heatmap + weekly streak). Upserted with relative increments.
CREATE TABLE "learnActivityDay" (
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "companyId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "units" INTEGER NOT NULL DEFAULT 0,
    "seconds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("userId", "day", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX "learnActivityDay_companyId_idx" ON "learnActivityDay" ("companyId");

CREATE TABLE "learnBadgeAward" (
    "id" TEXT NOT NULL DEFAULT id('lba'),
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "badgeSlug" TEXT NOT NULL,
    "awardedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
ALTER TABLE "learnBadgeAward" ADD CONSTRAINT "learnBadgeAward_userId_badgeSlug_companyId_key"
    UNIQUE ("userId", "badgeSlug", "companyId");
CREATE INDEX "learnBadgeAward_companyId_idx" ON "learnBadgeAward" ("companyId");

-- ---------------------------------------------------------------- certificates
CREATE TABLE "learnCertificate" (
    "id" TEXT NOT NULL DEFAULT id('lcert'),
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "trackSlug" TEXT NOT NULL,
    "trackTitle" TEXT NOT NULL,
    "contentVersion" TEXT NOT NULL,
    "examAttemptId" TEXT NOT NULL,
    "examScore" NUMERIC NOT NULL,
    "challengeSlugs" TEXT[] NOT NULL,
    "challengeAttemptIds" TEXT[] NOT NULL,
    "evidence" JSONB NOT NULL,
    "verificationCode" TEXT NOT NULL DEFAULT id('lcv'),
    "issuedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "renewedAt" TIMESTAMP WITH TIME ZONE,
    "revokedAt" TIMESTAMP WITH TIME ZONE,
    "revokedBy" TEXT REFERENCES "user"("id"),
    "customFields" JSONB,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("examAttemptId", "companyId") REFERENCES "learnAttempt"("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
ALTER TABLE "learnCertificate" ADD CONSTRAINT "learnCertificate_verificationCode_key" UNIQUE ("verificationCode");
ALTER TABLE "learnCertificate" ADD CONSTRAINT "learnCertificate_examAttemptId_companyId_key" UNIQUE ("examAttemptId", "companyId");
CREATE INDEX "learnCertificate_companyId_idx" ON "learnCertificate" ("companyId");
CREATE INDEX "learnCertificate_user_idx" ON "learnCertificate" ("userId", "companyId", "trackSlug", "expiresAt");
CREATE INDEX "learnCertificate_expiry_idx" ON "learnCertificate" ("expiresAt") WHERE "revokedAt" IS NULL;

-- ---------------------------------------------------------------- assignments
CREATE TABLE "learnAssignment" (
    "id" TEXT NOT NULL DEFAULT id('lasn'),
    "companyId" TEXT NOT NULL,
    "trackSlug" TEXT NOT NULL,
    "trackTitle" TEXT NOT NULL,
    "groupIds" TEXT[] NOT NULL,
    "dueDate" DATE,
    "customFields" JSONB,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX "learnAssignment_companyId_idx" ON "learnAssignment" ("companyId");
CREATE INDEX "learnAssignment_createdBy_idx" ON "learnAssignment" ("createdBy");
CREATE INDEX "learnAssignment_groupIds_idx" ON "learnAssignment" USING GIN ("groupIds");

-- ---------------------------------------------------------------- preferences
CREATE TABLE "learnPreference" (
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "companyId" TEXT NOT NULL,
    "weeklyGoalXp" INTEGER NOT NULL DEFAULT 200 CHECK ("weeklyGoalXp" IN (100, 200, 500)),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("userId", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

-- ---------------------------------------------------------------- RLS
-- Engine tables: self-only reads limited to companies the user belongs to.
-- No INSERT/UPDATE/DELETE policies — service-role writes only.
ALTER TABLE "public"."learnUnitProgress" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."learnUnitProgress" FOR SELECT USING (
  "userId" = (SELECT auth.uid()::text)
  AND "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

ALTER TABLE "public"."learnAttempt" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."learnAttempt" FOR SELECT USING (
  "userId" = (SELECT auth.uid()::text)
  AND "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

ALTER TABLE "public"."learnAttemptAnswer" ENABLE ROW LEVEL SECURITY;
-- deliberately no policies: service-role reads and writes only

ALTER TABLE "public"."learnChallengeAttempt" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."learnChallengeAttempt" FOR SELECT USING (
  "userId" = (SELECT auth.uid()::text)
  AND "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

ALTER TABLE "public"."learnXpEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."learnXpEvent" FOR SELECT USING (
  "userId" = (SELECT auth.uid()::text)
  AND "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

ALTER TABLE "public"."learnActivityDay" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."learnActivityDay" FOR SELECT USING (
  "userId" = (SELECT auth.uid()::text)
  AND "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

ALTER TABLE "public"."learnBadgeAward" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."learnBadgeAward" FOR SELECT USING (
  "userId" = (SELECT auth.uid()::text)
  AND "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

ALTER TABLE "public"."learnCertificate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."learnCertificate" FOR SELECT USING (
  "userId" = (SELECT auth.uid()::text)
  AND "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

-- Learner-owned settings: self reads and writes.
ALTER TABLE "public"."learnPreference" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."learnPreference" FOR SELECT USING (
  "userId" = (SELECT auth.uid()::text)
  AND "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."learnPreference" FOR INSERT WITH CHECK (
  "userId" = (SELECT auth.uid()::text)
  AND "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "UPDATE" ON "public"."learnPreference" FOR UPDATE USING (
  "userId" = (SELECT auth.uid()::text)
  AND "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

-- Admin-owned assignments: any employee may read; resources_* to write.
ALTER TABLE "public"."learnAssignment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."learnAssignment" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."learnAssignment" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('resources_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."learnAssignment" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('resources_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."learnAssignment" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('resources_delete'))::text[])
);

-- `learnAssignment` is the ONE Learn table a client may write, and its policies
-- can only reason about `companyId` — not about what is INSIDE `groupIds`. A
-- user with `resources_create` could therefore POST an assignment naming a
-- group from another company through PostgREST, bypassing the service-layer
-- check in `upsertLearnAssignment`, and the admin dashboard would then resolve
-- that group's members and surface another tenant's employees.
--
-- The service check stays (it produces a readable error); this is the backstop
-- that holds when the service is not in the path.
CREATE OR REPLACE FUNCTION public.learn_assignment_groups_in_company()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  foreign_group TEXT;
BEGIN
  SELECT g_id INTO foreign_group
  FROM unnest(NEW."groupIds") AS g_id
  WHERE NOT EXISTS (
    SELECT 1 FROM "group"
    WHERE "group"."id" = g_id
      AND "group"."companyId" = NEW."companyId"
  )
  LIMIT 1;

  IF foreign_group IS NOT NULL THEN
    RAISE EXCEPTION
      'Group % does not belong to company %', foreign_group, NEW."companyId"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "learnAssignment_groups_in_company"
BEFORE INSERT OR UPDATE OF "groupIds", "companyId" ON "public"."learnAssignment"
FOR EACH ROW EXECUTE FUNCTION public.learn_assignment_groups_in_company();

NOTIFY pgrst, 'reload schema';
