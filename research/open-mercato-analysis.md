# Open Mercato `.ai/` Analysis — What They Do Well & What Carbon Can Adopt

_Research date: 2026-06-30_
_Repo: https://github.com/open-mercato/open-mercato_

---

## 1. Executive Summary

Open Mercato has built one of the most comprehensive AI-agent-friendly codebases I've seen. Their `.ai/` folder is a centralized knowledge hub with **780 files** spanning specs, skills, QA scenarios, lessons learned, design system rules, run logs, analysis reports, and scripts. It's organized, versioned, and designed so any agent session (Claude Code or Codex) can bootstrap with full project context.

Carbon has strong foundations — our `.claude/rules/` with `paths:` auto-scoping (55 rule files) and our conductor/harness/checks inner loop are arguably more sophisticated for autonomous builds. But our agent knowledge is **scattered** across `.claude/`, `llm/`, workspace files, and GitHub issues. Open Mercato's advantage isn't that they're smarter — it's that they're **organized**.

---

## 2. Key Metrics Comparison

| Dimension | Open Mercato | Carbon |
|-----------|-------------|--------|
| Centralized AI folder | `.ai/` (780 files) | None — scattered across `.claude/`, `llm/`, workspace |
| Skills | 40 (tiered: core/automation/security/migration/infra) | 29 (flat, all loaded every session) |
| Rules files | Embedded in AGENTS.md hierarchy | 55 auto-scoped `.claude/rules/*.md` files |
| Specs (versioned in repo) | 317 markdown specs (implemented/ + pending) | 0 in repo (GitHub issues only) |
| QA scenarios | 150 markdown test cases | 0 formalized |
| Lessons learned | 971 lines in `.ai/lessons.md` | Scattered in MEMORY.md (operator-level only) |
| Design system rules | Decision-tree format (`ds-rules.md` + `ui-components.md`) | Prose-based `conventions-ui.md` |
| Run logs | 198 files in `.ai/runs/` | gitignored `llm/loops/runs/` |
| AGENTS.md files | 30 (root + per-package + per-module) | 1 (root only) |
| Task Router | Explicit table mapping task → guide files | Implicit via `paths:` auto-scoping |
| Multi-agent support | Claude Code + Codex (shared skill install) | Claude Code only |

---

## 3. What They Do Better — Detailed Findings

### 3.1 Centralized `.ai/` Knowledge Hub

**Their approach:** Everything agent-relevant lives under `.ai/` — specs, skills, lessons, plans, QA, analysis, reports, scripts, design system rules. Single discovery path. Version-controlled alongside code.

**Our gap:** Agent knowledge is fragmented:
- `.claude/rules/` — auto-scoped rules
- `.claude/skills/` — task-specific procedures
- `llm/outer-loop/` — outer-loop design docs
- `llm/loops/runs/` — runtime artifacts (gitignored)
- `AGENTS.md` — root conventions
- Workspace `MEMORY.md` — operator-level lessons (not in repo)
- GitHub issues — specs and requirements

**Impact:** A fresh Claude Code session in Carbon has no way to discover lessons, specs, or analysis without being told where to look. In Open Mercato, any agent reads `.ai/` and finds everything.

### 3.2 Spec-First Development (317 Versioned Specs)

**Their approach:** Numbered, dated specs in `.ai/specs/` with `implemented/` and `enterprise/` subfolders. Each spec has: TLDR, Overview, Problem Statement, Proposed Solution, Architecture, Data Models, API Contracts, Risks, Compliance Report, Changelog. Specs travel with the code.

**Our gap:** We use GitHub issues as specs. They work, but:
- Not version-controlled alongside code
- Not discoverable by agents reading the filesystem
- No changelog tracking implementation drift
- Can't be referenced by path in other docs

### 3.3 Committed Lessons Learned (971 lines)

**Their approach:** `.ai/lessons.md` — a growing list of architectural foot-guns, ORM gotchas, flush ordering, identity-map traps, migration pitfalls. Every agent session reads it on start. Self-improving: after corrections, agents update the file.

**Our gap:** Our lessons live in `MEMORY.md` (operator-level, not in repo) and scattered in `AGENTS.md`. A fresh Claude Code session in Carbon doesn't know about binding format bugs, permission scope mismatches, or orphaned subprocess traps unless we tell it.

### 3.4 Tiered Skill System

**Their approach:** `tiers.json` defines 5 tiers (core: 15 skills, automation: 17, security: 2, migration: 1, infra: 2). `yarn install-skills` creates per-skill symlinks. Default installs only core. Keeps context budgets tight.

**Our gap:** All 29 skills load every session. No tiering, no install script, no context budget management. As we add more skills, every session pays the context tax for skills it doesn't need.

### 3.5 Design System as Decision Trees

**Their approach:** `ds-rules.md` has literal "what color do I need?" decision trees with token lookups. Tables map questions → answers → tokens. Agents can parse these mechanically.

**Our gap:** Our `conventions-ui.md` exists but is prose-based. Agents have to interpret paragraphs instead of following tables.

### 3.6 QA Folder with Scenarios and Test Plans (150 scenarios)

**Their approach:** `.ai/qa/scenarios/` with 150+ numbered, categorized test cases (TC-AUTH-001 through TC-UNDO-001). Each has: Test ID, Category, Priority, Type, Prerequisites, Steps, Expected Results, Edge Cases. Own `AGENTS.md`. Integration with Playwright.

**Our gap:** No formalized QA scenarios in the repo. The behavior gate demands proof, but there's no library of scenarios to reference.

### 3.7 Task Router Table

**Their approach:** Explicit table in root `AGENTS.md` mapping 40+ task types to exact guide files. "Adding search? → read these 3 guides." Agents know what they don't know.

**Our gap:** Our `paths:` auto-scoping is smarter (rules auto-load based on file paths being edited), but it's invisible — agents don't know which rules will fire or which guides exist for a given task type.

### 3.8 Hierarchical AGENTS.md (30 files)

**Their approach:** Root `AGENTS.md` + per-package + per-module AGENTS.md files. Each has `Always`, `Ask First`, `Never`, `Validation Commands` sections. Distributed authority — each module owns its own rules.

**Our gap:** Single root `AGENTS.md`. All conventions in one place. As Carbon grows, this will become unwieldy.

### 3.9 Run Logs (Committed)

**Their approach:** `.ai/runs/` contains 198 files — PLAN.md, HANDOFF.md, NOTIFY.md, checkpoint checks, artifacts, gate results. Committed to the repo. Full audit trail of what the agent did, what it verified, what it handed off.

**Our gap:** Our `llm/loops/runs/` is gitignored. Run history doesn't persist across clones. No audit trail in the repo.

---

## 4. What We Do Better

### 4.1 Auto-Scoped Rules (`.claude/rules/` with `paths:` frontmatter)
55 rule files that auto-load based on which files are being edited. More sophisticated than their flat AGENTS.md approach — rules fire contextually without the agent needing to know they exist.

### 4.2 Conductor Inner Loop
The conductor skill, harness, and checks system is more mature for autonomous builds. Deterministic dispatch, ledger tracking, judge/doer/behavior separation, clobber detection.

### 4.3 Outer-Loop Orchestration
Heartbeat → reconcile → PR feedback → build → groom cycle. More advanced than their automation tier, which is skill-based rather than loop-based.

### 4.4 Checks Package
`packages/checks/` for conformance, clobber detection, invariants. Built into the build pipeline, not bolted on.

---

## 5. Implementation Plan — Making Carbon More LLM-Friendly

### Phase 1: Foundation (Day 1-2) — Immediate Value

#### 1a. Create `.ai/lessons.md` in Carbon repo
- Extract lessons from `MEMORY.md`, `AGENTS.md`, and daily notes
- Include: binding format rules, permission scope gotchas, ORM patterns, migration pitfalls, orphaned subprocess traps, Docker group membership quirks
- Auto-load rule: agents read this on session start
- **Effort:** 30 minutes
- **Value:** Every agent session immediately smarter

#### 1b. Add Task Router to root `AGENTS.md`
- Map task types to guide files (rules, skills, packages)
- Include: "Adding a new module?", "Fixing a bug?", "Working on UI?", "Database migration?", etc.
- **Effort:** 1 hour
- **Value:** Agents know what to read before they start

#### 1c. Create `.ai/specs/` and move next feature design there
- Don't replace GitHub issues — augment them
- Link spec path from issue, link issue from spec
- Use date-slug naming: `YYYY-MM-DD-feature-name.md`
- **Effort:** 30 minutes for structure, ongoing for content

### Phase 2: Organization (Week 1) — Structural Improvements

#### 2a. Create `.ai/` directory structure
```
.ai/
├── lessons.md              # Architectural foot-guns and patterns
├── specs/                  # Feature specifications
│   ├── implemented/        # Completed specs
│   └── README.md           # Spec conventions
├── qa/                     # QA scenarios and test plans
│   ├── scenarios/          # TC-XXX-NNN test cases
│   └── AGENTS.md           # QA conventions
├── analysis/               # Research and audits
├── runs/                   # Build run logs (committed)
├── docs/                   # Agent-readable guides
│   └── module-development.md
├── ds-rules.md             # Design system decision trees
└── skills/                 # Source of truth for skills
    ├── tiers.json          # Tier manifest
    └── <skill>/SKILL.md    # Individual skills
```

#### 2b. Rewrite UI conventions as decision trees
- Convert `conventions-ui.md` from prose to scannable tables
- Status colors, radius, typography, component selection
- Follow Open Mercato's `ds-rules.md` pattern

#### 2c. Add per-package AGENTS.md files
- Start with the busiest packages: `packages/react`, `packages/database`, `packages/form`
- Use `Always` / `Ask First` / `Never` / `Validation Commands` structure
- **Don't boil the ocean** — add as we touch packages

### Phase 3: Skill Tiering (Week 2) — Context Budget Management

#### 3a. Create `tiers.json` manifest
```json
{
  "default": ["core"],
  "tiers": {
    "core": { "skills": ["conductor", "execute", "feature", "self-review", ...] },
    "automation": { "skills": ["finishing-a-development-branch", "pr-explainer", ...] },
    "debugging": { "skills": ["systematic-debugging", "debugging-difficult-bugs", ...] },
    "testing": { "skills": ["test", "test-driven-development", "smoke-test"] }
  }
}
```

#### 3b. Build install script
- `pnpm run install-skills` — creates per-skill symlinks
- Default: core only
- `--with automation,debugging` for opt-in tiers
- Keeps Claude Code's expected `.claude/skills/` structure

### Phase 4: QA Library (Week 2-3) — Test Scenario Coverage

#### 4a. Create initial QA scenarios for critical flows
- Auth flows (login, logout, password reset)
- Core CRUD operations
- Permission checks
- Manufacturing-specific workflows

#### 4b. Link scenarios to behavior gate
- The behavior gate already demands proof — give it a library to reference
- Each scenario: Test ID, Category, Priority, Steps, Expected Results

### Phase 5: Spec-First Workflow (Ongoing) — Cultural Shift

#### 5a. Spec template
- TLDR, Problem, Solution, Architecture, Data Models, API Contracts, Risks, Changelog
- Store in `.ai/specs/YYYY-MM-DD-feature-name.md`
- Link from GitHub issue

#### 5b. Implemented spec tracking
- Move completed specs to `.ai/specs/implemented/`
- Update changelog in spec after implementation

---

## 6. What NOT to Adopt

- **Multi-agent harness (Claude + Codex)**: Not needed yet. We're Claude-only and it works.
- **Detailed PR label workflows**: Their 15+ label taxonomy is over-engineered for our team size. Our current labels are sufficient.
- **`yarn install-skills` complexity**: Their script handles symlinks, legacy migration, clean mode. We can start simpler.
- **780-file `.ai/` folder**: Aspirational, not a target. We need the structure, not the volume.

---

## 7. Priority Order

| # | Action | Effort | Impact | Do When |
|---|--------|--------|--------|---------|
| 1 | `.ai/lessons.md` | 30 min | High | Today |
| 2 | Task Router in AGENTS.md | 1 hour | High | Today |
| 3 | `.ai/specs/` folder + first spec | 30 min | Medium | Today |
| 4 | `.ai/` directory structure | 2 hours | High | This week |
| 5 | DS rules as decision trees | 2 hours | Medium | This week |
| 6 | Per-package AGENTS.md (top 3) | 3 hours | Medium | This week |
| 7 | Skill tiering + tiers.json | 4 hours | Medium | Week 2 |
| 8 | QA scenario library (10 critical) | 4 hours | Medium | Week 2-3 |
| 9 | Run logs committed to repo | 1 hour | Low | When convenient |
| 10 | Spec-first workflow adoption | Ongoing | High | Ongoing |

---

## 8. Key Takeaways

1. **Organization > Sophistication.** Our rules auto-scoping is smarter than their flat files, but their centralized discovery is more effective. Both matter.

2. **Lessons must live in the repo.** `MEMORY.md` on the operator box is invisible to Claude Code sessions. `.ai/lessons.md` in the repo is universal.

3. **Specs should travel with code.** GitHub issues are great for tracking, but specs-as-markdown enable agent discovery, version control, and cross-referencing.

4. **Skill tiering is context hygiene.** As skill count grows, loading everything wastes tokens. Tiered installation is inevitable — better to design it now.

5. **Decision trees > prose.** Agents parse tables better than paragraphs. Rewrite conventions as lookup tables wherever possible.
