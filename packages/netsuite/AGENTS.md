# @carbon/netsuite

The NetSuite side of Carbon's one-click migration: a SuiteTalk client, the SuiteQL
extractors, the pure NetSuite→Carbon mappers, and the gap register. Internal workspace
package — never published to npm.

It contains **no database access and no Carbon service code**. The loader that writes a
plan into a company lives in `@carbon/jobs` (`src/netsuite/load/`), because that is where
the Kysely client belongs.

## Always

- Keep `src/map/` **pure** — no network, no clock, no database. It is where every product
  decision lives (which NetSuite item type becomes which Carbon type, which orders are in
  scope), and its testability is the reason those decisions are reviewable at all.
- Use `suiteQLKeyset` for anything unbounded. NetSuite caps SuiteQL's `offset` at 100,000
  and then silently stops returning rows; `suiteQLAll` refuses at the ceiling rather than
  truncating, but only keyset pagination avoids it.
- Probe before you read. Features change the schema, releases rename it (2026.1 split
  `entityaddress` into per-record-type tables), and role permissions hide it with no error.
  Add candidates to `probeAccount` rather than assuming a table name.
- Escape every SuiteQL literal through `src/extract/sql.ts`. There are no bind parameters
  over REST — `SuiteQL.params` exists only in SuiteScript.
- Add a `GAP_CATALOG` entry for anything the migration cannot carry, then run
  `pnpm --filter @carbon/netsuite generate:gaps`. A test fails if `GAPS.md` drifts.
- Leave ambiguity unset and note it. An order date a NetSuite account formats ambiguously
  (`05/06/2026`) lands as null; a promised date silently off by months is worse than a
  blank one.

## Never

- Never write to NetSuite. This package reads; the migration has no write-back and no
  two-way sync, and the customer is told so on the settings page.
- Never put a credential in an event payload or a log line. The job resolves credentials
  from Supabase Vault at run time.
- Never renumber a gap id — the run report, the docs site and support all reference them.
- Never guess a Carbon enum from a NetSuite value that does not map cleanly. `mapItemType`
  and `mapAccountType` return null for anything unrecognized, and the caller reports it.

## Validation Commands

```bash
pnpm --filter @carbon/netsuite test
pnpm --filter @carbon/netsuite typecheck
pnpm --filter @carbon/netsuite generate:gaps   # after editing GAP_CATALOG
```

## Layout

| Path | Provides |
|---|---|
| `src/client/` | `NetSuiteClient` (SuiteQL + REST, concurrency-limited, retrying), TBA (OAuth 1.0a) signing, OAuth 2.0 M2M token minting, account-id derivation |
| `src/extract/` | `probeAccount` (what does this account expose?), `extractNetSuite` (every row the mapper needs), SuiteQL escaping and row coercion |
| `src/map/` | `mapSnapshotToPlan`, `mapItemType`, `mapAccountType` — pure |
| `src/plan.ts` | `MigrationPlan`, the contract between map and load |
| `src/gaps/` | `GAP_CATALOG`, `detectGaps`, and the `GAPS.md` generator |

## Key Exports

| Subpath | Provides | Safe in a browser bundle? |
|---|---|---|
| `.` | everything, including the client | **No** — pulls `node:crypto` |
| `./gaps` | `GAP_CATALOG`, `detectGaps`, gap types | Yes |
| `./plan` | `MigrationPlan`, `PLAN_SECTIONS`, `planCounts` | Yes |

The ERP's migration report imports `./gaps` and `./plan` specifically so the signing code
never reaches the browser.

## Consumers

- `packages/jobs/src/inngest/functions/tasks/netsuite-migration.ts` — the job.
- `packages/jobs/src/netsuite/load/` — the loader, which consumes `MigrationPlan`.
- `apps/erp/app/modules/settings/ui/NetSuiteMigration/` — the report, via `./gaps`.

## Cross-References

- `.ai/specs/2026-09-12-netsuite-migration.md` — the design and its decisions
- `.claude/rules/netsuite-migration.md` — how the three layers fit together at runtime
- `GAPS.md` — what a migration leaves behind (generated)
