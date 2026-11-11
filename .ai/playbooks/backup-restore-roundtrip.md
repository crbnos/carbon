# Company Backup / Restore round-trip

Last tested: 2026-11-10 (refactor/backups-untangle, fresh `crbn up` worktree DB: export, download, own restore → revert, restore → keep, failed-restore dismiss, upload, demo-data apply → revert / apply → keep — all PASS after the two fixes below)
Route: `/x/settings/backups` (internal-gated — needs an `@carbon.ms` / `@carbon.us.org` user; `test@carbon.ms` qualifies)

> NOT covered by the own round-trip: the FOREIGN restore (`remap=true`) path — that's where the unified `buildRowTransforms` substrate pass-through + reseed/template logic actually run. And the `20260625163000_add-companyid-to-backup-tables` migration (singletons + audit tables) must be applied before its new coverage shows up.

## Prerequisites
- Logged in (see `/auth`). Dev server up.
- `networkidle` wait times out on this app (persistent dev connections) — snapshot directly after a short `sleep` instead of `agent-browser wait --load networkidle`.

## Steps (own-company round-trip — all PASS)

### 1. Export
- Navigate `/x/settings/backups`.
- Fill the label textbox (first textbox in the panel) e.g. `loop-test-1`.
- Leave the data-choice combobox at its default (Data only).
- Click **Create backup**. Button goes `[disabled]` while the export job runs.
- Wait ~20s → a modal **"Backup ready — it's in the list below"** appears. Click **Done**.
- The backup now shows in the list with **Download** + **Delete**.

### 2. Restore (own → `remap=false`)
- Click **Choose a backup** → combobox lists `<label> <date>`; click the option.
- **Restore** button enables. Click it.
- ~3s → modal **"Restore complete. Loaded N rows."** (365 for the Carbon Development dev company). Click **Done**.
- A **Keep** / **Revert** review row appears (the restore is reversible via auto-snapshot).

### 3. Revert (snapshot reload)
- Click **Revert** → toast "Reverting — your previous data is being restored", then modal **"Reverted. Your previous data is back, exactly as it was before the restore."**
- (Or **Keep** to finalize and discard the snapshot.)

## Selector Notes
- Backups panel controls, in order: "What a backup contains" (popover), label textbox, data-choice combobox, "Create backup", "Choose a backup" (source picker), "Restore".
- Dialog refs shift after the job completes — re-`snapshot -i` before clicking Done/Keep/Revert.

## Foreign restore (the high-risk path — `remap=true`)
- Switch company to a DIFFERENT one than the backup's source (this DB has `Carbon Development` and `Brynne Fox`), then restore the other company's backup via **Choose a backup → Upload new backup…**.
- This is where remap runs: id remap (text/uuid only — int/serial ids kept verbatim), user/employee FK collapse to importer, user-keyed identity tables skipped, and the referential-closure preflight.

## Common Failures (fixed 2026-06-25, foreign restore)
- `Cannot read properties of undefined (reading 'get')` — int/serial-id table in id-remap; fixed by gating the transform on idMap presence.
- `duplicate key value violates "trainingCompletion_unique_period_idx"` — user FK in a unique index collapsed to one user; fixed by widening `isUserScopedIdentityTable` to unique-index columns.
- `Backup is inconsistent: X.col references a Y that isn't in the backup` — non-closed backup (cross-scope NOT-NULL FK); now caught up front by the restore closure preflight (fails before any wipe, lists every gap).

## Common Failures (fixed 2026-11-10)
- Restore fails with `duplicate key value violates unique constraint "jobFavorites_pkey"` — the catalog sort's cycle tie-break put `jobFavorite` (scoped through `job`) before `job`, so the reversed wipe deleted `job` first and the child's filter matched nothing. Fixed in `topologicalSort` (break a cycle only inside the cycle).
- The page sits on "Creating backup…" after the export finished — the loader took ~3.7 s (an `information_schema` primary-key query) against a 2.5 s poll, so every revalidation was cancelled. Fixed by reading primary keys from `pg_catalog` (~140 ms loader).

## Notes (2026-11-10)
- A restore loads fewer rows than the backup holds: the left-alone tables (`employee`, `employeeType`, `employeeTypePermission`, `userToCompany`, `externalIntegrationMapping`) are not reloaded. 4,060 in the backup → 4,037 loaded on the dev seed.
- Demo-data **Keep** opens a type-to-confirm dialog: type `I understand, replace my existing data with the new demo data`, then click "Keep demo data".
- Proving a revert: compare `md5(string_agg(id, ',' order by id))` over the company's `item` + `job` ids — counts alone can match between datasets.
- Upload: set the file on the hidden `input[type=file]` (accept `.tar.gz`) with a `DataTransfer`, then dispatch `change`. The upload lists under its manifest's label and date, so a re-uploaded copy looks identical to the original.

## Round 2 (2026-11-10): files, foreign, old schema, scale
- **Files**: upload part documents and a thumbnail on `/x/part/<id>` (4 file inputs: tag them with `data-up` via eval, then `agent-browser upload '[data-up=uN]' <files>`), and one document on `/x/documents`. "Data + files" backup holds them under `assets/`. Fixed: a restore or revert over existing files deleted every `document` row (copy did remove-then-copy; the delete fires `delete_orphaned_documents`). Copy now uses `x-upsert`.
- **Foreign restore**: a second company in its own group needs `user.admin = true` (local test user) for the switcher's "Add Company". Switch with `POST /x/settings/company/switch/<id>`. Fixed: `document.path` (and ~25 other path columns) were not rewritten — any text value under `<sourceCompanyId>/` is now rewritten. New ids keep the schema's `id('prefix')`.
- **Old schema**: export with this branch's `writeCompanyBackup` against an older `wt_*` database (read-only), written into the target company's bucket, then restore it. Shows "Restorable with changes".
- **Scale**: 528k cloned ledger rows (`itemLedger` ×5000, `journalLine` ×800, `costLedger` ×9000 via `INSERT … SELECT … CROSS JOIN generate_series` with `session_replication_role = replica`). Before streaming: 1.7 GB / 2.3 GB peak. After: export +310 MB, restore +179 MB in 26 s under a 384 MB heap cap (the old code ran out of memory there). Revert of the 528k-row snapshot: 63 s.
- Revert deletes the files its restore added (`addedFiles` on the marker); check B's file count returns to its pre-restore value.
- Picker options read `<label><date>` with no space: select by `textContent.startsWith(label)` via eval, since a long list puts options outside the viewport.

## Round 3 (2026-11-11): after the review fixes
- Own "Data + files" restore → revert of a fresh backup: item-id md5, journalLine and document counts identical before, after restore and after revert; marker and `_pre-restore-*` folder gone after revert.
- The search index is rebuilt by the load: entries per type equal the source tables' row counts (the old index carried stale entries from earlier restores).
- Demo data apply → revert: same fingerprint before and after.

## Onboarding import (2026-11-10)
- Needs a user with no company: create a passwordless local user with the admin API on `http://127.0.0.1:<PORT_API>/auth/v1/admin/users` (`email_confirm: true`, an `@carbon.ms` address — restore is internal-only), sign in by the magic link from the local mail catcher (`http://127.0.0.1:54324/api/v1/mailbox/<local-part>`). Sign out first through the user menu; `/logout` doesn't.
- Steps: theme → user (first/last name, `requestSubmit`) → company (name, address combobox via `fill`, city, postal code) → industry: click the "Restore from a backup" label, Next, set the file on the input, click "Create company". The page uploads to staging, then posts `backupPath`.
- Verify: the new company's counts and file paths (`fp.sql`), `staged left: 0` under `onboarding/` in the staging bucket, and a backup of the new company (scope check).
