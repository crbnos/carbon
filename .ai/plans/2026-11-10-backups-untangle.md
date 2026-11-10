# Backups module untangle — decision log

Branch `refactor/backups-untangle` (worktree `carbon-backups-untangle`), off
`origin/main` 273e479e1b. Additions chosen: Comments, Tests.

Scope: `packages/jobs/src/backups/*`, `packages/jobs/src/inngest/functions/tasks/company-{backup,backup.transforms,export,restore,import,template}.ts`,
`scheduled/purge-company.ts`, `scripts/{check-backups,backup-baseline}.ts`,
`packages/ee/src/backups.server.ts`, and the ERP side (`modules/settings/backups.*`,
backup code in `settings.service.ts`, `routes/x+/settings+/{backups,demo-data}.tsx`,
`routes/api+/settings.backup-*`, `ui/Backups/*`, `ui/DemoData/*`).

## Evidence

- Change frequency since 2026-06 (commits): backups.tsx 31, company-backup.ts 29,
  company-restore.ts 23, company-export.ts 21, company-import.ts 20,
  backups.service.ts 19, schema.ts 14, transforms 12.
- Every one of the 8 commits to company-template.ts also changed company-restore.ts.
- Import graph: `company-backup.ts` re-exports `backups/{schema,scope,renames}`
  (`export *`), so flows import engine pieces through a task module;
  `company-template.ts` imports `wipeAndLoad` / `resolveRestoreScope` from
  `company-restore.ts`; `purge-company.ts` (scheduled) imports `wipeScopedData`
  from a task module.

## Problems

### Engine (packages/jobs/src/backups/*, tasks/company-backup*.ts) — audit 1

Hidden links
- `buildCompanyBackup` returns asset paths; only the export copies them (`copyAssetsToBackup`). Restore/template snapshots (`restore.ts:623`, `template.ts:265`) never copy, so a revert restores no files (failures logged as warnings). VERIFIED.
- Manifest-last is left to 3 callers (`writeBackupManifest`: export, restore, template); writer split from reader (`readBackup`) across files.
- Company bucket spelled two ways: `storage.from(companyId)` (tables/manifest) vs `getCompanyPrivateBucket(companyId)` (assets); `{companyId}/` prefix restated in 3 places.
- `RESEED_SKIPPED_TABLES` == `IN_PLACE_SKIPPED_TABLES` (same 6 names, two lists); kept-set built twice (`selectWipeableTables`, `assertWipeSafe`); `SECRET_TABLES` re-Set in 5 places.
- `TRANSIENT_TABLES` copied into `database/datasets/wipe.ts` `TRANSIENT_MRP_TABLES`.
- Company-singleton defined twice (`COMPANY_SINGLETON_TABLES` vs FK-shape inference in `buildRowTransforms`).
- user/employee ref set written 3x (`USER_REF_TABLES`, `RETAINED_REF_TABLES`, literal in `isUserScopedIdentityTable`).
- "NOT-NULL FK to a tracked id" rule coded 4x (`scopeEdges`, `buildDanglingPredicate`, `findDanglingReferences`, `loadSubstrateIds`); "has id column → tracked" 4x.
- Group flag→table mapping in `MIRRORED_GROUPS`, `rebuildDerivedGroups` SQL and the db triggers.
- Unique indexes read twice (catalog flattens groups; import re-queries per table, N+1).
- Two copy-pasted loaders: `restore.ts:175-244` vs `import.ts:308-380` (chunk size, column filter, row loop, insert, conflict clause); drifted: only restore writes `tableChange`/realtime, only import dedupes composite PKs; identity rule differs.
- `idMaps`→`idRewrite` flattening copied (restore, import).
- `companyGroupId` read written 3x (restore, import, export).
- Restore reads kept `employeeType` to feed the engine's group remap.
- Export re-implements `throttleProgress` (literal 250) and `JobProgress`; concurrency 6 written 5x.
- Marker integration keys + metadata shapes retyped in the ERP.
- `TEMPLATE_ASSET_PREFIX` "_templates" vs datasets/assets.ts "_templates/".
- `schema.ts` header claims no runtime @carbon imports but re-exports `rebuildDerivedGroups` (imports seed-data).
- `applyTableRenames` must follow `readBackup` in all 4 load paths by convention.

Needless links
- `mapWithConcurrency` (generic) lives in `scope.ts`; duplicates `@carbon/utils` `async.map`.
- Pure transforms/renames import through `./company-backup` (an Inngest task module); `CompanyBackup` type lives there.
- `purge-company.ts` / `company-cleanup.ts` import the wipe + catalog from `tasks/company-backup`.
- `wipeAndLoad`, `resolveRestoreScope`, `buildCompanyBackup` live in job files; template imports restore and export.
- transforms depends on `@carbon/documents/template` for one column (`documentEdit.settings`).
- `buildRowTransforms` carries 5 reseed-only options; error policy decided by which are present.
- `buildIdMaps(companies?)` only from restore (import gets fresh ids for company-wide groups); `rebuildDerivedGroups(wipedGroupIds)` only from restore.
- Import-only helpers (`filterUnpopulated`, `referencedDroppedTables`, `matchableUniqueGroups`, `mapCollidingRows`, `getUniqueColumnGroups`) and restore-only (`deleteDanglingRows`, `RESTORE_INTEGRATION`) sit in shared modules.
- `copyAssetsToBackup(destBucket)` / `restoreAssetsFromBackup(srcBucket)`: every caller passes `companyId` + `backupAssetsDir(name)`.
- `wipeAndLoad` requires `userId` that reverts pass as `""`.
- Two barrels (`company-backup.ts` export *, `schema.ts` re-exports); mixed import paths.

Surplus
- Dead: `templateIndustryId` path (`rewriteToTemplateAssetPath`, `TEMPLATE_ASSET_PREFIX`, template branch in transforms, `referencedTemplate`); import `preserve` mode (only sender passes reseed); import revert ledger (written then deleted, `autoFinalize: true` only) + export `ledgerFilter` + `BACKUP_INTEGRATION`; `id-refs` `externalIntegrationMapping` entry; `backupNameFromSource` legacy bridge.
- Unused exports: `TEMPLATE_BUCKET`, `backupTablesDir`, `BACKUP_TABLE_CONCURRENCY`; many exported-but-file-local (EXPORTS_PREFIX, backupManifestPath, USER_REF_TABLES, DanglingRef, GroupRemap, RowTransform, CollisionResolution, COMPANY_SINGLETON_TABLES, CATALOG_EXCLUDED_TABLES, topologicalSort, ScopeEdge, ExclusionCause, ExclusionTerm, COLUMN_RENAMES, LIVE_COLUMN_RENAMES).
- `totalExcludedRows` (no prod caller; ERP has `totalScopeRows`); `findExportScopeViolations` pass-through; `assertBackupImportable`/`blockingReason` thin wrapper; restore's try/catch around never-throwing `restoreAssetsFromBackup`.

Special cases
- `accountDefault`/`account` check in `reportBackupCompatibility`; `group` mapped last; `documentEdit.settings`; `/email/i` scrub; singleton FK test; FK branches for company/companyGroup/user; `groupConflictClause` per table; identity rule's literal companyId exclusion; export ledger filter; `accountDefault` as "already seeded" marker.
- Errors as nothing: schema_migrations read → "unknown"; non-strict listing in export and snapshot cleanup; `canSetReplicationRole` sentinel; `copyStorageObject` regex retry; asset failures counted never surfaced; `upsertExportMarker` unchecked write.
- `assertWipeSafe` re-checks a schema invariant on every load (hard-coded includeGroup).

### ERP (apps/erp/app) — audit 3

Hidden links
- Marker contract re-declared: integration names as literals (`backups.service.ts:200,252,307`, `settings.service.ts:1719`); RestoreMeta / export / TemplateMeta shapes hand-cast; status union in 6 files; `reason: "scope-violations"` in 5; progress `{phase,done,total}` 7x; `ScopeViolationSummary`/`ExcludedRow`/`RowsByTable` copies of job types; `BackupStatus` repeats `BackupCompatibilityStatus` + "incomplete".
- `SNAPSHOT_PREFIX = "_pre-restore-"` copies the job literal; `_pre-template-` snapshots are NOT hidden — they list as normal backups (restorable, deletable; deleting breaks demo-data revert). VERIFIED. Hiding lives only in the listing: delete/restore/archive accept `_pre-*` names.
- `exports/` layout + `manifest.json`/`assets/` re-typed as literals (backups.service, settings.service unpack, archive route); jobs own `backupDir` etc. in a task file.
- Folder naming `${iso}_${slug}` built by export, built differently by unpack (`_uploaded`), parsed by `formatBackupName`.
- `"backup:"` source prefix set/matched/stripped in 3 files, optional on the server; events.ts documents `filePath` as `exports/…`, ERP sends a bare name.
- Two upload paths for the same archive (Settings: signed URL + unpack; onboarding: form body); file-type check duplicated.
- Phase key → label mapped twice (BackupProgressModal untranslated, TemplateReviewRow translated); key list only in a comment.
- Four access gates disagree: `canManageBackups`, client nav re-implementation, onboarding `isInternalEmail`, job `requireBackupsEntitlement` (no internal path → internal user on non-BACKUPS company passes route, job throws). Gate hand-called in 7 routes with differing permission: archive download + summary use `view` → view-only user downloads the whole company. VERIFIED.
- `purgeAndRestore` (backups.tsx) vs `purgeAndApply` (demo-data.tsx) copies ("Mirrors"); one-at-a-time guard 3x; keep/dismiss bodies; scope-violation copy + ExcludedRowsInfo 3x; `RestoreRun` re-declares service return; resolved-run-ids + 2500ms poll 2x; onboarding's own `startCompanyTemplate`; `includeStorage` defaults scattered; display-name expr 3x (restore run stores raw folder name as label); date shown two ways (`formatBackupDate` uses JS Date); second byte formatter; API URLs hard-coded (no `path.to`); `backups.areas.ts` hard-codes tables incl. dead `shelf`.
- Stale comments cite nonexistent files (`backups.server.ts`, `backups-archive.server.ts`).

Needless links
- Backup building blocks inside 9.5k-line `settings.service.ts` while `backups.service.ts` is a second service file (baseline exemption); no `defineServiceFn` op for any backup action.
- `listCompanyBackupFolders` returns a placeholder verdict filled by `getCompanyBackups` in another file.
- UI imports types from `backups.service` (server-only); DemoData UI imports Backups UI internals via barrel; backup-only `RowsByTable`/`totalScopeRows` in a utils file importing 5 modules.
- `clearStaleExportFailure`, `exportSkipCorrupted` eligibility, purge→finalize→restart sequencing, tar packing, summary counting live in routes.
- `JobProgressModal` serves export and restore with nested ternaries; export completion split route/modal; restore ValidatedForm never submits; `useExportChoices` + duplicate `exportSkipValidator`.
- Client injection and error conventions inconsistent (`{error}` vs throw; keep/dismiss/revert uncaught; delete returns flash, others JSON).

Surplus
- Barrels `ui/Backups/index.ts`, `ui/DemoData/index.ts`; `utils/backups.ts` one caller; six one-line `trigger()` wrappers (start/finalize/revert × restore/template); unused exports (`ScopeViolationSummary`, `RestoreRun`, `ExcludedRow`, `Scope`, `Entity`, `UploadProgressProps`); loader returns unused `companyId`; dead `.carbon.json.gz` branch in `format.ts`; orphaned doc comment; status routes re-project; `signed-upload.ts` one caller.

Special cases
- Errors read as success/nothing: restore-status query error → "gone" → revert modal says "Reverted"; in-flight guard reads query error as none; load errors show "No backups yet"/hide Keep-Revert; export-status error → not running; manifest download/parse error → "Incomplete" (invites deleting a good backup); `excludedRowsByTable ?? []` (unknown as zero); 5000-folder silent cap; dismiss ignores delete error; `countEntity` dead catch; traversal entries skipped silently; `assetErrors` ignored.
- Hard-coded: label 80 vs slug 40 vs validator none; `BACKUP_ACRONYMS`; `TABLE_AREAS` with `itemLedger` exception.
- Polling/timeouts chosen separately (2500, 500, 2000, tick-count watchdogs, 5-min stall only for template).
- Browser-clock optimistic start + `supersedes` identity hack; one-value `reason` branches in 6 places; two typed-confirm rules.

### Job flows (tasks/company-{export,restore,import,template}.ts, purge, scripts) — audit 2

Bugs confirmed by reading: snapshots hold no files; `_pre-template-` listed as a backup; restore and template take different concurrency keys (a restore and a template revert can wipe one company together; export can dump across a restore's commit); restore marker `externalId = snapshotPath ?? ""` collides on the partial unique index when a run failed before its snapshot, blocking the next restore; `count ?? 1` reads a failed sole-member query as "sole member" and wipes group-shared accounts.

Hidden links
- Marker read/write/clear copied restore↔template (drifted: run-id vs company lookup, swallow vs throw); progress reporter copied with opposite failure rules (template's throws inside `applyDataset`'s txn); export inlines the throttle.
- Snapshot block copied (reuse path, `_pre-<kind>-<id>`, dump, manifest, marker); revert body copied (drifted: group via resolveRestoreScope vs getCompanyGroupId; files total 1 vs real count).
- Scope-violation → marker reason + NonRetriableError copied 3x; three marker types with overlapping fields re-declared by the ERP; integration keys in 3 places + ERP literals; `exports/` paths in ERP.
- Template marker survives wipes only because `externalIntegrationMapping` is in both `IN_PLACE_SKIPPED_TABLES` and datasets `PRESERVED_TABLES`.
- Export dumps marker rows (only `company-backup` ledger filtered).
- Loader copied restore↔import (INSERT_CHUNK_SIZE x2); replica probe + SET LOCAL x3; post-load cleanup (tableChange, realtime, dangling) only in restore.
- Post-read preamble (catalog, renames, gate, closure) copied 4x with different subsets; reverts skip the gate; restore loads the catalog twice.
- Group read 3x with different checks; sole-member rule 2x (restore unlocked + `?? 1`, purge FOR UPDATE).
- Prefix delete 2x (purge 20 passes × 200; removeBucketPrefix).
- `check-backups` `catalogAsManifest` rebuilds the export manifest.
- "One pending run" guard in job+app for template, app only for restore; restore concurrency object copied 3x.
- Registration in 5 places (flow, tasks/index.ts barrel, inngest/index.ts, events.ts, trigger.ts identity map).
- Comments tune limits to pools that no longer exist.

Needless links
- Template imports restore's `wipeAndLoad`/`resolveRestoreScope` and export's `buildCompanyBackup`; free template flow imports `@carbon/ee/backups.server` through them.
- `wipeAndLoad(remap)` two modes (userId/substrateIds remap-only); `buildCompanyBackup` one parameter per caller (`name`, `skipCorrupted`, `onProgress`).
- `wipeFirst: takeSnapshot` one flag for two decisions.

Surplus
- Template non-snapshot branch (every caller sends `snapshot: true`): clear-on-success, `wipeFirst: false`, cleared-marker guard.
- `TEMPLATE_INTEGRATION` exported for itself; `getCompanyGroupId` exported "for template" (unused there); `trigger.ts` 8 identity mappings; `tasks/index.ts` barrel; two `startCompanyTemplate`s; restore try/catch around non-throwing asset restore. (Plus engine-audit dead paths.)

Special cases
- Errors as nothing: import idempotency count, `accountDefault` probe, export marker IO, `deleteRestoreMarker`, non-strict snapshot delete, export listing; template/export catch can hide error on failed marker write.
- Restore finalize has no status guard (template has); restore revert with no snapshot returns quietly (template fails it); restore revert event lacks userId; idempotency skip only for `ready`; `new Date()` in restore/export vs `datetime.timestamp()`; export-only error truncation; `requireBackupsEntitlement` outside `step.run` (replay after lapse marks a committed restore failed); IS_LOCAL_DEV bypass in the lock; import N+1 + reseed-only dedupe; per-restore `to_regprocedure` probe; unknown datasetKey path.
- Purge: 20-pass loop + `/not found/`, table-prefix list, last-company-in-group refusal without replica; check-backups exit-0 skips, `-1` migrations, swallowed biome/git-add.
- No flow tests (engine + purge only); stale event comments.


## Fixes

Each fix above the problems it solves. Order = execution order.

### F1. An engine package-within-the-package: `packages/jobs/src/backups/` owns every reusable piece; task files only hold Inngest functions.
Modules (no Inngest imports, nothing imports a task file):
- `policy.ts` — every per-table decision: SECRET/STRUCTURAL/TRANSIENT/singleton lists, ONE `KEPT_TABLES` (replaces RESEED_SKIPPED + IN_PLACE_SKIPPED), USER refs, READABLE_ID, STORAGE_PATH_COLUMNS, `isUserScopedIdentityTable`, wipe/load selection, `assertWipeSafe`.
- `catalog.ts` (today's schema.ts introspection + types), `compatibility.ts` (report/status/gate), `renames.ts`, `id-refs.ts`, `scope.ts` (scope filter + violations/exclusions/purge/dangling), `remap.ts` (id maps returning idRewrite, row transforms, group mapping), `derived-groups.ts`.
- `format.ts` — Manifest, CompanyBackup, folder layout + names (`backupDir`, snapshot prefixes, `isSnapshotName`), NDJSON, encode/bind, `readBackup` (applies renames + gate itself).
- `dump.ts` — `writeCompanyBackup`: dump tables → copy assets → manifest LAST, one call (export, both snapshots).
- `load.ts` — ONE loader: wipe (optional), replica mode, insert loop, derived groups, change notification, dangling cleanup; used by restore, both reverts and import. `group-scope.ts` — one sole-member/group resolver (throws on query error), shared with purge.
- `storage.ts` — company bucket, list/copy/remove (one prefix delete, also used by purge).
Solves (engine): table lists that must agree; NOT-NULL-FK rule copies; loaders copied/drifted; manifest-last convention; renames-after-read convention; preamble subsets; group read 3x + `?? 1`; bucket spelled two ways; task-module barrels; purge/cleanup importing a task file; template importing restore/export; `mapWithConcurrency` → `@carbon/utils` `async.map`; two prefix deletes; idMaps→idRewrite copies; snapshots without files (BUG); `wipeAndLoad` remap-only params.

### F2. One reversible-run lifecycle: `backups/runs.ts`, used by restore and template (export uses its marker/progress half).
Owns: marker store per kind (`company-restore` / `company-template` / `company-export`), keyed so it cannot collide (one row per company+kind, run id in metadata); typed metadata + statuses + phase keys EXPORTED for the ERP; read/write/clear that throw; one throttled progress writer that never throws; `failRun` mapping (scope violations → reason + NonRetriableError; a failed marker write never hides the error); snapshot step (`_pre-<kind>-<runId>`, reuse on retry, `writeCompanyBackup`); `keepRun` (status guard: ready|failed) and `revertRun` (read snapshot via readBackup, load own, files with real count, delete snapshot strictly, clear; no snapshot → failed); one per-company concurrency key shared by restore, template, export and import; entitlement inside the step.
Solves: marker/progress/snapshot/revert copies and drift; restore↔template lock (BUG); marker externalId collision (BUG); finalize status guard; quiet no-snapshot revert; userId-less revert; `new Date()`; one-pending-run guard in the job; ERP re-declared shapes; entitlement replay.

### F3. Remove what nothing varies or calls.
Template non-snapshot branch; import `preserve` mode + revert ledger + export ledger filter + `BACKUP_INTEGRATION`; `templateIndustryId` path; legacy `.carbon.json.gz` bridges; unused exports; `trigger.ts` identity map; `tasks/index.ts` barrel; pass-throughs (`findExportScopeViolations`, `assertBackupImportable`, `totalExcludedRows`); restore's dead try/catch.

### F4. ERP: one backups module surface.
- All backup + demo-data building blocks in `modules/settings/backups.service.ts` (out of settings.service.ts); listing returns the verdict itself; contracts (marker types, statuses, phases, paths, `isSnapshotName`) imported from `@carbon/jobs/backups`; UI-facing types in `settings.models.ts`/utils, never from a service.
- One gate (`requireBackupAccess`) used by every backup route with `update: settings` (archive included); snapshot names refused by delete/restore/archive.
- Shared purge-then-run and one-at-a-time guard for restore and template; errors surfaced (no "error = empty"); API URLs via `path.to`; barrels removed; JS Date → `@carbon/utils`.
Solves: ERP audit hidden/needless links, `_pre-template-` listed (BUG), view-only archive download (BUG), errors read as empty/success.

### F5. Comments pass, then tests pass (keep behavior tests; add flow-level tests at the new seams).

## F1b decisions (2026-11-10)
- `readBackupForLoad` (read + table renames) is the one read for every load. The compatibility gate (`assertBackupImportable`, now throwing) runs only on forward restore and import: a revert loads the company's own snapshot, and a company with no group has account defaults without a chart of accounts, which the gate would refuse.
- Import's revert ledger and `importRunId` idempotency check are gone. The only sender always auto-finalized, so the ledger was written row by row and then deleted. A retry after the load committed now fails on the "already set up" guard instead of skipping silently.
- `insertTables` + `bulkLoad` are the one insert loop and the one load transaction (replica mode, derived groups, tableChange, realtime) for restore, both reverts and import. Import now also logs the table changes and broadcasts. The user-collapse PK dedupe now applies to every remapped load (foreign restore had the same risk).
- `removeBucketPrefix` is the one prefix delete, batches of 200, also used by purge (replaces `drainFolder`).
- Backup storage I/O (`readBackup`, `writeBackupManifest`, `writeBackupTable`, asset copies) lives in `storage.ts` and resolves the bucket with `getCompanyPrivateBucket`; `format.ts` is pure.

## F2 decisions (2026-11-10)
- `backups/runs.ts` owns the run lifecycle: `runMarker` (one store, keyed by `entityId`, throws on read/write errors), `progressWriter` (throttled, never throws), `failRun` (scope-violation mapping + NonRetriable), `takeSnapshot` (reuses a recorded snapshot), `keepRun` (ready/failed only), `revertRun`.
- BUG fixed: a restore marker's `externalId` started as `""`, so a second restore marker collided with a failed one on the partial unique index. `externalId` is now the entity id.
- BUG fixed: restore, template, export and import used three different concurrency keys, so a template could wipe under a restore, or an export dump a half-loaded company. All take `PER_COMPANY_CONCURRENCY`.
- BUG fixed: a template keep/revert sent for an earlier run resolved whatever run held the one-per-company marker. They now act only on a marker naming their run.
- Restore finalize now refuses an in-flight run (template already did); restore revert with no snapshot marks the run failed (template already did).
- Template's `snapshot` flag and its fire-and-forget path are gone: both senders always passed `true`.
- Entitlement is checked inside the step, after the running marker, so a refusal shows as a failed run.

## F3 notes (2026-11-10)
- Removed: `backupNameFromSource` (every sender passes the folder name), `totalExcludedRows`, the `findExportScopeViolations` wrapper (the detailed one took its name), the `externalIntegrationMapping` id-ref (that table never loads), needless `export`s.
- Out of scope, left as they are: `packages/lib/src/trigger.ts` task→event map and `tasks/index.ts` barrel serve every job in the repo, not only backups.
