# MES phone layout, round 2

> Status: approved
> Date: 2026-10-07
> Extends: `.ai/specs/2026-10-07-mes-phone-layout.md` (round 1) and `.ai/specs/2026-10-07-viewport-api.md` (`max-md:`, `useViewport`)
> Evidence: a round-1 review of 16 screens at 393px by 3 reviewers (space and layout, navigation, operator tasks). Each scored about 40/100.
> The review files (session scratch, not committed): `mes-r1/review-layout.md`, `mes-r1/review-nav.md`, `mes-r1/review-operator.md`, `mes-r1/round1.html`.

## TL;DR

- MES phones get real app chrome: one app bar on every page and a bottom tab bar (Schedule · Assigned · Active · Maintenance · More).
- Cards, toolbars and the Operation page use the screen better: 2-column cards, a 1-row toolbar, less fixed chrome.
- Task screens show their task: Inspection cells, the material Issue button and Picking Finish move into view and into thumb reach.
- Back goes to the page you came from, and the timer toggle opens on the running timer. Both also change desktop.
- Everything else at 768px and up stays the same. No new data and no new features, except 1 approved confirmation step.

## Problem

Round 1 fixed horizontal overflow. It did not fix chrome, density or task reach. The round-1 review found these faults (scores are the average of 3 reviewers):

| Screen | Score | Main fault |
|---|---|---|
| My Hours | 16 | The page has no header and no nav button. On a phone, the user cannot leave it. The table clips mid-word. |
| Inspection | 26 | The sample-entry columns start past the right edge. 5 icon-only actions crowd the header. |
| Job detail | 31 | The graph is left-to-right in a portrait screen. Nodes are about 35px wide. The minimap covers a corner. |
| Operation | 36 | Fixed chrome takes 40% of the screen. The phone does not show which timer runs. The Issue button is off-screen. |
| Schedule | 39 | The toolbar takes 3 rows. A card is about 395px tall, so 1.4 cards fit. |
| Picking detail | 42 | No Back. Finish is a 32px button at the top. |
| Assigned, Active, Recent | 43–48 | Card fields use the left half only. The list view greys out the item name and quantity. |
| Maintenance dispatch | 46 | An unlabelled Complete sits 16px from Start and completes with no confirmation. |
| Nav sheet | 54 | Count badges float away from their rows. The footer and the user row are below the fold. |

Faults that every reviewer found:

1. The only phone navigation is a 28px icon in the top-left corner (`packages/react/src/Sidebar.tsx:300`).
2. 13 routes build their own header. Heights are 50px, 52px or auto. Titles are 14px on phones (`Heading` `h4`).
3. Operation Back always goes to Schedule (`JobOperation.tsx:806-813`).
4. Default buttons are 32px (`Button` `md`). Completing actions sit at the top of the screen.

## Goals

- A user can reach every MES section from every root page with 1 tap in the bottom third of the screen.
- Every page has the same app bar below 768px: the same height, gutter, title size and Back control.
- Each work-card screen shows at least 2 full cards above the fold at 393×852.
- On the Operation page, the scrolling content gets at least 65% of the screen height.
- Each task screen shows its primary input and its completing action without a sideways scroll.
- All interactive controls that this spec touches are at least 44px on phones.
- The round-2 review scores the screens at 75/100 or more on average.

## Non-goals

- No new data, KPIs, Scan button or inbox. The approved exceptions are the 2 desktop changes and the dispatch confirmation below.
- No Clock Out confirmation (owner decision).
- No change to the 3D model viewers, the wall displays or dialog content.
- No change to the scroll model of the app shell. The layout reviewer suspects that nested scroll areas keep the browser toolbar expanded. Nobody verified this on a device, so it stays out of this round.
- No per-user tab bar settings.
- No dock on the Instructions and Chat tabs (today's behaviour stays).

## Design

All phone styles use `max-md:`. A component tree changes only where CSS cannot do it. Use CSS (`md:hidden`) for the tab bar. The MES has no server viewport hint, so `useViewport()` renders "desktop" on the server.

### Phase 1: app chrome and navigation

#### 1.1 Safe areas

- Add `viewport-fit=cover` to the viewport meta in `apps/mes/app/root.tsx`. The ERP has it already. Without it, `pb-safe` is 0 on iPhones, and the dock and the tab bar sit on the home indicator.

#### 1.2 `MesAppBar` (new, `apps/mes/app/components/MesAppBar.tsx`)

One header component for every MES page. At 768px and up it renders the markup that each page renders today: the sidebar trigger, the title and the page actions. Below 768px:

| Part | Phone spec |
|---|---|
| Container | `sticky top-0`, 52px plus `pt-safe`, `border-b`, `bg-card`. The same on root and pushed pages. |
| Left, root page | No sidebar trigger. The tab bar and More replace it. The title starts at the 16px gutter. |
| Left, pushed page | A 44×44 Back icon button (`LuChevronLeft`, `aria-label` "Back"). It goes to the origin page (1.5), else to the parent page. |
| Title | 17px, semibold, 1 line, ellipsis. Root: the page title. Pushed: the record ID. |
| Subtitle (pushed) | 12px muted: the parent page name, for example "Assigned". It replaces the "‹ Schedule" text button. |
| Right | At most 2 icon actions, each 44×44. |

Props: `title`, `subtitle?`, `back?: { to: string }`, `actions?: ReactNode`, `kind: "root" | "pushed"`. Move these headers onto it: operations, assigned, active, recent, jobs, maintenance, picking list, picking detail, timecard, job detail, dispatch detail, operation, inspection, assembly.

#### 1.3 `MesTabBar` (new) on a shared `TabBar` (new, `packages/react/src/TabBar.tsx`)

- Lift the presentational tab markup from `apps/erp/app/components/Layout/Mobile/MobileTabBar.tsx` (the `Tab` and its class names) into `TabBar` and `TabBarItem` in `@carbon/react`. `TabBarItem` takes `icon`, `label`, `to` or `onClick`, `isActive` and an optional `count`.
- Point the ERP `MobileTabBar` at the shared parts. The ERP tab bar must look the same as before.
- Build `apps/mes/app/components/MesTabBar.tsx`:

| Tab | Icon | Target |
|---|---|---|
| Schedule | `LuCalendarDays` | `path.to.operations` |
| Assigned | `LuClipboardList` | `path.to.assigned` |
| Active | `LuActivity` | `path.to.active`, count `activeEvents` |
| Maintenance | `LuWrench` | `path.to.maintenance`, count `activeMaintenanceCount` |
| More | `LuMenu` | opens the existing Navigation sheet (`useSidebar().setOpenMobile(true)`) |

- Labels, icons and targets come from one shared list. Export `QUEUES` and the titles map from `AppSidebar.tsx`, so the rail and the tab bar cannot drift.
- Show the bar on root pages only: Schedule, Assigned, Active, Recent, Jobs, Maintenance, the Picking list and My Hours. Match the Picking list by exact path, because `/x/picking/:id` shares the prefix.
- Hide the bar on pushed pages: Operation, Assembly, Inspection, Batch, Job detail, Dispatch detail and Picking detail.
- Hide the bar while a text input has focus.
- Active tab: foreground icon and label, a pill behind the icon, `aria-current="page"`. On Recent, Jobs, Picking and My Hours, the More tab is active.
- Count: a 16px pill on the icon. Hide it at 0.
- Size: 54px plus `pb-safe`. Root page content gets bottom padding for the bar. Toasts sit above the bar.

#### 1.4 Navigation sheet (`packages/react/src/NavRail.tsx`, phone branch only)

1. Place the count badge inline at the end of its row, vertically centred.
2. Pin the footer (Clock In, My Hours, the user row) below the scrolling groups, with `pb-safe`.
3. Add a trailing `LuArrowUpRight` to the rows that leave the app (the brand row and Displays).

The sheet keeps every desktop item, in the same groups and order.

#### 1.5 Back returns to the origin (desktop too)

1. Links into an operation pass the origin page: `OperationsList.tsx`, `Kanban/components/ItemCard.tsx` and `JobDag/JobOperationNode.tsx`. Use a `?from=` search parameter with the current path.
2. Operation, Assembly and Inspection read `from`. The Back target is that path, else `path.to.operations`.
3. The Back label is the title of the origin queue, from the shared titles map. On desktop the "‹ Schedule" button shows that title.
4. The redirects in `operation.$operationId.tsx` keep the search string, so `from` survives them. React Router drops `location.state` on a loader redirect, so `state` cannot carry the origin.

#### 1.6 Page titles (desktop too)

- "Assigned to Me" becomes "Assigned" (`assigned.tsx`).
- "Open Jobs" becomes "Jobs" (`jobs.tsx`).

#### 1.7 My Hours

1. Add `MesAppBar` (root, title "My Hours").
2. Below 768px, put Clock In / Clock Out in a sticky bottom bar as a full-width `lg` button. Keep the red Clock Out and the "Clocked in since" badge.
3. Below 768px, show each entry as a row: line 1 is the day and the duration, line 2 is the clock-in and clock-out times. The ⋮ menu becomes a trailing 44px button.
4. Show the empty message outside any scroller.
5. Below 768px, Prev and Next become 44px icon buttons, so the week range fits on 1 line.

### Phase 2: space

#### 2.1 Work cards (`ItemCard.tsx`, `OperationsList.tsx`)

- Below 768px, lay the card fields out in a 2-column grid. The job and the operation description span both columns. Status and duration, deadline and date, and sales order and customer pair up.
- Move the assignee and tags into the grid. Hide the separate footer band below 768px.
- Put the 2 progress bars side by side in 1 row.
- Fix the list card colours: the title and the quantity use `text-foreground`, as on the board card.
- Keep every field that the card shows today.

#### 2.2 Toolbars (Schedule, Assigned, Active, Recent)

- Row 1: Search (full width) and Filter (40×40 icon button).
- Row 2, only when present: the station chip and the active filter chips, in a sideways-scrolling row with an edge fade. The chip × gets a 44px hit area.
- Display, and on Assigned the board/list toggle, move into the app bar's 2 action slots.
- Active and Recent: remove the fixed toolbar height that makes the search overlap the cards.

#### 2.3 Board (`ColumnCard.tsx`)

- A single column fills the width (`max-md:only:w-full`).
- Size the board with flex instead of `calc(100dvh - …)`.
- Hide the horizontal scrollbar pill and the column drag grip below 768px.
- Column header padding drops to `py-2`.

#### 2.4 Operation page (`JobOperation.tsx`, `Controls.tsx`)

1. Below 768px, the context row (job ID, customer, description, status, duration, due) moves into the scrolling content area. It scrolls away with the content.
2. Below 768px, order the context items: status, due, customer, description, duration.
3. Below 768px, the meters fit in 1 row of 4. The label sits above, the value below. Values use 12px and do not truncate.
4. The toggle opens on the running timer type (all widths). If no timer runs, keep today's order: Setup, Machine, Labor (`useOperation.tsx`).
5. Below 1024px, the dock shows the running type and elapsed time, for example "Machine · 2d 6h". This label exists today but is hidden below 1024px.
6. Below 1024px, the + and ⋮ dock buttons get 12px captions: "Log completed" and "More". Use the existing Lingui strings.
7. Below 768px, the Completed, Scrapped and Due Date cards become 1 grouped card with 3 rows.
8. The job ⋮ button gets a 44px hit area on phones.
9. The green Start, the red Pause and the dock actions do not change.

#### 2.5 Picking detail (`picking.$pickingListId.tsx`)

1. Use `MesAppBar` (pushed, title is the list ID, Back to Picking). The status pill moves to the first content row.
2. Below 768px, "N/M lines" and Finish move into a sticky bottom bar. Finish is a full-width `lg` button.
3. Remove the inner bordered wrapper below 768px, so there is 1 container level.
4. Use a smaller thumbnail and `line-clamp-2` for item names.
5. The open-quantity badge becomes a neutral pill. Emerald stays for picked and orange for short.
6. Pick and Short become 48px tall below 768px.

#### 2.6 Smaller fixes

- Picking list: the label/value rows stretch to full width, so the values right-align.
- Jobs: the item ID and the description share 1 line. Quantity uses `text-foreground`.
- Maintenance: the tab row gets an edge fade and scrolls the active tab into view. The impact pill and the avatar move into the card header.

### Phase 3: task screens

#### 3.1 Inspection (`InspectionMeasurementMatrix.tsx`, `InspectionView.tsx`)

1. Below 768px, the sticky Characteristic column is 150px wide. The Gauge picker moves into the Characteristic cell as a second line, and the Gauge column hides. Sample 1 is then visible.
2. Add an edge fade to the matrix and to the meta bar.
3. The bordered frame wraps its rows. It does not stretch to the bottom.
4. Below 768px, Accept, Reject, Partial and Complete passed move into a bottom action bar of labelled 48px buttons. Accept is the primary button.
5. The header keeps the ID, the status and the timer. The timer shows its elapsed time on phones.
6. Put the Completed / Scrap / Rework counts first in the meta bar on phones.

#### 3.2 Materials on the Operation page

- Below 768px, render each material as a row card instead of the table. Line 1 is the part ID and "Actual / Estimated". Line 2 is the description. Line 3 is the existing badges. A trailing 44px Issue button uses the existing action.
- The tracked (serial/batch) Issue branch gets the same row.
- At 768px and up, the table stays.

#### 3.3 Job detail graph (`JobDag.tsx`)

- Below 768px, the default direction is top-to-bottom. The direction toggle stays.
- Below 768px, hide the minimap.
- The graph toolbar buttons are 44px on phones.
- Wrap "Left to Right" and "Fit" in Lingui.

#### 3.4 Maintenance dispatch (`dispatch.$dispatchId.tsx`)

1. Use `MesAppBar` (pushed, Back to Maintenance).
2. Below 768px, Start/Pause stays the big round button. Complete becomes a labelled full-width secondary button below it.
3. Complete opens a confirmation (all widths, owner decision). The confirmation names the dispatch and has Cancel on the left and Complete on the right.
4. Hide the Description card when the document has no text.
5. The work-centre name becomes the card title, so the label-only band goes away.

#### 3.5 Empty states

Active, Schedule, Jobs, Picking list and Maintenance use a neutral muted icon and a 17px title on phones. Keep the existing strings. Add no new text.

## Design Decisions

| Decision | Choice | Why |
|---|---|---|
| Phone navigation | Bottom tab bar with 4 queues + More | 1 tap in the thumb zone. Uses only MES sidebar items. Owner approved. |
| Which 4 tabs | Schedule, Assigned, Active, Maintenance | The first 3 rail items, plus the 2 items with counts. Owner approved. |
| Tab bar code | Shared `TabBar` in `@carbon/react`, used by ERP and MES | The ERP tab bar imports ERP-only modules, so MES cannot use it as-is. The repo rule puts shared UI in a package. |
| Tab bar visibility | CSS (`md:hidden`), root pages only | MES has no server viewport hint. A JS switch flashes on hydrate. Pushed pages have their own bottom bars. |
| Header | One `MesAppBar` for 14 pages | 13 hand-built headers disagree on height, title size and Back. |
| Back target | The `?from=` parameter, else the parent page | Back must go where the user came from. Owner approved the desktop change. |
| Card density | 2-column grid, all fields kept | Owner chose this over a 3-line summary. Adapt, do not remove. |
| Timer toggle default | The running type, all widths | Today a phone shows Start while Machine runs. Owner approved the desktop change. |
| Materials on phones | Row cards with a visible Issue button | The table hides the Issue button off-screen. Same data, different container. |
| Inspection on phones | Narrow first column, gauge folded in | Smallest change that puts sample 1 in view. A card-per-characteristic stepper is larger. |
| Job graph | Top-to-bottom, no minimap on phones | Owner approved. The canvas stays a canvas. |
| Dispatch Complete | Confirmation at all widths | Owner approved. Complete is 1 tap from Start today. |
| Shell scroll model | No change | The browser-toolbar cause is not verified. |

## Acceptance Criteria

At 393×852 unless stated:

1. On Schedule, Assigned, Active, Recent, Jobs, Maintenance, Picking and My Hours, a 5-item tab bar shows at the bottom. A tap on Active opens `/x/active`, and the Active tab shows as current.
2. With 6 open maintenance dispatches, the Maintenance tab shows "6". With 0, it shows no badge.
3. A tap on More opens the Navigation sheet. The sheet lists Schedule, Assigned, Active, Recent, Jobs, Maintenance, Picking, Add Inventory, Remove Inventory, End Operations, Suggestion and Displays in that order. Clock In, My Hours and the user row show without a scroll.
4. On Operation, Assembly, Inspection, Job detail, Dispatch detail and Picking detail, no tab bar shows, and a 44px Back shows at the top-left.
5. Open an operation from Active, then tap Back. The app shows `/x/active`. The same flow on desktop at 1280px also returns to Active.
6. My Hours shows the app bar, the tab bar and a full-width Clock In button at the bottom. With no entries, the full empty message shows.
7. On Schedule with 1 work center, the column fills the width, and at least 2 full cards show above the fold.
8. On the Operation page with a running Machine timer, the toggle shows Machine and the dock shows a red Pause and "Machine · <elapsed>".
9. On the Operation page, the scrolling content area is at least 65% of the screen height on the Details tab. The context row scrolls away.
10. On the Operation page, every material shows an Issue button that is at least 44px and fully on screen.
11. On Inspection, the first sample input is fully visible without a sideways scroll. Accept shows as a labelled button at the bottom.
12. On Picking detail, Finish is a full-width button at the bottom.
13. On Dispatch detail, a tap on Complete opens a confirmation. Cancel closes it and the dispatch stays open.
14. On Job detail, the graph runs top-to-bottom and no minimap shows.
15. `document.documentElement.scrollWidth` is 393 on every screen in this spec.
16. At 1280×800, Schedule, Assigned, Jobs, Operation, Picking detail and Inspection match their pre-change screenshots, except for the 2 renamed titles and the Back label.
17. The ERP tab bar at 393px looks the same as before the `TabBar` extraction.
18. `pnpm exec turbo run typecheck --filter=mes --filter=erp` passes. Every new string is in Lingui.
19. A round-2 review by the same 3 reviewer lenses averages 75/100 or more.

## Open Questions

- [x] Should the MES have a bottom tab bar? — **Answer:** Yes. Schedule · Assigned · Active · Maintenance · More (owner).
- [x] Back to the origin also changes desktop. Allow it? — **Answer:** Yes (owner).
- [x] Rename "Assigned to Me" and "Open Jobs" to match the nav? — **Answer:** Yes, desktop too (owner).
- [x] Job graph top-to-bottom on phones with no minimap? — **Answer:** Yes (owner).
- [x] Add a confirmation to dispatch Complete? — **Answer:** Yes (owner).
- [x] Timer toggle opens on the running type, desktop too? — **Answer:** Yes, at all widths (owner).
- [x] Card density: 2-column with all fields, or a 3-line summary? — **Answer:** 2-column, keep all fields (owner).
- [x] Confirm Clock Out? — **Answer:** No. Clock Out stays 1 tap (owner).
- [x] Change the shell scroll model to document scroll? — **Answer:** Out of scope for this round. The cause is not verified on a device.
- [x] Run the 3 phases one at a time with a review after each, or all then review? — **Answer:** All 3 phases, then 1 round-2 review (owner).

## Research

N/A. This is layout work inside the existing MES. The design follows the phone rulebook from the ERP phone redesign (`local-docs/mobile-design/src/build/rules.html`) and the ERP phone chrome (`.ai/specs/2026-10-07-mobile-chrome-structure.md`).

## Changelog

- 2026-10-07: Draft written from the round-1 review and 8 owner answers.
- 2026-10-07: Approved. Back uses `?from=` instead of `location.state` (state does not survive loader redirects). Empty states add no new text.
