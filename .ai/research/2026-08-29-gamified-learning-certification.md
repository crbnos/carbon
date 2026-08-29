# Gamified Docs Learning & Certification Research: Best Practices Survey

## Summary

Researched how best-in-class platforms turn product documentation into an interactive,
gamified learning system that ends in a credential a manager trusts: Salesforce
Trailhead (the canonical prior art), SAP Learning Hub/certification, Microsoft Learn
(which trains Dynamics 365 ERP users), Odoo eLearning (the closest open-source ERP
analog), NetSuite/Epicor/Acumatica (ERP vendor training programs), HubSpot and
ServiceNow (auto-graded hands-on exercises), Duolingo (streak/XP mechanics), and the
published learning-science literature (retrieval practice, spacing, gamification
backfire studies, the Brown University Rust Book experiment). Key findings: (1) the
industry-consensus assessable atom is a unit ending in exactly one quiz OR one
hands-on challenge, with points decaying on quiz retries but hands-on retries always
free; (2) **no classic ERP vendor auto-grades hands-on work against the customer's
own instance today** — only Trailhead (org API checks), HubSpot (own-account
grading), ServiceNow LabX, and Microsoft Applied Skills do it at all, which makes
verified-in-your-own-company challenges an open differentiator for Carbon; (3) in
mandatory/workplace contexts, competitive leaderboards and punitive mechanics have
documented negative effects, while private progress, built-in slack (weekly streaks,
freezes), and immediate explanatory feedback survive professional scrutiny; (4)
professional-level assessment means scenario items at Bloom's Apply/Analyze drawn
from a blueprinted bank ≥3× the form size, a 75–80% pass bar, escalating retake
cooldowns, and a certificate that is verifiable (public URL + criteria + evidence)
and perishable (version-stamped, renewed by a light "what changed" quiz).

## Competitors Surveyed

- **Salesforce Trailhead** — the reference implementation of gamified product
  training with automated hands-on verification; 200K → 4.5M+ learners, 20M+ badges.
- **SAP Learning Hub / learning.sap.com** — the enterprise ERP reference: learning
  journeys, paid practice systems, proctored exams, 1-year validity + stay-current.
- **Microsoft Learn** — trains Dynamics 365 (ERP) users; XP/badge/trophy taxonomy,
  role-based cert paths, Applied Skills lab-graded credentials, free open-book renewal.
- **Odoo eLearning (`website_slides` + `survey`)** — open-source ERP with a built-in
  LMS it dogfoods for its own product training; field-level mechanics readable in source.
- **NetSuite / Epicor University / Acumatica Open University** — how mid-market ERP
  vendors structure role-based customer training and certification maintenance.
- **HubSpot Academy / ServiceNow University** — commercial precedents for auto-grading
  exercises performed in the learner's own live tenant.
- **Duolingo** — streak/XP/league mechanics and their measured effects; what transfers
  to B2B and what backfires.
- **Brown University Rust Book experiment (OOPSLA 2024)** — quizzes embedded in real
  documentation at scale (62,526 readers, 1.14M answers), with published findings on
  question quality and using quiz telemetry to improve the docs.

## Key Consensus Patterns

### 1. The assessable atom: unit = content + (quiz XOR hands-on challenge)

- **Trailhead**: each unit ends in exactly one assessment — a short MCQ quiz or a
  hands-on challenge checked against a connected org. Module = badge, trail = path.
- **Microsoft Learn**: unit → module (ends in a knowledge check → badge) → learning
  path (→ trophy).
- **Odoo**: every content slide can carry a quiz; certification is a distinct
  content type delegated to the survey engine.
- **Rationale**: nothing is "read-only credit" — every screen of content ends in
  something checkable, which is also what the retrieval-practice literature says
  makes the content stick (see pattern 6).

### 2. Points decay on quiz retries; hands-on retries are always free

- **Trailhead**: quiz = 100 pts first try, 50 second, 25 third+; hands-on challenge
  = 500 pts flat with unlimited unpenalized retries ("the error → fix → re-check
  loop is the pedagogy"). Hands-on paying 5× the quiz is the most-copied number.
- **Odoo**: per-slide karma rewards default 10/7/5/2 by attempt count
  (`quiz_first_attempt_reward` … `quiz_fourth_attempt_reward` on `slide_slide`),
  with the UI showing what the next attempt is worth.
- **be-better-dev (house)**: XP awarded once on first completion; repeat runs are
  "practice runs" that count toward daily activity but award nothing.
- **Rationale**: decay kills guess-grinding; free hands-on retries keep the
  expensive-to-fake activity a learning loop instead of a punishment.

### 3. Automated hands-on verification = black-box assertions against a real tenant

- **Trailhead**: learner OAuth-connects an org (or one-click provisions a
  "Trailhead Playground" pre-loaded with sample data + a checker package). "Check
  Challenge" runs server-side: declarative challenges query the org's APIs for
  exactly-named objects/fields/config; code challenges execute assertions via the
  Tooling API and clean up their side effects. Failure returns the **first failing
  requirement by name** ("could not find field X"); retries unlimited. The #1
  failure mode is mistyped names, so instructions specify exact names and the
  checker's error names the missing thing.
- **HubSpot Academy**: practical exercises are performed in the learner's **own
  HubSpot account**; "some practical exercises are graded automatically based on
  actions taken in your HubSpot account."
- **ServiceNow University (LabX)**: guided simulations run against real instances;
  "the simulator validates your work against predefined success criteria" with
  instant feedback.
- **Microsoft Applied Skills**: scenario labs in hosted environments, scored
  automatically against objective completion criteria, no multiple choice.
- **Microsoft's cautionary tale**: the free 4-hour Azure Learn sandbox was retired
  (July 2026 FAQ) — disposable hosted sandboxes are a support burden; the pattern
  moved to bring-your-own tenant.
- **Gap**: Odoo, NetSuite, Epicor, Acumatica, and SAP all stop at quizzes or guided
  (unverified) exercises. **No ERP vendor checks the learner's work in the
  learner's own ERP.** SAP even charges for practice systems by the hour (HUB360 =
  60 h/yr). Carbon's demo-template companies are exactly the free, persistent
  practice fixture this pattern needs.

### 4. Separate the cheap dopamine from the employer-grade credential

- **Microsoft**: badge (module, knowledge check) vs trophy (path) vs **credential**
  (certification / Applied Skills — "validated by a more robust skill assessment").
- **Trailhead**: points/badges/ranks are permanent, additive identity (Ranger = 100
  badges + 50K pts; prestige tiers to 600/300K); **certifications** are separate,
  proctored, paid, and perishable. Superbadges sit between: free but
  performance-based — a business-scenario brief with **no step-by-step
  instructions**, validated by the same org checks; that absence of instructions is
  what makes them "professional level." Salesforce split monolithic 8–16K-pt
  superbadges into 1,500–2,500-pt units because the monoliths deterred starts.
- **Odoo**: certification = ~8 fields bolted onto the survey engine (`certification`
  bool, `scoring_success_min` default **80%**, `is_attempts_limited` default 1
  attempt, `is_time_limited` default 10 min, certificate PDF mail template + 6
  layout choices, linked `gamification.badge`).
- **Rationale**: if a lesson badge looks like a certification, both lose value; the
  rank is who you are, the certificate is what your employer relies on.

### 5. Certificates are version-stamped, verifiable, and renewed lightly

- **SAP (April 2024 pivot)**: all certs valid **1 year**; stay certified via a
  "short not proctored quiz with unlimited trials" per release window; miss it →
  Expired, full re-exam to return.
- **Microsoft**: role certs expire annually; renewal is a **free, unproctored,
  open-book online assessment focused on what changed**, available 6 months before
  expiry.
- **NetSuite**: admin certs require an annual open-book New Release Quiz + re-exam
  every 3 years.
- **Salesforce**: ran ~7 years of per-release maintenance modules (miss → cert
  expires), then retired separate maintainer modules in 2025 as administrative
  burden. Lesson: per-release cadence is too heavy; **one light delta-assessment
  per year is the settled convention**.
- **Credibility (Open Badges / Credly)**: what makes a credential checkable is a
  stable verification URL exposing issuer, criteria, evidence, and issue date —
  fields the Open Badges standard formalizes. A PDF alone is a sticker.

### 6. The quiz IS the lesson (retrieval practice), and it must explain itself

- Retrieval practice beats restudy at **g ≈ 0.50–0.61** (Adesope 2017 meta-analysis
  of 217 effects; Rowland 2014); practice testing and distributed practice are the
  only two "high-utility" techniques in Dunlosky et al. 2013.
- **Feedback is mandatory**: Butler & Roediger 2008 — unexplained MCQs teach the
  distractors; feedback with the explanation cancels that and amplifies the testing
  effect. Every wrong answer should link the exact doc section that answers it.
- **Spacing scales with the retention goal** (Cepeda 2006): for "certified for a
  year," reviews days-to-weeks apart beat next-day re-quizzing.
- **Question quality (Rust Book experiment, OOPSLA 2024 Distinguished Paper)**:
  conceptual "why" questions outperform surface "what" questions; 12 doc rewrites
  targeted at the worst-scoring questions raised those scores **+20%** — quiz
  telemetry doubles as analytics on which doc pages fail to teach.

### 7. Gamification that survives the workplace: private progress, built-in slack, no forced competition

- **Backfire evidence**: Hanus & Fox 2015 (badges + leaderboard course → declining
  intrinsic motivation and **lower exam scores**); Mollick & Rothbard "Mandatory
  Fun" (gamification helps only with consent; imposed, it lowers affect and
  performance); Mekler 2017 (points/levels/leaderboards change output, not
  motivation); Duolingo's hearts/energy backlash (punitive resource mechanics read
  as punishment). Meta-analyses (Sailer & Homner 2020: cognitive g = 0.49,
  motivational g = 0.36) say effects are real but modest and context-dependent.
- **Streaks for a workday product**: GitHub **removed** public daily streaks in 2016
  ("focuses on the work you're doing rather than the duration of your activity")
  because daily chains punish weekends and rest; LinkedIn Learning uses **weekly
  time goals**; Duolingo keeps daily streaks only by selling slack back (freezes —
  which their data shows increase retention: +0.38% DAU from a second freeze, ~21%
  churn reduction at risk points). Consensus for workplace learning: **count
  workweeks, not days**, and build the slack in free.
- **What transfers cleanly**: XP as private progress, milestone celebration
  (confetti on pass), streak-with-slack, activity heatmap (self-facing), badges for
  real accomplishments. What doesn't: colleague leaderboards, hearts/lives, public
  daily streaks, anything the manager can see besides the credential.

### 8. Role → path → certificate, with courses tagged by app/module

- **Microsoft** certifies job roles ("Dynamics 365 Business Central Functional
  Consultant"); learning paths are the curriculum unit; the training browser
  filters by role.
- **Odoo/Acumatica/Epicor/NetSuite** all converge on role-based learning paths
  (Acumatica: Finance Management, Orders and Inventory, Project Accounting…;
  NetSuite: Administrator/Consultant/Developer tracks with Associate → Professional
  levels) while individual courses map to apps.
- **Odoo dogfoods it**: odoo.com/slides organizes its own product training by app
  (Accounting, Inventory, MRP, Sales…) with a public leaderboard and certifications
  per app — proof an ERP training its own users on its own LMS works commercially.

### 9. Professional assessment hygiene for unproctored online exams

- **Item banks**: start at ~2–3× the items one form needs (real-world example: a
  150-item bank feeding 3 non-overlapping 50-item forms), blueprint by topic, draw
  randomly **within topic strata** so every form covers the same domains; run
  unscored pretest items to calibrate.
- **Pass bar**: 70–80% is convention, not science; the defensible method is a
  lightweight modified-Angoff review ("would a minimally competent AP clerk get
  this right?"). Practical: 75–80%, revisited against item stats. (Existing Carbon
  precedent: the in-ERP training runner already uses `PASSING_THRESHOLD = 0.8`;
  Odoo's certification default is 80%.)
- **Retakes**: escalating cooldowns are the industry pattern — AWS 14 days;
  Microsoft 24 h then 14 days, max 5/yr; Salesforce 24 h then 2 weeks. Fresh form
  each attempt.
- **Anti-cheating without surveillance**: randomized per-topic pools, shuffled
  options, one-question-at-a-time with no back-navigation, moderate time limit,
  server-side answer keys, and an **honor statement before the attempt**
  (empirically reduces cheating). The strongest deterrent in the literature is
  question design itself: scenario items are slow to look up and low-value to
  share. The hands-on verified task is the un-cheatable half of the credential.

### 10. Free learning, gated credential; publish the milestones

- Acumatica's university is fully free (certification reserved for partners);
  Microsoft training is free with paid proctored exams; SAP gates practice systems
  and exams behind a ~$1.4K/yr subscription (the cautionary contrast); Trailhead is
  free end-to-end and Salesforce publishes badge counts as marketing (1.2M → 20M).
- For an in-product system: all learning free with the product; the certificate is
  the trust artifact; team reporting is the admin-facing value.

## Answers to Research Questions

1. **How do leaders structure content and assessment?** Trail/path → module →
   unit, with exactly one assessment per unit (quiz XOR hands-on). Badges at module
   level, trophies/certificates at path level, ranks/levels across everything
   (Trailhead ranks: Scout → Ranger at 100 badges + 50K pts; point gates 200 / 3K /
   9K / 18K / 35K / 50K). Modules are 20–45 min; units single-sitting.
2. **How is hands-on work verified automatically?** Server-side black-box
   assertions over the tenant's APIs (Trailhead: exactly-named config queries +
   Tooling-API-invoked assertions with cleanup; HubSpot: actions in your own
   account; ServiceNow: predefined success criteria per simulation). First-failing
   requirement named in the error; unlimited free retries; the challenge is pinned
   to the tenant it was last checked against.
3. **What gamification works/backfires professionally?** Works: private XP/levels,
   weekly-unit streaks with free slack, self-facing heatmaps, module badges,
   celebration moments. Backfires (with study evidence): colleague leaderboards,
   punitive lives/energy, public daily streaks, any mechanic the employee didn't
   opt into. Manager visibility should be limited to assignment/certification
   status — never streaks or miss counts.
4. **How are professional assessments designed?** Scenario items at Bloom's
   Apply/Analyze ("here is a situation, what happens / what's the best action"),
   blueprinted banks ≥3× form size drawn per-topic, 75–80% pass, time limit,
   one-way navigation, shuffling, server-side keys, honor statement, escalating
   retake cooldowns (24 h → 1–2 weeks), fresh form per attempt.
5. **How do certificates stay credible as the product changes?** Version-stamp at
   issue; ~12-month validity; renewal = free, short, open-book "what changed"
   quiz (Microsoft/NetSuite/SAP convention; Salesforce's heavier per-release
   modules were retired as burden). Verification = public URL + ID exposing
   criteria, evidence (scores, verified tasks), issuer, dates (Open Badges fields).
6. **How do ERP vendors organize role-based training?** Role-named paths over
   app-tagged courses; Associate → Professional levels; admin-side team completion
   reporting (Epicor ELC) is a first-class feature; certification maintenance tied
   to release cadence.

## Competitor-Specific Details

### Salesforce Trailhead
- Points: quiz 100/50/25 by attempt; hands-on 500 flat; project step 100;
  superbadge units 1,500–2,500 (full superbadges ~9–10K). Rank never expires.
- Playgrounds: max 10 per account, auto-provisioned DE orgs with sample data + a
  pre-installed checker package; expire after ~6 months of inactivity.
- Superbadges: business-scenario brief, no step-by-step instructions, 4–12 h;
  Super Sets bundle them by role. PDII required 3 superbadges until Oct 2025.
- Certification: proctored, ~$200/$400, now delivered via Pearson VUE; 2025 program
  restructure retired 24 certs and ended separate maintenance modules.
- Scale: 200K users/1.2M badges (2016) → 5M badges + 22M challenges (2020) → 20M
  badges (2021); "average" community badge count ~200.

### SAP
- Free learning journeys on learning.sap.com map 1:1 to certs; Records of
  Achievement for journey quizzes. Practice systems are paid/metered (HUB360 = 60
  h/yr); Learning Hub ~$1,368/yr incl. 4 exam attempts.
- Exams: ~80 questions / 180 min, proctored, cut scores published per exam
  (~59–73%); max 4 attempts then 12-month lockout. Unproctored "practical exams"
  (system/scenario-based) are being added.
- Validity: 1 year flat since April 2024; stay-certified quiz per release window
  (unlimited tries, needs active subscription); miss → full re-exam.

### Microsoft Learn
- XP shown on every unit/module/path; levels uncapped, thresholds unpublished;
  badge = module (knowledge check), trophy = path; public profile + shareable
  transcript with employer-linked access.
- Applied Skills: lab-based assessment in a hosted environment, scenario delivered
  via in-lab emails, auto-scored against completion criteria in 1–2 h.
- Renewal: free open-book delta assessment, 6-month window, +1 year per pass.
- Azure Learn sandbox retired (2026) → bring-your-own subscription.

### Odoo
- `website_slides`: courses = sections + content (image/article/document/video/
  quiz) + certifications; enroll = Open/Invitation/Payment.
- Quiz karma per attempt 10/7/5/2 (source-verified defaults); course-finish +10,
  course-review +5; karma gates community actions (review at 10, moderate at 1K);
  ranks = karma thresholds; badges separate (manual or challenge-granted).
- Certification via `survey`: `scoring_success_min` default 80, attempts default 1
  (login required), time limit default 10 min, auto-emailed certificate PDF (6
  layouts), linked badge. **No expiry field** — a gap, not a pattern.
- Dogfooded at odoo.com/slides with a public XP leaderboard and rank titles.

### NetSuite / Epicor / Acumatica
- NetSuite: paid LCS Company Pass catalog; role-tracked leveled certs (Associate →
  Professional per role); admin certs = annual open-book New Release Quiz +
  3-year re-exam.
- Epicor University/ELC: role-based pathways, workshop-style hands-on courses,
  admin-side team completion + retention reporting.
- Acumatica Open University: fully free/public, role paths + a 21-day role-readiness
  program, self-check quizzes only; certification reserved for partners.

### HubSpot / ServiceNow
- HubSpot: certification practical exercises graded automatically from actions in
  the learner's own account (or manually, 5–7 days); status surfaced in-product.
- ServiceNow: Guided Simulations (LabX) validate work on real instances against
  predefined success criteria with instant feedback; free personal dev instances.

### Duolingo / learning science
- Streaks: 7-day streak → 3.6× course-completion odds; milestone animations +1.7%
  D7 retention; second equipped freeze +0.38% DAU; freezes ~21% churn reduction at
  risk points. Leagues: ~+25% lesson completion but documented XP-farming and
  anxiety; hearts→energy both read as punitive monetization.
- Rust Book experiment: 62,526 readers, 1,140,202 answers; conceptual questions
  beat surface ones; targeted doc rewrites +20% on failing questions; dropout
  localizes at hard concepts — telemetry finds where docs fail.

## House Prior Art (internal, non-competitor)

The author has already built this system twice outside Carbon; the mechanics are
proven and reusable:

- **be-better-dev** (`/Users/mac/sidd-oss/be-better-dev`, server-side, shipped):
  XP constants in one `gamify.ts` (lesson 20 XP, perfect-quiz +5, review +5, badge
  +50; level curve `50·n·(n−1)`); XP awarded once (`firstCompletion` gate, repeat =
  practice run); streak = consecutive active days anchored today-or-yesterday;
  GitHub-style 26-week heatmap bucketed by daily XP (<30/<60/<100/≥100); review
  queue (first interval 2 d, ×2.5 growth, 90 d cap, miss → tomorrow); strictly
  linear unlock; weekly leaderboard. Data model: content tables seeded by slug
  (upsert; reseeding never touches progress), `xp_event` **append-only ledger**
  ("totals are sums, never a mutable counter"), `activity_day` upserts,
  `badge_award` unique per badge.
- **rust-course / zero2deep** (`/Users/mac/work/rust-course`, spec + partial build):
  mastery states Seen → Practiced → Solid → Mastered advanced only by **cold**
  first-attempt correctness; test-out at every gate (≥80% unlocks); 12-kind
  exercise taxonomy (predict/spot-bug/fill-in/ordering/match-pairs/kata/boss);
  **boss battles** = "make this chapter's real tests pass in YOUR repo," with the
  proving rule that the authored suite must fail on the stub and pass on the
  reference implementation before a learner ever sees it; sandboxed runner with
  argv allowlist and first-failure feedback; `lesson_progress.status` where
  "locked" is computed, never stored; append-only `srs_review` so scheduler state
  is recomputable.
- **carbon-learn** (`/Users/mac/work/carbon-learn`): 17 MDX lessons teaching
  Carbon's own business logic; `<Predict>` commitment gates + `<Quiz>` with
  one-attempt scoring and explanations; XP 10/correct + 20/lesson, daily goal
  selectable 10/30/50/100; the recorded lesson: localStorage progress is
  per-browser-per-origin — **keep progress server-side from day one**.
- Carried design principles: predict-then-verify (the divergence is the lesson);
  every lesson ends in interaction; one lesson, one insight (450–750 words);
  distractors are real misconceptions; never fabricate verification output; the
  quiz-classification skill that matters for ERP users is "bug vs missing
  validation vs deliberate product decision vs configuration vs my misunderstanding."

## Recommended Approach for Carbon

1. **Build the learning layer inside the ERP as an extension of the existing
   `resources` training domain** (Trailhead-in-product / Odoo model), not in the
   static docs site (no auth) and not as an Academy expansion (positioning rule:
   Academy is not a product pillar). Reading stays on docs.carbon.ms; assessment,
   progress, XP, and certificates live in the app where users, companies,
   permissions, groups, notifications, and the data to verify hands-on work
   already exist.
2. **Adopt the Trailhead atom and economy**: role tracks → modules → units; unit =
   doc reading + (quiz XOR hands-on challenge); XP 100/50/25 quiz decay, 500 flat
   hands-on, module badges, permanent levels; certificates separate and perishable.
3. **Make verified hands-on challenges the differentiator** (the open ERP lane):
   server-side checkers assert exactly-specified records created by the learner in
   their company (Trailhead's declarative-check model), first-failure feedback
   naming the missing thing, unlimited free retries, evidence recorded on pass;
   practice recommended in a demo-template company (Carbon already ships those).
4. **Professional assessment per research consensus**: certification exam per
   track — scenario items, bank ≥3× form, drawn per-topic, 80% pass (existing
   Carbon precedent), time limit, one-way navigation, honor statement, escalating
   cooldowns, fresh forms; certificate version-stamped with 12-month validity,
   renewed by a free delta quiz; public verification URL with criteria + evidence.
5. **Workplace-safe gamification**: weekly-goal streaks (workweek unit, slack
   built in), private self-facing heatmap and XP, celebration on pass, **no
   colleague leaderboards in v1**; managers see assignment and certification
   status only.
6. **Close the docs loop**: every question links the doc section that answers it;
   per-question failure telemetry feeds a "worst-performing questions per doc
   page" report so the docs themselves improve (Rust Book model).

## Sources

- https://trailhead.salesforce.com/content/learn/modules/trailhead-road-to-ranger/plan-your-strategy-for-ranking-up
- https://help.salesforce.com/s/articleView?id=000388013&language=en_US&type=1
- https://trailhead.salesforce.com/content/learn/modules/trailhead_playground_management/create-a-trailhead-playground
- https://www.fishofprey.com/2015/02/troubleshooting-salesforces-trialheads.html
- https://www.salesforceben.com/superbadges-vs-certifications-which-is-better-for-me/
- https://www.salesforceben.com/salesforce-performance-based-credentials-superbages-super-sets-and-journeys/
- https://www.robbieduncan.com/blog/how-super-is-super
- https://www.salesforceben.com/salesforce-maintenance-exams/
- https://www.salesforceben.com/huge-changes-to-salesforce-certifications-heres-what-you-need-to-know/
- https://www.salesforceben.com/salesforce-is-retiring-24-certifications-heres-what-you-need-to-know/
- https://www.salesforce.com/news/stories/trailblazers-hit-milestone-of-five-million-badges-earned-on-trailhead/
- https://medium.com/trailhead/20-million-badges-trailheads-content-history-c00a72b38398
- https://venturebeat.com/business/salesforces-trailhead-platform-training-program-is-now-used-by-200000-people
- https://learning.sap.com/learning-journeys
- https://learning.sap.com/certification-transformation
- https://learning.sap.com/helpcenter/certification-support/how-to-stay-certified
- https://learning.sap.com/practice-systems
- https://training.sap.com/course/hub360-sap-learning-system-access-60-hour-usage-live-access-010-g-en/
- https://passitexams.com/articles/sap-certification-exam-format/
- https://learn.microsoft.com/en-us/training/support/faq
- https://learn.microsoft.com/en-us/credentials/applied-skills/
- https://learn.microsoft.com/en-us/credentials/support/applied-skills-faq
- https://learn.microsoft.com/en-us/credentials/certifications/renew-your-microsoft-certification
- https://learn.microsoft.com/en-us/credentials/certifications/d365-business-central-functional-consultant-associate/
- https://learn.microsoft.com/en-us/dynamics365/get-started/training/
- https://learn.microsoft.com/en-us/credentials/support/retake-policy
- https://www.odoo.com/documentation/18.0/applications/websites/elearning.html
- https://www.odoo.com/documentation/18.0/applications/marketing/surveys/scoring.html
- https://www.odoo.com/documentation/18.0/applications/websites/forum.html
- https://raw.githubusercontent.com/odoo/odoo/18.0/addons/website_slides/models/slide_slide.py
- https://raw.githubusercontent.com/odoo/odoo/18.0/addons/website_slides/models/slide_channel.py
- https://raw.githubusercontent.com/odoo/odoo/18.0/addons/survey/models/survey_survey.py
- https://www.odoo.com/slides
- https://www.netsuite.com/portal/services/training/suite-training/netsuite-certification.shtml
- https://www.netsuite.com/portal/assets/pdf/netsuite-certifications-frequently-asked-questions.pdf
- https://www.epicor.com/en-us/customers/epicor-learning/epicor-learning-center/
- https://openuni.acumatica.com/faq/
- https://knowledge.hubspot.com/help-and-resources/complete-practical-exercises-in-your-certification-course
- https://www.servicenow.com/community/developer-blog/guided-simulations-are-here-servicenow-university-changed-the/ba-p/3554890
- https://blog.duolingo.com/how-duolingo-streak-builds-habit/
- https://duolingo.deconstructoroffun.com/mechanics/streaks
- https://duolingo.deconstructoroffun.com/mechanics/leagues
- https://www.classcentral.com/report/duolingo-breaks-hearts-for-energy/
- https://github.blog/news-insights/product-news/more-contributions-on-your-profile/
- https://www.linkedin.com/help/learning/answer/a704926/setting-and-managing-weekly-goals-on-linkedin-learning
- https://www.semanticscholar.org/paper/dff76a9862467d426113ec530f83942016ae3a97 (Hanus & Fox 2015)
- https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2277103 (Mollick & Rothbard, "Mandatory Fun")
- https://www.sciencedirect.com/science/article/abs/pii/S0747563215301229 (Mekler 2017)
- https://eric.ed.gov/?id=EJ1245270 (Sailer & Homner 2020)
- https://journals.sagepub.com/doi/abs/10.3102/0034654316689306 (Adesope 2017)
- https://journals.sagepub.com/doi/abs/10.1177/1529100612453266 (Dunlosky 2013)
- https://link.springer.com/article/10.3758/MC.36.3.604 (Butler & Roediger 2008)
- https://digitalcommons.usf.edu/psy_facpub/1771/ (Cepeda 2006)
- https://cel.cs.brown.edu/paper/profiling-pl-learning/ (Rust Book experiment, OOPSLA 2024)
- https://arxiv.org/html/2401.01257v1
- https://www.psiexams.com/knowledge-hub/item-writing-and-exam-assembly-in-credentialing-importance-and-best-practices/
- https://assess.com/what-is-item-banking/
- https://assess.com/modified-angoff-method/
- https://aws.amazon.com/certification/policies/after-testing/
- https://aws.amazon.com/blogs/training-and-certification/aws-certification-new-exam-question-types/
- https://www.frontiersin.org/journals/education/articles/10.3389/feduc.2021.639814/full
- https://credsure.io/en/blog/open-badges-explained
- https://info.credly.com/product/open-badge-3.0
- Internal: `/Users/mac/sidd-oss/be-better-dev` (gamify.ts, learn.ts, schema/course.ts), `/Users/mac/work/rust-course` (PROMPT.md, COURSE-MAP.md, boss-suites/README.md, zero2deep schema), `/Users/mac/work/carbon-learn` (NOTES.md, progress.ts)
