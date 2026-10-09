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

## Journals and the accounting cutover

Every posting function writes its journal for every company. The company's
`companySettings.accountingCutoverDate` decides only the journal's status
(`.ai/specs/2026-10-08-accounting-cutover.md`). The `accountingEnabled` column still
exists, but no code reads it.

- **Status.** `journalPostingStatus(db, companyId)` (`@carbon/database/journal-posting-status`)
  returns `Provisional` when the company has no cutover and `Posted` when it has one.
  `postingStatusFor(cutoverDate)` is the same decision without a read, and
  `readAccountingCutoverDate` returns the date. All reads take `FOR SHARE`. The SQL
  posting functions (`complete_job_to_inventory`, `backflush_job_materials`) call
  `journal_posting_status(company_id)`.
- **The double read.** A function reads the status once before its transaction, to
  decide whether to resolve an accounting period. It reads it again inside the
  transaction, where `FOR SHARE` holds it until commit. A mismatch throws "Accounting
  was just set up. Post the document again." `activate-accounting` takes `FOR UPDATE`
  on the same row, so no posting writes a Provisional journal after the enable commits.
- **No period before the cutover.** A Provisional journal has `accountingPeriodId`
  null, and no posting creates a period for it. Resolve a period only when the status
  is `Posted`.
- **Stand-in lines.** `resolveDefaultAccount(defaults, role, postingStatus)` picks the
  account for a line that needs one of the nullable defaults in `OPTIONAL_DEFAULT_ROLES`.
  A set default is used as is. Before the cutover an empty one returns
  `retainedEarningsAccount` with `accountDefaultRole = role`, and the line stores that
  role in `journalLine.accountDefaultRole`. After the cutover an empty one throws "Set
  the <role> account default in Accounting → Defaults." A void copies
  `accountDefaultRole` from each original line to its reversal. Exceptions: after the
  cutover an empty `scrapAccount` still falls back to
  `inventoryAdjustmentVarianceAccount` (`issue`, `post-nonconformance`), and an empty `salesReturnsAccount`
  to `salesAccount` (`post-memo`). `revenueRecognitionSchedule` rows have no role
  column, so `post-sales-invoice` writes retained earnings on them and the enable
  re-points them by account.
- **Journal readers filter by a named status list** from
  `@carbon/database/accounting-posting`: `GL_JOURNAL_STATUSES` (Posted, Reversed) for
  balances, reports and tie-outs; `DOCUMENT_JOURNAL_STATUSES` (Provisional, Posted,
  Reversed) for a reader that follows one document's chain (void builders, GR/IR, WIP
  sums, intercompany lookups); `OPEN_ITEM_JOURNAL_STATUSES` (Provisional, Posted) for
  the payment control lookups and the memo, charge and reimbursement void checks. The
  `journal-status-filter` check (`@carbon/checks`) fails a `status <> 'Draft'` filter
  on a journal.
- **Opening lines.** The opening journal of the enable (`sourceType 'Opening Balance'`)
  copies the document keys and descriptions the original posting wrote. So the payment
  control lookups in `post-payment` accept `sourceType 'Opening Balance'` as well as the
  invoice, memo and `Payment` source types.
- **Voids of a document dated before the cutover** (`src/lib/cutover-void.ts`,
  `isBeforeCutover` in `@carbon/database/accounting-cutover-dates`):
  - A receipt or shipment void throws `INVENTORY_VOID_BEFORE_CUTOVER_ERROR` ("… Record a
    return or an inventory adjustment instead.").
  - A sales invoice void throws `SALES_INVOICE_VOID_BEFORE_CUTOVER_ERROR` ("… Issue a
    credit memo instead."). A purchase invoice void throws
    `PURCHASE_INVOICE_VOID_BEFORE_CUTOVER_ERROR` ("… Record a debit memo instead.").
  - A charge void throws `CHARGE_VOID_BEFORE_CUTOVER_ERROR` and a reimbursement void
    throws `REIMBURSEMENT_VOID_BEFORE_CUTOVER_ERROR` ("… Record a journal entry to
    correct it instead."). The date is `postingDate`, else `transactionDate` or
    `reimbursementDate`, as the posting uses.
  - A payment or memo void builds the document's posting again
    (`rebuildPaymentJournal`, `rebuildMemoJournal`) and posts it negated, dated today,
    so it nets the opening lines. `assertNoMigrationClearing` refuses a rebuilt line on
    the Migration Clearing account. A customer credit memo that credits a contract or a
    rental agreement throws `MEMO_CREDIT_VOID_BEFORE_CUTOVER_ERROR` instead.
  - A company with no cutover has nothing before it, so every void works as before.
- **Manual accounting work is refused before the cutover.**
  `assertAccountingCutover` (`src/lib/require-accounting-cutover.ts`) throws
  `ACCOUNTING_NOT_STARTED` ("Set up accounting before you post journals, runs or period
  closes."). `propose-revenue-recognition-run` and
  `recalculate-revenue-recognition-run` call it. The ERP service functions refuse the
  same work with the same message.

### `activate-accounting`

The one-way enable (`src/activate-accounting/index.ts`, input `{ cutoverDate,
confirmation }`, permission `update: accounting`). The wizard's Enable step calls it
through `serverFns.as(...)`. It runs in one Kysely transaction:

1. Locks `companySettings` `FOR UPDATE`. Refuses when the company already has a cutover
   (`ACCOUNTING_ALREADY_SET_UP`) or when `confirmation` is not the company name.
2. Runs `getActivationReadiness` and `getMigrationClearing`
   (`@carbon/database/accounting-cutover-reads`) again under the lock. Refuses on a
   failed check, or when Migration Clearing does not total zero within 0.01.
3. Closes the cost layers dated before the cutover and inserts one opening layer per
   item at the reviewed unit cost (`planInventoryReset`). Re-costs the outbound
   movements of FIFO and LIFO items dated on or after the cutover
   (`recostOutbound`), and books each document's difference as a Provisional
   "Cutover recost" journal, one per document and posting date.
4. Sets every Provisional journal dated before the cutover to `Superseded`, and every
   Planned `revenueRecognitionSchedule` row dated before it to Posted with no journal.
5. Deletes the Draft trial balance journal and posts the opening journal
   (`buildOpeningJournalLines`), Posted, dated the day before the cutover.
6. Gives each Provisional journal dated on or after the cutover the period of its date,
   re-points the stand-in schedule rows and lines, and promotes those journals to
   `Posted`.
7. Closes every period that ends before the cutover and snapshots its balances
   (`snapshotAccountingPeriodBalances`). It does not call `closeAccountingPeriod`,
   which opens its own transaction.
8. Sets `accountingCutoverDate`, `accountingActivatedAt` and `accountingActivatedBy`.
   The `check_accounting_config_locked` trigger then refuses any change to them, to the
   base currency and to the fiscal year start month.

`seed-company` sets a new company's cutover to the first day of the current month, so
a new company posts `Posted` journals from its first document.

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

Shared posting internals live in `src/lib/` (not exported): `get-accounting-period` (`resolveAccountingPeriod`, `getCurrentAccountingPeriod`, `getAccountingPeriodForDate`), `get-posting-group` (`getDefaultPostingGroup`, `resolveInventoryAccount`), `calculate-cogs`, `storage-units`, `require-accounting-cutover` (`assertAccountingCutover`, see Journals and the accounting cutover), `cutover-void` (`refuseVoidBeforeCutover`, `assertNoMigrationClearing` and the void messages), `postable` (`assertPostable` — only a Draft or Pending document is posted; called BEFORE the function's `try`, whose failure handler resets the document to Draft), `fixed-asset-writes` (`FixedAssetWrites` — asset changes decided while the journal is built are staged and applied inside the posting transaction, never written on `db` directly), `asset-transfer` (the capitalization / return-to-inventory journal line builders, used by `post-asset-transfer` and `post-rental-agreement`), `cost-layer-order` (`orderLayersForConsumption` / `leavingTrackedEntityIds` — a serial unit is costed from its own layer first, used by `calculate-cogs`, `issue` and `post-shipment`), `contract-ledger` (`lockContractPositions`, `loadContractPositions` — the contract movement ledger's position lock and grouped read, shared by `post-sales-invoice`, `post-memo` and the recognition run's `synthesizeContractRevenue`; `samePosition`, the float-tolerant equality of two positions, used by `post-sales-invoice`; `signedCreditAmount`, a signed credit as an account's natural-balance journal amount, used by `post-sales-invoice` and `post-memo`), and the inventory-adjustment core — `post-adjustment` (`bookAdjustment`, `createAdjustmentJournal`, `loadOpenCostLayers`), the pure row builders in `plan-adjustment` and `post-adjustment-cost` (`computeCurrentUnitCost`). Pure logic that the apps also need goes to `@carbon/utils` / `@carbon/database`, not here.

Two more internal helpers sit at the `src/` root (not exported): `shelf-life.ts`
(the company's expired-entity policy and expiry checks, used by `issue` and
`post-stock-transfer`) and `tracked-entity-attributes.ts` (`attributesContain`, the
`"attributes" @> …` form the `trackedEntity` GIN index serves, used by
`assign-serial-numbers`, `post-picking` and `post-stock-transfer`).
