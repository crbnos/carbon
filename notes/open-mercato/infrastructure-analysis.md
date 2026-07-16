# Open Mercato — Infrastructure & Developer Experience Analysis

> What makes their developer infrastructure LLM-ready, and what can Carbon learn from it.

---

## 1. Executive Summary

Open Mercato is an open-source "AI-Engineering Foundation Framework" — a Next.js 16 / TypeScript monorepo that positions itself not as a CRM/ERP but as the **structural layer that makes AI-generated code land correctly**. Their thesis: code assistants can write code, but they can't decide where it goes, how it layers, or whether it stays consistent across a 30-person team. Open Mercato provides the conventions, the guard rails, and the agent skills to solve that problem.

Their developer infrastructure is unusually mature for an open-source project. They've built a complete system where LLMs don't just *use* the codebase — they are first-class participants in it, with 44 purpose-built skills, 100+ design specs, 35 AGENTS.md files, and CI pipelines that validate AI-specific concerns (skill tier assignments, time-bomb test literals, client boundary violations, i18n sync).

---

## 2. The `.ai/` Directory — The AI Knowledge Base

This is the most distinctive piece of their infrastructure. The `.ai/` directory is a structured knowledge base co-located with the source code:

| Path | Count | Purpose |
|------|-------|---------|
| `.ai/specs/` | 100+ | Date-prefixed design specs (`YYYY-MM-DD-title.md`) with changelogs |
| `.ai/skills/` | 44 | Claude Code / Codex skills with tiered installation |
| `.ai/qa/` | — | Integration test infrastructure (Playwright configs, scenarios) |
| `.ai/lessons.md` | 94KB | Accumulated pitfalls and lessons learned |
| `.ai/ds-rules.md` | 19KB | Design system rules for AI agents |
| `.ai/ui-components.md` | 284KB | Complete UI component reference |
| `.ai/time-bomb-allowlist.json` | — | Allowlist for the time-bomb test scanner |

### Spec-Driven Development

Every significant feature starts as a spec in `.ai/specs/` before code is written. Specs use a `{YYYY-MM-DD}-{title}.md` naming convention and include:
- Design decisions
- Migration & backward compatibility sections
- Dated changelogs tracking evolution
- Phase-by-phase implementation plans

This creates a **reproducible audit trail** — both for human reviewers and for AI agents that need to understand *why* code exists, not just *what* it does. The `om-implement-spec` skill can read a spec and dispatch subagents to implement each phase with code-review compliance built in.

### Tiered Skill Installation

Skills are organized into tiers via `.ai/skills/tiers.json`:

| Tier | Description | Skills |
|------|-------------|--------|
| `core` | Daily-driver skills, installed by default | 15 skills (code review, DS guardian, spec writing, implementation, testing, migrations) |
| `automation` | PR/issue automation, opt-in | 19 skills (auto-create-pr, auto-review, merge buddy, QA scenarios) |
| `security` | Security auditing, opt-in | 2 skills |
| `migration` | One-shot version migrations | 1 skill |
| `infra` | Rare/special-case | 2 skills (devcontainer maintenance, integration builder) |

The `install-skills.sh` script creates per-skill symlinks under `.claude/skills/` and `.codex/skills/`. A CI workflow (`skills-tiers-lint.yml`) ensures every skill folder has a tier assignment — you can't land a new skill without categorizing it.

**Key insight**: They treat AI skills as first-class versioned artifacts with the same rigor as npm packages — tiered, validated in CI, symlinked for multiple AI harnesses.

---

## 3. The AGENTS.md Network — Distributed Context for AI

This is perhaps their most impactful pattern. They maintain **35 AGENTS.md files** distributed throughout the codebase:

```
AGENTS.md (root — 344 lines, Task Router table)
├── packages/core/AGENTS.md
│   └── packages/core/src/modules/customers/AGENTS.md
│   └── packages/core/src/modules/sales/AGENTS.md
│   └── packages/core/src/modules/auth/AGENTS.md
│   └── ... (12+ module-level AGENTS.md)
├── packages/ui/AGENTS.md
│   └── packages/ui/src/backend/AGENTS.md
├── packages/shared/AGENTS.md
├── packages/ai-assistant/AGENTS.md
├── packages/search/AGENTS.md
├── packages/cli/AGENTS.md
├── packages/events/AGENTS.md
├── packages/cache/AGENTS.md
├── packages/queue/AGENTS.md
├── packages/webhooks/AGENTS.md
└── .ai/qa/AGENTS.md
```

### The Task Router Pattern

The root AGENTS.md contains a **Task Router** — a large lookup table mapping task descriptions to the specific AGENTS.md files that contain relevant guidance. This is explicitly designed for AI agents:

> "IMPORTANT: Before any research or coding, match the task to the root AGENTS.md Task Router table. A single task often maps to **multiple rows** — for example, 'add a new module with search' requires both the Module Development and Search guides."

Each row maps a human-readable task description (e.g., "Building CRUD API routes, adding OpenAPI specs") to the specific guide files. The AGENTS.md files at each level contain:
- Local architecture and conventions
- Import paths (treated as public API — see backward compat)
- Validation commands
- Anti-patterns with explanations

**Why this matters for LLMs**: This is essentially a **retrieval-augmented context system** baked into the filesystem. An AI agent navigating the repo doesn't need to explore — it looks up the Task Router, reads the relevant AGENTS.md files, and has all the context it needs. The information is always fresh because it lives in the repo, not in a separate knowledge base.

---

## 4. Backward Compatibility Contract — The AI Safety Net

`BACKWARD_COMPATIBILITY.md` is a 500+ line contract that defines **14 categories of stable/frozen surfaces**:

| Category | Status | Example |
|----------|--------|---------|
| Auto-Discovery File Conventions | FROZEN | `index.ts`, `acl.ts`, `setup.ts`, `ce.ts`, etc. — names and exports are immutable |
| Type Definitions & Interfaces | STABLE | Required fields on `Module`, `ModuleInfo`, `EventDefinition`, etc. cannot be removed |
| Function Signatures | STABLE | `makeCrudRoute`, `createModuleEvents`, `findWithDecryption`, etc. |
| Event IDs | FROZEN | Published event IDs are consumed by subscribers and workflow triggers |
| Widget Injection Spot IDs | FROZEN | Renaming silently breaks all modules targeting that spot |
| API Route URLs | STABLE | External tools depend on URL patterns |
| Database Schema | ADDITIVE-ONLY | Never rename/remove columns, never narrow types |
| DI Service Names | STABLE | Renaming breaks all resolvers |
| ACL Feature IDs | FROZEN | Stored in database role configurations |
| AI Agent/Tool/Override IDs | FROZEN/STABLE | Referenced by module code, generated registries, tenant overrides |
| Import Paths | STABLE | If moved internally, old path must be re-exported with `@deprecated` |
| Generated File Contracts | STABLE | Generator output shapes must remain compatible |
| CLI Commands | STABLE | Cannot rename or remove existing commands |
| Notification Type IDs | FROZEN | Referenced by subscribers and stored in DB |

The deprecation protocol is strict:
1. Never remove in a single release
2. Add `@deprecated` JSDoc with migration guidance
3. Provide a bridge (re-export, accept old signature, etc.) for at least one minor version
4. Any PR modifying a contract surface MUST reference a spec with a "Migration & Backward Compatibility" section

**Why this matters for LLMs**: When an AI agent generates code, it has a clear, machine-readable reference for what it can and cannot change. The contract acts as a constraint system — the AI knows that renaming an event ID is a breaking change, that database columns are additive-only, and that import paths are public API. This prevents the most common class of AI-generated regressions.

---

## 5. Build Pipeline — Turborepo + Custom Orchestration

### Monorepo Structure

```
open-mercato/
├── apps/
│   ├── mercato/          (Next.js 16 main app)
│   └── docs/             (Documentation site)
├── packages/             (21 packages)
│   ├── ai-assistant/     (MCP tools, agent definitions)
│   ├── core/             (Module system, CRUD, DI, events)
│   ├── shared/           (Utilities, types, i18n)
│   ├── ui/               (Design system, CrudForm, DataTable)
│   ├── cli/              (Code generators, migrations)
│   ├── create-app/       (Scaffolding tool — `npx create-mercato-app`)
│   ├── search/           (Meilisearch integration)
│   ├── events/           (Event bus, DOM Event Bridge)
│   ├── cache/            (Tag-based caching)
│   ├── queue/            (Background workers)
│   └── ... (12 more)
└── external/
    └── official-modules/ (Git submodule for community modules)
```

### Turbo Configuration

`turbo.json` defines tasks with intelligent caching:
- **Cached**: `build` (with `generated/**` inputs, `dist/**` outputs), `typecheck`
- **Uncached**: `dev`, `watch`, `test`, `generate`, `db:generate`, `db:migrate`
- **Persistent**: `start`, `dev`, `watch`, `mcp:dev`, `mcp:serve`
- **Concurrency**: 32 (high parallelism for watch tasks)

The build has a deliberate double-build pattern: `build:packages → generate → build:packages → build:app`. The generator discovers all modules and produces registries that the second build then compiles.

### Custom Dev Orchestration

The `scripts/dev.mjs` (55KB!) is a sophisticated development orchestrator that:
- Manages database URL detection and creation
- Runs greenfield initialization
- Spawns Turbo watchers for 14+ packages
- Serves a splash screen with dev status
- Handles ephemeral environments for CI

**`yarn dev:greenfield`** is noteworthy — a single command that installs deps, builds everything, seeds the database, and starts the dev server. This is explicitly designed for zero-friction onboarding, whether by a human or an AI agent in a devcontainer.

### Package Management

- **Yarn 4.12.0** (Modern PnP-capable, using `node-modules` nodeLinker for Docker compat)
- **Node.js 24.x** required (leading-edge)
- **corepack** for deterministic package manager versions
- Extensive `resolutions` block (35+ overrides) for dependency hygiene

---

## 6. CI/CD Pipeline — 8 Workflows

### Primary CI (`ci.yml`) — The Main Gate

A sophisticated multi-stage pipeline with intelligent scope detection:

```
prepare (build + scope detection)
├── lint (parallel, no build dependency)
├── audit-scope → audit (conditional on dependency file changes)
├── test (typecheck + unit tests, scoped to changed packages on PRs)
├── ephemeral-integration (Playwright, 15 shards on push / 1 shard on PR)
│   └── merge-coverage (combines shard reports)
└── docker-build (validates all Dockerfiles)
```

**Smart integration sharding**: On pushes to protected branches, integration tests run across 15 parallel shards (~6 min wall time vs ~45 min serial). On PRs, a scope detector identifies which modules changed and runs only affected tests in a single shard.

**Scope detection logic** (in `prepare`):
- If shared packages changed (`packages/shared/`, `packages/ui/`, etc.) → full 15-shard suite
- If only module-specific paths changed → single shard with `OM_INTEGRATION_MODULES` filter
- If only CI/docs/scripts changed → skip integration entirely

**Build artifact sharing**: The `prepare` job builds once and uploads artifacts (package dist files + Next.js app build). All 15 integration shards download and reuse these — saving ~24 min of redundant builds.

**AI-specific CI checks** (run in the `test` job):
- `check:dep-versions` — dependency version conflicts
- `i18n:check-sync` — i18n dictionary synchronization
- `check:time-bombs:fail` — scans test files for hardcoded date literals that will cause flaky failures when they elapse (HIGH severity = future date asserted as valid → will flip to failing)
- `check:client-boundaries` — ensures Next.js App Router pages don't use `'use client'` at page roots beyond a configurable line count

### Merge Gate (`merge-gate.yml`)

Label-based merge-readiness gate enforced via branch protection:
- `needs-qa` without `qa-approved` → blocked (self-QA exception documented)
- `qa-failed` → blocked
- `do-not-merge` / `blocked` → hard blocks
- `needs-qa` + `skip-qa` → contradictory intent, blocked

### Snapshot Releases (`snapshot.yml`)

Every push to `develop` and every PR publishes snapshot npm packages:
- Unique version per commit
- `develop` channel for the moving target
- PR comments with install instructions
- **Standalone app integration test**: After publishing, scaffolds a fresh `create-mercato-app`, installs the just-published snapshot, boots the app, and runs Playwright tests against it. This validates the entire standalone-app lifecycle end-to-end.

### QA Environment Management

- `qa-deploy.yml` — Deploy any branch to QA slots (qa1–qa4) via Dokploy
- `qa-stop-on-merge.yml` — Automatically stops the QA slot when a PR is merged/closed (detects slot from PR labels, validates the running image matches before stopping)
- `dev-deploy.yml` — One-click deploy to dev environment

### Release (`release.yml`)

Manual workflow with GitHub Environment protection:
- Requires `production` environment approval (prevents single-compromised-account publishing)
- Supports `patch`, `minor`, `major`, or `existing` bump types
- Tags, creates GitHub Release with package table, publishes to npm with provenance

### Skills Tiers Lint (`skills-tiers-lint.yml`)

Triggered only on changes under `.ai/skills/**` — ensures every skill folder is registered in `tiers.json`. Fails fast with a hint pointing to the spec that defines the contract.

---

## 7. Dev Container — Zero-Install AI-Ready Environment

The `.devcontainer/` setup is production-grade:

### Stack
- **Base**: Node 24 Debian-slim (not Alpine — requires glibc for Homebrew)
- **Services**: PostgreSQL 17 (pgvector), Redis 7, Meilisearch 1.11
- **AI Tools**: Claude Code CLI (native install with auto-updates), Homebrew for runtime tool installation
- **Dev Tools**: Python 3, Ruby, `postgresql-client`, git, curl, bash, zsh
- **VS Code Extensions**: ESLint, Prettier, Tailwind CSS, dotenv, GitLens
- **Memory**: 12 GB recommended (Turbopack + 14 watchers + workers spike to 8-10 GB)

### AI-Ready Features

The devcontainer forwards AI API keys from the host environment:
```json
"remoteEnv": {
  "ANTHROPIC_API_KEY": "${localEnv:ANTHROPIC_API_KEY}",
  "OPENAI_API_KEY": "${localEnv:OPENAI_API_KEY}",
  "GOOGLE_GENERATIVE_AI_API_KEY": "${localEnv:GOOGLE_GENERATIVE_AI_API_KEY}",
  "OM_AI_PROVIDER": "${localEnv:OM_AI_PROVIDER}",
  "OM_AI_MODEL": "${localEnv:OM_AI_MODEL}"
}
```

### Volume Strategy

Named Docker volumes for gitignored directories avoid bind-mount performance issues:
- `node_modules` — avoids 150K+ files over bind mount
- `app_next` — Next.js build cache
- `attachments_storage` — file uploads
- `pkg_*_dist` — **auto-generated** by `scripts/generate-compose-volumes.sh` (scans `packages/*/` on each rebuild)

### Lifecycle Automation
- `initializeCommand` — generates volume compose file from package scan
- `postCreateCommand` — full bootstrap (env generation, install, build, migrate/init)
- `postStartCommand` — incremental sync (install, migrate)

---

## 8. VS Code Integration

Minimal but intentional `.vscode/settings.json`:
```json
{
  "chatgpt.openOnStartup": true,
  "claudeCode.initialPermissionMode": "acceptEdits",
  "claudeCode.preferredLocation": "panel",
  "claudeCode.respectGitIgnore": true
}
```

This auto-opens AI assistants on project load and pre-configures Claude Code to accept edits in panel mode. The message is clear: AI assistance is the default workflow, not an add-on.

---

## 9. MCP Integration

`.mcp.json.example` shows a straightforward HTTP-based MCP server:
```json
{
  "mcpServers": {
    "open-mercato": {
      "type": "http",
      "url": "http://localhost:3001/mcp",
      "headers": { "x-api-key": "omk_..." }
    }
  }
}
```

The `packages/ai-assistant/` package provides:
- `registerMcpTool` for module-scoped tool registration
- `defineAiAgent` / `defineAiTool` for declarative AI agent/tool definitions
- Mutation approval flow (`prepareMutation` → pending-action card → user confirms)
- Per-tenant prompt/model/policy overrides
- Tool override system (disable/replace tools per module or tenant)
- `yarn mcp:dev` / `yarn mcp:serve` for development

---

## 10. Configuration Patterns

### Verdaccio (Local NPM Registry)

`config/verdaccio/config.yaml` provides a local npm registry for testing the `create-mercato-app` scaffolding flow:
- `@open-mercato/*` packages: anonymous publish allowed (local dev only)
- Everything else: proxied to npmjs.org
- 50MB max body size for large packages

### Registry Scripts

`scripts/registry/` contains `setup-user.sh` and `publish.sh` for local registry management, used in the `create-app` integration test flow.

---

## 11. Custom CI/DX Scripts — The Toolbox

Beyond standard lint/test/build, Open Mercato ships **custom analysis scripts** that are particularly relevant for AI-assisted development:

| Script | Purpose | AI Relevance |
|--------|---------|--------------|
| `time-bomb-scanner.mjs` | Scans test files for hardcoded date literals that will cause future CI failures | Prevents a common AI anti-pattern: generating tests with absolute dates |
| `check-client-boundaries.mjs` | Enforces Next.js App Router `'use client'` boundaries | Catches AI-generated pages that violate RSC architecture |
| `i18n-check-sync.ts` | Validates i18n dictionary synchronization across locales | Prevents AI from hardcoding strings instead of using translation keys |
| `i18n-check-hardcoded.ts` | Scans for hardcoded user-facing strings | Same as above — catches the most common AI i18n mistake |
| `i18n-check-usage.ts` | Finds unused translation keys | Cleanup tool after AI-heavy development sessions |
| `template-sync.ts` | Keeps `create-app` template aligned with app source | Prevents drift when AI edits app files without updating the scaffold template |
| `validate-skills-tiers.sh` | Ensures every skill has a tier assignment | CI gate for skill management |
| `check-dep-versions.ts` | Detects dependency version conflicts in the monorepo | Catches AI-introduced version mismatches |
| `install-skills.sh` | Tiered skill installer for Claude Code / Codex | First-class skill lifecycle management |
| `check-version-alignment.sh` | Validates package version alignment across the monorepo | Release safety |
| `profile-dev-rss.mjs` | Memory profiling for the dev server | Performance monitoring |
| `promote-to-official-module.mjs` | Promotes an in-repo module to the official-modules submodule | Module lifecycle management |

---

## 12. Contributing Guidelines

`CONTRIBUTING.md` is concise but prescriptive:
- **Branch model**: `main` (release-ready), `develop` (nightly), `feat/<name>` topics
- **Spec-first**: Check `.ai/specs/` before implementing, create/update spec if missing
- **PRs**: Against `develop`, describe user impact, ensure CI green
- **No merge from AI** — the human gate is always maintained

The `om-code-review` skill + `review-checklist.md` codifies the review standards that AI agents must meet before a phase is considered done.

---

## 13. What Makes This "LLM-Ready" — Synthesis

### 13.1 Structured Context at Every Level

The AGENTS.md network + Task Router pattern means an AI agent never has to "explore" the codebase blindly. It reads the root Task Router, identifies which guides apply, reads those guides, and has complete context. This is **retrieval without RAG** — the retrieval index is the filesystem itself.

### 13.2 Contracts as Constraints

The backward compatibility contract converts implicit knowledge ("don't rename event IDs") into explicit, machine-readable rules. An AI agent reading `BACKWARD_COMPATIBILITY.md` knows exactly what surfaces are FROZEN vs STABLE vs ADDITIVE-ONLY, and what the deprecation protocol requires.

### 13.3 Spec-First = Reproducible AI Output

Because features start as specs with phases, acceptance criteria, and migration notes, an AI agent implementing a spec produces predictable, reviewable output. The `om-implement-spec` skill automates this: read spec → plan phase → dispatch subagents → validate against code review checklist → update spec changelog.

### 13.4 CI That Catches AI Anti-Patterns

The custom CI scripts (time-bomb scanner, client boundary checker, i18n hardcoded string detector, template sync) are specifically designed to catch the mistakes AI coding assistants make most often:
- Hardcoded dates in tests
- Hardcoded user-facing strings instead of i18n keys
- `'use client'` at page roots in App Router
- Template drift after AI-edited app files
- Dependency version conflicts from AI-added packages

### 13.5 Skills as Versioned Artifacts

44 skills with tiered installation, CI validation, and symlinks to multiple AI harnesses (Claude Code + Codex). Skills aren't prompts — they're full procedural guides with reference files, pre-flight checklists, and extension mode decisions.

### 13.6 Design System as Machine-Readable Documentation

`.ai/ds-rules.md` (19KB) and `.ai/ui-components.md` (284KB) give AI agents a complete reference for the design system. Combined with the `om-ds-guardian` skill (core tier), this means AI-generated UI stays consistent with the existing design language.

### 13.7 Lessons as Institutional Memory

`.ai/lessons.md` (94KB) is an accumulated knowledge base of pitfalls. The `om-implement-spec` skill reads this before every implementation to avoid repeating known mistakes.

---

## 14. Comparison Points for Carbon

| Aspect | Open Mercato | Carbon |
|--------|-------------|--------|
| AGENTS.md files | 35, distributed throughout codebase with Task Router | Root-level, centralized |
| AI skills | 44, tiered, CI-validated, multi-harness | Conductor inner loop, fewer explicit skills |
| Design specs | 100+ in `.ai/specs/`, date-prefixed with changelogs | Specs in `llm/outer-loop/` |
| Backward compat contract | 500+ lines, 14 categories, FROZEN/STABLE/ADDITIVE | Not formalized at this level |
| AI-specific CI checks | Time-bomb scanner, client boundary, i18n hardcoded, template sync, skill tier lint | Standard lint/test |
| Dev container | Full AI-ready setup (Claude Code, API key forwarding, auto-bootstrap) | — |
| MCP integration | Built-in MCP server, `ai-agents.ts`/`ai-tools.ts` per module, mutation approval flow | — |
| Lessons/knowledge base | `.ai/lessons.md` (94KB), `.ai/ui-components.md` (284KB) | Daily memory notes |

### Key Patterns Worth Adopting

1. **Distributed AGENTS.md with Task Router** — Instead of one large context file, place module-specific guidance next to the module and provide a routing table at the root.

2. **Backward Compatibility Contract** — Formalizing which surfaces are frozen/stable/additive prevents both human and AI regressions on the most critical interfaces.

3. **AI Anti-Pattern CI Checks** — Time-bomb scanning and hardcoded string detection are cheap to implement and catch real AI-generated bugs.

4. **Tiered Skill Installation** — As Carbon's skill count grows, a tier system (core/automation/security/migration) with CI validation would prevent skill sprawl.

5. **Spec-Driven Implementation Skills** — The `om-implement-spec` pattern (read spec → plan → dispatch subagents → validate → update spec) is directly applicable to Carbon's conductor loop.

---

*Analysis based on the `open-mercato` repository at `/tmp/open-mercato`, focusing on developer infrastructure, CI/CD, and LLM-readiness patterns.*
