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

## The result contract

Every exported service is also an API/MCP operation, and the dispatcher
(`apps/erp/app/routes/api+/v1+/lib/normalize-result.server.ts`) decides success
or failure from the **declared return type**, classified by `pnpm generate:mcp`
(`scripts/lib/result-shape.ts`) into the manifest's `resultShape`. A service
returns exactly one of:

- **`{ data, error }`** (plus `count` for a paged read) — a PostgREST/storage/
  functions response, or the hand-rolled equivalent. The error is thrown to
  the caller; `data` is returned.
- **An array of those** — `Promise.all` over per-row updates. Any element's
  error fails the call, exactly as the routes check `updates.some((u) => u.error)`.
- **Nothing** (`void`), or a **plain value** that cannot fail (a pure
  computation, a Kysely transaction that throws on failure).

What the generator refuses (and `pnpm check:manifest` fails on):

- A plain object with a member named `error`, `success` or `ok` — `{ error }`
  alone, `{ rows, error }`, `{ success: false, message }`, `{ ok: false, reason }`.
  None of them reaches a caller as a failure. Put the payload in `data`
  (`{ data: { rows, expandedParentIds }, error }`) and return `{ data: null, error }`.
- A union mixing an envelope with a plain value.
- A `bigint` anywhere in the result (Kysely's `numDeletedRows`) — JSON cannot
  carry it. Return `{ removed: Number(result.numDeletedRows) }`.

Write a refusal the caller can act on as `ruleError(message)` (`~/utils/supabase`):
its message reaches API/MCP callers as written, where a database failure is
reduced to a fixed public message. A route that needs more than the message
(e.g. a reason to branch on) spreads extra fields onto it —
`{ ...ruleError(message), reason: "no-plan" }` (`generateAssemblyStepsFromPlan`).
A single-record read that can find nothing without erroring (an RPC returning a
set) reports zero rows as `{ code: "PGRST116" }`, the not-found a `.single()`
read gives (`getOpportunity`).

### Every awaited response's `error` is read

A service that awaits a query must read its `error` (or return the response
whole). `const { data } = await q` followed by `data ?? []` turns a failed
read into an empty success — the API and MCP answer "no rows" when the query
failed. When a UI caller wants to degrade to an empty view, return the empty
value in `data` next to the error (`getModelByItemId`, `getBaseCatalog`) and let
the route read `.data`; the dispatcher still throws the error to API/MCP callers.
`apps/erp/test/mcp-service-error-contract.test.ts` scans every exported service
for awaited Supabase/storage/functions responses whose error is neither read
nor forwarded, against `mcp-service-error-contract.baseline.json`. The baseline
may only shrink: fix a site, then regenerate it with
`UPDATE_ERROR_BASELINE=1 pnpm vitest run test/mcp-service-error-contract.test.ts`.

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
- [ ] Never `{ error }` alone, `{ success/ok: false }`, or a bigint (see The result contract).
- [ ] Every awaited query's `error` is read or the response is returned whole.
- [ ] List queries scope `.eq("companyId", companyId)` and run `setGenericQueryFilters`.
- [ ] `.select(...)` + `.single()`/`.maybeSingle()` after insert/update to return the row.
- [ ] Update payloads wrapped in `sanitize(...)`.
- [ ] Multi-row writes use a Kysely transaction (`db.transaction().execute`).
- [ ] Exported from the module barrel (ERP).

<!-- UNVERIFIED: exact set of tables wired into get_next_sequence (e.g. "salesOrder") not re-enumerated here — pass the live table/sequence name the caller uses. -->
