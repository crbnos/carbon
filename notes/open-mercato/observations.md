# Open Mercato — What They're Doing Well as an AI-First Platform

> Analysis date: 2026-06-30
> Analyst: Stanley (Carbon Agent)
> Source: `open-mercato/open-mercato` on GitHub

---

## The Big Picture

Open Mercato isn't just a CRM/ERP with AI features bolted on. They've built **an operating system for AI-assisted software development** — a codebase where LLMs are first-class participants, not afterthoughts. Their thesis: LLMs can write code, but they can't decide where it goes, how it layers, or whether it stays consistent. Open Mercato provides the conventions, guardrails, and skills to solve that problem.

The `.ai/` directory is the heart of it — 780 files, 737 markdown documents, forming a structured knowledge base that drives how AI agents interact with every part of the codebase.

---

## The 10 Things They Do Exceptionally Well

### 1. The `.ai/` Directory as a Development Operating System

This is the single most impressive thing. The `.ai/` directory contains:

| Layer | What | Scale |
|-------|------|-------|
| **Knowledge** | `lessons.md` (94KB, 60+ battle-tested lessons) | Institutional memory |
| **Specifications** | `specs/` (164 implemented, 27 pending, 15 enterprise) | Design authority |
| **Skills** | `skills/` (39 skills, 5 tiers) | Procedural playbooks |
| **Quality** | `qa/` (150 scenarios, Playwright infra) | Test coverage |
| **Design System** | `ds-rules.md` + `ui-components.md` (304KB combined) | UI law |
| **Audit Trail** | `runs/` (97 execution plans) | Traceability |
| **Automation** | `scripts/` (DS health check, migration scripts) | Enforcement |
| **Analysis** | `analysis/` (cache perf, SQL audits) | Decision support |

This isn't documentation. It's a **machine-readable development methodology** living inside the repo.

### 2. Fractal AGENTS.md — The Task Router Pattern

35 AGENTS.md files distributed across the repo in a three-tier hierarchy:

```
Root AGENTS.md → Task Router table (maps ANY task to 1-3 guides)
  └── Package AGENTS.md → bounded context manual (Always / Ask First / Never)
      └── Module AGENTS.md → domain-specific expert (copy-from tables, DI tokens)
```

**Why this is brilliant:** An LLM doesn't need to understand the whole system. It reads the Task Router, follows the pointers, and gets exactly the context it needs. No RAG, no embeddings, no vector search — the retrieval index IS the filesystem.

Every AGENTS.md follows the same template:
- **Always** — invariant rules (autonomy boundary)
- **Ask First** — pause and check with human
- **Never** — hard prohibitions
- **Validation Commands** — exact shell commands to verify changes
- **Copy-From Tables** — "when you need X, copy from Y"

### 3. Spec-Driven Development with Hard Gates

264 total specs. The spec-writing skill enforces:

- **Open Questions Gate** — HARD STOP until critical unknowns are answered (no building on bad assumptions)
- **"Martin Fowler" Review Persona** — 9 architectural heuristics including "Singularity Law" (singular naming), "Undo Contract" (undo must be as detailed as execute), "Canonical Mechanisms" (use framework primitives)
- **Market Research Requirement** — every spec must reference an open-source market leader and document what was adopted vs. rejected
- **Compliance Gate** — formal checklist including encryption maps, DS rules, frontend architecture contract

Specs move from `specs/` to `specs/implemented/` when deployed. The audit trail is complete.

### 4. Lessons.md — Prescriptive Institutional Memory

94KB, 971 lines, 60+ lessons. Each follows:

```
## [Title]
Context: What was happening
Problem: What went wrong
Rule: The prescriptive rule going forward
Applies to: Exact files/modules affected
```

This isn't "we learned X" — it's "the Rule is Y, applying to Z files." The `om-auto-create-pr` skill explicitly reads `lessons.md` before coding. **Lessons feed back into agent behavior.**

Best examples:
- "Never guard sensitive routes with `requireRoles` on mutable role names" (security)
- "MikroORM 6 does NOT generate UUIDs client-side" (ORM gotcha)
- "Store global event bus in `globalThis` to survive module duplication in dev" (HMR subtlety)

### 5. Tiered Skill System — Context Window as Public Good

39 skills organized into 5 tiers:

| Tier | Count | Loaded by default? |
|------|-------|-------------------|
| Core | 15 | Yes |
| Automation | 19 | No |
| Security | 2 | No |
| Migration | 1 | No |
| Infra | 2 | No |

**The key insight:** "The context window is a public good." Only 15 core skills load by default. The rest are opt-in. This prevents context bloat and keeps the agent focused.

The skill lifecycle is complete:
- `om-spec-writing` → write the spec
- `om-pre-implement-spec` → readiness analysis
- `om-implement-spec` → dispatch subagents per phase
- `om-auto-create-pr` → open the PR with full audit trail
- `om-auto-review-pr` → self-review the PR
- `om-code-review` → architectural review
- `om-ds-guardian` → design system compliance
- `om-merge-buddy` → classify merge readiness
- `om-auto-update-changelog` → changelog entry
- `om-sync-merged-pr-issues` → post-merge cleanup

### 6. Convention-Over-Configuration with Auto-Discovery

17 optional module files, all auto-discovered. Drop the right file in the right place and the framework picks it up:

```
modules/<name>/
├── index.ts          # metadata
├── acl.ts            # RBAC features
├── setup.ts          # tenant init
├── events.ts         # typed events
├── search.ts         # search config
├── ai-agents.ts      # AI agent definitions ← FIRST-CLASS
├── ai-tools.ts       # AI tool packs ← FIRST-CLASS
├── api/              # REST endpoints (auto-discovered)
├── backend/          # admin pages (auto-discovered)
├── subscribers/      # event subscribers (auto-discovered)
├── workers/          # queue workers (auto-discovered)
└── widgets/          # cross-module UI injection
```

`ai-agents.ts` and `ai-tools.ts` are convention files at the same level as `events.ts` and `acl.ts`. AI isn't an add-on — it's a first-class module concern.

### 7. Backward Compatibility Contract — 14 Frozen Surfaces

A 500+ line contract defining exactly what's FROZEN, STABLE, or ADDITIVE-ONLY:

- Auto-discovery file names → FROZEN
- Event IDs → FROZEN
- Widget spot IDs → FROZEN
- ACL feature IDs → FROZEN
- AI agent/tool IDs → FROZEN
- Database schema → ADDITIVE-ONLY
- Import paths → STABLE (re-export on move)
- Function signatures → STABLE
- DI service names → STABLE

**Why this matters for AI:** An LLM knows exactly what it can and cannot change. No ambiguity. The deprecation protocol (add `@deprecated`, provide bridge, wait one minor version) is explicit.

### 8. Design System as Enforceable Law

Not guidelines — **laws** with enforcement:

- 336 lines of prescriptive rules in decision-tree format
- 285KB companion component reference
- Dedicated `om-ds-guardian` skill (core tier, loaded by default)
- Automated migration scripts (`ds-migrate-colors.sh`, `ds-migrate-typography.sh`)
- Health check script that generates sprint-level reports
- Boy Scout Rule: "When modifying a file with DS violations, MUST migrate touched lines"

Every section pairs "NEVER do X" with "ALWAYS do Y":
- NEVER use `text-red-*` → ALWAYS use `text-status-error-text`
- NEVER use arbitrary values → ALWAYS use DS scale
- NEVER add `dark:` overrides on semantic tokens → they already handle dark mode

### 9. Self-Review + Auto-Review Loop

PRs created by the agent go through a multi-stage review pipeline:

1. Agent builds the feature (using `om-auto-create-pr`)
2. Agent self-reviews using code-review checklist
3. Agent opens PR with full summary comment (changes, verification steps, risk analysis, rollback plan)
4. Agent runs `om-auto-review-pr` against its own PR
5. Agent fixes any findings from the review
6. Human reviews the final, agent-reviewed PR

### 10. AI-Specific CI Checks

Custom CI scripts that catch the mistakes AI coding assistants make most often:

| Check | What It Catches |
|-------|----------------|
| `time-bomb-scanner` | Hardcoded date literals in tests that will become flaky |
| `check-client-boundaries` | `'use client'` at page roots violating RSC architecture |
| `i18n-check-hardcoded` | Hardcoded user-facing strings instead of translation keys |
| `i18n-check-sync` | Translation dictionary drift across locales |
| `template-sync` | `create-app` template drift after AI edits app files |
| `skills-tiers-lint` | Unregistered skills without tier assignments |
| `check-dep-versions` | Dependency version conflicts from AI-added packages |

---

## The Underlying Philosophy

What makes Open Mercato's approach coherent is a consistent set of principles:

1. **Prescriptive over permissive** — "MUST" and "NEVER", not "should" and "avoid"
2. **Convention over configuration** — auto-discovery eliminates registration boilerplate
3. **Progressive disclosure** — root → package → module, each level adds detail
4. **Feedback loops** — lessons → rules → skills → implementation → new lessons
5. **Resumability** — every long-running workflow has checkpoint/resume capability
6. **Isolation** — worktrees for builds, ephemeral envs for tests, tiers for skills
7. **Auditability** — run plans, PR summaries, spec changelogs, tracking links
8. **Context budget** — treat the LLM context window as a shared resource

---

## What They Could Do Better

No system is perfect. A few observations:

1. **Complexity cost** — 780 files in `.ai/` is a lot to maintain. If the rate of lessons/specs/skills outpaces curation, it becomes noise.
2. **Spec size** — some specs are 175KB. That's past what an LLM can process in one read. The progressive disclosure principle could apply to specs too.
3. **No automated spec-to-code traceability** — specs move to `implemented/` manually. A CI check that validates "spec says X, code does Y" would close the loop.
4. **Skill testing** — skills are procedural guides, not tested code. A skill that gives bad advice has no CI gate until it produces a failing PR.
