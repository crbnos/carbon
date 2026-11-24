# Lessons

Mistakes an agent made, and the rule that prevents each one. There is one
file per topic. `pnpm brief <file>` shows a lesson before an agent edits a
file in that lesson's scope.

## Topic files

| File | Covers |
|---|---|
| `database-access.md` | Kysely, supabase-js and PostgREST queries, RLS, companyId tenancy, transactions, row locks, generated types |
| `database-migrations.md` | SQL migrations, triggers, views, functions, constraints, foreign keys, seeds and datasets, schema backups |
| `accounting-and-posting.md` | Journals, postings, the GL, periods, the cutover, accounting sync providers, revenue recognition, lease accounting |
| `inventory-and-traceability.md` | The item ledger, bins, lots, serials and tracked entities, picking, backflush, kanban |
| `production-and-mes.md` | Jobs, operations, work centers, the MES app, OEE, maintenance |
| `planning-and-scheduling.md` | MRP, the scheduler, demand, supersession, promising |
| `sales-purchasing-invoicing.md` | Quotes, orders, invoices, memos, payments, contracts, rentals, conversions, totals, voids |
| `integrations.md` | Ramp, Onshape, Jira and Linear, Stripe, OAuth, webhooks, Activepieces pieces, Slack, email |
| `workflows.md` | The workflow engine, matcher, catalog, actions and runs |
| `jobs-and-events.md` | Inngest functions, the event queue, crons, notification delivery |
| `ui-components-and-forms.md` | `@carbon/react`, ValidatedForm, modals and drawers, the design system, keyboard, accessibility |
| `routes-and-loaders.md` | React Router routes, loaders and actions, outlets, revalidation, the query cache, realtime, service workers |
| `tables-and-lists.md` | List tables, paging and infinite scroll, columns, CSV export and import |
| `dates-numbers-i18n.md` | Time zones, `@internationalized/date`, numeric precision, currency, Lingui |
| `testing.md` | Vitest, database tests, browser tests, conformance checks as tests |
| `dev-tooling-and-ci.md` | The crbn CLI, the local stack, git and worktrees, CI, scripts, agents and skills, docs |
| `files-cad-viewer.md` | Uploads, storage, media, CAD and STEP, the 3D viewer, Rust crates, PDFs and printing |
| `auth-and-security.md` | Auth, sessions, permissions, API keys, headers, secrets, the MCP and API surface |

Put a new lesson in the topic where a writer of that code needs it. If two
topics fit, choose the one whose code the mistake was made in. Never create a
new topic file: if no topic fits, ask the human. A new topic file needs a row
in this table, or `scopes.test.ts` fails.

## Lesson format

Each lesson is one `## ` section. A fenced `scope` block comes first:

````markdown
## Count invoices by the status the list shows, from its view

```scope
id: count-invoices-by-the-status-the-list-shows-from-its-view
paths: ["apps/erp/app/modules/*/ui/**/*Dashboard*"]
triggers: ["purchaseInvoices", "salesInvoices"]
```

**Context:** …

**Problem:** …

**Rule:** …

**Applies to:** …
````

| Field | Meaning |
|---|---|
| `id` | A slug of the title. Unique across all topic files. |
| `paths` | Globs of the files the lesson applies to. |
| `triggers` | Code text that shows the topic: a string, or `{"text": ".update(", "minCount": 2}`. Each has at least 4 characters. |

`pnpm brief` selects a lesson when its `paths` match the file, or when a
trigger occurs in the file or in the planned edit. It shows the title and the
**Rule** paragraph. Each lesson has at least one path or one trigger.

## When the briefing runs

`pnpm brief` searches for triggers at two moments only:

1. When an agent runs `pnpm brief <files>`, usually before it edits. It searches the files as they are now.
2. When Claude calls Edit, Write or MultiEdit on a file in the repository. The PreToolUse hook searches the file as it would be after the edit, plus the edit's own text. A new check violation refuses the edit before the write. The lessons and rules in scope arrive with the tool result, after the write, each once per session.

Nothing searches while an agent only reads files or runs commands. A trigger is plain, case-sensitive text, so it also matches inside a comment or a string.

## How a lesson is added and removed

1. `/learn` records a mistake. It chooses a check if the mistake shows in the
   code text, else a rule line, else a lesson section here.
2. When a check or a rule takes a lesson over, the same commit deletes the
   lesson's section.
3. A human approves the deletion of a lesson that no stronger store took over.

`packages/checks/src/brief/scopes.test.ts` fails a lesson that does not
parse, that has no scope, or whose id repeats.
