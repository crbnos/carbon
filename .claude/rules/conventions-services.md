---
paths:
  - "apps/erp/app/modules/**/*.service.ts"
  - "apps/erp/app/modules/**/*.server.ts"
  - "apps/erp/app/modules/*.server.ts"
  - "apps/mes/app/services/**"
---

# Services Conventions

How to **write a service function** — the typed data-access layer between routes and
the database. The cross-cutting client/RLS/transaction story (which client, Kysely vs
supabase-js, RPCs, generated types) lives in
[database-patterns.md](database-patterns.md); this file is about the function shape.

## Where they live

- **ERP**: every operation is a `defineServiceFn` const in
  `apps/erp/app/modules/{module}/{module}.server.ts`. The queries and writes it
  calls are building blocks in `{module}.service.ts`. File layout, naming and
  the checks that enforce them: [module-files.md](module-files.md).
- **MES**: flat under `apps/mes/app/services/{name}.service.ts`
  (e.g. `apps/mes/app/services/people.service.ts`). **Not** under a `modules/`
  tree. MES also has `{name}.server.ts` files in the same dir for server-only
  helpers, hence the `apps/mes/app/services/**` glob.

## Operations: `defineServiceFn`

Each operation a route, the API, MCP or a workflow can run is one
`defineServiceFn` const (`@carbon/api/service-fn.server`), so a tool does
exactly what the button does. Plan:
`.ai/plans/2026-10-15-service-function-migration.md`.

```ts
/**
 * Cancel a job.                      ← the title (API, MCP)
 *
 * @remarks
 * What it does, in order.            ← the description
 *
 * @mcp destructive                   ← published, labelled destructive
 */
export const cancelJob = defineServiceFn({
  input: z.object({ jobId: z.string() }),
  permission: { update: "production" },
  async run(ctx, { jobId }) {
    // ...
    if (!update.updated) return ctx.error("conflict", "The job's status changed");
    return { jobId };
  }
});
```

- **Result**: callers get `{ data, error }`, never a throw. `run` returns its
  value or `ctx.error(category, message, cause)`; a throw becomes `internal`
  with the cause logged and withheld. The error union is inferred.
- **Gate**: every ENTRY call is checked against `permission` for its actor
  (`user` claims, `apiKey` scopes; `system` passes). `{}` means company
  membership, `"system"` admits only the system actor, `{ by, rules }` keys
  the rule on an input field. A call made from inside another function's
  `run` is not checked again.
- **Context**: `ctx.asCaller.supabase` (RLS), `ctx.asSystem.supabase` /
  `ctx.asSystem.pg` (no RLS: scope every query by `ctx.company.id`), `ctx.kv`,
  `ctx.auditUserId` for `createdBy` / `updatedBy`. `ctx.can(required)` checks
  a permission the data decides (a posting mode, reopening a completed
  transfer). Before an RLS-bypassing write keyed on an id the caller sent,
  `refuseUnlessOwned(ctx, table, match)` (`shared/shared.service.ts`) returns
  a refusal unless the row is the company's.
- **Transactions**: `ctx.transaction(async (tx) => …)` on `asSystem.pg`. A
  returned `CarbonError` rolls back; a nested call joins the open
  transaction; `tx.asCaller` throws, because that client is outside it.
- **Routes**: `const api = await carbon(request)` (`@carbon/api/carbon.server`)
  authenticates the caller and returns the router: `api.production.cancelJob(input)`
  resolves to the result, its error a plain `{ category, message, status }`.
  A route that needs the auth result for more than the call (a role gate, a
  stream) builds the context with `serviceContext(auth)`
  (`modules/service-context.server.ts`); a caller with no session (a public
  share link) uses `systemContext({ companyId, companyGroupId, onBehalfOf })`.
- **Published**: `@mcp` in the TSDoc publishes the const as the MCP tool
  `{module}_{name}` and `POST /api/v1/{module}/{name}`. The permission decides
  the classification (only `view` → READ, any `delete` → DESTRUCTIVE, else
  WRITE); `@mcp read` forces READ (a read gated on `update`), `@mcp destructive`
  forces DESTRUCTIVE. `@param name - text` describes an input field. Publish
  an operation only when it is safe with nothing but its input: the API runs
  the gate and `run`, nothing the route does around the call.
- **Enforced**: `route-action-shape` (`@carbon/checks`) fails a new client,
  Kysely or `invokePosting` write in an ERP route; `service-fn-file` fails
  anything but service functions in `{module}.server.ts`.

## Building blocks: `{module}.service.ts`

The rest of this file is about the building blocks an operation calls.

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
`UPDATE … FROM (VALUES …)` that throws, rolling back, if any id falls outside that scope. The
operation passes `ctx.company.id` and `ctx.auditUserId`, never values from its input.

A single write is already atomic — don't reach for a transaction.

**Never construct the Kysely client (or a `pg` pool) inside the service.** The service
takes `db: Kysely<KyselyDatabase>` as an argument and nothing more. Inside an operation that
handle is `ctx.asSystem.pg` (or the `tx` of `ctx.transaction`). Enforced by the
`no-db-client-in-service` conformance check (`@carbon/checks`).

## Calling out to other helpers

- **Sequence numbers**: `getNextSequence(client, table, companyId)`
  (`~/modules/settings/settings.service`) calls the `get_next_sequence` RPC and returns `{ data, error }`
  like any other service call — await and check `error` before using `data`. Note the arg
  order: `(client, table, companyId)`.
  A caller-supplied number (custom ID, API, MCP) needs no counter code: the
  `sync_advance_document_sequence` interceptor moves the sequence past any number saved
  in its format.
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

- [ ] In the right place: an operation in `{module}.server.ts`, a building block in `{module}.service.ts`, MES `services/*.service.ts`.
- [ ] First arg is `client: SupabaseClient<Database>` (or `db: Kysely<KyselyDatabase>` for transactions).
- [ ] Returns the raw `{ data, error }` — does **not** throw, does **not** unwrap.
- [ ] List queries scope `.eq("companyId", companyId)` and run `setGenericQueryFilters`.
- [ ] `.select(...)` + `.single()`/`.maybeSingle()` after insert/update to return the row.
- [ ] Update payloads wrapped in `sanitize(...)`.
- [ ] Multi-row writes use a Kysely transaction (`db.transaction().execute`).

<!-- UNVERIFIED: exact set of tables wired into get_next_sequence (e.g. "salesOrder") not re-enumerated here — pass the live table/sequence name the caller uses. -->
