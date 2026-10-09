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
(`.ai/specs/implemented/2026-10-08-accounting-cutover.md`). The `accountingEnabled` column still
exists, but no code reads it.

- **Status.** `journalPostingStatus(db, companyId)` (`@carbon/database/journal-posting-status`)
  returns `Provisional` when the company has no cutover and `Posted` when it has one.
  `postingStatusFor(cutoverDate)` is the same decision without a read, and
  `readAccountingCutoverDate` returns the date. All reads take `FOR SHARE`. The SQL
  posting functions (`complete_job_to_inventory`, `backflush_job_materials`) call
  `journal_posting_status(company_id)`.
- **The double read.** Only a posting function that resolves an accounting period
  BEFORE its transaction reads the status twice. It reads it once before the
  transaction, to decide whether to resolve the period. Inside the transaction it calls
  `assertPostingStatusUnchanged` (`@carbon/database/journal-posting-status`), which
  reads it again `FOR SHARE` and throws `POSTING_STATUS_CHANGED_ERROR` ("Accounting was
  just set up. Post the document again.") on a mismatch. A function that reads the
  status only inside its transaction needs no second read. `activate-accounting` takes
  `FOR UPDATE` on the same row, so no posting writes a Provisional journal after the
  enable commits.
- **No period before the cutover.** A Provisional journal has `accountingPeriodId`
  null, and no posting creates a period for it. Resolve a period only when the status
  is `Posted`.
- **Stand-in lines.** `resolveDefaultAccount(defaults, role, postingStatus)` picks the
  account for a line that needs one of the nullable defaults in `OPTIONAL_DEFAULT_ROLES`.
  A set default is used as is.
  - An empty default with a fallback in `DEFAULT_FALLBACKS` uses the fallback, before
    and after the cutover (for example `scrapAccount` →
    `inventoryAdjustmentVarianceAccount`, `salesReturnsAccount` → `salesAccount`). It
    never takes a stand-in, and the enable does not require it.
  - Only an empty default with no fallback takes a stand-in. Before the cutover it
    returns `retainedEarningsAccount` with `accountDefaultRole = role`, and the line
    stores that role in `journalLine.accountDefaultRole`. After the cutover it throws
    `MissingAccountDefaultError`: status 400, message "Set the <label> account in
    Accounting → Default Accounts.", with the label from `OPTIONAL_DEFAULT_LABELS`.
  - A void copies `accountDefaultRole` from each original line to its reversal.
  - A `revenueRecognitionSchedule` row never takes a stand-in. `post-sales-invoice`
    refuses when the deferral, contract asset or rental default it needs is empty, in
    both states. The invoice's own lines take stand-ins through `salesInvoiceStandIns`
    (`src/lib/sales-invoice-stand-ins.ts`: `leaseRevenueAccount`,
    `netInvestmentInLeasesAccount`, `salesShippingRevenueAccount`).
- **Journal readers filter by a named status list** from
  `@carbon/database/accounting-posting`: `GL_JOURNAL_STATUSES` (Posted, Reversed) for
  balances, reports and tie-outs; `DOCUMENT_JOURNAL_STATUSES` (Provisional, Posted,
  Reversed) for a reader that follows one document's chain (void builders, GR/IR, WIP
  sums, intercompany lookups); `OPEN_ITEM_JOURNAL_STATUSES` (Provisional, Posted) for
  the payment control lookups and the memo, charge and reimbursement void checks.
  `PRE_CUTOVER_JOURNAL_STATUSES` (Provisional, Superseded) is not a reader's list: the
  enable wizard dates the start of the cost record from it. The
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
    (`rebuildPaymentJournal` in `src/post-payment/rebuild-journal.ts`,
    `rebuildMemoJournal` in `src/post-memo/rebuild-journal.ts`) and posts it negated,
    dated today, so it nets the opening lines. `assertNoMigrationClearing` refuses a
    rebuilt line on the Migration Clearing account. A customer credit memo that credits
    a contract or a rental agreement throws `MEMO_CREDIT_VOID_BEFORE_CUTOVER_ERROR`
    instead.
  - A time entry whose journal the enable superseded is not posted again.
    `post-production-event` refuses an event posted to GL with a line in a Superseded
    journal. `post-maintenance-event` refuses an entry whose expense changed (edited or
    deleted), and drops an unchanged one (`withoutSupersededEntries`,
    `post-maintenance-event/plan.ts`). Both throw `TIME_ENTRY_BEFORE_CUTOVER_ERROR` ("…
    Record a journal entry to correct it instead.").
  - A company with no cutover has nothing before it, so every void works as before.
- **Zero-cost outbound movements keep their pair.** The adjustment core
  (`valueMovement`, `src/lib/post-adjustment.ts`) skips the journal of an inbound
  movement at no value, but always writes the pair of an outbound one, at zero too.
  The enable's re-cost may give that movement a cost, and it adjusts the pair it finds.
- **Manual accounting work is refused before the cutover.**
  `assertAccountingCutover` (`src/lib/require-accounting-cutover.ts`) throws
  `ACCOUNTING_NOT_STARTED` ("Set up accounting before you post journals, runs or period
  closes."). `propose-revenue-recognition-run` and
  `recalculate-revenue-recognition-run` call it. The ERP service functions refuse the
  same work with the same message.

### `activate-accounting`

The one-way enable (`src/activate-accounting/index.ts`, input `{ cutoverDate,
confirmation }`, permission `update: accounting`). The wizard's Enable step calls it
through `serverFns.as(...)`. It runs in one Kysely transaction. The steps use the
spec's section 5 numbering, as the code comments do:

1. Locks `companySettings` `FOR UPDATE`. Refuses when the company already has a cutover
   (`ACCOUNTING_ALREADY_SET_UP`) or when `confirmation` is not the company name. Runs
   `getActivationReadiness` and `getMigrationClearing`
   (`@carbon/database/accounting-cutover-reads`) again under the lock. Refuses on a
   failed check, or when Migration Clearing does not total zero
   (`isMigrationClearingZero`). The `account-defaults` check refuses an empty
   `migrationClearingAccount`, and one that is not an active Equity posting account.
   1a. Writes the journals of the legacy documents (`journalLegacyDocuments`, below).
2. Inventory reset (`resetAndRecostInventory`, `src/activate-accounting/recost.ts`).
   Closes the cost layers dated before the cutover and inserts one opening layer per
   item with stock (`planInventoryReset`). The unit cost comes from
   `getCutoverInventory`: a Standard item takes its standard cost, a FIFO or LIFO item
   the value its layers held at the cutover (`unitCostAtCutover` replays the layers
   dated before it), and an Average item `itemCost.unitCost`, the one cost the
   wizard's inventory step lets a user edit.
3. Re-cost. Replays the layers and outbound movements of FIFO and LIFO items dated on
   or after the cutover (`recostOutbound`), and books each document's difference as a
   Provisional "Cutover recost" journal, one per document and posting date. A
   `Revaluation` cost row (a serial recost) keeps its cost.
4. Sets every Provisional journal dated before the cutover to `Superseded`.
5. Sets every Planned `revenueRecognitionSchedule` row dated before the cutover to
   Posted with no journal.
6. Fixed assets: no write. The register already holds the values at the cutover.
7. Deletes the Draft trial balance journal and posts the opening journal
   (`buildOpeningJournalLines`), Posted, dated the day before the cutover.
8. `assignPeriods` gives each Provisional journal dated on or after the cutover the
   period of its date.
9. `repointStandInLines` moves each stand-in line to the default it names (or that
   default's fallback). Then `promoteJournals` promotes those journals to `Posted`.
   Both are in `src/activate-accounting/promote.ts`.
10. Closes every period that ends before the cutover and snapshots its balances
    (`snapshotAccountingPeriodBalances`). It does not call `closeAccountingPeriod`,
    which opens its own transaction.
    10a. `getCurrentAccountingPeriod` makes the period that holds today Active, as the
    first posting would.
11. Sets `accountingCutoverDate`, `accountingActivatedAt` and `accountingActivatedBy`.
    The `check_accounting_config_locked` trigger then refuses any change to them, to the
    base currency and to the fiscal year start month.

#### Legacy documents (step 1a)

A legacy document is posted (not Draft, Pending or Voided), dated on or after the
cutover, and has no journal line under its document keys in a journal of any status.
A company with accounting off wrote no journal, and the reset deleted the others'.
`journalLegacyDocuments` (`src/activate-accounting/legacy/`) writes, for each one, the
journal its posting writes today: today's account defaults and item costs, in base
currency at the document's exchange rate, `Provisional`, dated the document's posting
date. The steps above then re-cost, period, re-point and promote it like any other
Provisional journal.

- **Detection** is one definition, `@carbon/database/legacy-documents`. Each function
  returns a query; the enable executes it, and `getLegacyDocumentCounts`
  (`@carbon/database/accounting-cutover-reads`) counts the same rows for the wizard's
  Enable step. Change the detection there, never in a builder.
- **Order** (`legacy/index.ts`): first the cost rows of movements that stored none
  (`writeLegacyMovementCosts`: sales order shipments, direct sales invoice lines, job
  issues and completions); then sales invoices, purchase invoices, memos, charges and
  reimbursements; then payments in posting order, because a payment reads the control
  line of what it settles; then purchase receipts, sales return receipts, sales
  shipments, return shipments, the adjustment core's movements, job issues and job
  completions; then depreciation runs, scrap disposals and revenue recognition runs
  (`legacy/runs.ts`).
- **Movement costs.** `writeLegacyMovementCosts` (`legacy/movement-cost.ts`) costs an
  outbound FIFO or LIFO movement with no cost row against the layers open now
  (`relieveOpenLayers`: one locked read of the layers, then `replayReliefs`). A
  Standard item costs at its standard cost and an Average one at `itemCost.unitCost`.
  The enable then re-costs the FIFO and LIFO rows (step 3); the repair keeps what the
  open layers gave.
- **Memos and payments** are built by `rebuildMemoJournals`
  (`src/post-memo/rebuild-journal.ts`) and `rebuildPaymentJournals`
  (`src/post-payment/rebuild-journal.ts`). The pre-cutover voids use the same files for
  one document (`rebuildMemoJournal`, `rebuildPaymentJournal`). The payment posting
  and its rebuild assemble the `buildPaymentJournal` input in one place,
  `src/post-payment/journal-input.ts` (`assemblePaymentJournal`), and
  `post-payment/rebuild-journal.test.ts` pins a rebuilt journal to the posted one.
- **Every rebuilt journal stays out of provider sync.** The provider may already hold
  the original. So `insertProvisionalJournals` (`legacy/write.ts`) calls
  `keepOutOfProviderSync` for every journal it writes, in the enable's step 1a and in
  the repair. It writes an `Excluded` `accountingSyncOperation` per accounting
  integration with `errorCode` `CUTOVER_REBUILT` (`CUTOVER_REBUILT_SYNC_CODE`).
  Re-send in Sync Activity still pushes one.
- **Closed periods.** Before it writes a batch, `insertProvisionalJournals` refuses
  when a period that holds one of the batch's posting dates is Closed or Locked, or
  has `closedAt` set. The `InvalidInputError` names the period and says to reopen
  (Closed) or unlock (Locked) it. The enable never meets one; the repair can.
- **Not rebuilt** (no stored basis): labor and machine absorption of a legacy job, the
  offset of a serial recost or an asset cost adjustment, asset registrations and
  transfers, and the depreciation of an asset that left the books with no journal
  (`assetsLeavingWithoutJournal`).
- The result's `legacyJournals` counts the journals written per family
  (`LegacyJournalCounts`: `LegacyDocumentCounts` plus `movementCostRows`). A document
  whose journal has no lines gets none.

#### `journal-legacy-documents` (the repair after the enable)

A company enabled before step 1a existed, and a demo-template company (migration
20261009004448 backfilled its cutover), can still hold legacy documents. The
server function (input `{}`, permission `update: accounting`) runs step 1a
again in one transaction, under `companySettings` `FOR UPDATE`. It refuses a
company with no cutover (`ACCOUNTING_NOT_STARTED`). When it wrote journals,
`assignPeriods`, `repointStandInLines` and `promoteJournals` take only those
journals, by the ids `journalLegacyDocuments` returns. Then
`getCurrentAccountingPeriod` makes the period that holds today Active, as the
enable leaves it. Settings → Accounting shows the count (`hasLegacyDocuments`,
then `getLegacyDocumentCounts`) and a "Write missing journals" button.

The one-off script `scripts/one-off/journal-legacy-documents.ts` runs it for
each company (`journalLegacyDocumentsForAllCompanies`,
`journal-legacy-documents/companies.ts`):

- `findCompaniesWithLegacyDocuments` takes only the companies with a cutover AND
  at least one legacy document. It runs each as `accountingActivatedBy`, else an
  active Admin employee.
- A company with neither user is `skipped`. For a failed call,
  `classifyRepairFailure` makes a refusal (`status` below 500: a closed period, an
  empty default) `skipped` and every other failure `failed`.
- The script lists the skipped companies at the end. It exits 1 when a company
  `failed`, else 0, so one company's data cannot fail every deploy, and a server
  failure is retried on the next deploy.
- With no Postgres URL (`SUPABASE_DB_URL`) it exits 75, `ONE_OFF_SCRIPT_DEFERRED`
  (`ci/src/one-off-scripts.ts`): the runner records nothing and runs it again on the
  next deploy.

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

Shared posting internals live in `src/lib/` (not exported): `get-accounting-period` (`resolveAccountingPeriod`, `getCurrentAccountingPeriod`, `getAccountingPeriodForDate`), `get-posting-group` (`getDefaultPostingGroup`, `resolveInventoryAccount`), `calculate-cogs` (`calculateCOGS`: reads and locks the open layers, then writes what `relieveLayers` from `@carbon/database/cost-relief` returns), `storage-units`, `require-accounting-cutover` (`assertAccountingCutover`, see Journals and the accounting cutover), `cutover-void` (`refuseVoidBeforeCutover`, `assertNoMigrationClearing`, the void messages and `TIME_ENTRY_BEFORE_CUTOVER_ERROR`), `postable` (`assertPostable` — only a Draft or Pending document is posted; called BEFORE the function's `try`, whose failure handler resets the document to Draft), `fixed-asset-writes` (`FixedAssetWrites` — asset changes decided while the journal is built are staged and applied inside the posting transaction, never written on `db` directly), `asset-transfer` (the capitalization / return-to-inventory journal line builders, used by `post-asset-transfer` and `post-rental-agreement`), `cost-layer-order` (`leavingTrackedEntityIds`, and `orderLayersForConsumption` re-exported from `@carbon/database/cost-relief` — a serial unit is costed from its own layer first), `contract-ledger` (`lockContractPositions`, `loadContractPositions` — the contract movement ledger's position lock and grouped read, shared by `post-sales-invoice`, `post-memo` and the recognition run's `synthesizeContractRevenue`; `samePosition`, the float-tolerant equality of two positions, used by `post-sales-invoice`; `signedCreditAmount`, a signed credit as an account's natural-balance journal amount, used by `post-sales-invoice` and `post-memo`), `party-dimensions` (`loadPartyDimensions`, `partyDimensionValues`, `partyDimensionValuesFrom` — the Customer / CustomerType or Supplier / SupplierType dimensions on every line of a payment or memo journal, used by `post-payment` and `post-memo` and their rebuilds), `cost-center-project-dimensions` (`costCenterAndProjectDimensions` — the oldest active Cost Center and Project dimensions, used by `post-charge`, `post-reimbursement` and their legacy builders), `document-journal-lines` (`documentJournalLines` — the lines one document's chain owns, read only from journals with a `DOCUMENT_JOURNAL_STATUSES` status; used by `post-receipt`, `post-shipment`, `post-sales-invoice` and `post-purchase-invoice`), `sales-invoice-stand-ins` (`salesInvoiceStandIns`, `STAND_IN_CLASS` — the stand-in lines of a sales invoice journal, used by `post-sales-invoice` and its legacy builder), and the inventory-adjustment core — `post-adjustment` (`bookAdjustment`, `createAdjustmentJournal`, `loadOpenCostLayers`), the pure row builders in `plan-adjustment` and `post-adjustment-cost` (`computeCurrentUnitCost`). Pure logic that the apps also need goes to `@carbon/utils` / `@carbon/database`, not here.

`src/post-receipt/posting-lines.ts` (pure) builds the journal lines of a purchase order
receipt (`purchaseReceiptLineCosts`, `buildPurchaseReceiptJournalLines`) and of a sales
return receipt (`buildSalesReturnReceiptJournalLines`). `post-receipt` and the legacy
backfill (`activate-accounting/legacy/receipt.ts`) both call it; each line carries its
dimensions by entity type, written with `journalLineDimensionRows`
(`src/lib/journal-line-dimensions.ts`).

`src/post-receipt/void-cost-ledger.ts` (`planReceiptVoidCostLedger`, pure) decides what
a purchase receipt void does to its cost rows: it closes the layers the receipt
created, refuses (`consumed`) when part of one was already issued or shipped, and puts
back what a negative line relieved as a new layer at the relieved cost.

**Cost relief** lives in `@carbon/database/cost-relief`, one definition for every
consumer: `isCostLayer` / `isCostRelief` (which `costLedger` rows open or relieve a
layer), `relieveLayers` (one relief, pure) and `replayReliefs` (a sequence of layers and
reliefs, as successive `calculateCOGS` calls would). `calculateCOGS`, the enable's
re-cost (`recostOutbound`), the opening layer cost (`getCutoverInventory`) and the legacy
movement costs all use it. A job return is not a layer: `isCostLayer` leaves out a
positive "Job Consumption" row.

Two more internal helpers sit at the `src/` root (not exported): `shelf-life.ts`
(the company's expired-entity policy and expiry checks, used by `issue` and
`post-stock-transfer`) and `tracked-entity-attributes.ts` (`attributesContain`, the
`"attributes" @> …` form the `trackedEntity` GIN index serves, used by
`assign-serial-numbers`, `post-picking` and `post-stock-transfer`).
