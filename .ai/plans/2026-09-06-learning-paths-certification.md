# Carbon Learn — learning paths, XP & verified certification — implementation plan

**Spec:** .ai/specs/2026-08-29-learning-paths-certification.md (PR #1509 — includes the 2026-09-06 review-round changes: `learnAttemptAnswer`, server-owned challenge start, idempotent certificates, self-only RLS, `revokeCertificate`)
**Research:** .ai/research/2026-08-29-gamified-learning-certification.md
**Branch:** `sid/carbon-learn` (cut from `main` after #1509 merges; if #1509 is still open, cut from `origin/sid/learning-paths-certification-spec` instead so the spec is in-tree)

This is a **single one-shot plan**: every phase of the spec (engine, two authored
tracks with certification, admin, notifications, PDF + verify page, renewal,
question analytics, the seven remaining tracks, the docs-site inline quizzes, and
the docs/rules/AGENTS sync) is a task below. Tasks marked **[parallel-safe]**
touch disjoint files and may be run as concurrent subagents by `/execute`.

## Design summary (read before any task)

- Everything extends the **`resources`** module — no new permission family, no
  new module folder (`.ai/lessons.md:49`). Learner routes are auth-only
  (`requirePermissions(request, { role: "employee" })`, precedent
  `apps/erp/app/routes/share+/training.$id.tsx:106`); admin routes gate on
  `resources_*`.
- Curriculum is **code-shipped** under `apps/erp/app/modules/resources/learn/`.
  Client-safe metadata in `curriculum.ts`; question banks and checkers are
  `*.server.ts` and never reach the browser.
- All progress/XP/certificate **writes** go through the service-role client
  (`getCarbonServiceRole()` from `@carbon/auth/client.server`) after server-side
  grading. Engine tables have **self-only SELECT** RLS and **no write policies**
  (`itarCertification` precedent, `20260812151247_itar-certification.sql:52-79`).
  `learnAttemptAnswer` has RLS enabled and **no policies at all**.
- XP is an append-only ledger (`learnXpEvent`) with a unique index per award;
  totals are `SUM`s. Streak is computed at read time from `learnActivityDay`
  (ISO week, Monday start via `datetime.weekBounds` — `packages/utils/src/datetime.ts:34-78`),
  never stored.
- Certificate issuance is one Kysely transaction, idempotent on
  `(examAttemptId, companyId)`, and snapshots the exact passed
  `learnChallengeAttempt` ids + evidence.
- Managers see a **projection** (status per employee × track, certificate
  state) built with the service role inside `resources_view`-gated routes —
  never raw XP/attempt rows.
- Two tooling facts that shape verification commands: `apps/erp` has **no
  `test` script** (run `pnpm --filter erp exec vitest run <file>`), and any table
  with `createdBy` **must** also carry `updatedBy` even when append-only
  (`.claude/rules/conventions-database.md:83`).

## Progress
- [ ] Task 0: Preconditions, branch, dev stack
- [ ] Task 1: Migration `learn-progression` (10 tables, RLS, indexes)
- [ ] Task 2: Regenerate DB types
- [ ] Task 3: Curriculum core — types, gamify constants + pure helpers, curriculum skeleton, docs URL helper
- [ ] Task 4: Question banks — fundamentals + purchasing
- [ ] Task 5: Hands-on checkers — reader interface, fundamentals + purchasing checkers, proving tests
- [ ] Task 6: Models — zod validators in `resources.models.ts`
- [ ] Task 7: Service reads/writes in `resources.service.ts`
- [ ] Task 8: Engine — `learn/engine.server.ts` (grading, exams, challenges, XP, certificates)
- [ ] Task 9: Notifications — two events end-to-end + weekly expiring-certificate pass
- [ ] Task 10: `path.to` entries
- [ ] Task 11: Learner routes `x+/learn+/`
- [ ] Task 12: Learner UI components `ui/Learn/` (+ `victory.mp3`)
- [ ] Task 13: Admin routes + UI under `x+/resources+/` + sidebar entry
- [ ] Task 14: Certificate PDF + file route + public verify route
- [ ] Task 15: Entry points — avatar menu link, home dashboard card
- [ ] Task 16: Question analytics (docs-feedback report)
- [ ] Task 17: Track content — accounting
- [ ] Task 18: Track content — sales
- [ ] Task 19: Track content — inventory
- [ ] Task 20: Track content — production
- [ ] Task 21: Track content — planning
- [ ] Task 22: Track content — quality
- [ ] Task 23: Track content — admin
- [ ] Task 24: Docs site — anonymous `<Quiz>` MDX component + KB strip rule + three seeded quizzes
- [ ] Task 25: Docs reference page, rule file, AGENTS.md sync, agent KB regen
- [ ] Task 26: i18n, lint, scoped typecheck, conformance checks
- [ ] Task 27: Browser verification via `/test`, self-review, spec changelog, PR

## Dependencies
- Task 1 → 2 → (3, 6) → 7 → 8. Task 3 before 4 and 5. Tasks 4 and 5 are
  independent of each other **[parallel-safe]** once 3 is done.
- Task 9 needs 2 (types) and 10 (paths) but not 8. Task 10 needs nothing but
  Task 0. Tasks 9 and 10 are **[parallel-safe]** with 3–8.
- Task 11 needs 7, 8, 10, 12. Task 12 needs 3 (types) only — **[parallel-safe]**
  with 4–8.
- Task 13 needs 7, 10. Task 14 needs 2, 7, 10. Task 15 needs 10, 11.
  Task 16 needs 8.
- Tasks 17–23 need 3, 4 (as the template), 5 (as the template) — all seven are
  **[parallel-safe]** with each other and with 9–16.
- Task 24 is independent of everything but Task 0 — **[parallel-safe]**.
- Task 25 needs 11–14 (documents real behavior). Task 26 after every code
  task. Task 27 last.

---

## Task 0: Preconditions, branch, dev stack

**Depends on:** none
**Files:** none created

**Steps:**
1. Check the spec PR: `gh pr view 1509 --json state,mergedAt`. If `MERGED`, cut
   the branch from main: `git fetch origin main && git checkout -b sid/carbon-learn origin/main`.
   If `OPEN`, cut from the spec branch so the spec is in-tree:
   `git fetch origin sid/learning-paths-certification-spec && git checkout -b sid/carbon-learn origin/sid/learning-paths-certification-spec`.
2. Confirm the spec file exists on the branch and has no unchecked open question:
   `grep -c "^- \[ \]" .ai/specs/2026-08-29-learning-paths-certification.md` must
   print `0` for the Open Questions section (the Acceptance Criteria checkboxes
   are also `- [ ]`; inspect that the only unchecked boxes are under
   `## Acceptance Criteria`). If an Open Question is unchecked, STOP — return
   to `/spec-writing` Step 7.
3. Start the dev stack: `crbn up` (seeds `test@carbon.ms`, writes
   `DEV_BYPASS_EMAIL` into `.env.local`). Then `pnpm db:migrate` so the local
   schema is current before Task 1 adds to it.
4. Read once, in full: `.ai/lessons.md`, `apps/erp/app/modules/resources/AGENTS.md`,
   `.claude/rules/workflow-database-migration.md`, `.claude/rules/conventions-database.md`,
   `.claude/rules/conventions-services.md`, `.claude/rules/conventions-forms.md`,
   `.claude/rules/database-patterns.md`, `.claude/rules/date-handling.md`,
   `.claude/rules/pdf-generation-patterns.md`, `.claude/rules/i18n-lingui-system.md`.

**Verify:**
```bash
git branch --show-current && grep -c "learnAttemptAnswer" .ai/specs/2026-08-29-learning-paths-certification.md && grep '^ERP_URL' .env.local
# Expected: sid/carbon-learn ; a count >= 3 ; an ERP_URL line
```

**Out of scope:** any code change.

---

## Task 1: Migration `learn-progression` (10 tables, RLS, indexes)

**Depends on:** Task 0
**Files:**
- Create: `packages/database/supabase/migrations/{generated}_learn-progression.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20260812151247_itar-certification.sql` (service-role-only writes + gate index), `20251205021915_training.sql:93-154` (`groupIds TEXT[]` + GIN index), `.claude/rules/conventions-database.md:43-131` (table + RLS template)

**Steps:**
1. `pnpm db:migrate:new learn-progression` (never hand-write the timestamp; never `000000` HHMMSS).
2. Write the body below verbatim. Every table: composite PK `("id","companyId")`
   except the two natural-key rollups, inline audit FKs, bare `NUMERIC`
   (`no-numeric-precision`), policy names exactly `SELECT`/`INSERT`/`UPDATE`/`DELETE`,
   helpers wrapped in `(SELECT …)` with `::text[]` (`no-legacy-rls` forbids
   `has_role`/`has_company_permission`).

```sql
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
-- deliberately no policies

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

NOTIFY pgrst, 'reload schema';
```

3. Apply: `pnpm db:migrate`.

**Verify:**
```bash
grep -c 'CREATE TABLE "learn' packages/database/supabase/migrations/*_learn-progression.sql
# Expected: 10
psql "$SUPABASE_DB_URL" -c '\d "learnCertificate"' | grep -c "learnCertificate_examAttemptId_companyId_key"
# Expected: 1
psql "$SUPABASE_DB_URL" -c "select count(*) from pg_policies where tablename = 'learnAttemptAnswer';"
# Expected: 0
psql "$SUPABASE_DB_URL" -c "select count(*) from pg_policies where tablename = 'learnAssignment';"
# Expected: 4
```
If `psql` is not on PATH, use the `crbn` psql wrapper or the Supabase Studio SQL
editor with the same statements; the expected values are the same.

**Out of scope:** any change to `training*`, `itarCertification`, or the
`module` enum (no new permission family). No seed rows — the curriculum is code.

---

## Task 2: Regenerate DB types

**Depends on:** Task 1
**Files:**
- Modify (generated): `packages/database/src/types.ts`, `packages/database/supabase/functions/lib/types.ts`

**Steps:**
1. `pnpm run generate:types` (against the migrated local DB).
2. Do not hand-edit the output.

**Verify:**
```bash
grep -c "learnAttemptAnswer" packages/database/src/types.ts
# Expected: >= 4
grep -c "learnAttemptKind" packages/database/src/types.ts
# Expected: >= 2
```
If either count is 0, STOP — the migration did not apply to the DB the generator reads.

**Out of scope:** manual type edits.

---

## Task 3: Curriculum core — types, gamify constants + pure helpers, curriculum skeleton, docs URL helper

**Depends on:** Task 2
**Files:**
- Create: `apps/erp/app/modules/resources/learn/types.ts`
- Create: `apps/erp/app/modules/resources/learn/gamify.ts`
- Create: `apps/erp/app/modules/resources/learn/gamify.test.ts`
- Create: `apps/erp/app/modules/resources/learn/curriculum.ts`
- Create: `apps/erp/app/modules/resources/learn/docs.ts`
- Create: `apps/erp/app/modules/resources/learn/index.ts`
- Copy from (precedent): `apps/academy/app/config.tsx:17-57` (content type shape), `apps/erp/app/utils/training.ts` (hardcoded external URL style — improve by centralizing), `packages/utils/src/datetime.ts:34-78` (`datetime.weekBounds`)

**Steps:**
1. `types.ts` — client-safe types only (no answers, no checker code):
   ```ts
   export const learnTrackSlugs = ["fundamentals","purchasing","accounting","sales","inventory","production","planning","quality","admin"] as const;
   export type LearnTrackSlug = (typeof learnTrackSlugs)[number];
   export type LearnDocLink = { title: string; url: string };            // url = absolute docs URL
   export type LearnUnitAssessment =
     | { kind: "quiz"; questionCount: 4 | 5 }
     | { kind: "challenge"; challengeSlug: string };
   export type LearnUnit = { slug: string; title: string; objective: string; estimatedMinutes: number; docs: LearnDocLink[]; assessment: LearnUnitAssessment };
   export type LearnModule = { slug: string; title: string; description: string; badgeSlug: string; badgeTitle: string; units: LearnUnit[] };
   export type LearnExamBlueprint = { questionCount: number; timeLimitMinutes: number; topics: Array<{ topic: string; count: number }> };
   export type LearnChallengeMeta = { slug: string; trackSlug: LearnTrackSlug; title: string; brief: string; requirements: Array<{ key: string; label: string }>; capstone: boolean };
   export type LearnTrack = { slug: LearnTrackSlug; title: string; description: string; audience: string; modules: LearnModule[]; requiredChallengeSlugs: string[]; exam: LearnExamBlueprint; challenges: LearnChallengeMeta[]; status: "live" | "coming-soon" };
   export type LearnQuestionKind = "single" | "multi";
   export type LearnQuestionBloom = "remember" | "apply" | "analyze";
   /** Client-safe shape served to the quiz/exam runner: no answer, no explanation. */
   export type LearnServedQuestion = { slug: string; kind: LearnQuestionKind; prompt: string; options: Array<{ id: string; text: string }> };
   /** Server-only shape (banks). */
   export type LearnQuestion = LearnServedQuestion & { unitSlug: string; topic: string; bloom: LearnQuestionBloom; answer: string | string[]; explanation: string; docsUrl: string };
   export type LearnCheckResult =
     | { passed: true; evidence: Record<string, unknown> }
     | { passed: false; failedRequirement: string; message: string };
   ```
2. `gamify.ts` — every constant in one file, plus pure helpers with tests:
   ```ts
   export const LEARN_CONTENT_VERSION = "2026.09.1";           // bump on any bank/checker change
   export const QUIZ_XP_BY_PASS_ATTEMPT = [100, 50, 25] as const; // index min(attempt-1, 2)
   export const CHALLENGE_XP = 500;
   export const MODULE_BADGE_XP = 50;
   export const CERTIFICATION_XP = 1000;
   export const RENEWAL_XP = 100;
   export const WEEKLY_GOAL_OPTIONS = [100, 200, 500] as const;
   export const DEFAULT_WEEKLY_GOAL_XP = 200;
   export const HEATMAP_WEEKS = 26;
   export const HEATMAP_BUCKETS = [100, 250, 500] as const;      // <100, <250, <500, >=500 → levels 1..4; 0 → 0
   export const EXAM_PASS_RATIO = 0.8;
   export const EXAM_TIME_LIMIT_MINUTES = 45;
   export const EXAM_COOLDOWN_FIRST_HOURS = 24;
   export const EXAM_COOLDOWN_NEXT_DAYS = 7;
   export const CERTIFICATE_VALIDITY_MONTHS = 12;
   export const RENEWAL_WINDOW_DAYS = 30;
   export const RENEWAL_QUESTION_COUNT = 10;
   export function xpForLevel(level: number): number { return 250 * level * (level - 1); }
   export function levelForXp(xp: number): number { /* largest n with xpForLevel(n) <= xp, min 1 */ }
   export function quizXpForPassAttempt(attempt: number): number { return QUIZ_XP_BY_PASS_ATTEMPT[Math.min(Math.max(attempt, 1), 3) - 1]; }
   export function heatmapBucket(xp: number): 0 | 1 | 2 | 3 | 4 { /* thresholds above */ }
   export function examCooldownEnd(failedSubmittedAts: string[]): string | null { /* 0 fails → null; 1 → last+24h; ≥2 → last+7d; ISO strings, compare lexicographically */ }
   /** ISO-week streak. `weeks` are Monday-keyed "YYYY-MM-DD" → xp sums; `currentWeekMonday` from datetime.weekBounds(tz).from sliced to date. */
   export function weeklyStreak(weeks: Record<string, number>, goalXp: number, currentWeekMonday: string): number { /* count consecutive satisfied weeks ending at previous week; +1 if current week satisfied; unmet current week does not break */ }
   export function drawStratifiedForm(pool: Array<{ slug: string; topic: string }>, blueprint: LearnExamBlueprint["topics"], seed: string, exclude: Set<string>): string[] { /* deterministic shuffle (mulberry32 seeded from seed string hash), pick `count` per topic preferring slugs not in `exclude`, throw if a topic pool is smaller than count */ }
   ```
   Use integer arithmetic only (no `Math.round` on value-bearing numbers — `no-raw-rounding`); XP is integers.
3. `gamify.test.ts` — vitest (pure, no barrel imports so no glossary mock needed):
   `xpForLevel(2)===500`, `levelForXp(3600)===4`, `quizXpForPassAttempt(1|2|3|9)===100|50|25|25`,
   `heatmapBucket(0|99|100|499|500)===0|1|2|3|4`, `examCooldownEnd([])===null`, one-fail → +24h,
   two-fails → +7d from the last, `weeklyStreak` cases from the spec acceptance criteria
   (two met weeks → 2; unmet current week keeps 2; unmet previous week → 0 or 1 if current met),
   `drawStratifiedForm` returns exactly blueprint totals, is deterministic for a seed, avoids
   `exclude` when the pool allows, and throws when a topic pool is short.
4. `docs.ts`:
   ```ts
   export const DOCS_URL = "https://docs.carbon.ms";   // single source; academy hardcodes per-entry — do not copy that
   export const docsRef = (path: string, title: string): LearnDocLink => ({ title, url: `${DOCS_URL}${path}` });
   ```
5. `curriculum.ts` — `export const learnTracks: LearnTrack[]` with **all nine** tracks
   declared (so the hub can show them) but only `fundamentals` and `purchasing`
   `status: "live"` in this task; the other seven are `status: "coming-soon"` with
   empty `modules` until Tasks 17–23 fill them. Define the two live tracks' full
   module/unit structure here (titles, objectives, doc links, assessment kinds);
   question banks come in Task 4, challenge metadata + checkers in Task 5.
   - `fundamentals` (audience: everyone) — modules:
     - `orientation` (badge `fundamentals-orientation`): units `what-carbon-is` (docs `/docs`, `/guides/order`; quiz 4), `items-and-methods` (`/docs/reference/items`, `/docs/reference/methods`; quiz 5), `navigating-carbon` (`/docs/reference/account`, `/docs/glossary`; quiz 4)
     - `your-company` (badge `fundamentals-company`): units `company-and-people` (`/docs/reference/company-settings`, `/docs/reference/people`; quiz 5), `permissions` (`/docs/reference/permissions`; quiz 4), `create-an-item` (challenge `fundamentals-create-item`)
     - `requiredChallengeSlugs: ["fundamentals-create-item"]`; exam blueprint: 20 questions / 30 minutes, topics `overview:4, items:5, people:4, permissions:4, glossary:3`.
   - `purchasing` (audience: buyers, purchasing managers) — modules:
     - `suppliers-and-quotes` (badge `purchasing-sourcing`): `suppliers` (`/docs/reference/suppliers-and-customers`; quiz 4), `rfq-to-quote` (`/guides/rfq-to-po`, `/docs/reference/supplier-quotes`; quiz 5)
     - `purchase-orders` (badge `purchasing-orders`): `po-anatomy` (`/docs/reference/purchase-orders`; quiz 5), `po-status-is-computed` (`/guides/rfq-to-po#a-pos-status-is-derived-from-its-lines-every-time` — use the real anchor from the page; quiz 4), `create-and-release-a-po` (challenge `purchasing-create-release-po`)
     - `receiving-and-billing` (badge `purchasing-receiving`): `receive-goods` (`/guides/receive-and-bill`, `/docs/reference/receipts`; quiz 5), `three-way-match` (`/docs/reference/invoices`; quiz 5), `receive-a-po` (challenge `purchasing-receive-po`), `capstone-source-brackets` (challenge `purchasing-capstone-source-brackets`)
     - `requiredChallengeSlugs: ["purchasing-create-release-po","purchasing-receive-po","purchasing-capstone-source-brackets"]`; exam: 30 questions / 45 minutes, topics `suppliers:5, quotes:6, orders:8, receiving:6, invoicing:5`.
   Export helpers: `getTrack(slug)`, `getUnit(trackSlug, unitSlug)`, `getChallenge(slug)`, `liveTracks()`, `trackUnitCount(track)`, `moduleForUnit(track, unitSlug)`.
6. `index.ts` — re-export `curriculum.ts`, `gamify.ts`, `docs.ts`, `types.ts` (client-safe only; **never** re-export `*.server.ts`).

**Verify:**
```bash
pnpm --filter erp exec vitest run app/modules/resources/learn/gamify.test.ts
# Expected: all tests pass; the summary line shows "Tests  N passed" with N >= 12 (not 0 — passWithNoTests is on)
pnpm exec turbo run typecheck --filter=erp 2>&1 | tail -5
# Expected: no errors referencing modules/resources/learn
```

**Out of scope:** question text, checker logic, any DB access, `packages/react`.

---

## Task 4: Question banks — fundamentals + purchasing

**Depends on:** Task 3
**Files:**
- Create: `apps/erp/app/modules/resources/learn/banks/fundamentals.server.ts`
- Create: `apps/erp/app/modules/resources/learn/banks/purchasing.server.ts`
- Create: `apps/erp/app/modules/resources/learn/banks/index.server.ts`
- Create: `apps/erp/app/modules/resources/learn/banks/banks.test.ts`
- Copy from (precedent, for the quality bar to EXCEED): `apps/academy/app/config.tsx:1063-1108` (recall-style questions — the contrast case); source material: `docs/content/docs/reference/purchase-orders.mdx:28-39` (status flow), `docs/content/guides/rfq-to-po.mdx:23-59` and `docs/content/guides/receive-and-bill.mdx:27-63` (callout rules), `docs/content/docs/reference/invoices.mdx:12-72`

**Steps:**
1. Each bank file exports `const questions: LearnQuestion[]`. Authoring rules (apply to every track; Tasks 17–23 reuse them):
   - Slug format `${trackSlug}.${unitSlug}.${nn}` (e.g. `purchasing.po-anatomy.03`), unique across the bank.
   - `bloom` distribution per unit bank: ≥ 60% `apply`/`analyze`; `remember` items only for glossary/terminology.
   - Prompts are scenarios grounded in Carbon's behavior ("A receipt is posted for 40 of the 50 units on a PO line. What does the PO show afterwards, and why?"), never definitions from the academy config. Distractors are real misconceptions (e.g. "Posting the invoice marks it Paid" — refuted by `receive-and-bill.mdx:63`).
   - `explanation` teaches (one or two sentences) and `docsUrl` deep-links the section (`${DOCS_URL}/docs/reference/receipts#status`).
   - `kind: "multi"` items store `answer: string[]`; grading is exact set match.
   - Sizes: each `quiz` unit's bank ≥ 8 questions (unit runner draws 4–5); the track exam pool (union of all unit banks tagged with `topic`) must cover the blueprint ≥ 3× per topic — for `purchasing` that means ≥ 90 questions total with per-topic counts ≥ 15/18/24/18/15; for `fundamentals` ≥ 60 with ≥ 12/15/12/12/9.
   - Purchasing must include items on: status derived from lines (`rfq-to-po.mdx:47`), stock moves regardless of accounting (`receive-and-bill.mdx:27`), inspected parts land On Hold (`:31`), three-way match on the PO line (`:51`), posted ≠ paid (`:63`), supplier quote locked after Draft (`supplier-quotes.mdx:49`), quotes in supplier currency (`:33`), converting a quote updates item costs (`:59`), dust forgiveness (`invoices.mdx:72`), the full `purchaseOrderStatus` set (`packages/database/src/types.ts:80647-80657`) and `receiptStatus` (`:80691`).
2. `index.server.ts`:
   ```ts
   import { questions as fundamentals } from "./fundamentals.server";
   import { questions as purchasing } from "./purchasing.server";
   export const banks: Record<LearnTrackSlug, LearnQuestion[]> = { fundamentals, purchasing, accounting: [], sales: [], inventory: [], production: [], planning: [], quality: [], admin: [] };
   export function bankForTrack(slug: LearnTrackSlug): LearnQuestion[]
   export function questionsForUnit(trackSlug: LearnTrackSlug, unitSlug: string): LearnQuestion[]
   export function questionBySlug(trackSlug: LearnTrackSlug, questionSlug: string): LearnQuestion | undefined
   export function toServed(q: LearnQuestion, shuffleSeed: string): LearnServedQuestion   // strips answer/explanation, shuffles options deterministically
   export function isCorrect(q: LearnQuestion, selected: string | string[]): boolean
   ```
3. `banks.test.ts` — structural guard that every future track must pass (import the
   server module directly; it has no barrel dependencies):
   - all slugs unique and match `/^[a-z]+\.[a-z0-9-]+\.\d{2}$/`;
   - every `unitSlug` exists in `curriculum.ts` for that track and every quiz unit has ≥ 8 questions;
   - every `answer` references existing option ids; `multi` answers are arrays of length ≥ 2;
   - every `docsUrl` starts with `DOCS_URL` and its path (minus `#anchor`) resolves to a file under `docs/content/` (`/docs/reference/x` → `docs/content/docs/reference/x.mdx`; `/guides/x` → `docs/content/guides/x.mdx`; `/docs` → `docs/content/docs/index.mdx`; `/docs/glossary` → `docs/content/docs/glossary.mdx`) — read with `node:fs`;
   - per-topic pool sizes ≥ 3 × the blueprint count for every live track;
   - `bloom` share of `remember` ≤ 40% per live track.

**Verify:**
```bash
pnpm --filter erp exec vitest run app/modules/resources/learn/banks/banks.test.ts
# Expected: pass, "Tests  N passed" with N >= 6
node -e "const fs=require('fs');const s=fs.readFileSync('apps/erp/app/modules/resources/learn/banks/purchasing.server.ts','utf8');console.log((s.match(/slug: \"purchasing\./g)||[]).length)"
# Expected: >= 90
```

**Out of scope:** the other seven tracks (Tasks 17–23), UI, DB.

---

## Task 5: Hands-on checkers — reader interface, fundamentals + purchasing checkers, proving tests

**Depends on:** Task 3
**Files:**
- Create: `apps/erp/app/modules/resources/learn/checkers/reader.server.ts`
- Create: `apps/erp/app/modules/resources/learn/checkers/fundamentals.server.ts`
- Create: `apps/erp/app/modules/resources/learn/checkers/purchasing.server.ts`
- Create: `apps/erp/app/modules/resources/learn/checkers/index.server.ts`
- Create: `apps/erp/app/modules/resources/learn/checkers/checkers.test.ts`
- Copy from (precedent): `packages/database/src/types.ts:40064-40093` (`purchaseOrder` columns), `:40643-40694` (`purchaseOrderLine`), `:45497-45522` (`receipt`), `:45920-45940` (`receiptLine`), `:53092-53119` (`supplier`), `:54544-54571` (`supplierQuote`); enum values `purchaseOrderStatus` `:80647-80657`, `receiptStatus` `:80691`, `supplierQuoteStatus` `:80786-80791`

**Steps:**
1. `reader.server.ts` — a narrow data-access interface so checkers are unit-testable with fakes:
   ```ts
   export type ReaderScope = { companyId: string; userId: string; since: string /* ISO */ };
   export interface LearnReader {
     itemsCreatedBy(scope: ReaderScope): Promise<Array<{ id: string; readableId: string; name: string; type: string }>>;
     purchaseOrdersCreatedBy(scope: ReaderScope): Promise<Array<{ id: string; purchaseOrderId: string; status: string; supplierId: string; createdAt: string }>>;
     purchaseOrderLines(companyId: string, purchaseOrderIds: string[]): Promise<Array<{ purchaseOrderId: string; purchaseQuantity: number | null; purchaseOrderLineType: string }>>;
     receiptsCreatedBy(scope: ReaderScope): Promise<Array<{ id: string; receiptId: string; status: string; sourceDocument: string | null; sourceDocumentId: string | null }>>;
     receiptLines(companyId: string, receiptIds: string[]): Promise<Array<{ receiptId: string; receivedQuantity: number }>>;
     suppliersCreatedSince(scope: ReaderScope): Promise<Array<{ id: string; name: string; createdBy: string | null }>>;   // supplier.createdBy is NULLABLE (types.ts:53097) — filter on companyId + createdAt, then prefer createdBy === userId when present
     supplierQuotesCreatedBy(scope: ReaderScope): Promise<Array<{ id: string; status: string; supplierId: string }>>;
     supplierQuoteLineCount(companyId: string, supplierQuoteIds: string[]): Promise<Record<string, number>>;
   }
   export function makeSupabaseReader(client: SupabaseClient<Database>): LearnReader
   ```
   Every query: `.eq("companyId", scope.companyId)`, `.eq("createdBy", scope.userId)` (except suppliers, see note), `.gte("createdAt", scope.since)`; batched `.in(...)` for line lookups — never a query inside a loop. **`purchaseOrderLine.purchaseOrderId` is the PO's UUID `id`**, and `receipt.sourceDocumentId` holds that same UUID (types.ts:40667, 45514) — never join on the readable `PO000001` string.
2. Checkers — `type LearnChecker = (ctx: { scope: ReaderScope; reader: LearnReader }) => Promise<LearnCheckResult>`; each evaluates requirements **in order** and returns the first failure with a message that names the missing thing:
   - `fundamentals-create-item` — requirements `item-exists` ("No item created by you since you started this challenge"), `item-is-part` (`type === "Part"`), `item-named` (non-empty name). Evidence `{ itemId, readableId }`.
   - `purchasing-create-release-po` — `po-exists`, `po-two-lines` (≥ 2 lines with `purchaseQuantity > 0` and `purchaseOrderLineType !== "Comment"`), `po-released` (status ∈ `["To Receive and Invoice","To Receive","To Invoice","Completed"]` — status is **computed from lines** by `post-receipt`/`post-purchase-invoice`, so never assert a single value; message when Draft: `"${purchaseOrderId} is still Draft — release it from the order's status menu"`). Evidence `{ purchaseOrderId: id, readableId }`. Pick the newest qualifying PO.
   - `purchasing-receive-po` — `po-exists-released` (as above), `receipt-exists` (receipt with `sourceDocument === "Purchase Order"` and `sourceDocumentId` ∈ learner PO ids), `receipt-posted` (`status === "Posted"`), `receipt-has-quantity` (≥ 1 line `receivedQuantity > 0`). Evidence `{ purchaseOrderId, receiptId, readableId }`.
   - `purchasing-capstone-source-brackets` (capstone, no step-by-step in the brief: "Northspoke needs 500 mounting brackets from a supplier you don't have yet. Get them on order and into stock.") — `supplier-created`, `quote-active` (supplier quote for that supplier with `status === "Active"` and ≥ 1 line), `po-released-for-supplier`, `receipt-posted`. Evidence with all four ids.
   Register challenge metadata (title, brief, requirement labels, `capstone`) in `curriculum.ts` `challenges` arrays (Task 3 left them empty for this task to fill) and the checker functions in `checkers/index.server.ts`: `export const checkers: Record<string, LearnChecker>`; `getChecker(slug)`.
3. `checkers.test.ts` — the **proving rule** for every checker: (a) `fail-on-empty`: a fake reader returning `[]` everywhere → `passed: false` with the FIRST requirement key; (b) `pass-on-known-good`: a fake reader seeded with a qualifying sequence → `passed: true` and evidence ids; (c) `first-failure-names-the-thing`: a Draft PO → `failedRequirement === "po-released"` and the message contains the PO readable id; (d) `other-user-never-passes`: records filtered out by the reader scope (assert the fake received `scope.userId`); (e) `since-respected`: assert the fake received `scope.since`. Add a meta-test that every `challengeSlug` referenced in `curriculum.ts` has a registered checker and vice versa.

**Verify:**
```bash
pnpm --filter erp exec vitest run app/modules/resources/learn/checkers/checkers.test.ts
# Expected: pass, "Tests  N passed" with N >= 12
```
If `purchaseOrderStatus` in `packages/database/src/types.ts` no longer contains
`"To Receive and Invoice"`, STOP and report — do not guess a replacement value.

**Out of scope:** the engine that records attempts (Task 8), UI, other tracks' checkers.

---

## Task 6: Models — zod validators in `resources.models.ts`

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/resources/resources.models.ts` — append validators after `trainingCompletionValidator` (~L356)
- Copy from (precedent): `trainingAssignmentValidator` (`resources.models.ts:342-348`)

**Steps:**
1. Append (imports `z`/`zfd` already exist at L2-3; import `learnTrackSlugs` and `WEEKLY_GOAL_OPTIONS` from `./learn`):
   ```ts
   export const learnQuizSubmissionValidator = z.object({
     attemptId: z.string().min(1),
     responses: z.string().min(1).transform((v, ctx) => { /* JSON.parse → Array<{questionSlug:string; selected:string|string[]}>; addIssue on failure */ })
   });
   export const learnExamStartValidator = z.object({
     trackSlug: z.enum(learnTrackSlugs),
     honorAccepted: z.literal("on", { errorMap: () => ({ message: "You must accept the honor statement" }) })
   });
   export const learnExamAnswerValidator = z.object({ attemptId: z.string().min(1), questionSlug: z.string().min(1), selected: z.union([z.string(), z.array(z.string())]) });
   export const learnExamFinalizeValidator = z.object({ attemptId: z.string().min(1) });
   export const learnChallengeStartValidator = z.object({ challengeSlug: z.string().min(1) });
   export const learnChallengeCheckValidator = z.object({ attemptId: z.string().min(1) });
   export const learnAssignmentValidator = z.object({
     id: zfd.text(z.string().optional()),
     trackSlug: z.enum(learnTrackSlugs, { errorMap: () => ({ message: "Track is required" }) }),
     groupIds: z.array(z.string()).min(1, { message: "At least one group is required" }),
     dueDate: zfd.text(z.string().optional())
   });
   export const learnCertificateRevokeValidator = z.object({ certificateId: z.string().min(1), reason: z.string().trim().min(1, { message: "A reason is required" }) });
   export const learnPreferenceValidator = z.object({ weeklyGoalXp: zfd.numeric(z.number().refine((n) => (WEEKLY_GOAL_OPTIONS as readonly number[]).includes(n), { message: "Choose 100, 200 or 500" })) });
   export const learnRenewalStartValidator = z.object({ certificateId: z.string().min(1) });
   ```
   Also export `type LearnAssignment = z.infer<typeof learnAssignmentValidator>`.
2. Ensure `apps/erp/app/modules/resources/index.ts` re-exports `./learn` (client-safe barrel from Task 3) so routes import `~/modules/resources`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp 2>&1 | tail -5
# Expected: no errors referencing resources.models.ts or modules/resources/learn
```

**Out of scope:** `trainingValidator` and existing validators.

---

## Task 7: Service reads/writes in `resources.service.ts`

**Depends on:** Task 6
**Files:**
- Modify: `apps/erp/app/modules/resources/resources.service.ts` — new exported functions (client first, `{ data, error }`, never throw)
- Create: `apps/erp/app/modules/resources/learn/projection.ts` (pure status computation) + `projection.test.ts`
- Copy from (precedent): `getTrainings` (`resources.service.ts:957-981`), `upsertTrainingAssignment` (`:1870`), `getUserGroups` (`apps/erp/app/modules/users/users.server.ts:808-818`), `getCompanyTimeZone` usage (`apps/erp/app/modules/people/people.service.ts:922-934`)

**Steps:**
1. Learner reads (user-scoped client; RLS self-only; always `.eq("companyId", companyId)`):
   - `getLearnUnitProgress(client, userId, companyId, trackSlug?)`
   - `getLearnXpTotal(client, userId, companyId)` — `select("amount")` and SUM in TS (no aggregate over PostgREST), return `{ data: number }`
   - `getLearnActivity(client, userId, companyId, sinceDay: string)` — `learnActivityDay` rows `gte("day", sinceDay)`
   - `getLearnBadges(client, userId, companyId)`, `getLearnCertificates(client, userId, companyId)`, `getLearnPreference(client, userId, companyId)`
   - `getLearnChallengeAttempts(client, userId, companyId, trackSlug)` — passed + open attempts
   - `getLearnExamAttempts(client, userId, companyId, trackSlug)` — `kind = 'Certification Exam'`, submitted only (for cooldown)
   - `getLearnAssignmentsForUser(client, userId, companyId)` — `client.rpc("groups_for_user", { uid: userId })` then `learnAssignment` `.eq("companyId").overlaps("groupIds", groups)`
   - `getLearnOverview(client, userId, companyId)` — `Promise.all` of the above for the hub
2. Admin (service-role client passed in by the gated route):
   - `getLearnTeamStatus(serviceRole, companyId, { search?, trackSlug?, status? } & GenericQueryFilters)` — the **projection**: assignments → `serviceRole.rpc("users_for_groups", { groups })` per assignment (batch all groupIds first; one RPC) → distinct members → `learnUnitProgress` + `learnCertificate` for those users with `.in("userId", ids)` (two queries total) → rows `{ userId, name, avatarUrl, trackSlug, trackTitle, dueDate, status: "Not started"|"In progress"|"Certified"|"Expired"|"Revoked"|"Overdue", percent, certificateId?, expiresAt? }` computed by the pure `projection.ts` helper `computeTeamStatus({ assignments, members, progress, certificates, unitCounts, today })`. Filter/sort/paginate in memory like `getTrainingAssignmentStatus` (`:883`). Never return XP, attempts, or answers.
   - `getLearnAssignment(s)`, `upsertLearnAssignment(client, { id?, trackSlug, trackTitle, groupIds, dueDate, companyId, createdBy|updatedBy })` — **before writing**, `select("id").in("id", groupIds).eq("companyId", companyId)` on `group`; if any id is missing, return `{ data: null, error: { message: "One or more groups do not belong to this company" } }`.
   - `deleteLearnAssignment(client, id, companyId)`
   - `getLearnCertificateById(serviceRole, id, companyId)`, `getLearnCertificateByCode(serviceRole, code)` (public verify), `getLearnCertificatesExpiring(serviceRole, fromIso, toIso)` (for the weekly job — lives in `packages/jobs`, so implement the query inline there in Task 9; keep this one for the admin dashboard "expiring soon" chip).
   - `getLearnQuestionStats(serviceRole, companyId)` — aggregate `learnAttemptAnswer` by `questionSlug` (`select("questionSlug, correct")` → counts in TS), returns `{ questionSlug, attempts, correctRate }` — Task 16 joins to banks.
3. Learner writes through the user client: `upsertLearnPreference(client, { userId, companyId, weeklyGoalXp })` (self policies exist).
4. `projection.test.ts` — Not started / In progress % / Certified (active) / Expired / Revoked / Overdue (dueDate < today and not certified) cases, using string dates only.

**Verify:**
```bash
pnpm --filter erp exec vitest run app/modules/resources/learn/projection.test.ts
# Expected: pass, N >= 6
pnpm exec turbo run typecheck --filter=erp 2>&1 | tail -5
# Expected: clean
```
Note: staging `resources.service.ts` triggers the pre-commit MCP regen
(`scripts/generate-mcp.ts`) — that is expected; let it stage `tool-metadata.json`.

**Out of scope:** grading, XP writes, certificate issuance (Task 8); any UI.

---

## Task 8: Engine — `learn/engine.server.ts` (grading, exams, challenges, XP, certificates)

**Depends on:** Tasks 4, 5, 7
**Files:**
- Create: `apps/erp/app/modules/resources/learn/engine.server.ts`
- Create: `apps/erp/app/modules/resources/learn/engine.test.ts`
- Copy from (precedent): `apps/erp/app/modules/shared/shared.server.ts:388-402` (Kysely transaction), `apps/erp/app/services/database.server.ts` (`getDatabaseClient`), `packages/database/supabase/migrations/20260812002454_item-stock-quantities-incremental.sql:105-120` (`ON CONFLICT … DO UPDATE SET x = t.x + EXCLUDED.x`), `apps/erp/app/routes/share+/training.$id.tsx:149-291` (server grading + completion write shape)

**Steps:**
1. Module setup: `import { getCarbonServiceRole } from "@carbon/auth/client.server"`, `import { getDatabaseClient } from "~/services/database.server"`, `import { sql } from "kysely"`, `import { datetime } from "@carbon/utils"`, `import { getCompanyTimeZone } from "@carbon/database"`. All functions take `{ serviceRole, db }` from the caller? No — this is a `.server.ts`, so it may construct them itself: `const serviceRole = await getCarbonServiceRole(); const db = getDatabaseClient();` inside each entry point (the `no-db-client-in-service` rule only bans `*.service.ts`).
2. `awardXp(trx, { companyId, userId, amount, kind, refSlug })` — `INSERT … ON CONFLICT DO NOTHING` on the unique index (Kysely `.onConflict((oc) => oc.columns([...]).doNothing())`), returns whether a row was inserted; when inserted, upsert `learnActivityDay` for `day = datetime.today(tz).toString()` (tz via `getCompanyTimeZone(db, companyId)`) with `xp = learnActivityDay.xp + EXCLUDED.xp`, `units + EXCLUDED.units`.
3. `startQuizAttempt({ companyId, userId, trackSlug, unitSlug })` — draws `questionCount` slugs from `questionsForUnit` (seed = new attempt id), inserts `learnAttempt` (`kind 'Unit Quiz'`, `contentVersion: LEARN_CONTENT_VERSION`), returns `{ attemptId, questions: LearnServedQuestion[] }`.
4. `gradeQuizAttempt({ companyId, userId, attemptId, responses })` — re-read the attempt under `companyId` + `userId` (404 otherwise); void if `contentVersion !== LEARN_CONTENT_VERSION` (`voidedAt`, return `{ voided: true }`); grade each response with `isCorrect` against the served `questionSlugs` only (ignore extras; missing = wrong); in one Kysely transaction: insert `learnAttemptAnswer` rows, update the attempt (`correctCount`, `passed = correct === count`, `submittedAt`), upsert `learnUnitProgress` (`quizAttempts + 1`, `bestScore = max`, `completedAt` on first pass), and on first pass `awardXp` `quizXpForPassAttempt(quizAttempts)` with `refSlug = unitSlug`, then `maybeAwardModuleBadge` (all units of the module have `completedAt` → `learnBadgeAward` + `MODULE_BADGE_XP` with `refSlug = badgeSlug`). Return per-question feedback `{ questionSlug, correct, explanation, docsUrl }` **in the response only**.
5. `startExamAttempt({ companyId, userId, trackSlug })` — guards: track live; every `requiredChallengeSlugs` has a passed `learnChallengeAttempt`; `examCooldownEnd(failedSubmittedAts)` is null or past (`datetime.timestamp()` compare); no open attempt (else return it). Draw `drawStratifiedForm(bankForTrack, blueprint.topics, seed, excludeSlugsFromLastAttempt)`, insert attempt with `expiresAt = now + EXAM_TIME_LIMIT_MINUTES`, return `{ attemptId, questions[0], index: 0, total, expiresAt }` (one question at a time — the runner asks for the next via `answerExamQuestion`).
6. `answerExamQuestion({ companyId, userId, attemptId, questionSlug, selected })` — re-read; reject if `submittedAt`/`voidedAt` set; if `datetime.timestamp() > expiresAt` → finalize with what exists; void on version mismatch; the `questionSlug` must equal `questionSlugs[answeredCount]` (no back-navigation, no skipping); insert the `learnAttemptAnswer` row; return the next served question or `{ done: true }`.
7. `finalizeExamAttempt({ companyId, userId, attemptId })` — sums stored `learnAttemptAnswer.correct`, sets `correctCount`, `passed = correct / count >= EXAM_PASS_RATIO`, `submittedAt`; on pass calls `issueCertificate`. Returns `{ passed, correctCount, questionCount, perTopic: [{ topic, correct, total }], certificateId? }` — never per-question.
8. `startChallenge({ companyId, userId, trackSlug, challengeSlug })` — select the open attempt (`passed = false`) for the triple; if none, insert one (`startedAt` = server default, `contentVersion`). Idempotent; returns the row.
9. `checkChallenge({ companyId, userId, attemptId })` — re-read under `companyId` + `userId` (throw `new Response("Not found", { status: 404 })` on miss — company-bound); build `scope = { companyId, userId, since: attempt.startedAt }`; run `getChecker(slug)({ scope, reader: makeSupabaseReader(serviceRole) })`; update the row (`checkCount + 1`, `lastCheckedAt`, `failedRequirement`/`message` or `passed = true`, `passedAt`, `evidence`); on first pass, in a transaction: `awardXp(CHALLENGE_XP, kind 'challenge', refSlug challengeSlug)` + `learnUnitProgress.completedAt` for the unit whose assessment is this challenge + `maybeAwardModuleBadge`. Return `LearnCheckResult`.
10. `issueCertificate(trx, { companyId, userId, trackSlug, examAttemptId, examScore })` — re-verify inside the transaction: exam attempt `passed = true` and belongs to user/company; every required challenge has a passed attempt (select the passed rows) — else throw; insert `learnCertificate` with `trackTitle`, `contentVersion`, `challengeSlugs`, `challengeAttemptIds`, `evidence: [{ slug, attemptId, passedAt, contentVersion, evidence }]`, `expiresAt = issuedAt + CERTIFICATE_VALIDITY_MONTHS` (compute with `@internationalized/date`: `parseAbsolute(now, tz).add({ months: 12 }).toAbsoluteString()`), `createdBy: userId`; `.onConflict(oc => oc.columns(["examAttemptId","companyId"]).doNothing())` then re-select by `(examAttemptId, companyId)` and return the existing row when nothing was inserted; `awardXp(CERTIFICATION_XP, 'certification', trackSlug)`; after commit, fire nothing here (the route fires the notification — see Task 11).
11. `startRenewalAttempt({ companyId, userId, certificateId })` — certificate active, within `RENEWAL_WINDOW_DAYS` of `expiresAt`, not revoked; draw `RENEWAL_QUESTION_COUNT` from the track bank (`kind 'Renewal Quiz'`), no time limit. `finalizeRenewalAttempt` — pass ≥ `EXAM_PASS_RATIO` → `expiresAt + 12 months`, `renewedAt = now`, `awardXp(RENEWAL_XP, 'renewal', certificateId)`.
12. `revokeCertificate({ companyId, certificateId, revokedBy, reason })` — set `revokedAt`, `revokedBy`, `customFields = jsonb || { revocationReason }`, `updatedBy`, `updatedAt`. No XP change.
13. `engine.test.ts` — pure-logic tests for the pieces that don't need a DB: the served-question sequencing rule (must answer `questionSlugs[n]`), the finalize scoring math, the void-on-version rule, and cooldown gating (extract these as small pure functions `nextExamQuestion`, `scoreAttempt`, `shouldVoid`, `canStartExam` in the same file and test them). Mock `@carbon/glossary` as in `apps/erp/app/utils/query.test.ts:1-11` if the import graph reaches it.

**Verify:**
```bash
pnpm --filter erp exec vitest run app/modules/resources/learn/engine.test.ts
# Expected: pass, N >= 8
pnpm exec turbo run typecheck --filter=erp 2>&1 | tail -5
# Expected: clean
grep -c "getCarbonServiceRole\|getDatabaseClient" apps/erp/app/modules/resources/resources.service.ts
# Expected: 0 (clients are constructed only in engine.server.ts / routes)
```

**Out of scope:** routes, UI, notifications (routes fire them), PDF.

---

## Task 9: Notifications — two events end-to-end + weekly expiring-certificate pass

**Depends on:** Tasks 2, 10
**Files:**
- Modify: `packages/notifications/src/index.ts` — enum (near L50), `getNotificationTopic` (L156-160 case group), `isRecurringNotificationEvent` (L105-114), `getNotificationEmailHeading` (L234-239 region), `getNotificationEmailCtaLabel` (L289-290 region)
- Modify: `packages/jobs/src/inngest/functions/notifications/notify.ts` — `defaultDestinations` (L164-178 region)
- Modify: `packages/jobs/src/inngest/functions/notifications/content.ts` — `getNotificationContent` (add cases near L676-708), `assignmentEvents` set (L1247-1263)
- Modify: `packages/jobs/src/inngest/functions/scheduled/weekly.ts` — new step between L303 and L305
- Modify: `apps/erp/app/routes/api+/link.ts` — `resolve()` cases near L20-30
- Modify: `apps/erp/app/components/Layout/Topbar/Notifications.tsx` — switch cases near L485-501
- Modify: `packages/documents/scripts/generate-notification-previews.mjs` — add the two events to the `previews` array; regenerate fixtures
- Copy from (precedent): every `TrainingAssignment` / `TrainingReminder` entry at the line ranges above

**Steps:**
1. `packages/notifications/src/index.ts`: add `LearnAssignment = "learn-assignment"` and `LearnCertificateExpiring = "learn-certificate-expiring"` to `NotificationEvent`; add both to the `NotificationTopic.Training` case group; add `LearnCertificateExpiring` to `isRecurringNotificationEvent`; headings `"Learning track assigned to you"` / `"Your Carbon certificate is expiring"`; CTA labels `"Open Learn"` / `"Renew now"`.
2. `notify.ts`: `[NotificationEvent.LearnAssignment]: [Email, Slack]`, `[NotificationEvent.LearnCertificateExpiring]: [Email, Slack]`.
3. `content.ts`: `LearnAssignment` — read `learnAssignment` by `documentId` (`select("trackTitle, dueDate")`), `description: \`Learning track "${trackTitle}" assigned to you\``, `reference: trackTitle`, details `Due` (formatted with `formatDate` from `@carbon/utils`). `LearnCertificateExpiring` — read `learnCertificate` by `documentId` (`select("trackTitle, expiresAt")`), `description: \`Your ${trackTitle} certificate expires on ${formatDate(expiresAt.slice(0,10))}\``. Add `LearnAssignment` to `assignmentEvents` (not the expiring one).
4. `weekly.ts`: after the training-reminder step, add
   `const expiring = await step.run("build-certificate-expiry-reminders", async () => { … })` that queries `learnCertificate` with `fetchAllFromTable`-style paging: `.is("revokedAt", null).gte("expiresAt", nowIso).lte("expiresAt", in30DaysIso)` (compute the bounds with `datetime.timestamp()` + `@internationalized/date` `parseAbsolute(...).add({ days: 30 })`), groups by `${companyId}:${userId}`, applies the same delivery-cap filter as L224-265 but for `NotificationEvent.LearnCertificateExpiring`, and pushes `{ name: "carbon/notify", data: { companyId, documentIds: certificateIds, event: LearnCertificateExpiring, recipient: { type: "user", userId } } }`; then `await step.sendEvent("send-certificate-expiring-notifications", expiring.notifyEvents)` outside the step (never send mid-step — L147-148 comment).
5. `api+/link.ts`: both events → `path.to.learn` (documentId is not a route param for either).
6. `Notifications.tsx`: `LearnAssignment` → `<Notification icon={<LuGraduationCap />} to={path.to.learn} {...props} />`; `LearnCertificateExpiring` → same icon `<LuBadgeCheck />`, `to={path.to.learn}`.
7. Email preview fixtures: add both events to `packages/documents/scripts/generate-notification-previews.mjs`, run it (`node packages/documents/scripts/generate-notification-previews.mjs`), then `pnpm exec biome check --write --no-errors-on-unmatched packages/documents/src/email/previews`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/notifications --filter=@carbon/jobs --filter=@carbon/documents --filter=erp 2>&1 | tail -5
# Expected: clean (an exhaustive switch over NotificationEvent would fail here if a case is missing)
grep -c "learn-assignment\|learn-certificate-expiring" packages/notifications/src/index.ts
# Expected: 2
ls packages/documents/src/email/previews | grep -c "learn"
# Expected: >= 2
```

**Out of scope:** new topics (both reuse `Training`); `notification` table (plain TEXT, no migration needed).

---

## Task 10: `path.to` entries

**Depends on:** Task 0
**Files:**
- Modify: `apps/erp/app/utils/path.ts` — add alphabetically inside `path.to` (near `training*` at ~L2172-2183 and `learn*` sorts before `location*`) and inside the `file:` block (~L959)
- Copy from (precedent): `path.to.training` (`:2172`), `path.to.completeTrainingAssignment` (`:497-498`), `path.to.file.jobTraveler` (`:961`)

**Steps:**
1. Add:
   ```ts
   learn: `${x}/learn`,
   learnAdmin: `${x}/resources/learn`,
   learnAssignment: (id: string) => generatePath(`${x}/resources/learn/assignments/${id}`),
   learnAssignments: `${x}/resources/learn/assignments`,
   learnCertificateVerify: (code: string) => generatePath(`${share}/certificate/${code}`),
   learnDeleteAssignment: (id: string) => generatePath(`${x}/resources/learn/assignments/delete/${id}`),
   learnExam: (trackSlug: string) => generatePath(`${x}/learn/${trackSlug}/exam`),
   learnPreferences: `${x}/learn/preferences`,
   learnQuestionStats: `${x}/resources/learn/questions`,
   learnRevokeCertificate: `${x}/resources/learn/revoke`,
   learnTrack: (trackSlug: string) => generatePath(`${x}/learn/${trackSlug}`),
   learnUnit: (trackSlug: string, unitSlug: string) => generatePath(`${x}/learn/${trackSlug}/${unitSlug}`),
   newLearnAssignment: `${x}/resources/learn/assignments/new`,
   ```
   and in `file:` — `learnCertificate: (id: string) => generatePath(\`${file}/learn-certificate/${id}.pdf\`),`.
2. Use `${share}` (the constant at L13), not a literal `/share`.

**Verify:**
```bash
grep -c "learn" apps/erp/app/utils/path.ts
# Expected: >= 14
pnpm exec turbo run typecheck --filter=erp 2>&1 | tail -3
# Expected: clean
```

**Out of scope:** routes themselves.

---

## Task 11: Learner routes `x+/learn+/`

**Depends on:** Tasks 7, 8, 10, 12
**Files:**
- Create: `apps/erp/app/routes/x+/learn+/_layout.tsx`
- Create: `apps/erp/app/routes/x+/learn+/_index.tsx`
- Create: `apps/erp/app/routes/x+/learn+/$trackSlug.tsx`
- Create: `apps/erp/app/routes/x+/learn+/$trackSlug.$unitSlug.tsx`
- Create: `apps/erp/app/routes/x+/learn+/$trackSlug.exam.tsx`
- Create: `apps/erp/app/routes/x+/learn+/$trackSlug.renew.tsx`
- Create: `apps/erp/app/routes/x+/learn+/preferences.tsx`
- Copy from (precedent): `apps/erp/app/routes/x+/training+/_layout.tsx` (passthrough layout with `handle`), `apps/erp/app/routes/share+/training.$id.tsx:105-150` (auth-only loader/action shape), `apps/erp/app/routes/x+/resources+/assignments.new.tsx:104-121` (`trigger("notify")` wrapped in try/catch)

**Steps:**
1. `_layout.tsx`: `meta` title `"Carbon | Learn"`, `handle: { breadcrumb: msg\`Learn\`, to: path.to.learn, module: "resources" }`, renders `<Outlet />` (no module sidebar — the hub is its own layout).
2. Every loader/action: `const { client, userId, companyId } = await requirePermissions(request, { role: "employee" });` — no module scope. Actions start with `assertIsPost(request)`.
3. `_index.tsx` loader: `getLearnOverview` + `getLearnAssignmentsForUser` + `getCompanyTimeZone` → compute `weeklyStreak` (Task 3) and heatmap buckets server-side; return tracks from `learnTracks` (client-safe) with per-track percent. Render `<LearnHub …/>` (Task 12).
4. `$trackSlug.tsx`: 404 for unknown/`coming-soon` tracks (`throw new Response("Not found", { status: 404 })`); loader returns modules/units with completion, badge states, challenge attempt states, exam gate (`locked` reasons: required challenges missing / cooldown until ISO / open attempt id), active certificate (with renewal window flag). Render `<TrackDetail …/>`.
5. `$trackSlug.$unitSlug.tsx`: loader returns the unit; for a quiz unit calls `startQuizAttempt` only when `?start=1` (so opening the page is not a sitting) — otherwise shows the objective + docs + "Start quiz"; for a challenge unit returns the open/passed `learnChallengeAttempt`. Action `intent` switch: `"start-quiz"` → `startQuizAttempt`; `"submit-quiz"` → validate `learnQuizSubmissionValidator` → `gradeQuizAttempt` → `data({ result })` (no redirect: the result view renders from action data, precedent `share+/training.$id.tsx`); `"start-challenge"` → `startChallenge`; `"check-challenge"` → `learnChallengeCheckValidator` → `checkChallenge`. Return `data({ ... })`; on service error `data({}, await flash(request, error(err, "…")))`.
6. `$trackSlug.exam.tsx`: loader: gate state + open attempt (with the *current* question only — never the whole form). Actions: `"start"` (`learnExamStartValidator`, honor checkbox) → `startExamAttempt`; `"answer"` → `answerExamQuestion`; `"finalize"` → `finalizeExamAttempt`; on `certificateId` in the result, fire `trigger("notify", …)`? No — issuance notifies nobody but the learner who is on-screen; instead, if the track was assigned, nothing else. (Admins see it on the dashboard.) Render `<ExamRunner …/>`.
7. `$trackSlug.renew.tsx`: `startRenewalAttempt` / answer / finalize, same shape, `<ExamRunner mode="renewal" />`.
8. `preferences.tsx`: `ValidatedForm` with `learnPreferenceValidator` → `upsertLearnPreference` → `throw redirect(path.to.learn, await flash(request, success("Weekly goal updated")))`.
9. All strings via `useLingui()` `t`/`<Trans>`; breadcrumbs via `msg`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp 2>&1 | tail -5
# Expected: clean
ls apps/erp/app/routes/x+/learn+ | wc -l
# Expected: 7
```
Browser (dev stack running): open `${ERP_URL}/x/learn` as `test@carbon.ms` → hub renders both live tracks and seven "coming soon" cards; open `/x/learn/purchasing/po-anatomy?start=1` → 5 questions; submit with all correct → result card shows 100 XP and confetti; `/x/learn/purchasing/exam` shows "Locked — complete 3 hands-on challenges".

**Out of scope:** admin pages (Task 13), PDF/verify (Task 14).

---

## Task 12: Learner UI components `ui/Learn/` (+ `victory.mp3`) [parallel-safe]

**Depends on:** Task 3
**Files:**
- Create under `apps/erp/app/modules/resources/ui/Learn/`: `LearnHub.tsx`, `TrackCard.tsx`, `TrackDetail.tsx`, `LevelPanel.tsx`, `WeeklyGoalRing.tsx`, `ActivityHeatmap.tsx`, `BadgeShelf.tsx`, `CertificateList.tsx`, `UnitRunner.tsx`, `QuizForm.tsx`, `QuizResult.tsx`, `ChallengePanel.tsx`, `ExamRunner.tsx`, `ExamResult.tsx`, `PracticeCompanyCallout.tsx`, `Celebration.tsx`, `index.ts`
- Create: `apps/erp/public/victory.mp3` (copy from `apps/mes/public/victory.mp3` — the ERP route `share+/training.$id.tsx:934` references a file that does not exist in `apps/erp/public/`)
- Modify: `apps/erp/app/modules/resources/ui/index.ts` — export `./Learn`
- Copy from (precedent): `apps/erp/app/routes/share+/training.$id.tsx:304-330` (wizard state), `:419-431` (shell + icon chip), `:572-760` (question step with `RadioGroup`/`Checkbox` from `@carbon/react`), `:931-946` (confetti + audio); `apps/erp/app/routes/x+/_index.tsx:498-514` (`ModuleCard`); `apps/erp/app/components/MetricCard.tsx` (stat tile); `packages/react/src/FunnelChart.tsx:1-41` (bespoke chart shape); `packages/react/src/BarProgress.tsx:61-95`

**Steps:**
1. Sourcing order: `@carbon/react` (`Card*`, `Badge`, `BarProgress`, `Button`, `IconButton`, `Heading`, `HStack`, `VStack`, `Status`, `Tooltip`, `RadioGroup`, `RadioGroupItem`, `Checkbox`, `useInterval`) → `~/components` (`Empty`, `Hyperlink`, `MetricCard`) → `~/components/Form` (`Submit`, `Hidden`, `Radios`) → new markup. Theme tokens only (`bg-primary/10`, `text-muted-foreground`); no hex.
2. `LevelPanel`: level + XP via `levelForXp`, `BarProgress progress={xpIntoLevel} max={xpForNextLevel} value={\`${xp} XP\`}`.
3. `WeeklyGoalRing`: net-new SVG ring (`<circle>` × 2, `strokeDasharray` from circumference, `stroke-primary`/`stroke-muted`), label `${weekXp}/${goal}` in `tabular-nums`, streak count below with `<LuFlame />`. Props `{ weekXp, goalXp, streak }`.
4. `ActivityHeatmap`: net-new CSS grid `grid-flow-col grid-rows-7` of 26 × 7 cells, intensity classes `["bg-muted","bg-primary/10","bg-primary/25","bg-primary/50","bg-primary/80"]` indexed by `heatmapBucket`, `title` tooltip `"${day}: ${xp} XP"`, month labels row, `role="img"` + `aria-label`. Props `{ days: Array<{ day: string; xp: number }>, weeks: number }`.
5. `TrackCard` (hub grid): icon chip (`size-12 rounded-full border bg-primary/10 text-primary` — precedent `share+/training.$id.tsx:429`), title, audience, `BarProgress`, status chip (`Status color="green"` Certified / `"yellow"` In progress / `"gray"` Not started / `"blue"` Coming soon), due date if assigned.
6. `UnitRunner`: objective, "Read these" `Hyperlink` cards opening `docs.carbon.ms` in a new tab (`target="_blank" rel="noopener noreferrer"`), then `QuizForm` or `ChallengePanel`.
7. `QuizForm`: one question per card (single → `RadioGroup`, multi → `Checkbox` list), serializes `responses` JSON into a `Hidden` input, `Submit` "Check answers". `QuizResult`: per-question ✓/✕ with the explanation and a "Read why" link to `docsUrl`; on pass renders `<Celebration />` and the XP earned (`quizXpForPassAttempt`).
8. `ChallengePanel`: brief, requirement checklist (`<LuCircle />` → `<LuCircleCheck className="text-emerald-500" />` as requirements pass; the first failing one shows the checker's `message` verbatim under it), target-company banner ("Checks run in **{company.name}**" from `useUser().company.name`), buttons "Start challenge" (hidden once an open attempt exists) and "Check my work" (`fetcher.Form`, `intent="check-challenge"`), evidence `Hyperlink`s on pass (PO → `path.to.purchaseOrder(id)`, receipt → `path.to.receipt(id)`).
9. `ExamRunner`: honor gate (`Checkbox name="honorAccepted"` + `Submit` "Start exam"); running state: countdown from `expiresAt` via `useInterval(…, 1000)` (`tabular-nums`, turns `text-destructive` under 5 min), progress dots (`flex gap-1`, `size-2 rounded-full bg-primary`/`bg-muted`), one question, "Next" (no back button); `ExamResult`: per-topic bars, pass/fail, and on pass `<Celebration />` + buttons "Download certificate" (`path.to.file.learnCertificate(id)`) and "Copy verify link".
10. `Celebration`: `ConfettiExplosion` (default import from `react-confetti-explosion`) + `<audio preload="auto"><source src="/victory.mp3" type="audio/mpeg" /></audio>` played in an effect with `.catch(() => {})`.
11. `PracticeCompanyCallout`: `Card` explaining that checks run in the current company and linking Settings → Demo Data (`path.to.demoData` if it exists — grep `path.ts` for `demo`; otherwise link `path.to.settings`).
12. Lingui everywhere (`useLingui` `t`, `<Trans>`); `t` in memo deps.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp 2>&1 | tail -5
# Expected: clean
ls apps/erp/public/victory.mp3 && ls apps/erp/app/modules/resources/ui/Learn | wc -l
# Expected: file exists ; 17
pnpm exec biome check apps/erp/app/modules/resources/ui/Learn 2>&1 | tail -2
# Expected: no errors
```

**Out of scope:** `packages/react` (keep the three net-new visual components app-local; promote later if MES wants them).

---

## Task 13: Admin routes + UI under `x+/resources+/` + sidebar entry

**Depends on:** Tasks 7, 10
**Files:**
- Create: `apps/erp/app/routes/x+/resources+/learn.tsx` (team dashboard, `<Outlet />` for drawers)
- Create: `apps/erp/app/routes/x+/resources+/learn.assignments.tsx`, `learn.assignments.new.tsx`, `learn.assignments.$id.tsx`, `learn.assignments.delete.$id.tsx`, `learn.revoke.tsx`
- Create: `apps/erp/app/modules/resources/ui/Learn/Admin/LearnTeamTable.tsx`, `LearnAssignmentForm.tsx`, `LearnAssignmentsTable.tsx`, `RevokeCertificateModal.tsx`
- Modify: `apps/erp/app/modules/resources/ui/useResourcesSubmodules.tsx` — add to the `People` group after `Assignments` (L77-86): `{ name: t\`Learn\`, to: path.to.learnAdmin, icon: <LuTrophy /> }`
- Copy from (precedent): `apps/erp/app/routes/x+/resources+/training.tsx:18-73` (list loader with `getGenericQueryFilters`), `assignments.new.tsx` (form action + notify), `apps/erp/app/modules/resources/ui/Training/TrainingAssignmentForm.tsx:36,346-357,460-465` (`ValidatedForm`, `Users name="groupIds" type="employee"`), `TrainingsTable.tsx` (`Table`, `ColumnDef`, `meta.filter`), `apps/erp/app/components/Modals` `ConfirmDelete`

**Steps:**
1. `learn.tsx` loader: `requirePermissions(request, { view: "resources", role: "employee" })`, then `const serviceRole = await getCarbonServiceRole()` (import from `@carbon/auth/client.server`) → `getLearnTeamStatus(serviceRole, companyId, { search, trackSlug, status, limit, offset, sorts, filters })`. Render `<LearnTeamTable data count />` with columns `Employee` (`EmployeeAvatar`), `Track`, `Status` (`Status` colors: Certified green, In progress yellow, Not started gray, Overdue orange, Expired red, Revoked red), `Progress` (`BarProgress progress={percent} value={\`${percent}%\`}`), `Due`, `Certificate` (`Hyperlink` to `path.to.file.learnCertificate(id)` + "Revoke" context-menu item when `permissions.can("update","resources")`). `meta.filter` static options for status and track. CSV export is automatic (`.claude/rules/table-csv-export.md`); every `header` a string; percent via `meta.exportValue`.
2. `learn.assignments.tsx` (+ `New` primary action), `learn.assignments.new.tsx` / `$id.tsx`: `create`/`update: "resources"`; action: `assertIsPost` → `validator(learnAssignmentValidator).validate(formData)` → `upsertLearnAssignment` with `trackTitle` from `getTrack(trackSlug).title` → on create, `trigger("notify", { companyId, documentId: id, event: NotificationEvent.LearnAssignment, recipient: { type: "group", groupIds }, from: userId })` in try/catch with `logger.error` → `throw redirect(path.to.learnAssignments, await flash(request, success("Assignment created")))`. The service's foreign-group rejection surfaces as `data({}, await flash(request, error(result.error, "Groups must belong to this company")))`.
3. `LearnAssignmentForm`: `ModalDrawer` form (precedent `TrainingAssignmentForm`), fields `Select name="trackSlug"` (options from `liveTracks()`), `Users name="groupIds" type="employee"`, `DatePicker name="dueDate"` (from `@carbon/form`; no default value).
4. `learn.assignments.delete.$id.tsx`: `delete: "resources"`, `ConfirmDelete` precedent.
5. `learn.revoke.tsx`: action only, `update: "resources"`, `learnCertificateRevokeValidator` → `revokeCertificate` (engine) → `data({ success: true }, await flash(request, success("Certificate revoked")))`. `RevokeCertificateModal` collects the reason.
6. Sidebar entry as above; `LuTrophy` from `react-icons/lu`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp 2>&1 | tail -5
# Expected: clean
grep -c "learnAdmin" apps/erp/app/modules/resources/ui/useResourcesSubmodules.tsx
# Expected: 1
```
Browser: `/x/resources/learn` as an admin shows the table; creating an assignment for the `test` employee group with a due date makes `/x/learn` show the track as assigned and delivers an in-app notification (topbar bell).

**Out of scope:** question analytics (Task 16).

---

## Task 14: Certificate PDF + file route + public verify route

**Depends on:** Tasks 2, 7, 10
**Files:**
- Create: `packages/documents/src/pdf/LearnCertificatePDF.tsx`
- Modify: `packages/documents/src/pdf/index.ts` — default-import + add to the flat `export { … }` block (alphabetical)
- Create: `apps/erp/app/routes/file+/learn-certificate+/$id[.]pdf.tsx`
- Create: `apps/erp/app/routes/share+/certificate.$code.tsx`
- Copy from (precedent): `packages/documents/src/pdf/KanbanLabelPDF.tsx:1-40,86-92,133-157` (hand-built Document/Page, `createTw`, QR `Image`), `apps/erp/app/routes/file+/kanban+/labels.$action[.]pdf.tsx` (route shape, stream→Buffer→Response), `apps/erp/app/routes/share+/quote.$id.tsx:100-145` (truly public loader with `getCarbonServiceRole()` and discriminated state)

**Steps:**
1. `LearnCertificatePDF` props: `{ companyName, learnerName, trackTitle, issuedAt, expiresAt, verificationCode, verifyUrl, qrDataUrl, contentVersion, examScorePercent: string, challengeCount: number, status: "Active" | "Expired" | "Revoked" }`. Landscape `Page size="A4" orientation="landscape"`, Helvetica via `createTw` (no `ensureFont` needed — Helvetica is a PDF built-in), title "Certificate of Completion", learner name large, track title, criteria line ("Certification exam passed with {score}; {n} hands-on challenges verified in Carbon"), issue/expiry dates, `Image src={qrDataUrl}` + verify URL text, content version in the footer. **Resolve the QR before render** (`await generateQRCode(verifyUrl, 1.2)` in the route — do not pass the promise like `KanbanLabelPDF.tsx:135` does; `.claude/rules/pdf-generation-patterns.md` requires resolved data URLs).
2. File route: `requirePermissions(request, { role: "employee" })`; `serviceRole = await getCarbonServiceRole()`; `getLearnCertificateById(serviceRole, id, companyId)`; authorize: `certificate.userId === userId` **or** `permissions.can("view","resources")` (get permissions from `requirePermissions` → use `{ view: "resources" }` in a second call only when not owner — simpler: call `requirePermissions(request, { role: "employee" })`, then if not owner, `await requirePermissions(request, { view: "resources" })`); read `getCompany` for the name, `user.fullName` via `select("fullName")` on `user`; build `verifyUrl = \`${ERP_URL}${path.to.learnCertificateVerify(code)}\`` (`ERP_URL` exported from `~/utils/path`); `renderToStream(<LearnCertificatePDF …/>)` → Buffer → `Response` with `Content-Disposition: inline; filename="${companyName} - ${trackTitle} Certificate.pdf"`.
3. `share+/certificate.$code.tsx`: **no `requirePermissions`**; `serviceRole = await getCarbonServiceRole()`; `getLearnCertificateByCode` (returns `{ state: "NotFound" }` on miss without revealing anything); compute `status` (Revoked > Expired (`expiresAt < datetime.timestamp()`) > Active); loader returns `{ state, learnerName, companyName, trackTitle, issuedAt, expiresAt, contentVersion, examScorePercent, challengeTitles }`; render a certificate facsimile card + status banner (`Status color` green/red/gray) + criteria list + "Download PDF" only when the viewer is signed in as owner (omit for anonymous). Add `meta` robots `noindex` is NOT required (public verify pages are meant to be linkable) — leave default.
4. Percent formatting through `formatPercent` / `usePercentFormatter` (`no-inline-fraction-digits`).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/documents --filter=erp 2>&1 | tail -5
# Expected: clean
grep -c "LearnCertificatePDF" packages/documents/src/pdf/index.ts
# Expected: 2
```
Browser: after a certificate exists, `${ERP_URL}/file/learn-certificate/<id>.pdf` returns a PDF (`curl -sI -b <cookie> … | grep -i "content-type: application/pdf"`), and `${ERP_URL}/share/certificate/<code>` in a private window shows Active; an unknown code shows the not-found state.

**Out of scope:** storing the PDF as a `document` row (on-demand render only; no `documentSourceType` change).

---

## Task 15: Entry points — avatar menu link, home dashboard card

**Depends on:** Tasks 10, 11
**Files:**
- Modify: `apps/erp/app/components/AvatarMenu.tsx` — add an item next to Profile (~L215): `<DropdownMenuItem asChild><Link to={path.to.learn}><DropdownMenuIcon icon={<LuGraduationCap />} /><Trans>Learn Carbon</Trans></Link></DropdownMenuItem>`
- Modify: `apps/erp/app/routes/x+/_index.tsx` — loader: `getLearnAssignmentsForUser` + `getLearnUnitProgress` (user client) → `learnCard: { trackSlug, trackTitle, percent, dueDate } | null` (the earliest-due unfinished assignment, else the most recently progressed live track, else null); render `<LearnContinueCard />` in the `lg:col-span-1` left column above `RecentlyViewed` (~L233) when non-null
- Create: `apps/erp/app/modules/resources/ui/Learn/LearnContinueCard.tsx` (uses `MetricCard`-like layout: title "Continue learning", track, `BarProgress`, `Button` "Open" → `path.to.learnTrack`)
- Copy from (precedent): `apps/erp/app/components/Layout/Topbar/HelpMenu.tsx:26-31` (menu item shape), `apps/erp/app/routes/x+/_index.tsx:498-514` (`ModuleCard`)

**Steps:** as listed; keep the dashboard loader change additive (`Promise.all` with the existing reads).

**Verify:**
```bash
grep -c "path.to.learn" apps/erp/app/components/AvatarMenu.tsx apps/erp/app/routes/x+/_index.tsx
# Expected: AvatarMenu 1 ; _index >= 1
pnpm exec turbo run typecheck --filter=erp 2>&1 | tail -3
# Expected: clean
```

**Out of scope:** `useModules` / a new nav module (Learn is not a permission module).

---

## Task 16: Question analytics (docs-feedback report)

**Depends on:** Task 8
**Files:**
- Create: `apps/erp/app/routes/x+/resources+/learn.questions.tsx`
- Create: `apps/erp/app/modules/resources/ui/Learn/Admin/LearnQuestionStatsTable.tsx`
- Modify: `apps/erp/app/modules/resources/learn/banks/index.server.ts` — add `questionMeta(slug): { trackSlug, unitSlug, topic, docsUrl, prompt }` (server-only; prompt is fine for admins)
- Copy from (precedent): `LearnTeamTable` (Task 13), `TrainingsTable.tsx` column style

**Steps:**
1. Loader: `view: "resources"`; `serviceRole` → `getLearnQuestionStats` → join to `questionMeta` in the loader (server) → rows `{ questionSlug, track, unit, topic, docsPage (url path without anchor), attempts, correctRate }`, sorted by `correctRate` ascending; only questions with ≥ 5 attempts (avoid identifying a single learner — aggregate only).
2. Table with `Hyperlink` to the docs page (new tab) and a `MetricCard` row: questions with `< 60%` correct ("Docs to revisit"). Tab link from `learn.tsx` header.
3. Rates formatted with `usePercentFormatter()`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp 2>&1 | tail -3
# Expected: clean
```
Browser: after ≥ 5 quiz submissions, `/x/resources/learn/questions` lists the questions with rates; no learner names appear anywhere on the page.

**Out of scope:** per-learner drill-down (privacy contract).

---

## Tasks 17–23: Track content — accounting, sales, inventory, production, planning, quality, admin [parallel-safe]

One task per track; identical shape. **Depends on:** Tasks 3, 4, 5 (as templates).
**Files (per track `<t>`):**
- Modify: `apps/erp/app/modules/resources/learn/curriculum.ts` — fill the `<t>` track (modules/units/exam blueprint/challenges), flip `status: "live"`
- Create: `apps/erp/app/modules/resources/learn/banks/<t>.server.ts`; register in `banks/index.server.ts`
- Create: `apps/erp/app/modules/resources/learn/checkers/<t>.server.ts`; register in `checkers/index.server.ts`
- Modify: `apps/erp/app/modules/resources/learn/checkers/reader.server.ts` — add the read methods the track's checkers need (batched, scoped, read-only)
- Modify: `apps/erp/app/modules/resources/learn/checkers/checkers.test.ts` — proving tests for each new checker
- Bump `LEARN_CONTENT_VERSION` in `gamify.ts` once per merged batch of tracks

**Backbone docs per track** (site paths under `docs/content/`; use the `##` headings on each page as unit topics):

| Task | Track | Units from these pages | Required hands-on challenges (checker asserts) |
|---|---|---|---|
| 17 | `accounting` | `reference/accounting`, `reference/invoices`, `reference/payments`, `reference/period-close`, `reference/dimensions`, `reference/fixed-assets`, `guides/job-costing`, `guides/job-finish-close` | `accounting-post-purchase-invoice` (a Posted purchase invoice created by the learner since start: `purchaseInvoice.status ∈ ["Open","Paid","Partially Paid"]`), `accounting-record-payment` (a payment applied to it), capstone `accounting-close-a-period` (an accounting period moved to Closed — read `accountingPeriod` status enum from `types.ts` first) |
| 18 | `sales` | `reference/quotes`, `reference/pricing`, `reference/sales-orders`, `reference/shipments`, `guides/quote-to-cash`, `guides/order-to-cash` | `sales-create-quote` (quote with ≥ 1 line), `sales-convert-to-order` (sales order whose `quoteId` is that quote, status not Draft), capstone `sales-quote-to-invoice` (quote → order → posted shipment → posted sales invoice) |
| 19 | `inventory` | `reference/inventory`, `reference/inventory-count`, `reference/picking`, `reference/traceability`, `reference/shelf-life`, `reference/scrap`, `reference/storage-rules` | `inventory-adjust-quantity` (a posted inventory adjustment by the learner), `inventory-transfer-stock` (a posted stock transfer), capstone `inventory-count-and-post` (an inventory count created and posted) |
| 20 | `production` | `reference/jobs`, `reference/scheduling`, `reference/mes`, `reference/work-centers`, `reference/routings`, `reference/kanban`, `guides/build`, `guides/floor` | `production-create-job` (job with a method — ≥ 1 `jobOperation` and ≥ 1 `jobMaterial`), `production-release-job` (job status Ready/In Progress — read `jobStatus` enum), capstone `production-complete-job` (job Completed with produced quantity > 0) |
| 21 | `planning` | `reference/planning`, `reference/forecast`, `reference/reordering`, `guides/plan` | `planning-set-reorder-policy` (an `itemReplenishment` row updated by the learner with a non-default reorder policy — verify column names in `types.ts`), capstone `planning-run-mrp-and-review` (a purchase order with status `Planned` or `To Review` created by MRP for the learner's item — read `purchaseOrder.status`) |
| 22 | `quality` | `reference/quality`, `reference/issues`, `reference/inspections`, `reference/calibration`, `reference/quality-documents`, `reference/risks`, `guides/ship` | `quality-raise-issue` (a non-conformance created by the learner), `quality-record-inspection` (an inspection record with a result), capstone `quality-close-an-issue` (issue moved to a closed status with a task completed — read the issue status enum) |
| 23 | `admin` | `reference/company-settings`, `reference/people`, `reference/permissions`, `reference/custom-fields`, `reference/sequences`, `reference/import-export`, `reference/documents`, `reference/api-keys`, `integrations/index` | `admin-create-employee-type` (an `employeeType` created with ≥ 1 module permission), `admin-add-custom-field` (a custom field on any table), capstone `admin-invite-and-permission` (an invited user assigned to that employee type) |

**Steps (per track):**
1. Read the backbone pages and quote their `StatusFlow` values + `Callout` titles; derive 6–10 units (4–5 quiz questions drawn from ≥ 8 per unit), one module per 2–4 units with a badge, an exam blueprint of 30 questions / 45 minutes across 4–6 topics (≥ 3× pool per topic), and the three challenges above (two guided + one capstone with no step-by-step).
2. Before writing a checker, open `packages/database/src/types.ts` for every table/enum it reads and copy the exact column names and enum values into the checker; if a table/enum named above does not exist under that name, STOP and report — do not invent a column.
3. Write the bank with the Task 4 authoring rules; `banks.test.ts` must stay green (it validates docs paths and pool sizes automatically).
4. Write the proving tests (fail-on-empty / pass-on-known-good / first-failure / scope) for each checker.

**Verify (per track):**
```bash
pnpm --filter erp exec vitest run app/modules/resources/learn/banks/banks.test.ts app/modules/resources/learn/checkers/checkers.test.ts
# Expected: pass; the bank test's per-track pool assertion now includes <t>
node -e "const s=require('fs').readFileSync('apps/erp/app/modules/resources/learn/banks/<t>.server.ts','utf8');console.log((s.match(/slug: \"<t>\./g)||[]).length)"
# Expected: >= 90
```

**Out of scope:** UI changes (the hub renders any live track), MES surfaces.

---

## Task 24: Docs site — anonymous `<Quiz>` MDX component + KB strip rule + three seeded quizzes [parallel-safe]

**Depends on:** Task 0
**Files:**
- Create: `docs/components/quiz.tsx`
- Modify: `docs/components/mdx.tsx` — register `Quiz`, `QuizQuestion`, `QuizOption` (L54-81 object)
- Modify: `docs/components/editorial/mdx.tsx` — register the same three in `editorialMdxComponents` (L273-295)
- Modify: `scripts/generate-agent-kb.ts` — add `out = out.replace(/<Quiz\b[^>]*>[\s\S]*?<\/Quiz>/g, "");` immediately after the `Figure` drop rules (L147-148) and **before** the catch-all rules at L160-161
- Modify: `docs/content/docs/reference/purchase-orders.mdx`, `docs/content/docs/reference/receipts.mdx`, `docs/content/guides/receive-and-bill.mdx` — one `<Quiz>` each (2–3 questions) at the end of the page's main section
- Copy from (precedent): `docs/components/checklist.tsx` (client component, `usePathname`-keyed localStorage, `_index` injection), `docs/components/editorial/mdx.tsx:158-164` (`AgentContext` render-null pattern)

**Steps:**
1. `quiz.tsx` (`"use client"`): `Quiz` clones children injecting `_index`; `QuizQuestion` props `{ prompt: string; answer: string; explanation: string; _index?: number; children }` renders the prompt, `QuizOption`s (`{ id: string; children }`) as buttons, reveals ✓/✕ + explanation after a pick, persists the chosen id under `carbon-docs:quiz:${pathname}:${_index}` (guard `window` access in an effect). Prompt/explanation/answer are **attributes**, options are children — so the search index (`remark-structure`) sees only option text, never the key or explanation. Styling: `not-prose my-6`, `border-border bg-card`, `border-brand` on the chosen option (tokens used by `checklist.tsx`); light-only site.
2. Register in both MDX maps; the Guide surface must include it or the guide quiz will not render.
3. KB rule: the catch-all at `generate-agent-kb.ts:160-161` keeps inner text, which would leak option text (harmless) but the drop rule keeps quizzes out of the agent KB entirely — quizzes are reader-facing, not knowledge.
4. Author the three quizzes from the same callouts Task 4 used (status computed from lines; inspected parts land On Hold; posted ≠ paid). Frontmatter untouched; no bare `{}` in prose (`carbon-docs` gotcha).
5. Regenerate the KB: `pnpm run generate:agent-kb` and commit the regenerated `apps/erp/app/modules/agent/kb/**` in the same commit.

**Verify:**
```bash
pnpm --filter docs typecheck 2>&1 | grep -c "components/quiz.tsx"
# Expected: 0 (no errors from the new file; the docs tsc is noisy for unrelated React 18/19 type skew — grep your own file out)
grep -c "<Quiz" docs/content/docs/reference/purchase-orders.mdx docs/content/docs/reference/receipts.mdx docs/content/guides/receive-and-bill.mdx
# Expected: 1 each
pnpm run generate:agent-kb && grep -c "QuizQuestion\|answer=" apps/erp/app/modules/agent/kb/purchase-orders.md
# Expected: 0
```
With the docs dev server running (`pnpm --filter docs dev`, port 3002): `curl -sS http://localhost:3002/docs/reference/receipts | grep -c "carbon-docs:quiz"` → `0` is fine (key is only used client-side); instead `grep -o 'To Receive and Invoice' | head -1` must match, and opening the page in a browser shows the quiz; refreshing keeps the chosen answer.

**Out of scope:** any auth or persistence on the docs site; the in-ERP engine.

---

## Task 25: Docs reference page, rule file, AGENTS.md sync, agent KB regen

**Depends on:** Tasks 11–14
**Files:**
- Create: `docs/content/docs/reference/learn.mdx` (frontmatter `title: Learn`, `description: Learning tracks built on these docs, with quizzes, verified hands-on challenges, XP, and role certificates.`)
- Modify: `docs/content/docs/reference/meta.json` — insert `"learn"` after `"training"` (L59)
- Modify: `docs/app/docs/layout.tsx` — add `"learn"` to the `People & access` `slugs` (L124-127)
- Create: `.claude/rules/learn-system.md` with `paths:` frontmatter `["apps/erp/app/modules/resources/learn/**", "apps/erp/app/routes/x+/learn+/**", "apps/erp/app/routes/share+/certificate.$code.tsx", "apps/erp/app/routes/file+/learn-certificate+/**"]` documenting: the engine invariants (service-role-only writes, self-only RLS, append-only XP, one open challenge attempt, version-bound grading + voiding, idempotent issuance), `LEARN_CONTENT_VERSION` bump rule, the checker proving rule, the reader-interface rule (never query in a loop; PO UUID vs readable id trap), and the privacy contract (managers see the projection only)
- Modify: `AGENTS.md` (root) Task Router — add a row `| Learn (learning tracks, XP, certification) | .claude/rules/learn-system.md + modules/resources/AGENTS.md |` under Domain Modules
- Modify: `apps/erp/app/modules/resources/AGENTS.md` — data-model row (`learn*` tables), key service functions (`getLearnOverview`, `getLearnTeamStatus`, `upsertLearnAssignment`, `getLearnCertificateByCode`), the engine file, and the correct validation command `pnpm --filter erp exec vitest run <file>` (the existing `pnpm --filter @carbon/erp test` line is stale — the package is `erp` and has no `test` script)
- Run: `pnpm run generate:agent-kb` and commit `apps/erp/app/modules/agent/kb/**`
- Copy from (precedent): `docs/content/docs/reference/training.mdx:1-20` (page shape: bold entity lead, concrete example, `FieldTable`, every claim cited `file:line`), `.claude/rules/supersession-system.md` (rule-file shape)

**Steps:** author `learn.mdx` grounded in the shipped code (cite `apps/erp/app/modules/resources/learn/gamify.ts` constants and the migration file:line for tables), covering: tracks and units, quizzes and XP, hands-on challenges (what "Check my work" reads, the practice-company recommendation), certification exam rules, certificates + verification URL + renewal, admin assignment and dashboard, what managers can and cannot see. Use `<FieldTable>`/`<Field>` for `learnCertificate` fields and `<StatusFlow>` for certificate states (Active / Expiring / Expired / Revoked).

**Verify:**
```bash
grep -n '"learn"' docs/content/docs/reference/meta.json docs/app/docs/layout.tsx
# Expected: one hit in each
pnpm run generate:agent-kb && ls apps/erp/app/modules/agent/kb | grep -c "^learn.md$"
# Expected: 1
grep -c "learn-system.md" AGENTS.md
# Expected: 1
```
Docs dev server: `curl -sS http://localhost:3002/docs/reference/learn | grep -c "Certificate"` → `>= 1` (a 500 means bad frontmatter — quote any colon).

**Out of scope:** Academy content; `.ai/specs` move (happens at the PR stage).

---

## Task 26: i18n, lint, scoped typecheck, conformance checks

**Depends on:** every code task above
**Files:** generated catalogs `packages/locale/locales/*/erp.po`; `apps/erp/app/routes/api+/mcp+/lib/tool-metadata.json` (regenerated by the hook); `packages/jobs/manifests/schema.json` (regenerated by `db:check:backups`)

**Steps:**
1. `pnpm lingui:extract` then invoke `/translate` to fill the new `msgstr`s; `pnpm lingui:check` must be green.
2. `pnpm exec biome check --write --no-errors-on-unmatched apps/erp/app/modules/resources apps/erp/app/routes/x+/learn+ apps/erp/app/routes/x+/resources+ apps/erp/app/routes/share+/certificate.\$code.tsx apps/erp/app/routes/file+/learn-certificate+ apps/erp/app/components/AvatarMenu.tsx apps/erp/app/routes/x+/_index.tsx packages/notifications/src packages/jobs/src packages/documents/src docs/components docs/content scripts/generate-agent-kb.ts`
3. `pnpm exec turbo run typecheck --filter=erp --filter=@carbon/documents --filter=@carbon/jobs --filter=@carbon/notifications --filter=docs`
4. `pnpm --filter erp exec vitest run app/modules/resources/learn` (all learn tests — check the test count is > 0).
5. `pnpm --filter @carbon/checks test` — no new findings. Expected watch-outs: `no-numeric-precision` (bare `NUMERIC` only — done), `no-local-timezone` (no `new Date().getDay()` etc. — streak math uses `datetime.*`), `no-raw-rounding` (XP integers; percent display via formatters), `no-inline-fraction-digits`, `module-shape` (nothing new at the `resources` module root except `learn/` and `ui/Learn/` subfolders — if it flags, STOP and report rather than editing `baseline.json`).
6. `pnpm db:check:datasets` and `pnpm db:check:backups` (both read the live schema; run after `pnpm db:migrate`).

**Verify:**
```bash
pnpm lingui:check 2>&1 | tail -2 && pnpm --filter @carbon/checks test 2>&1 | tail -3 && pnpm --filter erp exec vitest run app/modules/resources/learn 2>&1 | grep -E "Tests|passed"
# Expected: lingui compiled ; checks "N passed" with no failures ; learn tests "Tests  N passed" with N >= 40
```

**Out of scope:** whole-repo `pnpm typecheck` (OOMs), `pnpm --filter @carbon/checks baseline`.

---

## Task 27: Browser verification via `/test`, self-review, spec changelog, PR

**Depends on:** Task 26
**Files:**
- Create: `.ai/playbooks/learn-purchasing-track.md`, `.ai/playbooks/learn-admin-assignment.md` (written by `/test` on PASS)
- Modify: `.ai/specs/2026-08-29-learning-paths-certification.md` — changelog entry "implemented" with any divergences; move to `.ai/specs/implemented/` only with the user's OK (`.ai/specs/AGENTS.md` Ask First)

**Steps:**
1. Invoke `/test` with the feature described as: "Carbon Learn — as `test@carbon.ms`: (1) open /x/learn, start the Purchasing track, pass the `po-anatomy` unit quiz, confirm +100 XP and the badge shelf; (2) start the `create-and-release-a-po` challenge, create a 2-line PO and release it in the ERP, click Check my work, confirm the pass + evidence link; (3) complete the two other purchasing challenges, take the exam (accept honor statement), confirm the certificate, download the PDF, open the verify URL in a private window; (4) as an admin, assign the track to a group with a due date, confirm the notification and the dashboard row; revoke the certificate and confirm the verify page shows Revoked". Capture failures with `/error`.
2. Confirm the two privacy checks by hand with `curl` against PostgREST (`${SUPABASE_API_URL}/rest/v1/learnAttemptAnswer?select=id` with the learner's JWT → `[]`; `…/learnXpEvent` with an admin JWT for another user's rows → `[]`).
3. Invoke `/self-review` on the branch (docs-freshness check must pass for `resources/AGENTS.md` and the new rule).
4. Update the spec changelog, then open the PR with `Tracking spec: .ai/specs/2026-08-29-learning-paths-certification.md` in the body, a screenshot set per the PR evidence conventions, and the `🤖 Generated with [Claude Code](https://claude.com/claude-code)` footer.

**Verify:**
```bash
ls .ai/playbooks | grep -c "learn"
# Expected: 2
gh pr view --json title,url --jq '.url'
# Expected: a PR URL on crbnos/carbon
```

**Out of scope:** merging; moving the spec to `implemented/` without explicit approval.
