# The schema baseline

`schema.json` is a snapshot of the export schema: every table a company backup
would contain, with its column list and **no rows**. Compatibility is decided
entirely by table and column names, so a schema-shaped manifest is exactly as
informative as a real customer backup and costs nothing to commit.

## Nobody maintains this by hand

The pre-commit hook regenerates it from your live database and stages it, whenever
you commit a change under `packages/database/supabase/migrations/`. There is no
command to remember and no dated files to add. It is generated output, in the same
category as a lockfile.

## What it is compared against

A file that regenerates itself cannot be its own baseline — it would compare
today's schema with today's schema and pass every time. So the check fetches the
version of this file already on `main`, which is the schema real customer backups
were taken against:

```
https://raw.githubusercontent.com/<owner>/<repo>/main/packages/jobs/manifests/schema.json
```

The owner and repo come from your `origin` remote, so a fork checks itself.

If that fetch fails — offline, timeout, GitHub down — the check warns and falls
back to `git show origin/main:packages/jobs/manifests/schema.json`, your local
copy. A network problem never fails a commit. That copy can be months old if you
have not pulled; an older baseline is a **stricter** check, never a blinder one,
but it can flag a column a teammate has already removed on `main`. That is why the
warning names the staleness and not just the failure.

If the baseline is in neither place, the check **fails**. A missing baseline
silently skipped is indistinguishable from a passing check.

## The one time you have to think about it

The very first commit that puts this file on `main` has no baseline to compare
against. If that commit also touches a migration, bypass the hook once with
`CARBON_SKIP_BACKUP_CHECK=1 git commit …`. After it merges, the situation cannot
recur.

## Looking further back

Git holds every past version of this one file, so "would a six-month-old backup
still restore" is answered with
`git show <commit>:packages/jobs/manifests/schema.json` rather than by committing
dated copies.

## Not a test fixture

Do not point a unit test at this file — its contents change with every migration,
so a test asserting on it would be rewritten constantly and prove nothing.
