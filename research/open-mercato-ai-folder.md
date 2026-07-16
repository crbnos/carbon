# Open Mercato `.ai/` Folder — Deep Dive Analysis

**Date:** 2026-06-30
**Source:** https://github.com/open-mercato/open-mercato/tree/main/.ai

---

## 1. `.ai/specs/` — Specification System

### What It Contains
A comprehensive, numbered specification system covering the entire product. As of June 2026, there are **60+ implemented specs** in the OSS edition plus **9+ enterprise specs** in a parallel enterprise directory.

### Structure
```
.ai/specs/
├── README.md                    # Spec index rendered as a table
├── AGENTS.md                    # Agent rules for spec handling
├── implemented/                 # Fully deployed specs (moved via git mv)
│   ├── SPEC-001-2026-01-21-ui-reusable-components.md
│   ├── SPEC-029-2026-02-15-inbox-ops-agent.md
│   ├── SPEC-035-2026-02-22-mutation-guard-mechanism.md
│   ├── SPEC-041a-foundation.md through SPEC-041f-...
│   └── ... (60+ files)
├── enterprise/
│   ├── implemented/             # Deployed enterprise specs
│   │   ├── SPEC-ENT-001 through SPEC-ENT-009
│   │   └── (MFA, SSO/SCIM, record locking, QA preview deployments)
│   ├── 2026-06-04-usage-telemetry-phone-home.md  # Pending
│   ├── Sandboxes.md             # Pending
│   └── CONSIDERATION-password-change-*.md
└── (pending/draft specs in root)
```

### AGENTS.md Rules (Spec Governance)
The spec AGENTS.md defines strict rules for the AI agent:
- **Check both OSS and enterprise dirs** before modifying any module
- **Create** a new spec for: new modules, significant features, architecture changes touching multiple files
- **Update** existing specs when changing: APIs, data models, workflows, permissions, cross-module behavior
- **Skip** specs for: small bug fixes, typo-only edits, isolated one-file refactors
- **Never** introduce new SPEC-* filename prefixes (transitioning to `{date}-{title}.md` format)
- **Never** leave stale endpoints/entities/assumptions in a spec
- **Never** put enterprise-only scope in OSS directory
- Specs organized by status: root = pending/draft, `implemented/` = deployed
- Move to `implemented/` via `git mv` to preserve history

### Spec Format (from actual files)
Each spec follows a rigorous template:
1. **TLDR** — Key points, scope, concerns, decisions table, alternatives considered table
2. **Overview** — Module location, market references (competitors studied, what was adopted/rejected)
3. **Proposed Solution** — Multi-stage pipeline description with detailed architecture
4. **Problem Statement** — Numbered pain points
5. **Goals** — Bullet list of acceptance criteria
6. **Non-Goals** — Explicit scope boundaries
7. **Architecture** — Component locations, runtime behavior, data flow
8. **Data Models** — Entity schemas, relationships
9. **API Contracts** — Endpoint definitions, error propagation
10. **Integration Coverage** — API test coverage plan + UI path coverage
11. **Risks & Impact Review** — Per-risk: scenario, severity, affected area, mitigation, residual risk
12. **Final Compliance Report** — AGENTS.md files reviewed, compliance matrix (rule → status → notes), internal consistency check
13. **Changelog** — Dated entries

### Quality Assessment: ⭐⭐⭐⭐⭐ (Exceptional)
- **SPEC-029 (InboxOps Agent)**: ~9,000+ words. Includes competitor analysis (Front App, Levity AI, Mailchimp), decisions table with rationale, alternatives considered with rejection reasons. Four-stage pipeline (receive → extract → review → execute). Enterprise-grade.
- **SPEC-035 (Mutation Guard)**: Includes evolution section linking to newer SPEC-041m, backward-compat analysis, DI architecture, and a full compliance matrix against multiple AGENTS.md files.
- **SPEC-001 (UI Components)**: Acts as a living component catalog — every primitive, backend component, and input is listed with import paths and key props.

### What Carbon Could Learn
1. **Formal spec lifecycle** — The `root → implemented/` progression with `git mv` is elegant. Carbon specs could adopt this.
2. **Compliance matrix** — Every spec audits itself against project AGENTS.md rules. This is rigorous self-enforcement.
3. **Decisions + Alternatives table** — Every spec documents what was chosen AND what was rejected with reasons. Invaluable for future context.
4. **Market references** — Studying competitors and noting what was adopted/rejected shows architectural maturity.
5. **Spec-referenced skills** — They have an `om-spec-writing` skill that the agent uses when creating specs.
6. **Enterprise/OSS separation by directory** — Clean separation without filename prefixes.

---

## 2. `.ai/plans/` — Implementation Plans

### What It Contains
Detailed, task-by-task implementation plans that bridge the gap between specs and code. Currently contains one file:
- `2026-05-27-crm-email-integration.md`

### Format (from actual file)
The CRM email integration plan is **extremely detailed** — closer to a pair-programming script than a high-level plan:
- **Header**: Goal, architecture summary, tech stack, spec reference, branch instructions, commit convention
- **Phased structure**: Phase 1 → Schema + helper + subscriber (inbound)
- **Per-task breakdown**: Each task specifies exact files to modify/create
- **Per-step instructions**: Each step has:
  - Exact `grep` commands to find insertion points
  - Literal code blocks to insert (with TypeScript)
  - Exact `yarn` commands to verify (typecheck, generate)
  - Exact `git add` staging commands
- **Agentic sub-skill reference**: `Use superpowers:subagent-driven-development or superpowers:executing-plans`
- **Commit convention**: Per user's `feedback_no_auto_commit` memory — `git add` only, user commits manually

### Quality Assessment: ⭐⭐⭐⭐⭐ (Extraordinary)
This is the most detailed AI-driven implementation plan I've seen. It's essentially a deterministic script for an AI agent to follow, with zero ambiguity. Every file, every line, every command.

### What Carbon Could Learn
1. **Plans as agent scripts** — Plans aren't just "what to do" but "how to do it step-by-step with verification commands"
2. **Checkbox-based progress tracking** — `- [ ]` syntax lets an agent track and resume mid-plan
3. **Spec → Plan separation** — Specs define WHAT, plans define HOW. Two distinct artifacts.
4. **Branch/commit conventions in plans** — Prevents agent mistakes with git workflow
5. **Verification at every step** — After each change, a typecheck or test run confirms correctness

---

## 3. `.ai/qa/` — Quality Assurance System

### What It Contains
```
.ai/qa/
├── AGENTS.md              # QA agent rules (very detailed)
├── scenarios/             # 60+ markdown test case descriptions
│   ├── TC-ADMIN-001 through TC-ADMIN-010
│   ├── TC-AUTH-001 through TC-AUTH-015
│   ├── TC-CAT-001 through TC-CAT-007+
│   ├── TC-API-MSG-001 through TC-API-MSG-004
│   └── ... (extensive coverage across modules)
├── tests/
│   ├── playwright.config.ts    # Shared Playwright config
│   └── __no_tests__/           # Tests live in module __integration__ dirs
└── ephemeral-env.json          # Ephemeral environment config
```

### QA AGENTS.md (Comprehensive Testing Governance)
Key rules:
- **Prefer executable Playwright TypeScript tests** in module `__integration__` folders
- **Reuse shared helpers** from `@open-mercato/core/helpers/integration/*`
- Tests must be **independent, data-independent, deterministic, safe across retries**
- **Create fixtures per test** and clean up in finally/teardown
- **Never** rely on seeded/demo data
- **Never** put executable `.spec.ts` files under `.ai/qa/tests` (config only)
- **Never** leave broken tests — fix them or `test.skip()` with reason

### Test Helper Ecosystem
They have a rich shared helper library:
- `auth` — `login()`, `DEFAULT_CREDENTIALS`
- `api` — `getAuthToken()`, `apiRequest()`
- `catalogFixtures` — `createProductFixture()`, `deleteCatalogProductIfExists()`
- `crmFixtures` — `createCompanyFixture()`, etc.
- `salesFixtures` — `createSalesQuoteFixture()`, etc.
- `salesUi` — `createSalesDocument()`, `addCustomLine()`, etc.
- `queue` — `drainIntegrationQueue()`
- `crudFormPersistence` — `runCrudFormRoundTrip()` for automated CrudForm field testing

### Test Execution Modes
1. **Headless CI**: `yarn test:integration` — zero token cost
2. **Ephemeral containers**: `yarn test:integration:ephemeral` — Docker-based, no dev server needed
3. **Interactive ephemeral**: `yarn test:integration:ephemeral:interactive` — menu-driven
4. **AI-driven exploratory**: Agent reads scenarios and executes via Playwright MCP

### Scenario Naming Convention
`TC-{MODULE}-{NUMBER}-{description}.md` — e.g., `TC-AUTH-001-user-login-success.md`

### Quality Assessment: ⭐⭐⭐⭐⭐ (Best-in-class)
The QA system is extraordinarily mature for an AI-augmented project. The combination of:
- Markdown scenario specs (human-readable test intent)
- Executable Playwright tests (CI-ready verification)
- CrudForm round-trip automation (systematic coverage)
- Ephemeral environments (isolated testing)
- Shared fixture helpers (DRY, consistent)

### What Carbon Could Learn
1. **Scenario markdown → executable test pipeline** — Test cases as markdown that can be read by agents OR humans
2. **CrudForm round-trip automation** — Systematic testing of every form's create/read/update/delete cycle
3. **Ephemeral environment management** — `ephemeral-env.json` for tracking running test environments
4. **Fixture lifecycle pattern** — Create in setup, clean in teardown, never depend on seeded data
5. **Module `__integration__/` convention** — Tests live next to their module code, not in a central test folder

---

## 4. `.ai/analysis/` — Technical Analysis Documents

### What It Contains
Deep-dive technical analyses, audits, and investigations:
```
.ai/analysis/
├── 2026-06-08-cache-perf-frs/              # Multi-file analysis (subfolder!)
├── 2026-06-01-sql-transaction-safety-audit.md   # Massive codebase audit
├── 2026-06-02-atomic-writes-endpoint-verification.md
├── 2026-05-02-acme-admin-analytics-view-redirect.md
├── 2026-04-21-turbo-react-markdown-impact.md    # Dependency impact analysis
├── 2055-crudform-persistence-qa.md
└── generated-files-comparison.md                # Build artifact verification
```

### Content Analysis (from actual files)

**SQL Transaction Safety Audit** (`2026-06-01`): A staggering audit covering:
- **Scope**: 185 command files, ~770 API route files, 85 `makeCrudRoute` usages
- **Taxonomy**: PARTIAL-COMMIT, UOW-LOSS, NON-COMMAND-DIRECT-WRITE, MULTI-ENTITY-NON-ATOMIC, TXN-MISUSE, LOOP-WRITE
- **Findings**: ~52 issues — 5 CRITICAL, ~22 HIGH, ~25 MEDIUM
- **Per-module breakdown**: Framework, sales, customers, catalog, auth, directory, staff
- **Hardening applied**: Re-entrancy guard for `withAtomicFlush`, isolation level support
- This is essentially a professional security/reliability audit done by an AI agent

**Turbo & React-Markdown Impact** (`2026-04-21`): Dependency upgrade risk analysis:
- Version comparisons (exact versions)
- Breaking changes identification
- Real repo evidence (file paths, line numbers)
- Performance assessment with concrete risks
- Risk ranking (High → Low)
- Actionable recommendations

**Generated Files Comparison**: Verifies build artifact parity across branches (212 files compared, all matching). This is build system verification.

### Quality Assessment: ⭐⭐⭐⭐⭐ (Professional-grade)
These analyses are at the level of a senior staff engineer's investigation reports. The SQL transaction audit alone would be a multi-day engagement at a consulting firm.

### What Carbon Could Learn
1. **Committed analysis artifacts** — Analyses aren't ephemeral chat outputs; they're committed to the repo as institutional knowledge
2. **Failure-mode taxonomies** — Classifying bugs by pattern (PARTIAL-COMMIT, UOW-LOSS) creates a shared vocabulary
3. **Severity-based triage** — CRITICAL/HIGH/MEDIUM/LOW with per-module breakdowns
4. **Dependency impact analysis pattern** — Version diff → breaking changes → repo evidence → risk ranking → recommendations
5. **Subfolder analyses** — Complex investigations get their own folder (e.g., `2026-06-08-cache-perf-frs/`)

---

## 5. `.ai/reports/` — Automated Health Reports

### What It Contains
Design system health check reports — automated, dated snapshots:
```
.ai/reports/
├── ds-health-baseline-2026-04-11.txt   # Initial baseline
├── ds-health-2026-04-11.txt
├── ds-health-2026-04-12.txt
├── ds-health-2026-05-12.txt
└── ds-health-2026-05-13.txt
```

### Report Format (from actual files)
Each report tracks these metrics with targets:

| Metric | Baseline (Apr 11) | Latest (May 13) | Delta |
|--------|-------------------|-----------------|-------|
| Hardcoded status colors | 959 | 617 | -342 ▼ |
| Arbitrary text sizes | 154 | 38 | -116 ▼ |
| Notice imports (deprecated) | 21 | 1 | -20 ▼ |
| ErrorNotice imports | 8 | 8 | — |
| Inline SVG files | 24 | 30 | +6 ▲ |
| Raw fetch() files | 1 | 1 | — |
| Empty state coverage | 1/150 (0%) | 8/152 (5%) | +7 ▲ |
| Loading state coverage | 89/150 (59%) | 90/152 (59%) | — |
| Semantic token usages | 0 | 515 | +515 ▲ |

### Quality Assessment: ⭐⭐⭐⭐ (Excellent)
Shows clear progress tracking over time. The baseline → current delta tells a story of systematic design system migration.

### What Carbon Could Learn
1. **Automated health metrics committed to repo** — Not just CI checks; historical records of project health
2. **Targets in reports** — Each metric has a target (usually 0), making progress measurable
3. **Baseline comparisons** — Explicit baseline file for tracking delta over time
4. **Sprint-cadence reports** — "Run every sprint" convention baked into the script

---

## 6. `.ai/docs/` — AI-Facing Documentation

### What It Contains
Two key reference documents for AI agents:
```
.ai/docs/
├── ds-v0-usage-guide.md       # Design system usage guide
└── module-development.md      # Module development quick reference
```

### Content Analysis

**Module Development Quick Reference**: Extremely valuable developer guide covering:
- Auto-discovery paths (frontend pages, backend pages, API routes, subscribers, workers)
- Optional module files table (18+ convention files: `index.ts`, `cli.ts`, `di.ts`, `acl.ts`, `setup.ts`, `ce.ts`, `search.ts`, `events.ts`, etc.)
- Module rules (CRUD routes, command pattern, feature naming, custom fields, event system, translations, widget injection)
- Generated files: versioned vs ephemeral distinction (two clear categories with when/where/why)
- AI agent rules: `ai-agents.ts` definitions, `prepareMutation()` approval contract

**Design System v0 Usage Guide**: Complete DS reference with:
- Semantic status token system (`text-status-error-text`, etc.)
- Typography scale (arbitrary → standard Tailwind mappings)
- New components (StatusBadge, FormField, SectionHeader, CollapsibleSection)
- Alert variants migration
- DS Guardian AI skill (slash commands: analyze, migrate, DS health, DS review, scaffold)
- Health check script usage
- Migration scripts (codemod automation)

### Quality Assessment: ⭐⭐⭐⭐⭐ (Excellent)
These are purpose-built AI agent references — not just human docs repurposed. They include exact import paths, code examples, and slash commands.

### What Carbon Could Learn
1. **AI-facing docs vs human docs** — These are written for AI agents to consume during code generation
2. **Module convention catalog** — A single file listing every convention file and its purpose
3. **Generated files governance** — Clear rules for versioned vs ephemeral generated files
4. **DS Guardian concept** — An AI skill that enforces design system rules during development

---

## 7. `.ai/drafts/` — Work-in-Progress Design Documents

### What It Contains
```
.ai/drafts/
└── button-audit-figma-vs-code.md
```

### Content Analysis
A detailed Figma-to-code reconciliation for buttons:
- Extracts the exact Figma design token axes (Type × Style × Size × State)
- Maps every Figma variant to code variant with status indicators
- Documents architectural decisions (Option A vs Option B with rationale)
- Includes exact color tokens, size tokens, and typography specs from Figma
- Records implementation status per phase

### Quality Assessment: ⭐⭐⭐⭐ (Very Good)
Shows how AI agents can bridge the designer-developer gap by extracting Figma specs into actionable code mappings.

### What Carbon Could Learn
1. **Drafts as a staging area** — Work-in-progress docs that may become specs or analysis
2. **Design-to-code bridging** — AI agents can translate Figma specifications into implementation plans
3. **Decision documentation in drafts** — Even drafts record options considered and decisions made

---

## 8. `.ai/runs/` — Agent Execution Tracking

### What It Contains
Execution plans created by automation skills, with a well-documented README:
```
.ai/runs/
├── README.md                  # Explains both layout formats
├── {flat file runs}           # Simple .md files with ## Progress checklists
└── {per-run folders}/         # Complex runs with PLAN.md, HANDOFF.md, NOTIFY.md
    ├── PLAN.md                # Tasks table (Step | Description | Status)
    ├── HANDOFF.md             # Rewritten after every step for resumability
    ├── NOTIFY.md              # Append-only notification log
    ├── step-{N}-checks.md     # Verification logs per step
    └── step-{N}-artifacts/    # Optional artifacts
```

### Two Layout Formats
1. **Flat file** (`{name}.md`): Used by `om-auto-create-pr` / `om-auto-continue-pr` skills. Single markdown with `## Progress` checklist (`- [ ]` / `- [x]` with commit SHAs).
2. **Per-run folder** (`{name}/`): Used by `-loop` variants. Contains PLAN.md with a Tasks table, HANDOFF.md (rewritten after every step for context), NOTIFY.md (append-only), and step verification logs.

### Key Design Points
- Created as the **first commit** on a feature branch
- Updated during implementation (checkboxes flipped, SHAs added)
- Referenced by `om-auto-continue-pr` via `Tracking plan:` line in PR body
- **Remain in the repo after PR merge** as historical record
- Resume by matching unchecked boxes (flat) or first `Status != done` row (folder)

### Quality Assessment: ⭐⭐⭐⭐⭐ (Innovative)
This is a novel approach to AI agent state management. Instead of external state stores, execution state lives in the repo itself, alongside the code. The HANDOFF.md pattern is particularly clever — it's a context document rewritten after every step so a resuming agent has full context.

### What Carbon Could Learn
1. **Repo-as-state-store** — Execution state committed to the repo, not in external DBs
2. **HANDOFF.md pattern** — A constantly-rewritten file that gives a resuming agent full context
3. **Append-only NOTIFY.md** — Notification log that never loses history
4. **Per-step verification logs** — `step-{N}-checks.md` proves each step was validated
5. **Two-tier complexity** — Simple runs use flat files, complex runs use folders. Right tool for the job.
6. **PR body cross-reference** — The PR links back to its tracking plan, creating bidirectional traceability

---

## 9. `.ai/scripts/` — Automation Scripts

### What It Contains
```
.ai/scripts/
├── ds-health-check.sh         # Design system health check
├── ds-migrate-colors.sh       # Codemod: migrate hardcoded colors
└── ds-migrate-typography.sh   # Codemod: migrate arbitrary text sizes
```

### Content Analysis (from `ds-health-check.sh`)
A well-written, portable bash script (works on macOS + Linux):
- Uses `grep -r` instead of `rg` for portability
- Counts hardcoded status colors, arbitrary text sizes, deprecated components
- Tracks empty state and loading state coverage percentages
- Measures semantic token adoption
- Auto-compares with previous report (shows delta)
- Saves to `.ai/reports/ds-health-YYYY-MM-DD.txt`
- ~100 lines, clean `set -euo pipefail`

### Quality Assessment: ⭐⭐⭐⭐ (Very Good)
Practical, portable, well-structured automation. Not over-engineered.

### What Carbon Could Learn
1. **Automated code quality scripts in `.ai/`** — Scripts that agents can run for health checks
2. **Cross-platform portability** — Using `grep` instead of `rg` for broader compatibility
3. **Delta reporting** — Automatic comparison with previous runs
4. **Codemods alongside analysis** — Not just detecting problems but fixing them (`ds-migrate-colors.sh`)

---

## Overall Assessment

### Maturity Level: Production-Grade AI-First Development

Open Mercato's `.ai/` folder represents one of the most mature AI-augmented development setups I've observed. Key characteristics:

1. **Complete development lifecycle coverage**: specs → plans → implementation tracking → QA → analysis → reports
2. **Agent governance via AGENTS.md**: Rules in every directory control AI behavior
3. **Institutional knowledge preservation**: Analyses, decisions, and audit trails committed to the repo
4. **Resumable automation**: The runs/ system enables multi-session agent work
5. **Measurable quality tracking**: Health reports with baselines and deltas
6. **Clear separation of concerns**: Specs (what), plans (how), runs (progress), analysis (investigation), reports (metrics)

### Key Patterns for Carbon to Consider

| Pattern | Description | Priority |
|---------|-------------|----------|
| **Spec lifecycle** | root → implemented/ with git mv, compliance matrix | High |
| **Plans as agent scripts** | Step-by-step with verification commands | High |
| **HANDOFF.md** | Context doc rewritten after every agent step | High |
| **Analysis as artifacts** | Deep-dive investigations committed to repo | Medium |
| **Health reports** | Automated metrics with baseline tracking | Medium |
| **Per-directory AGENTS.md** | Rules scoped to each subdirectory's domain | High |
| **QA scenario → test pipeline** | Markdown scenarios that generate Playwright tests | Medium |
| **DS Guardian skill** | AI-enforced design system compliance | Low (different product) |
| **Decisions + Alternatives tables** | In every spec, document what was NOT chosen | High |
