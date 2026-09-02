---
paths:
  - "packages/jobs/src/backups/**"
  - "packages/jobs/src/inngest/functions/tasks/company-backup.ts"
  - "packages/jobs/src/inngest/functions/tasks/company-export.ts"
  - "packages/jobs/src/inngest/functions/tasks/company-import.ts"
  - "packages/jobs/src/inngest/functions/tasks/company-restore.ts"
  - "apps/erp/app/modules/settings/backups.service.ts"
  - "apps/erp/app/modules/settings/backups.server.ts"
  - "apps/erp/app/modules/settings/ui/Backups/**"
  - "apps/erp/app/routes/x+/settings+/backups.tsx"
  - "apps/erp/app/routes/api+/settings.backup-summary.ts"
  - "apps/erp/app/routes/api+/settings.backup-restore-status.$restoreRunId.ts"
  - "apps/erp/app/services/onboarding.server.ts"
  - "apps/erp/app/services/onboarding-draft.server.ts"
  - "packages/jobs/src/scripts/check-backups.ts"
  - "packages/jobs/manifests/**"
  - "ci/src/upload-backup-templates.ts"
  - "packages/database/supabase/backups/**"
---

# Company Backup / Restore / Onboarding Seed

Per-company logical backup, in-place restore (with revert), and onboarding-seed
from a committed demo template. **Inngest tasks, NOT edge functions** — the old
`import-company` / `finalize-import` / `revert-import` edge functions and the
`company-revert` / `publish-demo` / `refresh-demo-catalog` jobs were deleted; this
is the replacement. Reader-facing docs: `docs/content/docs/platform/backups.mdx`
(kept deliberately impl-free — keep internals here, not there).

User-facing rules of the feature: backups require `settings` update permission
(no owner gate — the old `group.ownerId === userId` check was removed from both the
route and the `export-company` edge function), exclude secrets, and a restore is
reversible via an auto-snapshot.

**Internal-only in real deployments, open to everyone on a local dev stack**,
while the multi-tenant caveats below are unhardened. One gate:
`canAccessBackups(email)` (`apps/erp/app/utils/backups.ts`) = `IS_LOCAL_DEV ||
isInternalEmail(email)`. `IS_LOCAL_DEV` (`packages/env`) is true only when neither
`NODE_ENV` nor `VERCEL_ENV` is `production`/`preview` — so prod, preview, and
self-hosted (all `NODE_ENV=production`) stay internal-only. Used by
`requireBackupAccess` (route loader/action), every `api+/settings.backup-*`
loader/action (404), and the nav (`localOrInternalRoutes` in
`useSettingsSubmodules.tsx`, via `useFlags().isLocalDev`). Internal =
`@carbon.ms` / `@carbon.us.org`. Drop `canAccessBackups` entirely to ship publicly.

## Shared engine — `company-backup.ts`

The catalog is **schema-introspected**, not a hand-maintained list. The
catalog + compatibility layer lives in `packages/jobs/src/backups/schema.ts`
(no runtime `@carbon/*` imports, so bare-`tsx` scripts and the ERP server can
both use it; `company-backup.ts` re-exports it), exported to app code as
`@carbon/jobs/backups`:

- `getCompanyTableCatalog(db)` reads `information_schema` for every public BASE
  TABLE carrying a `companyId` or `companyGroupId` column, builds `TableInfo`
  (columns, FK edges, `scopeColumn`, `hasId`/id type), and topologically sorts
  (referenced-first). **`companyId` wins** when a table has both columns.
- `scopeColumn: "companyId" | "companyGroupId"`. `companyId` = the company's own
  data; `companyGroupId` = config shared across a company group (chart of
  accounts, currencies, dimensions).
- Skip/scope sets: `SECRET_TABLES` (`apiKey`, `apiKeyRateLimit`,
  `companyIntegration`, `webhook`, `oauthClient`, `oauthToken` — never travel;
  `apiKeyRateLimit` is here because its NOT-NULL `apiKeyId` references the stripped
  secret `apiKey`, so exporting it alone would dangle every row on restore — and
  it's UNLOGGED operational counters, not user data), `STRUCTURAL_TABLES` (`company` —
  excluded from catalog), `TRANSIENT_TABLES` (`demandForecastSource`,
  `demandActual`, `supplyForecast`, `supplyActual` — MRP planning output the
  `mrp` edge fn regenerates wholesale every run; excluded from the catalog
  entirely alongside `STRUCTURAL_TABLES`, so they're never exported/wiped/loaded
  and the next MRP run rebuilds them. `demandForecastSource`'s discriminator
  CHECK (`sourceType` ↔ which of `jobId`/`salesOrderLineId`/`demandProjectionId`
  is non-null) made a remapped restore crash — the FK-nulling dangling-ref policy
  in `buildRowTransforms` nulls a set FK and violates the CHECK. `demandForecast`
  is deliberately kept: it has a user-forecast write path and no such CHECK. The
  two excluded sets are unioned into `CATALOG_EXCLUDED_TABLES`, which
  `assertBackupImportable` also skips — an OLDER backup that still carries an
  excluded table is not schema drift, its rows are just ignored on load),
  `RESEED_SKIPPED_TABLES` (memberships/invites/employee/externalIntegrationMapping
  — skipped on onboarding reseed), `IN_PLACE_SKIPPED_TABLES` (access/identity
  tables a restore must keep so the user isn't locked out).
- Format: a backup is a **FOLDER**, not a file — `exports/<name>/` holding
  `manifest.json`, one `tables/<table>.ndjson.gz` per NON-EMPTY table, and
  `assets/<path>` files. Paths come from `backupDir` / `backupManifestPath` /
  `backupTablePath` / `backupTablesDir` / `backupAssetsDir`; each table is written
  and read a line at a time (`serializeTable` / `deserializeTable`), so a huge
  table never materializes as one `>512MB` string (V8's max). Tables are dumped and
  loaded in parallel (`mapWithConcurrency`, `TABLE_CONCURRENCY = 6`). The whole
  folder bundles into one `.carbon.tar.gz` only for cross-environment download and
  upload. There is **no single `.carbon.json.gz` artifact and no `BACKUP_GZ_SUFFIX`**
  — that was the retired one-file format, whose whole-file `{ manifest, data }`
  JSON broke at ~512MB of row data.
- `manifest.json` is written **LAST**, by `writeBackupManifest`, after every table
  file and asset is in place. Its presence IS the "backup is complete" marker: the
  UI lists a manifest-less folder as `Incomplete`, and restore/import refuse to
  read one.
- Versioning: `BACKUP_VERSION` (currently **1** — single supported format, no
  legacy branch) in the manifest; `assertBackupImportable` rejects a file whose
  version no longer matches or that's missing a now-required column.
- Id minting: `newIdForTable(table)` → `randomUUID()` for uuid id columns else
  `nanoid()`. `buildIdMaps` (`company-backup.transforms.ts`) decides WHICH rows get
  one, and both the restore and the reseed/import call it so they can't drift.
  It is **gated on having a text/uuid `id` COLUMN**, not on `hasId` (PK exactly
  `id`) — the ~25 composite-PK tables are referenced by their `id` too, and five
  of them back that with a global `UNIQUE (id)`: `changeOrderRequiredAction`,
  `balloon`, `inspectionDocument`, `inspectionFeature` (all PK
  `("id","companyId")`) and `demandProjection` (PK
  `("itemId","locationId","periodId")`). Leaving their source ids in place made a
  cross-company restore collide with the SOURCE company's still-live rows and roll
  the whole thing back. Serial/int ids are left alone. A
  1:1 extension table whose `id` is itself an FK (`purchaseOrderDelivery.id ->
  purchaseOrder.id`) SHARES its parent's map rather than minting a second id,
  which would split the pair — and under `session_replication_role='replica'`
  the break would commit.
- Storage path rewriting: `rewriteStoragePath` (swap `{sourceCompanyId}/` →
  `{targetCompanyId}/` + remapped id segments), `rewriteToTemplateAssetPath`
  (`{co}/…` → `_templates/{industryId}/…`). `STORAGE_PATH_COLUMNS` =
  `thumbnailPath` ONLY. `modelPath` (raw CAD) is deliberately excluded — raw
  models live in the transient `temp-staging` bucket, not `private`, so a backup
  never carries them; a restored model keeps its thumbnail and regenerates its 3D
  artifacts if the raw is re-uploaded.
- Asset transport: `copyAssetsToBackup` (server-side `storage.copy`
  of `private/{companyId}/…` files into a backup's `assets/` folder) and
  `restoreAssetsFromBackup` (copy them back to `private/`, rewriting paths +
  guarding every write to the target `{companyId}/` prefix). `removeStoragePrefix`
  recursively deletes a backup's asset folder, which is `backupAssetsDir(name)` =
  `exports/<name>/assets` — derived from the folder name, not from a file suffix.
  Copies are server-side — **no asset bytes pass through the job process**, so
  memory stays flat regardless of asset size.

Buckets (important, two different things):
- `STORAGE_BUCKET = "private"` — the **shared** bucket holding every company's
  uploaded assets under a `{companyId}/` prefix.
- The **per-company bucket named by `companyId`** holds one folder per backup
  (`exports/<name>/` — its `manifest.json`, `tables/`, `assets/{companyId}/…`) and
  pre-restore snapshots under the same prefix — see `client.storage.from(companyId)`.
- `TEMPLATE_BUCKET = "company-templates"`, `TEMPLATE_ASSET_PREFIX = "_templates"`.

## Export — `company-export.ts`

Dumps each catalog table scoped by its scope column into its own **data-only**
`tables/<table>.ndjson.gz` (`serializeTable`, line-streamed). **Empty tables are
skipped**
(`if (result.rows.length === 0) continue`) — so a backup of a company with no GL
postings simply has no `journalLine`/`costLedger` rows; that is data-absence, not a
coverage gap. With `includeStorage: "all"`, `buildCompanyBackup` records the
in-scope asset paths in `manifest.storage` and returns them; the job then
`copyAssetsToBackup` them server-side into the backup's `assets/` folder.
- **Out-of-scope rows are FATAL, deliberately.** `findExportScopeViolations`
  (`src/backups/scope.ts`, which also holds `buildScopeFilter` and the exclusion/purge
  builders — pure kysely `sql`, re-exported by `schema.ts` and `company-backup.ts`) counts
  rows whose NOT-NULL FK points outside the company's scope, and a non-zero count
  throws before any table file is written, listing every offending edge.

  **This refusal is a tenant-leak detector, not a backup bug.** RLS hides another
  tenant's rows from every ordinary read; an export runs without RLS, so it is the
  first thing in the system with a wide enough view to see a cross-tenant reference
  at all. An implementation that excluded those rows and finished the backup was
  built and REVERTED on 2026-08-26 for exactly that reason — it made the only
  detector we have go quiet, in exchange for a nicer error on a company whose data
  was already wrong.

  The ONE sanctioned bypass (spec `.ai/specs/2026-09-01-skip-corrupted-rows-in-backups.md`):
  after a VISIBLE failure the user may click **Skip corrupted rows and retry**, which
  re-runs the export with `skipCorrupted: true` — `computeScopeExclusions`
  (`src/backups/scope.ts`) excludes the violating rows *and their dependents*, the job
  logs a `warn` with the list, and `manifest.excludedRows` records it (the Backups row
  shows `N rows excluded`). A restore blocked by the same rows (its pre-restore snapshot
  runs the same guard) offers **Remove corrupted data and restore**, which
  `purgeScopeViolations` deletes in one transaction (children first) behind a destructive
  confirm, then restarts the restore. Both jobs classify the failure with
  `ExportScopeViolationError` → marker `reason: "scope-violations"`; the UI offers the
  recovery ONLY for that reason. Never make either the default, and never skip silently.

  That error is rethrown as a **`NonRetriableError`** in both jobs. The guard's verdict
  is deterministic, so Inngest's `retries: 1` would only flip the marker back to
  `running` and fail again ~10s later — resurrecting the failure banner underneath a
  user who has already clicked Skip. Counts are reported from `rowsByTable` /
  `perTable` (DISTINCT rows per table), never by summing `violations` /
  `excludedRows`: those carry one entry per FK EDGE, so a row escaping scope through
  three of its foreign keys would be counted three times — which once put "10 rows" on
  the confirm button of a delete that removed 4.

  The other hard export failure is a company with no `companyGroupId`.
- **No compatibility verdict is stored with the backup.** One was
  (`compatibility.json`, written at export time on this feature's branch) and it
  was a tautology: the export diffed the manifest against the very catalog it had
  just been projected from, so it always said `ready` and was never refreshed.
  The verdict is only meaningful when manifest and schema come from different
  points in time, so it is computed LIVE in the Backups loader instead (see the
  ERP layer below).
- **Progress/failure marker**: one `externalIntegrationMapping` row per company
  (`integration = "company-export"`, no run id — exports are one-at-a-time per
  company). The job writes `{ status: "running", startedAt, progress }` heartbeats
  (throttled 250ms), **clears the marker on success** (the new backup appearing in
  the list is the completion signal), and **flips it to
  `{ status: "failed", error }` on error** — it is NOT cleared on failure; a
  cleared marker made a broken export indistinguishable from one that never ran.
  The failed marker is dismissed from the UI via the `dismissExportFailure`
  intent → `dismissCompanyExportFailure` (service role — the table has no DELETE
  policy), and the next export's `upsertExportMarker` reuses the row.
- **Asset cap** (`company-export.ts`): no per-file cap (the bucket already bounds
  uploads — 120MB CAD, 50MB docs; the `private` bucket's own limit is the dev
  `50MiB` global in `config.toml`), only a `MAX_STORAGE_TOTAL_BYTES = 1GiB` guard on
  the whole backup. Files are included greedily until the budget is hit; each is
  recorded in `manifest.storage` with `included: true|false`. The cap is storage-cost
  only (server-side copy is memory-flat) — each backup duplicates the bundled bytes.
  The old `25MiB`-per-file / `200MiB`-total caps silently dropped legit large media.

## The drift check — `pnpm db:check:backups`

A migration can make a backup a customer already holds unrestorable **without the
backup changing at all**: add a NOT NULL column with no DEFAULT and every backup
taken before today stops loading. This is the ONLY thing in the system that
prevents that, and prevention at commit time is the only place it can be done —
once the migration is in production the backup is already dead, and every
downstream mechanism can do no more than say so.

That is why there is **no stored verdict and no re-check job**: the Backups
loader computes `reportBackupCompatibility` against the LIVE schema on every
load (`getCompanyBackups` in `backups.server.ts`), so the badge cannot go
stale, and the hard refusal is `assertBackupImportable`, which runs against
the live schema inside `company-restore.ts`. (Two earlier designs died here:
a nightly re-check that alerted nobody and repaired nothing, and an
export-time `compatibility.json` that compared the manifest against the very
catalog it was projected from and could only ever say `ready`.)

`packages/jobs/src/scripts/check-backups.ts` compares ONE committed **schema
baseline** — `packages/jobs/manifests/schema.json`, every exportable table with its
column list and `rows: 0`, `SECRET_TABLES` excluded exactly as a real export
excludes them — against the live schema through `reportBackupCompatibility`. Any
`blocked` finding fails the check.

**Nobody maintains that file.** On success with `--stage` (which the hook passes,
and only the hook) the script regenerates it from the live catalog and `git add`s
it, announced on stdout. A manual `pnpm db:check:backups` stays read-only. There is
no `--write` and no directory of dated vintages — that was the earlier design, and
it depended on a person remembering at each release.

**The baseline is the copy on `main`, never the working-tree copy** — a file that
regenerates itself cannot be its own baseline. `resolveBaseline` fetches
`https://raw.githubusercontent.com/<owner>/<repo>/main/packages/jobs/manifests/schema.json`,
slug parsed from `git remote get-url origin` so a fork checks itself, with a 3s
timeout. On any fetch failure (including a 404 while the file is not yet on `main`)
it warns — naming the STALENESS, not just the failure — and falls back to
`git show origin/main:…`. A network problem never fails a commit. A local copy that
is months behind is a STRICTER baseline, never a blinder one, but it can flag a
column a teammate already removed, and an unexplained false alarm is what earns a
`--no-verify`. Found in **neither** place is a hard `exit 1`: a missing baseline
skipped quietly is indistinguishable from a passing check. The contract is in
`packages/jobs/manifests/README.md`.

A schema-shaped manifest with no rows is exactly as informative as a real customer
backup, because compatibility is decided entirely by table and column names. That is
what makes this checkable from a committed file rather than from a database.

It runs from `.husky/pre-commit` when a staged file is under
`packages/database/supabase/migrations/`, alongside `db:check:datasets`, and skips
with `CARBON_SKIP_BACKUP_CHECK=1`. Read-only — one connection, `information_schema`
queries, no writes.

**Three honest limits.** A hook is bypassable with `--no-verify`, so this is a safety
net rather than a gate (the same limitation `db:check:datasets` has). It reads the
LIVE schema, so it is only as good as the developer's `pnpm db:migrate` — which is
why it **refuses rather than passes** when migrations are pending: an unapplied
migration means the schema does not yet contain the change being committed, so the
baseline would pass for the wrong reason. And it asserts against the LAST SHIPPED
schema only — every migration commit is checked, so a break is caught the moment it
is introduced, but the check cannot pre-certify a two-year-old backup. Git holds
every past version of the one file, so looking further back is
`git show <commit>:packages/jobs/manifests/schema.json`, not a committed pile.

This deliberately is **not** a CI job. The design that was tried first replayed
migrations against a throwaway Postgres to rebuild an old schema, and that cannot
work cheaply: a bare Postgres has no `auth` or `storage` schema (`ERROR: relation
"storage.buckets" does not exist` on the 9th migration) because the Storage and
GoTrue services build those when their own containers boot, so the job needed most of
the compose stack. A developer's machine already has all three schemas, and once the
check runs there the replay is unnecessary — the committed baseline already IS the old
schema. Note that a backup itself never reads the other two schemas:
`getCompanyTableCatalog` filters on `table_schema = 'public'`.

`@carbon/checks` also carries `no-required-column-without-default`, which catches the
most common cause at the SQL level. The two are complements: that check reads
migration text, this one reads the resulting schema and knows what the backups
actually contain.

### What the pair does NOT catch — the honest coverage list

Neither check is complete, and the shape of the gap follows from `manifest.tables`
being `Array<{ name, rows, columns: string[] }>`. **Columns are NAMES ONLY** — no
type, no nullability, no constraint. So compatibility is decided entirely at the name
level, and everything below passes green today:

- **`ALTER COLUMN … SET NOT NULL` on a column that already existed.** The biggest
  hole, and a common migration (25 existing migrations do it). `reportBackupCompatibility`
  tests `backupCols.has(c.name)` FIRST, so a column present in the baseline is skipped
  before nullability is ever considered; and the SQL check deliberately matches only
  the `ADD COLUMN` form. Whether it actually breaks a restore is a DATA question —
  do that company's old rows have nulls there — which a rows-free manifest cannot
  answer even in principle.
- **Type changes** (`ALTER COLUMN … TYPE`, 17 existing migrations). `text` → `numeric`
  restores fine or fails per row depending on the data; the manifest cannot tell.
- **New `CHECK` / `UNIQUE` constraints, and new FKs.** Old rows may violate them.
  `demandForecastSource` is the precedent for how bad this gets — its discriminator
  CHECK made a remapped restore crash, and the fix was excluding the table entirely.
- **Removing a value from an enum** that old rows still carry.
- **Anything data-shaped at all** — the baseline has `rows: 0` by design.

Two more limits that are procedural rather than structural: a developer can pass
`--no-verify`, and the check refuses (rather than passes) when their database is
behind. Both are stated above.

Do NOT close these by teaching the baseline format about types and constraints. The
copy on `main` would lack the new fields until it is next regenerated, so the check
would be blind for exactly the window it exists to cover, and a richer manifest still could not
answer the data questions that make `SET NOT NULL` and type changes dangerous. The
honest reading is that this pair catches the whole class of *structural* breakage —
a table or column the backup has nothing to say about — and that the *value*-shaped
breakage is what `RestoreDisclosure` and the snapshot-and-revert path exist for.

### Renamed and dropped tables — `src/backups/renames.ts`

`TABLE_RENAMES` maps a tenant-scoped table's OLD name to its current one, or to `null`
when it was dropped along with its feature. "Tenant-scoped" here means anything in the
catalog — `direct` scope (its own `companyId`/`companyGroupId`) **and** `via` scope (reached
through a FK to a scoped parent), since both are exported. A migration that renames or drops such a table
must add an entry in the same commit; `db:check:backups` fails the commit until it does,
and `.claude/rules/workflow-database-migration.md` step 3b is where the author is told.

The map exists because "this table is not in the schema" is ambiguous and the schema cannot
disambiguate it. Dropped → skipping the rows is correct. Renamed → skipping silently
discards real data, orphans everything referencing it, and still reports success. So an
UNMAPPED missing table refuses the restore and names itself, rather than guessing.

`applyTableRenames(catalog, backup)` is what makes a mapping actually do something. It runs
ONCE, immediately after `readBackup` and before `assertBackupImportable`, in all four load
paths (restore, restore-revert, template-revert, import), rewriting the manifest table names
and the `data` keys. Everything downstream — the gate, the closure preflight,
`wipeAndLoad` — keys off table name, so normalising once is what keeps them from disagreeing;
before it existed the mapping reached only `reportBackupCompatibility`, so the pre-restore
screen said "restorable" and the gate then refused with
`table "X" no longer exists in the current schema`.

Two rules that make cycles safe. The map is consulted **only** for a name the live schema no
longer has, so after A→B→A the stale `A: "B"` entry is never read and cannot redirect rows
away from the table they belong to. And resolution is a **single hop**, never a chain — it
reads one entry and resolves it once against the catalog, so it cannot spin. Anything it
can't resolve confidently (unmapped, mapped at a name also missing, or mapped at a name this
same backup already carries) is left untouched for the gate to refuse.

## No nightly housekeeping — deliberately

A backup exists because a person took one, and stays until a person deletes it.
There is **no cron in this feature at all**. A `backupMaintenanceFunction`
(`0 3 * * *`) with three passes was built on this feature's branch and dropped
before merge — none of it ever shipped on `main`, so there is no code or
constant to find; this list exists so nobody rebuilds it:

- **Compatibility re-check** — recomputed a stored verdict nightly, alerted
  nobody, repaired nothing. The live loader computation replaced the whole idea
  of a stored verdict. Do not reintroduce a detector with no consumer that ACTS
  on a finding.
- **`expireBackups`** (delete past a retention window) — could not tell a backup
  a person deliberately took from one a cron took for them, so the one the
  customer chose was the one that disappeared. Deleting customer data on a timer
  nobody asked for.
- **`scheduleStaleExports`** (take one for any company whose newest was over a
  week old) — each run is a separate folder, so the person's own backup would
  sit buried among rows labelled `Scheduled` they never made, all paid storage.

The parent spec's D7 wanted scheduled creation; that is dropped, not deferred —
**not as a setting either**. See `.ai/specs/2026-08-25-backup-durability.md`.

Pre-restore and pre-template snapshots (`_pre-*`) were never touched by that job
and still are not: they are dropped by the keep/revert path in `company-restore.ts`
and `company-template.ts`. A stalled restore can still strand one — pre-existing,
and nothing here changed it.

## Restore — `company-restore.ts`

Three Inngest fns: `companyRestoreFunction`, `companyRestoreFinalizeFunction`,
`companyRestoreRevertFunction`. **Shared concurrency** key
`'company-restore-' + event.data.companyId`, scope `env`, limit `1` — one restore
per company at a time.

Forward flow:
1. `readBackup` from the per-company bucket — `manifest.json` first, then each
   `tables/<table>.ndjson.gz` through `deserializeTable` (streamed NDJSON gunzip,
   never a single `>512MB` string).
2. Compute `targetGroupId`, then `groupCompanyCount` (count of companies with that
   `companyGroupId`). `includeGroup = groupCompanyCount === 1`. A **foreign**
   backup (`manifest.sourceCompanyId !== companyId`) onto a shared group
   (`!includeGroup`) **throws** rather than rewrite the shared chart of accounts.
3. Auto-snapshot current state to `snapshotPath` (idempotent — reuses an existing
   one). This is what `revert` restores.
4. `wipeAndLoad` in ONE transaction with `session_replication_role = 'replica'`
   (relaxes FK checks during load):
   - `selectWipeableTables(catalog, { includeGroup })` → company-scoped tables
     minus kept/secret; group-scoped tables included **only** when `includeGroup`.
   - `wipeScopedData` deletes each table in reverse-topo order, **always** scoped
     `WHERE <scopeColumn> = <value>`; a null scope value is skipped (no unscoped
     DELETE is possible).
   - `buildRowTransforms` re-stamps `companyId`→target, `companyGroupId`→
     `targetGroupId`; on a foreign/remap load it mints new ids (text/uuid only) and
     remaps FKs, with a dangling-ref guard (nullable FK → null, non-nullable →
     throw).
   - Closure preflight (`assertReferentiallyClosed` → `findDanglingReferences`)
     runs before the wipe and refuses a backup whose NOT-NULL FK points at a row
     it doesn't include. It tracks a parent's ids for **any table with an `id`
     column**, not only `hasId` (sole-`id` PK) tables — the ~25 composite
     `("id","companyId")`-PK tables (`stockTransfer`, `supplierPart`, …) are
     referenced by their `id` too, and gating on `hasId` falsely flagged every
     child of them and refused otherwise-valid restores. It also skips
     `SECRET_TABLES` on both sides (a secret table is never written to a backup
     and never loaded) — an OLDER backup that predates a table joining
     `SECRET_TABLES` still carries its rows (e.g. `apiKeyRateLimit` → the stripped
     `apiKey`); they're ignored on load, so the preflight ignores them too.
5. `restoreAssetsFromBackup` (outside the txn, non-transactional) copies the files
   from the backup's `assets/` folder back to `private/<rewritten path>`,
   server-side. It runs **before** the `ready` marker (step below) so the progress
   dialog only reports "complete" once data AND files are in place — but it never
   throws (per-file warnings), so a storage hiccup still can't fail a committed
   restore. Every write is guarded to the target `{companyId}/` prefix.
6. State marker → `ready` (data committed + files copied).
7. `assertWipeSafe(catalog)` guards the invariant that a KEPT table has no NOT-NULL
   FK into a WIPED table.

State marker: a row on `externalIntegrationMapping`, `integration =
"company-restore"`, `metadata = { status: running|ready|failed|reverting,
snapshotPath, foreign, includeGroup }`. `revert` reads the marker and reloads
`snapshotPath` (using `metadata.includeGroup`). Status is polled by the UI.

**Second caller.** `wipeAndLoad`, `getCompanyGroupId` and `resolveRestoreScope`
(the extracted `targetGroupId` + `includeGroup` rule) are **exported** and are
also used by `company-template.ts`: applying a demo template from Settings
snapshots with `buildCompanyBackup`, and reverting it wipes-and-loads that
snapshot through exactly this path. See `onboarding-company-templates.md`.

### Known caveats in the committed code (not yet hardened)

- **Storage restore is best-effort** — copy failures `console.warn` only; the
  restore still reports success (data is the source of truth). The cross-tenant
  write guard (`targetPath.startsWith(\`${companyId}/\`)`) IS now in
  `restoreAssetsFromBackup`.
- **Asset copy duplicates bytes** — a self-contained backup copies the company's
  assets into its `assets/` folder, so each backup costs roughly its asset size in
  storage. Snapshots are transient (their `assets/` is removed on keep/revert);
  exports persist until deleted (`deleteCompanyBackupExport` removes the folder).
- Sequences: the only pg-native serials on backed-up tables are `entryNumber` on
  `itemLedger`/`costLedger`/`supplierLedger` (not PKs, not unique; PKs are all
  text). They are **global/shared across tenants** — never `setval` them scoped to
  one company; in-place restore needs no reset (other tenants hold the high-water
  mark).

## ERP layer

- `backups.service.ts` — per-company bucket ops: `exportCompanyBackup`,
  `listCompanyBackupFolders` (`from(companyId).list("exports")` folders, paged
  with a hard page cap; a folder is "ready" once `manifest.json` exists, else
  "pending"; returns each parsed `Manifest` for the server wrapper),
  `deleteCompanyBackup` (removes the whole `exports/<name>/` folder),
  `getCompanyRestoreRuns` (restore markers), `getCompanyExportRun` (the export
  marker: `status: "running" | "failed"`, `progress`, `startedAt`, `error`).
- `backups.server.ts` — server-only. `getCompanyBackups` is the loader's list:
  it reads the live catalog ONCE per load (`getCompanyTableCatalog` over
  `getDatabaseClient()`, via `@carbon/jobs/backups`), diffs every listed
  manifest with `reportBackupCompatibility`, attaches
  `{ status, findings }` to each row and strips the manifest. Plus the trigger
  wrappers (`startCompanyRestore`, `finalizeCompanyRestore`,
  `revertCompanyRestore`) and `dismissCompanyExportFailure` (service-role
  delete of the failed export marker) — kept off the client to avoid
  `Buffer`-in-client.
- `routes/x+/settings+/backups.tsx` — **access-gated** (`requireBackupAccess`)
  loader/action (export / restore / keep / dismiss / revert / delete /
  dismissExportFailure intents). `filePath` is forced under `exports/`. Export is
  **non-blocking, row-first** (Supabase-style): clicking "Create backup" does NOT
  open a modal — it drops a synthetic "Creating backup…" spinner row into the
  Backups list **immediately** (optimistic client state `runningExport`, set the
  instant the action returns `started: "export"`, before the job writes its first
  marker), and clicking that row opens the detail progress modal. `runningExport`
  is also **adopted from the marker** on mount for a run started elsewhere
  (reload / another tab); its `baseline` = ready backups when tracking began, and
  completion = a ready backup outside the baseline appearing in the revalidated
  list (page revalidates every 2.5s while the modal is closed). A "failed" marker
  renders a banner ("This backup could not be completed." + the job's own error)
  with a Dismiss button — the old copy blamed the product ("The system created an
  invalid backup — please contact Carbon support.") for what was usually a
  data-integrity finding the error string already named.
- `routes/api+/settings.backup-summary.ts` — lazy "what's in a backup" counts,
  grouped, per-entity `scope: company|group`.
- `routes/api+/settings.backup-restore-status.$restoreRunId.ts` — poll; `companyId`
  from `requirePermissions`, so a user can't poll another company's run.
- **One status vocabulary, four words** (`ui/Backups/format.ts`: `BackupStatus`,
  `backupStatusLabel` — a `msg`-descriptor map resolved with `t(...)` at the
  render site — and `backupStatusVariant`). No synonyms anywhere:

  | Status | Meaning | Restorable? |
  |---|---|---|
  | `Ready` | loads into today's schema unchanged | yes |
  | `Restorable with changes` | loads, but N things differ; disclosure required | yes, after confirming |
  | `Not restorable` | a hard refusal, with the reason | no |
  | `Incomplete` | no `manifest.json` — the export died partway | no |

  A failed EXPORT is not a row status — it renders as the failure banner from
  the export marker. `Incomplete` outranks the computed verdict (a half-written
  folder's incompleteness is the whole story) and is never rendered as
  "Preparing…" once no export is being tracked — that was the bug where a dead
  folder looked alive forever. A row shows its taken date, size, label and this
  badge, and deliberately **no expiry date**: a printed date reads as a promise
  the backup is good until then, which nothing can make. The badge answers the
  real question, for today — computed against the live schema on every load.
- UI: `modules/settings/ui/Backups/` — `BackupChoices` (Data only / Data + files),
  `BackupSourcePicker`, `BackupProgressModal`, `RestoreReviewRow` (Keep/Revert),
  `RestoreDisclosure` (the pre-restore screen — the ONLY path to a restore now),
  `BackupContentsInfo` (lazy popover), `format.ts`. `JobProgressModal` tracks real
  completion, not a timer: restore/revert poll the status marker; **export** has no
  marker, so the route component revalidates the list and passes `completed` once
  the new backup actually appears (`exportBaseline` diff) — the dialog never claims
  success before the artifact exists.

### `RestoreDisclosure` — five states, one base sentence

The pre-restore screen. It renders the verdict the loader computed against the
LIVE schema (`getCompanyBackups`), so it can never disagree with the badge on
the list. It is DISCLOSURE, not authorization: `assertBackupImportable` runs
the same diff again inside the restore, so this screen can never let through a
restore the gate would refuse.

Every state opens with the same two sentences — *This company's data is replaced with the
contents of this backup. Today's data is saved first, so you can revert.* Keep and Revert are
NOT explained here; they are explained on `RestoreReviewRow`, where they are the actual
decision. The four-line version that spelled out delete / snapshot / Revert / Keep upfront
read as a warning label and was cut.

| State | Added copy | Confirm |
|---|---|---|
| clean | none | button, no typing |
| unchecked (an upload-sourced restore — every LISTED backup has a live verdict) | "This backup hasn't been checked yet…" | button, no typing |
| defaults only | `Filled with a default` group | button, no typing |
| discards | `Discarded` group + "Some records won't come back. Type restore to continue." | typed `restore` |
| blocked | `Can't be restored` group | **no button at all** |

Findings group by `tableArea` (`backups.areas.ts`) — "Production" means something
to the person deciding, `jobOperationDependency` does not. Areas are stable keys
resolved to copy via `areaLabel` (`msg` descriptors); table names live in a
`Details` expander. There is no "Checked <date>" line — the verdict is live.

The state decision lives in `disclosure-state.ts` (`disclosureState(backup, typed)` →
`{ unchecked, blocked, discards, canConfirm }`), NOT in the component, and is unit-tested in
`disclosure-state.test.ts`. That split exists because the states worth seeing are the ones
nobody can produce by hand; the app has no browser-rendering test setup, so the branching is
what gets pinned.

There is one state with **no purpose-written copy**: a backup that is not referentially
closed. `assertReferentiallyClosed` throws inside the restore job with
`This backup can't be restored: the backup is not self-contained — …`, which surfaces after
the user clicks Restore, not on this screen — the verdict compares table and column
NAMES, and this is a row-level fact it cannot see. The refusal happens before the wipe, so
nothing is lost. Known gap.

## Onboarding seed

`routes/onboarding+/industry.tsx` → `dataChoice: "template" | "import" | "none"`
("Use a demo template" / "Restore from a backup" / "I don't need data"). The whole
step is internal-only (`isInternalEmail`); public signups create their company in the
company step.

**`template` is NOT a backup import.** It runs the dev seed's own tier code against the
new company, so the demo data has exactly one definition:
`packages/database/src/datasets/` — `tiers/` holds the insertion logic, `data/<key>/`
holds one industry story each (four today: `satellite`, `robotics`, `precision`, `motor`),
and `applyDataset()` in `datasets/index.ts` is the shared entry point.
`pnpm db:seed:dev --dataset <key>`, onboarding, and Settings → Demo Data are callers of
that one function.

Flow: `provisionOnboardingCompany` (onboarding.server.ts) does a **full** clean
`seedCompany` (the tiers' pre-flight needs a chart of accounts, a `location`, and
`unitOfMeasure` code `EA`), creates the headquarters location and employee job, and
**then** — deliberately last, because the pre-flight needs that location — triggers
`carbon/company-template`. `packages/jobs/src/inngest/functions/tasks/company-template.ts`
handles it: one `step.run`, concurrency 1 per company, a `getPostgresConnectionPool(2)`
client (size 1 is the shared pool the event drainer uses), a refuse-if-`item`-rows-exist
double-apply guard, and a marker on `externalIntegrationMapping`
(`integration = "company-template"`) cleared on success and set `failed` on a throw.
`applyDataset` wraps every tier in one transaction, so a failure leaves zero rows.

`industry.id` → dataset is a code map (`datasetForIndustry`), not a column. All four
industries have a dataset today; an industry without one is hidden from the onboarding
picker rather than provisioning a clean company.

**Dormant** (built, never wired, do not revive without revisiting
`.ai/specs/implemented/2026-08-13-onboarding-company-templates.md`): the
`company-templates` bucket, `TEMPLATE_BUCKET` / `TEMPLATE_ASSET_PREFIX`,
`templateIndustryId` on `carbon/company-import`, `ci/src/upload-backup-templates.ts`, and
`packages/database/supabase/backups/` (which now holds only a README saying so).

## CI publish (dormant)

`ci/src/upload-backup-templates.ts` is part of the dormant set above and publishes
nothing today — onboarding templates never go through a storage bucket. It is described
here only so the next reader knows what the script and the `Publish backup templates`
workflow (`.github/workflows/publish-templates.yml`, `workflow_dispatch`) were for:
a manual, idempotent upload of committed `.gz` archives and their sibling
`<industryId>.assets/` folders into each workspace's `company-templates` bucket.
