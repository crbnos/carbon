# Carbon — Agent Guidelines

Carbon is a manufacturing ERP/MES/QMS. It contains apps for ERP, MES, academy, and starter.

## Always

- Check the Task Router below before research or coding; a single task may match multiple rows — read all relevant guides.
- Use the closest package/module `AGENTS.md` for local architecture, imports, and validation commands.
- Follow `.ai/rules/` for subsystem-specific conventions (auto-loaded via `paths:` frontmatter).
- Read `.ai/lessons.md` before non-trivial changes to avoid known pitfalls.
- Preserve behavior unless the user or a spec explicitly asks for a behavior change.
- Keep changes minimal, focused, and integrated through real call sites.
- Use existing components — grep `packages/react/src/` and `apps/erp/app/components/` before writing UI.
- Enter plan mode for non-trivial tasks (3+ steps or architectural decisions).
- Use subagents liberally to keep the main context window clean.
- Run `pnpm run generate:types` after schema/migration changes, BEFORE typechecking.
- Never claim work is complete without running verification commands. Evidence before assertions — run the command, read the output, then state the result.

## Ask First

- Ask before reducing scope, changing architecture, changing public contracts, or adding production dependencies.
- Ask before changing database schema in production-critical tables.
- Ask before modifying authentication, RBAC, or multi-tenancy logic.
- Ask before touching multiple modules in a way not covered by an existing spec.

## Never

- Never use `npm` — always `pnpm`.
- Never expose cross-tenant data or skip `companyId` scoping.
- Never hand-edit generated DB types (`@carbon/database` types).
- Never scatter service/models files — one `{module}.service.ts` and one `{module}.models.ts` per module.
- Never rebuild the database to test changes — wait for the user.
- Never commit credentials, tokens, or private keys.

## Validation Commands

Choose the smallest relevant set for the change:

```bash
pnpm exec turbo run typecheck --filter=<pkg>   # TypeScript (scoped — whole-repo typecheck OOMs)
pnpm run lint                # Biome linting
pnpm run test                # Unit tests
pnpm run build               # Full build
pnpm db:migrate:new <name>   # Create new migration
pnpm db:migrate              # Apply pending migrations
pnpm run generate:types      # Regenerate DB types (after migrations)
```

## Task Router — Where to Find Detailed Guidance

IMPORTANT: Before any research or coding, match the task to this table. A single task often maps to **multiple rows** — read **all** matching guides before starting.

| Task | Guide |
|------|-------|
| **Database & Schema** | |
| Creating a database migration | `.ai/rules/workflow-database-migration.md` |
| Database conventions (tables, RLS, multi-tenancy) | `.ai/rules/conventions-database.md` |
| Database access patterns (clients, Kysely, RPCs) | `.ai/rules/database-patterns.md` |
| Migration SQL patterns (enums, views, triggers) | `.ai/rules/database-migration-patterns.md` |
| Working with the database package | `packages/database/AGENTS.md` |
| **Server & Services** | |
| Writing service functions | `.ai/rules/conventions-services.md` |
| Authentication, RBAC, permissions | `.ai/rules/authentication-system.md` + `packages/auth/AGENTS.md` |
| Background jobs and events (Inngest) | `.ai/rules/event-system.md` + `packages/jobs/AGENTS.md` |
| Adding an edge function | `.ai/rules/workflow-edge-function.md` |
| Adding event handlers | `.ai/rules/workflow-event-system.md` |
| **UI & Forms** | |
| Building forms (ValidatedForm + zod) | `.ai/rules/conventions-forms.md` + `packages/form/AGENTS.md` |
| UI components and conventions | `.ai/rules/conventions-ui.md` + `packages/react/AGENTS.md` |
| i18n / translations (Lingui) | `.ai/rules/i18n-lingui-system.md` + `packages/locale/AGENTS.md` |
| Flash messages and toasts | `.ai/rules/flash-system.md` |
| Document templates / customizer | `.ai/rules/document-template-customizer.md` |
| **Domain Modules** | |
| Purchasing (POs, receipts, conversion factors) | `.ai/rules/purchasing-conversion-factors.md` + `modules/purchasing/AGENTS.md` |
| Inventory (lots, bins, adjustments) | `.ai/rules/inventory-system.md` + `modules/inventory/AGENTS.md` |
| Production (work orders, scheduling, routings) | `.ai/rules/scheduling-data-structures.md` + `modules/production/AGENTS.md` |
| MES (shop floor, job operations) | `.ai/rules/mes-job-operation-ui.md` |
| Quality (inspections, NCRs, CAPAs) | `modules/quality/AGENTS.md` |
| Sales (quotes, orders) | `.ai/rules/quote-discount-system.md` + `modules/sales/AGENTS.md` |
| Accounting (GL, journal entries) | `.ai/rules/accounting-sync-handlers.md` + `modules/accounting/AGENTS.md` |
| Items / Parts / BOM | `.ai/rules/material-tables.md` + `modules/items/AGENTS.md` |
| Issues (NCR, CAPA, ECO, RMA) | `.ai/rules/issue-module.md` |
| Traceability / lot tracking | `.ai/rules/traceability-model.md` |
| Revision system | `.ai/rules/revision-system.md` |
| Kanban | `.ai/rules/kanban-system.md` |
| Fixed assets | `.ai/rules/fixed-asset-lifecycle.md` |
| Risk register | `.ai/rules/risk-register-module.md` |
| **Infrastructure** | |
| PDF generation | `.ai/rules/pdf-generation-patterns.md` + `packages/documents/AGENTS.md` |
| Printing system | `.ai/rules/printing-system.md` + `packages/printing/AGENTS.md` |
| CSV import/export | `.ai/rules/csv-import-system.md` + `.ai/rules/table-csv-export.md` |
| Billing / Stripe | `.ai/rules/billing-system.md` + `packages/stripe/AGENTS.md` |
| Deployment (SST) | `.ai/rules/sst-deployment-infrastructure.md` |
| Audit log system | `.ai/rules/audit-log-system.md` |
| Shipments / receipts UI | `.ai/rules/shipments-receipts-ui-patterns.md` |
| AI chat / SDK | `.ai/rules/chat-ai-sdk-info.md` |
| **Integrations** | |
| Jira integration | `.ai/rules/jira-integration.md` |
| Linear integration | `.ai/rules/linear-integration.md` |
| Xero API / webhooks | `.ai/rules/xero-api-contact-structure.md` + `.ai/rules/xero-webhooks.md` |
| Redis (shared dev) | `.ai/rules/dev-shared-redis.md` |
| **Architecture** | |
| General coding conventions | `.ai/rules/coding-conventions.md` |
| Project overview | `.ai/rules/project-overview.md` |
| Customer/supplier DB schema | `.ai/rules/customer-supplier-database-schema.md` |
| User/employee/job relationships | `.ai/rules/user-employee-job-relationships.md` |
| Company backup/restore | `.ai/rules/company-backup-restore.md` |
| Environment configuration | `.ai/rules/environment-configuration.md` |
| MCP tools reference | `.ai/rules/mcp-tools-reference.md` |
| Adding a new module | `.ai/docs/module-conventions.md` |
| Creating/refreshing an AGENTS.md | `.ai/skills/create-agents-md/SKILL.md` |
| **Design Specs** | |
| Check existing specs before building | `.ai/specs/` + `.ai/specs/implemented/` |
| Writing a new spec | `.ai/skills/spec-writing/SKILL.md` |
| **Workflows** | |
| Skills index — pipelines + all skills | `.ai/skills/README.md` |
| Competitor research for a feature | `.ai/skills/research/SKILL.md` |
| Feature pipeline (research→spec→plan→execute) | `.ai/skills/feature/SKILL.md` |
| Stress-test a plan or design (grill interview) | `.ai/skills/grill/SKILL.md` |
| Implementation plan from a spec | `.ai/skills/plan/SKILL.md` |
| Execute an approved plan | `.ai/skills/execute/SKILL.md` |
| Bug fix: root-cause analysis (read-only) | `.ai/skills/root-cause/SKILL.md` |
| Bug fix: runtime instrumentation | `.ai/skills/debugging-difficult-bugs/SKILL.md` |
| Bug fix: implement the fix | `.ai/skills/fix/SKILL.md` |
| Pre-commit verification gate | `.ai/skills/check-and-commit/SKILL.md` |
| Feature build (doer→gate→judge loop) | `.ai/skills/conductor/SKILL.md` |
| Browser-verify a feature | `.ai/skills/test/SKILL.md` |
| Repo audit → handoff plans | `.ai/skills/improve/SKILL.md` |
| Review your own branch before PR | `.ai/skills/self-review/SKILL.md` |

## Core Principles

- **Simplicity First:** Make every change as simple as possible. Minimize code impact.
- **No Laziness:** Identify root causes. Avoid temporary fixes. Senior developer standards.
- **Minimal Impact:** Touch only what is necessary. Avoid introducing new bugs.
- **Demand Elegance:** For non-trivial changes, pause and ask whether there is a more elegant solution.

## Workflow Orchestration

### Plan First

- Enter plan mode for any non-trivial task (3+ steps or architectural decisions).
- If something goes wrong, stop and re-plan immediately.
- Write implementation plans to `.ai/plans/{date}-{slug}.md` with checkable progress items (run logs go in `.ai/runs/`).

### Subagent Strategy

- Use subagents liberally to keep the main context window clean.
- Offload research, exploration, and parallel analysis to subagents.
- One task per subagent to ensure focused execution.

### Verification Before Done

- Never declare a task complete without proving it works.
- Ask: "Would a staff engineer approve this?"
- Run tests, check build, demonstrate correctness.

### Self-Improvement Loop

- After corrections, update `.ai/lessons.md` with the `Context → Problem → Rule → Applies to` format.
- Review lessons at the start of each session when relevant to the task.

## Architecture Quick Reference

- **Monorepo**: pnpm workspaces + Turborepo
- **Framework**: React Router v7 (NOT Remix), flat routes via `remix-flat-routes`
- **Database**: Supabase (Postgres) with RLS, typed via `@carbon/database` + Kysely
- **Background jobs**: Inngest (NOT Trigger.dev), via `@carbon/jobs`
- **Apps**: `erp` (main), `mes` (shop floor), `academy` (training), `starter` (example)
- **Packages**: 22 under `packages/` — auth, database, lib, react, form, documents, jobs, notifications, config, env, checks, harness, dev, stripe, ee, tiptap, locale, glossary, utils, kv, printing, onboarding
- **Multi-tenancy**: every table has `companyId` + composite PK `("id", "companyId")`
- **IDs**: `id('prefix')` default in SQL
- **Imports**: `~/*` → app code; `@carbon/*` → workspace packages

## ERP Module Layout

```
apps/erp/app/modules/{module}/
├── {module}.models.ts    # zod validators + derived types
├── {module}.service.ts   # Supabase/Kysely data operations
├── {module}.server.ts    # server-only helpers (optional)
├── types.ts              # shared types (optional)
├── index.ts              # barrel re-export
└── ui/                   # feature components
```

MES is lighter: services in `apps/mes/app/services/`, components in `apps/mes/app/components/`.

## Rules (`.ai/rules/`)

Internal technical context for each subsystem lives in `.ai/rules/`, symlinked to `.claude/rules/` by `install-skills.sh`. Claude Code auto-loads rules via `paths:` frontmatter when you work in matching areas. Update the relevant rule when you learn something durable about a subsystem. The source of truth is always the code and schema first.

## Browser Automation

With the user's permission, use the `/auth` and `/test` skill to verify fixes.
