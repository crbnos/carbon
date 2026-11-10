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
- [x] `db:check:backups`: fixed in a follow-up commit (see Known breakage). Originally broken on main, so not run. `packages/jobs/src/backups/derived-groups.ts`
      (from main) named-imports `@carbon/database/seed-data`, which `tsx` loads as CommonJS without
      named exports; it fails under Node 22 and Node 24. `packages/jobs/manifests/schema.json` is
      main's copy (the baseline the check compares against). It regenerates once the import is fixed.
- [x] `@carbon/checks` conformance (454 tests pass):
  - 11 `permission: {}` → `"employee"`.
  - One sidebar module key fixed: the customer Assets tab showed to every employee.
  - Direct loader reads: 21 now go through `api.*`, and 50 are baselined. Their reasons are below.
- [x] ERP and MES unit tests pass. Three of main's tests were ported to page gates:
  `posting-permissions`, `service-fn-api-key-gates`, and the `mcp-tool-permissions` count.
- [x] Committed as merge `aaa5a3f1ab`. main then moved by one UI commit (#2181), merged in
      `5b77695e64`. Not pushed.

## Handoff notes

**Open decisions.** Each one changes who can do what, so each needs a product decision:

- **Time and billing approvals.** `timesheetEntry` and `projectBillableItem` sit on
  `projects.approvals`. Changing a colleague's time or a billable item needs Approvals at Edit.
  main used one `projects_update` for both. A person still writes their own Draft time.
- **Contracts.** `sales.projectContracts` is view-only. Every contract write needs
  `sales.serviceContracts`, because one `customerContract` table serves both lists.
- **Service assignments.** `serviceJobAssignment` sits on `service.schedule`.
- **Cross-module actions.** These pages are a judgement call, made in `sales.server.ts` and
  `projects.server.ts`:
  - `replaceReturnedUnit` needs Returns Edit and Sales Orders Create.
  - `changeReturnLineToService` needs Returns Edit and Service Jobs Edit.
  - `postProjectIssue` needs Inventory → Quantities Edit and Projects Edit.
- **Narrow reads.** Some service functions are narrower than the pages that read them:
  - My Time (every employee) reads charge numbers, labor categories, pending reviews and revisions
    through building blocks whose wrappers need Projects pages.
  - Service → Schedule reads employees, absences and shifts. Their wrappers need Resource Planning
    and Employees.
  - Settings → Projects reads states and labels. Their wrappers need Projects View.
  - `getContractBillableItems` needs Approvals and Service Contracts. A contracts-only user sees an
    empty list on the contract billing tab.

  Widen those wrappers, or add employee-scoped reads, and then remove the baseline entries.

**Baselined `loader-reads-through-api` entries (50).** Each has a reason:

- **Cursor paging.** main moved these to cursor paging, but their wrappers still take `offset`:
  - job events, operations, quantities and steps;
  - inventory quantities, stock transfers and inventory count lines;
  - demand forecasts;
  - production and purchasing planning.

  Planning also reads with `bypassRls`.
- **Service-role reads.** The project page (`x+/project+/$projectId.tsx`, 10 reads) reads with
  `bypassRls`.
- **No read wrapper.** These building blocks are only called inside write functions:
  - create-po-line, build, place-in-service, missing-time;
  - receipt put-away lines;
  - `invalidateIntegrationHealthCache`.
- **Wrapper drops a field.** The R&D reports' wrappers drop `currentTaxYear`. The project report
  CSV needs raw rows. `getPurchaseOrderApproval` returns an object, but the page relies on null.
  `getReceiptRelatedItems` lacks main's return-line ids.
- **Public routes.** The `share+` quote PDF and supplier quote.
- **Narrower wrapper.** See "Narrow reads" above. Also `fixed-assets` (wrapper needs Asset Classes),
  `quality+/actions` (wrapper needs Action Types), `projects+/reports._index` (wrapper needs
  Accounting → Reporting), and project borrows on the planning pages (wrapper needs Projects).

**Breakage from main.** None of these come from this merge:

- `db:check:backups` could not run, on main either. `derived-groups.ts` named-imported
  `@carbon/database/seed-data`, and `tsx` loads that as CommonJS with no named exports. Fixed in
  `08b96826e4`: the file reads the exports from either shape, and `schema.json` is regenerated
  (449 tables, `permission` included). The two merge commits used `CARBON_SKIP_BACKUP_CHECK=1`
  before the fix.
- `integration-metadata-patch.test.sql` fails on main too: anon has EXECUTE on
  `upsert_company_integration_patch` since `20260924192316`.

**Leftovers from an earlier merge session.** These five untracked files were not created by this
run and are not committed:

- `packages/checks/src/zz-merge-scan.test.ts` (marked "TEMPORARY … delete before committing");
- `.ai/runs/conformance-after-merge.txt`, `invariants-after-merge.txt`, `pages-reference.tsv`,
  `registry-test-after-merge.txt`.

Delete them once nobody needs them.

**Verify:**

```bash
crbn reset && crbn up                    # fresh database: every migration applies in order
pnpm exec turbo run typecheck --filter=erp --filter=mes --filter=academy --filter=starter
pnpm exec turbo run test --filter=erp --filter=mes --filter=@carbon/database --filter=@carbon/auth \
  --filter=@carbon/api --filter=@carbon/ee --filter=@carbon/jobs --filter=@carbon/checks
pnpm --filter @carbon/database authz check   # the database matches manifest.ts
pnpm db:check:datasets
for f in packages/database/supabase/tests/*.test.sql; do
  pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -q -v ON_ERROR_STOP=1 -f "$f"; done
```

**One-page-role pass (2026-11-10).** All 173 pages over HTTP, against an Admin baseline, as in
`.ai/playbooks/page-level-permissions.md`:
- Every page, and a project, service job and customer asset record, opens for a role that holds
  only that page. Payroll Totals was checked with DCAA timekeeping on.
- The only differences from Admin are the five module roots that a loader redirects to one page.
  That is expected.

In the browser, the nav link and sidebar of eight new pages were checked: Approvals, Schedule,
Indirect Rates, Indirect Pools, Settings → Time, Project Contracts, Customer Assets, and Projects
through Approvals. Two bugs were fixed:
- The Projects and Service nav links opened their list page, which refuses the other pages' roles.
  `useModules` now names their first page.
- The Projects and Service sidebars, and People's Payroll Totals entry, showed every entry to anyone
  with the module. Each entry now has a `page`, and the filter checks View on it.

## Bugs found during the merge

- **Customer sidebar.** main's `permission: { module: "service" }` on the Assets tab was ignored by
  the branch's `gate` filter, so every employee saw the tab. It now needs
  `service.customerAssets` View.
- **Bulk permission edit for all matching users.** It sent main's checkbox shape, while the form now
  sends grants, so every all-matching edit failed with "Failed to parse permissions". It now sends
  grants through `update-permissions`.
- [x] Commit the merge (not pushed). The PR description update and push wait for the go-ahead.
