---
paths:
  - "packages/database/**"
---

# Database Conventions (Tables & Migrations)

The canonical TABLE + MIGRATION template for Carbon. Grounded in the newest
migrations (`packages/database/supabase/migrations/`) and the root `package.json`
scripts. **Tables get renamed and functions get revised — read the NEWEST
migration touching a table for current truth, never the first match or this doc.**

Related (do not duplicate here):

- **DB access** — clients (supabase-js vs Kysely), services, RPC, generated types:
  `database-patterns.md`.
- **SQL-level migration conventions** — enums, views, triggers, no-companyId RLS,
  the real per-statement patterns: `database-migration-patterns.md`.
- **Full step-by-step workflow** (checklist, `.models.ts` updates):
  `workflow-database-migration.md`.

## Commands (verified in root `package.json`)

| Command | Resolves to | Purpose |
| --- | --- | --- |
| `pnpm db:migrate:new <name>` | `supabase migration new` | **Create** a new timestamped migration file. |
| `pnpm db:migrate` | `crbn migrate` | **Apply** pending migrations to the local DB; also regenerates types + swagger. |
| `pnpm db:types` | `tsx scripts/generate-db-types.ts` | Regenerate generated DB types (after migrations). |

- **There is NO `db:build` script** — older docs/cache told people to run
  `npm run db:build` to "test" a migration. That command does not exist (it was
  removed; see root `README.md`). Use `pnpm db:migrate` to apply locally.
- Migration creation is `db:migrate:new <name>`, NOT `db:migrate <name>` —
  `db:migrate` takes no name and applies everything pending.
- **Never rebuild the DB to test changes.** Wait for the user to do it.

**Timestamp warning:** never use `000000` for the HHMMSS portion (e.g.
`…000000_foo.sql`). The timestamp is the migration's primary key; randomize HHMMSS
(e.g. `20260619142853_…`) to avoid cross-branch collisions.

## Table Template (canonical, from `20260609143732_document-template.sql`)

```sql
CREATE TABLE "entityName" (
    "id" TEXT NOT NULL DEFAULT id(),
    "companyId" TEXT NOT NULL,

    -- Business columns
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT TRUE,

    -- Audit columns (required) — reference "user" INLINE, no named constraints
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    -- Optional extensibility
    "customFields" JSONB,
    "tags" TEXT[],

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

-- Required indexes: companyId and every FK
CREATE INDEX "entityName_companyId_idx" ON "entityName" ("companyId");
CREATE INDEX "entityName_createdBy_idx" ON "entityName" ("createdBy");

-- Named, company-scoped uniqueness via ALTER (not inline)
ALTER TABLE "entityName" ADD CONSTRAINT "entityName_companyId_name_key"
    UNIQUE ("companyId", "name");
```

### Required Patterns

| Pattern | Rule |
|---------|------|
| Primary key value | `id TEXT NOT NULL DEFAULT id()` — bare `id()` or prefixed `id('pr')`, `id('sh')`, `id('je')`… both are current. Never a raw UUID. |
| Composite PK | `PRIMARY KEY ("id", "companyId")` |
| Multi-tenancy | `companyId TEXT NOT NULL` + FK to `company` `ON DELETE CASCADE` |
| Audit columns | `createdBy` (NOT NULL), `createdAt`, `updatedBy`, `updatedAt` — `*By` reference `"user"("id")` **inline** |
| `updatedAt` | Set by the **app** on write, not a DB trigger. Don't add a generic timestamp trigger. |
| Indexes | Index `companyId` and **every** FK (e.g. `createdBy`) |
| Never | An `itemReadableId` column; decimal places in a `NUMERIC` (use bare `NUMERIC`) |

<!-- UNVERIFIED: the prefix→entity mapping (e.g. which short prefix a given new table
     should use) is by convention, not enforced; pick a short prefix or use bare id(). -->

### Column Types

| Type | Use For |
|------|---------|
| `TEXT` | IDs, names, strings |
| `NUMERIC` | Financial amounts / quantities needing fractions (no precision spec) |
| `INTEGER` | Whole counts |
| `TIMESTAMP WITH TIME ZONE` | Dates/times |
| `DATE` | Calendar dates (no time) |
| `BOOLEAN NOT NULL DEFAULT` | Flags |
| `JSONB` | Custom fields / structured config |
| `TEXT[]` | Tags / arrays of ids |

## RLS Policies (the only correct pattern)

Enable RLS and create the four policies named **exactly** `SELECT` / `INSERT` /
`UPDATE` / `DELETE`. Schema-qualify the table (`"public"."t"`) and cast the helper
result `::text[]`. From `20260609143732_document-template.sql`:

```sql
ALTER TABLE "public"."entityName" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."entityName"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE POLICY "INSERT" ON "public"."entityName"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('module_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."entityName"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('module_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."entityName"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('module_delete'))::text[])
);
```

- **SELECT** → `get_companies_with_employee_role()` (any employee of the company can read).
  Some tables tighten read to a view permission instead (e.g. picking lists use
  `get_companies_with_employee_permission('inventory_view')`) — that's a valid variant.
- **INSERT / UPDATE / DELETE** → `get_companies_with_employee_permission('<module>_<action>')`,
  `<action>` ∈ `create` / `update` / `delete` (e.g. `settings_create`, `inventory_update`).
- The old `has_role` / `has_company_permission` pattern is **deprecated** — never use it.
- For tables **without a `companyId` column**, reach the company through the parent
  via `EXISTS`, gating writes on the **write** permission (not just visibility). See
  `database-migration-patterns.md` ("Tables without a companyId column").

## Views

Always `SECURITY_INVOKER=true` so the underlying tables' RLS applies to the caller:

```sql
CREATE OR REPLACE VIEW "module_entityView" WITH(SECURITY_INVOKER=true) AS
SELECT e.*, u."fullName" AS "createdByFullName"
FROM "entityName" e
LEFT JOIN "user" u ON u."id" = e."createdBy";
```

## Triggers

There is **no generic per-table boilerplate trigger** (no `updatedAt`/`companyId`
trigger to add). Triggers here are purpose-built — status recomputation,
search-index sync, the event-system dispatch — and live in their own migrations
(e.g. `update_picking_list_status_trigger` in `20260601143527_picking-lists.sql`).
Add a trigger only when there's real derived state to maintain. For async/event-driven
side effects use the event system (`event-system.md`), not ad-hoc triggers. See
`database-migration-patterns.md` for enum/trigger details.

## Zod Validators

After the migration, update the module's `{module}.models.ts` (full pattern in
`conventions-forms.md`):

```typescript
import { z } from "zod";
import { zfd } from "zod-form-data";

export const entityValidator = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  active: zfd.checkbox(),
});
```

Validate in route actions with `validator(schema).validate(formData)` from
`@carbon/form` — not `schema.parse()`.

## Migration Checklist

- [ ] File created with `pnpm db:migrate:new <name>` (HHMMSS not `000000`)
- [ ] `id` uses `id()` (bare or prefixed) for the PK value — never a raw UUID
- [ ] `companyId` present with composite PK `("id", "companyId")` + FK `ON DELETE CASCADE`
- [ ] Audit columns; `*By` reference `"user"("id")` inline
- [ ] Indexes on `companyId` and every FK
- [ ] RLS enabled with the four standardized policy names; SELECT via
      `get_companies_with_employee_role()`, writes via
      `get_companies_with_employee_permission('<module>_<action>')`
- [ ] Zod validators in `{module}.models.ts`
- [ ] Applied locally with `pnpm db:migrate` (regenerates types) — never `db:build`
