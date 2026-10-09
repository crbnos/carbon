# MES phone layout

> Status: approved
> Date: 2026-10-07
> Extends: `.ai/specs/2026-10-07-viewport-api.md` (`max-md:`, `useViewport`)
> Design source: the MES module of the mobile prototype (`local-docs/mobile-design/index.html`, specs
> `src/build/screens/mes_a.json` and `mes_b.json`, before screenshots `screenshots/mes/`)

## TL;DR

- The MES gets a phone layout below 768px. Tablet and desktop do not change.
- The work is layout only: no new features, no new data, no removed data.
- Boards and cards keep their content; the large 3D thumbnail becomes a small tile on phones.
- The Jobs table shows as list rows on phones; the My Hours table scrolls inside its card.
- Toolbars and header rows that overflow at 393px wrap or move to their own row.
- Dialogs already open as bottom sheets through the shared components, so they need no work.

## Problem

The MES at 393px (screenshots in `screenshots/mes/`) has these faults:

| Screen | Fault |
|---|---|
| Schedule, Assigned | The toolbar is wider than the screen (Search, Filter, the station chip, Display). Each card shows a 330px 3D thumbnail, so one card fills the screen. |
| Active, Recent | The same full-width thumbnail on every card. |
| Jobs | An 8-column table; the last columns are off screen. |
| Maintenance | The tab row and the search and filter share one row and overflow. |
| My Hours | A 4-column table inside a card. |
| Picking detail | The header row holds the ID, status, the line count and Finish, and clips. |
| Operation | The back link, the title and four tabs share one 52px row; "Chat" is off screen. |
| Assembly, Inspection | The header strip holds 6 controls and clips. |

## Goals

- Nothing overflows horizontally at 320px to 430px on the screens in the table.
- Every element that a screen shows on desktop is still on the phone screen.
- Tablet (768px and up) renders as it does today.

## Non-goals

- No ERP tab bar. The MES desktop has no Home, Search, Create or Modules. Round 2 adds an MES tab bar built from the sidebar's own items (`2026-10-07-mes-phone-round-2.md`).
- No new interactions: drag stays drag, and no long-press menus.
- No change to the 3D model viewers or the wall displays. Round 2 changes the Job graph direction and minimap on phones; the graph stays a canvas.
- No change to dialog content. The shared `Modal`, `Drawer` and `Popover` already render bottom sheets below 768px.
- Prototype items that add content are out of scope: graph status icons and legend, explanations on disabled buttons, the location and due date in the picking hero.

## Design

All phone styles use `max-md:`. A component tree changes only where CSS cannot do it, with `useViewport().isPhone`.

### Page header (all queue pages)

- The header keeps `SidebarTrigger` and the title. The trigger already opens the Navigation sheet on phones.

### Schedule and Assigned (board)

1. The toolbar wraps on phones (`max-md:flex-wrap`). The search and Filter stay on the first row. The station chip and Display wrap to the next row.
2. A column is `max-md:w-[300px]`, so the next column shows at the right edge. The board already snaps.
3. `ItemCard`: on phones the thumbnail is a 40px tile in the card header, beside the item. The large thumbnail is `max-md:hidden`. The Display setting `showThumbnail` still controls both.

### Active and Recent (card grid)

- `OperationsList` cards use the same thumbnail rule as `ItemCard`.

### Jobs

- Below 768px the table is hidden and a list shows the same 8 fields per job: job and quantity on line 1, item ID and description on line 2, then status, deadline, due date, tracking and assignee. The whole row links to the job. At 768px and up the table shows as today.

### Maintenance

- The tab row and the search and filter stack on phones (`max-md:flex-col max-md:items-stretch`). The tab row scrolls sideways when it does not fit.

### My Hours

- The table edits a row in place (two date-time inputs and Save). A second phone layout would copy that edit logic, so on phones the table keeps its columns and scrolls sideways inside its card (`min-w-[560px]`). The page itself does not scroll sideways.

### Picking detail

- The header wraps on phones: the ID and status on the first row, the line count and Finish on the next row.
- A line's item name truncates instead of running under the quantity badge (the name gets `w-full` inside its `items-start` column).

### Operation, Assembly, Inspection

- Operation: below 768px the tab list moves out of the header onto its own full-width row, under the header. The tab row scrolls sideways when it does not fit.
- Assembly and Inspection: no change. Both header strips already hide their labels below `sm` and fit at 393px.

## Design Decisions

| Decision | Choice | Why |
|---|---|---|
| Shell | Keep the MES header and Navigation sheet | They already work on phones; a tab bar would add destinations the MES lacks |
| Board on phones | Keep columns, 300px wide | The board already snaps; a narrower column shows the next one |
| Thumbnail | 40px tile in the header on phones | One card per screen hides the queue |
| Tables | Jobs: list rows below 768px, all fields kept. My Hours: the table scrolls inside its card | Fields off screen are lost data. My Hours edits rows in place, so a second layout would copy its edit logic |
| Interactions | No long-press, no new sheets | Owner rule: adapt, never add |
| Breakpoint API | `max-md:` and `useViewport` | The viewport spec of 2026-10-07 |

## Acceptance criteria

- [ ] At 393px, each screen in the Problem table has no horizontal page scroll (`document.documentElement.scrollWidth <= 393`).
- [ ] At 393px, a Schedule card is under 300px tall with the thumbnail on.
- [ ] At 393px, Jobs shows every job's job ID, item, quantity, status, deadline, due date, tracking and assignee.
- [ ] At 393px, the Operation page shows all four tabs; Chat can be reached.
- [ ] At 1280px, Schedule, Jobs and Operation match their pre-change screenshots.
- [ ] Typecheck passes for `mes`; Biome passes on the changed files.

## Open questions (resolved)

- [x] Ask before each step? — **Answer:** No. The owner asked for all steps to run without check-ins.
- [x] Bottom tab bar for the MES? — **Answer:** No. Recorded as an exception in the prototype (R2.1).
- [x] Prototype items that add features? — **Answer:** Dropped (see Non-goals); the owner's rule is adapt, never add.

## Changelog

- 2026-10-07: First version, from the MES prototype.
- 2026-10-07: Implemented. My Hours keeps its table (scrolls in its card); Assembly and Inspection needed no change.
