# Carbon LLM-Friendliness: Current State Assessment

**Date:** 2026-06-30
**Assessed by:** Subagent analysis of repo structure, documentation, and configuration

---

## 1. What Exists Today

### 1.1 Root-Level Agent Context

| File | Purpose | Lines |
|------|---------|-------|
| `AGENTS.md` | Primary agent orientation — environment, principles, workflow, tool rules, module layout | ~95 lines |
| `CLAUDE.md` | Single line: `@AGENTS.md` (redirect) | 1 line |
| `.claude/settings.json` | Minimal — just disables `superpowers` plugin | 3 lines |
| `.claude/settings.local.json` | Read permissions for openclaw paths only | ~8 lines |

**AGENTS.md** is well-structured. It covers:
- What Carbon is (ERP + MES + Academy)
- Core principles (simplicity, no laziness, minimal impact, demand elegance, use existing components)
- Workflow orchestration (plan first, subagent strategy, verification before done, autonomous bug fixing)
- Task management (todo files, self-improvement loop, lessons capture)
- Tool rules (prefer built-in tools over bash, grep conventions, rules auto-loading, never rebuild DB)
- Browser automation and migration references

### 1.2 Rules System (`.claude/rules/`)

**55 rule files, ~7,000 total lines.** Every single one has `paths:` frontmatter for scoped auto-loading. This is a mature, well-maintained system.

**Categories:**

| Category | Count | Examples |
|----------|-------|---------|
| **Conventions** (cross-cutting) | 6 | `coding-conventions.md`, `conventions-database.md`, `conventions-forms.md`, `conventions-services.md`, `conventions-ui.md`, `conventions-index.md` |
| **Workflows** (step-by-step procedures) | 3 | `workflow-database-migration.md`, `workflow-edge-function.md`, `workflow-event-system.md` |
| **Subsystem docs** (domain knowledge) | 30+ | `inventory-system.md`, `mrp-system.md`, `billing-system.md`, `printing-system.md`, `authentication-system.md`, etc. |
| **Integration docs** | 5 | `xero-api-contact-structure.md`, `xero-webhooks.md`, `jira-integration.md`, `linear-integration.md` |
| **Patterns** (reusable approaches) | 5+ | `database-patterns.md`, `database-migration-patterns.md`, `pdf-generation-patterns.md`, `clientAction-patterns.md` |

**Cross-reference quality:** Rules link to each other (e.g., `coding-conventions.md` has a table pointing to `conventions-database.md`, `conventions-forms.md`, etc.). The `conventions-index.md` serves as a master pointer.

### 1.3 Skills System (`.claude/skills/`)

**29 skills** covering the full development lifecycle:

| Category | Skills |
|----------|--------|
| **Development workflow** | `feature`, `plan`, `execute`, `brainstorm`, `research` |
| **Quality/Testing** | `test`, `smoke-test`, `test-driven-development`, `verification-before-completion` |
| **Debugging** | `systematic-debugging`, `debugging-difficult-bugs`, `error` |
| **Code review** | `self-review`, `receiving-code-review`, `pr-explainer`, `pr-splitter` |
| **Browser automation** | `agent-browser`, `login` |
| **Build loop** | `conductor` (the inner loop) |
| **Specialized** | `forms`, `database-transactions`, `carbon-docs`, `ui`, `make-interfaces-feel-better` |
| **Meta** | `writing-skills`, `dispatching-parallel-agents`, `using-git-worktrees`, `finishing-a-development-branch`, `improve` |

Notable skills with supporting files:
- `agent-browser/` — 7 reference docs (auth, commands, profiling, proxy, sessions, snapshots, video)
- `test/` — 20+ cached playbooks for specific ERP flows
- `systematic-debugging/` — 5 reference docs + test scenarios
- `writing-skills/` — 3 reference docs + examples
- `carbon-docs/` — 6 reference docs + templates
- `make-interfaces-feel-better/` — 4 reference docs (animations, performance, surfaces, typography)
- `improve/` — 3 reference docs (audit playbook, closing the loop, plan template)

### 1.4 Outer Loop / Agent System (`llm/`)

| Path | Contents |
|------|----------|
| `llm/outer-loop/README.md` | Design docs for the autonomous agent system (OpenClaw runtime + Claude Code) |
| `llm/outer-loop/agent-state.db` | SQLite state for the outer loop (empty/minimal) |
| `llm/loops/README.md` | Binding format, run layout, lifecycle/GC docs |
| `llm/loops/runs/*/` | Gitignored runtime artifacts (bindings, ledgers, outcomes, screenshots) |
| `llm/tasks/memo-refactor-plan.md` | A detailed architectural design doc (~260 lines) |

### 1.5 Harness Package (`packages/harness/`)

A dedicated TypeScript package for the loop system:
- `binding.ts` / `binding.test.ts` — parse and validate loop bindings
- `gates.ts` / `gates.test.ts` — floor gates (lint, checks, conformance)
- `ledger.ts` / `ledger.test.ts` — append-only iteration records
- `layout.ts` — path conventions for run artifacts
- `runs.ts` / `runs.test.ts` — run management and GC
- `runner/` — the loop runner
- `smoke.test.ts` — smoke tests

### 1.6 Other LLM-Adjacent Files

| Path | Purpose |
|------|---------|
| `.claude/scratch/tasks/todo.md` | Active task tracking |
| `.claude/scratch/research/*.md` | Research artifacts from the `/research` skill |
| `.claude/daily/` and `.claude/daily-notes/` | Daily session notes |
| `packages/checks/` | `@carbon/checks` — conformance checks used by the conductor |

### 1.7 What Does NOT Exist

- **No per-package `AGENTS.md`** — zero results from `find packages/ -name "AGENTS.md"`
- **No spec files** — `find -path "*spec*" -name "*.md"` found only `inbound-inspection-system.md` (named via path coincidence, it's a rules file)
- **No docs app content** — `apps/docs/content/` appears empty (docs site exists but no MDX content found)
- **No per-package READMEs** — only 5 of ~20 packages have a README (`dev`, `harness`, `checks`, `kv`, `documents`)
- **No architecture decision records (ADRs)**
- **No changelog** (at the repo level)
- **No contributing guide** beyond what's in AGENTS.md
- **No API documentation** beyond what's in the rules

---

## 2. How It's Organized

### Layer Model

```
Layer 1: Root Context (always loaded)
├── CLAUDE.md → @AGENTS.md (redirect)
├── AGENTS.md (principles, workflow, tool rules)
│
Layer 2: Auto-Scoped Rules (loaded on file access via paths: frontmatter)
├── .claude/rules/ (55 files, ~7K lines)
│   ├── conventions-*.md    (cross-cutting patterns)
│   ├── workflow-*.md       (step-by-step procedures)
│   └── {subsystem}.md      (domain-specific context)
│
Layer 3: On-Demand Skills (invoked explicitly or by trigger)
├── .claude/skills/ (29 skills)
│   └── {skill}/SKILL.md + references/ + assets/
│
Layer 4: Runtime Artifacts (ephemeral, gitignored)
├── llm/loops/runs/          (loop bindings, ledgers, outcomes)
├── .claude/scratch/         (tasks, research, daily notes)
│
Layer 5: Agent Infrastructure (packages)
├── packages/harness/        (loop mechanics)
├── packages/checks/         (conformance checks)
```

### Context Loading Strategy

1. **CLAUDE.md** → always loaded, redirects to AGENTS.md
2. **Rules** → auto-loaded via `paths:` frontmatter when touching matching files (zero manual effort)
3. **Skills** → triggered by keywords in user requests or explicit `/skill` invocation
4. **Conventions index** → loaded for general orientation, points to specific rules
5. **Research/scratch** → written and read during development workflows

---

## 3. Strengths — What Carbon Does Well

### 3.1 ⭐ Path-Scoped Rules Are Best-in-Class
All 55 rules have `paths:` frontmatter. This means the right context auto-loads when an agent touches relevant files — no manual "go read X" needed. This is **the** high-leverage pattern for LLM-friendliness. It's the equivalent of Open Mercato's rules system but more mature, with richer content and better cross-referencing.

### 3.2 ⭐ Deep Domain Knowledge Encoded
The rules encode real domain expertise — not just "how to code" but "how this ERP's accounting/inventory/MRP/quality systems actually work." The `inbound-inspection-system.md` rule, for example, explains the data model history (Phase 1 was per-tracked-entity, Phase 2 is lot-based), warns not to trust the Phase 1 shape, and documents the actual sampling standards (ANSI Z1.4, ISO 2859-1). This is expert-level context capture.

### 3.3 ⭐ Convention Rules Are Grounded in Real Code
Rules explicitly cite real migration files (e.g., "confirmed in `20260609143732_document-template.sql`") and include `<!-- UNVERIFIED -->` comments when something hasn't been re-confirmed. This epistemic honesty prevents rule drift.

### 3.4 ⭐ Mature Skill Ecosystem
29 skills covering the entire development lifecycle — from research to feature development to testing to PR creation. The `conductor` skill is particularly sophisticated: a full doer→gate→judge→ledger loop with provability hierarchy and binary decomposition for review.

### 3.5 ⭐ Test Playbook Caching
The `test` skill caches successful browser automation playbooks (20+ cached), so future test runs skip expensive discovery. This is practical institutional memory.

### 3.6 ⭐ Self-Improvement Infrastructure
AGENTS.md has a self-improvement loop (update `lessons.md` after corrections). The `writing-skills` skill exists to refine skills. The `improve` skill does read-only audits. There's a feedback loop from experience to documentation.

### 3.7 ⭐ Full Autonomous Agent Pipeline
The outer-loop system (OpenClaw runtime → Claude Code → harness → conductor) is a working autonomous development pipeline. The architecture is documented in `llm/outer-loop/README.md`, and the harness has tests and a clean API.

---

## 4. Gaps Compared to Open Mercato (and Best Practices)

### 4.1 🔴 No Per-Package AGENTS.md or READMEs
Only 5 of ~20 packages have any README. An agent working in `packages/auth/` or `packages/react/` has no local orientation beyond what the scoped rules provide. Open Mercato would have per-package context files that explain:
- What the package does and its public API
- Key design decisions and constraints
- Testing strategy
- Common gotchas

**Impact:** Agent must grep to understand package boundaries, exports, and conventions. The rules cover some of this (e.g., `authentication-system.md` covers `packages/auth`), but the mapping from package → rule is implicit.

### 4.2 🔴 No Formal Specs or Design Documents
The `llm/tasks/memo-refactor-plan.md` is excellent — a detailed architectural design with decisions, data models, migration plans, and risk analysis. But it's the only one. There's no established pattern for "when we design something, we write a spec here." Open Mercato would have a `specs/` or `design/` directory with a template and past specs.

### 4.3 🟡 CLAUDE.md Is a Redirect, Not a Summary
`CLAUDE.md` is literally `@AGENTS.md`. This works, but it wastes the most valuable real estate in the LLM context. Best practice (per Anthropic's own guidance and Open Mercato patterns) is to put a concise, high-signal summary in CLAUDE.md — the "30-second orientation" — and link to deeper docs. Currently, agents get the full AGENTS.md on every session, which is good content but could be more efficiently structured.

### 4.4 🟡 Rules Don't Cover All Subsystems
55 rules is impressive, but there are notable gaps:
- No rule for the **MES app** specifically (routing, services, components)
- No rule for **`@carbon/react`** (the shared component library — arguably the most important package for UI work)
- No rule for **`@carbon/jobs`/Inngest** patterns (beyond the `event-system.md` which covers events, not job orchestration)
- No rule for **testing conventions** (where to put tests, vitest config, mocking patterns)

### 4.5 🟡 No Architecture Overview Document
`project-overview.md` lists apps and packages (what things are) but doesn't explain how they relate (architecture). There's no diagram of data flow, no dependency graph, no "how a request flows from the browser to the database." The README has architecture images but they're GitHub-hosted screenshots, not accessible to an agent.

### 4.6 🟡 Cross-Reference Is Manual
The `conventions-index.md` is good, but cross-referencing between rules is done via markdown links and "see also" notes. There's no structured way for an agent to discover which rules are relevant to a given task beyond auto-loading via `paths:`. If an agent is working on a task that spans multiple subsystems (e.g., "add a new entity with forms, events, and printing"), it must manually load several rules.

### 4.7 🟡 No "Getting Started" for the Agent
AGENTS.md assumes the agent knows the codebase. There's no "if this is your first time, start here" flow. An onboarding path would help new agent sessions (or different models) ramp up faster.

### 4.8 🟡 Scratch/Daily Notes Are Unstructured
`.claude/scratch/` and `.claude/daily-notes/` accumulate artifacts without a cleanup or consolidation pattern. These could grow into noise over time.

### 4.9 🟢 Minor: Settings Files Are Minimal
`.claude/settings.json` only disables a plugin. `.claude/settings.local.json` only grants read permissions. There's no model configuration, no temperature settings, no context window management. This is fine for now (Claude Code defaults are reasonable), but as the agent system matures, explicit configuration may help.

---

## 5. Low-Hanging Fruit for Improvement

### 5.1 🎯 Add Per-Package AGENTS.md for Top 5 Packages (High Impact, Low Effort)
Start with the packages agents touch most:
1. **`packages/database/`** — migration workflow, schema conventions, type generation
2. **`packages/react/`** — component inventory, usage patterns, when to use what
3. **`packages/auth/`** — auth flow, permission model, session handling
4. **`packages/harness/`** — loop API, binding format, gate system
5. **`packages/jobs/`** — Inngest patterns, event handling, job lifecycle

Each file: 30-60 lines. What it does, key exports, gotchas, testing.

### 5.2 🎯 Enrich CLAUDE.md Beyond a Redirect (High Impact, Low Effort)
Replace the single-line redirect with a concise summary that includes:
- One-sentence project description
- The 5 most important things to know
- Key file locations
- "For more: see AGENTS.md, .claude/rules/, .claude/skills/"

This gives every session a fast orientation without loading the full AGENTS.md every time.

### 5.3 🎯 Add a Testing Conventions Rule (Medium Impact, Low Effort)
A `conventions-testing.md` scoped to `**/*.test.ts` and `**/*.test.tsx` covering:
- Where tests live (co-located vs `__tests__/`)
- Vitest configuration and test runner commands
- Mocking patterns (Supabase client, Inngest, etc.)
- What to test (service functions, validators, components)
- What NOT to test (generated types, trivial re-exports)

### 5.4 🎯 Add a `@carbon/react` Component Guide Rule (Medium Impact, Low Effort)
A rule scoped to `packages/react/src/**` and `apps/erp/app/components/**` that catalogs:
- Available components by category (layout, forms, data display, feedback)
- When to use which component
- Variant/size options
- Common composition patterns

This would prevent agents from re-implementing existing components.

### 5.5 🎯 Create a Design/Specs Template (Medium Impact, Low Effort)
Formalize the pattern from `llm/tasks/memo-refactor-plan.md`:
- Create `llm/tasks/TEMPLATE.md` with sections: Goal, Decisions, Target Model, Work Plan, Risks
- Add a brief note in AGENTS.md about writing specs for non-trivial features
- Ensures architectural decisions are captured, not just lost in chat

### 5.6 🎯 Add a MES Rule (Low-Medium Impact, Low Effort)
The MES app has different conventions than the ERP (lighter service layer, different component organization). A `mes-system.md` rule scoped to `apps/mes/**` would prevent agents from applying ERP patterns to MES code.

### 5.7 🎯 Add `<!-- UNVERIFIED -->` Audit Pass (Low Impact, Medium Effort)
Some rules have `<!-- UNVERIFIED -->` tags, which is excellent epistemic hygiene. A pass through all 55 rules to add these markers where appropriate would increase trust and identify stale content.

---

## 6. Summary Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Root context quality** | 8/10 | AGENTS.md is thorough; CLAUDE.md underused |
| **Scoped rules** | 9/10 | 55 rules, all path-scoped, well cross-referenced |
| **Skills/workflows** | 9/10 | 29 skills, full lifecycle coverage, test playbook caching |
| **Domain knowledge capture** | 8/10 | Deep subsystem docs; some gaps (MES, react components, testing) |
| **Per-package documentation** | 3/10 | Almost none; major gap |
| **Architecture documentation** | 5/10 | Project overview exists but no architecture flow docs |
| **Spec/design document system** | 3/10 | One excellent example but no established pattern |
| **Agent infrastructure** | 9/10 | Full outer-loop + harness + conductor pipeline |
| **Self-improvement** | 8/10 | Lessons capture, skill refinement, playbook caching |
| **Overall LLM-friendliness** | **7.5/10** | Strong foundation; per-package docs and spec patterns are the biggest gaps |

Carbon is significantly ahead of most codebases in LLM-friendliness. The scoped rules system and skill ecosystem are genuinely best-in-class. The main opportunities are in filling coverage gaps (per-package docs, missing rules for MES/react/testing) and formalizing patterns that already exist informally (spec documents, architecture overview).
