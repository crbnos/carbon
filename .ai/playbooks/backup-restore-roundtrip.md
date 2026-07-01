# Company Backup / Restore round-trip

Last tested: 2026-06-25 (re-verified after the closure/transform-unification refactor — own export→restore→revert all PASS; restore marker: 362 rows, foreign=false, includeGroup=true)
Route: `/x/settings/backups` (internal-gated — needs an `@carbon.ms` / `@carbon.us.org` user; `test@carbon.ms` qualifies)

> NOT covered by the own round-trip: the FOREIGN restore (`remap=true`) path — that's where the unified `buildRowTransforms` substrate pass-through + reseed/template logic actually run. And the `20260625163000_add-companyid-to-backup-tables` migration (singletons + audit tables) must be applied before its new coverage shows up.

## Prerequisites
- Logged in (see `/login`). Dev server up.
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
