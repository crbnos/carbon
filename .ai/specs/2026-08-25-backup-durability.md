# Backup durability and transparency

Date: 2026-08-25
Status: implemented on `feat/backup-durability`, not merged
Supersedes: the first draft of this file (same path, earlier today)
Reader-facing companion: `.ai/docs/backup-durability-eli5.html`

**This document has been through one correction pass.** After the feature was built,
reading it back end-to-end showed that three of its decisions acted on customer data
without being asked, and a fourth depended on a person remembering. D6 and D7 were
replaced, and the changes are folded into the text below rather than left as errata —
what you read here is what shipped. The corrected decisions and the reasoning behind them
are in the table below and under Rejected alternatives.

> ## ⚠ REVISED 2026-08-28 — the compatibility verdict is computed live, not stored
>
> Self-review found the stored verdict was a tautology: `writeBackupCompatibility`
> ran once, at export time, diffing the manifest against the very catalog it had
> just been projected from — empty by construction — and was never refreshed. So
> `compatibility.json` always said `ready`, and the badge's yellow/red states, the
> typed-confirm gate and the blocked no-confirm state were unreachable.
>
> **Now:** the Backups loader computes `reportBackupCompatibility` against the
> LIVE schema on every load (`getCompanyBackups` in `backups.server.ts`, via the
> new `@carbon/jobs/backups` export of `packages/jobs/src/backups/schema.ts`).
> `compatibility.json`, `writeBackupCompatibility`, `checkedAt` and the
> "listed but unchecked" state are gone; the restore job's own gate is unchanged.
> The same pass extracted the catalog/compat logic into `src/backups/` so
> `check-backups.ts` runs under bare tsx without the `@carbon/logger`
> `"type": "module"` flip (reverted), moved `TABLE_RENAMES` to
> `src/backups/renames.ts`, and translated the badge/area/popover copy.
>
> ## ⚠ REVERSED 2026-08-26 — read this before Part 3 or D3/D10
>
> Review feedback on the PR overturned this spec's reading of the cross-tenant rows.
> **Three things below no longer describe the branch**, and the reasoning that produced
> them was wrong. Full write-up: `.ai/reviews/2026-08-26-tenant-leak-feedback.md`.
>
> **D3 (export skips unrestorable rows) is REVERTED.** The export refusing was never a
> backup defect — it was a tenant leak surfacing. RLS hides another tenant's rows from
> every ordinary read, so an export, which runs without RLS, is the only thing wide
> enough to see one. Excluding the rows and finishing the backup silenced the sole
> detector in exchange for a friendlier error on a company whose data was already wrong.
> The hard refusal is back. `manifest.excludedRows`, `CompanyBackupSummary.excludedRows`,
> the list-row count and the disclosure's `ExcludedRows` block are all gone.
>
> **D10 (nightly `findExportScopeViolations` monitor) is REVERTED.** `tenant-integrity.ts`
> only wrote a log line. By this repo's own rule — no detection without a consumer that
> acts — that is not monitoring. Deleted rather than dressed up.
>
> **Part 3's SQL migration is REVERTED.** `20260825075035_harden-operation-dependency-scope.sql`
> added a same-company guard to `check_operation_dependencies`,
> `set_initial_dependency_status` and `finish_job_operation`. Those three functions only
> READ dependency rows; none of them writes one, so none could have produced the
> mis-stamped data, and this spec's claim that they did was unsupported. The guard was
> tolerating bad rows rather than preventing them, at the cost of rewriting three live
> job-completion functions. Dropped.
>
> **What SURVIVES from Part 3, and matters most:** the edge-function fixes in
> `trigger-rework/index.ts` and `schedule/index.ts`. Those are the write path. Before
> them, `trigger-rework` had NO authorization gate at all, and its convergence read of
> `jobOperationDependency` carried no `jobId` filter — so it swept in EVERY tenant's
> dependency edges and re-inserted them under the caller's company. That is how the rows
> got mis-stamped. Both functions now verify the job belongs to the caller's company and
> 404 on a miss, and the read is scoped.
>
> Everything else in this spec — D1, D2, D4–D9, D11–D14 — is unaffected.

Per-company backups are currently close to unusable, for two unrelated reasons
that both surface to the user as "the backup is broken". This spec covers the
mechanism, both defects, every decision taken, and — new in this revision — the
**user-facing behaviour**: what we warn about, what we still refuse, and what we
tell the person at each step.

---

## Decisions at a glance

| # | Decision | Why |
|---|---|---|
| D1 | A new NOT NULL column must ship a DEFAULT (conformance check over migration SQL) | Makes the gate's main refusal branch unreachable. Cheapest fix in this document. |
| D2 | Restore **discloses and proceeds** instead of refusing, except where data would be silently lost | The loader is already drift-tolerant; the gate is what refuses. |
| D3 | ~~Export **skips and discloses** unrestorable rows~~ **REVERTED 2026-08-26** — the export still refuses | The refusal is a tenant-leak detector, not a backup defect. See the banner above. |
| D4 | A committed map of renamed/dropped tables, appended by the migration that renames | "Missing" means two different things and guessing wrong loses data quietly. |
| D5 | A LOCAL pre-commit check, not a CI gate | Moves discovery to the moment fixing it is free. The CI design was abandoned on contact — a bare Postgres has no `auth`/`storage` schema, so it needed most of the compose stack. |
| D6 | ONE self-maintaining schema baseline, `packages/jobs/manifests/schema.json`, regenerated and staged by the pre-commit hook | *(replaced the original D6, dated vintages: nothing forced anyone to add one, and the directory grew forever)* |
| D7 | Backups have NO shelf life, NO scheduled creation, and NO revalidation pass | *(replaced the original D7, which had all three)* Revalidation had no consumer that acted on a finding; the other two acted on customer data without being asked. |
| D8 | One shared status vocabulary across every backup surface | Five states, one word each, no synonyms. |
| D9 | All user-facing copy names the affected product areas, never "the system" | The current message blames the product for a data-integrity finding. |
| D10 | ~~`findExportScopeViolations` runs on a schedule as monitoring~~ **REVERTED 2026-08-26** | It only logged. No detection without a consumer that acts. |

| D11 | The baseline is the copy on `main`, fetched from `raw.githubusercontent.com`, slug from the `origin` remote | The last shipped schema is what customer backups were taken against; a file that regenerates itself cannot be its own baseline. |
| D12 | A fetch failure warns — naming the STALENESS, not just the failure — and falls back to `git show origin/main:…`; a baseline found in NEITHER place is a hard failure | Offline work must not be blocked; a missing baseline skipped quietly is indistinguishable from a passing check. |
| D13 | The check asserts against the last shipped schema only | Every migration commit is checked, so a break is caught when introduced. Git holds every past version of the one file for looking further back. |
| D14 | The rule for what a backup contains lives once, in `company-backup.ts` | The baseline exists to describe what a real export produces; two implementations that merely agree today would let the check go green against a model that had drifted. |

Deferred: eager rewrite of stored backups on deploy; per-migration row
transforms replayed at restore. Both discussed under Rejected alternatives.

---

## Part 1 — How backups work today

Grounded against `packages/jobs/src/inngest/functions/tasks/company-{backup,export,restore,template}.ts`
as of this date.

### What gets copied

One Postgres database; every tenant's rows share the same tables, separated by a
`companyId` column. Nothing hardcodes the table list — `getCompanyTableCatalog`
reads `information_schema` for every public base table with a `companyId` or
`companyGroupId` column, collects columns and FK edges, and topologically sorts
them parent-first.

Tables with **neither** column are pulled in transitively: a table inherits the
scope of the first FK it has to an already-scoped table
(`company-backup.ts:649`). Nuance — "first" is `pg_constraint` ordering, so for a
child with several FKs to scoped parents the chosen path is arbitrary but stable.
No known bug; a latent surprise if a table gains a new FK.

Excluded on purpose: `SECRET_TABLES` (`apiKey`, `apiKeyRateLimit`,
`companyIntegration`, `webhook`, `oauthClient`, `oauthToken`) and
`TRANSIENT_TABLES` (MRP output the next run regenerates).

### The artifact

A folder in the per-company storage bucket, not a single archive:

```
exports/<name>/
  tables/<table>.ndjson.gz    one gzipped file per NON-EMPTY table
  assets/<path>               server-side copies of the company's files
  manifest.json               written LAST
```

`manifest.json` is the completion protocol: the UI lists a folder without one as
still-preparing, and restore refuses to read it. It holds each table's name, row
count and **column list** — the last of these is what Part 4 exploits.

Empty tables get no file, which is data-absence rather than a coverage gap.
Assets are copied server-side so no bytes pass through the job; the only bound is
`MAX_STORAGE_TOTAL_BYTES = 1GiB` per backup, a storage-cost guard, not a memory
one. A company with no `companyGroupId` throws rather than producing a backup
with an empty chart of accounts.

**Not a point-in-time snapshot.** The per-table `SELECT`s run six at a time, each
its own statement, with no shared transaction. A backup taken during active use
is not guaranteed internally consistent. Not a reported problem; stated so no
feature is built assuming otherwise.

### What a restore does

Replace, not merge:

1. Preflight refusals, before anything is touched — format compatible
   (`assertBackupImportable`), referentially closed
   (`assertReferentiallyClosed`), and a foreign backup rejected if the target
   shares its company group with siblings.
2. Snapshot current state to `_pre-restore-<runId>` using the same export code.
   **Idempotent** — a retry reuses `metadata.snapshotPath`, because
   re-snapshotting after the wipe committed would capture the wiped state and
   destroy the real pre-restore copy.
3. `wipeAndLoad`: one transaction, `SET LOCAL session_replication_role = 'replica'`
   so FK order doesn't matter during the load. Scoped `DELETE`s, then bulk
   `INSERT`s.
4. Files copied back — deliberately outside the transaction, best-effort, so a
   storage failure cannot fail an already-committed restore.
5. Marker goes `ready`; the user picks Keep (snapshot dropped) or Revert
   (snapshot reloaded through the same `wipeAndLoad`).

### The two safety nets are different things

- The **transaction** covers a restore that *fails*. Nothing changed.
- The **snapshot** covers a restore that *succeeded and was wrong*.

Constantly conflated. Neither substitutes for the other, and the UI copy in
Part 5 must keep them distinct.

---

## Part 2 — Defect A: restores rot after a migration

### The exact failure

`assertBackupImportable` (`company-backup.ts:742`) has two schema-drift refusal
branches:

- a table in the manifest that no longer exists in the catalog, and
- a live column that is NOT NULL, has no DEFAULT, is not generated, and is absent
  from the backup's column list.

Plus a `BACKUP_VERSION` mismatch (currently `1`, so inert) and a check that
account defaults never travel without a chart of accounts.

### The loader is already tolerant

`company-restore.ts:147` builds its insert column list as the **intersection** of
live and backup columns:

```typescript
      const columns = table.columns.filter(
        (c) => !c.isGenerated && backupCols.has(c.name)
      );
```

A column dropped since the backup is already ignored; a column added since
already falls back to its `DEFAULT`. Most drift would load fine. **It is the gate
in front of the loader that refuses**, by demanding an exact match. That
asymmetry is the whole defect.

### What the gate does NOT catch

Passing it is not proof the load will work: a tightened `CHECK`, a removed enum
value, a narrowed column type, or a retargeted FK all pass and then fail
mid-load. `demandForecastSource` is excluded from backups entirely because of
exactly this class — a discriminator `CHECK` that a remapped restore violated.

### Decisions

**D1 — new NOT NULL columns ship a DEFAULT.** A conformance check in
`@carbon/checks` over migration SQL. Since the gate already skips defaulted
columns, this makes its second branch unreachable.

**D2 — disclose and proceed.** Replace most of the gate with a report the user
confirms. Design in Part 5.

Hard boundary, and it is not negotiable: **still refuse** when proceeding would
leave surviving rows pointing at nothing. A restore that reports success and has
broken links is worse than today's refusal, because nobody finds out.

**D4 — a rename/drop map.** Dropped-with-its-feature is safe to skip; *renamed*
discards real data and orphans its children while reporting success. The schema
cannot distinguish them, so keep a committed map (`old name → new name | null`)
that a renaming migration must add a line to. A missing entry is a hard refusal,
not a guess.

---

## Part 3 — Defect B: exports refuse, and the multi-tenancy bug under it

This is a security finding. Read it before cleaning any data.

### What the customer saw

```
The system created an invalid backup — please contact Carbon support. (Refusing to export CG4Zvt9pMsvfgxLb2ijPPy: 4 NOT-NULL reference(s) escape company scope, so the backup could never be restored: pickMethod.itemId → item (1 row) jobOperationDependency.jobId → job (3 rows) jobOperationDependency.dependsOnId → jobOperation (3 rows) jobOperationDependency.operationId → jobOperation (3 rows))
```

`findExportScopeViolations` refuses to *produce* a backup whose NOT-NULL FKs
point outside the company's export scope, because such a backup could never be
restored. **It is behaving correctly. The data is wrong.**

That guard deliberately widens the parent set to include `companyId IS NULL` rows
— shared seeded substrate present in every target — so a ref to global
`material*`/currency rows is never a false positive. A ref to a row owned by a
*different* company still surfaces, which is what happened.

### What the data says

Both tables carry their own `NOT NULL companyId`, and both FKs are single-column
(`jobOperationDependency.jobId → job("id")`, `pickMethod.itemId → item("id")`),
so Postgres only guarantees the parent exists *somewhere*.

Blast radius across the whole database is four rows in two company pairs:

```
CG4Zvt9pMsvfgxLb2ijPPy → EaQrV2e2fKZDDAD69G8cto   3 rows (jobOperationDependency)
VL169ZQuC8pK7bZqFofx8F → d1htultl6debqkn9qn60     1 row  (jobOperationDependency)
CG4Zvt9pMsvfgxLb2ijPPy → 2QHYS5kvVmu4Jsi6EXh33q   1 row  (pickMethod)
```

The three `jobOperationDependency` rows are **one continuous dependency chain of
a single job** — `jo_32jkB…` → `SWzSN…` → `jo_CZnGX…` → `jo_HvrtN…` — all
belonging to `EaQrV2e2fKZDDAD69G8cto`, written 2026-07-29 16:17:45, but stamped
`CG4Zvt9pMsvfgxLb2ijPPy`.

That is the key detail. This is not one stray id leaking into a computation —
**the entire insert used the wrong `companyId`.**

No `company-restore` or `company-template` marker exists on any of the three
companies (the only marker is the failed export itself), so an
import/restore/template origin is unsupported. Markers clear on success, so
absence is not proof.

### Root cause hypothesis

Both incidents share one shape: **the record id comes from the request, the
`companyId` comes from the session, and nothing checks that the two belong
together.**

- `pickMethod` rows are "created lazily when a user attempts to view them" (its
  own migration comment), so viewing an item writes a row with the viewer's
  company and the item's id.
- The only two writers of `jobOperationDependency` are
  `packages/database/supabase/functions/lib/scheduling/scheduling-engine.ts` and
  `packages/database/supabase/functions/trigger-rework/index.ts`. Both take
  `companyId` and `jobId` from the edge-function payload and **neither verifies
  the job belongs to that company.** There are no SQL-level inserts.

A second, independent bug in the same area, worth fixing on its own merits —
`trigger-rework/index.ts:351`:

```typescript
  const downstreamDeps = await trx
    .selectFrom("jobOperationDependency")
    .select(["operationId"])
    .where("dependsOnId", "=", triggeredAtJobOperationId)
    .where("operationId", "not in", clonedOperationIds)
    .execute();
```

No `companyId` and no `jobId` filter. It reads dependency rows belonging to any
tenant and re-inserts them stamped with this job's company — a direct route to
this exact corruption.

### Structural notes (corrected)

An earlier draft of this spec claimed these rows can never heal. That was wrong,
and the correction matters for how the fix is framed.

The bad rows' `jobId` (`job_GLoDiXmcuURfU6UTg5GLxA`) is **correct** — it is the
job those operations really belong to. Only `companyId` is wrong. Since the
scheduler's rebuild deletes `.where("jobId", "=", this.jobId)` with no company
filter, the owning company's next reschedule of that job *will* clear them. They
are not permanent residue.

What remains true:

- `jobOperationDependency`'s primary key is `("operationId", "dependsOnId")` with
  **no `companyId`**, so one operation pair can exist only once database-wide,
  across all tenants. The scheduler's
  `.onConflict(["operationId","dependsOnId"]).doNothing()` therefore lets a
  pre-existing foreign row silently suppress the legitimate one.
- A row whose `jobId` *is* wrong would be permanent. That is not this incident,
  but the same write path could produce it.

### Open question 1 — RESOLVED, and it is not cosmetic

`check_operation_dependencies(operation_id)`
(`20250429130223_operation-dependencies.sql:35`) has **no company filter**:

```sql
  SELECT COUNT(*)
  INTO incomplete_deps
  FROM "jobOperationDependency" dep
  JOIN "jobOperation" jo ON jo.id = dep."dependsOnId"
  WHERE dep."operationId" = operation_id
    AND jo.status != 'Done';
```

The `finish_job_operation()` trigger in the same migration repeats the pattern in
its `NOT EXISTS` subquery. So a dependency row stamped with *any* company
participates in deciding whether an operation is `Waiting` or `Ready`.

For **this** incident the operational impact is mild, because the three rows
describe `EaQrV2e2fKZDDAD69G8cto`'s own real dependency chain — the graph is
right, only the label is wrong. But the mechanism is confirmed: a row belonging
to one tenant can gate another tenant's shop-floor operation, with nothing in
the schema or these functions to prevent it.

The severity therefore sits in what the rows *prove* rather than what they
currently *do*: **a write occurred against company `EaQrV2e2fKZDDAD69G8cto`'s job
while carrying company `CG4Zvt9pMsvfgxLb2ijPPy`'s id.** That is an unauthorised
cross-tenant write, and the payload-trust gap in Part 3's "Root cause hypothesis"
is the only mechanism found that produces it. Fixing that gap is the priority;
the four rows are a symptom.

Consequence for the plan: the ownership checks are **not** optional hardening
that can wait behind the backup work.

### Honest limit on the diagnosis

The three rows were written 6–7 ms apart, meaning three separate transactions.
Both current writers insert in a single statement, which would share one `NOW()`
(transaction timestamp). The `pg_advisory_xact_lock` + `onConflict` block in the
scheduler reads like it was added *after* someone hit a race here, so the version
that wrote these rows most likely no longer exists. The guilty statement cannot
be pinned from the row alone; the ownership check is the right fix regardless.

### Unresolved and blocking

`check_operation_dependencies(operation_id)` is `SECURITY DEFINER` and takes only
an operation id, with no company. **Whether it counts these rows decides whether
this is cosmetic or operational** — if it does, one tenant's stray row can hold
another tenant's shop-floor operation in a not-ready state. Determine this
*before* deleting the rows, because the cleanup removes the ability to reproduce
the effect.

### Actions, in order

1. Answer the `check_operation_dependencies` question. It sets the severity of
   everything else here.
2. Add a job-and-company ownership check to both edge functions, and scope the
   `downstreamDeps` read. Stops new damage.
3. **D10** — run `findExportScopeViolations` on a schedule so cross-tenant refs
   are caught by monitoring rather than by a customer's failed export.
4. Clean up the four rows, evidence preserved elsewhere first.
5. **D3** — make the export skip and disclose instead of refusing. Design in
   Part 5.

The customer's export stays blocked until either 4 or 5 lands.

### Schema follow-up (needs its own design pass)

Adding `companyId` to `jobOperationDependency`'s primary key would make the whole
class impossible and would match the composite-PK convention the rest of the
schema follows. It is a migration on a production-critical table with an
`onConflict` clause depending on the current key.

---

## Part 4 — The drift check

### Why this is the centrepiece

Nothing exercises a backup between the day it is written and the day someone
needs it, so migrations accumulate unchecked. Move discovery to the moment the
migration is written, by the person who knows what the new column means.

In-house proof: `applyDataset` (`packages/database/src/datasets/`) fills a
company across just as many tables and *doesn't* rot, because it is code that
ships alongside the schema and `pnpm db:check:datasets` runs on pre-commit.
Backups rot for the opposite reason — frozen data with nothing exercising it.

### Where this landed, and why not CI (D5, revised)

The original D5 was a CI job on migration PRs: boot an empty Postgres, apply only
`origin/main`'s migrations, dump the catalog as the "before", apply the PR's
migrations, compare. It was abandoned on contact. A bare Postgres has no `auth` or
`storage` schema — `ERROR: relation "storage.buckets" does not exist` on the ninth
migration — because the Storage and GoTrue services create those when their own
containers boot, so the job needed most of the compose stack.

A developer's machine already has all three schemas. And once the check runs
there, the migration replay it was built around becomes unnecessary: a committed
schema manifest already IS the old schema. So it is a local command,
`pnpm db:check:backups`, run from `.husky/pre-commit` when a staged file is under
`packages/database/supabase/migrations/`, skippable with
`CARBON_SKIP_BACKUP_CHECK=1`.

D11–D13 keep it that way. Fetching the baseline from `main` at commit time closes the
staleness hole that would otherwise argue for a CI backstop, and CI was already
declined once on cost for this work.

Two honest limits carry over. A hook is bypassable with `--no-verify`, so this is
a safety net rather than a gate — the same limitation `db:check:datasets` has. And
it reads the LIVE schema, so it **refuses rather than passes** when the developer's
database is behind: an unapplied migration means the schema does not yet contain
the change being committed, so the baseline would pass for the wrong reason.

### Check A — the manifest, not the data

Producing a realistic old backup is a chore, and **synthesising one is worse**:
this schema is a web of FKs and discriminator `CHECK`s (again,
`demandForecastSource`), so a generic row-builder fails for its own reasons and
you debug the generator while believing you are debugging backups. Explicitly
rejected.

You do not need rows. `assertBackupImportable` reads `manifest.tables` — names
and column lists — and nothing else that matters. Every table is covered
automatically, nothing is fabricated, no FK has to be satisfied, and it is not a
stand-in for the real gate: it *is* the function that gates real restores.

**D6 — one self-maintaining baseline (revised).** The original D6 committed dated
manifests (3/6/12 months) to answer "how far back is a backup restorable". It was
replaced: nothing forced anyone to add one, and the directory grew forever.

Instead there is exactly one undated file, `packages/jobs/manifests/schema.json`,
which the pre-commit hook regenerates from the developer's live database and
`git add`s on success (`--stage`, which only the hook passes — a manual
`pnpm db:check:backups` stays read-only). It is generated output, in the category
of a lockfile.

A file that regenerates itself cannot be its own baseline — it would compare
today's schema with today's schema and pass every time. So the "before" is the
copy of that file **on `main`** (D11), fetched unauthenticated from
`https://raw.githubusercontent.com/<owner>/<repo>/main/packages/jobs/manifests/schema.json`
with the slug parsed from `git remote get-url origin`, so a fork checks itself.
D12 governs the failure modes; D13 sets the window; D14 keeps the file describing
what a real export produces.

### Check B — the demo-data round trip — DROPPED

Designed as: seed with `applyDataset`, export, restore, to catch the
constraint/type class that a rows-free manifest cannot. Dropped because it cannot
be a commit-time check — `buildCompanyBackup` writes storage outside any
transaction, so a rolled-back round trip still leaves objects behind, and
`wipeAndLoad` deletes real rows.

The gap it would have covered is real and is stated honestly under "What none of
this does" below, and in the rule's coverage list.

### Check C — demo-data coverage has not shrunk — DROPPED

Designed as: list every tenant-scoped table with zero demo rows, fail when a new
one appears. It existed only to stop Check B going green while exercising nothing;
with B dropped, its reason went with it.

It is also unnecessary here on its own terms: `catalogAsManifest` reads
`information_schema`, so **every** table in the schema is already compared with
`rows: 0` whether or not a dataset ever inserts into it. Coverage at the name
level is total, and demo data adds nothing to it. Backups do not depend on demo
data.

### Fixed for free

`pnpm db:check:datasets` reads the **live local** database. Write a migration,
commit before `pnpm db:migrate`, and it validates against the old schema and
passes — exactly the state a migration author is usually in.

The backup check shares that database but not that hole: it **refuses to give a
verdict** when migrations are pending rather than passing (`countPendingMigrations`),
because an unapplied migration means the live schema does not yet contain the change
being committed. Both remain bypassable with `--no-verify`; neither is a gate.

### What none of this does

It tells you a backup has broken. It does not make a broken backup loadable. That
is what Part 5's disclose-and-proceed is for, and what the deferred eager-rewrite
option would address properly.

---

## Part 5 — User-facing behaviour and transparency

The current experience fails on honesty as much as on function. A refusal reads
`The system created an invalid backup — please contact Carbon support.` — which
blames the product for a data-integrity finding, gives the person nothing to act
on, and is shown for a condition where 4 rows out of millions were the problem.
This part is the design for that.

Surfaces: `apps/erp/app/routes/x+/settings+/backups.tsx`,
`apps/erp/app/modules/settings/ui/Backups/` (`BackupChoices`,
`BackupSourcePicker`, `BackupProgressModal`, `RestoreReviewRow`,
`BackupContentsInfo`), and `apps/erp/app/routes/api+/settings.backup-summary.ts`.

### D8 — one status vocabulary, five words

Used identically in the list, the detail modal, and any API response. No
synonyms anywhere.

| Status | Meaning | User can restore? |
|---|---|---|
| **Ready** | Complete, and loads into today's schema unchanged | Yes |
| **Restorable with changes** | Will load, but N things differ — disclosure required | Yes, after confirming |
| **Not restorable** | A hard refusal, with the specific reason | No |
| **Incomplete** | No `manifest.json` — the export died partway | No |
| **Failed** | The export itself failed, with the reason | No |

`Incomplete` must never be rendered as "Preparing…" once no export is being
tracked — that is the existing bug where a dead folder looked alive forever.

### Creating a backup

Keep today's non-blocking, row-first behaviour: clicking Create backup drops a
"Creating backup…" row into the list immediately (optimistic `runningExport`,
also adopted from the marker on mount so a reload or another tab still shows it),
and clicking that row opens the progress modal.

Progress must stay **real**, never a timer: phase plus counts (`tables`, then
`files`), and completion signalled by the new backup actually appearing in the
revalidated list — never by the dialog guessing.

**New (D3): a partial success is a success.** When
`findExportScopeViolations` finds unrestorable rows, do not refuse. Exclude those
rows, record them in the manifest as excluded, finish the backup, and mark the
row `Ready` with a secondary line: `3 rows excluded`. Clicking through names the
affected areas and, in a details expander, the exact table and FK for support.

Rationale: an orphaned `jobOperationDependency` row is meaningless without its
operation, and the alternative is a company with no backup at all.

**When we still fail an export** — genuinely unrecoverable cases only: the
company has no `companyGroupId`, or storage rejected the writes. Keep the marker
on failure (a cleared marker made a broken export indistinguishable from one that
never ran), show a banner with a plain reason, and keep the Dismiss action.

### The Backups list

Each row shows label, when it was taken, size, and its **status badge computed
from the stored manifest against the live catalog**, written once beside the
manifest at export time (`compatibility.json`) and dated by `checkedAt`.

**No expiry date, and no disclaimer (revised).** The original design printed both
a status badge and a concrete expiry date, and rejected a creation-time "backups
may go stale" disclaimer as unfalsifiable and unread. The disclaimer stays
rejected for that reason; the expiry date is now rejected too, for a related one.
A printed date reads as a promise the backup is good until then, and nothing can
make that promise — the date was only our own deletion schedule, and D7 removed
the deletion. The badge answers the question the person actually has, for today.

The original design also had a nightly pass refreshing that badge. It was built
and removed: it recomputed the verdict, alerted nobody and repaired nothing, so
`checkedAt` now always equals the export date, which the row already shows. The
hard refusal is `assertBackupImportable` inside the restore, against the LIVE
schema, and it cannot go stale.

### Before restoring — the disclosure screen (D2)

Run the compatibility and closure checks in **report mode**, not gate mode, and
render three finding kinds:

- **Will be filled with a default** — a column added since this backup. No data
  is lost. Informational.
- **Will be discarded** — a column removed since this backup. Its values are in
  the backup and will not land anywhere.
- **Cannot be restored** — see the hard-refusal list below.

Group findings by **product area, not table name**, reusing the vocabulary
already in `GROUPS` in `settings.backup-summary.ts` (Sales, Purchasing, Items,
Production, Accounting, Quality, People). That map is currently headline entities
only, so it needs generalising to cover every scoped table, with an
`Other` bucket rather than a silent omission. Exact table names stay available
in a details expander — support needs them, the user does not.

The screen must also state, every time, in this order: today's data for this
company will be deleted and replaced; a snapshot is taken first; Revert restores
it; Keep drops the snapshot and is the point of no return.

Require typed confirmation **only** when something will be discarded. A restore
that merely fills defaults does not need friction.

### What we still hard-refuse, and what we say

Each of these is a genuine "proceeding is worse than stopping". The message names
the cause and, where one exists, the action.

- **A table was renamed and the D4 map has no entry.** Skipping it would discard
  real data and orphan its children while reporting success.
- **A NOT NULL foreign key would dangle** after skipping. This is the D2 hard
  boundary.
- **`manifest.json` is missing** — the backup never finished. Suggest taking a
  new one.
- **The format generation is no longer supported** (`BACKUP_VERSION` mismatch).
- **A foreign backup onto a shared company group** — it would rewrite the chart
  of accounts the sibling companies are still posting to. This one already has
  good copy; keep it.

### During and after the run

Progress markers already exist (`snapshot`, `wipe`, `load`, `files`, throttled to
250 ms) — surface all four phases with counts.

A stalled run must stay actionable. The template flow already learned this: keep
Revert visible and spinning for the whole run rather than hiding it, and after a
timeout offer "Retry revert". Re-firing is safe because the snapshot path is read
from the marker and the shared concurrency key serialises it.

Keep/Revert persists until decided. Revert must not hide its row optimistically —
it keeps running, and the row is the only thing reporting that.

### Copy rules (D9)

1. Never say "the system". Name what happened.
2. Never say "contact support" when the person can act. If they genuinely cannot,
   say what support will need.
3. Product words in the body (Sales, Production); exact table and column names in
   a details expander.
4. Numbers, not adjectives. "3 rows excluded", never "some data".
5. Never claim success before the artifact exists.

---

## Edge cases and nuances to preserve

- **Snapshot idempotency is load-bearing.** A retry that re-snapshots after the
  wipe committed captures the wiped state and destroys the user's real data.
  `company-template.ts` follows the same rule for the same reason.
- **The two wipes are not interchangeable.** `datasets/wipe.ts` preserves the
  chart of accounts, UoMs, sequences and locations because the tiers require
  them; `selectWipeableTables` deletes them because a backup carries them back.
  Each is paired with whatever repopulates after it.
- **`session_replication_role = 'replica'` disables FK enforcement and cascades**
  for the duration of the load. Any cleanup logic assuming `ON DELETE CASCADE`
  fires is wrong inside that transaction. This is also why orphan residue is
  plausible in general, even though it did not explain Part 3.
- **File restore is best-effort by design** and must stay that way — the data
  transaction has already committed. Every write is guarded to the target
  `{companyId}/` prefix.
- **Export markers are kept on failure, cleared on success.** Whatever D3 does
  must preserve that property.
- **`manifest.json` last** is the completion protocol. Any new writer of a backup
  folder must preserve the ordering.
- **Empty table ≠ missing coverage.** No `journalLine` file just means no GL
  postings. Check C must not flag a legitimately empty table.
- **A backup is not a consistent point in time.** Do not build a feature that
  depends on it being one.
- **Transitive scope picks the first matching FK**, in `pg_constraint` order. A
  table gaining a new FK to a differently-scoped parent could silently change
  which rows a backup includes.
- **Snapshots are transient**, their assets removed on keep/revert; exports
  persist until deleted **by a person** — there is no cron in this feature at all
  (D7). Each backup duplicates its asset bytes in storage; with nothing creating
  backups automatically, nothing accumulates on its own.
- **Pre-restore and pre-template snapshots (`_pre-*`) have no sweeper** and never
  did — the deleted maintenance job skipped them by design. They are dropped by the
  keep/revert path. A stalled restore can strand one; pre-existing, out of scope.
- **The feature is internal-only** in real deployments
  (`canAccessBackups(email)` = `IS_LOCAL_DEV || isInternalEmail(email)`), which is
  why Part 3 has not hit a paying customer — and why removing that gate should
  wait for Part 3's fixes.

---

## Rejected alternatives

- **A mechanical row-filler** to reach 100% table coverage. Discriminator
  `CHECK`s and the FK web mean the generator fails for its own reasons; you debug
  the generator instead of the backups.
- **Per-migration row transforms replayed at restore (lazy upcasting).** The only
  way to make genuinely old backups restorable, but it means maintaining a second
  migration ladder in row-object form that is write-once-debug-never — first
  exercised the day someone desperately needs a restore. Revisit only if D6's
  vintages show we need it.
- **Eager rewrite of stored backups on deploy.** Better economics than lazy (the
  transform is written once, at maximum context) and it makes the compatibility
  gate a no-op. But a bad rewrite corrupts silently with no original to compare
  against, so it needs a retained pre-rewrite copy. **Deferred, not dismissed** —
  this is the answer if long-lived backups become a requirement.
- **Restore into a scratch database at the backup's own schema version, migrate
  it forward, re-export.** Reuses migrations we already trust, but needs a spare
  database per restore. Too heavy for now.
- **A "backups may go stale" disclaimer at creation time.** Unfalsifiable and
  unread. Replaced by the per-row status badge (Part 5).
- **A printed expiry date on each backup row.** Reads as a promise of validity
  nothing can make; it only ever described our own deletion schedule, which D7
  removed.
- **Automatic weekly backups, and 90-day automatic deletion.** Both built, neither
  shipped. The deletion could not tell a backup a person deliberately took from one
  a cron took for them, so the one the customer chose was the one that disappeared;
  the weekly job buried that same backup among rows labelled `Scheduled` nobody
  asked for, at our storage cost. Dropped, and **not** to be reintroduced as a
  setting — a backup is a thing a person chooses to take.
- **A nightly pass re-checking stored backups.** No consumer acted on a finding, and
  by the time it notices, the breaking change is already in production. Prevention
  at commit time is the only version that helps.

---

## Open questions

1. ~~Does `check_operation_dependencies` count cross-tenant rows?~~ **Resolved:
   yes** — no company filter, and `finish_job_operation()` repeats the pattern.
   See "Open question 1 — RESOLVED" in Part 3. The finding is an unauthorised
   cross-tenant write, so the ownership checks lead the plan.
2. ~~How far back must a backup stay restorable?~~ **Resolved (D13):** the check
   asserts against the LAST SHIPPED schema only. Every migration commit is checked,
   so a break is caught the moment it is introduced; the restore screen answers the
   live question for a real backup; and git holds every past version of the one
   file (`git show <commit>:packages/jobs/manifests/schema.json`) for looking
   further back. Rejected: committing dated baselines, and an on-demand `--since`
   flag (YAGNI — `git show` already does it).
3. ~~Where do D6's manifest vintages live?~~ **Dissolved:** there are no vintages.
   One file, `packages/jobs/manifests/schema.json`, maintained by the hook (D6).
4. ~~Is a PR-time `supabase start` acceptable CI cost?~~ **Resolved: no CI job.**
   The check is local, and fetching `main` at commit time closes the staleness hole
   that motivated a CI backstop. CI was already declined once on cost for this
   branch.
5. Should `companyId` join `jobOperationDependency`'s primary key?
6. Who generalises the `GROUPS` map in `settings.backup-summary.ts` to cover every
   scoped table, and does the `Other` bucket need a per-table allowlist to stay
   honest?

---

## Doc debt

~~`.claude/rules/company-backup-restore.md` describes the retired single
`.carbon.json.gz` NDJSON format.~~ **Done** (plan Task 21), and re-synced again by
Task 27 for the correction pass.

## Changelog

- **2026-08-25** — Spec written; three parts (restore rot, the export refusal and
  the cross-tenant write under it, the drift check) plus the user-facing design.
- **2026-08-25** — Implemented on `feat/backup-durability` (plan Tasks 1–21; 5, 16
  and 17 skipped or dropped by decision).
- **2026-08-25** — **Correction pass.** Reading the feature back end-to-end with the
  user replaced D6 and D7 and added D11–D13: no automatic backups, no automatic
  deletion, no expiry date, and one self-maintaining schema baseline checked against
  the copy on `main`. Plan Tasks 22–28.
- **2026-08-25** — Thermo-nuclear code review added D14 and plan Task 29: the rule
  for what a backup contains was written twice, so the baseline could have drifted
  from the exporter while the check stayed green. Fixed; three lesser findings
  (duplicated `skip`/`countPendingMigrations` across `@carbon/jobs` and
  `@carbon/database`, three exit conventions in the check script, two restating
  comments) were left open deliberately.
