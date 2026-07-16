# Open Mercato Architecture Report
*Prepared: 2026-07-11 | Repo: https://github.com/open-mercato/open-mercato | Version: 0.6.5*

---

## TL;DR

Open Mercato is a Next.js 16 / React 19 / TypeScript monorepo ERP/CRM framework. It's technically solid — modern stack, good separation of concerns, serious infrastructure thinking (multi-tenancy, RBAC, events, queues, caching). The "entity" concept is **not custom database tables** — it's an EAV (Entity-Attribute-Value) system with JSONB document storage bolted onto a fixed schema. The module system is **inspired by but shallower than Odoo modules** — auto-discovery via file naming conventions rather than manifest-declared dependency graphs. Brad's instinct is correct: technically capable but missing the ERP depth that comes from operators who've actually run businesses on their own software.

---

## 1. Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 App Router (full-stack — API routes + server/client components) |
| Language | TypeScript throughout, zod for runtime validation |
| Database | PostgreSQL via MikroORM v7 |
| Query layer | Kysely (type-safe SQL builder, used for custom entity queries) |
| DI | Awilix (per-request container) |
| State/Cache | Tag-based cache abstraction (memory / SQLite / Redis) |
| Queue | Custom worker contract over a queue abstraction |
| Events | Internal event bus (ephemeral + persistent), SSE DOM bridge to browser |
| AI | Vercel AI SDK + OpenCode agent + MCP HTTP server (port 3001) |
| Search | Configurable fulltext/vector/token search per module |
| Frontend | React 19, TanStack Query v5, TanStack Table v8, Radix UI, Tailwind CSS |
| Monorepo | Turborepo + Yarn workspaces |
| Node | Requires Node 24.x |

The stack is clean and modern. No legacy jQuery, no PHP, no XML config files. This is a proper TypeScript engineering team.

---

## 2. Module System — How It Works

### Architecture

```
apps/
  mercato/          ← The Next.js app (thin shell, boilerplate)
    src/
      modules.ts    ← THE REGISTRY: lists all enabled modules
packages/
  core/             ← All built-in business modules
  shared/           ← Cross-cutting utilities, types, DSL
  ui/               ← Component library (forms, tables, etc.)
  ai-assistant/     ← AI assistant + MCP server
  events/           ← Event bus
  cache/            ← Cache abstraction
  queue/            ← Job queue abstraction
  search/           ← Search indexing
  webhooks/         ← Outbound/inbound webhooks
  enterprise/       ← Commercial-only overlays
  channel-gmail/    ← Gmail integration provider
  channel-imap/     ← IMAP integration provider
  gateway-stripe/   ← Stripe payment gateway
```

### Module Registration

Modules are enabled by listing them in `apps/mercato/src/modules.ts`:

```typescript
{ id: 'customers', from: '@open-mercato/core' },
{ id: 'workflows', from: '@open-mercato/core' },
{ id: 'my_custom_module', from: '@app' },  // app-local module
```

After adding a module, `yarn generate` must be run to regenerate auto-discovery registries (ephemeral generated files in `.mercato/generated/`).

### Auto-Discovery Convention (Odoo-like)

Each module is a folder under `src/modules/<module>/` with these **auto-discovered file slots**:

| File | Auto-discovered as |
|------|-------------------|
| `frontend/<path>.tsx` | Public frontend route `/<path>` |
| `backend/<path>.tsx` | Admin backend route `/backend/<path>` |
| `api/<METHOD>/<path>.ts` | API route `/api/<path>` dispatched by method |
| `subscribers/*.ts` | Event subscriber (export `metadata.event`) |
| `workers/*.ts` | Background job worker (export `metadata.queue`) |
| `index.ts` | Module metadata |
| `di.ts` | DI registrar (`register(container)`) |
| `acl.ts` | Feature-based permissions |
| `setup.ts` | Tenant initialization hooks |
| `ce.ts` | Custom entity/field definitions |
| `events.ts` | Typed event declarations |
| `search.ts` | Search index config |
| `ai-tools.ts` | AI/MCP tool definitions |
| `ai-agents.ts` | AI agent definitions |
| `api/interceptors.ts` | API route hooks (before/after) |
| `widgets/injection/` | Injected UI widgets |
| `data/extensions.ts` | Cross-module data links |

### Compared to Odoo Modules

| Dimension | Odoo | Open Mercato |
|-----------|------|--------------|
| Declaration | `__manifest__.py` with explicit deps | `modules.ts` list + file conventions |
| Dependency resolution | Automatic dependency graph, install order | Manual — developer must add to `modules.ts` |
| Model inheritance | Python class inheritance across modules | No ORM cross-module inheritance; use `data/extensions.ts` foreign-key links |
| View inheritance | XML xpath overlays | Widget injection slots + component replacement handles |
| Upgrade path | `--update=module` | `yarn generate` + manual migration |
| Override depth | Deep (any model field, any view, any method) | Medium (widget injection, interceptors, DI override, module-level `overrides` config) |
| Runtime isolation | Python processes, shared registry | Node.js + Awilix per-request DI |

**Verdict for Chase's question:** It's *inspired by* Odoo's modularity but is shallower. You can override UI widgets, inject menu items, add API interceptors, replace DI services, and suppress specific module features via `modules.ts` overrides. You **cannot** do arbitrary model inheritance or extend another module's ORM entity with new columns (the rule is explicit: no direct ORM relationships between modules). Cross-module data goes through extension entities declared in `data/extensions.ts` with foreign key IDs.

---

## 3. The "Entity" Concept — What It Really Is

This is the most important finding. **Open Mercato "entities" are NOT custom database tables.**

### What Exists

There are two distinct systems conflated under "entities":

#### System Entities (code-defined)
Every module's ORM tables are registered as entity IDs in the format `module:entity` (e.g., `customers:customer_person_profile`, `sales:sales_order`). These are normal PostgreSQL tables managed via MikroORM migrations. Custom fields can be attached to them via EAV (see below).

#### Custom/Virtual Entities (user-created at runtime)
Users can create "custom entities" from the admin UI at `Backend → Data Designer → User Entities`. These are **NOT new tables**. Instead:

1. A row is inserted into `custom_entities` (the entity definition/metadata)
2. Field definitions go into `custom_field_defs` (EAV schema)
3. **Records are stored in `custom_entities_storage`** — a single JSONB document table:

```sql
custom_entities_storage (
  entity_type TEXT,      -- e.g., 'my_module:my_entity'
  entity_id   UUID,      -- the record's ID
  organization_id UUID,
  tenant_id UUID,
  doc JSONB,             -- all field values packed here
  created_at, updated_at, deleted_at
)
```

Everything goes into one `doc` JSONB column. There's no column-per-field, no separate table per entity. The query engine uses `cf:fieldname` selectors to filter and project from the JSONB document.

### Custom Fields on System Entities

For real ORM-backed entities (like `customers:customer_person_profile`), custom fields work differently:
- Definitions still go into `custom_field_defs`
- Values go into `custom_field_values` (the traditional EAV table with `entity_type`, `record_id`, `key`, `value`)
- The query engine joins these at query time

### What Users Can Do

- Create a "virtual entity" (e.g., "Project," "Asset," "Maintenance Ticket") via admin UI
- Define fields: text, multiline, integer, float, boolean, select, currency, relation, attachment, dictionary
- CRUD records via the auto-generated records UI
- Attach it to the sidebar navigation (`showInSidebar: true`)
- Query records via the API: `GET /api/entities/records?entityId=my_module:my_entity`
- Export records as CSV/JSON/XML/Markdown

### What Users **Cannot** Do

- No custom table per entity (all in JSONB doc storage)
- No custom indexes on custom entity fields (JSONB queries, not indexed columns)
- No JOIN between two custom entities at the SQL layer
- No schema migration (no `ALTER TABLE`) — field changes are immediate, no migration step
- No row-level computed fields or triggers (business rules module handles this with JSONB condition expressions, not DB triggers)

### Code-Defined Custom Entities (via `ce.ts`)

Modules can declare custom entities in their `ce.ts` file:

```typescript
// packages/core/src/modules/customers/ce.ts
export const entities = [
  {
    id: 'customers:customer_person_profile',
    label: 'Customer Person',
    labelField: 'displayName',
    fields: CUSTOMER_PERSON_CUSTOM_FIELDS,
  },
]
```

These use the same EAV/JSONB storage but the schema is seeded at install time and version-controlled.

### Brad's Instinct

This is EAV, not "custom tables." It's closer to Salesforce Custom Objects (stored in shared tables) than to true database table creation. The benefit is zero-migration schema changes; the cost is no SQL-layer indexing, no foreign keys between custom entities, and JSONB query overhead at scale.

---

## 4. Workflows System

The workflows module is the most sophisticated piece. It's a full workflow engine:

### Data Model
- **WorkflowDefinition** — template with steps, transitions, triggers, activities (JSON-stored)
- **WorkflowInstance** — running execution tracking context + current step
- **StepInstance** — per-step execution record
- **UserTask** — human-in-the-loop tasks with SLA tracking
- **WorkflowEvent** — immutable audit log (event-sourced)

### Step Types
`START | END | USER_TASK | AUTOMATED | PARALLEL_FORK | PARALLEL_JOIN | SUB_WORKFLOW | WAIT_FOR_SIGNAL | WAIT_FOR_TIMER`

### Activity Types (what happens on transitions)
`SEND_EMAIL | CALL_API | CALL_WEBHOOK | UPDATE_ENTITY | EMIT_EVENT | EXECUTE_FUNCTION | WAIT`

### Execution Model
- Sync activities execute inline and advance immediately
- Async activities enqueue to `workflow-activities` queue; workflow pauses
- Saga-style compensation on failure (reverse-order compensation activities)
- Variable interpolation: `{{context.*}}`, `{{workflow.*}}`, `{{env.*}}`, `{{now}}`

### Event Triggers
Workflows can auto-start from any domain event. The trigger subscriber evaluates `filterConditions` against the event payload (including wildcard patterns like `customers.*`) and maps event payload into workflow context.

### Visual Editor
Built on React Flow (`@xyflow/react`) — a GUI for building workflow definitions without code.

### Verdict
This is a serious workflow engine. More flexible than Odoo's native workflows, arguably more opinionated than Temporal. The saga compensation pattern and event-trigger debouncing show real production thinking.

---

## 5. Other Notable Modules

### Business Rules
A rules engine with:
- Rule types: `GUARD | VALIDATION | CALCULATION | ACTION | ASSIGNMENT`
- Condition expressions stored as JSONB
- Scoped by entity type + event type
- Runtime evaluation against entity data
- Complements workflows (rules are for field-level validation/calculation; workflows are for process orchestration)

### AI Assistant
- OpenCode-based agent with MCP HTTP server (port 3001)
- Per-module tools declared in `ai-tools.ts`
- Per-module agents in `ai-agents.ts`
- Mutation approval workflow (no direct writes without approval gate)
- Command palette UI (Cmd+K)
- Code Mode: AI can write JavaScript that runs in a node:vm sandbox against the API

### Multi-Tenancy
- Two-tier: `tenant_id` (installation/SaaS tenant) + `organization_id` (org within tenant)
- Every query MUST scope by both
- Organization hierarchy via the `directory` module
- Feature-based RBAC with wildcard grants (`customers.*` grants all customer features)

### Customer Portal
- Separate frontend routes under `[orgSlug]/portal/...`
- Separate auth (`requireCustomerAuth`)
- Separate RBAC (`requireCustomerFeatures`)
- Configurable navigation injection

### Integrations & Data Sync
- Provider pattern: each integration is its own package (`packages/channel-gmail`, `packages/gateway-stripe`, etc.)
- Adapters register credentials, health checks, and sync jobs
- Official modules delivered via a git submodule (`external/official-modules`) activated via `official-modules.json`

---

## 6. What They're Good At

1. **Framework engineering** — The scaffolding, auto-discovery, DI container, per-module migration isolation, and backward-compatibility contract (`BACKWARD_COMPATIBILITY.md` with 13 contract-surface categories) are serious infrastructure work.

2. **AI-first development process** — The AGENTS.md files, skill system, spec-first workflow, and QA scenario library are genuinely impressive. They've built a self-describing codebase where AI agents can operate autonomously.

3. **Workflows** — The workflow engine is production-grade with a proper state machine, saga compensation, event triggers, and visual editor.

4. **Multi-tenancy** — Deep, consistent, enforced at every layer including tests.

5. **Extension model** — Widget injection, API interceptors, DI overrides, and module-level override configuration offer meaningful extensibility without forking core.

---

## 7. Where Brad's Instinct Lands

Brad's read is accurate. The gaps vs. a real ERP:

| ERP Concern | Open Mercato's Answer | Depth |
|-------------|----------------------|-------|
| Custom tables/fields | EAV + JSONB doc storage | Shallow — no true schema |
| Financial periods, GL, CoA | None visible | Missing |
| Inventory ledger / lot tracking | None visible | Missing |
| MRP / production planning | `planner` + `resources` modules, basic | Shallow |
| Purchasing / AP / AR | None visible | Missing |
| Tax engine (VAT, GST, compliance) | Not found | Missing |
| Multi-currency with exchange rates | `currencies` module exists | Present but unclear depth |
| Reporting / analytics | `dashboards` + `perspectives` | Light |
| Data migration / import tooling | Excel sync module, basic | Shallow |
| Audit / change log | `audit_logs` module | Present |

The software feels like it was designed by people who understand SaaS platform architecture deeply but haven't suffered through running actual ERP processes (month-end close, statutory reporting, warehouse ops). The "entity" concept betrays this — a real ERP architect's first question is "what's the GL impact of this entity?" not "what JSONB fields does it have?"

---

## 8. Carbon Comparison

| Dimension | Carbon | Open Mercato |
|-----------|--------|-------------|
| Core language | TypeScript / Next.js | TypeScript / Next.js |
| Database | Supabase (Postgres) | Postgres via MikroORM |
| Multi-tenancy | Organization-scoped | Two-tier tenant+org |
| Module system | None explicit; harness conductor pattern | Auto-discovery file conventions |
| Custom fields | Not exposed | EAV + JSONB |
| Workflows | Not present | Full workflow engine |
| AI integration | Claude Code (outer + inner loop) | OpenCode + MCP + per-module tools |
| Build process | `crbn up` / harness loop | Next.js build + turborepo |
| Target audience | Internal tooling for operators | Developer-first ERP/CRM framework |

The key difference in intent: Carbon is building toward *understanding* the business process (AI-assisted operations); Open Mercato is building a *platform* for developers to build business apps on. They're potentially complementary rather than directly competing — Open Mercato could be the frontend/data layer, Carbon the intelligence layer.

---

## 9. Summary for Slack Thread

**The "entity" concept:** Not custom tables. It's EAV/JSONB document storage — all "custom entity" records go into one `custom_entities_storage` table with a `doc JSONB` column. Fast to deploy, zero migrations, but no SQL-layer indexes or joins between entities. Think Salesforce Custom Objects, not "add a PostgreSQL table."

**Module system vs Odoo:** Similar spirit (auto-discovery, file conventions, per-module migrations, DI registration) but shallower. No dependency graph resolution, no deep ORM inheritance. Override depth is real but limited to widget injection, API interceptors, and DI replacement. The `modules.ts` registry + file naming is clean and developer-friendly.

**Workflows:** Genuinely impressive — full state machine (START/END/USER_TASK/AUTOMATED/PARALLEL/SUB_WORKFLOW/WAIT_FOR_SIGNAL/WAIT_FOR_TIMER), saga compensation, event-triggered auto-start, variable interpolation, visual React Flow editor. This is the standout feature.

**Brad's read:** Confirmed. Strong platform engineering, weak ERP domain depth. No financials, no inventory ledger, no tax engine. The "entity" abstraction is a developer convenience, not an operator solution.
