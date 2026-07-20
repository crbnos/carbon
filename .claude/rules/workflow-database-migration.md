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
- **RLS** — enable, then create exactly four policies named `SELECT` / `INSERT` /
  `UPDATE` / `DELETE`, schema-qualified (`"public"."t"`) with the helper result
  cast `::text[]`:
  - `SELECT` → `get_companies_with_employee_role()` (any employee reads). Some
    tables tighten read to a view permission — a valid variant.
  - `INSERT`/`UPDATE`/`DELETE` →
    `get_companies_with_employee_permission('<module>_<action>')`
    (`<action>` ∈ `create` / `update` / `delete`).
  - The old `has_role` / `has_company_permission` helpers are **deprecated** —
    never use them. For tables without a `companyId`, reach the company through
    the parent via `EXISTS` (see `database-migration-patterns.md`).
- **Never**: an `itemReadableId` column, or a precision spec on `NUMERIC`.
- **Views** use `WITH(SECURITY_INVOKER=true)`.

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

## Checklist

- [ ] File created with `pnpm db:migrate:new <name>` (HHMMSS not `000000`)
- [ ] `id` uses `id()` (bare or prefixed) for the PK value — never a raw UUID
- [ ] `companyId` + composite PK `("id", "companyId")` + FK `ON DELETE CASCADE`
- [ ] Audit columns; `*By` reference `"user"("id")` inline
- [ ] Indexes on `companyId` and every FK
- [ ] RLS enabled with the four standardized policy names (SELECT via
      `get_companies_with_employee_role()`, writes via
      `get_companies_with_employee_permission('<module>_<action>')`)
- [ ] Zod validators updated in `{module}.models.ts`
- [ ] Applied locally with `pnpm db:migrate` (regenerates types) — never `db:build`
