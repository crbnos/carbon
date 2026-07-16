# Open Mercato — Packages Architecture Analysis

## Executive Summary

Open Mercato's package architecture is a masterclass in LLM-friendly monorepo design. It uses a **three-tier AGENTS.md hierarchy** (root → package → module), **strict dependency layering**, and **exhaustive inline context** to make every part of the system self-documenting for AI agents. The architecture is not merely LLM-aware; it is LLM-*native* — designed from the ground up so that an AI agent can discover, understand, and safely modify any part of the system without human hand-holding.

---

## 1. Package Map

### Infrastructure Packages (zero domain knowledge)

| Package | Purpose | AGENTS.md? |
|---------|---------|------------|
| `shared` | Cross-cutting utilities, types, DSL helpers, i18n, encryption, DI, data engine | ✅ |
| `events` | Event bus (ephemeral + persistent), DOM Event Bridge (SSE) | ✅ |
| `cache` | Strategy-based caching (memory / SQLite / Redis) | ✅ |
| `queue` | Background job processing (local / BullMQ) | ✅ |
| `search` | Multi-strategy search (fulltext / vector / tokens) | ✅ |
| `cli` | Generators, migrations, scaffolding, CLI commands | ✅ |

### Domain Packages

| Package | Purpose | AGENTS.md? |
|---------|---------|------------|
| `core` | All core business modules (40+ modules) | ✅ (package + 12 module-level) |
| `ui` | UI primitives, DataTable, CrudForm, portal shell, backend components | ✅ |
| `ai-assistant` | AI agents, MCP tools, model factory, command palette | ✅ |

### Vertical/Feature Packages

| Package | Purpose | AGENTS.md? |
|---------|---------|------------|
| `onboarding` | Setup wizards, tenant provisioning | ✅ |
| `webhooks` | Outbound/inbound webhook delivery (Standard Webhooks) | ✅ |
| `content` | Static content pages (legal, terms) | ✅ |
| `checkout` | Checkout flows | ✅ |
| `enterprise` | Commercial enterprise-only overlays | ✅ |
| `create-app` | Standalone app template + Verdaccio testing | ✅ |

### Provider Packages (external integration adapters)

| Package | Purpose | AGENTS.md? |
|---------|---------|------------|
| `channel-gmail` | Gmail email channel integration | ✅ |
| `channel-imap` | IMAP email channel integration | ✅ |
| `gateway-stripe` | Stripe payment gateway | No dedicated AGENTS.md |
| `sync-akeneo` | Akeneo PIM data sync | No dedicated AGENTS.md |
| `storage-s3` | S3 file storage | No dedicated AGENTS.md |
| `scheduler` | Task scheduling | No dedicated AGENTS.md |

---

## 2. The Three-Tier AGENTS.md Hierarchy

This is the most architecturally significant pattern in the entire codebase.

### Tier 1: Root `AGENTS.md` — The Task Router

The root AGENTS.md acts as a **universal dispatcher**. Its centerpiece is a giant Task Router table that maps any conceivable task to the exact guide(s) an agent should read:

```
| Task                              | Guide                                    |
|-----------------------------------|------------------------------------------|
| Building CRUD API routes          | packages/core/AGENTS.md → API Routes     |
| Configuring search                | packages/search/AGENTS.md                |
| Adding background workers         | packages/queue/AGENTS.md                 |
```

**Why this is LLM-critical:** An LLM doesn't need to understand the whole system. It needs to know *where to look*. The Task Router eliminates guesswork — the agent reads one table and knows which 1-3 files contain everything it needs.

### Tier 2: Package `AGENTS.md` — The Bounded Context

Each package has its own AGENTS.md that is a complete working manual for that bounded context. Every one follows the same template:

1. **Always** — invariant rules (MUST do)
2. **Ask First** — things requiring human approval
3. **Never** — hard prohibitions
4. **Validation Commands** — exact commands to verify changes
5. **Detailed guidance** — patterns, contracts, code examples

### Tier 3: Module `AGENTS.md` — The Domain Expert

Inside `packages/core/src/modules/`, 12 individual modules have their own AGENTS.md files:

- `auth`, `catalog`, `customers`, `sales`, `workflows`
- `integrations`, `data_sync`, `progress`
- `attachments`, `currencies`, `customer_accounts`, `staff`

Each module AGENTS.md is **self-contained** — it covers data model constraints, key directories, event patterns, DI services, and reference files to copy from.

### The Hierarchy's Effect

An agent working on "add search to the catalog module" would read:
1. Root AGENTS.md Task Router → points to `packages/search/AGENTS.md` + `packages/core/src/modules/catalog/AGENTS.md`
2. `packages/search/AGENTS.md` — complete search integration guide with templates
3. `packages/core/src/modules/catalog/AGENTS.md` — catalog-specific events, entities, pricing rules

This is **progressive disclosure for LLMs** — the agent gets exactly the context it needs, no more.

---

## 3. Dependency Layering — The Inverted Pyramid

The package dependency graph is strictly layered:

```
                         ┌─────────┐
                         │  shared  │  ← zero domain deps
                         └────┬────┘
                   ┌──────────┼──────────┐
                   │          │          │
              ┌────┴───┐ ┌───┴──┐ ┌────┴───┐
              │ events │ │cache │ │ queue  │
              └────┬───┘ └───┬──┘ └────┬───┘
                   │         │         │
              ┌────┴─────────┴─────────┴────┐
              │           search            │
              └──────────────┬──────────────┘
                             │
              ┌──────────────┴──────────────┐
              │            core             │
              │  (40+ business modules)     │
              └──────────────┬──────────────┘
                             │
         ┌───────────┬───────┴────────┬──────────┐
         │           │               │           │
    ┌────┴───┐  ┌────┴────┐  ┌──────┴──┐  ┌────┴────┐
    │   ui   │  │ai-assist│  │webhooks │  │checkout │
    └────────┘  └─────────┘  └─────────┘  └─────────┘
                             │
         ┌───────────┬───────┴────────┬──────────┐
         │           │               │           │
    ┌────┴────┐ ┌────┴────┐  ┌──────┴──┐  ┌────┴────┐
    │gmail-ch │ │imap-ch  │  │stripe-gw│  │akeneo   │
    └─────────┘ └─────────┘  └─────────┘  └─────────┘
```

**Why this matters for LLMs:**
- **`shared` never imports from domain packages** — explicitly stated in its AGENTS.md. This means an agent modifying `shared` can reason about the change without understanding any business logic.
- **Provider packages import from integration contracts, never vice versa** — the `integrations` module AGENTS.md states "Never import from provider modules." This means adding a new provider (e.g., a Shopify sync adapter) is a leaf-node change with zero blast radius.
- **`core` modules never create direct ORM relationships between each other** — they communicate through events, DI, and widget injection. This is critical for LLMs: modifying one module can't cascade foreign-key breakage to another.

---

## 4. What Makes This Architecture LLM-Friendly

### 4.1 Exhaustive "Copy From" Reference Tables

The `customers` module AGENTS.md is explicitly labeled as **"the reference CRUD module"** and provides a table:

```
| When you need          | Copy from                                |
|------------------------|------------------------------------------|
| CRUD API route         | api/people/route.ts                      |
| Undoable commands      | commands/people.ts                       |
| Backend list page      | backend/customers/people/page.tsx         |
| Search config          | search.ts                                |
```

This is **template-driven development for LLMs**. Instead of asking the agent to invent patterns, it tells the agent exactly which file to copy and adapt. The root AGENTS.md also has such tables, as does the `progress` module.

### 4.2 Checklists That Replace Tribal Knowledge

The `customers` module has a "Module Files Checklist — All MUST Be Present":

```
acl.ts, ce.ts, di.ts, events.ts, index.ts, notifications.ts, search.ts, setup.ts, analytics.ts, vector.ts
```

The `search` module ends with:

```
## Checklist: Add Search to a New Module
- [ ] Create search.ts in the module directory
- [ ] Export searchConfig with correct entityId
- [ ] Define fieldPolicy for fulltext
- [ ] Define buildSource for vector search
...
```

This is how you encode tribal knowledge for an LLM. A human team lead would say "make sure you add the search config" — the checklist makes that implicit knowledge explicit and exhaustive.

### 4.3 Strategy Tables for Decision Points

Every AGENTS.md that involves choosing between approaches provides a decision table:

**Cache:**
```
| Strategy | When to use                                      |
|----------|--------------------------------------------------|
| Memory   | Development and single-process apps               |
| SQLite   | Single-server production deployments              |
| Redis    | Multi-server production or latency-sensitive paths|
```

**Queue concurrency:**
```
| Worker type          | Recommended | Rationale                    |
|----------------------|-------------|------------------------------|
| I/O-bound            | 5–10        | Network latency allows it    |
| CPU-bound            | 1–2         | Avoid blocking event loop    |
| Database-heavy       | 3–5         | Balance with connection pool  |
```

**Search strategies:**
```
| Strategy  | When to use                              | Backend required |
|-----------|------------------------------------------|------------------|
| Fulltext  | Fast, typo-tolerant search               | Meilisearch      |
| Vector    | Semantic/meaning-based search            | Embedding API    |
| Tokens    | Baseline keyword search that always works | PostgreSQL       |
```

These tables are **decision-making shortcuts for LLMs**. Instead of reasoning from first principles about caching strategy, the agent matches its context to a row in the table.

### 4.4 Explicit Safety Boundaries (Always / Ask First / Never)

Every AGENTS.md opens with three sections that form a **behavioral contract**:

- **Always** — invariant rules the agent must follow
- **Ask First** — things that require pausing and asking the human
- **Never** — hard prohibitions that must not be violated

This is the most important LLM-friendly pattern in the entire architecture. It gives the agent:
- **Autonomy** within the "Always" rules (no need to ask permission)
- **Awareness** of when to stop and check with a human
- **Guardrails** that prevent the most dangerous mistakes

Example from `events`:
```
Always: MUST declare events in the emitting module's events.ts
Ask First: Ask before changing persistent delivery semantics
Never: Never emit undeclared events
```

### 4.5 Inline Code Examples With Context

The AGENTS.md files don't just reference code — they embed working examples with enough context to be copy-pasted. The `search` AGENTS.md includes complete `search.ts` templates. The `ai-assistant` AGENTS.md includes full agent and tool registration examples. The `events` AGENTS.md shows the complete subscriber contract.

This matters because LLMs work best when they can pattern-match against concrete examples, not abstract descriptions.

### 4.6 Architecture Diagrams in ASCII

The `ai-assistant` AGENTS.md includes an ASCII architecture diagram showing the full stack:

```
Frontend (Command Palette) → POST /api/chat (SSE) → OpenCode Client → OpenCode Server → MCP HTTP Server
```

The `workflows` AGENTS.md includes the execution flow:

```
Definition → startWorkflow() → Instance → executeWorkflow() loop
                                              ↓
                                    stepHandler.enterStep()
```

ASCII diagrams are **LLM-native** — they're text, not images, so the model can reason about the architecture directly.

### 4.7 Cross-Reference Web

Every module AGENTS.md cross-references the package-level guides it depends on:

```
## Cross-References
- Event bus architecture: packages/events/AGENTS.md
- Queue worker contract: packages/queue/AGENTS.md
- Widget injection pattern: packages/core/AGENTS.md → Widget Injection
```

This creates a navigable knowledge graph. An agent working on workflow events can follow the pointer to `packages/events/AGENTS.md` without needing to search the filesystem.

### 4.8 DI Service Token Tables

Multiple AGENTS.md files include tables mapping DI tokens to their purpose:

```
| Token                | When to use                                    |
|----------------------|------------------------------------------------|
| workflowExecutor     | Start, advance, cancel, retry workflows        |
| stepHandler          | Enter/exit/execute individual steps             |
| activityExecutor     | Execute or enqueue activities                   |
```

This is essential for LLMs because DI containers are opaque — you can't grep for how to get a service without knowing its token name. The tables make the DI graph explicit.

### 4.9 The UMES Extension System — Composable Without Coupling

The **Unified Module Extension System (UMES)** is how modules extend each other without direct imports:

- **Widget Injection** — modules inject UI into other modules' pages via stable spot IDs
- **Event Subscribers** — modules react to other modules' events
- **Entity Extensions** — modules add fields to other modules' entities
- **Response Enrichers** — modules augment other modules' API responses
- **API Interceptors** — modules add before/after hooks to other modules' routes
- **Component Replacement** — modules override other modules' UI components

Each extension mechanism is documented with import paths, code examples, and rules. This means an LLM can add cross-module behavior by following a template, without needing to understand the target module's internals.

### 4.10 Module-Level Overrides — Safe Customization

The `modules.ts` unified overrides system lets downstream apps replace or disable any contract a module presents:

```typescript
{
  id: 'example',
  overrides: {
    ai: { agents: { 'catalog.catalog_assistant': null } },
    routes: { 'POST /api/orders': null },
    widgets: { 'sales.detail:tabs': null },
  }
}
```

This is **LLM-safe customization**: the agent doesn't need to fork or modify upstream code. It adds an override entry and the runtime handles the rest.

---

## 5. The `core` Package as a Module Container

The `core` package is the most architecturally interesting. It contains **40+ modules** in `src/modules/`, each following a standardized file structure:

```
src/modules/<module>/
├── acl.ts          # RBAC features
├── ce.ts           # Custom entities
├── di.ts           # DI registrations
├── events.ts       # Typed events
├── index.ts        # Module metadata
├── notifications.ts # Notification types
├── search.ts       # Search config
├── setup.ts        # Tenant init
├── api/            # REST endpoints (auto-discovered)
├── backend/        # Admin pages (auto-discovered)
├── commands/       # Undoable domain operations
├── components/     # React components
├── data/           # ORM entities + validators
├── frontend/       # Public pages (auto-discovered)
├── i18n/           # Translations
├── lib/            # Business logic
├── subscribers/    # Event subscribers (auto-discovered)
├── widgets/        # Cross-module UI injection
└── workers/        # Queue workers (auto-discovered)
```

**Every directory is auto-discovered by the generator.** The LLM doesn't need to register anything manually — it creates a file in the right directory, runs `yarn generate`, and the system picks it up.

This is **convention-over-configuration taken to its logical extreme for LLMs**: the agent only needs to know the directory layout to add any type of functionality.

---

## 6. Provider Package Isolation

External integration providers are isolated into their own npm workspace packages:

```
packages/
├── gateway-stripe/     # Stripe payment gateway
├── channel-gmail/      # Gmail channel
├── channel-imap/       # IMAP channel
├── sync-akeneo/        # Akeneo PIM sync
├── storage-s3/         # S3 storage
```

The `integrations` module AGENTS.md states the golden rule: **"Never import from provider modules — integrations module is generic; providers import from integrations, not vice versa."**

This means:
1. Adding a new provider is a leaf-node operation with zero blast radius
2. An LLM can build a complete provider by following the `integrations` AGENTS.md without understanding any other provider
3. Provider code can't accidentally break core business logic

---

## 7. The UI Package — A Design System for LLMs

The `ui` AGENTS.md is extraordinary. It includes:

1. **A complete component quick-reference table** mapping every UI need to its component and import path (40+ entries)
2. **Critical Primitive Rules** — 6 hard rules like "NEVER use raw `<button>`" and "Same-row buttons MUST share `size`"
3. **CrudForm Guidelines** — complete form-building patterns with optimistic locking, validation, and custom field integration
4. **DataTable Guidelines** — exhaustive table-building guide including portal usage, bulk actions, and export
5. **Portal Extension** — complete portal page building system with hooks, shell, injection spots

The companion `.ai/ds-rules.md` and `.ai/ui-components.md` files extend this with design-system tokens, typography, and spacing rules.

This level of detail means an LLM can build a complete, design-system-compliant UI page by reading one file.

---

## 8. The AI Assistant Package — Meta-LLM Architecture

The `ai-assistant` package is the most self-referential — it's an LLM-friendly guide to building systems that use LLMs. It covers:

1. **Agent registration** with `defineAiAgent()` — typed agent definitions with system prompts, allowed tools, mutation policies
2. **Tool registration** with `defineAiTool()` — typed tools with Zod schemas, RBAC, and mutation gates
3. **Model resolution** — a detailed priority chain for how the system picks which LLM model to use
4. **Override system** — how to replace, extend, or disable agents/tools from downstream modules
5. **Mutation approval lifecycle** — how AI-proposed mutations go through human approval before execution

The architecture diagram, provider configuration table, and model resolution chain give an LLM everything it needs to add a new AI agent to any module.

---

## 9. Connection Budget Pattern — System-Wide Resource Awareness

One of the most sophisticated patterns is the **connection budget** documented across `queue` and `shared`:

```
web_pool_max + worker_pool_max + scheduler/overhead ≤ Postgres max_connections
```

Both the `queue` AGENTS.md and `shared` AGENTS.md reference this invariant. The queue worker system even auto-fits concurrency to the budget at startup and logs the resolved plan.

This pattern — documenting system-wide resource constraints inline where they affect local decisions — is critical for LLMs. An agent adding a new worker with concurrency 10 would see the budget warning and know to check the total.

---

## 10. Patterns Worth Stealing for Carbon

### 10.1 The Task Router Table
A single lookup table at the root that maps any task to 1-3 specific guides. This eliminates the "which AGENTS.md do I read?" problem.

### 10.2 Always / Ask First / Never
A behavioral contract at the top of every context file. Gives the agent clear autonomy boundaries.

### 10.3 Copy-From Reference Tables
Explicit "when you need X, copy from Y" tables that turn development into template adaptation.

### 10.4 Module File Checklists
Exhaustive lists of required files that replace tribal knowledge about "what a complete module looks like."

### 10.5 Strategy Decision Tables
When-to-use tables for every technology choice, so the agent doesn't have to reason from first principles.

### 10.6 DI Token Tables
Making the dependency injection graph explicit in documentation, since DI containers are opaque to code search.

### 10.7 Validation Commands Section
Every AGENTS.md includes the exact shell commands to verify changes. No guesswork about "how do I check if this is correct?"

### 10.8 Cross-Reference Pointers
Explicit links between related AGENTS.md files, creating a navigable knowledge graph.

### 10.9 ASCII Architecture Diagrams
Text-based diagrams that LLMs can reason about directly, unlike image diagrams.

### 10.10 Convention-Over-Configuration with Auto-Discovery
Standard directory layouts where the generator discovers files automatically, so the LLM only needs to put files in the right place.

---

## 11. Scale of the Documentation Investment

| Level | Count | Avg. Size | Total |
|-------|-------|-----------|-------|
| Root AGENTS.md | 1 | ~12KB | ~12KB |
| Package AGENTS.md | 17 | ~8KB avg (ui: ~35KB, ai-assistant: ~65KB) | ~150KB+ |
| Module AGENTS.md | 12 | ~5KB avg | ~60KB |
| Supporting .ai/ files | 3+ | ~15KB avg | ~45KB+ |
| **Total** | **33+** | — | **~270KB+** |

That's roughly **270KB+ of structured LLM context** across the repo, equivalent to ~67,000 words — a full technical book. And every word is targeted at making an AI agent productive.

---

## 12. Conclusion

Open Mercato's package architecture represents the most comprehensive LLM-friendly codebase documentation I've encountered. The key insight is **progressive disclosure through hierarchical AGENTS.md files**: the root file is a dispatcher, package files are bounded-context manuals, and module files are domain-specific guides.

The architecture succeeds because it solves the three fundamental problems of LLM-assisted development:

1. **Discovery** — "Where do I look?" → Task Router table
2. **Understanding** — "How does this work?" → Inline architecture diagrams, code examples, and DI tables
3. **Safety** — "What can go wrong?" → Always/Ask First/Never contracts, checklists, and validation commands

This is not documentation for humans who happen to be using LLMs. This is **an operating system for AI-assisted software development**, designed from scratch for how LLMs consume and act on information.
