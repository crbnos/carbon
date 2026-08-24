# Onboarding demo templates — this directory is unused

This folder once held repo-committed company backups (`<industryId>.carbon.json.gz`
plus a sibling `<industryId>.assets/` folder) that onboarding's "Use a demo template"
choice was supposed to download and reseed-import. **That design was never finished**
and has been replaced. The committed `robotics_oem.carbon.json.gz` was deleted in
`d01f0357a`; nothing has read this directory since.

## What actually happens now

Onboarding's `template` choice runs the **dev seed's own tier code** against the newly
created company — the same data, the same insertion logic, no archive in between. The
data lives in exactly one place: `packages/database/src/datasets/`.

- Data: `packages/database/src/datasets/data/<datasetKey>/` (`satellite`, `robotics`,
  `precision` and `motor` ship today, one per onboarding industry)
- Engine: `packages/database/src/datasets/tiers/` + `applyDataset()` in `index.ts`
- Dev entry point: `pnpm db:seed:dev -- --email you@example.com --dataset satellite`
- Onboarding entry point: `apps/erp/app/services/onboarding.server.ts` triggers
  `carbon/company-template`, handled by
  `packages/jobs/src/inngest/functions/tasks/company-template.ts`
- An `industry` row is mapped to a dataset in code by `datasetForIndustry()`; an
  industry with no dataset is hidden from the onboarding picker.

See `.ai/specs/implemented/2026-08-13-onboarding-company-templates.md` and
`.claude/rules/company-backup-restore.md`.

## Dormant code this leaves behind

These exist but have no runtime consumer for onboarding templates. Do not wire them
back up without revisiting the spec:

- the private `company-templates` storage bucket
- `TEMPLATE_BUCKET` / `TEMPLATE_ASSET_PREFIX` in
  `packages/jobs/src/inngest/functions/tasks/company-backup.ts`
- `templateIndustryId` on the `carbon/company-import` event
- `ci/src/upload-backup-templates.ts` and `.github/workflows/publish-templates.yml`

Backup **export/restore** for real customer companies is unaffected and still lives in
`company-backup.ts` / `company-restore.ts`.
