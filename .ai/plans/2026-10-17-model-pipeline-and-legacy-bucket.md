# Model pipeline hardening and the legacy `private` bucket

Branch: `refactor/service-functions` (PR crbnos/carbon#1937). Requested 2026-10-17:
make the assembler pipeline more robust and faster, refactor it to the service
function patterns, and drop the legacy `private` bucket fallback.

## Production facts (read-only checks, 2026-10-17)

Live US production is the Supabase project "Carbon" (us-east-1). "Carbon - US" has
2 companies and an empty `private` bucket.

| Check | US production | EU | Staging |
|---|---|---|---|
| Objects in `private` with no copy in their company bucket, live company | 0 (rechecked 2026-10-17) | 0 | 0 |
| The same, prefix is not a live company (25 deleted companies, `audit-logs/`) | 1,807 | 6 | 1 |
| `auditLogArchive` rows whose `archivePath` is `audit-logs/…` (only copy in `private`) | 390, 9 companies | 6, 1 company | 1 |
| Newest object written to `private` | 2026-10-01 | 2026-09-20 | 2026-08-10 |
| Successful server reads from `private` (Axiom, 30 days) | 614, all on 2026-10-01 17:03–22:53; none since | none | n/a |
| Storage requests to `private`, last 24 h (Supabase edge logs) | 2,959 `list-v2` (200), 26 DELETE (200), 39 GET (400), 10 info (400) | | |

Conclusions:

- Nothing writes to `private`. Migration `20261002022403` closed it to sessions and keys,
  and no service-role code writes there.
- The fallback serves no file reads now. It costs about 3,000 extra storage calls a day.
- Before the fallback goes, one set of data must move: the 397 legacy audit archives.
  A first count showed 18 company objects. A recheck found that all 18 belong to deleted
  companies, so no live company has a file only in `private`.
- `/file/preview/private/…` is a stored URL format (rich-text images, inspection
  documents, quality documents). The preview route keeps `private` as an alias for the
  caller's own company bucket. Only the read from the legacy bucket goes.

## Work

Status: done on `refactor/service-functions`, not pushed. Commits: `ffe95a563b` (A),
`9947f360f0` (B, D), `eff0f12f70` (E, G), `a792e109b9` (F, C), `ba3bde17d7` (the F
follow-up below).

### A. Drop the legacy `private` bucket fallback

- [x] `@carbon/files` `storage().company()`: company bucket only. No read fallback, no
      list union, no remove from both, no move out of legacy.
- [x] Preview routes (ERP, MES): `private` stays a URL alias (`PRIVATE_PREVIEW_ALIAS`) for
      the caller's company bucket and reads the company bucket only.
- [x] Model raw location: one `storage.objects` query (`findStorageObjectBuckets`,
      company bucket, then `temp-staging`) replaces the HTTP probes in the jobs resolver
      and the ERP and MES `model.artifacts` and `model.download` routes.
- [x] CSV import, audit archive download, backup asset copy and export listing, cleanup
      sweep: company bucket only. `auditConfig.archiveBucket` is gone.
- [x] Delete the unused `upsertModelUpload` (`shared.service.ts`).
- [x] One-off script `scripts/one-off/relocate-legacy-audit-archives.ts`: copies each
      legacy audit archive to `{companyId}/audit-logs/…` in the company bucket and
      rewrites `archivePath`. Idempotent, `--dry-run`. CI runs it once per database
      after `supabase db push`, so it ships with this PR's migrations. No script copies
      company objects, because no live company has one only in `private`.
- [x] Purge keeps draining `private/<companyId>/` for a deleted company
      (`LEGACY_SHARED_BUCKET`, cleanup only).

### B. Assembler job runner

- [x] `runAssemblerJob`: wait in slices (`waitForEvent` up to 5 min, then one poll).
      Continue while the service reports the job queued or running. Fail when the
      service reports a failure a resubmit cannot fix, when the job runs longer than the
      action's budget, or after 6 hours queued. Resubmit a lost job or a transient
      failure, 2 times at most.
- [x] Service: a job is `running` only after admission grants its memory. Before that it
      is `pending`, so queue time does not count against the run budget.
- [x] Drop the in-step 429 sleep loop. A 429 throws `RetryAfterError`.
- [x] Correct the `ASSEMBLER_CONCURRENCY` comment: a waiting run holds no slot.

### C. Reaper (scheduled)

The thresholds changed from the first draft. The runner itself waits up to 6 hours for a
queued job, so a 2-hour reaper would fail live jobs.

- [x] Optimise, conversion or plan job `Processing` / `Queued` with no update for
      8 hours → `Failed` with an "interrupted" message.
- [x] A model created 30 to 60 minutes ago that is still `Idle` → send
      `carbon/model-optimize` again (lost start). pg_cron runs at :13 and :43, so each
      model is in the window for one run only.

### D. Callback signature

- [x] One signer in `@carbon/api/internal-call` for the assembler callback token. It
      throws when `SESSION_SECRET` is empty. Jobs and the ERP route use it.

### E. Jobs write through Kysely

- [x] Model and plan-job state changes go through `getJobDatabaseClient()`, scoped by
      `companyId`, set `updatedAt` (`tasks/model-rows.ts`). Storage calls keep the
      service-role client.

### F. One owner for starting the pipeline

- [x] Statement handler `queue_model_pipeline` on `modelUpload` sends
      `carbon/model-optimize` through `util.send_inngest_event` for each inserted row.
      It skips under `app.sync_in_progress` and for bundled `_templates/` paths.
- [x] Remove the `trigger("model-optimize")` calls that follow a row insert.
- [x] The part and tool forms and the quote drop stage the raw BEFORE they insert the
      row, because the event goes out at commit.
- [x] Changed from the first draft: the forms still insert the row under RLS, with the
      real `createdBy`. RLS does not check `modelPath`, so the path check moved into
      the jobs instead: `resolveModelSourceBucket` takes the row's `companyId` and
      refuses a path outside it. That covers every insert path, not only the forms.

### G. Ingest in one job

- [x] Service `optimize` accepts optional `compact` and `thumbnail` outputs. For STEP it
      writes the xbf once, tessellates from it, compacts it, and renders the thumbnail
      from the optimised GLB in memory.
- [x] `model-optimize` asks for all three and persists them. `model-compact` stays for
      assembler-off relocation and legacy rows. `model-thumbnail` stays for a captured
      camera direction.

### H. Verify

- [x] Typecheck (erp, mes, jobs, ee, api, files, database), Biome, tests, `cargo test`.
- [x] Reaper and handler on the local database, in rolled-back transactions.
- [ ] Live: upload a STEP and a GLB on the local stack; the row reaches optimised,
      compacted and thumbnailed from one assembler job. Not done: it needs the user's
      dev server and a rebuilt assembler.
- [x] Docs: `packages/files/AGENTS.md`, `apps/assembler/AGENTS.md`,
      `packages/jobs/AGENTS.md`, `apps/erp/app/modules/items/AGENTS.md`,
      `.claude/rules/{company-backup-restore,audit-log-system,csv-import-system,event-system,mcp-tools-reference}.md`,
      `.ai/lessons.md`.

### I. Onshape models refreshed in place (found during this work)

An Onshape export with no immutable source (an assembly, or a workspace part with no
microversion) refreshed its `modelUpload` row in place. Main behaves the same. The
row kept `optimizeStatus = 'Success'`, so `model-optimize` skipped it. A forced run
would not help either: the compacted raw, the preview and the assembly graph are keyed
by the model id, and `copyRawToDurable` never overwrites a durable copy.

- [x] `attachOnshapeAssetsToItem` names such an export by its bytes
      (`contentSourceId`: company, item, file name and content). Unchanged bytes reuse
      the row. Changed bytes get a new row, and the item is repointed to it. The
      in-place branch is gone.
- [x] The panel sync, revision sync and backfill no longer send `model-optimize` or
      `model-thumbnail`. The new row starts the optimise, which renders the thumbnail.
- [x] Tests: unchanged bytes reuse the model; changed bytes get a new one. Both fail
      on the old attach.

- [x] Existing data: 614 US production items have an Onshape mapping and a model with
      a plain id. For an export with no source id, a prior model with the same file
      name counts as that export's earlier sync, so it is not added as a document.
      Main overwrote that row; now it stays in storage. A released part keeps the
      strict rule: only the `onshape-` prefix marks an earlier sync.

## Deploy order

1. Deploy the migrations. CI then runs `relocate-legacy-audit-archives.ts` once per
   database. Until it runs, a legacy audit archive download fails.
2. Deploy the assembler (G and the `running` status change) before the apps. An old
   assembler ignores the `compact` and `thumbnail` fields. The model is optimised, its
   raw leaves staging uncompacted (`relocateRaw`), and it gets no thumbnail.
3. Deploy ERP and jobs.
