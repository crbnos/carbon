---
paths:
  - "apps/erp/app/modules/**/*.service.ts"
  - "apps/mes/app/services/**"
---

# Services Conventions

How to **write a service function** — the typed data-access layer between routes and
the database. The cross-cutting client/RLS/transaction story (which client, Kysely vs
supabase-js, RPCs, generated types) lives in
[database-patterns.md](database-patterns.md); this file is about the function shape.

## Where they live

- **ERP**: `apps/erp/app/modules/{module}/{module}.service.ts`
  (e.g. `apps/erp/app/modules/sales/sales.service.ts`,
  `apps/erp/app/modules/inventory/inventory.service.ts`). Re-exported via the module
  barrel `index.ts`; import from the module root (`~/modules/sales`), not the deep file.
- **MES**: flat under `apps/mes/app/services/{name}.service.ts`
  (e.g. `apps/mes/app/services/people.service.ts`,
  `apps/mes/app/services/inventory.service.ts`). **Not** under a `modules/` tree.
  MES also has `{name}.server.ts` files in the same dir for server-only helpers —
  hence the `apps/mes/app/services/**` glob rather than `*.service.ts`.

ERP module layout for context:

```
apps/erp/app/modules/{module}/
├── {module}.models.ts    # zod validators + derived types
├── {module}.service.ts   # data operations (this file's subject)
├── {module}.server.ts    # server-only helpers (optional)
├── index.ts              # barrel re-export
└── ui/                   # components
```

## The function shape

Every service function takes the **client as its first argument** and **returns the raw
supabase `{ data, error }`** — it does **not** throw, and it does **not** unwrap `data`.
The route handler inspects `error`.

```typescript
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitize } from "~/utils/supabase"; // re-exports @carbon/utils

// Get one — real: getCustomer in sales.service.ts
export async function getCustomer(client: SupabaseClient<Database>, id: string) {
  return client.from("customer").select("*").eq("id", id).single();
}
```

- `.single()` when exactly one row is expected; `.maybeSingle()` when zero-or-one
  (e.g. `getOpenClockEntry` in `apps/mes/app/services/people.service.ts`).
- No `try/catch`, no `if (error) throw` — return the response object untouched.

## Lists: `companyId` + `setGenericQueryFilters`

List functions take `companyId` explicitly and a `GenericQueryFilters` arg, run
`setGenericQueryFilters(query, args, [defaultSort])` (`~/utils/query`) for
search/sort/pagination, and select with `{ count: "exact" }`. **Always** scope by
`companyId` — defense in depth even though RLS enforces it too.

```typescript
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";

// real: getCustomers in sales.service.ts
export async function getCustomers(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("customers")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [{ column: "name", ascending: true }]);
  return query;
}
```

For an unpaginated full list (e.g. a select dropdown), use
`fetchAllFromTable(client, table, columns, qb)` from `@carbon/database`, which pages
through large result sets (`getCustomersList` in `sales.service.ts`).

## Upsert: the primary mutation

The canonical write helper is `upsert{Thing}`, branching internally between insert and
update. Two branch styles are both in use:

**By presence of an audit field** (real: `upsertCustomer` in `sales.service.ts`) — the
arg is a discriminated union, `createdBy` ⇒ insert, `updatedBy` ⇒ update:

```typescript
export async function upsertCustomer(
  client: SupabaseClient<Database>,
  customer:
    | (Omit<z.infer<typeof customerValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof customerValidator>, "id"> & {
        id: string;
        updatedBy: string;
      })
) {
  if ("createdBy" in customer) {
    return client.from("customer").insert([customer]).select("id, name").single();
  }
  return client
    .from("customer")
    .update({ ...sanitize(customer), updatedAt: today(getLocalTimeZone()).toString() })
    .eq("id", customer.id)
    .select("id")
    .single();
}
```

**By presence of `id`** (`if (data.id) { update } else { insert }`) is the other common
form. Supabase's native `.upsert(...)` is also used in places — all three are valid.

Notes that match real code:
- Use `.select("id")` (or `"id, name"`) + `.single()` after insert/update to return the
  written row.
- Wrap update payloads in `sanitize(...)` to strip `undefined`/empty values before
  sending (`upsertCustomer`, and the MES `clockOut`/`updateTimeCardEntry`).
- Pure `insert{Thing}` functions exist where there's never an update path (e.g.
  `insertCustomerContact`, `insertManualInventoryAdjustment`).

## Delete

```typescript
// real: deleteCustomer in sales.service.ts
export async function deleteCustomer(
  client: SupabaseClient<Database>,
  customerId: string
) {
  return client.from("customer").delete().eq("id", customerId);
}
```

## Multi-row transactions: Kysely

For multi-row/multi-table writes where partial failure is a bug, the function takes a
`Kysely<KyselyDatabase>` instead of a supabase client and runs `db.transaction().execute`.
Kysely **bypasses RLS** and **throws on rollback** (the route try/catches it). See
[database-patterns.md](database-patterns.md#transactions-kysely) for client wiring.

```typescript
import type { Kysely, KyselyDatabase } from "@carbon/database/client";

// real: updateQuoteLineOrder in sales.service.ts
export async function updateQuoteLineOrder(
  db: Kysely<KyselyDatabase>,
  updates: { id: string; sortOrder: number; updatedBy: string }[]
) {
  return db.transaction().execute(async (trx) => {
    for (const { id, sortOrder, updatedBy } of updates) {
      await trx
        .updateTable("quoteLine")
        .set({ sortOrder, updatedBy })
        .where("id", "=", id)
        .execute();
    }
  });
}
```

A single write is already atomic — don't reach for a transaction.

## Calling out to other helpers

- **Sequence numbers**: `getNextSequence(client, table, companyId)`
  (`~/modules/settings`) calls the `get_next_sequence` RPC and returns `{ data, error }`
  like any other service call — await and check `error` before using `data`. Note the arg
  order: `(client, table, companyId)`.
- **RPCs**: heavy/aggregate logic is `client.rpc("fn_name", { ... })`; the function is
  defined in a migration. See database-patterns.md.

## Naming conventions

| Operation | Name | First arg |
|-----------|------|-----------|
| Get one | `getCustomer(client, id)` | client |
| Get paginated list | `getCustomers(client, companyId, args)` | client |
| Get full (unpaginated) list | `getCustomersList(client, companyId)` | client |
| Create-or-update | `upsertCustomer(client, data)` | client |
| Insert-only | `insertCustomerContact(client, data)` | client |
| Delete | `deleteCustomer(client, id)` | client |
| Multi-row / reorder | `updateQuoteLineOrder(db, updates)` | `Kysely<KyselyDatabase>` |

## Checklist

- [ ] In the right place: ERP `modules/{module}/{module}.service.ts`, MES `services/*.service.ts`.
- [ ] First arg is `client: SupabaseClient<Database>` (or `db: Kysely<KyselyDatabase>` for transactions).
- [ ] Returns the raw `{ data, error }` — does **not** throw, does **not** unwrap.
- [ ] List queries scope `.eq("companyId", companyId)` and run `setGenericQueryFilters`.
- [ ] `.select(...)` + `.single()`/`.maybeSingle()` after insert/update to return the row.
- [ ] Update payloads wrapped in `sanitize(...)`.
- [ ] Multi-row writes use a Kysely transaction (`db.transaction().execute`).
- [ ] Exported from the module barrel (ERP).

<!-- UNVERIFIED: exact set of tables wired into get_next_sequence (e.g. "salesOrder") not re-enumerated here — pass the live table/sequence name the caller uses. -->
