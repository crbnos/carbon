---
paths:
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

User-facing rules of the feature: backups are **company-owner only**
(`group.ownerId === userId` check in the route), exclude secrets, and a restore is
reversible via an auto-snapshot.

**Currently internal-only** (`isInternalEmail`, `@carbon/utils`) while the
multi-tenant caveats below are unhardened: the nav entry is in `internalOnlyRoutes`
(`useSettingsSubmodules.tsx`), and `requireOwner` (route loader/action) plus both
`api+/settings.backup-*` loaders 404/redirect non-internal users. Internal =
`@carbon.ms` / `@carbon.us.org`. Drop the gates to ship publicly.

## Shared engine — `company-backup.ts`

The catalog is **schema-introspected**, not a hand-maintained list:

- `getCompanyTableCatalog(sql)` reads `information_schema` for every public BASE
  TABLE carrying a `companyId` or `companyGroupId` column, builds `TableInfo`
  (columns, FK edges, `scopeColumn`, `hasId`/id type), and topologically sorts
  (referenced-first). **`companyId` wins** when a table has both columns.
- `scopeColumn: "companyId" | "companyGroupId"`. `companyId` = the company's own
  data; `companyGroupId` = config shared across a company group (chart of
  accounts, currencies, dimensions).
- Skip/scope sets: `SECRET_TABLES` (`apiKey`, `companyIntegration`, `webhook`,
  `oauthClient`, `oauthToken` — never travel), `STRUCTURAL_TABLES` (`company` —
  excluded from catalog), `RESEED_SKIPPED_TABLES` (memberships/invites/employee/
  externalIntegrationMapping — skipped on onboarding reseed),
  `IN_PLACE_SKIPPED_TABLES` (access/identity tables a restore must keep so the
  user isn't locked out).
- Versioning: `BACKUP_VERSION` in the manifest; `assertBackupImportable` rejects a
  file whose version no longer matches or that's missing a now-required column.
- Id minting: `newIdForTable(table)` → `randomUUID()` for uuid id columns else
  `nanoid()`. Id remap is **gated to text/uuid id columns** (serial/int ids are
  left alone).
- Storage path rewriting: `rewriteStoragePath` (swap `{sourceCompanyId}/` →
  `{targetCompanyId}/` + remapped id segments), `rewriteToTemplateAssetPath`
  (`{co}/…` → `_templates/{industryId}/…`). `STORAGE_PATH_COLUMNS` =
  `modelPath`, `thumbnailPath`.

Buckets (important, two different things):
- `STORAGE_BUCKET = "private"` — the **shared** bucket holding every company's
  uploaded assets under a `{companyId}/` prefix. Asset files in a backup go here.
- The **per-company bucket named by `companyId`** holds the backup `.gz` files
  (`exports/…`) and pre-restore snapshots — see `client.storage.from(companyId)`.
- `TEMPLATE_BUCKET = "company-templates"`, `TEMPLATE_ASSET_PREFIX = "_templates"`.

## Export — `company-export.ts`

Dumps each catalog table scoped by its scope column, gzips (`await gzipAsync`,
promisified). **Empty tables are skipped** (`if (result.rows.length === 0)
continue`) — so a backup of a company with no GL postings simply has no
`journalLine`/`costLedger` rows; that is data-absence, not a coverage gap. With
`includeStorage: "all"`, asset files under `private/{companyId}/` are base64-embedded.

## Restore — `company-restore.ts`

Three Inngest fns: `companyRestoreFunction`, `companyRestoreFinalizeFunction`,
`companyRestoreRevertFunction`. **Shared concurrency** key
`'company-restore-' + event.data.companyId`, scope `env`, limit `1` — one restore
per company at a time.

Forward flow:
1. `downloadBackup` from the per-company bucket; `gunzipAsync`.
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
5. `restoreStorage` (outside the txn, non-transactional) uploads embedded files to
   `private/<rewritten path>` with `upsert: true`.
6. `assertWipeSafe(catalog)` guards the invariant that a KEPT table has no NOT-NULL
   FK into a WIPED table.

State marker: a row on `externalIntegrationMapping`, `integration =
"company-restore"`, `metadata = { status: running|ready|failed|reverting,
snapshotPath, foreign, includeGroup }`. `revert` reads the marker and reloads
`snapshotPath` (using `metadata.includeGroup`). Status is polled by the UI.

### Known caveats in the committed code (not yet hardened)

- **`restoreStorage` has no target-prefix assertion.** It writes to the shared
  `private` bucket via `rewriteStoragePath`, which only rewrites paths under
  `sourceCompanyId/`. A backup whose storage map holds a path NOT under
  `sourceCompanyId` would upload outside this company's prefix (cross-tenant write,
  `upsert:true`). Own/normal backups never trigger it; add a
  `targetPath.startsWith(\`${companyId}/\`)` guard if hardening.
- **Storage restore is best-effort** — upload failures `console.warn` only; the
  restore still reports success.
- **`company-import` id-gate drift** — restore gates id remap on column type
  (text/uuid); import still uses a `typeof row.id === "string"` heuristic. Share
  one transform builder to fix.
- Sequences: the only pg-native serials on backed-up tables are `entryNumber` on
  `itemLedger`/`costLedger`/`supplierLedger` (not PKs, not unique; PKs are all
  text). They are **global/shared across tenants** — never `setval` them scoped to
  one company; in-place restore needs no reset (other tenants hold the high-water
  mark).

## ERP layer

- `backups.service.ts` — per-company bucket ops: `exportCompanyBackup`,
  `listCompanyBackupExports` (`from(companyId).list("exports")`),
  `getCompanyBackupSignedUrl`, `deleteCompanyBackupExport`,
  `getCompanyRestoreRuns` (reads the markers).
- `backups.server.ts` — server-only trigger wrappers (`startCompanyRestore`,
  `finalizeCompanyRestore`, `revertCompanyRestore`) — kept off the client to avoid
  `Buffer`-in-client.
- `routes/x+/settings+/backups.tsx` — **owner-gated** loader/action (export /
  restore / keep / dismiss / revert / delete intents). `filePath` is forced under
  `exports/`.
- `routes/api+/settings.backup-summary.ts` — lazy "what's in a backup" counts,
  grouped, per-entity `scope: company|group`.
- `routes/api+/settings.backup-restore-status.$restoreRunId.ts` — poll; `companyId`
  from `requirePermissions`, so a user can't poll another company's run.
- UI: `modules/settings/ui/Backups/` — `BackupChoices` (Data only / Data + files),
  `BackupSourcePicker`, `BackupProgressModal`, `RestoreReviewRow` (Keep/Revert),
  `BackupContentsInfo` (lazy popover), `format.ts`.

## Onboarding seed

`routes/onboarding+/industry.tsx` → `dataChoice: "template" | "import" | "none"`
("Use a demo template" / "Restore from a backup" / "I don't need data"). A demo
template is a committed `.gz` at
`packages/database/supabase/backups/<industryId>.carbon.json.gz` (one per
`industry` row). `provisionCompanyData` (onboarding.server.ts) imports it on top of
an identity-only seed, **referencing** the shared `_templates/<industryId>/` assets
instead of copying files per company. No file → clean seed.

## CI publish

`ci/src/upload-backup-templates.ts` — **manual, idempotent** (`--force` to
overwrite). Uploads each committed `.gz` to every workspace's `company-templates`
bucket and fans its assets into `private/_templates/<industryId>/`. Run via the
`Publish backup templates` workflow (`.github/workflows/publish-templates.yml`,
`workflow_dispatch`) or `pnpm --filter ci ci:upload-backup-templates`. NOT run on
every deploy (templates are large + change rarely). The script hardcodes the
`_templates` literal — keep in sync with `TEMPLATE_ASSET_PREFIX`.
