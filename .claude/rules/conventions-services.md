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

### Search and filters

- A single-column search may use `.ilike(column, …)` as above. A search over several columns
  goes through `setSearchFilter(query, search, columns)` (`~/utils/query`). It
  strips `,()\`, splits the rest into tokens, and requires every token to match one of the
  columns ("M8 washer" finds "Washer, Flat, M8"). Never interpolate a caller value into
  `.or(...)` by hand: `.or()` takes one string in PostgREST's logic-tree grammar, so a comma in
  the search splits it into a broken condition (PGRST100, reported as an unknown database error).
- Search on ONE embedded resource: select the embed `!inner` and pass
  `{ referencedTable: "embed" }` (`getProductionEvents`, `getMethodMaterials`). Without `!inner`
  a filter on an embed nulls the embed and still returns the row.
- A dotted embedded column (`embed.col.ilike…`) inside a top-level `.or()` is always rejected by
  PostgREST. A search across a parent column AND an embedded column is a view column, or resolve
  the embedded matches to ids first and OR `fkId.in.(…)` with `searchCondition(search, columns)`
  (`getCustomerItemPriceOverridesList`).
- Only values from an id list (`col.in.(…)`) or id-named variables may be interpolated into
  `.or()`.
- Every key in a READ function's args type is published as an API/MCP filter. Apply each one
  (`if (args.status) query = query.eq("status", args.status)`) or remove it; an unread key is a
  filter that silently returns every row.
- Enforced by the `no-raw-or-filter` and `declared-arg-unused` conformance checks
  (`@carbon/checks`).

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
  written row. For an update this is also what makes a miss an error: see
  [Confirming a write](#confirming-a-write).
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
  return client
    .from("customer")
    .delete()
    .eq("id", customerId)
    .select("id")
    .single();
}
```

## Confirming a write

PostgREST answers an UPDATE or DELETE that matches no row with 204, and supabase-js returns
`{ data: null, error: null }`. The route, the API and the MCP server all read that as success, so
a wrong id, a readable id where the key is a uuid, a row RLS hides, or a status guard that no
longer holds all report "done" while nothing changed.

- A write keyed on the row's unique key (`id`, or the table's own key such as `customerId` on
  `customerPayment`) ends `.select("id").single()`. A miss becomes PGRST116, which the API maps
  to "no matching record was found" and the UI shows through its existing `result.error` flash.
  `.select()` alone does not do it (a miss is `data: []`); neither does `.maybeSingle()` unless
  the caller then checks `!result.data` (`updateChangeNoticeStatus`).
- A write keyed on a non-unique column (`.eq("quoteId", id)`, `.in("id", ids)`) must NOT end in
  `.single()`: PostgREST rolls back a singular-response write that touches more than one row.
  Zero rows is a success there by design; add `.select("id")` only when a caller checks the
  count.
- A write that only applies in a state (`.eq("status", "Draft")`) pre-reads the row and returns
  `{ data: null, error: ruleError("… is not in Draft status") }` (`ruleError` from
  `~/utils/supabase`; `postJournalEntry`, `deleteJournalEntry`). Keep the guard in the write too,
  with `.single()`, for the race. A bare `{ message }` error is masked by the API as an unknown
  database error; `ruleError` is shown as written.
- An idempotent clear ("remove the shelf-life row if there is one") stays bare; the check
  baselines it.
- Kysely writes: check `numUpdatedRows` / `numDeletedRows` when a zero-row write is a caller
  error.
- Enforced for supabase-js chains in ERP services by the `no-unconfirmed-write` conformance
  check (`@carbon/checks`); current hits are baselined and burned down per module.

## Multi-row transactions: Kysely

For multi-row/multi-table writes where partial failure is a bug, the function takes a
`Kysely<KyselyDatabase>` instead of a supabase client and runs `db.transaction().execute`.
Kysely **bypasses RLS** and **throws on rollback** (the route try/catches it). See
[database-patterns.md](database-patterns.md#transactions-kysely) for client wiring.

```typescript
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { updateSortOrder } from "../shared/sort-order";

// real: updateQuoteLineOrder in sales.service.ts
export async function updateQuoteLineOrder(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  userId: string,
  quoteId: string,
  updates: { id: string; sortOrder: number }[]
) {
  return updateSortOrder(db, {
    table: "quoteLine",
    column: "sortOrder",
    companyId,
    userId,
    parent: { column: "quoteId", id: quoteId },
    updates
  });
}
```

Because Kysely bypasses RLS, a Kysely service **always** scopes by `companyId` — and by the
parent document id when the row ids come from the request — in the SQL itself. Never a per-row
query in a loop: `updateSortOrder` (`modules/shared/sort-order.ts`) is one
`UPDATE … FROM (VALUES …)` that throws, rolling back, if any id falls outside that scope. Name
the tenant params `companyId` / `userId` so the API dispatcher injects them from the auth
context rather than the body.

A single write is already atomic — don't reach for a transaction.

**Never construct the Kysely client (or a `pg` pool) inside the service.** The service
takes `db: Kysely<KyselyDatabase>` as an argument and nothing more — importing
`@carbon/database/client`'s `getPostgresConnectionPool`/`getPostgresClient` or `kysely`'s
`PostgresDriver` here (even behind a dynamic `import()`) pulls server-only code into the
browser bundle, because `{module}.service.ts` is re-exported through the module barrel that
client components import. Build the handle once in a `.server` file — `getDatabaseClient()`
from `~/services/database.server` — import it in the **route action**, and pass it in. This
is enforced by the `no-db-client-in-service` conformance check (`@carbon/checks`); the
route-wiring example is in [database-patterns.md](database-patterns.md#transactions-kysely).

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
| Multi-row / reorder | `updateQuoteLineOrder(db, companyId, userId, quoteId, updates)` | `Kysely<KyselyDatabase>` |

## Checklist

- [ ] In the right place: ERP `modules/{module}/{module}.service.ts`, MES `services/*.service.ts`.
- [ ] First arg is `client: SupabaseClient<Database>` (or `db: Kysely<KyselyDatabase>` for transactions).
- [ ] Returns the raw `{ data, error }` — does **not** throw, does **not** unwrap.
- [ ] List queries scope `.eq("companyId", companyId)` and run `setGenericQueryFilters`.
- [ ] `.select(...)` + `.single()` after insert/update to return the row; `.select("id").single()`
      on every update/delete keyed on a unique key (not on multi-row writes).
- [ ] Status-guarded writes pre-read and return `ruleError(...)`.
- [ ] Search through `setSearchFilter`; every declared args key is applied.
- [ ] Update payloads wrapped in `sanitize(...)`.
- [ ] Multi-row writes use a Kysely transaction (`db.transaction().execute`).
- [ ] Exported from the module barrel (ERP).

<!-- UNVERIFIED: exact set of tables wired into get_next_sequence (e.g. "salesOrder") not re-enumerated here — pass the live table/sequence name the caller uses. -->
