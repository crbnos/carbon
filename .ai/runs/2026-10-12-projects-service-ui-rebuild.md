# Projects and Service UI rebuild — run log

Plan: `.ai/plans/2026-10-12-projects-service-ui-rebuild.md`. Screenshots go to `.ai/scratch/ui-rebuild/` (git-ignored). Viewport 1440×900. User `satellite-demo@carbonos.dev` at https://erp.projects-wbs-research-spec.dev.

## Task 1: Set up the screenshot scripts, the run log and the baseline shots

- The scripts `login.sh` and `shot.sh` exist and are executable. The browser session `ui-rebuild` was already signed in, so `login.sh` printed `LOGIN FORM NOT FOUND` and the URL `/x`.
- 22 baseline shots `00-*.png` are saved. The inventory count reference is `00-ref-inventory-count.png` (count `ic_8L6hmHD9ykkCuj9GvKYiTR`).
- `/x/project/…/elements` opens with `?layout=list` (the saved layout preference).
- No error text showed on any baseline screen.

## Task 2: Apply the terminology table and add the glossary entries

- Applied the *Terminology* table; the plan's table now has an "Applied" column with each decision. Two additions: the planning group excess rule shows "Unassigned stock" and "Exception project" (the enum values stay), and the service invoice detail `By Node` shows "By Element".
- `BuildFromPartDrawer` lost `vocabulary`; the service order's drawer now reads "Build from part" with the element wording.
- 47 glossary entries in `docs/content/src/glossary/terms.ts`, each with one grounded definition and an `href` to a heading that exists (all 34 distinct hrefs checked). `element` now says "One item" instead of "One node". ACRN, SLIN and preproduction have thin sources, so their definitions say only what the rules state.
- Not changed: code names (`COMMON_STOCK_OWNER`, `clearSuspect`, `ServiceWorkNode`), enum values, the "Build Tree" button, `.claude/rules/` and the docs pages (Tasks 41 and 42; `projects.mdx` still says "common stock").
- Verify: the old-word grep on `apps/erp/app apps/mes/app` (`.tsx`, comments excluded) → 0; the service "node" grep in `t`/`<Trans>` → 0. `@carbon/content` test 17 passed; `docs` typecheck exit 0 (glossary agent). `pnpm run lingui:extract` ran.
- Code gate: Biome clean (terms.ts is outside Biome's `files.includes`); `typecheck` erp, mes, server-functions exit 0; erp 2,261 and mes 73 tests passed.
- Shots: `02-service-work.png` (the work tree says Element; the Add Element row), `02-plan-tree-terms.png` (Current plan, Work complete).
- Screenshot check: the screens are unchanged except for the words, so the layout answers stay as Tasks 11–22 left them. The service work page still has 3 header actions (Put on Hold, Complete, Cancel); Tasks 30–32 rebuild it.

## Task 3: Give Empty a title and a description

- `Empty` takes `title` and `description`. `description={null}` renders no line. The default text is the same.
- Code gate: Biome clean, `typecheck --filter=erp` exit 0, `erp test` 2,242 passed.
- `03-empty-unchanged.png` matches `00-project-costs.png` pixel for pixel by eye. The 7 questions do not apply: the task changes no layout.

## Task 4: Add ReadOnlyField for read-only values

- Added `ReadOnlyField` and `ReadOnlyFields` in `apps/erp/app/components/ReadOnlyField.tsx`, exported from `~/components`.
- `ReadOnlyField` uses `LabelWithHelp variant="inline"` when `termId` is set. It renders a muted `—` for an empty value.
- The license-header fixer walks tracked files only (`git ls-files --cached`). Run `git add -N <file>` before the fixer on a new file.
- Code gate: Biome clean, `typecheck --filter=erp` exit 0, `erp test` 2,242 passed. No screen uses the component yet, so no screenshot.

## Task 5: Add the grid helpers EditableByRow and useStableEditableComponents

- Added `EditableByRow` and `useStableEditableComponents` in `apps/erp/app/components/Editable/`, exported from its `index.ts`.
- `useStableEditableComponents` is generic over the callbacks `C` and the returned editor record `R`, so a caller keeps its exact editor keys.
- Code gate: Biome clean, `typecheck --filter=erp` exit 0, `erp test` 2,242 passed. No screen uses the helpers yet, so no screenshot.

## Task 6: Add collapsible groups and counts to the sidebars

- `RouteGroup` and `AuthenticatedRouteGroup` get `collapsible?`. `Route` gets `count?`.
- `GroupedContentSidebar` folds a `collapsible` group in a `Collapsible`. The group follows the page (open while one of its routes is active) until the user toggles it. Then the user's choice sticks for the session.
- A route `count` above 0 shows a `Count` at the right of the link, on the panel and on the phone sheet (`SheetNavRow count`).
- `SheetNavGroup` takes `collapsible`, `open` and `onOpenChange`.
- `DetailSidebar` links take `isActive` and `indent` (`pl-8`).
- Code gate: Biome clean, `typecheck --filter=erp` exit 0, `erp test` 2,242 passed.
- `06-sales-sidebar-unchanged.png` and `06-projects-sidebar-unchanged.png` look as before.
- Environment: the ERP dev server died during the gate (no error in its log). I restarted it with `/tmp/uir/start-erp.sh`, which sources `.env.local` first. The shell exports `SUPABASE_URL`, `SUPABASE_DB_URL` and `REDIS_URL` for another stack, and those override `.env.local` in Vite. A restart without the source step serves the wrong database and loses the session.

## Task 7: Add useGovernmentContracting and UpgradeOverlayRow

- Added `useGovernmentContracting()` in `apps/erp/app/modules/projects/ui/useGovernmentContracting.ts`. It returns true when `timekeepingControls` is `DCAA` or `usePlanGate({ feature: "GOVERNMENT_CONTRACTING" })` is not gated.
- Added `UpgradeOverlayRow({ title, plan, className })` to `UpgradeOverlay.tsx`, exported from the folder index. `UpgradeOverlayUpgradeButton` takes only `children` and `to`; the row passes neither.
- Code gate: Biome clean, `typecheck --filter=erp` exit 0, `erp test` 2,242 passed. No screen uses them yet, so no screenshot.

## Task 8: Fix the week views on a Sunday

- Step 1: `select timezone from company` → `UTC` for "Carbon Development" (`db6d4ukm20gg2a6iv1vg`); its two locations are `America/Chicago`.
- Step 2: `seedCompanyReferenceData` inserts the company with `timezone = defaultLocation.timezone` (`America/Chicago`). `defaultLocation` is a module import, so it is in scope.
- Steps 3–4: `timesheetWeek(timeZone, offset, anchor?)` in `packages/utils/src/timekeeping.ts`, 7 tests: Sunday 2026-10-11 → week of 2026-10-05; Monday 2026-10-12 → 2026-10-12; offset -1 → 2026-09-28; offset +1; 7 days Monday first; the bounds at Chicago midnight; the week that ends daylight saving time; a non-finite offset.
- Step 5: `getTimesheetWeekView` (ERP) and the MES timesheet loader call it; both outputs keep their shape.
- Step 6: `formatDay` in the MES timecard calls `formatDate`.
- Step 7: Settings → Company, in the browser: Timezone `America/Chicago`. The save also needs Address Line 1, City, Postal Code and Country, which the dev company did not have, so the form got the Headquarters address (123 Main Street, Austin, TX 78701, United States). The DB now reads `America/Chicago`.
- Verify: `@carbon/utils` test 56 files, 726 passed; `typecheck` erp, mes, utils, database exit 0; `pnpm db:check:datasets -- --dataset satellite` ✓ (3.2 s, with `SUPABASE_DB_URL` on port 60663: the stack moved there after the reset).
- Code gate: Biome clean (one warning on an existing `console.warn` in `bootstrap.ts`); erp 2,261 and mes 73 tests passed.
- Shots: `08-my-time-week.png`: the week is Oct 12 – Oct 18, 2026 and holds today (Monday 2026-10-12). No MES dev server runs in this worktree, so the MES timesheet has no shot.

## Task 9: Shrink the Projects and Service sidebars (Layer 0)

- Projects sidebar: `Manage` (Projects, My Timesheet, Approvals, Reports) and a collapsible `Setup` (Labor Categories, Planning Groups). Transfers and Billing left the sidebar; their URLs still work.
- The label stays "My Timesheet": Task 2 (terminology) runs in a later run, so this run keeps the current wording.
- Approvals shows when `timesheetApprovalRequired` is true or `timekeepingControls` is `DCAA`. It carries `approvalCount` from the `projects+` and `project+` layout loaders (`getApprovalCountForUser` in `projects.server.ts`: 0 without `update: projects`). It is also active on `/x/projects/billing` (D13).
- The demo company requires no approval and is not DCAA, so Approvals and its count do not show in the shots.
- `projects+/_layout.tsx` had no loader. Its new loader calls `requirePermissions(request, {})`, so each page keeps its own permission check.
- `isProjectsRoute` and `isServiceOrdersRoute` use the literal record prefixes (`/x/project/`, `/x/service-order/`). The project stock transfer record keeps Projects active.
- Service sidebar: `Manage` (Service Orders, Schedule, My Visits) and a collapsible `Setup` (Customer Assets, Service Templates). My Timesheet left it.
- People → Payroll Totals shows only when `useGovernmentContracting()` is true.
- `pnpm run generate:mcp` updated `tool-manifest.digest.json`.
- Code gate: Biome clean, `typecheck --filter=erp` exit 0, `erp test` 2,242 passed.
- Shots: `09-projects-sidebar.png`, `09-reports-one-active.png` (only Reports active), `09-service-one-active.png` (only Schedule active), `09-setup-open.png` (Setup opens on a Setup page).
- 7 questions (sidebar only): 1 yes (the Jobs sidebar pattern), 2 yes, 3 yes, 4 yes, 5 n/a, 6 yes, 7 yes (Setup collapsed).
- Environment: the ERP dev server ran out of heap (4 GB) a second time. `/tmp/uir/start-erp.sh` now sets `NODE_OPTIONS=--max-old-space-size=12288`.

## Task 10: Simplify the projects list and the New Project drawer (Layer 1)

- Projects list columns: Identifier (pinned, links to `path.to.project`), Name, Status, Owner, Due (`endDate`), Budget used. Treatment, Budget, Actual, Committed, Start Date and Active are hidden by `defaultColumnVisibility`; their filters and CSV export stay.
- Budget used: a neutral `BarProgress` of actual / budget and the percent from `usePercentFormatter`. Over budget turns the bar and the percent red. A project with no budget shows `—`.
- The primary action was a `Button` that opened `ProjectForm` from the table (no copy-from options). It is now `New label="Project" to={path.to.newProject}`, so it renders "Add Project" with the N key, as Jobs does. The in-table drawer is gone.
- Deviation: `/x/projects/new` is a sibling of the list route, so the drawer opens over an empty page (plan Open point 3). Before, a click opened the drawer over the list.
- `emptyState` is `Empty title="No projects yet"` only when no `filter` or `search` param is set.
- New Project drawer (create mode): Name, Identifier, Cost Treatment, CIP Class (Capitalize only), Cost Objective (only when `useGovernmentContracting()`), Customer, Owner. "Start from a copy" is a collapsed section with Copy from, kept mounted, open when `?copyFrom=` is set.
- When Cost Objective is hidden, a `Hidden` field still posts its default (Direct for a Contract project), so a created project gets the same cost objective as before.
- Edit mode is unchanged (Task 14 rebuilds it).
- In this dev stack `usePlanGate` is never gated (not Cloud, not Community), so `useGovernmentContracting()` is true and Cost Objective shows.
- Created test project URC "UI Rebuild Check" (`prj_M5jo99bAWiZXcgCzpFnLfy`, Draft) from the drawer. It opened. The ERP has no project delete route, so it stays in the demo data.
- Code gate: Biome clean, `typecheck --filter=erp` exit 0, `erp test` 2,242 passed, `pnpm --filter erp build` exit 0 with no "Server-only module" line.
- Shots: `10-projects-list.png`, `10-new-project.png`, `10-new-project-copy-open.png`.
- 7 questions: 1 yes (Jobs list), 2 yes, 3 yes, 4 yes (Add Project), 5 n/a, 6 yes (row menu), 7 yes (copy-from collapsed, the rest moved to Settings).

## Task 11: Build the project workspace shell and the project sidebar (Layer 2)

- `$projectId.tsx` now renders `PanelProvider` → `ProjectHeader` → `ResizablePanels` with `explorer={<ProjectSidebar />}` and the content `<div className="bg-card h-full overflow-y-auto w-full"><RecordOutlet /></div>`, copied from `sales-return-order+/$id.tsx`. Every height subtracts `var(--content-inset)`.
- Loader additions, in the one `Promise.all`: `getProjectElements`, `getProjectSwitcherOptions` (new service function), `getProjectChangeRequests`, a head count of `planningGroup`, and `getContractBillingLines`. It returns `treeElements`, `switcherOptions`, `openChangeRequests`, `activeChangeRequest`, `hasPlanningGroups`, `hasControlAccount` and `hasBillingLines`. With `?cr=` the tree uses `loadChangeRequestOverlay` + `overlayElementList`.
- The Elements loader no longer reads the change requests; `ChangeRequestPicker` left `ElementsHeader`.
- `ProjectSidebar`: the switcher, the change request picker with a Baselines icon button, the `DetailSidebar` links (Overview, Plan, Schedule, Costs, Stock and Pegging indented, Time), the element tree on a Plan page, and Settings pinned at the bottom.
- Deviation: the switcher is a ghost `Button` with `LuChevronsUpDown` that opens a `Popover` + `Command` search, not the form `Combobox`. The form `Combobox` draws a bordered input; the sidebar needs a quiet title row like Flow and like `CompanySwitcher`. Choosing a project opens the same page of that project (an element page opens its Plan page).
- `useProjectSidebarLinks` is a new export in `useProjectNavigation.tsx`. The header's `useProjectNavigation` stays until Task 12 removes it.
- `NewChangeRequestModal` moved out of `ChangeRequestsTable`. `ChangeRequestPicker` takes `canCreate` and `className` and lists "New change request" and "All change requests" under the change requests.
- The Baselines icon button turns active on the Baselines page. Settings is also active on `/details` until Task 14 redirects it.
- `pnpm run generate:mcp` updated `tool-manifest.digest.json`.
- Code gate: Biome clean, `typecheck --filter=erp` exit 0, `erp test` 2,242 passed.
- Shots: `11-workspace-plan.png`, `11-workspace-costs.png`, `11-workspace-element.png` (the element right panel still opens in the content pane, and the tree highlights its row), `11-cr-picker-open.png`.
- OB2 shows Stock and Pegging under Costs. Billing does not show: OB2's contract lines are Fixed, and `getContractBillingLines` skips Fixed lines.
- 7 questions (sidebar only; the header is Task 12): 1 yes (`flow-requirements-tree.jpg` anatomy), 2 yes in the sidebar (the old header still overlaps until Task 12), 3 n/a, 4 n/a, 5 n/a, 6 yes, 7 yes.

## Task 12: Rebuild the project header on RecordHeader

- `ProjectHeader` now renders `RecordHeader` (copied from `JobHeader.tsx`): the identifier, then the name in `text-muted-foreground` (truncates), `Copy`, the ⋯ menu, ONE `ProjectStatus`, the explorer toggle (`usePanels().toggleExplorer`), and ONE `RecordAction slot="primary"`.
- Primary action by status: Draft → Release; Released → Technically complete; On Hold → Resume; Technically Complete → Close (the existing `Confirm`); Closed → none; a stop-work order → Resume work (`intent=resume`). The label stays "Technically complete" because Task 2 (terminology) runs later.
- ⋯ menu: Put on hold (Released), Technically complete (On Hold), Reopen (Technically Complete), Place in service (Capitalize with an asset under construction), Stop work (Released + Direct), a separator, Baselines, Change requests, Copy project, Template.
- Deviation: the plan's menu has no item for On Hold → Technically Complete. The old header offered it, and `projectStatusTransitions` allows it, so the menu keeps it.
- Stop work now shows for a Released Direct project and is disabled without `update: projects` (before, it hid). The status items are disabled, not hidden, without the permission or under a stop-work order.
- Removed from the header: the cost treatment `Enumerable`, the owner avatar, the stop-work badge, the overdue borrows badge and `DetailsTopbar`. Task 13 shows them on Overview.
- Deleted `useProjectNavigation` (the tab list). `useProjectSidebarLinks` stays in that file.
- Code gate: Biome clean, `typecheck --filter=erp` exit 0, `erp test` 2,242 passed.
- Shots: `12-header-1440.png`, `12-header-1024.png`, `12-header-menu-open.png`, `12-icr-draft.png` (primary is Release; not clicked), `12-nsg3-on-hold.png`.
- NSG3: Put on hold set `On Hold`; Resume set `Released`. NSG3 ends Released (checked in the database).
- 7 questions: 1 yes (`00-ref-job.png`; not like `bad-project-header.jpg`), 2 yes at 1440 and 1024, 3 yes, 4 yes, 5 n/a, 6 yes, 7 yes.

## Task 13: Add the project Overview page

- `$projectId._index.tsx` no longer redirects to Plan. Its loader reads `getProjectElements`, `getProjectCostSummary`, `getChildServiceProjectCosts`, `getProjectMilestones`, `getProjectOpenTimesheetEntries` and the company time zone, in one `Promise.all`. `today` is in the company time zone.
- `ProjectOverview` has no form and no button: Details (`ReadOnlyFields`: Status, Owner, Customer, Start, Due, Cost Treatment with `termId="cost-treatment"`), Budget (`BarProgress` of actual / budget, then Budget, Committed, Actual), Next milestone (first not completed whose end date is today or later, with elements done; links to Schedule), and Needs attention.
- Needs attention rows: stop-work (links to Settings), overdue borrows (Stock), open change requests (Change requests), time not posted yet (Time). With none: `Empty title="Nothing needs attention" description={null}`.
- The budget figures use `buildProjectCostFigures`, so they equal the Costs page's "Project total" row ($275,000 budget for OB2). The open change request count and the overdue borrows come from the `$projectId.tsx` loader, so this page adds no query for them.
- Deviation: `getProjectElements` has no `estimateAtCompletion`; the Overview passes `null` for it, which changes only the estimate at completion, and the Overview does not show that figure.
- The time-not-posted count is the length of `getProjectOpenTimesheetEntries` (that read stops at 500 rows).
- Code gate: Biome clean, `typecheck --filter=erp` exit 0, `erp test` 2,242 passed, `pnpm --filter erp build` exit 0 with no "Server-only module" line.
- Shots: `13-overview.png` (1440), `13-overview-1920.png`, `13-plan-1920.png`, `13-header-menu-open.png`, `13-plan-from-sidebar.png`, `13-projects-list.png`.
- 7 questions: 1 yes (`flow-agent-panel.jpg` quiet panels), 2 yes at 1440 and 1920, 3 yes (no toolbar), 4 yes (none), 5 yes (no input box anywhere), 6 yes, 7 yes.
- Not in scope and still open: the Plan page body keeps its old toolbar until Tasks 19–20. At 1440 its type chips clip after "System".

## Task 14: Fold Details into the project Settings page

- Settings opens with a "Project" card: Name, Identifier (read-only text), Description, Customer, Owner, Location, Priority, Start and End Date. Four folded sections stay mounted (D14): Accounting (Cost Treatment, CIP Class or Cost Account, Cost Objective), Stock and planning (Project stock and its 2 flags, Planning Group and Priority), Charging, Plan lock. A section opens on its own while one of its fields has an error (`useFormContext().fieldErrors`).
- Cost Objective shows only with `useGovernmentContracting()`; otherwise a `Hidden` field posts the saved value. Planning Group and Priority show only with `hasPlanningGroups`. Every boolean is `bordered`; `termId` on Cost Treatment, Cost Objective, Project stock and Planning Group.
- The card posts to the details action through a fetcher. `/details` redirects to `/settings` (`redirectBeforeLoaders`); its action redirects to Settings. Links that opened Details now open Settings (projects list "Edit Project") or Overview (planning group members, exception project).
- Order: Project, Members (only with Restrict charging on), States, Labels, Project control. Project control shows one `UpgradeOverlayRow` when gated.
- States and Labels are unchanged (Brad's scope change: they move to company settings in a later task).
- Verify: `/details` → `/settings` (`14-details-redirect.png`). With every section folded, the Description changed and saved ("Project updated"); `costTreatment` Contract, `costAccountId` null, `costObjective` Direct, `planningGroupId`, `planningPriority` 10 and `projectStock` stayed the same. The description was put back afterwards.
- Code gate: Biome clean; `typecheck --filter=erp` exit 0; erp 2,261 tests passed.
- Shots: `14-settings.png` (sections folded), `14-settings-open.png` and `14-settings-open-2.png` (Accounting, Stock and planning open).
- Screenshot check: 1 yes (Settings → Inventory cards); 2 yes; 3 yes (no toolbar); 4 yes: the header's next step is the page's primary action, and each card has its own Save, as the settings precedent does; 5 yes; 6 yes; 7 yes (4 folded sections, Layer 5 on Cost Objective and Planning Group).

## Task 15: Simplify the Costs page

- Layer 5: the loader returns no earned value for a project with no control account, before it checks the feature. So a company without the feature sees the upgrade row only on a project with a control account, and it is one `UpgradeOverlayRow`, not the overlay section.
- The Service orders, Burden by pool and Earned value sections each open with the same title bar: `Subheading as="h3" variant="light"` in an `h-12` row. Service orders and Burden by pool keep their column header row under it ("Service order", "Pool").
- `termId`: Control account, Planned value, Earned value, Actual cost (the earned value headers, inline icons) and Pool (`indirect-pool`).
- `ProjectLedgerTable` always passes `emptyState` "No costs posted yet" (no description), so the costs drawer and the Time page both get it.
- `ProjectCostsTree` is unchanged.
- Code gate: Biome clean; `typecheck --filter=erp` exit 0; erp 2,261 tests passed.
- Shots: `15-costs.png` (OB2, earned value under the tree), `15-costs-drawer.png` (OB2-1: the empty ledger), `15-costs-nsops.png` (no control account: no earned value section).
- Environment: the ERP dev server died during this task (502); restarted with `/tmp/uir/start-erp.sh`.
- Screenshot check: 1 yes (the costs tree kept; the job costs sections' plain headings); 2 yes: the earned value headers wrap to 2 lines in their fixed 96 px columns, nothing clips; 3 yes (one row: the earned value period picker); 4 yes (the header's next step only); 5 yes; 6 yes; 7 yes (earned value by Layer 5).

## Task 16: Rebuild the Stock, Pegging and Billing pages under Costs

- Stock: one toolbar row (the project stock rule as muted text, then the **Transfer** `SplitButton` with Borrow and Payback in its menu). Four sections, each a `Subheading` over a compact `Table` with no toolbar of its own: Project stock, Borrowed by this project, Lent by this project, Transfers (this project's latest 10, from `getProjectStockTransfers` with `projectId`, and an "All transfers" link). Pay Back moved from a row button to the row ⋯ menu.
- Pegging: no card. One toolbar row: the description, "As of" with the `DatePicker` in a `w-44` wrapper, Current when a day is set. The empty state is `Empty` ("No pegs yet" / "No pegs on that day"). Override moved from a row button to the row ⋯ menu. The page-level `PlanningGroupsUpgradeOverlay` stays.
- Billing: "Contract lines" and "Billable items" are both `Subheading as="h3" variant="light"`. `ProjectBillableItemsTable` takes an optional `emptyState` and an optional `title` (the Projects → Billing list still passes its title).
- `termId`: project-stock, borrow-payback (both borrow sections), unassigned-stock (on "Unassigned stock" in the transfers list, `StockOwner withHelp`), peg (State), billing-element, billing-method, billable-item. `payback-variance` has no label on these pages to carry it.
- Empty lists on Stock and the no-contract-line case on Billing are one muted line, not the cabinet illustration (same deviation as the Overview).
- Environment: a second start of the dev server failed on the port but re-optimized Vite's dependency cache under the running one, so every dependency answered 504 and the project pages rendered no body. A clean restart (stop, then one `/tmp/uir/start-erp.sh`) fixed it.
- Code gate: Biome clean; `typecheck --filter=erp` exit 0; erp 2,261 tests passed.
- Shots: `16-stock.png`, `16-pegging.png`, `16-billing.png` (OB2 has no billing contract line, so its Billing page shows the empty states; the sidebar does not link it).
- Screenshot check: 1 yes; 2 yes; 3 yes (one toolbar row on Stock and Pegging, none on Billing); 4 yes (Transfer on Stock; the header's next step); 5 yes; 6 yes (Pay Back and Override in row menus, Borrow and Payback in the split menu); 7 yes.

## Task 17: Simplify the Time page

- "Time not posted yet" is a compact `Table` (Date, Employee, Element, Labor Category, Hours, Status) with no pagination, search, column picker, CSV or sort; it sizes to its rows and scrolls past 320 px.
- Both sections open with `Subheading as="h3" variant="light"`: "Time not posted yet" and "Costs posted". `ProjectLedgerTable`'s `title` is optional now, so the Time page draws the heading itself; the costs drawer keeps its title.
- With no open time the section shows one muted line, "All time is posted", not `Empty` (as on the Overview and Stock). The ledger keeps Task 15's `Empty`.
- Code gate: Biome clean; `typecheck --filter=erp` exit 0; erp 2,261 tests passed.
- Shot: `17-time.png` (4 open entries, an empty ledger).
- Screenshot check: 1 yes (the ledger table precedent); 2 yes; 3 yes (no toolbar); 4 yes (the header only); 5 yes; 6 yes (no row actions); 7 yes.

## Task 18: Turn Milestones into the Schedule page

- First build (a timeline over a 6-column table) was rejected by Brad before commit: thin bars with squeezed labels, rows not aligned with the table, a red today line (`bad-schedule-bars.jpg`). Rebuilt to `good-schedule-bars.png`.
- `MilestoneSchedule` (replaces `MilestonesList` and the unused `MilestoneTimeline`): a toolbar row (Today, the Weekly / Monthly / Quarterly `Tabs` that write `?scale`, New Milestone), then two panes sharing one vertical scroll. The left pane (320 px) has "Milestones", the count and a sort toggle (start date, earliest or latest first), then one 60 px row per milestone: a status icon and the name; a hover ⋯ menu (Open, Edit, Complete or Reopen, Delete). The right pane draws each milestone's bar on the same row: 36 px, `rounded-md`, a pastel fill by status (green Completed, blue Active, neutral Upcoming), the name inside with 12 px padding, and a sticky label that stays readable when the bar starts off-screen.
- Header: the period row (months, quarters or years, with a "Current" tag), then the column row (weeks, months or quarters). The current column has a solid pill on its label and a faint tint down the whole pane; faint gridlines at column boundaries; no today line.
- `scheduleLayout`, `scheduleBar`, `spanHolds` (`ui/Milestones/schedule-scale.ts`, 11 tests): whole top-row periods that hold every date and today, one column of margin, at least the pane's width in days, built with `@internationalized/date`.
- Opening scroll: the earliest bar when today's column still fits in view, else today a quarter of the way in; once the pane has a width, and again on a scale change. Today scrolls back to today.
- The drawer (`?milestone=`, the loader's burn read as before) shows status, start, end, elements completed (`Progress`), hours, cost and the burn chart, with Delete, Edit and Complete or Reopen. `MilestoneBurnChart` lost its card and close button (the drawer is its only caller).
- The four intents (`upsert`, `complete`, `reopen`, `delete`) are unchanged.
- Code gate: Biome clean; `typecheck --filter=erp` exit 0; erp 200 files, 2,272 tests passed; `pnpm --filter erp build` exit 0 (on the first build; it runs again at the end of the batch).
- Shots: `18-schedule.png` (1440), `18-schedule-1920.png`, `18-schedule-drawer.png`.
- Environment: the browser session crashed during a shot and the magic link did not arrive; opening `/x` signed in through the dev bypass.

## Task 19: Reduce the Plan loader to Table, Tree and Reader

- Demo data moved: the database was rebuilt, so the company is "Carbon Development" (`db6d4ukm20gg2a6iv1vg`), the only user is `test@carbon.ms` (the dev bypass signs it in, no magic link), OB2 is `prj_5vCwDZeAP2MHdjqYeYe7iP` (10 elements) and NSOPS is `prj_Xn8Bq9qYwbQ6tsjQVHuD7h` (0 elements). `login.sh` now takes `LOGIN_EMAIL`.
- `projectLayouts` is `table`, `tree`, `reader`. `canonicalElementsParams` (models, tested) redirects a URL with no layout or a retired one to `layout=table`, and turns the old `?type=` into `filter=type:eq:…`; every other param stays, `cr` included.
- The loader reads no view and no preference. `$projectId.views.tsx`, the 5 view and preference service functions, the display-state models and `path.to.projectViews` are gone. `generate:mcp` changed nothing (none of them was a tool).
- The Type filter is in the Filter popover (`isExclusive`, one type at a time, because the Tree uses it as a lens). The type chips row is gone with it.
- Verify: `grep -rn "getProjectViews\|projectUserPreference\|savePreference\|projectViews" apps/erp/app` → only `AGENTS.md` (the table row says the tables are unused) and none in code.
- Code gate: Biome clean, `typecheck --filter=erp` exit 0, `erp test` 2,253 passed (11 new in `projects-element-filters.test.ts`).
- Shots: `19-plan-redirect.png` (`?layout=board` ends at `layout=table`), `19-plan-legacy-type.png` (`?type=Requirement` shows the chip "Type is Requirement" and 3 rows), `19-plan-empty.png` (NSOPS).
- 7 questions: the toolbar is still the old one until Task 20 (title, count, layout dropdown, quick-add bar). Answers 1–7 are checked in Task 20.

## Task 20: Give Plan one toolbar row and add rows in the grid

- Brad, 2026-10-12: "remove the Elements from the top bar here. we can keep the search, that should move left and the elements can go in filter". Then, the same day: he likes the sidebar's search, so the Plan page has ONE search, the sidebar's "Search elements" box.
- Toolbar (`ElementsHeader`), one row: the Table / Tree / Reader `Tabs` on the left; Filter and the `SplitButton` "New Element" on the right. No title, no count, no type chips, no toolbar search, no Views, no layout dropdown, no Display popover. Filter chips show in a second row only while a filter is set. In the Reader, an Export PDF icon button sits left of Filter.
- The sidebar search filters the tree at once and writes `?search=` 500 ms after the last key (on the Plan page only), so the Table, Tree and Reader filter on the server. It reads the param back after back/forward.
- Fixed in `TreeView` (shared): a reload of the tree's data (`UPDATE_TREE`) and the first render dropped the active filter. The search reload exposed it. Pinned by `test/tree-view-filter.test.ts`.
- Table: columns ID, Name, Type, State, Owner, Target Date. Name, State, Owner and Target Date edit in place (`useCellSave`). Empty cells show nothing. The row menu (Open, Add child, Move to…, Copy id, Delete) is a ghost ⋯ that shows on row hover or focus. The quick-add bar is gone.
- New Element posts a default name per type ("New Task", …) and the open element as parent to `path.to.newProjectElement`. The Table highlights the new row; the Tree and Reader open its panel.
- Empty project: one muted line "No elements yet. New element" (the link creates a Task). A filter or search with no match: "No elements match."
- Checked in the browser: created NSOPS-1 with New Element, renamed it in the grid to "Ground segment link budget" (the database row changed), deleted it from the row menu (0 rows left).
- Code gate: Biome clean, `typecheck --filter=erp` exit 0, `erp test` 2,255 passed.
- Shots: `20-plan-toolbar.png`, `20-plan-filter-open.png` (Type first in the Filter popover), `20-plan-sidebar-search.png` ("mass": the tree and the Table both show OB2-5 and OB2-6), `20-plan-new-row.png`, `20-plan-renamed.png`, `20-plan-empty.png` (NSOPS), `20-plan-reader.png`.
- 7 questions: 1 yes (`flow-requirements-tree.jpg`: switch, then the split primary; Flow puts the primary left, Brad put the switch left), 2 yes, 3 yes (chips row only while filtering), 4 yes (New Element), 5 yes (cells are borderless until focused), 6 yes (row menu ⋯, Filter popover; Export PDF is the Reader's one output button), 7 yes (cost and schedule columns left the grid; they are on Costs and Schedule).

## Task 21: Delete the List, Board and Timeline layouts

- Deleted `ElementList.tsx`, `ElementBoard.tsx`, `ElementTimeline.tsx`. `QuickAddRow` moved to `ui/Element/QuickAddRow.tsx` (the element's Children section uses it); `MoveElementModal` moved to `ui/Elements/MoveElementModal.tsx` (the Table's row menu uses it).
- `ElementProperties.tsx` lost the `ElementProperties` row, `ActualPill`, `ElementPillData`, the display settings (`ElementDisplay`, `resolveElementDisplay`, `useElementDisplayLabels`) and the grouping labels; `elementFieldKey` is module-private (only `useElementField` reads it). The models lost `elementDisplayProperties`, `elementGroupings` and `timelineZooms`. `timeline-geometry.ts` and its test stay (Schedule).
- Verify: `grep -rn "\bElementList\b\|\bElementBoard\b\|\bElementTimeline\b" apps/erp/app` → 0. The plan's pattern without the leading `\b` also matches `overlayElementList`, a server function that stays.
- `.claude/rules/projects-system.md` → "The Plan page" section rewritten (3 layouts, the redirect, the toolbar, the sidebar search, no views). The docs pages are Task 42.
- Code gate: Biome clean, `typecheck --filter=erp` exit 0, `erp test` 2,255 passed, `pnpm --filter erp build` exit 0 with no "Server-only module" line.
- Shots: `21-plan-tree.png`, `21-plan-reader.png`, `21-plan-element-panel.png` (the panel's Children quick-add still renders; the toolbar stays one row with the panel open).
- Still open for Task 22: the Tree fits to a speck in the top-left corner (`21-plan-tree.png`).

## Task 22: Restyle the Tree cards and fix the fit-view

- Cause of the speck: the canvas fitted with the `fitView` prop and a `requestAnimationFrame` effect. Both ran before the card nodes had a size, and the effect re-ran on every highlight because the layout `useMemo` also held the highlight. The fit clamped to `minZoom` 0.2 and put the tree in the top-left corner.
- A second cause, found in the browser: `useNodesInitialized()` reads `measured` from the node objects. Only an `onNodesChange` handler writes it back, and this canvas has none, so the flag never turns true. The fix: each card states its fixed size (`width`, `height`), and the canvas calls `useNodesInitialized({ includeHiddenNodes: true })`, which reads the measured handles and the declared size.
- The fit is now `treeViewport` (`graph/tree-viewport.ts`, 6 tests). It computes the viewport from the layout's box sizes with `getViewportForBounds`: padding 0.15, at most 100 %. Below 50 % it fits the top box and its first 6 cards. `minZoom` is 0.1. It runs when the nodes are sized, when the box geometry changes (a filter, the root, a collapse) and when the canvas resizes (`ResizeObserver`). The canvas stays transparent until the first fit, so the speck never paints.
- Cards: a grey type label with its icon, then the comment count, the link count (an icon and a number, still the highlight button) and the owner avatar on the right; the name in 2 lines; one chip, the state. The verification icon and the suspect badge left the card; the amber border stays. The readable id is in the `title` tooltip. The link handles show on hover only.
- Boxes: the parent's name sits above the box in the layout's header band. The box is `rounded-lg border border-border bg-muted/30` with no type tint. `elementTypeColors` lost its `label` and `box` colours and became the private `iconColors` in `ElementTypeIcon.tsx`.
- The Fit view, Find and Legend buttons moved from a panel over the canvas (it covered the cards) to the right of the breadcrumb row.
- Code gate: Biome clean; `typecheck --filter=erp` exit 0; `erp test` 199 files, 2,261 tests passed (`tree-layout` and `tree-viewport` included); `pnpm --filter erp build` exit 0.
- Shots: `22-plan-tree.png` (1440), `22-plan-tree-1920.png`, `22-plan-tree-filter.png` (Type is Requirement: refit and centred), `22-plan-tree-nsops.png` (empty project: one centred box), `22-plan-tree-owner.png` (an owner set on OB2-2 for the shot, then cleared), `22-plan-tree-panel.png` (element panel open: the fallback fits the top box at 100 %).
- Screenshot check: 1 yes (Flow's quiet cards and boxes); 2 yes; 3 yes (the breadcrumb row is the canvas's own header, as in Flow); 4 yes (New Element); 5 yes; 6 yes; 7 yes.

## Task 23: Rebuild the element panel and page (Layer 4)

## Task 24: Put all plan lines in one grid

## Task 25: Rebuild ERP My Time as a grid

Shots: `25-my-time.png`, `25-my-time-last-week.png`, `25-my-time-edited.png` (2 h typed on Tue, Tab, the totals went from 15 to 17; then cleared, which deleted the entry). Reference: the inventory count grid.

1. Reference pattern: yes — `Table compact withInlineEditing`, one `EditableNumber` per day, a footer row with the totals.
2. No overlap at 1440: yes.
3. One toolbar row: yes — title and week picker left, Add row (ghost) and Submit right.
4. One primary: yes (Submit and post week).
5. No input box in the table: yes — cells are borderless until opened.
6. Secondary actions in a menu: yes — Correct is in the row menu (shown only when a row has a posted cell).
7. Advanced fields hidden: yes — the timecard line shows only when the week has timecards; Work location and Research role stay under Add row's More.

## Task 26: Rebuild MES My Time as a touch grid

Unverified in the browser: this worktree runs no MES dev server (the brief says not to start one). Checked by `pnpm exec turbo run typecheck --filter=mes` (pass), `pnpm --filter mes test` (6 files, 73 tests pass) and `pnpm --filter mes build` (exit 0, no "Server-only module referenced by client").

## Task 27: Rebuild Approvals with Time and Billing tabs

Shots: `27-approvals-time.png`, `27-approvals-billing.png` (`/x/projects/billing` landed on `/x/projects/approvals?tab=billing`). The demo has no billable item, so the Billing tab shows its empty state.

1. Reference pattern: yes — a list page with its title and a `Tabs` switch, like Job's views.
2. No overlap: yes. 3. One toolbar row: yes (Approvals + Time / Billing). 4. One primary: yes (Approve all per card, as before). 5. No input box in a table: yes. 6. Secondary actions: yes (Reject all, Open timesheet stay on the card). 7. Advanced fields hidden: n/a.

## Task 28: Edit labor category rates in a grid

Shot: `28-labor-rates.png` (Systems Engineer, after Bill Rate 150 was typed, committed with Tab, and the page reloaded; then cleared back to empty through the grid). Known gap: rates have no delete endpoint, so the grid has no delete.

1. Reference pattern: yes — `Grid` with a "New" row, like `SupplierParts`. 2. No overlap: yes. 3. One toolbar row: n/a (a drawer). 4. One primary: yes (Save). 5. No input box in the table: yes. 6. Secondary actions in a menu: n/a (no row actions). 7. Advanced fields hidden: n/a.

## Task 29: Edit contract labor rates, funding actions and rate ceilings in grids

Unverified in the browser. The demo has only Fixed lines. A Draft test contract (CON000002, "UI rebuild T&M check", ORBSEC) was created in the UI and its line switched to Time & Materials, but the line form's Billing Element picker offered no element of OB2, and `customerContractLine_billing_check` refuses a Time & Materials line without one, so the line could not be saved. The test contract was deleted through its own delete route. Checked by typecheck, Biome and the ERP tests only.

## Task 30: Fix My Visits, the Build from part drawer and the Service empty states

Shots: `30-my-visits.png`, `30-customer-assets.png` (ORBSEC Defense, no assets), `30-contract-service-orders.png`, `30-build-from-part.png`.

1. Reference pattern: yes — the title sits top-left like Schedule; the contract tab is a `Table compact`. 2. No overlap: yes; the contract's 8 columns scroll sideways inside the table with the Properties panel open (775 px pane). 3. One toolbar row: yes. 4. One primary: yes. 5. No input box in a table: yes. 6. Secondary actions in menus: yes. 7. Advanced fields hidden: n/a.

## Task 31: Open New Service Order in a drawer

Shots: `31-new-service-order.png`, `31-new-service-order-more.png` (unit chosen, More open). Created SVC000004 (Draft Field Visit, unit SAT-1000-S013) from the drawer; it opened on its Details page.

1. Reference pattern: yes — the New Project drawer. 2. No overlap: yes. 3. One toolbar row: n/a. 4. One primary: yes (Save). 5. No input box in a table: n/a. 6. Secondary actions in menus: yes. 7. Advanced fields collapsed: yes (More).

## Task 32: Give service templates a standard record page

Shots: `32-service-template.png`, `32-service-template-element.png`, `32-element-delete.png`. Checked: added an element from the quick-add row, opened its page, ⋯ → Delete → Delete; it returned to the template and the row was gone.

1. Reference pattern: yes — `RecordHeader` (identifier, muted name, copy at the end), and the element page of a project for the element. 2. No overlap: yes; the plan grid fits the 800 px column. 3. One toolbar row: yes. 4. One primary: yes (none). 5. No input box in the table: yes. 6. Secondary actions in menus: yes (⋯: Add plan line, Delete). 7. Advanced fields hidden: n/a.

## Task 33: Show a locked contract line as read-only text

Shots: `33-contract-line.png` (CON000001, Active, Fixed line, text only), `33-draft-tm-line.png` (CON000003, Draft, the Time & Materials line's form with OB2-1), `33-billing-element-property.png` (the new Billing element switch on an element), `33-billing-branch-refused.png` (OB2-2 refused under OB2-1).

Billing Element picker: no element of the demo had `isBilling`, and nothing in the app set it — the picker read correctly (`isBilling` and a Contract project) but had nothing to offer. The element's Work properties now have a Billing element switch on a Contract project. With OB2-1 marked, the picker offered "OB2-1 Satellite bus", and a Draft T&M line saved (CON000003 "UI rebuild T&M check", ORBSEC Defense, Mission Operations Support → OB2-1). Task 29's grids then took rows: funding action P00001 / AA / $250,000.00, labor rate Systems Engineer $185.00 (`29-contract-line-billing.png`, `29-contract-line-grids.png`). OB2's Billing page shows the line (`29-project-billing.png`). Rate ceilings show for a Cost Plus line only, so they are not in the shots.

1. Reference pattern: yes — `ReadOnlyFields`, the form's labels and groups. 2. No overlap: yes. 3. One toolbar row: yes. 4. One primary: yes (the header's). 5. No input box: yes, none on a locked line. 6. Secondary actions in menus: n/a. 7. Advanced fields hidden: the Revenue group is shown as text (nothing to fold on a read-only view).

## Task 34: Rebuild Projects → Reports as one list

## Task 35: Turn Indirect Rates into a runs list with a Rates drawer

Shots: `35-indirect-rates.png` (no runs yet: the `Empty` state), `35-indirect-rates-menu.png`, `35-indirect-rates-drawer.png`. Checked: ⋯ → Statement opens the statement drawer.

Step 3 stopped: a grid cell does not map to one rate entry. `set-rate` (`setIndirectRate`, `indirectRateRows`) writes the rate from `fromPeriod` to period 12, so a typed cell would overwrite every later month of that pool and rate type. The drawer's grid stays read-only, and Set Rate (the existing modal) sits in the drawer header. `SetIndirectRateModal` keeps its caller.

1. Reference pattern: yes — the Revenue Recognition runs list. 2. No overlap: yes; the 12 months scroll sideways inside the drawer. 3. One toolbar row: yes (title, fiscal year, ⋯, Run Period). 4. One primary: yes (Run Period). 5. No input box in a table: yes. 6. Secondary actions in menus: yes (⋯: Rates, Run True-Up, Statement, ICE Export). 7. Advanced fields hidden: yes.

## Task 36: Move Burden Settings to Settings → Accounting and default the fiscal year

Shots: `36-settings-accounting.png`, `36-settings-accounting-burden.png` (the card after Fixed Assets), `36-ice-bare.png` (opens FY2026), `36-statement-bare.png`. No "could not be completed" text on either bare URL. Checked: Save on the card toasts "Burden settings saved".

1. Reference pattern: yes — the Lease Classification and Fixed Assets cards. 2. No overlap: yes. 3. One toolbar row: n/a. 4. One primary: yes (Save per card, as the page). 5. No input box in a table: n/a. 6. Secondary actions in menus: n/a. 7. Advanced fields hidden: n/a.

## Task 37: Match Settings → Timekeeping and Projects to Settings → Inventory

Shots: `37-settings-timekeeping.png` (Standard: the Controls card alone), `37-settings-timekeeping-dcaa.png` (DCAA picked, not saved: the DCAA rules card appears), `37-settings-projects.png`. Checked: Save under Standard toasts "Timekeeping settings updated" and keeps the DCAA values (1 day, 40 hours).

1. Reference pattern: yes — Settings → Inventory (`SettingsPage`, `SettingsPageHeading`, a card per subject, 400 px short fields). 2. No overlap: yes. 3. One toolbar row: n/a. 4. One primary: yes (one Save). 5. No input box in a table: n/a (the projects grids are Task 14's). 6. Secondary actions in menus: n/a. 7. Advanced fields hidden: yes, the DCAA rules show only under DCAA.

## Task 38: Sweep the remaining empty states

Shots: `38-baselines.png`, `38-change-requests.png` (OB2 has neither: the `Empty` state, one action in the header), `38-planning-groups.png` (one row, unchanged). Verify grep: `border-dashed` outside `ElementBoxNode` in the projects and service modules and routes: 0.

1. Reference pattern: yes — `Empty` for a page or list, one muted line inside a form. 2. No overlap: yes. 3. One toolbar row: yes. 4. One primary: yes (the empty states no longer repeat the header's button). 5. No input box in a table: n/a. 6. Secondary actions in menus: n/a. 7. Advanced fields hidden: n/a.

## Task 39: Sweep every boolean field to bordered

## Task 40: Sweep the glossary popovers onto the rebuilt screens

- 16 form fields got `termId` and 21 column headers or section labels got `LabelWithHelp` (`variant="inline"`), across 27 files in the projects, service, contract and indirect rates modules and their routes. New terms covered here: `allowability` (the Unallowable columns of the costs tree, burden by pool and the expense statement), `cpi`, `spi`, `burden` (Burden by pool), `requirement` (the element's Requirement group), `research-role`, `funded-research`, `rate-ceiling`, `billable-item`, `charge-number`, `control-account`, `earned-value`, `coverage`, `service-order`, `indirect-pool`, `billing-method`, `revenue-method`, `clin` (CLIN / SLIN), plus the existing `element`, `labor-category` and `milestone`. `PropertyField` and `PropertyGroup` (`ui/Element/PropertyFields.tsx`) take an optional `termId`.
- Not changed, on purpose: the module list tables (Service Orders, Labor Categories, Planning Groups, Indirect Pools, the project ledger, the indirect rate runs). A JSX header drops a sortable column from the Table's Sort picker (`sortKeyToLabel` keeps string headers only). The ERP `Table` columns that did change keep their CSV heading through `meta.filterHeader`. Menu items (Baselines, Change requests, Stop work) and sidebar links get no icon. The report pages (`projects+/reports.*.tsx`) and `TimesheetGrid.tsx` belong to another session's uncommitted work and were left alone. "Ceiling" on a contract line is the funding ceiling, not a rate ceiling, so it has no `termId`.
- Verify: `@carbon/content` test 17 passed; `docs` typecheck exit 0; `typecheck --filter=erp` exit 0; erp tests 2,272 passed.
- Shots: `40-glossary-popover.png` (OB2 Settings, Accounting open, the Cost treatment popover), `40-element.png` (the Milestone icon in the properties column).

1. Reference pattern: yes — `LabelWithHelp` as on the Bill Rate and ACRN headers. 2. No overlap: yes. 3. One toolbar row: unchanged. 4. One primary: unchanged. 5. No input box in a table: unchanged. 6. Secondary actions in menus: unchanged. 7. Advanced fields hidden: unchanged.

## Task 41: Update the rules, AGENTS.md, lessons and the design skill

- Rules: `projects-system.md` has a new *Information architecture* section (module sidebar, list, workspace, element page, Layer 5) and drift fixes (Costs, Stock, Pegging and Billing are pages; billing review is Approvals → Billing; transfers open from the Stock page; the overdue borrows row is on the Overview, not the header; the Plan page and element page as built). `field-service.md` (elements, not nodes; a *Module UI* section: sidebar, New drawer, template pages, empty states; the contract tab's 5 columns), `project-billing.md` (review, the Billing element switch, the line billing page, the project Billing page), `project-control.md` (where earned value shows), `indirect-rates.md` (runs list, Rates drawer, Burden Settings in Settings → Accounting, current fiscal year), `government-contracting.md` (where the fields show, Settings → Timekeeping; the other session's Missing Time block is not in this commit), and "common stock" → "unassigned stock" in the prose of `inventory-system.md`, `mrp-system.md`, `traceability-model.md`.
- AGENTS.md: projects (a *UI Layout* section, company-wide states and labels, Approvals, `updateProjectElementBilling`; the other session's two Missing Time lines are not in this commit), service, items and inventory (unassigned stock).
- Design skill: the precedent-screen rule in Step 2 and the Done list; the real `Empty` and the "one muted line" rule for a section; anti-patterns (everything on the first screen, panel in a panel, a `Subheading` per section, collapsible sidebar groups, striped bars); the grouped work list and the Excel grid in *tables-and-lists*; `Boolean bordered` and `hideOptionalTags` in *forms*; worked example 4 (the project workspace).
- Lessons: "Every UI task names its precedent screen and is checked by screenshot against it" (today's main mistake), "A collapsed form section keeps its fields mounted", "A company with time zone UTC shifts every business day".
- Verify: the plan's grep (`ElementList`, `ElementBoard`, `ElementTimeline`, `projectView`, `common stock`) finds only the List that exists again, `projectView` as the table that stays, and `overlayElementList`; "common stock" → 0.
- Found and not fixed (code, not docs): the `createProject` comment in `projects.server.ts` still says "six default states"; `ChoicePill` in `ui/Elements/ElementProperties.tsx` is unused; code comments still say "My Timesheet" (`useServiceSubmodules.tsx`, `TimesheetApprovals.tsx`). The element page's Government contracting group tests DCAA alone, not `useGovernmentContracting()` (as Brad's note of the second review says).

## Task 42: Update the docs reference pages

- `projects.mdx`: the module sidebar; a new *The project workspace* section (header, sidebar, Layer 5); *The Plan page* (List, Tree, Reader, Filter, Search elements, New Element) and *The element page* replace "Layouts and the element page" (no inbound glossary anchor); the Milestones section describes the Schedule (heading kept: a glossary entry links to it); states and labels at Settings → Projects; status moves in the ⋯ menu, "Work Complete"; Stock, Pegging and Billing under Costs; transfers from the Stock page; "Unassigned stock"; My Time; Approvals tabs; earned value headers; keyboard shortcuts rewritten to the real bindings; the in-app agent notes and route list. Board, Table, Timeline, Display, Views and the Details tab are gone.
- `service-orders.mdx`: the sidebar, the New drawer (More), "element" for "node", Build from part, My Time, Work Complete, the template element page.
- `project-billing.mdx`: the Billing element switch, Edit Funding in the ⋯ menu, the labor rate grid, review in Approvals → Billing or the project Billing page.
- `government-contracting.mdx`: Cost Objective on Settings, the element's Government contracting group (DCAA), the Timekeeping screenshot label, My Time, members under Charging, Correct in the row menu, the Funding Actions headers. The other session's lines (Timesheet required, the Reports intro, Missing Time) are not in this commit.
- `contracts.mdx`: no billing UI path to change.
- Verify: `docs` typecheck exit 0; the link check prints no MISSING; `@carbon/content` test 17 passed (it checks every glossary link and anchor).

## Task 43: Fill the translations

## Task 44: Run the final screenshot pass

Screens shot at 1440 × 900 (and the 5 workspace pages at 1024 × 768) on 2026-10-12, signed in as `test@carbon.ms` in the agent-browser session `uir-final`. Shots are in `.ai/scratch/ui-rebuild/` (git-ignored). "Passes the checks" means all 7 questions of the screenshot check are yes. The record ids are the current ones (OB2 `prj_5vCwDZeAP2MHdjqYeYe7iP`, SVC000001 `svc_CkLCmMQLPLzMKBJhbijLYU`, CON000001 `con_EgV3wUdAaChPJGWYgr8MQj`, CON000003 `con_HPq5QWsbf5He5J8SBUwyUe`, template TPL-FMQKGZ, Systems Engineer `lbc_6xtdZUYAge7BuQ1epf3wyB`).

| Screen | Screenshot | Passes the checks | Note |
|---|---|---|---|
| Projects list | `99-projects-list` | y | One New Project; Filter; Approvals is absent (no time approval or DCAA in the dev company). |
| Project Overview | `99-project-overview, -1024` | y | One muted fact line, Budget, Next milestone, Needs attention. |
| Plan, List | `99-project-elements, 99-project-plan-1024` | y | Linear list grouped by state; one toolbar row. |
| Plan, Tree | `99-plan-tree` | y | The breadcrumb crumb is capped at 192 px (`max-w-48`, deliberate), so the project name truncates. |
| Plan, Reader | `99-plan-reader` | y | Export PDF is the icon button beside Filter. |
| Element page (Requirement) | `99-project-element, 40-element` | y | No Optional tags (fix A5); Milestone glossary icon. |
| Element page (System, plan lines) | `99-element-page-system` | y | The plan grid fits the 800 px column. |
| Schedule | `99-project-schedule, -1024` | y | Monthly scale, current quarter tinted. |
| Costs | `99-project-costs, -1024` | y | At 1024 px the tree scrolls sideways inside its pane (its 63 rem minimum). |
| Time | `99-project-time, -1024` | y | At 1024 px the Status column scrolls inside the table. |
| Stock | `99-project-stock` | y | Transfer split button; empty sections are one muted line. |
| Pegging | `99-project-pegging` | y | As of in the toolbar row. |
| Billing (project) | `a2-project-billing, 99-project-billing` | y | Fix A2: five columns, the line name truncates with a tooltip. |
| Settings (project) | `99-project-settings, 40-glossary-popover` | y | Folded sections; glossary popovers. |
| Baselines | `99-baselines` | y | `Empty`; one action in the header. |
| Change requests | `99-change-requests` | y | `Empty`; one action in the header. |
| My Time (ERP) | `99-my-time` | y | Grid, footer totals, Add row quiet. |
| My Time (MES) | `—` | n/a | No MES dev server in this worktree (502); not shot. |
| Approvals (Time, Billing) | `99-approvals, 99-approvals-billing` | y | Tabs; `Empty`. No sidebar link is active, because Approvals is hidden while time approval and DCAA are off. |
| Labor category drawer | `99-labor-category` | y | Rates `Grid`; Research role glossary icon. |
| Planning groups | `99-planning-groups` | y | Unchanged list. |
| Reports | `99-reports` | n/a | Another session's uncommitted work (Task 34 follow-up); not judged here. |
| Indirect Rates | `99-indirect-rates` | y | Runs list, `Empty`, ⋯ and Run Period. |
| Indirect Rates drawer | `a4-indirect-rates-drawer, 99-indirect-rates-drawer` | y | Fix A4: twelve months fit (890 px, no overflow). |
| Service orders list | `99-service-orders` | y | One Add Service Order. |
| New Service Order drawer | `99-new-service-order` | y | More folded. |
| Service order (Details, Work) | `99-service-order, 99-service-work` | n | Not rebuilt by this plan: the header shows Put on Hold, Complete and Cancel as three buttons (see open items). No Optional tags in Properties (fix A5). |
| Service schedule | `99-service-schedule` | y | Unchanged. |
| My Visits | `99-my-visits` | y | Title aligned left. |
| Service template | `99-service-template` | y | Record header, copy at the end. |
| Contract line (Fixed, locked) | `99-contract-line` | y | Read-only text; glossary icons. |
| Contract Service Orders tab | `a1-contract-service-orders, 99-contract-service-orders` | y | Fix A1: five columns, no sideways scroll beside Properties. |
| Contract line billing (T&M) | `a3-contract-line-billing, 99-contract-line-billing` | y | Fix A3: Review Items is a link in the card description. |
| Settings → Timekeeping | `99-settings-timekeeping` | y | Matches Settings → Inventory. |
| Settings → Projects | `99-settings-projects` | y | States and labels grids. |
| Settings → Accounting | `99-settings-accounting` | y | Burden Settings card. |

- Environment: the ERP dev server stopped during the pass (502 on the last shots); nothing listened on `PORT_ERP`, so it was restarted with `/tmp/uir/start-erp.sh` and the failed shots were taken again.
- Fixed in this pass (`7b35971dcb`): the Copy from helper text, and "My Timesheet" in code comments.
- Fixed in this pass: Settings → Timekeeping (Task 37) seeded `useState` from loader data, which the `no-state-copy-of-loader-data` conformance check refuses. Only the user's pick is state now; until a pick, the saved setting decides. Checked: picking DCAA shows the DCAA rules card before a save (`44-timekeeping-dcaa.png`).
- Gates: `pnpm --filter erp build` exit 0 (no "Server-only module referenced by client"), `pnpm --filter mes build` exit 0, `pnpm --filter @carbon/checks test` 300 passed after the Timekeeping fix, `typecheck --filter=erp` exit 0, erp tests 2,272 passed.
- Bigger, not fixed: the service order header has three transition buttons (Put on Hold, Complete, Cancel), outside this plan's scope; Approvals has no sidebar link while time approval and DCAA are off, so billing review is reached only from the project and line pages; MES My Time is unverified in a browser.

## Fixes after the review (Part A, 2026-10-12)

- A1 `5b3b9b3169`: the contract's Service Orders tab shows Service Order, Status, Customer Asset, Scheduled (next unfinished visit) and Total Cost; the site, dates and billed amount stay on the order page.
- A2 `10517c554b`: the project Billing contract lines have five columns; the line name is one truncated line with a tooltip; Method left (it is on the line's page).
- A3 `9e55970dd0`: Review Items on the line billing page is a link in the Billable Items card's description, not a washed-out full-width button.
- A4 `d6b2448a74`: the Indirect Rates drawer's grid uses narrow cell padding; twelve months fit the `xl` drawer at 1440 px.
- A5 `12cb424c52`: the element page's properties column and the service order's Properties panel hide the "Optional" tag (`hideOptionalTags`, a `data-optional-tag` attribute on `FormLabel`'s tag); `isOptional` stays, so the clear buttons stay.

## Batch close (2026-10-12): header, menus, final build

- Header (`da5a18a411`): no primary button; the status transitions open the ⋯ menu (next step first); the copy button and ⋯ menu at the right end (`RecordHeader` `toolsPlacement="end"`). Shot `header-no-primary.png`. NSOPS: Put on hold, then Resume, from the menu; it ends Released.
- Menus: no stray scrollbar reproduced in 11 menus at DPR 1 and 2 (see the plan's execution notes). No code change.
- `pnpm --filter erp build` exit 0 after the last commit.

