# Projects, Field Service, billing and government contracting UI rebuild — implementation plan

**Spec:** none. Brad set the scope on 2026-10-12 (see *Information architecture* and *Decisions*).
**Research:**
- `.ai/scratch/ui-audit/README.md`: the audit of 64 screens.
- `.ai/scratch/ui-patterns-reference.md`: how Carbon screens are built.
- `.ai/scratch/ui-reference/flow-*.jpg`: what good looks like.
- `.ai/scratch/ui-reference/bad-*.jpg`: what to remove.
**Branch:** projects-wbs-research-spec

## Scope of this plan

This is a UI rebuild. Server actions, permissions, validators and data stay the same, except where a task names a change. Brad's words:

> "this interfaces are so bad. especially the projects view. it's completely over the top, incoherent, and overly complicated. also, any time we have an editable table, we should use an excel-like format similar to the inventory count or purchasing planning tables. aside from the tree view which use something like xyflow or reactflow -- things should essentially follow existing patterns, look minimal, and follow the vercel asthetic."

> "projects might need additional menus and navigation so that we're not exposing so many unnecessary controls on the ui at a time. the ui should look extremely simple and unwrap like an onion to reveal necessary complexity."

The plan has 44 tasks in 12 groups. Size: one executor run does 4–6 tasks. Each task commits on its own.

## Information architecture

The UI opens in layers. Each layer shows the least that a user needs, and the next layer holds the rest.

| Layer | Surface | What it shows | What it hides |
|---|---|---|---|
| 0 | The module sidebar | Projects: **Projects**, **My Time**, **Approvals** (with a count), **Reports**, then a collapsed **Setup** group (Labor Categories, Planning Groups). Service: **Service Orders**, **Schedule**, **My Visits**, then a collapsed **Setup** group (Customer Assets, Service Templates). | Transfers and Billing leave the sidebar. Transfers open from a project's Stock page. Billing review moves into Approvals. |
| 1 | The projects list | Identifier, Name, Status, Owner, Due, Budget used. One **New Project** button. Filters sit behind the Filter button. | Treatment, Budget, Actual, Committed, Start and Active stay as hidden columns. |
| 2 | The project workspace | A left project sidebar: the project switcher, the change request selector with a history icon, then the links **Overview**, **Plan** (with the element tree under it), **Schedule**, **Costs** (with **Stock**, **Pegging** and **Billing** under it when they apply), **Time**, and **Settings** at the bottom. A one-line header: identifier and name, one status badge, one primary action, a ⋯ menu. | No tab strip. Baselines and change requests open from the sidebar and the ⋯ menu. |
| 3 | Inside a page | One toolbar row: the primary action, the view switch, search. A Filter button; filter chips show only when a filter is set. Display options in a ⋯ menu. | No type chips row, no saved views, no stacked toolbars. |
| 4 | The element | A right panel: a short header (type, readable id, name, state), then collapsed sections Details, Plan, Time, Links, Comments. An expand icon opens the full page with the same content. | Requirement verification, Parameters, earned value and government fields show only when they apply. |
| 5 | A feature shows only when it is used | See the next table. | |

Layer 5 rules:

| Feature | Shows when |
|---|---|
| Government contracting fields: cost objective, allowability (unallowable, preproduction), FLSA status, CLIN and ACRN, funding actions, leave, business component, research role | `companySettings.timekeepingControls = 'DCAA'`, or the company has the `GOVERNMENT_CONTRACTING` feature (`useGovernmentContracting`, Task 7) |
| Earned value on the Costs page | The project has an element with `isControlAccount = true` |
| Billing under Costs | The project's `costTreatment` is Contract and a contract line bills it |
| Planning group fields and Pegging | The company has at least one `planningGroup` row (project fields), and the project has a `planningGroupId` (Pegging) |
| Service coverage | The project is a Service project (no change; already true) |
| A gated commercial feature | Its upgrade entry point shows as ONE compact row (`UpgradeOverlayRow`, Task 7) or one menu item, never a full overlay inside a busy page. The page-level overlay stays on a page whose whole subject is the feature (Indirect Rates, Planning Groups). |

## Decisions

| # | Decision | Reason |
|---|---|---|
| IA | The *Information architecture* above is the structure. It replaces Brad's earlier decision 2 (4 views in a header `DetailsTopbar`) and changes decisions 1 and 4. | Brad, 2026-10-12 ("unwrap like an onion"). |
| D1 | The project workspace uses the existing explorer frame: `PanelProvider` + `ResizablePanels`. The left `explorer` slot holds the project sidebar (Layer 2). The centre holds the page. The element opens in a right panel. The header is the standard `RecordHeader`. It must not overlap at 1440 px. | Brad approved the explorer frame. The IA moved the nav links into it, as in `flow-requirements-tree.jpg`. |
| D2 | The project pages are Overview, Plan, Schedule, Costs (Stock, Pegging, Billing under it), Time and Settings. Details folds into Settings. Baselines and Change requests are pages reached from the sidebar's history icon, the change request selector and the ⋯ menu. | IA Layer 2. |
| D3 | Plan has ONE toolbar row: a **New Element** `SplitButton`, a Table / Tree / Reader switch, a Filter button, search, and a ⋯ Display menu. The type chips become a Type filter in the Filter popover. Saved views, the Display popover, the change request picker in the toolbar, the List, Board and Timeline layouts, and the quick-add bar go. Table is the inline-edit grid, and **New Element** adds the row in the grid. The Tree (React Flow) stays, restyled to Flow's muted cards: a small grey type label, the name, at most one status chip, a comment count and an avatar. The fit-view never shows a speck. | Brad decision 3 and IA Layer 3. |
| D4 | An element opens in the right panel, with an expand icon to the full page. Both render the same `ElementView`, so the content never differs. All plan lines (material, labor, cost) go in ONE inline-edit grid with a Type column. The per-type modals and the duplicate **Log time** / **Issue material** buttons go. | Brad decision 4, changed by IA Layer 4 (the right panel stays, the duplication goes). |
| D5 | Every editable table uses the inventory count grid: `Table` `compact` `withInlineEditing` + `useCellSave`, or `Grid` for a small child list. That covers My Time (ERP, with totals in a footer row), the MES timesheet (the same rows × days grid, sized for touch), element plan lines, service template lines, labor category rates (no modal on a drawer), contract labor rates, funding actions, rate ceilings and indirect rates. Document lines (quote and order lines) keep the explorer pattern. | Brad decision 5. Rate ceilings sit on the same card stack as labor rates, so they follow. |
| D6 | One empty state everywhere: `Empty` (`~/components/Empty.tsx`) with a specific title, or the `Table` `emptyState` prop with an `Empty`. Dashed cards, the "No data exists" triangle and plain-text empties go from every screen this plan touches. Read-only values show as text, not disabled inputs. Every "new" action opens a drawer. Modal buttons follow the house order. Reports is one page like Accounting → Reporting. Indirect Rates is a list like Revenue Recognition runs, and its settings form moves under Settings → Accounting. Settings → Timekeeping matches Settings → Inventory. "Node" becomes "Element". Two sidebar items are never active at once. My Visits aligns its title. | Brad decision 6. The `Table` default triangle stays for the rest of the app; changing it globally is out of scope (see *Open points*). |
| D7 | Three bugs get fixed: the week views, the bare `/ice` and `/statement` URLs (default to the current fiscal year), and the header overlap at 1440 px. | Brad decision 7. |
| D8 | The week views already compute the week in the company time zone (`datetime.weekBounds(companyTimeZone, offset)`). The demo company's `company.timezone` is `UTC`, because the dev bootstrap inserts the company with no time zone. So on a Sunday evening in America/Chicago the server's day is already Monday. Task 8 fixes the bootstrap, adds a tested week helper, and sets the demo company's time zone in Settings → Company. The server functions keep the company time zone, so the grid and the DCAA entry window agree. | Research on 2026-10-12: `company.timezone = 'UTC'`, locations `America/Chicago`. One calendar for the grid and `save-timesheet-entry`. |
| D9 | Every boolean form field passes `bordered`. That covers `Boolean` from `~/components/Form` / `@carbon/form` (`packages/form/src/components/Boolean.tsx:31`) and any switch or checkbox field in a form. Task 39 sweeps the branch. Every task follows it. | Brad, 2026-10-12. |
| D10 | Domain terms get a glossary popover. Form fields and labels pass `termId` (`TermId` from `@carbon/content/glossary`), which renders `LabelWithHelp`. Task 2 adds the missing entries to `docs/content/src/glossary/terms.ts`. Task 40 sweeps the rebuilt screens. Every task follows it. The translate glossary `packages/locale/locales/glossary.json` is a different file and stays as it is. | Brad, 2026-10-12. |
| D11 | Plain words replace internal jargon (*Terminology* table). Code identifiers and enum values stay. Task 2 renames the UI strings and the glossary. Tasks 41 and 42 rename the rules and docs. | Brad, 2026-10-12 ("Common stock" collides with the equity term). |
| D12 | The demo company is the verification data: log in as `satellite-demo@carbonos.dev` at https://erp.projects-wbs-research-spec.dev (MES at https://mes.projects-wbs-research-spec.dev). The login page has no password field. It mails a magic link, and the local Inbucket catches it, so `login.sh` (Task 1) signs in without the password. Never use localhost:3000. | Brad decision 8. Checked on 2026-10-12: the email form and the magic link work. |
| D13 | The Projects → Billing list moves into the Approvals page as a **Billing** tab. Transfers leave the sidebar and open from the project's Stock page. Both old URLs keep working. | IA Layer 0 names 4 links only. Billing review is a review queue, like time approval. |
| D14 | A collapsed form section keeps its fields mounted. A closed section only hides them. | A form posts the whole record (`projectValidator`). An unmounted field would post nothing and the action would clear the column. |

## Terminology

The glossary (`docs/content/src/glossary/terms.ts`) is the source of truth. Task 2 applies this table.

| Current UI text | New UI text | Reason | Applied (Task 2, 2026-10-12) |
|---|---|---|---|
| Common stock (and "common stock" in sentences) | Unassigned stock | Brad. It means stock that belongs to no project. "Common stock" is an equity account. | Done: the transfer owner pickers and lines, `StockOwner`, the inventory owner filter, the storage unit and count rows, the job form, the planning action line, the item planning toggle ("Unassigned stock for projects"), the job validator message, 2 server-function refusals. The planning group excess rule enum `Common Stock` now shows the label "Unassigned stock" (`usePlanningGroupExcessRuleLabels`). Code names (`COMMON_STOCK_OWNER`, the enum value) stay. |
| Node, nodes (Service UI, `BuildFromPartDrawer` with `vocabulary="node"`) | Element, elements | One concept, one name. Projects already says Element. | Done: the work tree (column, buttons, placeholder, delete text), the visit page, the templates list column, the element peek, the template and work route flashes and refusals, `requireServiceOrderNode`'s message. `vocabulary` is gone, so the service drawer title is "Build from part", like Projects. The invoice detail enum `By Node` shows "By Element". The "Build Tree" button on the work card stays. |
| Live plan | Current plan | The baseline compare already says "Current plan". | Done: the change request picker, the review banner, 2 status flashes, the apply conflict message. |
| Technically complete / Technically Complete (status label) | Work complete | Plain. The enum value `Technically Complete` stays. | Done: `ProjectStatus` label "Work Complete" (title case, like the other statuses), the header primary action and the ⋯ menu item "Work complete". |
| Suspect, Suspect link | Needs review | Plain, and it says what to do. | Done: the Tree legend, the badge's label "Link needs review". The button "Mark reviewed" stays. |
| My Timesheet | My Time | Brad's sidebar wording (Layer 0). ERP and MES. | Done: the Projects sidebar, the avatar menu, the ERP breadcrumb and grid title, the Log time flash, the MES nav rail and page title. |
| BCWS, BCWP, ACWP (column headers) | Planned value, Earned value, Actual cost | The plain earned value names. The glossary entries carry the acronyms as aliases. | Done: the 3 headers; each keeps its acronym as the `title` tooltip. The close task text says "planned value, earned value and actual cost". BAC, CV, SV, CPI and SPI stay (not in this table). |
| Export ACWP | keep + glossary | ACWP is the name of the deliverable an auditor asks for. | Kept. Glossary `actual-cost` (alias `acwp`). |
| "plan lines" (2 strings) | "planned materials, labor and costs" | Plain. | Done: the Copy from helper text and the service template paragraph. |
| Payback Variance | keep + glossary | An accounting variance, like purchase price variance. | Kept. Glossary `payback-variance`. |
| Borrow, Payback | keep + glossary | Plain verbs. The glossary explains the stock rule. | Kept. Glossary `borrow-payback`. |
| Charge Number | keep (entry exists) | The government contracting term. | Kept. |
| Soft, Hard, Manual (pegs) | keep + glossary | The pegging terms planners use. | Kept. Glossary `peg` (aliases `soft-peg`, `hard-peg`, `manual-peg`). |
| Billing Element | keep + glossary | The project billing term. | Kept. Glossary `billing-element`. |
| Control account, Work package | keep + glossary | The earned value terms. | Kept. Glossary `control-account`, `work-package`. |
| CLIN, SLIN, ACRN, Burden, Dilution | keep + glossary | Real government contracting terms. | Kept. Glossary entries added. |
| As of | keep | Plain English. | Kept. |
| stripe, segment, planning segment, coverage reclass | no UI change | They appear in rules only, not in the UI. | No change. |
| Exception Project (planning group excess rule) | Exception project | Sentence case, like the other labels; the enum value stays. | Done, with the "Unassigned stock" label. |

## Removed

| What | Where it goes |
|---|---|
| The 8-tab strip in the project header, and the Billing, Stock and Pegging tabs | The project sidebar (Layer 2) |
| The Details tab | Settings (`/details` redirects to `/settings`) |
| Saved views (`$projectId.views.tsx`, `ElementViewsMenu`, `SaveViewModal`), the per-user layout preference, the Display popover | Gone. The `projectView` and `projectUserPreference` tables stay (no migration). |
| The List, Board and Timeline layouts (`ElementList.tsx`, `ElementBoard.tsx`, `ElementTimeline.tsx`) and the quick-add bar in the table | Gone. `?layout=list|board|timeline` redirects to `table`. `timeline-geometry.ts` stays for the Schedule timeline. |
| The type chips row | The Type filter in the Filter popover |
| The per-type plan line modals (`PlanLineModal` in `ElementPlanLines.tsx`) | The plan lines grid |
| The second **Log time** and **Issue material** buttons on the element | One pair, in the Time section |
| The Earned Value form's own Save button | Autosave per field |
| `TimesheetGrid`'s boxed `NumberField` cells, the MES card-per-row timesheet and its totals card | The grids |
| The labor rate modal on the labor category drawer, and the modals for contract labor rates, funding actions and rate ceilings | The grids |
| The 8-card Reports grid | One report list |
| The 3-card Indirect Rates page and its Burden Settings card | The runs list, a Rates drawer, and Settings → Accounting |
| The full-page New Service Order form | A drawer |
| The bespoke service template page (back link, paragraph) | A standard record header |
| Transfers and Billing in the Projects sidebar, My Timesheet in the Service sidebar | Stock page, Approvals, the avatar menu |
| Dashed empty cards and "No data exists" on the touched screens | `Empty` |

## Rules for the executor

- Read these before Task 1:
  1. `.claude/skills/carbon-design/SKILL.md` and `references/tables-and-lists.md`, `references/actions-and-overlays.md`, `references/status-and-feedback.md`.
  2. `.ai/scratch/ui-patterns-reference.md`.
  3. `.ai/scratch/ui-audit/README.md`.
  4. `.claude/rules/projects-system.md`, `field-service.md`, `project-billing.md`, `government-contracting.md`, `indirect-rates.md`, `project-control.md`, `commercial-licensing.md`, `date-handling.md`, `numeric-precision.md`.
  5. `apps/erp/app/modules/projects/AGENTS.md` and `apps/erp/app/modules/service/AGENTS.md`.
- Read these 6 lessons in `.ai/lessons.md`:
  1. *Full-screen height calcs must subtract the app-shell inset*
  2. *A shared executor acquires callers nobody planned for*
  3. *Lingui: a ternary inside t\`\` bakes the English words*
  4. *Lingui: `plural()` inside a `memo(…)` component calls the global i18n*
  5. *The pre-commit Lingui extract reads the working tree, not the commit*
  6. *Never hand-measure React Flow handle positions*
- 🛑 Never switch branches. Never stash. Never rebuild the database. Commit only the files of the current task.
- 🛑 Before each commit, run `git status --short`. If it shows `.ts` or `.tsx` edits outside the task, STOP: the Lingui hook would extract a wrong catalog.
- Never use JavaScript `Date` to parse, format or do arithmetic. Use `@internationalized/date` and `@carbon/utils`.
- Never query in a loop. Never build a DB client in a `*.service.ts`.
- Mark every new UI string with `t` or `<Trans>`. Write every count phrase with `<Plural>`.
- Run `pnpm --filter @carbon/checks license-headers` after you create a source file. Never type the header.
- Every boolean form field passes `bordered` (D9).
- Every field or label that names a glossary term passes `termId` (D10). Use the slugs Task 2 adds.
- Use the words in *Terminology*. Never bring back an old word.
- Every screen's default view shows at most ONE primary action. Every secondary action lives in a ⋯ menu, a row menu, or a Filter or Display popover. Every advanced field sits in a collapsed section or hides by Layer 5.
- Keep each `Editable*` editor's identity stable. Build editors once with `useStableEditableComponents` (Task 5).
- Every quiet grid save goes through `useCellSave`. If a route action does not answer `data({ error })` for `quiet=true`, add that branch. Keep its validator and its writes the same.
- When you delete a file, grep the whole repo for each export name first. Every hit is a caller to fix.
- If a task adds, removes or changes a service function, run `pnpm run generate:mcp`. Commit its output in the same task.
- If a quoted line or path does not match the file, search for it. If you cannot find it, STOP and report.
- Write a check result for every task in the run log `.ai/runs/2026-10-12-projects-service-ui-rebuild.md` (Task 1 creates it).

### The screenshot check (every UI task)

1. Run `AGENT_BROWSER_SESSION=ui-rebuild agent-browser get url`. If it fails or shows `/login`, run `.ai/scratch/ui-rebuild/login.sh`.
   - Expected: the last line ends with `/x`.
2. Run `.ai/scratch/ui-rebuild/shot.sh <erp|mes> <path> <task>-<slug>` for each screen the task names.
   - Expected: `saved <name>.png at <url>`, and no error line under it.
3. Open each new PNG with the Read tool. Open the reference PNG the task names. Open `.ai/scratch/ui-reference/flow-requirements-tree.jpg`.
4. Answer these 7 questions in the run log, under the task's heading:
   1. Does the screen show the reference pattern?
   2. Does nothing overlap or clip at 1440 px?
   3. Is there one toolbar row?
   4. Is there at most one primary action?
   5. Is there no input box inside a table (cells are borderless until focused)?
   6. Does every secondary action sit in a ⋯ menu, a row menu or a popover?
   7. Are advanced fields collapsed or hidden by Layer 5?
5. If one answer is "no", fix the code and repeat from step 2. The task is not done until all 7 answers are "yes".

### The code gate (every task)

```bash
pnpm exec biome check --write <every file the task changed>
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0, no "error TS" line.
pnpm --filter erp test
# Expected: exit code 0, no failed test.
```

For an MES task, also run `pnpm exec turbo run typecheck --filter=mes` and `pnpm --filter mes test`. The last task of each group also runs `pnpm --filter erp build` (and `pnpm --filter mes build` in Group 6). Expected: exit code 0, and no "Server-only module referenced by client" line.

Commit each task through the `check-and-commit` skill with a conventional message, for example `refactor(projects): rebuild the project header on RecordHeader`.

### Demo records (company `db65d74gq0g13npk9vp0`)

| Record | URL path |
|---|---|
| Project OB2 (Contract, project stock, planning group, 10 elements) | `/x/project/prj_PkThuk8ai72VzkQouKFDFv` |
| Project NSG3 (Expense, project stock, planning group) | `/x/project/prj_HHwYbAmVczM6LbEFpDDLBn` |
| Project ICR (Capitalize, Draft) | `/x/project/prj_29kwYLiPtR85CgbnYjWZZZ` |
| Element OB2-2 (Requirement with children) | `pje_LhH99coneGU1Q6ziQZc6Nx` |
| Element OB2-10 (a material plan line) | `pje_Ew3YnQzXe2DhMs6U1KvNUT` |
| Service order SVC000001 (Scheduled, plan lines on its elements) | `/x/service-order/svc_26C9aBAPXgqwr7UCGPGLEi` |
| Service template TPL-MPQJL2 | `/x/service-orders/templates/prj_MPQJL28XuzqBQrxcd42HAF` |
| Template element TPL-MPQJL2-1 (material and labor lines) | `pje_DH8tJXhnf9Eqt85rPgmw2G` |
| Labor category Systems Engineer | `/x/projects/labor-categories/lbc_H5erqLUCtjGW7vnX5oHL5s` |
| Contract CON000001 (Active, 3 Fixed lines) | `/x/contract/con_U9wosGpZJJaN4cVEhVMpa1` |
| Contract line (Fixed) | `/x/contract/con_U9wosGpZJJaN4cVEhVMpa1/conl_HvwrdW8QHRYM9VpDk42zE3/details` |
| Customer with an asset | `/x/customer/cust_AfsgMa8AhDMG17suKgLTsX/assets` |

If an id returns 404, find the new one with `.ai/scratch/ui-audit/q.sh "<SQL>"` against the same tables. The demo has no Time & Materials or Cost Plus contract line. Tasks 29 and 33 say what to do about that.

## Progress

- [x] Task 1: Set up the screenshot scripts, the run log and the baseline shots
- [x] Task 2: Apply the terminology table and add the glossary entries
- [x] Task 3: Give `Empty` a title and a description
- [x] Task 4: Add `ReadOnlyField` for read-only values
- [x] Task 5: Add the grid helpers `EditableByRow` and `useStableEditableComponents`
- [x] Task 6: Add collapsible groups and counts to the sidebars
- [x] Task 7: Add `useGovernmentContracting` and `UpgradeOverlayRow`
- [ ] Task 8: Fix the week views on a Sunday
- [x] Task 9: Shrink the Projects and Service sidebars (Layer 0)
- [x] Task 10: Simplify the projects list and the New Project drawer (Layer 1)
- [x] Task 11: Build the project workspace shell and the project sidebar (Layer 2)
- [x] Task 12: Rebuild the project header on `RecordHeader`
- [x] Task 13: Add the project Overview page
- [ ] Task 14: Fold Details into the project Settings page
- [ ] Task 15: Simplify the Costs page
- [ ] Task 16: Rebuild the Stock, Pegging and Billing pages under Costs
- [ ] Task 17: Simplify the Time page
- [ ] Task 18: Turn Milestones into the Schedule page
- [x] Task 19: Reduce the Plan loader to Table, Tree and Reader
- [x] Task 20: Give Plan one toolbar row and add rows in the grid
- [x] Task 21: Delete the List, Board and Timeline layouts
- [x] Task 22: Restyle the Tree cards and fix the fit-view
- [ ] Task 23: Rebuild the element panel and page (Layer 4)
- [ ] Task 24: Put all plan lines in one grid
- [ ] Task 25: Rebuild ERP My Time as a grid
- [ ] Task 26: Rebuild MES My Time as a touch grid
- [ ] Task 27: Rebuild Approvals with Time and Billing tabs
- [ ] Task 28: Edit labor category rates in a grid
- [ ] Task 29: Edit contract labor rates, funding actions and rate ceilings in grids
- [ ] Task 30: Fix My Visits, the Build from part drawer and the Service empty states
- [ ] Task 31: Open New Service Order in a drawer
- [ ] Task 32: Give service templates a standard record page
- [ ] Task 33: Show a locked contract line as read-only text
- [ ] Task 34: Rebuild Projects → Reports as one list
- [ ] Task 35: Turn Indirect Rates into a runs list with a Rates drawer
- [ ] Task 36: Move Burden Settings to Settings → Accounting and default the fiscal year
- [ ] Task 37: Match Settings → Timekeeping and Projects to Settings → Inventory
- [ ] Task 38: Sweep the remaining empty states
- [ ] Task 39: Sweep every boolean field to `bordered`
- [ ] Task 40: Sweep the glossary popovers onto the rebuilt screens
- [ ] Task 41: Update the rules, AGENTS.md, lessons and the design skill
- [ ] Task 42: Update the docs reference pages
- [ ] Task 43: Fill the translations
- [ ] Task 44: Run the final screenshot pass

## Dependencies

- Task 1 runs first. Task 2 runs before every screen task (Tasks 9–40), so they use the new words.
- Tasks 3–8 are independent of each other. Run them in any order or in parallel.
- Task 9 needs Task 6. Task 10 needs Tasks 3 and 4.
- Task 11 needs Tasks 6 and 9. Tasks 12–18 need Task 11. Task 13 needs Task 4. Task 14 needs Task 7. Task 16 needs Task 7. Task 18 runs before Task 21 (it keeps `timeline-geometry.ts`).
- Task 19 needs Task 11. Task 20 needs Tasks 5 and 19. Task 21 needs Tasks 18 and 20. Task 22 needs Task 19.
- Task 23 needs Tasks 7 and 11. Task 24 needs Tasks 5 and 23.
- Task 25 needs Tasks 5 and 8. Task 26 needs Task 8. Task 27 needs Tasks 9 and 25.
- Tasks 28 and 29 need Task 5. Task 29 needs Task 7.
- Tasks 30–32 need Tasks 2 and 3. Task 32 needs Task 24.
- Task 33 needs Task 4. Tasks 34–37 need Task 3. Task 35 needs Task 5.
- Tasks 38–40 need Tasks 9–37. Tasks 41 and 42 need Tasks 1–40. Task 43 needs Task 42. Task 44 runs last.

---

# Group 0 — Setup

## Task 1: Set up the screenshot scripts, the run log and the baseline shots

**Depends on:** none
**Files:**
- Check (they exist, scratch is git-ignored): `.ai/scratch/ui-rebuild/login.sh`, `.ai/scratch/ui-rebuild/shot.sh`
- Create: `.ai/runs/2026-10-12-projects-service-ui-rebuild.md`
- Copy from (precedent): `.ai/scratch/ui-audit/shot.sh`, `.claude/skills/auth/SKILL.md`

**Steps:**
1. Run `ls -l .ai/scratch/ui-rebuild/login.sh .ai/scratch/ui-rebuild/shot.sh`. If a file is missing, recreate it from the block below. Then run `chmod +x` on it.
2. Run `.ai/scratch/ui-rebuild/login.sh`. Expected: the last line ends with `/x`.
3. Create the run log with a `# Projects and Service UI rebuild — run log` heading and one `## Task N` heading per task.
4. Take the baseline shots with `shot.sh`. Use the name `00-<slug>` for each:

| Name | App | Path |
|---|---|---|
| `00-projects-list` | erp | `/x/projects` |
| `00-project-elements` | erp | `/x/project/prj_PkThuk8ai72VzkQouKFDFv/elements` |
| `00-project-element` | erp | `/x/project/prj_PkThuk8ai72VzkQouKFDFv/element/pje_LhH99coneGU1Q6ziQZc6Nx` |
| `00-project-milestones` | erp | `/x/project/prj_PkThuk8ai72VzkQouKFDFv/milestones` |
| `00-project-costs` | erp | `/x/project/prj_PkThuk8ai72VzkQouKFDFv/costs` |
| `00-project-time` | erp | `/x/project/prj_PkThuk8ai72VzkQouKFDFv/time` |
| `00-project-stock` | erp | `/x/project/prj_PkThuk8ai72VzkQouKFDFv/stock` |
| `00-project-settings` | erp | `/x/project/prj_PkThuk8ai72VzkQouKFDFv/settings` |
| `00-my-time` | erp | `/x/timesheet` |
| `00-mes-my-time` | mes | `/x/timesheet` |
| `00-approvals` | erp | `/x/projects/approvals` |
| `00-labor-category` | erp | `/x/projects/labor-categories/lbc_H5erqLUCtjGW7vnX5oHL5s` |
| `00-reports` | erp | `/x/projects/reports` |
| `00-indirect-rates` | erp | `/x/accounting/indirect-rates` |
| `00-service-orders` | erp | `/x/service-orders` |
| `00-service-template` | erp | `/x/service-orders/templates/prj_MPQJL28XuzqBQrxcd42HAF` |
| `00-contract-line` | erp | `/x/contract/con_U9wosGpZJJaN4cVEhVMpa1/conl_HvwrdW8QHRYM9VpDk42zE3/details` |
| `00-ref-job` | erp | `/x/production/jobs` |
| `00-ref-inventory-count` | erp | open the first row of `/x/inventory/inventory-count`, else reuse `.ai/scratch/ui-audit/91-ref-inventory-count-grid.png` |
| `00-ref-accounting-reports` | erp | `/x/accounting/reports` |
| `00-ref-revenue-runs` | erp | `/x/accounting/revenue-recognition-runs` |
| `00-ref-settings-inventory` | erp | `/x/settings/inventory` |

5. Commit the run log only. The scripts and PNGs stay in the ignored scratch folder.

```bash
#!/bin/bash
# .ai/scratch/ui-rebuild/login.sh — signs the agent-browser session "ui-rebuild"
# in as the satellite demo user through the magic link that Inbucket catches.
set -uo pipefail
export AGENT_BROWSER_SESSION=ui-rebuild
ROOT=/Users/barbinbrad/conductor/workspaces/carbon/kelowna
ERP=$(grep '^ERP_URL=' "$ROOT/.env.local" | cut -d= -f2)
PORT=$(grep '^PORT_INBUCKET=' "$ROOT/.env.local" | cut -d= -f2)
EMAIL=satellite-demo@carbonos.dev
BOX=satellite-demo
curl -s -X DELETE "http://localhost:$PORT/api/v1/mailbox/$BOX" >/dev/null || true
agent-browser set viewport 1440 900 >/dev/null
agent-browser open "$ERP/login" >/dev/null
sleep 4
SNAP=$(agent-browser snapshot -i)
REF=$(echo "$SNAP" | grep 'textbox "Email Address"' | grep -o 'ref=e[0-9]*' | cut -d= -f2)
BTN=$(echo "$SNAP" | grep 'button "Continue"' | grep -o 'ref=e[0-9]*' | cut -d= -f2)
if [ -z "$REF" ] || [ -z "$BTN" ]; then echo "LOGIN FORM NOT FOUND (already signed in?)"; agent-browser get url; exit 1; fi
agent-browser fill "@$REF" "$EMAIL" >/dev/null
agent-browser click "@$BTN" >/dev/null
ID=""
for i in $(seq 1 20); do
  ID=$(curl -s "http://localhost:$PORT/api/v1/mailbox/$BOX" | python3 -c 'import sys,json; m=json.load(sys.stdin); print(m[-1]["id"] if m else "")')
  [ -n "$ID" ] && break
  sleep 1
done
if [ -z "$ID" ]; then echo "NO MAGIC LINK"; exit 1; fi
LINK=$(curl -s "http://localhost:$PORT/api/v1/mailbox/$BOX/$ID" | python3 -c 'import sys,json,re,html; b=json.load(sys.stdin)["body"]; t=b.get("html") or b.get("text"); m=re.search(r"href=\"([^\"]+)\"", t) or re.search(r"(https?://\S+)", t); print(html.unescape(m.group(1)))')
agent-browser open "$LINK" >/dev/null
sleep 5
agent-browser get url
```

```bash
#!/bin/bash
# .ai/scratch/ui-rebuild/shot.sh <erp|mes> <path> <name> [wait-seconds]
export AGENT_BROWSER_SESSION=ui-rebuild
ROOT=/Users/barbinbrad/conductor/workspaces/carbon/kelowna
KEY=$(echo "$1" | tr '[:lower:]' '[:upper:]')_URL
BASE=$(grep "^$KEY=" "$ROOT/.env.local" | cut -d= -f2)
agent-browser set viewport 1440 900 >/dev/null
agent-browser open "$BASE$2" >/dev/null
sleep "${4:-5}"
agent-browser screenshot "$ROOT/.ai/scratch/ui-rebuild/$3.png" >/dev/null
echo "saved $3.png at $(agent-browser get url)"
agent-browser get text body 2>/dev/null | grep -i -E "something went wrong|application error|could not be completed|404" | head -3 | cut -c1-200
```

**Verify:**
```bash
ls .ai/scratch/ui-rebuild/00-*.png | wc -l
# Expected: 22 (21 if the inventory count reference reuses the audit PNG).
git show --stat HEAD | grep runs/2026-10-12
# Expected: the run log is in the commit.
```

If the magic link never arrives, STOP and report. Do not change `DEV_BYPASS_EMAIL`.

**Out of scope:** any code change.

## Task 2: Apply the terminology table and add the glossary entries

**Depends on:** Task 1
**Files:**
- Modify: `docs/content/src/glossary/terms.ts` — add the missing entries
- Modify: every `.tsx` file that holds a string in the *Terminology* table (find them with the greps below)
- Copy from (precedent): the `charge-number`, `element` and `cost-treatment` entries in `terms.ts` (around line 2285)

**Steps:**
1. Find each old string in the UI:
   ```bash
   grep -rn -i "common stock" apps/erp/app apps/mes/app
   grep -rn -E "Live plan|Technically [Cc]omplete|Suspect link|>Suspect<|t\`Suspect\`|My Timesheet|BCWS|BCWP|plan lines" apps/erp/app apps/mes/app
   grep -rn -E "[Nn]odes?\b" apps/erp/app/modules/service apps/erp/app/routes/x+/service-orders+ apps/erp/app/routes/x+/service-order+ apps/erp/app/modules/projects/ui/Elements/BuildFromPartDrawer.tsx
   ```
2. Change each user-visible string to its *New UI text*. Keep code identifiers, enum values, URL segments and prop names.
3. For "Technically complete", change the label only. `ProjectStatus` and the status buttons map the enum value `Technically Complete` to the label "Work complete".
4. In `BuildFromPartDrawer.tsx`, remove the `vocabulary` prop and its "node" strings. Remove `vocabulary="node"` from `routes/x+/service-order+/$id.work.tsx`.
5. Rename toast and flash text too: "Node deleted" becomes "Element deleted", and so on.
6. For each candidate slug below, run `grep -n '"<slug>"\|^  <slug>:' docs/content/src/glossary/terms.ts`. Skip a slug that exists.
7. Add each missing entry. Write one sentence per definition. Ground it in the rules and specs named in the table. Never invent a fact.
8. Give each entry an `href` to a docs heading that exists. Check the anchor with `grep -n "^## \|^### " docs/content/docs/reference/<page>.mdx`.

| Slug | Term | Source to read | `href` page |
|---|---|---|---|
| `unassigned-stock` | Unassigned stock | `inventory-system.md` → *Project stock* | `projects` |
| `project-stock` | Project stock | `projects-system.md` → *Project stock* | `projects` |
| `borrow-payback` | Borrow and payback | `projects-system.md` → *Project stock* | `projects` |
| `payback-variance` | Payback variance | `projects-system.md` → *Project stock* | `projects` |
| `planning-group` | Planning group | `projects-system.md` → *Planning groups* | `projects` |
| `peg` (aliases `soft-peg`, `hard-peg`, `manual-peg`) | Peg | `projects/AGENTS.md` → *Planning group* | `projects` |
| `requirement` | Requirement | `projects-system.md` → *Verification and Parameters* | `projects` |
| `needs-review` (alias `suspect-link`) | Needs review | `projects-system.md` → *Trace links and suspect flags* | `projects` |
| `baseline` | Baseline | `projects-system.md` → *Baselines* | `projects` |
| `change-request` | Change request | `projects-system.md` → *Baselines* | `projects` |
| `capitalize` (alias `cip`) | Capitalize | `projects-system.md` → *Capital projects* | `projects` |
| `cost-objective` | Cost objective | `government-contracting.md` → *Cost objectives* | `government-contracting` |
| `allowability` (alias `unallowable-cost`) | Allowability | `government-contracting.md` → *Cost objectives* | `government-contracting` |
| `preproduction` | Preproduction | `government-contracting.md` | `government-contracting` |
| `flsa-status` | FLSA status | `government-contracting.md` → *DCAA timekeeping* | `government-contracting` |
| `timekeeping-controls` (alias `dcaa`) | Timekeeping controls | `government-contracting.md` → *Off by default* | `government-contracting` |
| `dilution` | Dilution | `government-contracting.md` → *Dilution* | `government-contracting` |
| `labor-transfer` | Labor transfer | `government-contracting.md` → *Labor transfers* | `government-contracting` |
| `clin`, `slin`, `acrn` | CLIN, SLIN, ACRN | `government-contracting.md` → *CLIN and ACRN funding* | `government-contracting` |
| `funding-action` | Funding action | `government-contracting.md` → *CLIN and ACRN funding* | `government-contracting` |
| `business-component`, `research-role`, `funded-research` | Business component, Research role, Funded research | `government-contracting.md` → *R&D tax* | `government-contracting` |
| `indirect-pool`, `burden`, `provisional-rate`, `final-rate`, `rate-ceiling` | Indirect pool, Burden, Provisional rate, Final rate, Rate ceiling | `indirect-rates.md` | `projects` (*Indirect rates*) |
| `earned-value` (alias `bcwp`), `planned-value` (alias `bcws`), `actual-cost` (alias `acwp`), `control-account`, `work-package`, `cpi`, `spi` | the earned value terms | `project-control.md` | `projects` |
| `stop-work-order`, `budget-control` | Stop-work order, Budget control | `project-control.md` | `projects` |
| `billing-element`, `billing-method`, `bill-rate`, `billable-item`, `right-to-invoice`, `percent-complete` | the project billing terms | `project-billing.md` | `project-billing` |
| `service-order`, `coverage` | Service order, Coverage | `field-service.md` → *The shape*, *Coverage* | `service-orders` |

9. Do not pass any `termId` yet. Tasks 9–40 pass them.
10. Run `pnpm run lingui:extract`. The new msgids get translations in Task 43.

**Verify:**
```bash
pnpm --filter @carbon/content test
# Expected: exit code 0 (terms.test.ts passes).
pnpm --filter docs typecheck
# Expected: exit code 0.
grep -rn -i "common stock\|Live plan\|Suspect link" apps/erp/app apps/mes/app | grep -v "^.*//" | wc -l
# Expected: 0.
grep -rn -E "t\`[^\`]*[Nn]ode|<Trans>[^<]*[Nn]ode" apps/erp/app/modules/service apps/erp/app/routes/x+/service-orders+ apps/erp/app/routes/x+/service-order+ | wc -l
# Expected: 0.
```
Then run the code gate. Then the screenshot check on `/x/service-order/svc_26C9aBAPXgqwr7UCGPGLEi/work` (name `02-service-work`, reference `00-service-orders.png`).

**Out of scope:** rules and docs (Tasks 41 and 42). `packages/locale/locales/glossary.json`.

---

# Group 1 — Shared pieces

## Task 3: Give `Empty` a title and a description

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/components/Empty.tsx`
- Copy from (precedent): the same file

**Steps:**
1. Add two optional props: `title?: ReactNode` and `description?: ReactNode`.
2. Render `title` in the `h3`, else today's `<Trans>No data yet</Trans>`.
3. Render `description` in the `p`, else today's text. If `description` is `null`, render no `p`.
4. Keep `children` under the text. It holds at most one secondary `Button`.
5. Keep every other class the same. All 66 callers must look unchanged.

**Verify:** run the code gate. Then the screenshot check on `/x/project/prj_PkThuk8ai72VzkQouKFDFv/costs` (name `03-empty-unchanged`). Expected: it looks the same as `00-project-costs.png`.

**Out of scope:** the `Table` built-in empty state.

## Task 4: Add `ReadOnlyField` for read-only values

**Depends on:** none
**Files:**
- Create: `apps/erp/app/components/ReadOnlyField.tsx`
- Modify: `apps/erp/app/components/index.ts` — export `ReadOnlyField` and `ReadOnlyFields`
- Copy from (precedent): the inline display of `packages/form/src/components/InputControlled.tsx:117-136`; `Property` in `apps/erp/app/modules/projects/ui/Element/ElementSidebar.tsx:49`

**Steps:**
1. Create `ReadOnlyField({ label, termId, children })`.
   - Label: `text-xs text-muted-foreground`, wrapped in `LabelWithHelp` from `@carbon/react` when `termId` is set.
   - Value: `text-sm text-foreground`. Render `—` when `children` is `null`, `undefined` or `""`.
2. Create `ReadOnlyFields({ children })`: `<div className="@container"><div className="grid gap-4 @md:grid-cols-2 @3xl:grid-cols-3">`.
3. Use no `Input`, no border and no disabled styling.

**Verify:** run the code gate. Expected: exit code 0.

**Out of scope:** replacing the 7 local helpers (`DetailRow`, `Row`, `Field`). Tasks touch them only when they rebuild that screen.

## Task 5: Add the grid helpers `EditableByRow` and `useStableEditableComponents`

**Depends on:** none
**Files:**
- Create: `apps/erp/app/components/Editable/EditableByRow.tsx`
- Create: `apps/erp/app/components/Editable/useStableEditableComponents.ts`
- Modify: `apps/erp/app/components/Editable/index.ts` — export both
- Copy from (precedent): `apps/erp/app/modules/production/ui/Planning/PlanningOrderGrids.tsx:382-416` (stable editors through a ref); the editor props type in `apps/erp/app/components/Editable/types.ts:5-15`

**Steps:**
1. `EditableByRow<T>(pick: (row: T) => EditorComponent<T> | null, readOnly: (props: EditableTableCellComponentProps<T>) => ReactNode)`.
   - It returns one component.
   - It renders `pick(row)` with the same props when that returns a component.
   - Otherwise it renders `readOnly(props)`.
   - Use it for a column whose editor depends on the row: the plan line Type, a locked timesheet cell.
2. `useStableEditableComponents<C>(build: (latest: { current: C }) => Record<string, EditorComponent>, callbacks: C)`.
   - It keeps `callbacks` in a ref and updates the ref on every render.
   - It calls `build` once, in a `useMemo` with empty deps.
   - It returns the same object on every render.
3. Write a short comment that names `PlanningOrderGrids.tsx` as the reason: a new editor component drops the typed value.

**Verify:** run the code gate. Expected: exit code 0.

**Out of scope:** changing `Table` or `Grid`.

## Task 6: Add collapsible groups and counts to the sidebars

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/types/index.ts` — `AuthenticatedRouteGroup` gets `collapsible?: boolean`; the route type gets `count?: number`
- Modify: `apps/erp/app/components/Layout/Navigation/GroupedContentSidebar.tsx`
- Modify: `apps/erp/app/components/Layout/Navigation/DetailSidebar.tsx` — links get `isActive?: (pathname: string) => boolean` and `indent?: boolean`
- Copy from (precedent): `Collapsible` in `packages/react/src/Collapsible.tsx`; the `Count` use in `apps/erp/app/components/Layout/Navigation/DetailsTopbar.tsx`; `isActive` in `DetailsTopbar.tsx:27-37`

**Steps:**
1. In `GroupedContentSidebar`, render a group with `collapsible: true` inside a `Collapsible`.
   - The `Subheading` becomes the trigger, with a `LuChevronRight` that turns 90° when open.
   - The group starts open only when one of its routes is active.
2. Render `route.count` with `<Count>` at the right of the link when it is above 0.
3. Apply both to the phone sheet (`SheetNavGroup`) too.
4. In `DetailSidebar`, use `link.isActive(pathname)` when set, else today's `includes` rule.
5. Add `pl-8` to a link with `indent: true`.
6. Every new prop is optional. No other module may change.

**Verify:** run the code gate. Then the screenshot check on `/x/sales` (name `06-sales-sidebar-unchanged`). Expected: it looks as before.

**Out of scope:** saved views in the sidebar.

## Task 7: Add `useGovernmentContracting` and `UpgradeOverlayRow`

**Depends on:** none
**Files:**
- Create: `apps/erp/app/modules/projects/ui/useGovernmentContracting.ts`
- Modify: `apps/erp/app/components/UpgradeOverlay/UpgradeOverlay.tsx` and `index.ts` — add and export `UpgradeOverlayRow`
- Copy from (precedent): `apps/erp/app/hooks/usePlanGate.ts`; `apps/erp/app/hooks/useSettings.ts`; `UpgradeOverlayUpgradeButton` in `UpgradeOverlay.tsx`

**Steps:**
1. `useGovernmentContracting(): boolean` returns `useSettings().timekeepingControls === "DCAA" || !usePlanGate({ feature: "GOVERNMENT_CONTRACTING" }).isGated`.
2. `UpgradeOverlayRow({ title, plan })` draws ONE row: `flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm`.
   - Left: `LuLock` in `text-muted-foreground`, then `title`, then a muted "Available on the {plan} plan".
   - Right: `UpgradeOverlayUpgradeButton`.
3. Read the button's props before you use it. Pass only props its type declares.

**Verify:** run the code gate. Expected: exit code 0.

**Out of scope:** the server gates (`requireFeature`, `requireEntitlement`). They stay as they are.

## Task 8: Fix the week views on a Sunday

**Depends on:** none
**Files:**
- Modify: `packages/database/src/datasets/bootstrap.ts:136` — insert the company with `timezone`
- Modify: `packages/utils/src/timekeeping.ts` — add `timesheetWeek`
- Modify: `packages/utils/src/timekeeping.test.ts`
- Modify: `apps/erp/app/modules/projects/projects.server.ts:4581-4627` (`getTimesheetWeekView`) — use `timesheetWeek`
- Modify: `apps/mes/app/routes/x+/timesheet.tsx:86-93` — use `timesheetWeek`
- Modify: `apps/mes/app/routes/x+/timecard.tsx:90-96` — replace `new Date(...).toLocaleDateString` with `formatDate`
- Copy from (precedent): `datetime.weekBounds` in `packages/utils/src/datetime.ts:65-79`

**Steps:**
1. Run `.ai/scratch/ui-audit/q.sh "select timezone from company where id='db65d74gq0g13npk9vp0'"`. Expected: `UTC`. Write the result in the run log.
2. In `bootstrap.ts`, add `timezone` to the `INSERT INTO company` at line 136. Pass `defaultLocation.timezone`. If `defaultLocation` is not in scope there, STOP and report.
3. Add `timesheetWeek(timeZone: string, offset: number, anchor?: CalendarDate)` to `timekeeping.ts`.
   - It returns `{ weekStart, weekEnd, days, today }` as `YYYY-MM-DD` strings.
   - Build it from `datetime.weekBounds` and `datetime.businessDay`, as `getTimesheetWeekView` does at lines 4587-4594.
4. Write tests with a fixed `anchor`:
   - Sunday 2026-10-11 in `America/Chicago`, offset 0: `weekStart` is `2026-10-05`.
   - Monday 2026-10-12, offset 0: `weekStart` is `2026-10-12`.
   - Sunday 2026-10-11, offset -1: `weekStart` is `2026-09-28`.
   - `days` has 7 entries, Monday first.
5. Call `timesheetWeek` from the ERP and MES loaders. Keep their outputs the same shape.
6. Replace the `formatDay` body in `timecard.tsx` with `formatDate` from `@carbon/utils`.
7. In the browser, open Settings → Company for the demo company. Set the time zone to `America/Chicago`, the satellite plant's zone. Save.

**Verify:**
```bash
pnpm --filter @carbon/utils test
# Expected: the timesheetWeek tests pass.
pnpm exec turbo run typecheck --filter=mes
# Expected: exit code 0.
pnpm db:check:datasets -- --dataset satellite
# Expected: no violation. (Run pnpm db:migrate first if migrations are pending.)
```
Then the code gate. Then the screenshot check on `/x/timesheet` (name `08-my-time-week`). Expected: the week holds today's date in America/Chicago.

**Out of scope:** the server functions' time zone (D8). The service schedule (it already reads the company time zone).

---

# Group 2 — The module and the list (Layers 0 and 1)

## Task 9: Shrink the Projects and Service sidebars (Layer 0)

**Depends on:** Tasks 2, 6
**Files:**
- Modify: `apps/erp/app/modules/projects/ui/useProjectsSubmodules.tsx`
- Modify: `apps/erp/app/modules/service/ui/useServiceSubmodules.tsx`
- Modify: `apps/erp/app/routes/x+/projects+/_layout.tsx` and `apps/erp/app/routes/x+/project+/_layout.tsx` — load `approvalCount`
- Modify: `apps/erp/app/modules/projects/projects.service.ts` — add `getTimesheetApprovalCount`
- Modify: the People sidebar hook (find it: `grep -rln "payrollTotals" apps/erp/app/modules/people/ui`) — Layer 5
- Copy from (precedent): `apps/erp/app/modules/workflows/ui/useWorkflowsSubmodules.tsx:26-38` (literal prefix match)

**Steps:**
1. Projects groups:
   - Group `Manage` (not collapsible): Projects, My Time (`path.to.timesheet`), Approvals, Reports.
   - Group `Setup` (`collapsible: true`): Labor Categories, Planning Groups.
   - Remove Transfers and Billing. Their URLs keep working (Tasks 16 and 27 give them new entry points).
2. Show Approvals when `settings.timesheetApprovalRequired` is true or `settings.timekeepingControls === "DCAA"`. A DCAA labor transfer always waits for approval.
3. Add `getTimesheetApprovalCount(client, companyId)`: a `head: true` count of `timesheetEntry` rows with status `Submitted` for the company.
4. Load it in both layout loaders when the user has `update: projects`. Return `approvalCount`. Read it in the hook with `useMatches()` (the first match whose data has `approvalCount`). Pass it as the Approvals `count`.
5. Fix `isProjectsRoute`: replace `path.to.project("")` with the literal prefix `` `${path.to.projects.replace(/s$/, "")}/` ``. Write a comment: `generatePath` drops the trailing slash.
6. Service groups:
   - Group `Manage`: Service Orders, Schedule, My Visits.
   - Group `Setup` (`collapsible: true`): Customer Assets, Service Templates.
   - Remove My Time from the Service sidebar. It stays in the avatar menu (`AvatarMenu.tsx:170-175`).
7. Fix `isServiceOrdersRoute` the same way as step 5, with the prefix `/x/service-order/`.
8. Hide People → Payroll Totals unless `useGovernmentContracting()` is true.
9. Run `pnpm run generate:mcp`, because Step 3 adds a service function.

**Verify:** run the code gate. Then the screenshot check on:
- `/x/projects` (name `09-projects-sidebar`)
- `/x/projects/reports` (name `09-reports-one-active`): only Reports is active.
- `/x/service-orders/schedule` (name `09-service-one-active`): only Schedule is active.

Reference: `00-ref-job.png`.

**Out of scope:** the Accounting sidebar (Indirect Pools and Rates stay where they are).

## Task 10: Simplify the projects list and the New Project drawer (Layer 1)

**Depends on:** Tasks 3, 4, 9
**Files:**
- Modify: `apps/erp/app/modules/projects/ui/Projects/ProjectsTable.tsx`
- Modify: `apps/erp/app/modules/projects/ui/Projects/ProjectForm.tsx` — the create mode only
- Copy from (precedent): `apps/erp/app/modules/sales/ui/SalesReturnOrders/SalesReturnOrdersTable.tsx`; `BarProgress` in `packages/react/src/BarProgress.tsx:65-102`

**Steps:**
1. Visible columns: Identifier (pinned, `Hyperlink`), Name, Status, Owner, Due (`endDate`, header "Due"), Budget used.
2. Budget used: a new display column. Render `BarProgress` of `actual / budget`, and the percent with `usePercentFormatter`. Render `—` when `budget` is 0.
3. Hide Treatment, Budget, Actual, Committed, Start and Active with `defaultColumnVisibility`. Keep their filters and CSV export.
4. Keep `primaryAction={<New label={t\`Project\`} to={path.to.newProject} />}`.
5. Pass `emptyState={<Empty title={t\`No projects yet\`} />}` only when no filter is set.
6. In create mode, `ProjectForm` shows: Name, Identifier, Cost Treatment (and CIP Class when Capitalize), Customer, Owner.
7. Put **Copy from** in a collapsed section "Start from a copy", kept mounted (D14). Open it when `?copyFrom=` is set.
8. Every other field moves to Settings (Task 14). Keep the edit-mode fields unchanged for now.
9. If `projectValidator` requires a field you removed, STOP and report.

**Verify:** run the code gate. Then `pnpm --filter erp build`. Then the screenshot check on `/x/projects` (name `10-projects-list`) and `/x/projects/new` (name `10-new-project`). Reference: `00-ref-job.png`. Create one test project from the drawer and confirm it opens.

**Out of scope:** the `getProjects` query.

---

# Group 3 — The project workspace (Layer 2)

## Task 11: Build the project workspace shell and the project sidebar (Layer 2)

**Depends on:** Tasks 6, 9
**Files:**
- Modify: `apps/erp/app/routes/x+/project+/$projectId.tsx` — the `PanelProvider` frame and 6 new loader reads
- Create: `apps/erp/app/modules/projects/ui/Project/ProjectSidebar.tsx`
- Create: `apps/erp/app/modules/projects/ui/Project/ProjectElementTree.tsx`
- Create: `apps/erp/app/modules/projects/ui/ChangeRequests/NewChangeRequestModal.tsx` — moved out of `ChangeRequestsTable.tsx`
- Modify: `apps/erp/app/modules/projects/ui/ChangeRequests/ChangeRequestPicker.tsx` — add "New change request" and "All change requests"
- Modify: `apps/erp/app/modules/projects/ui/ChangeRequests/ChangeRequestsTable.tsx` — use `NewChangeRequestModal`
- Modify: `apps/erp/app/modules/projects/ui/Elements/ElementsHeader.tsx` — remove `ChangeRequestPicker` (it moves to the sidebar)
- Modify: `apps/erp/app/modules/projects/ui/Project/useProjectNavigation.tsx` — return sidebar links
- Modify: `apps/erp/app/modules/projects/projects.service.ts` — add `getProjectSwitcherOptions`
- Copy from (precedent): `apps/erp/app/routes/x+/sales-return-order+/$id.tsx` (frame); `apps/erp/app/modules/projects/ui/Costs/ProjectCostsTree.tsx:90-213` (`useTree`, `TreeView`, `LevelLine`); `apps/erp/app/components/BoMExplorer/BoMExplorer.tsx` (search over the tree, `h-8` rows); `DetailSidebar.tsx` (nav links); `.ai/scratch/ui-reference/flow-requirements-tree.jpg` (anatomy)

**Steps:**
1. Wrap the route in `PanelProvider`. Render the header, then `ResizablePanels` with `explorerLabel={t\`Project\`}`, `explorer={<ProjectSidebar />}` and the content `<div className="bg-card h-full overflow-y-auto w-full"><RecordOutlet /></div>`. Pass no `properties`.
2. Subtract `var(--content-inset)` in every full-height calc.
3. Loader additions, in the existing `Promise.all`:
   - `getProjectElements(client, projectId, companyId)` for the tree (id, parentId, readableId, name, type, sort order).
   - `getProjectSwitcherOptions(client, companyId)`: id, identifier, name of active, non-template `Standard` projects, ordered by identifier, at most 200 rows.
   - The open change requests that `ChangeRequestPicker` lists today (move that read from the Elements loader).
   - `hasPlanningGroups`: the company has a `planningGroup` row.
   - `hasControlAccount`: an element of the project has `isControlAccount`.
   - `hasBillingLines`: the project is Contract, and `getContractBillingLines` returns a row.
4. With `?cr=` set, overlay the tree with `loadChangeRequestOverlay` and `overlayElementList`, as `$projectId.elements.tsx` lines 286-305 do.
5. `ProjectSidebar`, top to bottom:
   1. The switcher: a `Combobox` of the switcher options, showing `identifier · name`. Choosing a project navigates to the same page of that project.
   2. A row with `ChangeRequestPicker` and an `IconButton` (`LuHistory`, aria-label "Baselines") that links to `path.to.projectBaselines(id)`.
   3. The `DetailSidebar` links:

      | Link | To | Shows |
      |---|---|---|
      | Overview | `path.to.project(id)` (exact match) | always |
      | Plan | `path.to.projectElements(id)` (also active on `/element/`) | always |
      | Schedule | `path.to.projectMilestones(id)` | always |
      | Costs | `path.to.projectCosts(id)` | always |
      | Stock (indented) | `path.to.projectStock(id)` | `project.projectStock` |
      | Pegging (indented) | `path.to.projectPegging(id)` | `project.planningGroupId` |
      | Billing (indented) | `path.to.projectBilling(id)` | `hasBillingLines` |
      | Time | `path.to.projectTime(id)` | always |

   4. While a Plan page is open, `ProjectElementTree` under the links: a search input and the tree. Each row links to `path.to.projectElement(id, elementId)` and keeps `?cr=`.
   5. Settings (`path.to.projectSettings(id)`) pinned at the bottom.
6. Move the New change request modal into `NewChangeRequestModal`. `ChangeRequestPicker` lists the open change requests, then "New change request" (opens the modal), then "All change requests" (links to `path.to.projectChangeRequests(id)`).
7. Run `pnpm run generate:mcp`.
8. Remove `ChangeRequestPicker` from `ElementsHeader.tsx`.
9. Leave `ProjectHeader` as it is. Task 12 rebuilds it.

**Verify:** run the code gate. Then the screenshot check on `/x/project/prj_PkThuk8ai72VzkQouKFDFv/elements` (name `11-workspace-plan`) and `/x/project/prj_PkThuk8ai72VzkQouKFDFv/costs` (name `11-workspace-costs`). Reference: `flow-requirements-tree.jpg`. Expected: the sidebar shows the links and the tree under Plan. For OB2 it shows Stock and Pegging under Costs. Billing shows only when a contract line bills the project.

If the element right panel no longer opens inside the new content pane, STOP and report.

**Out of scope:** the header (Task 12), the page bodies (Tasks 13–24).

## Task 12: Rebuild the project header on `RecordHeader`

**Depends on:** Task 11
**Files:**
- Modify: `apps/erp/app/modules/projects/ui/Project/ProjectHeader.tsx`
- Copy from (precedent): `apps/erp/app/modules/sales/ui/SalesReturnOrders/SalesReturnOrderHeader.tsx`; `apps/erp/app/modules/production/ui/Jobs/JobHeader.tsx:208-266` (⋯ menu), `:332-341` (`RecordHeader` call)

**Steps:**
1. Render `RecordHeader` with:
   - `title`: the identifier, then the name in `text-muted-foreground` inside `min-w-0 truncate`.
   - `titleTo={path.to.project(id)}`, `copyValue` = identifier, `onToggleExplorer`.
   - `status={<ProjectStatus status={project.status} />}` and nothing else.
2. ONE `RecordAction slot="primary"`, picked by status:

| Status | Primary action | Posts to |
|---|---|---|
| Draft | Release | `path.to.projectStatus(id)`, `status=Released` |
| Released | Work complete | `path.to.projectStatus(id)`, `status=Technically Complete` |
| On Hold | Resume | `path.to.projectStatus(id)`, `status=Released` |
| Technically Complete | Close (the existing `Confirm`) | `path.to.projectStatus(id)`, `status=Closed` |
| Closed | none | |
| any, during stop-work | Resume work | `path.to.projectStopWork(id)`, `intent=resume` |

3. The ⋯ menu, in this order:
   1. Put on hold (Released)
   2. Reopen (Technically Complete)
   3. Place in service (Capitalize with an asset under construction)
   4. Stop work (Released, Direct; ee)
   5. separator
   6. Baselines, Change requests (links)
   7. Copy project (link to `newProject?copyFrom=`)
   8. Template (the checkbox item)
4. Disable, never hide, an item the user may not use.
5. Remove the cost treatment `Enumerable`, the owner avatar, the stop-work badge and the overdue borrows badge. Task 13 shows them on Overview.
6. Remove `DetailsTopbar`. Delete the tab links in `useProjectNavigation.tsx` that Task 11 did not reuse.

**Verify:** run the code gate. Then the screenshot check on `/x/project/prj_PkThuk8ai72VzkQouKFDFv` at 1440 (name `12-header-1440`). Then run `AGENT_BROWSER_SESSION=ui-rebuild agent-browser set viewport 1024 768` and shoot again (name `12-header-1024`). Reference: `bad-project-header.jpg` (must not look like it) and `00-ref-job.png`. Open ICR (Draft) and confirm the primary action is Release; do not click it, because a Capitalize release creates assets. On NSG3, run Put on hold, then Resume. Expected: NSG3 ends Released.

**Out of scope:** the status route (`$projectId.status.tsx`).

## Task 13: Add the project Overview page

**Depends on:** Tasks 4, 11, 12
**Files:**
- Modify: `apps/erp/app/routes/x+/project+/$projectId._index.tsx` — remove the redirect; add a loader and a page
- Create: `apps/erp/app/modules/projects/ui/Project/ProjectOverview.tsx`
- Copy from (precedent): `apps/erp/app/modules/sales/ui/SalesOrder/SalesOrderSummary.tsx` (a quiet summary card); `ReadOnlyFields` (Task 4)

**Steps:**
1. Loader reads: `getProjectCostSummary`, `getProjectMilestones`, the count of open change requests (Draft, In Review, Approved), and the count from `getProjectOpenTimesheetEntries`. It reads `today` in the company time zone.
2. The page has no form and no button except links. Sections:
   1. Facts (`ReadOnlyFields`): Status, Owner, Customer, Start, Due, Cost treatment (`termId="cost-treatment"`).
   2. Budget: `BarProgress` of actual vs budget, with Budget, Committed and Actual as money.
   3. Next milestone: the first milestone not completed whose end date is on or after today. Show its name, dates and element progress, linked to Schedule.
   4. Needs attention: one linked row per item that is not zero.
      - Stop-work, with its end date.
      - Overdue borrows, linked to Stock.
      - Open change requests, linked to Change requests.
      - Time not posted yet, linked to Time.
      - With no item, show `<Empty title={t\`Nothing needs attention\`} description={null} />`.
3. Keep every query outside loops.

**Verify:** run the code gate. Then the screenshot check on `/x/project/prj_PkThuk8ai72VzkQouKFDFv` (name `13-overview`). Reference: `flow-agent-panel.jpg` (quiet panels). Expected: no input box anywhere.

**Out of scope:** charts beyond `BarProgress`.

## Task 14: Fold Details into the project Settings page

**Depends on:** Tasks 7, 11
**Files:**
- Modify: `apps/erp/app/routes/x+/project+/$projectId.settings.tsx` — the page
- Modify: `apps/erp/app/routes/x+/project+/$projectId.details.tsx` — keep the action; the loader redirects to Settings; remove the default export
- Modify: `apps/erp/app/modules/projects/ui/Projects/ProjectForm.tsx` — the edit mode
- Modify: `apps/erp/app/modules/projects/ui/Project/ProjectControlSettings.ee.tsx` — gated state becomes `UpgradeOverlayRow`
- Modify: `apps/erp/app/modules/projects/ui/Project/ProjectStates.tsx`, `ProjectLabels.tsx` — empty states only
- Copy from (precedent): `apps/erp/app/routes/x+/settings+/inventory.tsx` (cards, `max-w-[400px]` fields, `CardFooter` Save); `redirectBeforeLoaders` in today's `$projectId._index.tsx`

**Steps:**
1. Page column: `VStack className="p-4 max-w-[60rem] mx-auto gap-4"`.
2. Card "Project": `ProjectForm` in edit mode, posting to `path.to.projectDetails(id)` (the action stays).
   - Always visible: Name, Identifier (read-only), Description, Customer, Owner, Location, Priority, Start Date, End Date.
   - Collapsed sections, kept mounted (D14):

     | Section | Fields |
     |---|---|
     | Accounting | Cost Treatment, CIP Class or Cost Account, Cost Objective |
     | Stock and planning | Project stock and its two flags, Planning Group, Planning Priority |
     | Charging | Restrict charging to members |
     | Plan lock | Lock Plan After Milestone |

   - Show Cost Objective only when `useGovernmentContracting()` is true. Show Planning Group and Priority only when `hasPlanningGroups` is true.
   - Pass `termId` on Cost Treatment (`cost-treatment`), Cost Objective (`cost-objective`), Project stock (`project-stock`), Planning Group (`planning-group`).
   - Pass `bordered` on every `Boolean`.
3. Card "Members", only when `restrictCharging` is on.
4. Cards "States" and "Labels" (existing components). Replace "No labels yet." with `Empty`.
5. Card "Project control": the entitled form as today, with `bordered` booleans; when gated, one `UpgradeOverlayRow` instead of `UpgradeOverlaySection`.
6. `$projectId.details.tsx` loader: `throw redirect(path.to.projectSettings(projectId))` through `redirectBeforeLoaders`.
7. After a save, the action's redirect goes to Settings. Change only the redirect target.

**Verify:** run the code gate. Then:
1. The screenshot check on `/x/project/prj_PkThuk8ai72VzkQouKFDFv/settings` (name `14-settings`). Reference: `00-ref-settings-inventory.png`.
2. Open `/x/project/prj_PkThuk8ai72VzkQouKFDFv/details`. Expected: it lands on `/settings`.
3. With "Accounting" collapsed, change the Description and save. Then run `.ai/scratch/ui-audit/q.sh "select \"costTreatment\", \"costAccountId\" from project where id='prj_PkThuk8ai72VzkQouKFDFv'"`. Expected: the same values as before the save.

**Out of scope:** the details action's validation and checks.

## Task 15: Simplify the Costs page

**Depends on:** Tasks 7, 11
**Files:**
- Modify: `apps/erp/app/routes/x+/project+/$projectId.costs.tsx`
- Modify: `apps/erp/app/modules/projects/ui/Costs/ProjectEarnedValue.ee.tsx`
- Modify: `apps/erp/app/modules/projects/ui/Costs/ProjectLedgerTable.tsx` — `emptyState`
- Modify: `apps/erp/app/routes/x+/project+/$projectId.costs.$elementId.tsx`
- Copy from (precedent): `ProjectCostsTree.tsx` (keep); `apps/erp/app/modules/production/ui/Jobs/` costs view for section headings

**Steps:**
1. Keep `ProjectCostsTree`, `ServiceOrderCosts` and `ProjectBurdenByPool` (both hide when empty).
2. Render `ProjectEarnedValue` only when `hasControlAccount` is true (Layer 5).
3. When earned value is gated, render one `UpgradeOverlayRow` instead of `UpgradeOverlaySection`.
4. Rename the earned value headers per *Terminology*: Planned value, Earned value, Actual cost. Pass `termId` `planned-value`, `earned-value`, `actual-cost`, `control-account`.
5. Give every section the same heading: `Subheading as="h3" variant="light"`.
6. Pass `emptyState={<Empty title={t\`No costs posted yet\`} description={null} />}` to `ProjectLedgerTable`.

**Verify:** run the code gate. Then the screenshot check on `/x/project/prj_PkThuk8ai72VzkQouKFDFv/costs` (name `15-costs`) and on the first element row's drawer (name `15-costs-drawer`). Reference: `00-project-costs.png`.

**Out of scope:** the cost figures and `buildProjectCostFigures`.

## Task 16: Rebuild the Stock, Pegging and Billing pages under Costs

**Depends on:** Tasks 3, 7, 11
**Files:**
- Modify: `apps/erp/app/modules/projects/ui/Stock/ProjectStock.tsx`
- Modify: `apps/erp/app/routes/x+/project+/$projectId.stock.tsx` — also load the project's transfers
- Modify: `apps/erp/app/modules/projects/ui/Pegging/ProjectPegging.tsx`, `ManualPegForm.tsx`
- Modify: `apps/erp/app/routes/x+/project+/$projectId.billing.tsx`, `apps/erp/app/modules/projects/ui/Billing/ProjectBillingLines.tsx`, `ProjectBillableItemsTable.tsx`
- Copy from (precedent): `apps/erp/app/modules/inventory/ui/` Quantities table (a `Table` with a toolbar action); `SplitButton` in `JobHeader.tsx:499-525`

**Steps:**
1. Stock: one toolbar row with a `SplitButton` "Transfer" (dropdown: Borrow, Payback). Under it, one `Table compact` per list: Stock, Borrowed by this project, Lent by this project, Transfers.
   - Each table passes an `Empty` with a specific title: "No project stock", "Nothing owed", "Nothing lent", "No transfers".
   - Transfers lists this project's transfers. If `getProjectStockTransfers` cannot filter by project, STOP and report.
   - Add a link "All transfers" to `path.to.projectStockTransfers`.
   - Use "Unassigned stock" wherever an owner is null.
2. Pegging: put the "As of" `DatePicker` inside a `w-44` wrapper in the toolbar row. Replace the dashed box with `Empty`. Keep the page-level `PlanningGroupsUpgradeOverlay`.
3. Billing: one heading per section, both `Subheading as="h3" variant="light"`. Replace the plain text in `ProjectBillingLines` with `Empty`. Pass an `Empty` to `ProjectBillableItemsTable` as `emptyState`.
4. Pass `termId`: `billing-element`, `billable-item`, `peg`, `borrow-payback`, `payback-variance`, `unassigned-stock`.

**Verify:** run the code gate. Then the screenshot check on `/stock`, `/pegging` and `/billing` of OB2 (names `16-stock`, `16-pegging`, `16-billing`). Reference: `00-ref-job.png`.

**Out of scope:** the transfer routes and posting.

## Task 17: Simplify the Time page

**Depends on:** Tasks 3, 11
**Files:**
- Modify: `apps/erp/app/routes/x+/project+/$projectId.time.tsx`
- Copy from (precedent): `apps/erp/app/modules/projects/ui/Costs/ProjectLedgerTable.tsx`

**Steps:**
1. Replace the raw `TableBase` "Time not posted yet" with a `Table compact` (Date, Employee, Element, Labor Category, Hours, Status). Turn off its pagination, search and CSV.
2. Give it `emptyState={<Empty title={t\`All time is posted\`} description={null} />}`.
3. Give the ledger the same `Empty` as Task 15.
4. Use one heading style: `Subheading as="h3" variant="light"`.
5. Billing is not on this page (IA: it sits under Costs).

**Verify:** run the code gate. Then the screenshot check on `/x/project/prj_PkThuk8ai72VzkQouKFDFv/time` (name `17-time`). Reference: `00-ref-job.png`.

**Out of scope:** timesheet posting.

## Task 18: Turn Milestones into the Schedule page

**Depends on:** Tasks 3, 11
**Files:**
- Modify: `apps/erp/app/routes/x+/project+/$projectId.milestones.tsx`
- Modify: `apps/erp/app/modules/projects/ui/Milestones/MilestonesList.tsx` — becomes a `Table`
- Create: `apps/erp/app/modules/projects/ui/Milestones/MilestoneTimeline.tsx`
- Copy from (precedent): `apps/erp/app/modules/projects/ui/Elements/timeline-geometry.ts` (`dayIndex`, `barRect`, `defaultWindow`); `SalesReturnOrdersTable.tsx` (row menu)

**Steps:**
1. The page title in the breadcrumb and sidebar is "Schedule". The URL stays `/milestones`.
2. `MilestoneTimeline`: one bar per milestone from start to end, a today line, month ticks. Use the geometry helpers. No drag.
3. Under it, a `Table compact`: Name, Status (Active, Upcoming, Completed), Start, End, Progress (`BarProgress` of done elements), Hours, Cost.
4. `primaryAction`: New Milestone (the existing `MilestoneForm` drawer).
5. Row menu: Edit, Complete or Reopen, Burn chart (sets `?milestone=`), then Delete last.
6. Show `MilestoneBurnChart` under the table while `?milestone=` is set.
7. Replace the dashed empty card with `Empty title={t\`No milestones yet\`}`.
8. Keep every intent (`upsert`, `complete`, `reopen`, `delete`).

**Verify:** run the code gate. Then `pnpm --filter erp build`. Then the screenshot check on `/x/project/prj_PkThuk8ai72VzkQouKFDFv/milestones` (name `18-schedule`). Reference: `00-ref-job.png`.

**Out of scope:** dependencies between milestones.

---

# Group 4 — Plan (Layer 3)

## Task 19: Reduce the Plan loader to Table, Tree and Reader

**Depends on:** Task 11
**Files:**
- Modify: `apps/erp/app/routes/x+/project+/$projectId.elements.tsx` (loader lines 137-338, component lines 376-443, `shouldRevalidate` 105-135)
- Delete: `apps/erp/app/routes/x+/project+/$projectId.views.tsx`
- Modify: `apps/erp/app/modules/projects/projects.service.ts` — delete `getProjectViews`, `upsertProjectView`, `deleteProjectView`, `getProjectUserPreference`, `upsertProjectUserPreference` (lines 3990-4107)
- Modify: `apps/erp/app/modules/projects/projects.models.ts` — delete the view and display models (lines 2679-2828) that lose every caller
- Modify: `apps/erp/app/utils/path.ts` — delete `projectViews`

**Steps:**
1. `projectLayouts` becomes `["table", "tree", "reader"]`. The default is `table`.
2. When `layout` is missing, or is `list`, `board` or `timeline`, redirect to the same URL with `layout=table`. Keep every other param, `cr` included.
3. Remove the view reads and the preference reads from the route.
4. Remove the `savePreference` post, `selectView`, `viewSaved` and the local display state.
5. Remove the `savePreference` branch of `shouldRevalidate`.
6. Move the Type filter into the Filter popover:
   1. Add a `type` definition to the filter definitions (route lines 485-545), options from `projectElementTypes`.
   2. Make `parseElementFilters` read `filter=type:in:...` too. Keep the old `?type=` param working for links and the Reader PDF.
7. Keep `elementGroupings` if the Table still groups.
8. Grep the repo for each deleted name before you delete it.
9. Run `pnpm run generate:mcp`.

**Verify:**
```bash
grep -rn "getProjectViews\|projectUserPreference\|savePreference\|projectViews" apps/erp/app | wc -l
# Expected: 0.
```
Then the code gate. Then the screenshot check on `/x/project/prj_PkThuk8ai72VzkQouKFDFv/elements?layout=board` (name `19-plan-redirect`). Expected: the URL ends with `layout=table`.

**Out of scope:** the `projectView` and `projectUserPreference` tables (no migration).

## Task 20: Give Plan one toolbar row and add rows in the grid

**Depends on:** Tasks 5, 19
**Files:**
- Modify: `apps/erp/app/modules/projects/ui/Elements/ElementsHeader.tsx`
- Modify: `apps/erp/app/modules/projects/ui/Elements/ElementTable.tsx`
- Modify: `apps/erp/app/routes/x+/project+/$projectId.elements.tsx` — remove the table's `QuickAddRow`
- Copy from (precedent): `SplitButton` in `packages/react/src/SplitButton.tsx:21-35` and `JobHeader.tsx:499-525`; `Tabs` in `packages/react/src/Tabs.tsx`; `flow-requirements-tree.jpg` (the toolbar)

**Steps:**
1. The toolbar row, left to right:
   1. `SplitButton` "New Element". A click creates a Task. The dropdown lists the 7 types, a separator, then Build from part.
   2. `Tabs` Table / Tree / Reader. They write `layout`.
   3. `Filter` (state, owner, milestone, label, type).
   4. `SearchFilter param="search"`.
   5. A ⋯ `DropdownMenu` "Display": Group by (Table only), Export PDF (Reader only).
2. Show `ActiveFilters` chips in a second row only while a filter is set.
3. While the plan is locked, disable **New Element** with a tooltip that links to the change requests page. Remove the separate "Plan locked" control.
4. **New Element** posts `type`, a default name and `parentId` to `path.to.newProjectElement` through `withChangeRequest`. Use one `msg` per type for the default name (`New Task`, `New Requirement`, …), never a ternary inside `t`.
5. `parentId` is the element whose right panel is open, else none.
6. After the post, highlight the new row with `getRowClassName`.
7. Make the Name column editable with `EditableText`. `name` is in `projectElementEditableFields`.
8. Build every editor with `useStableEditableComponents`.
9. Turn off the `Table`'s own toolbar so it adds no second row: `withSearch={false}`, `withColumnOrdering={false}`, `withCsvExport={false}`, `withSidebarTrigger={false}`, no `title`. If a toolbar row still renders, STOP and report.
10. Remove the title "Elements" and its count.
11. Pass `emptyState={<Empty title={t\`No elements yet\`} />}`.

**Verify:** run the code gate. Then the screenshot check on `/x/project/prj_PkThuk8ai72VzkQouKFDFv/elements` (name `20-plan-table`) and with `layout=reader` (name `20-plan-reader`). Reference: `flow-requirements-tree.jpg` and `00-ref-inventory-count.png`. Create a Task with **New Element** and rename it in the grid. Then delete it from its row menu.

**Out of scope:** the Tree layout (Task 22).

## Task 21: Delete the List, Board and Timeline layouts

**Depends on:** Tasks 18, 20
**Files:**
- Delete: `apps/erp/app/modules/projects/ui/Elements/ElementList.tsx`, `ElementBoard.tsx`, `ElementTimeline.tsx`
- Create: `apps/erp/app/modules/projects/ui/Element/QuickAddRow.tsx` — moved from `ElementList.tsx:466-585`, for `ElementChildren`
- Modify: `apps/erp/app/modules/projects/ui/Elements/ElementTable.tsx` — own the `ElementLayoutProps` type
- Modify: `apps/erp/app/modules/projects/ui/Elements/ElementProperties.tsx` — delete `ElementProperties` (line 1034), `ActualPill` (993), `ElementPillData`, `elementFieldKey`
- Modify: `apps/erp/app/modules/projects/projects.models.ts` — delete `timelineZooms` if it has no caller
- Keep: `timeline-geometry.ts` and `apps/erp/test/projects-timeline-geometry.test.ts` (Task 18 uses them)

**Steps:**
1. For each export of the 3 files, grep the whole repo. Fix or move each hit first.
2. Move `QuickAddRow` and keep its behavior for `ElementChildren`.
3. Delete the files and the dead pieces.

**Verify:**
```bash
grep -rn "ElementList\b\|ElementBoard\|ElementTimeline\b" apps/erp/app | wc -l
# Expected: 0.
```
Then the code gate.

**Out of scope:** `ElementReader.tsx` and the Reader PDF route.

## Task 22: Restyle the Tree cards and fix the fit-view

**Depends on:** Task 19
**Files:**
- Modify: `apps/erp/app/modules/projects/ui/Elements/graph/ElementCardNode.tsx`, `ElementBoxNode.tsx`
- Modify: `apps/erp/app/modules/projects/ui/Elements/ElementGraph.tsx` (fit at lines 341-346, 447-458)
- Copy from (precedent): `flow-requirements-tree.jpg`, `flow-tests-trace.jpg`; `apps/erp/app/modules/settings/ui/Companies/CompaniesTreeView.tsx:32-36,65-68` (`useNodesInitialized`)

**Steps:**
1. Card, top to bottom:
   - Row 1, left: the type icon and the type label in `text-xs text-muted-foreground`.
   - Row 1, right: the comment count, the link count (muted icon and number), and the owner avatar.
   - Row 2: the name, `line-clamp-2`, `text-sm`.
   - Row 3: at most one chip, the state.
   - Keep the amber border for a link that needs review. Keep the readable id in the card's `title` tooltip.
2. Box: the label (icon, parent name, Focus button) sits above the box. The box is `rounded-lg border border-border bg-muted/30`, with no type tint.
3. Fit-view:
   1. Fit only after `useNodesInitialized()` is true and the container is wider and taller than 0.
   2. Re-fit when the container resizes (`ResizeObserver`).
   3. Call `fitView({ padding: 0.15, maxZoom: 1 })`.
   4. If the zoom after that is below 0.5, call `fitView({ nodes: <the top box and its first 6 cards>, padding: 0.15, maxZoom: 1 })`.
   5. Set `minZoom` to 0.1 so a user can still zoom out by hand.
4. Never call `stopPropagation` inside a node. Keep `nodrag` and `data-graph-action` on in-node buttons.

**Verify:**
```bash
pnpm --filter erp test -- tree-layout
# Expected: tree-layout.test.ts passes.
```
Then the code gate. Then `pnpm --filter erp build`. Then the screenshot check on `/x/project/prj_PkThuk8ai72VzkQouKFDFv/elements?layout=tree` (name `22-plan-tree`) and the same for NSG3 (name `22-plan-tree-nsg3`). Reference: `flow-requirements-tree.jpg`. Expected: the cards are readable at first paint, not a speck.

**Out of scope:** `tree-layout.ts` maths.

---

# Group 5 — The element (Layer 4)

## Task 23: Rebuild the element panel and page (Layer 4)

**Depends on:** Tasks 7, 11
**Files:**
- Modify: `apps/erp/app/modules/projects/ui/Element/ElementView.tsx`
- Modify: `apps/erp/app/modules/projects/ui/Element/ElementSidebar.tsx` — becomes the Details section body
- Modify: `apps/erp/app/modules/projects/ui/Element/ElementEarnedValue.ee.tsx` — autosave, no Save button
- Modify: `apps/erp/app/modules/projects/ui/Element/ElementTimeAndMaterials.tsx`
- Modify: `apps/erp/app/routes/x+/project+/$projectId.element.$elementId.tsx`, `$projectId.elements.$elementId.tsx`
- Copy from (precedent): `Collapsible` in `packages/react/src/Collapsible.tsx`; `flow-agent-panel.jpg` (a calm right panel); `IssueProperties.tsx` (inline autosave)

**Steps:**
1. Header: type icon, readable id with `Copy`, the name (editable inline as today), the state pill. On the right: expand icon (panel only, links to `path.to.projectElementFull`), ⋯ (Delete), close (panel only).
2. Five `Collapsible` sections. Details starts open. The others start closed and show a count in the trigger when they have rows.
   1. **Details**: the description, the `ElementSidebar` properties, the type block and the children list. `ElementTypeBlock` already shows only for a Requirement or a Parameter.
   2. **Plan**: `ElementPlanLines` (Task 24 makes it a grid).
   3. **Time**: `ElementTimeAndMaterials` with ONE **Log time** and ONE **Issue material** button, and the Budget block.
   4. **Links**: `ElementLinks`.
   5. **Comments**: the activity and comments.
3. Remove the action row under the description that repeated **Log time** and **Issue material** (`ElementView.tsx:181-188`, `:301`).
4. Layer 5 inside Details:
   - Show Unallowable, Preproduction, Leave, Business component and Research role only when `useGovernmentContracting()` is true.
   - Show the Earned value sub-section only when `useGovernmentContracting()` is true. When gated, show one `UpgradeOverlayRow`.
5. Earned value saves on each field change. Post `intent=earned-value` with all its fields to the same action as today. Remove its `Submit`.
6. The page variant renders the same sections in a `max-w-4xl` column, with no separate right sidebar.
7. Pass `bordered` on every boolean and `termId` on Control account, Work package, Unallowable (`allowability`), Preproduction, Business component, Research role.

**Verify:** run the code gate. Then the screenshot check on:
- `/x/project/prj_PkThuk8ai72VzkQouKFDFv/elements/pje_LhH99coneGU1Q6ziQZc6Nx` (name `23-element-panel`)
- `/x/project/prj_PkThuk8ai72VzkQouKFDFv/element/pje_LhH99coneGU1Q6ziQZc6Nx` (name `23-element-page`)

Reference: `flow-agent-panel.jpg` and `00-project-element.png`. Expected: one Log time button, sections collapsed except Details.

**Out of scope:** the element update route.

## Task 24: Put all plan lines in one grid

**Depends on:** Tasks 5, 23
**Files:**
- Modify: `apps/erp/app/modules/projects/ui/Element/ElementPlanLines.tsx` — replace `PlanLineModal` with a grid
- Modify: `apps/erp/app/routes/x+/project+/$projectId.elements.$elementId.plan.tsx` — answer `data({ error })` for `quiet=true`
- Modify: `apps/erp/app/routes/x+/service-orders+/templates_.$id.$elementId.tsx` — the same quiet answer in its action
- Copy from (precedent): `apps/erp/app/modules/sales/ui/Contracts/ContractRevenueGrid.tsx` (grid, `rowMenuColumn`, `setupGridHeight`, a button under the grid); `apps/erp/app/modules/inventory/ui/InventoryCount/InventoryCountLines.tsx`

**Steps:**
1. One `Table compact withInlineEditing forceEditMode={canEdit}`. Rows are the material, labor and cost lines merged, each with `type`.
2. Columns:

| Column | Material | Labor | Cost |
|---|---|---|---|
| Type | badge, read-only | badge | badge |
| Line | Item (`EditableList` with options from `useItems()`) | Labor Category (`EditableList`) | Description (`EditableText`) |
| Method | `EditableList` of method types, plus the job or PO link | — | — |
| Quantity | Quantity (`EditableNumber`) with unit | Hours (`EditableNumber`) | — |
| Unit cost | `EditableNumber` (rate kind) | — | — |
| Amount | quantity × unit cost, read-only | — | Amount (`EditableNumber`, money) |
| Date | Required (`EditableDate`) | Start (`EditableDate`) | — |
| End | — | End (`EditableDate`) | — |

3. Use `EditableByRow` for Line, Quantity, Amount and Date. A "—" cell is read-only text.
4. `onCellEdit` posts the WHOLE row merged with the change, with `intent` `upsertMaterial`, `upsertLabor` or `upsertCost` by type, through `useCellSave`. The validators stay the same.
5. Under the grid: a `SplitButton` "Add line" (Material, Labor, Cost). It appends a draft row in local state. A draft row posts once its required fields are set; read the defaults from today's `PlanLineModal` form.
6. Row menu (`rowMenuColumn`): Create Job and Create PO line (materials, when `canSupply`), then Delete (`ConfirmDelete` with today's `delete*` intent).
7. Keep the `action` override prop for service templates.
8. `Empty` with `title={t\`Nothing planned yet\`}` when there are no rows and no draft.

**Verify:** run the code gate. Then `pnpm --filter erp build`. Then the screenshot check on:
- `/x/project/prj_PkThuk8ai72VzkQouKFDFv/element/pje_Ew3YnQzXe2DhMs6U1KvNUT` (name `24-plan-lines`)
- `/x/service-orders/templates/prj_MPQJL28XuzqBQrxcd42HAF/pje_DH8tJXhnf9Eqt85rPgmw2G` (name `24-template-lines`)

Reference: `00-ref-inventory-count.png` and `.ai/scratch/ui-audit/92b-ref-purchasing-planning-order-drawer.png`. Edit a quantity, add a cost line, then delete it.

**Out of scope:** the Create Job and Create PO line routes.

---

# Group 6 — Time

## Task 25: Rebuild ERP My Time as a grid

**Depends on:** Tasks 5, 8
**Files:**
- Modify: `apps/erp/app/modules/projects/ui/Timesheet/TimesheetGrid.tsx`
- Modify: `apps/erp/app/routes/x+/timesheet.tsx` — the breadcrumb says "My Time"
- Copy from (precedent): `ContractRevenueGrid.tsx:172-219` (per-column `footer`, a row total), `:303-310` (a button under the grid that opens a modal); `InventoryCountLines.tsx:704-724`

**Steps:**
1. The header row holds 3 things:
   1. The title "My Time".
   2. The week navigation: previous, the range, next, and "This week" when another week is open.
   3. ONE primary action: **Submit week**, or the DCAA certification.
2. Put "Add row" under the grid as a secondary button. It opens today's `AddRowModal`.
3. One `Table compact withInlineEditing forceEditMode` with:
   - A pinned Charge Number column (readable id and name, labor category under it in `text-xs text-muted-foreground`).
   - One `EditableNumber` column per day (hours 0–24, `INPUT_FORMAT.quantity`).
   - A read-only Total column.
4. Footer per day column: the day total, and under it the timecard hours, orange when they differ. Footer of Total: the week total.
5. Locked cells: an `EditableByRow` day editor returns read-only text for a locked cell, using today's rules (lines 190-201, 521-566). A Posted cell shows a "Correct" action in the row menu.
6. DCAA: before a save, await today's `onRequestReasons`. If it resolves false, return an error so the cell reverts.
7. Save through `useCellSave` to `path.to.timesheetUpdate` with today's cell key fields.
8. Keep `CertificationModal`, `TimesheetChangeModal`, `TimesheetReviewBanner` and `TimesheetRevisionsPopover`.
9. Replace the dashed empty card with `Empty title={t\`No time this week\`}`.
10. The manager route `projects+/timesheets.$employeeId.tsx` uses the same component. Check it too.

**Verify:** run the code gate. Then the screenshot check on `/x/timesheet` (name `25-my-time`) and `/x/timesheet?week=-1` (name `25-my-time-last-week`). Reference: `00-ref-inventory-count.png`; must not look like `bad-timesheet-inputs.jpg`. Type 2 hours on a Draft day, press Tab, and confirm the total changes.

**Out of scope:** the server functions.

## Task 26: Rebuild MES My Time as a touch grid

**Depends on:** Task 8
**Files:**
- Modify: `apps/mes/app/routes/x+/timesheet.tsx` (layout lines 347-485, `DayCell` 512-612)
- Copy from (precedent): `apps/mes/app/components/Inspection/InspectionMeasurementMatrix.tsx:85-88, 543-583, 731-748` (touch cells, sticky header and first column); `.claude/skills/carbon-design/references/shop-floor-mes.md`

**Steps:**
1. One header row: "My Time", previous, the range, "This week", next, **Add row** (secondary, `size="lg"`), **Submit week** (primary, `size="lg"`).
2. Draw one `<table>`:
   - a sticky header with the days;
   - a sticky first column with the charge number and the labor category;
   - one cell per day, and a Total column.
3. Each cell is a borderless `<input inputMode="decimal">` with `min-h-12`, a focus ring, commit on blur and on Enter. Keep `DayCell`'s save and revert logic.
4. A footer row with the day totals and the week total. Delete the totals card and the row cards.
5. Keep `AddRowSheet`.
6. Use the same label as the ERP for the submit button.

**Verify:** run `pnpm exec turbo run typecheck --filter=mes` and `pnpm --filter mes test`. Expected: exit code 0. Then the code gate. Then the screenshot check on mes `/x/timesheet` (name `26-mes-my-time`). Reference: `25-my-time.png`. Type an hour and confirm the total changes.

**Out of scope:** the MES DCAA reason modal (a known gap).

## Task 27: Rebuild Approvals with Time and Billing tabs

**Depends on:** Tasks 9, 25
**Files:**
- Modify: `apps/erp/app/routes/x+/projects+/approvals.tsx` — two tabs; the Billing tab loads the billable items
- Modify: `apps/erp/app/modules/projects/ui/Timesheet/TimesheetApprovals.tsx`
- Modify: `apps/erp/app/routes/x+/projects+/billing.tsx` — the loader redirects to `approvals?tab=billing` and keeps the query string
- Copy from (precedent): `Tabs` in `packages/react/src/Tabs.tsx`; `ProjectBillableItemsTable.tsx`

**Steps:**
1. Page header: the title "Approvals" and `Tabs` Time / Billing, written to `?tab=`.
2. Time tab: today's `TimesheetApprovals` with `Empty title={t\`Nothing to approve\`}`.
3. Billing tab: `ProjectBillableItemsTable` with today's Billing loader logic. The default statuses stay Unbilled and On Hold. Its `Empty` says that the list shows Unbilled and On Hold items only.
4. Keep both actions: the approvals intents and `billing.update.tsx`.
5. Show the Billing tab only to users with `view: sales`, as today.
6. Redirect `/x/projects/billing` to `/x/projects/approvals?tab=billing`.

**Verify:** run the code gate. Then `pnpm --filter erp build` and `pnpm --filter mes build`. Then the screenshot check on `/x/projects/approvals` (name `27-approvals-time`) and `/x/projects/billing` (name `27-approvals-billing`). Reference: `00-ref-job.png`.

**Out of scope:** the approval rules.

---

# Group 7 — Other grids

## Task 28: Edit labor category rates in a grid

**Depends on:** Task 5
**Files:**
- Modify: `apps/erp/app/modules/projects/ui/LaborCategories/LaborCategoryForm.tsx` (rates lines 154-271, `RateModal` 276-348)
- Modify: `apps/erp/app/routes/x+/projects+/labor-categories.$id.tsx` — `intent=rate` answers `data({ error })` for `quiet=true`
- Copy from (precedent): `apps/erp/app/modules/items/ui/Item/SupplierParts/SupplierParts.tsx` (`Grid` with `onNewRow`)

**Steps:**
1. Replace the rates `TableBase` and `RateModal` with a `Grid`: Effective From (`EditableDate`), Cost Rate and Bill Rate (`EditableNumber`, rate kind).
2. `onNewRow` appends a draft row. It posts once Effective From and Cost Rate are set.
3. Each edit posts the whole row with `intent=rate` and its `id` through `useCellSave`.
4. Show no delete: there is no delete endpoint. Write it in the run log as a known gap.
5. Pass `termId="bill-rate"` on the Bill Rate header and `bordered` on every boolean in the form.

**Verify:** run the code gate. Then the screenshot check on `/x/projects/labor-categories/lbc_H5erqLUCtjGW7vnX5oHL5s` (name `28-labor-rates`). Reference: `92b-ref-purchasing-planning-order-drawer.png`. Edit a bill rate and reload.

**Out of scope:** the category fields.

## Task 29: Edit contract labor rates, funding actions and rate ceilings in grids

**Depends on:** Tasks 5, 7
**Files:**
- Modify: `apps/erp/app/modules/sales/ui/Contracts/ContractLaborRates.tsx`, `ContractFundingActions.tsx`, `ContractRateCeilings.ee.tsx`, `ContractLineBilling.tsx`
- Modify: `apps/erp/app/routes/x+/contract+/$id.$lineId.labor-rates.tsx`, `$id.$lineId.funding-actions.tsx` — the quiet answer
- Copy from (precedent): `ContractRevenueGrid.tsx` (Table with footer and row menu)

**Steps:**
1. Labor rates: a `Table compact` grid. Columns: Applies to (one `EditableList` of "Labor category: X" and "Employee: Y" options), Bill Rate, Effective From. Posting maps the choice to `laborCategoryId` or `employeeId`.
2. Funding actions: Modification Number, Funded Date, ACRN, Expires On, Funded Cost, Funded Fee, with a footer total. Show the card only when `useGovernmentContracting()` is true or the line has actions.
3. Rate ceilings: the same grid pattern with today's fields.
4. Put an "Add …" button under each grid. It appends a draft row.
5. Give each grid a row menu with Delete (`ConfirmDelete` with today's intent).
6. Each edit posts the whole row with today's `upsert` or `ceiling-upsert` intent.
7. In `ContractLineBilling`, keep ONE primary action (**Generate Billable Items**). Move Edit Funding and the Line Details link into a ⋯ menu.
8. Pass `termId`: `acrn`, `funding-action`, `rate-ceiling`, `bill-rate`.
9. The demo has no Time & Materials or Cost Plus line. Create one Draft test contract with one Time & Materials line in the UI to see the grids. If you cannot, write "unverified in the browser" in the run log.

**Verify:** run the code gate. Then `pnpm --filter erp build`. Then the screenshot check on the test line's Billing page (name `29-contract-billing`). Reference: `25-my-time.png`.

**Out of scope:** the funding sync rules.

---

# Group 8 — Service

## Task 30: Fix My Visits, the Build from part drawer and the Service empty states

**Depends on:** Tasks 2, 3
**Files:**
- Modify: `apps/erp/app/modules/service/ui/Visits/MyVisits.tsx:61-65`
- Modify: `apps/erp/app/modules/projects/ui/Elements/BuildFromPartDrawer.tsx:406-427` — the drawer button order
- Modify: `apps/erp/app/modules/service/ui/CustomerAssets/CustomerAssetsTable.tsx:228-234`, `ServiceOrders/ContractServiceOrders.tsx:65`, `Billing/BillableItemsTable.tsx:171`, `Visits/VisitsList.tsx:72`, `Visits/VisitPage.tsx:218,458`, `Visits/ServiceSchedule.tsx:191`, `Work/WorkTree.tsx:176`, `Work/NodePeek.tsx:237`, `CustomerAssets/ComponentHistory.tsx:51`, `CustomerAssets/CustomerAssetPage.tsx:254`
- Copy from (precedent): `SettingsPageHeading` for the left-aligned title; `CustomerTypeForm.tsx:99-107` (drawer footer order)

**Steps:**
1. My Visits: put the title in a left-aligned page header row, `max-md:hidden`, as other module pages do. Keep the list column.
2. Build from part drawer footer: `[Create elements] [Cancel]`, with Cancel `variant="solid"`.
3. Replace each plain-text or dashed empty state in the listed files with `Empty` and a specific `title`. For a `Table`, pass it as `emptyState`.
4. `ContractServiceOrders`: render a `Table compact` instead of the card.

**Verify:** run the code gate. Then the screenshot check on `/x/service-orders/my-visits` (name `30-my-visits`), `/x/customer/cust_AfsgMa8AhDMG17suKgLTsX/assets` (name `30-customer-assets`) and `/x/contract/con_U9wosGpZJJaN4cVEhVMpa1/service-orders` (name `30-contract-service-orders`). Reference: `00-ref-job.png`.

**Out of scope:** the visit page logic.

## Task 31: Open New Service Order in a drawer

**Depends on:** Tasks 2, 3
**Files:**
- Modify: `apps/erp/app/routes/x+/service-orders+/new.tsx` (line 110)
- Modify: `apps/erp/app/modules/service/ui/ServiceOrders/ServiceOrderForm.tsx`
- Copy from (precedent): `ProjectForm.tsx:315-365` (create mode `ModalDrawer`); `CustomerTypeForm.tsx:99-107` (footer order)

**Steps:**
1. Render `ServiceOrderForm` in a `ModalDrawerProvider` → `ModalDrawer` → `ValidatedForm` with a single column.
2. Footer: `[Save] [Cancel]`, Cancel `variant="solid"`. Closing navigates to `path.to.serviceOrders`.
3. Show the fields of the chosen type only, as today. Put Coverage Contract, Priority and Start Work From in a collapsed "More" section, kept mounted (D14).
4. Pass `termId="service-order"` on Type and `termId="coverage"` on Coverage Contract.
5. Keep the action and its validator.

**Verify:** run the code gate. Then the screenshot check on `/x/service-orders/new` (name `31-new-service-order`). Reference: `10-new-project.png`. Create one Draft Field Visit order and confirm it opens.

**Out of scope:** the order record page.

## Task 32: Give service templates a standard record page

**Depends on:** Tasks 2, 3, 24
**Files:**
- Modify: `apps/erp/app/routes/x+/service-orders+/templates_.$id.tsx` (lines 158-208)
- Copy from (precedent): `RecordHeader` in `apps/erp/app/components/Layout/RecordHeader.tsx:257-281`; `detailBreadcrumb` in `apps/erp/app/routes/x+/project+/$projectId.tsx`

**Steps:**
1. Add a `handle` with `detailBreadcrumb({ breadcrumb: msg\`Service Templates\`, to: path.to.serviceTemplates }, (data) => data?.template?.identifier)`. Read the real path helper name first.
2. Render `RecordHeader` with the identifier, the name and a ⋯ menu (Delete). No status.
3. Remove the back link and the explanatory paragraph.
4. Keep `WorkTree` and `<RecordOutlet/>`. The element drawer shows the plan lines grid from Task 24.

**Verify:** run the code gate. Then `pnpm --filter erp build`. Then the screenshot check on `/x/service-orders/templates/prj_MPQJL28XuzqBQrxcd42HAF` (name `32-service-template`). Reference: `00-ref-job.png`.

**Out of scope:** template creation.

---

# Group 9 — Contract

## Task 33: Show a locked contract line as read-only text

**Depends on:** Task 4
**Files:**
- Modify: `apps/erp/app/routes/x+/contract+/$id.$lineId.details.tsx` (line 149)
- Create: `apps/erp/app/modules/sales/ui/Contracts/ContractLineSummary.tsx`
- Copy from (precedent): `ReadOnlyFields` (Task 4); `ContractLineForm.tsx` (the field list and labels)

**Steps:**
1. When `contract.status !== "Draft"`, render `ContractLineSummary` instead of `ContractLineForm`.
2. `ContractLineSummary` shows every field of the form as a `ReadOnlyField` with the same label. Format money and dates with the house formatters.
3. Under the fields, one muted line: "Change lines with Amend." Amend stays in the contract header.
4. Pass `termId` on CLIN (`clin`), Billing Method (`billing-method`), Billing Element (`billing-element`).
5. A Draft contract keeps the editable form.

**Verify:** run the code gate. Then the screenshot check on `/x/contract/con_U9wosGpZJJaN4cVEhVMpa1/conl_HvwrdW8QHRYM9VpDk42zE3/details` (name `33-contract-line`). Reference: `00-contract-line.png` (must show no disabled inputs).

**Out of scope:** the Amend flow.

---

# Group 10 — Reports, indirect rates and settings

## Task 34: Rebuild Projects → Reports as one list

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/routes/x+/projects+/reports.tsx`
- Copy from (precedent): `apps/erp/app/routes/x+/accounting+/reports.tsx:356-447` (title, search, `SectionHeading`, bordered rows)

**Steps:**
1. Header: the title, a search input, and ONE shared `DateRangePicker` (default: this month to date).
2. Show 3 sections: Timekeeping, Audit and contracts, R&D tax.
3. Each section is a bordered stack of rows. A row holds the name, a muted description, and a **Download CSV** link on the right.
4. The 5 range reports take the shared range. Labor distribution keeps a small accounting period `Select` in its row. The 2 R&D reports keep a small tax year `Select` in their row.
5. Build each link with `path.to.api.projectReport(reportKey, params)` and today's params.
6. Remove the card grid.

**Verify:** run the code gate. Then the screenshot check on `/x/projects/reports` (name `34-reports`). Reference: `00-ref-accounting-reports.png`. Download one CSV and confirm a 200.

**Out of scope:** the report builders.

## Task 35: Turn Indirect Rates into a runs list with a Rates drawer

**Depends on:** Tasks 3, 5
**Files:**
- Modify: `apps/erp/app/routes/x+/accounting+/indirect-rates.tsx`
- Create: `apps/erp/app/routes/x+/accounting+/indirect-rates.rates.tsx` — a `Drawer size="xl"` with the editable rates grid
- Modify: `apps/erp/app/modules/accounting/ui/IndirectRates/IndirectRateRuns.ee.tsx` — becomes a `Table`
- Modify: `apps/erp/app/modules/accounting/ui/IndirectRates/IndirectRatesGrid.ee.tsx` — editable cells
- Modify: `apps/erp/app/utils/path.ts` — add `indirectRatesRates`
- Copy from (precedent): `apps/erp/app/routes/x+/accounting+/revenue-recognition-runs.tsx` and `RevenueRecognitionRunsTable.tsx:109-161`

**Steps:**
1. The page is a `Table` of runs, titled "Indirect Rates". `primaryAction`: **Run Period** (a `Confirm` with the period `Select`, posting `intent=run`).
2. `headerActions`: the fiscal year `Select`, then a ⋯ menu with Rates (opens the drawer), Run True-Up, Statement and ICE Export.
3. The Rates drawer shows `IndirectRatesGrid` with inline editing. The cells of a manually set rate type take `EditableNumber` and post `intent=set-rate` with today's fields. A computed cell is read-only. If the grid does not map one cell to one rate entry, STOP and report.
4. Delete `SetIndirectRateModal` when it has no caller.
5. Keep `IndirectRatesUpgradeOverlay` for a gated company (the page's whole subject is the feature).
6. Pass `termId`: `indirect-pool`, `provisional-rate`, `final-rate`, `burden`.
7. Remove `BurdenSettingsForm` from this page (Task 36 moves it).

**Verify:** run the code gate. Then the screenshot check on `/x/accounting/indirect-rates` (name `35-indirect-rates`) and the Rates drawer (name `35-indirect-rates-drawer`). Reference: `00-ref-revenue-runs.png`.

**Out of scope:** the run engine.

## Task 36: Move Burden Settings to Settings → Accounting and default the fiscal year

**Depends on:** Task 35
**Files:**
- Modify: `apps/erp/app/routes/x+/settings+/accounting.tsx` — a Burden Settings card and an `intent=burdenSettings` branch
- Modify: `apps/erp/app/modules/accounting/ui/IndirectRates/BurdenSettingsForm.ee.tsx`
- Modify: `apps/erp/app/routes/x+/accounting+/indirect-rates.ice.tsx:33-38`, `indirect-rates.statement.tsx:54-57`
- Copy from (precedent): the Lease Classification card in `settings+/accounting.tsx:504-565`; the fallback in `indirect-rates.tsx:70-74,96-98`

**Steps:**
1. Add a Burden Settings card after Fixed Assets: a `ValidatedForm` around a `Card`, hidden `intent=burdenSettings`, a `CardFooter` Save. Pass `bordered` on the boolean.
2. The new action branch calls `requireFeature(GOVERNMENT_CONTRACTING)` first, then today's `updateBurdenSettings` path. Catch `EntitlementError`.
3. For a gated company, show one `UpgradeOverlayRow` in place of the card.
4. In both drawers, replace the 400 with the page's fallback: a missing or bad `fiscalYear` becomes the current fiscal year.

**Verify:** run the code gate. Then the screenshot check on `/x/settings/accounting` (name `36-settings-accounting`), `/x/accounting/indirect-rates/ice` (name `36-ice-bare`) and `/x/accounting/indirect-rates/statement` (name `36-statement-bare`). Expected: no "could not be completed" text.

**Out of scope:** the ICE builders.

## Task 37: Match Settings → Timekeeping and Projects to Settings → Inventory

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/routes/x+/settings+/timekeeping.tsx` (lines 160-250), `apps/erp/app/routes/x+/settings+/projects.tsx` (lines 115-177)
- Copy from (precedent): `apps/erp/app/routes/x+/settings+/inventory.tsx:221-252`; `apps/erp/app/components/SettingsPage.tsx`, `SettingsSectionHeader.tsx`

**Steps:**
1. Replace the hand-written `VStack` with `SettingsPage className="gap-4"` and `SettingsPageHeading`.
2. Timekeeping has 2 cards:
   - "Controls": the mode.
   - "DCAA rules": the entry window, the timecard check, the weekly hours and the two certification texts. It shows only when Controls is DCAA.
3. Use `max-w-[400px]` for short fields and `max-w-[640px]` for the certification texts.
4. Pass `termId="timekeeping-controls"` on Controls and `termId="dilution"` on Standard Weekly Hours.
5. Keep the actions.

**Verify:** run the code gate. Then `pnpm --filter erp build`. Then the screenshot check on `/x/settings/timekeeping` (name `37-settings-timekeeping`) and `/x/settings/projects` (name `37-settings-projects`). Reference: `00-ref-settings-inventory.png`.

**Out of scope:** the timekeeping validator.

---

# Group 11 — Sweeps

## Task 38: Sweep the remaining empty states

**Depends on:** Tasks 9–37
**Files:**
- Modify: every file the commands below list

**Steps:**
1. Run:
   ```bash
   grep -rln "border-dashed" apps/erp/app/modules/projects apps/erp/app/modules/service apps/erp/app/modules/accounting/ui/IndirectRates apps/erp/app/routes/x+/project+ apps/erp/app/routes/x+/projects+ apps/erp/app/routes/x+/service-orders+ apps/erp/app/routes/x+/service-order+
   ```
2. Replace each dashed empty box with `Empty`. Leave `ElementBoxNode.tsx:80` (an add slot, not an empty state).
3. Pass `emptyState` with an `Empty` for the unfiltered empty case in these 8 tables:
   - `ProjectsTable.tsx`, `LaborCategoriesTable.tsx`, `ProjectStockTransfersTable.tsx`, `PlanningGroupsTable.tsx`
   - `ServiceOrdersTable.tsx`, `ServiceTemplatesTable.tsx`, `IndirectPoolsTable.ee.tsx`, `contract+/$id.billing-backup.$invoiceId.tsx`
4. Replace the plain-sentence empties in `IndirectExpenseStatement.ee.tsx:65`, `ElementComments.tsx:69`, `ElementChildren.tsx:88`, `ElementLinks.tsx:154`, `ElementReader.tsx:61`, `ElementGraph.tsx:198`, `PlanDiffViewer.tsx:339`, `ChangeRequestReview.tsx:394`, `ChangeRequestsTable.tsx:62`, `BaselinesList.tsx:78`, `ProjectStockTransferLines.tsx:333`.

**Verify:**
```bash
grep -rn "border-dashed" apps/erp/app/modules/projects apps/erp/app/modules/service apps/erp/app/routes/x+/project+ apps/erp/app/routes/x+/projects+ | grep -v ElementBoxNode | wc -l
# Expected: 0.
```
Then the code gate. Then the screenshot check on `/x/project/prj_PkThuk8ai72VzkQouKFDFv/baselines` (name `38-baselines`) and `/change-requests` (name `38-change-requests`).

**Out of scope:** the global `Table` default.

## Task 39: Sweep every boolean field to `bordered`

**Depends on:** Tasks 9–37
**Files:**
- Modify: every file the command below lists in the projects, service, billing and government contracting areas

**Steps:**
1. Run:
   ```bash
   git diff --name-only $(git merge-base HEAD origin/main) HEAD -- apps packages | grep -E "\.tsx$" | xargs grep -l -E "<Boolean|<Switch"
   ```
2. In each form, pass `bordered` on every `Boolean`.
3. For a `Switch` or `Checkbox` field inside a form, wrap it the way `Boolean` does when `bordered` is set (`packages/form/src/components/Boolean.tsx:71`). Leave a menu checkbox item (`DropdownMenuCheckboxItem`) as it is.
4. The known list on 2026-10-12 has 16 files: `BurdenSettingsForm.ee.tsx`, `IndirectPoolForm.ee.tsx`, `PersonJob.tsx`, `ElementEarnedValue.ee.tsx`, `ElementsHeader.tsx`, `PlanningGroupForm.tsx`, `LaborCategoryForm.tsx`, `ProjectForm.tsx`, `ContractProperties.tsx`, `ServiceOrderProperties.tsx`, `ElementSidebar.tsx`, `ProjectStates.tsx`, `TimesheetGrid.tsx`, `BuildFromPartDrawer.tsx`, `settings+/projects.tsx`, `settings+/invoicing.tsx`.
5. Skip a file outside the four areas: `ItemSalePriceForm.tsx`, `ItemPlanningForm.tsx`, `JobForm.tsx`.

**Verify:**
```bash
git diff --name-only $(git merge-base HEAD origin/main) HEAD -- apps | grep -E "projects|service|IndirectRates|Contracts|timekeeping|settings\+/projects" | xargs grep -h "<Boolean" | grep -vc bordered
# Expected: 0.
```
Then the code gate. Then the screenshot check on `/x/project/prj_PkThuk8ai72VzkQouKFDFv/settings` (name `39-bordered`).

**Out of scope:** forms outside the four areas.

## Task 40: Sweep the glossary popovers onto the rebuilt screens

**Depends on:** Tasks 2, 9–37
**Files:**
- Modify: the forms, column headers and labels of the rebuilt screens

**Steps:**
1. For each slug Task 2 added, run `grep -rn -i "<the term's words>" apps/erp/app/modules/{projects,service,sales/ui/Contracts,accounting/ui/IndirectRates} apps/erp/app/routes/x+/{project+,projects+,service-orders+,service-order+,contract+}`.
2. Pass `termId="<slug>"` on each form field that shows the term.
3. For a `Table` column header, wrap the header text in `LabelWithHelp` (`packages/react/src/LabelWithHelp.tsx`).
4. Write the count of fields and headers you changed in the run log.

**Verify:** run `pnpm --filter @carbon/content test` (expected: exit code 0). Then the code gate. Then `pnpm --filter erp build`. Then the screenshot check on `/x/project/prj_PkThuk8ai72VzkQouKFDFv/settings` with one popover open (name `40-glossary-popover`).

**Out of scope:** screens this plan does not touch.

---

# Group 12 — Docs, translations and the final pass

## Task 41: Update the rules, AGENTS.md, lessons and the design skill

**Depends on:** Tasks 1–40
**Files:**
- Modify: `.claude/rules/projects-system.md` — *Layouts, views and the Reader PDF* (3 layouts, no saved views); the workspace; *Timesheets* ("My Time"); "common stock"
- Modify: `.claude/rules/field-service.md` — "nodes" becomes "elements"; the New drawer; the sidebar
- Modify: `.claude/rules/project-billing.md` — *UI* (Billing under Costs; Approvals → Billing)
- Modify: `.claude/rules/government-contracting.md` — *Reports* (one list); Layer 5
- Modify: `.claude/rules/indirect-rates.md` — the runs list, the Rates drawer, Burden Settings in Settings → Accounting
- Modify: `.claude/rules/project-control.md` — earned value autosave; shows only with a control account
- Modify: `.claude/rules/inventory-system.md` — "common stock" becomes "unassigned stock" in prose
- Modify: `apps/erp/app/modules/projects/AGENTS.md` (lines 124, 168), `apps/erp/app/modules/service/AGENTS.md`
- Modify: `.claude/skills/carbon-design/references/status-and-feedback.md:142-147` — describe the real `Empty` (illustration, title, description)
- Modify: `.ai/lessons.md` — one lesson per new pitfall found during the run
- Modify: `.ai/scratch/ui-patterns-reference.md` is scratch; do not edit it

**Steps:**
1. Describe committed code only. Mark anything you cannot verify `<!-- UNVERIFIED: ... -->`.
2. Add a short *Information architecture* section to `projects-system.md` that points to this plan.
3. Delete every line that names a removed file, function or route.
4. Add lessons in the `Context → Problem → Rule → Applies to` format. Candidates: the collapsed-section unmount risk (D14), the `generatePath` trailing slash, the UTC company time zone.

**Verify:**
```bash
grep -rn "ElementList\|ElementBoard\|ElementTimeline\b\|projectView\b\|common stock" .claude/rules apps/erp/app/modules/projects/AGENTS.md apps/erp/app/modules/service/AGENTS.md | wc -l
# Expected: 0 (projectView may stay only where it names the table that stays).
```

**Out of scope:** product docs (Task 42).

## Task 42: Update the docs reference pages

**Depends on:** Task 41
**Files:**
- Modify: `docs/content/docs/reference/projects.mdx` (lines 8, 10, 34, 94-105, 115, 155, 173, 197-198, 228, 251, 261, 265, 284, 315-337)
- Modify: `docs/content/docs/reference/service-orders.mdx` (lines 8, 10, 14, 27, 49-71, 93, 111)
- Modify: `docs/content/docs/reference/government-contracting.mdx` (lines 50, 58, 104, 113-123)
- Modify: `docs/content/docs/reference/project-billing.mdx`, `contracts.mdx` — the billing UI paths

**Steps:**
1. Use the `carbon-docs` skill. Ground every claim in the code.
2. Describe the new navigation: the module sidebar and the project sidebar.
3. Describe each project page: Overview, Plan (3 layouts), Schedule, Costs (Stock, Pegging, Billing), Time, Settings.
4. Apply the *Terminology* table: Unassigned stock, Element (not node), Current plan, Work complete, Needs review, My Time.
5. Remove the text about saved views, Display, the Board, List and Timeline layouts, and the Details tab.
6. Update each `Screenshot` label to the new layout.

**Verify:**
```bash
pnpm --filter docs typecheck
# Expected: exit code 0.
cd docs && for l in $(grep -oh "](/docs/[^)]*)" content/docs/reference/{projects,service-orders,government-contracting,project-billing,contracts}.mdx | sed 's|](/docs/||;s|)||;s|#.*||' | sort -u); do [ -f "content/docs/$l.mdx" ] || [ -f "content/docs/$l/index.mdx" ] || echo "MISSING $l"; done
# Expected: no MISSING line.
```

**Out of scope:** the changelog.

## Task 43: Fill the translations

**Depends on:** Task 42
**Files:**
- Modify: `packages/locale/locales/*/erp.po`, `packages/locale/locales/*/mes.po`

**Steps:**
1. Run `git status --short`. If it shows uncommitted `.ts` or `.tsx` edits, STOP (lesson *The pre-commit Lingui extract reads the working tree*).
2. Run `pnpm run lingui:extract`.
3. Run the `translate` skill to fill every empty `msgstr`.
4. Run `pnpm lingui:check`.

**Verify:**
```bash
pnpm lingui:check
# Expected: exit code 0, no missing translation.
git diff --stat -- packages/locale/locales | tail -1
# Expected: only .po files changed.
```

**Out of scope:** `packages/locale/locales/glossary.json`.

## Task 44: Run the final screenshot pass

**Depends on:** Tasks 1–43
**Files:**
- Modify: `.ai/runs/2026-10-12-projects-service-ui-rebuild.md` — the final table

**Steps:**
1. Run `.ai/scratch/ui-rebuild/login.sh`.
2. Shoot every screen of Task 1's baseline table again with the name `99-<slug>`. Add `99-project-overview`, `99-plan-tree`, `99-element-panel`, `99-approvals-billing` and `99-new-service-order`.
3. Shoot the 5 workspace pages again at 1024 × 768 with the suffix `-1024`.
4. For each pair (`00-…` and `99-…`), answer the 7 questions of the screenshot check.
5. Write one table row per screen in the run log: name, the 7 answers, and a note.
6. If one answer is "no", fix it in a new commit, then shoot again.
7. Run the gates one last time:
   ```bash
   pnpm exec turbo run typecheck --filter=erp
   pnpm exec turbo run typecheck --filter=mes
   pnpm --filter erp test
   pnpm --filter mes test
   pnpm --filter erp build
   pnpm --filter mes build
   pnpm run lint
   ```

**Verify:** every row in the run log's final table has 7 "yes" answers. Every gate exits 0.

**Out of scope:** new features.

---

## Open points

1. The `Table` built-in empty state ("No data exists" with a triangle) stays for the rest of the app. This plan replaces it only on the touched screens. Brad may want it changed globally.
2. Billing review moves into Approvals (D13), and Transfers leave the sidebar. Brad named 4 sidebar links; he did not say where these two go.
3. New Job is a full page (`NewRecordPage`), not a drawer. The New Project and New Service Order drawers follow the drawer rule, not New Job. A drawer route at a module's index URL opens over an empty page, as `/x/projects/new` does today.
4. The demo company has no Time & Materials or Cost Plus line, no baseline, no change request and no billable item. Tasks 16, 27 and 29 check those screens empty, or with a test record.
5. Labor category rates have no delete endpoint. The grid shows no delete.
6. Project states and labels keep their small modals. They are not tables, and the grid has no colour editor.

## Execution notes

Run of 2026-10-12 (Tasks 1, 3–7, 9–13). Tasks 2 and 8 run later, so the screens keep the current wording ("My Timesheet", "Live plan", "Technically complete").

- Environment: the ERP dev server ran out of heap (4 GB) twice during the gates. The restart script `/tmp/uir/start-erp.sh` sources `.env.local` first and sets `NODE_OPTIONS=--max-old-space-size=12288`. The shell exports `SUPABASE_URL`, `SUPABASE_DB_URL` and `REDIS_URL` for another stack, and those override `.env.local` in Vite.
- Task 4 and later: the license-header fixer walks tracked files only. Run `git add -N <file>` before `pnpm --filter @carbon/checks license-headers`.
- Task 9: `projects+/_layout.tsx` had no loader. Its new loader calls `requirePermissions(request, {})` and returns `approvalCount`; each page keeps its own permission check. Approvals is also active on `/x/projects/billing` (D13).
- Task 10: the primary action was a `Button` that opened `ProjectForm` from the table. It is now `New label="Project" to={path.to.newProject}` ("Add Project"). The drawer opens over an empty page (Open point 3).
- Task 10: when Cost Objective is hidden in the New Project drawer, a `Hidden` field still posts its default (Direct for a Contract project).
- Task 10: created the test project URC "UI Rebuild Check" (`prj_M5jo99bAWiZXcgCzpFnLfy`, Draft). The ERP has no project delete route.
- Task 11: the project switcher is a ghost `Button` that opens a `Popover` + `Command` search, not the form `Combobox`, which draws a bordered input. Precedent: `CompanySwitcher`.
- Task 11: `useProjectSidebarLinks` is a new export in `useProjectNavigation.tsx`; Task 12 deleted the old `useProjectNavigation` tab list.
- Task 12: the ⋯ menu also offers "Technically complete" for an On Hold project. The old header offered it and `projectStatusTransitions` allows it.
- Task 13: `getProjectElements` has no `estimateAtCompletion`, so the Overview passes `null` to `buildProjectCostFigures`. The Overview does not show that figure.
- In this dev stack `usePlanGate` is never gated (not Cloud, not Community), so `useGovernmentContracting()` is true for every company and the government contracting fields still show.

Polish pass of 2026-10-12, after Brad's review of the Task 13 shots (commit `fix(projects): quieter project shell and overview`):

- The project name showed three times. The switcher row at the top of the project sidebar is gone; the sidebar starts with the change request selector and the Baselines button. The header title (identifier, muted name, a small chevron) is now the switcher button: it opens the same searchable project list (`ProjectSwitcher` moved from `ProjectSidebar.tsx` into `ProjectHeader.tsx`). The title no longer links to Overview; the sidebar's Overview link does that. The breadcrumb keeps the identifier only.
- Overview: the Details card is gone. The page opens with one muted line, Owner · Customer · Start – Due · Cost treatment, plain text, missing facts left out (only a start date reads "Starts …", only a due date "Due …"). Then Budget and Next milestone side by side, then Needs attention. Each section is a `Subheading as="h3"` over one bordered box; no `CardHeader` bar or divider.
- Progress bars: `BarProgress` (the striped ticks) is replaced by `Progress` from `@carbon/react`, `h-1.5`, a solid neutral fill (`bg-foreground/70`), red only when over budget. The projects list "Budget used" column uses the same component. Numbers use the UI font with `tabular-nums`; `BarProgress` drew its value in `font-mono`, and Carbon money (`MotionMoney`, `useCurrencyFormatter`) is not mono.
- Cost treatment on Overview is plain text (the `Enumerable` badge is gone). The list already had no Treatment column.
- An empty Overview section ("Nothing needs attention", "No upcoming milestone") is one muted line, not the `Empty` cabinet illustration (a deviation from D6 for this summary page only: the illustration was louder than the data).
- Layer 5: Stock and Pegging show under Costs only when the project has project stock (any `itemLedger` row with its `projectId`) or a current peg (a `projectPeg` row with `supersededAt` null). `$projectId.tsx` reads each with one `head: true` count, both served by existing partial indexes, and returns `hasProjectStock` / `hasPegs`. Before, they showed on the `projectStock` flag and `planningGroupId`.
- Open question: a project with project stock turned on but no stock yet now has no Stock link, so the Task 16 Transfer button on that page is not reachable from the sidebar until stock arrives (the old URL and the Overview's overdue-borrows row still reach it).

Run of 2026-10-12, Tasks 19–21 (the Plan page), with Brad's instruction of the same day: "remove the Elements from the top bar here. we can keep the search, that should move left and the elements can go in filter".

- Environment: the database was rebuilt. The demo company is "Carbon Development" (`db6d4ukm20gg2a6iv1vg`) with one user, `test@carbon.ms` (signed in by the dev bypass). OB2 is `prj_5vCwDZeAP2MHdjqYeYe7iP`, NSOPS `prj_Xn8Bq9qYwbQ6tsjQVHuD7h`. The record table above has the old ids.
- Task 19: the Type filter writes `filter=type:eq:…` and is single choice (`isExclusive`), as the type chips were, because the Tree layout uses one type as a lens. The old `?type=` param still works: the loader redirects it into the Type filter so it shows as a chip (`canonicalElementsParams`), and `parseElementFilters` still reads it for the Reader PDF.
- Task 20, Brad's decision (2026-10-12, after the first instruction): the Plan page has ONE search, the sidebar's "Search elements" box above the tree. The toolbar has no search. The sidebar box filters the tree at once and writes the page's `search` param (debounced 500 ms, Plan page only), so the Table, Tree and Reader filter on the server.
- Task 20: the toolbar is the switch on the left, then Filter and New Element on the right (Brad's order). There is no ⋯ Display menu: with Group by and the shown properties gone it held only Export PDF, which is an icon button in the Reader instead. Table grouping is gone with it.
- Task 20: `SplitButton` takes no separator, so Build from part is the last item of the type list with none.
- Task 20: while the plan is locked, New Element is disabled with the lock message as its tooltip. A tooltip is not interactive, so it cannot link; the sidebar's change request picker opens a change request. The "Plan locked" text and the "Open Change Request" button are gone.
- Task 20: the grid's columns are ID, Name, Type, State, Owner and Target Date (Brad). Priority, Milestone, Start Date, the hours and the cost columns left the grid; the Plan loader no longer reads `getProjectCostSummary`. Owner became editable.
- Task 20: the text and date editors use `useStableEditableComponents`. The State and Owner list editors take their options when built, so they are rebuilt only when the options' content changes; a pick commits at once, so a rebuild loses nothing.
- Task 20: the row menu is a hover-revealed ghost ⋯ column (Open, Add child, Move to…, Copy id, Delete), not the Table's `renderContextMenu`, whose pinned column showed a bordered button on every row and made rows 49 px. The List's bulk selection bar (state and priority for many rows) has no replacement.
- Task 20: New Element in the Tree or Reader opens the new element's panel, since those layouts have no row to highlight.
- Task 20: `TreeView` (shared) re-applies its filter after a tree reload and at mount; before, any reload of the tree data while a search was typed showed every node again. `EditableText`'s save type widened to `PostgrestSingleResponse<unknown>`, as `EditableList` and `EditableDate` already take.
- Task 21: `MoveElementModal` moved to its own file (`ui/Elements/MoveElementModal.tsx`) as well as `QuickAddRow`, because the Table's row menu keeps Move to…. `elementFieldKey` stays as a private helper of `useElementField` rather than being deleted.
- Task 21: the Verify grep `ElementList\b` also matches `overlayElementList` (a server function); with a leading `\b` the count is 0.
- Tasks 19–21: the docs pages (`docs/content/docs/reference/projects.mdx`, `government-contracting.mdx`) still describe the List layout, Views and the old Elements tab; Task 42 updates them.

Run of 2026-10-12, Task 22 (the Tree), then Tasks 2, 8, 14–18:

- Task 22: `CARD_HEIGHT` went from 88 to 100 so a card holds the type row, 2 lines of name and the state chip. Only the constant changed; the `tree-layout.test.ts` box heights and card offsets that follow from it moved with it (232 → 256, 328 → 364, y 136 → 148).
- Task 22: the fit does not call `fitView`. `treeViewport` computes the viewport from the layout's own box sizes with `getViewportForBounds` and sets it with `setViewport`. In React Flow 12.10 `fitView` resolves later (it queues until the nodes are measured), so a zoom read just after it is stale, and step 3.4 ("if the zoom after that is below 0.5") could not be tested that way.
- Task 22: `useNodesInitialized()` never turns true on this canvas (it has no `onNodesChange`), so step 3.1 uses `useNodesInitialized({ includeHiddenNodes: true })`, and every card node states its size.
- Task 22: the Fit view, Find and Legend buttons moved off the canvas into the breadcrumb row; the panel covered the top-left cards.
- Task 22: the verification status icon and the suspect badge left the card ("at most one chip"). The amber border still marks a link that needs review; the element panel and the Reader still show the verification.

