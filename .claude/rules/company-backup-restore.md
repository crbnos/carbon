---
paths:
  - "packages/jobs/src/backups/**"
  - "packages/jobs/src/inngest/functions/tasks/company-export.ts"
  - "packages/jobs/src/inngest/functions/tasks/company-import.ts"
  - "packages/jobs/src/inngest/functions/tasks/company-restore.ts"
  - "packages/jobs/src/inngest/functions/tasks/company-template.ts"
  - "packages/jobs/src/inngest/functions/scheduled/purge-company.ts"
  - "packages/jobs/src/scripts/check-backups.ts"
  - "packages/jobs/src/scripts/backup-baseline.ts"
  - "packages/jobs/manifests/**"
  - "packages/ee/src/backups.server.ts"
  - "apps/erp/app/modules/settings/settings.service.ts"
  - "apps/erp/app/modules/settings/types.ts"
  - "apps/erp/app/modules/settings/backups.areas.ts"
  - "apps/erp/app/modules/settings/ui/Backups/**"
  - "apps/erp/app/modules/settings/ui/DemoData/**"
  - "apps/erp/app/routes/x+/settings+/backups.tsx"
  - "apps/erp/app/routes/x+/settings+/demo-data.tsx"
  - "apps/erp/app/routes/api+/settings.backup-*.ts"
  - "apps/erp/app/services/onboarding.server.ts"
---

# Company Backup / Restore / Onboarding Seed

Per-company logical backup, in-place restore (with revert), demo templates and
onboarding from a backup. **Inngest tasks, NOT edge functions** — the old
`import-company` / `finalize-import` / `revert-import` edge functions and the
`company-revert` / `publish-demo` / `refresh-demo-catalog` jobs were deleted; this
is the replacement. Reader-facing docs: `docs/content/docs/platform/backups.mdx`
(kept deliberately impl-free — keep internals here, not there). The refactor that
gave the code its current layout: `.ai/plans/2026-11-10-backups-untangle.md`.

User-facing rules: backups require `settings` update permission (no owner gate),
exclude secrets, and a restore is reversible via an auto-snapshot.

## Gates

**Backups are a Business/Enterprise feature** (`BACKUPS` in `FEATURE_PLANS`), with
an internal-staff / local-dev escape hatch. Every backup route —
`x+/settings+/backups.tsx` and every `api+/settings.backup-*` (archive, export-status,
restore-status, summary, upload) — takes `requireBackupAccess(request)`
(`settings.service.ts`): `requirePermissions({ update: "settings" })`, then
`canManageBackups(client, companyId, email)` = `IS_LOCAL_DEV || isInternalEmail(email)
|| companyHasFeature(BACKUPS)`; deny is a 404. View permission is not enough: a backup
holds the whole company. The nav (`useSettingsSubmodules.tsx`) mirrors it with
`usePlanGate({ feature: "BACKUPS" })` OR `isInternal` / `isLocalDev`. Internal =
`@carbon.ms` / `@carbon.us.org`.

**Demo Data** (`x+/settings+/demo-data.tsx`) takes only `update: settings`, and the
nav shows it to every employee. Templating is free on every edition.

`requireBackupAccess` is the route-level UX gate (a deletable open-code `if`). The
un-strippable commercial LOCK is `requireBackupsEntitlement(companyId)`
(`@carbon/ee/backups.server`). `IS_LOCAL_DEV`-exempt, otherwise
`requireEntitlement("BACKUPS")` — Community/Starter throw. Called by:
- `companyExportFunction` and `companyRestoreFunction` — inside the step, after the
  `running` marker, so a refusal shows as a failed run.
- `companyImportFunction` — before the step (it has no marker).

NOT called by restore finalize/revert (they only resolve a started restore; gating
them would strand a pending restore if entitlement lapsed) or by any
`company-template` function. Do NOT push the check into `writeCompanyBackup` /
`wipeAndLoad` / `revertRun` — the template uses them, and that breaks free templating.
Known gap (auth, left as is): internal staff pass the ERP gate via `isInternalEmail`,
but the job lock only exempts local dev, so a staff-started export or restore on a
company without BACKUPS fails as a run.

The multi-tenant caveats below are real but are NOT a cross-tenant leak in the backup
feature — every entry point is scoped to the caller's `companyId`. They were the reason
this stayed internal-only, and exposing it to customers is a deliberate product decision:
(1) restore is a full in-company wipe-and-reload (large destructive surface, snapshot-
reversible); (2) the export HARD-REFUSES when a company's live data already holds
cross-tenant references left by an upstream bug (tables like `jobOperationDependency`
still lacking `companyId` in their PK — see `.ai/specs/2026-08-25-backup-durability.md`),
offering a destructive "remove corrupted data" path. Closing that upstream schema hole
is the remaining hardening.

## Engine — `packages/jobs/src/backups/`

Everything reusable lives here; the task files are thin Inngest functions over it,
and nothing here imports a task file. App code imports the public surface,
`@carbon/jobs/backups` (`index.ts`). Modules:

| File | Holds |
|---|---|
| `catalog.ts` | `getCompanyTableCatalog`, `TableInfo`, `selectExportableTables`, `exportableColumns` |
| `policy.ts` | every per-table decision: secret / structural / transient / singleton lists, `KEPT_TABLES` + `isLeftAlone`, `isUserScopedIdentityTable`, `READABLE_ID_TABLES`, `selectWipeableTables`, `assertWipeSafe` |
| `compatibility.ts` | `reportBackupCompatibility`, `compatibilityStatus`, the throwing gate `assertBackupImportable` |
| `format.ts` | pure: `Manifest`, `BACKUP_VERSION`, folder paths, `newBackupName`, `snapshotName` / `isSnapshotName`, `CompanyBackup` (`manifest` + `rows(table)`), `tableWriter` / `readTableRows` (batched gzip NDJSON), `tableRows`, `backupFromRows`, value encode/bind |
| `storage.ts` | all bucket I/O: `readBackup`, `listBackups`, `writeBackupTable` / `writeBackupManifest`, asset copies, `removeBucketPrefix`, `listBucketFilesRecursive` |
| `dump.ts` | `writeCompanyBackup` — the export and both snapshots |
| `load.ts` | `readBackupForLoad`, `wipeScopedData`, `insertTables`, `bulkLoad`, `wipeAndLoad`, `resolveRestoreScope`, `canSetReplicationRole` |
| `remap.ts` | `buildIdMaps`, `buildRowTransforms`, closure preflight, `rewriteStoragePath` |
| `reseed.ts` | the import's additive-load helpers |
| `scope.ts` | scope filter, violations, exclusions, purge, dangling-row cleanup |
| `derived-groups.ts`, `renames.ts`, `id-refs.ts` | see below |
| `runs.ts` | the run lifecycle — markers, progress, failure, snapshot, keep/revert, `PER_COMPANY_CONCURRENCY` |

Storage I/O resolves the bucket with `getCompanyPrivateBucket(companyId)`.

- `getCompanyTableCatalog(db)` reads `information_schema` (`table_schema = 'public'`)
  for every BASE TABLE carrying a `companyId` or `companyGroupId` column, builds
  `TableInfo` (columns, FK edges, `scopeColumn`, `hasId`/id type), and topologically
  sorts (referenced-first). **`companyId` wins** when a table has both columns. It is
  **schema-introspected**, not a hand-maintained list.
- `scopeColumn: "companyId" | "companyGroupId"`. `companyId` = the company's own
  data; `companyGroupId` = config shared across a company group (chart of
  accounts, currencies, dimensions).
- `SECRET_TABLES` never travel, and a restore never wipes them: `apiKey`,
  `apiKeyRateLimit`, `tableChange`, `companyIntegration`, `integrationConnection`,
  `employeePin`, `webhook`, `oauthClient`, `oauthCode`, `oauthToken`,
  `ssoConnection`, `ssoDomain`, `pushSubscription`. The `policy.ts` comment gives the
  reason for each — e.g. `apiKeyRateLimit` dangles without the stripped `apiKey`;
  `employeePin` hashes are a credential; SSO `providerId` / `domain` are unique across
  ALL companies, so a copy collided; `integrationConnection`'s token is in the vault,
  so a restored row reads Active with no token behind it.
- `STRUCTURAL_TABLES` (`company`) and `TRANSIENT_TABLES` (`demandForecastSource`,
  `demandActual`, `supplyForecast`, `supplyActual` — MRP output regenerated every run)
  union into `CATALOG_EXCLUDED_TABLES`: never exported, wiped or loaded, and the
  next MRP run rebuilds them. `demandForecastSource`'s discriminator CHECK
  (`sourceType` ↔ which of `jobId`/`salesOrderLineId`/`demandProjectionId` is
  non-null) made a remapped restore crash — the FK-nulling dangling-ref policy in
  `buildRowTransforms` nulls a set FK and violates the CHECK. `demandForecast` is
  kept: it has a user-forecast write path and no such CHECK. `planningAction` is kept
  too (`Dismissed` / `assigneeOverridden` are the planner's own state) despite a
  comparable CHECK (`planningAction_change_target_chk`): its target FKs are nullable
  with ON DELETE CASCADE, so a consistent snapshot never dangles one. The dataset
  wipe (`wipe.ts` `TRANSIENT_MRP_TABLES`) deletes it — a different path.
  `assertBackupImportable` also skips the excluded set — an OLDER backup that still
  carries one is not schema drift, its rows are just ignored.
- `KEPT_TABLES` (`userToCompany`, `employee`, `employeeType`,
  `employeeTypePermission`, `invite`, `externalIntegrationMapping`) is ONE list for
  both loads: a restore never wipes them (or the user is locked out) and the import
  never writes them (a copy's memberships and integration state belong to the source
  company's users). `isLeftAlone(name)` = secret or kept. It replaced the two lists
  `RESEED_SKIPPED_TABLES` / `IN_PLACE_SKIPPED_TABLES`.
- User-scoped identity tables (`isUserScopedIdentityTable`: a `user`/`employee` FK
  column in a unique index — favourites, preferences, accounts, `productionEvent`)
  are wiped by every restore. An own restore and a revert reload them from the
  backup, whose users are this company's; a foreign restore and the import skip
  them, since every source user collapses onto the importing one and the rows would
  collide. The tenant half of a composite FK (`(employeeId, companyId) -> employee`)
  doesn't count: it once marked `payment` and `reimbursement` as identity, and a
  foreign restore dropped them. After an own load, `deleteDanglingRows` removes kept
  identity rows whose parent the wipe removed (replica mode skipped the cascade).
- Format: a backup is a **FOLDER** — `exports/<name>/` holding `manifest.json`, one
  `tables/<table>.ndjson.gz` per NON-EMPTY table, and `assets/<path>` files. Paths
  come from `backupDir` / `backupManifestPath` / `backupTablePath` / `backupAssetsDir`;
  each table is written and read a line at a time, so a huge table never
  materializes as one `>512MB` string (V8's max). Tables are dumped and read in
  parallel (`async.map` from `@carbon/utils`, `TABLE_CONCURRENCY = 6` in
  `concurrency.ts`). The folder bundles into one `.carbon.tar.gz` only for
  cross-environment download and upload. There is **no single-file format** — the
  retired one-file `{ manifest, data }` JSON broke at ~512MB of row data, and its
  last bridges were removed.
- Names: `newBackupName(takenAt, label)` = timestamp + label slug. Snapshots are
  `snapshotName(run, runId)` = `_pre-restore-<id>` / `_pre-template-<id>`, same
  layout; `isSnapshotName` (`_pre-` prefix) keeps them out of `listBackups` and out
  of every user action (restore, delete, archive — `isUserBackupName` in the ERP).
- `manifest.json` is written **LAST** (`writeCompanyBackup` → `writeBackupManifest`),
  after every table file and asset. Its presence IS the "backup is complete" marker:
  `listBackups` returns `manifest: null` for a manifest-less folder (listed as
  `Incomplete`), and `readBackup` refuses one. A manifest download error other than
  not-found throws, so a good backup never lists as unfinished.
- Versioning: `BACKUP_VERSION` (currently **1**, single format, no legacy branch);
  `assertBackupImportable` rejects a backup whose version no longer matches or that
  lacks a now-required column.
- Id minting: `newIdForTable(table)` → `randomUUID()` for uuid id columns, else
  the schema default's shape: `item_<22 base58>` for a column defaulting to
  `id('item')` (`ColumnInfo.idPrefix`, read from `column_default` by the catalog). `buildIdMaps` (`remap.ts`) decides WHICH rows get one, and both the
  foreign restore and the import call it so they can't drift. It is **gated on
  having a text/uuid `id` COLUMN**, not on `hasId` (PK exactly `id`) — the ~25
  composite-PK tables are referenced by their `id` too, and five of them back that
  with a global `UNIQUE (id)`: `changeOrderRequiredAction`, `balloon`,
  `inspectionDocument`, `inspectionFeature` (all PK `("id","companyId")`) and
  `demandProjection` (PK `("itemId","locationId","periodId")`). Leaving their source
  ids in place made a cross-company restore collide with the SOURCE company's live
  rows and roll back. `READABLE_ID_TABLES` (`part`, `material`, `consumable`,
  `service`, `tool`, `fixture`) are excluded BY NAME: their `id` is a human-authored
  part number matched by VALUE against `item."readableId"`; minting a fresh one
  orphans every row from its item and list views render empty against a full table.
  They carry no global `UNIQUE (id)`, so keeping their ids cannot collide; the two
  sets are disjoint and `remap.test.ts` pins it. Serial/int ids are left alone. A
  1:1 extension table whose `id` is itself an FK (`purchaseOrderDelivery.id ->
  purchaseOrder.id`) SHARES its parent's map rather than minting a second id, which
  would split the pair — and under `session_replication_role='replica'` the break
  would commit. `wipeAndLoad` and the import fold the maps into one `idRewrite`.
- Derived groups (`derived-groups.ts`): the database makes a `group` per employee
  type, customer type, supplier type, customer and supplier (its id IS that row's id)
  plus the company-wide groups (`groups` / `getGroupId` in
  `@carbon/database/seed-data`), and their memberships, in interceptors a replica-mode
  load never fires. On a remap `buildIdMaps` gives such a group the new id of the row
  it mirrors, of the same-named kept employee type, or of the target company, so
  approver and notification groups naming it stay connected. `insertTables` adds
  `ON CONFLICT ("id") DO NOTHING` to `group` (`groupConflictClause`): without replica
  mode the interceptor has already made the group. `bulkLoad` then runs
  `rebuildDerivedGroups` in the same transaction: removes derived groups whose row
  isn't there, recreates missing groups and memberships, and removes memberships
  still pointing at a group the load removed (`membership` survives an own restore).
  Its SQL restates the `sync_create_*_group` / `sync_add_*_to_group` interceptors; a
  change to those must change it too. Tested in
  `apps/erp/test/database/rebuild-derived-groups.test.ts`.
- Storage path rewriting: `rewriteStoragePath` (`remap.ts`; swap `{sourceCompanyId}/`
  → `{targetCompanyId}/` + remapped id segments). It applies to ANY text or text[]
  value under `{sourceCompanyId}/`, whatever the column is called — about 30 columns
  hold paths (`document.path`, `supplier.logo`, the slide images, signatures,
  certificates, `supplierQuote.sharedFilePaths`, the `modelUpload` artifacts). A name
  list missed most of them and left a cross-company restore pointing at the SOURCE
  company. The files are copied with the same rewrite (`assetTargets`), so a path
  and its file stay together.
- File copies overwrite in place (`x-upsert` on `copy`), never remove-then-copy:
  deleting a storage object fires `delete_orphaned_documents`, which drops the
  `document` row for that path — the row a restore just loaded.
- FK-less id refs: `ID_REF_COLUMNS` (`id-refs.ts`, per table) lists TEXT/TEXT[]
  columns that hold a tenant row's id with no FK — generic refs like
  `inspection.sourceDocumentId`/`sourceDocumentLineId` (receipt line OR job
  operation), `itemLedger.documentId`, `...Ids` arrays. `buildRowTransforms` rewrites
  them through `idRewrite` on a remap load (element-wise for arrays, lookup-only so
  non-id values pass through; an FK column is never treated this way). Columns that
  only ever hold a row id (`ROW_ID_REF_COLUMNS`: `inspection.sourceDocumentLineId`)
  are nulled instead when unmapped, like a nullable FK: the row is not in the backup
  (an inspection whose job operation was deleted), and its source id would collide
  on the unique index below. Unlisted, a cross-company restore keeps the SOURCE ids:
  the `inspection_sourceDocumentLineId_key` unique index (cross-company, on
  `("sourceDocument","sourceDocumentLineId")`) then collides with the source
  company's live rows and rolls the restore back. A migration adding such a column
  must list it (`workflow-database-migration.md` step 3c). The maps are typed against
  the generated row types (`satisfies`), so a renamed/dropped column fails typecheck.
  Neither `db:check:backups` nor any other check detects an UNLISTED new column yet.
- Asset transport (`storage.ts`): `copyAssetsToBackup` (server-side `storage.copy` of
  the bucket's `{companyId}/…` files into the backup's `assets/`) and
  `restoreAssetsFromBackup` (copy them back, rewriting paths, every write guarded to
  the target `{companyId}/` prefix). **No asset bytes pass through the job process**,
  so memory stays flat regardless of asset size. `removeBucketPrefix` is the one
  prefix delete (batches of 200; `strict` throws on a list/remove error), used by the
  ERP's backup delete (strict), keep/revert (the snapshot) and the company purge.
  `listBucketFilesRecursive` pages past storage's 1000 entries per `list` call: a
  larger folder was cut short and the backup left files out. The archive download
  lists strictly and fails when a file can't be read, rather than shipping an archive
  that imports as complete.

Buckets: the **per-company private bucket** (`getCompanyPrivateBucket(companyId)`)
holds the uploads under `{companyId}/`, every backup folder (`exports/<name>/`, assets
at `assets/{companyId}/…`) and the snapshots. The `company-templates` bucket
(migration `20260617100002`) is dormant: no backup code reads it.

## Runs — `runs.ts`

One lifecycle for every long backup job:
- **Marker store** `runMarker`: one `externalIntegrationMapping` row per run,
  `integration` = `company-restore` / `company-template` / `company-export`, keyed by
  `entityId` — the run id for a restore (several can wait on keep/revert), the
  company id for the one-per-company template and export. `externalId` = the entity
  id (it was `""`, so a second restore marker collided with a failed one on the
  partial unique index). Reads and writes THROW: a marker read as absent or silently
  not written makes a retry snapshot over the real copy, or the page wait forever.
- **Typed metadata**, exported for the ERP: `RunStatus` (`running | ready | failed |
  reverting`), `JobProgress` (`phase` is a stable key the page maps to a label),
  `RestoreRunMeta` / `TemplateRunMeta` / `ExportRunMeta`.
- `progressWriter`: throttled (250ms, a phase change or `done === total` always goes
  out), never throws, writes over its own connection so it is safe inside a load
  transaction.
- `failRun`: writes `{ status: "failed", error }` and returns what to throw. An
  `ExportScopeViolationError` becomes `reason: "scope-violations"` plus a
  **`NonRetriableError`** (see Export). A failed marker write never hides the error.
- `takeSnapshot`: `writeCompanyBackup` to `_pre-<run>-<runId>` with
  `includeStorage: "all"` (snapshots carry their files), then records
  `snapshotPath`. A recorded snapshot is reused, never retaken: a retry after the load
  committed would capture the loaded data over the company's real copy.
- **`applied`**: `RunMarker.markApplied` is an UPDATE run INSIDE the load's own
  transaction (`wipeAndLoad({ markApplied })`, `applyDataset({ beforeCommit })`), so
  the flag commits with the data or not at all. A `failed` run with `applied` still
  holds the only way back: the review rows offer Keep / Revert, never Dismiss.
- `holdsPendingChange` = not `failed`, or `failed` and `applied`. Only one restore or
  demo-data run may hold it per company: `assertNoPendingChange` in both jobs (race-free
  under `PER_COMPANY_CONCURRENCY`), `getPendingChange` in both ERP routes.
- `failStuckRun`: the `onFailure` of export, restore, template and both reverts. A
  timeout or out-of-memory kill skips the job's own catch; this marks a still
  `running` / `reverting` run failed, so it doesn't lock the company out.
- `keepRun`: only `ready` or `failed` (an in-flight run is refused); deletes the
  snapshot folder, then the marker.
- `revertRun`: reads the snapshot through `readBackupForLoad`, `wipeAndLoad` with
  `remap: false` and the marker's `includeGroup`, restores its files, deletes the
  snapshot and the marker. No recorded snapshot → marks the run failed (not a quiet
  no-op that keeps offering Revert). A run that covered group data is refused
  (marked failed, snapshot kept) once another company has joined the group: its
  rows point at that shared data. On failure the marker keeps the snapshot so the
  revert can be retried.
- `PER_COMPANY_CONCURRENCY` (`'company-data-' + companyId`, scope `env`, limit 1) is
  taken by every export, restore, template and import function (and their
  finalize/revert). Three different keys used to let a template wipe under a
  restore, or an export dump a half-loaded company.

## Export — `company-export.ts` → `writeCompanyBackup` (`dump.ts`)

Dumps each exportable table (secrets out), scoped by `buildScopeFilter`, into its own
**data-only** `tables/<table>.ndjson.gz`. **Empty tables are skipped** — a backup of a
company with no GL postings simply has no `journalLine`/`costLedger` file; that is
data-absence, not a coverage gap. With `includeStorage: "all"` it lists the bucket
under `{companyId}/`, records each file in `manifest.storage`, and copies the included
ones server-side into `assets/`. Then the manifest.
- **Out-of-scope rows are FATAL, deliberately.** `findExportScopeViolations`
  (`scope.ts`) counts rows whose NOT-NULL FK points outside the company's scope, and
  a non-zero count throws `ExportScopeViolationError` before any table file is
  written, listing every offending edge. Snapshots run the same guard.

  **This refusal is a tenant-leak detector, not a backup bug.** RLS hides another
  tenant's rows from every ordinary read; an export runs without RLS, so it is the
  first thing in the system with a wide enough view to see a cross-tenant reference
  at all. An implementation that excluded those rows and finished the backup was
  built and REVERTED on 2026-08-26 for exactly that reason — it made the only
  detector we have go quiet, in exchange for a nicer error on a company whose data
  was already wrong.

  The ONE sanctioned bypass (spec `.ai/specs/2026-09-01-skip-corrupted-rows-in-backups.md`):
  after a VISIBLE failure the user may click **Skip corrupted rows and retry**
  (`exportSkipCorrupted` intent), which re-runs the export with `skipCorrupted: true`
  — `computeScopeExclusions` excludes the violating rows *and their dependents*,
  the job logs a `warn` with the list, and `manifest.excludedRows` records it (the
  Backups row shows `N rows excluded`). A restore or template blocked by the same
  rows (their snapshot runs the guard) offers **Remove corrupted data and restore**
  / **…and apply** (`purgeAndRestore` / `purgeAndApply` intents): `purgeAndRetry` →
  `purgeCorruptedRows` → `purgeScopeViolations` deletes them in one transaction
  (children first) behind a destructive confirm, then restarts the run.
  The UI offers the recovery ONLY for `reason: "scope-violations"`. Never make either
  the default, and never skip silently.

  Why `NonRetriableError`: the guard's verdict is deterministic, so Inngest's
  `retries: 1` would only flip the marker back to `running` and fail again ~10s later
  — resurrecting the failure banner under a user who has already clicked Skip. Counts
  are reported from `rowsByTable` / `violationRowsByTable` /
  `manifest.excludedRowsByTable` (DISTINCT rows per table), never by summing
  `violations` / `excludedRows`: those carry one entry per FK EDGE, so a row escaping
  scope through three of its foreign keys would be counted three times — which once
  put "10 rows" on the confirm button of a delete that removed 4.

  The other hard export failure is a company with no `companyGroupId`.
- **No compatibility verdict is stored with the backup.** An export-time
  `compatibility.json` diffed the manifest against the catalog it was just projected
  from, so it always said `ready`. The verdict is computed LIVE in the loader.
- **Marker**: one per company. `{ status: "running", startedAt, progress }`,
  **cleared on success** (the new backup appearing in the list is the completion
  signal), and **left `failed` on error** — a cleared marker made a broken export
  indistinguishable from one that never ran. Dismissed via the `dismissExportFailure`
  intent → `dismissCompanyExportFailure` (service role — the table has no DELETE
  policy); the next export's first write overwrites it back to `running`.
- **Asset cap** (`dump.ts`): no per-file cap (the bucket already bounds uploads —
  120MB CAD, 50MB docs; the dev global is `50MiB` in `config.toml`), only
  `MAX_STORAGE_TOTAL_BYTES = 1GiB` on the whole backup. Files are included greedily
  until the budget is hit; each is recorded with `included: true|false`. The cap is
  storage-cost only (the copy is memory-flat) — each backup duplicates the bundled
  bytes. The old `25MiB`-per-file / `200MiB`-total caps silently dropped legit media.

## The drift check — `pnpm db:check:backups`

A migration can make a backup a customer already holds unrestorable **without the
backup changing at all**: add a NOT NULL column with no DEFAULT and every backup
taken before today stops loading. This is the ONLY thing in the system that
prevents that, and prevention at commit time is the only place it can be done —
once the migration is in production the backup is already dead, and every
downstream mechanism can do no more than say so.

That is why there is **no stored verdict and no re-check job**: the Backups
loader computes `reportBackupCompatibility` against the LIVE schema on every
load (`getCompanyBackups` in `settings.service.ts`), so the badge cannot go
stale, and the hard refusal is `assertBackupImportable`, which runs against
the live schema inside the restore and import jobs. (Two earlier designs died here:
a nightly re-check, and an export-time `compatibility.json` — see Export and
"No nightly housekeeping".)

`packages/jobs/src/scripts/check-backups.ts` runs under bare `tsx`, so the engine
modules it loads (`catalog`, `compatibility`, `format`, `policy`, `renames`) must not
runtime-import a CJS `@carbon/*` package (type-only imports are fine). It compares
ONE committed **schema
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
regenerates itself cannot be its own baseline. `resolveBaseline`
(`scripts/backup-baseline.ts`) fetches
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

It runs from `scripts/git-hooks/pre-commit` when a staged file is under
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

Do NOT close these by teaching the baseline format about types and constraints. The
copy on `main` would lack the new fields until it is next regenerated, so the check
would be blind for exactly the window it exists to cover, and a richer manifest still could not
answer the data questions that make `SET NOT NULL` and type changes dangerous. The
honest reading is that this pair catches the whole class of *structural* breakage —
a table or column the backup has nothing to say about — and that the *value*-shaped
breakage is what `RestoreDisclosure` and the snapshot-and-revert path exist for.

### Renamed and dropped tables — `renames.ts`

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
ONCE, inside `readBackupForLoad` — the one read for every load (restore, both reverts via
`revertRun`, import) — rewriting the manifest table names and the `data` keys. The gate
(`assertBackupImportable`) runs after it on restore and import only: a revert loads the
company's own snapshot. Everything downstream — the gate, the closure preflight,
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
and still are not: `keepRun` / `revertRun` (`runs.ts`) drop them. A stalled run can
still strand one — pre-existing, and nothing here changed it.

## Restore — `company-restore.ts`

Three Inngest fns over `runs.ts`: `companyRestoreFunction`,
`companyRestoreFinalizeFunction` (`keepRun`), `companyRestoreRevertFunction`
(`revertRun`). All take `PER_COMPANY_CONCURRENCY`. The marker is keyed by
`restoreRunId`; a retry that finds it `ready` returns without wiping again.

Forward flow, inside one `step.run`:
1. Marker → `running` (with `filePath`, `label`, `includeStorage`, so a recovery can
   restart the same restore), then `requireBackupsEntitlement`.
2. `readBackupForLoad` (`readBackup` + `applyTableRenames`): `manifest.json` only.
   Each `tables/<table>.ndjson.gz` is downloaded as a stream when a caller iterates
   `backup.rows(table)`, and again on the next call. Then `assertBackupImportable`
   against the live catalog (manifest only).
3. `resolveRestoreScope` → `targetGroupId`, and `includeGroup` = this company is its
   group's sole member. A **foreign** backup (`manifest.sourceCompanyId !==
   companyId`) onto a shared group (`!includeGroup`) **throws** rather than rewrite
   the shared chart of accounts.
4. Closure preflight, BEFORE the snapshot and the wipe: `loadSubstrateIds` probes the
   target for global (`companyId IS NULL`) rows the backup omits, then
   `assertReferentiallyClosed` → `findDanglingReferences` refuses a backup whose
   NOT-NULL FK points at a row it doesn't include, listing every gap. It tracks a
   parent's ids for **any table with an `id` column**, not only `hasId` — gating on
   `hasId` falsely flagged every child of the ~25 composite `("id","companyId")`-PK
   tables (`stockTransfer`, `supplierPart`, …). It skips `SECRET_TABLES` on both
   sides: an OLDER backup that predates a table joining the list still carries its
   rows (e.g. `apiKeyRateLimit` → the stripped `apiKey`); they're ignored on load,
   so the preflight ignores them too.
5. `takeSnapshot` (records `foreign`, `includeGroup`, `snapshotPath`).
6. `wipeAndLoad` (`load.ts`), one transaction via `bulkLoad`:
   - `assertWipeSafe(catalog)` first: a KEPT table must hold no NOT-NULL FK into a
     WIPED table.
   - `selectWipeableTables(catalog, { includeGroup })` → company-scoped tables minus
     `isLeftAlone`; group-scoped tables **only** when `includeGroup`. The full set is
     wiped (a table empty in the backup ends up empty); only tables with rows load.
   - `wipeScopedData` deletes in reverse-topo order, **always** scoped by
     `buildScopeFilter`; a null group id matches nothing (no unscoped DELETE is
     possible).
   - `insertTables`: verbatim on an own restore; on a foreign one `buildRowTransforms`
     re-stamps `companyId` / `companyGroupId`, mints ids, remaps FKs (nullable
     dangling FK → null, non-nullable → throw), and keeps the first of the rows a
     user collapse made identical on a user-keyed table.
   - `assertLoadedInScope` (restore, revert and import): a backup is a file the user
     can edit, so verbatim rows may name another company. It counts the rows THIS
     transaction wrote (`xmin = pg_current_xact_id()::xid`) outside `buildScopeFilter`
     and throws on any, rolling the load back. Covers `via` tables too (a child hung
     off another company's parent).
   - `bulkLoad` (every load uses it) sets `session_replication_role = 'replica'`
     where `canSetReplicationRole` allows (else warns, relying on topological order),
     then, in the transaction, rebuilds derived groups, writes a null-row-id
     `tableChange` per `CHANGE_LOGGED_TABLES` entry and `realtime.send`s per
     `REALTIME_TABLES` entry — without it, open tabs kept stale picker rows for an hour.
7. `restoreAssetsFromBackup` (outside the transaction) when `includeStorage = "all"`.
   It runs **before** `ready` so the dialog reports complete only once data AND files
   are in place. The company's files are listed BEFORE the load; after the commit
   the whole file phase (recording `addedFiles`, the copy) is in a try/catch that
   logs, so a storage error can't fail a committed restore.
   `assetTargets` drops any manifest path that is unsafe (`isUnsafeStoragePath`) or
   lands outside `{companyId}/`: never written, never in `addedFiles`.
8. Marker → `ready` (`rows`), parked on keep or revert. Any throw → `failRun`.

Keep and revert need no entitlement. Keep refuses an in-flight run; revert with no
snapshot marks the run failed.

**Other callers of the load path.** `company-template.ts` snapshots and reverts
through `runs.ts` (`takeSnapshot` / `keepRun` / `revertRun`), so a template revert is
exactly a restore revert. Company deletion: `purgeCompany`
(`scheduled/purge-company.ts`, run by the weekly `company-cleanup`) calls
`wipeScopedData` over the WHOLE catalog in replica mode, secret and identity tables
included, because nothing is reloaded after it. It then deletes the `company` row with
triggers back on, so tables outside the catalog cascade. `canSetReplicationRole`
decides whether it can wipe at all. See `billing-system.md`.

### Known caveats in the committed code (not yet hardened)

- **Storage restore is best-effort** — copy failures warn only; the restore still
  reports success (data is the source of truth). The cross-tenant guard is
  `assetTargets` (see step 7); archive uploads check each entry with
  `isUnsafeStoragePath` (storage-js puts keys into the URL unencoded, so `%2e%2e`
  resolves like `..`).
- **Asset copy duplicates bytes** — a backup copies the company's assets into its
  `assets/` folder, so each backup costs roughly its asset size in storage.
  Snapshots are transient (keep/revert delete the folder); exports persist until
  deleted (`deleteCompanyBackup`, strict `removeBucketPrefix`).
- Sequences: the only pg-native serials on backed-up tables are `entryNumber` on
  `itemLedger`/`costLedger`/`supplierLedger` (not PKs, not unique; PKs are all
  text). They are **global/shared across tenants** — never `setval` them scoped to
  one company; in-place restore needs no reset (other tenants hold the high-water
  mark).

## Import — `company-import.ts` (onboarding from a backup)

Populates a freshly created company from a backup: an additive reseed, every id
remapped. No preserve mode, no revert ledger, no idempotency check: a retry after the
load committed fails on the "already set up" guard (an `accountDefault` row exists).
Flow: `readBackupForLoad` + `assertBackupImportable`; candidate tables = not
`isLeftAlone`, not user-scoped identity, with rows; `filterUnpopulated` drops tables
the target already populated (onboarding's own inserts); `buildIdMaps`; one
`bulkLoad` + `insertTables`; then `restoreAssetsFromBackup`. Group-scoped data with no
target group throws.

Reseed re-inclusion (`reseed.ts`): a dropped table whose ids the kept rows still
REFERENCE is re-added by `referencedDroppedTables` (transitive over `id`-FKs) —
without it the backup's `location` table was dropped because onboarding had inserted
one "Headquarters" row, and every imported `workCenter`/`job` locationId was nulled
(nullable) or left dangling at the SOURCE company's row (NOT NULL, committed under
replica mode) — the "schedule says no work centers exist" bug. A re-added table is
populated in the target by definition and unique constraints stay enforced under
replica mode, so backup rows that collide on a real unique key are NOT inserted:
`mapCollidingRows` + `matchableUniqueGroups` (+ `getUniqueColumnGroups` over
`pg_index`) map the source id onto the existing target row's id instead, so every FK
into the skipped row lands on the target's own row.

## ERP layer

- **`settings.service.ts`, Backups section** (no `backups.service.ts`: the
  `module-shape` check allows one service file per module): the gate,
  `isUserBackupName` (refuses paths and `_pre-*` snapshots), `unpackBackupArchive`
  (`.carbon.tar.gz` → a fresh `exports/<name>/`), and the staged upload both
  uploads share: `signBackupStaging` (a signed slot in `TEMP_STAGING_BUCKET`; the
  browser PUTs the archive there, since Vercel caps a request body at 4.5 MB),
  `isStagedBackupPath` and `unpackStagedBackupArchive` (streams it back, unpacks,
  then always deletes the staged object),
  `getCompanyBackups`, `deleteCompanyBackup`, the run readers, the start functions
  (`startCompanyRestore` / `startCompanyTemplate` / `exportCompanyBackup`),
  `dismissCompanyExportFailure`, and `purgeAndRetry` (the one purge-then-start for
  restore and template). Keep/revert are plain `trigger(...)` calls in the routes.
  Layout, marker keys and run shapes come from `@carbon/jobs/backups`; UI-facing
  types are in `settings/types.ts`.
- `getCompanyBackups` is the loader's list: `listBackups` (engine), then the live
  catalog ONCE per load, `reportBackupCompatibility` per manifest, `{ status,
  findings }` per row, manifest stripped. A catalog read failure costs the badges,
  not the page (`compatibility: null` = "not checked", never "ready").
- Errors never read as empty: list and marker read errors throw in loaders; the
  polled status routes answer `"unreadable"`, so a blip is never taken for "reverted"
  (`"gone"`); summary counts throw instead of 0.
- `routes/x+/settings+/backups.tsx` — loader/action (`export`, `restore`, `keep`,
  `dismiss`, `revert`, `dismissExportFailure`, `exportSkipCorrupted`,
  `purgeAndRestore`, `delete`). Every name from the client passes `isUserBackupName`.
  Export is **non-blocking, row-first** (Supabase-style): "Create backup" opens no
  modal — it drops a synthetic "Creating backup…" spinner row into the list
  **immediately** (client state `runningExport`, set when the action returns
  `started: "export"`, before the job writes its first marker); clicking the row
  opens the progress modal. `runningExport` is also **adopted from the marker** on
  mount for a run started elsewhere; its `baseline` = ready backups when tracking
  began, and completion = a ready backup outside the baseline appearing in the
  revalidated list. A `failed` marker renders a banner (the job's own error) with
  Dismiss — the old copy blamed the product for what was usually a data-integrity
  finding the error already named.
- `routes/x+/settings+/demo-data.tsx` — apply / keep / dismiss / revert /
  `purgeAndApply` for templates (`ui/DemoData/`).
- `routes/api+/settings.backup-*`: `summary` (lazy "what's in a backup" counts,
  grouped, per-entity `scope: company|group`), `restore-status.$restoreRunId` and
  `export-status` (polls; `companyId` from the gate, so a user can't poll another
  company's run), `archive.$file` (the `.carbon.tar.gz` download), `upload`.
  URLs via `path.to.api.backup*`.
- **One status vocabulary, four words** (`ui/Backups/format.ts`: `BackupStatus`,
  `backupStatusLabel` — a `msg`-descriptor map resolved with `t(...)` at the
  render site — and `backupStatusVariant`). No synonyms anywhere:

  | Status | Meaning | Restorable? |
  |---|---|---|
  | `Ready` | loads into today's schema unchanged | yes |
  | `Restorable with changes` | loads, but N things differ; disclosure required | yes, after confirming |
  | `Not restorable` | a hard refusal, with the reason | no |
  | `Incomplete` | no `manifest.json` — the export died partway | no |

  A failed EXPORT is not a row status — it renders as the failure banner from the
  export marker. `Incomplete` outranks the computed verdict and is never rendered as
  "Preparing…" once no export is being tracked — that was the bug where a dead folder
  looked alive forever. A row shows its taken date, size, label and this badge, and
  deliberately **no expiry date**: a printed date reads as a promise the backup is
  good until then, which nothing can make.
- UI: `modules/settings/ui/Backups/` — `BackupChoices` (Data only / Data + files),
  `BackupSourcePicker`, `BackupProgressModal` (`JobProgressModal`), `RestoreReviewRow`
  (Keep/Revert), `RestoreDisclosure` (the pre-restore screen — the ONLY path to a
  restore), `BackupContentsInfo` (lazy popover), `ExcludedRowsInfo`,
  `PurgeCorruptedRowsModal`, `format.ts`. `JobProgressModal` tracks real completion,
  not a timer: restore/revert poll the status marker; export completes once the new
  backup actually appears in the list — the dialog never claims success before the
  artifact exists.

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

Findings group by `tableArea` (`settings/backups.areas.ts`) — "Production" means something
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

## Onboarding seed and demo templates

`routes/onboarding+/industry.tsx` → `dataChoice: "template" | "import" | "none"`
("Use a demo template" / "Restore from a backup" / "I don't need data"). Restore from
a backup is internal-only (`isInternalEmail`); the template and a clean start are open
to every signup. The archive is staged first (`api/onboarding/backup-upload`
signs a slot under `onboarding/<userId>/`, internal-only); the step posts its
`backupPath`, never the file. In `onboarding.server.ts`, `provisionCompanyData`
unpacks it with `unpackStagedBackupArchive` onto an identity-only seed and triggers
`carbon/company-import`. A re-entry (the company already exists) with a backup
throws: the import needs a company that isn't set up, and ignoring the backup would
report success over nothing. `provisionOnboardingCompany` calls `startCompanyTemplate`
after the headquarters exists (the dataset pre-flight needs it). A failed enqueue is
fatal, not silent.

**`template` is NOT a backup import.** It runs the dev seed's own tier code against the
company, so the demo data has exactly one definition: `packages/database/src/datasets/`
— `tiers/` holds the insertion logic, `data/<key>/` holds one industry story each, and
`applyDataset()` is the shared entry point for `pnpm db:seed:dev --dataset <key>`,
onboarding, and Settings → Demo Data. `industry.id` → dataset is a code map
(`datasetForIndustry`); an industry without one is hidden from the picker. Full
feature context: `onboarding-company-templates.md`.

`company-template.ts`: one marker per company (`entityId` = company id), concurrency
`[{ limit: 2 }, PER_COMPANY_CONCURRENCY]` (the unkeyed limit keeps N onboardings from
outnumbering the pool). The apply step refuses while another run's marker is pending
keep/revert (it owns the only snapshot of the real data), writes `running`, then
`takeSnapshot` (always — the old `snapshot` flag is gone), then
`applyDataset({ wipeFirst: true })` on its own `getProcessPool()` connection (the
shared size-1 pool behind `getJobDatabaseClient` runs the event drainer). A
non-fatal `plan-template` step runs MRP and scheduling and records `planningError`.
Keep and revert act only on a marker naming their `templateRunId`: one sent for an
earlier run must not resolve a later one.


## Memory and scale

No stage holds a whole company. The export reads each table through a cursor
(`DECLARE … FETCH 2000`) into a gzip stream and keeps only the compressed bytes. A
restore reads the backup twice, a table at a time: `scanBackup` keeps only what the
checks need (`BackupScan`: ids of referenced tables — every id-bearing table with
`allIds` for a foreign load — the distinct values of each id FK with row counts, and
the `group` rows), then `insertTables` streams each table in batches.
`findDanglingReferences`, `loadSubstrateIds` and `buildIdMaps` take the scan;
`scanRows` builds one from rows in memory for tests.

Measured on 528k rows (2026-11-10, fresh process, 384 MB heap cap): export +310 MB
peak RSS, restore +179 MB in 26 s. The code before this ran out of memory under the
same cap. Not solved: a restore is one transaction in one `step.run`, so the
function's time limit (800 s on Vercel Pro) caps the largest companies.

## Revert removes the files its restore added

Before copying files, the restore records in its marker (`addedFiles`) the target
paths that did not exist yet, merged with an earlier attempt's. `revertRun` deletes
exactly those (`removeCompanyPaths`) after the data is back, and never anything
else. A failed delete is logged, not reported as a failed revert.

## Table order and FK cycles

`topologicalSort` breaks a cycle only among the cycle's own tables (Tarjan SCCs): a
table that merely hangs off a cycle waits for it. The wipe runs this order backwards
and filters a child through its parent, so a child sorted before its parent
survived the wipe (`jobFavorite` before `job`: every restore of a company with a job
favorite failed on `jobFavorites_pkey`).
