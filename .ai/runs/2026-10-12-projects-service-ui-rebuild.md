# Projects and Service UI rebuild — run log

Plan: `.ai/plans/2026-10-12-projects-service-ui-rebuild.md`. Screenshots go to `.ai/scratch/ui-rebuild/` (git-ignored). Viewport 1440×900. User `satellite-demo@carbonos.dev` at https://erp.projects-wbs-research-spec.dev.

## Task 1: Set up the screenshot scripts, the run log and the baseline shots

- The scripts `login.sh` and `shot.sh` exist and are executable. The browser session `ui-rebuild` was already signed in, so `login.sh` printed `LOGIN FORM NOT FOUND` and the URL `/x`.
- 22 baseline shots `00-*.png` are saved. The inventory count reference is `00-ref-inventory-count.png` (count `ic_8L6hmHD9ykkCuj9GvKYiTR`).
- `/x/project/…/elements` opens with `?layout=list` (the saved layout preference).
- No error text showed on any baseline screen.

## Task 2: Apply the terminology table and add the glossary entries

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

## Task 13: Add the project Overview page

## Task 14: Fold Details into the project Settings page

## Task 15: Simplify the Costs page

## Task 16: Rebuild the Stock, Pegging and Billing pages under Costs

## Task 17: Simplify the Time page

## Task 18: Turn Milestones into the Schedule page

## Task 19: Reduce the Plan loader to Table, Tree and Reader

## Task 20: Give Plan one toolbar row and add rows in the grid

## Task 21: Delete the List, Board and Timeline layouts

## Task 22: Restyle the Tree cards and fix the fit-view

## Task 23: Rebuild the element panel and page (Layer 4)

## Task 24: Put all plan lines in one grid

## Task 25: Rebuild ERP My Time as a grid

## Task 26: Rebuild MES My Time as a touch grid

## Task 27: Rebuild Approvals with Time and Billing tabs

## Task 28: Edit labor category rates in a grid

## Task 29: Edit contract labor rates, funding actions and rate ceilings in grids

## Task 30: Fix My Visits, the Build from part drawer and the Service empty states

## Task 31: Open New Service Order in a drawer

## Task 32: Give service templates a standard record page

## Task 33: Show a locked contract line as read-only text

## Task 34: Rebuild Projects → Reports as one list

## Task 35: Turn Indirect Rates into a runs list with a Rates drawer

## Task 36: Move Burden Settings to Settings → Accounting and default the fiscal year

## Task 37: Match Settings → Timekeeping and Projects to Settings → Inventory

## Task 38: Sweep the remaining empty states

## Task 39: Sweep every boolean field to bordered

## Task 40: Sweep the glossary popovers onto the rebuilt screens

## Task 41: Update the rules, AGENTS.md, lessons and the design skill

## Task 42: Update the docs reference pages

## Task 43: Fill the translations

## Task 44: Run the final screenshot pass

