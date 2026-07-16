# Carbon LLM-First Overhaul — Comprehensive Plan

> Date: 2026-06-30
> Author: Stanley (Carbon Agent)
> Based on: Deep analysis of Open Mercato's `.ai/` architecture + Carbon's current state
> Audience: Brad

---

## Executive Summary

Carbon today has solid foundations — a working agent loop, Claude Code integration, `.claude/rules/` for auto-loading context, and a skill system via the conductor. But compared to Open Mercato's approach, we're bringing a pocket knife to a sword fight.

Open Mercato has 35 AGENTS.md files, 39 purpose-built skills, 264 design specs, 60+ battle-tested lessons, and a complete spec-to-PR automation pipeline — all inside a `.ai/` directory that functions as an operating system for AI-assisted development. Carbon has 2 AGENTS.md files, 29 skills (mostly generic Claude Code defaults), 54 rules files (auto-loaded but flat), and no spec system.

**This plan proposes a phased overhaul to make Carbon LLM-first by design**, adapting Open Mercato's best patterns to Carbon's architecture and constraints. The goal: any AI agent — Stanley, Claude Code, or a future system — can navigate, understand, modify, and safely extend Carbon without human hand-holding.

---

## The Gap

| Dimension | Open Mercato | Carbon Today |
|-----------|-------------|--------------|
| AGENTS.md files | 35 (root + package + module) | 2 (root + .deepsec) |
| Task Router | Yes — maps any task to 1-3 guides | No — flat rule files |
| `.ai/` or equivalent | 780 files, structured knowledge base | `.claude/rules/` (54 files, flat) |
| Design specs | 264 (164 implemented) | None formalized |
| Lessons / institutional memory | 94KB, 60+ prescriptive lessons | Daily notes (raw logs) |
| Skills | 39 domain-specific, tiered | 29 mostly generic Claude Code |
| Backward compat contract | 500+ lines, 14 categories | Not formalized |
| AI-specific CI checks | 7+ custom checks | Standard lint/test |
| Convention-over-config | 17 auto-discovered module files | Manual registration |
| Module-level AGENTS.md | 12 modules have their own | None |
| Self-review pipeline | Multi-stage auto-review | Single conductor pass |
| Design system enforcement | Dedicated skill + scripts + CI | UI conventions in rules |

---

## Principles for Carbon's Overhaul

Not everything Open Mercato does makes sense for Carbon. They're a different product, different stage, different team size. Here's how I'd filter:

1. **Steal the architecture, not the volume.** We don't need 780 files in `.ai/`. We need the *patterns* — Task Router, hierarchical AGENTS.md, spec lifecycle, lessons format.

2. **Start with what helps Stanley.** I'm the primary AI consumer of Carbon's codebase. Every improvement should make my conductor loop faster, safer, and more autonomous.

3. **Don't break what works.** The `.claude/rules/` auto-loading system is good. The conductor skill is good. Build on them, don't replace them.

4. **Progressive rollout.** This is a big change. Phase it so each phase delivers value independently.

5. **Carbon's domain is the constraint.** Manufacturing ERP is harder than CRM. More modules, deeper domain knowledge, stricter data integrity requirements. The system must account for this.

---

## Phase 1: The Foundation (Week 1-2)

### 1.1 Create `.ai/` Directory Structure

```
carbon/.ai/
├── specs/                    # Design specifications
│   ├── AGENTS.md             # Spec lifecycle rules
│   └── implemented/          # Completed specs
├── skills/                   # Carbon-specific skills
│   └── tiers.json            # Tier definitions
├── lessons.md                # Prescriptive lessons learned
├── docs/                     # Module development guides
│   └── module-conventions.md # How Carbon modules are structured
├── runs/                     # Execution run plans (audit trail)
├── qa/                       # Test scenarios and infrastructure
│   └── AGENTS.md             # QA approach
└── scripts/                  # Automation scripts
```

Keep `.claude/rules/` as-is — they serve a different purpose (auto-loading context for Claude Code). The `.ai/` directory is for structured knowledge that skills and agents reference explicitly.

### 1.2 Upgrade Root AGENTS.md with Task Router

Transform the current flat AGENTS.md into a hierarchical system with a Task Router table. The root should be a **dispatcher**, not a textbook.

```markdown
## Task Router — Where to Find Detailed Guidance

| Task | Guide |
|------|-------|
| Adding a database migration | `.claude/rules/workflow-database-migration.md` |
| Working on forms (CrudForm patterns) | `.claude/rules/conventions-forms.md` + `packages/form/AGENTS.md` |
| Adding an edge function | `.claude/rules/workflow-edge-function.md` |
| Working on the event system | `.claude/rules/event-system.md` + `packages/jobs/AGENTS.md` |
| Adding/modifying purchasing module | `.claude/rules/method-material-sourcing.md` + module AGENTS.md |
| Working on MES job operations | `.claude/rules/mes-job-operation-ui.md` |
| Working on inventory | `.claude/rules/inventory-system.md` |
| Working on the scheduling system | `.claude/rules/scheduling-data-structures.md` |
| Adding a new module | `.ai/docs/module-conventions.md` |
| Working on authentication | `.claude/rules/authentication-system.md` + `packages/auth/AGENTS.md` |
| UI component work | `.claude/rules/conventions-ui.md` |
| Database patterns | `.claude/rules/database-patterns.md` + `.claude/rules/conventions-database.md` |
| PDF generation | `.claude/rules/pdf-generation-patterns.md` |
| Traceability / lot tracking | `.claude/rules/traceability-model.md` |
| CSV import/export | `.claude/rules/csv-import-system.md` + `.claude/rules/table-csv-export.md` |
| Billing/Stripe | `.claude/rules/billing-system.md` + `packages/stripe/AGENTS.md` |
| Deployment (SST) | `.claude/rules/sst-deployment-infrastructure.md` |
| Notifications | `packages/notifications/AGENTS.md` |
| i18n / translations | `.claude/rules/i18n-lingui-system.md` + `packages/locale/AGENTS.md` |
```

### 1.3 Add Always / Ask First / Never Template

Every AGENTS.md and every `.claude/rules/` file should open with behavioral boundaries:

```markdown
## Always
- Check the Task Router before research or coding
- Follow `.claude/rules/conventions-*.md` for the relevant subsystem
- One `<module>.service.ts` and one `<module>.models.ts` per module
- Run `pnpm run generate:types` after schema/migration changes, BEFORE typechecking
- Use `pnpm` — NEVER `npm`

## Ask First
- Before changing database schema in production-critical tables
- Before modifying authentication or RBAC logic
- Before adding new dependencies

## Never
- Never expose cross-tenant data
- Never merge without review
- Never build without a tracked issue
- Never scatter service/models files (one per module)
```

### 1.4 Initialize `lessons.md`

Seed with lessons we've already learned (from MEMORY.md and daily notes):

```markdown
# Lessons Learned

## Docker group membership requires gateway restart
**Context:** Adding openclaw user to docker group.
**Problem:** Process inherits old groups from parent shell.
**Rule:** Always restart the gateway after group membership changes.
**Applies to:** Any systemd service or long-running process needing new group access.

## Binding format for conductor
**Context:** `parseBinding()` in the conductor.
**Problem:** Only reads YAML frontmatter. Title and acceptance criteria as markdown headings/checkboxes in the body were ignored.
**Rule:** `title:` and `acceptance:` list MUST be inside `---` block, not as markdown headings/checkboxes in the body.
**Applies to:** `CARBON_AGENT.md`, all binding synthesis.

## `gh issue list` excludes PRs
**Context:** Heartbeat scanning for assigned work.
**Problem:** Human-opened PRs assigned to carbon-agent were invisible.
**Rule:** Always also check `gh pr list --assignee carbon-agent` alongside `gh issue list`.
**Applies to:** Heartbeat cron, CARBON_AGENT.md.

## Orphaned claude subprocesses after OOM
**Context:** Harness parent gets SIGKILL'd by OOM killer.
**Problem:** Claude -p doer subprocess survives. Judge may run in degraded context and revert good changes.
**Rule:** Check worktree for untracked files to recover doer output before cleaning up.
**Applies to:** Post-failure recovery in conductor loop.

## Permission scope renames are invisible to typecheck
**Context:** Changing DB RLS policies (plm_* → production_*).
**Problem:** App layer `requirePermissions()` + `permissions.can()` calls use string literals invisible to typecheck/lint.
**Rule:** When renaming permission scopes, grep for ALL string literal references across the entire codebase, not just DB layer.
**Applies to:** Any permission or scope rename.
```

---

## Phase 2: Package-Level AGENTS.md (Week 2-3)

### 2.1 Create AGENTS.md for Each Package

Carbon has 22 packages. Each should get an AGENTS.md with:
- What the package does (1-2 sentences)
- Always / Ask First / Never
- Validation commands
- Key patterns and import paths
- Cross-references to related packages

Priority order (highest-traffic packages first):
1. `packages/database/` — schema, migrations, models
2. `packages/react/` — UI components, design system
3. `packages/form/` — form system (CrudForm equivalent)
4. `packages/lib/` — shared utilities
5. `packages/auth/` — authentication, RBAC
6. `packages/jobs/` — background jobs, event system
7. `packages/notifications/` — notification system
8. `packages/documents/` — PDF generation, templates
9. `packages/config/` — environment configuration
10. Remaining packages

### 2.2 Create Module-Level AGENTS.md for Core ERP Modules

The `apps/erp/app/modules/` directory contains Carbon's domain modules. The highest-value modules for AGENTS.md files:

1. **Purchasing** — complex domain with conversion factors, POs, receipts
2. **Inventory** — lots, bins, adjustments, reservations
3. **Scheduling** — work orders, operations, routings
4. **Parts / BOM** — bill of materials, revisions, lifecycle
5. **Quality** — inspections, NCRs, CAPAs
6. **Sales** — quotes, orders, fulfillment
7. **Accounting** — chart of accounts, journal entries, GL
8. **MES** — shop floor, job tracking, operator interface

Each module AGENTS.md should include:
- Domain concept summary (for an LLM that doesn't know manufacturing)
- Data model overview (key tables, relationships)
- Business rules and invariants
- Copy-from reference table
- Related modules and how they interact

### 2.3 Create Module Conventions Document

`.ai/docs/module-conventions.md` — Carbon's equivalent of Open Mercato's module development guide:

- File structure conventions (`<module>.service.ts`, `<module>.models.ts`)
- Route patterns (React Router / Remix heritage)
- Form patterns (using `packages/form`)
- Table patterns (using `packages/react` DataTable)
- Service patterns (Supabase client usage)
- How modules compose (through DB relations, not DI)

---

## Phase 3: Spec-Driven Development (Week 3-4)

### 3.1 Establish Spec System

Create `.ai/specs/AGENTS.md` with lifecycle rules:

```markdown
# Spec Lifecycle
1. Non-trivial feature → create spec in `.ai/specs/{YYYY-MM-DD}-{title}.md`
2. Spec reviewed (open questions resolved)
3. Implementation proceeds phase-by-phase
4. Completed spec moves to `.ai/specs/implemented/`
```

### 3.2 Create Spec Template

Adapted for Carbon's needs (simpler than Open Mercato's — we don't need the "Martin Fowler" persona yet):

```markdown
# {Title}

## TLDR
One paragraph.

## Problem
What's wrong / what's missing.

## Proposed Solution
How we'll fix it.

### Design Decisions
| Decision | Choice | Rationale |
|----------|--------|-----------|

## Data Model Changes
Tables, columns, migrations needed.

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Risks
| Risk | Severity | Mitigation |
|------|----------|------------|

## Changelog
- {date}: Created
```

### 3.3 Retrofit Existing Specs

Move existing design work into the spec system:
- Research docs from `.claude/scratch/research/` → `.ai/specs/`
- Task plans from `.claude/scratch/tasks/` → `.ai/runs/`

---

## Phase 4: Carbon-Specific Skills (Week 4-6)

### 4.1 Create Carbon-Specific Skills in `.ai/skills/`

Priority skills for Carbon (domain-specific, not generic):

| Skill | Purpose | Tier |
|-------|---------|------|
| `carbon-module-scaffold` | Scaffold a new ERP module (routes, service, models, forms, tables) | Core |
| `carbon-migration` | Database migration workflow (generate → review → apply) | Core |
| `carbon-form-builder` | Build forms following Carbon conventions | Core |
| `carbon-spec-writing` | Write specs adapted to manufacturing domain | Core |
| `carbon-auto-create-pr` | End-to-end PR with Carbon-specific gates | Automation |
| `carbon-code-review` | Review checklist with Carbon patterns | Core |
| `carbon-supabase-rls` | Write and test RLS policies correctly | Core |
| `carbon-i18n` | i18n workflow with Lingui | Core |
| `carbon-edge-function` | Edge function patterns | Infra |
| `carbon-test` | Testing patterns and conventions | Core |

### 4.2 Upgrade the Conductor Skill

The conductor (`.claude/skills/conductor/SKILL.md`) is our inner-loop workhorse. Enhance it with:
- Pre-flight context loading (read relevant AGENTS.md, lessons.md, existing specs)
- Phase tracking in run plans (`.ai/runs/`)
- Self-review step before PR submission
- Checkpoint/resume capability for long builds

### 4.3 Create Skill Creator Meta-Skill

Adapt Open Mercato's `om-skill-creator` pattern — a skill for creating skills:
- Anatomy of a Carbon skill (SKILL.md + references/ + scripts/)
- Context window budget guidelines
- Degrees of freedom guidance (high/medium/low)
- Tier assignment rules

---

## Phase 5: Safety & Quality Gates (Week 6-8)

### 5.1 Backward Compatibility Contract

Create `BACKWARD_COMPATIBILITY.md` defining Carbon's stable surfaces:

| Surface | Status | Examples |
|---------|--------|---------|
| Database table/column names | ADDITIVE-ONLY | Never rename, never remove |
| Supabase RLS policy names | STABLE | Rename requires migration |
| Permission scope strings | FROZEN | `"parts"`, `"inventory"`, `"purchasing"` |
| Service function signatures | STABLE | Add optional params, don't remove |
| Route paths | STABLE | Redirects required on change |
| Edge function names | FROZEN | Referenced by Supabase config |
| Event types | FROZEN | Referenced by subscribers |
| Form component props | STABLE | Additive-only |

### 5.2 Design System Rules

Create `.ai/ds-rules.md` for Carbon's UI conventions:
- Component decision tree (when to use which component from `packages/react`)
- Color token rules (status colors, brand colors)
- Spacing and typography scale
- Form layout patterns
- Table conventions
- Boy Scout Rule for touched files

### 5.3 AI-Specific CI Checks

Add checks that catch common AI mistakes in Carbon:

| Check | What It Catches |
|-------|----------------|
| Hardcoded permission strings | Permission strings that don't match known scopes |
| `npm` usage detection | Using npm instead of pnpm |
| Missing `generate:types` | Schema changes without type regeneration |
| Scattered service files | New `.service.ts` files outside module convention |
| Hardcoded i18n strings | User-facing strings not using Lingui |

---

## Phase 6: Knowledge Base & Feedback Loops (Week 8-10)

### 6.1 Run Plans as Audit Trail

Every conductor build should create a run plan in `.ai/runs/`:

```markdown
# {date}-{slug}

## Goal
One sentence.

## Issue
#{number}

## Progress
- [x] Phase 1: Scaffold — abc1234
- [x] Phase 2: Implementation — def5678
- [ ] Phase 3: Tests
- [ ] Phase 4: Review

## Checkpoint Notes
...
```

### 6.2 Lessons Feedback Loop

After every build (success or failure), the conductor should:
1. Check if the build revealed a new pattern or pitfall
2. If yes, append to `.ai/lessons.md` using the `Context → Problem → Rule → Applies to` format
3. If the lesson impacts an AGENTS.md file, update that too

### 6.3 Spec-to-Code Traceability

Every PR should link back to its spec (if one exists):
```
Tracking spec: .ai/specs/2026-07-01-eco-workflow.md
```

And every implemented spec should link to its PR:
```
## Changelog
- 2026-07-05: Implemented in PR #999
```

---

## Phase 7: Advanced Patterns (Week 10+)

### 7.1 QA Scenarios

Build a library of manufacturing-specific test scenarios:
- Purchase order lifecycle (create → approve → receive → invoice)
- Work order lifecycle (create → schedule → start → complete)
- Lot traceability (receipt → WIP → finished goods → shipment)
- Quality inspection flow (inbound → inspect → accept/reject → disposition)

### 7.2 Domain Knowledge Base

Create `.ai/docs/manufacturing/` with domain primers for AI agents:
- `erp-concepts.md` — what an ERP does, key entities
- `mes-concepts.md` — shop floor, operations, routings
- `quality-concepts.md` — inspections, NCRs, CAPAs, ECOs
- `inventory-concepts.md` — lots, bins, units of measure, conversions
- `purchasing-concepts.md` — POs, receipts, vendor management

These help any AI agent (not just me) understand the *domain* before writing code for it.

### 7.3 Tiered Skill Loading

As the skill count grows, implement tiered loading:
- **Core** (always loaded): module-scaffold, migration, form-builder, code-review, spec-writing
- **Automation** (opt-in): auto-create-pr, auto-review, changelog
- **Domain** (opt-in): manufacturing-specific skills
- **Infra** (opt-in): edge functions, deployment, Supabase admin

---

## Implementation Priority

If I had to pick the 5 highest-impact changes to do first:

1. **Task Router in root AGENTS.md** — immediate ROI for every agent session
2. **`.ai/lessons.md`** — institutional memory that prevents repeated mistakes
3. **Package-level AGENTS.md** (top 5 packages) — bounded context for each package
4. **Spec system** (`.ai/specs/` + template) — design-first development
5. **Module-level AGENTS.md** (top 5 modules) — domain knowledge for manufacturing

Everything else builds on these foundations.

---

## What This Looks Like When It's Done

A developer (human or AI) working on "add lot traceability to purchase receipts":

1. Reads root AGENTS.md Task Router → finds `inventory-system.md`, `traceability-model.md`, `packages/database/AGENTS.md`, `modules/purchasing/AGENTS.md`
2. Reads `.ai/lessons.md` → finds the permission scope rename lesson
3. Checks `.ai/specs/` → finds or creates a spec for the feature
4. Reads `modules/inventory/AGENTS.md` → understands the lot data model and business rules
5. Reads `modules/purchasing/AGENTS.md` → understands receipt workflow and copy-from tables
6. Implements following module conventions
7. Run plan tracked in `.ai/runs/`
8. Self-reviews against `carbon-code-review` checklist
9. Opens PR with spec link and verification steps
10. Lesson captured if anything unexpected happened

That's the vision: **any agent can do meaningful work on Carbon without asking Brad to explain everything first.**

---

## Cost Estimate

This is primarily a documentation and process investment, not a code change:

| Phase | Effort | Impact |
|-------|--------|--------|
| Phase 1: Foundation | 2-3 days | High (immediate ROI) |
| Phase 2: Package AGENTS.md | 3-5 days | High |
| Phase 3: Spec system | 1-2 days | Medium |
| Phase 4: Carbon skills | 5-8 days | High |
| Phase 5: Safety gates | 3-5 days | Medium |
| Phase 6: Feedback loops | 2-3 days | Medium |
| Phase 7: Advanced | Ongoing | Compound |

**Total initial investment: ~3-4 weeks of focused work.**

The payoff compounds — every spec written, every lesson captured, every AGENTS.md maintained makes the next build faster and safer. Open Mercato's 164 implemented specs and 97 run plans didn't happen overnight. They accumulated through disciplined practice.

---

*"The best time to plant a tree was 20 years ago. The second best time is now." — And the best time to make a codebase LLM-first is before you need it to be.*
