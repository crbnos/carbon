# @carbon/database

DB types, Supabase/Kysely clients, audit config, event system types, rate limiting, migrations, and pagination utilities.

## Always

- Use `pnpm db:migrate:new <name>` to create migrations; `pnpm db:migrate` to apply (regenerates types). There is **no** `db:build`.
- Tables: composite PK `("id", "companyId")`, `id` default `id()` or `id('prefix')` — never raw UUID. Audit columns (`createdBy`/`createdAt`/`updatedBy`/`updatedAt`) with inline `REFERENCES "user"("id")`.
- RLS: four policies named exactly `SELECT`/`INSERT`/`UPDATE`/`DELETE`. SELECT uses `get_companies_with_employee_role()`, writes use `get_companies_with_employee_permission('<module>_<action>')`. Schema-qualify tables, cast `::text[]`.
- Import `Database` type from `@carbon/database`; `KyselyDatabase` / `Kysely` from `@carbon/database/client`. Never hand-edit `src/types.ts` — it's generated.
- Use `fetchAllFromTable` / `fetchAllRecords` for paginated reads that exceed the 1000-row Supabase limit.

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
| `.` (index) | `Database` type, `fetchAllFromTable`, `fetchAllRecords`, `fetchRecordsInBatches` |
| `./client` | `Kysely`, `KyselyDatabase`, Postgres pool factories (`getPostgresClient`, `getPostgresConnectionPool`) |
| `./event` | `QueueMessage`, `EventSchema`, `createEventSystemSubscription`, `deleteEventSystemSubscription` |
| `./quality` | Inspection execution engine shared by ERP + MES (`upsertInspectionSample`, `upsertInspectionMeasurement`, `dispositionInspection` — optional one-shot `requireOpen`, `reconcileInspectionSamplingPlans`, `changeInspectionDocument`, `getOrCreateJobOperationInspection`, pure `valuateMeasurement`); Passed/Failed/Partial are all hard-terminal and samples linked from `productionQuantity.inspectionSampleId` are locked; every fn takes a `Kysely<KyselyDatabase>` first arg — authorize at the route, see `.claude/rules/inspection-system.md` |
| `./sampling` | Node-side re-export of `supabase/functions/shared/sampling-engine.ts` (Z1.4 / ISO 2859-1 resolvers) |
| `./audit` | Audit-log functions (`getEntityAuditLog`, `enableAuditLog`, `syncAuditSubscriptions`, …); `auditConfig` + `AuditEntityType` come from the separate `./audit.config` subpath |
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
