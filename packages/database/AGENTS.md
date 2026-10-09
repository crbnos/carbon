# @carbon/database

DB types, Supabase/Kysely clients, audit config, event system types, rate limiting, migrations, and pagination utilities.

## Always

- Use `pnpm db:migrate:new <name>` to create migrations; `pnpm db:migrate` to apply (regenerates types). There is **no** `db:build`.
- Tables: composite PK `("id", "companyId")`, `id` default `id()` or `id('prefix')` — never raw UUID. Audit columns (`createdBy`/`createdAt`/`updatedBy`/`updatedAt`) with inline `REFERENCES "user"("id")`.
- RLS: every public table's policies are a rule in `src/authz/manifest.ts` (usually `company("<module>")` — the four standard policies) and the RLS helpers are `src/authz/helpers/<name>.sql`. `pnpm db:migrate` syncs them locally; `pnpm --filter @carbon/database authz migration <name>` ships them to production (`migration.test.ts` fails until it does). See `.claude/rules/authz-manifest.md`.
- Event-system functions (dispatch, subscriptions, queue wake-up, audit log, search index, embeddings) are one file each in `src/event-system/functions/` (`<name>.sql`, `util.<name>.sql` for the `util` schema), synced and shipped by the same `authz sync` / `authz migration` commands. Edit the file; never redefine one in a migration.
- Import `Database` type from `@carbon/database`; `KyselyDatabase` / `Kysely` from `@carbon/database/client`. Never hand-edit `src/types.ts` — it's generated.
- `scriptRun` is a deliberate exception to the table conventions above: no `companyId`, no
  composite PK, SELECT-only RLS. It is the per-database ledger of one-off scripts that
  `ci/src/migrations.ts` runs after `supabase db push` — see `scripts/one-off/README.md`.
  It is intentionally NOT tenant-scoped so `selectWipeableTables` (company-backup.ts) cannot
  select it and a company restore cannot erase it. A migration landing in this package is
  also what triggers those scripts to deploy (`.github/workflows/supabase.yml` only fires on
  `packages/database/supabase/**`).
- Use `fetchAllFromTable` for paginated reads that exceed the 1000-row Supabase limit. It pages
  without `count: "exact"` (a `COUNT(*) OVER ()` per page is not free) and fetches the pages past
  the first concurrently. `fetchAllRecords` is the same pager over a query FACTORY (`() => builder`)
  — a factory, because supabase-js builders are mutable, so concurrent awaits on one builder all
  fetch whichever `.range()` was set last.

## Ask First

- Adding a new event system handler type to the `handlerType` CHECK constraint.
- Changing `audit.config.ts` entity definitions (affects which tables get audited and how diffs are computed).
- Modifying `src/client.ts` (the Node-only Kysely/node-postgres client shared by the apps, jobs and server functions, including its NUMERIC/DATE type parsers).

- **Declare event triggers in `src/event-system/attachments.ts`**, and write interceptor / statement-handler bodies as files in `src/event-system/handlers/`. `authz sync` applies both; `authz migration <name>` ships them. Never call `attach_event_trigger`, `attach_statement_handler` or `set_event_triggers` in a migration.
- **A table is realtime when its attachments entry lists `broadcast_table_changes`.** `REALTIME_TABLES` (`src/realtime-tables.ts`) is derived from the manifest. See `.claude/rules/realtime-system.md`.
## Never

- Specify decimal places in `NUMERIC` columns (use bare `NUMERIC`).
- Use `000000` for the HHMMSS portion of migration timestamps (causes cross-branch collisions).
- Recreate or call the retired RLS helpers `has_role`, `has_company_permission`, `get_companies_with_permission`, `get_permission_companies` — dropped in `20260927224314_retire-legacy-rls-helpers.sql` (they admitted customer and supplier portal accounts); `authz-fixes.test.sql` asserts they stay gone.
- Write `CREATE`/`ALTER POLICY` on a public table, or define a managed RLS helper or event-system function, in a migration — and never hand-edit a generated authz migration or `src/authz/baseline.json`.
- Write a `SECURITY DEFINER` function that trusts a company id from its caller without `PERFORM assert_company_access(company_id)` first — every `public` function is an API endpoint (see `.claude/rules/database-migration-patterns.md`).
- `REVOKE EXECUTE` on a `public` function: on this Postgres image calling it then segfaults the backend. Guard inside the function, or make it `SECURITY INVOKER`.

## Validation Commands

```bash
pnpm db:migrate          # Apply pending migrations + regenerate types
pnpm db:types            # Regenerate types only
pnpm db:check:datasets   # Validate + dry-run every demo dataset against the schema (writes nothing)
pnpm --filter @carbon/database typecheck
pnpm --filter @carbon/database test
pnpm --filter @carbon/database authz check   # local DB vs manifest (exit 3 = drift)
pnpm --filter @carbon/database authz migration <name>   # ship unshipped rules/helpers
```

## Key Exports

| Subpath | Provides |
|---------|----------|
| `.` (index) | `Database` type, `fetchAllFromTable`, `fetchAllRecords` (takes a query factory), `fetchRecordsInBatches`, `journalReference` (`journalLine.documentLineReference` values). The `datetime` derivation API lives in `@carbon/utils` |
| `./client` | Node-only. `Kysely`, `KyselyDatabase`, `getPostgresClient`, and `getProcessPool()` (one shared pool per process — never create another, never end it outside an exiting script); registers the NUMERIC → `Number` and DATE → `YYYY-MM-DD` type parsers at module load (see `.claude/rules/numeric-precision.md`) |
| `./methods` | Make-method helpers shared by get-method and `@carbon/planning` (`getJobMethodTree`, `getQuoteMethodTree`, `traverseJobMethod`, `calculateQuoteLinePrices`, …) |
| `./job-quantities-engine` | `computeJobQuantities` / `flattenJobQuantityTree` — the pure job-quantity cascade behind the `recalculate` server function |
| `./mrp-engine` | `explodeBom`, `makeKey`, `makeLocationItemKey`, `makeActualKey`, … — the pure MRP compute engine consumed by `@carbon/planning`'s `runMrp` and by get-method (`@carbon/server-functions`) |
| `./configuration-rule` | `runConfigurationRule` — runs configurator rule code in QuickJS (WebAssembly) with no host access and time/memory limits — plus `transpileRule` (sucrase: wraps a stored rule body in `configure(params)` and strips its types, throws on a syntax error). Both are used by get-method (`@carbon/server-functions`, `get-method/sandbox.ts`) and the ERP rule editor, so a preview and a job run the same JavaScript. Never run rule code with `new Function`/`eval`/`import()` |
| `./rows` | PostgREST-shaped reads and writes over Kysely (`selectRows`, `single` / `maybeSingle` / `many` with `{ data, error }`, `insertRows` / `updateRows` / `deleteRows`, `rpcRows` / `rpcValue`, `inOrder`, filter helpers `isNull` / `notNull` / `neq` / `notIn` / …). Rows go through `to_jsonb`, so they equal what PostgREST returns. Used by every server function and by `calculateQuoteLinePrices` when it is given a Kysely handle |
| `./fetch-all` | `fetchAll` — serial paginated PostgREST reads from a query factory (the root's `fetchAllRecords` is the concurrent, strictly typed variant) |
| `./json` | `toJson` / `toJsonColumns` — pre-serialise `json`/`jsonb` values written through Kysely (the driver sends strings and arrays unquoted) |
| `./price-trace` | `quoteToOrderPriceTrace` — the price trace a sales order line carries when the `convert` server function turns a quote into an order |
| `./supersession-pick` | The supersession rules shared by MRP, get-method and picking (`buildSupersessionRedirectMap`, `buildConsumeFirstHops`, `settleConsumeFirstLine`, `resolveMadeLinePull`, `consumableInWholeAssemblies`, …) |
| `./supplier-part-price` | Supplier part prices are stored as quoted (per purchase unit, in the part's `currencyCode`); `convertUnitPrice` puts one on a purchase document in its currency, `buildSupplierPriceMap` turns them into base per-inventory-unit costing breaks. Shared by the ERP, `methods.ts` and the server functions so every reader converts the same way |
| `./picked-consumption` | Consumption follows what was picked (`linesideCredit`, `getPickedBudgets`, `allocateAcrossBudgets`, …) — the one definition of usable lineside stock shared by the pick-list generator and the `issue` backflush |
| `./posting` | `buildPaymentJournal` / `buildMemoJournal` (`src/build-payment-journal.ts`, `src/build-memo-journal.ts`) for the `post-payment` / `post-memo` server functions and the dataset tiers |
| `./precision` / `./accounting-currency` / `./accounting-posting` / `./sales-posting-amounts` / `./ledger` | The pure numeric-precision API, FX conversion, journal role vocabulary, sales posting amounts, and ledger helpers (`AccountType`, `AccountClass`, `isAccountClass`, `credit`, `debit`, `accountTypeFromClass`). They live here, not in `@carbon/utils`, because the posting builders need them and this package cannot import `@carbon/utils` (turbo cycle); `@carbon/utils` re-exports them, so app code imports them from there. Keep them free of imports outside each other |
| `./deposit-scope` | `loadSalesInvoiceDocumentIds` (the rental agreements / sales orders each sales invoice bills, one query) and `loadDepositScope` (a deposit payment's document + readable id) — the reads behind "a customer deposit funds only its own document", shared by `replaceInvoiceSettlements` and `post-payment` |
| `./sequence` | `getNextSequence` / `getNextRevisionSequence` / `getNextSerialNumbers` — the one allocator for document and serial numbers (date tokens in the company timezone) |
| `./seed-data` | The company seed data (accounts, sequences, groups + `getGroupId`, …) used by the `seed-company` server function and the dataset tooling |
| *(no subpath)* | `src/sql-effects.ts` — `sqlFunctionEffects(sources)` / `loadSqlFunctionEffects()`: whether a SQL function writes, reads or cannot be told, read off its current definition with `libpg-query` (every migration, then the managed function files). The API generator imports it by path to refuse a `read` tool that calls a writing function. An extension function it meets must be added to `EXTERNAL_READS` or `EXTERNAL_WRITES`; reviewed dynamic SQL to `REVIEWED_DYNAMIC_READS` |
| `./event` | `QueueMessage`, `EventSchema`, `createEventSystemSubscription`, `deleteEventSystemSubscription` |
| `./quality` | Inspection execution engine shared by ERP + MES (`upsertInspectionSample`, `upsertInspectionMeasurement`, `dispositionInspection` — optional one-shot `requireOpen`, `reconcileInspectionSamplingPlans`, `changeInspectionDocument`, `getOrCreateJobOperationInspection`, pure `valuateMeasurement`, from `src/inspection-verdict.ts`, which the dataset seed shares); Passed/Failed/Partial are all hard-terminal and samples linked from `productionQuantity.inspectionSampleId` are locked; every fn takes a `Kysely<KyselyDatabase>` first arg — authorize at the route, see `.claude/rules/inspection-system.md` |
| `./sampling` | Z1.4 / ISO 2859-1 sampling resolvers (`resolveSamplingPlan`, `resolveFeatureSamplingPlan`) used by post-receipt and the inspection engine |
| `./audit.config` / `./audit.types` | `auditConfig`, `AuditEntityType`, `getAuditableTableNames`, and the audit type surface. The audit ENGINE (`getEntityAuditLog`, `enableAuditLog`, `insertAuditLogEntries`, …) MOVED to the commercial `@carbon/ee/audit.server`; config + types stay here (client-safe, generic schema types consumed by CE packages) |
| `./ratelimit` | `checkApiKeyRateLimit` (Postgres RPC wrapper) |
| `./datasets` | `applyDataset(pgClient, { companyId, userId, dataset, timeZone, wipeFirst? })` — the one entry point that fills a company with an industry dataset, in a single transaction; `wipeFirst` clears prior business data inside that same transaction while preserving bootstrap config. Plus `DATASETS`, `getDataset`, `datasetKeys`, `datasetForIndustry`. Consumed by onboarding (`industry.tsx`) and the `company-template` Inngest job. See Dev Seed below |
| `./seed-workflows` | `buildSeedWorkflows`, `SEED_WORKFLOW_BUILDERS`, `EVENT_SOURCES` — the seeded workflow definitions and tier 11's event→table map (`datasets/tiers/workflow-definitions.ts`); `@carbon/ee`'s `seed-workflows.test.ts` pins both to the workflow catalog |
| `./dataset-rule-fields` | `RULE_FIELDS` — the rule-builder fields a seeded sales/storage rule may test (`datasets/rule-fields.ts`); `@carbon/utils`'s `field-registry.test.ts` pins it to `field-registry.ts` |
| `.` (root, from `src/timezone.ts` + `src/utils.ts`) | `getCompanyTimeZone(db, companyId)` / `getLocationTimeZone(db, locationId, companyId)` — business-timezone resolvers, overloaded for Supabase client or Kysely handle (they throw on query failure rather than silently falling back); `AnyPostgresClient` + `isKysely` guard for writing such overloads. SQL siblings: `company_today(companyId)` / `location_today(locationId, companyId)` replace `CURRENT_DATE` for business dates in DB functions (SECURITY INVOKER — callers must be SECURITY DEFINER or service-role). ERP routes should prefer the Redis-cached wrappers in `~/modules/shared/timezone.server` |

## Dev Seed

`src/datasets/` splits **data** from **engine**, and both the dev CLI and onboarding's
`company-template` job go through the same `applyDataset()` entry point (`./datasets`).

- **Data** — `data/<key>/`, one file per slice, pure TypeScript literals with no SQL and no
  ids. Registered in `DATASETS` (`datasets/index.ts`). Four keys ship today, one per
  onboarding industry: `satellite`, `robotics`, `precision`, `motor`. **New seed data goes
  here**, not in a tier: the tiers are industry-agnostic shared code, and hard-coding one
  industry's content into them breaks every other dataset.
- **Engine** — `tiers/01-foundation.ts` … `tiers/12-planning.ts`, run in numeric order because
  each tier depends on ids the earlier ones put in `ctx.refs`. The ordering IS the contract.
  Change a tier only to support a new *shape* of data. A `Dataset` has twelve slices; `ops`
  (tier 10) carries maintenance, training, timecards, suggestions and notes.

Dates are signed day-offsets resolved against the company's today — never JS `Date`, never
`CURRENT_DATE` in a tier's SQL. Primary keys must never be literals: several tables
(`externalLink`, `period`) have globally-unique keys, so a fixed id collides on the second
company seeded into the same database.

`pnpm db:seed:dev` runs `src/seed-dev.ts` (the dev CLI); `cli.ts` parses its args,
`bootstrap.ts` sets up the company and `wipe.ts` clears prior data. `cli.ts` and `bootstrap.ts`
are dev tooling (the dev CLI and the drift check), outside the `./datasets` export. `wipe.ts` is
reached from the shared engine via `applyDataset`'s `wipeFirst` option, which both the dev CLI
and the `company-template` job use; it is not exported on its own.

After its seed commits, `seed-dev.ts` spawns `pnpm --filter @carbon/jobs plan:company --
--company <id> --user <id>` to run MRP + the scheduler (a spawn, not an import:
`@carbon/planning` depends on this package). `--skip-plan` opts out; a failed run only prints
a warning with the command to re-run. Under portless it passes
`NODE_EXTRA_CA_CERTS=~/.portless/ca.pem` when that file exists and the variable is unset.

`pnpm db:check:datasets` (`src/check-datasets.ts`) has two layers. First the pure
`validateDataset` (`datasets/validate.ts`) cross-checks every dataset with no database —
ref resolution, required status coverage, on-hand ≥ 0, journal balance, settlement
consistency — so a broken dataset blocks the commit even when the stack is down. Then `datasets/verify.ts` applies every dataset to
a scratch company, asserts the `datasets/coverage.ts` row-count floors, and always rolls back,
so it writes nothing; this layer skips with a warning when there is no database. The pre-commit
hook runs it on any `packages/database/**` change.

Per-module seed scripts were folded into this structure: `seed-change-orders.ts` and its
`db:seed:change-orders` script are gone, replaced by `tiers/08-change-orders.ts`.

Full feature context: `.claude/rules/onboarding-company-templates.md`.

## Cross-References

- `.claude/rules/conventions-database.md` — table template, column types, migration checklist
- `.claude/rules/database-patterns.md` — client factories, services, Kysely transactions
- `.claude/rules/authz-manifest.md` — RLS policies and helpers: manifest, sync, shipping
- `.claude/rules/database-migration-patterns.md` — SQL conventions, enums, triggers, RLS for tables without `companyId`
- `.claude/rules/event-system.md` — trigger dispatch, PGMQ queue, handler types
- `packages/auth/` — Supabase client factories (`getCarbon`, `getCarbonServiceRole`)
- `packages/jobs/` — Inngest event handlers that consume the event queue
