# Onboarding demo templates

Repo-committed company backups used as onboarding demo data. One file per
industry, named `<industryId>.carbon.json.gz` (the `industryId` must match a row
in the `industry` table — see the onboarding migration).

These are published into every workspace by `ci/src/upload-backup-templates.ts`
as a **manual** step — the `Publish backup templates` workflow
(`.github/workflows/publish-templates.yml`, `workflow_dispatch`) or
`pnpm --filter ci ci:upload-backup-templates` locally. It is **not** run on every
deploy (templates change rarely and are large). It uploads the `.gz` to each
workspace's private `company-templates` bucket and fans the template's storage
assets (3D models, …) into the shared `_templates/<industryId>/` prefix of the
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
2. Settings → Backups → Export (choose storage inclusion), then download the
   resulting `.gz`.
3. Commit it here as `<industryId>.carbon.json.gz`, overwriting the old one.

## Versioning / backwards compatibility

Each backup carries a manifest `version` (`BACKUP_VERSION` in
`packages/jobs/src/inngest/functions/tasks/company-backup.ts`). The importer
rejects a file whose version no longer matches, and a structural guard
(`assertBackupImportable`) independently rejects a file missing a now-required
column. Bump `BACKUP_VERSION` only for a deliberate hard break, then re-export
every template here.
