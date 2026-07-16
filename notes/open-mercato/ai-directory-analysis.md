# Open Mercato `.ai/` Directory Analysis

> Analysis date: 2026-06-30
> Source: `/tmp/open-mercato/.ai/`
> Total files in `.ai/`: **780**

---

## Table of Contents

1. [Directory Overview](#directory-overview)
2. [Lessons Learned (`lessons.md`)](#lessons-learned)
3. [Specs Directory — Spec-Driven Workflow](#specs-directory)
4. [Design System Rules (`ds-rules.md`)](#design-system-rules)
5. [Module Development Guide (`docs/module-development.md`)](#module-development-guide)
6. [Skills System (`skills/`)](#skills-system)
7. [QA Approach (`qa/AGENTS.md`)](#qa-approach)
8. [Other Notable Directories](#other-notable-directories)
9. [Key Takeaways & What's Impressive](#key-takeaways)

---

## 1. Directory Overview {#directory-overview}

The `.ai/` directory is the **brain** of the Open Mercato project — a comprehensive, AI-native knowledge base that drives how AI agents (Claude Code, Codex) interact with the codebase. It contains:

```
.ai/
├── lessons.md              (94KB, 971 lines — accumulated project lessons)
├── ds-rules.md             (19KB — design system rules for AI)
├── ui-components.md        (285KB — full component reference)
├── design-system-audit-*   (275KB — DS audit report)
├── time-bomb-allowlist.json
├── analysis/               (7+ analysis reports, incl. cache perf FRs)
├── docs/                   (module-development.md, ds-v0-usage-guide.md)
├── drafts/                 (button-audit-figma-vs-code.md)
├── plans/                  (crm-email-integration plan)
├── qa/                     (AGENTS.md + 150 scenarios + Playwright config)
├── reports/
├── runs/                   (97 execution run plans — autonomous agent output)
├── scripts/                (ds-health-check.sh, ds-migrate-colors/typography)
├── skills/                 (39 skills across 5 tiers)
└── specs/                  (27 pending + 164 implemented + enterprise specs)
```

**What's impressive:** This is one of the most comprehensive AI-facing project directories I've seen. It's not just documentation — it's an **operating system for AI-assisted development**, with lessons feeding back into rules, specs driving implementation, skills orchestrating workflows, and QA scenarios verifying everything.

---

## 2. Lessons Learned (`lessons.md`) {#lessons-learned}

**Size:** 94KB, 971 lines, 60+ distinct lessons

### Structure

Each lesson follows a rigorous, consistent format:

```
## [Lesson Title]
**Context**: What was happening when the problem occurred
**Problem**: What went wrong and why
**Rule**: The prescriptive, actionable rule going forward
**Applies to**: Specific files/modules/patterns affected
```

### Categories of Lessons

The lessons span an extraordinary range of technical concerns:

| Category | Count (approx.) | Examples |
|----------|-----------------|----------|
| **ORM / Data Layer** | ~12 | Identity-map stale snapshots, flush ordering, MikroORM UUID generation, entity metadata |
| **Standalone / Create-App Parity** | ~15 | Template sync, env vars, Yarn versions, generator paths, Docker entrypoints |
| **Frontend / UI** | ~10 | Hydration, lazy providers, async selects, SSR, dnd-kit stable IDs |
| **Integration / Sync** | ~10 | Akeneo media paths, variant scoping, progress tracking, env presets |
| **Security** | ~5 | Credential exfiltration, role-name spoofing, RBAC `requireFeatures` vs `requireRoles` |
| **Testing** | ~5 | Playwright `networkidle`, `testIgnore` scoping, flaky test diagnosis |
| **Build / CI** | ~5 | Stale dist artifacts, `.cmd` wrappers, package exports |
| **Architecture** | ~8 | `globalThis` registries, widget injection, namespace preservation |

### Standout Lessons

1. **"Never guard sensitive routes with `requireRoles` on mutable role names"** — A security lesson about how role-name-based access control is fundamentally unsafe because names are user-editable. Must use immutable feature IDs from `acl.ts` instead.

2. **"Store global event bus in `globalThis` to survive module duplication in dev"** — Addresses a subtle HMR/Turbopack issue where module duplication creates orphaned event bus instances. Repeated across several lessons (event bus, integration registry, ORM entities).

3. **"MikroORM 6 does NOT generate UUIDs client-side"** — A gotcha where `em.create()` without explicit ID leaves `id` as `undefined` until flush, breaking parent-child creation patterns.

4. **"Stabilize flaky integration tests by finding the hang, not by raising the timeout"** — An anti-pattern lesson: don't just bump timeouts; trace the actual blocking await and fix the interaction.

### What's Impressive

- **Institutional memory at scale.** 60+ lessons, all battle-tested from real incidents. This isn't theoretical — every lesson has a concrete `Context` → `Problem` → `Rule` chain.
- **Prescriptive, not descriptive.** Each lesson ends with a **Rule** (not a suggestion) and an **Applies to** section pinpointing exactly which files/modules it covers.
- **Cross-cutting lessons.** Many lessons span monorepo ↔ standalone parity, catching a class of bugs that emerge only in scaffolded apps.
- **Security consciousness.** Multiple lessons about tenant isolation, credential hygiene, RBAC correctness, and untrusted input handling.

---

## 3. Specs Directory — Spec-Driven Workflow {#specs-directory}

### Scale

| Category | Count |
|----------|-------|
| **Pending specs** (root `.ai/specs/`) | 27 files |
| **Implemented specs** (`.ai/specs/implemented/`) | 164 files |
| **Enterprise specs** (`.ai/specs/enterprise/`) | 6 files |
| **Date-prefixed feature specs** (root, non-SPEC-*) | 67 files |
| **Total spec-like documents** | ~264 |

### Naming Convention

```
# Legacy (still present, being normalized):
SPEC-008-2026-01-27-product-quality-widget.md

# Current convention:
2026-06-15-custom-entity-records-edit-reserved-keys.md
```

Date-first, kebab-case title. The `om-fix-specs` skill exists specifically to normalize legacy `SPEC-*` names.

### Spec Lifecycle

The spec directory reveals a **full lifecycle workflow**:

```
1. Idea → spec draft (om-spec-writing skill, "Martin Fowler" review lens)
2. Pending spec lives in .ai/specs/
3. Implementation via om-implement-spec or om-auto-create-pr
4. Implemented spec moves to .ai/specs/implemented/
5. PR links back to spec via "Tracking plan:" line
```

### Spec Content — What's Inside

Specs are **comprehensive technical documents** (many are 20-100+ KB). Example topics:

- `2026-04-21-crm-call-transcriptions.md` (175KB!) — CRM call transcription integration
- `SPEC-024-2026-02-11-financial-module.md` (179KB) — Full ERP financial modules spec
- `SPEC-033-2026-02-18-omnibus-price-tracking.md` (142KB) — EU Omnibus price compliance
- `2026-05-21-email-integration-foundation.md` (129KB) — Email integration architecture
- `SPEC-029-2026-02-17-ecommerce-storefront-module.md` (74KB) — Ecommerce storefront

### Spec Template Requirements

From the `om-spec-writing` skill's template, every spec must include:
1. TLDR & Overview
2. Problem Statement
3. Proposed Solution (with Design Decisions table)
4. Architecture
5. Data Models
6. API Contracts
7. Risks & Impact Review
8. Final Compliance Report
9. Changelog

### What's Impressive

- **164 implemented specs** — This is a project that has been seriously spec-driven for months. The ratio of implemented (164) to pending (27) shows specs actually get built.
- **The "Martin Fowler" Review Lens** — The spec-writing skill adopts a "Martin Fowler staff-engineer persona" that challenges specs with 9 specific heuristics: Command Graph vs Independent Ops, Singularity Law (plural naming), Undo Contract, Module Isolation, Canonical Mechanisms, Sensitive Data encryption, and Design System compliance.
- **Open Questions Gate** — Specs must identify critical unknowns upfront, present them, and **STOP** until answered. This prevents the classic failure of building on wrong assumptions.
- **Market research requirement** — Every spec must reference an open-source market leader and document what was adopted vs. rejected.

---

## 4. Design System Rules (`ds-rules.md`) {#design-system-rules}

**Size:** 19KB, 336 lines

### Structure

The DS rules file is organized as a comprehensive **decision tree reference** that an AI agent can consult when writing UI code. It covers:

| Section | Key Rule |
|---------|----------|
| **Colors** | NEVER use hardcoded Tailwind colors (`text-red-*`, `bg-green-*`). Always use semantic tokens (`text-status-error-text`, `bg-status-success-bg`). |
| **Brand Colors** | Separate from semantic tokens. `brand-violet` for AI features, full gradient for hero/splash only. |
| **Corner Radius** | 6 levels from `rounded-sm` to `rounded-full`. NEVER use arbitrary values. |
| **Typography** | 6 sizes from `text-xs` (12px) to `text-2xl` (24px). NEVER use arbitrary sizes. Custom `text-overline` for 11px uppercase. |
| **Spacing** | 4px grid system. NEVER use arbitrary spacing. |
| **Opacity** | Fixed scale: 5, 10, 20, 30, 50, 70, 80, 90, 95, 100. NEVER arbitrary. |
| **Z-Index** | Semantic tokens (`z-sticky`, `z-modal`, `z-popover`, `z-tooltip`). NEVER arbitrary numeric z-index. |
| **Shadows** | 7 levels from `shadow-xs` to `shadow-2xl`. NEVER arbitrary. |
| **Motion** | 150ms micro, 200ms standard, 300ms large. NEVER arbitrary duration. |
| **Status Display** | MUST use `StatusBadge` with `StatusMap`. NEVER hardcode colors on Badge. |
| **Forms** | MUST use `FormField` wrapper. Every input MUST have visible label. |
| **Icons** | MUST use `lucide-react`. NEVER inline `<svg>`. |
| **Breakpoints** | Mobile-first only. NEVER use `max-*` or arbitrary media queries. |
| **Dark Mode** | NEVER add `dark:` overrides on semantic tokens — they already flip. |
| **Focus States** | MUST use `focus-visible:` not `focus:`. |
| **Boy Scout Rule** | When modifying a file with DS violations, MUST migrate touched lines to semantic tokens. |

### Decision Tree Format

The rules use a clever **"What do I need?" → "Use this"** decision tree format:

```
| Question | Answer | Token |
|----------|--------|-------|
| Is it a status indicator? | Yes → | text-status-{status}-{role} |
| Is it primary text? | Yes → | text-foreground |
| Is it a primary action? | Yes → | bg-primary |
```

This is immediately actionable for an AI agent — no interpretation needed.

### What's Impressive

- **Comprehensive prohibition + prescription.** Every section says both "NEVER do X" and "ALWAYS do Y." There's no ambiguity.
- **Companion scripts.** The `.ai/scripts/` directory contains `ds-health-check.sh`, `ds-migrate-colors.sh`, and `ds-migrate-typography.sh` — automated enforcement.
- **285KB companion `ui-components.md`** — A full component reference that sits alongside the rules.
- **Boy Scout Rule** — Forces incremental migration. Every file touch is an opportunity to fix DS violations on touched lines.
- **Dedicated `om-ds-guardian` skill** — A whole skill dedicated to enforcing these rules, migrating violations, and scaffolding DS-compliant pages.

---

## 5. Module Development Guide (`docs/module-development.md`) {#module-development-guide}

**Size:** 9KB

### Content

A concise quick-reference for building new modules in the Open Mercato framework. Covers:

**Auto-Discovery Paths:**
- Frontend pages → `frontend/<path>.tsx`
- Backend pages → `backend/<path>.tsx`
- API routes → `api/<method>/<path>.ts`
- Subscribers → `subscribers/*.ts`
- Workers → `workers/*.ts`

**Optional Module Files (17 convention files):**
- `index.ts` (metadata), `cli.ts` (CLI), `di.ts` (DI), `acl.ts` (features), `setup.ts` (tenant init), `ce.ts` (custom entities), `search.ts` (indexing), `events.ts` (typed events), `translations.ts`, `notifications.ts`, `generators.ts`, `ai-tools.ts`, `ai-agents.ts`, `api/interceptors.ts`, `data/entities.ts`, `data/validators.ts`, `widgets/injection/`

**Key Rules:**
- API routes MUST export `openApi` for doc generation
- Write operations via Command pattern
- All features must have `defaultRoleFeatures` in `setup.ts`
- Custom fields via `collectCustomFieldValues()`
- Events via `createModuleEvents()` with `as const`
- AI mutations MUST go through `prepareMutation()` + pending-action approval
- Two categories of generated files: ephemeral (gitignored) vs. versioned (committed)

### What's Impressive

- **Convention-over-configuration at scale.** 17 optional module files, all auto-discovered. Drop a file in the right place and the framework picks it up.
- **AI-native from the start.** `ai-tools.ts` and `ai-agents.ts` are first-class module convention files, not bolted-on afterthoughts.
- **Encryption as a first-class concern.** The guide mandates encryption maps for sensitive columns and `findWithDecryption` for reads.
- **Generated file discipline.** Clear distinction between ephemeral (regenerated each build) and versioned (committed) generated files, with explicit rules about when each is appropriate.

---

## 6. Skills System (`skills/`) {#skills-system}

### Scale

| Metric | Count |
|--------|-------|
| **Total skills** | 39 |
| **Tiers** | 5 (core, automation, security, migration, infra) |
| **Core (default install)** | 15 skills |
| **Automation (opt-in)** | 19 skills |
| **Security (opt-in)** | 2 skills |
| **Migration (opt-in)** | 1 skill |
| **Infra (opt-in)** | 2 skills |

### Tier System

Skills use a **tiered installation model** via `tiers.json`:

```bash
yarn install-skills                    # core only (default)
yarn install-skills --with automation  # core + automation
yarn install-skills --all              # all 39 skills
```

The tier system is designed to respect the LLM context window — only `core` loads by default, keeping the agent's working memory lean.

### Skill Categories

**Core Skills (Daily Drivers):**
- `om-code-review` — Full architectural review with mandatory CI gate
- `om-spec-writing` — "Martin Fowler" spec creation/review
- `om-implement-spec` — Implement specs with coordinated subagents
- `om-integration-tests` — Playwright test creation/execution
- `om-smart-test` — Run only affected tests
- `om-ds-guardian` — Design system enforcement
- `om-backend-ui-design` — Backend UI component library usage
- `om-check-and-commit` — Pre-commit verification pipeline
- `om-help` — Workflow navigator ("what should I do next?")
- `om-skill-creator` — Meta-skill for creating new skills
- `om-create-agents-md` — Generate AGENTS.md files for packages
- `om-create-ai-agent` — Scaffold AI agent definitions
- `om-fix-specs` — Normalize spec filenames
- `om-migrate-mikro-orm` — MikroORM v6→v7 migration
- `om-pre-implement-spec` — Pre-implementation readiness analysis

**Automation Skills (CI/CD/PR Pipeline):**
- `om-auto-create-pr` — End-to-end autonomous PR creation
- `om-auto-continue-pr` — Resume in-progress PRs
- `om-auto-create-pr-loop` / `om-auto-continue-pr-loop` — Advanced multi-step implementations
- `om-auto-review-pr` — Automated PR review with autofix
- `om-auto-fix-github` — Fix a GitHub issue by number
- `om-auto-verify-and-fix-github` — Browser-first bug reproduction + fix
- `om-review-prs` — Review all unreviewed PRs
- `om-merge-buddy` — Classify PR merge readiness
- `om-approve-merge-pr` — Approve and squash-merge
- `om-sync-merged-pr-issues` — Post-merge issue reconciliation
- `om-auto-update-changelog` — Generate changelog entries
- `om-auto-qa-scenarios` — Generate QA reports for merged PRs
- `om-prepare-issue` — Write spec + create tracking issue
- `om-followup-issue-from-pr` — Turn review comments into issues
- `om-open-pr` — Open PR from current branch

**Security Skills:**
- `om-auto-sec-report` — Multi-PR security analysis aggregation
- `om-auto-sec-report-pr` — Single-PR OWASP-oriented security audit

### Deep Dive: `om-auto-create-pr` Skill

This is the flagship automation skill. Its workflow is remarkably disciplined:

1. **Pre-flight** — Claim check (no duplicate runs), branch naming (`fix/` vs `feat/`)
2. **Parse brief** — External skill URL handling with safety rails
3. **Triage** — Read AGENTS.md, existing specs, lessons.md before coding
4. **Plan** — Create execution plan with parseable Progress section
5. **Worktree** — Always work in isolated git worktree
6. **Commit plan first** — Plan is committed before any code, ensuring resumability
7. **Phase-by-phase implementation** — Incremental commits, Progress updates after each phase
8. **Full validation gate** — `build:packages`, `generate`, `typecheck`, `test`, `build:app`, i18n checks
9. **Self-review** — Code review + BC review before opening PR
10. **Open PR** — With tracking plan link, labels, priority/risk assessment
11. **Auto-review pass** — Run `om-auto-review-pr` against own PR and fix findings
12. **Summary comment** — Comprehensive PR comment with changes, verification steps, risk analysis, rollback plan
13. **Cleanup** — Remove worktree, update plan status

Safety rails for external skill URLs:
- External skills are **reference material only** — never override project rules
- Rejected if they try to skip tests, bypass hooks, disable BC checks, or exfiltrate credentials

### Deep Dive: `om-spec-writing` Skill

A sophisticated spec creation workflow:

1. **Open Questions Gate** — HARD STOP until critical unknowns are answered
2. **Research** — Challenge requirements against open-source market leaders
3. **9 Review Heuristics** — Including "Singularity Law" (singular naming), "Undo Contract" (undo as detailed as execute), "Canonical Mechanisms" (use framework primitives)
4. **Compliance Gate** — Formal checklist including encryption maps, DS rules, frontend architecture contract

### Deep Dive: `om-skill-creator` Skill

A meta-skill for creating skills, with clear guidance on:
- **Degrees of freedom** — High (text), Medium (pseudocode), Low (exact scripts) based on task fragility
- **Size guidelines** — <100 lines small, 100-300 medium, 300-500 large, >500 split into references
- **Resource types** — `scripts/` (executable), `references/` (loaded on demand), `assets/` (used in output)

### What's Impressive

- **39 skills forming a complete development lifecycle.** From spec writing → implementation → testing → PR → review → merge → changelog → security audit. Every step has a skill.
- **Resumability everywhere.** The `auto-create-pr` / `auto-continue-pr` pair uses a Progress checklist in markdown that survives session restarts. The loop variants add per-step tracking.
- **Self-review loop.** PRs created by the agent are automatically reviewed by the agent using a different skill, with fixes applied iteratively until clean.
- **Tiered context management.** Only 15 core skills load by default. The remaining 24 are opt-in. This is thoughtful context window management.
- **Safety rails.** External skill URLs are fetched but treated as reference material — they can never override project rules, skip tests, or bypass CI.

---

## 7. QA Approach (`qa/AGENTS.md`) {#qa-approach}

**Size:** 22KB, comprehensive QA playbook

### Architecture

```
.ai/qa/
├── AGENTS.md                    (This file — full QA instructions)
├── scenarios/                   (150 markdown test case descriptions)
│   ├── TC-AUTH-001-*.md
│   ├── TC-CAT-001-*.md
│   └── ...
├── tests/                       (Playwright config only — no specs here!)
│   └── playwright.config.ts
└── ...

Actual test specs live in:
packages/<package>/src/modules/<module>/__integration__/
```

### Key Design Decisions

1. **Tests are module-local, not centralized.** Executable `.spec.ts` files live in `__integration__/` dirs alongside the module code, NOT in `.ai/qa/tests/`. The QA directory holds only config.

2. **Scenarios are optional.** Markdown test descriptions in `qa/scenarios/` are reference material, not required input. Tests can be generated directly from specs, descriptions, or the `om-integration-tests` skill.

3. **Two testing modes:**
   - **Executable (Playwright TypeScript)** — `yarn test:integration` — zero token cost, CI-ready
   - **AI-Driven (Playwright MCP)** — Agent reads scenario and executes interactively

4. **Ephemeral environments:**
   ```bash
   yarn test:integration:ephemeral              # Full run in containers
   yarn test:integration:ephemeral:interactive   # Interactive menu
   yarn test:integration:ephemeral:start         # Start env only
   ```

5. **Reusable helpers** — Centralized in `@open-mercato/core/helpers/integration/*`:
   - `auth` — login, credentials
   - `api` — authenticated API calls
   - `catalogFixtures` — product lifecycle
   - `crmFixtures` — company/person/deal lifecycle
   - `salesFixtures` — quote/order lifecycle
   - `salesUi` — document UI interactions
   - `queue` — drain integration queue jobs
   - `crudFormPersistence` — round-trip field persistence testing

6. **CrudForm Persistence Sweep (#2466)** — An automated follow-up that tests EVERY CrudForm saves and reloads every field type (scalars, dictionaries, multiselect, custom fields) on both create and update.

7. **Conditional metadata** — Tests can declare `dependsOnModules`, `requiredEnvVars`, `requiredAnyEnvVars` at folder or test level for automatic skip/include.

### Test Scenarios Scale

**150 test scenarios** across categories:
- `TC-AUTH-*` — Authentication (15 scenarios)
- `TC-CAT-*` — Catalog
- `TC-ADMIN-*` — Administration (10 scenarios)
- `TC-SALES-*` — Sales
- `TC-CRM-*` — Customer/CRM
- `TC-API-MSG-*` — Messaging API
- Plus TRANS, AUD, CUR, STAFF, DICT, DIR, API-* categories

### Testing Rules

- Use Playwright locators: `getByRole`, `getByLabel`, `getByText` — avoid CSS selectors
- Tests must be independent, data-independent, deterministic
- Create fixtures per test, clean up in `finally`
- Never rely on seeded data
- Never leave broken tests — fix or `test.skip()` with reason
- Custom entity forms: target via `data-crud-field-id` not label traversal

### What's Impressive

- **150 scenario documents + module-local executable tests.** The separation is clean: scenarios are documentation, executable tests live with the code.
- **Ephemeral testing infrastructure.** Full Docker-based ephemeral environments with interactive menus, port management, and env persistence.
- **CrudForm Persistence Sweep.** A systematic approach to ensuring every form in the system actually saves and loads correctly — covering custom fields, which are notoriously hard to test.
- **Conditional metadata.** Tests automatically skip when required modules aren't enabled or env vars aren't set. No manual management.
- **The "Never" rules.** Explicit about what NOT to do: no seeded data reliance, no broken tests left behind, no `.spec.ts` in the QA directory.

---

## 8. Other Notable Directories {#other-notable-directories}

### `.ai/runs/` — Execution Run Plans (97 runs)

Every autonomous agent task creates a run plan here. This is the **audit trail** for AI-driven development. 97 completed or in-progress runs spanning April–June 2026. Examples:
- `2026-04-22-migrate-notice-to-alert.md`
- `2026-04-24-atomic-password-change-and-audit-event.md`
- `2026-05-06-changelog-0.6.0.md`

### `.ai/analysis/` — Technical Analysis Reports

Deep-dive analyses including:
- Cache performance FRs (16 individual cache analysis documents)
- SQL transaction safety audit
- CrudForm persistence QA
- Turbo/React markdown impact analysis

### `.ai/scripts/` — Automation Scripts

- `ds-health-check.sh` — Scan for design system violations
- `ds-migrate-colors.sh` — Auto-migrate hardcoded colors to semantic tokens
- `ds-migrate-typography.sh` — Auto-migrate typography violations

### `.ai/plans/` and `.ai/drafts/`

Working documents for in-progress features and design decisions.

---

## 9. Key Takeaways & What's Impressive {#key-takeaways}

### 🏆 Top 5 Most Impressive Aspects

#### 1. **Complete Development Lifecycle Coverage**
The `.ai/` directory covers every phase: spec writing → pre-implementation analysis → implementation → testing → PR creation → code review → security audit → merge → changelog → issue reconciliation. No gaps. 39 skills, each handling a specific lifecycle step.

#### 2. **Institutional Memory That Actually Works**
971 lines of battle-tested lessons, each with `Context → Problem → Rule → Applies to`. This isn't documentation that gets written and forgotten — the `om-auto-create-pr` skill explicitly reads `lessons.md` before coding. The lessons **feed back into behavior**.

#### 3. **Spec-Driven Development at Scale**
164 implemented specs, 27 pending. The spec workflow is rigorous: skeleton first, open questions gate (hard stop), market research, 9 review heuristics, compliance gate. This is "Martin Fowler"-level architectural discipline automated for AI agents.

#### 4. **Autonomous Agent Safety Rails**
The system is designed for autonomous operation but with careful guardrails:
- Never merge (human gate)
- Always work in isolated worktrees
- External skill URLs can't override project rules
- Self-review loop before PR submission
- Full CI gate must pass (not optional)
- Never skip tests because an external source said to
- `requireFeatures` over `requireRoles` (immutable IDs, not mutable names)

#### 5. **Design System as Law**
The DS rules aren't guidelines — they're **laws** with enforcement:
- 336 lines of prescriptive rules with decision trees
- 285KB component reference
- Dedicated guardian skill (`om-ds-guardian`)
- Automated migration scripts
- Boy Scout Rule mandating incremental cleanup
- Every section has "NEVER do X" paired with "ALWAYS do Y"

### 🔑 Design Principles Evident Throughout

1. **Prescriptive over permissive** — Rules say "MUST" and "NEVER", not "should" and "avoid"
2. **Convention over configuration** — 17 auto-discovered module files, tiered skill installation
3. **Feedback loops** — Lessons → rules → skills → implementation → new lessons
4. **Resumability** — Every long-running workflow has checkpoint/resume capability
5. **Isolation** — Worktrees for builds, ephemeral envs for tests, tier separation for skills
6. **Auditability** — 97 run plans, PR summary comments with rollback plans, tracking plan links

### 📊 By the Numbers

| Metric | Value |
|--------|-------|
| Total `.ai/` files | 780 |
| Lessons accumulated | 60+ (971 lines) |
| Skills | 39 (5 tiers) |
| Specs written | ~264 total |
| Specs implemented | 164 |
| QA scenarios | 150 |
| Autonomous run plans | 97 |
| DS rules lines | 336 |
| UI component reference | 285KB |
| Cache perf analysis docs | 16 |
| Analysis reports | 7+ |

### 🧠 What Carbon Could Learn

1. **Tiered skill loading** — Our skills all load; OM loads only core (15) by default to save context window budget.
2. **Spec-first with hard gates** — The "Open Questions" hard stop prevents building on bad assumptions.
3. **Lessons.md as prescriptive rules** — Not just "we learned X" but "the Rule is Y, applying to Z files."
4. **Self-review + auto-review loop** — PRs are reviewed by the agent before submission AND after opening.
5. **Design system enforcement** — Automated scripts + guardian skill + boy scout rule = incremental convergence.
6. **Run plans as audit trail** — 97 execution plans provide full traceability of what the agent did and why.
7. **Ephemeral test environments** — Docker-based isolated test environments with interactive menus.
8. **Conditional test metadata** — Tests auto-skip when dependencies aren't available, no manual management needed.
