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
pnpm --filter @carbon/database typecheck
```

## Key Exports

| Subpath | Provides |
|---------|----------|
| `.` (index) | `Database` type, `fetchAllFromTable`, `fetchAllRecords`, `fetchRecordsInBatches` |
| `./client` | `Kysely`, `KyselyDatabase`, Postgres pool factories (`getPostgresClient`, `getPostgresConnectionPool`) |
| `./event` | `QueueMessage`, `EventSchema`, `createEventSystemSubscription`, `deleteEventSystemSubscription` |
| `./audit` | `auditConfig`, entity/table lookup helpers, `AuditEntityType` |
| `./ratelimit` | `checkApiKeyRateLimit` (Postgres RPC wrapper) |

## Cross-References

- `.ai/rules/conventions-database.md` — table template, column types, migration checklist
- `.ai/rules/database-patterns.md` — client factories, services, Kysely transactions
- `.ai/rules/database-migration-patterns.md` — SQL conventions, enums, triggers, RLS for tables without `companyId`
- `.ai/rules/event-system.md` — trigger dispatch, PGMQ queue, handler types
- `packages/auth/` — Supabase client factories (`getCarbon`, `getCarbonServiceRole`)
- `packages/jobs/` — Inngest event handlers that consume the event queue
- `supabase/functions/lib/logging.ts` — Deno-native logger (`getFunctionLogger`) mirroring `@carbon/logger`; use it instead of `console.*` in edge functions (`@logtape/*` via `deno.json` jsr imports)
