# Model pipeline hardening and the legacy `private` bucket

Branch: `refactor/service-functions` (PR crbnos/carbon#1937). Requested 2026-10-17:
make the assembler pipeline more robust and faster, refactor it to the service
function patterns, and drop the legacy `private` bucket fallback.

## Production facts (read-only checks, 2026-10-17)

Live US production is the Supabase project "Carbon" (us-east-1). "Carbon - US" has
2 companies and an empty `private` bucket.

| Check | US production | EU | Staging |
|---|---|---|---|
| Objects in `private` with no copy in their company bucket, live company | 18 (1 MB): 7 models, 7 thumbnails (no row refers to them), 3 opportunity documents, 1 supplier-interaction document | 0 | 0 |
| The same, prefix is not a live company (deleted companies, `audit-logs/`) | 1,789 (998 MB) | 6 | 1 |
| `auditLogArchive` rows whose `archivePath` is `audit-logs/…` (only copy in `private`) | 390, 9 companies | 6, 1 company | 1 |
| Newest object written to `private` | 2026-10-01 | 2026-09-20 | 2026-08-10 |
| Successful server reads from `private` (Axiom, 30 days) | 614, all on 2026-10-01 17:03–22:53; none since | none | n/a |
| Storage requests to `private`, last 24 h (Supabase edge logs) | 2,959 `list-v2` (200), 26 DELETE (200), 39 GET (400), 10 info (400) | | |

Conclusions:

- Nothing writes to `private`. Migration `20261002022403` closed it to sessions and keys,
  and no service-role code writes there.
- The fallback serves no file reads now. It costs about 3,000 extra storage calls a day.
- Before the fallback goes, two sets of data must move: the 18 company objects (4 of them
  are visible documents) and the 397 legacy audit archives.
- `/file/preview/private/…` is a stored URL format (rich-text images, inspection
  documents, quality documents). The preview route keeps `private` as an alias for the
  caller's own company bucket. Only the read from the legacy bucket goes.

## Work

### A. Drop the legacy `private` bucket fallback

- [ ] `@carbon/files` `storage().company()`: company bucket only. No read fallback, no
      list union, no remove from both, no move out of legacy.
- [ ] Preview routes (ERP, MES): `private` stays a URL alias for the caller's company
      bucket and reads the company bucket only.
- [ ] Model raw location: one `storage.objects` query (company bucket, then
      `temp-staging`) replaces the HTTP probes in the jobs resolver and the ERP and MES
      `model.artifacts` and `model.download` routes.
- [ ] CSV import, audit archive download, backup asset copy and export listing, cleanup
      sweep: company bucket only. `auditConfig.archiveBucket` goes.
- [ ] Delete the unused `upsertModelUpload` (`shared.service.ts`).
- [ ] One-off final pass (`scripts/one-off/recopy-private-buckets.ts`): copy the remaining
      live-company objects, and move legacy audit archives to
      `{companyId}/audit-logs/…` in the company bucket and update `archivePath`.
      Idempotent, `--dry-run`. Run on staging, US and EU BEFORE this deploys.
- [ ] Purge keeps draining `private/<companyId>/` for a deleted company (cleanup, not a
      read fallback).

### B. Assembler job runner

- [ ] `runAssemblerJob`: wait in slices (`waitForEvent` up to 5 min, then one poll).
      Continue while the service reports the job queued or running. Fail when the
      service reports it failed, when it is lost (resubmit once), when it runs longer than
      the action's budget, or after an absolute ceiling.
- [ ] Service: a job is `running` only after admission grants its memory. Before that it
      is `pending`, so queue time does not count against the run budget.
- [ ] Drop the in-step 429 sleep loop. A 429 throws `RetryAfterError`.
- [ ] Correct the `ASSEMBLER_CONCURRENCY` comment: a waiting run holds no slot.

### C. Reaper (scheduled)

- [ ] Optimize or convert `Processing` / `Queued` with no update for 2 h → `Failed`
      ("Interrupted"); plan jobs the same.
- [ ] A model row from the last 24 h, older than 30 min, with an optimizable format and no
      optimize status → send `carbon/model-optimize` (lost start).

### D. Callback signature

- [ ] One signer in `@carbon/api/internal-call` for the assembler callback token. It throws
      when `SESSION_SECRET` is empty. Jobs and the ERP route use it.

### E. Jobs write through Kysely

- [ ] Model and plan-job state changes go through `getJobDatabaseClient()`, scoped by
      `companyId`, set `updatedAt`. Storage calls keep the service-role client.

### F. One owner for starting the pipeline

- [ ] AFTER INSERT trigger on `modelUpload` sends `carbon/model-optimize` through
      `util.send_inngest_event`. Skipped during dataset apply and sync (`app.sync_in_progress`)
      and for bundled `_templates/` paths.
- [ ] Remove the `trigger("model-optimize")` calls that follow a row insert.
- [ ] Part and tool forms register the model through `api+/model.upload` (path check,
      real `createdBy`) instead of a browser insert.

### G. Ingest in one job

- [ ] Service `optimize` accepts optional `compact` and `thumbnail` outputs. For STEP it
      writes the xbf once, tessellates from it, compacts it, and renders the thumbnail
      from the optimized GLB in memory.
- [ ] `model-optimize` asks for all three and persists them. `model-compact` stays for
      assembler-off relocation and legacy rows. `model-thumbnail` stays for a captured
      camera direction.

### H. Verify

- [ ] Typecheck (erp, mes, jobs, ee, api, files, database), Biome, tests, `cargo test`.
- [ ] Live: upload a STEP and a GLB on the local stack; the row reaches optimized,
      compacted and thumbnailed from one assembler job.
- [ ] Docs: `packages/files/AGENTS.md`, `apps/assembler/AGENTS.md`,
      `packages/jobs/AGENTS.md`, `.claude/rules/company-backup-restore.md`,
      `.ai/lessons.md`.

## Deploy order

1. Run the one-off final pass on staging, US and EU (`--dry-run` first).
2. Deploy the assembler (G and the `running` status change) before the apps.
3. Deploy ERP and jobs.
