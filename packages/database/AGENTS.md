# @carbon/database

DB types, Supabase/Kysely clients, audit config, event system types, rate limiting, migrations, and pagination utilities.

## Always

- Use `pnpm db:migrate:new <name>` to create migrations; `pnpm db:migrate` to apply (regenerates types). There is **no** `db:build`.
- Tables: composite PK `("id", "companyId")`, `id` default `id()` or `id('prefix')` — never raw UUID. Audit columns (`createdBy`/`createdAt`/`updatedBy`/`updatedAt`) with inline `REFERENCES "user"("id")`.
- RLS: four policies named exactly `SELECT`/`INSERT`/`UPDATE`/`DELETE`. SELECT uses `get_companies_with_employee_role()`, writes use `get_companies_with_employee_permission('<module>_<action>')`. Schema-qualify tables, cast `::text[]`.
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
- Modifying `src/client.ts` re-exports (the Kysely/Postgres client barrel shared with Supabase edge functions).

## Never

- Specify decimal places in `NUMERIC` columns (use bare `NUMERIC`).
- Use `000000` for the HHMMSS portion of migration timestamps (causes cross-branch collisions).
- Use the deprecated `has_role` / `has_company_permission` RLS helpers.

## Validation Commands

```bash
pnpm db:migrate          # Apply pending migrations + regenerate types
pnpm db:types            # Regenerate types only
pnpm db:check:datasets   # Dry-run every demo dataset against the schema (writes nothing)
pnpm --filter @carbon/database typecheck
```

## Key Exports

| Subpath | Provides |
|---------|----------|
| `.` (index) | `Database` type, `fetchAllFromTable`, `fetchAllRecords` (takes a query factory), `fetchRecordsInBatches` |
| `./client` | `Kysely`, `KyselyDatabase`, Postgres pool factories (`getPostgresClient`, `getPostgresConnectionPool`) |
| `./datetime` | Node re-export of `supabase/functions/lib/datetime.ts` — the edge-runtime datetime helpers (`datetime`, `getCompanyTimeZone`, `getLocationTimeZone`) for Node consumers |
| `./methods` | Node re-export of `supabase/functions/lib/methods.ts` — shared make-method helpers |
| `./logging` | Node re-export of `supabase/functions/lib/logging.ts` (`getFunctionLogger`) |
| `./mrp-engine` | Node re-export of `supabase/functions/lib/mrp-engine.ts` (`explodeBom`, `makeKey`, `makeLocationItemKey`, `makeActualKey`, …) — the pure MRP compute engine consumed by `@carbon/planning`'s `runMrp` (the engine STAYS in the edge-lib; still used by the Deno `recalculate` function) |
| `./fetch-all` | Node re-export of `supabase/functions/lib/fetch-all.ts` (`fetchAll` — paginated PostgREST reads) |
| `./supersession-pick` | Node re-export of `supabase/functions/lib/supersession-pick.ts` (`buildSupersessionRedirectMap`, `buildConsumeFirstHops`, `settleConsumeFirstLine`, `resolveMadeLinePull`, `consumableInWholeAssemblies`, …) |
| `./picked-consumption` | Node re-export of `supabase/functions/lib/picked-consumption.ts` (`linesideCredit`, `getPickedBudgets`, `allocateAcrossBudgets`, …) — the one definition of usable lineside stock shared by the pick-list generator and the `issue` backflush |
| *(no subpath)* | `supabase/functions/shared/image-pipeline.ts` — the codebase-wide image pipeline (decode HEIC/JPEG/PNG/WebP → shape → encode), re-exported by `@carbon/files/media` (NOT by this package). Unlike `precision.ts` it has npm deps (`libheif-js`, `@jsquash/*`) which are pinned in BOTH this package.json and `functions/deno.json` `imports` — keep the versions identical. Its `.d.ts` sits beside it (`wasm-codecs.d.ts`, triple-slash referenced). Consumed by the `process-image`, `logo-resizer` and `thumbnail` edge functions |
| `./sequence` | `getNextSequence` — Node re-export of `supabase/functions/shared/get-next-sequence.ts`, for Kysely writers that mint readable ids |
| `./revenue-recognition` | `createRevenueRecognitionRunProposal(db, { companyId, periodEnd, userId })` — builds ONE Draft revenue recognition run in its own transaction (claims Planned `revenueRecognitionSchedule` rows dated on or before the period end; returns null when nothing is due) after running `RUN_ROW_SYNTHESIZERS`; `synthesizeRentalAccruals` is the one synthesizer today (operating rent earned but not on a posted invoice → Accrual rows, Dr contract asset / Cr rental income). Consumed by the ERP run routes and the `revenue-recognition-proposal` Inngest job. Posting stays in the ERP's `accounting.server.ts` |
| `./rental-billing` | `createRentalInvoicesForDuePeriods(db, { companyId, asOf, rentalAgreementId?, userId })` — rolls the billing periods of live Operating (or unclassified) rental lines forward to `billingHorizon(asOf)` (a Sales-Type line's whole term was cut at activation and never rolls a holdover period), then drafts one Draft sales invoice per Active agreement with a `Rental` line per due period and per charge dated on or before `asOf` (one transaction per agreement); `releaseRentalInvoiceStamps(trx, …)` un-stamps periods/charges when a Draft invoice or line is deleted. Consumed by the ERP (`sales.server.ts`) and the `rental-billing` Inngest job. The pure period math is `supabase/functions/shared/rental-billing.ts` (re-exported by `@carbon/utils`) |
| `./event` | `QueueMessage`, `EventSchema`, `createEventSystemSubscription`, `deleteEventSystemSubscription` |
| `./quality` | Inspection execution engine shared by ERP + MES (`upsertInspectionSample`, `upsertInspectionMeasurement`, `dispositionInspection` — optional one-shot `requireOpen`, `reconcileInspectionSamplingPlans`, `changeInspectionDocument`, `getOrCreateJobOperationInspection`, pure `valuateMeasurement`); Passed/Failed/Partial are all hard-terminal and samples linked from `productionQuantity.inspectionSampleId` are locked; every fn takes a `Kysely<KyselyDatabase>` first arg — authorize at the route, see `.claude/rules/inspection-system.md` |
| `./sampling` | Node-side re-export of `supabase/functions/shared/sampling-engine.ts` (Z1.4 / ISO 2859-1 resolvers) |
| `./audit.config` / `./audit.types` | `auditConfig`, `AuditEntityType`, `getAuditableTableNames`, and the audit type surface. The audit ENGINE (`getEntityAuditLog`, `enableAuditLog`, `insertAuditLogEntries`, …) MOVED to the commercial `@carbon/ee/audit.server`; config + types stay here (client-safe, generic schema types consumed by CE packages) |
| `./ratelimit` | `checkApiKeyRateLimit` (Postgres RPC wrapper) |
| `./datasets` | `applyDataset(pgClient, { companyId, userId, dataset, timeZone, wipeFirst? })` — the one entry point that fills a company with an industry dataset, in a single transaction; `wipeFirst` clears prior business data inside that same transaction while preserving bootstrap config. Plus `DATASETS`, `getDataset`, `datasetKeys`, `datasetForIndustry`. Consumed by onboarding (`industry.tsx`) and the `company-template` Inngest job. See Dev Seed below |
| `./seed-workflows` | `buildSeedWorkflows` — the seeded workflow definitions (`datasets/tiers/workflow-definitions.ts`) |
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
  Change a tier only to support a new *shape* of data.

Dates are signed day-offsets resolved against the company's today — never JS `Date`, never
`CURRENT_DATE` in a tier's SQL. Primary keys must never be literals: several tables
(`externalLink`, `period`) have globally-unique keys, so a fixed id collides on the second
company seeded into the same database.

`pnpm db:seed:dev` runs `src/seed-dev.ts` (the dev CLI); `cli.ts` parses its args,
`bootstrap.ts` sets up the company and `wipe.ts` clears prior data. `cli.ts` and `bootstrap.ts`
are dev-only. `wipe.ts` is reached from the shared engine via `applyDataset`'s `wipeFirst`
option, which both the dev CLI and the `company-template` job use; it is not exported on its own.

`pnpm db:check:datasets` (`src/check-datasets.ts` → `datasets/verify.ts`) catches schema drift:
it applies every dataset to a scratch company inside a transaction it always rolls back, so it
writes nothing. The pre-commit hook runs it on any `packages/database/**` change.

Per-module seed scripts were folded into this structure: `seed-change-orders.ts` and its
`db:seed:change-orders` script are gone, replaced by `tiers/08-change-orders.ts`.

Full feature context: `.claude/rules/onboarding-company-templates.md`.

## Cross-References

- `.claude/rules/conventions-database.md` — table template, column types, migration checklist
- `.claude/rules/database-patterns.md` — client factories, services, Kysely transactions
- `.claude/rules/database-migration-patterns.md` — SQL conventions, enums, triggers, RLS for tables without `companyId`
- `.claude/rules/event-system.md` — trigger dispatch, PGMQ queue, handler types
- `packages/auth/` — Supabase client factories (`getCarbon`, `getCarbonServiceRole`)
- `packages/jobs/` — Inngest event handlers that consume the event queue
- `supabase/functions/lib/logging.ts` — Deno-native logger (`getFunctionLogger`) mirroring `@carbon/logger`; use it instead of `console.*` in edge functions (`@logtape/*` via `deno.json` jsr imports)
