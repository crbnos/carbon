# Onboarding demo templates

Repo-committed company backups used as onboarding demo data. Each template is two
things, named by `industryId` (which must match a row in the `industry` table —
see the onboarding migration):

- `<industryId>.carbon.json.gz` — the gz of `{ manifest, data }` (records only).
- `<industryId>.assets/` — the template's storage files (3D models, thumbnails, …),
  mirroring their source path (`{sourceCompanyId}/models/{id}.stl`). Omit the folder
  if the template has no files.

> Generation 2: storage assets are real files in the `.assets/` folder, NOT
> base64-embedded in the gz (which kept the gz small and bounded export memory).

These are published into every workspace by `ci/src/upload-backup-templates.ts`
as a **manual** step — the `Publish backup templates` workflow
(`.github/workflows/publish-templates.yml`, `workflow_dispatch`) or
`pnpm --filter ci ci:upload-backup-templates` locally. It is **not** run on every
deploy (templates change rarely and are large). It uploads the `.gz` to each
workspace's private `company-templates` bucket and fans the files from
`<industryId>.assets/` into the shared `_templates/<industryId>/` prefix of the
`private` bucket. The publish is **idempotent** — anything that already exists is
skipped; pass `--force` (workflow input `force: true`) to overwrite an updated
template.

Onboarding's "template" data choice downloads the matching `.gz` and
reseed-imports it on top of an identity-only seed
(`apps/erp/app/services/onboarding.server.ts`). The import **references** the
shared `_templates/<industryId>/` assets instead of copying files into the new
company's bucket — so onboard/revert cycles do no per-company file I/O. If no file
exists for the chosen industry, onboarding falls back to a clean seed.

## Authoring / refreshing a template

1. Populate a company with the data you want as the demo set.
2. Settings → Backups → Export (include files), which writes
   `exports/<name>.carbon.json.gz` plus an `exports/<name>.assets/` folder to the
   company's bucket.
3. Download both. Commit the gz here as `<industryId>.carbon.json.gz` and the
   asset files as `<industryId>.assets/<sourceCompanyId>/…`, overwriting the old
   template.

## Versioning / backwards compatibility

Each backup carries a manifest `version` (`BACKUP_VERSION` in
`packages/jobs/src/inngest/functions/tasks/company-backup.ts`). The importer
rejects a file whose version no longer matches, and a structural guard
(`assertBackupImportable`) independently rejects a file missing a now-required
column. Bump `BACKUP_VERSION` only for a deliberate hard break, then re-export
every template here.
