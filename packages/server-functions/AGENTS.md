# @carbon/server-functions

Server functions: privileged, multi-step writes shared by the ERP, MES, the API and
Inngest jobs (posting documents, issuing material, converting quotes, importing CSVs).
One directory per function (`src/<name>/index.ts`), each built with `defineServerFn`.

A function belongs here when it bypasses RLS (Kysely or the service role, so it must
authorize its own caller), writes across several tables in one transaction, or is
shared by more than one app or by jobs. Simple CRUD stays an app service; pure logic
goes to `@carbon/utils` / `@carbon/database`.

## Shape

```ts
const postCharge = defineServerFn({
  name: "post-charge",                       // the directory name
  input: postChargeInput,                    // zod; exported alongside
  permissions: { update: "invoicing" },      // or "system", or { by: "type", rules: {...} }
  async run({ db, companyId, userId }, { type, chargeId }) { ... }
});
export default postCharge;                   // the function is its module's default export
```

Callers go through `serverFns`, the package root's one runtime export, by the function's name:

```ts
import { serverFns } from "@carbon/server-functions";

await serverFns.system({ db, companyId, userId }).invoke("post-charge", input);
await serverFns.as({ client, db, companyId, userId }).invoke("post-charge", input);
await serverFns.system(fields).invokeOrThrow("post-charge", input); // throws ServerFnError
```

The name, input and result are typed from the function's own definition. `system(...)`
is the explicit elevation (no permission check); `as(...)` takes the caller's Supabase
client and runs as whoever is behind it (`ServerFnContext.fromClient`). `invoke` never
throws: a zod failure is a 400 naming the fields, and a refused client, a failed module
load or anything the function throws comes back as `{ data: null, error }`.
`invokeOrThrow` is for a job step, where a throw is what triggers the retry.

`src/invoke.ts` holds the registry: one literal `() => import("./<name>")` per function,
so each loads on first use. `permissions-manifest.test.ts` fails when a directory is
missing from it or a key differs from the function's `name`. Inside this package one
function calls another directly, `fn(ctx, input)`, with the context it was given.

The context's `actor` decides how `authorize` checks the caller:

| Actor | Built by | Checked against |
|---|---|---|
| `system` | `ServerFnContext.system`, or `fromClient` on a service-role client | nothing — passes every rule, and is the only actor a `"system"` rule admits |
| `user` | `ServerFnContext.user`, or `fromClient` on a user's client | the user's claims (`get_claims` over `ctx.db`). `fromClient` requires the client's bearer JWT `sub` to equal `userId`, else `ForbiddenError` — `serverFns.as` binds the client's user to `userId` |
| `apiKey` | `fromClient` on a client carrying a `carbon-key` header | the key's own `scopes`: the key must belong to `companyId` and be unexpired. Never its creator's claims. Rate limiting stays with the route that authenticated the key |

The service-role client (`ctx.supabase()`) is built once per process and the cache
resets after a failed build, so one bad start does not poison later calls.

## Always

- MUST be built with `defineServerFn`. `permissions` is the caller check:
  `{ <action>: "<module>" }`, `{}` (company membership), `"system"` (server-side callers
  only), or `{ by: "<field>", rules: { <value>: <permissions> } }` keyed on a string
  field of the input (a value with no rule is refused). `server-fn-authorizes-caller`
  (`@carbon/checks`) fails an entry point not built with it.
- MUST review `src/__snapshots__/permissions-manifest.test.ts.snap` when changing a
  function's `permissions`: `permissions-manifest.test.ts` snapshots every function's
  declared rule (exposed as `fn.permissions`), so a change to who may run a function is a
  snapshot diff. Update it with `vitest -u` only after reviewing that diff.
- MUST build contexts with `ServerFnContext.system(...)`, `.user(...)` or
  `.fromClient(client, ...)` — never an object literal. `db` comes from
  `getDatabaseClient()` (ERP/MES `~/services/database.server`) or
  `getJobDatabaseClient()` (jobs). Never construct a pool in this package — the one
  exception is `src/local-database-test-fixture.ts`, the live-database test gate
  (`hasLocalDatabase`, `databaseTest`), which opens a one-connection pool for the
  regressions that need real transactions.
- MUST read and write through `ctx.db` or `ctx.supabase()` (the service-role client),
  never a caller's RLS client. Prefer `ctx.db`: in production a PostgREST call takes
  about 52 ms at the median and a direct statement 4.5 ms, so a function that reads
  through the Supabase client pays for every lookup ten times over.
- MUST use `@carbon/database/rows` for a read whose rows are copied or compared as PostgREST
  would return them: `selectRows` / `selectRow`, or `single` / `maybeSingle` / `many`
  for code written against `{ data, error }`. They go through `to_jsonb`, so timestamps
  stay strings at full precision (a Kysely row hands back a `Date` cut to the
  millisecond), `columns` is the select list, `embed` nests child rows, and there is
  no 1000-row cap. `isNull` is `IS NULL`; a `null` value matches nothing, as `.eq` does.
  Plain Kysely is fine for a narrow lookup with no timestamps.
- MUST read on the transaction (`trx`) while one is open, never on `db`: a second
  pooled connection per open transaction can exhaust the process's sixteen. A read that
  must NOT see the transaction's own writes needs a reason and a comment.
- MUST run a group of lookups with `inOrder` rather than `Promise.all`: each query
  started at once takes its own pooled connection, and opening one costs more than the
  reads do.
- MUST re-read record ids from the input under `companyId` before writing
  (`assertCompanyRecords`).
- MUST throw `NotFoundError` for a missing record, `InvalidInputError` for input the
  schema cannot express, `ServerFnError(message, status, body)` otherwise. A data-layer
  failure surfaces with an empty `message`, so callers keep their fallback copy
  (`error.message || "…"`).
- MUST be called through `serverFns` from apps, jobs and `packages/ee`, never by
  importing the function's module. The package root exports only `serverFns` and types,
  and `invoke.ts` imports only types at module scope, so a browser-bundled
  `*.service.ts` can import the root statically. Never add a runtime export to
  `src/index.ts`: `defineServerFn`, the context and the error classes load `@carbon/env`
  and the logger, which must stay out of the browser graph.
- MUST add a new function to the registry in `src/invoke.ts` and export it as the
  module's default.

## Never

- Never make a context `system` from request input. Use `ServerFnContext.system` only
  where no user is behind the call (jobs, syncers) or the caller already checked the
  permission; `fromClient` decides from the client's key.
- Never import a `.server` module, not even with a lazy `import()`. Services `import()`
  this package, so it is in the browser graph and the React Router build fails with
  "Server-only module referenced by client". That is why `authorize` reads `get_claims`
  over `ctx.db` and the service-role client is built here. `pnpm --filter erp build`
  catches it; typecheck does not.

## Validation Commands

```bash
pnpm --filter @carbon/server-functions test
pnpm exec turbo run typecheck --filter=@carbon/server-functions --concurrency=1
pnpm --filter @carbon/checks test
```

## Key Exports

| Subpath | Provides |
|---|---|
| `.` | `serverFns` (`system(fields)` / `as(caller)` → `invoke(name, input)`, `invokeOrThrow`), `serverFnNames`, and types only: `ServerFnName`, `ServerFnInput<Name>`, `ServerFnResult`, `ServerFn`, `PermissionRule`, `Actor`, `Permissions`, `RequiredPermissions`, `ServerFnError` (as a type). Browser-safe: nothing else is loaded until a function is invoked |
| `./errors` | `ServerFnError`, `InvalidInputError`, `ForbiddenError`, `NotFoundError`, `isDataLayerError`, `toServerFnError` — the classes, for `instanceof` and `new` |
| `./<name>` | one server function as the default export, plus its input schema and result types (`src/<name>/index.ts`) |

Shared posting internals live in `src/lib/` (not exported): `get-accounting-period` (`resolveAccountingPeriod`, `getCurrentAccountingPeriod`, `getAccountingPeriodForDate`), `get-posting-group` (`getDefaultPostingGroup`, `resolveInventoryAccount`), `calculate-cogs`, `storage-units`, `postable` (`assertPostable` — only a Draft or Pending document is posted; called BEFORE the function's `try`, whose failure handler resets the document to Draft), `fixed-asset-writes` (`FixedAssetWrites` — asset changes decided while the journal is built are staged and applied inside the posting transaction, never written on `db` directly), and the inventory-adjustment core — `post-adjustment` (`bookAdjustment`, `createAdjustmentJournal`, `loadOpenCostLayers`), the pure row builders in `plan-adjustment` and `post-adjustment-cost` (`computeCurrentUnitCost`). Pure logic that the apps also need goes to `@carbon/utils` / `@carbon/database`, not here.

Two more internal helpers sit at the `src/` root (not exported): `shelf-life.ts`
(the company's expired-entity policy and expiry checks, used by `issue` and
`post-stock-transfer`) and `tracked-entity-attributes.ts` (`attributesContain`, the
`"attributes" @> …` form the `trackedEntity` GIN index serves, used by
`assign-serial-numbers`, `post-picking` and `post-stock-transfer`).
