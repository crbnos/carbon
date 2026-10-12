# One-off scripts

Scripts in this folder run **exactly once per database**, automatically, on the
next deploy — and then never again.

Everything else belongs in `scripts/`. This folder is only for one-time data
migrations: work that must happen once against existing data, that a SQL
migration cannot do (because it talks to Storage, an external API, or needs
application logic), and that is meaningless to run a second time.

## How a script here gets run

1. `.github/workflows/supabase.yml` runs `pnpm --filter ci ci:migrations` on
   pushes to `main` under `packages/database/supabase/**`.
2. For each workspace, `ci/src/migrations.ts` applies migrations
   (`supabase db push`), then calls `runPendingScripts`.
3. That reads the **target database's own** `scriptRun` table, runs the listed
   scripts with no row there (`tsx <file>`, one subprocess each), and reads each
   exit code (`oneOffScriptOutcome` in `ci/src/one-off-scripts.ts`):
   - `0` — completed. The runner inserts the script's `scriptRun` row.
   - `75` (`ONE_OFF_SCRIPT_DEFERRED`, `EX_TEMPFAIL` in `sysexits.h`) — deferred.
     The workspace is not ready for the script yet, usually because the runner
     did not pass something it needs. The runner logs it, writes no row, and
     does not fail the deploy. The next deploy runs it again.
   - Anything else, or a signal — failed. No row, and the overall CI run fails.
     The schema is already pushed, so the workspace's migration still succeeds.

Nobody runs these by hand in production. Merging is what ships them.

## The environment a script gets

`oneOffScriptEnv` (`ci/src/one-off-scripts.ts`) builds it from the workspace's:

- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, with the rest of the
  workspace's Supabase settings.
- `SUPABASE_DB_URL`: for a Supabase-hosted workspace, the project's Supavisor
  URL (`aws-0-<region>.pooler.supabase.com`), read from the Management API with
  the workspace's access token and password. The workspace's own pooler URL is
  on `db.<ref>.supabase.co`, which resolves to IPv6 only, and GitHub-hosted
  runners have no IPv6 (`ENETUNREACH`). Failing that, the workspace's pooler
  URL, as the deployed app gets it, else its connection string when that starts
  with `postgresql://`. A workspace with none passes no `SUPABASE_DB_URL`.
- **No database password.** The runner removes `SUPABASE_DB_PASSWORD`; only
  `supabase db push` uses it. A script never needs it and must not read it.

`scripts/lib/local-script-config.ts` lets a `.env.local` override the passed
environment, which is why the runner spawns each script rather than importing it.

## Adding a script

1. Drop a `<kebab-case>.ts` file in this folder. That is the registration —
   every such file is discovered automatically, so there is no list to update.
   The name must be lower-case words separated by hyphens; anything else
   (dotted names, underscores, capitals, non-`.ts` files) fails the deploy
   with an error rather than being silently skipped.
2. Take configuration from `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in
   the environment; the runner injects the per-workspace values. A script that
   needs Postgres itself (a Kysely transaction, a server function) reads
   `SUPABASE_DB_URL` (see above). When it is absent, the script logs why and
   exits `75`, so the workspace runs it on a later deploy rather than failing
   this one — `journal-legacy-documents.ts` is the example. Say so in the
   script's header. Support `--dry-run` if the script writes anything.
3. Ship it **alongside a migration**, or it will not deploy on its own — the
   workflow only triggers on `packages/database/supabase/**` changes. Without
   one, run the workflow manually (`workflow_dispatch`).

Anything that is not a one-time data migration does not belong in this folder:
putting it here means it runs against every production database on the next
deploy. **In particular, do not colocate tests here** — `scripts/lib/` keeps
`*.test.ts` beside its sources, but that convention is refused in this folder
precisely because a discovered file gets executed in production. Put tests for
a one-off script in `ci/src/` or beside the code it exercises.

### Two rules that are not optional

**It must be idempotent.** The ledger row is written *after* the script
succeeds, so a crash between the work and the record means the next deploy runs
it again. A script that cannot survive a second run will corrupt data here.

**Its filename is permanent.** The `scriptRun` table is keyed on the file's
basename. Renaming the file makes every database look like it has never run
the script, and it runs again everywhere.

## Why the ledger lives in the target database

"Has this script run here?" is a fact about a specific database, so it travels
with it: a workspace that is cloned, restored, or re-pointed at another project
carries the right answer rather than inheriting a stale flag from elsewhere.
Self-hosted instances get the same bookkeeping from `supabase db push` alone,
with no control-plane table to replicate.

`scriptRun` is deliberately not tenant-scoped — it has no `companyId` or
`companyGroupId` — so `selectWipeableTables` in `company-backup.ts` cannot
select it and a company restore can never erase the ledger and cause a re-run.

Note this is separate from the database **seed** (`packages/database/src/seed.ts`),
which is gated by the `seeded` boolean on the CI `workspaces` row and is not
part of this mechanism.

## Removing a script

Once every deployment has run it, delete the file. Leave the `scriptRun` row
alone — it is the record that the work happened.
Each script's header comment should say what condition makes it safe to remove.
