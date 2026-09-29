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
export const postCharge = defineServerFn({
  name: "post-charge",                       // the directory name
  input: postChargeInput,                    // zod; exported alongside
  permissions: { update: "invoicing" },      // or "system", or { by: "type", rules: {...} }
  async run({ db, companyId, userId }, { type, chargeId }) { ... }
});

await postCharge(ServerFnContext.system({ db, companyId, userId }), input);
await postCharge.withClient(client, db, { companyId, userId, ...input });
```

`defineServerFn` validates the input (a zod failure is a 400 naming the fields),
authorizes, runs, and returns `{ data, error }` — it never throws. `withClient` builds
its context inside a try as well, so a refused client also comes back as `{ error }`.

The context's `actor` decides how `authorize` checks the caller:

| Actor | Built by | Checked against |
|---|---|---|
| `system` | `ServerFnContext.system`, or `fromClient` on a service-role client | nothing — passes every rule, and is the only actor a `"system"` rule admits |
| `user` | `ServerFnContext.user`, or `fromClient` on a user's client | the user's claims (`get_claims` over `ctx.db`). `fromClient` requires the client's bearer JWT `sub` to equal `userId`, else `ForbiddenError` — `withClient` binds the client's user to the input's `userId` |
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
- MUST read and write through `ctx.supabase()` (the service-role client) or `ctx.db`,
  never a caller's RLS client.
- MUST re-read record ids from the input under `companyId` before writing
  (`assertCompanyRecords`).
- MUST throw `NotFoundError` for a missing record, `InvalidInputError` for input the
  schema cannot express, `ServerFnError(message, status, body)` otherwise. A data-layer
  failure surfaces with an empty `message`, so callers keep their fallback copy
  (`error.message || "…"`).
- MUST be imported lazily (`await import("@carbon/server-functions/<name>")`) from a
  `*.service.ts`: service files are bundled for the browser. Routes, `.server.ts` files
  and jobs import statically.

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
| `.` | `defineServerFn`, `ServerFn`, `ServerFnResult`, `PermissionRule`; `ServerFnContext`, `Actor`, `Permissions`, `authorize`, `clientUsesKey`; `ServerFnError`, `InvalidInputError`, `ForbiddenError`, `NotFoundError`, `isDataLayerError`, `toServerFnError`; `assertCompanyRecords`; `hasPermissions`, `permissionsFromClaims`, `RequiredPermissions`, `ModulePermissions` |
| `./<name>` | one server function (`src/<name>/index.ts`) |

Shared posting internals live in `src/lib/` (not exported): `get-accounting-period` (`resolveAccountingPeriod`, `getCurrentAccountingPeriod`, `getAccountingPeriodForDate`), `get-posting-group` (`getDefaultPostingGroup`, `resolveInventoryAccount`), `calculate-cogs`, `storage-units`, and the inventory-adjustment core — `post-adjustment` (`bookAdjustment`, `createAdjustmentJournal`, `loadOpenCostLayers`), the pure row builders in `plan-adjustment` and `post-adjustment-cost` (`computeCurrentUnitCost`). Pure logic that the apps also need goes to `@carbon/utils` / `@carbon/database`, not here.

Two more internal helpers sit at the `src/` root (not exported): `shelf-life.ts`
(the company's expired-entity policy and expiry checks, used by `issue` and
`post-stock-transfer`) and `tracked-entity-attributes.ts` (`attributesContain`, the
`"attributes" @> …` form the `trackedEntity` GIN index serves, used by
`assign-serial-numbers`, `post-picking` and `post-stock-transfer`).
