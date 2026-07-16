# Open Mercato — AGENTS.md Hierarchy Deep-Dive

> **Analyzed:** 2026-06-30 | **Source:** [open-mercato/open-mercato](https://github.com/open-mercato/open-mercato) on GitHub
> **Files fetched:** 25+ AGENTS.md files across root, packages, and module levels

---

## 1. Architecture Overview

Open Mercato is a modular, multi-tenant ERP/CRM platform (think "open-source Salesforce for commerce"). It uses a **monorepo** with:
- `apps/mercato/` — main app
- `packages/` — 12+ packages (core, ui, shared, search, events, queue, cache, webhooks, ai-assistant, cli, onboarding, content, create-app)
- `packages/core/src/modules/` — business modules (customers, sales, auth, catalog, etc.)
- `.ai/` — AI-specific assets (specs, skills, docs, qa, scripts, lessons)

Their AGENTS.md system is the **most comprehensive hierarchical agent-instruction architecture** I've seen in any open-source project.

---

## 2. Full Hierarchy Map

```
Repository Root
├── AGENTS.md                              ← MASTER: Task Router + global Always/Ask/Never
├── CLAUDE.md                              ← Redirect: just `@AGENTS.md` (single source of truth)
├── BACKWARD_COMPATIBILITY.md              ← Contract surfaces (FROZEN/STABLE annotations)
├── .ai/
│   ├── qa/AGENTS.md                       ← QA/integration testing instructions
│   ├── skills/                            ← Agent skills (om-module-scaffold, om-integration-tests, etc.)
│   ├── specs/                             ← Feature specs (referenced by Task Router)
│   ├── docs/                              ← Module development docs
│   ├── ds-rules.md                        ← Design system rules
│   ├── ui-components.md                   ← Component reference (variants, props, MUST rules)
│   ├── lessons.md                         ← Accumulated agent lessons
│   ├── analysis/                          ← Analysis artifacts
│   ├── plans/                             ← Planning docs
│   ├── reports/                           ← Generated reports
│   ├── runs/                              ← Run artifacts
│   └── scripts/                           ← Utility scripts
│
├── packages/
│   ├── core/AGENTS.md                     ← Core package: extensibility contracts, auto-discovery
│   │   └── src/modules/
│   │       ├── customers/AGENTS.md        ← REFERENCE MODULE: "copy patterns from here first"
│   │       ├── sales/AGENTS.md            ← Complex business logic module
│   │       ├── auth/AGENTS.md             ← Auth/RBAC/ACL module
│   │       ├── progress/AGENTS.md         ← Bulk operations + progress tracking
│   │       ├── integrations/AGENTS.md     ← (referenced, not fetched)
│   │       ├── data_sync/AGENTS.md        ← (referenced, not fetched)
│   │       ├── workflows/AGENTS.md        ← (referenced, not fetched)
│   │       └── customer_accounts/AGENTS.md ← (referenced, not fetched)
│   │
│   ├── ui/AGENTS.md                       ← UI primitives, CrudForm, DataTable, portal
│   │   └── src/backend/AGENTS.md          ← (referenced: backend page components)
│   │
│   ├── shared/AGENTS.md                   ← Cross-cutting utilities, types, DSL, i18n
│   ├── search/AGENTS.md                   ← Fulltext/vector/token search configuration
│   ├── events/AGENTS.md                   ← Event bus, subscribers, SSE bridge
│   ├── queue/AGENTS.md                    ← Background job processing (BullMQ/local)
│   ├── cache/AGENTS.md                    ← Tag-based caching (Redis/SQLite/memory)
│   ├── webhooks/AGENTS.md                 ← Standard Webhooks, inbound/outbound
│   ├── ai-assistant/AGENTS.md             ← AI agents, MCP tools, Code Mode
│   ├── cli/AGENTS.md                      ← Generators, migrations, scaffolding
│   ├── onboarding/AGENTS.md               ← Setup wizards, tenant provisioning
│   ├── content/AGENTS.md                  ← Static content pages
│   └── create-app/AGENTS.md               ← Standalone app scaffolding
│
└── (No .claude/ directory, no CODEX.md, no .claude/settings.json)
```

### Hierarchy Depth: 4 Levels

1. **Root** — `AGENTS.md` (global rules + Task Router)
2. **Package** — `packages/<pkg>/AGENTS.md` (package-scoped architecture)
3. **Module** — `packages/core/src/modules/<mod>/AGENTS.md` (domain-specific rules)
4. **Sub-directory** — `packages/ui/src/backend/AGENTS.md`, `.ai/qa/AGENTS.md` (functional area)

---

## 3. Task Router — Full Analysis

The Task Router is the **crown jewel** of their system. It's a massive table in the root AGENTS.md that maps every conceivable task to the specific guide(s) an agent should read.

### Design Philosophy

> "Before any research or coding, match the task to the root AGENTS.md Task Router table. A single task often maps to **multiple rows** — for example, 'add a new module with search' requires both the Module Development and Search guides. Read **all** matching guides before starting."

### Router Categories (8 major sections)

| Category | # of Rows | Coverage |
|----------|-----------|----------|
| **Module Development** | ~25 rows | CRUD, events, notifications, widgets, injection, ACL, encryption, extensions, custom fields, interceptors, enrichers, optimistic locking |
| **Specific Modules** | ~5 rows | Module-specific work, webhooks, integration providers |
| **Packages** | ~15 rows | shared utils, UI, search, CLI, events, cache, queue, AI assistant, MCP, onboarding, content, standalone apps |
| **Performance** | ~1 row | Dev-mode memory profiling |
| **Migration** | ~1 row | MikroORM v6→v7 migration |
| **Testing** | ~1 row | Integration testing (Playwright) |
| **Spec & PR Automation** | (truncated) | Spec lifecycle |

### Key Router Patterns

1. **Multi-guide mapping**: A task like "adding DataTable extension widgets" maps to BOTH `packages/core/AGENTS.md → Widget Injection` AND `packages/ui/AGENTS.md → DataTable Guidelines`

2. **Skills as router targets**: Some rows point to `.ai/skills/` — e.g., "Creating a new module" maps to the `om-module-scaffold` skill

3. **Spec references**: Rows like optimistic locking reference both AGENTS.md files AND spec files (`.ai/specs/implemented/2026-05-25-oss-optimistic-locking.md`)

4. **Guide granularity**: Routes point to BOTH the file AND the specific section within it (e.g., `packages/core/AGENTS.md → Events → Event Subscribers`)

5. **Fallback rule**: "Only use Explore agents for topics not covered by any existing AGENTS.md"

### Example Multi-Guide Routing

| Task | Guides Required |
|------|----------------|
| "Add a new module with search" | `packages/core/AGENTS.md` + `.ai/docs/module-development.md` + `packages/search/AGENTS.md` |
| "Add bulk operations with progress" | `packages/core/src/modules/progress/AGENTS.md` + `packages/ui/AGENTS.md → DataTable` + `packages/queue/AGENTS.md` |
| "Fix wildcard ACL handling" | `packages/core/AGENTS.md → Access Control` + `packages/shared/AGENTS.md` + `packages/ui/AGENTS.md` + `packages/core/src/modules/auth/AGENTS.md` |
| "Add AI agents with tools" | `.ai/skills/om-create-ai-agent/SKILL.md` + `packages/ai-assistant/AGENTS.md` + framework docs |

---

## 4. Per-Package Scoping Patterns

Every AGENTS.md follows a **consistent 4-section structure**:

### Standard Template

```markdown
# <Package> — Agent Guidelines

## Always
1. MUST do X...
2. MUST do Y...

## Ask First
- Ask before changing Z...

## Never
- Never do W...

## Validation Commands
```bash
yarn <specific-commands>
```
```

### Package-Level Scoping Examples

| Package | Key Scoped Rule | Why It Matters |
|---------|----------------|----------------|
| **shared** | "MUST NOT import from `@open-mercato/core` or any domain package" | Enforces dependency direction |
| **core** | "Never create direct ORM relationships between modules" | Module isolation |
| **ui** | "Never use raw `<button>`, raw checkbox inputs, or raw `<Link>` styled as a button" | Design system compliance |
| **events** | "MUST NOT use direct module-to-module function calls for side effects" | Event-driven architecture |
| **queue** | "Never exceed worker concurrency 20" | Resource management |
| **cache** | "MUST resolve via DI — never instantiate cache directly" | DI discipline |
| **search** | "MUST define `fieldPolicy.excluded` for sensitive fields" | Data security |
| **cli** | "Never commit unrelated generated migrations caused by stale snapshots" | Clean git history |

### Module-Level Scoping (Inside packages/core)

The **customers module** is designated as the **reference CRUD module**:

> "This is the reference CRUD module. When building new modules, copy patterns from here first."

It includes a "Key Reference Files — Copy From Here" table mapping needs to specific files. This is a powerful pattern — one canonical module as the template, all others derive from it.

The **sales module** has domain-specific constraints:
- MUST use `salesCalculationService` from DI for document math
- MUST follow document flow: Quote → Order → Invoice — no skipping steps
- Configuration entities (channels, statuses, methods) are managed via admin UI, not code

---

## 5. Backward Compatibility Contract

`BACKWARD_COMPATIBILITY.md` is a **formal contract document** that categorizes all public surfaces:

### Contract Categories

| Category | Stability Level | Rule |
|----------|----------------|------|
| **Auto-Discovery File Conventions** | FROZEN | "MUST NOT change. New files may be added, existing ones are immutable." |
| **Type Definitions & Interfaces** | STABLE | "Required fields MUST NOT be removed. Optional fields may be added freely." |
| **Function Signatures** | STABLE | "Their signatures MUST NOT change in a breaking way. New optional parameters may be added." |

### Deprecation Protocol (5 steps)

1. Never remove or rename a public contract in a single release
2. Deprecate first: add `@deprecated` JSDoc with migration guidance
3. Provide a bridge: re-export old name/path, accept old signature
4. Document in RELEASE_NOTES.md
5. Any PR modifying a contract MUST reference a spec with "Migration & Backward Compatibility" section

### FROZEN Convention Files

They list **19 specific convention files** (e.g., `index.ts`, `acl.ts`, `setup.ts`, `events.ts`, `search.ts`, etc.) with their required exports and immutability contracts. Plus **5 directory patterns** for auto-discovery routing.

This is remarkably thorough — every file in the module convention system has an explicit contract status.

---

## 6. Verification/Commit Workflow

### Validation Command Hierarchy

Each AGENTS.md has a "Validation Commands" section with the **smallest relevant set** for changes at that level:

**Root level:**
```bash
yarn generate
yarn build:packages
yarn typecheck
yarn lint
yarn test
yarn build:app
```

**Package level (example: core):**
```bash
yarn db:generate
yarn generate
yarn workspace @open-mercato/core build
yarn workspace @open-mercato/core test
```

**UI level:**
```bash
yarn workspace @open-mercato/ui test
yarn workspace @open-mercato/ui build
yarn i18n:check
```

### Key Workflow Rules

1. **`yarn generate` after module file changes** — auto-discovers and registers new files
2. **`yarn db:generate` for entity changes** — but review generated SQL carefully
3. **Never `yarn db:migrate` without asking** — PRs should include migration files, not local DB state
4. **Enter plan mode for non-trivial tasks** — 3+ steps or architectural decisions
5. **Check specs before modifying** — `.ai/specs/` and `.ai/specs/enterprise/`

---

## 7. The .ai/ Ecosystem

Beyond AGENTS.md, they have a rich `.ai/` directory:

| Directory | Purpose |
|-----------|---------|
| `.ai/specs/` | Feature specifications (referenced by Task Router rows) |
| `.ai/specs/enterprise/` | Enterprise-only specs |
| `.ai/skills/` | Agent skills (om-module-scaffold, om-integration-tests, om-create-ai-agent, om-migrate-mikro-orm, om-backend-ui-design, om-ds-guardian, om-integration-builder) |
| `.ai/qa/` | QA testing infrastructure + AGENTS.md |
| `.ai/docs/` | Developer documentation (module-development.md) |
| `.ai/ds-rules.md` | Design system rules (color tokens, typography, spacing) |
| `.ai/ui-components.md` | Component reference with variants, sizes, props, MUST rules |
| `.ai/lessons.md` | Accumulated agent lessons learned |
| `.ai/plans/` | Planning documents |
| `.ai/analysis/` | Analysis artifacts |
| `.ai/reports/` | Generated reports |
| `.ai/runs/` | Run artifacts |
| `.ai/scripts/` | Utility scripts |

### CLAUDE.md Strategy

Their `CLAUDE.md` contains only `@AGENTS.md` — a redirect. This means:
- Claude Code loads AGENTS.md as its primary instructions
- CODEX.md doesn't exist (OpenAI Codex not targeted)
- No `.claude/settings.json` or `.claude/rules/` — everything lives in AGENTS.md

This is a **single-source-of-truth** approach: one AGENTS.md hierarchy serves all coding agents.

---

## 8. Distinctive Patterns Worth Noting

### 8.1 Reference Module Pattern
The customers module is the explicit "reference CRUD module" with a "Copy From Here" table. Every new module should copy its patterns. This eliminates ambiguity about which patterns to follow.

### 8.2 Optimistic Locking as Default-ON
They mandate optimistic locking via `updated_at` on every new user-editable entity, with guard tests to enforce it. This is baked into the AGENTS.md instructions, not just a spec.

### 8.3 Wildcard ACL Enforcement
Multiple AGENTS.md files repeat: "Never check raw ACL arrays with `includes(...)`, `Set.has(...)`, or ad hoc wildcard logic." They have shared helpers (`hasFeature`, `hasAllFeatures`) and enforce this across core, shared, UI, and auth modules.

### 8.4 Never/Always Consistency Across Levels
Global "Never" rules like "never expose cross-tenant data" are repeated at the root AND in relevant package AGENTS.md files. This ensures even if an agent only reads the nearest AGENTS.md, critical rules are present.

### 8.5 Skills as Task Router Targets
Skills like `om-module-scaffold` and `om-create-ai-agent` are first-class routing targets in the Task Router, blurring the line between instructions and automation.

### 8.6 Lessons File
`.ai/lessons.md` captures accumulated agent lessons — a form of institutional memory for AI agents.

### 8.7 Event-Driven Architecture Enforcement
The events package AGENTS.md mandates: "MUST NOT use direct module-to-module function calls for side effects." This is architectural enforcement via agent instructions.

---

## 9. What Carbon Could Adopt

### 9.1 Task Router Table (HIGH VALUE)
**What:** A root-level routing table mapping task types to the specific guide(s) to read before working.
**Why for Carbon:** Our conductor dispatches builds, but the doer agent doesn't have explicit guidance on which files to read for different task types. A Task Router would eliminate the "where do I look?" problem.
**Adaptation:** Map Carbon tasks (new feature, bug fix, UI work, API change, test) to specific paths in our repo.

### 9.2 Always/Ask First/Never Structure (HIGH VALUE)
**What:** Every AGENTS.md follows a consistent `Always → Ask First → Never → Validation Commands` structure.
**Why for Carbon:** We have safety rails in AGENTS.md but they're not systematically organized. The Always/Ask/Never pattern creates clear tiers of autonomy.
**Adaptation:** Restructure our conductor skill and package-level AGENTS.md files with this template.

### 9.3 Reference Module Pattern (MEDIUM VALUE)
**What:** One module (customers) is designated as the canonical reference, with a "Copy From Here" table mapping needs to files.
**Why for Carbon:** When building new features, knowing which existing code to reference prevents reinvention and drift.
**Adaptation:** Designate our most mature module as the reference implementation.

### 9.4 Backward Compatibility Contract (MEDIUM VALUE)
**What:** Explicit FROZEN/STABLE annotations on every public contract surface with a 5-step deprecation protocol.
**Why for Carbon:** As Carbon grows, we need clear rules about what can and can't change. This prevents agents from casually breaking APIs.
**Adaptation:** Document our public contract surfaces with stability annotations.

### 9.5 Validation Command Scoping (MEDIUM VALUE)
**What:** Each AGENTS.md has the smallest relevant validation commands for changes at that level.
**Why for Carbon:** Our doer agents sometimes run too many or too few checks. Scoped validation commands would make this precise.
**Adaptation:** Add `## Validation Commands` to each area of the codebase.

### 9.6 `.ai/lessons.md` Pattern (LOW-MEDIUM VALUE)
**What:** A single file accumulating agent lessons learned.
**Why for Carbon:** We have daily memory files, but a curated lessons file would give future agents institutional wisdom.
**Adaptation:** We already have `MEMORY.md` and daily notes — could add a focused `lessons.md` for code-specific learnings.

### 9.7 CLAUDE.md → AGENTS.md Redirect (LOW VALUE)
**What:** CLAUDE.md just contains `@AGENTS.md` — single source of truth.
**Why for Carbon:** We already use AGENTS.md as our primary. But worth noting their philosophy: one file hierarchy serves all AI coding tools.

---

## 10. Quantitative Summary

| Metric | Count |
|--------|-------|
| Total AGENTS.md files found | 22+ (some referenced but not fetched) |
| Hierarchy depth | 4 levels (root → package → module → sub-directory) |
| Task Router rows | ~50+ across 8 categories |
| FROZEN contract surfaces | 19 convention files + 5 directory patterns |
| STABLE type definitions | 20+ interfaces with field-level contracts |
| STABLE function signatures | 15+ functions with parameter contracts |
| Package-level AGENTS.md | 12 packages |
| Module-level AGENTS.md | 6+ modules (customers, sales, auth, progress, integrations, data_sync) |
| .ai/ skills | 7+ (om-module-scaffold, om-integration-tests, om-create-ai-agent, om-migrate-mikro-orm, om-backend-ui-design, om-ds-guardian, om-integration-builder) |
| Validation command sets | 12+ (scoped per level) |

---

## 11. Key Takeaway

Open Mercato's AGENTS.md system is **the most sophisticated hierarchical agent-instruction architecture** in any open-source project I've analyzed. The Task Router alone — with its multi-guide routing, skill integration, and spec references — is a pattern that could transform how any large codebase onboards AI agents.

Their core insight: **don't just tell the agent what to do — tell it where to look first.** The Task Router acts as a knowledge index, turning a sprawling codebase into a navigable decision tree for AI agents.
