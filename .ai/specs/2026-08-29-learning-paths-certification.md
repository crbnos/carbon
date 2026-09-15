# Carbon Learn — learning paths, XP & verified certification (`learnAttempt` / `learnChallengeAttempt` / `learnXpEvent` / `learnCertificate`)

> Status: draft
> Author: Claude (with Sid)
> Date: 2026-08-29
> Research: `.ai/research/2026-08-29-gamified-learning-certification.md`

## TLDR

Turn Carbon's documentation (docs.carbon.ms — 99 MDX pages, ~111k words) into an
interactive, gamified learning system **inside the ERP**: role-based learning
tracks (Fundamentals, Purchasing, Sales, Production, Inventory, Quality,
Accounting, Planning, Admin) whose units pair doc reading with professional-level
quizzes and **hands-on challenges verified against the learner's own company
data** — the Trailhead "Check Challenge" model that none of the ERP vendors
surveyed (SAP, Odoo, NetSuite, Epicor, Acumatica, as of 2026-08-29) ships today.
Learners earn XP (append-only ledger), levels, module badges, a weekly-goal
streak, and a private GitHub-style activity heatmap; completing a track's
certification exam (scenario questions drawn from a bank, 80% pass, timed,
one-way navigation, escalating retake cooldowns) plus its required hands-on
challenges issues a **version-stamped certificate** with a public verification
URL, a react-pdf certificate with QR code, and a 12-month validity renewed by a
free delta quiz. Admins assign tracks to groups, get due dates, notifications,
and a team progress/certification dashboard. Everything is an **additive
extension of the existing `resources` training domain**: no new permission
module, no changes to existing tables, curriculum shipped in code (not a CMS —
per-company custom content remains the existing Training feature's job), and all
progress/certificate writes are server-authoritative (no client write policies,
same as `itarCertification`). The docs site itself stays static; a later phase
adds anonymous inline "check your understanding" quizzes there using the
existing `<AgentContext>` remark-strip pattern for answer keys.

## Problem Statement

The docs are complete but passive. A new hire told "go read the accounting
docs" has no feedback loop (nothing checks understanding), no motivation loop
(no progress, no goal, no reward), and no proof of completion (nothing to show
their manager). Carbon already has three disconnected learning surfaces, none of
which solves this:

- **docs.carbon.ms** — 111k words across editorial Guides (5 flows) and a
  Reference tree whose 12 sidebar groups map almost 1:1 onto ERP roles, but the
  site is fully static: no auth, no persistence beyond an unused localStorage
  `Checklist` component, one API route (search). Reading leaves no trace.
- **Academy** (`apps/academy`, learn.carbon.ms) — 73 Loom video lessons + 18
  topic MCQ challenges with per-user progress, but progress is **global**
  (`lessonCompletion` / `challengeAttempt` carry no `companyId`, RLS is
  self-only) so a manager cannot see their team; scores aren't stored (only
  `passed`); and there are no certificates, XP, streaks, or hands-on checks.
  The docs house style also pins a positioning rule: Academy is not a product
  pillar and must not be framed as one (`.claude/skills/carbon-docs/SKILL.md`).
- **Company Training** (`resources` module) — a real per-company quiz engine
  (`training` / `trainingQuestion` with 5 question types / `trainingAssignment`
  by group / `trainingCompletion` per period, `PASSING_THRESHOLD = 0.8`,
  confetti in `share+/training.$id.tsx`) — but it is for the **customer's own
  SOP content**, not for learning Carbon itself, and has no gamification.

Meanwhile a grep confirms `badge`, `xp`, `streak`, `leaderboard`, `certificat*`
(outside ITAR/quality docs) have **zero** hits in migrations, `apps/erp`, and
`packages/react` — the gamified layer is genuinely greenfield, while every
supporting rail already exists: shared Supabase auth, `group`/`membership`
assignment targets, `NotificationEvent.TrainingAssignment`/`TrainingReminder`
with a weekly digest, react-pdf + `generateQRCode` for documents, demo-template
companies for safe practice, and `itarCertification` as the precedent for a
tamper-proof, expiring, service-role-only certificate record.

The research (see linked file) shows the competitive lane: Salesforce Trailhead
proved gamified product training at ecosystem scale (20M+ badges) on exactly
this atom — unit = quiz XOR verified hands-on challenge — and **no classic ERP
vendor (SAP, Odoo, NetSuite, Epicor, Acumatica) auto-grades hands-on work
against the customer's own instance**. Carbon can be the first ERP where "create
a PO and we'll check it" is how you learn the product.

## Proposed Solution

A **Learn** area inside the ERP, built as an additive extension of the
`resources` domain, with three moving parts: a code-shipped curriculum, a
server-authoritative progress/gamification engine, and a certification pipeline.

### The curriculum (code-shipped, docs-grounded)

Curriculum lives in the repo at `apps/erp/app/modules/resources/learn/`:

- `curriculum.ts` — client-safe track/module/unit metadata: slugs, titles,
  descriptions, ordered doc links (absolute URLs built from a `DOCS_URL`
  constant, precedent: `apps/academy/app/utils/path.ts`), XP values, question
  counts, challenge slugs, badge definitions, and `LEARN_CONTENT_VERSION`.
- `banks/{track}.server.ts` — question banks (**server-only**: prompts,
  options, correct answers, explanations, `docsUrl` per question, Bloom level
  tag, topic tag for stratified draws). Never importable client-side, so answer
  keys never ship to the browser.
- `checkers.server.ts` — hands-on challenge checker registry (below).
- `gamify.ts` — every gamification constant in one file (house pattern from
  be-better-dev's `gamify.ts`).

Structure follows the Trailhead atom: **track → module → unit**, where a unit is
one sitting: a short objective ("What you'll be able to do"), links to the exact
doc sections to read, then exactly one assessment — a quiz **or** a hands-on
challenge. Tracks map to the docs Reference sidebar groups and academy modules:

| Track | Backbone docs (Reference groups + Guide flows) |
|---|---|
| `fundamentals` | Overview, items, methods, glossary, navigation — soft prerequisite for all others |
| `sales` | Quotes, sales orders, pricing + Quote-to-cash guide flow |
| `purchasing` | POs, supplier quotes, suppliers, receipts + RFQ-to-bill guide flow |
| `inventory` | Inventory & locations, counts, picking, traceability, shelf life, scrap |
| `production` | Jobs, scheduling, MES, work centers, routings, kanban + Make-to-order / floor guide chapters |
| `planning` | MRP, demand projections, reordering |
| `quality` | Issues, inspections, calibration, quality documents, risks |
| `accounting` | Ledger, invoices, payments, period close, dimensions, fixed assets + Manufacturing-accounting guide flow |
| `admin` | Company settings, people & permissions, custom fields, sequences, import/export, integrations |

Phase 1 ships `fundamentals` + `purchasing` end-to-end (including
certification); the other seven follow as content work on the same engine
(accounting first — it is the user's canonical example).

Question style is the professional bar from the research: scenario items at
Bloom's Apply/Analyze ("A receipt was posted for 40 of 50 ordered units — what
does the PO status show and why?"), distractors that are real misconceptions,
and an explanation on every answer that deep-links the doc section that answers
it (Butler & Roediger 2008: unexplained MCQs teach the distractors). Unit
quizzes draw 4–5 questions from a per-unit bank of 8+; certification exams draw
~30 from a per-track bank of 90+ stratified by topic (≥3× form size, PSI/ASC
convention).

### Hands-on challenges — the differentiator

A challenge is instructions + a **server-side checker**. The learner presses
**Start challenge** (the server records `startedAt` from its own clock and
returns the attempt id — one open attempt per learner × challenge × company,
pressing it again returns the same attempt), performs real actions in the
company they're signed into ("Create a purchase order for any supplier with at
least 2 lines and release it"), then clicks **Check my work**. The checker (a
named function in `checkers.server.ts`, keyed by challenge slug) runs read-only
predicate queries scoped to `companyId` + `createdBy = userId` +
`createdAt >= attempt.startedAt` (the stored server value, never client input),
and returns either
`passed` with evidence (the matched record ids) or the **first failing
requirement by name** — Trailhead's exact feedback model ("No released purchase
order with at least 2 lines was found — found PO-000123 but it is still Draft").
Rules, all from research consensus:

- Unlimited retries, never penalized; full 500 XP whenever it passes.
- Checkers are read-only — they never mutate or clean up business data (unlike
  Trailhead's Apex rollback, ERP documents are legitimate data; what the learner
  creates is theirs/their admin's to keep or delete).
- Each track ends in a **capstone** challenge: a business-scenario brief with
  requirements but **no step-by-step instructions** (the superbadge model — the
  absence of instructions is what makes it professional-level).
- Practice-company guidance, not enforcement: the Learn hub surfaces a callout
  recommending admins provision a practice company from the existing demo
  templates (Settings → Demo Data) and shows which company a check will run in.
  Requiring a sandbox would kill self-serve adoption (Microsoft retired its
  hosted sandboxes; HubSpot grades in the real account), and some admins want
  training in the real company's conventions.
- Every checker ships with a fixture test proving it **fails on an empty
  company and passes on a known-good sequence of service calls** (the
  rust-course boss-suite proving rule: a challenge that can't fail verifies
  nothing).

### Gamification engine (workplace-safe)

Constants in `gamify.ts`, numbers from the research + house prior art:

- **XP**: unit quiz 100/50/25 by pass attempt (Trailhead decay; a pass requires
  all questions correct, matching Trailhead/Academy unit-quiz semantics);
  hands-on challenge 500 flat; module badge +50; track certification +1000;
  renewal quiz +100. XP is awarded **once** per unit/challenge (first pass);
  re-runs are practice. All awards are rows in the append-only `learnXpEvent`
  ledger — totals are sums, never a mutable counter (be-better-dev rule: a
  mis-award is a deletable row, not a corrupted balance).
- **Levels**: `xpForLevel(n) = 250·n·(n−1)` — L2 at 500, L3 at 1,500, L4 at
  3,000; one full track (~3,600 XP) lands mid-L4; the full curriculum reaches
  ~L11. Levels and badges are permanent and additive (rank ≠ certificate).
- **Streak**: **weekly, not daily.** A week (ISO week, company timezone) counts
  when the learner meets their weekly XP goal (default 200, adjustable
  100/200/500 in `learnPreference`); the streak is consecutive satisfied weeks,
  and the current week can't break it until it ends. This is the GitHub-removal
  / LinkedIn-Learning consensus: daily streaks punish weekends and read as
  punitive in workplace products.
- **Heatmap**: GitHub-style 26-week grid from `learnActivityDay` (daily XP
  buckets <100/<250/<500/≥500), rendered by a new app-local CSS-grid component
  — **visible only to the learner**.
- **No leaderboards in v1.** Hanus & Fox 2015 and Mollick & Rothbard show
  competitive mechanics backfire in mandatory workplace contexts. Managers see
  assignment + certification status, never streaks, XP, or miss counts.
- Celebration on pass reuses `react-confetti-explosion` + the success-audio
  pattern from `share+/training.$id.tsx`.

### Certification pipeline

```
[Track units complete?] ──not required──┐
                                        ▼
 required challenges Passed ──► Exam unlocked ──► attempt (honor statement →
 timed, 1-question-at-a-time, no back-nav, shuffled, fresh stratified form)
        ▲                                   │
        │           fail (< 80%)            │ pass (≥ 80%)
        └── cooldown 24h → 7d escalating ◄──┤
                                            ▼
                            learnCertificate issued (service role)
                            contentVersion + expiresAt = +12 months
                            verificationCode → /share/certificate/:code
                            PDF w/ QR • +1000 XP • notification
                                            │
                    ┌───────────────────────┼──────────────────┐
                    ▼                       ▼                  ▼
              Active (valid)   expiring soon (30d notice   Expired
                    │           → free renewal quiz,        (retake exam
                    └── renewal pass → expiresAt +12mo ◄──   to re-certify)
```

- Exam: ~30 scenario questions drawn per-topic from the track bank, 45-minute
  limit, one-way navigation, options shuffled, server-side grading, honor
  statement gate before start (empirically reduces cheating), pass ≥ 80%
  (matches the existing `PASSING_THRESHOLD = 0.8` and Odoo's default), fresh
  form each attempt, retake cooldowns 24 h after the first fail then 7 days
  (Microsoft/Salesforce convention).
- Certificate issuance is **server-authoritative**: exam pass + required
  challenge passes are re-verified server-side in one transaction before the
  `learnCertificate` row is written with the service-role client. The table has
  **no client write policies** (the `itarCertification` precedent).
- Verification page `share/certificate/:code` (public, service-role read)
  shows: learner name, track, issue/expiry dates, content version, status
  (Active/Expired/Revoked), and the criteria met (exam score, verified
  challenges) — the Open Badges credibility fields. The PDF (react-pdf,
  hand-built like `KanbanLabelPDF`, QR via `generateQRCode`) links the same URL.
- Renewal: from 30 days before expiry, a free ~10-question open-book delta quiz
  extends validity 12 months (SAP/Microsoft/NetSuite convention; Salesforce's
  release-aligned maintenance modules — three cycles a year, still running as
  of 2026 — are the heavier cadence deliberately avoided).

### Admin: assignment & reporting

- `learnAssignment` mirrors `trainingAssignment`: a track assigned to
  `groupIds[]` (every id verified to belong to the company; one foreign id
  rejects the whole write) with an optional `dueDate`. Fires `NotificationEvent.LearnAssignment`
  (new additive enum value, `Training` topic) through the existing notify job;
  expiring certificates fire `LearnCertificateExpiring`; overdue assignments
  join the existing weekly digest.
- Team dashboard under Resources: per employee × assigned track — Not started /
  In progress (n%) / Certified (expires d) / Expired / Overdue — filterable by
  group/department, with certificate links. Gated `resources_view`; the data is
  a projection built with the service-role client, so admins never touch raw
  XP/attempt rows. Revoking a certificate (with a reason) is an admin action on
  the same dashboard, gated `resources_update`; the verify page shows Revoked
  immediately.
- Question analytics (phase 2): failure rates per question grouped by doc page —
  the Rust Book loop where quiz telemetry becomes a docs bug report (+20% score
  lift from targeted rewrites in their published experiment).

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Where the system lives | ERP, extending the `resources` training domain | Docs site is static with no auth (only 1 API route); Academy progress is global/companyId-less and Academy must not become a product pillar (docs SKILL.md positioning rule); the ERP already has auth, tenancy, groups, notifications, and the data hands-on checks assert against. Odoo embeds its LMS in the ERP; Trailhead is in-ecosystem. |
| New permission module? | **No** — everything under existing `resources_*` scopes | `.ai/lessons.md:49` ("Features live inside existing permission modules"); Training already lives under `resources`; `BACKWARD_COMPATIBILITY.md` freezes scope strings but says adding is safe — we add none. |
| Learner-surface access | Auth-only (`requirePermissions(request, {})`, employee role), not `resources_view` | Most employees lack `resources_view`; precedent: `share+/training.$id.tsx` self-completion and `trainingCompletion`'s self-INSERT policy. Admin routes stay `resources_*`-gated. |
| Curriculum storage | Code-shipped TS in `modules/resources/learn/` (no content tables, no CMS) | Academy's `config.tsx` precedent hardened by be-better-dev's slug-stability rule; content versions with the product (certificates stamp `LEARN_CONTENT_VERSION`); no seed-drift problem (`.ai/lessons.md:312`); per-company custom content is already the existing Training feature's job — clean separation. |
| Question banks & checkers | `*.server.ts` modules only | Answer keys and checker logic must never reach the client bundle; server grades everything. |
| Progress tenancy | Per user **per company** (`userId` + `companyId` on every row) | The manager-visibility requirement is company-scoped; hands-on evidence references company data; matches `trainingCompletion`. Academy's global-progress gap is the counter-example. Cross-company XP portability deliberately out of scope for v1. |
| Write path for progress/XP/certificates | **No client write policies**; all writes via service-role client in route actions after server-side grading | Self-INSERT RLS (as on `trainingCompletion`) would let a crafted PostgREST call forge `passed = true` or mint XP. `itarCertification` (service-role-only writes) is the precedent. SELECT policies: self + `resources_view`. |
| XP economy | Quiz 100/50/25 by attempt; challenge 500 flat; badge +50; certification +1000; `xpForLevel(n)=250·n·(n−1)`; constants in one `gamify.ts` | Trailhead's published numbers (hands-on pays 5×; decay kills guess-grinding; free challenge retries are the pedagogy); one-file constants is the be-better-dev house pattern. |
| XP integrity | Append-only `learnXpEvent` ledger; totals are SUMs; awards gated once per ref | be-better-dev/zero2deep rule: a mis-award is a deletable row, never a corrupted counter; unique partial index prevents double-award. |
| Per-question grading storage | `learnAttemptAnswer`, RLS enabled with no policies (service-role only); `learnAttempt` holds only the form and totals | A learner reading `correct` per question across retries reconstructs the key (PR #1509 review). Feedback is returned in the action response for one sitting only. |
| Exam grading vs. content changes | Grade each answer at submission against `attempt.contentVersion`; finalize sums stored answers; a version mismatch voids the attempt (no cooldown) | Code-shipped banks change on deploy; an in-flight attempt must never be graded against content it was not served (PR #1509 review). |
| Hands-on challenge lifecycle | Server-owned `startChallenge` (idempotent, server `startedAt`, one open attempt per learner × challenge × company) → `checkChallenge(attemptId)` re-read under the session company | The time filter needs a start the client cannot fake, and an attempt must be bound to the company it was started in (PR #1509 review). |
| Certificate idempotency + evidence | UNIQUE `(examAttemptId, companyId)`; `challengeAttemptIds[]` + immutable `evidence` snapshot | A retried issuance must not mint a second verification code; a certificate must name the exact evidence it was issued on (PR #1509 review). |
| Revocation | `revokeCertificate` admin action gated on `resources_update`, reason kept in `customFields` | `revokedAt`/`revokedBy` existed without any operation that could set them (PR #1509 review). |
| Manager read path | Engine tables are self-only under RLS; admins read a service-role projection inside `resources_view`-gated routes | The RLS branch granting `resources_view` raw reads over XP/attempt rows exceeded the "status only" contract (PR #1509 review). |
| Streak model | Weekly XP goal (default 200, user-adjustable), ISO week in company timezone, current week can't break it | GitHub removed daily streaks for punishing rest; LinkedIn Learning uses weekly goals; Duolingo's own data shows slack increases retention. Company timezone per the MRP precedent; be-better-dev's server-local-time shortcut explicitly doesn't survive multi-tenant. |
| Leaderboards | None in v1; heatmap/streak/XP visible only to the learner; managers see assignment + certification status | Hanus & Fox 2015 (leaderboards lowered exam scores), Mollick & Rothbard (consent moderates workplace gamification). Odoo's public leaderboard rejected knowingly. |
| Unit quiz pass bar | All questions correct (retry decays XP) | Trailhead and Academy unit-quiz semantics; the unit quiz is formative, so mastery-retry beats a partial pass. |
| Certification exam design | ~30 Qs from ≥90-item per-track bank, stratified by topic, 80% pass, 45-min limit, one-way nav, shuffle, honor gate, fresh form, cooldowns 24h→7d | Research consensus (PSI bank ratios, AWS/Microsoft/Salesforce retake policies, Odoo/`share+/training` 80% precedent); question design is the primary anti-cheat, hands-on challenges the un-cheatable half. |
| Certificate record | `learnCertificate` modeled on `itarCertification`: composite PK, `expiresAt`, `verificationCode`, evidence, revocation columns, service-role-only writes | Existing in-repo pattern for a tamper-proof expiring attestation; Open Badges fields (criteria, evidence, dates, issuer) drive the verify page. |
| Expiry & renewal | 12-month validity; free ~10-question delta quiz from 30 days before expiry extends +12 months | SAP (1-year + stay-current quiz), Microsoft (free open-book renewal), NetSuite (annual release quiz); Salesforce's release-aligned maintenance cadence (Spring/Summer/Winter, still current in 2026) is heavier and deliberately avoided. |
| Hands-on checker semantics | Read-only predicates on `companyId` + `createdBy` + `createdAt >= startedAt`; first-failure message names the missing thing; evidence ids recorded on pass; fixture test proves fail-on-empty/pass-on-solution | Trailhead's check model + rust-course's proving rule; read-only because ERP documents are real data (no auto-cleanup). |
| Practice company | Recommended (nudge to demo-template company + show target company on every check), not required | Microsoft retired hosted sandboxes; HubSpot grades the real account; demo templates already exist (Settings → Demo Data). Enforcement would block self-serve learners. |
| Reading surface | Link out to docs.carbon.ms sections from units (DOCS_URL constant); no iframe embedding, no content duplication | Docs stay canonical and beautiful; academy already hardcodes cross-app URLs; the agent-KB copy of docs is stripped for agents, not reader-grade. |
| Docs-site inline quizzes | Phase 3: anonymous, localStorage-persisted "Check your understanding" blocks in MDX; answer keys authored via a remark-stripped component | The `<AgentContext>` remark plugin is the proven in-repo pattern for author-time metadata invisible to readers and search; the built-but-unused `Checklist` shows the localStorage persistence shape. No auth added to the docs site. |
| Heatmap component | App-local (`ui/Learn/ActivityHeatmap.tsx`), CSS grid + Tailwind intensity classes | No heatmap exists anywhere; `@carbon/react` props are a STABLE surface, so land app-local first and promote later if MES wants it. be-better-dev's 26-week grid is the reference. |
| Academy | Untouched; units may link Loom lessons as supplemental material | Positioning rule + avoids touching its global-progress schema; its content maps 1:1 to the same modules so cross-links are free. |
| MES | Out of scope v1 | Shop-floor operators take the Production track in the ERP; a MES-embedded runner is a later decision. |
| Notifications | New additive `NotificationEvent` values (`LearnAssignment`, `LearnCertificateExpiring`) under the existing `Training` topic | Event types are FROZEN for renames, additions safe; the notify job, digest, and settings surfaces already handle Training events. |
| Heuristic 1 — multi-tenancy | All new tables: `companyId`, composite PK `("id","companyId")`, `id('<prefix>')` defaults; exception: `learnActivityDay` uses natural PK `("userId","day","companyId")` | House template; the activity row is an upsert counter never referenced by FK (precedent: `lessonCompletion`'s natural PK). |
| Heuristic 2 — service shape | All reads/writes as functions in `resources.service.ts`, `client` first, return `{data,error}`, never throw | Module-conventions rule; one service file per module. |
| Heuristic 3 — RLS | Every table gets SELECT policies (`SELECT` name, self OR `resources_view` company set); write policies only where client writes are safe (`learnPreference` self, `learnAssignment` via `resources_*`) | Conventions + the deliberate write-lockdown decision above; helper calls wrapped in `(SELECT ...)`. |
| Heuristic 4 — permission scoping | Admin routes `requirePermissions(request, {view/create/update/delete: "resources"})`; learner routes auth-only | See access decisions above. |
| Heuristic 5 — forms | Quiz/exam/preference submissions are `ValidatedForm` + `validator(zod)` route actions; exam runner advances via per-question actions on the attempt row | House form pattern; server holds exam state so back-navigation is impossible client-side. |
| Heuristic 6 — module layout | Extends `resources`: models in `resources.models.ts`, service in `resources.service.ts`, UI in `ui/Learn/`, curriculum in `learn/`; no new module folder | lessons.md:49 — module folder = permission module = nav module. |
| Heuristic 7 — backward compat | Purely additive: new tables, routes, events, path.to entries; no FROZEN/STABLE surface modified | `BACKWARD_COMPATIBILITY.md` — adding scopes/functions/events/routes is safe; none of the existing `training*` tables change. |

## Data Model Changes

One migration: `pnpm db:migrate:new learn-progression`. All tables are new
(additive); nothing existing is altered. FKs to `user` follow the house
single-column pattern used by `trainingCompletion`; audit columns follow the
template. High-volume system rows (`learnXpEvent`, `learnActivityDay`,
`learnAttempt`, `learnChallengeAttempt`) deliberately omit `customFields` —
they are engine ledgers, not user-editable documents.

### Enum

```sql
CREATE TYPE "learnAttemptKind" AS ENUM ('Unit Quiz', 'Certification Exam', 'Renewal Quiz');
```

### `learnUnitProgress` — one row per learner per unit

```sql
CREATE TABLE "learnUnitProgress" (
    "id" TEXT NOT NULL DEFAULT id('lup'),
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "trackSlug" TEXT NOT NULL,
    "moduleSlug" TEXT NOT NULL,
    "unitSlug" TEXT NOT NULL,
    "quizAttempts" INTEGER NOT NULL DEFAULT 0,
    "bestScore" NUMERIC,                -- fraction 0..1, quiz units only
    "completedAt" TIMESTAMP WITH TIME ZONE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "learnUnitProgress_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "learnUnitProgress_unique" UNIQUE ("userId", "unitSlug", "companyId"),
    CONSTRAINT "learnUnitProgress_companyId_fkey" FOREIGN KEY ("companyId")
        REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "learnUnitProgress_companyId_idx" ON "learnUnitProgress" ("companyId");
CREATE INDEX "learnUnitProgress_user_track_idx" ON "learnUnitProgress" ("userId", "companyId", "trackSlug");
```

### `learnAttempt` — every quiz/exam sitting (append-only)

```sql
CREATE TABLE "learnAttempt" (
    "id" TEXT NOT NULL DEFAULT id('lat'),
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "kind" "learnAttemptKind" NOT NULL,
    "trackSlug" TEXT NOT NULL,
    "unitSlug" TEXT,                    -- NULL for exams/renewals
    "questionSlugs" TEXT[] NOT NULL,    -- the drawn form, in served order
    "questionCount" INTEGER NOT NULL,
    "correctCount" INTEGER,
    "passed" BOOLEAN,
    "contentVersion" TEXT NOT NULL,
    "startedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "submittedAt" TIMESTAMP WITH TIME ZONE,
    "expiresAt" TIMESTAMP WITH TIME ZONE, -- exam time limit deadline
    "voidedAt" TIMESTAMP WITH TIME ZONE, -- content version changed mid-attempt; no cooldown, no score
    CONSTRAINT "learnAttempt_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "learnAttempt_companyId_fkey" FOREIGN KEY ("companyId")
        REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "learnAttempt_cooldown_idx" ON "learnAttempt"
    ("userId", "companyId", "kind", "trackSlug", "submittedAt");
```

Grading is bound to the stored `contentVersion`: every answer is graded **at
submission** against the bank for that version and written to
`learnAttemptAnswer` (below); `finalizeExamAttempt` only sums stored results,
never re-grades. If `LEARN_CONTENT_VERSION` differs from `attempt.contentVersion`
at any answer or finalize call, the attempt is **voided** (`voidedAt` set, no
score, no cooldown) and the learner is asked to start again on the new content.

### `learnAttemptAnswer` — per-question grading, service-role only

Per-question correctness never sits in a learner-readable row: a learner who
could read `correct` per question across retries would reconstruct the answer
key. Unit-quiz feedback (explanations + doc links) is returned in the grading
action's response for that sitting only; exams reveal only per-topic totals.

```sql
CREATE TABLE "learnAttemptAnswer" (
    "id" TEXT NOT NULL DEFAULT id('laa'),
    "companyId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionSlug" TEXT NOT NULL,
    "selected" JSONB NOT NULL,          -- option id(s) chosen
    "correct" BOOLEAN NOT NULL,         -- graded at submission against the bank
    "answeredAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT "learnAttemptAnswer_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "learnAttemptAnswer_unique" UNIQUE ("attemptId", "questionSlug", "companyId"),
    CONSTRAINT "learnAttemptAnswer_attempt_fkey" FOREIGN KEY ("attemptId", "companyId")
        REFERENCES "learnAttempt"("id", "companyId") ON DELETE CASCADE,
    CONSTRAINT "learnAttemptAnswer_companyId_fkey" FOREIGN KEY ("companyId")
        REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- RLS enabled with NO policies at all: service-role reads and writes only.
```

### `learnChallengeAttempt` — one row per server-owned start

The start is a server operation, never client input: `startChallenge` records
`startedAt` from the server clock and returns the attempt id; `checkChallenge`
takes that id, re-reads the row under the session's `companyId` (a mismatch is
a 404 — an attempt is bound to the company it was started in), and updates the
same row on every check. Exactly one open (unpassed) attempt exists per learner
× challenge × company.

```sql
CREATE TABLE "learnChallengeAttempt" (
    "id" TEXT NOT NULL DEFAULT id('lch'),
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "trackSlug" TEXT NOT NULL,
    "challengeSlug" TEXT NOT NULL,
    "contentVersion" TEXT NOT NULL,     -- checker version the attempt runs against
    "startedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), -- server clock only
    "checkCount" INTEGER NOT NULL DEFAULT 0,
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "passedAt" TIMESTAMP WITH TIME ZONE,
    "failedRequirement" TEXT,           -- first failing requirement of the latest check
    "message" TEXT,                     -- the human-readable feedback shown
    "evidence" JSONB,                   -- matched record ids on pass
    "lastCheckedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "learnChallengeAttempt_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "learnChallengeAttempt_companyId_fkey" FOREIGN KEY ("companyId")
        REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "learnChallengeAttempt_open_idx" ON "learnChallengeAttempt"
    ("userId", "companyId", "challengeSlug") WHERE "passed" = false;
CREATE INDEX "learnChallengeAttempt_user_idx" ON "learnChallengeAttempt"
    ("userId", "companyId", "challengeSlug", "passed");
```

### `learnXpEvent` — append-only XP ledger

```sql
CREATE TABLE "learnXpEvent" (
    "id" TEXT NOT NULL DEFAULT id('lxp'),
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "amount" INTEGER NOT NULL,
    "kind" TEXT NOT NULL CHECK ("kind" IN
        ('unit_quiz','challenge','module_badge','certification','renewal')),
    "refSlug" TEXT NOT NULL,            -- unit/challenge/module/track slug
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT "learnXpEvent_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "learnXpEvent_companyId_fkey" FOREIGN KEY ("companyId")
        REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "learnXpEvent_once_idx" ON "learnXpEvent"
    ("userId", "companyId", "kind", "refSlug");  -- one award per thing, ever
CREATE INDEX "learnXpEvent_activity_idx" ON "learnXpEvent"
    ("userId", "companyId", "createdAt");
```

### `learnActivityDay` — daily rollup for heatmap + weekly streak

```sql
CREATE TABLE "learnActivityDay" (
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "companyId" TEXT NOT NULL,
    "day" DATE NOT NULL,                -- bucketed in the company timezone
    "xp" INTEGER NOT NULL DEFAULT 0,
    "units" INTEGER NOT NULL DEFAULT 0,
    "seconds" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "learnActivityDay_pkey" PRIMARY KEY ("userId", "day", "companyId"),
    CONSTRAINT "learnActivityDay_companyId_fkey" FOREIGN KEY ("companyId")
        REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
```

Written with `INSERT ... ON CONFLICT DO UPDATE SET xp = "learnActivityDay".xp + EXCLUDED.xp, ...`
(the be-better-dev upsert-increment pattern). Weekly streak is **computed** from
these rows at read time, never stored (zero2deep rule: derived state that is
stored goes stale).

### `learnBadgeAward`

```sql
CREATE TABLE "learnBadgeAward" (
    "id" TEXT NOT NULL DEFAULT id('lba'),
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "badgeSlug" TEXT NOT NULL,
    "awardedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT "learnBadgeAward_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "learnBadgeAward_unique" UNIQUE ("userId", "badgeSlug", "companyId"),
    CONSTRAINT "learnBadgeAward_companyId_fkey" FOREIGN KEY ("companyId")
        REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
```

### `learnCertificate` — modeled on `itarCertification`

```sql
CREATE TABLE "learnCertificate" (
    "id" TEXT NOT NULL DEFAULT id('lcert'),
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "trackSlug" TEXT NOT NULL,
    "contentVersion" TEXT NOT NULL,
    "examAttemptId" TEXT NOT NULL,
    "examScore" NUMERIC NOT NULL,       -- fraction 0..1
    "challengeSlugs" TEXT[] NOT NULL,   -- the track's required challenges at issue time
    "challengeAttemptIds" TEXT[] NOT NULL, -- the exact passed learnChallengeAttempt rows
    "evidence" JSONB NOT NULL,          -- immutable snapshot per challenge:
                                        -- { slug, attemptId, passedAt, contentVersion, evidence }
    "verificationCode" TEXT NOT NULL DEFAULT id('lcv'),
    "issuedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "renewedAt" TIMESTAMP WITH TIME ZONE,
    "revokedAt" TIMESTAMP WITH TIME ZONE,
    "revokedBy" TEXT REFERENCES "user"("id"),
    "customFields" JSONB,
    CONSTRAINT "learnCertificate_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "learnCertificate_verificationCode_key" UNIQUE ("verificationCode"),
    CONSTRAINT "learnCertificate_examAttempt_key" UNIQUE ("examAttemptId", "companyId"),
        -- issuance is idempotent per passed exam: a retried or concurrent
        -- issueCertificate returns the existing row instead of minting a second code
    CONSTRAINT "learnCertificate_examAttempt_fkey" FOREIGN KEY ("examAttemptId", "companyId")
        REFERENCES "learnAttempt"("id", "companyId"),
    CONSTRAINT "learnCertificate_companyId_fkey" FOREIGN KEY ("companyId")
        REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "learnCertificate_user_idx" ON "learnCertificate"
    ("userId", "companyId", "trackSlug", "expiresAt");
```

### `learnAssignment` — admin assigns a track to groups

```sql
CREATE TABLE "learnAssignment" (
    "id" TEXT NOT NULL DEFAULT id('lasn'),
    "companyId" TEXT NOT NULL,
    "trackSlug" TEXT NOT NULL,
    "groupIds" TEXT[] NOT NULL,
    "dueDate" DATE,
    "customFields" JSONB,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "learnAssignment_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "learnAssignment_companyId_fkey" FOREIGN KEY ("companyId")
        REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "learnAssignment_groupIds_idx" ON "learnAssignment" USING GIN ("groupIds");
```

### `learnPreference` — learner settings

```sql
CREATE TABLE "learnPreference" (
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "companyId" TEXT NOT NULL,
    "weeklyGoalXp" INTEGER NOT NULL DEFAULT 200
        CHECK ("weeklyGoalXp" IN (100, 200, 500)), -- enforced at the DB, not only the validator
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "learnPreference_pkey" PRIMARY KEY ("userId", "companyId"),
    CONSTRAINT "learnPreference_companyId_fkey" FOREIGN KEY ("companyId")
        REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
```

### RLS

```sql
-- Pattern for learner-owned engine tables (learnUnitProgress, learnAttempt,
-- learnChallengeAttempt, learnXpEvent, learnActivityDay, learnBadgeAward,
-- learnCertificate): SELF-ONLY reads, limited to companies the user belongs to.
ALTER TABLE "learnXpEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "learnXpEvent" FOR SELECT USING (
    "userId" = (SELECT auth.uid()::text)
    AND "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
-- Deliberately NO INSERT/UPDATE/DELETE policies: all writes go through the
-- service-role client after server-side grading (itarCertification precedent).
-- Managers never read these rows through PostgREST. The admin dashboard is a
-- reporting PROJECTION — status per employee × track plus certificate status —
-- built by a service function on the service-role client inside a route gated
-- by requirePermissions({ view: "resources" }). Raw XP, streaks, answers, and
-- misses never leave the learner's own session. Every app query additionally
-- filters on the ACTIVE companyId (the RLS membership predicate is defense in
-- depth for multi-company users, not the primary scope).

-- learnAttemptAnswer: RLS enabled, NO policies — service-role only.
-- learnPreference: SELECT/INSERT/UPDATE for self only (same self + membership predicate).
-- learnAssignment: SELECT via get_companies_with_employee_role(); INSERT/UPDATE/
-- DELETE via get_companies_with_employee_permission('resources_create'/'_update'/'_delete').
```

After the migration: `pnpm run generate:types` before any typecheck.

## API / Service Changes

### `resources.models.ts` (additions)

- `learnQuizSubmissionValidator` — `{ unitSlug, attemptId, responses: [{questionSlug, selected}] }`
- `learnExamStartValidator` — `{ trackSlug, honorAccepted: literal(true) }`
- `learnExamAnswerValidator` — `{ attemptId, questionSlug, selected }`
- `learnChallengeStartValidator` — `{ challengeSlug }`
- `learnChallengeCheckValidator` — `{ attemptId }` (never a client-supplied `startedAt`)
- `learnAssignmentValidator` — `{ trackSlug, groupIds: array, dueDate? }`
- `learnCertificateRevokeValidator` — `{ certificateId, reason }`
- `learnPreferenceValidator` — `{ weeklyGoalXp: 100 | 200 | 500 }`

### `resources.service.ts` (additions — client first, `{data,error}`, never throw)

- `getLearnOverview(client, userId, companyId)` — unit progress + badges +
  certificates + XP total + activity for the hub (parallel reads).
- `getLearnActivity(client, userId, companyId, sinceDay)` — heatmap rows.
- `getLearnAssignmentsForUser(client, userId, companyId)` — via `groups_for_user`.
- `getLearnTeamStatus(serviceRole, companyId, filters)` — admin dashboard
  **projection** (per employee × assigned track: status, percent, certificate
  state/expiry — never XP, streaks, or answers); one query with `.in()`, no N+1;
  called only from routes gated on `resources_view`.
- `upsertLearnPreference(client, ...)`, `upsertLearnAssignment(client, ...)`
  (resolves every `groupId` with `group.companyId = companyId` and rejects the
  whole write on any foreign id — before notifications or dashboard joins can
  see it), `deleteLearnAssignment(client, ...)`.
- `getLearnCertificateByCode(serviceRole, code)` — verification page read.
- **Server-only engine** (`resources.learn.server.ts` alongside the curriculum):
  `startQuizAttempt`, `gradeQuizAttempt` (grades each answer against the bank
  for `attempt.contentVersion`, writes `learnAttemptAnswer` rows, returns the
  per-question feedback in the action response only), `startExamAttempt` (draws
  the stratified form, sets `expiresAt`, enforces cooldowns),
  `answerExamQuestion` (grades at submission; voids the attempt on a content
  version mismatch), `finalizeExamAttempt` (sums stored answers only),
  `startChallenge` (idempotent: returns the open attempt for user × challenge ×
  company or creates one with a server `startedAt`), `checkChallenge(attemptId)`
  (re-reads the attempt under the session company, runs the checker with the
  stored `startedAt`, updates the row), `issueCertificate` (re-verifies exam +
  challenges, snapshots the exact `learnChallengeAttempt` ids + evidence, writes
  certificate + XP + badge + notification in one Kysely transaction; on the
  `(examAttemptId, companyId)` unique conflict it returns the existing
  certificate), `renewCertificate`, and `revokeCertificate` (admin,
  `resources_update`: sets `revokedAt`/`revokedBy`, records the reason in
  `customFields.revocationReason`, fires no XP change). All writes via the
  service-role client; all XP awards through one `awardXp` helper that inserts
  the ledger row (idempotent via the unique index) and upserts
  `learnActivityDay`.

### Routes

Learner (auth-only, employee role) — new tree `x+/learn+/`:

- `_layout.tsx` — `handle: { breadcrumb: Learn, module: "resources" }`
- `_index.tsx` — hub: track cards with progress, continue CTA, XP/level/streak
  panel, heatmap, badges, certificates, practice-company callout.
- `$trackSlug.tsx` — track detail: modules/units, badge states, exam gate state
  (locked → unlocked → cooldown until ...), certificate status.
- `$trackSlug.$unitSlug.tsx` — unit runner: objectives, doc links, quiz form
  (server-graded action, explanations + doc deep-links on results) or challenge
  panel (instructions, target-company banner, "Check my work" action).
- `$trackSlug.exam.tsx` — honor gate → timed one-question-at-a-time runner →
  result + certificate issuance on pass.
- `preferences.tsx` — weekly goal.

Admin (resources-gated) — under `x+/resources+/`:

- `learn.tsx` — team dashboard (status table + filters).
- `learn.assignments.tsx` / `learn.assignments.new.tsx` /
  `learn.assignments.$id.tsx` — assignment CRUD (mirrors training assignments).

Public / files:

- `share+/certificate.$code.tsx` — verification page (service-role read,
  minimal fields, robots-friendly).
- `file+/learn-certificate+/$id[.]pdf.tsx` — react-pdf certificate
  (hand-built tree like `KanbanLabelPDF.tsx` on `Template.tsx`, QR via
  `generateQRCode(verifyUrl)`, `renderToStream`).

`path.to` additions: `learn`, `learnTrack`, `learnUnit`, `learnExam`,
`learnAdmin`, `learnAssignments`, `learnCertificateVerify`, `learnCertificatePdf`.

### Notifications

- `NotificationEvent.LearnAssignment = "learn-assignment"` — fired on
  assignment create (same try/catch `trigger("notify", ...)` pattern as
  `assignments.new.tsx`); topic `Training`; defaults `[Email, Slack]` + InApp.
- `NotificationEvent.LearnCertificateExpiring = "learn-certificate-expiring"` —
  fired by a small addition to the existing weekly scheduled job for
  certificates inside the 30-day window; recurring, capped by the existing
  delivery-cap machinery.

### i18n

All new UI strings through Lingui (`t`/`msg`); `/translate` fills catalogs.
Curriculum content itself (question prompts, unit copy) ships English-only in
v1 — flagged in Open Questions.

## UI Changes

- **Learn hub** (`/x/learn`): track grid with per-track progress rings; right
  rail with level + XP bar, weekly-goal ring, workweek streak, 26-week
  heatmap (`ui/Learn/ActivityHeatmap.tsx`, CSS grid, 4 intensity buckets),
  badge shelf, certificate list (Active/Expiring/Expired chips).
- **Unit runner**: objective header → "Read these" doc-link cards (open
  docs.carbon.ms in a new tab) → quiz card (one attempt in flight; instant
  per-question feedback with the explanation and a "Read why" doc deep-link;
  confetti + success audio on pass — reusing the `share+/training.$id.tsx`
  pattern) or challenge card (requirement checklist that fills in as checks
  pass, first-failure message verbatim from the checker, evidence links on pass).
- **Exam runner**: full-screen; honor statement gate; countdown timer; one
  question per screen, no back navigation; progress dots; results screen with
  per-topic breakdown (never per-question answer reveal — bank protection);
  certificate celebration on pass with PDF + verify-link buttons.
- **Admin dashboard** (`/x/resources/learn`): employees × assigned tracks
  status table (Not started / In progress % / Certified until / Expired /
  Overdue), group/department filters, CSV export via the standard table
  export; assignment forms mirroring `TrainingAssignmentForm`.
- **Entry points**: "Learn" item in the Resources sidebar group (admin), a
  "Learn Carbon" link in the top-bar help/avatar menu (everyone), and a
  "Continue learning" card on the home dashboard when an assignment is open.
- **Verification page** (`/share/certificate/:code`): certificate facsimile +
  status banner + criteria list (exam score, verified challenges, content
  version, dates). No auth required.

## Acceptance Criteria

Phase 1 (engine + `fundamentals` + `purchasing`):

- [ ] A learner with no `resources_*` permissions can open `/x/learn`, see both
      tracks, and open a unit; an anonymous request is redirected to login.
- [ ] Submitting a unit quiz with all answers correct on the first try awards
      exactly 100 XP once: the `learnXpEvent` row exists, a resubmission of the
      same quiz creates no second row (unique index holds), and the hub XP
      total equals the SUM of ledger rows.
- [ ] Failing a quiz then passing on the second attempt awards 50 XP; the third
      or later pass awards 25; `learnUnitProgress.quizAttempts` and `bestScore`
      reflect every sitting.
- [ ] Quiz grading happens server-side: the page HTML/JS bundle contains no
      correct-answer data (verified by grepping the built client bundle for a
      known answer-key string), and a hand-crafted POST with forged
      `correct: true` responses does not change the grade.
- [ ] A direct PostgREST INSERT into `learnXpEvent` / `learnAttempt` /
      `learnCertificate` with a learner JWT is rejected (no write policy).
- [ ] A learner JWT can SELECT its own `learnAttempt` rows but gets zero rows
      from `learnAttemptAnswer` (no policy); a user holding `resources_view`
      gets zero rows from another employee's `learnXpEvent` / `learnAttempt`
      through PostgREST, while the admin dashboard still shows that employee's
      track status via the projection.
- [ ] Opening a hands-on unit and pressing "Start challenge" creates exactly
      one open `learnChallengeAttempt` (a second press returns the same id);
      "Check my work" with an attempt id from another company returns 404 and
      records nothing.
- [ ] Calling `issueCertificate` twice for the same passed exam attempt (retry
      or concurrent) yields one `learnCertificate` row and one
      `verificationCode`; the second call returns the first row.
- [ ] A certificate's `challengeAttemptIds` and `evidence` name the exact
      passed attempts; a later re-run of the challenge does not alter them.
- [ ] An admin with `resources_update` can revoke a certificate with a reason;
      the verify page shows Revoked immediately, the learner's hub shows the
      certificate as Revoked, and a user without `resources_update` gets 403.
- [ ] `upsertLearnAssignment` with one `groupId` from another company rejects
      the whole write (no row, no notification).
- [ ] A direct PostgREST UPDATE of `learnPreference.weeklyGoalXp` to `0` or
      `150` fails the CHECK constraint.
- [ ] Bumping `LEARN_CONTENT_VERSION` while an exam attempt is in flight voids
      that attempt on the next answer (no score, no cooldown) and the learner
      can start a new attempt immediately.
- [ ] The "Create and release a purchase order" challenge fails with the
      message naming the first missing requirement when (a) no PO exists, (b) a
      PO exists but is Draft, (c) it has 1 line — and passes when a released
      2-line PO created by the learner after `startedAt` exists, recording the
      PO id in `evidence`. Records created by a *different* user never pass.
- [ ] Checker fixture tests prove fail-on-empty-company and
      pass-on-known-good-sequence for every shipped challenge.
- [ ] The exam cannot start until required challenges pass; starting requires
      the honor checkbox; the drawn form contains the blueprinted per-topic
      counts; two consecutive attempts draw different forms.
- [ ] Answering past the time limit finalizes the attempt with only the
      answers submitted before `expiresAt`.
- [ ] Scoring ≥ 80% issues a `learnCertificate` in one transaction with
      `expiresAt = issuedAt + 12 months`, awards 1000 XP, fires the
      notification, and renders both the PDF (with a QR that resolves to the
      verify URL) and the public verification page showing Active status,
      score, and verified challenges.
- [ ] Scoring < 80% blocks a retake for 24 h (first fail) then 7 days
      (subsequent), with the cooldown end shown in the UI and enforced
      server-side.
- [ ] `/share/certificate/:code` renders for a logged-out visitor, shows
      Expired after `expiresAt`, Revoked when `revokedAt` is set, and 404s on
      an unknown code.
- [ ] Completing every unit in a module awards the module badge + 50 XP
      exactly once.
- [ ] Activity on two days in the company's timezone produces two
      `learnActivityDay` rows with correct sums; a learner meeting their weekly
      goal two ISO weeks running shows streak 2; an unmet *current* week does
      not break it; an unmet *previous* week resets it.
- [ ] The heatmap renders 26 weeks with intensity buckets and shows only the
      signed-in learner's own data.
- [ ] An admin assigns `purchasing` to a group with a due date: members see it
      on the hub, `LearnAssignment` notifications deliver in-app + email, and
      the team dashboard shows each member's status, flipping to Certified
      (with expiry) after a member certifies — visible only to users with
      `resources_view`.
- [ ] A learner in company A sees no progress/certificates from company B
      (RLS + service scoping), and all engine queries filter by `companyId`.
- [ ] Every learner-facing string is Lingui-wrapped; `pnpm run lint`, scoped
      typecheck, and `pnpm run generate:types` are clean.

Phase 2+ (tracked, not v1-blocking): remaining seven tracks (accounting first),
renewal quiz flow before expiry, per-question analytics for docs feedback,
capstone challenges per track, docs-site inline quizzes (phase 3).

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Learners create junk documents in a production company while practicing | Med | Practice-company callout on the hub + target-company banner on every check; challenges are read-only (never mutate); demo-template companies are one click (Settings → Demo Data); admin guidance in docs. Deliberately not enforced (see Open Questions). |
| Question banks leak (answers in client bundle or via API) | High | Banks/checkers in `*.server.ts` only; grading server-side; exam results never reveal per-question keys; acceptance criterion greps the built bundle. |
| Forged progress/XP/certificates via direct PostgREST writes | High | No client write policies on any engine table; service-role writes after server-side verification; `itarCertification` precedent; acceptance criterion tests the rejection. |
| Docs drift breaks curriculum links or stales questions | Med | Curriculum links checked by a small CI script against `docs/content` slugs (same spirit as the docs link-verification bar); `LEARN_CONTENT_VERSION` stamps certificates; question explanations cite doc paths so a docs PR touching them flags the bank for review. |
| Gamification reads as surveillance/pressure and backfires | Med | Research-backed guardrails baked in: weekly (not daily) streaks, private heatmap/XP, no leaderboards, manager sees only assignment + certification status. |
| Content authoring effort per track is large (90+ exam bank, unit quizzes, checkers) | Med | Phase per track; glossary (371 grounded terms) and `StatusFlow` lifecycles (33 authored) are ready-made question sources; AI-assisted drafting with human curation and the fail-on-stub proving rule for checkers. |
| Cert exam integrity limits (unproctored) | Low | Accepted openly: bank stratification, fresh forms, one-way nav, time limit, cooldowns, honor gate — and the verified hands-on portion is the un-cheatable half (research consensus). Not marketed as a proctored credential. |
| `resources.service.ts` grows large | Low | Engine functions isolated in `resources.learn.server.ts`; models stay in `resources.models.ts` per module-layout rule. |

## Open Questions

> Resolved in autonomous mode (headless run — the user directed
> answer-questions → research → spec-PR in one pass and reviews at the PR).
> Each resolution below follows codebase precedent → research consensus →
> recommendation, and is listed again in the PR's "Assumed decisions" section
> for veto at review. None touches Ask-First territory: no existing schema,
> auth/RBAC, or public contract is modified — everything is additive.

- [x] Where does the system live — docs site, Academy, or ERP? —
      **Autonomous:** ERP, extending the `resources` training domain. The docs
      site has no auth/persistence; Academy progress is global (no `companyId`)
      and the docs skill forbids elevating Academy to a product pillar; the ERP
      has every rail (auth, groups, notifications, PDF, demo companies) and is
      where hands-on verification must run. (Odoo-in-ERP + Trailhead-in-ecosystem
      precedent.)
- [x] New `learn_*` permission family or reuse `resources`? — **Autonomous:**
      reuse `resources` — `.ai/lessons.md:49` explicitly forbids minting a new
      module family for a feature that fits an existing domain, and Training
      already lives there. Learner surfaces are auth-only (precedent:
      `trainingCompletion` self-INSERT, `share+/training.$id.tsx`); admin
      surfaces gate on `resources_*`. No RBAC change of any kind.
- [x] Is progress per-company or global-per-user? — **Autonomous:** per-company.
      The product goal is employer-visible training records and company-scoped
      hands-on evidence; `trainingCompletion` is the precedent and Academy's
      global progress is the documented gap. Cost: a user who changes companies
      starts fresh (portability deliberately out of scope v1).
- [x] Must hands-on challenges run in a dedicated sandbox company? —
      **Autonomous:** no — recommended, not required. HubSpot grades the real
      account; Microsoft retired hosted sandboxes; enforcement would block
      self-serve learners in single-company installs. The hub nudges toward a
      demo-template practice company and every check names its target company.
      This is the resolution most worth a human veto if junk-data risk feels
      unacceptable.
- [x] Leaderboards? — **Autonomous:** none in v1; XP/streak/heatmap are
      learner-private. Peer-reviewed backfire evidence in mandatory workplace
      contexts (Hanus & Fox 2015; Mollick & Rothbard) outweighs Odoo's public
      leaderboard precedent. Team-aggregate views can revisit later.
- [x] Certificate lifetime and renewal? — **Autonomous:** 12-month validity,
      version-stamped, renewed by a free short delta quiz from 30 days out —
      the SAP/Microsoft/NetSuite convergence; Salesforce's release-aligned
      maintenance modules (three cycles a year, still current) are the heavier
      cadence deliberately avoided.
- [x] Pass bar? — **Autonomous:** 80% for certification exams (existing
      `PASSING_THRESHOLD = 0.8` precedent + Odoo default), unit quizzes require
      all-correct with XP decay on retries (Trailhead/Academy semantics),
      hands-on checks are binary with free retries.
- [x] Curriculum authoring — CMS/DB or code? — **Autonomous:** code-shipped TS
      (Academy `config.tsx` precedent + be-better-dev slug-upsert lesson), so
      content versions with the product and certificates can stamp a real
      version; companies wanting their own content already have the Training
      feature. Revisit only if non-engineers must author Carbon curriculum.
- [x] Are curriculum question prompts translated in v1? — **Autonomous:** UI
      chrome yes (Lingui), curriculum content English-only in v1 — the docs it
      teaches are English-only today; translating 500+ bank items before the
      engine proves out is premature.
- [x] Does the docs site itself get interactive quizzes? — **Autonomous:** yes
      but phase 3, anonymous + localStorage only (Checklist precedent), answer
      keys via a remark-stripped MDX component (`<AgentContext>` pattern); no
      auth is added to the static docs app. The in-ERP system is the one that
      certifies.
- [x] MES surface for shop-floor learners? — **Autonomous:** out of scope v1;
      the Production track is taken in the ERP. Revisit with MES stakeholders.

## Changelog

- 2026-08-29: Created. Research + design per
  `.ai/research/2026-08-29-gamified-learning-certification.md` (Trailhead, SAP,
  Microsoft Learn, Odoo, NetSuite/Epicor/Acumatica, HubSpot/ServiceNow,
  Duolingo, learning-science literature, and house prior art: be-better-dev,
  rust-course/zero2deep, carbon-learn). **All 11 open questions resolved
  autonomously** (headless run; resolutions marked `Autonomous:` above and
  mirrored in the spec PR's "Assumed decisions" section for review). Key
  autonomous calls: ERP-embedded under `resources` (no new permission family),
  per-company progress, server-authoritative writes with no client write
  policies, weekly-goal streaks with no leaderboards, 12-month version-stamped
  certificates with delta-quiz renewal, code-shipped curriculum, practice
  company recommended-not-required.
- 2026-09-06: Review round 1 (CodeRabbit on PR #1509) — accepted 11 findings,
  all baked into the design above: (1) per-question grading moved out of the
  learner-readable `learnAttempt.responses` into a service-role-only
  `learnAttemptAnswer` table; (2) exam grading bound to the stored
  `contentVersion` — answers graded at submission, finalize only sums, a
  version mismatch voids the attempt (`voidedAt`, no cooldown); (3) hands-on
  challenges get a server-owned `startChallenge` and `checkChallenge(attemptId)`
  re-reads the attempt under the session company — `learnChallengeAttempt` is
  now one row per start with a partial unique index on open attempts; (4)
  `learnCertificate` gains UNIQUE `(examAttemptId, companyId)` so issuance is
  idempotent, plus `challengeAttemptIds[]` and an immutable `evidence`
  snapshot; (5) `revokeCertificate` admin action (`resources_update`) added;
  (6) engine-table RLS is self-only **and** membership-scoped — the
  `resources_view` raw-read branch is gone, admins read a service-role
  projection; (7) `upsertLearnAssignment` rejects any `groupId` outside the
  company; (8) `weeklyGoalXp` gets a DB CHECK (100/200/500); (9) Salesforce
  maintenance-module claim corrected (release-aligned modules still run as of
  2026) in spec + research; (10) the "no ERP vendor" claim scoped to the five
  vendors surveyed as of 2026-08-29; (11) research prior-art references made
  machine-independent. Declined: none. Acceptance criteria extended with nine
  new checks covering each accepted finding.
