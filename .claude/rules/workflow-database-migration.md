---
paths: ["packages/database/supabase/migrations/**"]
---

# Workflow: Add a Database Migration

The canonical step-by-step for creating and applying a DB migration in Carbon.
Commands and patterns here are grounded in the root + `packages/database`
`package.json` scripts and the newest migrations
(`packages/database/supabase/migrations/`).

For the detail this workflow deliberately does NOT repeat:

- **Table + RLS template, column types, checklist** → `conventions-database.md`.
- **SQL-level patterns** (enums, views, triggers, no-`companyId` RLS) →
  `database-migration-patterns.md`.
- **DB access** (supabase-js vs Kysely, services, generated types) →
  `database-patterns.md`.

## Commands (verified in root `package.json`)

| Command | Resolves to | Purpose |
| --- | --- | --- |
| `pnpm db:migrate:new <name>` | `supabase migration new` | **Create** a new timestamped migration file. |
| `pnpm db:migrate` | `crbn migrate` | **Apply** pending migrations to the local DB, then regenerate types + swagger. |
| `pnpm db:types` | `tsx scripts/generate-db-types.ts` | Regenerate generated DB types only (after migrations). |

- **There is NO `db:build` script.** Older docs/cache told people to run
  `npm run db:build` to "test" a migration — that command does not exist (it was
  removed; see root `README.md` ~line 465). Apply locally with `pnpm db:migrate`.
- Use **`pnpm`, not `npm`** for every script (this is a pnpm workspace).
- Creation is `db:migrate:new <name>`; application is bare `db:migrate` (takes
  **no** name and applies everything pending). Don't conflate the two.
- **Never rebuild the DB to test changes.** Wait for the user to do it.

## Steps

### 1. Prereqs

- Latest `main`; the local stack provisioned once via `crbn up` (writes
  `.env.local`, which `crbn migrate` reads for `PORT_DB`). `crbn migrate` aborts
  if the local DB at `127.0.0.1:$PORT_DB` is unreachable.
- Know the multi-tenant model: nearly every table carries `companyId` + composite
  PK `("id", "companyId")`.

### 2. Create the migration file

```bash
pnpm db:migrate:new <name-of-migration>
```

Creates `packages/database/supabase/migrations/<timestamp>_<name>.sql`.

> **Timestamp warning:** never use `000000` for the HHMMSS portion (e.g.
> `…000000_foo.sql`). The timestamp is the migration's primary key; randomize
> HHMMSS (e.g. `20260619142853_…`) to avoid cross-branch collisions.

### 3. Write the SQL

Read the **newest** migration touching a related table for current truth — never
the first match. Use the canonical table + RLS template in
`conventions-database.md`. The non-negotiable patterns (all confirmed in the
newest migrations, e.g. `20260609143732_document-template.sql`):

- **PK value** `"id" TEXT NOT NULL DEFAULT id()` — bare `id()` or prefixed
  `id('pr')`; never a raw UUID.
- **Multi-tenancy** `"companyId" TEXT NOT NULL`, composite
  `PRIMARY KEY ("id", "companyId")`, FK to `"company"("id") ON DELETE CASCADE`.
- **Audit columns** `createdBy` (NOT NULL), `createdAt`, `updatedBy`, `updatedAt`
  — the `*By` columns reference `"user"("id")` **inline** (no named constraints).
  `updatedAt` is set by the app, not a trigger.
- **Indexes** on `companyId` and **every** FK (e.g. `createdBy`).
- **RLS** — not in the migration. Add the table's rule to
  `packages/database/src/authz/manifest.ts` (usually `entityName: company("<module>")`),
  then ship it with `pnpm --filter @carbon/database authz migration <name>`; CI's
  `migration.test.ts` fails until you do. See `authz-manifest.md`.
  - The old `has_role` / `has_company_permission` helpers no longer exist
    (dropped in `20260927224314_retire-legacy-rls-helpers.sql` (they admitted customer and supplier portal accounts); `authz-fixes.test.sql` asserts they stay gone). For tables without a `companyId`, reach the company through
    the parent via `EXISTS` (see `database-migration-patterns.md`).
- **Never**: an `itemReadableId` column, or a precision spec on `NUMERIC`.
- **Views** use `WITH(SECURITY_INVOKER=true)`.

### 3b. Renaming or dropping a table? Record it for backups

If the migration **renames or drops any table that appears in a company backup**, add an
entry to `TABLE_RENAMES` in
`packages/jobs/src/backups/renames.ts` in the SAME commit:
the new name for a rename, `null` for a table dropped along with its feature.

That is more tables than it sounds: the catalog scopes a table either DIRECTLY (its own
`companyId` / `companyGroupId` column) or `via` a foreign key to a scoped parent, so a
child table with neither column is still exported and still needs an entry. When in doubt,
run `pnpm db:check:backups` — it fails on exactly the tables that need one.

Only you know which of the two it was. A customer's existing backup still names the old
table, and to a restore "this table is gone" is ambiguous — guessing "dropped" when it was
really a rename silently discards their rows and still reports success. So an unmapped
missing table refuses the restore outright, and `pnpm db:check:backups` fails your commit
until the entry exists.

### 3c. A column that holds a row id with no FK? Record it for backups

If the migration adds a TEXT / TEXT[] column that stores another tenant row's id
**without a foreign key** — usually a generic ref that can point at one of several
tables (`inspection."sourceDocumentLineId"` is a receipt line OR a job operation), or an
`...Ids` array — add it to `ID_REF_COLUMNS` in `packages/jobs/src/backups/id-refs.ts`
in the SAME commit.

A restore into a different company gives every row a new id and rewrites FK columns
to match. It cannot see a column with no FK, so that column keeps the SOURCE
company's ids — dangling at best, and a unique-index collision with the source
company's live rows when the column is indexed (`inspection_sourceDocumentLineId_key`
fails a cross-company restore this way). Listing it makes the restore rewrite it through
the old→new id map. Readable numbers (`quote."quoteId"`), external ids and user refs are
not row ids — leave them out. The map is typed against the generated row types, so a
column you rename or drop fails `typecheck` until you update its entry.

### 4. Update the Zod validators

Update the module's `apps/erp/app/modules/{module}/{module}.models.ts` to match
the schema (zod + `zfd` from `zod-form-data`). Validate in route actions with
`validator(schema).validate(formData)` from `@carbon/form`, not `schema.parse()`.
Full pattern in `conventions-forms.md`.

### 5. Apply + regenerate locally

```bash
pnpm db:migrate
```

Applies pending migrations against the worktree's local DB and (only if new
migrations were applied) regenerates DB types + swagger. To regenerate types
alone, `pnpm db:types`. **Do NOT run `npm run db:build` — it does not exist.**

### 6. Update the demo data

The four demo datasets (`packages/database/src/datasets/`) must keep showing every
screen. When a migration adds, renames or drops a table or column, or changes a status
enum or CHECK constraint:

- **New table or feature a user can see:** add realistic rows to all four datasets
  (`data/<key>/`, plus the tier that inserts them), and a floor in `datasets/coverage.ts`.
- **Renamed/dropped column or table:** update the tier and data that write it.
- **New enum value a user can reach:** make it appear in the demo data.

Then run `pnpm db:check:datasets` — it applies every dataset and rolls back, and the
pre-commit hook runs it anyway. Details: `onboarding-company-templates.md`.

## Checklist

- [ ] File created with `pnpm db:migrate:new <name>` (HHMMSS not `000000`)
- [ ] `id` uses `id()` (bare or prefixed) for the PK value — never a raw UUID
- [ ] `companyId` + composite PK `("id", "companyId")` + FK `ON DELETE CASCADE`
- [ ] Audit columns; `*By` reference `"user"("id")` inline
- [ ] Indexes on `companyId` and every FK
- [ ] Rule added to `packages/database/src/authz/manifest.ts` and shipped with
      `pnpm --filter @carbon/database authz migration <name>` (no `CREATE POLICY` in migrations)
- [ ] Renamed/dropped a tenant-scoped table? `TABLE_RENAMES` entry added
      (`packages/jobs/src/backups/renames.ts`) — new name, or `null` if dropped with its feature
- [ ] New TEXT/TEXT[] column holding a tenant row id with no FK? Listed in `ID_REF_COLUMNS`
      (`packages/jobs/src/backups/id-refs.ts`)
- [ ] Zod validators updated in `{module}.models.ts`
- [ ] Applied locally with `pnpm db:migrate` (regenerates types) — never `db:build`
- [ ] Demo data updated for the new/changed tables, and `pnpm db:check:datasets` ✓×4
