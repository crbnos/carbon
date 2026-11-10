# Run: merge origin/main into page-level permissions (PR #1958)

Branch `claude/service-function-wrapping-13f04f`. main at `cca2a0beea` (2026-11-10), merge base
`615050497f` (2026-10-18): main is 420 commits and 194 migrations ahead.

## Decisions

- **Merge, not rebase.** The branch is pushed and has 48 commits.
- **The branch's migrations are re-dated after main's last one** (`20261110041037`). Before this
  change, they were dated 2026-10-18 to 2026-10-20 and ran before main's Projects, Service and the
  other new tables existed:
  - the grant conversion did not see the `Projects` and `Service` modules;
  - the page-key rewrite did not reach the new tables.
  None of the migrations had been applied to a shared database, so re-dating them is safe.
  The new timestamps are `20261110050000` to `20261110050013`, in the original order.
  `LAST_MODULE_KEY_MIGRATION` is now `20261110050010` (module-keys-to-pages).
- **The functions in module-keys-to-pages** (`is_claims_admin`,
  `get_item_storage_unit_requirements_by_location[_and_item]`) and its storage policies are not
  redefined by any of main's migrations, so running them later reverts nothing.
- **New modules get pages:**
  - Projects: `projects.projects`, `projects.approvals`, `projects.reports`,
    `projects.laborCategories`, `projects.planningGroups`. My Time (`/x/timesheet`) stays open to
    every employee.
  - Service: `service.jobs`, `service.schedule`, `service.customerAssets`.
- **main's list registry (`loadListPage`) is kept.** Each list's `permission` becomes a page gate.
- **main's RLS for the new tables** comes from its manifest rules. `render()` writes the owning page's
  key, and a new `authz migration` delta ships it after the re-dated migrations.

## Progress

- [x] Re-date the 14 migrations and their references
- [x] Resolve the 381 conflicted files (split across subagents by area). Per-area notes are in
      `.ai/scratch/merge-followups.md`.
- [x] Registry: 173 pages (was 159). Accounting → Projects is removed (main moved it).
- [x] List registry: 111 lists use page gates.
- [x] `authz migration` delta: `20261110081948_page-keys-for-main.sql` (141 tables). Its only module
      keys are portal keys. The access and authz tests pass.
- [x] Convert main's auto-merged code that still uses the old API (`requirePermissions`,
      `carbon(request)`, `can()`, module keys). About 230 files, in sweeps by area.
- [x] Regenerate: types (`crbn migrate` on a fresh `crbn reset` database), workflow catalog, MCP
      manifest (1789 tools).
- [x] Typecheck: all shared packages, plus erp, mes, academy and starter. Biome: clean.
- [x] Unit tests: database, auth, api, ee and jobs pass.
- [x] SQL tests: 43 of 44 pass.
  - Two of main's fixtures used the old `userPermission` keys; they now write grants
    (`authz-pieces`, `document-edit-authz`).
  - `integration-metadata-patch` fails the same way on main: anon has EXECUTE since
    `20260924192316`.
- [x] `db:check:datasets`: all 5 datasets apply. The defense dataset gained a Buyer role.
- [ ] `db:check:backups`: broken on main, so not run. `packages/jobs/src/backups/derived-groups.ts`
      (from main) named-imports `@carbon/database/seed-data`, which `tsx` loads as CommonJS without
      named exports; it fails under Node 22 and Node 24. `packages/jobs/manifests/schema.json` is
      main's copy (the baseline the check compares against). It regenerates once the import is fixed.
- [ ] `@carbon/checks` conformance: 11 `permission: {}` → `"employee"`. One sidebar module key fixed:
      the customer Assets tab showed to everyone. The direct loader reads are being fixed or
      baselined.

## Bugs found during the merge

- **Customer sidebar.** main's `permission: { module: "service" }` on the Assets tab was ignored by
  the branch's `gate` filter, so every employee saw the tab. It now needs
  `service.customerAssets` View.
- **Bulk permission edit for all matching users.** It sent main's checkbox shape, while the form now
  sends grants, so every all-matching edit failed with "Failed to parse permissions". It now sends
  grants through `update-permissions`.
- [ ] Commit the merge and push. Update the PR description. Hand off once asked.
