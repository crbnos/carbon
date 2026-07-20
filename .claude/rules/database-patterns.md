---
paths:
  - "packages/database/**"
  - "apps/erp/app/modules/**/*.service.ts"
  - "apps/mes/app/services/**/*.service.ts"
---

# Database Access Patterns

How Carbon talks to its database. The DB is **Postgres via Supabase**. Two clients are used:

1. **supabase-js** (`@supabase/supabase-js`) — the default for almost all reads/writes. Goes
   through PostgREST and is subject to **RLS**.
2. **Kysely** (`kysely` + `kysely-supabase`) — a typed query builder over a raw `pg` pool.
   Used only for **multi-row transactions**. **Bypasses RLS** — auth must be enforced at the route.

There is no Prisma/Drizzle/TypeORM here. Do not introduce another ORM.

## Clients (`@carbon/auth`)

All client factories live in `packages/auth/src/lib/supabase/`.

| Factory | Source | RLS? | Use |
| --- | --- | --- | --- |
| `getCarbon(accessToken?)` | `client.ts` (anon key + user JWT) | Yes (acts as the user) | Default request-scoped client |
| `getCarbonServiceRole()` | `client.server.ts` (service role key) | No (bypasses RLS) | Server-only privileged ops, jobs, edge functions |
| `getCarbonAPIKeyClient(apiKey)` | `client.ts` (`carbon-key` header) | Yes | Public API key auth |

`createClient` is configured with `autoRefreshToken: false`, `persistSession: false`, and a
`fetchWithRetry` wrapper (retries 5xx/408/timeouts with backoff). Do not re-create this config ad hoc.

### Getting a client in a route

Loaders/actions never construct a client directly. They call `requirePermissions`
(`packages/auth/src/services/auth.server.ts`), which authenticates the request and returns the
right client plus context:

```typescript
import { requirePermissions } from "@carbon/auth/auth.server";

const { client, companyId, userId } = await requirePermissions(request, {
  view: "sales",          // permission_action, e.g. "sales_view" is checked internally
});
```

- It checks the user's claims for the required `<module>_<action>` permission and **redirects on
  denial**. It also handles the `carbon-key` API-key path (rate limiting, scope checks).
- Pass `bypassRls: true` to get `getCarbonServiceRole()` instead (only honored for `employee` role).
- `userId` is the effective user (respects console/impersonation); `sessionUserId` is the raw session user.

## Service functions

DB logic lives in service files, **not** in route handlers:

- ERP: `apps/erp/app/modules/{module}/{module}.service.ts`
- MES: `apps/mes/app/services/{name}.service.ts`

Each function takes the **client as its first argument** and returns the raw supabase `{ data, error }`
(it does **not** throw). The route handler inspects `error` and converts it with `flash(request, error(...))`.

```typescript
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function getCustomer(client: SupabaseClient<Database>, id: string) {
  return client.from("customer").select("*").eq("id", id).single();
}
```

Conventions (see also `conventions-services.md`):

- Always scope list queries by `companyId` (`.eq("companyId", companyId)`) — defense in depth even though RLS also enforces it.
- List endpoints take `GenericQueryFilters` and run through `setGenericQueryFilters(query, args, [...])` (`~/utils/query`) for search/sort/pagination; use `.select("*", { count: "exact" })`.
- Use `sanitize(...)` (re-exported from `@carbon/utils`) to strip empty values before insert/update.
- Upserts are done either with a manual `id ? update : insert` branch or supabase's native `.upsert(...)`; both are in use.
- `fetchAllFromTable(client, table, columns, qb)` (from `@carbon/database`) pages through large result sets.

## RPC functions

Heavy/aggregate logic lives in Postgres functions called via `client.rpc("fn_name", { ... }, { count })`.
Examples: `get_sales_order_lines_by_customer_id`, `get_opportunity_with_related_records`,
`get_quote_methods`, `get_part_details`. Use an RPC when the query is non-trivial or needs a transaction
that supabase-js can't express; the function is defined in a migration.

## Transactions (Kysely)

For **multi-row / multi-table writes** where partial failure is a bug, use Kysely. The route passes
`getDatabaseClient()` (`apps/erp/app/services/database.server.ts` — a cached singleton over a 10-conn
`pg` pool built by `getPostgresClient`/`getPostgresConnectionPool` in
`packages/database/supabase/functions/lib/postgres/index.ts`).

Every `client.from(...).update(...)` is a separate HTTP roundtrip to PostgREST. With `Promise.all`,
some rows can commit and the rest fail, leaving data in a half-applied state with no rollback.
Kysely opens one PG transaction, runs every write inside it, and rolls everything back on any error.

**Use transactions when:**
- Bulk reorder / sortOrder updates across N rows.
- Writes that span multiple tables and need all-or-nothing semantics (e.g. parent + child rows, denormalized counters).
- Anything where partial application would be a real bug, not a cosmetic glitch.

**Don't use transactions when:**
- A single write (already atomic).
- Reads only — keep using the Supabase client (`client.from(...).select(...)`); Kysely has no auth/RLS context.
- Throwaway/idempotent fan-out where partial failure is fine and retry is cheap.

### Service function example

`Kysely<KyselyDatabase>` is the first arg by convention. The route passes `getDatabaseClient()`.
Real precedents: `items.service.ts → upsertPickMethodWithShelfLife`,
`update<Entity>LineOrder` functions across purchasing, sales, invoicing services.

```typescript
import type { Kysely, KyselyDatabase } from "@carbon/database/client";

export async function updatePurchaseOrderLineOrder(
  db: Kysely<KyselyDatabase>,
  updates: { id: string; sortOrder: number; updatedBy: string }[]
) {
  return db.transaction().execute(async (trx) => {
    for (const { id, sortOrder, updatedBy } of updates) {
      await trx
        .updateTable("purchaseOrderLine")
        .set({ sortOrder, updatedBy })
        .where("id", "=", id)
        .execute();
    }
  });
}
```

### Route handler example

```typescript
import { getDatabaseClient } from "~/services/database.server";
import { updatePurchaseOrderLineOrder } from "~/modules/purchasing";

export async function action({ request, params }: ActionFunctionArgs) {
  const { userId } = await requirePermissions(request, { update: "purchasing" });
  // ... build `updates` from formData ...
  try {
    await updatePurchaseOrderLineOrder(getDatabaseClient(), updates);
  } catch (err) {
    return data(
      { success: false },
      await flash(request, error(err, "Failed to update sort order"))
    );
  }
  return { success: true };
}
```

### Key notes

- Kysely **throws** on rollback — use `try/catch`, not the `{ error }` return pattern.
- Kysely **does not apply RLS**. Authorize at the route with `requirePermissions` before calling it;
  when in doubt, scope queries by `companyId` inside the transaction.
- Single writes are already atomic — don't reach for a transaction.
- Kysely auto-quotes reserved column names (e.g. `order`), so `.set({ order: sortOrder })` is safe.
- Kysely uses a connection pool and the Postgres role — enforce auth at the route, not in the service.

## RLS / permission model

- Multi-tenant: nearly every table has `companyId` (composite PK `("id", "companyId")`).
- Standardized policy names `SELECT` / `INSERT` / `UPDATE` / `DELETE`, gated by SQL helpers
  `get_companies_with_employee_role()` (read) and `get_companies_with_employee_permission('<module>_<action>')`
  (write). Verified current in the newest migrations (e.g. `20260603140000_storage-rules-inventory-rls.sql`).
- RLS is the real authorization boundary for supabase-js clients; `requirePermissions` is the app-layer gate
  (and the only gate for service-role / Kysely paths). See `conventions-database.md` for the table+RLS template.

## Generated types

- `packages/database/src/types.ts` (and `supabase/functions/lib/postgres/index.ts` consumes it as
  `SupabaseDatabase`) are **generated — never hand-edit**.
- `Database` is re-exported from `@carbon/database`; the Kysely shape is `KyselyDatabase`
  (`KyselifyDatabase<SupabaseDatabase>`) from `@carbon/database/client`.
- Row/Insert/Update types: `Database["public"]["Tables"]["customer"]["Row" | "Insert" | "Update"]`.
- Regenerate with `pnpm run db:types` (`scripts/generate-db-types.ts`); requires the local Supabase DB
  running with all migrations applied. After merging branches that add migrations, regenerate or
  typecheck fails with `SelectQueryError` / "excessively deep" errors.

## Migrations

- Live in `packages/database/supabase/migrations/`, timestamp-prefixed and applied in order via the
  Supabase CLI. Read the **newest** relevant migration for current schema/RLS truth — not the first.
- New migration: `npm run db:migrate <name>` (avoid `000000` HHMMSS to prevent cross-branch collisions).
- Follow `workflow-database-migration.md` and `conventions-database.md` when adding tables.

<!-- UNVERIFIED: realtime postgres_changes subscriptions exist in app code (e.g. apps/erp/app/hooks/useRealtime.tsx, RealtimeDataProvider.tsx) but are a UI concern, not a service-layer pattern, so omitted from this rule. -->
