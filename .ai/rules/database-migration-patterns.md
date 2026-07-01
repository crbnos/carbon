---
paths: ["packages/database/supabase/migrations/**"]
---

# Database Migration Patterns

How migrations are written and structured in Carbon. The full workflow (checklist,
.models.ts updates) is in `workflow-database-migration.md` — follow that. The table
template lives in `conventions-database.md`. This file captures the **real conventions in
the SQL itself**, grounded in the newest migrations. Don't repeat those two files.

Migrations live in `packages/database/supabase/migrations/`, timestamp-prefixed
(`YYYYMMDDHHMMSS_descriptive-name.sql`), applied in order by the Supabase CLI. **Read the
NEWEST relevant migration for current truth — tables get renamed and functions get revised;
never trust the first match or this doc over the live SQL.**

## Commands (verified in root `package.json`)

| Command | What it does |
| --- | --- |
| `pnpm db:migrate:new <name>` | Create a new migration file (`supabase migration new`). |
| `pnpm db:migrate` | Apply pending migrations to the local worktree DB (`crbn migrate`); also regenerates types + swagger unless `--no-regen`. |
| `pnpm db:types` | Regenerate generated DB types after migrations. |

There is **no `db:build` script** — older docs/cache referenced it; ignore that. Use
`pnpm db:migrate` to apply locally. Never rebuild the DB to test; let the user do it.

**Timestamp warning:** never use `000000` for the HHMMSS portion (e.g. `…000000_foo.sql`).
The timestamp is the migration's primary key; randomize HHMMSS (e.g. `20260619142853_…`) to
avoid cross-branch collisions.

## Table creation (canonical, from `20260609143732_document-template.sql`)

```sql
CREATE TABLE "documentTemplate" (
    "id" TEXT NOT NULL DEFAULT id(),
    "companyId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "blocks" JSONB NOT NULL DEFAULT '[]',

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX "documentTemplate_companyId_idx" ON "documentTemplate" ("companyId");
CREATE INDEX "documentTemplate_createdBy_idx" ON "documentTemplate" ("createdBy");

-- Named, company-scoped uniqueness via ALTER (not inline)
ALTER TABLE "documentTemplate" ADD CONSTRAINT "documentTemplate_companyId_documentType_key"
    UNIQUE ("companyId", "documentType");
```

- **`id()` default** — both bare `id()` and prefixed `id('prefix')` are current and common
  (prefixes are short: `id('pr')`, `id('dim')`, `id('je')`, `id('tce')`). Either is fine.
  Never use a raw UUID.
- **Composite PK `("id", "companyId")`** + `companyId` FK to `company` with `ON DELETE CASCADE`.
- **Audit columns** reference `user` **inline** (`TEXT NOT NULL REFERENCES "user"("id")`) — no
  separate named FK constraints.
- **`updatedAt` is set by the app on write, not by a DB trigger.** Don't add a generic
  timestamp trigger.
- Index `companyId` and every FK (e.g. `createdBy`).
- Never add an `itemReadableId` column, and never specify decimal places in a `NUMERIC`.

## RLS (the only correct pattern)

Enable RLS and create the four standardized policies named exactly `SELECT` / `INSERT` /
`UPDATE` / `DELETE`. Schema-qualify the table (`"public"."t"`) on the `ALTER`/`CREATE POLICY`,
and cast the helper result with `::text[]`.

```sql
ALTER TABLE "public"."documentTemplate" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."documentTemplate"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE POLICY "INSERT" ON "public"."documentTemplate"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('settings_create'))::text[])
);
-- UPDATE → USING get_companies_with_employee_permission('<module>_update')
-- DELETE → USING get_companies_with_employee_permission('<module>_delete')
```

- **SELECT** uses `get_companies_with_employee_role()` (any employee of the company can read).
- **INSERT/UPDATE/DELETE** use `get_companies_with_employee_permission('<module>_<action>')`
  where `<action>` is `create` / `update` / `delete` (e.g. `settings_create`, `inventory_update`).
- The old `has_role` / `has_company_permission` pattern is **deprecated** — never use it.

### Tables without a `companyId` column

Reach the company through the parent via `EXISTS`, gating on the same permission.
From `20260614092317_picking-tracked-entity-rls.sql`:

```sql
CREATE POLICY "INSERT" ON "pickingListLineTrackedEntity"
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM "pickingListLine" pll
    WHERE pll."id" = "pickingListLineId"
      AND pll."companyId" = ANY (
        (SELECT get_companies_with_employee_permission('inventory_create'))::text[]
      )
  )
);
```

Gate writes on the **write** permission, not just visibility — a SELECT-only predicate on
INSERT/UPDATE/DELETE is a privilege-escalation bug (the reason that migration exists).

## Views

Always `SECURITY_INVOKER=true` so the underlying tables' RLS applies to the querying user:

```sql
CREATE OR REPLACE VIEW "module_entityView" WITH(SECURITY_INVOKER=true) AS
SELECT e.*, u."fullName" AS "createdByFullName"
FROM "entityName" e
LEFT JOIN "user" u ON u."id" = e."createdBy";
```

## Triggers

There is **no generic boilerplate trigger** to add per table. Triggers in this codebase are
purpose-built (status recomputation, search-index sync, the event-system dispatch) and live
in their own migrations — e.g. `CREATE TRIGGER update_picking_list_status_trigger …`
(`20260601143527_picking-lists.sql`). Don't manufacture an `updatedAt`/`companyId` trigger;
add a trigger only when there's real derived state to maintain. For async/event-driven side
effects use the event system (see `event-system.md`), not ad-hoc triggers.
<!-- UNVERIFIED: no GRANT statements appear in recent migrations; per-table grants are not a current convention -->

## Enums

```sql
CREATE TYPE "warehouseTransferStatus" AS ENUM ('Draft', 'To Ship', 'To Receive', 'Completed');
```

Add new values with `ALTER TYPE "<enum>" ADD VALUE '<v>'` in a later migration (cannot run
inside a transaction block with other statements that use the value).

## Gotchas

- Read the **newest** migration touching a table/function — renames (`shelf`→`storageUnit`,
  `customRule`→`storageRule`) and revised RPCs are common.
- Schema-qualify (`"public"."t"`) on RLS statements; cast helper results `::text[]`.
- After adding a migration, regenerate types (`pnpm db:types`) or typecheck breaks with
  `SelectQueryError` / "excessively deep" errors.
- For DB **access** patterns (clients, services, Kysely transactions) see
  `database-patterns.md`; for the table template + checklist see `conventions-database.md`.
