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
   scripts with no row there, and inserts a row for each one that succeeds.

Nobody runs these by hand in production. Merging is what ships them.

## Adding a script

1. Drop a `<kebab-case>.ts` file in this folder. That is the registration —
   every such file is discovered automatically, so there is no list to update.
   The name must be lower-case words separated by hyphens; anything else
   (dotted names, underscores, capitals, non-`.ts` files) fails the deploy
   with an error rather than being silently skipped.
2. Take configuration from `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in
   the environment; the runner injects the per-workspace values. Support
   `--dry-run` if the script writes anything.
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
