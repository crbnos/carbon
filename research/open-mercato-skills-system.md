# Open Mercato Skills System — Deep Analysis

**Date:** 2026-06-30
**Source:** https://github.com/open-mercato/open-mercato
**Version analyzed:** v0.6.5

---

## 1. Architecture Overview

Open Mercato uses a **tiered, symlink-based skills installation system** for Claude Code and Codex harnesses. Skills live in `.ai/skills/` (source of truth) and are selectively installed via symlinks into `.claude/skills/` and `.codex/skills/`.

### Directory Structure

```
.ai/
├── skills/
│   ├── README.md              # Full catalog + usage docs
│   ├── tiers.json             # Tier manifest (single source of truth)
│   ├── tiers.schema.json      # JSON Schema for validation
│   └── om-<skill-name>/       # One folder per skill
│       ├── SKILL.md           # Required: YAML frontmatter + instructions
│       ├── scripts/           # Optional: executable code
│       ├── references/        # Optional: loaded on demand
│       └── assets/            # Optional: templates, images
├── ds-rules.md                # Design system rules (referenced by skills)
├── ui-components.md           # Component reference
├── lessons.md                 # Known pitfalls
├── specs/                     # Feature specifications
├── runs/                      # Execution plans for auto-PR workflows
├── qa/                        # Integration test configs
├── reports/                   # Generated reports (DS health, etc.)
└── scripts/                   # DS migration scripts, health checks
```

### Key Design Decisions

1. **Skills are in-repo** — `.ai/skills/` lives alongside the codebase, not in an external registry
2. **Tiered installation** — context-budget-aware; only `core` loads by default
3. **Symlink-based** — `install-skills.sh` creates per-skill symlinks, not copies
4. **Multi-harness** — same skills install into both `.claude/skills/` and `.codex/skills/`
5. **Schema-validated** — `tiers.schema.json` validates `tiers.json` via a separate validator script
6. **YAML frontmatter** — every SKILL.md uses `name` + `description` in frontmatter for trigger matching

---

## 2. Tier System & Complete Skill Catalog

### Tiers (from tiers.json)

| Tier | Default? | Count | Description |
|------|----------|-------|-------------|
| `core` | ✅ yes | 15 | Daily-driver skills installed by default |
| `automation` | opt-in | 19 | PR/issue automation, agent-driven workflows |
| `security` | opt-in | 2 | Security audit skills |
| `migration` | opt-in | 1 | One-shot, version-pinned migrations |
| `infra` | opt-in | 2 | Rare, special-case skills |

**Total: 39 skills across 5 tiers**

### Complete Skill Catalog

#### Core Tier (15 skills — always installed)

| Skill | Purpose | Quality |
|-------|---------|---------|
| `om-code-review` | Full code review against architecture/security/conventions. CI/CD verification gate, backward compat checks, output template | ★★★★★ Exceptional |
| `om-ds-guardian` | Design system enforcement — analyze, plan, migrate, scaffold, review, verify | ★★★★★ Exceptional |
| `om-backend-ui-design` | Backend/backoffice UI patterns using @open-mercato/ui | ★★★★ |
| `om-check-and-commit` | CI-style verification → fix i18n → commit+push | ★★★★ Solid |
| `om-spec-writing` | Write/review architectural specifications ("Martin Fowler" persona) | ★★★★★ Exceptional |
| `om-implement-spec` | Multi-phase spec implementation with subagents, tests, self-review | ★★★★★ Exceptional |
| `om-pre-implement-spec` | Pre-implementation analysis: BC audit, risk, gaps | ★★★★ |
| `om-integration-tests` | Playwright integration test creation and execution | ★★★★ |
| `om-smart-test` | Run only tests affected by changed code (Jest + Playwright) | ★★★★★ Exceptional |
| `om-create-agents-md` | Generate/rewrite AGENTS.md files for packages/modules | ★★★ |
| `om-skill-creator` | Meta-skill: guide for creating new skills | ★★★★★ Exceptional |
| `om-fix-specs` | Fix/update spec file conventions | ★★★ |
| `om-migrate-mikro-orm` | MikroORM migration handling | ★★★ |
| `om-create-ai-agent` | Create new AI agent modules | ★★★ |
| `om-help` | Navigation/knowledge skill — "what do I do now?" | ★★★★ Smart |

#### Automation Tier (19 skills — opt-in)

| Skill | Purpose | Quality |
|-------|---------|---------|
| `om-auto-create-pr` | Autonomous task → execution plan → isolated worktree → PR | ★★★★★ Exceptional |
| `om-auto-continue-pr` | Resume an interrupted auto-create-pr run | ★★★★ |
| `om-auto-create-pr-loop` | Batch loop wrapper for auto-create-pr | ★★★ |
| `om-auto-continue-pr-loop` | Batch loop wrapper for auto-continue-pr | ★★★ |
| `om-auto-review-pr` | Isolated worktree PR review → approve/request-changes + autofix | ★★★★★ Exceptional |
| `om-auto-fix-github` | Auto-fix GitHub issues end-to-end | ★★★★ |
| `om-auto-verify-and-fix-github` | Verify issue + fix in one pass | ★★★★ |
| `om-prepare-issue` | Prepare a GitHub issue for implementation | ★★★ |
| `om-verify-in-repo` | Verify an issue is reproducible in the repo | ★★★ |
| `om-root-cause` | Read-only root-cause analysis for a GitHub issue | ★★★★ Focused |
| `om-fix` | Implement minimal fix from root-cause output + regression tests | ★★★★ Focused |
| `om-open-pr` | Open a PR from a completed fix (the final step) | ★★★ |
| `om-review-prs` | Batch review multiple PRs | ★★★ |
| `om-merge-buddy` | Triage open PRs for merge readiness | ★★★★ Clean |
| `om-approve-merge-pr` | Approve and merge a PR | ★★★ |
| `om-followup-issue-from-pr` | Create follow-up issues from merged PRs | ★★★ |
| `om-sync-merged-pr-issues` | Sync issue state after PR merge | ★★★ |
| `om-auto-update-changelog` | Auto-generate changelog entries | ★★★ |
| `om-auto-qa-scenarios` | Auto-generate QA test scenarios | ★★★ |

#### Security Tier (2 skills)

| Skill | Purpose |
|-------|---------|
| `om-auto-sec-report` | Security audit report generation |
| `om-auto-sec-report-pr` | Security audit as part of PR review |

#### Migration Tier (1 skill)

| Skill | Purpose |
|-------|---------|
| `om-auto-upgrade-0.4.10-to-0.5.0` | One-shot version migration script |

#### Infra Tier (2 skills)

| Skill | Purpose |
|-------|---------|
| `om-dev-container-maintenance` | Dev container setup/maintenance |
| `om-integration-builder` | Integration test infrastructure |

---

## 3. Install System — How It Works

### Entry Point

```bash
yarn install-skills    # runs scripts/install-skills.sh
```

Listed in `package.json` as: `"install-skills": "./scripts/install-skills.sh"`

Also available through Docker: `"docker:install-skills": "node scripts/docker-exec.mjs install-skills"`

### install-skills.sh — Mechanics

The script is a ~300-line POSIX shell script (`#!/bin/sh`, `set -eu`). Key mechanics:

1. **Requires `jq`** — reads `tiers.json` with `jq` for tier/skill extraction
2. **Validates first** — runs `scripts/validate-skills-tiers.sh` before any installation
3. **Reads tiers.json** — extracts tier names, skill lists, and default tiers
4. **Creates symlinks** — for each selected skill, creates `<harness>/skills/<skill-name> -> .ai/skills/<skill-name>`
5. **Dual-harness** — installs into both `.claude/skills/` and `.codex/skills/`
6. **Legacy migration** — detects old directory-level symlinks (`.claude/skills -> ../.ai/skills`) and replaces with per-skill symlinks
7. **Sweep** — removes symlinks for skills no longer in the selected tiers
8. **Idempotent** — safe to re-run; converges to the desired state

### CLI Flags

```bash
yarn install-skills                              # core only (default)
yarn install-skills --with automation            # core + automation (additive)
yarn install-skills --with automation,security   # multiple extras
yarn install-skills --tiers core,security        # explicit set (replaces default)
yarn install-skills --all                        # every tier (39 skills)
yarn install-skills --list                       # print tier table + current state
yarn install-skills --clean                      # remove all symlinks
```

`--with` and `--tiers` are mutually exclusive. `--with` is additive on top of default; `--tiers` replaces the default.

### tiers.schema.json

JSON Schema (draft 2020-12) that validates:
- `default`: array of tier name strings (minItems: 1)
- `tiers`: object with tier names matching `^[a-z][a-z0-9-]*$`
- Each tier has `description` (string) and `skills` (array of strings matching `^[a-z0-9][a-z0-9._-]*$`)

### Context Budget Design

The README explains the rationale: "This keeps loaded skill descriptions inside the harness's per-session context budget while leaving the full catalog one flag away." With 39 skills, loading all descriptions would consume significant context; the tier system ensures only ~15 core skill descriptions are loaded by default.

---

## 4. Skill Quality & Depth Analysis

### Structural Patterns

Every skill follows a consistent structure:

1. **YAML frontmatter** — `name` + `description` only (no extra fields)
2. **Markdown body** — loaded only when skill triggers
3. **Optional `references/`** — detailed checklists, templates, mappings loaded on demand
4. **Optional `scripts/`** — executable automation (bash/python)

### Depth Tiers (by analysis)

#### Tier 1: Comprehensive Skills (8-10K+ bytes, deep workflows)

**om-code-review** (~9K+)
- 8-step workflow with mandatory CI/CD verification gate
- Full output template with severity classification
- 20+ item backward compatibility checklist
- 15+ item general checklist
- References: `references/review-checklist.md` (another 9K+ of detailed checks across 14+ categories)
- Quality: Production-grade. This is the backbone of the entire system.

**om-implement-spec** (~9K+)
- Extension mode decision gate (external extension vs core modification)
- 6-step per-phase workflow (plan → implement → unit tests → integration tests → docs → self-review)
- Inline rules table covering 15+ areas (types, APIs, encryption, cache, transactions, etc.)
- Cross-references 8+ other skill/reference files
- Uses subagents for parallelization

**om-ds-guardian** (~9K+)
- 6 capabilities: Analyze, Plan, Migrate, Scaffold, Review, Verify
- Includes inline bash scripts for violation scanning
- Three migration modes: script-based bulk, surgical per-file, raw HTML → DS primitive
- References: `references/token-mapping.md` for find→replace operations
- Also references `.ai/scripts/ds-health-check.sh`, `.ai/scripts/ds-migrate-colors.sh`, `.ai/scripts/ds-migrate-typography.sh`

**om-auto-create-pr** (~9K+)
- 10-step autonomous workflow: parse → triage → plan → worktree → commit plan → implement → validate → review → PR → cleanup
- Concurrency claim system (mutex via GitHub labels + comments)
- Git worktree isolation with trap-based cleanup
- External skill URL support with safety rails
- Progress tracking format for resumability

**om-auto-review-pr** (~9K+)
- 11-step workflow with concurrency locking
- Fork-aware PR checkout
- Review vs re-review detection
- Early-exit for conflicts and CI failures
- Duplicate/already-merged detection
- Autofix loop capability
- Pipeline label management

**om-smart-test** (~9K+)
- Cache system (`.test-cache.json`) for avoiding re-analysis
- Two test type strategies: Jest (import graph) + Playwright (module matching)
- 4-layer classification: ui, ui-component, api-logic, data, mixed
- Base ref resolution logic (develop vs main awareness)
- Python integration script for Playwright mapping

**om-spec-writing** (~8K)
- "Martin Fowler" architectural persona
- 10-step workflow with skeleton-first approach and Open Questions gate
- 9 review heuristics covering architectural concerns
- References: `references/spec-checklist.md`, `references/compliance-review.md`, `references/spec-template.md`, `references/frontend-architecture-contract.md`

**om-skill-creator** (~9K+)
- Meta-skill for creating other skills
- Core principles: conciseness, degrees of freedom, progressive disclosure
- Three-level loading system explanation
- Detailed anatomy of skill structure
- Anti-patterns (what NOT to include)

#### Tier 2: Focused Skills (3-7K bytes, clear scope)

**om-check-and-commit** (~3K)
- Clean, focused: scope → verify → fix i18n → commit
- 8-step verification gate (same as code-review)
- I18n repair rules
- Output format defined

**om-help** (~5K)
- Two modes: Navigation ("what now?") and Knowledge ("how do I do X?")
- Signal → workflow sequence mapping table
- Task Router integration for knowledge mode
- References: `references/skills-catalog.md`, `references/workflow-sequences.md`

**om-fix** (~6K)
- Step 3 of autofix pipeline (after root-cause)
- Issue claiming with GitHub labels
- Reads analyzer's brief from prompt
- Mandatory regression tests
- Validation loop + self-review
- Structured output contract (Status: ready/blocked)

**om-root-cause** (~4K)
- Step 2 of autofix pipeline
- Read-only analysis (no edits allowed)
- Structured output contract (~400 words)
- LOW_CONFIDENCE fallback path

**om-merge-buddy** (~3K)
- Single-purpose: triage PRs for merge readiness
- Gate evaluation (review, CI, conflicts, labels)
- Three classifications: ready, almost-ready, blocked
- Clean markdown report format

### Workflow Chains

Skills are designed to compose into **workflows**:

```
Spec Lifecycle:
  om-spec-writing → om-pre-implement-spec → om-implement-spec → om-code-review → om-check-and-commit

Autofix Pipeline:
  om-verify-in-repo → om-root-cause → om-fix → om-open-pr

Autonomous PR:
  om-auto-create-pr → (interrupted?) → om-auto-continue-pr

PR Lifecycle:
  om-auto-review-pr → (autofix?) → om-approve-merge-pr → om-sync-merged-pr-issues → om-followup-issue-from-pr

Navigation:
  om-help → (any skill above)
```

### Concurrency & Safety

Multiple skills implement a **mutex/claim system** for concurrent agent safety:
- GitHub issue/PR labels (`in-progress`)
- GitHub assignees
- Claim comments with timestamps (`🤖 autofix started by @user at <timestamp>`)
- Stale lock recovery (60min timeout)
- `--force` flag for manual override
- Lock release in finally/cleanup blocks

---

## 5. Supporting Infrastructure

### .ai/ds-rules.md — Design System Rules (~9K+)

Comprehensive design system specification covering:
- **Colors** — semantic token decision tree, status token structure, brand color system
- **Corner Radius** — 6 tiers from `rounded-sm` to `rounded-full`
- **Typography** — strict scale (never arbitrary sizes), `text-overline` custom token for 11px
- **Feedback** — Alert (not Notice), flash(), confirm dialog patterns
- **Spacing** — 4px grid scale with decision table
- **Opacity** — standard scale with use-case mapping
- **Z-Index** — semantic layering tokens (`z-sticky`, `z-dropdown`, `z-overlay`, `z-modal`, `z-toast`, `z-fullscreen`)

### .ai/design-system-audit-2026-04-10.md

A full audit document (9K+) covering:
- 160 backend pages across 34 modules
- Screen architecture analysis (70% don't use DataTable, 79% no empty state, 41% no loading state)
- Navigation/IA review
- Typography audit (61 arbitrary text sizes found)
- **372 hardcoded semantic colors** identified and catalogued
- Color usage heat map by pattern

### .ai/scripts/ (referenced by ds-guardian)

- `ds-health-check.sh` — generates DS health reports
- `ds-migrate-colors.sh` — bulk color migration per module
- `ds-migrate-typography.sh` — bulk typography migration per module

### references/ Subdirectories (per skill)

Key reference files discovered:
- `om-code-review/references/review-checklist.md` — 14+ category checklist (~9K+)
- `om-spec-writing/references/spec-template.md` — full spec template with risk register (~7K)
- `om-spec-writing/references/spec-checklist.md` — spec review checklist
- `om-spec-writing/references/compliance-review.md` — final compliance review template
- `om-spec-writing/references/frontend-architecture-contract.md` — frontend arch contract
- `om-ds-guardian/references/token-mapping.md` — exact find→replace for DS migration
- `om-help/references/workflow-sequences.md` — named workflows with skill ordering
- `om-help/references/skills-catalog.md` — skill catalog with triggers
- `om-smart-test/references/test-architecture.md` — module extraction patterns

---

## 6. What Carbon Could Adopt

### High-Impact Ideas

#### 1. Tiered Skill Installation
**What they do:** `tiers.json` + `install-skills.sh` creates per-skill symlinks. Only core (15 skills) loads by default; automation (19 skills) is opt-in.
**Why it matters:** Context budget management. 39 skill descriptions would overwhelm the context window.
**Carbon adaptation:** We have ~40 skills. A tier system would let us keep core skills (conductor, feature, test, self-review) always loaded while making specialized ones (pr-splitter, diagram-maker, meme-maker) opt-in.

#### 2. Skill Composition Chains
**What they do:** Skills explicitly declare their position in workflows (e.g., `om-root-cause` → `om-fix` → `om-open-pr`). Each skill has a structured output contract that the next skill parses.
**Why it matters:** Enables multi-agent pipelines with clear handoff points. Our conductor already does this implicitly, but OM makes it explicit.
**Carbon adaptation:** Define explicit input/output contracts for our inner-loop skills (doer/judge/behavior) so they chain cleanly.

#### 3. Concurrency Claim System
**What they do:** GitHub labels + assignees + timestamped comments as a distributed mutex. Stale lock recovery at 60 minutes. `--force` override.
**Why it matters:** Prevents multiple agents from clobbering the same issue/PR.
**Carbon adaptation:** Our SQLite semaphore does this at the build level, but we could adopt per-issue claiming for the grooming/feedback loops.

#### 4. Progressive Disclosure via references/
**What they do:** SKILL.md stays lean (<500 lines recommended). Heavy reference material (checklists, templates, mappings) lives in `references/` and loads on demand.
**Why it matters:** Keeps trigger-time context cost low while providing depth when needed.
**Carbon adaptation:** Our skills don't use references/ at all. The conductor skill is already large; splitting its checklists and templates into references/ would reduce its context footprint.

#### 5. DS Guardian Pattern
**What they do:** A dedicated skill for design system enforcement with 6 capabilities (analyze → plan → migrate → scaffold → review → verify), bash scripts for scanning, and a token mapping reference.
**Why it matters:** Systematic approach to UI consistency across 160+ pages.
**Carbon adaptation:** We have make-interfaces-feel-better and ui skills but nothing as systematic. A guardian-pattern skill that scans for violations and has migration scripts would be valuable for any project with a design system.

#### 6. Self-Review as Mandatory Gate
**What they do:** Every implementation skill includes a self-review step against the code-review checklist BEFORE marking work complete.
**Why it matters:** Catches issues before they reach the PR review stage, reducing iteration cycles.
**Carbon adaptation:** Our self-review skill exists but isn't mandated by the conductor. Making it a required gate in the inner loop would improve first-pass quality.

#### 7. om-help Navigator Pattern
**What they do:** A meta-skill that reads current git state, maps it to workflow sequences, and recommends the next skill to use.
**Why it matters:** Reduces confusion for both humans and agents about "what to do next."
**Carbon adaptation:** We don't have an equivalent. A navigator skill that reads agent state (SQLite, git, GitHub) and recommends the next action would be valuable for the outer loop.

#### 8. Execution Plans with Progress Tracking
**What they do:** `om-auto-create-pr` saves execution plans to `.ai/runs/` with a Progress section using `- [ ]`/`- [x]` + commit SHA. The companion `om-auto-continue-pr` can resume from any checkpoint.
**Why it matters:** Crash-resilient autonomous workflows. The progress file is committed to the branch, so state survives across sessions.
**Carbon adaptation:** Our conductor tracks state in the spec file, but the explicit `.ai/runs/` pattern with parseable progress sections is cleaner for crash recovery.

### Medium-Impact Ideas

#### 9. Git Worktree Isolation
Every automation skill creates an isolated worktree (`git worktree add`) with trap-based cleanup. Prevents mutations to the developer's working directory.

#### 10. Schema Validation for Skill Manifests
`tiers.schema.json` + `validate-skills-tiers.sh` ensures the manifest is well-formed before installation. Catches typos and structural errors.

#### 11. YAML Frontmatter Standard
Every SKILL.md uses `name` + `description` in YAML frontmatter. The description doubles as trigger matching text, so skills include trigger keywords in it.

#### 12. CI Gate Mirroring
The `om-code-review` and `om-check-and-commit` skills run the EXACT same steps as `.github/workflows/ci.yml`. No "it works on my machine" gap.

---

## 7. Quality Assessment Summary

### Strengths

1. **Exceptional depth** — Top skills are 9K+ bytes with detailed workflows, decision trees, and edge case handling
2. **Consistent structure** — Every skill follows the same pattern (frontmatter, workflow, output format)
3. **Cross-referencing** — Skills reference each other, AGENTS.md files, specs, and lessons
4. **Safety-first** — Concurrency locks, worktree isolation, validation gates, self-review
5. **Progressive disclosure** — Heavy reference material offloaded to `references/`
6. **Composability** — Skills chain via structured output contracts
7. **Context-aware** — Tier system manages context budget
8. **Well-documented** — README serves as both catalog and usage guide

### Weaknesses

1. **OM-specific** — Skills are deeply coupled to Open Mercato's architecture (MikroORM, module structure, encryption patterns). Not portable as-is.
2. **Shell-heavy** — The install script is POSIX sh; no TypeScript/Node equivalent. Some teams might find this less maintainable.
3. **No versioning** — Individual skills don't have version numbers. The tier manifest doesn't track when skills were added/modified.
4. **No dependency graph** — Skills reference each other by name but there's no formal dependency declaration (e.g., "om-fix requires om-root-cause to have run first").
5. **No test coverage for skills** — No automated tests that verify skills work correctly or that their referenced files exist.

### Scale

- **39 skills** across 5 tiers
- **~150K+ bytes** of skill content (SKILL.md files alone)
- **~50K+ bytes** of reference material in `references/` directories
- **~20K+ bytes** of supporting docs (ds-rules.md, audit, etc.)
- **~10K+ bytes** of bash scripts for DS migration and health checks

This is one of the most comprehensive in-repo AI skill systems in any open-source project.
